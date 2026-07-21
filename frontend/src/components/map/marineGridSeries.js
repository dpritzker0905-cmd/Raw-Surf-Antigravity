// marineGridSeries.js
// Option 1 "sync upgrade" — marine time-series client (PAGED).
//
// Fetches a MULTI-HOUR marine grid in ONE request (/api/weather/grid_series) so the
// timeline scrubber can select an hour CLIENT-SIDE (instant) instead of one backend
// fetch per hour. The backend endpoint is additive and reuses the same per-hour grid
// builder /grid uses; the first hour fetches the multi-hour upstream (already returned
// by Open-Meteo/Copernicus), the rest re-slice it.
//
// PAGING (audit Finding 2): the full 0..336h window is 113 3-hourly frames, but the
// backend caps a series at 48 frames. So we split into 3-hourly PAGES and load the page
// containing the CURRENT hour FIRST, then adjacent pages during idle — instead of always
// starting at hour zero. Page SPAN is per cost class (§0f(3)): 48 frames for the cheap
// GFS/ICON swell re-slice, 16 frames for EURO/surf so every request fits Netlify's ~26s
// proxy window (see pageSpanHours). Cache/in-flight are keyed by
// model+layer+flavor+viewport+page so far-hour scrubbing is instant once its page is loaded.
//
// SAFETY: this whole path is OFF unless window.__MARINE_SERIES__ === true. When off,
// nothing here runs and the orchestrator behaves exactly as before. When on, a series
// frame is used ONLY as an extra cache source during scrub — it commits through the
// SAME orchestrator path as a normal cached grid (parity/transition gates still apply),
// and anything missing falls back to the existing per-hour fetch.

import { API_BASE } from '../../lib/apiClient';
import { getSurfModeFlag } from './backendWeatherServiceClient';
import { buildTruthTag, recordTruthStage } from './weatherTruthTracker';
import { marineWarmCommitCovers } from './marineWarmCoverage';

// pageKey (model_layer_viewportKey_pN) -> { ts, frames: Map<hourOffset, marineData>, hours: number[] }
const _seriesCache = new Map();
const _inFlight = new Map();
const _idleTimers = new Set(); // pending adjacent-page prefetch timers (cleared on reset)
const SERIES_TTL_MS = 5 * 60 * 1000; // mirror backend upstream cache TTL
const SERIES_MAX = 48;              // bounded; heavy-class targets hold up to 8 SMALL pages each
                                    // (16 frames vs 48), so more entries ≈ same total memory
// Coarse-preview revalidation: a COLD regional viewport gets an instant GLOBAL coarse_preview from the
// backend (SWR — it builds the precise regional grid in the background). Re-fetch the page, spaced out,
// until the backend returns the regional grid — else we'd cache the global frame and the heatmap renders
// coarse/clamped at the viewport forever (the zoom-out clamp). Bounded so a viewport that is genuinely
// global-only can't loop.
// EXPONENTIAL BACKOFF (sharpen re-drive root, 2026-07-04): the old fixed 8×1.2s window (~10s) assumed the
// backend's regional build finishes fast, but under 1-CPU ingestion contention it can run MINUTES — the
// budget exhausted, the GLOBAL preview got cached for the full 5-min TTL, and with the render backstop's
// no-progress cap also engaged NOTHING re-fetched until the user moved the map (the "world grid resident
// for minutes at a fresh site" wedge, observed live at Venice). Backoff keeps the early snappiness
// (1.2s/2.4s/4.8s…) but stretches the total budget past the SERIES_TTL, while late retries are 30s apart
// so total backend load stays negligible (the build-in-progress responses are served from the SWR cache).
const COARSE_REVAL_MAX = 15;   // 14 backoff delays ≈ 307s — covers the full SERIES_TTL window
const COARSE_REVAL_BASE_MS = 1200;
const COARSE_REVAL_MAX_INTERVAL_MS = 30000;
// Delay before revalidation attempt N+1, after N coarse results so far. Exported for tests.
export function coarseRevalDelayMs(revalCount) {
  const n = Math.max(1, Math.floor(revalCount) || 1);
  return Math.min(COARSE_REVAL_BASE_MS * Math.pow(2, n - 1), COARSE_REVAL_MAX_INTERVAL_MS);
}

// §4.3(b) SERIES-PAGE FETCH RESILIENCE (2026-07-13, round-12; tier-thrash decode fix candidate b):
// failed pages (deploy-window 500s, network blips, the 45s local timeout) were SILENT — the page
// stayed absent until the next user gesture while the clamp backstop looped on misses (the
// "series misses climbing" aggravator, user dev logs round-11). Bounded retry on the SAME
// exponential backoff as coarse revalidation (1.2s/2.4s/4.8s/9.6s). Never retries: caller-signal
// aborts (superseded viewport), or pages whose cache entry already HAS frames (stale frames still
// serve; the TTL refresh will try again naturally). Kill: window.__RAW_SERIES_RETRY_DISABLED__.
// Telemetry: __MARINE_SERIES_DIAG__.pageRetries / pageFailsExhausted / lastRetryReason.
const SERIES_FAIL_RETRY_MAX = 4;
const _failRetries = new Map(); // pageKey -> consecutive failed attempts

function scheduleFailRetry(model, layer, bounds, page, signal, key, reason) {
  if (typeof window !== 'undefined' && window.__RAW_SERIES_RETRY_DISABLED__ === true) return;
  const n = (_failRetries.get(key) || 0) + 1;
  _failRetries.set(key, n);
  if (_failRetries.size > 64) _failRetries.delete(_failRetries.keys().next().value);
  if (typeof window !== 'undefined') {
    window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 };
    const d = window.__MARINE_SERIES_DIAG__;
    if (n > SERIES_FAIL_RETRY_MAX) {
      d.pageFailsExhausted = (d.pageFailsExhausted || 0) + 1;
    } else {
      d.pageRetries = (d.pageRetries || 0) + 1;
      d.lastRetryReason = reason;
    }
  }
  if (n > SERIES_FAIL_RETRY_MAX) return;
  const t = setTimeout(() => { loadSeriesPage(model, layer, bounds, page, signal, true); }, coarseRevalDelayMs(n));
  _idleTimers.add(t);
}

