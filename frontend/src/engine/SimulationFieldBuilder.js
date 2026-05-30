/**
 * SimulationFieldBuilder.js — Adapter Layer
 *
 * Converts the current production data formats (from marineController)
 * into the canonical SimulationField contract.
 *
 * This is the BRIDGE between the old world (scattered data hooks)
 * and the new world (unified field model).
 *
 * RULES:
 * - NO rendering logic
 * - NO MapLibre references
 * - NO React (pure functions only)
 * - Handles missing/partial data gracefully
 */

import { createEmptyField } from './SimulationField';

// ========================================================================
// WIND DATA → SimulationField.grid.windU / windV
// ========================================================================

/**
 * Inject wind data from WeatherEngine's windData format into a SimulationField.
 *
 * windData format (from marineController.extractWindAtOffset):
 * {
 *   vectors: [{ lat, lng, speed, direction, u, v }, ...],
 *   bounds: { west, south, east, north },
 *   cols: number, rows: number,
 *   source: string, hourOffset: number
 * }
 *
 * @param {SimulationField} field - Target field (mutated in place)
 * @param {Object|null} windData - Wind data from WeatherEngine
 * @returns {SimulationField} The mutated field (for chaining)
 */
export function injectWindData(field, windData) {
  if (!windData?.vectors?.length) return field;

  const vectors = windData.vectors;
  const srcCols = windData.cols || Math.round(Math.sqrt(vectors.length));
  const srcRows = windData.rows || srcCols;

  // If grid dimensions match, direct copy
  if (srcCols === field.cols && srcRows === field.rows) {
    for (let i = 0; i < vectors.length && i < field.cols * field.rows; i++) {
      field.grid.windU[i] = vectors[i].u || 0;
      field.grid.windV[i] = vectors[i].v || 0;
    }
  } else {
    // Nearest-neighbor resample to field grid
    for (let y = 0; y < field.rows; y++) {
      for (let x = 0; x < field.cols; x++) {
        const srcX = Math.round((x / (field.cols - 1)) * (srcCols - 1));
        const srcY = Math.round((y / (field.rows - 1)) * (srcRows - 1));
        const srcIdx = srcY * srcCols + srcX;
        const dstIdx = y * field.cols + x;
        if (srcIdx < vectors.length) {
          field.grid.windU[dstIdx] = vectors[srcIdx].u || 0;
          field.grid.windV[dstIdx] = vectors[srcIdx].v || 0;
        }
      }
    }
  }

  field.sources.wind = true;
  if (windData.bounds) {
    field.bounds = { ...windData.bounds };
  }
  return field;
}

// ========================================================================
// MARINE DATA → SimulationField.grid.waveHeight / waveDir / swell / windWave
// ========================================================================

/**
 * Inject marine data from useMarineOrchestrator's marineData format.
 *
 * marineData format (from marineController.extractMarineAtOffset):
 * {
 *   type: 'FeatureCollection',
 *   features: [{ geometry: { coordinates }, properties: { wave_height, wave_direction, ... } }],
 *   grid: { vectors: [...], bounds, cols, rows }
 * }
 *
 * @param {SimulationField} field - Target field (mutated in place)
 * @param {Object|null} marineData - Marine data from useMarineOrchestrator
 * @returns {SimulationField}
 */
