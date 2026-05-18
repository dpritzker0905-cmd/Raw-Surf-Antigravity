import { useRef, useCallback } from 'react';

/**
 * useRasterTransactions (v243)
 *
 * Raster source mutation controller with:
 * 1. Source-level single-flight locks (no concurrent mutations per sourceId)
 * 2. Hard ingress dedup (silently drops during INTERACTING, no log spam)
 * 3. Flush dedup via RAF token (only latest flush executes per frame cycle)
 * 4. Source load state tracking with 2s min retry
 *
 * v243 fixes (per ChatGPT v242 runtime audit):
 * - Ingress spam: silently deduplicates against deferred queue
 * - Source race: each sourceId has a single-flight lock
 * - Flush spam: token-guarded RAF ensures only latest flush runs
 */
export function useRasterTransactions(mapInstance, renderContract) {
  const lastCommittedUrls = useRef({});
  const deferredQueue = useRef([]);
  const sourceLocks = useRef({});
  const flushTokenRef = useRef(0);
  const flushRegisteredRef = useRef(false);
  const sourceLoadState = useRef({});
  const MIN_RETRY_DELAY = 2000;
  // Stable refs for cross-callback access
  const renderContractRef = useRef(renderContract);
  renderContractRef.current = renderContract;
  const mapRef = useRef(mapInstance);
  mapRef.current = mapInstance;

  /**
   * Add/replace entry in deferred queue (deduped by sourceId).
   * Plain function — only accesses refs, safe from stale closure.
   */
  const addToQueue = (sourceId, url, isTilesArray) => {
    deferredQueue.current = deferredQueue.current.filter(e => e.sourceId !== sourceId);
    deferredQueue.current.push({ sourceId, url, isTilesArray });
  };

  /**
   * Commit a single source mutation.
   * Single-flight: if sourceId is mid-commit, queues the latest payload instead.
   * @private
   */
  const commitMutation = useCallback((sourceId, url, isTilesArray) => {
    const map = mapRef.current;
    if (!map) return false;

    // Single-flight gate
    if (sourceLocks.current[sourceId]) {
      sourceLocks.current[sourceId].queued = { sourceId, url, isTilesArray };
      return true; // Queued payload will fire after current commit
    }

    try {
      const source = map.getSource(sourceId);
      if (!source) return false;

      // Source-loading gate with rate-limited retry
      if (map.isSourceLoaded && !map.isSourceLoaded(sourceId)) {
        const loadState = sourceLoadState.current[sourceId];
        const now = Date.now();
        if (loadState && now - loadState.lastAttempt < MIN_RETRY_DELAY) {
          return false;
        }
        sourceLoadState.current[sourceId] = { status: 'loading', lastAttempt: now };
        return false;
      }

      // Hard dedup right before commit
      const urlKey = isTilesArray ? JSON.stringify(url) : url;
      if (lastCommittedUrls.current[sourceId] === urlKey) {
        return true;
      }

      // Lock this source
      sourceLocks.current[sourceId] = { queued: null };

      // Schedule the mutation — 1 RAF delay for GPU frame safety
      requestAnimationFrame(() => {
        if (!map.getStyle()) {
          sourceLocks.current[sourceId] = null;
          return;
        }

        try {
          if (!map.getSource(sourceId)) {
            sourceLocks.current[sourceId] = null;
            return;
          }

          // om:// protocol caches state by variable only, NOT by time_step.
          // setUrl() returns stale cached data. The only reliable fix is to
          // remove + re-add the source and layers to force a fresh state.
          const style = map.getStyle();
          const allLayers = style?.layers || [];
          const myLayers = allLayers.filter(l => l.source === sourceId);

          // Find the layer AFTER our last layer to preserve z-ordering
          const lastIdx = allLayers.findIndex(
            l => l.id === myLayers[myLayers.length - 1]?.id
          );
          const beforeId = (lastIdx >= 0 && lastIdx + 1 < allLayers.length)
            ? allLayers[lastIdx + 1].id : undefined;

          // Remove layers (reverse order) then source
          for (let i = myLayers.length - 1; i >= 0; i--) {
            try { map.removeLayer(myLayers[i].id); } catch (_) { /* already removed */ }
          }
          try { map.removeSource(sourceId); } catch (_) { /* already removed */ }

          // Re-add source with the new URL
          const spec = { type: 'raster', maxzoom: 12 };
          if (isTilesArray) spec.tiles = url;
          else spec.url = url;
          map.addSource(sourceId, spec);

          // Re-add layers in original order at the correct position
          for (const layer of myLayers) {
            try { map.addLayer(layer, beforeId); } catch (_) { /* layer exists */ }
          }

          map.triggerRepaint();
          lastCommittedUrls.current[sourceId] = urlKey;
          sourceLoadState.current[sourceId] = { status: 'ready', lastAttempt: Date.now() };
        } catch (innerErr) {
          console.warn(`[Raster TX] source swap failed for ${sourceId}:`, innerErr.message);
        }

        // Release lock INSIDE RAF — prevents race conditions
        const queued = sourceLocks.current[sourceId]?.queued;
        sourceLocks.current[sourceId] = null;

        if (queued) {
          requestAnimationFrame(() => {
            if (renderContractRef.current?.canCommit()) {
              commitMutation(queued.sourceId, queued.url, queued.isTilesArray);
            } else {
              addToQueue(queued.sourceId, queued.url, queued.isTilesArray);
              scheduleFlush();
            }
          });
        }
      });

      return true;
    } catch (e) {
      sourceLocks.current[sourceId] = null;
      if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
        return true;
      }
      sourceLoadState.current[sourceId] = { status: 'failed', lastAttempt: Date.now() };
      console.warn(`[Raster TX] Failed to update ${sourceId}:`, e);
      return true;
    }
  }, []); // No deps — uses only refs

  /**
   * Flush queue. Token-guarded: only the latest invocation within a frame cycle executes.
   * @private
   */
  const doFlush = useCallback(() => {
    const token = ++flushTokenRef.current;
    flushRegisteredRef.current = false;

    requestAnimationFrame(() => {
      if (token !== flushTokenRef.current) return; // Stale
      const map = mapRef.current;
      const contract = renderContractRef.current;
      if (!map || !deferredQueue.current.length) return;
      if (!contract?.canCommit()) {
        scheduleFlush();
        return;
      }

      const entries = [...deferredQueue.current];
      deferredQueue.current = [];

      const retries = [];
      for (const entry of entries) {
        const ok = commitMutation(entry.sourceId, entry.url, entry.isTilesArray);
        if (!ok) retries.push(entry);
      }

      if (retries.length > 0) {
        deferredQueue.current = retries;
        setTimeout(() => scheduleFlush(), MIN_RETRY_DELAY);
      }
    });
  }, [commitMutation]);

  /**
   * Schedule a flush on next READY transition. Idempotent — won't double-register.
   */
  const scheduleFlush = () => {
    if (flushRegisteredRef.current) return;
    flushRegisteredRef.current = true;
    // Use ref to get latest contract
    renderContractRef.current?.onReady(() => {
      // Small yield to batch multiple onReady callbacks
      setTimeout(() => doFlush(), 0);
    });
  };

  /**
   * Public API: Enqueue a raster source update.
   */
  const queueRasterUpdate = useCallback((sourceId, url, isTilesArray = false) => {
    const map = mapRef.current;
    if (!map) return;

    // Hard dedup at ingress
    const urlKey = isTilesArray ? JSON.stringify(url) : url;
    if (lastCommittedUrls.current[sourceId] === urlKey) return;

    // Dedup against queue (prevents repeated queuing of same URL)
    const existing = deferredQueue.current.find(e => e.sourceId === sourceId);
    if (existing) {
      const existingKey = existing.isTilesArray ? JSON.stringify(existing.url) : existing.url;
      if (existingKey === urlKey) return; // Already queued with same URL
    }

    // Can we commit right now?
    const contract = renderContractRef.current;
    if (contract?.canCommit()) {
      const ok = commitMutation(sourceId, url, isTilesArray);
      if (!ok) {
        addToQueue(sourceId, url, isTilesArray);
        scheduleFlush();
      }
    } else {
      // Queue silently — no log spam
      addToQueue(sourceId, url, isTilesArray);
      scheduleFlush();
    }
  }, [commitMutation]);

  const cleanupTransactions = useCallback(() => {
    deferredQueue.current = [];
    sourceLoadState.current = {};
    sourceLocks.current = {};
    flushTokenRef.current = 0;
    flushRegisteredRef.current = false;
  }, []);

  return { queueRasterUpdate, cleanupTransactions };
}