// Concurrency gate for grid_series fetches. The backend is 1-CPU: firing N series requests at
// once (rapid model/layer toggling warms GFS+ICON+EURO × every layer × 3 pages) slams the box
// into 503s/timeouts so NOTHING completes — the "bottleneck after scrubbing." Cap concurrent
// fetches so the box serves them ~2 at a time and each finishes fast (no contention). Requests
// queue client-side; a request whose signal aborts while queued is dropped (never hits the box),
// so superseded model/layer warms don't pile up. Tune up once the backend has more CPU.
const MARINE_SERIES_MAX_CONCURRENT = 2;
let _seriesActiveLoads = 0;
const _seriesWaiters = []; // [{ resolve, signal }]

function acquireSeriesSlot(signal) {
  if (_seriesActiveLoads < MARINE_SERIES_MAX_CONCURRENT) { _seriesActiveLoads++; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const entry = { resolve, signal };
    _seriesWaiters.push(entry);
    if (signal) {
      try {
        signal.addEventListener('abort', () => {
          const i = _seriesWaiters.indexOf(entry);
          if (i >= 0) { _seriesWaiters.splice(i, 1); resolve(false); } // dropped while queued; no slot taken
        }, { once: true });
      } catch (e) { /* ignore */ }
    }
  });
}

function releaseSeriesSlot() {
  if (_seriesActiveLoads > 0) _seriesActiveLoads--;
  while (_seriesWaiters.length && _seriesActiveLoads < MARINE_SERIES_MAX_CONCURRENT) {
    const w = _seriesWaiters.shift();
    if (w.signal && w.signal.aborted) { w.resolve(false); continue; } // drop aborted-while-queued
    _seriesActiveLoads++;
    w.resolve(true);
  }
}

// 3-hourly pages of at most 48 frames (the backend series cap). The span is per COST CLASS,
// sized so ONE page always fits Netlify's ~26s /api/* proxy window — a page that runs past it
// is a TOTAL loss (the proxy cuts the response; the client logs "Fetch failed" and caches
// nothing). Measured 2026-07-14 (§0f(3), direct-to-Render, FL regional viewport, cold):
//   GFS/ICON swell 48-frame page = 1.8s (cheap re-slice of the cached coarse product);
//   surf=1 adds ~0.26s/frame (per-frame rating transform) → GFS surf 48-frame = 14.4s;
//   EURO adds ~0.2s/frame (per-hour L2 resolve)          → EURO surf 48-frame = 23.1s cold —
//   inside the window only when the box is idle; any contention kills it (the user's failures).
// HEAVY class (EURO any-flavor, or surf mode any-model) pages are 16 frames ≈ 8.5s worst-case
// cold (~3× window headroom). The cheap swell class keeps 48-frame pages (3-request full warm).
const PAGE_SPAN_HOURS = 144;        // 48 frames × 3h — GFS/ICON swell (cheap cached re-slice)
const HEAVY_PAGE_SPAN_HOURS = 48;   // 16 frames × 3h — EURO or surf mode (per-frame server cost)
const MARINE_SERIES_MAX_HOURS = 336; // EURO 14-day window ceiling (240 native + 96 estimated)

function pageSpanHours(model) {
  if ((model || 'GFS').toUpperCase() === 'EURO') return HEAVY_PAGE_SPAN_HOURS;
  return getSurfModeFlag() ? HEAVY_PAGE_SPAN_HOURS : PAGE_SPAN_HOURS;
}
// Heavy regime: floor(336/48) = 7 (page 7 = the single +336h frame — the wheel's max is a real
// ask, so it gets its own tiny page rather than being silently unreachable). Cheap regime: 2.
function lastPageFor(model) {
  return Math.floor(MARINE_SERIES_MAX_HOURS / pageSpanHours(model));
}

export function isMarineSeriesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__MARINE_SERIES__ === false) return false;
  try {
    if (window.localStorage && window.localStorage.getItem('marine_series') === 'false') {
      return false;
    }
  } catch (e) { /* localStorage blocked */ }
  return true;
}

// The 3-hourly page that contains a given hour offset, in the model's span regime.
// Cheap regime — page 0: 0..141, 1: 144..285, 2: 288..336. Heavy — 48h pages, 0..7.
export function marineSeriesPageForHour(hourOffset, model) {
  const h = Math.max(0, Number(hourOffset) || 0);
  return Math.min(lastPageFor(model), Math.floor(h / pageSpanHours(model)));
}

// The hour offsets a page requests (<=48 frames, 3-hourly, clamped to the 336h ceiling).
function buildPageHours(page, model) {
  const span = pageSpanHours(model);
  const start = page * span;
  const end = Math.min(start + span - 3, MARINE_SERIES_MAX_HOURS);
  const hours = [];
  for (let h = start; h <= end; h += 3) hours.push(h);
  return hours;
}

// Coarse viewport key so small pans reuse the same series.
// Two correctness fixes for GLOBAL-zoom scrub (forensics 2026-06-26: at z2 with a wrapped viewport
// like west=-204, scrubbing was a per-hour fetch storm because the series never HIT):
//  (1) Normalize longitude to [-180,180] — a viewport panned past the antimeridian (west < -180)
//      otherwise yields keys that never match the warmed series.
//  (2) Collapse any WIDE viewport (span > 15° either axis — the backend's is_wide threshold, where it
//      serves ONE global-coarse product for everything) to a single stable 'global' key. Without this,
//      the 0.5° snap on a ~200°-span viewport churns the key on every micro-pan, so the warmed global
//      series is never reused → scrub re-fetches each hour. With it, the global-coarse series warms
//      once on settle and every global scrub hour HITS it (instant, zero-backend).
function viewportKey(bounds) {
  if (!bounds) return 'global';
  const normLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180; // wrap into [-180,180)
  const w = normLng(bounds.west);
  const e = normLng(bounds.east);
  const spanLng = (e < w) ? (e + 360) - w : e - w;
  const spanLat = Math.abs(bounds.north - bounds.south);
  if (spanLng > 15.0 || spanLat > 15.0) return 'global';
  const r = (v) => (Math.round(v * 2) / 2).toFixed(1); // 0.5° snap
  return `${r(w)}_${r(bounds.south)}_${r(e)}_${r(bounds.north)}`;
}

