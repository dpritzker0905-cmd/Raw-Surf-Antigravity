import {
  FRAME_ENCODING, compareFrameToGrid, frameProofEnabled, heightAtNode, installFrameProof, publicObjectUrl, runFrameProof,
} from './frameImageProof';

// A 3 x 2 image over lng 0..20, lat 0..10 (row 0 = north = lat 10), heights in metres, one missing node.
const FRAME = { width: 3, height: 2, bounds: { west: 0, east: 20, south: 0, north: 10 }, encoding: FRAME_ENCODING,
  model: 'GFS', layer: 'waves', valid_time: '2026-10-19T12:00:00Z', path: 'gfs/waves/global_mid/r/v.png', bytes: 99 };
const HEIGHTS = [[1.234, 2.5, null], [0.001, 0, 7.777]]; // [northRow, southRow]
function encode(heights) {
  const rgba = new Uint8ClampedArray(3 * 2 * 4);
  heights.forEach((row, r) => row.forEach((h, c) => {
    const code = h === null ? 0 : Math.round(h / 0.001) + 1;
    const i = (r * 3 + c) * 4;
    rgba[i] = code >> 8; rgba[i + 1] = code & 0xff; rgba[i + 3] = 255;
  }));
  return rgba;
}
const vectorsFrom = (heights) => heights.flatMap((row, r) => row.map((h, c) => (
  { lat: r === 0 ? 10 : 0, lng: c * 10, speed: h === null ? 0 : h, is_valid: h !== null })));

describe('frameImageProof', () => {
  afterEach(() => { delete window.__RAW_FRAME_PROOF__; delete window.__RAW_RUN_FRAME_PROOF__; localStorage.clear(); });

  test('is off unless explicitly enabled', () => {
    expect(frameProofEnabled()).toBe(false);
    expect(installFrameProof({ gridUrl: 'x' })).toBe(false);
    expect(window.__RAW_RUN_FRAME_PROOF__).toBeUndefined();
    localStorage.setItem('__RAW_FRAME_PROOF__', 'true');
    expect(frameProofEnabled()).toBe(true);
  });

  test('reads nodes north-up and keeps missing distinct from zero', () => {
    const rgba = encode(HEIGHTS);
    expect(heightAtNode(rgba, FRAME, 10, 0)).toBeCloseTo(1.234, 6);
    expect(heightAtNode(rgba, FRAME, 0, 20)).toBeCloseTo(7.777, 6);
    expect(heightAtNode(rgba, FRAME, 10, 20)).toBeNull();
    expect(heightAtNode(rgba, FRAME, 0, 10)).toBe(0);
    expect(heightAtNode(rgba, FRAME, 5, 10)).toBeUndefined(); // between rows: not a node
  });

  test('a faithful image has parity 0, and one changed node is caught (mutation control)', () => {
    const rgba = encode(HEIGHTS);
    expect(compareFrameToGrid(FRAME, rgba, vectorsFrom(HEIGHTS))).toMatchObject({ compared: 6, bad: 0, offNode: 0 });
    const served = vectorsFrom(HEIGHTS);
    served[1].speed += 0.002;
    const res = compareFrameToGrid(FRAME, rgba, served);
    expect(res.bad).toBe(1);
    expect(res.samples[0]).toMatchObject({ lat: 10, lng: 10 });
    const missing = vectorsFrom(HEIGHTS);
    missing[2] = { ...missing[2], speed: 1, is_valid: true };
    expect(compareFrameToGrid(FRAME, rgba, missing)).toMatchObject({ bad: 1, missingMismatch: 1 });
  });

  test('runs end to end on injected fetch/decode, timing both paths and naming every host', async () => {
    const rgba = encode(HEIGHTS);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes('/manifest.json')) return { ok: true, json: async () => ({ frames: [FRAME] }) };
      if (url.endsWith('.png')) return { ok: true, blob: async () => 'blob' };
      return { ok: true, json: async () => ({ valid_time: FRAME.valid_time, product_id: 'p', grid: { vectors: vectorsFrom(HEIGHTS) } }) };
    };
    let t = 0;
    const res = await runFrameProof({ supabaseUrl: 'https://cdn.example.co/', gridUrl: 'https://box.example.com/api/weather/grid',
      fetchImpl, decode: async () => ({ rgba, width: 3, height: 2 }), clock: () => (t += 10) });
    expect(res.ok).toBe(true);
    expect(res.hosts).toEqual({ image: ['cdn.example.co'], grid: ['box.example.com'] });
    expect(calls[1]).toBe(publicObjectUrl('https://cdn.example.co/', FRAME.path));
    expect(calls[2]).toContain('valid_time=2026-10-19T12%3A00%3A00Z');
    expect(Object.keys(res.timingsMs)).toEqual(['manifest', 'image', 'decode', 'imagePathTotal', 'grid']);
  });

  test('decode reads the bitmap size before close() zeroes it (the bug the real browser run caught)', async () => {
    const saved = { cib: global.createImageBitmap, oc: global.OffscreenCanvas };
    global.createImageBitmap = async () => {
      const bm = { width: 3, height: 2, close() { this.width = 0; this.height = 0; } };
      return bm;
    };
    global.OffscreenCanvas = function OffscreenCanvas(w, h) {
      this.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }) });
    };
    try {
      const { decodePngRgba } = await import('./frameImageProof');
      const out = await decodePngRgba('blob');
      expect([out.width, out.height, out.rgba.length]).toEqual([3, 2, 24]);
    } finally {
      global.createImageBitmap = saved.cib;
      global.OffscreenCanvas = saved.oc;
    }
  });

  test('a different served valid time is not ok even when the nodes agree', async () => {
    const rgba = encode(HEIGHTS);
    const fetchImpl = async (url) => (url.includes('/manifest.json')
      ? { ok: true, json: async () => ({ frames: [FRAME] }) }
      : url.endsWith('.png') ? { ok: true, blob: async () => 'b' }
        : { ok: true, json: async () => ({ valid_time: '2026-10-19T15:00:00Z', grid: { vectors: vectorsFrom(HEIGHTS) } }) });
    const res = await runFrameProof({ supabaseUrl: 'https://c.example', gridUrl: 'https://b.example/g', fetchImpl,
      decode: async () => ({ rgba, width: 3, height: 2 }) });
    expect(res.parity.bad).toBe(0);
    expect(res.ok).toBe(false);
  });
});
