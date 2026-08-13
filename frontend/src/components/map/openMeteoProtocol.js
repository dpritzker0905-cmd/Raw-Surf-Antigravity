import { CUSTOM_COLOR_SCALES, aliasSurfaceTemperature } from './colorScales';
import { WeatherTelemetry } from './WeatherTelemetry';
import { traceOmUrl, traceOmBlock } from './omUrlTrace';

// F4: per-tile / per-frame console output is GATED. With console capture / React Scan / PostHog
// active, an unconditional console.log per decoded tile materially amplifies tile-heavy
// interactions (the "[OM-Protocol] addProtocol callback triggered" spam fires dozens of times
// per pan/scrub). Enable verbose tile logging with globalThis.__OM_TILE_DEBUG__ = true. Works in
// both the main thread and the decode worker (globalThis). Warnings/errors stay unconditional.
function tileLog(...args) {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.__OM_TILE_DEBUG__) console.log(...args);
  } catch (e) { /* ignore */ }
}

// Custom protocol active model lock to avoid premature tile discarding
let activeModelLock = "";

// Global registry for missing Open-Meteo model runs to block 404 tile storms
const MISSING_OM_RUNS = new Set();
const MISSING_OM_TILES = new Set();

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
  
  const parent = getParentModel(folder), lockParent = getParentModel(lock);
  const l = lock.toLowerCase();
  return (parent && parent === lockParent) || parent.toLowerCase() === l || f.includes(l) || l.includes(f);
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

// ─── RUNTIME TRUTH TELEMETRY ───────────────────────────────────────────────
// Call window.__TILE_TRUTH__.report() in browser console for forensic dump
const TILE_TRUTH = {
  protocolCalls: 0,           // total omProtocol() invocations (actual decodes)
  cacheHits: 0,               // DECODED_TILE_CACHE hits (skipped decodes)
  cacheMisses: 0,             // DECODED_TILE_CACHE misses (went to decode)
  cacheFlushes: 0,            // times DECODED_TILE_CACHE was cleared
  maskUpgrades: [],           // [{resolution, timestamp, holeCount, cacheSize}]
  urlInvalidations: 0,        // times om-mask-upgraded event dispatched
  recentTiles: [],            // last 30 tile requests [{key, source, timestamp, marine}]
  currentMaskResolution: null, // '110m' or '50m'
  lastFlushTimestamp: null,
  report() {
    const r = {
      '📊 Protocol Stats': {
        'Total omProtocol() calls (actual decodes)': this.protocolCalls,
        'DECODED_TILE_CACHE hits (skipped decodes)': this.cacheHits,
        'DECODED_TILE_CACHE misses → decode': this.cacheMisses,
        'Cache flush count': this.cacheFlushes,
        'URL invalidation events': this.urlInvalidations,
        'Current mask resolution': this.currentMaskResolution,
        'Current cache size': DECODED_TILE_CACHE.size,
        'Last flush': this.lastFlushTimestamp ? new Date(this.lastFlushTimestamp).toISOString() : 'never',
      },
      '🔄 Mask Upgrades': this.maskUpgrades,
      '📦 Recent Tiles (last 30)': this.recentTiles.slice(-30).map(t => ({
        ...t,
        timestamp: new Date(t.timestamp).toISOString(),
        age: `${((Date.now() - t.timestamp) / 1000).toFixed(1)}s ago`
      })),
      '⚠️  DIAGNOSIS': this.protocolCalls === 0
        ? '🔴 NO TILES DECODED — SourceCache is serving everything from GPU cache'
        : this.cacheHits > this.protocolCalls * 2
          ? '🟡 HEAVY CACHE HITS — most tiles served from DECODED_TILE_CACHE'
          : '🟢 TILES ACTIVELY DECODING — protocol pipeline is live',
    };
    console.log('%c═══ TILE TRUTH REPORT ═══', 'color: #00ff88; font-size: 16px; font-weight: bold');
    console.table(r['📊 Protocol Stats']);
    console.log('%cMask Upgrades:', 'color: #ffaa00; font-weight: bold', r['🔄 Mask Upgrades']);
    console.log('%cRecent Tiles:', 'color: #00aaff; font-weight: bold');
    console.table(r['📦 Recent Tiles (last 30)']);
    console.log('%c' + r['⚠️  DIAGNOSIS'], 'font-size: 14px; font-weight: bold');
    return r;
  },
  reset() {
    this.protocolCalls = 0; this.cacheHits = 0; this.cacheMisses = 0;
    this.cacheFlushes = 0; this.maskUpgrades = []; this.urlInvalidations = 0;
    this.recentTiles = []; this.lastFlushTimestamp = null;
    console.log('%c[TILE_TRUTH] Reset', 'color: #ff6600');
  }
};
if (typeof window !== 'undefined') {
  window.__TILE_TRUTH__ = TILE_TRUTH;
}
// ─────────────────────────────────────────────────────────────────────────────

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

