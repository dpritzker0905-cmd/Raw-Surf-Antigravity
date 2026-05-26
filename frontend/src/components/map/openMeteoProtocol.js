import { CUSTOM_COLOR_SCALES } from './colorScales';
import { WeatherTelemetry } from './WeatherTelemetry';

// Custom protocol active model lock to avoid premature tile discarding
let activeModelLock = "";

// Global registry for missing Open-Meteo model runs to block 404 tile storms
const MISSING_OM_RUNS = new Set();
const MISSING_OM_TILES = new Set();

let resolveLandMask = null;
const landMaskPromise = new Promise((resolve) => {
  resolveLandMask = resolve;
});

export const setMapActiveModelLock = (modelName) => {
  activeModelLock = modelName;
  console.log('[MODEL] [OM-Protocol] Active model lock target set to:', activeModelLock);
};

const getParentModel = (folder) => {
  if (!folder) return "";
  const f = folder.toLowerCase();
  if (f.includes('dwd') || f.includes('icon') || f.includes('gwam')) return "ICON";
  if (f.includes('gfs')) return "GFS";
  if (f.includes('ecmwf') || f.includes('ifs') || f.includes('wam')) return "EURO";
  return "";
};

const isModelMatch = (folder, lock) => {
  if (!folder) return true;
  
  // Safe dynamic fallback: check typeof window !== 'undefined' to avoid worker ReferenceErrors
  if (typeof window !== 'undefined' && window.__OM_ACTIVE_MODELS__ && window.__OM_ACTIVE_MODELS__.includes(folder)) {
    return true;
  }
  
  if (!lock) return true; // Safe fallback if lock is empty
  
  const f = folder.toLowerCase();
  
  // GFS is the global fallback model for all weather/marine layers, allow it always
  if (f.includes('gfs')) {
    return true;
  }
  
  const parent = getParentModel(folder);
  const l = lock.toLowerCase();
  return parent.toLowerCase() === l || f.includes(l) || l.includes(f);
};

// Global Concurrency Semaphore to serialize tile decoding requests to 1 parallel worker
// Prevents parallel Emscripten heap allocations that trigger RuntimeError: Aborted(OOM) crashes
class ConcurrencySemaphore {
  constructor(limit = 1) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }
  acquire() {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }
  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.active--;
    }
  }
}
const protocolMutex = new ConcurrencySemaphore(3);

// In-memory cache for decoded tile buffers to bypass WASM decode and fetch entirely on hits during timeline scrubs
const DECODED_TILE_CACHE = new Map();
const MAX_CACHE_SIZE = 150;

function cacheDecodedTile(key, value) {
  if (DECODED_TILE_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = DECODED_TILE_CACHE.keys().next().value;
    DECODED_TILE_CACHE.delete(oldestKey);
  }
  DECODED_TILE_CACHE.set(key, value);
}

// Marine variables that should be clipped to ocean only
const MARINE_VARIABLES = new Set([
  'wave_height', 'swell_wave_height', 'secondary_swell_wave_height',
  'wind_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'wind_wave_period', 'wind_wave_direction', 'wave_period', 'wave_direction',
  'ocean_current_velocity', 'sea_surface_temperature'
]);

/**
 * Build an ocean-only GeoJSON polygon from land GeoJSON.
 * Creates a world bounding box with land polygons as holes.
 */
function buildOceanPolygon(landGeoJSON) {
  if (!landGeoJSON?.features?.length) return null;

  // World bounding box (outer ring, counter-clockwise)
  const worldRing = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

  // Collect all land polygon rings as holes (clockwise for GeoJSON holes)
  const holes = [];
  for (const feature of landGeoJSON.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      // Only take the outer ring of each land polygon as a hole
      if (geom.coordinates[0]) holes.push(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly[0]) holes.push(poly[0]);
      }
    }
  }

  if (holes.length === 0) return null;

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [worldRing, ...holes]
    },
    properties: {}
  };
}

