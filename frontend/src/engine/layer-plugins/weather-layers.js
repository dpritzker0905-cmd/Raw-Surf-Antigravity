/*
====================================================
 Raw Surf OS Weather Layer Plugins (v2)
 RADAR, SATELLITE, PRESSURE, FOG
 CONTEXT-AWARE UPDATE/RENDER
====================================================

Compatible with LayerRegistry plugin system.
NO import-time side effects, NO engine coupling.
var/function only (TDZ-immune)

UPGRADE v2:
- Radar: reads ctx.radarStream, tracks frame animation
- Satellite: reads ctx.tileService, manages tile refresh
- Pressure: reads ctx.forecast.pressureField, computes isobar data
- Fog: reads ctx.atmosphere.fogDensity, modulates visibility
====================================================
*/

// RADAR LAYER 

var RadarLayerPlugin = {
  id: 'radar-plugin',
  type: 'raster',
  dataSource: 'RAINVIEWER_REFLECTIVITY',
  renderMode: 'maplibre',
  updateFrequency: 2,
  enabled: false,
  _ctx: null,
  _data: null,
  _frameIndex: 0,
  _lastUpdate: 0,

  init: function(ctx) {
    this._ctx = ctx;
    this._data = null;
    this._frameIndex = 0;
    this._lastUpdate = 0;
    console.log('[RadarLayer] init');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    var ctx = this._ctx;
    if (!ctx) return;

    // Read latest radar frame from stream
    if (ctx.radarStream && typeof ctx.radarStream.latestFrame === 'function') {
      this._data = ctx.radarStream.latestFrame();
      this._frameIndex++;
    } else if (ctx.forecast && ctx.forecast.radar) {
      this._data = ctx.forecast.radar;
    }
  },

  render: function() {
    if (!this._data || !this._ctx) return;
    var map = this._ctx.mapInstance;
    if (!map) return;

    // Animate radar opacity for smooth frame transitions
    if (map.getLayer && map.getLayer('radar-raster-layer')) {
      try {
        var opacity = this._data ? 0.7 : 0;
        map.setPaintProperty('radar-raster-layer', 'raster-opacity', opacity);
      } catch (e) { /* layer may not exist */ }
    }
  },

  destroy: function() {
    this._ctx = null;
    this._data = null;
    console.log('[RadarLayer] destroyed');
  },

  getState: function() {
    return { frameIndex: this._frameIndex, hasData: !!this._data };
  },
};

// SATELLITE LAYER 

var SatelliteLayerPlugin = {
  id: 'satellite-plugin',
  type: 'raster',
  dataSource: 'ICON_CLOUD_COVER',
  renderMode: 'maplibre',
  updateFrequency: 5,
  enabled: false,
  _ctx: null,
  _tiles: null,
  _lastUpdate: 0,
  _coverage: 0,

  init: function(ctx) {
    this._ctx = ctx;
    this._tiles = null;
    this._lastUpdate = 0;
    this._coverage = 0;
    console.log('[SatelliteLayer] init');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    var ctx = this._ctx;
    if (!ctx) return;

    // Read satellite tiles from tile service
    if (ctx.tileService && typeof ctx.tileService.getSatelliteTiles === 'function') {
      this._tiles = ctx.tileService.getSatelliteTiles();
    } else if (ctx.forecast && ctx.forecast.cloudCover !== undefined) {
      this._coverage = ctx.forecast.cloudCover;
    }
  },

  render: function() {
    if (!this._ctx) return;
    var map = this._ctx.mapInstance;
    if (!map) return;

    // Modulate satellite layer opacity based on cloud coverage
    if (map.getLayer && map.getLayer('satellite-raster-layer')) {
      try {
        var opacity = Math.min(0.9, Math.max(0.3, this._coverage / 100));
        map.setPaintProperty('satellite-raster-layer', 'raster-opacity', opacity);
      } catch (e) { /* layer may not exist */ }
    }
  },

  destroy: function() {
    this._ctx = null;
    this._tiles = null;
    console.log('[SatelliteLayer] destroyed');
  },

  getState: function() {
    return { hasTiles: !!this._tiles, coverage: this._coverage };
  },
};

// PRESSURE LAYER 

