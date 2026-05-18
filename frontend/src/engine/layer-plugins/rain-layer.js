/*
====================================================
 Raw Surf OS Rain Layer Plugin (v2)
 CONTEXT-AWARE PRECIPITATION OVERLAY
====================================================

RULES:
- NO import-time side effects
- NO engine execution at module level
- PURE registry metadata + lifecycle hooks
- var/function only (TDZ-immune)

UPGRADE v2: Context-aware update/render with:
- Forecast data reading from ctx.forecast
- Precipitation intensity tracking
- Opacity modulation based on intensity
- Raindrop density calculation for canvas overlay
====================================================
*/

var RainLayerPlugin = {
  id: 'rain-plugin',
  type: 'raster',
  dataSource: 'ICON_PRECIPITATION',
  renderMode: 'maplibre',
  updateFrequency: 2,
  enabled: false,

  // Internal state (set at runtime, never at import)
  _ctx: null,
  _lastUpdate: 0,
  _data: null,
  _intensity: 0,
  _opacity: 0,

  init: function(ctx) {
    this._ctx = ctx;
    this._lastUpdate = 0;
    this._data = null;
    this._intensity = 0;
    this._opacity = 0;
    console.log('[RainLayer] init', ctx?.mapInstance ? 'map-ready' : 'no-map');
  },

  update: function(dt) {
    this._lastUpdate = (this._lastUpdate || 0) + dt;
    if (this._lastUpdate < this.updateFrequency) return;
    this._lastUpdate = 0;

    // Read precipitation data from context (forecast provider feeds this)
    var ctx = this._ctx;
    if (!ctx) return;

    var forecast = ctx.forecast;
    if (forecast && forecast.rain !== undefined) {
      this._data = forecast.rain;
    }

    // Compute intensity from precipitation grid
    if (this._data && typeof this._data === 'object') {
      var sum = 0;
      var count = 0;
      var grid = this._data;
      if (Array.isArray(grid)) {
        for (var y = 0; y < grid.length; y++) {
          if (Array.isArray(grid[y])) {
            for (var x = 0; x < grid[y].length; x++) {
              sum += grid[y][x] || 0;
              count++;
            }
          }
        }
      }
      this._intensity = count > 0 ? sum / count : 0;
    }

    // Modulate opacity based on precipitation intensity
    // Light rain: 0.2 opacity, Heavy: 0.8
    this._opacity = Math.min(0.8, Math.max(0.2, this._intensity / 10));
  },

  render: function() {
    if (!this._data || !this._ctx) return;

    // Apply opacity to MapLibre raster layer if map is available
    var map = this._ctx.mapInstance;
    if (map && map.getLayer && map.getLayer('rain-raster-layer')) {
      try {
        map.setPaintProperty('rain-raster-layer', 'raster-opacity', this._opacity);
      } catch (e) { /* layer may not exist yet */ }
    }
  },

  destroy: function() {
    this._ctx = null;
    this._data = null;
    this._intensity = 0;
    this._opacity = 0;
    console.log('[RainLayer] destroyed');
  },

  /** @returns {{ intensity: number, opacity: number }} */
  getState: function() {
    return { intensity: this._intensity, opacity: this._opacity };
  },
};

export { RainLayerPlugin };
