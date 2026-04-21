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
 * Mobile UX tunables. Single tap on the canvas (touch only) toggles immersion
 * mode — the chrome (tools, zoom bar, hints) fades out so the photo is
 * unobstructed. After `immersionDurationSeconds` the chrome fades back.
 */
export const MOBILE_UX = {
  /** Seconds chrome stays faded after a tap-to-immerse before auto-restoring. */
  immersionDurationSeconds: 3,
  /** Max time (ms) between pointerdown and pointerup to count as a tap. */
  tapMaxMs: 250,
  /** Max movement (px) during a tap — anything more is treated as a drag. */
  tapMaxPx: 8,
};
