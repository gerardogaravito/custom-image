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
