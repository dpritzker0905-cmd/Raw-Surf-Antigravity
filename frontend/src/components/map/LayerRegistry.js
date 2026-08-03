/* 
========================================================
 Raw Surf OS Layer Registry
 SAFE PLUGIN-BASED GEOSPATIAL LAYER SYSTEM
========================================================

RULES ENFORCED:
- NO import-time side effects
- NO WebGL initialization here
- NO MapLibre dependency
- NO engine execution
- PURE REGISTRY ONLY

This file is:
 metadata + lifecycle coordination layer
 NOT a renderer
 NOT a simulation engine
========================================================
*/

// v76: MODEL ROUTING MAPS 
// Maps the user's selected model (GFS/EURO/ICON) to the correct tile model
// for each variable group. Built from live Open-Meteo tile metadata.
// 

// Rain/cloud: ncep_gfs025 lacks precipitation. ncep_gfs013 IS GFS with precipitation.
export const PRECIP_MODEL_MAP = {
 'GFS': 'ncep_gfs013', // GFS 0.13 HAS precipitation, hourly
 'ICON': 'dwd_icon', // ICON HAS precipitation, hourly
 'EURO': 'ecmwf_ifs025', // ECMWF HAS precipitation, 3-hourly (safe: valid_times_N)
};

// Wind overlays: GFS wind components are in ncep_gfs013. Others are on atmospheric models.
export const WIND_MODEL_MAP = {
  'GFS': 'ncep_gfs013',
  'ICON': 'dwd_icon',
  'EURO': 'ecmwf_ifs025',
};

// Marine waves: GFS Wave is the most complete (swell, wind_wave, secondary).
// ECMWF WAM only has wave_height/period no swell/wind_wave decomposition.
export const MARINE_MODEL_MAP = {
  'GFS':  'ncep_gfswave025',  // Full: wave, swell, wind_wave, secondary swell
  'ICON': 'dwd_gwam',         // DWD ICON-based global wave model
  'EURO': 'ecmwf_wam025',     // Limited: wave_height/period only
};

// BACKWARD-COMPATIBLE STATIC REGISTRY 

export var LAYER_REGISTRY = {
  rain: {
    id: "rain",
    type: "raster",
    source: "ICON_PRECIPITATION",
    omVariable: "precipitation",
    category: "forecast",
    renderMode: "maplibre",
    updateFrequency: 2,
  },
  radar: {
    id: "radar",
    type: "raster",
    source: "RAINVIEWER_REFLECTIVITY",
    category: "observational",
    renderMode: "maplibre",
    updateFrequency: 2,
  },
  satellite: {
    id: "satellite",
    type: "raster",
    source: "ICON_CLOUD_COVER",
    omVariable: "cloud_cover",
    category: "imagery",
    renderMode: "maplibre",
    updateFrequency: 5,
  },
  pressure: {
    id: "pressure",
    type: "raster",
    source: "OM_PRESSURE",
    omVariable: "pressure_msl",
    category: "model",
    renderMode: "maplibre",
    updateFrequency: 3,
  },
  // TEMPERATURE PAIR (2026-07-11, pipeline-3 riders — CDN availability probed live before wiring):
  // temperature_2m is served on ALL THREE model routes (ncep_gfs013 / dwd_icon / ecmwf_ifs025) and
  // the tile library ships a registered 'temperature' color scale. Routed via the atmospheric
  // PRECIP_MODEL_MAP branch in useOpenMeteoTileUrls (same >168h/>228h GFS cutovers as rain).
  temperature: {
    id: "temperature",
    type: "raster",
    source: "OM_TEMPERATURE",
    omVariable: "temperature_2m",
    category: "model",
    renderMode: "maplibre",
    updateFrequency: 3,
  },
  // water_temp: sea_surface_temperature is NOT hosted on the tile CDN (probed 07-11: zero domains
  // carry it — the library only ships a color-scale ALIAS for it). surface_temperature = the model
  // SKIN temperature, which over ocean IS the model's SST analysis field — served on ncep_gfs013 +
  // ecmwf_ifs025; dwd_icon LACKS it (the metadata gate serves transparent tiles for ICON — the
  // established ecmwf_wam025-lacks-swell pattern, no cross-model lying). Land skin temperature is
  // hidden by rendering this layer's slots BELOW the OceanMask land fill (MapWebGL: water_temp slot
  // anchor = marineBeforeId + oceanMaskActive includes water_temp; kill __RAW_WATER_TEMP_MASK_DISABLED__).
  water_temp: {
    id: "water_temp",
    type: "raster",
    source: "OM_WATER_TEMP",
    omVariable: "surface_temperature",
    category: "model",
    renderMode: "maplibre",
    updateFrequency: 3,
  },
  fog: {
    id: "fog",
    type: "raster",
    source: "OM_FOG",
    // v75: Changed from cloud_cover_low (shows all low clouds) to visibility.
    // Only GFS tiles have visibility data. Low vis (<1km) = real fog.
    omVariable: "visibility",
    omModel: "ncep_gfs025",
    category: "model",
    renderMode: "maplibre",
    updateFrequency: 2,
  },
  wind: {
    id: "wind",
    type: "particle",
    source: "WIND_PARTICLES",
    omVariable: "wind_u_component_10m",
    category: "model",
    renderMode: "webgl",
    updateFrequency: 1,
  },
  waves: {
    id: "waves",
    type: "marine",
    source: "MARINE_WAVES",
    omVariable: "wave_height",
 // v76: No hardcoded omModel resolved dynamically via MARINE_MODEL_MAP
    omModelGroup: "marine",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  },
  swell_1: {
    id: "swell_1",
    type: "marine",
    source: "MARINE_SWELL1",
    omVariable: "swell_wave_height",
    omModelGroup: "marine",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  },
  swell_2: {
    id: "swell_2",
    type: "marine",
    source: "MARINE_SWELL2",
    omVariable: "secondary_swell_wave_height",
    omModelGroup: "marine",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  },
  wind_waves: {
    id: "wind_waves",
    type: "marine",
    source: "MARINE_WINDWAVES",
    omVariable: "wind_wave_height",
    omModelGroup: "marine",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  }
};