export function registerOpenMeteoProtocol(maplibregl, setProtocolReady, MODEL_METADATA_CACHE) {
  // Register a global fetch interceptor to completely prevent 429 rate limits on latest.json metadata requests
  const globalCtx = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};
  if (globalCtx.fetch && !globalCtx.__FETCH_INTERCEPTED__) {
    globalCtx.__FETCH_INTERCEPTED__ = true;
    const originalFetch = globalCtx.fetch;
    globalCtx.fetch = function (input, init) {
      const urlString = typeof input === 'string' ? input : input?.url || '';
      
      // Fast-path: Block requests to known missing model runs or specific missing tiles in 0ms
      if (urlString.includes('map-tiles.open-meteo.com')) {
        if (MISSING_OM_TILES.has(urlString)) {
          return Promise.resolve(new Response('OM Tile Missing', {
            status: 404,
            statusText: 'Not Found'
          }));
        }
        for (const runPattern of MISSING_OM_RUNS) {
          if (urlString.includes(runPattern)) {
            // Serve 404 immediately in 0ms, preventing browser-blocking network storms
            return Promise.resolve(new Response('OM Tile Missing', {
              status: 404,
              statusText: 'Not Found'
            }));
          }
        }
      }

      if (urlString.includes('map-tiles.open-meteo.com') && urlString.includes('latest.json') && !urlString.includes('time_step=') && !urlString.includes('skip_intercept=true') && MODEL_METADATA_CACHE) {
        try {
          const urlObj = new URL(urlString);
          const parts = urlObj.pathname.split('/');
          const model = parts[2];
          if (model && MODEL_METADATA_CACHE[model] && MODEL_METADATA_CACHE[model].validTimes?.length) {
            const meta = MODEL_METADATA_CACHE[model];
            WeatherTelemetry.trackCacheHit(model, 'MODEL_METADATA_CACHE');
            const responseData = {
              completed: true,
              crs_wkt: "",
              last_modified_time: new Date().toISOString(),
              reference_time: meta.referenceTime || new Date().toISOString(),
              valid_times: meta.validTimes,
              variables: meta.variables || []
            };
            return Promise.resolve(new Response(JSON.stringify(responseData), {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'application/json' }
            }));
          } else if (model) {
            WeatherTelemetry.trackCacheMiss(model, 'MODEL_METADATA_CACHE');
          }
        } catch (err) {
          console.warn('[FETCH] [OM-Protocol] Fetch intercept parsing error:', err);
        }
      }

      let effectiveInit = init;
      if (urlString.includes('map-tiles.open-meteo.com') && urlString.includes('.om')) {
        effectiveInit = { ...init, cache: 'no-store' };
      }

      const fetchStartTime = Date.now();
      const promise = originalFetch.call(this, input, effectiveInit);

      // Inspect response and register 404s for .om tile runs
      if (urlString.includes('map-tiles.open-meteo.com') && urlString.includes('.om')) {
        return promise.then(res => {
          const duration = Date.now() - fetchStartTime;
          if (res.status === 404) {
            WeatherTelemetry.trackTileResponse(urlString, duration, 'MISS', urlString);
            WeatherTelemetry.trackTileError(urlString, duration, urlString, '404 Not Found');
            try {
              // Block the specific missing tile URL to prevent repeated 404 requests for it
              if (!MISSING_OM_TILES.has(urlString)) {
                MISSING_OM_TILES.add(urlString);
                console.warn(`[FETCH] [OM-Protocol] Precise tile registered as MISSING: ${urlString}. Future requests to this exact tile will be blocked.`);
              }
            } catch (e) { /* ignore */ }
          } else {
            WeatherTelemetry.trackTileResponse(urlString, duration, 'HIT', urlString);
          }
          return res;
        }).catch(err => {
          const duration = Date.now() - fetchStartTime;
          WeatherTelemetry.trackTileError(urlString, duration, urlString, err.message || 'Fetch failed');
          throw err;
        });
      }



      return promise;
    };
  }

  import('@openmeteo/weather-map-layer').then(({ omProtocol, defaultOmProtocolSettings }) => {
    // Forceful mutation to guarantee custom scales are used in all instances
    Object.assign(defaultOmProtocolSettings.colorScales, CUSTOM_COLOR_SCALES);

    const settings = {
      ...defaultOmProtocolSettings,
      colorScales: {
        ...defaultOmProtocolSettings.colorScales,
        ...CUSTOM_COLOR_SCALES
      }
    };
    window.__OM_PROTOCOL_SETTINGS__ = settings;

    // Fetch land GeoJSON and build ocean clipping polygon for marine layers
    // Use 50m resolution loaded from local public folder
    const NE_LAND_50M_URL = '/ne_50m_land.json';
    
    const applyLandMask = (landGeoJSON) => {
      try {
        const oceanPoly = buildOceanPolygon(landGeoJSON);
        if (oceanPoly) {
          const marineSettings = {
            ...settings,
            clippingOptions: {
              geojson: oceanPoly,
              fillRule: 'evenodd'
            }
          };
          window.__OM_MARINE_SETTINGS__ = marineSettings;
          console.log('[MODEL] [OM-Protocol] Ocean clipping polygon built with ne_50m_land:', oceanPoly.geometry.coordinates.length - 1, 'land holes');
        }
      } catch (err) {
        console.error('[MODEL] [OM-Protocol] Failed to build ocean polygon:', err);
      } finally {
        if (resolveLandMask) {
          resolveLandMask();
          resolveLandMask = null;
        }
      }
    };

    fetch(NE_LAND_50M_URL)
      .then(r => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      })
      .then(landGeoJSON => {
        applyLandMask(landGeoJSON);
      })
      .catch(err => {
        console.warn('[MODEL] [OM-Protocol] Failed to load 50m land GeoJSON, falling back to 110m:', err.message);
        fetch('/ne_110m_land.json')
          .then(r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            return r.json();
          })
          .then(landGeoJSON => {
            applyLandMask(landGeoJSON);
          })
          .catch(err2 => {
            console.error('[MODEL] [OM-Protocol] All land GeoJSON load attempts failed:', err2);
            if (resolveLandMask) {
              resolveLandMask();
              resolveLandMask = null;
            }
          });
      });

    if (maplibregl?.addProtocol) {
      try {
        maplibregl.addProtocol('om', (params, abortController) => {
          const hasWindow = typeof window !== 'undefined';
          const currentSettings = (hasWindow && window.__OM_PROTOCOL_SETTINGS__) || settings;
          const debug = (hasWindow && window.__RASTER_DEBUG__) || {};
          
          // Safe one-time init log
          if (!debug.hasLoggedProtocol) {
            if (hasWindow && window.__RASTER_DEBUG__) window.__RASTER_DEBUG__.hasLoggedProtocol = true;
            console.log('[MODEL] [OM-Protocol] Registered with', Object.keys(currentSettings.colorScales).length, 'color scales');
          }
          
           let requestedModelFolder = "";
          let urlObj = null;
          let variable = "";
          try {
            urlObj = new URL(params.url.replace('om://', ''));
            const parts = urlObj.pathname.split('/');
            if (parts[2]) {
              requestedModelFolder = parts[2];
            }
            variable = urlObj.searchParams.get('variable') || "";
          } catch (err) { /* ignore parse errors */ }

          const getSafeWorkerFallbackResponse = async (url, type) => {
            // Explicitly verify that the URL request targets a cancelled metadata configuration block
            const isAbortedJsonMeta = type === 'json' || (typeof url === 'string' && !url.includes('.om'));

            if (isAbortedJsonMeta) {
              const flawlessMockJson = {
                tilejson: "2.2.0",
                name: "om-safe-fallback",
                version: "1.0.0",
                tiles: ["om://transparent-tile/{z}/{x}/{y}.om"],
                bounds: [-180, -85, 180, 85],
                minzoom: 0,
                maxzoom: 22,
                completed: true,
                crs_wkt: "",
                last_modified_time: new Date().toISOString(),
                reference_time: new Date().toISOString(),
                valid_times: [new Date().toISOString()],
                variables: []
              };
              // Return the parsed JSON object directly to prevent MapLibre from throwing length TypeError
              return { data: flawlessMockJson };
            }

            // Standard imagery fallbacks return our valid 1x1 fully transparent PNG data container
            // Pre-compiled raw Uint8Array byte sequence avoids window.atob ReferenceError in Web Workers.
            try {
              const cleanPngBytes = new Uint8Array([
                137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96, 96, 0, 0, 0, 5, 0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
              ]);
              return { data: cleanPngBytes.buffer };
            } catch (e) {
              return { data: new ArrayBuffer(0) };
            }
          };

          // Fast-path: Block requests to known missing model runs in 0ms without throwing or logging
          if (params.url) {
            for (const runPattern of MISSING_OM_RUNS) {
              if (params.url.includes(runPattern)) {
                return getSafeWorkerFallbackResponse(params.url, params.type);
              }
            }
          }

          // Intercept local transparent-tile requests seamlessly without causing Data URI fetch exceptions
          if (params.url && params.url.includes('transparent-tile')) {
            return getSafeWorkerFallbackResponse(params.url, params.type || 'image');
          }

          // Zero-Latency Match Lock Fast-Path
          const matchResult = isModelMatch(requestedModelFolder, activeModelLock);
          if (!matchResult) {
            return getSafeWorkerFallbackResponse(params.url, params.type);
          }

          // v3.14: Use ocean-clipped settings for marine variables so land pixels are transparent
          const isMarine = variable && MARINE_VARIABLES.has(variable);

          // v3.15: Serialized concurrency lock to prevent parallel setToOmFile race condition OOM crashes
          const runProtocol = async () => {
            const tileKey = params.url || 'unknown-tile';

            // 1. Fast-path: Return cached decoded tile immediately in 0ms on hits
            if (DECODED_TILE_CACHE.has(tileKey)) {
              WeatherTelemetry.trackTileLoaded(tileKey, true);
              return DECODED_TILE_CACHE.get(tileKey);
            }

            if (isMarine) {
              await landMaskPromise;
            }

            const marineSettings = (hasWindow && window.__OM_MARINE_SETTINGS__) || null;
            const effectiveSettings = (isMarine && marineSettings) ? marineSettings : currentSettings;

            await protocolMutex.acquire();
            WeatherTelemetry.trackTileRequest(tileKey, tileKey);
            const startTime = Date.now();
            try {
              if (abortController.signal.aborted) {
                WeatherTelemetry.trackTileLoaded(tileKey, false);
                return getSafeWorkerFallbackResponse(params.url, params.type);
              }
              WeatherTelemetry.trackRasterDecodeStart(tileKey);
              const res = await omProtocol(params, abortController, effectiveSettings);
              WeatherTelemetry.trackRasterDecodeEnd(tileKey, Date.now() - startTime);
              WeatherTelemetry.trackTileLoaded(tileKey, true);
              WeatherTelemetry.trackRasterDecoded(tileKey, Date.now() - startTime);

              // 2. Cache successful decoded result
              if (res && res.data) {
                cacheDecodedTile(tileKey, res);
              }
              return res;
            } catch (err) {
              WeatherTelemetry.trackTileLoaded(tileKey, false);
              WeatherTelemetry.trackTileError(tileKey, Date.now() - startTime, tileKey, err.message || 'Decoding error');
              if (err.name === 'AbortError' || err.message?.includes('aborted')) {
                throw err;
              }
              console.error('[TRANSITION] [OM-Protocol] Async tile decoding error caught:', err, err.stack);
              return getSafeWorkerFallbackResponse(params.url, params.type);
            } finally {
              protocolMutex.release();
            }

          };

          try {
            return runProtocol();
          } catch (syncErr) {
            if (syncErr.name === 'AbortError' || syncErr.message?.includes('aborted')) {
              throw syncErr;
            }
             console.error('[TRANSITION] [OM-Protocol] Sync tile parsing error:', syncErr, syncErr.stack);
             return getSafeWorkerFallbackResponse(params.url, params.type);
          }
        });
      } catch (e) { /* already registered - will read from window.__OM_PROTOCOL_SETTINGS__ */ }
    }
    setProtocolReady(true);
  });
}

/**
 * v3.13.2: Dynamically imports clearBlockCache from @openmeteo/weather-map-layer
 * and completely clears the tile server's grid block registry.
 * Called on activeModel changes to prevent cross-model data pollution and tile corruption.
 * @returns {Promise<void>}
 */
export function clearOpenMeteoCache() {
  DECODED_TILE_CACHE.clear();
  return import('@openmeteo/weather-map-layer')
    .then(({ clearBlockCache }) => {
      return clearBlockCache()
        .then(() => {
          console.log('[CACHE] [OM-Protocol] Grid block cache cleared successfully');
        })
        .catch(err => {
          console.warn('[CACHE] [OM-Protocol] clearBlockCache execution failed:', err);
        });
    })
    .catch(err => {
      console.warn('[CACHE] [OM-Protocol] Failed to import clearBlockCache:', err);
    });
}
