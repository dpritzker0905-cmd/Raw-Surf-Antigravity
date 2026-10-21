import { createFrameArrays, isWebGL2, supportsFrameArrays, uploadBytesTo2D } from './marineFrameStoreGpu';

// A recording WebGL2 stand-in: tracks bindings and pixel-store state the way a context does, and logs every call.
function fakeGL({ maxLayers = 2048, webgl2 = true } = {}) {
  let id = 0;
  const st = { arr: null, tex: null, read: null, flip: false, pre: false };
  const calls = [];
  const C = {
    TEXTURE_2D: 'T2D', TEXTURE_2D_ARRAY: 'T2DA', READ_FRAMEBUFFER: 'RFB', COLOR_ATTACHMENT0: 'CA0', RGBA: 'RGBA', RGBA8: 'RGBA8',
    UNSIGNED_BYTE: 'UB', NEAREST: 'N', CLAMP_TO_EDGE: 'C', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG', TEXTURE_WRAP_S: 'WS',
    TEXTURE_WRAP_T: 'WT', MAX_ARRAY_TEXTURE_LAYERS: 'MAXL', TEXTURE_BINDING_2D_ARRAY: 'B2DA', TEXTURE_BINDING_2D: 'B2D',
    READ_FRAMEBUFFER_BINDING: 'BRFB', UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
  };
  const gl = {
    ...C,
    getParameter: (p) => ({ MAXL: maxLayers, B2DA: st.arr, B2D: st.tex, BRFB: st.read, FLIP: st.flip, PRE: st.pre })[p],
    createTexture: () => ({ tex: ++id }), deleteTexture: (t) => calls.push(['deleteTexture', t]),
    createFramebuffer: () => ({ fb: ++id }), deleteFramebuffer: () => {},
    bindTexture: (target, t) => { if (target === 'T2DA') st.arr = t; else st.tex = t; },
    bindFramebuffer: (target, f) => { if (target === 'RFB') st.read = f; },
    pixelStorei: (p, v) => { if (p === 'FLIP') st.flip = v; if (p === 'PRE') st.pre = v; },
    texParameteri: () => {},
    texStorage3D: (...a) => calls.push(['texStorage3D', st.arr, ...a.slice(2)]),
    texSubImage3D: (...a) => calls.push(['texSubImage3D', st.arr, a[4], st.flip, st.pre]),
    framebufferTextureLayer: (_t, _a, tex, _l, layer) => calls.push(['framebufferTextureLayer', st.read, tex, layer]),
    copyTexSubImage2D: (...a) => calls.push(['copyTexSubImage2D', st.tex, st.read, a[6], a[7]]),
    texSubImage2D: (...a) => calls.push(['texSubImage2D', st.tex, st.flip, st.pre, a[4], a[5]]),
  };
  if (!webgl2) { delete gl.texStorage3D; }
  return { gl, st, calls };
}
const COLS = 181; const ROWS = 83;
const frame = (fill = 7) => new Uint8Array(COLS * ROWS * 4).fill(fill);

describe('support', () => {
  it('needs WebGL2 and enough array layers', () => {
    expect(isWebGL2(fakeGL().gl)).toBe(true);
    expect(isWebGL2(fakeGL({ webgl2: false }).gl)).toBe(false);
    expect(supportsFrameArrays(fakeGL().gl, 115)).toBe(true);
    expect(supportsFrameArrays(fakeGL({ maxLayers: 100 }).gl, 115)).toBe(false);
    expect(createFrameArrays(fakeGL({ maxLayers: 100 }).gl, { cols: COLS, rows: ROWS, depth: 115 })).toBeNull();
  });
});

