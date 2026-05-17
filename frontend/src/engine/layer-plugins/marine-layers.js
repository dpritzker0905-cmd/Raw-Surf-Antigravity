/*
====================================================
 Raw Surf OS — Marine Layer Plugins (v2)
 WAVES, SWELL 1, SWELL 2, WIND WAVES
 CONTEXT-AWARE MARINE DATA FLOW
====================================================

Compatible with LayerRegistry plugin system.
Extends existing marine particle rendering (GPUMarineLayer).
NO import-time side effects, NO engine coupling.
var/function only (TDZ-immune)

UPGRADE v2:
- Each layer reads from ctx.marineData / ctx.forecast
- Computes wave energy, direction, period from forecast
- Feeds computed fields into GPUMarineLayer via context
- Tracks per-layer statistics for UI display
====================================================
*/

// ─── SHARED HELPERS ──────────────────────────────────────────────────────────

/**
 * Extract marine field from context by variable name.
 * @param {Object} ctx
 * @param {string} varName - e.g. 'wave_height', 'swell_wave_height'
 * @returns {Object|null}
 */
function extractMarineField(ctx, varName) {
  if (!ctx) return null;

  // Direct marine data source
  if (ctx.marineData && ctx.marineData[varName] !== undefined) {
    return ctx.marineData[varName];
  }

  // Forecast provider fallback
  if (ctx.forecast && ctx.forecast.waves) {
    var waves = ctx.forecast.waves;
    if (waves[varName] !== undefined) return waves[varName];
  }

  return null;
}

/**
 * Compute mean value from a 2D grid.
 * @param {number[][]|Float32Array} grid
 * @returns {number}
 */
function computeGridMean(grid) {
  if (!grid) return 0;
  var sum = 0;
  var count = 0;

  if (Array.isArray(grid)) {
    for (var y = 0; y < grid.length; y++) {
      var row = grid[y];
      if (!Array.isArray(row)) continue;
      for (var x = 0; x < row.length; x++) {
        if (typeof row[x] === 'number' && !isNaN(row[x])) {
          sum += row[x];
          count++;
        }
      }
    }
  } else if (grid.length !== undefined) {
    // Float32Array / typed array
    for (var i = 0; i < grid.length; i++) {
      if (!isNaN(grid[i])) { sum += grid[i]; count++; }
    }
  }

  return count > 0 ? sum / count : 0;
}

// ─── WAVES (SIGNIFICANT WAVE HEIGHT) ─────────────────────────────────────────

var WavesLayerPlugin = {
  id: 'waves-plugin',
  type: 'marine',
  dataSource: 'MARINE_WAVES',
  renderMode: 'canvas',
  updateFrequency: 1,
  enabled: false,
  _ctx: null,
  _lastUpdate: 0,
  _data: null,
  _meanHeight: 0,

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    this._data = null;
    this._meanHeight = 0;
    console.log('[WavesLayer] init — wave_height');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    // Read wave height field from context
    this._data = extractMarineField(this._ctx, 'wave_height');
    if (this._data) {
      this._meanHeight = computeGridMean(this._data);
    }

    // Push computed data into context for GPUMarineLayer consumption
    if (this._ctx && this._data) {
      this._ctx.waveHeightField = this._data;
      this._ctx.waveHeightMean = this._meanHeight;
    }
  },

  render: function() {
    // GPUMarineLayer reads waveHeightField from context
    // This plugin only coordinates data → no direct rendering
  },

  destroy: function() {
    this._ctx = null;
    this._data = null;
    console.log('[WavesLayer] destroyed');
  },

  getState: function() {
    return { meanHeight: this._meanHeight, hasData: !!this._data };
  },
};

// ─── SWELL 1 (PRIMARY SWELL) ────────────────────────────────────────────────

