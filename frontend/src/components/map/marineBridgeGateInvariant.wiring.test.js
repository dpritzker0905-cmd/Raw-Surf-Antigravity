/**
 * F-22 (audit 2026-10-01): the gate/bridge invariant is WIRED, end to end, against the real code on both sides.
 *
 * marineBridgeGateInvariant.test.js pins the predicates against a transcription of the layer's gate (marineBridgeGateOracle.testutil.js).
 * This file runs the REAL layer (WebGLMarineCustomLayer.render, the one that hides the clip) and the REAL engine method
 * (bridgeToCoarseGlobalIfHeld, the one that promotes the held base) on the same view, the way the layer/engine pair meets in the app,
 * and it sweeps the real layer over the same zoom x span x coverage grid the predicates run on, so a layer-only drift in the gate
 * (the 0.6, an axis test, the 2026-07-22 break) shows up here even if the transcription still agrees with the bridge. It also pins the
 * call sites (the recorded class of "green unit tests, nothing wired"): the layer and the bridge read the same wide test, the engine
 * hands the bridge the selected instant the layer publishes, and the engine's Phase-B shadow carries the same base-aware switch.
 * "Real engine" here is one prototype method on a fake `this` with `setWaveData` stubbed (the way WebGLMarineEngine.bridgePromote.test.js
 * has always run it): the commit choke and the per-frame order are modelled, with the real decision functions, in
 * marineBridgeGateInvariant.sequence.test.js.
 */
import fs from 'fs';
import path from 'path';
import WebGLMarineEngine from './WebGLMarineEngine';
import { createCustomLayer } from './WebGLMarineCustomLayer';
import { _resetSelectedMemoForTest } from './marineStaleHourLayer';
import { WORLD, viewport, clipFor, gateHides, SPANS, ZOOMS, COVERS } from './marineBridgeGateOracle.testutil';

const bridge = WebGLMarineEngine.prototype.bridgeToCoarseGlobalIfHeld;
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

const ref = (current) => ({ current });
const ANCHOR = Date.parse('2026-10-01T12:00:00Z');
const NOW0 = '2026-10-01T12:00:00Z';
const WED15 = '2026-10-07T15:00:00Z';                                  // the anchor + 147 h: the selected instant when hour 147 is selected
const FAKE_GL = { __fakeGl: true };

const ZOOM = 6.2;
const VB = [-90, 22, -70, 34];                                         // a 20 x 12 deg view at z6.2 (a desktop map)
const GRID = { hourOffset: 147, valid_time: WED15 };
const clip = (over = {}, vb = VB, c = 0.3) => clipFor(vb, c, { ...GRID, ...over });     // 30% of the view: the layer HIDES it (below the 0.6 cover fraction at a wide view)
const fineWorld = (over = {}) => ({
  bounds: WORLD, cols: 181, rows: 82, vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
  __sourceModel: 'GFS', __componentLayer: 'waves', ...GRID, ...over,
});
const coarseWorld = (over = {}) => fineWorld({ cols: 37, rows: 17, ...over });

const mkMap = (vb, zoom) => ({
  getBounds: () => ({ getWest: () => vb[0], getEast: () => vb[2], getSouth: () => vb[1], getNorth: () => vb[3] }),
  getZoom: () => zoom, getCanvas: () => ({ width: 1280, height: 800 }),
  isZooming: () => false, isMoving: () => false, triggerRepaint: jest.fn(),
});

/** The pair as the app has it: the layer renders THIS engine; the engine's bridge reads the view the render loop recorded. */
function makePair(resident, base, { hour = 147, vb = VB, zoom = ZOOM, model = 'GFS' } = {}) {
  const calls = [];
  const engine = {
    clearBuffers: jest.fn(), render: jest.fn(), _initialized: true,
    _pendingDowngrade: null,
    _waveData: { waveGrid: resident },
    _coarseBaseData: base ? { waveGrid: base, u_waveTexture: {} } : null,
    _lastZoom: zoom, _lastViewportBounds: vb.slice(),
    setWaveData(gl, grid, geojson) { calls.push({ grid, geojson }); },
    __setWaveDataCalls: calls,
  };
  const layer = createCustomLayer(engine, ref(true), ref(mkMap(vb, zoom)), ref(null), ref(null), ref(null),
    ref('dark'), ref(null), ref(false), ref(['waves']), ref(hour), ref(null), ref(model));
  return { layer, engine };
}
const frame = (layer) => layer.render({ gl: {}, defaultProjectionData: { mainMatrix: new Float32Array(16) } });
const opacityOf = (engine) => engine.render.mock.calls[engine.render.mock.calls.length - 1][7];

