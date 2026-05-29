/**
 * SimulationLoop.js — Live Physics Engine Core
 *
 * This is the HEART of the simulation. It subscribes to the
 * render-orchestrator's fixed-timestep loop and drives:
 *
 *   1. Field evolution (wind smoothing, wave propagation, coupling)
 *   2. RK4 particle advection (wind + marine)
 *   3. RenderPlan generation from evolved state
 *
 * EXECUTION MODEL:
 *   - SimulationLoop subscribes to render-orchestrator
 *   - Every tick (60Hz): evolve field → update particles → compose plan
 *   - Every render frame: notify React bridge with latest RenderPlan
 *   - Runs INDEPENDENTLY of React render cycle
 *
 * RULES:
 *   - NO React, NO DOM, NO MapLibre
 *   - Deterministic: same inputs at same simTime → same outputs
 *   - Communicates to React via subscriber callbacks only
 */

import { ParticleSystem, TRAIL_LENGTH } from './particle-system';
import { onSimulationUpdate, onRender } from './render-orchestrator';
import { composeRenderPlan } from './FieldCompositionEngine';
import { cloneField } from './SimulationField';
import { evolveField, getEvolutionDiagnostics, setBaseFieldRef, resetEnergyBaseline, onFieldReset } from './FieldEvolutionEngine';
import { recordFieldReset } from './SimulationHealthMonitor';
import { recordSimTick, recordCompose, advanceFrame } from './PerformanceBudget';

// ========================================================================
// SIMULATION STATE
// ========================================================================

let _baseField = null;       // Latest field from data sources (immutable reference)
let _evolvedField = null;    // Cloned field that evolves over time (mutable)
let _config = null;          // Current render config
let _renderPlan = null;      // Latest RenderPlan output
let _windParticles = null;   // RK4 wind particle system
let _marineParticles = null; // RK4 marine particle system
let _simTime = 0;            // Total simulation time (seconds)
let _frameIndex = 0;         // Monotonic frame counter
let _initialized = false;
let _unsubUpdate = null;
let _unsubRender = null;
let _evolutionTicks = 0;     // Count of evolution steps applied
let _lastFieldRevision = 0;  // Track when new base data arrives

// Render plan subscribers (React bridge)
const _planSubscribers = [];

// ========================================================================
// PARTICLE SYSTEM CONFIGURATION
// ========================================================================

const WIND_PARTICLE_COUNT = 6000;
const MARINE_PARTICLE_COUNT = 3000;
const SIM_BOUNDS = { width: 512, height: 512 };

// Throttle evolution to every N ticks (60Hz is too fast for field evolution)
// Field evolves at ~15Hz, particles at 60Hz
const FIELD_EVOLUTION_INTERVAL = 4;

function ensureWindParticles() {
  if (_windParticles) return;
  _windParticles = new ParticleSystem({
    count: WIND_PARTICLE_COUNT,
    bounds: SIM_BOUNDS,
    speedScale: 0.00025,
  });
  console.log(`[SimLoop] Wind particle system: ${WIND_PARTICLE_COUNT} particles, RK4 advection`);
}

function ensureMarineParticles() {
  if (_marineParticles) return;
  _marineParticles = new ParticleSystem({
    count: MARINE_PARTICLE_COUNT,
    bounds: SIM_BOUNDS,
    speedScale: 0.00015,
  });
  console.log(`[SimLoop] Marine particle system: ${MARINE_PARTICLE_COUNT} particles, RK4 advection`);
}

// ========================================================================
// FIELD BINDING (called from React via bridge)
// ========================================================================

/**
 * Bind a new SimulationField from data sources.
 * This is the "base truth" — fresh data from Open-Meteo/GFS/ICON.
 * The evolution engine clones and mutates this over time.
 *
 * @param {import('./SimulationField').SimulationField} field
 */
