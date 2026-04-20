// Generic LIFO stack with a max size. Used by main.ts to hold editor snapshots.
// Pure data structure — no DOM, no side effects — so it's straight-forward to
// unit-test the contract.

export class UndoStack<T> {
  private items: T[] = [];
  private readonly limit: number;

  constructor(limit = 20) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error('UndoStack limit must be a positive integer');
    }
    this.limit = Math.floor(limit);
  }

  /** Push an entry. When the stack is full, the oldest entry is dropped. */
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.limit) this.items.shift();
  }

  /** Pop the most recent entry, or `undefined` if the stack is empty. */
  pop(): T | undefined {
    return this.items.pop();
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items.length = 0;
  }
}

/**
 * Two-stack undo/redo coordinator. Wraps two `UndoStack`s — `past` and `future` —
 * implementing the canonical pattern: `push` records a new state and clears the
 * future; `undo` moves a state from past → future (returning the popped past);
 * `redo` moves it back. Pure: no DOM, fully tested in `undo.test.ts`.
 *
 * Caller is responsible for snapshotting the *current* state when calling
 * `undo`/`redo` — the coordinator pushes that snapshot to the opposite stack
 * so the operation is reversible.
 */
export class History<T> {
  private readonly past: UndoStack<T>;
  private readonly future: UndoStack<T>;

  constructor(limit = 20) {
    this.past = new UndoStack<T>(limit);
    this.future = new UndoStack<T>(limit);
  }

  /** Record a new state. Clears the redo stack (a new action invalidates redo). */
  push(snapshot: T): void {
    this.past.push(snapshot);
    this.future.clear();
  }

  /** Returns the snapshot to apply (popped from past) and stashes `current` in future. */
  undo(current: T): T | undefined {
    const snap = this.past.pop();
    if (snap === undefined) return undefined;
    this.future.push(current);
    return snap;
  }

  /** Returns the snapshot to apply (popped from future) and stashes `current` in past. */
  redo(current: T): T | undefined {
    const snap = this.future.pop();
    if (snap === undefined) return undefined;
    this.past.push(current);
    return snap;
  }

  canUndo(): boolean { return !this.past.isEmpty(); }
  canRedo(): boolean { return !this.future.isEmpty(); }

  clear(): void {
    this.past.clear();
    this.future.clear();
  }
}