/**
 * Backward-compatible raster source resolver.
 * @param {string} layerId
 * @returns {string}
 */
export function resolveRasterSource(layerId) {
  var layer = LAYER_REGISTRY[layerId];
  if (!layer) {
    throw new Error(`[LRCM] Unknown layer: ${layerId}`);
  }
  return layer.source;
}


// DYNAMIC PLUGIN REGISTRY 
// Safe plugin-based layer system. No side effects. No engine coupling.
// Layers register at runtime (after engine init), not at import time.
// 

/**
 * @typedef {'raster'|'vector'|'particle'|'marine'} LayerType
 * @typedef {'webgl'|'canvas'|'maplibre'} RenderMode
 *
 * @typedef {Object} LayerPlugin
 * @property {string} id
 * @property {LayerType} type
 * @property {string} dataSource
 * @property {RenderMode} renderMode
 * @property {number} updateFrequency - update interval in seconds
 * @property {boolean} enabled
 * @property {function} [init] - called after engine.init()
 * @property {function} [update] - called from render orchestrator
 * @property {function} [render] - called from single render loop
 * @property {function} [destroy] - cleanup on removal
 *
 * @typedef {Object} LayerContext
 * @property {HTMLCanvasElement} [canvas]
 * @property {*} [mapInstance]
 * @property {*} [engine]
 * @property {Object} [config]
 */

var _pluginRegistry = new Map();

/**
 * Register a layer plugin (SAFE no side effects).
 * Must be called AFTER engine init phase.
 * @param {LayerPlugin} layer
 */
// Counts silent, expected re-bootstraps (same id, same definition). Kept as a COUNTER rather
// than a log line: `counts` survives ring eviction, a log does not — the lesson from
// __MARINE_CHURN__. Read via window.__LAYER_REGISTRY_DIAG__.
let _reregisterCount = 0;

