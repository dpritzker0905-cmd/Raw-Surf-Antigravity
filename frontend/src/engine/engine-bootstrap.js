/**
 * Engine Bootstrap — Controlled Init Entry Point
 *
 * SAFE ENGINE START:
 *   - NO import-time execution
 *   - NO React coupling
 *   - Uses InitSequencer safety gate
 *   - Coordinates layer bootstrap → render loop start
 *
 * Call ONLY from MapWebGL.js onLoad callback (after MapLibre ready).
 */

import {
  assertSafeToInitEngine,
  markEngineReady,
  markLayersReady,
  markComplete
} from './init-sequencer';
import {
  bootstrapCoreLayers,
  initPlugins
} from '../components/map/LayerRegistry';

var _initialized = false;

/**
 * Initialize the engine. Called ONCE after MapLibre is ready.
 *
 * @param {Object} ctx
 * @param {HTMLCanvasElement} [ctx.canvas]
 * @param {*} ctx.mapInstance - MapLibre map instance
 * @param {Object} [ctx.config]
 */
export function initEngine(ctx) {
  if (_initialized) return;

  // HARD SAFETY GATE — prevents "ge/be before initialization" crash class
  assertSafeToInitEngine();

  _initialized = true;
  console.log('[EngineBootstrap] Starting engine init...');

  // 1. Register all core layers from LAYER_REGISTRY (safe sync)
  bootstrapCoreLayers();
  markLayersReady();

  // 2. Initialize plugins that need runtime context
  initPlugins({
    canvas: ctx.canvas,
    mapInstance: ctx.mapInstance,
    config: ctx.config || {},
  });

  // 3. Mark engine ready (resolves waitForEngineBoot promises)
  markEngineReady();

  // 4. Boot complete
  markComplete();
  console.log('[EngineBootstrap] Engine ready. All layers bootstrapped.');
}

/** @returns {boolean} */
export function isEngineInitialized() {
  return _initialized;
}
