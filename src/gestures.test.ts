import { describe, it, expect } from 'vitest';
import { countTouchPointers } from './gestures';

describe('countTouchPointers — pinch eligibility filter', () => {
  it('returns 0 for an empty pointer set', () => {
    expect(countTouchPointers([])).toBe(0);
  });

  it('counts a single touch pointer', () => {
    expect(countTouchPointers([{ type: 'touch' }])).toBe(1);
  });

  it('counts two touches (the canonical pinch case)', () => {
    expect(countTouchPointers([{ type: 'touch' }, { type: 'touch' }])).toBe(2);
  });

  it('counts arbitrarily many touches (e.g. palm rest on iPad)', () => {
    expect(
      countTouchPointers([
        { type: 'touch' }, { type: 'touch' }, { type: 'touch' }, { type: 'touch' }, { type: 'touch' },
      ]),
    ).toBe(5);
  });

  it('ignores a single mouse pointer', () => {
    expect(countTouchPointers([{ type: 'mouse' }])).toBe(0);
  });

  it('ignores multiple mouse pointers (orphan + new mouse drag)', () => {
    // This is the regression scenario: a never-released mouse pointer left over
    // from a previous interrupted gesture, plus a fresh mouse-down. Old code
    // treated this as `size === 2` and triggered phantom pinch zoom.
    expect(countTouchPointers([{ type: 'mouse' }, { type: 'mouse' }])).toBe(0);
  });

  it('ignores pen pointers (stylus is single-point input, not pinch)', () => {
    expect(countTouchPointers([{ type: 'pen' }, { type: 'pen' }])).toBe(0);
  });

  it('returns 1 when one orphan mouse coexists with one real touch', () => {
    // Touch alone is not enough to start a pinch — the user is mid single-tap
    // or pan. Mustn't count the stale mouse as the "second finger".
    expect(countTouchPointers([{ type: 'mouse' }, { type: 'touch' }])).toBe(1);
  });

  it('counts only the real touches when mouse and pen also coexist', () => {
    expect(
      countTouchPointers([
        { type: 'mouse' }, { type: 'pen' }, { type: 'touch' }, { type: 'touch' },
      ]),
    ).toBe(2);
  });

  it('works with a Map values iterator (mirrors the real callsite)', () => {
    const m = new Map([
      [10, { x: 0, y: 0, type: 'touch' as const }],
      [20, { x: 0, y: 0, type: 'mouse' as const }],
      [30, { x: 0, y: 0, type: 'touch' as const }],
    ]);
    expect(countTouchPointers(m.values())).toBe(2);
  });

  it('treats unknown pointer types conservatively (not touch → not counted)', () => {
    // Defensive: future spec extensions or weird drivers shouldn't accidentally
    // unlock pinch. Only the explicit string 'touch' counts.
    expect(countTouchPointers([{ type: 'eraser' }, { type: '' }])).toBe(0);
  });
});
