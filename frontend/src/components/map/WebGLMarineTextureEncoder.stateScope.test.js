import { createTexture, updateTexture, withTextureState, encodeMarineTexture } from './WebGLMarineTextureEncoder';

/**
 * `gl.getParameter` SAVE/RESTORE BATCHING.
 *
 * Measured 2026-08-11 on deploy `23743f63` (GATE6_cpu_profile_RUN.txt): `gl.getParameter` cost
 * 1465.9 ms of self time — 4.6% of a 30 s profile — second only to `getImageData`. Cause: every
 * texture create AND every texture update opened with
 *     prevTex   = gl.getParameter(TEXTURE_BINDING_2D)
 *     prevFlipY = gl.getParameter(UNPACK_FLIP_Y_WEBGL)
 * and closed by restoring them. In Chrome's command-buffer architecture a getParameter is a
 * synchronous round trip to the GPU process, and `encodeMarineTexture` creates up to five textures
 * per commit — ten round trips where one pair would do.
 *
 * ⛔ THE NAIVE FIX IS WRONG. Shadowing the binding in JS would only know about OUR bindTexture
 * calls; MapLibre shares this context and binds textures too, so a shadow would restore a stale
 * binding. The state read here must stay a real driver read.
 * ★ So the fix is not to stop reading — it is to read ONCE PER BATCH. Between our own texture ops
 *   only our own code runs, so no external observer can see the intermediate states; capturing at
 *   scope entry and restoring at scope exit is observationally identical to doing it per call.
 *
 * These tests pin the count AND the restore, because a batching change that lost the restore would
 * look like a pure win right up until MapLibre drew with our texture bound.
 */

function makeGL() {
  let handle = 0;
  let bound = null;
  let flipY = false;
  const calls = { getParameter: 0, bindTexture: 0, pixelStorei: 0, texImage2D: 0, texSubImage2D: 0 };
  const uploadsFlipY = [];
  const gl = {
    TEXTURE_2D: 'TEXTURE_2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE',
    LINEAR: 'LINEAR', CLAMP_TO_EDGE: 'CLAMP_TO_EDGE',
    TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TEXTURE_BINDING_2D', UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
    getParameter: (p) => {
      calls.getParameter++;
      return p === 'TEXTURE_BINDING_2D' ? bound : p === 'UNPACK_FLIP_Y_WEBGL' ? flipY : null;
    },
    createTexture: () => ({ __tex: ++handle }),
    deleteTexture: () => {},
    bindTexture: (_t, tex) => { calls.bindTexture++; bound = tex; },
    texParameteri: () => {},
    pixelStorei: (p, v) => { calls.pixelStorei++; if (p === 'UNPACK_FLIP_Y_WEBGL') flipY = v; },
    texImage2D: () => { calls.texImage2D++; uploadsFlipY.push(flipY); },
    texSubImage2D: () => { calls.texSubImage2D++; uploadsFlipY.push(flipY); }
  };
  return {
    gl, calls, uploadsFlipY,
    state: () => ({ bound, flipY }),
    // Simulate MapLibre having left its own texture bound and flipY true.
    presetForeignState: (tex, fy) => { bound = tex; flipY = fy; }
  };
}

const DATA = new Uint8Array(4 * 4 * 4);

