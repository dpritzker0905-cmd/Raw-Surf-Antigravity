/**
 * marineFramePack PARITY: the packer's bytes must equal, byte for byte, the `u_waveTexture` bytes the REAL encoder uploads for the
 * same static frame, on both lanes a static frame takes to the engine today:
 *   lane A (seam A, the /grid JSON): buildVectors -> mapNormalizedGridToWebGL -> the useMarineWindData conform -> trimDeadEdges
 *     -> encodeMarineTexture;
 *   lane B (seam B, series frames): buildVectors -> the conform -> trimDeadEdges -> encodeMarineTexture.
 * The frames go through #422's own staticFrameCodec (parseFrame, buildVectors). One reference copy is pinned here (update it if
 * its source changes): conform(), the vector rebuild in useMarineWindData.js (the `vectors.map` at the top of the conformed grid,
 * dev 5be9e9dd0); it lives inside a hook and is not exported.
 * Frames: one REAL GFS world frame (marineFramePack.realFrame.fixture.js) and synthetic frames built to hit every branch (land,
 * all-invalid polar rows that trimDeadEdges cuts, calm cells, null period, null and low confidence, the other uv convention, a
 * regional frame). Settings: the three themes (height scale 16 m rounded vs 10 m floored), every kill switch the encoder reads,
 * and the Float16 arrays the encoder uses where the browser has them.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { buildVectors, parseFrame } from './staticFrameCodec'; // #422's own codec (on dev since 2a47fd5d8)

const KEYS = ['__WEBGL_MARINE_THEME__', '__RAW_DISABLE_DIR_DILATION__', '__RAW_DISABLE_DIR_CONFIDENCE__', '__RAW_CONF_FADE_STRENGTH__',
  '__RAW_DISABLE_DEAD_EDGE_TRIM__', '__RAW_DISABLE_WRAP_MIRROR__', 'Float16Array'];
let saved;
beforeEach(() => { saved = KEYS.map((k) => [k, window[k]]); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { saved.forEach(([k, v]) => { if (v === undefined) delete window[k]; else window[k] = v; }); jest.restoreAllMocks(); });

// ── reference: the useMarineWindData conform, waves layer with flat vectors (the only branch static frames reach) ──────────────
function conform(vectors, layer = 'waves') {
  return vectors.map((v) => {
    const hasFlat = v && typeof v.speed === 'number' && typeof v.u === 'number';
    const hasSubData = layer && v && v[layer];
    const layerData = hasSubData ? v[layer] : (hasFlat ? v : (v[layer] || v.waves));
    const dirConfidence = layerData && typeof layerData.dirConfidence === 'number' ? layerData.dirConfidence
      : (layerData && typeof layerData.dir_confidence === 'number' ? layerData.dir_confidence
        : (v && typeof v.dirConfidence === 'number' ? v.dirConfidence : (v && typeof v.dir_confidence === 'number' ? v.dir_confidence : null)));
    return {
      lat: v.lat, lng: v.lng, u: layerData?.u || 0, v: layerData?.v || 0, speed: layerData?.speed || 0, period: layerData?.period || 0,
      height: layerData?.height !== undefined ? layerData.height : (layerData?.speed || 0),
      direction: layerData?.direction !== undefined ? layerData.direction : undefined, isOcean: v.isOcean, dirConfidence,
      phys_speed: typeof v.phys_speed === 'number' ? v.phys_speed : (layerData && typeof layerData.phys_speed === 'number' ? layerData.phys_speed : undefined),
      [layer]: layerData,
    };
  });
}
function makeRecordingGL() {
  let handle = 0; let bound = null; let flipY = false; const uploads = new Map();
  const gl = {
    TEXTURE_2D: 'TEXTURE_2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE', LINEAR: 'LINEAR', NEAREST: 'NEAREST', CLAMP_TO_EDGE: 'CLAMP_TO_EDGE',
    TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TEXTURE_BINDING_2D', UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
    getParameter: (p) => (p === 'TEXTURE_BINDING_2D' ? bound : p === 'UNPACK_FLIP_Y_WEBGL' ? flipY : null),
    createTexture: () => ({ __tex: ++handle }), deleteTexture: () => {}, bindTexture: (_t, tex) => { bound = tex; },
    texParameteri: () => {}, pixelStorei: (p, val) => { if (p === 'UNPACK_FLIP_Y_WEBGL') flipY = val; },
    texImage2D: (...a) => { if (a.length >= 9 && bound) uploads.set(bound, { width: a[3], height: a[4], data: a[8] ? Uint8Array.from(a[8]) : null }); },
    texSubImage2D: () => {},
  };
  return { gl, uploads };
}

// Fresh module instances, so FloatArrayConstructor is evaluated under the window under test (Float16 or not).
function load() {
  let m;
  jest.isolateModules(() => {
    m = {
      pack: require('./marineFramePack'),
      enc: require('./WebGLMarineTextureEncoder'),
      dec: require('./marineEngineDecisions'),
      map: require('./backendWeatherServiceClientHelpers'),
      math: require('./WebGLMarineFieldMath'),
    };
  });
  return m;
}
function encoderBytes(m, grid) {
  const g = m.dec.trimDeadEdges(grid) || grid;
  const { gl, uploads } = makeRecordingGL();
  const out = m.enc.encodeMarineTexture(gl, g, null, {}, undefined);
  const wave = uploads.get(out.u_waveTexture);
  const chl = uploads.get(out.u_chlorophyllTexture); const bath = uploads.get(out.u_bathymetryTexture);
  return { bytes: wave.data, cols: wave.width, rows: wave.height, chl: chl && chl.data, bath: bath && bath.data };
}
function laneA(m, parsed) {
  const json = { grid: { vectors: buildVectors(parsed), bounds: parsed.bounds, cols: parsed.cols, rows: parsed.rows }, provider: 'static', product_id: 'p' };
  const mapped = m.map.mapNormalizedGridToWebGL(json, parsed.bounds, 0, 'waves', 'GFS');
  return encoderBytes(m, { ...mapped.grid, vectors: conform(mapped.grid.vectors) });
}
function laneB(m, parsed) {
  return encoderBytes(m, { vectors: conform(buildVectors(parsed)), bounds: parsed.bounds, cols: parsed.cols, rows: parsed.rows,
    __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 3, productId: 'p' });
}
function firstDiff(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; }

// ── frames ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const REAL = () => parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function synthetic({ cols = 181, rows = 83, bounds = { west: -180, south: -80, east: 180, north: 84 }, seed = 7, uvConvention = 0, deadRows = [0, 1, 2, rows - 2, rows - 1] } = {}) {
  const r = rng(seed); const n = cols * rows;
  const H = new Float64Array(n); const D = new Float64Array(n); const P = new Float64Array(n); const C = new Float64Array(n);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const land = deadRows.includes(y) || (((x - 40) ** 2) / 300 + ((y - 50) ** 2) / 90 < 1) || (((x - 120) ** 2) / 500 + ((y - 30) ** 2) / 60 < 1);
      D[i] = Math.round(r() * 36000) / 100; C[i] = r() < 0.3 ? NaN : Math.round(r() * 254) / 254;
      if (land) { H[i] = NaN; P[i] = r() < 0.5 ? NaN : Math.round(r() * 2000) / 100; continue; }
      const calm = r() < 0.04;
      H[i] = calm ? 0 : Math.round((0.2 + r() * 14 + (r() < 0.02 ? 6 : 0)) * 1000) / 1000;
      P[i] = r() < 0.05 ? NaN : Math.round((4 + r() * 18) * 100) / 100;
    }
  }
  return { cols, rows, bounds, uvConvention, fields: { 0: H, 1: D, 2: P, 3: C } };
}

const FRAMES = [
  ['the real GFS world frame', REAL],
  ['a synthetic world frame with dead polar rows', () => synthetic()],
  ['the other uv convention', () => synthetic({ seed: 11, uvConvention: 1 })],
  ['a regional frame (no wrap)', () => synthetic({ cols: 33, rows: 33, bounds: { west: -88, south: 20, east: -72, north: 36 }, seed: 5, deadRows: [32] })],
];
const SETTINGS = [
  ['dark (10 m, floored)', { __WEBGL_MARINE_THEME__: 'dark' }],
  ['light (16 m, rounded)', { __WEBGL_MARINE_THEME__: 'light' }],
  ['beach (v1, 10 m)', { __WEBGL_MARINE_THEME__: 'beach' }],
  ['dilation off', { __WEBGL_MARINE_THEME__: 'light', __RAW_DISABLE_DIR_DILATION__: true }],
  ['confidence off', { __WEBGL_MARINE_THEME__: 'dark', __RAW_DISABLE_DIR_CONFIDENCE__: true }],
  ['confidence strength 0.4', { __WEBGL_MARINE_THEME__: 'dark', __RAW_CONF_FADE_STRENGTH__: 0.4 }],
  ['dead-edge trim off', { __WEBGL_MARINE_THEME__: 'light', __RAW_DISABLE_DEAD_EDGE_TRIM__: true }],
];

describe('marineFramePack: byte-identical to the encoder on both static lanes', () => {
  FRAMES.forEach(([fname, make]) => {
    SETTINGS.forEach(([sname, env]) => {
      it(`${fname}, ${sname}`, () => {
        Object.assign(window, env);
        const m = load();
        const parsed = make();
        const packed = m.pack.packStaticFrame(parsed);
        expect(packed).not.toBeNull();
        for (const [lane, ref] of [['A', laneA(m, parsed)], ['B', laneB(m, parsed)]]) {
          expect({ lane, cols: packed.cols, rows: packed.rows }).toEqual({ lane, cols: ref.cols, rows: ref.rows });
          expect({ lane, firstDiff: firstDiff(packed.bytes, ref.bytes) }).toEqual({ lane, firstDiff: -1 });
        }
      });
    });
  });

  it('with Float16 scratch arrays (the encoder uses window.Float16Array where the browser has it)', () => {
    if (typeof Float16Array === 'undefined') return;
    window.Float16Array = Float16Array;
    window.__WEBGL_MARINE_THEME__ = 'light';
    const m = load();
    expect(m.math.FloatArrayConstructor).not.toBe(Float32Array);
    const parsed = REAL();
    const packed = m.pack.packStaticFrame(parsed);
    expect(packed.signature).toMatch(/\|f16$/);
    expect(firstDiff(packed.bytes, laneA(m, parsed).bytes)).toBe(-1);
    expect(firstDiff(packed.bytes, laneB(m, parsed).bytes)).toBe(-1);
  });

  it('the real frame is trimmed exactly as trimDeadEdges trims it, and the trim is not a no-op', () => {
    window.__WEBGL_MARINE_THEME__ = 'dark';
    const m = load();
    const parsed = REAL();
    const packed = m.pack.packStaticFrame(parsed);
    const ref = laneA(m, parsed);
    expect([packed.cols, packed.rows]).toEqual([ref.cols, ref.rows]);
    expect(packed.isGlobal).toBe(true);
    // A non-trivial check: the field has many distinct texels (a constant output would also be "equal" to a broken reference).
    expect(new Set(Array.from(packed.bytes.filter((_, i) => i % 4 === 2))).size).toBeGreaterThan(40);
  });
});

describe('marineFramePack: scope and signature', () => {
  it('declines non-waves layers, rating grids and frames without a height plane', () => {
    const m = load();
    const parsed = synthetic({ seed: 3 });
    expect(m.pack.packStaticFrame(parsed, { layer: 'swell_1' })).toBeNull();
    expect(m.pack.packStaticFrame(parsed, { ratingMode: true })).toBeNull();
    expect(m.pack.packStaticFrame({ ...parsed, fields: {} })).toBeNull();
  });

  it('declines the full-wrap mirror case (a dead +180 column beside a live -180 one) so the caller takes the normal path', () => {
    const m = load();
    const parsed = synthetic({ seed: 9, deadRows: [] });
    for (let y = 0; y < parsed.rows; y++) parsed.fields[0][y * parsed.cols + parsed.cols - 1] = NaN;
    expect(m.pack.packStaticFrame(parsed)).toBeNull();
  });

  it('the signature changes with every setting that changes the bytes', () => {
    const m = load();
    const sigs = new Set(SETTINGS.map(([, env]) => { KEYS.forEach((k) => { if (k !== 'Float16Array') delete window[k]; }); Object.assign(window, env); return m.pack.packSignature(); }));
    expect(sigs.size).toBe(SETTINGS.length - 1); // dark and beach share the 10 m scale and every other setting
  });

  it('validityBits round-trips the mask and validityDiff counts the cells that differ', () => {
    const m = load();
    const a = Uint8Array.from({ length: 1003 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const b = Uint8Array.from(a); b[0] = 0; b[500] = 1 - b[500]; b[1002] = 1 - b[1002];
    const ba = m.pack.validityBits(a);
    expect(ba.length).toBe(126);
    for (let i = 0; i < a.length; i++) expect((ba[i >> 3] >> (i & 7)) & 1).toBe(a[i]);
    expect(m.pack.validityDiff(ba, m.pack.validityBits(a))).toBe(0);
    expect(m.pack.validityDiff(ba, m.pack.validityBits(b))).toBe(3);
    expect(m.pack.validityDiff(ba, null)).toBe(Infinity);
    expect(m.pack.validityDiff(ba, new Uint8Array(3))).toBe(Infinity);
  });

  it('validityHash tells validity patterns apart and is stable', () => {
    const m = load();
    const a = Uint8Array.from([1, 0, 1, 1]); const b = Uint8Array.from([1, 1, 0, 1]);
    expect(m.pack.validityHash(a)).toBe(m.pack.validityHash(Uint8Array.from(a)));
    expect(m.pack.validityHash(a)).not.toBe(m.pack.validityHash(b));
  });
});

// STAGE A (2026-10-22): a frame's OWN chl/bath, rebuilt from the pack's two masks by marineFrameAux in a fresh module instance (its
// own getMarineGeoData cache, so equality is the derivation's, not a cache hit), equal the encoder's chl/bath uploads on both lanes.
describe("marineFrameAux: a stored frame carries the encoder's exact chl/bath bytes", () => {
  const auxModule = () => { let a; jest.isolateModules(() => { a = require('./marineFrameAux'); }); return a; };
  it.each(['dark', 'light'])('the real frame, %s theme: chl and bath equal lane A and lane B', (theme) => {
    window.__WEBGL_MARINE_THEME__ = theme;
    const m = load();
    const parsed = REAL();
    const pack = m.pack.packStaticFrame(parsed);
    const aux = auxModule().auxForPack(pack);
    expect(aux).not.toBeNull();
    for (const lane of [laneA(m, parsed), laneB(m, parsed)]) {
      expect([lane.cols, lane.rows]).toEqual([aux.cols, aux.rows]);
      expect(firstDiff(Uint8Array.from(aux.chl), lane.chl)).toBe(-1);
      expect(firstDiff(Uint8Array.from(aux.bath), lane.bath)).toBe(-1);
    }
  });
  it('a pack without its masks has no aux (the caller falls back to the tolerance rule)', () => {
    const a = auxModule();
    expect(a.auxForPack(null)).toBeNull();
    expect(a.auxForPack({ cols: 2, rows: 2, validityBits: new Uint8Array(1) })).toBeNull();
  });
});
