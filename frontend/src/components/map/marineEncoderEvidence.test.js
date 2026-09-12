import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { captureMarineEncoderEvidence, ENCODER_COLUMNS } from './marineEncoderEvidence';

function recordingGL() {
  let bound = null, next = 0;
  const uploads = [];
  const gl = { TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, LINEAR: 4, NEAREST: 5, CLAMP_TO_EDGE: 6,
    TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
    TEXTURE_BINDING_2D: 11, UNPACK_FLIP_Y_WEBGL: 12,
    getParameter: p => p === 11 ? bound : false, createTexture: () => ({ id: ++next }),
    deleteTexture() {}, bindTexture: (_, tex) => { bound = tex; }, texParameteri() {}, pixelStorei() {},
    texImage2D: (...a) => { if (a.length >= 9) uploads.push([a[3], a[4], a[8] ? Array.from(a[8]) : null]); },
    texSubImage2D() {} };
  return { gl, uploads };
}
const makeGrid = () => ({ cols: 2, rows: 2, bounds: { west: 0, south: 0, east: 1, north: 1 },
  __componentLayer: 'waves', __sourceModel: 'GFS', __fromSeries: true, hourOffset: 0, is_estimated: false,
  model_run_time: '2026-09-12T00:00:00Z', served_valid_time: '2026-09-12T03:00:00Z',
  vectors: Array.from({ length: 4 }, (_, i) => ({ lng: i % 2, lat: Math.floor(i / 2), u: 1, v: 0,
    height: 2, speed: 2, period: 9, waves: { is_valid: i !== 0, dir_confidence: .25 } })) });
function encode(g) { const { gl, uploads } = recordingGL(); encodeMarineTexture(gl, g, null, {}, undefined); return uploads; }
const col = (e, name) => e.values.map(r => r[ENCODER_COLUMNS.indexOf(name)]);
beforeEach(() => { delete window.__RAW_ENCODER_EVIDENCE__; delete window.__RAW_OPACITY_EVIDENCE__; delete window.__RAW_CAPTURE_OPACITY__; });
afterEach(() => { delete window.__RAW_CAPTURE_OPACITY__; });

it('records actual pre-extrapolation masks and confidence without changing any texture upload', () => {
  const grid = makeGrid(), before = JSON.stringify(grid);
  const off = encode(grid);
  expect(window.__RAW_ENCODER_EVIDENCE__).toBeUndefined();
  window.__RAW_CAPTURE_OPACITY__ = true;
  expect(encode(grid)).toEqual(off);
  expect(JSON.stringify(grid)).toBe(before);
  const e = window.__RAW_ENCODER_EVIDENCE__.encodes[0];
  expect(e).toMatchObject({ complete: true, route: 'series', standalone: false, vectorCount: 4, cells: 4 });
  expect(col(e, 'ocean')).toEqual([0, 1, 1, 1]);
  expect(col(e, 'confidence')).toEqual([1, .25, .25, .25]);
  expect(col(e, 'topOcean')).toEqual(['missing', 'missing', 'missing', 'missing']);
  expect(col(e, 'wavesValid')).toEqual([false, true, true, true]);
  expect(e.identity.model_run_time).toBe(grid.model_run_time);
  grid.vectors[0].waves.is_valid = true;
  expect(col(e, 'wavesValid')[0]).toBe(false);
});
it('an actual mask intervention changes the recorded effective field', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  const g = makeGrid(); encode(g);
  delete g.vectors[0].waves.is_valid; encode(g);
  const [a,b] = window.__RAW_ENCODER_EVIDENCE__.encodes;
  expect(col(a, 'ocean')).toEqual([0,1,1,1]);
  expect(col(b, 'ocean')).toEqual([1,1,1,1]);
  expect(a.grid.id).toBe(b.grid.id); // Separate encode snapshots see mutation of the same grid.
});
it('distinguishes explicit null from a missing mask at the actual encoder', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  const g = makeGrid(); g.vectors[1].isOcean = null; encode(g);
  const e = window.__RAW_ENCODER_EVIDENCE__.encodes[0];
  expect(col(e, 'topOcean')[1]).toBeNull(); expect(col(e, 'ocean')[1]).toBe(0);
  expect(col(e, 'topOcean')[2]).toBe('missing'); expect(col(e, 'ocean')[2]).toBe(1);
});
it('marks exhausted cell budget incomplete and counts dropped encodes', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  encode(makeGrid()); window.__RAW_ENCODER_EVIDENCE__.cells = 100000;
  encode(makeGrid());
  expect(window.__RAW_ENCODER_EVIDENCE__.encodes[1]).toMatchObject({ complete: false, values: null, reason: 'cell-budget-or-shape' });
  for (let i = 0; i < 65; i++) captureMarineEncoderEvidence(makeGrid(), false, []);
  expect(window.__RAW_ENCODER_EVIDENCE__).toMatchObject({ seen: 67, dropped: 3 });
  expect(window.__RAW_ENCODER_EVIDENCE__.encodes).toHaveLength(64);
});
it('contains an observer failure without changing the application error path', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  expect(() => captureMarineEncoderEvidence(null, false, [])).not.toThrow();
  expect(window.__RAW_ENCODER_EVIDENCE__.errors).toBe(1);
});