// Marine variables — identification only (no longer used for raster clipping since Phase 4A GPU migration)
// Marine rendering is now 100% GPU-driven via WebGLMarineEngine heatmap + particles.
// This set is retained for data routing and telemetry identification.
const MARINE_VARIABLES = new Set([
  'wave_height', 'swell_wave_height', 'secondary_swell_wave_height',
  'wind_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'wind_wave_period', 'wind_wave_direction', 'wave_period', 'wave_direction',
  'ocean_current_velocity', 'sea_surface_temperature'
]);

// ─── Water Temp coastal-halo fix (2026-07-11, user report: "land band halo around coastal and
// island areas") ─────────────────────────────────────────────────────────────────────────────
// surface_temperature is SKIN temperature: grid cells containing land carry land heat. Probed on
// the live decoded grid (row 0 = SOUTH, GFS ascending-lat): Catalina's cell reads 20.05°C vs
// 17.75°C open water 60km out (+2.3°C, worse by day; mainland LA cell 27.45°C) — the steep temp
// palette renders that ring as a vivid halo, and contours=true traces the fake island gradients.
// No mask POLYGON can fix data-level contamination, so land cells are OCEAN-FILLED at decode
// time (see oceanFillLandCells): coastal land-contaminated cells take their clean water
// neighbors' mean → the field stays continuous to the true coastline with water-derived values;
// unfillable deep-interior land is NaN'd (transparent, and visually under the opaque ocean-mask
// land fill regardless). Masks build per grid dimension from the same NE 50m polygons OceanMask
// uses, pre-built at protocol registration; a decode that races a still-building mask is healed
// via the rawsurf:wt-landmask-ready → &wtlm=1 URL-rotation path.
// Kill switch: globalThis.__RAW_WT_LANDMASK_DISABLED__ = true (decode runs on the main thread in
// practice — verified via window.__DECODED_OM_TILES__ being populated from the page realm).
const LAND_CELL_MASKS = {}; // `${nx}x${ny}` -> { mask, hadUnmaskedDecode } (mask null while building/failed)
let LAND_GEOJSON_PROMISE = null; // shared across per-grid builds (fetch once)

function getLandGeoJSONOnce() {
  if (!LAND_GEOJSON_PROMISE) {
    LAND_GEOJSON_PROMISE = fetch('/ne_50m_land.json').then(res => {
      if (!res.ok) throw new Error(`land geojson status ${res.status}`);
      return res.json();
    }).catch(err => { LAND_GEOJSON_PROMISE = null; throw err; });
  }
  return LAND_GEOJSON_PROMISE;
}

