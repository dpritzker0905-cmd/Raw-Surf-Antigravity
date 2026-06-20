/**
 * SimulationHealthMonitor.js — Runtime Health + Stability Tracking
 *
 * Subscribes to SimulationLoop's RenderPlan output and tracks:
 *   - RK4 integrity (NaN detection across wind/wave fields)
 *   - Wind energy conservation drift
 *   - Wave field divergence detection
 *   - Particle loss rate
 *   - Frame jitter (inter-callback timing)
 *   - GPU dispatch latency
 *
 * Exposes diagnostics via window.__SIM_HEALTH__
 *
 * RULES:
 *   - NO simulation logic, NO physics
 *   - Pure observation and measurement
 *   - Read-only access to field data
 */

import { onRenderPlan } from './SimulationLoop';

// ========================================================================
// CONFIGURATION
// ========================================================================

const SAMPLE_WINDOW = 60;        // Rolling window for statistics
const ENERGY_DRIFT_WARN = 0.5;   // 50% drift from initial → warning
const NAN_INTEGRITY_WARN = 0.99; // <99% valid → warning
const WAVE_DIVERGE_WARN = 20.0;  // Max waveHeight meters
const PARTICLE_LOSS_WARN = 0.1;  // >10% zero-speed → warning
const JITTER_WARN_MS = 50;       // Frame jitter threshold

// ========================================================================
// STATE
// ========================================================================

let _unsubscribe = null;
let _initialWindEnergy = null;
let _lastCallbackTime = 0;
let _sampleIndex = 0;
let _lastFieldRevision = -1;
let _rebaselineTimer = null;
let _pendingRevision = -1;
let _lastHealthSampleTime = 0;

// In forecast-authoritative mode the field is not evolving, so the full
// integrity/energy/divergence/particle scan every plan is wasted work. Sample at
// ~1Hz unless the field revision just changed. Sandbox keeps full-rate checks.
const HEALTH_SAMPLE_INTERVAL_MS = 1000;

// Rolling buffers
const _jitterSamples = new Float32Array(SAMPLE_WINDOW);
const _integrityHistory = new Float32Array(SAMPLE_WINDOW);
let _warningCount = 0;
let _resetCount = 0;

// Latest health snapshot
let _health = {
  stable: true,
  rk4Integrity: 1.0,
  windEnergyDrift: 0.0,
  waveDivergence: 0.0,
  particleLossRate: 0.0,
  frameJitterMs: 0.0,
  warningCount: 0,
  resetCount: 0,
  samplesCollected: 0,
};

// ========================================================================
// MEASUREMENT
// ========================================================================

/**
 * Measure RK4 field integrity — % of non-NaN values in wind grids.
 */
function measureIntegrity(field) {
  if (!field || !field.grid.windU) return 1.0;

  const size = field.cols * field.rows;
  let nanCount = 0;

  for (let i = 0; i < size; i++) {
    if (!isFinite(field.grid.windU[i])) nanCount++;
    if (!isFinite(field.grid.windV[i])) nanCount++;
    if (!isFinite(field.grid.waveHeight[i])) nanCount++;
  }

  const totalChecked = size * 3;
  return totalChecked > 0 ? (totalChecked - nanCount) / totalChecked : 1.0;
}

/**
 * Measure wind energy drift from initial snapshot.
 */
function measureEnergyDrift(field) {
  if (!field || !field.grid.windU) return 0;

  const size = field.cols * field.rows;
  let energy = 0;
  for (let i = 0; i < size; i++) {
    energy += field.grid.windU[i] ** 2 + field.grid.windV[i] ** 2;
  }
  energy /= size;

  // Capture initial energy on first valid measurement
  if (_initialWindEnergy === null && energy > 0) {
    _initialWindEnergy = energy;
    return 0;
  }

  if (_initialWindEnergy === null || _initialWindEnergy === 0) return 0;
  return Math.abs(energy - _initialWindEnergy) / _initialWindEnergy;
}

/**
 * Measure wave field divergence — max wave height in grid.
 */
function measureWaveDivergence(field) {
  if (!field || !field.grid.waveHeight) return 0;

  const size = field.cols * field.rows;
  let maxH = 0;
  for (let i = 0; i < size; i++) {
    const h = field.grid.waveHeight[i];
    if (h > maxH) maxH = h;
  }
  return maxH;
}

/**
 * Measure particle loss rate from RenderPlan wind particles.
 */
function measureParticleLoss(renderPlan) {
  if (!renderPlan?.windParticles?.rk4Particles) return 0;

  const particles = renderPlan.windParticles.rk4Particles;
  const count = renderPlan.windParticles.particleCount || particles.length;
  if (count === 0) return 0;

  let zeroCount = 0;
  for (let i = 0; i < count; i++) {
    const p = particles[i];
    if (p && Math.abs(p.vx) < 0.0001 && Math.abs(p.vy) < 0.0001) {
      zeroCount++;
    }
  }

  return zeroCount / count;
}

