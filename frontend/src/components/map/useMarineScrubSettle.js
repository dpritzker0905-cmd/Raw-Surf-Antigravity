import { useRef, useCallback, useEffect } from 'react';
import { getMarineSeriesFrame, ensureMarineSeries } from './marineGridSeries';
import { _marineDataSignature } from './useMarineOrchestratorDiag';

// True if the grid bounds fully cover the viewport bounds (small epsilon for float jitter).
function gridCoversViewport(gb, vb) {
  if (!gb || !vb) return false;
  const e = 1e-6;
  return gb.west <= vb.west + e && gb.east >= vb.east - e &&
         gb.south <= vb.south + e && gb.north >= vb.north - e;
}

// Detect a heatmap CLAMP: at a regional viewport (zoom > 6.5, span < 15°) the engine grid does NOT
// cover the viewport — either a coarse-GLOBAL grid held while zoomed in (renders blocky) OR a stale
// too-SMALL regional grid held after a zoom-out/pan (renders into a sub-rectangle). Both look clamped.
// Returns { clamp, kind, vb } reading the LIVE engine grid + map viewport. tol guards float jitter so a
// thin pan-edge sliver (grid still ~covers) is NOT treated as a clamp (avoids refetch churn/flash).
function detectClamp(mapInstance) {
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
    const regionalZoom = mapInstance.getZoom() > 6.5 && vwid < 15 && vhgt < 15;
    if (!regionalZoom) return { clamp: false, vb };
    if (renderedGlobal) return { clamp: true, kind: 'coarse_global', vb };
    // Regional grid SMALLER than the viewport (with a 0.25° tolerance) → too-small clamp.
    const ghgt = gb.north - gb.south;
    const tooSmall = !gridCoversViewport(gb, vb) && (gwid < vwid - 0.25 || ghgt < vhgt - 0.25);
    return { clamp: tooSmall, kind: tooSmall ? 'regional_too_small' : undefined, vb };
  } catch (e) {
    return { clamp: false };
  }
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
      const canSharpen = !!(frame && fw < 340 && frameCovers && setMarineData);
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
    if (engineEmpty && !pendingNow && mapInstance && activeMarineLayerRef.current &&
        marineData && marineData.grid?.vectors?.length) {
      const b = mapInstance.getBounds();
      const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      const model = activeModelRef.current;
      const layer = activeMarineLayerRef.current || 'waves';
      const frame = getMarineSeriesFrame(model, layer, vb, currentHour);
      if (frame && frame.grid && frame.grid.vectors && frame.grid.vectors.length > 0 && setMarineData) {
        if (typeof window !== 'undefined') window.__MARINE_ENGINE_EMPTY_RECOVER__ = (window.__MARINE_ENGINE_EMPTY_RECOVER__ || 0) + 1;
        console.log('[SCRUB-SETTLE] Engine empty at settled viewport — committing covering series frame (coarse fallback after zoom-out clear).');
        setMarineData(stampSeriesCommit(frame, marineRevision));
        recordSettleCommitSig(lastCommittedSigRef, frame, layer);
        return;
      }
      ensureMarineSeries(model, layer, vb, currentHour, undefined, true);
      return;
    }
  } catch (e) { /* map/series not ready — fall through to the hour/data checks */ }

  if (hourMismatch || noData) {
    // Terminal no-coverage/unsupported responses won't resolve by refetching — bypass the net.
    const fr = marineData?.grid?.__failureReason || marineData?.__failureReason;
    if (fr && (fr.includes('coverage') || fr.includes('unsupported'))) {
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
    // No-progress cap (organic repro 2026-06-28): at extreme zoom the series only has a GLOBAL covering frame
    // (fw 360) so runScrubSettleCheck's `fw < 340` gate can NEVER sharpen — the backstop re-drove forever
    // (loads 24→161+, rAF-jank). Track the stuck-clamp signature; after a few no-progress fires, stop
    // re-driving until the view changes (a covering regional tile genuinely isn't available — more re-driving
    // can't conjure one). Resets on any viewport/grid change, so normal sharpening is unaffected.
    let clampSig = null;
    let clampNoProgress = 0;
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

      const needsRefetch = (!(eng && eng._waveData) || clamp) && !window.__MARINE_FETCH_PENDING__ && govIdle;
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
        }
        if (clampNoProgress >= 3) {
          if (clampNoProgress === 3 && typeof window !== 'undefined') {
            window.__MARINE_CLAMP_GIVEUP_COUNT__ = (window.__MARINE_CLAMP_GIVEUP_COUNT__ || 0) + 1;
            // Diagnostic for P2: if willSharpen was true yet the engine grid stayed narrower than the frame
            // (engineGw < frameFw), the committed covering frame is NOT reaching the engine — the real
            // coverage bug that leaves a sub-viewport rectangle. That's fixed separately (hold a covering base).
            const _eb = gb ? `W${gb.west.toFixed(2)} E${gb.east.toFixed(2)} S${gb.south.toFixed(2)} N${gb.north.toFixed(2)}` : 'none';
            const _vp = _sd.vb ? `W${_sd.vb.w} E${_sd.vb.e} S${_sd.vb.s} N${_sd.vb.n}` : 'none';
            console.warn(`[Marine] Clamp backstop: ${kind} made no progress after 3 re-drives — stopping churn `
              + `until the view changes. (sharpen willSharpen=${_sd.willSharpen} frameFw=${_sd.fw}; engineGw=${gw && gw.toFixed ? gw.toFixed(1) : gw})`
              + ` engineBounds=[${_eb}] viewport=[${_vp}] series={loads:${_ser.loads},hits:${_ser.hits},misses:${_ser.misses}}`);
          }
          return;  // suppress further no-progress re-drives (breaks the infinite re-commit loop + particle-reset churn)
        }
      }
      console.warn(`[Marine] Render backstop: ${clamp ? (kind + ' grid at zoomed-in viewport') : 'engine empty'} + idle ≥3s — re-driving.`,
        `sharpen={found:${_sd.frameFound}, covers:${_sd.frameCovers}, fw:${_sd.fw && _sd.fw.toFixed ? _sd.fw.toFixed(1) : _sd.fw}, willSharpen:${_sd.willSharpen}} series={loads:${_ser.loads}, hits:${_ser.hits}, misses:${_ser.misses}}`);
      if (checkScrubSettleRef.current) checkScrubSettleRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [mapInstance]);
}
