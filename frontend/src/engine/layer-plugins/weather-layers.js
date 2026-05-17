/*
====================================================
 Raw Surf OS — Weather Layer Plugins
 RADAR, SATELLITE, PRESSURE, FOG
====================================================

Compatible with LayerRegistry plugin system.
NO import-time side effects, NO engine coupling.
var/function only (TDZ-immune)
====================================================
*/

// ─── RADAR LAYER ─────────────────────────────────────────────────────────────

var RadarLayerPlugin = {
  id: 'radar-plugin',
  type: 'raster',
  dataSource: 'RAINVIEWER_REFLECTIVITY',
  renderMode: 'maplibre',
  updateFrequency: 2,
  enabled: false,
  _ctx: null,

  init: function(ctx) {
    this._ctx = ctx;
    console.log('[RadarLayer] init');
  },
  update: function() { /* Radar tiles self-refresh via MapLibre source */ },
  render: function() { /* Handled by MapLibre raster layer */ },
  destroy: function() { this._ctx = null; console.log('[RadarLayer] destroyed'); },
};

// ─── SATELLITE LAYER ─────────────────────────────────────────────────────────

var SatelliteLayerPlugin = {
  id: 'satellite-plugin',
  type: 'raster',
  dataSource: 'ICON_CLOUD_COVER',
  renderMode: 'maplibre',
  updateFrequency: 5,
  enabled: false,
  _ctx: null,

  init: function(ctx) {
    this._ctx = ctx;
    console.log('[SatelliteLayer] init');
  },
  update: function() { /* Cloud cover tiles refresh on interval */ },
  render: function() { /* MapLibre raster rendering */ },
  destroy: function() { this._ctx = null; console.log('[SatelliteLayer] destroyed'); },
};

// ─── PRESSURE LAYER ──────────────────────────────────────────────────────────

var PressureLayerPlugin = {
  id: 'pressure-plugin',
  type: 'raster',
  dataSource: 'OM_PRESSURE',
  renderMode: 'maplibre',
  updateFrequency: 3,
  enabled: false,
  _ctx: null,

  init: function(ctx) {
    this._ctx = ctx;
    console.log('[PressureLayer] init');
  },
  update: function() { /* Pressure isobars update on model refresh */ },
  render: function() { /* Future: canvas overlay for isobar contours */ },
  destroy: function() { this._ctx = null; console.log('[PressureLayer] destroyed'); },
};

// ─── FOG LAYER ───────────────────────────────────────────────────────────────

var FogLayerPlugin = {
  id: 'fog-plugin',
  type: 'raster',
  dataSource: 'OM_FOG',
  renderMode: 'maplibre',
  updateFrequency: 2,
  enabled: false,
  _ctx: null,

  init: function(ctx) {
    this._ctx = ctx;
    console.log('[FogLayer] init');
  },
  update: function() { /* Low cloud cover tile refresh */ },
  render: function() { /* Semi-transparent overlay via MapLibre */ },
  destroy: function() { this._ctx = null; console.log('[FogLayer] destroyed'); },
};

export {
  RadarLayerPlugin,
  SatelliteLayerPlugin,
  PressureLayerPlugin,
  FogLayerPlugin,
};
