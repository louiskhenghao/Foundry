/**
 * The context-window denominator is not recorded anywhere on disk, so the map lives here.
 * Wrong for a future model until updated — the UI shows raw token counts next to the gauge for that reason.
 *
 * Caveat: a session started with a `[1m]` alias reports the plain model id in its transcript, so the
 * suffix never shows up here — pass the observed usage and the window is corrected upward when usage
 * proves the session must be on the 1M tier.
 */
export function contextWindowFor(model: string | null, usedTokens?: number | null): number {
  let win = 200_000;
  if (model && (/\[1m\]$/.test(model) || /-1m\b/.test(model))) win = 1_000_000;
  if (usedTokens != null && usedTokens > win) win = 1_000_000;
  return win;
}
