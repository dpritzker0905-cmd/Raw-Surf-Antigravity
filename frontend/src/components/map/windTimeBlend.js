/**
 * windTimeBlend.js — the f120+ wind TAIL between two 3-hourly frames (OPT-IN, default off; owner clips decide): a LABELLED
 * estimate, never a stored forecast.
 *
 * GFS publishes 3-hourly steps past f120, while the scrubber steps hourly, so 2 of every 3 tail hours draw the nearest frame
 * (labelled by #560). With window.__RAW_WIND_TIME_BLEND__ = true, a selected instant strictly between two built static frames
 * at or past f120 draws them blended by PCHIP on u and v: a monotone cubic Hermite (Fritsch-Carlson slopes) through the
 * frames t-3, t, t+3 and t+6, one-sided where a neighbour frame or node is missing.
 *
 * WHY PCHIP (the hold-out, SCOREBOARD S23, 2026-10-25; side-session-notes wind-holdout-2026-10-25/): every non-frame hour
 * f001-f119 of 3 real GFS runs was rebuilt from the 3-hourly frames alone and scored against the real hourly field. For f073-119,
 * the mean of 3 runs, vector RMSE (m/s) / 12 h particle trajectory mean (km):
 *   nearest 1.187 / 5.33 · linear u/v 0.897 / 5.66 · polar (speed linear + shorter arc, this file's first draft) 0.950 / 6.86
 *   · PCHIP u/v 0.886 / 5.16 · Catmull-Rom u/v 0.890 / 5.10.
 * PCHIP is best or within 0.004 m/s on every field metric in every run and cannot overshoot between frames (Catmull-Rom can);
 * the polar draft carried particles furthest from the truth, so it is gone.
 * WHY ONLY f120+: before f120 NOAA publishes every hour (FRAME_WIND_GFS_HOURLY, #580) — real data beats any interpolation.
 *
 * The result says what it is: `time_blend` on the grid, `is_estimated` true, and the status line reads "Estimated forecast:
 * interpolated between <t0> and <t1>". No served number moves.
 *
 * Pure: no I/O, no globals except the opt-in read.
 */

export const WIND_BLEND_MAX_GAP_MS = 6 * 3600000;   // never bridge a hole in the lattice (an unbuilt frame) with a long blend
export const WIND_BLEND_MIN_LEAD_MS = 120 * 3600000; // the tail only: f120+, where NOAA publishes no hourly step
export const WIND_BLEND_METHOD = 'PCHIP on u/v (monotone cubic, frames t-3..t+6)';

export function windTimeBlendOn() {
  return typeof window !== 'undefined' && window.__RAW_WIND_TIME_BLEND__ === true;
}

/** The run (forecast reference time) of a static-frame index, in ms, or NaN. */
export function indexRunMs(index) {
  return Date.parse(index && (index.run_time || index.run));
}

/**
 * The two built frames around `selectedMs`, the weight of the second, and their outer neighbours (`fm` before, `fp` after, each
 * only when built and exactly one bracket step away), or null: on a frame, outside the frames, across a gap or an unbuilt frame,
 * before f120 of `runMs`, or with no run known (the caller then draws the nearest frame, as by default).
 */
export function blendBracket(frames, selectedMs, runMs) {
  if (!Array.isArray(frames) || !Number.isFinite(selectedMs) || !Number.isFinite(runMs)) return null;
  const built = [];
  for (const f of frames) {
    const t = Date.parse(f && f.valid_time);
    if (Number.isFinite(t)) built.push({ f, t });
  }
  let i0 = -1; let i1 = -1;
  for (let i = 0; i < built.length; i++) {
    const { t } = built[i];
    if (t === selectedMs) return null;                         // exactly on a frame: no blend
    if (t < selectedMs && (i0 < 0 || t > built[i0].t)) i0 = i;
    if (t > selectedMs && (i1 < 0 || t < built[i1].t)) i1 = i;
  }
  if (i0 < 0 || i1 < 0) return null;
  const { f: f0, t: t0 } = built[i0]; const { f: f1, t: t1 } = built[i1];
  if (!f0.path || !f1.path || t1 - t0 > WIND_BLEND_MAX_GAP_MS) return null;
  if (t0 - runMs < WIND_BLEND_MIN_LEAD_MS) return null;
  const step = t1 - t0;
  const at = (t) => { const hit = built.find((b) => b.t === t); return hit && hit.f.path ? hit.f : null; };
  return { f0, f1, t0, t1, weight: (selectedMs - t0) / step, fm: at(t0 - step), fp: at(t1 + step) };
}

/** The frames' u/v sign (+1 or -1): u = sign * speed * sin(direction). Read off the first well-conditioned vector. */
export function uvSign(vectors) {
  for (const v of vectors) {
    if (!v || v.is_valid === false || !(v.speed > 0.5)) continue;
    const s = Math.sin(v.direction * (Math.PI / 180));
    if (Math.abs(s) > 0.3 && v.u !== 0) return Math.sign(v.u / (v.speed * s)) || -1;
  }
  return -1;
}