function ensureLandCellMask(nx, ny, bounds) {
  const key = `${nx}x${ny}`;
  const existing = LAND_CELL_MASKS[key];
  if (existing) return existing.mask;
  const entry = (LAND_CELL_MASKS[key] = { mask: null, hadUnmaskedDecode: false });
  (async () => {
    try {
      if (typeof OffscreenCanvas === 'undefined') return;
      const gj = await getLandGeoJSONOnce();
      const [w, s, e, n] = bounds;
      const canvas = new OffscreenCanvas(nx, ny);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Grid row 0 = south (probed) → draw with y = (lat - s) so canvas rows match grid rows.
      const px = (lng) => ((lng - w) / (e - w)) * nx;
      const py = (lat) => ((lat - s) / (n - s)) * ny;
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
      // ±1 cell of dilation (lineWidth is in CELLS, not km). Under the NaN regime lineWidth 2
      // over-masked coarse grids (ifs025 moats swallowed water 60km offshore), but under
      // OCEAN-FILL a dilated cell just takes its water-neighbors' mean — no holes — and the
      // margin matters: GFS's OWN landmask is more generous than NE 50m around islands/cays
      // (probed live: Great Abaco shore cells held 47.3/38.5/34.1°C midday land-skin values in
      // cells NE-50m called water — the user's "deep hot red spot" off Marsh Harbour).
      ctx.lineWidth = 2;
      const drawRings = (rings) => {
        ctx.beginPath();
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            if (i === 0) ctx.moveTo(px(lng), py(lat)); else ctx.lineTo(px(lng), py(lat));
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
        ctx.stroke();
      };
      for (const f of gj.features || []) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'Polygon') drawRings(g.coordinates);
        else if (g.type === 'MultiPolygon') g.coordinates.forEach(drawRings);
      }
      const img = ctx.getImageData(0, 0, nx, ny).data;
      const mask = new Uint8Array(nx * ny);
      for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4 + 3] > 0 ? 1 : 0;
      entry.mask = mask;
      // A decode raced past while this mask was building → the library cached an UNMASKED field
      // for that timestep (probed live: the first ecmwf_ifs025 decode after a model switch kept
      // Catalina at 20.2°C). Nudge the slot machinery to re-point wt URLs (&wtlm=1) → fresh
      // decode through the now-ready mask. Main-thread decode path (verified); worker path skips.
      if (entry.hadUnmaskedDecode && typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('rawsurf:wt-landmask-ready')); } catch (e) { /* noop */ }
      }
    } catch (err) {
      console.warn('[OM-Protocol] Water-temp land mask build failed (halo fix inactive):', err && err.message);
    }
  })();
  return null;
}

// Ocean-fill: replace land-contaminated cells with the mean of their clean WATER neighbors
// (breadth-first, 3 dilation passes), then NaN whatever land remains unfilled (deep interior —
// visually covered by the opaque ocean-mask land fill anyway). Straight NaN-ing every
// land-touching cell was scientifically honest but product-fatal on coarse grids: at ifs025
// (0.25°≈28km/cell) the whole SoCal bight rendered as an empty moat around land — worse than the
// halo it replaced. Fill keeps the field continuous to the true (vector-mask) coastline with
// plausible nearshore values; the palette shows water-derived temps only.
function oceanFillLandCells(values, landMask, nx, ny) {
  const state = Uint8Array.from(landMask); // 1 = land, not yet filled; 0 = water / filled source
  const PASSES = 3;
  for (let p = 0; p < PASSES; p++) {
    const filled = [];
    for (let y = 0; y < ny; y++) {
      const row = y * nx;
      for (let x = 0; x < nx; x++) {
        const i = row + x;
        if (state[i] !== 1) continue;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ny) continue;
          const rr = yy * nx;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= nx) continue;
            const j = rr + xx;
            if (state[j] === 0) {
              const vv = values[j];
              if (vv !== null && !Number.isNaN(vv)) { sum += vv; cnt++; }
            }
          }
        }
        if (cnt > 0) { values[i] = sum / cnt; filled.push(i); }
      }
    }
    if (!filled.length) break;
    for (let k = 0; k < filled.length; k++) state[filled[k]] = 0;
  }
  for (let i = 0; i < state.length; i++) { if (state[i] === 1) values[i] = NaN; }
}

// Coastal outlier QC (2026-07-11, "deep hot red spot off Marsh Harbour"): the dilated NE mask
// misses cells the MODEL's landmask calls land (thin cays absent from NE 50m), which render raw
// land-skin temps (probed: 47.3°C in Bahamas water at midday). Standard SST coastal QC: within 2
// cells of the coastline, a cell >3°C from the local water median (9×9 at stride 2 ≈ ±4 cells;
// median resists the contaminated minority) is ocean-filled. Symmetric — land runs hot by day,
// cold by night. Real fronts survive: deviation from a ±50km median stays ~2-3°C even at the Gulf
// Stream wall, Bahamas banks ~+1.5-2°C. Kill: globalThis.__RAW_WT_COASTAL_QC_DISABLED__.
function coastalOutlierQC(values, landMask, nx, ny) {
  const augmented = Uint8Array.from(landMask);
  // ring = non-land cells within Chebyshev distance 2 of land (stamped from land cells)
  const ring = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    const row = y * nx;
    for (let x = 0; x < nx; x++) {
      if (landMask[row + x] !== 1) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        const rr = yy * nx;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          const j = rr + xx;
          if (landMask[j] === 0) ring[j] = 1;
        }
      }
    }
  }
  const windowVals = [];
  for (let y = 0; y < ny; y++) {
    const row = y * nx;
    for (let x = 0; x < nx; x++) {
      const i = row + x;
      if (ring[i] !== 1) continue;
      const v = values[i];
      if (v === null || Number.isNaN(v)) continue;
      windowVals.length = 0;
      for (let dy = -4; dy <= 4; dy += 2) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        const rr = yy * nx;
        for (let dx = -4; dx <= 4; dx += 2) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          const j = rr + xx;
          if (landMask[j] === 0) {
            const wv = values[j];
            if (wv !== null && !Number.isNaN(wv)) windowVals.push(wv);
          }
        }
      }
      if (windowVals.length < 5) continue; // not enough clean context — leave the cell alone
      windowVals.sort((a, b) => a - b);
      const median = windowVals[windowVals.length >> 1];
      if (Math.abs(v - median) > 3.0) augmented[i] = 1;
    }
  }
  return augmented;
}

