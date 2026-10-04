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

import { ensureMarineSeries, getMarineSeriesFrame, runBackgroundWarm } from './marineGridSeries';
import { fetchBackendMarineGrid, getSharedValidTime } from './backendWeatherServiceClient';
import { fetchBackendCopernicusGrid } from './backendCopernicusServiceClient';
import { coarseBaseOutdatedBy } from './marineStaleHour';
import { bridgeCeilDeg } from './marineZoomOutGate';
import { exactGfsPlaybackEnabled, isExactPlaybackFrame } from './marinePlaybackPolicy';

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
// once cached, gated to zoomed-in viewports (the world warm's `opts.band` serves up to the bridge's
// ceiling, grid only: see prewarmGlobalMarineGrid), rides the sibling-prewarm kill switch, silent (no
// truth-stage pollution). No abort signal → the background warm survives the pan/zoom that would
// otherwise cancel it (the global is location-independent, so a stray completion is harmless).
const _globalGridPrewarmInFlight = new Set();
const _GLOBAL_BOUNDS = { west: -180, south: -80, east: 180, north: 85 };

// F-03 (audit 14.0) — THE GUARD KEYED ON THE WRONG QUANTITY.
// Both the in-flight key and the controller result cache were keyed by `hourOffset`, but the thing
// actually fetched is identified by the RESOLVED valid_time. Marine frames are 3-hourly, so three
// consecutive 1-hour wheel steps resolve to ONE valid_time -- and each one missed the guard and
// downloaded the same ~2.3 MB world grid again. Measured live 2026-09-20 at z7: wheel handles 13,
// 14 and 15 every one resolved to 2026-09-21T12:00:00.000Z and issued three identical requests;
// across a 9-hour scrub that was 9 world fetches / 14,084 KB where 3 / ~4,700 KB were needed.
//
// So dedupe on the resolved time as well. This is strictly a REQUEST-IDENTITY repair: the second
// and third offsets receive the very grid the first one fetched for the same valid_time, so it
// cannot change a pixel. The global lane itself is untouched -- it has real consumers (coastal
// wash, crest-ring fill, zoom-out bridge) and removing it was never the fix.
const _globalGridByValidTime = new Map();   // vtKey -> { result, ts }
const _GLOBAL_VT_TTL_MS = 10 * 60 * 1000;   // matches the series page TTL: a warm scrub, not a session

function _vtKey(model, layer, validTimeIso) {
  return `${model}_${layer}_${validTimeIso}_GLOBALGRID`;
}

function _rememberGlobalByValidTime(key, result) {
  try {
    _globalGridByValidTime.set(key, { result, ts: Date.now() });
    // Bounded: a long scrub walks many frames, and this holds whole world grids. Evict oldest
    // beyond a small window so the repair cannot become the memory problem it just fixed.
    if (_globalGridByValidTime.size > 8) {
      const oldest = [..._globalGridByValidTime.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) _globalGridByValidTime.delete(oldest[0]);
    }
  } catch (e) { /* best-effort */ }
}

function _recallGlobalByValidTime(key) {
  const hit = _globalGridByValidTime.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > _GLOBAL_VT_TTL_MS) { _globalGridByValidTime.delete(key); return null; }
  return hit.result;
}

/** Test seam: the module-level maps outlive a Jest module registry reset of their consumers. */
export function _resetGlobalPrewarmDedupeForTest() {
  _globalGridByValidTime.clear();
  _globalGridPrewarmInFlight.clear();
  if (typeof window !== 'undefined') delete window.__MARINE_GLOBAL_PREWARM__;
}