var Swell1LayerPlugin = {
  id: 'swell1-plugin',
  type: 'marine',
  dataSource: 'MARINE_SWELL1',
  renderMode: 'canvas',
  updateFrequency: 1,
  enabled: false,
  _ctx: null,
  _lastUpdate: 0,
  _data: null,
  _meanHeight: 0,
  _direction: null,

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    this._data = null;
    this._meanHeight = 0;
    this._direction = null;
    console.log('[Swell1Layer] init — swell_wave_height');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    this._data = extractMarineField(this._ctx, 'swell_wave_height');
    this._direction = extractMarineField(this._ctx, 'swell_wave_direction');
    if (this._data) {
      this._meanHeight = computeGridMean(this._data);
    }

    if (this._ctx && this._data) {
      this._ctx.swell1HeightField = this._data;
      this._ctx.swell1Direction = this._direction;
    }
  },

  render: function() {
    // GPUMarineLayer reads swell1HeightField from context
  },

  destroy: function() {
    this._ctx = null;
    this._data = null;
    this._direction = null;
    console.log('[Swell1Layer] destroyed');
  },

  getState: function() {
    return { meanHeight: this._meanHeight, hasData: !!this._data, hasDirection: !!this._direction };
  },
};

// ─── SWELL 2 (SECONDARY SWELL) ──────────────────────────────────────────────

var Swell2LayerPlugin = {
  id: 'swell2-plugin',
  type: 'marine',
  dataSource: 'MARINE_SWELL2',
  renderMode: 'canvas',
  updateFrequency: 1,
  enabled: false,
  _ctx: null,
  _lastUpdate: 0,
  _data: null,
  _meanHeight: 0,
  _direction: null,

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    this._data = null;
    this._meanHeight = 0;
    this._direction = null;
    console.log('[Swell2Layer] init — secondary_swell_wave_height');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    this._data = extractMarineField(this._ctx, 'secondary_swell_wave_height');
    this._direction = extractMarineField(this._ctx, 'secondary_swell_wave_direction');
    if (this._data) {
      this._meanHeight = computeGridMean(this._data);
    }

    if (this._ctx && this._data) {
      this._ctx.swell2HeightField = this._data;
      this._ctx.swell2Direction = this._direction;
    }
  },

  render: function() {
    // GPUMarineLayer reads swell2HeightField from context
  },

  destroy: function() {
    this._ctx = null;
    this._data = null;
    this._direction = null;
    console.log('[Swell2Layer] destroyed');
  },

  getState: function() {
    return { meanHeight: this._meanHeight, hasData: !!this._data };
  },
};

// ─── WIND WAVES ──────────────────────────────────────────────────────────────

var WindWavesLayerPlugin = {
  id: 'wind-waves-plugin',
  type: 'marine',
  dataSource: 'MARINE_WIND_WAVES',
  renderMode: 'canvas',
  updateFrequency: 1,
  enabled: false,
  _ctx: null,
  _lastUpdate: 0,
  _data: null,
  _meanHeight: 0,
  _direction: null,

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    this._data = null;
    this._meanHeight = 0;
    this._direction = null;
    console.log('[WindWavesLayer] init — wind_wave_height');
  },

  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    this._data = extractMarineField(this._ctx, 'wind_wave_height');
    this._direction = extractMarineField(this._ctx, 'wind_wave_direction');
    if (this._data) {
      this._meanHeight = computeGridMean(this._data);
    }

    if (this._ctx && this._data) {
      this._ctx.windWaveHeightField = this._data;
      this._ctx.windWaveDirection = this._direction;
    }
  },

  render: function() {
    // GPUMarineLayer reads windWaveHeightField from context
  },

  destroy: function() {
    this._ctx = null;
    this._data = null;
    this._direction = null;
    console.log('[WindWavesLayer] destroyed');
  },

  getState: function() {
    return { meanHeight: this._meanHeight, hasData: !!this._data };
  },
};

export {
  WavesLayerPlugin,
  Swell1LayerPlugin,
  Swell2LayerPlugin,
  WindWavesLayerPlugin,
  extractMarineField,
  computeGridMean,
};