export function registerLayerPlugin(layer) {
  if (!layer?.id) {
    throw new Error('[LayerRegistry] Invalid plugin: missing id');
  }
  const existing = _pluginRegistry.get(layer.id);
  if (existing) {
    // ⛔⛔ RE-REGISTERING AN IDENTICAL DEFINITION IS A NO-OP, NOT AN ERROR (2026-08-03).
    // `bootstrapCoreLayers` is documented "called once after engine init" but runs on EVERY init,
    // and the engine re-inits on model switches and pans. Measured live on the dev map: 9
    // engine_init / 12 engine_dispose off ~4 model clicks and 2 pans emitted **48 identical
    // console.warns in 2 ms**, and every one was captured into `__WEATHER_TELEMETRY__` as a
    // `model_warning`. The ring reader's C1 check FAILED on it: `model_warning` was 73.8% of the
    // ring, and past 50% every OTHER type in a FIFO ring with no per-type quota is an undercount.
    // So this warning was not just noise — it was DESTROYING the telemetry it shared a ring with.
    // Second instance of that class; the first was a per-frame emit (fixed `52b27146`).
    // ★ THE GUARD'S REAL PURPOSE IS PRESERVED: warn on a genuine CONFLICT — two DIFFERENT plugins
    //   claiming one id, which is a bug — and stay silent when the same static definition is simply
    //   re-bootstrapped, which is expected. Muting it outright would have thrown the guard away.
    const conflict = existing.type !== layer.type
      || existing.dataSource !== layer.dataSource
      || existing.renderMode !== layer.renderMode;
    if (conflict) {
      console.warn(`[LayerRegistry] Plugin id CONFLICT: ${layer.id} is already registered with a `
        + `different definition (type ${existing.type}/${layer.type}, `
        + `source ${existing.dataSource}/${layer.dataSource}, `
        + `render ${existing.renderMode}/${layer.renderMode}) — keeping the first.`);
    } else {
      _reregisterCount += 1;   // observable without being loud; see __LAYER_REGISTRY_DIAG__
    }
    return;
  }
  _pluginRegistry.set(layer.id, layer);
}

/** @param {string} id */
export function getLayerPlugin(id) {
  return _pluginRegistry.get(id);
}

/** @returns {LayerPlugin[]} */
export function getAllPlugins() {
  return Array.from(_pluginRegistry.values());
}

/**
 * @param {string} id
 * @param {boolean} enabled
 */
export function setPluginEnabled(id, enabled) {
  var plugin = _pluginRegistry.get(id);
  if (plugin) plugin.enabled = enabled;
}

/** @param {string} id */
export function removeLayerPlugin(id) {
  var plugin = _pluginRegistry.get(id);
  if (plugin?.destroy) plugin.destroy();
  _pluginRegistry.delete(id);
}

// LIFECYCLE HOOKS (called by engine/orchestrator, NEVER by React) 

/**
 * Initialize all enabled plugins. Called AFTER engine.init().
 * @param {LayerContext} ctx
 */
export function initPlugins(ctx) {
  _pluginRegistry.forEach((plugin) => {
    if (plugin.enabled && plugin.init) plugin.init(ctx);
  });
}

/**
 * Update all enabled plugins. Called from render orchestrator.
 * @param {number} dt - delta time in seconds
 */
export function updatePlugins(dt) {
  _pluginRegistry.forEach((plugin) => {
    if (plugin.enabled && plugin.update) plugin.update(dt);
  });
}

/** Render all enabled plugins. Called from single RAF loop. */
export function renderPlugins() {
  _pluginRegistry.forEach((plugin) => {
    if (plugin.enabled && plugin.render) plugin.render();
  });
}

/** Cleanup all plugins. */
export function destroyPlugins() {
  _pluginRegistry.forEach((plugin) => { plugin.destroy?.(); });
  _pluginRegistry.clear();
}

/**
 * Bootstrap core layers into the plugin registry from LAYER_REGISTRY.
 * Called once after engine init. Does NOT execute anything.
 */
export function bootstrapCoreLayers() {
  Object.values(LAYER_REGISTRY).forEach((layer) => {
    registerLayerPlugin({
      id: layer.id,
      type: layer.type,
      dataSource: layer.source,
      renderMode: layer.renderMode || 'maplibre',
      updateFrequency: layer.updateFrequency || 1,
      enabled: false, // enabled by user interaction, not by default
    });
  });
}

// v3.12.5: Pre-populate known model variables and valid times to avoid blocking URL resolution on layer toggle
export const MODEL_METADATA_CACHE = {};

