/**
 * Render Orchestrator — Engine-Level Render Coordination
 *
 * Wraps the CanvasAnimationCoordinator with engine-level lifecycle:
 *   - Plugin layer update/render calls
 *   - Init-sequencer gate enforcement
 *   - Metric aggregation from coordinator + WebGL
 *
 * This is the engine-layer counterpart to the map-level coordinator.
 * MapWebGL.js calls the coordinator directly for Canvas2D layers.
 * This module adds the plugin lifecycle on top.
 *
 * RULES:
 *   - NO import-time side effects
 *   - NO React
 *   - Coordinates with init-sequencer state machine
 */

import { getInitState } from './init-sequencer';
import { updatePlugins, renderPlugins } from '../components/map/LayerRegistry';

var _running = false;
var _rafId = null;
var _lastTime = 0;

/**
 * Frame function — updates and renders all plugin layers.
 * Only runs after engine is ready (via init-sequencer).
 */
function frame(time) {
  if (!_running) return;

  var state = getInitState();
  if (state !== 'engine-ready' && state !== 'layers-ready' && state !== 'complete') {
    // Engine not ready — wait
    _rafId = requestAnimationFrame(frame);
    return;
  }

  var dt = (time - _lastTime) / 1000;
  _lastTime = time;

  // Clamp dt to prevent huge jumps on tab switch
  dt = Math.min(dt, 0.05);

  // 1. Update plugin simulation logic
  updatePlugins(dt);

  // 2. Render plugin outputs
  renderPlugins();

  _rafId = requestAnimationFrame(frame);
}

/**
 * Start the plugin render loop.
 * CRITICAL: Only ONE loop. Prevents duplicates.
 */
export function startPluginRenderLoop() {
  if (_running) return;
  _running = true;
  _lastTime = performance.now();
  _rafId = requestAnimationFrame(frame);
  console.log('[RenderOrchestrator] Plugin loop started');
}

/**
 * Stop the plugin render loop.
 */
export function stopPluginRenderLoop() {
  _running = false;
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  console.log('[RenderOrchestrator] Plugin loop stopped');
}

/** @returns {boolean} */
export function isPluginLoopRunning() {
  return _running;
}
