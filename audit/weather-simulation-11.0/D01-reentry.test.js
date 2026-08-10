/**
 * Agent G / finding D-01 — EXECUTED reproduction of the claimed mechanism.
 *
 * Claim under test: shutdownEngine() does not reset the init-sequencer, so the
 * MapWebGL re-entry guard (state in {engine-ready, layers-ready, complete})
 * short-circuits and the engine is never restarted.
 *
 * This exercises the REAL modules (no re-implementation) and reproduces the
 * MapWebGL tryInit() branch logic verbatim from MapWebGL.js:647-671.
 */
const SRC = 'C:/Users/dprit/Raw-Surf/frontend/src';

// Minimal browser-ish global so the modules' `typeof window` guards behave like a browser.
global.window = global.window || {};
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const seq = require(SRC + '/engine/init-sequencer');
const boot = require(SRC + '/engine/engine-bootstrap');
const orch = require(SRC + '/engine/render-orchestrator');
const sim = require(SRC + '/engine/SimulationLoop');
const disp = require(SRC + '/engine/RenderPlanDispatcher');

// Verbatim transcription of MapWebGL.js:647-671 tryInit().
function tryInit(userTier) {
  let didInit = false;
  const state = seq.getInitState();
  if (state === 'engine-ready' || state === 'layers-ready' || state === 'complete') {
    didInit = true;
    return { didInit, calledInitEngine: false };
  }
  if (state === 'map-ready') {
    try {
      boot.initEngine({ mapInstance: {}, config: { userTier } });
      didInit = true;
      return { didInit, calledInitEngine: true };
    } catch (err) {
      return { didInit: false, calledInitEngine: true, err };
    }
  }
  return { didInit: false, calledInitEngine: false };
}

test('D-01 mechanism: shutdown leaves state=complete and the guard blocks restart', () => {
  // 1. Boot exactly as the live path does: markMapReady() then the effect runs.
  seq.markMapReady();
  expect(seq.getInitState()).toBe('map-ready');

  const first = tryInit('guest');
  expect(first.calledInitEngine).toBe(true);
  expect(first.didInit).toBe(true);
  expect(boot.isEngineInitialized()).toBe(true);
  expect(seq.getInitState()).toBe('complete');
  expect(orch.isPluginLoopRunning()).toBe(true);
  expect(sim.getSimDiagnostics().running).toBe(true);
  expect(disp.getDispatcherDiagnostics().running).toBe(true);

  // 2. userTier changes -> React runs the cleanup (didInit was true).
  boot.shutdownEngine();
  expect(boot.isEngineInitialized()).toBe(false);
  expect(orch.isPluginLoopRunning()).toBe(false);
  expect(sim.getSimDiagnostics().running).toBe(false);
  expect(disp.getDispatcherDiagnostics().running).toBe(false);

  // THE CLAIM: the sequencer was not reset.
  expect(seq.getInitState()).toBe('complete');

  // 3. The effect body re-runs.
  const second = tryInit('premium');
  expect(second.calledInitEngine).toBe(false);   // short-circuit, no initEngine
  expect(second.didInit).toBe(true);

  // 4. Engine stays down. Permanently.
  expect(boot.isEngineInitialized()).toBe(false);
  expect(orch.isPluginLoopRunning()).toBe(false);
  expect(sim.getSimDiagnostics().running).toBe(false);
  expect(disp.getDispatcherDiagnostics().running).toBe(false);
});

test('D-01 counterfactual: even WITHOUT the guard, initEngine would throw at state=complete', () => {
  expect(seq.getInitState()).toBe('complete');
  expect(() => boot.initEngine({ mapInstance: {}, config: {} }))
    .toThrow(/Engine init blocked\. State=complete/);
});

test('D-01 recovery: only markMapReady() re-arms the sequencer', () => {
  seq.markMapReady();
  const third = tryInit('premium');
  expect(third.calledInitEngine).toBe(true);
  expect(boot.isEngineInitialized()).toBe(true);
  expect(orch.isPluginLoopRunning()).toBe(true);
  boot.shutdownEngine();
});

test('D-01 blast radius: default browser flags gate every consumer OFF', () => {
  const reg = require(SRC + '/components/map/LayerRegistry');
  reg.bootstrapCoreLayers();
  const plugins = reg.getAllPlugins();
  expect(plugins.length).toBeGreaterThan(0);
  // bootstrapCoreLayers registers every core layer with enabled:false, and
  // setPluginEnabled is never called anywhere in src -> updatePlugins/renderPlugins no-op.
  expect(plugins.filter((p) => p.enabled).length).toBe(0);

  // gpu-texture-manager was never bound (MapWebGL passes no ctx.gl), so destroyAll() is a no-op.
  const gpu = require(SRC + '/engine/gpu-texture-manager');
  const diag = gpu.getDiagnostics ? gpu.getDiagnostics() : null;
  if (diag) {
    expect(diag.hasContext).toBe(false);
    expect(diag.textures).toBe(0);
  }
});
