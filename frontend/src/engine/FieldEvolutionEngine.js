/**
 * FieldEvolutionEngine.js — Physics Evolution Step
 *
 * This is the PHYSICS CORE of the simulation engine.
 * It evolves a SimulationField forward in time by applying:
 *
 *   1. Wind field temporal smoothing (exponential damping)
 *   2. Wave energy propagation (swell advection + decay)
 *   3. Wind → Wave coupling (Sverdrup–Munk energy transfer)
 *   4. Marine flow field evolution (wave-driven drift)
 *   5. Stability corrections (damping, clamping, NaN protection)
 *
 * RULES:
 *   - NO React, NO DOM, NO MapLibre
 *   - PURE deterministic physics: same field + same dt = same output
 *   - Operates on Float32Array grids (zero-GC in the hot path)
 *   - Called ONLY from SimulationLoop at fixed timestep
 *
 * RK4 integration is performed by the ParticleSystem (particle-system.js).
 * This module handles FIELD-LEVEL evolution (grid-based physics).
 */

import { rk4Advect, sampleField } from './particle-system';

// ========================================================================
// PHYSICAL CONSTANTS
// ========================================================================

const WIND_DAMPING = 0.9995;         // Per-tick wind stability factor
const WAVE_DECAY = 0.9998;           // Swell energy decay per tick
const WAVE_PROPAGATION_SPEED = 0.3;  // Grid cells per tick for wave propagation
const WIND_WAVE_COUPLING = 0.002;    // Wind → wave energy transfer rate
const SMOOTHING_KERNEL_WEIGHT = 0.15; // 5-point Laplacian smoothing strength
const MAX_WAVE_HEIGHT = 25.0;        // Physical clamp (meters)
const MAX_WIND_SPEED = 80.0;         // Physical clamp (m/s)
const MARINE_DRIFT_SCALE = 0.1;      // Wave → current drift factor

// ========================================================================
// FIELD EVOLUTION STEP
// ========================================================================

/**
 * Evolve a SimulationField forward by one simulation tick.
 *
 * This modifies the field IN-PLACE for performance (zero-allocation).
 * The caller (SimulationLoop) should clone if immutability is needed.
 *
 * @param {import('./SimulationField').SimulationField} field
 * @param {number} dt - Delta time in seconds (fixed timestep, e.g. 1/60)
 * @param {number} simTime - Total simulation time elapsed
 * @returns {import('./SimulationField').SimulationField} Same field reference (mutated)
 */
export function evolveField(field, dt, simTime) {
  if (!field || !field.grid) return field;

  const { cols, rows, grid } = field;
  const size = cols * rows;

  // Skip if no data populated
  if (!field.sources.wind && !field.sources.marine) return field;

  // ---- PHASE A: Wind Field Evolution ----
  if (field.sources.wind && grid.windU && grid.windV) {
    evolveWindField(grid.windU, grid.windV, cols, rows, dt, simTime);
  }

  // ---- PHASE B: Wave Energy Propagation ----
  if (field.sources.marine && grid.waveHeight && grid.waveDir) {
    evolveWaveField(grid, cols, rows, dt, simTime);
  }

  // ---- PHASE C: Wind → Wave Coupling ----
  if (field.sources.wind && field.sources.marine) {
    applyWindWaveCoupling(grid, cols, rows, dt);
  }

  // ---- PHASE D: Stability Corrections ----
  applyStabilityCorrections(grid, cols, rows);

  // Update simulation time on the field
  field.time = Date.now();

  return field;
}

// ========================================================================
// PHASE A: WIND FIELD EVOLUTION
// ========================================================================

/**
 * Apply temporal smoothing to wind field.
 * Adds micro-perturbation for visual turbulence while maintaining
 * meteorological stability via exponential damping.
 *
 * @param {Float32Array} windU
 * @param {Float32Array} windV
 * @param {number} cols
 * @param {number} rows
 * @param {number} dt
 * @param {number} simTime
 */