beforeAll(() => {
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(ANCHOR + 10 * 60 * 1000);
  _resetSelectedMemoForTest();
  window.__RAW_GPU__ = {};
  window.__MOCK_DATE_NOW__ = ANCHOR;
  window.__RAW_MARINE_XFAM_HOLD_DISABLED__ = true;
  delete window.isScrubbingTimeline;
  delete window.__MARINE_TRANSITIONING__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__MARINE_FETCH_DEBOUNCING__;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  delete window.__RAW_GPU__;
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_MARINE_XFAM_HOLD_DISABLED__;
  delete window.__RAW_DISABLE_BASE_AWARE_BRIDGE__;
  delete window.__RAW_DISABLE_STALE_HOUR_DIM__;
  delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
  delete window.__MARINE_ZOOMOUT_BRIDGE__;
  jest.restoreAllMocks();
});

describe('the real layer hides the clip, and the real engine promotes the held 2 deg base for the same view', () => {
  it('layer: opacity 0 (hidden over the wash); engine: promotes the base, with a NULL land geojson (the all-water-mask rule)', () => {
    const { layer, engine } = makePair(clip(), fineWorld());
    frame(layer);
    expect(opacityOf(engine)).toBe(0);                                  // the gate's verdict for this clip in this band
    expect(bridge.call(engine, FAKE_GL)).toBe(true);                    // pre-F-22 this was false for span 20 <= 40: the hidden frames
    expect(engine.__setWaveDataCalls).toHaveLength(1);
    expect(engine.__setWaveDataCalls[0].grid).toBe(engine._coarseBaseData.waveGrid);
    expect(engine.__setWaveDataCalls[0].geojson).toBeNull();
  });

  it('a clip the layer SHOWS (it covers the view) is not replaced', () => {
    const { layer, engine } = makePair(clip({}, VB, 1.2), fineWorld());   // 1.2: the clip's box is larger than the view
    frame(layer);
    expect(opacityOf(engine)).toBe(1);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
    expect(engine.__setWaveDataCalls).toHaveLength(0);
  });

  it('the 10 deg base keeps the 40 deg ceiling: hidden by the gate, NOT promoted (the 2026-07-22 trade, unchanged)', () => {
    const { layer, engine } = makePair(clip(), coarseWorld());
    frame(layer);
    expect(opacityOf(engine)).toBe(0);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
  });

  it('the kill switch __RAW_DISABLE_BASE_AWARE_BRIDGE__ restores the old behaviour (hidden, not promoted)', () => {
    window.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true;
    const { layer, engine } = makePair(clip(), fineWorld());
    frame(layer);
    expect(opacityOf(engine)).toBe(0);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
  });
});