export function bindField(field) {
  if (!field) return;

  // Detect new data arrival
  if (field.revision !== _lastFieldRevision) {
    _lastFieldRevision = field.revision;
    _baseField = field;

    // Clone for mutable evolution
    _evolvedField = cloneField(field);

    // Deep-clone typed arrays so evolution doesn't corrupt base data
    _evolvedField.grid = {
      windU:          new Float32Array(field.grid.windU),
      windV:          new Float32Array(field.grid.windV),
      waveHeight:     new Float32Array(field.grid.waveHeight),
      waveDir:        new Float32Array(field.grid.waveDir),
      wavePeriod:     new Float32Array(field.grid.wavePeriod),
      swellHeight:    new Float32Array(field.grid.swellHeight),
      swellDir:       new Float32Array(field.grid.swellDir),
      swellPeriod:    new Float32Array(field.grid.swellPeriod),
      windWaveHeight: new Float32Array(field.grid.windWaveHeight),
      windWaveDir:    new Float32Array(field.grid.windWaveDir),
      windWavePeriod: new Float32Array(field.grid.windWavePeriod),
      pressure:       new Float32Array(field.grid.pressure),
      landMask:       new Uint8Array(field.grid.landMask),
    };

    _evolutionTicks = 0;

    // Set base field ref for emergency resets in FieldEvolutionEngine
    setBaseFieldRef(field);
    resetEnergyBaseline();

    console.log(`[SimLoop] New field bound: rev=${field.revision}, ${field.cols}×${field.rows}, sources=`, field.sources);

    // Bind wind field to RK4 particle system
    if (field.sources.wind) {
      ensureWindParticles();
      _windParticles.setField(
        _evolvedField.grid.windU,
        _evolvedField.grid.windV,
        field.cols,
        field.rows
      );
    }

    // Bind marine wave field for particle advection
    if (field.sources.marine && field.grid.waveHeight) {
      ensureMarineParticles();
      rebindMarineParticles();
    }
  }
}

/**
 * Rebuild marine particle field from evolved wave data.
 * Converts waveHeight + waveDir → synthetic u/v for advection.
 */
function rebindMarineParticles() {
  if (!_marineParticles || !_evolvedField) return;

  const f = _evolvedField;
  const len = f.cols * f.rows;
  const waveU = new Float32Array(len);
  const waveV = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const h = f.grid.waveHeight[i];
    const dir = f.grid.waveDir[i] * (Math.PI / 180);
    // Stokes drift: proportional to wave height, in wave direction
    waveU[i] = h * 0.3 * Math.sin(dir);
    waveV[i] = h * 0.3 * Math.cos(dir);
  }

  _marineParticles.setField(waveU, waveV, f.cols, f.rows);
}

/**
 * Bind rendering configuration.
 * @param {Object} config - { activeLayers, activeMarineLayer, theme, oceanMaskEnabled }
 */
export function bindConfig(config) {
  _config = config;
}

// ========================================================================
// SIMULATION TICK (60Hz fixed timestep)
// ========================================================================

/**
 * Core simulation step. Called at FIXED TIMESTEP by render-orchestrator.
 *
 * Execution order:
 *   1. Evolve field (wind smoothing, wave propagation, coupling) — 15Hz
 *   2. RK4 wind particle advection — 60Hz
 *   3. RK4 marine particle advection — 60Hz
 *   4. Rebind marine particles after field evolution
 *
 * @param {number} dt - Fixed delta time (1/60 seconds)
 * @param {number} simTime - Total elapsed simulation time
 */
function simulationTick(dt, simTime) {
  const t0 = performance.now();
  _simTime = simTime;
  _frameIndex++;

  if (!_evolvedField) return;

  // ---- FIELD EVOLUTION (throttled to ~15Hz) ----
  if (_frameIndex % FIELD_EVOLUTION_INTERVAL === 0) {
    evolveField(_evolvedField, dt * FIELD_EVOLUTION_INTERVAL, simTime);
    _evolutionTicks++;

    // Re-bind particles to evolved field data
    if (_windParticles && _evolvedField.sources.wind) {
      _windParticles.setField(
        _evolvedField.grid.windU,
        _evolvedField.grid.windV,
        _evolvedField.cols,
        _evolvedField.rows
      );
    }

    if (_marineParticles && _evolvedField.sources.marine) {
      rebindMarineParticles();
    }
  }

  // ---- RK4 WIND PARTICLE ADVECTION (60Hz) ----
  if (_windParticles && _evolvedField.sources.wind) {
    _windParticles.update(dt);
  }

  // ---- RK4 MARINE PARTICLE ADVECTION (60Hz) ----
  if (_marineParticles && _evolvedField.sources.marine) {
    _marineParticles.update(dt);
  }

  recordSimTick(performance.now() - t0);
  advanceFrame();
}

