// Layout-mode helpers shared between JS and CSS. The CSS uses
// `@media (hover: none)` to switch to a touch-first layout (tools panel
// anchored to the bottom of the viewport, zoom bar on top). JS needs the same
// signal in a few places — keeping the detection in one helper avoids the two
// surfaces drifting apart.

/**
 * True when the device is touch-first (no hover capability). Mirrors the CSS
 * `@media (hover: none)` query so JS branches stay in lockstep with layout.
 *
 * Returns `false` when `matchMedia` is unavailable (Node test env, SSR) so
 * callers can rely on a boolean without guarding the global themselves.
 */
export function isMobileLayout(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  return matchMedia('(hover: none)').matches;
}

/**
 * Where to vertically anchor the floating A/B hint relative to the tools panel.
 *
 * - Desktop: panel sits in the top-right corner, hint goes directly under it
 *   (`toolsBottom + gap` from the viewport top).
 * - Mobile: panel hugs the bottom of the viewport. There's no room beneath it
 *   for the hint without it falling off-screen, so we return `null` and the
 *   caller skips rendering entirely. This is preferable to repositioning the
 *   hint above the panel because (a) the panel height changes with the active
 *   tab, making a stable anchor awkward, and (b) the hint is a non-critical
 *   credit — silent omission is fine on small screens.
 *
 * Pure function — no DOM access — so it's trivially unit-testable.
 *
 * @param toolsBottom Y coord (px from viewport top) of the tools panel's bottom edge.
 * @param isMobile    Result of {@link isMobileLayout}, passed in for testability.
 * @param gap         Pixels between panel bottom and hint top. Defaults to 8px.
 * @returns Top offset in px, or `null` to skip rendering.
 */
export function computeAbHintTop(
  toolsBottom: number,
  isMobile: boolean,
  gap: number = 8,
): number | null {
  if (isMobile) return null;
  return toolsBottom + gap;
}
