import { useState, useRef, useEffect, useCallback } from 'react';
import { useMarineRevalidation } from '../../hooks/useMarineRevalidation';
import { useMarineDataFetcherCore } from './useMarineDataFetcherCore';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getSharedValidTime, getBackendIconMarineFlag, getBackendWeatherFlag, getSurfModeFlag } from './backendWeatherServiceClient';
import { updateDeprecationDiag } from './forecastSamplers';
import { isInCooldown, clearCooldown } from './marineControllerUtils';
import { _marineDataSignature, _logPipelineEvent } from './useMarineOrchestratorDiag';
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
  getLongitudinalOverlap,
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
import { createMarineInFlightRegistry } from './marineInFlightRegistry';
import { recordMarineEvent } from './marineForensics';   // surf_toggle breadcrumb (§5b pinning instrument)


export function useMarineDataFetcher({
  mapInstance,
  activeLayers,
  activeMarineLayer,
  activeMarineLayerRef,
  timeOffsetHours,
  timeOffsetRef,
  activeModel,
  activeModelRef
}) {
  const [marineData, setMarineData] = useState(null);
  const marineDataRef = useRef(null);

  const marineRevision = useRef(0);
  const marineRequestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  // Phase 2 (abort-storm rework): in-flight registry. On a target switch we DETACH the
  // abandoned fetch (let it run to completion + self-cache) instead of aborting+refetching.
  // Display-safety stays with the requestId / live-target / transition guards below — the
  // registry only bounds concurrency (cap detached requests) and cleans up on unmount.
  const inFlightRef = useRef(null);
  if (!inFlightRef.current) inFlightRef.current = createMarineInFlightRegistry({ cap: 3 });
  const inFlight = inFlightRef.current;
  const activeMarineLayersRef = useRef(false);
  const marineFetchLocksRef = useRef({ lastHash: null, lastTime: 0, isFetching: false, manualFetchActiveUntil: 0, fetchStartedAt: 0 });
  const manualMarineTriggerRef = useRef(null);
  const isCommittingDataRef = useRef(false);
  const isInternalMapUpdateRef = useRef(false);
  const internalUpdateTimerRef = useRef(null);
  const lastUserInteractionRef = useRef(0);
  const lastStableCameraRef = useRef(null);
  const lastInvocationRef = useRef({ source: null, time: 0 });
  const {
    swrTimerRef,
    swrRetryCountRef,
    cooldownRetryRef,
    marineRetryCountRef,
    clearAllTimers,
    scheduleSWRRevalidation,
    scheduleCooldownRetry,
    scheduleDegenerateRetry,
    resetRetryCounts
  } = useMarineRevalidation();
  const updateMarineGridRef = useRef(null);
  const enqueueMarineUpdateRef = useRef(null);
  const consecutiveFailuresRef = useRef(0);
  const abortRecoveryRetryCountRef = useRef(0);
  const lastFetchedModelRef = useRef(null);
  const pendingMarineIntentRef = useRef(null);
  const pipelineEventsRef = useRef([]);

  const pipelineCountersRef = useRef({
    networkFetches: 0, cacheRemaps: 0, duplicateCommitSkipped: 0, duplicateUploadSkipped: 0,
    staleRejections: 0, pendingIntents: 0, rateLimits: 0, extendedEstimateFetches: 0,
    extendedEstimateSkipped: 0, webglUploads: 0, webglClears: 0, commitShortCircuit: 0
  });

  const lastCommittedSigRef = useRef(null);
  const orchestratorInFlight = useRef(new Map());

  const scheduledRef = useRef(false);
  const timeoutIdRef = useRef(null);
  const moveendDebounceRef = useRef({ timer: null });
  const scrubDebounceRef = useRef(null);
  // Phase 2b: belt-and-suspenders fallback for the detached-dedup early-return — if a wake
  // is ever missed, this re-drives the current target so a transition can't be stranded.
  const detachedWaitTimerRef = useRef(null);

  const getViewportHash = useCallback(() => {
    if (!mapInstance) return null;
    try {
      const b = mapInstance.getBounds();
      const west = b.getWest();
      const east = b.getEast();
      const south = b.getSouth();
      const north = b.getNorth();
      if (Math.abs(east - west) < 0.01 || Math.abs(north - south) < 0.01) {
        return null;
      }
      const q = v => Number(v).toFixed(2);
      const bboxStr = `${q(west)},${q(south)},${q(east)},${q(north)}`;
      return `${bboxStr}:${activeModelRef.current}:${activeMarineLayerRef.current || 'waves'}:${timeOffsetRef.current}:${getSurfModeFlag() ? 'surf' : 'swell'}`;
    } catch (e) { return null; }
  }, [mapInstance, activeModelRef, activeMarineLayerRef, timeOffsetRef]);

  const logPipelineEventHelper = useCallback((eventType, detail) => {
    _logPipelineEvent(
      eventType,
      detail,
      pipelineEventsRef,
      pipelineCountersRef,
      activeModelRef,
      activeMarineLayerRef,
      timeOffsetRef,
      lastCommittedSigRef,
      pendingMarineIntentRef
    );
  }, [activeModelRef, activeMarineLayerRef, timeOffsetRef]);

  const { updateMarineGrid, enqueueMarineUpdate } = useMarineDataFetcherCore({
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
  });

  enqueueMarineUpdateRef.current = enqueueMarineUpdate;
  manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');

  // Option-2 Swell<->Surf toggle: re-fetch the marine grid when the surf flag flips. The toggle (in
  // MapWeatherControls) flips the flag then dispatches this event; the URL builder + cache key already read
  // the flag, so a forced manual fetch pulls the surf (or swell) grid and commits it to the heatmap.
  useEffect(() => {
    const onSurfToggle = () => {
      // PINNING INSTRUMENT (2026-07-17 §5b): in one live repro the toggle's re-fetch was swallowed
      // before any network/guard breadcrumb and the band wedged until the flavor backstop broke it.
      // Record the entry state so the NEXT occurrence pins the swallowing branch from the ring alone.
      try {
        const locks = marineFetchLocksRef.current || {};
        const inflight = abortControllerRef.current && abortControllerRef.current.__intent;
        recordMarineEvent('surf_toggle', {
          flag: getSurfModeFlag(), isFetching: !!locks.isFetching,
          inflightSurf: inflight ? inflight.surf : null,
          inflightAgeMs: locks.fetchStartedAt ? (Date.now() - locks.fetchStartedAt) : null,
        });
      } catch (e) { /* breadcrumb never fatal */ }
      try { enqueueMarineUpdate('manual'); } catch (e) {}
    };
    window.addEventListener('rawsurf:surf-toggle', onSurfToggle);
    // SERIES-ARRIVAL UPGRADE (2026-07-17, user @z8.63: post-toggle the 2° global_mid interim sat
    // resident 15 s+ with wrong coarse direction while the honest FINE series page landed in the
    // cache 4.4 s in and nothing committed it — the settle sharpener's clamp class keys on
    // coarse-GLOBAL residents (span ≥359°) and the clipped mid tier passes as "regional", so it
    // escapes every upgrade path at a settled camera. When a regional series page lands, re-drive
    // the CACHE lane ('series_upgrade' = commit-from-cache only, never network — see
    // updateMarineGrid): the flavor fast path then commits the finer same-flavor frame and the
    // no-downgrade guard's normal rules apply. Loop-safe: the commit stores nothing back into the
    // series cache, a miss returns without fetching, and repeats dedup on the commit signature.
    // Kill: __RAW_DISABLE_FLAVOR_CACHE_FASTPATH__ (shared with the commit half).
    const onSeriesRevalidated = () => {
      try {
        if (typeof window !== 'undefined'
            && (window.__RAW_DISABLE_FLAVOR_CACHE_FASTPATH__ === true || window.isScrubbingTimeline)) return;
        enqueueMarineUpdate('series_upgrade');
      } catch (e) { /* best-effort */ }
    };
    window.addEventListener('marine_series_revalidated', onSeriesRevalidated);
    return () => {
      window.removeEventListener('rawsurf:surf-toggle', onSurfToggle);
      window.removeEventListener('marine_series_revalidated', onSeriesRevalidated);
    };
  }, [enqueueMarineUpdate]);

  useEffect(() => {
    marineDataRef.current = marineData;
  }, [marineData]);

  useEffect(() => {
    consecutiveFailuresRef.current = 0;
    abortRecoveryRetryCountRef.current = 0;
    resetRetryCounts();
  }, [activeModel, activeMarineLayer, timeOffsetHours]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Abort every detached in-flight request too (they no longer auto-abort on switch).
      try { inFlight.abortAll(); } catch (e) { /* ignore */ }
      if (detachedWaitTimerRef.current) clearTimeout(detachedWaitTimerRef.current);
      if (cooldownRetryRef.current) clearTimeout(cooldownRetryRef.current);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      if (moveendDebounceRef.current.timer) clearTimeout(moveendDebounceRef.current.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      if (scrubDebounceRef.current) clearTimeout(scrubDebounceRef.current);
      if (swrTimerRef.current) clearTimeout(swrTimerRef.current);
    };
  }, []);

  return {
    marineData,
    marineDataRef,
    setMarineData,
    marineRevision,
    marineRequestIdRef,
    activeMarineLayersRef,
    marineFetchLocksRef,
    manualMarineTriggerRef,
    isCommittingDataRef,
    isInternalMapUpdateRef,
    internalUpdateTimerRef,
    lastUserInteractionRef,
    lastStableCameraRef,
    lastInvocationRef,
    cooldownRetryRef,
    marineRetryCountRef,
    updateMarineGridRef,
    enqueueMarineUpdateRef,
    consecutiveFailuresRef,
    lastFetchedModelRef,
    pendingMarineIntentRef,
    pipelineEventsRef,
    pipelineCountersRef,
    lastCommittedSigRef,
    orchestratorInFlight,
    scheduledRef,
    timeoutIdRef,
    moveendDebounceRef,
    getViewportHash,
    logPipelineEventHelper,
    updateMarineGrid,
    enqueueMarineUpdate
  };
}
