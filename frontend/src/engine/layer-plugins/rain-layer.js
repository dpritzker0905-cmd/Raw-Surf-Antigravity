/*
====================================================
 Raw Surf OS — Rain Layer Plugin
 EXTENDS LayerRegistry (NO engine coupling)
====================================================

RULES:
- NO import-time side effects
- NO engine execution
- NO DOM manipulation
- PURE registry metadata + lifecycle hooks
- var/function only (TDZ-immune)
====================================================
*/

/**
 * Rain Layer Plugin — compatible with LayerRegistry plugin system.
 * Provides lifecycle hooks for precipitation overlay rendering.
 *
 * This plugin is registered at runtime via registerLayerPlugin(),
 * NOT at import time. It extends the existing rain entry in LAYER_REGISTRY
 * with dynamic lifecycle capabilities.
 */
var RainLayerPlugin = {
  id: 'rain-plugin',
  type: 'raster',
  dataSource: 'ICON_PRECIPITATION',
  renderMode: 'maplibre',
  updateFrequency: 2,
  enabled: false,

  // Lifecycle hooks (called by render-orchestrator, NEVER by React)
  init: function(ctx) {
    console.log('[RainLayer] init', ctx?.mapInstance ? 'map-ready' : 'no-map');
    this._ctx = ctx;
    this._lastUpdate = 0;
  },

  update: function(dt) {
    // Accumulate time, only process at updateFrequency interval
    this._lastUpdate = (this._lastUpdate || 0) + dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;
    // Future: precipitation intensity interpolation
  },

  render: function() {
    // Rendering handled by MapLibre raster source —
    // this hook is for custom overlay effects (e.g. raindrop animation)
  },

  destroy: function() {
    this._ctx = null;
    console.log('[RainLayer] destroyed');
  },
};

export { RainLayerPlugin };
