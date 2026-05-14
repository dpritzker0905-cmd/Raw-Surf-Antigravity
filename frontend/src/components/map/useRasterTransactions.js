import { useRef, useCallback, useEffect } from 'react';

/**
 * useRasterTransactions (v241)
 *
 * Centralized raster source mutation controller with:
 * - Map readiness lifecycle (style.load flush)
 * - Interaction lock (blocks commits during drag/zoom)
 * - Dedup-guarded flush (prevents double-commit)
 *
 * v241 fixes (per ChatGPT v240 audit):
 * - Double-commit: flushQueue was called from 3 paths (immediate check, style.load,
 *   fallback poll). Now guarded by a `flushedRef` flag.
 * - Interaction lock: commits are blocked during dragstart→idle and zoomstart→idle.
 *   Deferred writes replay automatically 150ms after interaction ends.
 */
export function useRasterTransactions(mapInstance) {
  const pendingTimers = useRef({});
  const lastCommittedUrls = useRef({});

  // Deferred Write Queue
  const deferredQueue = useRef([]);
  const styleReadyRef = useRef(false);
  const flushedRef = useRef(false); // v241: prevents double-flush

  // v241: Interaction Lock — blocks commits during drag/zoom
  const interactionLockedRef = useRef(false);
  const interactionResumeTimer = useRef(null);

  /**
   * Commit a single source mutation. Only when map is ready AND not interacting.
   * @private
   */
  const commitMutation = useCallback((sourceId, url, isTilesArray) => {
    if (!mapInstance) return false;

    // v241: Hard block during interaction — return false to re-queue
    if (interactionLockedRef.current) {
      console.debug(`[Raster TX] Blocked ${sourceId} (interaction lock)`);
      return false;
    }

    try {
      const source = mapInstance.getSource(sourceId);
      if (!source) return false;

      // Source-loading gate
      if (mapInstance.isSourceLoaded && !mapInstance.isSourceLoaded(sourceId)) {
        console.debug(`[Raster TX] Deferred ${sourceId} (source still loading)`);
        return false;
      }

      // Dedup check right before commit (prevents double-commit from flush races)
      const urlKey = isTilesArray ? JSON.stringify(url) : url;
      if (lastCommittedUrls.current[sourceId] === urlKey) {
        return true; // Already committed — skip but don't retry
      }

      if (isTilesArray) {
        if (source.setTiles) source.setTiles(url);
      } else {
        if (source.setUrl) source.setUrl(url);
      }

      lastCommittedUrls.current[sourceId] = urlKey;
      console.debug(`[Raster TX] Committed ${sourceId}`);
      return true;
    } catch (e) {
      if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
        console.debug(`[Raster TX] AbortError swallowed for ${sourceId}`);
        return true;
      }
      console.warn(`[Raster TX] Failed to update ${sourceId}:`, e);
      return true;
    }
  }, [mapInstance]);

  /**
   * Flush the deferred write queue. Guarded against double-invocation.
   * @private
   */
  const flushQueue = useCallback(() => {
    if (!mapInstance || !deferredQueue.current.length) return;
    if (interactionLockedRef.current) return; // Don't flush during interaction

    console.log(`[Raster TX] Flushing ${deferredQueue.current.length} deferred writes`);
    const retries = [];

    for (const entry of deferredQueue.current) {
      const ok = commitMutation(entry.sourceId, entry.url, entry.isTilesArray);
      if (!ok) retries.push(entry);
    }

    deferredQueue.current = retries;

    if (retries.length > 0) {
      setTimeout(flushQueue, 500);
    }
  }, [mapInstance, commitMutation]);

  /**
   * Map Readiness + Interaction Lock lifecycle.
   */
  useEffect(() => {
    if (!mapInstance) return;

    // --- Style readiness (single-shot flush) ---
    const tryInitialFlush = () => {
      if (flushedRef.current) return; // Already flushed — prevent double-commit
      flushedRef.current = true;
      styleReadyRef.current = true;
      flushQueue();
    };

    if (mapInstance.isStyleLoaded?.()) {
      tryInitialFlush();
    }

    const onStyleLoad = () => {
      console.log('[Raster TX] style.load → MAP_READY');
      tryInitialFlush();
    };
    mapInstance.on('style.load', onStyleLoad);

    // Fallback poll (race condition coverage)
    const fallbackTimer = setTimeout(() => {
      if (!flushedRef.current && mapInstance.isStyleLoaded?.()) {
        console.log('[Raster TX] Fallback poll → flushing');
        tryInitialFlush();
      }
    }, 500);

    // --- v241: Interaction Lock ---
    const lockInteraction = () => {
      interactionLockedRef.current = true;
      clearTimeout(interactionResumeTimer.current);
    };

    const unlockInteraction = () => {
      // Debounce unlock — wait for inertial easing to settle
      clearTimeout(interactionResumeTimer.current);
      interactionResumeTimer.current = setTimeout(() => {
        interactionLockedRef.current = false;
        // Replay any writes that were blocked during interaction
        if (deferredQueue.current.length > 0) {
          console.log('[Raster TX] Interaction ended, replaying deferred writes');
          flushQueue();
        }
      }, 150);
    };

    mapInstance.on('dragstart', lockInteraction);
    mapInstance.on('zoomstart', lockInteraction);
    mapInstance.on('moveend', unlockInteraction);

    return () => {
      mapInstance.off('style.load', onStyleLoad);
      mapInstance.off('dragstart', lockInteraction);
      mapInstance.off('zoomstart', lockInteraction);
      mapInstance.off('moveend', unlockInteraction);
      clearTimeout(fallbackTimer);
      clearTimeout(interactionResumeTimer.current);
    };
  }, [mapInstance, flushQueue]);

  /**
   * Public API: Enqueue a raster source update.
   */
  const queueRasterUpdate = useCallback((sourceId, url, isTilesArray = false) => {
    if (!mapInstance) return;

    const urlKey = isTilesArray ? JSON.stringify(url) : url;
    if (lastCommittedUrls.current[sourceId] === urlKey) return;

    if (pendingTimers.current[sourceId]) {
      clearTimeout(pendingTimers.current[sourceId]);
    }

    // Queue if style not ready OR interaction locked
    if (!styleReadyRef.current || !mapInstance.isStyleLoaded?.() || interactionLockedRef.current) {
      console.log(`[Raster TX] Queued ${sourceId} (${interactionLockedRef.current ? 'interaction lock' : 'style not ready'})`);
      deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
      deferredQueue.current.push({ sourceId, url, isTilesArray });
      return;
    }

    pendingTimers.current[sourceId] = setTimeout(() => {
      pendingTimers.current[sourceId] = null;
      const ok = commitMutation(sourceId, url, isTilesArray);
      if (!ok) {
        // Re-queue for next idle window
        deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
        deferredQueue.current.push({ sourceId, url, isTilesArray });
      }
    }, 200);
  }, [mapInstance, commitMutation]);

  const cleanupTransactions = useCallback(() => {
    Object.values(pendingTimers.current).forEach(t => clearTimeout(t));
    pendingTimers.current = {};
    deferredQueue.current = [];
  }, []);

  return { queueRasterUpdate, cleanupTransactions };
}
