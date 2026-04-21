// Centralized app config / UI strings.
// Convention: empty string = feature disabled (no DOM render, no timers).
// To enable a hint, just set its value to non-empty text. No other changes
// needed — the consumer (main.ts) checks the value at runtime.

/**
 * Floating hint texts. Each hint is shown once per session when the relevant
 * UI becomes visible, fades out after its configured duration or on click, and
 * is fully disabled when its text is the empty string.
 */
export const HINTS = {
  /** Below the tools panel — explains the A/B toggle gesture on adjustments. */
  ab: 'por Gerardo Garavito',
  /** Seconds the AB hint stays visible before auto-dismissing. */
  abDurationSeconds: 3,
};

/**
 * Mobile UX tunables. The mobile UI follows an "image-first" model:
 *   • Default state after image load is `body.is-menu-hidden` — only the
 *     image + zoom bar are visible.
 *   • Single tap on the canvas toggles the menu (tabs bar + bottom sheet).
 *   • Drag or pinch on the canvas auto-hides the menu so it gets out of the
 *     way during exploration / zoom gestures.
 * See mobile-ux.md § 7 for the full state machine.
 */
export const MOBILE_UX = {
  /** Max time (ms) between pointerdown and pointerup to count as a tap. */
  tapMaxMs: 250,
  /** Max movement (px) during a tap — anything more is treated as a drag. */
  tapMaxPx: 8,
  /**
   * Pointer travel (px) on the canvas that triggers the auto-hide of the
   * mobile menu. Higher than `tapMaxPx` so a slightly shaky tap doesn't
   * accidentally hide it; lower than a typical pan gesture so the menu is
   * already out of the way once the user is exploring.
   */
  dragHidePx: 30,
};
