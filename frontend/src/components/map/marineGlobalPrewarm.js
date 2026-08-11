// marineGlobalPrewarm.js — the GLOBAL-coarse grid/series prewarm and the zoom-out coarse-bridge seed.
// Split out of marineController.js on 2026-08-11 (cut 2 of 3) to hold that file under the 800 LOC
// ratchet. PURE RELOCATION: every line below is the code that stood in marineController, comments
// included; the only additions are the imports, the exports, and the dependency seam directly under
// this header. Public symbols are re-exported from marineController so no call site moved.
//
// THE SEAM (why this is injection and not an import): the moved code calls three things that live IN
// marineController — getModelSafeMarine and isMarineSiblingPrewarmEnabled are declared there, and
// _cacheMarineResult is re-exported through it. marineController already imports ensureMarineSeries
// from marineGridSeries and now imports this module, so importing marineController back from here
// would close a cycle in both directions. ES modules tolerate cycles; a LIVE FETCH PATH must not
// depend on that tolerance. marineController calls registerPrewarmDeps once at module scope instead,
// so the edges here point one way only: marineController -> marineGlobalPrewarm -> {series, clients}.

import { ensureMarineSeries } from './marineGridSeries';
import { fetchBackendMarineGrid } from './backendWeatherServiceClient';
import { fetchBackendCopernicusGrid } from './backendCopernicusServiceClient';

let _prewarmDeps = null;

/**
 * Wire the marineController-owned dependencies this module needs. Called ONCE at marineController
 * module scope. Deliberately NOT defaulted to a stub: an unregistered dep must disable the warm (see
 * the fail-soft guard in prewarmGlobalMarineGrid), never fake a cache read or a cache write.
 */
export function registerPrewarmDeps({ getModelSafeMarine, cacheMarineResult, isSiblingPrewarmEnabled } = {}) {
  _prewarmDeps = { getModelSafeMarine, cacheMarineResult, isSiblingPrewarmEnabled };
}

// GLOBAL-COARSE grid prewarm (2026-07-04, the "heatmap clears 3-5s on FIRST zoom-out" root, traced):
// on zoom-out past z7 the display gate rejects the regional grid (op 0) and the GLOBAL-coarse grid
// must take over — but on a COLD cache that /grid fetch is ~5s (1-CPU backend), a long blank window
// (only ~1s once warm). Warm the ACTIVE layer's global-coarse into the SAME result cache the zoom-out
// lookup uses, WHILE the user is still zoomed in. SAFE vs the documented landmine (which COMMITTED a
// coarse grid at a zoomed-IN viewport → tripped the backstop → clear): this only CACHES via
// _cacheMarineResult under the 'global_coarse' tile key. A zoomed-IN fetchMarineData keys by the
// VIEWPORT tile (viewport_...), never global_coarse, so the cached global can only be RETRIEVED +
// committed once the viewport is wide (zoomed out) — its correct context. Bounded: deduped, skipped
// once cached, gated to zoomed-in viewports, rides the sibling-prewarm kill switch, silent (no
// truth-stage pollution). No abort signal → the background warm survives the pan/zoom that would
// otherwise cancel it (the global is location-independent, so a stray completion is harmless).
const _globalGridPrewarmInFlight = new Set();
const _GLOBAL_BOUNDS = { west: -180, south: -80, east: 180, north: 85 };

