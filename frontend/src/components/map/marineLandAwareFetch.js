/**
 * marineLandAwareFetch.js — uniforms for the land-aware wave fetch (the island halo, 2026-08-18).
 *
 * WHAT IT FEEDS. `sampleWaveLandAware()` in WebGLMarineShaders.js excludes LAND texels from the
 * bilinear blend of the wave texture and renormalises the remaining weights, so a water pixel near a
 * coast is interpolated only among water cells. Rendered height is H = sum(w_i h_i); the halo is
 * dH/dh_land > 0, and this drives the term that zeroes those weights.
 *
 * ⛔ WHY BOTH PASSES MUST CALL THIS. The coarse wash and the main heatmap share ONE program, and GL
 * uniforms persist per program between draws. If only the main pass set `u_waveTexel`, the coarse
 * pass would sample ITS texture using the MAIN grid's texel size — reading neighbours at the wrong
 * stride and inventing values. Every call site sets the pair, or the pair is wrong.
 *
 * ⚠️ DIMENSIONS COME FROM `waveGrid.cols/rows`, NOT `engine._texWidth`. The latter is written by the
 * encoder only when it allocates, so it can lag the grid whose texture is currently bound; the grid
 * object cannot. A stride that disagrees with the bound texture by even one texel would smear
 * exactly the coastline this change exists to sharpen.
 *
 * Kill: `__RAW_DISABLE_LAND_AWARE_FETCH__ = true` pins the pair to 0 and the shader falls back to the
 * plain `texture2D` fetch, byte-for-byte the pre-change behaviour.
 */

/**
 * @returns {{on: boolean, cols: number|null, rows: number|null}} what was actually set — the caller
 *   can put this straight into telemetry, and tests assert on it without a GL context.
 */
export function resolveLandAwareFetch(waveGrid, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  // ⛔⛔ DEFAULT OFF — MEASURED REGRESSION, 2026-08-18. Enabling this made the halo WORSE, in a
  // within-build A/B on deployed 2f58c7e6 with a working control:
  //     madeira z9.3   control 0 px  ->  ENABLED 40 px (4177 m), peak 47 vs open-water 21
  //     madeira z8.5    control 14 px ->  ENABLED 37 px (6728 m), peak 74 vs open-water 23
  // WHY, and it is a flaw in the APPROACH, not a bug in this code: renormalising the weights makes
  // the interpolant DISCONTINUOUS at the coast. A footprint containing a land texel collapses to the
  // pure-water value while a footprint one cell further out keeps the full blend, so at ~22 km cells
  // the two differ by up to 0.5 m across one cell boundary — a manufactured EDGE in place of a ramp.
  // Removing the ramp was right; replacing it with a step is not.
  // Kept, not deleted: the analysis and instruments are sound and a smooth variant (blend the
  // renormalised and plain results by land-weight fraction, so the field stays C0) is the obvious
  // next attempt. Opt in with __RAW_ENABLE_LAND_AWARE_FETCH__ = true to measure it.
  if (w.__RAW_ENABLE_LAND_AWARE_FETCH__ !== true) return { on: false, cols: null, rows: null };
  if (w.__RAW_DISABLE_LAND_AWARE_FETCH__ === true) return { on: false, cols: null, rows: null };
  const g = waveGrid;
  // A 1-wide or 1-tall grid has no interior 2x2 footprint; fail safe to the plain fetch rather than
  // divide by a zero-length stride.
  // ⚠️ Finiteness is checked EXPLICITLY, the same way computeMidZoomOverlayEngage guards its zoom:
  // a bare `g.cols > 1` coerces, so the string '8' would pass and put a stringly-typed stride into a
  // GL uniform. NaN would also slip past a naive `typeof === 'number'`.
  if (!g || !Number.isFinite(g.cols) || !Number.isFinite(g.rows) || g.cols <= 1 || g.rows <= 1) {
    return { on: false, cols: null, rows: null };
  }
  return { on: true, cols: g.cols, rows: g.rows };
}

/** Sets `u_waveTexel` + `u_landAwareFetch` on `prog`. Always sets BOTH — see the note above. */
export function setLandAwareFetchUniforms(gl, prog, waveGrid, win) {
  const r = resolveLandAwareFetch(waveGrid, win);
  if (!gl || !prog) return r;
  gl.uniform2f(gl.getUniformLocation(prog, 'u_waveTexel'),
    r.on ? 1 / r.cols : 0, r.on ? 1 / r.rows : 0);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_landAwareFetch'), r.on ? 1 : 0);
  return r;
}
