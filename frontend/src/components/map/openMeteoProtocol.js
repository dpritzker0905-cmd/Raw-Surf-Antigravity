import { CUSTOM_COLOR_SCALES } from './colorScales';
import { WeatherTelemetry } from './WeatherTelemetry';

// Custom protocol active model lock to avoid premature tile discarding
let activeModelLock = "";

// Global registry for missing Open-Meteo model runs to block 404 tile storms
const MISSING_OM_RUNS = new Set();
const MISSING_OM_TILES = new Set();

export const setMapActiveModelLock = (modelName) => {
  activeModelLock = modelName;
  console.log('[OM-Protocol] Active model lock target set to:', activeModelLock);
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

// Global Mutex to serialize all tile decoding requests and prevent parallel setToOmFile race condition OOM crashes
class ProtocolMutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }
  acquire() {
    if (!this.locked) {
      this.locked = true;
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
      this.locked = false;
    }
  }
}
const protocolMutex = new ProtocolMutex();

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
          console.warn('[OM-Protocol] Fetch intercept parsing error:', err);
        }
      }

      const fetchStartTime = Date.now();
      const promise = originalFetch.apply(this, arguments);

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
                console.warn(`[OM-Protocol] Precise tile registered as MISSING: ${urlString}. Future requests to this exact tile will be blocked.`);
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
    // Use 110m resolution cached in localStorage for sub-1ms instant loading (loaded from local public folder)
    const NE_LAND_110M_URL = '/ne_110m_land.json';
    
    const applyLandMask = (landGeoJSON) => {
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
        console.log('[OM-Protocol] Ocean clipping polygon built:', oceanPoly.geometry.coordinates.length - 1, 'land holes');
      }
    };

    let cachedMask = null;
    try {
      cachedMask = localStorage.getItem('om_land_mask_110m');
    } catch (e) {
      console.warn('[OM-Protocol] LocalStorage access failed:', e);
    }

    if (cachedMask) {
      try {
        const parsed = JSON.parse(cachedMask);
        applyLandMask(parsed);
        console.log('[OM-Protocol] Land mask hydrated instantly from localStorage cache (0ms)');
      } catch (err) {
        console.warn('[OM-Protocol] Failed to parse cached land mask:', err);
        localStorage.removeItem('om_land_mask_110m');
        cachedMask = null;
      }
    }

    if (!cachedMask) {
      fetch(NE_LAND_110M_URL)
        .then(r => r.json())
        .then(landGeoJSON => {
          applyLandMask(landGeoJSON);
          try {
            localStorage.setItem('om_land_mask_110m', JSON.stringify(landGeoJSON));
            console.log('[OM-Protocol] Land mask cached in localStorage (300 KB)');
          } catch (e) {
            console.warn('[OM-Protocol] Failed to cache land mask in localStorage:', e);
          }
        })
        .catch(err => {
          console.warn('[OM-Protocol] Failed to build ocean clipping polygon:', err.message);
        });
    }

    if (maplibregl?.addProtocol) {
      try {
        maplibregl.addProtocol('om', (params, abortController) => {
          const hasWindow = typeof window !== 'undefined';
          const currentSettings = (hasWindow && window.__OM_PROTOCOL_SETTINGS__) || settings;
          const debug = (hasWindow && window.__RASTER_DEBUG__) || {};
          
          // Safe one-time init log
          if (!debug.hasLoggedProtocol) {
            if (hasWindow && window.__RASTER_DEBUG__) window.__RASTER_DEBUG__.hasLoggedProtocol = true;
            console.log('[OM-Protocol] Registered with', Object.keys(currentSettings.colorScales).length, 'color scales');
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
          const marineSettings = (hasWindow && window.__OM_MARINE_SETTINGS__) || null;
          const effectiveSettings = (isMarine && marineSettings) ? marineSettings : currentSettings;

          // v3.15: Serialized concurrency lock to prevent parallel setToOmFile race condition OOM crashes
          const runProtocol = async () => {
            await protocolMutex.acquire();
            const tileKey = params.url || 'unknown-tile';
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
              return res;
            } catch (err) {
              WeatherTelemetry.trackTileLoaded(tileKey, false);
              WeatherTelemetry.trackTileError(tileKey, Date.now() - startTime, tileKey, err.message || 'Decoding error');
              if (err.name === 'AbortError' || err.message?.includes('aborted')) {
                throw err;
              }
              console.error('[OM-Protocol] Async tile decoding error caught:', err, err.stack);
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
            console.error('[OM-Protocol] Sync tile parsing error:', syncErr, syncErr.stack);
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
  return import('@openmeteo/weather-map-layer')
    .then(({ clearBlockCache }) => {
      return clearBlockCache()
        .then(() => {
          console.log('[OM-Protocol] Grid block cache cleared successfully');
        })
        .catch(err => {
          console.warn('[OM-Protocol] clearBlockCache execution failed:', err);
        });
    })
    .catch(err => {
      console.warn('[OM-Protocol] Failed to import clearBlockCache:', err);
    });
}