// ========================================================================
// RENDER CALLBACK (display refresh rate)
// ========================================================================

/**
 * Called at DISPLAY REFRESH RATE. Generates RenderPlan and notifies subscribers.
 *
 * @param {number} alpha - Interpolation factor between simulation steps
 * @param {number} simTime - Total elapsed simulation time
 */
function renderCallback(alpha, simTime) {
  if (!_evolvedField || !_config) return;

  // Compose RenderPlan from EVOLVED field (not base)
  _renderPlan = composeRenderPlan(_evolvedField, _config);

  if (_renderPlan) {
    // Attach simulation clock
    _renderPlan.simTime = simTime;
    _renderPlan.frameIndex = _frameIndex;
    _renderPlan.alpha = alpha;
    _renderPlan.evolutionTicks = _evolutionTicks;

    // Attach RK4-evolved particle positions
    if (_windParticles && _renderPlan.windParticles.active) {
      _renderPlan.windParticles.rk4Particles = _windParticles.getParticles();
      _renderPlan.windParticles.particleCount = _windParticles.getCount();
      _renderPlan.windParticles.trailLength = TRAIL_LENGTH;
    }

    if (_marineParticles && _renderPlan.waveField.active) {
      _renderPlan.waveField.rk4Particles = _marineParticles.getParticles();
      _renderPlan.waveField.particleCount = _marineParticles.getCount();
    }

    // Attach evolution diagnostics
    _renderPlan.evolution = getEvolutionDiagnostics(_evolvedField);

    // Attach evolved field reference for GPU dispatcher (non-enumerable to keep plan clean)
    Object.defineProperty(_renderPlan, '_evolvedField', {
      value: _evolvedField,
      enumerable: false,
      configurable: true,
    });
  }

  // Notify all subscribers (React bridge)
  for (let i = 0; i < _planSubscribers.length; i++) {
    try {
      _planSubscribers[i](_renderPlan, _frameIndex);
    } catch (e) {
      console.warn('[SimLoop] Subscriber error:', e.message);
    }
  }
}

// ========================================================================
// SUBSCRIBER API
// ========================================================================

/**
 * Subscribe to RenderPlan updates.
 * @param {Function} fn - (renderPlan, frameIndex) => void
 * @returns {Function} unsubscribe
 */
export function onRenderPlan(fn) {
  _planSubscribers.push(fn);
  if (_renderPlan) fn(_renderPlan, _frameIndex);
  return () => {
    const idx = _planSubscribers.indexOf(fn);
    if (idx >= 0) _planSubscribers.splice(idx, 1);
  };
}

// ========================================================================
// LIFECYCLE
// ========================================================================

/**
 * Start the simulation loop.
 */
export function startSimulation() {
  if (_initialized) return;
  _initialized = true;

  _unsubUpdate = onSimulationUpdate(simulationTick);
  _unsubRender = onRender(renderCallback);

  console.log('[SimLoop] Simulation started — RK4 particles + field evolution active');
}

/**
 * Stop the simulation loop.
 */
export function stopSimulation() {
  if (!_initialized) return;
  _initialized = false;

  if (_unsubUpdate) { _unsubUpdate(); _unsubUpdate = null; }
  if (_unsubRender) { _unsubRender(); _unsubRender = null; }

  console.log('[SimLoop] Simulation stopped');
}

/**
 * Get simulation diagnostics.
 */
export function getSimDiagnostics() {
  return {
    running: _initialized,
    simTime: _simTime.toFixed(2),
    frameIndex: _frameIndex,
    evolutionTicks: _evolutionTicks,
    hasBaseField: !!_baseField,
    hasEvolvedField: !!_evolvedField,
    windParticles: _windParticles ? _windParticles.getCount() : 0,
    marineParticles: _marineParticles ? _marineParticles.getCount() : 0,
    planSubscribers: _planSubscribers.length,
    hasRenderPlan: !!_renderPlan,
    fieldEvolutionRate: `${60 / FIELD_EVOLUTION_INTERVAL}Hz`,
  };
}