var PressureLayerPlugin = {
  id: 'pressure-plugin',
  type: 'vector',
  dataSource: 'OM_PRESSURE',
  renderMode: 'maplibre',
  updateFrequency: 3,
  enabled: false,
  _ctx: null,
  _field: null,
  _isobars: null,
  _lastUpdate: 0,

  init: function(ctx) {
    this._ctx = ctx;
    this._field = null;
    this._isobars = null;
    this._lastUpdate = 0;
    console.log('[PressureLayer] init');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    var ctx = this._ctx;
    if (!ctx) return;

    // Read pressure field from forecast
    if (ctx.forecast && ctx.forecast.pressureField) {
      this._field = ctx.forecast.pressureField;
      // Compute isobar contour levels (every 4 hPa)
      this._isobars = computeIsobarLevels(this._field);
    }
  },

  render: function() {
    if (!this._isobars || !this._ctx) return;
    // Future: render isobar contour lines on canvas overlay
    // For now, the data is available via getState() for UI display
  },

  destroy: function() {
    this._ctx = null;
    this._field = null;
    this._isobars = null;
    console.log('[PressureLayer] destroyed');
  },

  getState: function() {
    return { hasField: !!this._field, isobarCount: this._isobars ? this._isobars.length : 0 };
  },
};

/**
 * Compute isobar contour levels from a pressure grid.
 * @param {Object} field - pressure field data
 * @returns {number[]} array of pressure levels (hPa)
 */
function computeIsobarLevels(field) {
  if (!field || !Array.isArray(field.data)) return [];
  var min = Infinity;
  var max = -Infinity;
  for (var y = 0; y < field.data.length; y++) {
    var row = field.data[y];
    if (!Array.isArray(row)) continue;
    for (var x = 0; x < row.length; x++) {
      var val = row[x];
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  // Generate levels every 4 hPa
  var levels = [];
  var start = Math.ceil(min / 4) * 4;
  for (var p = start; p <= max; p += 4) {
    levels.push(p);
  }
  return levels;
}

// FOG LAYER 

var FogLayerPlugin = {
  id: 'fog-plugin',
  type: 'raster',
  dataSource: 'OM_FOG',
  renderMode: 'maplibre',
  updateFrequency: 2,
  enabled: false,
  _ctx: null,
  _densityField: null,
  _visibility: 1.0,
  _lastUpdate: 0,

  init: function(ctx) {
    this._ctx = ctx;
    this._densityField = null;
    this._visibility = 1.0;
    this._lastUpdate = 0;
    console.log('[FogLayer] init');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    var ctx = this._ctx;
    if (!ctx) return;

    // Read fog density from atmosphere data
    if (ctx.atmosphere && ctx.atmosphere.fogDensity !== undefined) {
      this._densityField = ctx.atmosphere.fogDensity;
    } else if (ctx.forecast && ctx.forecast.lowCloudCover !== undefined) {
      // Fallback: derive fog from low cloud cover
      this._densityField = ctx.forecast.lowCloudCover;
    }

    // Compute visibility factor (inverse of density)
    if (typeof this._densityField === 'number') {
      this._visibility = Math.max(0.1, 1 - this._densityField / 100);
    }
  },

  render: function() {
    if (!this._ctx || this._densityField === null) return;
    var map = this._ctx.mapInstance;
    if (!map) return;

    // Apply fog as semi-transparent white overlay via raster opacity
    if (map.getLayer && map.getLayer('fog-raster-layer')) {
      try {
        var fogOpacity = Math.min(0.6, (1 - this._visibility) * 0.8);
        map.setPaintProperty('fog-raster-layer', 'raster-opacity', fogOpacity);
      } catch (e) { /* layer may not exist */ }
    }
  },

  destroy: function() {
    this._ctx = null;
    this._densityField = null;
    this._visibility = 1.0;
    console.log('[FogLayer] destroyed');
  },

  getState: function() {
    return { visibility: this._visibility, hasDensity: this._densityField !== null };
  },
};

export {
  RadarLayerPlugin,
  SatelliteLayerPlugin,
  PressureLayerPlugin,
  FogLayerPlugin,
  computeIsobarLevels,
};
