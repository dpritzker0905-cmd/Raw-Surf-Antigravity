import logger from './logger';
/**
 * Lightweight IndexedDB Tile Cache for Leaflet
 * Caches map tiles locally for faster loading on repeat visits
 * No external dependencies - uses native browser APIs
 */

const DB_NAME = 'leaflet_tile_cache';
const DB_VERSION = 1;
const STORE_NAME = 'tiles';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 500; // Max tiles to keep

let db = null;
let dbPromise = null;

/**
 * Initialize IndexedDB connection
 */
const initDB = () => {
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      logger.debug('[TileCache] IndexedDB not supported');
      resolve(null);
      return;
    }
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      logger.debug('[TileCache] Failed to open DB');
      resolve(null);
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      logger.debug('[TileCache] IndexedDB initialized');
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        logger.debug('[TileCache] Created object store');
      }
    };
  });
  
  return dbPromise;
};

/**
 * Get a tile from cache
 * @param {string} key - Tile URL or unique key
 * @returns {Promise<string|null>} - Data URL or null
 */
export const getTile = async (key) => {
  const database = await initDB();
  if (!database) return null;
  
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // Check if expired
          if (Date.now() - result.timestamp > MAX_AGE_MS) {
            resolve(null);
          } else {
            resolve(result.dataUrl);
          }
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
};

/**
 * Store a tile in cache
 * @param {string} key - Tile URL or unique key
 * @param {string} dataUrl - Base64 data URL of tile
 */
export const setTile = async (key, dataUrl) => {
  const database = await initDB();
  if (!database) return;
  
  try {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    store.put({
      key,
      dataUrl,
      timestamp: Date.now()
    });
  } catch (e) {
    logger.debug('[TileCache] Failed to cache tile');
  }
};

/**
 * Clear old tiles from cache
 */
export const cleanupCache = async () => {
  const database = await initDB();
  if (!database) return;
  
  try {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const cutoff = Date.now() - MAX_AGE_MS;
    
    const request = index.openCursor();
    let deleted = 0;
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.timestamp < cutoff) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      } else if (deleted > 0) {
        logger.debug(`[TileCache] Cleaned up ${deleted} expired tiles`);
      }
    };
  } catch (e) {
    // Ignore cleanup errors
  }
};

/**
 * Get cache stats
 */
export const getCacheStats = async () => {
  const database = await initDB();
  if (!database) return { count: 0, size: 0 };
  
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();
      
      countRequest.onsuccess = () => {
        resolve({ count: countRequest.result });
      };
      
      countRequest.onerror = () => resolve({ count: 0 });
    } catch (e) {
      resolve({ count: 0 });
    }
  });
};

/**
 * Clear all cached tiles
 */
export const clearCache = async () => {
  const database = await initDB();
  if (!database) return;
  
  try {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    logger.debug('[TileCache] Cache cleared');
  } catch (e) {
    logger.debug('[TileCache] Failed to clear cache');
  }
};

// Initialize on import and run cleanup
initDB().then(() => cleanupCache());

export default {
  getTile,
  setTile,
  cleanupCache,
  getCacheStats,
  clearCache
};
