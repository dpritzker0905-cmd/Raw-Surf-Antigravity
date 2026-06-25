import { useRef, useCallback, useEffect } from 'react';
import { getMarineSeriesFrame } from './marineGridSeries';

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
    safetyNetRetryRef, marineFetchLocksRef, updateMarineGridRef,
  } = ctx;

  if (window.isScrubbingTimeline) return;
  const currentHour = timeOffsetRef.current;
  const renderedHour = marineData?.grid?.hourOffset ?? marineData?.hourOffset;
  const hourMismatch = renderedHour !== undefined && renderedHour !== null && renderedHour !== currentHour;
  const noData = !marineData || !marineData.grid?.vectors?.length;

  // Resolution mismatch: a COARSE GLOBAL grid is rendered while the viewport is zoomed IN to a
  // region. The global grid "covers" the zoomed-in viewport, so the normal moveend fetch is
  // suppressed by cache containment and the heatmap stays a blocky ~1-cell blob that never
  // sharpens. Detect it and force a fresh REGIONAL fetch. Reads the live engine grid bounds.
  let gridMismatch = false;
  try {
    const wg = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
    if (wg && wg.bounds && mapInstance) {
      const gwid = (wg.bounds.east < wg.bounds.west) ? (wg.bounds.east + 360) - wg.bounds.west : wg.bounds.east - wg.bounds.west;
      const renderedGlobal = gwid >= 340 || wg.coverage_scope === 'global' || wg.coverage_scope === 'global_coarse';
      const vb = mapInstance.getBounds();
      const vwid = (vb.getEast() < vb.getWest()) ? (vb.getEast() + 360) - vb.getWest() : vb.getEast() - vb.getWest();
      gridMismatch = renderedGlobal && mapInstance.getZoom() > 6.5 && vwid < 15 && (vb.getNorth() - vb.getSouth()) < 15;
    }
  } catch (e) { /* map not ready */ }

  // gridMismatch: commit the regional series frame to sharpen INSTEAD of a /grid fetch (the marine
  // controller cache serves the coarse global for the contained viewport, so a refetch is a no-op
  // loop). If the regional frame isn't ready yet, defer (the warming kick is loading it).
  if (gridMismatch) {
    try {
      const vb = mapInstance.getBounds();
      const frame = getMarineSeriesFrame(activeModelRef.current, activeMarineLayerRef.current || 'waves',
        { west: vb.getWest(), south: vb.getSouth(), east: vb.getEast(), north: vb.getNorth() }, currentHour);
      const fb = frame && frame.grid && frame.grid.bounds;
      const fw = fb ? ((fb.east < fb.west) ? (fb.east + 360) - fb.west : fb.east - fb.west) : 999;
      if (frame && fw < 340 && setMarineData) {
        if (typeof window !== 'undefined') window.__MARINE_GRIDMISMATCH_COUNT__ = (window.__MARINE_GRIDMISMATCH_COUNT__ || 0) + 1;
        console.log('[SCRUB-SETTLE] Sharpening coarse-global grid: committing regional series frame.');
        setMarineData(frame);
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

  const checkScrubSettle = useCallback(() => {
    runScrubSettleCheck({
      marineData, mapInstance, setMarineData,
      timeOffsetRef, activeModelRef, activeMarineLayerRef,
      safetyNetRetryRef, marineFetchLocksRef, updateMarineGridRef,
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
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('timeline_scrub_end', handleScrubEnd);
      clearTimeout(scrubSettleTimerRef.current);
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
      const wg = eng && eng._waveData && eng._waveData.waveGrid;
      // Also re-drive when a COARSE GLOBAL grid is held while zoomed IN (zoom-in fires no scrub-end).
      let coarseAtZoom = false;
      if (wg && wg.bounds) {
        const gwid = (wg.bounds.east < wg.bounds.west) ? (wg.bounds.east + 360) - wg.bounds.west : wg.bounds.east - wg.bounds.west;
        const renderedGlobal = gwid >= 340 || wg.coverage_scope === 'global' || wg.coverage_scope === 'global_coarse';
        try {
          const vb = mapInstance.getBounds();
          const vwid = (vb.getEast() < vb.getWest()) ? (vb.getEast() + 360) - vb.getWest() : vb.getEast() - vb.getWest();
          coarseAtZoom = renderedGlobal && mapInstance.getZoom() > 6.5 && vwid < 15 && (vb.getNorth() - vb.getSouth()) < 15;
        } catch (e) { /* ignore */ }
      }
      const needsRefetch = (!(eng && eng._waveData) || coarseAtZoom) && !window.__MARINE_FETCH_PENDING__ && govIdle;
      if (!needsRefetch) { blankStreak = 0; return; }
      blankStreak++;
      if (blankStreak < 3) return;                   // require ~3s sustained (ignores the brief load gap)
      if (Date.now() - lastBackstop < 6000) return;  // min gap so each refetch can complete
      lastBackstop = Date.now();
      blankStreak = 0;
      if (typeof window !== 'undefined') window.__MARINE_BLANK_BACKSTOP_COUNT__ = (window.__MARINE_BLANK_BACKSTOP_COUNT__ || 0) + 1;
      console.warn(`[Marine] Render backstop: ${coarseAtZoom ? 'coarse-global grid at zoomed-in viewport' : 'engine empty'} + idle ≥3s — re-driving fetch.`);
      if (checkScrubSettleRef.current) checkScrubSettleRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [mapInstance]);
}
