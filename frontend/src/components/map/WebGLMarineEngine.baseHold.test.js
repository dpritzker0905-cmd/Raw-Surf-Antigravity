/**
 * The engine's coarse-base capture keeps the held 2-degree base (2026-10-02; the F-22 follow-up; marineStaleHour.js rule 5).
 *
 * `_captureCoarseBase` is the ONE place a coarse-global grid becomes the held base: the commit path (setWaveData, BLEND BOTH) and the seed
 * consume (the world warm's landing) both call it. Until now every coarse-global grid committed replaced the base of its model|layer|flavor
 * slot, so a thin world frame (46 x 20, an 8-degree lattice) committed at a world view destroyed the exact frame held for the same data, and
 * the F-22 bridge, which only promotes a 2-degree base for the selected hour, stopped firing for the rest of the session (offline phone-width
 * replay: 35 and 52 hidden frames in two trials against 0 with the exact base).
 *
 * The engine cannot be mounted without a GL context, so this runs the REAL prototype method on a fake `this` with the texture encoder stubbed
 * (the way WebGLMarineEngine.bridgePromote.test.js runs the bridge); the decision it consults is pinned in marineStaleHour.baseHold.test.js
 * and the enumerated state machine in marineBaseHold.sequence.test.js. The CALL SITES are pinned in source (the recorded class of "green unit
 * tests, nothing wired"): both capture paths must still go through this method, and the method must still ask first.
 */
import fs from 'fs';
import path from 'path';
import WebGLMarineEngine, { coarseBaseKey, coarseBaseLruKey } from './WebGLMarineEngine';
import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { clipFor, viewport } from './marineBridgeGateOracle.testutil';

jest.mock('./WebGLMarineTextureEncoder', () => ({
  ...jest.requireActual('./WebGLMarineTextureEncoder'),
  encodeMarineTexture: jest.fn(),
}));

const capture = WebGLMarineEngine.prototype._captureCoarseBase;
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const T15 = '2026-10-07T15:00:00Z';
const T18 = '2026-10-07T18:00:00Z';
const ID = { __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 147 };
const exact = (vt, over = {}) => ({ ...ID, bounds: WORLD, cols: 181, rows: 82, valid_time: vt, ...over });
const thin = (vt, over = {}) => ({ ...ID, bounds: WORLD, cols: 46, rows: 20, __decimatedStride: 4, valid_time: vt, ...over });
const GL = { __fakeGl: true };

// The shapes the two capture paths REALLY carry. The commit path hands the engine useMarineWindData's explicit conform (no __decimatedStride, no
// served_valid_time, the valid time and the run taken from the wrapper: the series path spells the run in whole seconds); the seed path hands it the raw
// /grid grid (the ingest clock with microseconds). The two paths spell ONE run differently, and a fixture that gives both the same string hides that.
const conformedThin = (vt, over = {}) => ({
  bounds: WORLD, cols: 46, rows: 21, vectors: [{ lat: 0, lng: 0, speed: 1 }], __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false,
  valid_time: vt, validTime: vt, run_time: '2026-10-07T06:00:03Z', runTime: '2026-10-07T06:00:03Z', truthTag: { valid_time: vt }, hourOffset: 146, __fromSeries: true, ...over,
});
const rawExactSeed = (vt, over = {}) => ({
  bounds: WORLD, cols: 181, rows: 82, vectors: [{ lat: 0, lng: 0, speed: 1 }], __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false,
  valid_time: vt, run_time: '2026-10-07T06:00:03.456789Z', __decimatedStride: 0, hourOffset: 144, ...over,
});

/** The fake `this`: the fields the method reads, the real LRU-enabled switch, and a spy where the textures would be freed. */
function makeEngine() {
  return {
    _coarseBaseLru: new Map(), _coarseBaseData: null, _landGeoJSON: null,
    _coarseBaseLruEnabled: WebGLMarineEngine.prototype._coarseBaseLruEnabled,
    _freeCoarseBase: jest.fn(),
  };
}
const take = (eng, grid) => capture.call(eng, GL, grid, coarseBaseKey(grid));
const heldFor = (eng, grid) => eng._coarseBaseLru.get(coarseBaseLruKey(grid));

beforeEach(() => {
  encodeMarineTexture.mockReset();
  let n = 0;
  encodeMarineTexture.mockImplementation((gl, grid) => ({ u_waveTexture: { n: ++n }, u_oceanMaskTexture: { n: `mask${n}` }, __encodedCols: grid.cols }));
  window.__RAW_GPU__ = {};
});
afterEach(() => {
  delete window.__RAW_GPU__;
  delete window.__RAW_DISABLE_BASE_HOLD__;
  delete window.__RAW_DISABLE_COARSE_BASE_LRU__;
  delete window.__MARINE_BASE_HOLD__;
  delete window.__MARINE_ZOOMOUT_BRIDGE__;
});

