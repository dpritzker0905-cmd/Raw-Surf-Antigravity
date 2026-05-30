/**
 * SimulationField.js — Canonical Field Data Contract
 *
 * The single source of truth for all rendering in Raw Surf.
 * Every data source (wind, marine, pressure, mask) normalizes
 * into this shape. The FCE consumes it, the renderers never
 * see raw API data.
 *
 * RULES:
 * - NO rendering logic
 * - NO MapLibre references
 * - NO React
 * - Pure data contract + factory
 */

// ========================================================================
// TYPE DEFINITIONS (JSDoc — consumed by IDE + FCE)
// ========================================================================

/**
 * @typedef {Object} FieldGrid
 * @property {Float32Array} windU      - U-component of wind (knots), row-major
 * @property {Float32Array} windV      - V-component of wind (knots), row-major
 * @property {Float32Array} waveHeight - Significant wave height (meters)
 * @property {Float32Array} waveDir    - Wave direction (degrees, meteorological)
 * @property {Float32Array} wavePeriod - Mean wave period (seconds)
 * @property {Float32Array} swellHeight - Primary swell height (meters)
 * @property {Float32Array} swellDir   - Primary swell direction (degrees)
 * @property {Float32Array} swellPeriod - Primary swell period (seconds)
 * @property {Float32Array} swell2Height - Secondary swell height (meters)
 * @property {Float32Array} swell2Dir   - Secondary swell direction (degrees)
 * @property {Float32Array} swell2Period - Secondary swell period (seconds)
 * @property {Float32Array} windWaveHeight - Wind-wave height (meters)
 * @property {Float32Array} windWaveDir - Wind-wave direction (degrees)
 * @property {Float32Array} windWavePeriod - Wind-wave period (seconds)
 * @property {Float32Array} pressure   - Mean sea level pressure (hPa)
 * @property {Uint8Array}   landMask   - 1 = land, 0 = ocean
 */

/**
 * @typedef {Object} FieldBounds
 * @property {number} north
 * @property {number} south
 * @property {number} east
 * @property {number} west
 */

/**
 * @typedef {Object} SimulationField
 * @property {number}      time        - Current simulation timestamp (ms since epoch)
 * @property {number}      hourOffset  - Hours offset from now
 * @property {string}      model       - Active model ('GFS' | 'ICON' | 'EURO')
 * @property {FieldGrid}   grid        - All field data arrays
 * @property {FieldBounds} bounds      - Geographic bounds of the grid
 * @property {number}      cols        - Grid width (number of columns)
 * @property {number}      rows        - Grid height (number of rows)
 * @property {number}      revision    - Monotonic counter, increments on any data change
 * @property {Object}      sources     - Which data sources contributed
 * @property {boolean}     sources.wind     - True if wind data is populated
 * @property {boolean}     sources.marine   - True if marine data is populated
 * @property {boolean}     sources.pressure - True if pressure data is populated
 * @property {boolean}     sources.landMask - True if land mask is loaded
 */

// ========================================================================
// FACTORY
// ========================================================================

let _revisionCounter = 0;

/**
 * Create an empty SimulationField with zeroed arrays.
 *
 * @param {number} cols - Grid width
 * @param {number} rows - Grid height
 * @param {FieldBounds} bounds - Geographic bounds
 * @param {string} [model='GFS'] - Active forecast model
 * @returns {SimulationField}
 */
export function createEmptyField(cols, rows, bounds, model = 'GFS') {
  const size = cols * rows;
  return {
    time: Date.now(),
    hourOffset: 0,
    model,
    grid: {
      windU:          new Float32Array(size),
      windV:          new Float32Array(size),
      waveHeight:     new Float32Array(size),
      waveDir:        new Float32Array(size),
      wavePeriod:     new Float32Array(size),
      swellHeight:    new Float32Array(size),
      swellDir:       new Float32Array(size),
      swellPeriod:    new Float32Array(size),
      swell2Height:   new Float32Array(size),
      swell2Dir:      new Float32Array(size),
      swell2Period:   new Float32Array(size),
      windWaveHeight: new Float32Array(size),
      windWaveDir:    new Float32Array(size),
      windWavePeriod: new Float32Array(size),
      pressure:       new Float32Array(size),
      landMask:       new Uint8Array(size),
    },
    bounds: { ...bounds },
    cols,
    rows,
    revision: ++_revisionCounter,
    sources: {
      wind: false,
      marine: false,
      pressure: false,
      landMask: false,
    },
  };
}

/**
 * Clone a SimulationField (shallow copy of typed arrays — they're immutable between frames).
 *
 * @param {SimulationField} field
 * @returns {SimulationField}
 */
export function cloneField(field) {
  return {
    ...field,
    grid: { ...field.grid },
    bounds: { ...field.bounds },
    sources: { ...field.sources },
    revision: ++_revisionCounter,
  };
}

/**
 * Check if a SimulationField has any populated data.
 *
 * @param {SimulationField} field
 * @returns {boolean}
 */
export function isFieldPopulated(field) {
  if (!field) return false;
  return field.sources.wind || field.sources.marine || field.sources.pressure;
}

/**
 * Get diagnostic info about a SimulationField.
 *
 * @param {SimulationField} field
 * @returns {Object}
 */
export function getFieldDiagnostics(field) {
  if (!field) return { populated: false };

  const grid = field.grid;
  let windMax = 0, waveMax = 0, pressMin = 9999, pressMax = 0;

  for (let i = 0; i < field.cols * field.rows; i++) {
    const speed = Math.sqrt(grid.windU[i] ** 2 + grid.windV[i] ** 2);
    if (speed > windMax) windMax = speed;
    if (grid.waveHeight[i] > waveMax) waveMax = grid.waveHeight[i];
    if (grid.pressure[i] > 0 && grid.pressure[i] < pressMin) pressMin = grid.pressure[i];
    if (grid.pressure[i] > pressMax) pressMax = grid.pressure[i];
  }

  return {
    populated: isFieldPopulated(field),
    model: field.model,
    hourOffset: field.hourOffset,
    revision: field.revision,
    grid: `${field.cols}×${field.rows}`,
    sources: field.sources,
    peaks: {
      windSpeed: +windMax.toFixed(1),
      waveHeight: +waveMax.toFixed(1),
      pressureRange: pressMax > 0 ? `${pressMin.toFixed(0)}–${pressMax.toFixed(0)} hPa` : 'none',
    },
  };
}
