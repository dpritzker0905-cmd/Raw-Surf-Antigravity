import { useRef, useEffect, useCallback } from 'react';
import { getRemainingCooldown } from '../components/map/marineController';

/**
 * useMarineRevalidation - Custom hook for managing weather simulation retry timers,
 * SWR revalidations, and cooldown fallbacks.
 */
export function useMarineRevalidation() {
  const swrTimerRef = useRef(null);
  const swrRetryCountRef = useRef(0);
  const cooldownRetryRef = useRef(null);
  const marineRetryCountRef = useRef(0);

  const clearAllTimers = useCallback(() => {
    if (swrTimerRef.current) {
      clearTimeout(swrTimerRef.current);
      swrTimerRef.current = null;
    }
    if (cooldownRetryRef.current) {
      clearTimeout(cooldownRetryRef.current);
      cooldownRetryRef.current = null;
    }
  }, []);

  const scheduleSWRRevalidation = useCallback((data, updateFn) => {
    const grid = data?.grid;
    const isStale = !!(data?.stale || grid?.stale);
    // An HTTP-200 grid with zero vectors (non-renderable) is usually a *transient*
    // absence of data — e.g. a far-hour slice of a freshly-published model run the
    // backend is still ingesting. It is NOT flagged stale, so without this branch it
    // commits once (blanking the heatmap, e.g. on a GFS->ICON switch where the
    // same-model hold-guard doesn't apply) and is never retried. Schedule a bounded
    // revalidation so it self-heals once the backend finishes ingesting. Terminal
    // no-coverage / unsupported responses are excluded — retrying won't resolve them.
    // A TERMINAL no-data response — out-of-coverage (no_coverage, no_copernicus_coverage,
    // no_backend_coverage, out_of_bounds/no_coverage) or unsupported layer — will never resolve
    // by retrying, so it must be excluded from the transient retry. The reason can arrive as a
    // status OR as the safe-zero grid's __failureReason (createFallbackSafeZeroGrid). Match by
    // substring so every coverage/unsupported variant is caught.
    const reasonStr = `${data?.status || ''} ${grid?.status || ''} ${data?.__failureReason || ''} ${grid?.__failureReason || ''}`.toLowerCase();
    const isTerminalNoData = reasonStr.includes('coverage') || reasonStr.includes('unsupported');

    const isEmptyTransient = !!grid &&
      grid.renderable === false &&
      ((grid.vectors?.length || 0) === 0) &&
      !grid.__unsupportedLayer && data?.__unsupportedLayer !== true &&
      !isTerminalNoData;

    if (isStale || isEmptyTransient) {
      // SWR RE-DRIVE LADDER — the dominant term in zoom-out "slow expansion" (HANDOFF-2026-07-15 §1,
      // mechanism traced 2026-07-15): the mid-res preview commits INSTANTLY, then this fixed-delay
      // re-request is what actually pulls the sharpened fine grid once the backend's background
      // _revalidate_fetch (serialized, MARINE_REVAL_CONCURRENCY=1) has warmed the dynamic cache. So the
      // perceived sharpen latency ≈ delay × (retries until the reval lands), and the 3-retry cap is
      // what leaves a slow reval STUCK at the mid tier (the residual "clamping"). The delay ladder and
      // retry cap are LIVE-TUNABLE for A/B against __SHARPEN_TRACE__ — DEFAULTS ARE BYTE-IDENTICAL to
      // the prior hardcoded 1500ms × 3. On the live site set e.g.
      //   window.__RAW_MARINE_SWR_STALE_DELAYS__ = [700, 1200, 1800, 2500]
      //   window.__RAW_MARINE_SWR_MAX_RETRIES__  = 4
      // to trial a faster+deeper ladder at ZERO upstream cost (the re-request reads the now-warm cache,
      // not upstream). Empty/cold-ingestion transients keep their own 2500ms cadence — a different
      // phenomenon (a freshly-published run still ingesting), left untouched.
      const _w = (typeof window !== 'undefined') ? window : undefined;
      const _maxRetries = (_w && Number(_w.__RAW_MARINE_SWR_MAX_RETRIES__) > 0)
        ? Math.floor(Number(_w.__RAW_MARINE_SWR_MAX_RETRIES__)) : 3;
      const _staleLadder = (_w && Array.isArray(_w.__RAW_MARINE_SWR_STALE_DELAYS__) && _w.__RAW_MARINE_SWR_STALE_DELAYS__.length)
        ? _w.__RAW_MARINE_SWR_STALE_DELAYS__ : null;
      if (swrRetryCountRef.current < _maxRetries) {
        const _idx = swrRetryCountRef.current;
        const delay = isEmptyTransient
          ? 2500
          : (_staleLadder ? (Number(_staleLadder[Math.min(_idx, _staleLadder.length - 1)]) || 1500) : 1500);
        console.log(`[SWR] ${isEmptyTransient ? 'Empty/non-renderable grid (likely cold ingestion of a fresh run)' : 'Committed stale/coarse grid'}. Scheduling SWR revalidation retry #${swrRetryCountRef.current + 1} in ${delay}ms`);
        if (swrTimerRef.current) {
          clearTimeout(swrTimerRef.current);
        }
        swrTimerRef.current = setTimeout(() => {
          swrTimerRef.current = null;
          swrRetryCountRef.current += 1;
          updateFn('swr_revalidation');
        }, delay);
      } else {
        console.warn(`[SWR] Max revalidation retries reached (${_maxRetries}), stopping polling.`);
      }
    } else {
      swrRetryCountRef.current = 0;
      if (swrTimerRef.current) {
        clearTimeout(swrTimerRef.current);
        swrTimerRef.current = null;
      }
    }
  }, []);

  const scheduleCooldownRetry = useCallback((updateFn) => {
    const remaining = getRemainingCooldown('marine');
    const delay = remaining > 0 ? remaining + 3000 : 5000;
    const retrySource = remaining > 0 ? 'cooldown_retry' : 'delayed_retry';

    if (cooldownRetryRef.current) {
      clearTimeout(cooldownRetryRef.current);
    }
    cooldownRetryRef.current = setTimeout(() => {
      cooldownRetryRef.current = null;
      updateFn(retrySource);
    }, delay);
  }, []);

  const scheduleDegenerateRetry = useCallback((source, updateFn) => {
    const retryCount = marineRetryCountRef.current || 0;
    if (retryCount < 20) {
      marineRetryCountRef.current = retryCount + 1;
      const isRetrySource = source.includes('retry');
      const nextSource = isRetrySource ? source : source + '_retry';
      setTimeout(() => {
        updateFn(nextSource);
      }, 500);
    } else {
      console.warn(`[Marine] Max retries (${retryCount}) reached for degenerate bounds.`);
    }
  }, []);

  const resetRetryCounts = useCallback(() => {
    swrRetryCountRef.current = 0;
    marineRetryCountRef.current = 0;
  }, []);

  // Ensure timers are cleared on unmount
  useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  return {
    swrTimerRef,
    swrRetryCountRef,
    cooldownRetryRef,
    marineRetryCountRef,
    clearAllTimers,
    scheduleSWRRevalidation,
    scheduleCooldownRetry,
    scheduleDegenerateRetry,
    resetRetryCounts,
  };
}

export default useMarineRevalidation;
