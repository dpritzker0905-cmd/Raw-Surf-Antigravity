import { useRef, useCallback, useEffect } from 'react';

/**
 * useRasterTransactions (v240)
 *
 * Centralized raster source mutation controller with MAP READINESS LIFECYCLE.
 *
 * Architecture (addresses ChatGPT v239 audit — "timing contracts are probabilistic"):
 * 1. Deduplicates: won't call setUrl if the URL hasn't changed
 * 2. Serializes: cancels pending updates before scheduling new ones
 * 3. Abort-safe: swallows MapLibre AbortError from cancelled internal fetches
 * 4. Style-safe: checks isStyleLoaded() before committing mutations
 * 5. Source-loading gate: defers mutation during active tile fetch
 * 6. NEW — Deferred Write Queue: stores writes that arrive before style.load
 * 7. NEW — Guaranteed Flush: style.load event drains the queue deterministically
 * 8. NEW — Fallback Poll: catches the case where style.load fires before listener attaches
 */
export function useRasterTransactions(mapInstance) {
  const pendingTimers = useRef({});
  const lastCommittedUrls = useRef({});

  // v240: Deferred Write Queue — stores mutations that arrive before MAP_READY
  const deferredQueue = useRef([]);
  const styleReadyRef = useRef(false);

  /**
   * Commit a single source mutation. Called ONLY when map is confirmed ready.
   * @private
   */
  const commitMutation = useCallback((sourceId, url, isTilesArray) => {
    if (!mapInstance) return false;

    try {
      const source = mapInstance.getSource(sourceId);
      if (!source) return false;

      // Source-loading gate: don't interrupt an active tile-fetch pipeline
      if (mapInstance.isSourceLoaded && !mapInstance.isSourceLoaded(sourceId)) {
        console.debug(`[Raster TX] Deferred ${sourceId} (source still loading)`);
        return false; // Signal: retry needed
      }

      if (isTilesArray) {
        if (source.setTiles) source.setTiles(url);
      } else {
        if (source.setUrl) source.setUrl(url);
      }

      const urlKey = isTilesArray ? JSON.stringify(url) : url;
      lastCommittedUrls.current[sourceId] = urlKey;
      console.debug(`[Raster TX] Committed ${sourceId}`);
      return true;
    } catch (e) {
      if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
        console.debug(`[Raster TX] AbortError swallowed for ${sourceId} (expected)`);
        return true; // Don't retry AbortErrors
      }
      console.warn(`[Raster TX] Failed to update ${sourceId}:`, e);
      return true; // Don't retry unknown errors either
    }
  }, [mapInstance]);

  /**
   * Flush the deferred write queue. Called on style.load and fallback poll.
   * @private
   */
  const flushQueue = useCallback(() => {
    if (!mapInstance || !deferredQueue.current.length) return;

    console.log(`[Raster TX] Flushing ${deferredQueue.current.length} deferred writes`);
    const retries = [];

    for (const entry of deferredQueue.current) {
      const ok = commitMutation(entry.sourceId, entry.url, entry.isTilesArray);
      if (!ok) retries.push(entry); // Source still loading — re-queue
    }

    deferredQueue.current = retries;

    // If some entries couldn't commit (source loading), retry once more
    if (retries.length > 0) {
      setTimeout(flushQueue, 500);
    }
  }, [mapInstance, commitMutation]);

  /**
   * v240: Map Readiness Lifecycle — subscribe to style.load for guaranteed flush.
   */
  useEffect(() => {
    if (!mapInstance) return;

    // Check if style is already loaded (event may have fired before this effect runs)
    if (mapInstance.isStyleLoaded?.()) {
      styleReadyRef.current = true;
      flushQueue();
    }

    const onStyleLoad = () => {
      console.log('[Raster TX] style.load → MAP_READY, flushing queue');
      styleReadyRef.current = true;
      flushQueue();
    };

    mapInstance.on('style.load', onStyleLoad);

    // Fallback poll: in case style.load already fired before listener attached
    const fallbackTimer = setTimeout(() => {
      if (!styleReadyRef.current && mapInstance.isStyleLoaded?.()) {
        console.log('[Raster TX] Fallback poll → style was already loaded');
        styleReadyRef.current = true;
        flushQueue();
      }
    }, 500);

    return () => {
      mapInstance.off('style.load', onStyleLoad);
      clearTimeout(fallbackTimer);
    };
  }, [mapInstance, flushQueue]);

  /**
   * Public API: Enqueue a serialized raster source update.
   * @param {string} sourceId  - MapLibre source ID
   * @param {string|string[]} url - URL string or tiles array
   * @param {boolean} isTilesArray - true for setTiles(), false for setUrl()
   */
  const queueRasterUpdate = useCallback((sourceId, url, isTilesArray = false) => {
    if (!mapInstance) return;

    // Deduplicate: skip if we'd commit the exact same URL
    const urlKey = isTilesArray ? JSON.stringify(url) : url;
    if (lastCommittedUrls.current[sourceId] === urlKey) return;

    // Cancel any pending timer for this source
    if (pendingTimers.current[sourceId]) {
      clearTimeout(pendingTimers.current[sourceId]);
    }

    // If map style isn't ready yet, queue for deterministic flush
    if (!styleReadyRef.current || !mapInstance.isStyleLoaded?.()) {
      console.log(`[Raster TX] Queued ${sourceId} (style not ready)`);
      // Replace any existing entry for this sourceId to avoid stale writes
      deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
      deferredQueue.current.push({ sourceId, url, isTilesArray });
      return;
    }

    // Style is ready — schedule commit with settling delay
    pendingTimers.current[sourceId] = setTimeout(() => {
      pendingTimers.current[sourceId] = null;
      const ok = commitMutation(sourceId, url, isTilesArray);
      if (!ok) {
        // Source still loading — defer with short retry
        const retryTimer = setTimeout(() => {
          commitMutation(sourceId, url, isTilesArray);
        }, 400);
        pendingTimers.current[sourceId] = retryTimer;
      }
    }, 200);
  }, [mapInstance, commitMutation]);

  /**
   * Cleanup all pending timers (call in effect cleanup)
   */
  const cleanupTransactions = useCallback(() => {
    Object.values(pendingTimers.current).forEach(t => clearTimeout(t));
    pendingTimers.current = {};
    deferredQueue.current = [];
  }, []);

  return { queueRasterUpdate, cleanupTransactions };
}
