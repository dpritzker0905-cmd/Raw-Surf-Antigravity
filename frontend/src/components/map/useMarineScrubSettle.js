import { useRef, useCallback, useEffect } from 'react';
import { getMarineSeriesFrame, ensureMarineSeries } from './marineGridSeries';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import { isTerminalNoCoverage } from './marineControllerCache';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';

// True if the grid bounds fully cover the viewport bounds (small epsilon for float jitter).
function gridCoversViewport(gb, vb) {
  if (!gb || !vb) return false;
  const e = 1e-6;
  return gb.west <= vb.west + e && gb.east >= vb.east - e &&
         gb.south <= vb.south + e && gb.north >= vb.north - e;
}

// Detect a heatmap CLAMP: at a regional viewport (zoom > MARINE_ZOOMED_OUT_MAX_ZOOM, span < 15°) the engine grid does NOT
// cover the viewport — either a coarse-GLOBAL grid held while zoomed in (renders blocky) OR a stale
// too-SMALL regional grid held after a zoom-out/pan (renders into a sub-rectangle). Both look clamped.
// Returns { clamp, kind, vb } reading the LIVE engine grid + map viewport. tol guards float jitter so a
// thin pan-edge sliver (grid still ~covers) is NOT treated as a clamp (avoids refetch churn/flash).
// Cell size (degrees) above which a grid is coarser than ANY fine regional tile: fine tiles observed
// live are ≤0.25°/cell (13×13 over ~2-3°); a resident grid coarser than 0.5°/cell at a zoomed-in
// viewport is a degraded/intermediate product, never the finest available. Exported for tests.
// 2026-07-05 dwell-sharpen fix (the Baja "animations clamp, then you pan and they adjust" report):
// the live capture was 0.44°/cell (9×9 span-4°) at z8.3 — under the old 0.5 gate AND over the old
// 3-cells-across floor, so detectClamp never fired and only a pan pulled the sharpened fine grid.
// 0.3 excludes the genuinely-fine 0.25° tiles at ANY zoom (so deep zoom over fine data never loops).
export const CLAMP_COARSE_CELL_DEG = 0.3;
// Minimum grid cells that should span a zoomed-in viewport before the render reads as blocky. Raised
// 3 → 8 (zoom-relative legibility: ~7 cells across still reads blocky at z8+; the 0.44° Baja capture
// was 6.8 across). A genuinely FINE tile with few cells stays excluded by the 0.3° gate above, and
// the clamp_resharpen driver is capped at 2 per {viewport,hour,model,layer} so a coarse-only region
// cannot refetch-storm.
export const CLAMP_MIN_CELLS_ACROSS = 8;

// Detect a heatmap CLAMP: at a regional viewport (zoom > MARINE_ZOOMED_OUT_MAX_ZOOM, span < 15°) the engine grid either
// does NOT cover the viewport (coarse-GLOBAL blob or stale too-SMALL regional sub-rectangle) OR covers
// it but is far too COARSE to render detail (a degraded ~1°/cell tile held where a fine tile is expected).
// Returns { clamp, kind, vb } reading the LIVE engine grid + map viewport. Exported for tests.
export function detectClamp(mapInstance) {
  try {
    const wg = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
    if (!wg || !wg.bounds || !mapInstance) return { clamp: false };
    const gb = wg.bounds;
    const gwid = (gb.east < gb.west) ? (gb.east + 360) - gb.west : gb.east - gb.west;
    const renderedGlobal = gwid >= 340 || wg.coverage_scope === 'global' || wg.coverage_scope === 'global_coarse';
    const b = mapInstance.getBounds();
    const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const vwid = (vb.east < vb.west) ? (vb.east + 360) - vb.west : vb.east - vb.west;
    const vhgt = vb.north - vb.south;
    const regionalZoom = mapInstance.getZoom() > MARINE_ZOOMED_OUT_MAX_ZOOM && vwid < 15 && vhgt < 15;
    if (!regionalZoom) return { clamp: false, vb };
    if (renderedGlobal) return { clamp: true, kind: 'coarse_global', vb };
    // Regional grid SMALLER than the viewport (with a 0.25° tolerance) → too-small clamp.
    const ghgt = gb.north - gb.south;
    const tooSmall = !gridCoversViewport(gb, vb) && (gwid < vwid - 0.25 || ghgt < vhgt - 0.25);
    if (tooSmall) return { clamp: true, kind: 'regional_too_small', vb };
    // COVERS-BUT-TOO-COARSE (2026-07-04, live "heatmap cleared at z9.34, hasn't fixed itself"): the grid
    // contains the viewport but its cells are so large (a degraded/intermediate ~1°/cell tile held where
    // a fine regional tile is expected) that only a cell or two span the view — it block-means to ~0 at
    // the coast and reads near-blank. detectClamp missed this (covers → not too-small; span < 340 → not
    // global) so the backstop never re-drove and it sat forever. Flag it when cells are clearly coarser
    // than any fine tile AND too few span the viewport; the re-drive's clamp_resharpen pulls the fuller
    // viewport tile, and the no-progress cap bounds it if the region genuinely has no finer product.
    const cols = Math.max(1, wg.cols || 1), rows = Math.max(1, wg.rows || 1);
    const cellLng = gwid / cols, cellLat = ghgt / rows;
    const cellDeg = Math.max(cellLng, cellLat);
    const cellsAcross = Math.min(vwid / Math.max(cellLng, 1e-6), vhgt / Math.max(cellLat, 1e-6));
    const tooCoarse = gridCoversViewport(gb, vb) && cellDeg > CLAMP_COARSE_CELL_DEG && cellsAcross < CLAMP_MIN_CELLS_ACROSS;
    return { clamp: tooCoarse, kind: tooCoarse ? 'regional_too_coarse' : undefined, vb };
  } catch (e) {
    return { clamp: false };
  }
}