function pageKey(model, layer, bounds, page) {
  return `${model || 'GFS'}_${layer || 'waves'}_${getSurfModeFlag() ? 'surf' : 'swell'}_${viewportKey(bounds)}_p${page}`;
}

// Pad a REGIONAL request bbox outward by ~0.5° so the backend's degree-snapped tile reliably CONTAINS the
// viewport — and any sub-cell pan that maps to the SAME 0.5° viewportKey. Without this, a viewport whose edge
// sits just outside the served tile (live 2026-06-28: viewport south 27.96 vs served tile south 28.0) fails
// getMarineSeriesFrame's strict bboxContains → found:false → the heatmap stays CLAMPED until the 5-min TTL
// expires, because the TTL dedup refuses to re-fetch a tile that would contain it. Proven by curl: the padded
// request returns a tile that contains the unpadded viewport. Only pads comfortably-regional spans so padding
// can never push a near-15° viewport over the backend's wide/global-coarse threshold. Latitude clamped.
export const SERIES_BBOX_PAD_DEG = 0.5;
export function padRegionalBbox(b) {
  if (!b) return b;
  const spanLng = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  const spanLat = Math.abs(b.north - b.south);
  if (spanLng >= 12 || spanLat >= 12) return b;   // wide/near-wide: leave alone (avoid the 15° threshold)
  const p = SERIES_BBOX_PAD_DEG;
  return {
    west: b.west - p,
    east: b.east + p,
    south: Math.max(-89.5, b.south - p),
    north: Math.min(89.5, b.north + p),
  };
}

// Defer adjacent-page prefetch to idle so it never competes with the current page or a
// scrub. requestIdleCallback when available; otherwise a macrotask (NOT a microtask, so it
// can't fire inside a caller's await — keeps the synchronous "one fetch" test invariant).
function scheduleIdlePrefetch(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => { _idleTimers.delete(id); fn(); }, { timeout: 2500 });
    _idleTimers.add(id);
    return;
  }
  const id = setTimeout(() => { _idleTimers.delete(id); fn(); }, 1500);
  _idleTimers.add(id);
}

// Convert one backend series frame into a marineData object shaped exactly like a normal
// cached grid commit, so the orchestrator's existing commit/parity logic accepts it.
function frameToMarineData(frame, model, layer) {
  const provider = frame.provider || (model === 'EURO' ? 'copernicus' : 'open-meteo');
  const renderable = Array.isArray(frame.vectors) && frame.vectors.length > 0;
  // True data origin for the HUD provenance. `provider` is the deliberate 'open-meteo' contract key (kept
  // byte-identical across the NOAA-direct + open-meteo paths), so without __sourceDataset the HUD mislabels
  // NOAA-direct GFS as "open-meteo". Prefer the backend's per-frame source_dataset; else derive from the model
  // (on the decoupled ingest runner open-meteo is unreachable, so GFS marine is always NOAA-direct ncep_gfswave025,
  // ICON=GWAM/DWD, EURO=Copernicus). The HUD's __basicSourceName maps these → NOAA / DWD / Copernicus.
  const __sourceDataset = frame.source_dataset || (
    model === 'GFS' ? 'ncep_gfswave025' :
    model === 'ICON' ? 'gwam_dwd' :
    model === 'EURO' ? 'copernicus_cmems' : null
  );
  const grid = {
    vectors: frame.vectors,
    cols: frame.cols,
    rows: frame.rows,
    bounds: frame.bounds,
    __renderable: renderable,
    // MISSING STAMP = the EURO series stall (2026-07-06): every REAL fetch path stamps
    // __gridSupportsLayer (mapper/copernicusGridFetcher/backend clients), and useMarineWindData's
    // hasCopernicusGrid REQUIRES it === true for provider 'copernicus'/'backend-weather-service' —
    // so a series-committed EURO frame (the clamp sharpen's ONLY route at close zoom, and the
    // scrub safety-net's fast path) conformed to hasCopernicusGrid:false and the gate NULLED it.
    // The raw marineData still fed useSimulationField, hence the log signature "series frames
    // bind to the SIM FIELD but the ENGINE keeps coarse_global". The series endpoint returns
    // frames FOR the requested layer, so vectors-present ⇒ the grid supports it: truthful stamp.
    __gridSupportsLayer: renderable,
    __componentLayer: layer,
    __sourceModel: model,
    __sourceDataset,
    __gridProvider: provider,
    provider,
    hourOffset: frame.hour_offset,
    is_estimated: !!frame.is_estimated,
    is_dynamic_viewport_product: true,
    __fromSeries: true,
    // Carry the surf-RATING signal so the shader paints the rating band on series-committed frames (clamp/scrub
    // commit series frames; without this the rating band never rendered even with surf=1). See _frame_rating_mode.
    ratingMode: !!frame.rating_mode,
    // §0c SERVING HONESTY: the frame actually served per the backend (valid_time echoes the
    // ask). Surfaced in FORENSIC-SNAP as frameOff — a pasted log self-reports frame skew.
    valid_time: frame.valid_time || null,
    served_valid_time: frame.served_valid_time || null,
    frame_offset_hours: frame.frame_offset_hours ?? 0,
    frame_substituted: !!frame.frame_substituted,
  };
  const product_id = `series_${model}_${layer}_h${frame.hour_offset}`;
  // Audit #18/A3: mint the lineage tag ONCE here — recordTruthStage PRESERVES an existing tag, so
  // commit and webglUpload share product_id + traceId. Without this the engine reconstructs a tag
  // from the bare waveGrid (no product_id there) → "Product: undefined" + a divergent traceId, and
  // the same-product previousStages filter never matches series frames. Stamped on the GRID because
  // that's the object the engine sees (waveGrid.truthTag), and mirrored on the wrapper for the
  // orchestratorCommit's marineData.truthTag read.
  const truthTag = renderable ? buildTruthTag({
    grid, model, domain: 'marine', layer,
    valid_time: frame.valid_time, run_time: frame.run_time,
    product_id, provider,
    is_dynamic_viewport_product: true,
    coverage_scope: frame.coverage_scope,
  }, 'seriesFrameMint') : null;
  if (truthTag) {
    if (Number.isFinite(frame.hour_offset)) truthTag.timeOffsetHours = frame.hour_offset;
    grid.truthTag = truthTag;
    // Task #14 (2026-07-18): REGISTER the chain at its mint. Series frames legitimately commit
    // through direct lanes (scrub-settle, clamp backstop, hour-0 revalidate) that never record an
    // orchestratorCommit — their webglUpload then compared against the PREVIOUS chain's commit on
    // the same stable product_id (series_*_h0) and console.error'd a false MISMATCH on every
    // mini/series commit (TruthOverlay render storm rode the same spam). 'seriesFrameMint' is a
    // START stage (exempt from backward comparison, arms the absence watchdog) so the upload
    // compares within ITS OWN chain; real within-chain divergence still trips. Scope mirrors the
    // tracker's GFS-waves@h0 gate. Kill: __RAW_DISABLE_SERIES_MINT_STAGE__.
    if (model === 'GFS' && layer === 'waves' && frame.hour_offset === 0 &&
        typeof window !== 'undefined' && !window.__RAW_DISABLE_SERIES_MINT_STAGE__) {
      recordTruthStage('seriesFrameMint', {
        model, domain: 'marine', layer,
        valid_time: frame.valid_time, run_time: frame.run_time,
        product_id, grid, truthTag,
      }, 'marineGridSeries.js', 'mapSeriesFrame');
    }
  }
  return {
    type: 'FeatureCollection',
    features: [],
    grid,
    __sourceModel: model,
    __provider: provider,
    __renderable: renderable,
    __fromSeries: true,
    hourOffset: frame.hour_offset,
    ...(truthTag ? { truthTag } : {}),
    product_id,
    region_id: 'series',
    is_dynamic_viewport_product: true,
  };
}

