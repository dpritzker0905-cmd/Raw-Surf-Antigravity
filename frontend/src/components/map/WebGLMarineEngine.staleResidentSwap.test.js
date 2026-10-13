import WebGLMarineEngine from './WebGLMarineEngine';

// The engine's per-frame zoom-out bridge also promotes the held base over a STALE WORLD frame already drawn (2026-10-01, audit F-21;
// marineStaleHour.js rule 4). The predicate has its own tests (marineCommitGate.staleSwap.test.js); this one runs the REAL prototype method
// with a fake `this`, the way WebGLMarineEngine.bridgePromote.test.js does, so the call site that hands the decision the layer's
// `__staleSwapMs` is exercised and not only read in source.

const bridge = WebGLMarineEngine.prototype.bridgeToCoarseGlobalIfHeld;

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const NOW0 = '2026-10-01T12:00:00Z';
const WED15 = '2026-10-07T15:00:00Z';
const SEL = Date.parse(WED15);
const world = (vt, over = {}) => ({ bounds: WORLD, cols: 181, rows: 82, valid_time: vt, vectors: new Array(8).fill({ speed: 1 }), __sourceModel: 'GFS', __componentLayer: 'waves', ...over });
const FAKE_GL = { __fakeGl: true };
const WIDE_VIEWPORT = [-170, -50, 20, 60];

function makeEngine(overrides) {
  const calls = [];
  return {
    _pendingDowngrade: null,
    _coarseBaseData: { waveGrid: world(WED15), u_waveTexture: {} },          // the held base: the selected hour (a seed landed after the zoom-out)
    _waveData: { waveGrid: world(NOW0) },                                      // the frame drawn: the earlier promotion of the old base
    _lastZoom: 3.6,
    _lastViewportBounds: WIDE_VIEWPORT,
    _maskSourceReady: false,
    _maskRetainPatchedOk: true,
    __setWaveDataCalls: calls,
    setWaveData(gl, grid, geojson) { calls.push({ gl, grid, geojson }); },
    ...overrides,
  };
}

afterEach(() => {
  delete window.__RAW_DISABLE_ZOOMOUT_BRIDGE__;
  delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
  delete window.__MARINE_ZOOMOUT_BRIDGE__;
});

describe('bridgeToCoarseGlobalIfHeld: a stale world frame already drawn', () => {
  it('is replaced by the held base when the layer hands the selected instant (the same promotion commit the bridge always made)', () => {
    const eng = makeEngine({ __staleSwapMs: SEL });
    expect(bridge.call(eng, FAKE_GL)).toBe(true);
    expect(eng.__setWaveDataCalls).toHaveLength(1);
    expect(eng.__setWaveDataCalls[0].grid).toBe(eng._coarseBaseData.waveGrid);
    expect(eng.__setWaveDataCalls[0].geojson).toBeNull();
    expect(eng._maskSourceReady).toBe(true);
    expect(eng._maskRetainPatchedOk).toBe(false);
    expect(window.__MARINE_ZOOMOUT_BRIDGE__.count).toBe(1);
  });

  it('is left alone without the instant: a world resident was never bridged and still is not', () => {
    const eng = makeEngine();
    expect(bridge.call(eng, FAKE_GL)).toBe(false);
    expect(eng.__setWaveDataCalls).toHaveLength(0);
  });

  it('is left alone when it is the right hour, and an older base never replaces it', () => {
    const right = makeEngine({ __staleSwapMs: SEL, _waveData: { waveGrid: world(WED15) } });
    expect(bridge.call(right, FAKE_GL)).toBe(false);
    const older = makeEngine({ __staleSwapMs: SEL, _waveData: { waveGrid: world(WED15) }, _coarseBaseData: { waveGrid: world(NOW0), u_waveTexture: {} } });
    expect(bridge.call(older, FAKE_GL)).toBe(false);
    expect(right.__setWaveDataCalls).toHaveLength(0);
    expect(older.__setWaveDataCalls).toHaveLength(0);
  });

  it('is left alone while a downgrade is stashed, and under either kill switch', () => {
    expect(bridge.call(makeEngine({ __staleSwapMs: SEL, _pendingDowngrade: world(WED15) }), FAKE_GL)).toBe(false);
    window.__RAW_DISABLE_STALE_RESIDENT_SWAP__ = true;
    expect(bridge.call(makeEngine({ __staleSwapMs: SEL }), FAKE_GL)).toBe(false);
    delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
    window.__RAW_DISABLE_ZOOMOUT_BRIDGE__ = true;
    expect(bridge.call(makeEngine({ __staleSwapMs: SEL }), FAKE_GL)).toBe(false);
  });

  it('does not undo a model switch: the base is for another model', () => {
    const eng = makeEngine({ __staleSwapMs: SEL, _coarseBaseData: { waveGrid: world(WED15, { __sourceModel: 'ICON' }), u_waveTexture: {} } });
    expect(bridge.call(eng, FAKE_GL)).toBe(false);
    expect(eng.__setWaveDataCalls).toHaveLength(0);
  });
});
