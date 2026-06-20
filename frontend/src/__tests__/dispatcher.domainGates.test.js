/**
 * Phase 3.2 — RenderPlanDispatcher domain gates must be LOCAL: a disabled wind
 * upload must skip only the wind block (not return from the whole dispatcher and
 * suppress marine dispatch/diagnostics), and a disabled marine upload must not
 * affect wind dispatch.
 */
import {
  dispatchRenderPlan,
  registerWindEngine,
  registerMarineEngine,
  unregisterWindEngine,
  unregisterMarineEngine,
} from '../engine/RenderPlanDispatcher';

function makeMarineGrid() {
  const a = (v) => new Float32Array([v, v, v, v]);
  return {
    windU: a(1), windV: a(1),
    waveHeight: a(2), waveDir: a(90), wavePeriod: a(8),
    swellHeight: a(0), swellDir: a(0), swellPeriod: a(0),
    swell2Height: a(0), swell2Dir: a(0), swell2Period: a(0),
    windWaveHeight: a(0), windWaveDir: a(0), windWavePeriod: a(0),
    landMask: new Uint8Array([0, 0, 0, 0]),
  };
}

function makePlan() {
  const field = {
    sources: { wind: true, marine: true },
    grid: makeMarineGrid(),
    cols: 2, rows: 2,
    bounds: { west: -100, east: -80, south: 20, north: 40 },
    model: 'GFS', sourceModel: 'GFS', gridProvider: 'open-meteo', componentLayer: 'waves',
    hourOffset: 0,
  };
  return {
    _evolvedField: field,
    waveField: { marineLayer: 'waves', active: true },
    windParticles: { active: true },
    activeModel: 'GFS', model: 'GFS',
  };
}

// DISPATCH_INTERVAL throttles uploads to every 6th call; call 6× to guarantee one.
function dispatch6(plan) {
  for (let i = 0; i < 6; i++) dispatchRenderPlan(plan, i);
}

function mkMarineEngine() {
  return { setWaveData: jest.fn(), clearBuffers: jest.fn(), _dispatcherActive: false, _waveData: null };
}

describe('RenderPlanDispatcher — domain-local upload gates', () => {
  let windEngine, marineEngine;

  beforeEach(() => {
    windEngine = { setWindData: jest.fn() };
    marineEngine = mkMarineEngine();
    registerWindEngine(windEngine, {});
    registerMarineEngine(marineEngine, {});
    // Neutralize scrub / identity early-returns in the marine block.
    window.isScrubbingTimeline = false;
    window.lastScrubTime = 0;
    delete window.activeTimeOffsetHours;
    delete window.activeModel;
    delete window.activeMarineLayer;
    delete window.__FCE_DISPATCH_STATUS__;
    delete window.__FCE_MARINE_BLOCKED__;
  });

  afterEach(() => {
    unregisterWindEngine();
    unregisterMarineEngine();
    delete window.__ALLOW_FCE_WIND_UPLOAD__;
    delete window.__ALLOW_FCE_MARINE_UPLOAD__;
  });

  it('disabled wind upload does NOT suppress marine dispatch when a wind engine is present', () => {
    window.__ALLOW_FCE_WIND_UPLOAD__ = false; // wind disabled
    window.__ALLOW_FCE_MARINE_UPLOAD__ = true; // marine enabled

    dispatch6(makePlan());

    // Marine block was reached (diagnostics written + grid uploaded)...
    expect(window.__FCE_DISPATCH_STATUS__).toBeDefined();
    expect(marineEngine.setWaveData).toHaveBeenCalled();
    // ...while the wind upload was correctly skipped (not suppressing marine).
    expect(windEngine.setWindData).not.toHaveBeenCalled();
    expect(window.__FCE_WIND_BLOCKED__?.blocked).toBe(true);
  });

  it('disabled marine upload does NOT suppress wind dispatch', () => {
    window.__ALLOW_FCE_WIND_UPLOAD__ = true;   // wind enabled
    delete window.__ALLOW_FCE_MARINE_UPLOAD__; // marine disabled

    dispatch6(makePlan());

    expect(windEngine.setWindData).toHaveBeenCalled();
    expect(marineEngine.setWaveData).not.toHaveBeenCalled();
    expect(window.__FCE_MARINE_BLOCKED__?.blocked).toBe(true);
  });
});