/**
 * Measure frame-to-frame jitter.
 */
function measureJitter() {
  const now = performance.now();
  if (_lastCallbackTime === 0) {
    _lastCallbackTime = now;
    return 0;
  }
  const delta = now - _lastCallbackTime;
  _lastCallbackTime = now;
  return delta;
}

// ========================================================================
// HEALTH CHECK CALLBACK
// ========================================================================

function onPlanReceived(renderPlan, frameIndex) {
  if (!renderPlan) return;

  const field = renderPlan._evolvedField;
  // Capture revision-changed BEFORE the rebaseline block mutates _lastFieldRevision.
  const revisionChanged = field && field.revision !== _lastFieldRevision;
  if (field && field.revision !== _lastFieldRevision) {
    // Always null the baseline immediately so the next energy measurement
    // captures the new field, but debounce the console log to avoid 50+
    // redundant lines during rapid layer/model switching sequences.
    _initialWindEnergy = null;
    _lastFieldRevision = field.revision;
    _pendingRevision = field.revision;
    clearTimeout(_rebaselineTimer);
    _rebaselineTimer = setTimeout(() => {
      console.log('[SimHealth] New field revision detected (' + _pendingRevision + '), re-baselining energy calculation');
      _rebaselineTimer = null;
    }, 500);
  }

  // Mode-aware throttle: in forecast-authoritative mode, only run the full metric
  // scan ~1Hz (or immediately when the revision changed). Sandbox runs full rate.
  const inSandbox = typeof window !== 'undefined' && window.__IN_SIMULATION_SANDBOX__ === true;
  const now0 = performance.now();
  if (!inSandbox && !revisionChanged && (now0 - _lastHealthSampleTime) < HEALTH_SAMPLE_INTERVAL_MS) {
    return;
  }
  _lastHealthSampleTime = now0;

  const idx = _sampleIndex % SAMPLE_WINDOW;

  // Measure all metrics
  const integrity = measureIntegrity(field);
  const energyDrift = measureEnergyDrift(field);
  const waveDivergence = measureWaveDivergence(field);
  const particleLoss = measureParticleLoss(renderPlan);
  const jitter = measureJitter();

  // Store in rolling buffers
  _jitterSamples[idx] = jitter;
  _integrityHistory[idx] = integrity;

  // Compute rolling averages
  const filled = Math.min(_sampleIndex + 1, SAMPLE_WINDOW);
  let avgJitter = 0, avgIntegrity = 0;
  for (let i = 0; i < filled; i++) {
    avgJitter += _jitterSamples[i];
    avgIntegrity += _integrityHistory[i];
  }
  avgJitter /= filled;
  avgIntegrity /= filled;

  // Determine stability
  const stable =
    avgIntegrity >= NAN_INTEGRITY_WARN &&
    energyDrift < ENERGY_DRIFT_WARN &&
    waveDivergence < WAVE_DIVERGE_WARN &&
    particleLoss < PARTICLE_LOSS_WARN;

  // Track warnings
  if (!stable && _sampleIndex > SAMPLE_WINDOW) {
    _warningCount++;
    if (_warningCount % 60 === 1) {
      console.warn('[SimHealth] Instability detected:', {
        integrity: avgIntegrity.toFixed(4),
        energyDrift: energyDrift.toFixed(4),
        waveDivergence: waveDivergence.toFixed(2),
        particleLoss: particleLoss.toFixed(4),
      });
    }
  }

  // Update health snapshot
  _health = {
    stable,
    rk4Integrity: +avgIntegrity.toFixed(4),
    windEnergyDrift: +energyDrift.toFixed(4),
    waveDivergence: +waveDivergence.toFixed(2),
    particleLossRate: +particleLoss.toFixed(4),
    frameJitterMs: +avgJitter.toFixed(1),
    warningCount: _warningCount,
    resetCount: _resetCount,
    samplesCollected: _sampleIndex + 1,
  };

  // Expose to browser console
  if (typeof window !== 'undefined') {
    window.__SIM_HEALTH__ = _health;
  }

  _sampleIndex++;
}

// ========================================================================
// LIFECYCLE
// ========================================================================

/**
 * Start health monitoring.
 */
export function startHealthMonitor() {
  if (_unsubscribe) return;
  _unsubscribe = onRenderPlan(onPlanReceived);
  console.log('[SimHealth] Health monitor started');
}

/**
 * Stop health monitoring.
 */
export function stopHealthMonitor() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
}

/**
 * Get current health snapshot.
 */
export function getHealthSnapshot() {
  return { ..._health };
}

/**
 * Record an emergency field reset (called from FieldEvolutionEngine).
 */
export function recordFieldReset() {
  _resetCount++;
  _initialWindEnergy = null; // Re-baseline after reset
}