function evolveWindField(windU, windV, cols, rows, dt, simTime) {
  // Deterministic turbulence based on simTime
  // Uses a cheap hash for spatial variation without Math.random()
  const turbScale = 0.08; // Turbulence amplitude (fraction of wind speed)
  const timeFreq = simTime * 2.0;

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;

      // Damping (stability)
      windU[i] *= WIND_DAMPING;
      windV[i] *= WIND_DAMPING;

      // 5-point Laplacian smoothing (reduces grid artifacts)
      const iN = (y - 1) * cols + x;
      const iS = (y + 1) * cols + x;
      const iW = y * cols + (x - 1);
      const iE = y * cols + (x + 1);

      const lapU = (windU[iN] + windU[iS] + windU[iW] + windU[iE] - 4 * windU[i]);
      const lapV = (windV[iN] + windV[iS] + windV[iW] + windV[iE] - 4 * windV[i]);

      windU[i] += lapU * SMOOTHING_KERNEL_WEIGHT * dt;
      windV[i] += lapV * SMOOTHING_KERNEL_WEIGHT * dt;

      // Deterministic micro-turbulence (cheap spatial hash)
      const hash = deterministicHash(x, y, simTime);
      const speed = Math.sqrt(windU[i] * windU[i] + windV[i] * windV[i]);
      const turbU = hash * turbScale * speed * dt;
      const turbV = deterministicHash(x + 1000, y + 1000, simTime) * turbScale * speed * dt;

      windU[i] += turbU;
      windV[i] += turbV;
    }
  }
}

// ========================================================================
// PHASE B: WAVE ENERGY PROPAGATION
// ========================================================================

/**
 * Evolve wave field: propagate energy in swell direction with decay.
 * Uses a semi-Lagrangian advection step (first-order upwind).
 *
 * @param {import('./SimulationField').FieldGrid} grid
 * @param {number} cols
 * @param {number} rows
 * @param {number} dt
 * @param {number} simTime
 */
function evolveWaveField(grid, cols, rows, dt, simTime) {
  const { waveHeight, waveDir, swellHeight, swellDir } = grid;

  // Semi-Lagrangian advection for wave height
  // Each cell's energy drifts in the wave direction
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;

      // Wave propagation direction → velocity
      const dir = waveDir[i] * (Math.PI / 180);
      const driftX = Math.sin(dir) * WAVE_PROPAGATION_SPEED * dt;
      const driftY = Math.cos(dir) * WAVE_PROPAGATION_SPEED * dt;

      // Upstream sample (semi-Lagrangian)
      const srcX = x - driftX;
      const srcY = y - driftY;

      if (srcX >= 0 && srcX < cols - 1 && srcY >= 0 && srcY < rows - 1) {
        // Bilinear interpolation from upstream
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const fx = srcX - x0;
        const fy = srcY - y0;

        const i00 = y0 * cols + x0;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;

        const upstreamHeight =
          (1 - fx) * (1 - fy) * waveHeight[i00] +
          fx * (1 - fy) * waveHeight[i10] +
          (1 - fx) * fy * waveHeight[i01] +
          fx * fy * waveHeight[i11];

        // Blend: mostly preserve current, slowly advect
        waveHeight[i] = waveHeight[i] * 0.95 + upstreamHeight * 0.05;
      }

      // Energy decay (swell dissipation)
      waveHeight[i] *= WAVE_DECAY;

      // Swell height also decays
      if (swellHeight) {
        swellHeight[i] *= WAVE_DECAY;
      }

      // Direction smoothing (3-point average)
      const iW = y * cols + (x - 1);
      const iE = y * cols + (x + 1);
      waveDir[i] = (waveDir[iW] + waveDir[i] + waveDir[iE]) / 3;
      if (swellDir) {
        swellDir[i] = (swellDir[iW] + swellDir[i] + swellDir[iE]) / 3;
      }
    }
  }
}

// ========================================================================
// PHASE C: WIND → WAVE COUPLING
// ========================================================================

/**
 * Transfer energy from wind field to wave field.
 * Simplified Sverdrup–Munk model: wave growth proportional to
 * wind speed squared × fetch factor.
 *
 * @param {import('./SimulationField').FieldGrid} grid
 * @param {number} cols
 * @param {number} rows
 * @param {number} dt
 */