// Load ONE page of the series. Idempotent + TTL'd + deduped (keyed by page). Never throws.
async function loadSeriesPage(model, layer, bounds, page, signal, force = false) {
  if (!isMarineSeriesEnabled() || !bounds || page < 0 || page > lastPageFor(model)) return;
  const key = pageKey(model, layer, bounds, page);
  // Padded request box (also used for the coverage-aware dedup below). Computed once here.
  const reqBox = padRegionalBbox(bounds);
  const existing = _seriesCache.get(key);
  if (existing && !force) {
    // A coarse-preview entry is allowed to RE-FETCH (capped + spaced) so the SWR-revalidated regional
    // grid replaces the cold global frame; otherwise honour the normal TTL dedup. `force` bypasses the
    // TTL dedup entirely — used by the clamp backstop (#8) when the engine is HELD on a stale non-covering
    // tile and the cache has no covering frame for the panned viewport: the TTL dedup would otherwise
    // refuse to re-fetch the covering tile the backend readily serves. Still de-duped against `_inFlight`.
    const coarseRetryDue = existing.coarsePreview &&
      (existing.revalCount || 0) < COARSE_REVAL_MAX &&
      Date.now() - existing.ts >= coarseRevalDelayMs(existing.revalCount || 1);
    // §7j COVERAGE-AWARE TTL DEDUP (2026-07-13, the 15–60° pan wedge): spans >15° all share the
    // 'global' viewportKey, but the SERVED entry stores a mid-CLIP (~1.5× the FIRST viewport),
    // not the world — so a pan in that band hit this TTL return for 5 minutes while the cached
    // clip no longer covered the screen (user live wedge: series misses climbing 36→52 while the
    // clamp backstop slow-probed a fetch this dedup kept refusing). An entry only earns the TTL
    // skip if it still COVERS the padded request; truly world-wide entries (≥340°) contain every
    // viewport by construction and keep the skip. Same disease class as the SERIES_BBOX_PAD_DEG
    // note above — this is the general fix at the dedup itself. Warming placeholders (bounds
    // null) keep their own retry schedule.
    const _ebW = existing.bounds
      ? ((existing.bounds.east < existing.bounds.west)
          ? (existing.bounds.east + 360) - existing.bounds.west
          : existing.bounds.east - existing.bounds.west)
      : 0;
    // Compare against the RAW viewport (not the padded reqBox): servers legitimately clamp the
    // served tile to product edges, so an entry can be smaller than the pad yet still cover the
    // screen — only a viewport that actually LEFT the cached tile earns the refetch.
    const coverageBroken = !!existing.bounds && _ebW < 340 && !bboxContains(existing.bounds, bounds);
    if (coverageBroken && typeof window !== 'undefined') {
      window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 };
      window.__MARINE_SERIES_DIAG__.ttlCoverageBypass = (window.__MARINE_SERIES_DIAG__.ttlCoverageBypass || 0) + 1;
    }
    if (!coarseRetryDue && !coverageBroken && Date.now() - existing.ts < SERIES_TTL_MS) return;
  }
  if (_inFlight.has(key)) return;

  const hours = buildPageHours(page, model);
  if (hours.length === 0) return;
  // FLAVOR SNAPSHOT (2026-07-15, "the rating band isn't turning off"): capture the surf flag ONCE
  // at request time — it flavors the URL below AND stamps the cache entry so getMarineSeriesFrame's
  // containment fallback can refuse to serve a SURF page in swell mode (the toggle-off wedge: surf
  // frames carry SCOREs + ratingMode:true, and the engine's reverse gate then keeps painting the
  // band while this serve preempts the honest commit that would release it).
  const surfFlavor = getSurfModeFlag();
  // Request the padded box (computed above) so the served tile contains the viewport (+small pans) —
  // fixes the degree-boundary clamp. Cache key + coarse-preview detection still use the UNPADDED bounds.
  const url = `${API_BASE}/weather/grid_series?model=${encodeURIComponent(model || 'GFS')}`
    + `&domain=marine&layer=${encodeURIComponent(layer || 'waves')}`
    + `&bbox=${reqBox.west.toFixed(4)},${reqBox.south.toFixed(4)},${reqBox.east.toFixed(4)},${reqBox.north.toFixed(4)}`
    + `&hours=${hours.join(',')}`
    + (surfFlavor ? '&surf=1' : '');

  // Local timeout so a slow model (EURO/Copernicus) can't leave the series fetch hanging.
  // Armed AFTER the concurrency slot is acquired (below): it bounds the FETCH, not the queue
  // wait. With the smaller heavy-class pages there are up to 8 pages queuing behind 2 slots —
  // arming here made tail-of-queue pages burn the budget while WAITING and retry as spurious
  // `timeout_45s` (observed live 07-14, 13 retries in one warm). Queued pages still cancel
  // instantly via the caller-signal listener when the viewport supersedes.
  const localController = new AbortController();
  let timeoutId = null;
  if (signal) { try { signal.addEventListener('abort', () => localController.abort()); } catch (e) { /* ignore */ } }

  const p = (async () => {
    // Wait for a concurrency slot before hitting the 1-CPU backend. If the signal aborts while
    // we're queued, acquireSeriesSlot resolves false and we never fetch (superseded warm dropped).
    const gotSlot = await acquireSeriesSlot(localController.signal);
    if (!gotSlot || localController.signal.aborted) {
      _inFlight.delete(key);
      return;
    }
    timeoutId = setTimeout(() => { try { localController.abort(); } catch (e) { /* ignore */ } }, 45000);
    try {
      const res = await fetch(url, { signal: localController.signal });
      if (!res.ok) {
        // §4.3(b): a failed page (deploy-window 500, cold-start 502) retries bounded instead of
        // silently vanishing until the next gesture. Entries that already hold frames skip it.
        if (!localController.signal.aborted && !(existing && existing.frames && existing.frames.size)) {
          scheduleFailRetry(model, layer, bounds, page, signal, key, `http_${res.status}`);
        }
        return;
      }
      const json = await res.json();
      if (!json || !Array.isArray(json.frames) || json.frames.length === 0) {
        // COLD-START retry (2026-07-06, chip task_e618f9ff): an empty series marked `warming`
        // means the backend is mid L2-restore (every deploy opens this window) — retry with the
        // existing backoff instead of abandoning the viewport to the per-hour fallback until the
        // next gesture. Bounded by COARSE_REVAL_MAX; never stomps an entry that has frames.
        if (json && json.warming === true && !localController.signal.aborted) {
          const prevWarm = (existing && existing.warmingRetries) || 0;
          if (prevWarm < COARSE_REVAL_MAX) {
            if (!existing || !(existing.frames && existing.frames.size)) {
              _seriesCache.set(key, {
                ts: Date.now(), frames: new Map(), hours: [], bounds: null,
                model, layer, page, warming: true, warmingRetries: prevWarm + 1,
              });
            }
            const t = setTimeout(() => { loadSeriesPage(model, layer, bounds, page, signal, true); }, coarseRevalDelayMs(prevWarm + 1));
            _idleTimers.add(t);
          }
        }
        return;
      }
      const frames = new Map();
      const hoursList = [];
      for (const f of json.frames) {
        if (typeof f.hour_offset !== 'number' || !f.vectors || f.vectors.length === 0) continue;
        frames.set(f.hour_offset, frameToMarineData(f, model, layer));
        hoursList.push(f.hour_offset);
      }
      if (frames.size === 0) return;
      hoursList.sort((a, b) => a - b);
      // Coarse-preview detection: the backend served a GLOBAL frame for a REGIONAL request (a cold SWR
      // preview while it builds the precise regional grid). Flag it so the dedup above re-fetches until
      // the regional grid lands, instead of caching the coarse/clamped frame.
      const reqW = (bounds.east < bounds.west) ? (bounds.east + 360 - bounds.west) : (bounds.east - bounds.west);
      const reqH = Math.abs(bounds.north - bounds.south);
      const sf = frames.values().next().value;
      const sfb = sf && sf.grid && sf.grid.bounds;
      const frameW = sfb ? ((sfb.east < sfb.west) ? (sfb.east + 360 - sfb.west) : (sfb.east - sfb.west)) : 0;
      const isCoarsePreview = reqW < 15.0 && reqH < 15.0 && frameW >= 340.0;
      const revalCount = isCoarsePreview ? (((existing && existing.revalCount) || 0) + 1) : 0;
      // Store the SERVED frame bounds (sfb), not the requested bbox, so getMarineSeriesFrame's
      // containment matching reflects what the grid ACTUALLY covers. This matters for the 'global'
      // key: the requested bbox is a wrapped wide viewport (e.g. west=-204) but the served global
      // grid is ±180, which contains every viewport — so global scrub HITS regardless of pan. Also
      // strictly improves regional hits (the served tile is ≥ the requested viewport).
      _seriesCache.set(key, { ts: Date.now(), frames, hours: hoursList, bounds: sfb || bounds, model, layer, page, surf: surfFlavor, coarsePreview: isCoarsePreview, revalCount });
      _failRetries.delete(key); // §4.3(b): a successful page resets its failure budget
      // Bound memory.
      if (_seriesCache.size > SERIES_MAX) {
        const oldest = _seriesCache.keys().next().value;
        if (oldest !== undefined && oldest !== key) _seriesCache.delete(oldest);
      }
      // Self-schedule a revalidation re-fetch while still coarse (the backend is building the regional
      // grid in the background). Bounded by COARSE_REVAL_MAX. Aborts with the active signal.
      if (isCoarsePreview && revalCount < COARSE_REVAL_MAX && !localController.signal.aborted) {
        const t = setTimeout(() => { loadSeriesPage(model, layer, bounds, page, signal); }, coarseRevalDelayMs(revalCount));
        _idleTimers.add(t);
      } else if (!isCoarsePreview && typeof window !== 'undefined') {
        // A REGIONAL frame just landed. Notify so a held coarse-global / clamped grid is sharpened
        // IMMEDIATELY (event-driven) instead of waiting on the ~3s render backstop's polling timer.
        // This is the INITIAL-LOAD clamp: the first /grid MISS serves a coarse-global SWR preview, and
        // without this the sharpen waited 3s. After the series is warm, toggles already commit regional
        // instantly (no clamp). checkScrubSettle is a cheap no-op when nothing is actually clamped.
        try { window.dispatchEvent(new Event('marine_series_revalidated')); } catch (e) { /* ignore */ }
      }
      if (typeof window !== 'undefined') {
        window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 };
        window.__MARINE_SERIES_DIAG__.loads++;
        window.__MARINE_SERIES_DIAG__.lastKey = key;
        window.__MARINE_SERIES_DIAG__.lastPage = page;
        window.__MARINE_SERIES_DIAG__.lastFrames = hoursList.length;
      }
    } catch (e) {
      // §4.3(b): superseded-viewport aborts (caller signal) stay silent — retrying them is pure
      // waste. Everything else (the 45s local timeout, network errors) retries bounded; before
      // this the page silently vanished and the clamp backstop looped on misses.
      const callerAborted = !!(signal && signal.aborted);
      if (!callerAborted && !(existing && existing.frames && existing.frames.size)) {
        const reason = (e && e.name === 'AbortError') ? 'timeout_45s' : `net_${(e && e.name) || 'error'}`;
        scheduleFailRetry(model, layer, bounds, page, signal, key, reason);
      }
    } finally {
      releaseSeriesSlot(); // hand the slot to the next queued load
      clearTimeout(timeoutId);
      _inFlight.delete(key);
    }
  })();
  _inFlight.set(key, p);
  // Awaiting here makes the load observable to callers that DO await (and tests); the
  // orchestrator calls this fire-and-forget (no await), so it stays a background load.
  await p;
}

