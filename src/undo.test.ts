import { describe, it, expect } from 'vitest';
import { History, UndoStack } from './undo';

describe('UndoStack — basic contract', () => {
  it('starts empty', () => {
    const s = new UndoStack<number>();
    expect(s.size()).toBe(0);
    expect(s.isEmpty()).toBe(true);
  });

  it('pop on empty returns undefined', () => {
    const s = new UndoStack<number>();
    expect(s.pop()).toBeUndefined();
  });

  it('push then pop returns the same item', () => {
    const s = new UndoStack<string>();
    s.push('a');
    expect(s.size()).toBe(1);
    expect(s.isEmpty()).toBe(false);
    expect(s.pop()).toBe('a');
    expect(s.size()).toBe(0);
  });

  it('LIFO: pop returns the most recent push', () => {
    const s = new UndoStack<number>();
    s.push(1); s.push(2); s.push(3);
    expect(s.pop()).toBe(3);
    expect(s.pop()).toBe(2);
    expect(s.pop()).toBe(1);
    expect(s.pop()).toBeUndefined();
  });

  it('clear empties the stack', () => {
    const s = new UndoStack<number>();
    s.push(1); s.push(2);
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.isEmpty()).toBe(true);
    expect(s.pop()).toBeUndefined();
  });
});

describe('UndoStack — limit', () => {
  it('drops the oldest entry when over the limit', () => {
    const s = new UndoStack<number>(3);
    s.push(1); s.push(2); s.push(3); s.push(4);
    expect(s.size()).toBe(3);
    expect(s.pop()).toBe(4);
    expect(s.pop()).toBe(3);
    expect(s.pop()).toBe(2);  // 1 was dropped
    expect(s.pop()).toBeUndefined();
  });

  it('default limit is 20', () => {
    const s = new UndoStack<number>();
    for (let i = 0; i < 25; i++) s.push(i);
    expect(s.size()).toBe(20);
    // The 5 oldest (0..4) should have been dropped
    expect(s.pop()).toBe(24);
    // Pop the remaining 19 — last one is index 5
    let last = -1;
    while (!s.isEmpty()) last = s.pop()!;
    expect(last).toBe(5);
  });

  it('throws on invalid limit', () => {
    expect(() => new UndoStack<number>(0)).toThrow();
    expect(() => new UndoStack<number>(-1)).toThrow();
    expect(() => new UndoStack<number>(NaN)).toThrow();
    expect(() => new UndoStack<number>(Infinity)).toThrow();
  });

  it('floors fractional limits', () => {
    const s = new UndoStack<number>(2.7);
    s.push(1); s.push(2); s.push(3);
    expect(s.size()).toBe(2);
  });
});

describe('UndoStack — regression: repeated push/pop cycles', () => {
  // Documented expectation behind the bug fix: a fresh push after a pop must
  // be poppable on its own. (The actual bug was in main.ts — slider changes
  // weren't pushing snapshots — but this test reinforces the stack contract.)
  it('push → pop → push → pop returns each item independently', () => {
    const s = new UndoStack<string>();
    s.push('first');
    expect(s.pop()).toBe('first');
    expect(s.isEmpty()).toBe(true);

    s.push('second');
    expect(s.size()).toBe(1);
    expect(s.pop()).toBe('second');
    expect(s.isEmpty()).toBe(true);

    s.push('third');
    expect(s.pop()).toBe('third');
    expect(s.pop()).toBeUndefined();
  });

  it('many alternating push/pop operations stay consistent', () => {
    const s = new UndoStack<number>(50);
    const seen: number[] = [];
    for (let i = 0; i < 100; i++) {
      s.push(i);
      seen.push(s.pop()!);
    }
    expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(s.isEmpty()).toBe(true);
  });

  it('mixed pushes interleaved with pops keep LIFO order', () => {
    const s = new UndoStack<string>();
    s.push('a');
    s.push('b');
    expect(s.pop()).toBe('b');     // [a]
    s.push('c');                    // [a, c]
    s.push('d');                    // [a, c, d]
    expect(s.pop()).toBe('d');      // [a, c]
    expect(s.pop()).toBe('c');      // [a]
    expect(s.pop()).toBe('a');      // []
    expect(s.pop()).toBeUndefined();
  });
});