describe('the pool', () => {
  it('allocates texStorage3D RGBA8 of the frame size, keeps a spare, reuses instead of re-allocating', () => {
    const { gl, calls } = fakeGL();
    const p = createFrameArrays(gl, { cols: COLS, rows: ROWS, depth: 115, maxArrays: 3 });
    p.ensureSpare();
    expect(calls.filter((c) => c[0] === 'texStorage3D')).toEqual([['texStorage3D', { tex: 1 }, 'RGBA8', COLS, ROWS, 115]]);
    const a = p.acquire('A');
    expect(a.tex).toEqual({ tex: 1 });                                   // the spare, not a new allocation
    expect(p.telemetry()).toMatchObject({ allocs: 1, reuses: 1, arrays: 1, spare: 0 });
    p.release('A');
    expect(p.acquire('B').tex).toEqual({ tex: 1 });                      // a released array is reused
    expect(p.allocatedBytes()).toBe(115 * COLS * ROWS * 4);
  });

  it('when full, the least recently used set loses its array and acquire() names it', () => {
    let t = 0; const { gl } = fakeGL();
    const p = createFrameArrays(gl, { cols: COLS, rows: ROWS, depth: 10, maxArrays: 2, now: () => (t += 1) });
    p.acquire('A'); p.acquire('B');
    p.acquire('A');                                                      // A is now the most recent
    const c = p.acquire('C');
    expect(c.evicted).toBe('B');
    expect(p.has('B')).toBe(false);
    expect(p.telemetry()).toMatchObject({ allocs: 2, evictions: 1, sets: 2 });
  });
});

describe('upload and copy: state hygiene', () => {
  it('uploadMany forces FLIP_Y / PREMULTIPLY false for texSubImage3D and restores the caller\'s state exactly', () => {
    const { gl, st, calls } = fakeGL();
    const p = createFrameArrays(gl, { cols: COLS, rows: ROWS, depth: 20 });
    p.acquire('A');
    const before = { arr: { user: 1 }, tex: { user: 2 }, read: { user: 3 }, flip: true, pre: true };
    Object.assign(st, before);
    expect(p.uploadMany('A', [{ layer: 0, bytes: frame() }, { layer: 19, bytes: frame() }, { layer: 20, bytes: frame() }, { layer: 1, bytes: new Uint8Array(4) }])).toBe(2);
    const ups = calls.filter((c) => c[0] === 'texSubImage3D');
    expect(ups.map((c) => [c[2], c[3], c[4]])).toEqual([[0, false, false], [19, false, false]]);
    expect(st).toEqual(before);
    expect(p.telemetry().errors).toBe(2);                                // out-of-range layer, wrong byte length
  });

  it('copyToTexture copies the asked layer into the target 2D texture and restores every binding', () => {
    const { gl, st, calls } = fakeGL();
    const p = createFrameArrays(gl, { cols: COLS, rows: ROWS, depth: 20 });
    const { tex } = p.acquire('A');
    const target = { engineWaveTex: true };
    const before = { arr: null, tex: { maplibre: 9 }, read: { maplibreFbo: 4 }, flip: false, pre: false };
    Object.assign(st, before);
    expect(p.copyToTexture('A', 12, target)).toBe(true);
    const ftl = calls.find((c) => c[0] === 'framebufferTextureLayer');
    expect(ftl[2]).toBe(tex); expect(ftl[3]).toBe(12);
    const cp = calls.find((c) => c[0] === 'copyTexSubImage2D');
    expect(cp[1]).toBe(target); expect(cp[3]).toBe(COLS); expect(cp[4]).toBe(ROWS);
    expect(st).toEqual(before);
  });

  it('refuses unknown sets and out-of-range layers (the caller falls back to the normal commit)', () => {
    const { gl } = fakeGL();
    const p = createFrameArrays(gl, { cols: COLS, rows: ROWS, depth: 20 });
    expect(p.copyToTexture('nope', 0, {})).toBe(false);
    p.acquire('A');
    expect(p.copyToTexture('A', 20, {})).toBe(false);
    expect(p.copyToTexture('A', 0, null)).toBe(false);
    expect(p.uploadMany('nope', [{ layer: 0, bytes: frame() }])).toBe(0);
  });
});

describe('WebGL1 fallback', () => {
  it('uploadBytesTo2D writes the bytes with FLIP_Y false and restores the caller\'s texture and pixel store', () => {
    const { gl, st, calls } = fakeGL({ webgl2: false });
    Object.assign(st, { tex: { prev: 1 }, flip: true, pre: false });
    expect(uploadBytesTo2D(gl, { wave: 1 }, frame(), COLS, ROWS)).toBe(true);
    expect(calls.find((c) => c[0] === 'texSubImage2D')).toEqual(['texSubImage2D', { wave: 1 }, false, false, COLS, ROWS]);
    expect(st).toMatchObject({ tex: { prev: 1 }, flip: true, pre: false });
    expect(uploadBytesTo2D(gl, { wave: 1 }, new Uint8Array(8), COLS, ROWS)).toBe(false);
  });
});
