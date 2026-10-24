/**
 * marineSettleReloadGuard.js — the scrub-settle clamp stops force-reloading, for ever, a series page it already holds a covering frame
 * of (2026-10-23).
 *
 * WHY. runScrubSettleCheck's clamp branch (useMarineScrubSettle.js) commits a covering regional series frame when it is meaningfully
 * finer than the resident grid; otherwise it force-loads the view's page (`ensureMarineSeries(..., currentPageOnly, force=true)`)
 * "so the next tick can sharpen". The landed page fires `marine_series_revalidated`, which runs the settle check again
 * (marineSettleLiveMap). When the resident reads regional_too_coarse and the covering series frame is the SAME coarse grid (a model
 * whose grid is that coarse at this zoom), every reload asks the same product again: a loop at page cadence, which the backstop's
 * no-progress cap does not stop (its signature is the engine grid's bounds, and the resident alternated between two grids).
 *   - Offline drain replay (scn_sibling_toggle.js: surf ON, ICON, 20 small pans at z8 off Florida, the 1-CPU box modelled): the
 *     resident ICON grid (0.46-deg cells) read regional_too_coarse, __MARINE_SHARPEN_DIAG__ showed frameFound + frameCovers true and
 *     willSharpen false every second, and the final box was asked again each time its page landed: dev 18 to 60+ times depending on
 *     the run; 117 and still asking at the 600 s cap when less other work was queued.
 *   - Live, real ICON at z7-9 can read too coarse the same way, and each reload is a 10-25 s surf page (the 19:44Z saturation).
 * NOT NEVER. The covering frame can be a coarse INTERIM (the backend serves a coarse clip while its regional product builds); then a
 * reload is how the fine product arrives, and refusing it outright made the swell replay fall back to more /grid asks (19 vs 11).
 *
 * WHAT. With no covering regional frame the branch reloads as before. With a covering frame that is not finer, it reloads under a
 * budget per {model, layer, hour, view}: SETTLE_RELOAD_QUICK at once, then one per SETTLE_RELOAD_GAP_MS, SETTLE_RELOAD_MAX in all.
 * The capped fuller-tile /grid upgrade just below it (clamp_resharpen, 2 per view and hour) is unchanged.
 * Kill: window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ = true (reload on every tick, as before).
 */
export const SETTLE_RELOAD_QUICK = 2;
export const SETTLE_RELOAD_GAP_MS = 30000;
export const SETTLE_RELOAD_MAX = 5;

const _reloads = new Map();   // key -> { count, lastAt }

/** The budget key: model, layer, hour and the view rounded to 0.5 deg (a pan to another view is another ask). */
export function settleReloadKey({ model, layer, hour, vb }) {
  const r = (v) => (Math.round(Number(v) * 2) / 2).toFixed(1);
  return vb ? `${model}_${layer}_${hour}_${r(vb.west)}_${r(vb.south)}_${r(vb.east)}_${r(vb.north)}` : `${model}_${layer}_${hour}`;
}

/** Whether the clamp branch should force-reload the view's page now (it records the reload when it says yes). */
export function settleSeriesReloadNeeded(coveringRegionalFrame, ask = {}, now = Date.now()) {
  if ((typeof window !== 'undefined' && window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ === true) || !coveringRegionalFrame) return true;
  const key = settleReloadKey(ask);
  const r = _reloads.get(key) || { count: 0, lastAt: 0 };
  if (r.count >= SETTLE_RELOAD_MAX || (r.count >= SETTLE_RELOAD_QUICK && now - r.lastAt < SETTLE_RELOAD_GAP_MS)) {
    if (typeof window !== 'undefined') window.__RAW_SETTLE_RELOAD_HELD__ = (window.__RAW_SETTLE_RELOAD_HELD__ || 0) + 1;
    return false;
  }
  _reloads.set(key, { count: r.count + 1, lastAt: now });
  if (_reloads.size > 64) _reloads.delete(_reloads.keys().next().value);
  return true;
}

export function _resetSettleReloadGuardForTest() { _reloads.clear(); }
