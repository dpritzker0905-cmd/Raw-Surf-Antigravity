import { useRef, useCallback } from 'react';

/**
 * useRasterTransactions (v242)
 *
 * Raster source mutation controller. Depends on useMapRenderContract for all
 * readiness and interaction gating. This hook owns ONLY:
 * 1. URL deduplication
 * 2. Source-load state tracking (with 2s min retry delay)
 * 3. Deferred write queue (drained by contract onReady callback)
 *
 * DELETED from v241:
 * - Ad-hoc style.load listener (now in contract)
 * - Ad-hoc interaction lock (now in contract)
 * - Fallback poll (now in contract)
 * - setTimeout-based retry loops (replaced by source load state tracking)
 * - flushedRef / tryInitialFlush (replaced by contract onReady)
 */
export function useRasterTransactions(mapInstance, renderContract) {
  const pendingTimers = useRef({});
  const lastCommittedUrls = useRef({});
  const deferredQueue = useRef([]);

  // v242: Source Load State — prevents infinite retry loops
  const sourceLoadState = useRef({});
  const MIN_RETRY_DELAY = 2000; // ms — never retry a loading source faster than this

  /**
   * Commit a single source mutation. ONLY called when contract.canCommit() is true.
   * @private
   */
  const commitMutation = useCallback((sourceId, url, isTilesArray) => {
    if (!mapInstance) return false;

    try {
      const source = mapInstance.getSource(sourceId);
      if (!source) return false;

      // Source-loading gate with rate-limited retry
      if (mapInstance.isSourceLoaded && !mapInstance.isSourceLoaded(sourceId)) {
        const loadState = sourceLoadState.current[sourceId];
        const now = Date.now();
        if (loadState && now - loadState.lastAttempt < MIN_RETRY_DELAY) {
          return false; // Rate-limited — don't spam
        }
        sourceLoadState.current[sourceId] = { status: 'loading', lastAttempt: now };
        console.debug(`[Raster TX] Deferred ${sourceId} (source loading, next retry in ${MIN_RETRY_DELAY}ms)`);
        return false;
      }

      // Hard dedup right before commit
      const urlKey = isTilesArray ? JSON.stringify(url) : url;
      if (lastCommittedUrls.current[sourceId] === urlKey) {
        return true; // Already committed — skip
      }

      if (isTilesArray) {
        if (source.setTiles) source.setTiles(url);
      } else {
        if (source.setUrl) source.setUrl(url);
      }

      lastCommittedUrls.current[sourceId] = urlKey;
      sourceLoadState.current[sourceId] = { status: 'ready', lastAttempt: Date.now() };
      console.debug(`[Raster TX] Committed ${sourceId}`);
      return true;
    } catch (e) {
      if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
        console.debug(`[Raster TX] AbortError swallowed for ${sourceId}`);
        return true;
      }
      sourceLoadState.current[sourceId] = { status: 'failed', lastAttempt: Date.now() };
      console.warn(`[Raster TX] Failed to update ${sourceId}:`, e);
      return true;
    }
  }, [mapInstance]);

  /**
   * Flush the deferred write queue. ONLY called by contract onReady callback.
   * @private
   */
  const flushQueue = useCallback(() => {
    if (!mapInstance || !deferredQueue.current.length) return;
    if (!renderContract?.canCommit()) return;

    console.log(`[Raster TX] Flushing ${deferredQueue.current.length} deferred writes`);
    const retries = [];

    for (const entry of deferredQueue.current) {
      const ok = commitMutation(entry.sourceId, entry.url, entry.isTilesArray);
      if (!ok) retries.push(entry);
    }

    deferredQueue.current = retries;

    // If source-loading entries remain, schedule ONE retry after MIN_RETRY_DELAY
    if (retries.length > 0) {
      renderContract.onReady(() => {
        setTimeout(flushQueue, MIN_RETRY_DELAY);
      });
    }
  }, [mapInstance, commitMutation, renderContract]);

  /**
   * Public API: Enqueue a raster source update.
   */
  const queueRasterUpdate = useCallback((sourceId, url, isTilesArray = false) => {
    if (!mapInstance) return;

    // Hard dedup at ingress
    const urlKey = isTilesArray ? JSON.stringify(url) : url;
    if (lastCommittedUrls.current[sourceId] === urlKey) return;

    // Cancel any pending timer
    if (pendingTimers.current[sourceId]) {
      clearTimeout(pendingTimers.current[sourceId]);
    }

    // Can we commit right now?
    if (renderContract?.canCommit()) {
      pendingTimers.current[sourceId] = setTimeout(() => {
        pendingTimers.current[sourceId] = null;

        // Re-check contract (interaction may have started during 200ms settle)
        if (!renderContract.canCommit()) {
          deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
          deferredQueue.current.push({ sourceId, url, isTilesArray });
          renderContract.onReady(flushQueue);
          return;
        }

        const ok = commitMutation(sourceId, url, isTilesArray);
        if (!ok) {
          deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
          deferredQueue.current.push({ sourceId, url, isTilesArray });
          renderContract.onReady(flushQueue);
        }
      }, 200);
    } else {
      // Queue and register for flush on next READY transition
      const state = renderContract?.getState?.() || 'unknown';
      console.log(`[Raster TX] Queued ${sourceId} (state: ${state})`);
      deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
      deferredQueue.current.push({ sourceId, url, isTilesArray });
      renderContract?.onReady(flushQueue);
    }
  }, [mapInstance, commitMutation, renderContract, flushQueue]);

  const cleanupTransactions = useCallback(() => {
    Object.values(pendingTimers.current).forEach(t => clearTimeout(t));
    pendingTimers.current = {};
    deferredQueue.current = [];
    sourceLoadState.current = {};
  }, []);

  return { queueRasterUpdate, cleanupTransactions };
}