// === HOUR-0-FIRST PAINT LANE (2026-07-18, the time-to-fine arc's measured fix) ===
// PROOF CHAIN (HANDOFF-2026-07-18-hour0-first-paint-lane-design.md): at activation the 48-hour
// series page takes 2.5-3.3 s first-byte in the request storm while a 1-hour request answers in
// 0.26-0.30 s CONCURRENTLY (storm-immune, curl-proven) — yet the first fine paint waited on the
// full page (fine commit ~4.2 s; the coarse world paint at ~2 s = the "two heatmaps" report).
// This lane fires a MINI series load (the current hour ONLY) when the page is cold, stored under
// a distinct '_h0' key that getMarineSeriesFrame's containment fallback serves immediately; the
// full page later lands under the exact page key and naturally supersedes it (exact-key loop wins;
// the mini entry ages out via SERIES_TTL_MS). BYPASSES the 2-slot series queue deliberately — the
// whole point is not queueing behind the 48-hour pages, and the storm experiment proved the
// backend absorbs the tiny request concurrently. Completion re-drive = the SAME
// 'marine_series_revalidated' event the full page fires (event-driven sharpen, not the 3 s poll).
// Kill: __RAW_DISABLE_HOUR0_FIRST__. Telemetry: __MARINE_SERIES_DIAG__.h0Loads/h0Served.
async function loadSeriesHour0(model, layer, bounds, hourOffset, signal) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_HOUR0_FIRST__ === true) return;
  if (!isMarineSeriesEnabled() || !bounds) return;
  const page = marineSeriesPageForHour(hourOffset, model);
  const h0key = `${pageKey(model, layer, bounds, page)}_h0`;
  const existing = _seriesCache.get(h0key);
  if ((existing && Date.now() - existing.ts < SERIES_TTL_MS) || _inFlight.has(h0key)) return;
  const h = Math.max(0, Math.round(hourOffset / 3) * 3);   // snap to the 3-hourly frame grid
  const reqBox = padRegionalBbox(bounds);
  const surfFlavor = getSurfModeFlag();
  const url = `${API_BASE}/weather/grid_series?model=${encodeURIComponent(model || 'GFS')}`
    + `&domain=marine&layer=${encodeURIComponent(layer || 'waves')}`
    + `&bbox=${reqBox.west.toFixed(4)},${reqBox.south.toFixed(4)},${reqBox.east.toFixed(4)},${reqBox.north.toFixed(4)}`
    + `&hours=${h}`
    + (surfFlavor ? '&surf=1' : '');
  const localController = new AbortController();
  if (signal) { try { signal.addEventListener('abort', () => localController.abort()); } catch (e) { /* ignore */ } }
  const timeoutId = setTimeout(() => { try { localController.abort(); } catch (e) { /* ignore */ } }, 15000);
  const p = (async () => {
    try {
      const res = await fetch(url, { signal: localController.signal });
      if (!res.ok) return;                                   // silent: the full page is coming anyway
      const json = await res.json();
      if (!json || !Array.isArray(json.frames) || json.frames.length === 0) return;
      const f = json.frames.find((x) => typeof x.hour_offset === 'number' && x.vectors && x.vectors.length > 0);
      if (!f) return;
      const md = frameToMarineData(f, model, layer);
      const sfb = md && md.grid && md.grid.bounds;
      // A GLOBAL coarse SWR preview is useless as a regional first paint (the clamp class) — skip;
      // the full-page lane's coarse-reval machinery owns that path.
      const reqW = Math.abs(bounds.east - bounds.west);
      const frameW = sfb ? ((sfb.east < sfb.west) ? (sfb.east + 360 - sfb.west) : (sfb.east - sfb.west)) : 0;
      if (reqW < 15.0 && frameW >= 340.0) return;
      const frames = new Map([[f.hour_offset, md]]);
      _seriesCache.set(h0key, {
        ts: Date.now(), frames, hours: [f.hour_offset], bounds: sfb || bounds,
        model, layer, page, surf: surfFlavor, coarsePreview: false, revalCount: 0, h0: true,
      });
      if (typeof window !== 'undefined') {
        const dg = (window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 });
        dg.h0Loads = (dg.h0Loads || 0) + 1;
        try { window.dispatchEvent(new Event('marine_series_revalidated')); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* silent — full page is the safety net */ } finally {
      clearTimeout(timeoutId);
      _inFlight.delete(h0key);
    }
  })();
  _inFlight.set(h0key, p);
  await p;
}

