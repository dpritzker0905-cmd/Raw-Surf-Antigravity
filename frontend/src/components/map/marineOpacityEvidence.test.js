import { beginOpacityEvidence, finishOpacityEvidence, opacityEngineState } from './marineOpacityEvidence';
import { createCustomLayer } from './WebGLMarineCustomLayer';

const regional = () => ({ bounds: { west: -83, south: 26, east: -79, north: 30 },
  cols: 5, rows: 5, __sourceModel: 'GFS', __componentLayer: 'waves' });
const globalGrid = () => ({ bounds: { west: -180, south: -80, east: 180, north: 80 }, cols: 37, rows: 17 });
const ref = current => ({ current });

beforeEach(() => {
  delete window.__RAW_OPACITY_EVIDENCE__;
  delete window.__RAW_CAPTURE_OPACITY__;
  delete window.__RAW_COARSE_BRIDGE_GRACE__;
  delete window.__MARINE_FETCH_PENDING__;
  global.WebGLRenderingContext = class {};
  global.WebGL2RenderingContext = class {};
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('disabled observation leaves a frozen engine untouched and creates no evidence store', () => {
  const engine = Object.freeze({ _waveData: { waveGrid: regional() }, setWaveData() {} });
  expect(beginOpacityEvidence(engine)).toBeNull();
  expect(window.__RAW_OPACITY_EVIDENCE__).toBeUndefined();
});

it('snapshots identities without holding mutable grids or inferring a missing model', () => {
  const grid = regional(), coarse = globalGrid();
  const engine = { _waveData: { waveGrid: grid }, _coarseBaseData: { waveGrid: coarse, u_waveTexture: {} } };
  const first = opacityEngineState(engine);
  grid.bounds.west = -84;
  expect(first.resident.bounds[0]).toBe(-83);
  expect(first.coarse.model).toBeNull();
  const second = opacityEngineState(engine);
  expect(second.resident.id).toBe(first.resident.id);
  expect(second.resident.id).not.toBe(second.coarse.id);
});

it('lifecycle observation preserves this, argument references, return and exception identity', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  const grid = regional(), gl = {}, land = {}, result = {}, error = new Error('encode failed');
  const original = jest.fn(function(g, incoming, l) {
    expect(this).toBe(engine); expect(g).toBe(gl); expect(incoming).toBe(grid); expect(l).toBe(land);
    this._waveData = { waveGrid: incoming }; return result;
  });
  const engine = { setWaveData: original, _freeCoarseBase() { throw error; } };
  const frame = beginOpacityEvidence(engine);
  expect(engine.setWaveData(gl, grid, land)).toBe(result);
  let caught;
  try { engine._freeCoarseBase(); } catch (e) { caught = e; }
  expect(caught).toBe(error);
  finishOpacityEvidence(frame, engine);
  expect(original).toHaveBeenCalledTimes(1);
  const store = window.__RAW_OPACITY_EVIDENCE__;
  expect(store.events).toHaveLength(2);
  expect(store.events[0].after.resident.id).toBe(frame.after.resident.id);
  expect(store.events[1].threw).toBe(true);
  expect(store.errors).toBe(0);
  window.__RAW_CAPTURE_OPACITY__ = false;
  engine.setWaveData(gl, grid, land);
  expect(store.eventsSeen).toBe(2);
});

it('caps lifecycle evidence and reports every dropped event', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  const engine = { bridgeToCoarseGlobalIfHeld: () => false };
  beginOpacityEvidence(engine);
  for (let i = 0; i < 2503; i++) expect(engine.bridgeToCoarseGlobalIfHeld()).toBe(false);
  const store = window.__RAW_OPACITY_EVIDENCE__;
  expect(store.events).toHaveLength(2500);
  expect(store.eventsSeen).toBe(2503);
  expect(store.eventsDropped).toBe(3);
  expect(Math.min(...store.events.map(event => event.seq))).toBe(4);
  expect(Math.max(...store.events.map(event => event.seq))).toBe(2503);
});

function renderCase({ capture, moving, coarse, covered = false, swap = false }) {
  window.__RAW_CAPTURE_OPACITY__ = capture;
  window.__MARINE_FETCH_PENDING__ = moving;
  const engine = { _waveData: { waveGrid: regional() },
    _coarseBaseData: coarse ? { waveGrid: globalGrid(), u_waveTexture: {} } : null };
  const calls = [];
  engine.render = (...args) => {
    calls.push({ width: args[2], height: args[3], zoom: args[4], theme: args[5], viewport: args[6], mult: args[7] });
    if (swap) engine._waveData = { waveGrid: globalGrid() };
  };
  const vb = covered ? [-82, 27, -80, 29] : [-85, 24, -77, 32];
  const map = { getBounds: () => ({ getWest: () => vb[0], getSouth: () => vb[1], getEast: () => vb[2], getNorth: () => vb[3] }),
    getZoom: () => 6.75, isZooming: () => false, isMoving: () => false,
    getCanvas: () => ({ width: 1280, height: 800 }), triggerRepaint: jest.fn() };
  const layer = createCustomLayer(engine, ref(true), ref(map), ref(null), ref(null), ref(null), ref('dark'),
    ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
  layer.render({}, new Float32Array(16));
  return { calls, repaint: map.triggerRepaint.mock.calls.length, frame: window.__RAW_OPACITY_EVIDENCE__?.frame };
}

it.each([
  { moving: true, coarse: true }, { moving: true, coarse: false },
  { moving: false, coarse: false }, { moving: false, coarse: true },
  { moving: true, coarse: true, covered: true }, { moving: true, coarse: true, swap: true },
])('observing the actual custom layer changes no render calls or repaint behavior: %j', scenario => {
  const off = renderCase({ ...scenario, capture: false });
  const on = renderCase({ ...scenario, capture: true });
  expect(on.calls).toEqual(off.calls);
  expect(on.repaint).toBe(off.repaint);
  expect(on.frame.seq).toBeGreaterThan(0);
  if (scenario.covered) expect(on.frame.gate).toBeUndefined();
  else expect(on.frame.gate.result.coarseBridge).toBe(scenario.coarse);
  if (!scenario.moving && !scenario.coarse) {
    expect(on.calls).toHaveLength(0);
    expect(on.frame.gate.result.bail).toBe(true);
    expect(on.frame.status).toBe('entered');
  } else {
    expect(on.frame.status).toBe('engine-returned');
    expect(on.frame.inputMult).toBe(scenario.covered ? 1 : 0);
  }
  if (scenario.swap) expect(on.frame.before.resident.id).not.toBe(on.frame.after.resident.id);
});

it('records fetch-pending separately from actual map motion, with grace remaining disabled', () => {
  const { frame } = renderCase({ moving: true, coarse: true, capture: true });
  expect(frame.gate.isZoomingOrMoving).toBe(true);
  expect(frame.grace).toEqual({ moving: false, mult: 0, state: null });
  expect(frame.flags.__RAW_COARSE_BRIDGE_GRACE__).toBeNull();
});
