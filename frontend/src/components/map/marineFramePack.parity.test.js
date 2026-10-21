/**
 * marineFramePack PARITY: the packer's bytes must equal, byte for byte, the `u_waveTexture` bytes the REAL encoder uploads for the
 * same static frame, on both lanes a static frame takes to the engine today:
 *   lane A (seam A, the /grid JSON): buildVectors -> mapNormalizedGridToWebGL -> the useMarineWindData conform -> trimDeadEdges
 *     -> encodeMarineTexture;
 *   lane B (seam B, series frames): buildVectors -> the conform -> trimDeadEdges -> encodeMarineTexture.
 * Reference copies (pinned here, update them if their sources change):
 *   - buildVectors / the RSWF reader: staticFrameCodec.js, PR #422 head 75d5318ea (not on dev yet);
 *   - conform(): the vector rebuild in useMarineWindData.js (the `vectors.map` at the top of the conformed grid, dev 5be9e9dd0).
 * Frames: one REAL GFS world frame (marineFramePack.realFrame.fixture.js) and synthetic frames built to hit every branch (land,
 * all-invalid polar rows that trimDeadEdges cuts, calm cells, null period, null and low confidence, the other uv convention, a
 * regional frame). Settings: the three themes (height scale 16 m rounded vs 10 m floored), every kill switch the encoder reads,
 * and the Float16 arrays the encoder uses where the browser has them.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';

const KEYS = ['__WEBGL_MARINE_THEME__', '__RAW_DISABLE_DIR_DILATION__', '__RAW_DISABLE_DIR_CONFIDENCE__', '__RAW_CONF_FADE_STRENGTH__',
  '__RAW_DISABLE_DEAD_EDGE_TRIM__', '__RAW_DISABLE_WRAP_MIRROR__', 'Float16Array'];
let saved;
beforeEach(() => { saved = KEYS.map((k) => [k, window[k]]); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { saved.forEach(([k, v]) => { if (v === undefined) delete window[k]; else window[k] = v; }); jest.restoreAllMocks(); });

// ── reference: the RSWF v1 reader and buildVectors of staticFrameCodec.js (#422) ─────────────────────────────────────────────
function parseFrame(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cols = dv.getUint16(8, true); const rows = dv.getUint16(10, true); const fieldCount = dv.getUint8(18);
  const uvConvention = dv.getUint8(19); let pos = dv.getUint32(20, true);
  const bounds = { west: dv.getFloat64(24, true), south: dv.getFloat64(32, true), east: dv.getFloat64(40, true), north: dv.getFloat64(48, true) };
  const n = cols * rows; const fields = {};
  for (let f = 0; f < fieldCount; f++) {
    const d = 72 + f * 24; const id = dv.getUint8(d); const dtype = dv.getUint8(d + 1); const layout = dv.getUint8(d + 2);
    const missing = dv.getUint32(d + 4, true); const scale = dv.getFloat64(d + 8, true); const offset = dv.getFloat64(d + 16, true);
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let code;
      if (dtype === 1) code = bytes[pos + k]; else if (layout === 1) code = bytes[pos + k] | (bytes[pos + n + k] << 8); else code = bytes[pos + 2 * k] | (bytes[pos + 2 * k + 1] << 8);
      out[k] = (missing !== 0xFFFFFFFF && code === missing) ? NaN : code * scale + offset;
    }
    fields[id] = out; pos += n * dtype;
  }
  return { cols, rows, bounds, uvConvention, fields };
}
const r2 = (x) => Math.round(x * 100) / 100; const r4 = (x) => Math.round(x * 1e4) / 1e4; const r6 = (x) => Math.round(x * 1e6) / 1e6;
function buildVectors(parsed) {
  const { cols, rows, bounds, fields } = parsed; const H = fields[0]; const D = fields[1]; const P = fields[2]; const C = fields[3];
  const sign = parsed.uvConvention === 1 ? 1 : -1;
  const dLat = rows > 1 ? (bounds.north - bounds.south) / (rows - 1) : 0; const dLng = cols > 1 ? (bounds.east - bounds.west) / (cols - 1) : 0;
  const out = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = r6(bounds.south + r * dLat);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const lng = r6(bounds.west + c * dLng); const h = H[i]; const valid = !Number.isNaN(h);
      const dir = D ? (Number.isNaN(D[i]) ? 0 : r2(D[i])) : 0; const per = P ? (Number.isNaN(P[i]) ? null : r2(P[i])) : null;
      const conf = C ? (Number.isNaN(C[i]) ? null : r4(C[i])) : null;
      if (!valid) { out[i] = { lat, lng, speed: 0, direction: dir, u: 0, v: 0, period: per, gust: null, value: null, is_valid: false, dir_confidence: conf }; continue; }
      const speed = r4(h); const rad = dir * (Math.PI / 180);
      out[i] = { lat, lng, speed, direction: dir, u: r4(sign * speed * Math.sin(rad)) + 0, v: r4(sign * speed * Math.cos(rad)) + 0,
        period: per, gust: null, value: null, is_valid: true, dir_confidence: conf };
    }
  }
  return out;
}
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
  return { bytes: wave.data, cols: wave.width, rows: wave.height };
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

  it('validityHash tells validity patterns apart and is stable', () => {
    const m = load();
    const a = Uint8Array.from([1, 0, 1, 1]); const b = Uint8Array.from([1, 1, 0, 1]);
    expect(m.pack.validityHash(a)).toBe(m.pack.validityHash(Uint8Array.from(a)));
    expect(m.pack.validityHash(a)).not.toBe(m.pack.validityHash(b));
  });
});