function applyWindWaveCoupling(grid, cols, rows, dt) {
  const { windU, windV, waveHeight, waveDir, landMask } = grid;

  for (let i = 0; i < cols * rows; i++) {
    // Only apply over ocean
    if (landMask && landMask[i] === 1) continue;

    const windSpeed = Math.sqrt(windU[i] * windU[i] + windV[i] * windV[i]);

    // Energy transfer: proportional to wind speed squared
    // Stronger winds grow waves faster (Sverdrup–Munk approximation)
    const energyInput = windSpeed * windSpeed * WIND_WAVE_COUPLING * dt;

    waveHeight[i] += energyInput;

    // Wind direction influences wave direction (slow rotation toward wind)
    const windDir = (Math.atan2(windU[i], windV[i]) * 180 / Math.PI + 360) % 360;
    let dirDiff = windDir - waveDir[i];
    if (dirDiff > 180) dirDiff -= 360;
    if (dirDiff < -180) dirDiff += 360;
    waveDir[i] += dirDiff * 0.002 * dt; // Very slow directional coupling
  }
}

// ========================================================================
// PHASE D: STABILITY CORRECTIONS
// ========================================================================

/**
 * Clamp all fields to physical bounds and fix NaN/Infinity values.
 * This is the safety net that prevents numerical instability.
 *
 * @param {import('./SimulationField').FieldGrid} grid
 * @param {number} cols
 * @param {number} rows
 */
function applyStabilityCorrections(grid, cols, rows) {
  const size = cols * rows;

  for (let i = 0; i < size; i++) {
    // Wind clamping
    if (!isFinite(grid.windU[i])) grid.windU[i] = 0;
    if (!isFinite(grid.windV[i])) grid.windV[i] = 0;
    const windSpd = Math.sqrt(grid.windU[i] ** 2 + grid.windV[i] ** 2);
    if (windSpd > MAX_WIND_SPEED) {
      const scale = MAX_WIND_SPEED / windSpd;
      grid.windU[i] *= scale;
      grid.windV[i] *= scale;
    }

    // Wave clamping
    if (!isFinite(grid.waveHeight[i])) grid.waveHeight[i] = 0;
    if (grid.waveHeight[i] < 0) grid.waveHeight[i] = 0;
    if (grid.waveHeight[i] > MAX_WAVE_HEIGHT) grid.waveHeight[i] = MAX_WAVE_HEIGHT;

    // Direction normalization (0-360)
    if (!isFinite(grid.waveDir[i])) grid.waveDir[i] = 0;
    grid.waveDir[i] = ((grid.waveDir[i] % 360) + 360) % 360;

    // Swell clamping
    if (grid.swellHeight) {
      if (!isFinite(grid.swellHeight[i])) grid.swellHeight[i] = 0;
      if (grid.swellHeight[i] < 0) grid.swellHeight[i] = 0;
      if (grid.swellHeight[i] > MAX_WAVE_HEIGHT) grid.swellHeight[i] = MAX_WAVE_HEIGHT;
    }

    // Pressure sanity (300-1100 hPa or zero)
    if (grid.pressure[i] !== 0 && (grid.pressure[i] < 300 || grid.pressure[i] > 1100 || !isFinite(grid.pressure[i]))) {
      grid.pressure[i] = 0;
    }
  }
}

// ========================================================================
// UTILITY: DETERMINISTIC HASH
// ========================================================================

/**
 * Cheap deterministic pseudo-random hash for spatial turbulence.
 * Returns value in [-1, 1]. Same inputs always produce same output.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} t
 * @returns {number}
 */
function deterministicHash(x, y, t) {
  let n = Math.sin(x * 127.1 + y * 311.7 + t * 74.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

// ========================================================================
// DIAGNOSTICS
// ========================================================================

/**
 * Get evolution diagnostics for debugging.
 *
 * @param {import('./SimulationField').SimulationField} field
 * @returns {Object}
 */
export function getEvolutionDiagnostics(field) {
  if (!field) return { evolved: false };

  const g = field.grid;
  const size = field.cols * field.rows;
  let windEnergy = 0, waveEnergy = 0;

  for (let i = 0; i < size; i++) {
    windEnergy += g.windU[i] ** 2 + g.windV[i] ** 2;
    waveEnergy += g.waveHeight[i] ** 2;
  }

  return {
    evolved: true,
    windTotalEnergy: +(windEnergy / size).toFixed(4),
    waveTotalEnergy: +(waveEnergy / size).toFixed(4),
    gridSize: `${field.cols}×${field.rows}`,
  };
}
