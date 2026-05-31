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
  if (marineData.__renderable === false || marineData.grid?.__renderable === false) return field;

  const gridVectors = marineData.grid.vectors;
  const srcCols = marineData.grid.cols || Math.round(Math.sqrt(gridVectors.length));
  const srcRows = marineData.grid.rows || srcCols;

  const srcBounds = marineData.grid.bounds;
  if (!srcBounds) return field;

  const srcWest = srcBounds.west;
  const srcEast = srcBounds.east;
  const srcSouth = srcBounds.south;
  const srcNorth = srcBounds.north;

  const srcLngSpan = srcEast < srcWest ? (srcEast + 360 - srcWest) : (srcEast - srcWest);
  const srcLatSpan = srcNorth - srcSouth;

  const dstWest = field.bounds.west;
  const dstEast = field.bounds.east;
  const dstSouth = field.bounds.south;
  const dstNorth = field.bounds.north;

  const dstLngSpan = dstEast < dstWest ? (dstEast + 360 - dstWest) : (dstEast - dstWest);
  const dstLatSpan = dstNorth - dstSouth;

  const getSourceVector = (x, y) => {
    const idx = y * srcCols + x;
    return gridVectors[idx] || null;
  };

  for (let y = 0; y < field.rows; y++) {
    for (let x = 0; x < field.cols; x++) {
      // Map destination grid pixel to geographic coordinate (lat, lng)
      const tDstX = x / Math.max(1, field.cols - 1);
      const tDstY = y / Math.max(1, field.rows - 1);

      let lng = dstWest + tDstX * dstLngSpan;
      if (lng > 180) lng -= 360;
      const lat = dstSouth + tDstY * dstLatSpan;

      // Map geographic coordinate (lat, lng) to source fractional grid coordinates
      let checkLng = lng;
      if (srcEast < srcWest && lng < srcWest) {
        checkLng += 360;
      }
      
      const tSrcX = srcLngSpan > 0 ? (checkLng - srcWest) / srcLngSpan : 0.5;
      const tSrcY = srcLatSpan > 0 ? (lat - srcSouth) / srcLatSpan : 0.5;

      const dstIdx = y * field.cols + x;

      // If outside source bounds, zero out the grid cell to prevent regional stretch artifacts
      if (tSrcX < 0 || tSrcX > 1 || tSrcY < 0 || tSrcY > 1) {
        field.grid.waveHeight[dstIdx] = 0;
        field.grid.waveDir[dstIdx] = 0;
        field.grid.wavePeriod[dstIdx] = 0;
        field.grid.swellHeight[dstIdx] = 0;
        field.grid.swellDir[dstIdx] = 0;
        field.grid.swellPeriod[dstIdx] = 0;
        field.grid.swell2Height[dstIdx] = 0;
        field.grid.swell2Dir[dstIdx] = 0;
        field.grid.swell2Period[dstIdx] = 0;
        field.grid.windWaveHeight[dstIdx] = 0;
        field.grid.windWaveDir[dstIdx] = 0;
        field.grid.windWavePeriod[dstIdx] = 0;
        field.grid.landMask[dstIdx] = 1; // Default to land
        continue;
      }

      const srcX = tSrcX * (srcCols - 1);
      const srcY = tSrcY * (srcRows - 1);

      const x0 = Math.floor(srcX);
      const x1 = Math.min(srcCols - 1, x0 + 1);
      const y0 = Math.floor(srcY);
      const y1 = Math.min(srcRows - 1, y0 + 1);

      const dx = srcX - x0;
      const dy = srcY - y0;

      const v00 = getSourceVector(x0, y0);
      const v10 = getSourceVector(x1, y0);
      const v01 = getSourceVector(x0, y1);
      const v11 = getSourceVector(x1, y1);

      // Helper to interpolate u/v components or scalar values
      const interpVal = (getProp) => {
        const val00 = getProp(v00) || 0;
        const val10 = getProp(v10) || 0;
        const val01 = getProp(v01) || 0;
        const val11 = getProp(v11) || 0;
        return (1 - dx) * (1 - dy) * val00 + dx * (1 - dy) * val10 + (1 - dx) * dy * val01 + dx * dy * val11;
      };

      // Waves Direct Interpolation (Circular-safe via Cartesian components)
      const waveU = interpVal(v => v?.waves?.u);
      const waveV = interpVal(v => v?.waves?.v);
      const wavePeriod = interpVal(v => v?.waves?.period);
      const waveSpeed = Math.sqrt(waveU * waveU + waveV * waveV);

      // Swell 1 Direct Interpolation
      const swellU = interpVal(v => v?.swell_1?.u);
      const swellV = interpVal(v => v?.swell_1?.v);
      const swellPeriod = interpVal(v => v?.swell_1?.period);
      const swellSpeed = Math.sqrt(swellU * swellU + swellV * swellV);

      // Swell 2 Direct Interpolation
      const swell2U = interpVal(v => v?.swell_2?.u);
      const swell2V = interpVal(v => v?.swell_2?.v);
      const swell2Period = interpVal(v => v?.swell_2?.period);
      const swell2Speed = Math.sqrt(swell2U * swell2U + swell2V * swell2V);

      // Wind Waves Direct Interpolation
      const windWaveU = interpVal(v => v?.wind_waves?.u);
      const windWaveV = interpVal(v => v?.wind_waves?.v);
      const windWavePeriod = interpVal(v => v?.wind_waves?.period);
      const windWaveSpeed = Math.sqrt(windWaveU * windWaveU + windWaveV * windWaveV);

      // Nearest-neighbor for binary land mask
      const nearestX = Math.round(srcX);
      const nearestY = Math.round(srcY);
      const nearestV = getSourceVector(nearestX, nearestY);
      const isOcean = nearestV ? nearestV.isOcean : (waveSpeed > 0);

      field.grid.waveHeight[dstIdx] = waveSpeed;
      field.grid.waveDir[dstIdx] = waveSpeed > 0
        ? (Math.atan2(-waveU, -waveV) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.wavePeriod[dstIdx] = wavePeriod;

      field.grid.swellHeight[dstIdx] = swellSpeed;
      field.grid.swellDir[dstIdx] = swellSpeed > 0
        ? (Math.atan2(-swellU, -swellV) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.swellPeriod[dstIdx] = swellPeriod;

      field.grid.swell2Height[dstIdx] = swell2Speed;
      field.grid.swell2Dir[dstIdx] = swell2Speed > 0
        ? (Math.atan2(-swell2U, -swell2V) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.swell2Period[dstIdx] = swell2Period;

      field.grid.windWaveHeight[dstIdx] = windWaveSpeed;
      field.grid.windWaveDir[dstIdx] = windWaveSpeed > 0
        ? (Math.atan2(-windWaveU, -windWaveV) * (180 / Math.PI) + 360) % 360
        : 0;
      field.grid.windWavePeriod[dstIdx] = windWavePeriod;

      field.grid.landMask[dstIdx] = isOcean ? 0 : 1;
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
 * @param {string} [params.activeMarineLayer=null] - Currently active marine sub-layer
 * @returns {SimulationField}
 */
export function buildSimulationField({
  windData = null,
  marineData = null,
  pressureData = null,
  model = 'GFS',
  hourOffset = 0,
  activeMarineLayer = null,
}) {
  // Determine grid dimensions based on active render type and active layer priority
  let cols = 15, rows = 15; // Default to wind grid size
  let bounds = { north: 85, south: -85, east: 180, west: -180 };

  const isMarineRenderable = marineData && marineData.__renderable !== false && marineData.grid?.__renderable !== false;
  const isMarineActive = !!activeMarineLayer;

  if (isMarineActive && isMarineRenderable && marineData?.grid?.cols) {
    cols = marineData.grid.cols;
    rows = marineData.grid.rows || cols;
    if (marineData.grid.bounds) bounds = { ...marineData.grid.bounds };
  } else if (windData?.cols) {
    cols = windData.cols;
    rows = windData.rows || cols;
    if (windData.bounds) bounds = { ...windData.bounds };
  } else if (isMarineRenderable && marineData?.grid?.cols) {
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

  // Track metadata on field for GPU dispatcher verification
  field.gridProvider = marineData?.grid?.__gridProvider || marineData?.grid?.provider || 'none';
  field.componentLayer = marineData?.grid?.__componentLayer || 'none';
  field.sourceModel = marineData?.grid?.__sourceModel || 'unknown';

  // Inject all available data
  injectWindData(field, windData);
  injectMarineData(field, marineData);
  injectPressureData(field, pressureData);

  return field;
}