/**
 * Background-load the marine time-series PAGE containing `hourOffset` (current hour) first,
 * then prefetch adjacent page(s) during idle. Idempotent + TTL'd + deduped. No-op when the
 * flag is off. Never throws. hourOffset defaults to 0 (near page) for legacy callers.
 */
export async function ensureMarineSeries(model, layer, bounds, hourOffset = 0, signal, currentPageOnly = false, force = false) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  const page = marineSeriesPageForHour(hourOffset, model);
  // HOUR-0-FIRST: when the current page is COLD, race a 1-hour mini load ahead of it
  // (fire-and-forget — it must not delay the page load it exists to beat). Fires on EVERY cold
  // ensureMarineSeries call including the sibling prewarm's currentPageOnly path — the REAL
  // activation goes through marineController's currentPageOnly=true call (probe run 1 proof:
  // gating on that flag skipped the mini exactly where it was built to fire), and a 1-hour
  // 36 KB mini is storm-immune (curl-proven), not the 48-frame adjacent-page fanout the sibling
  // contract guards against. Sibling toggles gain an instant first frame as a side benefit.
  // (Probe run 2 lesson: do NOT suppress on _inFlight.has(pageKey) — a page already in flight for
  // 2.5-3.3 s cold is EXACTLY the window the mini exists to beat. The mini's own h0-key dedup
  // prevents duplicate minis; the page-warm check below prevents pointless ones.)
  const _pk = pageKey(model, layer, bounds, page);
  const _pc = _seriesCache.get(_pk);
  if (!(_pc && _pc.frames && _pc.frames.size && Date.now() - _pc.ts < SERIES_TTL_MS)) {
    loadSeriesHour0(model, layer, bounds, hourOffset, signal);
  }
  await loadSeriesPage(model, layer, bounds, page, signal, force);
  // currentPageOnly: load just the page containing hourOffset, no adjacent prefetch. Used by the
  // sibling-layer toggle prewarm — a toggle only needs the CURRENT hour, so fanning out to adjacent
  // pages (future-hour frames, for scrubbing) would be wasted 1-CPU backend load on the siblings.
  if (currentPageOnly) return;
  // Prefetch neighbours during idle so scrubbing into an adjacent page is already warm.
  for (const adj of [page + 1, page - 1]) {
    if (adj < 0 || adj > lastPageFor(model)) continue;
    const k = pageKey(model, layer, bounds, adj);
    const cached = _seriesCache.get(k);
    if ((cached && Date.now() - cached.ts < SERIES_TTL_MS) || _inFlight.has(k)) continue;
    scheduleIdlePrefetch(() => { loadSeriesPage(model, layer, bounds, adj, signal); });
  }
}