// RETAINED-REGIONAL zoom-out detector (2026-07-04, "cleared at ~z6.95"): the zoom-flash fix
// (56465397) RETAINS the stale regional grid on a zoom-out reject instead of clearing the engine, so
// `engineEmpty` is false; the display gate (WebGLMarineCustomLayer: gridWidth<340 at a zoomed-out
// viewport) then fades that regional grid to opacityMultiplier 0 / skips its render, leaving a BLANK
// heatmap with no global-coarse fallback. A retained REGIONAL grid at a zoomed-out viewport is
// display-equivalent to empty → both the §2b recovery AND the blank backstop must treat it as such
// so the GLOBAL-coarse frame gets fetched + committed. Exported for tests.
export function isRetainedRegionalZoomedOut(eng, mapInstance) {
  try {
    const eg = eng && eng._waveData && eng._waveData.waveGrid;
    const egb = eg && eg.bounds;
    if (!egb || !mapInstance) return false;
    const egSpan = (egb.east < egb.west) ? (egb.east + 360 - egb.west) : (egb.east - egb.west);
    if (!(egSpan > 0 && egSpan < 340)) return false;   // only a REGIONAL grid can be zoom-out-rejected
    const b = mapInstance.getBounds();
    const vw = (b.getEast() < b.getWest()) ? (b.getEast() + 360 - b.getWest()) : (b.getEast() - b.getWest());
    const vh = Math.abs(b.getNorth() - b.getSouth());
    const zoomedOut = vw > 15.0 || vh > 15.0 || mapInstance.getZoom() <= MARINE_ZOOMED_OUT_MAX_ZOOM;
    if (!zoomedOut) return false;
    // COVERAGE EXEMPTION (2026-07-05, gate↔guard↔recovery alignment): the display gate now SHOWS a
    // regional that covers ≥ the shared 0.8 fraction of the viewport even below z7 (Fix A) — and the
    // zoomed-out fetch path now requests the viewport bbox up to 15° span, committing a COVERING
    // clipped `global_mid` grid at z5-7. That grid is a HEALTHY display, not the ⑦ wedge — flagging
    // it here would loop the §2b recovery + blank-backstop refetching a global frame that never
    // commits (the fetch path returns the covering mid again). Only a NON-covering retained regional
    // (the gate hides it → blank) is display-equivalent to empty. Same lever as the gate/guard:
    // __RAW_DOWNGRADE_COVER_FRAC__ (default 0.8).
    const vWest = b.getWest(), vEast0 = b.getEast(), vSouth = b.getSouth(), vNorth = b.getNorth();
    const vEast = (vEast0 < vWest) ? vEast0 + 360 : vEast0;
    let gWest = egb.west, gEast = egb.east;
    if (gEast < gWest) gEast += 360;
    const ix = Math.max(0, Math.min(gEast, vEast) - Math.max(gWest, vWest));
    const iy = Math.max(0, Math.min(egb.north, vNorth) - Math.max(egb.south, vSouth));
    const vpArea = Math.max(1e-9, (vEast - vWest) * (vNorth - vSouth));
    const frac = (ix * iy) / vpArea;
    const minFrac = (typeof window !== 'undefined' && Number(window.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.8;
    return frac < minFrac;
  } catch (e) { return false; }
}

// How long a marine fetch-PENDING flag may persist with no live fetch backing it before we treat it as
// STRANDED. Symmetric to MARINE_FETCH_LEASE_MS (the isFetching lease in useMarineDataFetcherCore) but for
// the wedge the isFetching-gated watchdog CANNOT see: __MARINE_FETCH_PENDING__ stuck non-null while
// locks.isFetching is false and the governor is idle. Slightly longer than the isFetching lease because
// this path only clears a window flag (no controller to abort), so we want zero chance of clobbering a
// just-queued fetch that hasn't registered in the governor yet (the governor registers a real fetch in ms).
export const MARINE_PENDING_LEASE_MS = 6000;
// Snapshot the freeze state earlier than we act, so a single organic repro is fully diagnosable even if the
// auto-recovery's trigger turns out to be slightly off.
export const STRANDED_PENDING_RECORD_MS = 3000;

/**
 * Decide whether a marine fetch-PENDING is STRANDED. A stranded pending wedges BOTH frontend recovery
 * paths — runScrubSettleCheck bypasses on a matching pending (see "isAlreadyFetchingCurrentHour"), and the
 * blank-heatmap backstop requires `!pending` — while the isFetching-gated releaseStaleMarineLock stays
 * silent (isFetching is false). Net result: the heatmap freezes near a region that HAS data until a manual
 * layer toggle clears pending. This is the symmetric sibling of releaseStaleMarineLock for that case; the
 * govIdle + age + !isFetching guards make a false positive (clobbering a real in-flight fetch) effectively
 * impossible. Pure + unit-testable (no I/O). `record` requests a forensic snapshot before we act.
 */
export function evaluateStrandedPending({ hasPending, pendingAgeMs, govIdle, isFetching,
  leaseMs = MARINE_PENDING_LEASE_MS, recordMs = STRANDED_PENDING_RECORD_MS }) {
  if (!hasPending) return { record: false, stranded: false };
  // Record whatever is stuck (govIdle / isFetching captured in the payload by the caller) once a single
  // pending has out-lived a normal fetch — that alone is abnormal and worth a snapshot.
  const record = pendingAgeMs > recordMs;
  // Only treat as STRANDED (safe to clear + re-drive) when provably dead: idle + not isFetching + past lease.
  const stranded = !!govIdle && !isFetching && pendingAgeMs > leaseMs;
  return { record, stranded };
}

// Marker-wedge predicate (chip task_59bcc036), pure + exported for tests: isFetching=true with
// NO lease start stamp is the strand releaseStaleMarineLock cannot heal (its lease math bails
// on fetchStartedAt=0) — every fetch dedup-blocks with zero network activity. A HEALTHY fetch
// stamps the lease in the same tick it sets the marker, so tracking begins only on the
// abnormal combination, and stranded requires it sustained (default 10s) under an idle governor.
export const MARKER_WEDGE_LEASE_MS = 10 * 1000;
export function evaluateMarkerWedge({ isFetching, hasStartStamp, govIdle, ageMs, leaseMs = MARKER_WEDGE_LEASE_MS }) {
  const tracking = !!isFetching && !hasStartStamp;
  const stranded = tracking && !!govIdle && ageMs > leaseMs;
  return { tracking, stranded };
}

/**
 * Ring-buffer recorder for the "froze, needed a manual toggle" wedge (rating plan §8 #1). Read-only telemetry
 * — captures the lock/governor/pending state at the moment of a suspected freeze so the NEXT organic repro is
 * diagnosable in one shot (instrument-then-fix, not guess). Keeps the last ~20 snapshots + per-reason counts.
 */
function recordMarineFreeze(reason, payload) {
  if (typeof window === 'undefined') return;
  const store = window.__MARINE_FREEZE_DIAG__ || { counts: {}, recent: [] };
  store.counts[reason] = (store.counts[reason] || 0) + 1;
  store.recent.push({ ts: Date.now(), reason, ...payload });
  if (store.recent.length > 20) store.recent.shift();
  store.last = store.recent[store.recent.length - 1];
  window.__MARINE_FREEZE_DIAG__ = store;
}

// How often a CAPPED no-progress clamp may fire a slow PROBE re-drive. The cap itself is right (it
// breaks the ~6s re-commit/particle-reset churn), but its reset signature is the ENGINE grid bounds —
// for a held coarse_global grid those are always ±180/±85, so no pan ever resets the interval's cap
// and an idle user got PERMANENT silence: with the series coarse-reval budget also exhausted, nothing
// re-fetched until a moveend (the Venice "world grid resident for minutes" wedge, 2026-07-04). A probe
// every ~45s re-runs checkScrubSettle: if the backend's regional build finished meanwhile, the series
// force-fetch pulls it and the sharpen commits (event-driven via marine_series_revalidated); if not,
// it costs one bounded background fetch — no commit, so no particle-reset churn.
export const CLAMP_CAP_REARM_MS = 45000;

/**
 * Decide whether a no-progress-capped clamp should fire a slow probe re-drive. Pure + unit-testable.
 * `noProgress` = consecutive backstop passes with an unchanged engine-grid signature;
 * `sinceLastProbeMs` = elapsed since the cap engaged or the last probe fired;
 * `probesFired` = slow probes already fired for THIS clamp signature.
 * §7h.3 TERMINAL STATE (2026-07-13, the non-pilot forever-probe wedge): each probe forces one
 * bounded series fetch — when the best-available tier genuinely IS the resident (non-pilot mid
 * ceiling, or a dynamic tile the clamp classifier still dislikes), probes can never progress, so
 * they stop after `probeMax` (~3 min at the 45 s cadence). Recovery stays intact WITHOUT probes:
 * a landed regional frame fires `marine_series_revalidated` (event-driven sharpen), and any
 * viewport/grid change resets the signature and re-arms everything.
 */
export function evaluateClampCapProbe({ noProgress, sinceLastProbeMs, probesFired = 0, threshold = 3, rearmMs = CLAMP_CAP_REARM_MS, probeMax = 4 }) {
  if (noProgress < threshold) return { capped: false, probe: false, terminal: false };
  if (probesFired >= probeMax) return { capped: true, probe: false, terminal: true };
  return { capped: true, probe: sinceLastProbeMs >= rearmMs, terminal: false };
}

// Fallback revision sequence for callers (tests/legacy) that don't wire the shared marineRevision ref.
const _fallbackRevision = { current: 0 };

/**
 * Stamp a series-frame commit so it actually RENDERS. Root cause of the "committed covering frame
 * never sticks at the engine" clamp (regional_too_small, 2026-07-01): WebGLMarineLayer's upload
 * effect keys on the `revision` prop (marineData.__commitRevision) — it has NO `data` dependency —
 * and series frames from getMarineSeriesFrame carry neither __commitRevision nor
 * grid.__activeLayerNonzeroCount, so MapWebGL's revision computed to 0 for EVERY series commit. A
 * series→series commit (the clamp sharpen: same model/layer/hour, only the data changed) therefore
 * left revision 0→0 and the upload effect never fired — the engine kept the stale non-covering
 * grid (engineGw=3.0 vs frameFw=4.0 in the live log). Re-drives then re-committed the SAME cached
 * object, which React's setState bails out on entirely, so no retry could ever recover.
 * Fix: bump the SHARED marineRevision (the same monotonic sequence every other commit path uses —
 * orchestrator instant cache-hit, commitMarineData, SWR) and commit a shallow CLONE: the fresh
 * object identity defeats the setState bailout, the fresh __commitRevision fires the upload effect.
 * The grid stays shared by reference (cheap — no vector copy).
 */
export function stampSeriesCommit(frame, marineRevision) {
  const rev = marineRevision || _fallbackRevision;
  rev.current = (rev.current || 0) + 1;
  return { ...frame, __commitRevision: rev.current };
}

/**
 * Record a scrub-settle commit in the fetcher's duplicate-commit ledger. Without this the sharpen
 * left lastCommittedSigRef pointing at the PRE-sharpen product (e.g. the coarse-global preview), so
 * the next legitimate fetch that returned that same product hit commitMarineData's
 * `duplicate_commit_skipped` and never committed — no revision change, no layer effect re-run, and
 * the display wedged on a zoom-out-rejected regional rectangle (live-reproduced in preview,
 * 2026-07-01: zoom 9→4.55 re-fetched the cached coarse-global, sig matched the pre-sharpen ledger,
 * engine stuck rendering the 13×13 regional at a 10°-wide viewport). Recording the sharpened
 * frame's own signature keeps true duplicates (same content) skipped while letting a REAL product
 * change (coarse↔regional) commit normally.
 */
function recordSettleCommitSig(lastCommittedSigRef, frame, layer) {
  if (!lastCommittedSigRef) return;
  try { lastCommittedSigRef.current = _marineDataSignature(frame, layer); } catch (e) { lastCommittedSigRef.current = null; }
}

// Scrub-settle safety net + blank-heatmap backstop, extracted VERBATIM from useMarineOrchestrator to
// keep that module under the 800-LOC cap. Behavior is unchanged: the effects run at the same call
// site, with the same dependency arrays, reading the same live refs (passed in via params).

// Scrub-settle verification: after scrubbing ends, confirm the rendered marineData matches the
// requested hour and, if not (or if blank / a coarse-global grid is held while zoomed in), re-drive a
// fetch or commit the regional series frame. Terminal-bypass (coverage/unsupported) + a 3-retry cap
// per {hour,model,layer} stop it looping on a genuinely-empty layer. Pure — reads everything via ctx.
// Exported for tests (commit-stamping + engine-empty recovery regression coverage).
export function runScrubSettleCheck(ctx) {
  const {
    marineData, mapInstance, setMarineData,
    timeOffsetRef, activeModelRef, activeMarineLayerRef,
    safetyNetRetryRef, clampRefetchRef, marineFetchLocksRef, updateMarineGridRef,
    marineRevision, lastCommittedSigRef,
  } = ctx;

  if (window.isScrubbingTimeline) return;
  const currentHour = timeOffsetRef.current;
  const renderedHour = marineData?.grid?.hourOffset ?? marineData?.hourOffset;
  const hourMismatch = renderedHour !== undefined && renderedHour !== null && renderedHour !== currentHour;
  const noData = !marineData || !marineData.grid?.vectors?.length;

  // Heatmap CLAMP: the engine grid does NOT cover the viewport at a regional zoom — a coarse-GLOBAL
  // grid held while zoomed in (blocky blob), OR a stale too-SMALL regional grid held after a
  // zoom-out/pan (renders into a sub-rectangle). A plain /grid refetch is a no-op loop here (the
  // cache serves the same non-covering grid for the "contained" viewport), so instead commit a
  // REGIONAL series frame that COVERS the viewport. If none is warmed yet, load the series for THIS
  // viewport+hour so the next tick can sharpen — this is what breaks the coarse-global refetch loop.
  const { clamp, kind, vb: clampVb } = detectClamp(mapInstance);
  if (clamp && clampVb) {
    try {
      const model = activeModelRef.current;
      const layer = activeMarineLayerRef.current || 'waves';
      const frame = getMarineSeriesFrame(model, layer, clampVb, currentHour);
      const fb = frame && frame.grid && frame.grid.bounds;
      const fw = fb ? ((fb.east < fb.west) ? (fb.east + 360) - fb.west : fb.east - fb.west) : 999;
      const frameCovers = fb && gridCoversViewport(fb, clampVb);
      // For regional_too_coarse the covering series frame is usually the SAME coarse grid already
      // resident, so committing it just churns particles with no visual gain (2026-07-04). Only
      // sharpen-commit when the frame is MEANINGFULLY finer than what's resident; otherwise fall to
      // the dedup-bypassing clamp_resharpen fetch below, which pulls the fuller/finer viewport tile.
      let frameFinerEnough = true;
      if (kind === 'regional_too_coarse' && frame && frame.grid) {
        try {
          const rg = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
          if (rg && rg.bounds && rg.cols) {
            const rw = (rg.bounds.east < rg.bounds.west ? rg.bounds.east + 360 : rg.bounds.east) - rg.bounds.west;
            const rCell = rw / Math.max(1, rg.cols);
            const fCell = fw / Math.max(1, frame.grid.cols || 1);
            frameFinerEnough = fCell < rCell * 0.9;   // meaningfully finer, not the same coarse grid
          }
        } catch (e) { /* default true — never block a legitimate sharpen */ }
      }
      const canSharpen = !!(frame && fw < 340 && frameCovers && setMarineData && frameFinerEnough);
      if (typeof window !== 'undefined') {
        window.__MARINE_SHARPEN_DIAG__ = {
          kind, frameFound: !!frame, frameCovers: !!frameCovers, fw,
          hour: currentHour, vb: { w: +clampVb.west.toFixed(2), s: +clampVb.south.toFixed(2), e: +clampVb.east.toFixed(2), n: +clampVb.north.toFixed(2) },
          willSharpen: canSharpen, ts: Date.now()
        };
      }
      if (canSharpen) {
        if (typeof window !== 'undefined') window.__MARINE_GRIDMISMATCH_COUNT__ = (window.__MARINE_GRIDMISMATCH_COUNT__ || 0) + 1;
        console.log(`[SCRUB-SETTLE] Sharpening ${kind} grid: committing covering regional series frame.`);
        // Stamped CLONE, not the raw cached frame — see stampSeriesCommit. Without this the commit
        // never re-fired WebGLMarineLayer's revision-keyed upload effect (revision 0→0) and the
        // engine stayed on the stale non-covering grid — the regional_too_small clamp (2026-07-01).
        setMarineData(stampSeriesCommit(frame, marineRevision));
        recordSettleCommitSig(lastCommittedSigRef, frame, layer);
      } else {
        // No covering frame warmed yet → load the series for the CURRENT viewport+hour so the next
        // tick sharpens. FORCE past the TTL dedup (#8 root, 2026-07-01): after a pan beyond the warmed
        // tiles the cache holds only NON-covering frames for earlier viewports, and the normal TTL dedup
        // then refuses to re-fetch the covering tile the backend readily serves (curl-proven) — leaving
        // the engine stuck on a stale sub-viewport rectangle (regional_too_small). force+currentPageOnly
        // re-fetches just the covering current-hour tile; bounded by the render-backstop's 3-try
        // no-progress cap + the series concurrency slot, so it can't storm the 1-CPU backend.
        ensureMarineSeries(model, layer, clampVb, currentHour, undefined, true, true);
      }
      // UPGRADE the clamp to the FULLER regional tile. The committed series frame "covers" the viewport
      // but can be a small/coarse viewport grid (the "clamped to a small patch" report). A plain refetch
      // dedups (the no-op loop this branch was built to avoid), but a FRESH dedup-bypassing fetch — exactly
      // what a layer-toggle triggers (isCorrectLayer=false → bypassDedupe) — pulls the fuller regional
      // viewport tile. Capped per {viewport,hour,model,layer} so a coarse-only region can't make it storm.
      if (clampRefetchRef && updateMarineGridRef && updateMarineGridRef.current) {
        const _ck = `${model}_${layer}_${currentHour}_${clampVb.west.toFixed(1)}_${clampVb.south.toFixed(1)}_${clampVb.east.toFixed(1)}_${clampVb.north.toFixed(1)}`;
        if (clampRefetchRef.current.key !== _ck) clampRefetchRef.current = { key: _ck, count: 0 };
        if (clampRefetchRef.current.count < 2) {
          clampRefetchRef.current.count++;
          updateMarineGridRef.current('clamp_resharpen');
        }
      }
    } catch (e) { /* map/series not ready — defer */ }
    return;
  }

  // ZOOM-OUT CLEAR RECOVERY (§2b, 2026-07-01): on zoom-out the display gate rejects the resident
  // regional grid (isZoomedOutRegionalReject in useMarineWindData) and WebGLMarineLayer CLEARS the
  // engine — but marineData still holds that regional frame, so NO existing branch could recover:
  // detectClamp no-ops at a zoomed-out viewport, and noData is false (state still has vectors). The
  // render backstop then re-drove this check forever as a silent no-op — the "heatmap clears with no
  // coarse fallback" bug. Recover by committing a covering warmed series frame: at a wide viewport
  // the series key collapses to 'global', so this serves the cached coarse-global world grid —
  // visually clean now that coarse crests are suppressed in the vortex band (4520300e/fe7431c3), and
  // every getMarineSeriesFrame result COVERS the viewport by construction. If nothing covering is
  // warmed yet, load the series for THIS viewport so the next backstop tick can commit it.
  try {
    const eng = typeof window !== 'undefined' ? window.__MARINE_ENGINE__ : null;
    const engineEmpty = !!(eng && !eng._waveData);
    const pendingNow = typeof window !== 'undefined' && !!window.__MARINE_FETCH_PENDING__;
    // A retained REGIONAL grid at a zoomed-out viewport is display-equivalent to empty (rejected +
    // faded to op 0 by the gate) → run the same GLOBAL-frame recovery. Self-limiting: once the global
    // (span≥340) commits, the grid is no longer regional → this stops (no loop). See the helper.
    const retainedRegionalZoomedOut = !engineEmpty && isRetainedRegionalZoomedOut(eng, mapInstance);
    if ((engineEmpty || retainedRegionalZoomedOut) && !pendingNow && mapInstance && activeMarineLayerRef.current &&
        marineData && marineData.grid?.vectors?.length) {
      const b = mapInstance.getBounds();
      const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      const model = activeModelRef.current;
      const layer = activeMarineLayerRef.current || 'waves';
      // GATE-COMPATIBLE frame selection (live-caught 2026-07-02): at a ZOOMED-OUT viewport (zoom ≤ MARINE_ZOOMED_OUT_MAX_ZOOM
      // or span > 15° — the display gate's isViewportZoomedOut) useMarineWindData rejects EVERY
      // regional-width grid (gridWidth < 340 → isZoomedOutRegionalReject), and getMarineSeriesFrame
      // prefers the smallest CONTAINING regional tile — so this branch was committing frames the gate
      // is designed to reject, looping (engine stayed empty, __MARINE_ENGINE_EMPTY_RECOVER__ climbed).
      // In that zone only the GLOBAL-coarse frame is displayable: request the series with GLOBAL bounds
      // (collapses to the stable 'global' key → the world-covering coarse product).
      const vwid = (vb.east < vb.west) ? (vb.east + 360) - vb.west : vb.east - vb.west;
      const vhgt = Math.abs(vb.north - vb.south);
      let zoomedOutGate = vwid > 15.0 || vhgt > 15.0;
      try { zoomedOutGate = zoomedOutGate || mapInstance.getZoom() <= MARINE_ZOOMED_OUT_MAX_ZOOM; } catch (e) { /* keep span-based */ }
      // MID-RES BAND (2026-07-05): the GLOBAL frame is only mandatory when the SPAN outgrows the
      // backend's mid tier (>15°). At z≤7 with span ≤15° request the VIEWPORT instead — the fetch
      // path resolves it to the clipped ~2° global_mid, which COVERS the viewport by construction,
      // so the coverage-aligned gate (Fix A) displays it: regional-quality at z5-7 instead of the
      // 10° lattice. Kill (revert to z-based global): __RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__.
      const _wideSpanOnly = (typeof window === 'undefined' || window.__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__ !== true)
        ? (vwid > 15.0 || vhgt > 15.0) : zoomedOutGate;
      const reqBounds = _wideSpanOnly ? { west: -180, south: -85, east: 180, north: 85 } : vb;
      const frame = getMarineSeriesFrame(model, layer, reqBounds, currentHour);
      if (frame && frame.grid && frame.grid.vectors && frame.grid.vectors.length > 0 && setMarineData) {
        if (typeof window !== 'undefined') window.__MARINE_ENGINE_EMPTY_RECOVER__ = (window.__MARINE_ENGINE_EMPTY_RECOVER__ || 0) + 1;
        console.log(`[SCRUB-SETTLE] Engine empty at settled viewport — committing ${zoomedOutGate ? 'GLOBAL-coarse' : 'covering regional'} series frame (recovery after zoom-out clear).`);
        setMarineData(stampSeriesCommit(frame, marineRevision));
        recordSettleCommitSig(lastCommittedSigRef, frame, layer);
        return;
      }
      ensureMarineSeries(model, layer, reqBounds, currentHour, undefined, true);
      return;
    }
  } catch (e) { /* map/series not ready — fall through to the hour/data checks */ }

  if (hourMismatch || noData) {
    // Terminal no-coverage/unsupported responses won't resolve by refetching — bypass the net.
    const fr = marineData?.grid?.__failureReason || marineData?.__failureReason;
    if (fr && (fr.includes('coverage') || fr.includes('unsupported'))) {
      return;
    }
    // §7.6 far-horizon churn: the held frame is a STALE grid (no __failureReason) but the REQUESTED hour
    // is terminally uncovered for this run (EURO waves >240h / ICON extended range not yet ingested) — the
    // fetcher recorded it. Bypass so the backstop stops re-driving the doomed 404 (the "10-day slowdown"),
    // while the held frame keeps displaying (no clearing). Kill: window.__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__.
    if (isTerminalNoCoverage(activeModelRef?.current, activeMarineLayerRef?.current, currentHour)) {
      if (typeof window !== 'undefined') {
        window.__MARINE_TERMINAL_NOCOV_BYPASS_COUNT__ = (window.__MARINE_TERMINAL_NOCOV_BYPASS_COUNT__ || 0) + 1;
      }
      return;
    }

    const pending = window.__MARINE_FETCH_PENDING__;
    const isAlreadyFetchingCurrentHour = pending &&
      pending.hour === currentHour &&
      pending.model === activeModelRef.current &&
      pending.layer === (activeMarineLayerRef.current || 'waves');

    if (isAlreadyFetchingCurrentHour) {
      console.log(`[SCRUB-SETTLE] Post-scrub verification: rendered hour=${renderedHour}, requested hour=${currentHour}. Fetch already in-flight for this hour. Bypassing redundant fetch.`);
      return;
    }

    // Cap retries for a persistently-failing target so this net can't saturate the backend.
    const ssKey = `${currentHour}_${activeModelRef.current}_${activeMarineLayerRef.current || 'waves'}`;
    if (safetyNetRetryRef.current.key !== ssKey) safetyNetRetryRef.current = { key: ssKey, count: 0 };
    if (noData) {
      if (safetyNetRetryRef.current.count >= 3) {
        console.warn(`[SCRUB-SETTLE] Max safety-net retries (3) for ${ssKey}; stopping to avoid a refetch loop.`);
        return;
      }
      safetyNetRetryRef.current.count++;
    }

    // SERIES-FIRST: the warmed multi-hour series usually already holds this hour — especially at
    // GLOBAL zoom, where the prewarm loads all pages under the stable 'global' key. Commit the nearest
    // warmed frame INSTANTLY (zero-backend) and SKIP the per-hour /grid fetch. This is the snappy-scrub
    // path: live forensics showed the series warmed (loads>0) but this safety net NEVER consulted it —
    // it always fetched, which is the per-hour SCRUB-SETTLE storm the user sees. Only fetch when the
    // series genuinely lacks the hour (returns null).
    try {
      const vb = mapInstance.getBounds();
      const vp = { west: vb.getWest(), south: vb.getSouth(), east: vb.getEast(), north: vb.getNorth() };
      const sf = getMarineSeriesFrame(activeModelRef.current, activeMarineLayerRef.current || 'waves', vp, currentHour);
      if (sf && sf.grid && sf.grid.vectors && sf.grid.vectors.length > 0 && setMarineData) {
        if (typeof window !== 'undefined') window.__MARINE_SCRUBSETTLE_SERIESHIT__ = (window.__MARINE_SCRUBSETTLE_SERIESHIT__ || 0) + 1;
        console.log(`[SCRUB-SETTLE] Series hit for hour=${currentHour} — committing warmed frame (no fetch).`);
        // Stamped clone for the same reason as the clamp sharpen above: an unstamped series frame
        // only rendered by luck (when the hour prop happened to change too).
        setMarineData(stampSeriesCommit(sf, marineRevision));
        recordSettleCommitSig(lastCommittedSigRef, sf, activeMarineLayerRef.current || 'waves');
        return;
      }
    } catch (e) { /* series not ready — fall through to the authoritative fetch */ }

    console.log(`[SCRUB-SETTLE] Post-scrub verification: rendered hour=${renderedHour}, requested hour=${currentHour}. Triggering fetch.`);
    marineFetchLocksRef.current.lastHash = null;
    if (updateMarineGridRef.current) {
      updateMarineGridRef.current('timeline_scrub');
    }
  }
}

export function useMarineScrubSettle({
  mapInstance, marineData, setMarineData,
  timeOffsetRef, activeModelRef, activeMarineLayerRef, activeMarineLayersRef,
  marineFetchLocksRef, updateMarineGridRef, marineRevision, lastCommittedSigRef,
}) {
  const scrubSettleTimerRef = useRef(null);
  // Caps safety-net refetches per {hour,model,layer} so a fetch that keeps failing can't re-fire
  // forever and saturate the 1-CPU backend. Resets automatically when the target changes.
  const safetyNetRetryRef = useRef({ key: '', count: 0 });
  // Caps the dedup-bypassing "upgrade" fetch when a coarse/small grid is held while zoomed in, so a
  // region that only has the coarse product can't turn the clamp-resharpen into a refetch storm.
  const clampRefetchRef = useRef({ key: '', count: 0 });

  const checkScrubSettle = useCallback(() => {
    runScrubSettleCheck({
      marineData, mapInstance, setMarineData,
      timeOffsetRef, activeModelRef, activeMarineLayerRef,
      safetyNetRetryRef, clampRefetchRef, marineFetchLocksRef, updateMarineGridRef,
      marineRevision, lastCommittedSigRef,
    });
  }, [marineData]);

  // Live ref to the latest checkScrubSettle so the blank-backstop interval can call it without taking
  // it as an effect dep (which would re-create the interval on every marineData change and reset its
  // blank streak before it ever reaches the threshold).
  const checkScrubSettleRef = useRef(checkScrubSettle);
  checkScrubSettleRef.current = checkScrubSettle;

  // Drive checkScrubSettle when scrubbing ends.
  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;
    let wasScrubbingRef = false;
    const intervalId = setInterval(() => {
      const isNowScrubbing = !!window.isScrubbingTimeline;
      if (wasScrubbingRef && !isNowScrubbing) {
        clearTimeout(scrubSettleTimerRef.current);
        scrubSettleTimerRef.current = setTimeout(checkScrubSettle, 250);
      }
      wasScrubbingRef = isNowScrubbing;
    }, 150);
    const handleScrubEnd = () => {
      clearTimeout(scrubSettleTimerRef.current);
      scrubSettleTimerRef.current = setTimeout(checkScrubSettle, 200);
    };
    window.addEventListener('timeline_scrub_end', handleScrubEnd);
    // When a coarse-preview series page revalidates to a REGIONAL grid, commit it (sharpen the clamp).
    const handleRevalidated = () => {
      clearTimeout(scrubSettleTimerRef.current);
      scrubSettleTimerRef.current = setTimeout(() => checkScrubSettleRef.current && checkScrubSettleRef.current(), 60);
    };
    window.addEventListener('marine_series_revalidated', handleRevalidated);
    // On viewport SETTLE (zoom-out/pan), check for a clamp promptly instead of waiting for the 3s
    // backstop. Debounced; a no-op unless detectClamp fires, so normal panning is unaffected. A
    // second check ~1.4s later catches the case where the covering series frame is still loading.
    let moveTimer = null, moveTimer2 = null;
    const handleMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      clearTimeout(moveTimer); clearTimeout(moveTimer2);
      moveTimer = setTimeout(() => checkScrubSettleRef.current && checkScrubSettleRef.current(), 350);
      moveTimer2 = setTimeout(() => checkScrubSettleRef.current && checkScrubSettleRef.current(), 1400);
    };
    mapInstance.on('moveend', handleMoveEnd);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('timeline_scrub_end', handleScrubEnd);
      window.removeEventListener('marine_series_revalidated', handleRevalidated);
      try { mapInstance.off('moveend', handleMoveEnd); } catch (e) { /* map gone */ }
      clearTimeout(scrubSettleTimerRef.current);
      clearTimeout(moveTimer); clearTimeout(moveTimer2);
    };
  }, [mapInstance, marineData, checkScrubSettle]);

  // Blank-heatmap backstop — OWN effect, keyed on mapInstance. When a layer is active but the WebGL
  // engine has NO wave data (or a coarse-global grid is held while zoomed in) AND no fetch is pending
  // AND the governor shows no in-flight fetch, sustained ~3s, re-drive checkScrubSettle. Catches the
  // SILENT blank-wedge the fetcher's isFetching-gated watchdog can't see.
  useEffect(() => {
    if (!mapInstance) return;
    let blankStreak = 0;
    let lastBackstop = 0;
    // Stranded-pending tracking (rating plan §8 #1): how long the SAME __MARINE_FETCH_PENDING__ has persisted.
    let pendingSig = null;
    let pendingSince = 0;
    let lastPendingRelease = 0;
    let lastFreezeRecord = 0;
    // Marker-wedge tracking (chip task_59bcc036): how long isFetching=true has persisted WITHOUT
    // a lease start stamp — the strand releaseStaleMarineLock cannot heal (its lease math bails
    // on fetchStartedAt=0), which dedup-blocks every fetch with zero network activity.
    let zeroStampSince = 0;
    // Stranded-debounce tracking (2026-07-07): how long __MARINE_FETCH_DEBOUNCING__ has stuck
    // true under an idle governor — legit windows are ≤900ms.
    let debouncingSince = 0;
    // No-progress cap (organic repro 2026-06-28): at extreme zoom the series only has a GLOBAL covering frame
    // (fw 360) so runScrubSettleCheck's `fw < 340` gate can NEVER sharpen — the backstop re-drove forever
    // (loads 24→161+, rAF-jank). Track the stuck-clamp signature; after a few no-progress fires, stop
    // re-driving until the view changes (a covering regional tile genuinely isn't available — more re-driving
    // can't conjure one). Resets on any viewport/grid change, so normal sharpening is unaffected.
    let clampSig = null;
    let clampNoProgress = 0;
    let lastCapProbe = 0;  // when the no-progress cap engaged / last slow probe fired
    let clampProbesFired = 0;      // §7h.3: slow probes fired for THIS clamp signature
    let clampTerminalWarned = false;
    const id = setInterval(() => {
      // Layer-active checked LIVE via the ref (synced in render) — not an effect dep — so the
      // interval is created once and never churns (preserving the blank streak across re-renders).
      if (window.isScrubbingTimeline || !activeMarineLayerRef.current) { blankStreak = 0; pendingSig = null; return; }
      const eng = typeof window !== 'undefined' && window.__MARINE_ENGINE__;
      const gov = (typeof window !== 'undefined' && window.__MARINE_GOVERNOR_STATE__) || {};
      const govIdle = !gov.activeGridFetches && !gov.activeCopernicusFetches && !((gov.inFlightKeys || []).length);
      // Also re-drive when a non-covering grid (coarse-global OR too-small regional) is held while
      // zoomed IN — zoom-in/out fires no scrub-end, so without this the clamp would never sharpen.
      const { clamp, kind } = detectClamp(mapInstance);

      // ── Stranded-pending watchdog: the wedge the user hit near FL (data present, grid covers, froze after
      //    ~1min, only Waves off→on recovered). __MARINE_FETCH_PENDING__ stuck non-null while isFetching is
      //    false + governor idle disables BOTH recovery paths (runScrubSettleCheck bypasses on a matching
      //    pending; the blank-backstop below requires !pending) and the isFetching watchdog can't see it.
      //    Symmetric sibling of releaseStaleMarineLock: record the freeze state (forensics), then — only when
      //    provably dead (idle + !isFetching + past the lease) — clear the stranded pending and re-drive.
      const pending = (typeof window !== 'undefined') ? window.__MARINE_FETCH_PENDING__ : null;
      const locks = marineFetchLocksRef && marineFetchLocksRef.current;
      const isFetching = !!(locks && locks.isFetching);
      const sig = pending ? `${pending.model}/${pending.layer}/${pending.hour}` : null;
      if (sig !== pendingSig) { pendingSig = sig; pendingSince = Date.now(); }
      const pendingAge = pending ? (Date.now() - pendingSince) : 0;
      const sp = evaluateStrandedPending({ hasPending: !!pending, pendingAgeMs: pendingAge, govIdle, isFetching });
      if (sp.record && Date.now() - lastFreezeRecord > 3000) {
        lastFreezeRecord = Date.now();
        let renderedHour = null;
        try { renderedHour = eng && eng._waveData && eng._waveData.waveGrid ? eng._waveData.waveGrid.hourOffset : null; } catch (e) { /* engine churning */ }
        recordMarineFreeze('stranded_pending', {
          pendingAge, sig, govIdle, isFetching, engHasData: !!(eng && eng._waveData), clamp: !!clamp, kind: kind || null,
          renderedHour, requestedHour: timeOffsetRef.current,
          gov: { grid: gov.activeGridFetches || 0, cop: gov.activeCopernicusFetches || 0, inFlight: (gov.inFlightKeys || []).length },
        });
      }
      if (sp.stranded && Date.now() - lastPendingRelease > 6000) {
        lastPendingRelease = Date.now();
        pendingSig = null; blankStreak = 0;
        if (typeof window !== 'undefined') {
          window.__MARINE_FETCH_PENDING__ = null;
          window.__MARINE_FETCH_DEBOUNCING__ = false;
          window.__MARINE_PENDING_LEASE_RELEASE__ = (window.__MARINE_PENDING_LEASE_RELEASE__ || 0) + 1;
        }
        console.warn(`[Marine] Stranded fetch-pending released (idle ${(pendingAge / 1000).toFixed(1)}s, isFetching=false, governor idle) — re-driving wedged heatmap.`);
        if (checkScrubSettleRef.current) checkScrubSettleRef.current();
        return;
      }

      // ── Stranded-debounce watchdog (2026-07-07, the SAME family as stranded-pending): a
      //    legitimate debounce window is ≤900ms (orchestrator moveend), so a
      //    __MARINE_FETCH_DEBOUNCING__ that persists >8s while the governor is idle and nothing
      //    is pending is a strand (the moveend early-return leak was the root — fixed at the
      //    source, this is the belt). ~8 gates read the flag as "transitioning" and hold stale
      //    frames while it sticks — the close-zoom clamped-resolution face.
      if (typeof window !== 'undefined' && window.__MARINE_FETCH_DEBOUNCING__ === true &&
          govIdle && !window.__MARINE_FETCH_PENDING__ && !isFetching) {
        if (!debouncingSince) debouncingSince = Date.now();
        if (Date.now() - debouncingSince > 8000) {
          debouncingSince = 0;
          window.__MARINE_FETCH_DEBOUNCING__ = false;
          window.__MARINE_DEBOUNCE_STRAND_HEAL__ = (window.__MARINE_DEBOUNCE_STRAND_HEAL__ || 0) + 1;
          console.warn('[Marine] Stranded __MARINE_FETCH_DEBOUNCING__ cleared (idle 8s+, no pending, not fetching) — transition gates released.');
        }
      } else {
        debouncingSince = 0;
      }

      // ── Marker-wedge heal (chip task_59bcc036, the 07-06 "zero network requests" dead-wedge):
      //    isFetching=true with NO lease start stamp is UNHEALABLE by releaseStaleMarineLock
      //    (its lease math bails on fetchStartedAt=0) and dedup-blocks every fetch — the wedge
      //    whose only user remedy was a hard refresh. Provably dead = governor idle + no start
      //    stamp, sustained 10s (a healthy fetch stamps the lease within the same tick it sets
      //    the marker). Heal the marker and re-drive; telemetry __MARINE_MARKER_WEDGE_HEAL__.
      //    Kill: __RAW_DISABLE_MARKER_WEDGE_HEAL__.
      const zeroStamp = evaluateMarkerWedge({
        isFetching, hasStartStamp: !!(locks && locks.fetchStartedAt), govIdle,
        ageMs: zeroStampSince ? Date.now() - zeroStampSince : 0,
      });
      if (zeroStamp.tracking) { if (!zeroStampSince) zeroStampSince = Date.now(); } else { zeroStampSince = 0; }
      if (zeroStamp.stranded &&
          !(typeof window !== 'undefined' && window.__RAW_DISABLE_MARKER_WEDGE_HEAL__ === true)) {
        zeroStampSince = 0;
        if (locks) { locks.isFetching = false; locks.activeSource = null; }
        if (typeof window !== 'undefined') {
          window.__MARINE_MARKER_WEDGE_HEAL__ = (window.__MARINE_MARKER_WEDGE_HEAL__ || 0) + 1;
        }
        recordMarineFreeze('marker_wedge_healed', { govIdle, isFetching: true, hadStartStamp: false });
        console.warn('[Marine] isFetching marker wedge healed (no lease stamp, governor idle 10s+) — re-driving.');
        if (checkScrubSettleRef.current) checkScrubSettleRef.current();
        return;
      }

      // Forensic-only (no auto-action): the OTHER hypothesis — at rest (idle, not scrubbing, NO pending,
      // not isFetching) but the engine's rendered hour ≠ the requested hour while a covering grid is held.
      // That's a render/commit freeze the stranded-pending path won't fire on; capturing it (vs. the absence
      // of any record) tells us which cause the next organic repro actually is — instrument, then fix.
      if (!pending && govIdle && !isFetching && eng && eng._waveData && !clamp && Date.now() - lastFreezeRecord > 3000) {
        let rh = null;
        try { rh = eng._waveData.waveGrid ? eng._waveData.waveGrid.hourOffset : null; } catch (e) { rh = null; }
        if (rh != null && rh !== timeOffsetRef.current) {
          lastFreezeRecord = Date.now();
          recordMarineFreeze('stale_not_tracking', {
            renderedHour: rh, requestedHour: timeOffsetRef.current, govIdle, isFetching, pending: false,
          });
        }
      }

      // RETAINED-REGIONAL zoom-out (2026-07-04, "cleared at ~z6.95"): a regional grid held (retained,
      // not empty) at a zoomed-out viewport is faded to op 0 by the display gate → display-empty. The
      // §2b recovery commits the GLOBAL frame, but on a COLD global cache it must fetch first, and the
      // moveend that fired the recovery once won't re-fire to commit the warmed frame — so the backstop
      // must keep re-driving until the global (span≥340) commits. Add it to needsRefetch; self-limiting
      // (once global commits it's no longer regional → false).
      const retainedRegionalZoomedOut = isRetainedRegionalZoomedOut(eng, mapInstance);
      const needsRefetch = (!(eng && eng._waveData) || clamp || retainedRegionalZoomedOut) && !window.__MARINE_FETCH_PENDING__ && govIdle;
      if (!needsRefetch) { blankStreak = 0; clampNoProgress = 0; clampSig = null; return; }
      blankStreak++;
      if (blankStreak < 3) return;                   // require ~3s sustained (ignores the brief load gap)
      if (Date.now() - lastBackstop < 6000) return;  // min gap so each refetch can complete
      lastBackstop = Date.now();
      blankStreak = 0;
      if (typeof window !== 'undefined') window.__MARINE_BLANK_BACKSTOP_COUNT__ = (window.__MARINE_BLANK_BACKSTOP_COUNT__ || 0) + 1;
      // Inline the sharpen/series diagnosis so a single backstop log line reveals WHY it isn't sharpening:
      //   frameFound:false -> the regional series isn't warming for this viewport (load/dedup);
      //   frameFound:true + fw>=340 -> the series itself came back GLOBAL-coarse (needs regional revalidation);
      //   frameFound:true + frameCovers:false -> served grid doesn't contain the viewport (containment/snap).
      const _sd = (typeof window !== 'undefined' && window.__MARINE_SHARPEN_DIAG__) || {};
      const _ser = (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) || {};
      // No-progress cap: a CLAMP whose held ENGINE grid signature does not change across re-drives is making
      // no progress, and re-driving just churns (rAF jank + a particle-state reset every ~6s). This covers
      // BOTH failure modes: (a) willSharpen:false — the only covering frame is global (fw>=340) and the gate
      // rightly won't commit it; and (b) willSharpen:true but the committed "covering" series frame never
      // STICKS at the engine (the infinite re-commit loop from the 2026-06-30 log: Sharpening fires every
      // cycle, hits climb 3→20, yet detectClamp still reads regional_too_small because the engine grid never
      // became the committed frame). Both are unrecoverable by re-driving alone → cap on an unchanged engine
      // signature and stop until the view changes (a moveend re-triggers checkScrubSettle for a new viewport).
      // A sharpen that DOES stick changes the engine bounds → sig changes → counter resets → clamp clears
      // naturally, so this never caps a genuinely-progressing recovery. (Previously the cap required
      // willSharpen===false, so mode (b) reset the counter every cycle and looped forever.)
      if (clamp) {
        let gb = null;
        try { gb = eng && eng._waveData && eng._waveData.waveGrid && eng._waveData.waveGrid.bounds; } catch (e) { gb = null; }
        const gw = gb ? ((gb.east < gb.west) ? (gb.east + 360) - gb.west : gb.east - gb.west) : null;
        const sig = gb
          ? `${kind}|${gb.west.toFixed(1)},${gb.south.toFixed(1)},${gb.east.toFixed(1)},${gb.north.toFixed(1)}`
          : kind;
        if (sig === clampSig) {   // held engine grid unchanged since last re-drive → no progress (either mode)
          clampNoProgress++;
        } else {
          clampSig = sig;
          clampNoProgress = 0;
          clampProbesFired = 0;          // §7h.3: any engine-grid change re-arms the probe budget
          clampTerminalWarned = false;
        }
        if (clampNoProgress >= 3) {
          if (clampNoProgress === 3 && typeof window !== 'undefined') {
            window.__MARINE_CLAMP_GIVEUP_COUNT__ = (window.__MARINE_CLAMP_GIVEUP_COUNT__ || 0) + 1;
            lastCapProbe = Date.now();  // arm the slow-probe clock from the moment the cap engages
            // Diagnostic for P2: if willSharpen was true yet the engine grid stayed narrower than the frame
            // (engineGw < frameFw), the committed covering frame is NOT reaching the engine — the real
            // coverage bug that leaves a sub-viewport rectangle. That's fixed separately (hold a covering base).
            const _eb = gb ? `W${gb.west.toFixed(2)} E${gb.east.toFixed(2)} S${gb.south.toFixed(2)} N${gb.north.toFixed(2)}` : 'none';
            const _vp = _sd.vb ? `W${_sd.vb.w} E${_sd.vb.e} S${_sd.vb.s} N${_sd.vb.n}` : 'none';
            console.warn(`[Marine] Clamp backstop: ${kind} made no progress after 3 re-drives — slowing to a `
              + `${(CLAMP_CAP_REARM_MS / 1000)}s probe cadence. (sharpen willSharpen=${_sd.willSharpen} frameFw=${_sd.fw}; engineGw=${gw && gw.toFixed ? gw.toFixed(1) : gw})`
              + ` engineBounds=[${_eb}] viewport=[${_vp}] series={loads:${_ser.loads},hits:${_ser.hits},misses:${_ser.misses}}`);
            return;
          }
          // Slow re-arm probe: the engine-sig cap never resets for a held coarse_global grid (its bounds
          // are always the world), so without this an idle viewport stayed wedged on the world grid until
          // a moveend — even after the backend's regional build completed. One probe per rearm window:
          // sharpens instantly when a covering regional frame is now available, else fires one bounded
          // background series fetch (no commit → no churn).
          const _probeMax = (typeof window !== 'undefined' && Number.isFinite(+window.__RAW_CLAMP_PROBE_MAX__)) ? +window.__RAW_CLAMP_PROBE_MAX__ : 4;
          const cp = evaluateClampCapProbe({ noProgress: clampNoProgress, sinceLastProbeMs: Date.now() - lastCapProbe, probesFired: clampProbesFired, probeMax: _probeMax });
          if (cp.terminal) {
            // §7h.3: probe budget spent — the resident IS the best available tier here. Silent
            // hold; marine_series_revalidated / moveend / any grid change re-arms recovery.
            if (!clampTerminalWarned) {
              clampTerminalWarned = true;
              if (typeof window !== 'undefined') window.__MARINE_CLAMP_TERMINAL_COUNT__ = (window.__MARINE_CLAMP_TERMINAL_COUNT__ || 0) + 1;
              console.warn(`[Marine] Clamp backstop: ${kind} probe budget spent (${_probeMax}) — accepting resident as best-available tier. Re-arms on view/grid change; series revalidation still sharpens instantly.`);
            }
            return;
          }
          if (cp.probe) {
            lastCapProbe = Date.now();
            clampProbesFired++;
            if (typeof window !== 'undefined') window.__MARINE_CLAMP_CAP_PROBE_COUNT__ = (window.__MARINE_CLAMP_CAP_PROBE_COUNT__ || 0) + 1;
            console.warn(`[Marine] Clamp backstop: capped ${kind} slow probe ${clampProbesFired}/${_probeMax} — re-checking for a landed regional product.`);
            if (checkScrubSettleRef.current) checkScrubSettleRef.current();
          }
          return;  // suppress fast no-progress re-drives (breaks the infinite re-commit loop + particle-reset churn)
        }
      }
      console.warn(`[Marine] Render backstop: ${clamp ? (kind + ' grid at zoomed-in viewport') : 'engine empty'} + idle ≥3s — re-driving.`,
        `sharpen={found:${_sd.frameFound}, covers:${_sd.frameCovers}, fw:${_sd.fw && _sd.fw.toFixed ? _sd.fw.toFixed(1) : _sd.fw}, willSharpen:${_sd.willSharpen}} series={loads:${_ser.loads}, hits:${_ser.hits}, misses:${_ser.misses}}`);
      if (checkScrubSettleRef.current) checkScrubSettleRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [mapInstance]);
}