const DEFAULT_ATMOSPHERIC_VARS = [
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'wind_u_component_10m', 'wind_v_component_10m',
  'precipitation', 'cloud_cover', 'cloud_cover_low', 'visibility', 'msl_pressure', 'fog', 'pressure_msl'
];
const DEFAULT_MARINE_VARS = [
  'wave_height', 'wave_direction', 'wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
];
const DWD_GWAM_VARS = [
  'wave_height', 'wave_direction', 'wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
];
const LIMITED_MARINE_VARS = [
  'wave_height', 'wave_direction', 'wave_period'
];

function getAlignedReferenceTime() {
  const date = new Date(Date.now() - 12 * 3600000);
  const hours = date.getUTCHours();
  const alignedHours = Math.floor(hours / 6) * 6;
  date.setUTCHours(alignedHours, 0, 0, 0);
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}
const referenceTime = getAlignedReferenceTime();

function generateDefaultTimes(intervalHours = 1, maxHours = 240, baseTimeStr = referenceTime) {
  const start = new Date(baseTimeStr);
  const times = [];
  const startOffset = Math.floor(-24 / intervalHours) * intervalHours;
  const endOffset = Math.ceil(maxHours / intervalHours) * intervalHours;
  for (let i = startOffset; i <= endOffset; i += intervalHours) {
    const d = new Date(start.getTime() + i * 3600000);
    times.push(d.toISOString().replace(/\.\d+Z$/, 'Z'));
  }
  return times;
}

function generateGfsDefaultTimes(baseTimeStr = referenceTime) {
  const start = new Date(baseTimeStr);
  const times = [];
  // GFS is hourly up to 120 hours (5 days)
  for (let i = -24; i <= 120; i++) {
    const d = new Date(start.getTime() + i * 3600000);
    times.push(d.toISOString().replace(/\.\d+Z$/, 'Z'));
  }
  // GFS becomes 3-hourly from 120h to 384h (16 days)
  for (let i = 123; i <= 384; i += 3) {
    const d = new Date(start.getTime() + i * 3600000);
    times.push(d.toISOString().replace(/\.\d+Z$/, 'Z'));
  }
  return times;
}

const defaultTimesGfs = generateGfsDefaultTimes();         // GFS atmospheric / wave: hybrid 1h/3h interval, max 16 days (384h)
const defaultTimesIconAtm = generateDefaultTimes(1, 216); // ICON atmospheric: 1h interval, max 9 days (216h)
const defaultTimesIconWav = generateDefaultTimes(3, 180); // ICON wave: 3h interval, max 7.5 days (180h)
const defaultTimesEuro = generateDefaultTimes(3, 240);    // EURO atmospheric / wave: 3h interval, max 10 days (240h)

const GFS_ATMOSPHERIC_VARS = DEFAULT_ATMOSPHERIC_VARS;

MODEL_METADATA_CACHE['ncep_gfs025'] = { variables: GFS_ATMOSPHERIC_VARS, validTimes: defaultTimesGfs, referenceTime };
MODEL_METADATA_CACHE['ncep_gfs013'] = { variables: GFS_ATMOSPHERIC_VARS, validTimes: defaultTimesGfs, referenceTime };
MODEL_METADATA_CACHE['dwd_icon'] = { variables: DEFAULT_ATMOSPHERIC_VARS, validTimes: defaultTimesIconAtm, referenceTime };
MODEL_METADATA_CACHE['ecmwf_ifs025'] = { variables: DEFAULT_ATMOSPHERIC_VARS, validTimes: defaultTimesEuro, referenceTime };
MODEL_METADATA_CACHE['ncep_gfswave025'] = { variables: DEFAULT_MARINE_VARS, validTimes: defaultTimesGfs, referenceTime };
MODEL_METADATA_CACHE['dwd_gwam'] = { variables: DWD_GWAM_VARS, validTimes: defaultTimesIconWav, referenceTime };
MODEL_METADATA_CACHE['ecmwf_wam025'] = { variables: LIMITED_MARINE_VARS, validTimes: defaultTimesEuro, referenceTime };

// Observable without being loud: how many identical re-bootstraps happened, and how many
// distinct plugins are live. A silent no-op that nobody can count is how a churn bug hides.
if (typeof window !== 'undefined') {
  window.__LAYER_REGISTRY_DIAG__ = {
    get reregisterCount() { return _reregisterCount; },
    get pluginCount() { return _pluginRegistry.size; },
    get ids() { return Array.from(_pluginRegistry.keys()); },
  };
}