/**
 * Eagerly load EVERY page for the active model/layer/viewport (no idle deferral). Called on
 * scrub START so any hour the user jumps to during a fast drag already has a cached frame —
 * idle prefetch (requestIdleCallback) never runs during active scrubbing, which is why far
 * hours otherwise held the previous frame until settle. Fire-and-forget; deduped + TTL'd.
 */
export function prewarmMarineSeries(model, layer, bounds, signal) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  // EURO marine grid_series is backed by per-hour Copernicus fetches (~10s/hr, frequently time
  // out, and OOM the 512MB backend). Eager-loading all its pages is what overloaded Render under
  // scrub+toggle. Skip the eager prewarm for EURO — its lazy current-page load handles it. GFS &
  // ICON just re-slice a cheap cached coarse product, so prewarming all pages is safe + fast.
  if ((model || 'GFS').toUpperCase() === 'EURO') return;
  for (let page = 0, last = lastPageFor(model); page <= last; page++) {
    loadSeriesPage(model, layer, bounds, page, signal);
  }
}

// True if `outer` bbox fully contains `inner`. No antimeridian handling — series bboxes don't
// cross it in practice; a wrap case just fails containment and falls through to exact/miss.
function bboxContains(outer, inner) {
  if (!outer || !inner) return false;
  return outer.south <= inner.south && outer.north >= inner.north &&
         outer.west <= inner.west && outer.east >= inner.east;
}

// Nearest frame (within ±1.5h, 3-hourly) for an hour within one cache entry, or null.
function nearestFrameInEntry(entry, hourOffset) {
  let best = null, bestDiff = Infinity;
  for (const h of entry.hours) {
    const d = Math.abs(h - hourOffset);
    if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
  }
  return (best !== null && bestDiff <= 1.5) ? { frame: best, diff: bestDiff } : null;
}

/**
 * Return a ready-to-commit marineData for the requested hour from the cached series, or
 * null if no series / no nearby frame. Searches the page containing the hour plus its
 * neighbours (to cover frames near a page boundary) and snaps to the nearest frame within
 * ±1.5h (frames are 3-hourly), so scrubbing tracks the nearest available hour synchronously.
 */
