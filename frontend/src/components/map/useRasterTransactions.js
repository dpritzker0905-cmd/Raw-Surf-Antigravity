import { useRef, useCallback } from 'react';

/**
 * useRasterTransactions (v238)
 *
 * Centralized raster source mutation controller. ALL MapLibre raster source
 * URL/tile updates MUST go through this queue. Direct calls to source.setUrl()
 * or source.setTiles() from React lifecycle are BANNED.
 *
 * Architecture:
 * 1. Deduplicates: won't call setUrl if the URL hasn't changed
 * 2. Serializes: cancels pending updates before scheduling new ones
 * 3. Abort-safe: swallows MapLibre AbortError from cancelled internal fetches
 * 4. Style-safe: checks isStyleLoaded() before committing mutations
 */
export function useRasterTransactions(mapInstance) {
  const pendingTimers = useRef({});
  const lastCommittedUrls = useRef({});

  /**
   * Enqueue a serialized raster source update.
   * @param {string} sourceId  - MapLibre source ID (e.g., 'om-weather-source')
   * @param {string|string[]} url - URL string or tiles array
   * @param {boolean} isTilesArray - true for setTiles(), false for setUrl()
   */
  const queueRasterUpdate = useCallback((sourceId, url, isTilesArray = false) => {
    if (!mapInstance) return;

    // Deduplicate: skip if we'd commit the exact same URL
    const urlKey = isTilesArray ? JSON.stringify(url) : url;
    if (lastCommittedUrls.current[sourceId] === urlKey) return;

    // Cancel any pending transaction for this source
    if (pendingTimers.current[sourceId]) {
      clearTimeout(pendingTimers.current[sourceId]);
    }

    pendingTimers.current[sourceId] = setTimeout(() => {
      pendingTimers.current[sourceId] = null;

      try {
        // Style-safety gate: don't mutate sources during style reload
        if (!mapInstance.isStyleLoaded?.()) {
          console.warn(`[Raster TX] Deferred ${sourceId} (style not loaded)`);
          const retryTimer = setTimeout(() => {
            queueRasterUpdate(sourceId, url, isTilesArray);
          }, 300);
          pendingTimers.current[sourceId] = retryTimer;
          return;
        }

        const source = mapInstance.getSource(sourceId);
        if (!source) return;

        // Source-loading gate: don't interrupt an active tile-fetch pipeline.
        // This is the root cause of AbortError — setUrl() during active fetch
        // cancels MapLibre's internal AbortController, generating unhandled rejections.
        if (mapInstance.isSourceLoaded && !mapInstance.isSourceLoaded(sourceId)) {
          console.debug(`[Raster TX] Deferred ${sourceId} (source still loading)`);
          const retryTimer = setTimeout(() => {
            queueRasterUpdate(sourceId, url, isTilesArray);
          }, 400);
          pendingTimers.current[sourceId] = retryTimer;
          return;
        }

        if (isTilesArray) {
          if (source.setTiles) source.setTiles(url);
        } else {
          if (source.setUrl) source.setUrl(url);
        }

        // Record committed URL for dedup
        lastCommittedUrls.current[sourceId] = urlKey;
      } catch (e) {
        // Swallow MapLibre AbortError — this is expected when cancelling
        // internal tile fetch pipelines. It is NOT an application error.
        if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
          console.debug(`[Raster TX] AbortError swallowed for ${sourceId} (expected)`);
          return;
        }
        console.warn(`[Raster TX] Failed to update ${sourceId}:`, e);
      }
    }, 200);
  }, [mapInstance]);

  /**
   * Cleanup all pending timers (call in effect cleanup)
   */
  const cleanupTransactions = useCallback(() => {
    Object.values(pendingTimers.current).forEach(t => clearTimeout(t));
    pendingTimers.current = {};
  }, []);

  return { queueRasterUpdate, cleanupTransactions };
}