// Eager pre-build for the two known water-temp grids (probed dims/bounds 2026-07-11: gfs013
// 3072×1536 / ifs025 1440×721, both row-0-SOUTH — verified with Sahara/Antarctica probe pairs on
// live decoded grids). Kicked at protocol registration so the mask wins the race against the
// first surface_temperature decode; if OM ever changes dims, the lazy per-dims build still
// covers it (with the wt-landmask-ready nudge healing the cached first frame).
function prebuildWaterTempLandMasks() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.__RAW_WT_LANDMASK_DISABLED__ === true) return;
    ensureLandCellMask(3072, 1536, [-180, -89.912126125, 180, 90.029275475]);
    ensureLandCellMask(1440, 721, [-180, -90, 180, 90.25]);
  } catch (e) { /* halo fix must never break protocol registration */ }
}

// NOTE: Marine ocean clipping polygon system (buildOceanPolygon, applyLandMask,
// 110m/50m land mask loading) REMOVED in Phase 4A.
// Marine rendering is now 100% GPU-driven via WebGLMarineEngine.
// The GPU engine uses the isOcean flag from API data for coastline masking,
// not GeoJSON polygon clipping. No land mask loading needed for marine.
// OceanMask.js loads its own land GeoJSON for visual basemap masking.

export function registerOpenMeteoProtocol(maplibregl, setProtocolReady, MODEL_METADATA_CACHE) {
  // Water-temp halo fix: start the land-cell mask builds NOW so they win the race against the
  // first surface_temperature decode (a lazy-only build let the first frame render unmasked and
  // the library cached it — probed live on the first ecmwf decode after a model switch).
  prebuildWaterTempLandMasks();
  // Initialize main-thread listener for BroadcastChannel cross-thread decoded tiles bridge
  if (typeof window !== 'undefined') {
    if (!window.__DECODED_OM_TILES__) {
      window.__DECODED_OM_TILES__ = new Map();
    }
    try {
      if (!window.__OM_BROADCAST_CHANNEL__) {
        const channel = new BroadcastChannel('om-decoded-tiles');
        channel.onmessage = (event) => {
          const payload = event.data;
          if (payload && payload.cacheKey && window.__DECODED_OM_TILES__) {
            tileLog(`[OM-Protocol-Main] Decoded tile received. Variable: ${payload.variable}, Bounds: ${payload.bounds?.join(',')}, ValueCount: ${payload.values?.length}, Dimensions: ${payload.nx}x${payload.ny}, TimeIndex: ${payload.timeIndex}`);
            window.__DECODED_OM_TILES__.set(payload.cacheKey, {
              values: payload.values,
              directions: payload.directions,
              bounds: payload.bounds,
              variable: payload.variable,
              model: payload.model,
              timestamp: payload.timestamp,
              nx: payload.nx,
              ny: payload.ny,
              timeIndex: payload.timeIndex
            });
            
            if (window.__DECODED_OM_TILES__.size > 150) {
              const oldestKey = window.__DECODED_OM_TILES__.keys().next().value;
              window.__DECODED_OM_TILES__.delete(oldestKey);
            }
          }
        };
        window.__OM_BROADCAST_CHANNEL__ = channel;
        console.log('[OM-Protocol] BroadcastChannel listener registered successfully on main thread.');
      }
    } catch (e) {
      console.warn('[OM-Protocol] BroadcastChannel setup failed on main thread:', e);
    }
  }

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

  import('@openmeteo/weather-map-layer').then(({ omProtocol, defaultOmProtocolSettings, GridFactory }) => {
    // Forceful mutation so custom scales win everywhere; then alias surface_temperature ->
    // the library's sea_surface_temperature (colorScales.aliasSurfaceTemperature says why).
    Object.assign(defaultOmProtocolSettings.colorScales, CUSTOM_COLOR_SCALES);
    aliasSurfaceTemperature(defaultOmProtocolSettings.colorScales);

    const settings = {
      ...defaultOmProtocolSettings,
      colorScales: {
        ...defaultOmProtocolSettings.colorScales,
        ...CUSTOM_COLOR_SCALES
      },
      postReadCallback(omFileReader, data, state) {
        tileLog("[OM-Protocol-Callback] postReadCallback triggered! Data exists:", !!data, "values exists:", !!data?.values, "state exists:", !!state);
        if (!data || !data.values) return;

        // Raster tile-decode timing probe (opt-in: window.__PRECIP_TILE_DIAG__ = true). The precip-
        // after-marine residual is cold .om tile fetch+decode (metadata is already prewarmed at mount
        // and the raster slots are resident, so it's neither of those). This records, per variable,
        // the decoded-tile count + the span from the first to the latest decode, so we can quantify
        // the real cost on a visible tab (reset window.__PRECIP_TILE_DIAG_DATA__ = {} before a toggle).
        // Zero-cost when off; never throws.
        try {
          if (typeof window !== 'undefined' && window.__PRECIP_TILE_DIAG__ === true) {
            const v = state?.dataOptions?.variable || 'unknown';
            const reg = (window.__PRECIP_TILE_DIAG_DATA__ = window.__PRECIP_TILE_DIAG_DATA__ || {});
            const now = Date.now();
            const e = (reg[v] = reg[v] || { count: 0, firstTs: now, lastTs: now, spanMs: 0 });
            e.count++;
            e.lastTs = now;
            e.spanMs = e.lastTs - e.firstTs;
          }
        } catch (e) { /* probe must never break tile decoding */ }
        
        let bounds = state.dataOptions?.bounds;
        const variable = state.dataOptions?.variable;
        let resolvedGrid = null;
        
        if (state.dataOptions?.domain?.grid) {
          try {
            resolvedGrid = GridFactory.create(state.dataOptions.domain.grid, null);
            if (!bounds) {
              bounds = resolvedGrid.getBounds();
              tileLog(`[OM-Protocol-Callback] Resolved bounds from domain grid:`, bounds);
            }
          } catch (e) {
            console.warn(`[OM-Protocol-Callback] Failed to get grid bounds:`, e.message);
          }
        }
        
        if (bounds && variable) {
          // Water Temp coastal-halo fix: NaN land cells (see LAND_CELL_MASKS above). Runs before
          // the side-channel store/broadcast so every consumer sees the masked field.
          try {
            const landmaskOff = typeof globalThis !== 'undefined' && globalThis.__RAW_WT_LANDMASK_DISABLED__ === true;
            if (variable === 'surface_temperature' && !landmaskOff && resolvedGrid && resolvedGrid.nx && resolvedGrid.ny
                && data.values && data.values.length === resolvedGrid.nx * resolvedGrid.ny) {
              const mask = ensureLandCellMask(resolvedGrid.nx, resolvedGrid.ny, bounds);
              if (mask) {
                const qcOff = typeof globalThis !== 'undefined' && globalThis.__RAW_WT_COASTAL_QC_DISABLED__ === true;
                const workMask = qcOff ? mask : coastalOutlierQC(data.values, mask, resolvedGrid.nx, resolvedGrid.ny);
                oceanFillLandCells(data.values, workMask, resolvedGrid.nx, resolvedGrid.ny);
              } else {
                const entry = LAND_CELL_MASKS[`${resolvedGrid.nx}x${resolvedGrid.ny}`];
                if (entry) entry.hadUnmaskedDecode = true; // heal via wt-landmask-ready once built
              }
            }
          } catch (e) { /* halo fix must never break tile decoding */ }

          let model = state.dataOptions?.domain?.value;
          if (!model && state.omFileUrl) {
            const urlParts = state.omFileUrl.split('/');
            model = urlParts.find(p => p.includes('wave') || p.includes('wam') || p.includes('gwam') || p.includes('gfs') || p.includes('icon') || p.includes('ifs') || p.includes('ecmwf'));
          }
          if (!model) {
            const isMarineVar = MARINE_VARIABLES.has(variable);
            model = isMarineVar ? 'ncep_gfswave025' : 'gfs_seamless';
            console.warn(`[OM-Protocol-Callback] Model not resolved for variable "${variable}". Defensive fallback used: "${model}"`);
          }

          let timeIndex = 0;
          if (state.omFileUrl) {
            const match = state.omFileUrl.match(/time_step=valid_times_(\d+)/);
            if (match) {
              timeIndex = parseInt(match[1], 10);
            } else {
              // Forensic Date-Time Extraction and Metadata Matching
              const timeMatch = state.omFileUrl.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})?:?(\d{2})?/);
              if (timeMatch) {
                const year = parseInt(timeMatch[1], 10);
                const month = parseInt(timeMatch[2], 10) - 1;
                const day = parseInt(timeMatch[3], 10);
                const hour = parseInt(timeMatch[4], 10);
                const min = timeMatch[5] ? parseInt(timeMatch[5], 10) : 0;
                const sec = timeMatch[6] ? parseInt(timeMatch[6], 10) : 0;
                const targetTimeMs = Date.UTC(year, month, day, hour, min, sec);
                
                const meta = MODEL_METADATA_CACHE?.[model];
                if (meta && Array.isArray(meta.validTimes) && meta.validTimes.length > 0) {
                  let minDiff = Infinity;
                  for (let i = 0; i < meta.validTimes.length; i++) {
                    const diff = Math.abs(new Date(meta.validTimes[i]).getTime() - targetTimeMs);
                    if (diff < minDiff) {
                      minDiff = diff;
                      timeIndex = i;
                    }
                  }
                  tileLog(`[FORENSIC-INDEX] Match successful: url date ${new Date(targetTimeMs).toISOString()} maps to validTimes index ${timeIndex} (${meta.validTimes[timeIndex]}) for model ${model}`);
                } else {
                  // Fallback: estimate timeIndex using forecast hours diff from reference time
                  const refTime = meta?.referenceTime ? new Date(meta.referenceTime) : new Date();
                  const hoursDiff = Math.round((targetTimeMs - refTime.getTime()) / 3600000);
                  const hoursPerStep = (model.includes('wave') || model.includes('wam') || model.includes('gwam')) ? 3 : 1;
                  timeIndex = Math.max(0, Math.round(hoursDiff / hoursPerStep));
                  tileLog(`[FORENSIC-INDEX] validTimes cache miss: url date ${new Date(targetTimeMs).toISOString()} estimated index ${timeIndex} for model ${model}`);
                }
              }
            }
          }
          if (timeIndex === 0 && state.ranges && state.ranges[0]) {
            timeIndex = state.ranges[0].start;
          }
          const cacheKey = `${variable}|${model}|${bounds.join(',')}|${timeIndex}`;
          const tilePayload = {
            cacheKey,
            values: data.values,
            directions: data.directions,
            bounds: bounds,
            variable: variable,
            model: model,
            timestamp: Date.now(),
            nx: resolvedGrid ? resolvedGrid.nx : undefined,
            ny: resolvedGrid ? resolvedGrid.ny : undefined,
            timeIndex
          };
          
          // Cross-thread communication: Broadcast decoded tile payload to main thread via persistent BroadcastChannel
          if (typeof window !== 'undefined' && window.__DECODED_OM_TILES__) {
            tileLog(`[OM-Protocol-Direct] Stored decoded tile directly on main thread. Variable: ${variable}, Model: ${model}, Bounds: ${bounds.join(',')}, ValueCount: ${data.values?.length}, Dimensions: ${tilePayload.nx}x${tilePayload.ny}, TimeIndex: ${timeIndex}`);
            window.__DECODED_OM_TILES__.set(cacheKey, {
              values: data.values,
              directions: data.directions,
              bounds: bounds,
              variable: variable,
              model: model,
              timestamp: Date.now(),
              nx: tilePayload.nx,
              ny: tilePayload.ny,
              timeIndex
            });
            
            if (window.__DECODED_OM_TILES__.size > 150) {
              const oldestKey = window.__DECODED_OM_TILES__.keys().next().value;
              window.__DECODED_OM_TILES__.delete(oldestKey);
            }
          }

          try {
            const globalCtx = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
            if (!globalCtx.__OM_BROADCAST_CHANNEL_WORKER__) {
              globalCtx.__OM_BROADCAST_CHANNEL_WORKER__ = new BroadcastChannel('om-decoded-tiles');
              console.log('[OM-Protocol-Worker] Persistent BroadcastChannel initialized successfully.');
            }
            globalCtx.__OM_BROADCAST_CHANNEL_WORKER__.postMessage(tilePayload);
            tileLog(`[OM-Protocol-Worker] Broadcasted decoded tile for ${variable} (bounds: ${bounds.join(',')})`);
          } catch (e) {
            console.warn('[OM-Protocol-Worker] BroadcastChannel failed to send in worker:', e);
            // Worker-self fallback just in case
            if (typeof self !== 'undefined') {
              if (!self.__DECODED_OM_TILES_FALLBACK__) {
                self.__DECODED_OM_TILES_FALLBACK__ = new Map();
              }
              self.__DECODED_OM_TILES_FALLBACK__.set(cacheKey, tilePayload);
            }
          }
        }
      }
    };
    window.__OM_PROTOCOL_SETTINGS__ = settings;

    // Global programmatic GRIB tile prefetcher for marine waves (bypasses MapLibre entirely)
    window.__FETCH_OM_TILE__ = async (variable, timeIndex, model = 'ncep_gfswave025') => {
      if (typeof window === 'undefined') return;
      const url = `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${timeIndex}&variable=${variable}`;
      
      const abortController = new AbortController();
      const currentSettings = window.__OM_PROTOCOL_SETTINGS__ || settings;
      
      try {
        // 1. Fetch JSON metadata first to initialize domain grid structure
        await omProtocol({ url, type: 'json' }, abortController, currentSettings);
        
        // 2. Request top-level tile (0/0/0) to trigger ensureData GRIB load and decode in postReadCallback
        await omProtocol({ url: `${url}/0/0/0`, type: 'arrayBuffer' }, abortController, currentSettings);
      } catch (e) {
        // Fail silently
      }
    };
    // NOTE: Marine ocean clipping polygon system REMOVED in Phase 4A.
    // Marine rendering is now 100% GPU-driven via WebGLMarineEngine.
    // The GPU engine uses isOcean flag from data texture for coastline masking.
    // Removed: buildOceanPolygon, applyLandMask, 110m/50m land mask loading,
    // om-mask-upgraded event dispatch, __OM_MARINE_SETTINGS__.

    if (maplibregl?.addProtocol) {
      try {
        maplibregl.addProtocol('om', (params, abortController) => {
          traceOmUrl(params && params.url);   // no-op unless __OM_URL_TRACE__ is armed
          const hasWindow = typeof window !== 'undefined';
          const currentSettings = (hasWindow && window.__OM_PROTOCOL_SETTINGS__) || settings;
          const debug = (hasWindow && window.__RASTER_DEBUG__) || {};
          // Per-tile callback log fires for every tile (332+ lines in a normal session);
          // gate it behind window.__RASTER_DEBUG__ so it does not amplify main-thread +
          // console-recording overhead in production. One-time init/failure logs below stay.
          if (hasWindow && window.__RASTER_DEBUG__) {
            tileLog("[OM-Protocol] addProtocol callback triggered! URL:", params.url, "hasWindow:", hasWindow, "hasCallback:", typeof currentSettings.postReadCallback === 'function');
          }
          
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

          // [RASTER PROBE] (__RASTER_DEBUG__; OFF in prod → zero cost) captures the tile ZOOMS
          // MapLibre requests: maxZ ≤10 at map z13 → overzoom works (clearing is decode/render);
          // maxZ >10 → maxzoom:10 is not taking. Sibling: omUrlTrace.js records the full z/x/y.
          if (hasWindow && window.__RASTER_DEBUG__ && urlObj) {
            try {
              const segs = urlObj.pathname.split('/').filter(Boolean);
              const tail = segs.slice(-3); // expected XYZ scheme: [z, x, y(.om|.json)]
              const last = tail[tail.length - 1] || '';
              const probe = (window.__RASTER_PROBE__ = window.__RASTER_PROBE__ || { maxZ: 0, byKey: {}, recent: [], jsonReqs: 0 });
              if (last.endsWith('.om')) {
                const z = Number(tail[0]);
                if (Number.isFinite(z)) {
                  const key = variable || requestedModelFolder || 'unknown';
                  probe.maxZ = Math.max(probe.maxZ, z);
                  probe.byKey[key] = Math.max(probe.byKey[key] || 0, z);
                  probe.recent.push({ z, path: tail.join('/'), key, t: Date.now() });
                  if (probe.recent.length > 150) probe.recent.shift();
                }
              } else if (last.endsWith('.json')) {
                probe.jsonReqs++;
              }
            } catch (e) { /* a probe must never break the protocol */ }
          }

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
                return traceOmBlock('missing_run', runPattern) || getSafeWorkerFallbackResponse(params.url, params.type);
              }
            }
          }

          // Intercept local transparent-tile requests seamlessly without causing Data URI fetch exceptions
          if (params.url && params.url.includes('transparent-tile')) {
            return traceOmBlock('transparent_sentinel') || getSafeWorkerFallbackResponse(params.url, params.type || 'image');
          }

          // Zero-Latency Match Lock Fast-Path
          const matchResult = isModelMatch(requestedModelFolder, activeModelLock);
          if (!matchResult) {
            return traceOmBlock('model_lock', requestedModelFolder + '|' + activeModelLock) || getSafeWorkerFallbackResponse(params.url, params.type);
          }

          // Marine identification: Let it run through the WASM decoder so our postReadCallback can cache
          // the raw numerical wave heights/directions, but we will return a transparent fallback at the end.
          const isMarine = variable && MARINE_VARIABLES.has(variable);
          const effectiveSettings = currentSettings;

          // v3.15: Serialized concurrency lock to prevent parallel setToOmFile race condition OOM crashes
          const runProtocol = async () => {
            const tileKey = params.url || 'unknown-tile';

            // 1. Fast-path: Return cached decoded tile immediately in 0ms on hits (exempt marine variables to guarantee main-thread broadcast updates)
            if (!isMarine && DECODED_TILE_CACHE.has(tileKey)) {
              TILE_TRUTH.cacheHits++;
              TILE_TRUTH.recentTiles.push({ key: tileKey.slice(-60), source: 'CACHE_HIT', timestamp: Date.now(), marine: isMarine });
              if (TILE_TRUTH.recentTiles.length > 50) TILE_TRUTH.recentTiles.shift();
              WeatherTelemetry.trackTileLoaded(tileKey, true);
              return DECODED_TILE_CACHE.get(tileKey);
            }

            if (abortController.signal.aborted) {
              throw new DOMException('The user aborted a request.', 'AbortError');
            }

            await protocolMutex.acquire();
            WeatherTelemetry.trackTileRequest(tileKey, tileKey);
            const startTime = Date.now();
            try {
              if (abortController.signal.aborted) {
                WeatherTelemetry.trackTileLoaded(tileKey, false);
                throw new DOMException('The user aborted a request.', 'AbortError');
              }
              WeatherTelemetry.trackRasterDecodeStart(tileKey);
              const res = await omProtocol(params, abortController, effectiveSettings);
              TILE_TRUTH.protocolCalls++;
              TILE_TRUTH.cacheMisses++;
              const clipApplied = !!(effectiveSettings?.clippingOptions?.geojson);
              TILE_TRUTH.recentTiles.push({
                key: tileKey.slice(-60),
                source: 'DECODE',
                timestamp: Date.now(),
                marine: isMarine,
                ms: Date.now() - startTime,
                mask: TILE_TRUTH.currentMaskResolution,
                clipApplied,
                settingsRef: isMarine ? 'marine' : 'default'
              });
              if (TILE_TRUTH.recentTiles.length > 50) TILE_TRUTH.recentTiles.shift();
              WeatherTelemetry.trackRasterDecodeEnd(tileKey, Date.now() - startTime);
              WeatherTelemetry.trackTileLoaded(tileKey, true);
              WeatherTelemetry.trackRasterDecoded(tileKey, Date.now() - startTime);

              // 2. Cache successful decoded result
              if (res && res.data) {
                cacheDecodedTile(tileKey, res);
              }
              const isFallbackActive = params.url && params.url.includes('webgl_fallback=true');
              if (isMarine && !isFallbackActive) {
                return getSafeWorkerFallbackResponse(params.url, params.type || 'image');
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
  if (typeof window !== 'undefined' && window.__DECODED_OM_TILES__) {
    window.__DECODED_OM_TILES__.clear();
    console.log('[CACHE] [OM-Protocol] Main-thread window.__DECODED_OM_TILES__ cleared successfully');
  }
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