describe('UndoStack — generic over arbitrary payload types', () => {
  it('works with object snapshots (reference identity preserved)', () => {
    type Snap = { adjust: { exposure: number }; tag: string };
    const s = new UndoStack<Snap>();
    const snapA: Snap = { adjust: { exposure: 50 }, tag: 'A' };
    const snapB: Snap = { adjust: { exposure: -20 }, tag: 'B' };
    s.push(snapA);
    s.push(snapB);
    expect(s.pop()).toBe(snapB);    // same reference
    expect(s.pop()).toBe(snapA);
  });
});

describe('History — undo/redo coordinator', () => {
  it('starts with no undo and no redo', () => {
    const h = new History<number>();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('push enables undo, leaves redo empty', () => {
    const h = new History<number>();
    h.push(1);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('undo returns the past entry and stashes current into future', () => {
    const h = new History<number>();
    h.push(1);
    // Caller's current state is 2 (e.g., after the action that produced snap 1)
    expect(h.undo(2)).toBe(1);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('redo returns the future entry and stashes current into past', () => {
    const h = new History<number>();
    h.push(1);
    h.undo(2);  // future = [2]
    // Caller's current state is now 1 (we just restored it)
    expect(h.redo(1)).toBe(2);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('a fresh push invalidates the redo stack', () => {
    const h = new History<number>();
    h.push(1);
    h.undo(2);              // future = [2]
    expect(h.canRedo()).toBe(true);
    h.push(3);              // any new action wipes redo
    expect(h.canRedo()).toBe(false);
  });

  it('undo on empty returns undefined and does not touch future', () => {
    const h = new History<number>();
    expect(h.undo(99)).toBeUndefined();
    expect(h.canRedo()).toBe(false);
  });

  it('redo on empty returns undefined and does not touch past', () => {
    const h = new History<number>();
    expect(h.redo(99)).toBeUndefined();
    expect(h.canUndo()).toBe(false);
  });

  it('clear empties both stacks', () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    h.undo(99);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('full undo → redo round-trip preserves the chain', () => {
    const h = new History<string>();
    h.push('a');           // past=[a]
    h.push('b');           // past=[a,b]
    h.push('c');           // past=[a,b,c]
    expect(h.undo('now')).toBe('c'); // past=[a,b], future=[now]
    expect(h.undo('c')).toBe('b');   // past=[a],   future=[now,c]
    expect(h.redo('b')).toBe('c');   // past=[a,b], future=[now]
    expect(h.redo('c')).toBe('now'); // past=[a,b,c], future=[]
    expect(h.canRedo()).toBe(false);
  });

  it('regression — crop scenario: snapshot before destructive op + restore via undo', () => {
    // Models the bug the user hit on the crop tab:
    // 1. push snapshot of state with cropBox set
    // 2. perform destructive op (crop apply): state changes (here represented as a tag)
    // 3. user hits undo → should recover the original snapshot
    type S = { tag: string; cropBox: { x: number } | null };
    const h = new History<S>();
    h.push({ tag: 'pre-apply', cropBox: { x: 100 } });
    // apply happens: now caller's state is post-apply with cropBox reset
    const restored = h.undo({ tag: 'post-apply', cropBox: null });
    expect(restored).toEqual({ tag: 'pre-apply', cropBox: { x: 100 } });
    // and the redo path stays available
    expect(h.canRedo()).toBe(true);
    const redone = h.redo({ tag: 'pre-apply', cropBox: { x: 100 } });
    expect(redone).toEqual({ tag: 'post-apply', cropBox: null });
  });
});
