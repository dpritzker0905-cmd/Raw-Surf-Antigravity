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
    const isEmptyTransient = !!grid &&
      grid.renderable === false &&
      ((grid.vectors?.length || 0) === 0) &&
      !grid.__unsupportedLayer && data?.__unsupportedLayer !== true &&
      data?.status !== 'unsupported' && grid.status !== 'unsupported' &&
      data?.status !== 'no_coverage' && grid.status !== 'no_coverage';

    if (isStale || isEmptyTransient) {
      if (swrRetryCountRef.current < 3) {
        const delay = isEmptyTransient ? 2500 : 1500;
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
        console.warn('[SWR] Max revalidation retries reached (3), stopping polling.');
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
