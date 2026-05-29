/**
 * FieldInterpolator.js — Temporal Interpolation for SimulationField
 *
 * Smoothly blends between two SimulationField snapshots (forecast frames)
 * using Float32Array linear interpolation and circular direction averaging.
 *
 * Used when the time slider sits between two discrete model outputs
 * (e.g. GFS 3-hourly, ICON 1-hourly).
 *
 * RULES:
 *   - NO snapping between forecast hours — ONLY smooth interpolation
 *   - Zero-allocation hot path (reuses output field)
 *   - Circular interpolation for direction fields (wind/wave direction)
 *   - landMask preserved from fieldA (binary, no interpolation)
 *   - NO React, NO DOM
 */

import { createField, cloneField } from './SimulationField';

// ========================================================================
// CACHED OUTPUT (reused to avoid GC pressure)
// ========================================================================

let _cachedOutput = null;

// ========================================================================
// CORE INTERPOLATION
// ========================================================================

/**
 * Interpolate between two SimulationFields.
 *
 * @param {import('./SimulationField').SimulationField} fieldA - Earlier forecast frame
 * @param {import('./SimulationField').SimulationField} fieldB - Later forecast frame
 * @param {number} t - Blend factor (0 = fieldA, 1 = fieldB)
 * @returns {import('./SimulationField').SimulationField} Blended field
 */
export function interpolateFields(fieldA, fieldB, t) {
  if (!fieldA || !fieldB) return fieldA || fieldB;
  if (t <= 0) return fieldA;
  if (t >= 1) return fieldB;

  const clampedT = Math.max(0, Math.min(1, t));
  const { cols, rows } = fieldA;
  const size = cols * rows;

  // Ensure matching grid dimensions
  if (fieldB.cols !== cols || fieldB.rows !== rows) {
    console.warn('[FieldInterpolator] Grid size mismatch, returning fieldA');
    return fieldA;
  }

  // Allocate or reuse output field
  if (!_cachedOutput || _cachedOutput.cols !== cols || _cachedOutput.rows !== rows) {
    _cachedOutput = cloneField(fieldA);
    _cachedOutput.grid = {
      windU:          new Float32Array(size),
      windV:          new Float32Array(size),
      waveHeight:     new Float32Array(size),
      waveDir:        new Float32Array(size),
      wavePeriod:     new Float32Array(size),
      swellHeight:    new Float32Array(size),
      swellDir:       new Float32Array(size),
      swellPeriod:    new Float32Array(size),
      windWaveHeight: new Float32Array(size),
      windWaveDir:    new Float32Array(size),
      windWavePeriod: new Float32Array(size),
      pressure:       new Float32Array(size),
      landMask:       new Uint8Array(size),
    };
  }

  const out = _cachedOutput;
  const gA = fieldA.grid;
  const gB = fieldB.grid;
  const gO = out.grid;

  // Linear interpolation for scalar fields
  lerpArray(gA.windU, gB.windU, gO.windU, clampedT, size);
  lerpArray(gA.windV, gB.windV, gO.windV, clampedT, size);
  lerpArray(gA.waveHeight, gB.waveHeight, gO.waveHeight, clampedT, size);
  lerpArray(gA.wavePeriod, gB.wavePeriod, gO.wavePeriod, clampedT, size);
  lerpArray(gA.swellHeight, gB.swellHeight, gO.swellHeight, clampedT, size);
  lerpArray(gA.swellPeriod, gB.swellPeriod, gO.swellPeriod, clampedT, size);
  lerpArray(gA.windWaveHeight, gB.windWaveHeight, gO.windWaveHeight, clampedT, size);
  lerpArray(gA.windWavePeriod, gB.windWavePeriod, gO.windWavePeriod, clampedT, size);
  lerpArray(gA.pressure, gB.pressure, gO.pressure, clampedT, size);

  // Circular interpolation for direction fields (0-360°)
  circularLerp(gA.waveDir, gB.waveDir, gO.waveDir, clampedT, size);
  circularLerp(gA.swellDir, gB.swellDir, gO.swellDir, clampedT, size);
  circularLerp(gA.windWaveDir, gB.windWaveDir, gO.windWaveDir, clampedT, size);

  // landMask: binary, no interpolation — use fieldA
  gO.landMask.set(gA.landMask);

  // Update metadata
  out.cols = cols;
  out.rows = rows;
  out.bounds = { ...fieldA.bounds };
  out.sources = { ...fieldA.sources };
  out.model = fieldA.model;
  out.revision = fieldA.revision + 0.5; // Fractional revision indicates interpolation
  out.time = Date.now();

  return out;
}

// ========================================================================
// INTERPOLATION PRIMITIVES
// ========================================================================

/**
 * Linear interpolation between two Float32Arrays (zero-allocation).
 */
function lerpArray(a, b, out, t, size) {
  const oneMinusT = 1 - t;
  for (let i = 0; i < size; i++) {
    out[i] = a[i] * oneMinusT + b[i] * t;
  }
}

/**
 * Circular interpolation for direction arrays (0-360°).
 * Handles wraparound correctly (e.g. 350° → 10° goes through 0°, not 180°).
 */
function circularLerp(a, b, out, t, size) {
  for (let i = 0; i < size; i++) {
    let diff = b[i] - a[i];
    // Shortest path around circle
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    out[i] = ((a[i] + diff * t) % 360 + 360) % 360;
  }
}

/**
 * Compute blend factor between two forecast timestamps.
 *
 * @param {number} currentHour - Current time offset in hours
 * @param {number} hourA - Earlier forecast hour
 * @param {number} hourB - Later forecast hour
 * @returns {number} 0-1 blend factor
 */
export function computeForecastBlend(currentHour, hourA, hourB) {
  if (hourB <= hourA) return 0;
  return Math.max(0, Math.min(1, (currentHour - hourA) / (hourB - hourA)));
}
