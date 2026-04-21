// Pure helpers for the canvas pointer state machine. Kept separate from
// `main.ts` so the touchy logic (pinch / pan / tap discrimination) has at
// least one piece that's covered by unit tests.

/**
 * How many of the tracked pointers are real touches — i.e., capable of forming
 * a pinch gesture.
 *
 * Mouse and pen are explicitly excluded:
 *   • A mouse cursor is a single-point input by definition. Two simultaneous
 *     mouse pointers in `activePointers` always indicate a stale/orphan one
 *     (a previous `pointerup` that got swallowed by `pointercancel`, devtools
 *     focus loss, OS gesture, etc).
 *   • A pen / stylus is also single-point. Pinch zoom requires fingers.
 *
 * Without this filter, the canvas pinch branch fires whenever
 * `activePointers.size >= 2`, which means a single mouse drag with one orphan
 * pointer in the Map produces a phantom pinch zoom on desktop. (See the
 * incident notes in `mobile-ux.md` § 5.)
 */
export function countTouchPointers(
  pointers: Iterable<{ type: string }>,
): number {
  let n = 0;
  for (const p of pointers) if (p.type === 'touch') n++;
  return n;
}
