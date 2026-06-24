import { useCallback } from 'react';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getSharedValidTime, getBackendIconMarineFlag, getBackendWeatherFlag } from './backendWeatherServiceClient';
import { updateDeprecationDiag } from './forecastSamplers';
import { isInCooldown, clearCooldown } from './marineControllerUtils';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
  checkShouldClearRegionalGrid,
  buildIconFallbackGrid,
  buildEuroFallbackGrid,
  buildCopernicusEmptyGrid,
  getAbortRecoveryGrid,
  handleRegionalGridClearing,
  handleCooldownFallback,
  commitMarineData
} from './useMarineDataFetcherHelpers';
import { getTarget, endTransition, recordChurn } from './marineTransitionCoordinator';

/**
 * Release an abandoned in-flight marine fetch when a newer request supersedes it.
 *
 * Phase 2c (OOM rework): during ACTIVE timeline scrubbing we ABORT the abandoned fetch —
 * closing the socket so the backend's disconnect-detection cancels the remaining per-hour
 * upstream work instead of running it to completion. Under a scrub storm there's no
 * switch-back benefit to detaching, only a pile-up of open connections + backend memory.
 * For model/layer switches we keep DETACHing so the abandoned fetch self-caches (a
 * switch-back becomes a cache hit). The aborted fetch's finally -> inFlight.complete(...,
 * 'abort') removes its registry entry, so no extra bookkeeping is needed here.
 */
function releaseAbandonedFetch(inFlight, controller, site, activeSource, source) {
  if (!controller || !controller.__intent) return;
  const scrubbing = typeof window !== 'undefined' && window.isScrubbingTimeline;
  if (scrubbing) {
    recordChurn('scrub_abort', { site, from: activeSource, to: source });
    try { controller.abort(); } catch (e) { /* ignore */ }
    return;
  }
  recordChurn('detach', { site, from: activeSource, to: source });
  inFlight.detach(controller.__intent);
}

// Max time a marine fetch may legitimately hold the isFetching lock. A real fetch (even slow on
// the 1-CPU backend) registers in the governor within ms and resolves well under this; only a
// STRANDED lock outlives it with the governor idle.
export const MARINE_FETCH_LEASE_MS = 8000;

/**
 * Stale-lock watchdog. A superseded marine fetch can strand locks.isFetching=true +
 * __MARINE_FETCH_PENDING__/__MARINE_FETCH_DEBOUNCING__ when its finally skips cleanup (the
 * `requestId === marineRequestIdRef.current` guard fails because a newer fetch bumped the id).
 * The same-target dedup below then trusts the dead-but-not-aborted abortControllerRef and skips
 * EVERY recovery fetch → the heatmap wedges blank forever until a scrub/pan releases the lock
 * (the "sometimes the heatmap won't load / won't track the scrub" + "clears after toggling" churn,
 * reproduced live on dev). This releases the lock ONLY when it's provably dead — held past the
 * lease AND the governor shows no active marine fetch (so we never abort a real slow request) —
 * letting the caller fall through to a fresh fetch. Returns true if it healed a stranded lock.
 */
export function releaseStaleMarineLock(locks, abortControllerRef) {
  if (!locks || !locks.isFetching) return false;
  const startedAt = locks.fetchStartedAt || 0;
  if (!startedAt || Date.now() - startedAt <= MARINE_FETCH_LEASE_MS) return false;
  let govIdle = true;
  try {
    const gov = (typeof window !== 'undefined') && window.__MARINE_GOVERNOR_STATE__;
    if (gov) {
      govIdle = !gov.activeGridFetches && !gov.activeCopernicusFetches &&
                !(gov.inFlightKeys && gov.inFlightKeys.length);
    }
  } catch (e) { govIdle = true; }
  if (!govIdle) return false; // a real fetch is running — never abort it
  try {
    if (abortControllerRef.current && !abortControllerRef.current.signal?.aborted) {
      abortControllerRef.current.abort();
    }
  } catch (e) { /* ignore */ }
  locks.isFetching = false;
  locks.activeSource = null;
  locks.fetchStartedAt = 0;
  if (typeof window !== 'undefined') {
    window.__MARINE_FETCH_PENDING__ = null;
    window.__MARINE_FETCH_DEBOUNCING__ = false;
  }
  recordChurn('stale_lock_release', {});
  console.warn('[Marine] Stale fetch lock released (held >lease, governor idle) — refetching to recover wedged heatmap.');
  return true;
}

