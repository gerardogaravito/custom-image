import { describe, it, expect } from 'vitest';
import { computeAbHintTop, isMobileLayout } from './layout';

describe('computeAbHintTop', () => {
  it('returns null on mobile so the caller skips rendering entirely', () => {
    expect(computeAbHintTop(100, true)).toBeNull();
  });

  it('returns toolsBottom + default 8px gap on desktop', () => {
    expect(computeAbHintTop(120, false)).toBe(128);
  });

  it('respects a custom gap', () => {
    expect(computeAbHintTop(120, false, 20)).toBe(140);
  });

  it('handles a zero gap (hint flush against the panel)', () => {
    expect(computeAbHintTop(120, false, 0)).toBe(120);
  });

  it('handles a tools panel anchored at viewport top (bottom near 0)', () => {
    expect(computeAbHintTop(0, false)).toBe(8);
  });

  it('returns null on mobile regardless of custom gap', () => {
    expect(computeAbHintTop(120, true, 50)).toBeNull();
  });

  it('preserves fractional bottoms (getBoundingClientRect can return decimals)', () => {
    expect(computeAbHintTop(123.5, false, 8)).toBeCloseTo(131.5, 6);
  });
});

describe('isMobileLayout', () => {
  it('returns false in environments without matchMedia (Node / SSR)', () => {
    // The test setup runs in node env which has no matchMedia by default —
    // the helper should degrade gracefully instead of throwing.
    expect(typeof matchMedia).toBe('undefined');
    expect(isMobileLayout()).toBe(false);
  });
});