describe('gl.getParameter batching via withTextureState', () => {
  it('a STANDALONE createTexture still reads driver state itself (unchanged contract)', () => {
    const h = makeGL();
    createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
    expect(h.calls.getParameter).toBe(2);
  });

  it('a STANDALONE updateTexture still reads driver state itself', () => {
    const h = makeGL();
    updateTexture(h.gl, { __tex: 9 }, DATA, 4, 4);
    expect(h.calls.getParameter).toBe(2);
  });

  it('REGRESSION: five textures in ONE scope cost ONE pair of reads, not five', () => {
    const h = makeGL();
    withTextureState(h.gl, () => {
      for (let i = 0; i < 5; i++) createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
    });
    // Was 10 (2 per texture). The whole point of the change.
    expect(h.calls.getParameter).toBe(2);
    expect(h.calls.texImage2D).toBe(5);
  });

  it('REGRESSION: a mixed create/update batch also costs ONE pair', () => {
    const h = makeGL();
    withTextureState(h.gl, () => {
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
      updateTexture(h.gl, { __tex: 42 }, DATA, 4, 4);
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
    });
    expect(h.calls.getParameter).toBe(2);
  });

  // ---- the restore must survive the optimisation ----

  it("RESTORE: a foreign binding is returned exactly, after a scoped batch", () => {
    const h = makeGL();
    const foreign = { __tex: 'maplibre-tile' };
    h.presetForeignState(foreign, true);
    withTextureState(h.gl, () => {
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
    });
    expect(h.state()).toEqual({ bound: foreign, flipY: true });
  });

  it('RESTORE: a foreign binding is returned exactly, after a STANDALONE call', () => {
    const h = makeGL();
    const foreign = { __tex: 'maplibre-tile' };
    h.presetForeignState(foreign, true);
    createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
    expect(h.state()).toEqual({ bound: foreign, flipY: true });
  });

  it('RESTORE: state is returned even when the batch throws', () => {
    const h = makeGL();
    const foreign = { __tex: 'maplibre-tile' };
    h.presetForeignState(foreign, true);
    expect(() => withTextureState(h.gl, () => {
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
      throw new Error('encode blew up mid-batch');
    })).toThrow('encode blew up mid-batch');
    expect(h.state()).toEqual({ bound: foreign, flipY: true });
  });

  it('CONTRACT: every upload inside a scope still happens with flipY false', () => {
    const h = makeGL();
    h.presetForeignState({ __tex: 'x' }, true);
    withTextureState(h.gl, () => {
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
      updateTexture(h.gl, { __tex: 7 }, DATA, 4, 4);
    });
    expect(h.uploadsFlipY).toEqual([false, false]);
  });

  it('nesting is safe: an inner scope does not re-read or early-restore', () => {
    const h = makeGL();
    const foreign = { __tex: 'maplibre-tile' };
    h.presetForeignState(foreign, true);
    withTextureState(h.gl, () => {
      createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4);
      withTextureState(h.gl, () => { createTexture(h.gl, h.gl.LINEAR, DATA, 4, 4); });
      expect(h.state().bound).not.toBe(foreign); // still inside — not restored yet
    });
    expect(h.calls.getParameter).toBe(2);
    expect(h.state()).toEqual({ bound: foreign, flipY: true });
  });

  it('a DIFFERENT gl context inside an active scope reads its own state (no cross-context leak)', () => {
    const a = makeGL();
    const b = makeGL();
    b.presetForeignState({ __tex: 'other-ctx' }, true);
    withTextureState(a.gl, () => {
      createTexture(a.gl, a.gl.LINEAR, DATA, 4, 4);
      createTexture(b.gl, b.gl.LINEAR, DATA, 4, 4); // must NOT be treated as inside a's scope
    });
    expect(b.calls.getParameter).toBe(2);
    expect(b.state().bound).toEqual({ __tex: 'other-ctx' });
  });

  it('withTextureState returns the callback result', () => {
    const h = makeGL();
    expect(withTextureState(h.gl, () => 'ok')).toBe('ok');
  });

  // ★ The helper batching in isolation is not the claim. The claim is that a REAL encode batches.
  it('END TO END: a full encodeMarineTexture costs ONE pair of driver reads', () => {
    const h = makeGL();
    const foreign = { __tex: 'maplibre-tile' };
    h.presetForeignState(foreign, true);
    const cols = 4, rows = 3;
    const grid = {
      cols, rows,
      vectors: Array.from({ length: cols * rows }, () => ({ direction: 270, speed: 2, height: 2, period: 10, is_valid: true })),
      __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0, __renderable: true,
      coverage_scope: 'regional', productId: 'scope-e2e',
      bounds: { west: -82, east: -79, south: 27, north: 29 }
    };
    const out = encodeMarineTexture(h.gl, grid, null, {}, undefined);
    expect(out).not.toBeNull();
    // Several textures are created (wave + chlorophyll + bathymetry + mask at minimum).
    expect(h.calls.texImage2D).toBeGreaterThanOrEqual(3);
    // ...but the driver is asked for its state exactly once, for the whole encode.
    expect(h.calls.getParameter).toBe(2);
    // And MapLibre's binding comes back untouched.
    expect(h.state()).toEqual({ bound: foreign, flipY: true });
  });
});
