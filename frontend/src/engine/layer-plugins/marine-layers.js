/*
====================================================
 Raw Surf OS — Marine Layer Plugins
 WAVES, SWELL 1, SWELL 2, WIND WAVES
====================================================

Compatible with LayerRegistry plugin system.
Extends existing marine particle rendering (GPUMarineLayer).
NO import-time side effects, NO engine coupling.
var/function only (TDZ-immune)
====================================================
*/

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

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    console.log('[WavesLayer] init — wave_height');
  },
  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;
    // Marine particle canvas handles rendering via GPUMarineLayer
    // This plugin coordinates data refresh timing
  },
  render: function() {
    // Delegated to GPUMarineLayer canvas overlay
  },
  destroy: function() {
    this._ctx = null;
    console.log('[WavesLayer] destroyed');
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

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    console.log('[Swell1Layer] init — swell_wave_height');
  },
  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;
  },
  render: function() {
    // Delegated to GPUMarineLayer canvas overlay
  },
  destroy: function() {
    this._ctx = null;
    console.log('[Swell1Layer] destroyed');
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

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    console.log('[Swell2Layer] init — secondary_swell_wave_height');
  },
  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;
  },
  render: function() {
    // Delegated to GPUMarineLayer canvas overlay
  },
  destroy: function() {
    this._ctx = null;
    console.log('[Swell2Layer] destroyed');
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

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    console.log('[WindWavesLayer] init — wind_wave_height');
  },
  update: function(dt) {
    this._lastUpdate += dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;
  },
  render: function() {
    // Delegated to GPUMarineLayer canvas overlay
  },
  destroy: function() {
    this._ctx = null;
    console.log('[WindWavesLayer] destroyed');
  },
};

export {
  WavesLayerPlugin,
  Swell1LayerPlugin,
  Swell2LayerPlugin,
  WindWavesLayerPlugin,
};
