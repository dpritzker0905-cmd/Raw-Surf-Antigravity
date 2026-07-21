import { useEffect } from 'react';
import { getMarineHourlyCache, extractMarineAtOffset, getModelSafeMarine } from './marineController';
import { getBackendCopernicusFlag, getBackendWeatherFlag, getBackendIconMarineFlag, getSharedValidTime } from './backendWeatherServiceClient';
import { findClosestHourIndex } from './marineControllerUtils';
import { computeGridContentHash } from './marineGridHash';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import { getMarineSeriesFrame } from './marineGridSeries';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';
import { marineWarmCommitCovers } from './marineWarmCoverage';
import { DISPLAY_ICON_MAX_HOURS, DISPLAY_EURO_WAVES_MAX_HOURS, DISPLAY_EURO_COMPONENT_MAX_HOURS } from './useMarineDataFetcherHelpers';

let _lastMarineScrubLogTime = 0;

export function useMarineOrchestratorScrubCache({
  timeOffsetHours,
  mapInstance,
  activeMarineLayersRef,
  prevTimeOffsetRef,
  timeOffsetRef,
  activeModelRef,
  activeMarineLayerRef,
  lastCommittedSigRef,
  marineRevision,
  marineFetchLocksRef,
  setMarineData,
  logPipelineEventHelper,
  getViewportHash,
  updateMarineGridRef,
  enqueueMarineUpdate
}) {
  useEffect(() => {
    const prev = prevTimeOffsetRef.current; prevTimeOffsetRef.current = timeOffsetHours;
    timeOffsetRef.current = timeOffsetHours;
    if (prev === timeOffsetHours) return;
    if (!mapInstance || !activeMarineLayersRef.current) return;

    let selectedApiTimestamp = 'none';
    let selectedIndex = -1;
    let cacheStartStr = 'none';
    let cacheEndStr = 'none';
    let cacheForecastDays = 0;
    let coverageRejected = false;
    let extractedGrid = null;
    let curModel = activeModelRef.current || 'GFS';
    let curLayer = activeMarineLayerRef.current || 'waves';
    // EURO display max (336h incl. estimates) — mirror the fetcher so EURO keeps its identity
    // through the estimate window and only falls back to GFS past 336h.
    const euroMax = curLayer === 'waves' ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;

    // Deferred-1: mirror the fetcher's model resolution EXACTLY so this scrub cache lookup keys
    // on the model actually fetched. ICON keeps its extended window (168→336h) when the backend
    // ICON flag is on; only fall back to GFS when ICON is unsupported (>168h && flag off) or out
    // of range (>336h). Was: unconditional ICON→GFS at >168h (ICON-extended never cache-hit).
    if (curModel === 'ICON' && timeOffsetHours > 168 && !getBackendIconMarineFlag()) {
      curModel = 'GFS';
    } else if (curModel === 'ICON' && timeOffsetHours > DISPLAY_ICON_MAX_HOURS) {
      curModel = 'GFS';
    } else if (curModel === 'EURO' && timeOffsetHours > euroMax) {
      curModel = 'GFS';
    }

    const isGfsBackend = getBackendWeatherFlag() && (curModel === 'GFS' || !curModel);
    const isIconBackend = getBackendIconMarineFlag() && curModel === 'ICON';
    const isCopernicusBackend = getBackendCopernicusFlag() && curModel === 'EURO';
    const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

    let vpBounds = null;
    try {
      const b = mapInstance.getBounds();
      vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    } catch (e) {
      vpBounds = null;
    }

    if (isBackendActive) {
      let cachedBackendData = getModelSafeMarine(curModel, timeOffsetHours, curLayer, vpBounds);
      // The series frame is the EXACT scrubbed hour (±1.5h snap). getModelSafeMarine can return a
      // NEAREST/stale-hour fallback (flagged __staleHour) which the commit below intentionally
      // SKIPS — leaving the heatmap stuck one step behind the slider during scrub. Prefer the
      // exact-hour series frame over that stale fallback so the heatmap snaps to each hour.
      if (!cachedBackendData || cachedBackendData.__staleHour) {
        const seriesFrame = getMarineSeriesFrame(curModel, curLayer, vpBounds, timeOffsetHours);
        if (seriesFrame) cachedBackendData = seriesFrame;
      }
      
      let isRegional = false;
      let isViewportZoomedOut = false;
      const currentZoom = mapInstance.getZoom();
      let vpWidth = 0;
      let vpHeight = 0;
      if (vpBounds) {
        const ew = vpBounds.east, ew_w = vpBounds.west;
        vpWidth = (ew < ew_w) ? (ew + 360) - ew_w : ew - ew_w;
        vpHeight = Math.abs(vpBounds.north - vpBounds.south);
      }
      isViewportZoomedOut = (currentZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM) || (vpWidth > 15.0 || vpHeight > 15.0);

      let isGridWidthRegional = false;
      let isContained = true;

      if (cachedBackendData) {
        const prodId = cachedBackendData.product_id || cachedBackendData.productId;
        const regionId = cachedBackendData.region_id || cachedBackendData.regionId || cachedBackendData.grid?.region_id || cachedBackendData.grid?.regionId;
        const coverageMode = cachedBackendData.coverage_mode || cachedBackendData.coverageMode || cachedBackendData.grid?.coverage_mode || cachedBackendData.grid?.coverageMode;
        const isDynamic = !!(cachedBackendData.is_dynamic_viewport_product || cachedBackendData.isDynamicViewportProduct || cachedBackendData.grid?.is_dynamic_viewport_product || cachedBackendData.grid?.isDynamicViewportProduct);

        const actualBounds = cachedBackendData.grid?.bounds || cachedBackendData.bounds;
        if (actualBounds) {
          const gw = actualBounds.west, ge = actualBounds.east, gs = actualBounds.south, gn = actualBounds.north;
          const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
          isGridWidthRegional = gridWidth < 340.0;

          if (isGridWidthRegional && vpBounds) {
            const ew = vpBounds.west, ee = vpBounds.east, es = vpBounds.south, en = vpBounds.north;
            let vWest = ew;
            let vEast = ee;
            if (vEast < vWest) vEast += 360;
            let gWest = gw;
            let gEast = ge;
            if (gEast < gWest) gEast += 360;
            isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
          }
        }

        isRegional = prodId && (
          prodId.includes('florida_east_coast') ||
          coverageMode === 'regional_tile' ||
          (regionId && regionId !== 'global_coarse' && !isDynamic) ||
          (isDynamic && (!isContained || isViewportZoomedOut) && isGridWidthRegional)
        );
      }

      // Legacy reject (verbatim): a regional / non-contained grid is rejected when zoomed OUT so a
      // clamped tile isn't served for a wide view.
      const legacyReject = isViewportZoomedOut && (isRegional || (isGridWidthRegional && !isContained));
      // #10 warm-commit coverage guard: ALSO reject a width-regional grid that does NOT cover the
      // current viewport while zoomed IN — otherwise a cached regional tile for another region paints
      // a floating rectangle here (the render's regional cull only fires zoomed out). Mirrors
      // regionalValidInPlace (useMarineOrchestrator.js:556). Kill: __RAW_DISABLE_MARINE_WARM_COVERAGE__.
      const warmCoverGuardOff = typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_WARM_COVERAGE__ === true;
      const zoomedInNonCovering = !warmCoverGuardOff && !isViewportZoomedOut &&
        !marineWarmCommitCovers(cachedBackendData, vpBounds);
      const rejectRegionalCache = legacyReject || zoomedInNonCovering;

      // Live A/B tripwire: count only the NEW rejections (would have committed under the legacy
      // formula) so a floating-rectangle repro shows a clean before/after via the kill switch.
      if (zoomedInNonCovering && !legacyReject && typeof window !== 'undefined') {
        const t = window.__MARINE_WARM_COVER_REJECT__ || { count: 0 };
        t.count += 1;
        t.last = { hour: timeOffsetHours, model: curModel, layer: curLayer,
          gridBounds: cachedBackendData.grid?.bounds || cachedBackendData.bounds || null, vpBounds };
        window.__MARINE_WARM_COVER_REJECT__ = t;
      }

      if (cachedBackendData && cachedBackendData.grid && !cachedBackendData.__staleHour && !rejectRegionalCache) {
        extractedGrid = cachedBackendData.grid;
        const sig = _marineDataSignature(cachedBackendData, curLayer);
        if (sig && sig !== lastCommittedSigRef.current) {
          const evtType = cachedBackendData.grid?.__renderable ? 'local_cache_remap_timeline' : 'local_cache_remap_timeline_no_data';
          const _now = Date.now();
          if (_now - _lastMarineScrubLogTime > 2000) {
            _lastMarineScrubLogTime = _now;
            console.log(`[SCRUB] [BACKEND CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
          }
          lastCommittedSigRef.current = sig;
          logPipelineEventHelper(evtType, { model: curModel, layer: curLayer, hour: timeOffsetHours, renderable: cachedBackendData.grid?.__renderable });
          marineRevision.current += 1;
          cachedBackendData.__commitRevision = marineRevision.current;

          const vHash = getViewportHash();
          if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }
          if (typeof window !== 'undefined' && curModel === 'GFS' && curLayer === 'waves' && timeOffsetHours === 0) {
            window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
            window.__GFS_WAVES_SINGLE_SLICE_TRACE__.cacheCommit = {
              committedProductId: cachedBackendData.grid?.productId || cachedBackendData.productId || null,
              committedValidTime: cachedBackendData.grid?.validTime || cachedBackendData.validTime || (typeof getSharedValidTime === 'function' ? getSharedValidTime(0, 'waves', 'GFS') : null),
              committedBounds: cachedBackendData.grid?.bounds || cachedBackendData.bounds || null,
              cacheKey: vHash,
              cacheSource: 'backend_cache_scrub',
              didRejectStaleRegional: true,
              didClearPreviousRegionalBeforeViewport: true,
              commitRevision: marineRevision.current,
              timeOffsetHours: timeOffsetHours
            };
            if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
              window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
            }
          }
          setMarineData(cachedBackendData);
        }

        if (!window.isScrubbingTimeline) {
          const sampleIndices = [0, 5, 10, 20, 50, 100, 200, 300, 400, 500];
          const samples = sampleIndices.map(idx => {
            const v = extractedGrid?.vectors?.[idx];
            const comp = v?.[curLayer] || v;
            return comp ? { idx, speed: comp.speed || 0, u: comp.u || 0, v: comp.v || 0, period: comp.period || 0 } : { idx, speed: 0, u: 0, v: 0, period: 0 };
          });

          window.__MARINE_SCRUB_DIAG__ = {
            requestedHour: timeOffsetHours,
            targetMs: Date.now() + timeOffsetHours * 3600000,
            selectedApiTimestamp: 'none',
            selectedIndex: -1,
            cacheCoverageStart: 'none',
            cacheCoverageEnd: 'none',
            forecastDays: 1,
            contentHash: computeGridContentHash(extractedGrid, curLayer),
            samples,
            coverageRejected: false,
            timestamp: new Date().toISOString()
          };
        }
        return;
      } else {
        if (typeof window !== 'undefined' && window.__SCRUB_DEBUG__) {
          console.log(`[SCRUB] [BACKEND CACHE] Miss: +${timeOffsetHours}h model=${curModel} layer=${curLayer}. Retaining stale view while fetching.`);
        }
        marineFetchLocksRef.current.lastHash = null;
        if (!window.isScrubbingTimeline) {
          enqueueMarineUpdate('timeline_scrub_deferred');
        }
        return;
      }
    } else {
      const cache = getMarineHourlyCache();
      if (cache?.results?.length && cache.model === curModel && (curModel !== 'EURO' || (cache.activeLayer || 'waves') === curLayer)) {
        const timeArray = cache.results[0]?.hourly?.time;
        const targetMs = Date.now() + timeOffsetHours * 3600000;
        const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
        selectedIndex = idx;
        if (timeArray?.[idx]) {
          selectedApiTimestamp = timeArray[idx];
          const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
          const delta = Math.abs(cachedMs - targetMs);
          if (delta > 3 * 3600000) {
            coverageRejected = true;
          }
        }
        cacheForecastDays = cache.__forecastDays || 0;
        if (cache.__coverageStartMs) cacheStartStr = new Date(cache.__coverageStartMs).toISOString();
        if (cache.__coverageEndMs) cacheEndStr = new Date(cache.__coverageEndMs).toISOString();
      }

      try {
        if (cache?.results?.length && cache.model === curModel && (curModel !== 'EURO' || (cache.activeLayer || 'waves') === curLayer) && !coverageRejected) {
          const data = extractMarineAtOffset(cache, timeOffsetHours, curLayer);
          if (data) {
            extractedGrid = data.grid;
            const sig = _marineDataSignature(data, curLayer);
            if (sig && sig !== lastCommittedSigRef.current) {
              const evtType = data.grid?.__renderable ? 'local_cache_remap_timeline' : 'local_cache_remap_timeline_no_data';
              const _now2 = Date.now();
              if (_now2 - _lastMarineScrubLogTime > 2000) {
                _lastMarineScrubLogTime = _now2;
                console.log(`[SCRUB] [CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
              }
              lastCommittedSigRef.current = sig; logPipelineEventHelper(evtType, { model: curModel, layer: curLayer, hour: timeOffsetHours, renderable: data.grid?.__renderable });
              marineRevision.current += 1; data.__commitRevision = marineRevision.current;
              
              const vHash = getViewportHash();
              if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }
              setMarineData(data);
            }
            
            if (!window.isScrubbingTimeline) {
              const sampleIndices = [0, 5, 10, 20, 50, 100, 200, 300, 400, 500];
              const samples = sampleIndices.map(idx => {
                const v = extractedGrid?.vectors?.[idx];
                const comp = v?.[curLayer] || v;
                return comp ? { idx, speed: comp.speed || 0, u: comp.u || 0, v: comp.v || 0, period: comp.period || 0 } : { idx, speed: 0, u: 0, v: 0, period: 0 };
              });

              window.__MARINE_SCRUB_DIAG__ = {
                requestedHour: timeOffsetHours,
                targetMs: Date.now() + timeOffsetHours * 3600000,
                selectedApiTimestamp,
                selectedIndex,
                cacheCoverageStart: cacheStartStr,
                cacheCoverageEnd: cacheEndStr,
                forecastDays: cacheForecastDays,
                contentHash: computeGridContentHash(extractedGrid, curLayer),
                samples,
                coverageRejected,
                timestamp: new Date().toISOString()
              };
            }
            return;
          }
        }
      } catch (e) { console.warn('[CACHE] Local timeline re-index failed:', e.message); }
    }

    if (coverageRejected) {
      let renderedHour = timeOffsetHours;
      const cache = getMarineHourlyCache();
      if (cache?.results?.[0]?.hourly?.time) {
        const timeArray = cache.results[0].hourly.time;
        if (timeArray[selectedIndex]) {
          const closestTimeMs = new Date(timeArray[selectedIndex].endsWith('Z') ? timeArray[selectedIndex] : timeArray[selectedIndex] + 'Z').getTime();
          renderedHour = Math.round((closestTimeMs - Date.now()) / 3600000);
        }
      }
      const statusVal = isBackendActive
        ? (curModel === 'EURO' ? 'no_copernicus_coverage' : 'no_backend_coverage')
        : 'retained_previous_hour_warning';
      window.__MARINE_HEATMAP_STATUS__ = {
        status: statusVal,
        requestedHour: timeOffsetHours,
        renderedHour: renderedHour,
        coverageRejected: true,
        retainedPrevious: true,
        blockedReason: 'cache_coverage_exceeded'
      };
    } else {
      if (window.__MARINE_HEATMAP_STATUS__?.status === 'retained_previous_hour_warning' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_copernicus_coverage' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_backend_coverage') {
        window.__MARINE_HEATMAP_STATUS__ = null;
      }
    }

    if (!window.isScrubbingTimeline) {
      window.__MARINE_SCRUB_DIAG__ = {
        requestedHour: timeOffsetHours,
        targetMs: Date.now() + timeOffsetHours * 3600000,
        selectedApiTimestamp,
        selectedIndex,
        cacheCoverageStart: cacheStartStr,
        cacheCoverageEnd: cacheEndStr,
        forecastDays: cacheForecastDays,
        contentHash: 0,
        samples: [],
        coverageRejected,
        timestamp: new Date().toISOString()
      };
    }

    const _now3 = Date.now();
    if (_now3 - _lastMarineScrubLogTime > 2000) {
      _lastMarineScrubLogTime = _now3;
      console.log(`[CACHE] [Marine] Cache miss for hour +${timeOffsetHours}h. Suppressing network fetch while scrubbing; safety net will fetch on settle.`);
    }
    marineFetchLocksRef.current.lastHash = null;
    if (!window.isScrubbingTimeline) {
      if (updateMarineGridRef.current) {
        updateMarineGridRef.current('timeline_scrub');
      }
    }
  }, [timeOffsetHours, mapInstance]);
}