export function useMarineDataFetcherCore({
  mapInstance,
  activeMarineLayerRef,
  timeOffsetRef,
  activeModelRef,
  marineData,
  setMarineData,
  marineRevision,
  marineRequestIdRef,
  abortControllerRef,
  inFlight,
  activeMarineLayersRef,
  marineFetchLocksRef,
  isCommittingDataRef,
  isInternalMapUpdateRef,
  internalUpdateTimerRef,
  swrTimerRef,
  swrRetryCountRef,
  cooldownRetryRef,
  clearAllTimers,
  scheduleSWRRevalidation,
  scheduleCooldownRetry,
  scheduleDegenerateRetry,
  resetRetryCounts,
  updateMarineGridRef,
  enqueueMarineUpdateRef,
  consecutiveFailuresRef,
  abortRecoveryRetryCountRef,
  lastFetchedModelRef,
  pendingMarineIntentRef,
  pipelineEventsRef,
  pipelineCountersRef,
  lastCommittedSigRef,
  orchestratorInFlight,
  scheduledRef,
  timeoutIdRef,
  moveendDebounceRef,
  scrubDebounceRef,
  detachedWaitTimerRef,
  getViewportHash,
  logPipelineEventHelper,
  marineDataRef,
  lastInvocationRef
}) {
  const updateMarineGrid = useCallback(async (source = 'unknown') => {
    let phase = 'init';
    // Phase 2: this invocation's controller + outcome, for identity-safe registry bookkeeping
    // in `finally` (a detached/stale request must still be removed from the registry).
    let myController = null;
    let fetchStatus = 'failure';
    const rawModel = activeModelRef.current;
    const layer = activeMarineLayerRef.current || 'waves';
    const timeOffset = timeOffsetRef.current;
    const isWaves = layer === 'waves';
    const nativeLimit = isWaves ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;
    const model = (rawModel === 'ICON' && timeOffset > 168 && !getBackendIconMarineFlag()) ? 'GFS'
                : (rawModel === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) ? 'GFS'
                : (rawModel === 'EURO' && timeOffset > nativeLimit) ? 'GFS'
                : rawModel;
    const zoom = mapInstance.getZoom();
    const locks = marineFetchLocksRef.current;
    let requestId = 0;
    let clearDebounce = true;
    // Generation of the transition this fetch fulfills, if any. Captured at dispatch so
    // the finally can end ONLY the transition it owns — a stale request (older generation,
    // or a non-transition viewport refetch) can never end a newer transition.
    let capturedTransitionGen = null;

    try {
      const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
      if (!isTimelineScrub && (window.isScrubbingTimeline || isCommittingDataRef.current)) return;
      if (!activeMarineLayersRef.current) return;
      const viewportHash = getViewportHash();
      if (!viewportHash) {
        console.log(`[Marine] Viewport bounds are degenerate or map not ready. Skipping fetch (source=${source}).`);
        const isRetrySource = source.includes('retry');
        const canRetry = source === 'mount' || source === 'load' || source === 'manual' || isRetrySource;
        if (canRetry) {
          clearDebounce = false;
          scheduleDegenerateRetry(source, (nextSource) => {
            if (activeMarineLayersRef.current && updateMarineGridRef.current) {
              updateMarineGridRef.current(nextSource);
            }
          });
        }
        return;
      }
      resetRetryCounts();
      const isRetry = source === 'cooldown_retry' || source === 'delayed_retry' || source === 'swr_revalidation';
      const hasValidData = marineData && marineData.grid && marineData.grid.vectors && marineData.grid.vectors.length > 0;
      const isCorrectLayer = marineData?.grid?.__componentLayer === layer;
      let bypassDedupe = !hasValidData || !isCorrectLayer || !!(marineData?.stale || marineData?.grid?.stale);

      if (!isRetry && !isTimelineScrub && !bypassDedupe && locks.lastHash === viewportHash && (Date.now() - locks.lastTime < 5 * 60 * 1000)) return;
      if (locks.lastHash !== viewportHash) {
        consecutiveFailuresRef.current = 0;
        resetRetryCounts();
        clearAllTimers();
        locks.lastTime = 0; // Prevent 1200ms rate-limiter from blocking the fetch on layer/viewport switch
      }

      if (source !== 'swr_revalidation') {
        if (swrTimerRef.current) {
          clearTimeout(swrTimerRef.current);
          swrTimerRef.current = null;
        }
        swrRetryCountRef.current = 0;
      }
      updateMarineGridRef.current = updateMarineGrid;

      // Heal a stranded lock before trusting it (otherwise the same-target dedup below skips
      // this recovery fetch forever → permanent blank heatmap). No-op for a healthy in-flight fetch.
      releaseStaleMarineLock(locks, abortControllerRef);
      if (locks.isFetching) {
        // Same-target dedup (see enqueueMarineUpdate): never abort an in-flight fetch that's
        // already loading this exact model/layer/hour — the activation multi-trigger would
        // otherwise abort-loop into the recovery-grid blank.
        const inflight = abortControllerRef.current && abortControllerRef.current.__intent;
        const isAborted = abortControllerRef.current?.signal?.aborted;
        if (inflight && !isAborted && inflight.rawModel === rawModel && inflight.layer === layer && inflight.hour === timeOffset) {
          console.log(`[Abort-Gate] Same-target fetch already in-flight (${inflight.rawModel}/${inflight.layer}/h${inflight.hour}); skipping duplicate (no abort).`);
          return;
        }
        const activeSource = locks.activeSource || 'unknown';
        const isHighPriority = (src) => src === 'manual' || src.includes('timeline') || src.includes('scrub');
        if (isHighPriority(activeSource) && !isHighPriority(source)) {
          console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority update request (${source})`);
          return;
        }
        console.log(`[Release] Releasing in-flight fetch (${activeSource}) for new request source=${source} (scrub=abort, switch=detach+self-cache)`);
        // Detach on model/layer switch (self-caches; requestId/live-target guards block its
        // stale commit; registry caps + unmounts) — but ABORT under active scrubbing so the
        // backend's disconnect-detection can cancel the remaining per-hour upstream work.
        releaseAbandonedFetch(inFlight, abortControllerRef.current, 'updateMarineGrid', activeSource, source);
        locks.isFetching = false;
      }
      if (!isRetry && !isTimelineScrub && consecutiveFailuresRef.current >= 3) return;
      const now = Date.now();
      if (!isRetry && !isTimelineScrub && now - locks.lastTime < 1200) return;
      if (!isTimelineScrub && (mapInstance.isMoving() || mapInstance.isZooming()) && hasValidData) {
        clearDebounce = false;
        return;
      }

      // Phase 2b — detached-dedup: if THIS exact target (incl. viewport) is already running
      // as a DETACHED request, don't start a duplicate; mark it wanted so its completion wakes
      // a cache-backed re-entry. Stuck-proof: cap never aborts a wanted entry (so it always
      // completes + wakes) + a 2s fallback re-drives if a wake is ever missed.
      {
        const di = { model, rawModel, layer, hour: timeOffset, boundsKey: viewportHash };
        const detachedSame = inFlight.find(di);
        if (detachedSame && detachedSame.state === 'detached') {
          inFlight.markWanted(di);
          logPipelineEventHelper('detached_dedup_wait', { model: rawModel, layer, hour: timeOffset });
          if (detachedWaitTimerRef.current) clearTimeout(detachedWaitTimerRef.current);
          detachedWaitTimerRef.current = setTimeout(() => {
            detachedWaitTimerRef.current = null;
            if (activeMarineLayersRef.current && updateMarineGridRef.current) updateMarineGridRef.current('detached_wake_fallback');
          }, 2000);
          clearDebounce = false;
          return;
        }
      }
      if (detachedWaitTimerRef.current) { clearTimeout(detachedWaitTimerRef.current); detachedWaitTimerRef.current = null; }

      phase = 'pre_fetch';
      const isActivation = source.startsWith('mount') || source.startsWith('load') || source.startsWith('manual');
      const bounds = handleRegionalGridClearing({
        mapInstance, isActivation, marineData, zoom, model, layer, setMarineData, lastCommittedSigRef
      });

      // NOTE: do NOT bump requestId before the cooldown early-return. The finally clears
      // locks.isFetching only when requestId === marineRequestIdRef.current; if we bumped it here
      // and then returned on cooldown without dispatching, an in-flight prior fetch's finally would
      // no longer match and locks.isFetching would be stranded true forever (stuck in-flight /
      // abort-storm deadlock). Bump it only once we're committed to dispatching, below.
      if (getRemainingCooldown('marine') > 0 || isInCooldown('marine')) {
        handleCooldownFallback({
          mapInstance, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
          marineRevision, getViewportHash, logPipelineEventHelper, cooldownRetryRef, consecutiveFailuresRef,
          clearTimeoutFunc: clearTimeout, getModelSafeMarine, _marineDataSignature, getSharedValidTime
        });
        return;
      }

      requestId = ++marineRequestIdRef.current;

      // Release the prior fetch (same-target is already deduped above, so this is a real
      // switch): detach to self-cache on a model/layer switch, abort under active scrubbing.
      releaseAbandonedFetch(inFlight, abortControllerRef.current, 'updateMarineGrid_preStart', null, source);
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      myController = abortControllerRef.current;
      // Tag with this fetch's target so a later switch can detach+self-cache it and the
      // registry can abort it for the concurrency cap / on unmount.
      abortControllerRef.current.__intent = { model, rawModel, layer, hour: timeOffset, bounds, zoom, boundsKey: viewportHash };
      inFlight.registerForeground(myController, abortControllerRef.current.__intent, requestId);

      locks.isFetching = true;
      locks.activeSource = source;
      locks.fetchStartedAt = Date.now(); // lease start — see releaseStaleMarineLock watchdog
      if (typeof window !== 'undefined') {
        window.__MARINE_FETCH_DEBOUNCING__ = false;
        window.__MARINE_FETCH_PENDING__ = { model: rawModel, layer, hour: timeOffset, timestamp: new Date().toISOString() };
      }
      // Take ownership of the open transition ONLY if this fetch's target identity matches it.
      // A viewport/moveend refetch (different intent) leaves capturedTransitionGen null and
      // therefore cannot end the transition.
      {
        const t = getTarget();
        if (t && t.status === 'pending' && t.model === rawModel && t.layer === layer) {
          capturedTransitionGen = t.gen;
        }
      }
      const fetchIntent = { model: rawModel, layer, hour: timeOffset };

      let data = null;

      const diagObj = {
        model, layer, targetHour: timeOffset, nativeLimit: model === 'ICON' ? DISPLAY_ICON_MAX_HOURS : nativeLimit,
        requiredSources: [], cacheHits: [], fetchStarted: [], skippedReason: null, resultStatus: 'pending',
        rateLimitStatus: 'ok', cooldownStatus: isInCooldown('marine') ? 'rate_limited' : 'ok', timestamp: new Date().toISOString()
      };
      window.__EXTENDED_ESTIMATE_FETCH_DIAG__ = diagObj;

      if (model === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) {
        const hasBackend = getBackendIconMarineFlag();
        const fallbackReason = hasBackend ? 'icon_no_backend_extended_estimate' : 'backend_required_no_frontend_estimator';
        data = buildIconFallbackGrid(bounds, fallbackReason);
      } else if (model === 'EURO' && timeOffset > nativeLimit && !getBackendCopernicusFlag()) {
        data = buildEuroFallbackGrid(bounds, 'backend_required_no_frontend_estimator');
      } else if (data === null) {
        if (model === 'EURO' && layer && COMPONENT_LAYERS.includes(layer)) {
          if (getBackendCopernicusFlag()) {
            phase = 'standard_fetch_copernicus';
            try {
              data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer);
              if (!data || !data.grid || (!data.grid.renderable && (!data.grid.vectors || data.grid.vectors.length === 0))) {
                console.warn('[Marine] Deployed Copernicus grid returned empty/unrenderable grid.');
                const failureReason = data?.grid?.__failureReason || 'unavailable';
                data = buildCopernicusEmptyGrid(bounds, timeOffset, layer, failureReason);
              }
            } catch (err) {
              if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
                throw err;
              } else {
                console.error('[Marine] Deployed Copernicus grid fetch failed:', err.message);
              }
              data = buildCopernicusEmptyGrid(bounds, timeOffset, layer, err.message || 'Copernicus grid fetch failed');
            }
          } else {
            data = {
              type: 'FeatureCollection',
              features: [],
              grid: {
                vectors: [], bounds, cols: 0, rows: 0, status: "no_coverage", source: "backend_required",
                provider: "none", is_estimated: false, fallbackReason: "backend_required_no_frontend_estimator",
                renderable: false, emptyGridWarning: "Backend Copernicus support is absent, no frontend estimator"
              }
            };
          }
        } else {
          phase = 'standard_fetch';
          data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer);
        }
      }

      // A renderable response means fetchMarineData has self-cached this target (warm for a
      // switch-back). Record success for registry telemetry BEFORE the stale-reject return so
      // a detached request that finished is counted as completed-into-cache, not failed.
      if (data && data.grid && data.grid.renderable !== false && data.grid.vectors && data.grid.vectors.length > 0) {
        fetchStatus = 'success';
      }

      if (requestId !== marineRequestIdRef.current) return;
      if (fetchIntent.model !== activeModelRef.current || fetchIntent.layer !== (activeMarineLayerRef.current || 'waves') || fetchIntent.hour !== timeOffsetRef.current) {
        logPipelineEventHelper('stale_async_response_rejected', fetchIntent); return;
      }

      phase = 'commit';
      if (typeof window !== 'undefined') {
        let nzCount = 0;
        if (data?.grid?.vectors) {
          for (const v of data.grid.vectors) {
            if (v) {
              const comp = v[layer] || v.waves || v.swell_1 || v.swell_2 || v.wind_waves || v;
              if (comp && comp.speed > 0) nzCount++;
            }
          }
        }
        window.__MARINE_FETCH_DIAG__ = { activeModel: activeModelRef.current, activeLayer: layer, timeOffsetHours: timeOffsetRef.current, provider: data?.grid?.__provider || 'none', gridProvider: data?.grid?.__gridProvider || 'none', httpStatus: data ? 200 : 502, elapsedMs: Date.now() - now, vectorCount: data?.grid?.vectors?.length || 0, nonzeroCount: nzCount, timestamp: new Date().toISOString() };
      }

      const isUnsupportedLayer = data?.grid?.__unsupportedLayer || data?.__unsupportedLayer || data?.status === 'unsupported';
      if (isUnsupportedLayer) {
        console.log(`[Marine] Unsupported layer detected: ${model}/${layer}. Preserving existing heatmap.`);
        logPipelineEventHelper('unsupported_layer_preserved', { model, layer, hour: timeOffset, reason: data?.grid?.emptyGridWarning || 'unsupported_model_layer' });
        consecutiveFailuresRef.current = 0; locks.lastHash = viewportHash; locks.lastTime = Date.now();
        setMarineData(prev => {
          if (prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0) {
            return {
              ...prev,
              __unsupportedLayerOverride: { model, layer, reason: data?.grid?.emptyGridWarning || 'unsupported_model_layer' }
            };
          }
          lastCommittedSigRef.current = null;
          return data;
        });
        return;
      }

      if (data && (data.features?.length > 0 || data.grid?.vectors?.length > 0 || data.grid?.__skippedReason === 'zoom_too_low' || data.grid?.skippedReason === 'zoom_too_low' || data.grid?.emptyGridWarning)) {
        commitMarineData({
          data, bounds, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
          marineRevision, getViewportHash, logPipelineEventHelper, consecutiveFailuresRef,
          isCommittingDataRef, isInternalMapUpdateRef, internalUpdateTimerRef, locks, source,
          scheduleSWRRevalidation, updateMarineGrid, getBackendCopernicusFlag, getBackendIconMarineFlag,
          getBackendWeatherFlag, _marineDataSignature, getSharedValidTime, updateDeprecationDiag,
          setTimeoutFunc: setTimeout, clearTimeoutFunc: clearTimeout
        });
      } else {
        consecutiveFailuresRef.current += 1;
        const isCurrentHour = fetchIntent.hour === timeOffsetRef.current;
        if (!window.isScrubbingTimeline && isCurrentHour) {
          setMarineData(prev => {
            const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
            const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
            const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
            const isSameModelAndLayer = prevModel === model && prevLayer === layer;
            if (hasValidData && isSameModelAndLayer) {
              return { ...prev, stale: true, grid: { ...prev.grid, stale: true } };
            }
            lastCommittedSigRef.current = null;
            return null;
          });
        } else {
          console.log(`[Marine] Fetch returned empty/failed (isCurrentHour=${isCurrentHour}), preserving stale data.`);
        }
        if (isInCooldown('marine')) logPipelineEventHelper('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
        if (consecutiveFailuresRef.current >= 3 || ['cooldown_retry', 'delayed_retry'].includes(source)) return;
        scheduleCooldownRetry((src) => {
          if (updateMarineGridRef.current && activeMarineLayersRef.current) {
            updateMarineGridRef.current(src);
          }
        });
      }
    } catch (err) {
      const isAbort = err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort');
      fetchStatus = isAbort ? 'abort' : 'failure';
      if (isAbort) {
        console.log(`[Marine] Fetch aborted (expected during model/layer switch) phase=${phase}: ${err.message}`);
      } else {
        console.error(`[Orchestrator Fatal Exception] phase=${phase} error:`, err.message);
      }
      const isCurrentHour = timeOffset === timeOffsetRef.current;
      if (!isAbort && !window.isScrubbingTimeline && isCurrentHour) {
        setMarineData(prev => {
          const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
          const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
          const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
          const isSameModelAndLayer = prevModel === model && prevLayer === layer;
          if (hasValidData && isSameModelAndLayer) {
            return { ...prev, stale: true, grid: { ...prev.grid, stale: true } };
          }
          lastCommittedSigRef.current = null;
          return null;
        });
      } else if (isAbort && isCurrentHour && !window.isScrubbingTimeline) {
        if (requestId !== marineRequestIdRef.current) {
          console.log(`[ABORT RECOVERY] Discarding abort recovery because requestId (${requestId}) is stale (current=${marineRequestIdRef.current}).`);
          return;
        }
        console.log(`[ABORT RECOVERY] AbortError in phase=${phase}, model=${model}, layer=${layer}. Retry count: ${abortRecoveryRetryCountRef.current}/3`);
        const prev = marineDataRef.current;
        const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
        const targetChanged = activeModelRef.current !== model || (activeMarineLayerRef.current || 'waves') !== layer;
        if (hasValidData) {
          console.log(`[ABORT RECOVERY] Previous valid data exists, preserving.`);
        } else if (targetChanged) {
          console.log(`[ABORT RECOVERY] Skipping recovery-grid blank — target moved on (was ${model}/${layer}, now ${activeModelRef.current}/${activeMarineLayerRef.current || 'waves'}); newer fetch owns the display.`);
        } else {
          console.warn(`[ABORT RECOVERY] No previous data exists. Committing recovery grid to break LOADING deadlock.`);
          recordChurn('recovery_grid_commit', { model, layer, hour: timeOffset, phase, retry: abortRecoveryRetryCountRef.current });
          lastCommittedSigRef.current = null;
          marineRevision.current += 1;
          const recoveryGrid = getAbortRecoveryGrid(model, layer, phase, marineRevision.current);
          setMarineData(recoveryGrid);

          if (abortRecoveryRetryCountRef.current < 3) {
            abortRecoveryRetryCountRef.current += 1;
            const retryModel = model;
            const retryLayer = layer;
            setTimeout(() => {
              if (activeModelRef.current !== retryModel || (activeMarineLayerRef.current || 'waves') !== retryLayer) {
                console.log(`[ABORT RECOVERY] Discarding stale retry (target=${retryModel}/${retryLayer}, current=${activeModelRef.current}/${activeMarineLayerRef.current}).`);
                return;
              }
              if (enqueueMarineUpdateRef.current && activeMarineLayersRef.current) {
                console.log(`[ABORT RECOVERY] Scheduling retry fetch after abort recovery (attempt ${abortRecoveryRetryCountRef.current}/3).`);
                enqueueMarineUpdateRef.current('abort_recovery_retry');
              }
            }, 1500);
          } else {
            console.warn(`[ABORT RECOVERY] Max retries (3) reached. Stopping abort recovery loop.`);
          }
        }
      } else {
        console.log(`[Marine] Fetch exception (isAbort=${isAbort}, isCurrentHour=${isCurrentHour}), preserving stale data.`);
      }
    } finally {
      // Registry bookkeeping for THIS request — runs for foreground AND detached/stale
      // requests. Identity-safe (ignored if a newer controller re-took this key), and it
      // NEVER commits or touches the transition/locks, so a detached completion is inert.
      if (myController && myController.__intent) {
        const { shouldWake } = inFlight.complete(myController.__intent, myController, fetchStatus);
        // A wanted detached request finished — re-drive the CURRENT target once (cache-hit if
        // it succeeded, fresh fetch if it failed), unblocking the dedup early-return above.
        if (shouldWake && activeMarineLayersRef.current && enqueueMarineUpdateRef.current) {
          inFlight.noteWakeEnqueued(inFlight.key(myController.__intent));
          setTimeout(() => { enqueueMarineUpdateRef.current && enqueueMarineUpdateRef.current('detached_wake'); }, 0);
        }
      }
      if (requestId === marineRequestIdRef.current) {
        locks.isFetching = false;
        locks.activeSource = null;
        locks.fetchStartedAt = 0;
        if (typeof window !== 'undefined') {
          window.__MARINE_FETCH_PENDING__ = null;
          if (!timeoutIdRef.current && capturedTransitionGen !== null) {
            // End ONLY the transition this fetch owns. No-op if a newer transition began
            // (endTransition checks generation), so a stale request can't end it. The
            // coordinator mirrors __MARINE_TRANSITIONING__ for un-migrated readers.
            endTransition(capturedTransitionGen);
          }
          if (clearDebounce) {
            window.__MARINE_FETCH_DEBOUNCING__ = false;
          }
        }
        const pending = pendingMarineIntentRef.current;
        if (pending) {
          pendingMarineIntentRef.current = null;
          if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
            const pendingSource = pending.source.includes('_pending') ? pending.source : pending.source + '_pending';
            setTimeout(() => enqueueMarineUpdateRef.current?.(pendingSource), 50);
          } else { logPipelineEventHelper('pending_intent_expired', pending); }
        }
      }
    }
  }, [
    mapInstance,
    activeModelRef,
    activeMarineLayerRef,
    timeOffsetRef,
    getViewportHash,
    logPipelineEventHelper
  ]);

  const enqueueMarineUpdate = useCallback((source) => {
    if (source === 'cancel_scrub') {
      if (scrubDebounceRef.current) {
        clearTimeout(scrubDebounceRef.current);
        scrubDebounceRef.current = null;
      }
      return;
    }

    const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
    if (!isTimelineScrub && window.isScrubbingTimeline) return;

    if (source === 'timeline_scrub_deferred') {
      if (scrubDebounceRef.current) clearTimeout(scrubDebounceRef.current);
      scrubDebounceRef.current = setTimeout(() => {
        scrubDebounceRef.current = null;
        updateMarineGrid('timeline_scrub');
      }, 150);
      return;
    }

    const now = Date.now();
    const locks = marineFetchLocksRef.current;
    // Heal a stranded lock before trusting it (same watchdog as updateMarineGrid).
    releaseStaleMarineLock(locks, abortControllerRef);
    if (locks.isFetching) {
      const inflight = abortControllerRef.current && abortControllerRef.current.__intent;
      const isAborted = abortControllerRef.current?.signal?.aborted;
      if (inflight && !isAborted && inflight.rawModel === activeModelRef.current &&
          inflight.layer === (activeMarineLayerRef.current || 'waves') &&
          inflight.hour === timeOffsetRef.current) {
        console.log(`[Abort-Gate] Same-target fetch already in-flight (${inflight.rawModel}/${inflight.layer}/h${inflight.hour}); skipping duplicate (no abort).`);
        return;
      }
      pendingMarineIntentRef.current = { source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, timestamp: Date.now() };
      logPipelineEventHelper('intent_buffered', pendingMarineIntentRef.current);
      const activeSource = locks.activeSource || 'unknown';
      const isHighPriority = (src) => src === 'manual' || src.startsWith('manual') || src.includes('timeline') || src.includes('scrub');
      if (isHighPriority(activeSource) && !isHighPriority(source)) {
        console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority request (${source})`);
        return;
      }
      console.log(`[Release] Releasing active fetch (${activeSource}) in enqueueMarineUpdate for new source=${source} (scrub=abort, switch=detach+self-cache)`);
      releaseAbandonedFetch(inFlight, abortControllerRef.current, 'enqueueMarineUpdate', activeSource, source);
      locks.isFetching = false;
      locks.activeSource = null;
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        if (!activeMarineLayersRef.current) return;
        updateMarineGrid(source);
      }, 150);
      return;
    }

    if (source === 'manual') locks.manualFetchActiveUntil = now + 1500;
    if (source.includes('moveend') && !source.includes('_pending') && now < (locks.manualFetchActiveUntil || 0)) return;

    let isCached = false;
    try {
      const b = mapInstance.getBounds(), bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
    } catch (e) {
      isCached = false;
    }

    const dedupeWindow = isCached ? 50 : 800;
    if (lastInvocationRef.current && lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < dedupeWindow) return;

    try {
      const viewportHash = getViewportHash();
      const hasValidData = marineDataRef.current && marineDataRef.current.grid && marineDataRef.current.grid.vectors && marineDataRef.current.grid.vectors.length > 0;
      const isCorrectLayer = marineDataRef.current?.grid?.__componentLayer === (activeMarineLayerRef.current || 'waves');
      const bypassDedupe = !hasValidData || !isCorrectLayer || !!(marineDataRef.current?.stale || marineDataRef.current?.grid?.stale);
      if (!bypassDedupe && locks.lastHash === viewportHash && (now - locks.lastTime < 5 * 60 * 1000)) return;
    } catch (e) {
      // ignore
    }

    lastInvocationRef.current = { source, time: now };
    if (scheduledRef.current) return;
    scheduledRef.current = true;

    if (typeof window !== 'undefined') {
      window.__MARINE_FETCH_DEBOUNCING__ = true;
    }

    requestAnimationFrame(() => {
      scheduledRef.current = false;
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      const stableDelay = (isCached || source === 'manual' || source === 'timeline_scrub') ? 20 : 300;
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        if (isTimelineScrub || (!mapInstance.isMoving() && !mapInstance.isZooming())) {
          updateMarineGrid(source);
        } else {
          let fired = false;
          const runUpdate = () => {
            if (fired) return;
            fired = true;
            mapInstance.off('idle', runUpdate);
            if (activeMarineLayersRef.current) {
              updateMarineGrid(source);
            }
          };
          mapInstance.once('idle', runUpdate);
          setTimeout(runUpdate, 1000);
        }
      }, stableDelay);
    });
  }, [
    mapInstance,
    activeModelRef,
    activeMarineLayerRef,
    timeOffsetRef,
    getViewportHash,
    logPipelineEventHelper,
    updateMarineGrid,
    marineDataRef,
    lastInvocationRef
  ]);

  return { updateMarineGrid, enqueueMarineUpdate };
}
