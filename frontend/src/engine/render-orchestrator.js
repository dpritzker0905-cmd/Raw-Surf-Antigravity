/**
 * Render Orchestrator v2 — Fixed Timestep + Decoupled Render Architecture
 *
 * GAME ENGINE PATTERN:
 *   Simulation runs at a FIXED timestep (deterministic).
 *   Rendering runs at display refresh rate (smooth).
 *   Interpolation bridges the gap between simulation and render.
 *
 * This replaces the v1 orchestrator with proper frame pacing,
 * preventing the common issue of simulation speed being tied to FPS.
 *
 * RULES:
 *   - ONE single RAF loop (no duplicates)
 *   - Fixed timestep simulation (16.67ms = 60Hz)
 *   - Render interpolation for smooth visuals
 *   - NO import-time side effects
 *   - NO React coupling
 *   - Coordinates with init-sequencer state machine
 */

import { getInitState } from './init-sequencer';
import { updatePlugins, renderPlugins } from '../components/map/LayerRegistry';

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const FIXED_DT = 1 / 60;          // 16.67ms simulation step
const MAX_FRAME_TIME = 0.1;        // Clamp to prevent spiral of death
const MAX_UPDATES_PER_FRAME = 4;   // Safety: max simulation steps per render

// ─── STATE ───────────────────────────────────────────────────────────────────
let _running = false;
let _rafId = null;
let _accumulator = 0;
let _lastTime = 0;
let _simTime = 0;        // Total simulation time elapsed
let _frameCount = 0;
let _fpsAccum = 0;
let _fps = 0;
let _lastFpsUpdate = 0;

// ─── SUBSCRIBER SYSTEM ──────────────────────────────────────────────────────
// External systems (particle renderers, weather layers) register callbacks
const _updateSubscribers = [];   // Called at fixed timestep: fn(dt, simTime)
const _renderSubscribers = [];   // Called each frame: fn(alpha, simTime)

/**
 * Register a simulation update callback (fixed timestep).
 * @param {Function} fn - (dt: number, simTime: number) => void
 * @returns {Function} unsubscribe
 */
export function onSimulationUpdate(fn) {
  _updateSubscribers.push(fn);
  return () => {
    const idx = _updateSubscribers.indexOf(fn);
    if (idx >= 0) _updateSubscribers.splice(idx, 1);
  };
}

/**
 * Register a render callback (display refresh rate).
 * @param {Function} fn - (alpha: number, simTime: number) => void
 * @returns {Function} unsubscribe
 */
export function onRender(fn) {
  _renderSubscribers.push(fn);
  return () => {
    const idx = _renderSubscribers.indexOf(fn);
    if (idx >= 0) _renderSubscribers.splice(idx, 1);
  };
}

/**
 * Core frame function — decoupled update/render loop.
 */
function frame(timestamp) {
  if (!_running) return;

  const state = getInitState();
  if (state !== 'engine-ready' && state !== 'layers-ready' && state !== 'complete') {
    _rafId = requestAnimationFrame(frame);
    return;
  }

  // Calculate frame time
  if (_lastTime === 0) _lastTime = timestamp;
  let frameTime = (timestamp - _lastTime) / 1000;
  _lastTime = timestamp;

  // Clamp to prevent spiral of death (e.g. tab was in background)
  if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

  // ── FIXED TIMESTEP SIMULATION ──────────────────────────────────────────
  _accumulator += frameTime;
  let updates = 0;

  while (_accumulator >= FIXED_DT && updates < MAX_UPDATES_PER_FRAME) {
    // 1. Update plugin layers at fixed rate
    updatePlugins(FIXED_DT);

    // 2. Notify simulation subscribers
    for (let i = 0; i < _updateSubscribers.length; i++) {
      _updateSubscribers[i](FIXED_DT, _simTime);
    }

    _accumulator -= FIXED_DT;
    _simTime += FIXED_DT;
    updates++;
  }

  // ── RENDER (at display refresh rate) ───────────────────────────────────
  // alpha = how far between the last simulation step and the next
  // Used by renderers to interpolate between states for smooth visuals
  const alpha = _accumulator / FIXED_DT;

  // Render plugin outputs
  renderPlugins();

  // Notify render subscribers with interpolation alpha
  for (let i = 0; i < _renderSubscribers.length; i++) {
    _renderSubscribers[i](alpha, _simTime);
  }

  // ── FPS COUNTER ────────────────────────────────────────────────────────
  _frameCount++;
  _fpsAccum += frameTime;
  if (timestamp - _lastFpsUpdate >= 1000) {
    _fps = Math.round(_frameCount / _fpsAccum);
    _frameCount = 0;
    _fpsAccum = 0;
    _lastFpsUpdate = timestamp;
  }

  _rafId = requestAnimationFrame(frame);
}

/**
 * Start the engine render loop.
 * CRITICAL: Only ONE loop globally. Prevents duplicates.
 */
export function startPluginRenderLoop() {
  if (_running) return;
  _running = true;
  _lastTime = 0;
  _accumulator = 0;
  _rafId = requestAnimationFrame(frame);
  console.log('[RenderOrchestrator v2] Engine loop started (fixed timestep)');
}

/**
 * Stop the engine render loop.
 */
export function stopPluginRenderLoop() {
  _running = false;
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  console.log('[RenderOrchestrator v2] Engine loop stopped');
}

/** @returns {boolean} */
export function isPluginLoopRunning() {
  return _running;
}

/** @returns {number} Current FPS */
export function getFPS() {
  return _fps;
}

/** @returns {number} Total simulation time in seconds */
export function getSimTime() {
  return _simTime;
}

/**
 * Get engine diagnostics.
 */
export function getEngineDiagnostics() {
  return {
    running: _running,
    fps: _fps,
    simTime: _simTime.toFixed(2),
    updateSubscribers: _updateSubscribers.length,
    renderSubscribers: _renderSubscribers.length,
  };
}