export function injectMarineData(field, marineData) {
  if (!marineData?.grid?.vectors?.length) return field;

  const gridVectors = marineData.grid.vectors;
  const srcCols = marineData.grid.cols || Math.round(Math.sqrt(gridVectors.length));
  const srcRows = marineData.grid.rows || srcCols;

  // Direct copy if dimensions match, otherwise nearest-neighbor
  const directCopy = (srcCols === field.cols && srcRows === field.rows);

  for (let y = 0; y < field.rows; y++) {
    for (let x = 0; x < field.cols; x++) {
      let srcIdx;
      if (directCopy) {
        srcIdx = y * field.cols + x;
      } else {
        const srcX = Math.round((x / (field.cols - 1)) * (srcCols - 1));
        const srcY = Math.round((y / (field.rows - 1)) * (srcRows - 1));
        srcIdx = srcY * srcCols + srcX;
      }

      const dstIdx = y * field.cols + x;
      if (srcIdx >= gridVectors.length) continue;

      const gv = gridVectors[srcIdx];

      // Wave height + direction + period
      // v5.0: Direction fix — removed erroneous +180 that flipped all directions.
      // atan2(-u, -v) correctly reconstructs meteorological direction from getUV() components.
      // +360 % 360 handles negative angles without introducing a 180° offset.
      field.grid.waveHeight[dstIdx] = gv.waves?.speed || 0;
      field.grid.waveDir[dstIdx] = gv.waves?.speed > 0
        ? (Math.atan2(-gv.waves.u, -gv.waves.v) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.wavePeriod[dstIdx] = gv.waves?.period || 0;

      // Primary swell
      field.grid.swellHeight[dstIdx] = gv.swell_1?.speed || 0;
      field.grid.swellDir[dstIdx] = gv.swell_1?.speed > 0
        ? (Math.atan2(-gv.swell_1.u, -gv.swell_1.v) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.swellPeriod[dstIdx] = gv.swell_1?.period || 0;

      // Secondary swell (swell_2)
      field.grid.swell2Height[dstIdx] = gv.swell_2?.speed || 0;
      field.grid.swell2Dir[dstIdx] = gv.swell_2?.speed > 0
        ? (Math.atan2(-gv.swell_2.u, -gv.swell_2.v) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.swell2Period[dstIdx] = gv.swell_2?.period || 0;

      // Wind waves
      field.grid.windWaveHeight[dstIdx] = gv.wind_waves?.speed || 0;
      field.grid.windWaveDir[dstIdx] = gv.wind_waves?.speed > 0
        ? (Math.atan2(-gv.wind_waves.u, -gv.wind_waves.v) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.windWavePeriod[dstIdx] = gv.wind_waves?.period || 0;

      // Land mask from ocean detection
      field.grid.landMask[dstIdx] = gv.isOcean ? 0 : 1;
    }
  }

  field.sources.marine = true;
  field.sources.landMask = true;
  return field;
}

// ========================================================================
// PRESSURE DATA → SimulationField.grid.pressure
// ========================================================================

/**
 * Inject pressure data from usePressureEngine's pressureData format.
 *
 * pressureData format (from marineController.extractPressureAtOffset):
 * {
 *   pressures: [{ lat, lng, pressure }, ...],
 *   bounds, cols, rows
 * }
 *
 * @param {SimulationField} field - Target field (mutated in place)
 * @param {Object|null} pressureData - Pressure data from usePressureEngine
 * @returns {SimulationField}
 */
export function injectPressureData(field, pressureData) {
  if (!pressureData?.pressures?.length) return field;

  const pressures = pressureData.pressures;
  const srcCols = pressureData.cols || Math.round(Math.sqrt(pressures.length));
  const srcRows = pressureData.rows || srcCols;

  const directCopy = (srcCols === field.cols && srcRows === field.rows);

  for (let y = 0; y < field.rows; y++) {
    for (let x = 0; x < field.cols; x++) {
      let srcIdx;
      if (directCopy) {
        srcIdx = y * field.cols + x;
      } else {
        const srcX = Math.round((x / (field.cols - 1)) * (srcCols - 1));
        const srcY = Math.round((y / (field.rows - 1)) * (srcRows - 1));
        srcIdx = srcY * srcCols + srcX;
      }

      const dstIdx = y * field.cols + x;
      if (srcIdx < pressures.length) {
        field.grid.pressure[dstIdx] = pressures[srcIdx].pressure || 1013;
      }
    }
  }

  field.sources.pressure = true;
  return field;
}

// ========================================================================
// UNIFIED BUILDER
// ========================================================================

/**
 * Build a complete SimulationField from all available data sources.
 *
 * This is the primary entry point. It creates a fresh field and injects
 * whatever data is available. Missing sources are gracefully skipped.
 *
 * @param {Object} params
 * @param {Object|null} params.windData - From WeatherEngine
 * @param {Object|null} params.marineData - From useMarineOrchestrator
 * @param {Object|null} params.pressureData - From usePressureEngine
 * @param {string} [params.model='GFS'] - Active forecast model
 * @param {number} [params.hourOffset=0] - Timeline offset in hours
 * @returns {SimulationField}
 */
export function buildSimulationField({
  windData = null,
  marineData = null,
  pressureData = null,
  model = 'GFS',
  hourOffset = 0,
}) {
  // Determine grid dimensions from largest available data source
  let cols = 15, rows = 15; // Default to wind grid size
  let bounds = { north: 85, south: -85, east: 180, west: -180 };

  if (windData?.cols) {
    cols = windData.cols;
    rows = windData.rows || cols;
    if (windData.bounds) bounds = { ...windData.bounds };
  } else if (marineData?.grid?.cols) {
    cols = marineData.grid.cols;
    rows = marineData.grid.rows || cols;
    if (marineData.grid.bounds) bounds = { ...marineData.grid.bounds };
  } else if (pressureData?.cols) {
    cols = pressureData.cols;
    rows = pressureData.rows || cols;
    if (pressureData.bounds) bounds = { ...pressureData.bounds };
  }

  const field = createEmptyField(cols, rows, bounds, model);
  field.hourOffset = hourOffset;
  field.time = Date.now() + hourOffset * 3600000;

  // Inject all available data
  injectWindData(field, windData);
  injectMarineData(field, marineData);
  injectPressureData(field, pressureData);

  return field;
}