// READ-BACK TELEMETRY (2026-10-01, audit F-21): what each call did and when the world grid actually went out. A warm that "fired"
// and fetched nothing was invisible (an offline replay saw the call and no request). window.__MARINE_GLOBAL_PREWARM__ =
// { calls, reasons: { <outcome>: n }, last: { reason, hour, at, ... }, grid: { hour, vt, queuedAt, startedAt, doneAt, ok } }.
function _note(reason, hour, extra) {
  try {
    if (typeof window === 'undefined') return;
    const t = window.__MARINE_GLOBAL_PREWARM__ = window.__MARINE_GLOBAL_PREWARM__ || { calls: 0, reasons: {} };
    t.calls++; t.reasons[reason] = (t.reasons[reason] || 0) + 1; t.last = { reason, hour, at: Date.now(), ...extra };
  } catch (e) { /* telemetry only */ }
}

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
// HOUR (2026-10-01, marineStaleHour.js, audit F-21): `g`, the grid about to be staged, is optional. A base (or pending seed)
// made for ANOTHER HOUR does not "match" it: the old identity-only test refused every right-hour seed for as long as the
// page-load world frame (the "now" hour) was held, so the zoom-out bridge promoted the wrong hour. Kill: __RAW_DISABLE_BASE_HOUR_SYNC__.
export function _coarseBaseMatches(o, m, activeLayer, g) {
  return !!o && (o.__sourceModel || 'GFS') === (m || 'GFS') &&
         (o.__componentLayer || 'waves') === (activeLayer || 'waves') &&
         !(g && coarseBaseOutdatedBy(o, g));
}
export function _stageCoarseBridgeSeed(g, m, activeLayer, from) {
  try {
    const eng = (typeof window !== 'undefined') && window.__MARINE_ENGINE__;
    if (eng && g &&
        !_coarseBaseMatches(eng._coarseBaseData, m, activeLayer, g) &&
        !_coarseBaseMatches(eng._pendingCoarseBaseGrid, m, activeLayer, g) &&
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

// `opts.gridFirst` (2026-10-01, audit F-21, marineStaleHour.js), optional and opt-in: the world warm (marineWorldWarmOnSettle.js) passes it,
// every other caller keeps the old order. The exact world grid goes out BEFORE the world series half, which holds the background lane's
// single slot while it loads. The series half then starts when the grid settles, or at once if there is nothing to fetch.
// Kill: __RAW_DISABLE_WORLD_GRID_FIRST__.
// `opts.band` (2026-10-02, the F-22 follow-up; owner: "keep the 2 degree frame for the selected hour at every zoom in that range"), optional and
// opt-in, passed only by the world warm: serve a view the 15 degree gate below calls wide, up to the bridge's ceiling (bridgeCeilDeg, 40 by
// default), where the F-22 bridge promotes a held 2-degree base for the selected hour but nothing asked for that frame: the per-fetch calls and
// the warm itself were declined as `wide_view`. GRID ONLY from such a view: the world series half (three 48-frame pages, 10-13 s of box CPU
// each) stays a regional-zoom activity. A view past the ceiling is a world view with its own fetch path. Kill: __RAW_DISABLE_WORLD_WARM_BAND__.
export function prewarmGlobalMarineGrid(model, hourOffset, bounds, activeLayer, opts) {
  const playback = !!opts?.playback && exactGfsPlaybackEnabled(model, activeLayer);
  const gridFirst = !!(opts && opts.gridFirst) && !(typeof window !== 'undefined' && window.__RAW_DISABLE_WORLD_GRID_FIRST__ === true);
  let _seriesStarted = false;
  let _deferSeries = false;
  let _gatesPassed = false;
  let _bandView = playback; // Playback warms one grid; never fans out into series pages.
  // THE SERIES HALF (audit v6) -- rationale relocated 2026-08-11 to keep marineController under the 800
  // LOC ratchet (it was 853). NOTHING WAS DELETED: the full reasoning, verbatim, is in
  // docs/research/FINDING-2026-08-11-marineController-rationale.md#series-half
  const startSeriesHalf = (m) => {
    if (_seriesStarted || _bandView) return;
    _seriesStarted = true;
    if (typeof window === 'undefined' || window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__ !== true) {
      try {
        // No abort signal, matching the grid warm: a background best-effort warm must survive the
        // pan/zoom that would otherwise cancel it. ensureMarineSeries is idempotent, TTL'd, deduped
        // and capped at 2 concurrent, so a repeated moveend is cheap.
        ensureMarineSeries(m, activeLayer, _GLOBAL_BOUNDS, hourOffset, undefined, true, false, true /* background (A15-11) */);
      } catch (e) { /* best-effort: a warm must never break the gesture that triggered it */ }
    }
  };
  try {
    // FAIL SOFT ON AN UNREGISTERED DEP (the seam, 2026-08-11): a warm must never break the gesture
    // that triggered it, so a missing dependency RETURNS — it never throws and never half-runs.
    const deps = _prewarmDeps;
    if (!deps || typeof deps.isSiblingPrewarmEnabled !== 'function' ||
        typeof deps.getModelSafeMarine !== 'function' || typeof deps.cacheMarineResult !== 'function') { _note('declined', hourOffset, { why: 'no_deps' }); return; }
    if (!deps.isSiblingPrewarmEnabled()) { _note('declined', hourOffset, { why: 'disabled' }); return; }
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) { _note('declined', hourOffset, { why: 'scrubbing' }); return; }
    if (!bounds || bounds.east === undefined || bounds.north === undefined) { _note('declined', hourOffset, { why: 'no_bounds' }); return; }
    // Only while ZOOMED IN (regional viewport ≤ 15°) — that's when a zoom-out is the next likely
    // gesture and the global is cold. At a wide viewport we already hold or are actively fetching it.
    // (Except the world warm's band: opts.band, below, serves a view up to the bridge's ceiling, grid only.)
    const vw = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
    const vh = Math.abs(bounds.north - bounds.south);
    if (!playback && (vw > 15 || vh > 15)) {
      // The band (opts.band): a view over 15 degrees and inside the ceiling is served, grid only. (Only a view over 15 degrees gets here, so a
      // ceiling tuned below 15 can never narrow the regional gate: it just leaves the band empty.)
      const ceil = bridgeCeilDeg(typeof window !== 'undefined' ? window : undefined);
      const bandOk = !!(opts && opts.band) && !(typeof window !== 'undefined' && window.__RAW_DISABLE_WORLD_WARM_BAND__ === true);
      if (!bandOk || vw > ceil || vh > ceil) { _note('declined', hourOffset, { why: 'wide_view' }); return; }
      _bandView = true;
    }
    const m = model || 'GFS';
    _gatesPassed = true;

    if (!gridFirst) startSeriesHalf(m);

    // F-03: dedupe on the RESOLVED valid_time, not the raw hourOffset -- three 1-hour steps share
    // one 3-hourly frame. Falls back to the offset key if the time cannot be resolved, which is
    // exactly the pre-2026-09-20 behaviour.
    // readOnly: this resolution exists ONLY to build a cache key. Without the flag it would
    // trigger a manifest refresh and a diagnostic write on every prewarm -- a dedupe that issues a
    // network request to decide whether to issue a network request. (WP-3's seriesReuse test pins
    // that constraint; readOnly is how it stays satisfied.)
    let _vt = null;
    try { _vt = getSharedValidTime(hourOffset, activeLayer, m, { readOnly: true }); } catch (e) { _vt = null; }
    const key = _vt ? _vtKey(m, activeLayer, _vt) : `${m}_${hourOffset}_${activeLayer}_GLOBALGRID`;
    if (_globalGridPrewarmInFlight.has(key)) { _note('in_flight', hourOffset, { vt: _vt, band: _bandView }); return; }
    // An earlier offset that resolved to this same valid_time already fetched this exact world
    // grid. Re-cache it under THIS offset and seed the bridge -- zero network, identical pixels.
    if (_vt) {
      const shared = _recallGlobalByValidTime(key);
      const sharedGrid = shared && shared.grid;
      if (sharedGrid && Array.isArray(sharedGrid.vectors) && sharedGrid.vectors.length > 0 &&
          (!playback || isExactPlaybackFrame(shared, _vt))) {
        deps.cacheMarineResult(m, hourOffset, shared, activeLayer, true);
        if (!playback) _stageCoarseBridgeSeed(sharedGrid, m, activeLayer, 'valid_time_dedupe');
        _note('valid_time_dedupe', hourOffset, { vt: _vt, band: _bandView });
        return;
      }
    }
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
      if (cw >= 340 && (!playback || isExactPlaybackFrame(cached, _vt))) {
        if (!playback) _stageCoarseBridgeSeed(cached.grid, m, activeLayer, 'cache_warm');
        _note('cache_warm', hourOffset, { vt: _vt, band: _bandView });
        return;
      }
    }
    // The global series page may already hold this hour while the controller's single-frame
    // cache is cold. Reuse that actual frame instead of downloading another world grid.
    // The series selector permits nearest-hour/bridge fallbacks: this cache write is stricter.
    // Never stamp an older hour or a substituted valid time as the requested forecast.
    const seriesFrame = getMarineSeriesFrame(m, activeLayer, _GLOBAL_BOUNDS, hourOffset);
    const sg = seriesFrame?.grid;
    const sb = sg?.bounds;
    const sw = sb ? ((sb.east < sb.west) ? (sb.east + 360) - sb.west : sb.east - sb.west) : 0;
    const targetTime = sg && sg.hourOffset === hourOffset
      ? Date.parse(getSharedValidTime(hourOffset, activeLayer, m)) : NaN;
    if (sg && Array.isArray(sg.vectors) && sg.vectors.length > 0 && sw >= 340 &&
        sg.hourOffset === hourOffset && Date.parse(sg.valid_time) === targetTime &&
        (!sg.served_valid_time || Date.parse(sg.served_valid_time) === targetTime) &&
        !sg.frame_substituted) {
      if (sg.__decimatedStride > 1) {
        // THINNED (2026-10-01, marineExactUpgrade.js): a stride-thinned series frame (46 x 21, an 8-degree lattice) is a VIEW
        // of the world grid, not the grid. Standing it in for the world grid ("identical pixels") made the controller cache
        // hand the thin frame to every zoom-out, and the exact frame was never fetched. It still seeds the bridge (right
        // hour, placeholder quality, better than none); the exact world grid is fetched below and replaces it.
        if (!playback) _stageCoarseBridgeSeed(sg, m, activeLayer, 'series_cache_thinned');
      } else {
        deps.cacheMarineResult(m, hourOffset, seriesFrame, activeLayer, true);
        if (!playback) _stageCoarseBridgeSeed(sg, m, activeLayer, 'series_cache');
        _note('series_cache', hourOffset, { vt: _vt, band: _bandView });
        return;
      }
    }
    _globalGridPrewarmInFlight.add(key);
    _deferSeries = gridFirst;      // the series half waits for this grid (finally below)
    const _gridT = { hour: hourOffset, vt: _vt, gridFirst, band: _bandView, queuedAt: Date.now() };
    _note('fetch', hourOffset, { vt: _vt, gridFirst, band: _bandView });
    if (typeof window !== 'undefined' && window.__MARINE_GLOBAL_PREWARM__) window.__MARINE_GLOBAL_PREWARM__.grid = _gridT;
    // No abort signal: this is a background best-effort warm that must survive the pan/zoom which
    // would otherwise cancel it. The global-coarse is location-independent, so it warms once and
    // serves every subsequent zoom-out.
    // A15-11: under the series limiter's BACKGROUND lane (one slot, after anything on screen) instead of
    // beside it — this world /grid used to bypass the cap entirely at every activation.
    Promise.resolve()
      .then(() => runBackgroundWarm(() => (_gridT.startedAt = Date.now(), m === 'ICON')
        ? fetchBackendMarineGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, activeLayer, 'ICON')
        : (m === 'EURO')
          // EURO world-coarse is a manifest product like the others (decoupled era) but routes
          // through the Copernicus client — the GFS-shaped default would cache a GFS grid under
          // the EURO key (model poison). Added 2026-07-15 with the model-switch wash re-warm.
          ? fetchBackendCopernicusGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, 'controller-prewarm', activeLayer)
          : fetchBackendMarineGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, activeLayer)))
      .then((result) => {
        const g = result && result.grid;
        _gridT.doneAt = Date.now(); _gridT.ok = !!(g && Array.isArray(g.vectors) && g.vectors.length > 0);
        if (g && Array.isArray(g.vectors) && g.vectors.length > 0) {
          deps.cacheMarineResult(m, hourOffset, result, activeLayer, true /* silent: no truth-stage pollution */);
          // F-03: remember it under the RESOLVED valid_time so the sibling offsets that share this
          // 3-hourly frame reuse it instead of re-downloading the same world grid.
          if (_vt) _rememberGlobalByValidTime(key, result);
          // COARSE-BASE SEED (2026-07-04, Part 2 of the z7 zoom-out bridge): a COLD coast (fresh session
          // straight to a coast, never zoomed out) never commits a coarse grid → engine._coarseBaseData is
          // empty → the zoom-out bridge can't engage. Stage the prewarmed global (tagged for blend match) so
          // the ENGINE snapshots it into the bridge base at its next render (proper render-loop GL timing —
          // never do GL work in this detached callback). Kill: __RAW_DISABLE_COARSE_BRIDGE__.
          if (!playback) _stageCoarseBridgeSeed(g, m, activeLayer);
        }
      })
      .catch(() => { _gridT.doneAt = _gridT.doneAt || Date.now(); _gridT.ok = false; /* best-effort: a cold zoom-out just falls back to the live fetch */ })
      .finally(() => { _globalGridPrewarmInFlight.delete(key); if (gridFirst) startSeriesHalf(m); });
  } catch (e) { /* never let prewarm break the active fetch */ }
  finally { if (gridFirst && _gatesPassed && !_deferSeries) startSeriesHalf(model || 'GFS'); }   // nothing to fetch: the series half starts at once, as it always did
}
