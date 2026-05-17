/* 
========================================================
 Raw Surf OS — Layer Registry
 SAFE PLUGIN-BASED GEOSPATIAL LAYER SYSTEM
========================================================

RULES ENFORCED:
- NO import-time side effects
- NO WebGL initialization here
- NO MapLibre dependency
- NO engine execution
- PURE REGISTRY ONLY

This file is:
→ metadata + lifecycle coordination layer
→ NOT a renderer
→ NOT a simulation engine
========================================================
*/

// ─── BACKWARD-COMPATIBLE STATIC REGISTRY ────────────────────────────────────
// Preserves the original LAYER_REGISTRY and resolveRasterSource exports
// that MapWebGL.js and other consumers depend on.
// ─────────────────────────────────────────────────────────────────────────────

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
  fog: {
    id: "fog",
    type: "raster",
    source: "OM_FOG",
    omVariable: "cloud_cover_low",
    category: "model",
    renderMode: "maplibre",
    updateFrequency: 2,
  },
  wind: {
    id: "wind",
    type: "particle",
    source: "WIND_PARTICLES",
    omVariable: "wind_gusts_10m",
    category: "model",
    renderMode: "webgl",
    updateFrequency: 1,
  },
  waves: {
    id: "waves",
    type: "marine",
    source: "MARINE_WAVES",
    omVariable: "wave_height",
    omModel: "ncep_gfswave025",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  },
  swell_1: {
    id: "swell_1",
    type: "marine",
    source: "MARINE_SWELL1",
    omVariable: "swell_wave_height",
    omModel: "ncep_gfswave025",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  },
  swell_2: {
    id: "swell_2",
    type: "marine",
    source: "MARINE_SWELL2",
    omVariable: "secondary_swell_wave_height",
    omModel: "ncep_gfswave025",
    category: "model",
    renderMode: "canvas",
    updateFrequency: 1,
  },
  wind_waves: {
    id: "wind_waves",
    type: "marine",
    source: "MARINE_WINDWAVES",
    omVariable: "wind_wave_height",
    omModel: "ncep_gfswave025",
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


// ─── DYNAMIC PLUGIN REGISTRY ────────────────────────────────────────────────
// Safe plugin-based layer system. No side effects. No engine coupling.
// Layers register at runtime (after engine init), not at import time.
// ─────────────────────────────────────────────────────────────────────────────

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
 * Register a layer plugin (SAFE — no side effects).
 * Must be called AFTER engine init phase.
 * @param {LayerPlugin} layer
 */
export function registerLayerPlugin(layer) {
  if (!layer?.id) {
    throw new Error('[LayerRegistry] Invalid plugin: missing id');
  }
  if (_pluginRegistry.has(layer.id)) {
    console.warn(`[LayerRegistry] Plugin already registered: ${layer.id}`);
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

// ─── LIFECYCLE HOOKS (called by engine/orchestrator, NEVER by React) ────────

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
