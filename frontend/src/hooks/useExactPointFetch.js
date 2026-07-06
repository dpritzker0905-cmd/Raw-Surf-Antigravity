import { useState, useEffect, useRef, useMemo } from 'react';
import {
  fetchExactMarinePoint,
  selectExactPointHour,
  hasCacheForModel,
  getCachedPointResponse,
  updateDeprecationDiag,
  writeOverlayDiagnostics
} from '../components/map/forecastSamplers';
import { isInCooldown, clearCooldown } from '../components/map/marineControllerUtils';

// EXACT-POINT FETCH BUDGET (2026-07-06): the shared 12s abort guaranteed a first-look "Timeout"
// on EURO — a COLD native CMEMS point measured 17s live (GFS 0.9s / ICON 2.5s), so every first
// EURO marker lookup died at 12s, and only a retry (hitting the by-then-warm server cache)
// could save it. Give Copernicus its realistic cold budget; fast models keep the interactive 12s.
// Levers: __RAW_EXACT_POINT_TIMEOUT_MS__ (non-EURO), __RAW_EXACT_POINT_EURO_TIMEOUT_MS__.
export function resolveExactPointTimeoutMs(model, win) {
  const w = win || {};
  const isEuro = model === 'EURO';
  const lever = Number(isEuro ? w.__RAW_EXACT_POINT_EURO_TIMEOUT_MS__ : w.__RAW_EXACT_POINT_TIMEOUT_MS__);
  if (isFinite(lever) && lever >= 1000) return lever;
  return isEuro ? 25000 : 12000;
}