export function getMarineSeriesFrame(model, layer, bounds, hourOffset) {
  if (!isMarineSeriesEnabled() || !bounds) return null;
  const page = marineSeriesPageForHour(hourOffset, model);
  const now = Date.now();
  // Width of the requested viewport (deg, antimeridian-safe). A GLOBAL-width cached frame must NEVER be
  // served to a regional (zoomed-in) viewport — that IS the coarse-global clamp.
  const vWid = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
  const isRegionalViewport = vWid < 60;
  let best = null;
  let bestDiff = Infinity;
  for (const cand of [page, page + 1, page - 1]) {
    if (cand < 0 || cand > lastPageFor(model)) continue;
    const entry = _seriesCache.get(pageKey(model, layer, bounds, cand));
    if (!entry || now - entry.ts >= SERIES_TTL_MS) continue;
    // The 0.5° viewportKey snap can match an entry whose grid is slightly SMALLER than (or offset
    // from) the current viewport — serving it renders a clamped sub-rectangle. Only take the exact-key
    // frame if its grid actually COVERS the viewport; else fall through to the containment fallback
    // (which finds a wider warmed frame, e.g. the zoom-out pre-warm) or misses into a fresh fetch.
    if (!bboxContains(entry.bounds, bounds)) continue;
    // A GLOBAL-width entry stored under the exact viewport key (a cold-viewport coarse SWR preview — the
    // backend served global-coarse while building the regional grid) must NOT be accepted here for a
    // REGIONAL viewport: doing so sets `best` with diff 0 and short-circuits the containment fallback below,
    // which would otherwise serve a SMALLER, already-warmed REGIONAL frame that also covers. That short
    // circuit is why a zoomed-in heatmap renders coarse/clamped (fw=360, willSharpen:false) even though a
    // covering regional tile is cached (organic repro 2026-06-28). Defer global to the last-resort fallback.
    const _eb = entry.bounds;
    const _eWid = (_eb.east < _eb.west) ? (_eb.east + 360 - _eb.west) : (_eb.east - _eb.west);
    if (isRegionalViewport && _eWid >= 340) continue;
    for (const h of entry.hours) {
      const d = Math.abs(h - hourOffset);
      if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
    }
  }
  // Containment fallback: the exact viewport key missed (e.g. just zoomed in / panned a bit), but
  // a WIDER already-warmed series (same model/layer, page-proximate) whose bbox CONTAINS this
  // viewport can serve it NOW — instant + zero backend while the exact view re-warms, instead of
  // missing into a per-hour fetch. The grid covers the viewport so it's render-safe; pick the
  // SMALLEST containing bbox so the served frame is the highest resolution available.
  if (best === null || bestDiff > 1.5) {
    let smallestArea = Infinity;
    let globalFallbackFrame = null;   // a GLOBAL-width frame — used ONLY if no regional frame contains the viewport
    let globalFallbackDiff = Infinity;
    const _wantSurf = getSurfModeFlag();
    for (const entry of _seriesCache.values()) {
      if (now - entry.ts >= SERIES_TTL_MS) continue;
      if (entry.model !== model || entry.layer !== layer) continue;
      // FLAVOR GUARD (2026-07-15, "the rating band isn't turning off"): NEVER serve a surf-flavored
      // page in swell mode — its frames carry SCOREs (ratingMode:true) and the engine's reverse gate
      // would keep painting the band while this serve preempts the honest commit that releases it.
      // ONE-DIRECTIONAL by design: an honest page in surf mode stays servable (the documented bridge —
      // the Option-A gate renders it honestly until a rating grid lands).
      if (!_wantSurf && entry.surf === true) continue;
      // Hour-range proximity guard (was a page-index compare — meaningless across the per-cost-class
      // span regimes, where the same hour maps to different page numbers). An entry whose HOURS list
      // can't reach the ask within the 3h lattice can never pass the ±1.5h nearest gate below.
      if (entry.hours && entry.hours.length &&
          (hourOffset < entry.hours[0] - 3 || hourOffset > entry.hours[entry.hours.length - 1] + 3)) continue;
      if (!bboxContains(entry.bounds, bounds)) continue;
      const nf = nearestFrameInEntry(entry, hourOffset);
      if (!nf) continue;
      const b = entry.bounds;
      // A GLOBAL-width frame renders coarse-clamped for a regional viewport, so DON'T prefer it. But in the
      // decoupled/serve-only world a region may have ONLY the global-coarse product (the regional grid_series
      // returns 0 frames / times out). Keep it as a LAST RESORT so scrubbing + layer/model switches still
      // render and track per hour instead of freezing on a stale frame. (Regression guard: returning null
      // here froze the heatmap whenever no regional frame existed — was 7db0a655.) The clamp-resharpen path
      // still attempts to upgrade to the regional tile once one is available; (near-)global viewports keep
      // accepting it directly below, so global scrub is unaffected.
      const eWid = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
      if (isRegionalViewport && eWid >= 340) {
        if (nf.diff < globalFallbackDiff) { globalFallbackDiff = nf.diff; globalFallbackFrame = nf.frame; }
        continue;
      }
      const area = Math.max(1e-4, b.east - b.west) * Math.max(1e-4, b.north - b.south);
      if (area < smallestArea) { smallestArea = area; best = nf.frame; bestDiff = nf.diff; }
    }
    // No regional frame contained the viewport — serve the global-coarse as a last resort (better than a
    // frozen/blank scrub). Still subject to the ±1.5h nearest-frame gate below.
    if ((best === null || bestDiff > 1.5) && globalFallbackFrame !== null) {
      best = globalFallbackFrame; bestDiff = globalFallbackDiff;
    }
  }
  // SERVED-FRAME COVERAGE INVARIANT (#10 Source 3, 2026-07-21 — VERIFIED against the live backend).
  // A grid_series page CAN hold frames with DIFFERENT bounds: EURO past the 240h native boundary
  // returns a WIDER coarse first frame (live: h228 5x5 [-84,24,-76,32]) followed by FINER, NARROWER
  // frames (h240+ 13x17 [-82,26,-79,30]). entry.bounds is the FIRST frame's bounds (:457-467), so the
  // entry-bounds containment checks above (:678/:717) can pass for a viewport that the SERVED (finer,
  // later) frame does NOT cover — serving a clamped sub-rectangle / floating rectangle. series_sharpen
  // guards this with its own frameCovers check, but recovery_2b / series_settle (useMarineScrubSettle)
  // commit a getMarineSeriesFrame result with NO per-frame gate. Enforce the contract at the one
  // function all series paths call: never return a frame whose OWN bounds don't cover the request — the
  // caller then fetches a covering grid. marineWarmCommitCovers is antimeridian/global/eps-safe and
  // fail-open. No-op for homogeneous pages (GFS verified uniform). Kill:
  // __RAW_DISABLE_MARINE_SERIES_FRAME_COVER__ (or the family master __RAW_DISABLE_MARINE_WARM_COVERAGE__).
  if (best !== null && bestDiff <= 1.5 &&
      !(typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_SERIES_FRAME_COVER__ === true) &&
      !marineWarmCommitCovers(best, bounds)) {
    if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) {
      window.__MARINE_SERIES_DIAG__.coverMisses = (window.__MARINE_SERIES_DIAG__.coverMisses || 0) + 1;
    }
    best = null;
  }
  if (best === null || bestDiff > 1.5) {
    if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.misses++;
    return null;
  }
  if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.hits++;
  return best;
}

export function _resetMarineSeriesForTest() {
  _seriesCache.clear();
  _inFlight.clear();
  for (const id of _idleTimers) {
    try { clearTimeout(id); if (typeof window !== 'undefined' && window.cancelIdleCallback) window.cancelIdleCallback(id); } catch (e) { /* ignore */ }
  }
  _idleTimers.clear();
  _seriesActiveLoads = 0;
  _seriesWaiters.length = 0;
  _failRetries.clear();
}