describe('THE CROSS-CHECK: the real layer over the whole zoom x span x coverage grid', () => {
  it('the layer hides a clip <=> the shared oracle says so <=> the real engine method promotes the held 2 deg base (GFS, EURO and ICON)', () => {
    const miss = [];
    let hidden = 0, n = 0;
    for (const model of ['GFS', 'EURO', 'ICON']) {
      for (const zoom of ZOOMS) for (const [w, h] of SPANS) for (const c of COVERS) {
        if (model !== 'GFS' && !(c === 0.3 || c === 0.8)) continue;       // the other models share the gate: two coverages each is enough
        const vb = viewport(w, h);
        const res = clip({ __sourceModel: model }, vb, c);
        const { layer, engine } = makePair(res, fineWorld({ __sourceModel: model }), { vb, zoom, model });
        frame(layer);
        const layerHides = opacityOf(engine) === 0;
        const oracle = gateHides(zoom, vb, res);
        const promoted = bridge.call(engine, FAKE_GL);
        n++;
        if (layerHides) hidden++;
        if (layerHides !== oracle || promoted !== layerHides) miss.push({ model, zoom, span: [w, h], cover: c, layerHides, oracle, promoted });
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(hidden).toBeGreaterThan(150);                                  // the grid really contains hidden frames
    expect({ count: miss.length, first: miss.slice(0, 2) }).toEqual({ count: 0, first: [] });
  });
});

describe('near the antimeridian the real layer SHOWS a covering clip and the real engine leaves it alone (the band keeps the old rule)', () => {
  // A Fiji-style view: MapLibre reports east 192 (unwrapped), the backend returns the clip WRAPPED (west 170 > east -168).
  const vb = [172, -25, 192, -13];
  const wrapped = () => clipFor(vb, 1, { ...GRID, bounds: { west: 170, south: -26, east: -168, north: -12 } });

  it('layer: shown (wrap-aware); engine: not promoted (its coverage arithmetic has no wrap, so the new rule steps aside)', () => {
    const { layer, engine } = makePair(wrapped(), fineWorld(), { vb, zoom: 6.2 });
    frame(layer);
    expect(opacityOf(engine)).toBe(1);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
    expect(engine.__setWaveDataCalls).toHaveLength(0);
  });
});

describe('the engine promotes only a base for the selected hour, using the instant the layer publishes each frame', () => {
  it('the layer publishes the selected instant every frame, whether or not the resident is a stale world frame', () => {
    const { layer, engine } = makePair(clip(), fineWorld());
    frame(layer);
    expect(engine.__selectedMs).toBe(Date.parse(WED15));                // hour 147 from the anchor
    expect(engine.__staleSwapMs).toBeNull();                            // the resident is a clip: F-21's swap input stays null
  });

  it('a base made for another hour (the page-load world frame while Wednesday is selected) is NOT promoted in this band', () => {
    const { layer, engine } = makePair(clip(), fineWorld({ valid_time: NOW0, hourOffset: 0 }));
    frame(layer);
    expect(opacityOf(engine)).toBe(0);                                  // still hidden, as before: the wash only
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
    expect(engine.__setWaveDataCalls).toHaveLength(0);
  });

  it('...nor a base for the NEIGHBOURING step (3 h off): drawn at full strength it would be a wrong hour, and the F-21 dim starts only at 3.5 h', () => {
    const { layer, engine } = makePair(clip(), fineWorld({ valid_time: '2026-10-07T12:00:00Z' }));
    frame(layer);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
  });

  it('...and IS promoted once the right-hour base is held (the F-21 seed landed)', () => {
    const { layer, engine } = makePair(clip(), fineWorld({ valid_time: NOW0, hourOffset: 0 }));
    frame(layer);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
    engine._coarseBaseData = { waveGrid: fineWorld(), u_waveTexture: {} };
    frame(layer);
    expect(bridge.call(engine, FAKE_GL)).toBe(true);
  });

  it('with BOTH F-21 switches on the readout is not consulted, nothing is published, and the new band keeps the old rule (an unknown hour fails closed)', () => {
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    window.__RAW_DISABLE_STALE_RESIDENT_SWAP__ = true;
    const { layer, engine } = makePair(clip(), fineWorld());
    frame(layer);
    expect(engine.__selectedMs).toBeNull();
    expect(opacityOf(engine)).toBe(0);
    expect(bridge.call(engine, FAKE_GL)).toBe(false);
  });
});

describe('call sites (source pins)', () => {
  it('the layer reads the gate\'s wide test from marineZoomOutGate, and the inline copy is gone', () => {
    const src = read('WebGLMarineCustomLayer.js');
    expect(src).toMatch(/import \{[^}]*\bisGateWideView\b[^}]*\} from '\.\/marineZoomOutGate';/);
    expect(src).toMatch(/const isViewportZoomedOut = isGateWideView\(currentZoom, vpWidth, vpHeight\);/);
    expect(src).not.toMatch(/\(currentZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM\) \|\| \(vpWidth > 15\.0 \|\| vpHeight > 15\.0\)/);
  });

  it('the commit gate reads the SAME function for the bridge\'s wide test (one definition, not a second copy)', () => {
    const src = read('marineCommitGate.js');
    expect(src).toMatch(/import \{ isGateWideView \} from '\.\/marineZoomOutGate';/);
    expect(src).toMatch(/const gateWide = isGateWideView\(lastZoom, vb\[2\] - vb\[0\], vb\[3\] - vb\[1\]\);/);
  });

  it('the engine\'s Phase-B shadow decision carries the same base-aware switch as decideMarineCommit (else every band reject logs an arb_shadow_diverge)', () => {
    const src = read('WebGLMarineEngine.js');
    expect(src).toMatch(/midBandCeilOff: window\.__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__ === true,\s*baseAwareBridge: window\.__RAW_DISABLE_BASE_AWARE_BRIDGE__ !== true/);
  });

  it('the engine hands the bridge the selected instant after the stale-swap instant, on the call it always made', () => {
    const src = read('WebGLMarineEngine.js');
    expect(src).toMatch(/shouldBridgeToCoarseGlobal\(rwg, cbg, this\._lastZoom, this\._lastViewportBounds,\s*\r?\n\s*typeof window !== 'undefined' \? window : undefined, this\.__staleSwapMs, this\.__selectedMs\)\) return false;/);
  });
});