export function useExactPointFetch({
  pointLat,
  pointLng,
  isExactPointRequired,
  activeModel,
  activeLayer,
  settledOffset,
  selectedSpot,
  longPressLocation,
  isScrubbing,
  isPlaying = false,
  timeOffsetHours,
  marineData
}) {
  const [exactPointResponse, setExactPointResponse] = useState(null);
  const [exactPointStatus, setExactPointStatus] = useState('idle');
  const [estimateTrigger, setEstimateTrigger] = useState(0);
  const exactPointFetchRef = useRef(null);
  const prevLayerRef = useRef(activeLayer);
  const prevModelRef = useRef(activeModel);

  const isEuroComponentLayer = activeModel === 'EURO' && ['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer);

  // Decoupled refs to prevent high-frequency grid updates and timeline scrubbing from triggering redundant fetches
  const marineDataRef = useRef(marineData);
  useEffect(() => {
    marineDataRef.current = marineData;
  }, [marineData]);

  // snapping key — Includes settledOffset to support backend redirect responses (which only return
  // a single valid time). Since settledOffset changes only when scrubbing finishes or direct timeline
  // click occurs, this prevents network queue saturation during scrubbing while ensuring correct data parity.
  const currentPointKey = `${pointLat ?? ''}_${pointLng ?? ''}_${activeModel}_${activeLayer}_hr${settledOffset}`;
  const [renderedPointKey, setRenderedPointKey] = useState(currentPointKey);
  const fetchGenRef = useRef(0);

  // Auto-retry on a wedged failure (exact_timeout / backend_error) so the infobox doesn't get stuck
  // "Loading…→Timeout" under rapid model/layer switching or a cold/slow backend (handoff §4.1). Bumping
  // retryNonce re-runs the fetch effect; retryCountRef caps attempts PER point-key (reset when the key
  // changes below, or on success). This is the "force one fresh fetch on settle, don't leave a wedged
  // timeout" fix — the prior code aborted in-flight fetches and never re-fired.
  const [retryNonce, setRetryNonce] = useState(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);
  const MAX_EXACT_RETRIES = 2;

  // Synchronous state reset during render phase (Derived State pattern)
  let localResponse = exactPointResponse;
  let localStatus = exactPointStatus;

  if (currentPointKey !== renderedPointKey) {
    setRenderedPointKey(currentPointKey);
    retryCountRef.current = 0;   // new point/model/layer/hour -> reset the retry budget
    const cachedData = getCachedPointResponse(pointLat, pointLng, activeModel, activeLayer, settledOffset);
    if (cachedData) {
      setExactPointResponse(cachedData);
      const selected = selectExactPointHour(cachedData, timeOffsetHours);
      const nextStatus = selected ? 'exact_success' : 'exact_loading';
      setExactPointStatus(nextStatus);

      localResponse = cachedData;
      localStatus = nextStatus;
    } else {
      setExactPointResponse(null);
      const nextStatus = pointLat && pointLng && isExactPointRequired ? 'exact_loading' : 'idle';
      setExactPointStatus(nextStatus);

      localResponse = null;
      localStatus = nextStatus;
    }
  }

  const isStale = (currentPointKey !== renderedPointKey) && !getCachedPointResponse(pointLat, pointLng, activeModel, activeLayer, settledOffset);

  const effectiveExactPointResponse = isStale ? null : localResponse;
  
  const effectiveExactPoint = useMemo(() => {
    if (!effectiveExactPointResponse) return null;
    return selectExactPointHour(effectiveExactPointResponse, timeOffsetHours);
  }, [effectiveExactPointResponse, timeOffsetHours]);

  const effectiveExactPointStatus = (() => {
    if (isStale) {
      return (pointLat && pointLng && isExactPointRequired ? 'exact_stale_rejected' : 'idle');
    }
    if (localStatus === 'exact_success' && effectiveExactPoint?.status) {
      return effectiveExactPoint.status;
    }
    return localStatus;
  })();

  useEffect(() => {
    const isLayerSwitch = prevLayerRef.current !== activeLayer;
    prevLayerRef.current = activeLayer;
    const isModelSwitch = prevModelRef.current !== activeModel;
    prevModelRef.current = activeModel;

    if (!pointLat || !pointLng || !isExactPointRequired) {
      setExactPointResponse(null);
      setExactPointStatus('idle');
      return;
    }

    const isUserExplicitSelection = !!(selectedSpot || longPressLocation);
    const hasGrid = marineDataRef.current?.grid?.vectors?.length > 0;

    const isMapBooted = typeof window !== 'undefined' && window.__MAP_BOOTSTRAPPED__ === true;
    const domain = (activeLayer === 'wind') ? 'wind' : (activeLayer === 'pressure') ? 'pressure' : 'marine';
    const isDomainCooldownActive = typeof isInCooldown === 'function' && isInCooldown(domain);

    if (!isMapBooted || isScrubbing || isPlaying || isDomainCooldownActive) {
      const isCached = hasCacheForModel(pointLat, pointLng, activeModel, activeLayer, settledOffset);
      if (!isCached) {
        console.log(`[Forecast Overlay] Suppressing exact-point fetch: booted=${isMapBooted} scrubbing=${isScrubbing} playing=${isPlaying} cooldown=${isDomainCooldownActive}`);
        // Do not clear the exactPointResponse or exactPoint state to prevent visual flickering.
        // Keeping the old hour offset values is safe since MapForecastOverlay will see the hour mismatch
        // and fall back to the correct grid values in-memory.
        setExactPointStatus(isDomainCooldownActive ? 'rate_limited' : 'idle');
        return;
      }
    }

    if (!isUserExplicitSelection && !hasGrid) {
      setExactPointResponse(null);
      setExactPointStatus('idle');
      return;
    }

    if (!isUserExplicitSelection && typeof isInCooldown === 'function' && isInCooldown('marine')) {
      console.log("[Forecast] Suppressing background snap prewarm because marine fetch is cooling down/failing");
      setExactPointResponse(null);
      setExactPointStatus('idle');
      return;
    }

    const isCooling = typeof isInCooldown === 'function' && isInCooldown('marine');
    const isCached = hasCacheForModel(pointLat, pointLng, activeModel, activeLayer, settledOffset);

    if (isCooling && !isCached) {
      console.log("[Forecast] Suppressing exact-point fetch because marine is cooling down and no cache is available.");
      setExactPointResponse(null);
      setExactPointStatus('rate_limited');
      return;
    }

    setExactPointResponse(null);
    setExactPointStatus('exact_loading');

    if (exactPointFetchRef.current) exactPointFetchRef.current.cancelled = true;
    const gen = ++fetchGenRef.current;
    const token = { cancelled: false };
    exactPointFetchRef.current = token;

    const controller = new AbortController();
    // Switch/explicit selection: 250ms (trimmed from 400ms 2026-06-26 so the infobox starts
    // loading sooner on a model/layer switch). Still long enough that rapid model cycling cancels
    // intermediate timers — each new switch clears the prior one (token.cancelled + clearTimeout) —
    // and cooldown (isInCooldown) guards against saturation. The non-switch path — most importantly
    // the post-scrub SETTLED-hour change — was 3000ms, which left the precise (esp. slow
    // EURO/Copernicus) point not even starting to fetch for 3s after the user stopped scrubbing;
    // trimmed to 1200ms so exact data loads sooner.
    const debounceTime = (isUserExplicitSelection || isLayerSwitch || isModelSwitch) ? 250 : 1200;

    const timeoutId = setTimeout(() => {
      if (token.cancelled || gen !== fetchGenRef.current) return;

      // Model-aware budget (2026-07-06, was a flat 12s): 12s stays for the fast models (GFS 0.9s /
      // ICON 2.5s live) — interactive, flips to grid fallback rather than hanging. EURO gets 25s:
      // a COLD native CMEMS point measured 17s live, so the flat 12s aborted every first EURO
      // lookup into "Timeout" (the user's stuck-loading-then-timeout report). The overlay shows
      // grid-fallback values while it waits, so the longer EURO budget is loading-truthful.
      const fetchTimeoutId = setTimeout(() => {
        controller.abort();
      }, resolveExactPointTimeoutMs(activeModel, typeof window !== 'undefined' ? window : null));

      const grid = marineDataRef.current?.grid;
      const gridProductId = grid?.productId || grid?.product_id || null;
      let gridBbox = null;
      if (grid?.bounds) {
        const b = grid.bounds;
        gridBbox = `${b.west},${b.south},${b.east},${b.north}`;
      }

      // On a retryable failure, keep the infobox "Loading…" and force one fresh fetch shortly instead of
      // wedging on a terminal status — this is the core fix for the rapid-switch / cold-backend hang.
      const failAttempt = (terminalStatus) => {
        if (retryCountRef.current < MAX_EXACT_RETRIES) {
          retryCountRef.current += 1;
          setExactPointStatus('exact_loading');
          retryTimerRef.current = setTimeout(() => {
            if (!token.cancelled && gen === fetchGenRef.current) setRetryNonce(n => n + 1);
          }, 1200);
        } else {
          setExactPointStatus(terminalStatus);
        }
      };

      fetchExactMarinePoint(
        pointLat,
        pointLng,
        activeModel,
        activeLayer,
        controller.signal,
        settledOffset,
        false,
        gridProductId,
        gridBbox
      ).then(data => {
        clearTimeout(fetchTimeoutId);
        if (!token.cancelled && gen === fetchGenRef.current) {
          if (data) {
            if (data.status === 'timeout') {
              failAttempt('exact_timeout');
            } else if (data.status === 'error') {
              failAttempt('exact_backend_error');
            } else if (data.status === 'empty') {
              setExactPointStatus('exact_empty');
            } else if (['copernicus_credentials_missing', 'copernicus_backend_502', 'copernicus_timeout', 'rate_limited'].includes(data.status)) {
              setExactPointStatus(data.status);
            } else {
              setExactPointResponse(data);
              setExactPointStatus('exact_success');
              retryCountRef.current = 0;   // success -> reset budget for this point-key
              if (typeof clearCooldown === 'function') {
                const domain = (activeLayer === 'wind') ? 'wind' : (activeLayer === 'pressure') ? 'pressure' : 'marine';
                clearCooldown(domain);
              }
            }
          } else {
            failAttempt('exact_backend_error');
          }
        }
      }).catch(err => {
        clearTimeout(fetchTimeoutId);
        if (!token.cancelled && gen === fetchGenRef.current) {
          if (err.name === 'AbortError') {
            failAttempt('exact_timeout');
          } else {
            failAttempt('exact_backend_error');
          }
        }
      });
    }, debounceTime);

    return () => {
      token.cancelled = true;
      clearTimeout(timeoutId);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      controller.abort();
    };
  }, [pointLat, pointLng, activeModel, activeLayer, isScrubbing, isPlaying, settledOffset, isExactPointRequired, selectedSpot, longPressLocation, retryNonce]);

  useEffect(() => {
    if (!effectiveExactPointResponse) {
      return;
    }
    const selected = selectExactPointHour(effectiveExactPointResponse, timeOffsetHours);

    if (selected) {
      const targetTs = Date.now() + (timeOffsetHours || 0) * 3600000;
      const targetTimestamp = new Date(targetTs).toISOString();
      const selectedTimestamp = selected.time;
      const selectedHourIndex = selected.hourIndex;
      const provider = selected.provider;
      const returnedTimeRange = `${selected.timeRangeStart} to ${selected.timeRangeEnd}`;
      
      let sourceStr = 'exact_point_api';
      if (selected.status === 'exact_no_time_coverage') {
        sourceStr = 'no_coverage';
      } else if (selected.status === 'estimate_pending_sources') {
        sourceStr = 'estimate_pending_sources';
      }

      /*
      console.log(
        `%c[FORECAST SCRUBUB SCRUBBER TRUTH] InfoBox Sync:\n` +
        `  - activeModel: ${activeModel}\n` +
        `  - activeLayer: ${activeLayer}\n` +
        `  - marker lat/lng: ${pointLat?.toFixed(4)}, ${pointLng?.toFixed(4)}\n` +
        `  - timeOffsetHours: ${timeOffsetHours}\n` +
        `  - targetTimestamp: ${targetTimestamp}\n` +
        `  - selectedTimestamp: ${selectedTimestamp}\n` +
        `  - selectedHourIndex: ${selectedHourIndex}\n` +
        `  - provider: ${provider}\n` +
        `  - returned time range: ${returnedTimeRange}\n` +
        `  - source: ${sourceStr}`,
        'color: #22c55e; font-weight: bold;'
      );
      */

      if (typeof window !== 'undefined') {
        window.__MARINE_POINT_DIAG__ = {
          point: { lat: pointLat, lng: pointLng },
          activeModel, activeLayer, timeOffsetHours,
          targetTimestamp,
          requestedForecastDays: effectiveExactPointResponse.forecastDays,
          returnedTimeRange: {
            start: selected.timeRangeStart,
            end: selected.timeRangeEnd
          },
          selectedHourIndex: selected.hourIndex,
          selectedTimestamp: selected.time,
          matchDiffMs: selected.matchDiffMs,
          exactPointValues: {
            wave_height: selected.wave_height,
            wave_direction: selected.wave_direction,
            wave_period: selected.wave_period,
            swell_wave_height: selected.swell_wave_height,
            swell_wave_direction: selected.swell_wave_direction,
            swell_wave_period: selected.swell_wave_period,
            secondary_swell_wave_height: selected.secondary_swell_wave_height,
            secondary_swell_wave_direction: selected.secondary_swell_wave_direction,
            secondary_swell_wave_period: selected.secondary_swell_wave_period,
            wind_wave_height: selected.wind_wave_height,
            wind_wave_direction: selected.wind_wave_direction,
            wind_wave_period: selected.wind_wave_period,
          },
          source: sourceStr,
          timestamp: new Date().toISOString()
        };
      }
    }
  }, [effectiveExactPointResponse, timeOffsetHours, activeLayer, activeModel, pointLat, pointLng, estimateTrigger]);

  return {
    exactPoint: effectiveExactPoint,
    exactPointStatus: effectiveExactPointStatus,
    exactPointResponse: effectiveExactPointResponse,
    setExactPointStatus,
    setExactPointResponse,
    setEstimateTrigger
  };
}