// Stage a global-width grid as the zoom-out bridge's coarse-base seed (engine snapshots it at its
// next render — GL-timing-safe). Shared by the prewarm's fetch path and its cache-warm early-return
// (2026-07-06: the early-return used to skip seeding, leaving the bridge baseless after an engine
// clear — the "rectangle before the heatmap expands" zoom-out transient). Best-effort, never throws.
// Kill: __RAW_DISABLE_COARSE_BRIDGE__. Telemetry: __MARINE_BRIDGE_SEED__ {count,lastFrom,lastAt}.
//
// MODEL-SWITCH STALENESS (2026-07-15, user's ICON "animations but no heatmap under them"): the old
// gate refused to stage while ANY base existed — after a model switch the engine still held the
// PREVIOUS model's base, blend-both's same-model check rightly disengaged the wash, and this gate
// then blocked the replacement forever (the user had to zoom far out so a world-coarse commit for
// the new model landed organically). A base or pending seed only blocks staging when it MATCHES the
// active (model, layer); a stale-identity base is treated as absent so the switch re-warms the wash.
export function _coarseBaseMatches(o, m, activeLayer) {
  return !!o && (o.__sourceModel || 'GFS') === (m || 'GFS') &&
         (o.__componentLayer || 'waves') === (activeLayer || 'waves');
}
export function _stageCoarseBridgeSeed(g, m, activeLayer, from) {
  try {
    const eng = (typeof window !== 'undefined') && window.__MARINE_ENGINE__;
    if (eng && g &&
        !_coarseBaseMatches(eng._coarseBaseData, m, activeLayer) &&
        !_coarseBaseMatches(eng._pendingCoarseBaseGrid, m, activeLayer) &&
        (typeof window === 'undefined' || window.__RAW_DISABLE_COARSE_BRIDGE__ !== true)) {
      if (!g.__sourceModel) g.__sourceModel = m;
      if (!g.__componentLayer) g.__componentLayer = activeLayer;
      eng._pendingCoarseBaseGrid = g;
      if (typeof window !== 'undefined') {
        const t = window.__MARINE_BRIDGE_SEED__ = window.__MARINE_BRIDGE_SEED__ || { count: 0 };
        t.count++; t.lastFrom = from || 'fetch'; t.lastAt = new Date().toISOString();
      }
    }
  } catch (e) { /* seed is best-effort */ }
}

// Re-warm the wash base ONLY when it is stale for the active (model, layer) — the CACHE-HIT
// complement of the redirect-path prewarm calls (2026-07-15): a model/layer switch served from the
// sibling-prewarmed cache returns before the redirect block, so the stale-base wedge persisted on
// exactly the switches that were fast. Network cost is zero unless the base truly mismatches
// (prewarmGlobalMarineGrid additionally dedups in-flight and serves cache-warm globals seed-only).
export function _rewarmWashBaseIfStale(m, hourOffset, bounds, activeLayer) {
  try {
    const eng = (typeof window !== 'undefined') && window.__MARINE_ENGINE__;
    if (!eng) return;
    if (_coarseBaseMatches(eng._coarseBaseData, m, activeLayer)) return;
    if (_coarseBaseMatches(eng._pendingCoarseBaseGrid, m, activeLayer)) return;
    prewarmGlobalMarineGrid(m, hourOffset, bounds, activeLayer);
  } catch (e) { /* best-effort */ }
}