describe('_captureCoarseBase (the real method): what becomes the held base', () => {
  it('captures a coarse-global grid when nothing is held: it is encoded, held in its slot and displayed', () => {
    const eng = makeEngine();
    const g = exact(T15);
    take(eng, g);
    expect(encodeMarineTexture).toHaveBeenCalledTimes(1);
    expect(heldFor(eng, g).waveGrid).toBe(g);
    expect(eng._coarseBaseData).toBe(heldFor(eng, g));
  });

  it('a thin frame of the SAME data does not replace the exact base: not encoded, the slot and the displayed base unchanged, nothing freed', () => {
    const eng = makeEngine();
    const held = exact(T15);
    take(eng, held);
    const slotBefore = heldFor(eng, held);
    take(eng, thin(T15, { hourOffset: 146 }));                     // the same valid time under another hour label, as at 3-hourly range
    expect(encodeMarineTexture).toHaveBeenCalledTimes(1);          // only the exact frame was ever encoded
    expect(heldFor(eng, held)).toBe(slotBefore);
    expect(eng._coarseBaseData).toBe(slotBefore);
    expect(eng._freeCoarseBase).not.toHaveBeenCalled();
    expect(window.__MARINE_BASE_HOLD__.kept).toBe(1);
  });

  it('a thin frame of ANOTHER 3-hourly step replaces it (the selected hour moved: the right hour wins), and the superseded set is freed', () => {
    const eng = makeEngine();
    const held = exact(T15);
    take(eng, held);
    const old = heldFor(eng, held);
    const later = thin(T18, { hourOffset: 150 });
    take(eng, later);
    expect(heldFor(eng, later).waveGrid).toBe(later);
    expect(eng._coarseBaseData).toBe(heldFor(eng, later));
    expect(eng._freeCoarseBase).toHaveBeenCalledWith(GL, old);
  });

  it('an exact frame replaces a thin base of the same data (a thin placeholder is not sticky), and frees it', () => {
    const eng = makeEngine();
    const placeholder = thin(T15);
    take(eng, placeholder);
    const old = heldFor(eng, placeholder);
    const real = exact(T15);
    take(eng, real);
    expect(heldFor(eng, real).waveGrid).toBe(real);
    expect(eng._freeCoarseBase).toHaveBeenCalledWith(GL, old);
  });

  it('another model\'s thin frame gets its own slot and never touches the exact GFS base (the identity is model | layer | flavor)', () => {
    const eng = makeEngine();
    const gfs = exact(T15);
    take(eng, gfs);
    const gfsSlot = heldFor(eng, gfs);
    const icon = thin(T15, { __sourceModel: 'ICON' });
    take(eng, icon);
    expect(heldFor(eng, gfs)).toBe(gfsSlot);
    expect(heldFor(eng, icon).waveGrid).toBe(icon);
    expect(eng._freeCoarseBase).not.toHaveBeenCalled();
  });

  it('with the kill switch on, the thin frame replaces the exact base again (the old behaviour, whole)', () => {
    window.__RAW_DISABLE_BASE_HOLD__ = true;
    const eng = makeEngine();
    const held = exact(T15);
    take(eng, held);
    const thinSame = thin(T15);
    take(eng, thinSame);
    expect(heldFor(eng, thinSame).waveGrid).toBe(thinSame);
    expect(encodeMarineTexture).toHaveBeenCalledTimes(2);
    expect(window.__MARINE_BASE_HOLD__).toBeUndefined();
  });

  it('with the LRU killed (the single-slot path) the displayed base is protected the same way, and still replaced by a frame of another step', () => {
    window.__RAW_DISABLE_COARSE_BASE_LRU__ = true;
    const eng = makeEngine();
    const held = exact(T15);
    take(eng, held);
    const displayed = eng._coarseBaseData;
    expect(displayed.waveGrid).toBe(held);
    take(eng, thin(T15));
    expect(eng._coarseBaseData).toBe(displayed);
    expect(encodeMarineTexture).toHaveBeenCalledTimes(1);
    const later = thin(T18);
    take(eng, later);
    expect(eng._coarseBaseData.waveGrid).toBe(later);
  });

  it('with the LRU killed AFTER it was filled, only the displayed base counts: the stale LRU map is ignored, as the rest of the engine ignores it', () => {
    const eng = makeEngine();
    const held = exact(T15);
    take(eng, held);                                                // the LRU holds an exact GFS wave base...
    eng._coarseBaseData = null;                                     // ...but nothing is displayed (the single-slot path starts empty after the kill)
    window.__RAW_DISABLE_COARSE_BASE_LRU__ = true;
    const thinSame = thin(T15);
    take(eng, thinSame);
    expect(eng._coarseBaseData.waveGrid).toBe(thinSame);            // nothing displayed to protect: the frame is captured
    expect(window.__MARINE_BASE_HOLD__).toBeUndefined();
  });

  it('a failed encode of an accepted frame still keeps the last-good base (the atomic-swap rule is untouched)', () => {
    const eng = makeEngine();
    const held = exact(T15);
    take(eng, held);
    const slot = heldFor(eng, held);
    encodeMarineTexture.mockImplementation(() => null);
    take(eng, exact(T18));
    expect(eng._coarseBaseData).toBe(slot);
    expect(heldFor(eng, held)).toBe(slot);
  });
});

