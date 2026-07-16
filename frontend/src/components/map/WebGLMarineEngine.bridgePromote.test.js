import WebGLMarineEngine from './WebGLMarineEngine';

// Regression guard for the 2026-07-16 zoom-out "clearing" keystone (motion coarse-promotion) —
// specifically the PROMOTION COMMIT's side-effects, not the predicate (shouldBridgeToCoarseGlobal
// is covered in WebGLMarineEngine.noDowngrade.test.js):
//
// 1. THE ALL-WATER MASK POISONING: bridgeToCoarseGlobalIfHeld used to pass this._waveData (an
//    encoded-texture set) as setWaveData's landGeoJSON arg. setWaveData persisted it into
//    _landGeoJSON, renderMaskToCanvas's identity check flushed the pristine-canvas LRU, and its
//    featureless-input early-return produced an ALL-WATER world mask — every promotion rendered
//    heatmap/crests over every continent and poisoned later null-geojson commits and
//    _captureCoarseBase until a layer commit repaired _landGeoJSON. The arg must be null.
// 2. FORCED MASK REBUILD: the promotion commits a GLOBAL grid while the cached mask is still the
//    regional's box — without _maskSourceReady=true/_maskRetainPatchedOk=false the encoder's
//    retain guards keep the crisp REGIONAL mask under the WORLD grid and everything outside its
//    box CLAMP_TO_EDGEs water over land (the SC/Cuba bleed geometry).

const bridge = WebGLMarineEngine.prototype.bridgeToCoarseGlobalIfHeld;

const COARSE_GLOBAL = {
  bounds: { west: -180, south: -80, east: 180, north: 85 },
  cols: 37, rows: 17,
  vectors: new Array(629).fill({ speed: 1 }),
};
const REGIONAL = {
  bounds: { west: -84, south: 24, east: -76, north: 32 },
  cols: 13, rows: 13,
  vectors: new Array(169).fill({ speed: 1 }),
};

// Wide continental viewport (z4.5): the 8°×8° regional covers ~2% of it → promotion territory.
const WIDE_VIEWPORT = [-125, 10, -60, 55];
const FAKE_GL = { __fakeGl: true };

function makeEngine(overrides) {
  const calls = [];
  return {
    _pendingDowngrade: null,
    _coarseBaseData: { waveGrid: COARSE_GLOBAL, u_waveTexture: {} },
    _waveData: { waveGrid: REGIONAL },
    _lastZoom: 4.5,
    _lastViewportBounds: WIDE_VIEWPORT,
    // stale flags from an earlier small-viewport commit — the promotion must override BOTH
    _maskSourceReady: false,
    _maskRetainPatchedOk: true,
    __setWaveDataCalls: calls,
    setWaveData(gl, grid, geojson) { calls.push({ gl, grid, geojson }); },
    ...overrides,
  };
}

afterEach(() => {
  delete window.__RAW_DISABLE_ZOOMOUT_BRIDGE__;
  delete window.__RAW_DOWNGRADE_COVER_FRAC__;
  delete window.__MARINE_ZOOMOUT_BRIDGE__;
});

describe('bridgeToCoarseGlobalIfHeld — promotion commit side-effects (zoom-out keystone)', () => {
  it('promotes the held coarse-global and passes NULL as the landGeoJSON arg (all-water mask regression)', () => {
    const eng = makeEngine();
    expect(bridge.call(eng, FAKE_GL)).toBe(true);
    expect(eng.__setWaveDataCalls).toHaveLength(1);
    const call = eng.__setWaveDataCalls[0];
    expect(call.grid).toBe(COARSE_GLOBAL);
    // THE fix: null falls through to the engine's stored real geojson; the old this._waveData
    // arg silently built an all-water world mask and poisoned _landGeoJSON.
    expect(call.geojson).toBeNull();
  });

  it('forces the full mask rebuild (escaped-mask recipe): sourceReady=true, retainPatchedOk=false', () => {
    const eng = makeEngine();
    expect(bridge.call(eng, FAKE_GL)).toBe(true);
    expect(eng._maskSourceReady).toBe(true);      // disarms retain_patched_src_not_ready
    expect(eng._maskRetainPatchedOk).toBe(false); // disarms retain_res_no_downgrade
  });

  it('bumps the shared telemetry counter', () => {
    const eng = makeEngine();
    bridge.call(eng, FAKE_GL);
    expect(window.__MARINE_ZOOMOUT_BRIDGE__.count).toBe(1);
  });

  it('declines without touching state when the predicate says no (regional still covers)', () => {
    // tight viewport fully inside the regional → coverage 1.0 → no promotion
    const eng = makeEngine({ _lastZoom: 8.5, _lastViewportBounds: [-83, 25, -80, 28] });
    expect(bridge.call(eng, FAKE_GL)).toBe(false);
    expect(eng.__setWaveDataCalls).toHaveLength(0);
    expect(eng._maskSourceReady).toBe(false);      // untouched
    expect(eng._maskRetainPatchedOk).toBe(true);   // untouched
  });

  it('declines when no coarse base is held / when the resident is already global', () => {
    const noBase = makeEngine({ _coarseBaseData: null });
    expect(bridge.call(noBase, FAKE_GL)).toBe(false);
    const alreadyGlobal = makeEngine({ _waveData: { waveGrid: COARSE_GLOBAL } });
    expect(bridge.call(alreadyGlobal, FAKE_GL)).toBe(false);
    expect(alreadyGlobal.__setWaveDataCalls).toHaveLength(0);
  });

  it('defers to the self-heal path while a downgrade is stashed', () => {
    const eng = makeEngine({ _pendingDowngrade: REGIONAL });
    expect(bridge.call(eng, FAKE_GL)).toBe(false);
    expect(eng.__setWaveDataCalls).toHaveLength(0);
  });

  it('KILL SWITCH __RAW_DISABLE_ZOOMOUT_BRIDGE__ restores the old no-promotion behavior', () => {
    window.__RAW_DISABLE_ZOOMOUT_BRIDGE__ = true;
    const eng = makeEngine();
    expect(bridge.call(eng, FAKE_GL)).toBe(false);
    expect(eng.__setWaveDataCalls).toHaveLength(0);
  });
});
