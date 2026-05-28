/**
 * Engine Bootstrap v2 Controlled Init Entry Point
 *
 * SAFE ENGINE START:
 *   - NO import-time execution
 *   - NO React coupling
 *   - Uses InitSequencer safety gate
 * - Coordinates: layer bootstrap render loop start forecast pipeline
 *
 * Call ONLY from MapWebGL.js onLoad callback (after MapLibre ready).
 *
 * v2 UPGRADES:
 *   - Starts render-orchestrator v2 (fixed timestep loop)
 *   - Wires forecast pipeline subscribers
 *   - Binds GPU texture manager to WebGL context
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
import { startPluginRenderLoop, stopPluginRenderLoop } from './render-orchestrator';
import { bindContext as bindGPUContext, destroyAll as destroyGPU } from './gpu-texture-manager';
import { startSimulation, stopSimulation } from './SimulationLoop';
import { startDispatcher, stopDispatcher } from './RenderPlanDispatcher';

var _initialized = false;

/**
 * Initialize the engine. Called ONCE after MapLibre is ready.
 *
 * @param {Object} ctx
 * @param {HTMLCanvasElement} [ctx.canvas]
 * @param {*} ctx.mapInstance - MapLibre map instance
 * @param {WebGLRenderingContext|WebGL2RenderingContext} [ctx.gl] - shared GL context
 * @param {Object} [ctx.config]
 */
export function initEngine(ctx) {
  if (_initialized) return;

 // HARD SAFETY GATE prevents "ge/be before initialization" crash class
  assertSafeToInitEngine();

  _initialized = true;
  console.log('[EngineBootstrap v2] Starting engine init...');

  // 1. Bind GPU texture manager if GL context available
  if (ctx.gl) {
    bindGPUContext(ctx.gl);
  }

  // 2. Register all core layers from LAYER_REGISTRY (safe sync)
  bootstrapCoreLayers();
  markLayersReady();

  // 3. Initialize plugins that need runtime context
  initPlugins({
    canvas: ctx.canvas,
    mapInstance: ctx.mapInstance,
    gl: ctx.gl,
    config: ctx.config || {},
  });

  // 4. Start the single render loop (fixed timestep v2)
  startPluginRenderLoop();

  // 4b. Start SimulationLoop (RK4 physics — subscribes to render-orchestrator)
  startSimulation();

  // 4c. Start RenderPlan dispatcher (bridges evolved field → GPU renderers)
  startDispatcher();

  // 5. Mark engine ready (resolves waitForEngineBoot promises)
  markEngineReady();

  // 6. Boot complete
  markComplete();
  console.log('[EngineBootstrap v2] Engine ready. Render loop started.');
}

/**
 * Shutdown the engine cleanly.
 * Call on component unmount / page navigation.
 */
export function shutdownEngine() {
  if (!_initialized) return;
  stopDispatcher();
  stopSimulation();
  stopPluginRenderLoop();
  destroyGPU();
  _initialized = false;
  console.log('[EngineBootstrap v2] Engine shutdown.');
}

/** @returns {boolean} */
export function isEngineInitialized() {
  return _initialized;
}
