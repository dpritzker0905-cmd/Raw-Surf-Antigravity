/**
 * gridPointRegistration.js — draw every forecast grid where its samples actually are (2026-10-08).
 *
 * THE CONVENTION MISMATCH. The backend serves every grid POINT-registered: `bounds` are the extents
 * of the SAMPLES (normalizer.py steps lon from west to east inclusive at `resolution`, so
 * cols = span / resolution + 1 — a 2-deg world grid is 181 x 83 over -180..180 / -80..84). GL
 * samples texel i at (i + 0.5) / n, i.e. it treats `bounds` as CELL EDGES. Uncorrected, sample i
 * is drawn at west + (i + 0.5) * span / n instead of west + i * span / (n - 1): +1/2 cell at the
 * west edge, 0 mid-grid, -1/2 cell at the east edge — and by a DIFFERENT amount in every grid.
 *
 * WHY THE OWNER SAW IT. Each pan brings a new viewport grid ~1-3 s after moveend; with different
 * bounds or column count, the same ocean point is drawn somewhere else, so the whole field slides
 * with the camera standing still (owner: "a slight shift ... on small pannings after a pan is
 * done, maybe a second or two later"). Measured on dev 744a7132, z7 Gulf: a 2-deg regional grid
 * going 8 -> 9 columns 3.0 s after moveend slid the field 28 css px east (cross-correlation of two
 * still-camera frames; null control 0 px); this formula predicted ~24 px at the centre.
 *
 * THE FIX maps a geographic uv in [0,1] over the sample extents onto texel centres:
 * uv' = (uv * (n - 1) + 1/2) / n, sent as uv' = uv + uv * a + b with a = -1/n, b = 1/(2n).
 * All zeros = the legacy mapping, so an unset uniform (GL's default) or the kill switch is
 * byte-identical to before — never a field collapsed onto one texel — and the small-term form
 * keeps mediump (fp16) precision on phones. Land masks are rasterised from polygons over their
 * own bounds (true edges) and are NOT corrected. Tests: gridPointRegistration.test.js.
 * Kill: window.__RAW_DISABLE_GRID_POINT_REG__ = true.
 */

export const GRID_REG_OFF = Object.freeze([0, 0, 0, 0]);

/** [a.x, a.y, b.x, b.y] for `grid` (needs integer-like cols/rows >= 2), or the legacy zeros. */
export function gridPointReg(grid, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_GRID_POINT_REG__ === true || !grid) return GRID_REG_OFF;
  const { cols, rows } = grid;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return GRID_REG_OFF;
  return [-1 / cols, -1 / rows, 0.5 / cols, 0.5 / rows];
}

/** Binds `name` (a vec4) on `prog` for `grid`. Returns what was set (tests assert it without GL). */
export function setGridPointRegUniform(gl, prog, name, grid, win) {
  const r = gridPointReg(grid, win);
  if (gl && prog) gl.uniform4f(gl.getUniformLocation(prog, name), r[0], r[1], r[2], r[3]);
  return r;
}

/** The GLSL twin of gridPointReg's mapping — every shader that samples a data grid declares it. */
export const GLSL_PT_REG = 'vec2 ptReg(vec2 uv, vec4 r) { return uv + uv * r.xy + r.zw; }';