/** Fritsch-Carlson slope (per frame step) at p0 from neighbours pm and pp: the harmonic mean of the two secants when they agree
 * in sign, else 0 (a local extremum stays flat, so the curve never overshoots). The same as the hold-out's `pchip_slope`. */
export function fcSlope(pm, p0, pp) {
  const d0 = p0 - pm; const d1 = pp - p0;
  return d0 * d1 > 0 ? (2 * d0 * d1) / (d0 + d1) : 0;
}

/** Cubic Hermite between p0 and p1 with slopes m0, m1 (per step), at a in [0, 1]. */
export function hermite(p0, p1, m0, m1, a) {
  const a2 = a * a; const a3 = a2 * a;
  return (2 * a3 - 3 * a2 + 1) * p0 + (a3 - 2 * a2 + a) * m0 + (-2 * a3 + 3 * a2) * p1 + (a3 - a2) * m1;
}

/** PCHIP between p0 and p1 at weight a; pm / pp may be null (that side is an edge: its slope is the bracket's own secant). */
export function pchip(pm, p0, p1, pp, a) {
  const m0 = pm == null ? p1 - p0 : fcSlope(pm, p0, p1);
  const m1 = pp == null ? p1 - p0 : fcSlope(p0, p1, pp);
  return hermite(p0, p1, m0, m1, a);
}

const okVec = (x) => !!(x && x.is_valid !== false && Number.isFinite(x.u) && Number.isFinite(x.v));
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000 + 0;

/**
 * Blend same-shape wind vector arrays at weight `w` (0 = A, 1 = B) by PCHIP on u and v. `M` (the frame before A) and `P` (the
 * frame after B) are optional and must have the same shape when given. Null when the bracket shapes differ or w is not strictly
 * inside (0, 1). A node missing in A or B keeps the frame that has it, unblended.
 */
export function blendVectors(A, B, w, M = null, P = null) {
  if (!Array.isArray(A) || !Array.isArray(B) || A.length !== B.length || !(w > 0 && w < 1)) return null;
  const m = Array.isArray(M) && M.length === A.length ? M : null;
  const p = Array.isArray(P) && P.length === A.length ? P : null;
  const sign = uvSign(A);
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) {
    const a = A[i]; const b = B[i];
    const aok = okVec(a); const bok = okVec(b);
    if (!aok && !bok) { out[i] = a || b; continue; }
    if (!aok || !bok) { out[i] = aok ? a : b; continue; }
    const mm = m && okVec(m[i]) ? m[i] : null; const pp = p && okVec(p[i]) ? p[i] : null;
    const u = pchip(mm && mm.u, a.u, b.u, pp && pp.u, w);
    const v = pchip(mm && mm.v, a.v, b.v, pp && pp.v, w);
    const speed = Math.hypot(u, v);
    // u = sign * speed * sin(dir), v = sign * speed * cos(dir)  =>  dir = atan2(sign * u, sign * v)
    const dir = speed > 0 ? ((Math.atan2(sign * u, sign * v) * 180) / Math.PI + 360) % 360 : a.direction;
    out[i] = { lat: a.lat, lng: a.lng, speed: r2(speed), direction: r2(dir), u: r4(u), v: r4(v), is_valid: true };
  }
  return out;
}

function isoNoMs(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/**
 * The /grid-shaped JSON for the selected instant, blended from the bracket frames' JSONs (same box) and, when present, their
 * outer neighbours' (`jm`, `jp`), labelled; or null. It names the SELECTED instant as its valid time and carries both bracket
 * sources, so nothing reads it as a stored frame.
 */
export function blendWindJson(j0, j1, bracket, selectedMs, jm = null, jp = null) {
  if (!j0 || !j1 || !bracket || !j0.grid || !j1.grid) return null;
  const vectors = blendVectors(j0.grid.vectors, j1.grid.vectors, bracket.weight,
    jm && jm.grid ? jm.grid.vectors : null, jp && jp.grid ? jp.grid.vectors : null);
  if (!vectors) return null;
  const at = isoNoMs(selectedMs);
  const time_blend = { from: isoNoMs(bracket.t0), to: isoNoMs(bracket.t1), weight: Math.round(bracket.weight * 1000) / 1000,
    method: WIND_BLEND_METHOD, neighbours: { before: !!(jm && jm.grid), after: !!(jp && jp.grid) },
    from_product: j0.product_id || null, to_product: j1.product_id || null };
  return { ...j0, grid: { ...j0.grid, vectors }, valid_time: at, served_valid_time: at, frame_substituted: false,
    product_id: `${j0.product_id || 'wind'}#blend@${at}`, is_estimated: true, time_blend, truthTag: null };
}
