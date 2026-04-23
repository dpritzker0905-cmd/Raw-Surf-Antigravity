/**
 * offlineGallery.js — Utility for caching purchased gallery photos offline
 * 
 * Allows surfers to save purchased photos for viewing without internet
 * (critical for beach/no-signal areas). Uses CacheStorage API.
 * 
 * Cap: 500MB total to prevent device storage issues.
 */

const GALLERY_CACHE_NAME = 'rawsurf-gallery-offline-v1';
const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500MB

/**
 * Cache a media URL for offline viewing
 * @param {string} mediaUrl - The full URL to cache
 * @returns {Promise<boolean>} true if cached successfully
 */
export async function cacheForOffline(mediaUrl) {
  if (!mediaUrl || !('caches' in window)) return false;
  
  try {
    // Check size limit first
    const currentSize = await getOfflineCacheSize();
    if (currentSize >= MAX_CACHE_BYTES) {
      console.warn('[OfflineGallery] Cache limit reached (500MB)');
      return false;
    }

    const cache = await caches.open(GALLERY_CACHE_NAME);
    const response = await fetch(mediaUrl, { mode: 'cors' });
    
    if (!response.ok) {
      console.warn('[OfflineGallery] Failed to fetch for caching:', response.status);
      return false;
    }

    await cache.put(mediaUrl, response);
    console.log('[OfflineGallery] Cached:', mediaUrl.substring(0, 80));
    return true;
  } catch (err) {
    console.error('[OfflineGallery] Cache failed:', err);
    return false;
  }
}

/**
 * Check if a media URL is available offline
 * @param {string} mediaUrl
 * @returns {Promise<boolean>}
 */
export async function isOfflineCached(mediaUrl) {
  if (!mediaUrl || !('caches' in window)) return false;
  try {
    const cache = await caches.open(GALLERY_CACHE_NAME);
    const match = await cache.match(mediaUrl);
    return !!match;
  } catch {
    return false;
  }
}

/**
 * Get a cached response for offline viewing
 * @param {string} mediaUrl
 * @returns {Promise<Response|null>}
 */
export async function getOfflineCached(mediaUrl) {
  if (!mediaUrl || !('caches' in window)) return null;
  try {
    const cache = await caches.open(GALLERY_CACHE_NAME);
    return await cache.match(mediaUrl);
  } catch {
    return null;
  }
}

/**
 * Remove a specific URL from the offline cache
 * @param {string} mediaUrl
 * @returns {Promise<boolean>}
 */
export async function removeFromOfflineCache(mediaUrl) {
  if (!mediaUrl || !('caches' in window)) return false;
  try {
    const cache = await caches.open(GALLERY_CACHE_NAME);
    return await cache.delete(mediaUrl);
  } catch {
    return false;
  }
}

/**
 * Clear the entire offline gallery cache
 * @returns {Promise<boolean>}
 */
export async function clearOfflineCache() {
  if (!('caches' in window)) return false;
  try {
    return await caches.delete(GALLERY_CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Get total size of the offline gallery cache in bytes
 * @returns {Promise<number>}
 */
export async function getOfflineCacheSize() {
  if (!('caches' in window)) return 0;
  try {
    const cache = await caches.open(GALLERY_CACHE_NAME);
    const keys = await cache.keys();
    let total = 0;
    for (const req of keys) {
      const resp = await cache.match(req);
      if (resp) {
        const blob = await resp.clone().blob();
        total += blob.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Get count of cached items
 * @returns {Promise<number>}
 */
export async function getOfflineCacheCount() {
  if (!('caches' in window)) return 0;
  try {
    const cache = await caches.open(GALLERY_CACHE_NAME);
    const keys = await cache.keys();
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
