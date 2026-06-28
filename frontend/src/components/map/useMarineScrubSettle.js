import { useRef, useCallback, useEffect } from 'react';
import { getMarineSeriesFrame, ensureMarineSeries } from './marineGridSeries';

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

// Scrub-settle safety net + blank-heatmap backstop, extracted VERBATIM from useMarineOrchestrator to
// keep that module under the 800-LOC cap. Behavior is unchanged: the effects run at the same call
// site, with the same dependency arrays, reading the same live refs (passed in via params).

// Scrub-settle verification: after scrubbing ends, confirm the rendered marineData matches the
// requested hour and, if not (or if blank / a coarse-global grid is held while zoomed in), re-drive a
// fetch or commit the regional series frame. Terminal-bypass (coverage/unsupported) + a 3-retry cap
// per {hour,model,layer} stop it looping on a genuinely-empty layer. Pure — reads everything via ctx.
function runScrubSettleCheck(ctx) {
  const {
    marineData, mapInstance, setMarineData,
    timeOffsetRef, activeModelRef, activeMarineLayerRef,
    safetyNetRetryRef, clampRefetchRef, marineFetchLocksRef, updateMarineGridRef,
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
        setMarineData(frame);
      } else {
        // No covering frame warmed yet → load the series for the CURRENT viewport+hour so the next
        // tick sharpens. Deduped + TTL'd + concurrency-capped, so repeated backstop ticks are cheap.
        ensureMarineSeries(model, layer, clampVb, currentHour);
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
        setMarineData(sf);
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
  marineFetchLocksRef, updateMarineGridRef,
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
    const id = setInterval(() => {
      // Layer-active checked LIVE via the ref (synced in render) — not an effect dep — so the
      // interval is created once and never churns (preserving the blank streak across re-renders).
      if (window.isScrubbingTimeline || !activeMarineLayerRef.current) { blankStreak = 0; return; }
      const eng = typeof window !== 'undefined' && window.__MARINE_ENGINE__;
      const gov = (typeof window !== 'undefined' && window.__MARINE_GOVERNOR_STATE__) || {};
      const govIdle = !gov.activeGridFetches && !gov.activeCopernicusFetches && !((gov.inFlightKeys || []).length);
      // Also re-drive when a non-covering grid (coarse-global OR too-small regional) is held while
      // zoomed IN — zoom-in/out fires no scrub-end, so without this the clamp would never sharpen.
      const { clamp, kind } = detectClamp(mapInstance);
      const needsRefetch = (!(eng && eng._waveData) || clamp) && !window.__MARINE_FETCH_PENDING__ && govIdle;
      if (!needsRefetch) { blankStreak = 0; return; }
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
      console.warn(`[Marine] Render backstop: ${clamp ? (kind + ' grid at zoomed-in viewport') : 'engine empty'} + idle ≥3s — re-driving.`,
        `sharpen={found:${_sd.frameFound}, covers:${_sd.frameCovers}, fw:${_sd.fw && _sd.fw.toFixed ? _sd.fw.toFixed(1) : _sd.fw}, willSharpen:${_sd.willSharpen}} series={loads:${_ser.loads}, hits:${_ser.hits}, misses:${_ser.misses}}`);
      if (checkScrubSettleRef.current) checkScrubSettleRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [mapInstance]);
}
