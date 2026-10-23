/**
 * marineSettleReloadGuard.js — the scrub-settle clamp stops force-reloading a series page it already holds a covering frame of
 * (2026-10-23).
 *
 * WHY. runScrubSettleCheck's clamp branch (useMarineScrubSettle.js) commits a covering regional series frame when it is meaningfully
 * finer than the resident grid; otherwise it force-loads the view's page (`ensureMarineSeries(..., currentPageOnly, force=true)`)
 * "so the next tick can sharpen". When the resident grid reads regional_too_coarse and the covering series frame is the SAME coarse
 * grid (a model whose grid is that coarse at this zoom), the reload asks the same product again: it can never come back finer, and
 * the branch reloads on every settle tick, for ever.
 *   - Offline drain replay (scn_sibling_toggle.js: surf ON, ICON, 20 small pans at z8 off Florida, the 1-CPU box modelled): the
 *     resident ICON grid (0.46-deg cells) read regional_too_coarse, __MARINE_SHARPEN_DIAG__ showed frameFound + frameCovers true and
 *     willSharpen false every second, and the final box was asked again each time its page landed. dev: 18 to 60+ repeats of the final
 *     box, depending on the run; with less other work queued, 117 and still asking at the 600 s cap.
 *   - Live, real ICON at z7-9 can read too coarse the same way, and each reload is a 10-25 s surf page (the 19:44Z saturation).
 *
 * WHAT. Reload only when no covering regional frame exists, which is what the branch's own comment says it is for ("No covering
 * frame warmed yet"). The capped fuller-tile /grid upgrade just below it (clamp_resharpen, 2 per view and hour) still runs.
 * Kill: window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ = true (reload on every tick, as before).
 */
export function settleSeriesReloadNeeded(coveringRegionalFrame) {
  return (typeof window !== 'undefined' && window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ === true) || !coveringRegionalFrame;
}