describe('the shapes the two paths really carry', () => {
  it('a raw /grid exact frame (microsecond run) is kept against the conformed series thin frame (whole-second run) of the same ingest', () => {
    const eng = makeEngine();
    const held = rawExactSeed(T15);
    take(eng, held);
    const slot = heldFor(eng, held);
    take(eng, conformedThin(T15));
    expect(heldFor(eng, held)).toBe(slot);
    expect(window.__MARINE_BASE_HOLD__.kept).toBe(1);
    expect(encodeMarineTexture).toHaveBeenCalledTimes(1);
  });

  it('...and a conformed thin frame of the next ingest (another run) replaces it', () => {
    const eng = makeEngine();
    const held = rawExactSeed(T15);
    take(eng, held);
    const nextRun = conformedThin(T15, { run_time: '2026-10-07T12:00:03Z', runTime: '2026-10-07T12:00:03Z' });
    take(eng, nextRun);
    expect(heldFor(eng, held).waveGrid).toBe(nextRun);
  });
});

describe('capture and the F-22 bridge together (the claim the hold exists for)', () => {
  const bridge = WebGLMarineEngine.prototype.bridgeToCoarseGlobalIfHeld;
  const VB = viewport(20, 12);                                           // [-90, 22, -70, 34]: a 20 x 12 degree view, a band zoom
  function pair() {
    const eng = makeEngine();
    const calls = [];
    Object.assign(eng, {
      _pendingDowngrade: null,
      _waveData: { waveGrid: clipFor(VB, 0.3, { hourOffset: 147, valid_time: T15 }) },     // 30% of the view: the layer's gate hides it at z6.2
      _lastZoom: 6.2, _lastViewportBounds: VB.slice(), __selectedMs: Date.parse(T15),
      setWaveData(gl, grid, geojson) { calls.push({ grid, geojson }); },
    });
    return { eng, calls };
  }

  it('an exact frame then a thin frame of the same data are captured: the bridge promotes the EXACT frame over the hidden clip', () => {
    const { eng, calls } = pair();
    const exactG = exact(T15, { hourOffset: 147 });
    take(eng, exactG);
    take(eng, thin(T15, { hourOffset: 146 }));
    expect(bridge.call(eng, GL)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].grid).toBe(exactG);
  });

  it('with the hold killed the thin frame is the base and the bridge (which promotes only a 2-degree base in this band) does nothing: the clip stays hidden', () => {
    window.__RAW_DISABLE_BASE_HOLD__ = true;
    const { eng, calls } = pair();
    take(eng, exact(T15, { hourOffset: 147 }));
    take(eng, thin(T15, { hourOffset: 146 }));
    expect(bridge.call(eng, GL)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('the wiring: both capture paths still go through the guarded method', () => {
  const src = read('WebGLMarineEngine.js');
  it('the commit path (setWaveData) and the seed consume both capture through _captureCoarseBase, with the key they always used', () => {
    expect(src).toMatch(/this\._captureCoarseBase\(gl, waveGrid, key\);/);
    expect(src).toMatch(/this\._captureCoarseBase\(gl, _seed, coarseBaseKey\(_seed\)\);/);
  });
  it('the method asks the held-base rule before it encodes anything, and the rule comes in through the commit lane\'s import line', () => {
    expect(src).toMatch(/import \{[^}]*\bheldBaseKeeps\b[^}]*\} from '\.\/marineCommitGate';/);
    const at = src.indexOf('WebGLMarineEngine.prototype._captureCoarseBase = function(gl, waveGrid, key) {');
    expect(at).toBeGreaterThan(0);
    const asks = src.indexOf('heldBaseKeeps(', at);
    expect(asks).toBeGreaterThan(at);
    expect(asks - at).toBeLessThan(200);                                     // the first statement of the method
    expect(src.indexOf('const atomic', at)).toBeGreaterThan(asks);
    expect(src.indexOf('encodeMarineTexture(', at)).toBeGreaterThan(asks);
  });
});