export function prewarmGlobalMarineGrid(model, hourOffset, bounds, activeLayer) {
  try {
    // FAIL SOFT ON AN UNREGISTERED DEP (the seam, 2026-08-11): a warm must never break the gesture
    // that triggered it, so a missing dependency RETURNS — it never throws and never half-runs.
    const deps = _prewarmDeps;
    if (!deps || typeof deps.isSiblingPrewarmEnabled !== 'function' ||
        typeof deps.getModelSafeMarine !== 'function' || typeof deps.cacheMarineResult !== 'function') return;
    if (!deps.isSiblingPrewarmEnabled()) return;
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) return;
    if (!bounds || bounds.east === undefined || bounds.north === undefined) return;
    // Only while ZOOMED IN (regional viewport ≤ 15°) — that's when a zoom-out is the next likely
    // gesture and the global is cold. At a wide viewport we already hold or are actively fetching it.
    const vw = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
    const vh = Math.abs(bounds.north - bounds.south);
    if (vw > 15 || vh > 15) return;
    const m = model || 'GFS';

    // THE SERIES HALF (audit v6) -- rationale relocated 2026-08-11 to keep marineController under the 800
    // LOC ratchet (it was 853). NOTHING WAS DELETED: the full reasoning, verbatim, is in
    // docs/research/FINDING-2026-08-11-marineController-rationale.md#series-half
    if (typeof window === 'undefined' || window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__ !== true) {
      try {
        // No abort signal, matching the grid warm: a background best-effort warm must survive the
        // pan/zoom that would otherwise cancel it. ensureMarineSeries is idempotent, TTL'd, deduped
        // and capped at 2 concurrent, so a repeated moveend is cheap.
        ensureMarineSeries(m, activeLayer, _GLOBAL_BOUNDS, hourOffset, undefined, true);
      } catch (e) { /* best-effort: a warm must never break the gesture that triggered it */ }
    }

    const key = `${m}_${hourOffset}_${activeLayer}_GLOBALGRID`;
    if (_globalGridPrewarmInFlight.has(key)) return;
    // Already have the global-coarse cached (from a prior zoom-out or prewarm)? Nothing to FETCH —
    // but the bridge seed below must still run: the engine's coarse base can be empty even while
    // the cache is warm (engine re-created or cleared on a layer/model switch AFTER the zoom-out
    // that cached this frame). The old bare early-return left the zoom-out bridge BASELESS in
    // exactly that state — the "rectangle before the heatmap expands into the next resolution"
    // report (2026-07-06). Stage the CACHED global (zero network) before returning.
    const cached = deps.getModelSafeMarine(m, hourOffset, activeLayer, _GLOBAL_BOUNDS);
    if (cached && cached.grid && Array.isArray(cached.grid.vectors) && cached.grid.vectors.length > 0) {
      const cb = cached.grid.bounds;
      const cw = cb ? ((cb.east < cb.west) ? (cb.east + 360) - cb.west : cb.east - cb.west) : 0;
      if (cw >= 340) {
        _stageCoarseBridgeSeed(cached.grid, m, activeLayer, 'cache_warm');
        return;
      }
    }
    _globalGridPrewarmInFlight.add(key);
    // No abort signal: this is a background best-effort warm that must survive the pan/zoom which
    // would otherwise cancel it. The global-coarse is location-independent, so it warms once and
    // serves every subsequent zoom-out.
    Promise.resolve()
      .then(() => (m === 'ICON')
        ? fetchBackendMarineGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, activeLayer, 'ICON')
        : (m === 'EURO')
          // EURO world-coarse is a manifest product like the others (decoupled era) but routes
          // through the Copernicus client — the GFS-shaped default would cache a GFS grid under
          // the EURO key (model poison). Added 2026-07-15 with the model-switch wash re-warm.
          ? fetchBackendCopernicusGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, 'controller-prewarm', activeLayer)
          : fetchBackendMarineGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, activeLayer))
      .then((result) => {
        const g = result && result.grid;
        if (g && Array.isArray(g.vectors) && g.vectors.length > 0) {
          deps.cacheMarineResult(m, hourOffset, result, activeLayer, true /* silent: no truth-stage pollution */);
          // COARSE-BASE SEED (2026-07-04, Part 2 of the z7 zoom-out bridge): a COLD coast (fresh session
          // straight to a coast, never zoomed out) never commits a coarse grid → engine._coarseBaseData is
          // empty → the zoom-out bridge can't engage. Stage the prewarmed global (tagged for blend match) so
          // the ENGINE snapshots it into the bridge base at its next render (proper render-loop GL timing —
          // never do GL work in this detached callback). Kill: __RAW_DISABLE_COARSE_BRIDGE__.
          _stageCoarseBridgeSeed(g, m, activeLayer);
        }
      })
      .catch(() => { /* best-effort: a cold zoom-out just falls back to the live fetch */ })
      .finally(() => { _globalGridPrewarmInFlight.delete(key); });
  } catch (e) { /* never let prewarm break the active fetch */ }
}
