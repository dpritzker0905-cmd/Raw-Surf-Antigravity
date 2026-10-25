/**
 * windTimeBlend.js — OWNER A/B CLIP B (2026-10-24; OPT-IN, default off): a LABELLED wind field between two 3-hourly frames.
 *
 * The stored GFS wind is 3-hourly; the scrubber steps hourly, so 2 of every 3 hours draw the nearest frame. With
 * window.__RAW_WIND_TIME_BLEND__ = true, a selected instant strictly between two built static frames draws a blend of the two:
 *   - speed linearly in time;
 *   - direction along the SHORTER arc (a u/v average would shrink the speed wherever the wind turns between frames);
 *   - u/v rebuilt from the blended speed + direction in the frames' own sign convention.
 * The result is an ESTIMATE and says so: `time_blend` on the grid, `is_estimated` true, and the wind status line reads
 * "Estimated forecast: interpolated between <t0> and <t1>". Never a stored forecast, never the default; no served number moves.
 *
 * Pure: no I/O, no globals except the opt-in read.
 */

export const WIND_BLEND_MAX_GAP_MS = 6 * 3600000;   // never bridge a hole in the lattice (an unbuilt frame) with a long blend

export function windTimeBlendOn() {
  return typeof window !== 'undefined' && window.__RAW_WIND_TIME_BLEND__ === true;
}

/** The two built frames around `selectedMs` and the weight of the second, or null (on a frame, outside, a gap, unbuilt). */
export function blendBracket(frames, selectedMs) {
  if (!Array.isArray(frames) || !Number.isFinite(selectedMs)) return null;
  let f0 = null; let f1 = null; let t0 = -Infinity; let t1 = Infinity;
  for (const f of frames) {
    const t = Date.parse(f && f.valid_time);
    if (!Number.isFinite(t)) continue;
    if (t === selectedMs) return null;                         // exactly on a frame: no blend
    if (t < selectedMs && t > t0) { t0 = t; f0 = f; }
    if (t > selectedMs && t < t1) { t1 = t; f1 = f; }
  }
  if (!f0 || !f1 || !f0.path || !f1.path || t1 - t0 > WIND_BLEND_MAX_GAP_MS) return null;
  return { f0, f1, t0, t1, weight: (selectedMs - t0) / (t1 - t0) };
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

/** Shortest signed arc from a to b, in degrees, in [-180, 180). */
export function arc(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Blend two same-shape wind vector arrays at weight `w` (0 = first, 1 = second). Null when the shapes differ. */
export function blendVectors(A, B, w) {
  if (!Array.isArray(A) || !Array.isArray(B) || A.length !== B.length || !(w > 0 && w < 1)) return null;
  const sign = uvSign(A);
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) {
    const a = A[i]; const b = B[i];
    const aok = a && a.is_valid !== false; const bok = b && b.is_valid !== false;
    if (!aok && !bok) { out[i] = a || b; continue; }
    if (!aok || !bok) { out[i] = aok ? a : b; continue; }   // one side missing: the frame that has it, unblended
    const speed = Math.round(((1 - w) * a.speed + w * b.speed) * 100) / 100;
    const dir = Math.round(((((a.direction + w * arc(a.direction, b.direction)) % 360) + 360) % 360) * 100) / 100;
    const rad = dir * (Math.PI / 180);
    out[i] = { lat: a.lat, lng: a.lng, speed, direction: dir,
      u: Math.round(sign * speed * Math.sin(rad) * 10000) / 10000 + 0, v: Math.round(sign * speed * Math.cos(rad) * 10000) / 10000 + 0,
      is_valid: true };
  }
  return out;
}

function isoNoMs(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/**
 * The /grid-shaped JSON for the selected instant, blended from the two frames' JSONs (same box), labelled; or null.
 * The blend names the SELECTED instant as its valid time and carries both sources, so nothing reads it as a stored frame.
 */
export function blendWindJson(j0, j1, bracket, selectedMs) {
  if (!j0 || !j1 || !bracket || !j0.grid || !j1.grid) return null;
  const vectors = blendVectors(j0.grid.vectors, j1.grid.vectors, bracket.weight);
  if (!vectors) return null;
  const at = isoNoMs(selectedMs);
  const time_blend = { from: isoNoMs(bracket.t0), to: isoNoMs(bracket.t1), weight: Math.round(bracket.weight * 1000) / 1000,
    method: 'speed linear + direction shorter arc', from_product: j0.product_id || null, to_product: j1.product_id || null };
  return { ...j0, grid: { ...j0.grid, vectors }, valid_time: at, served_valid_time: at, frame_substituted: false,
    product_id: `${j0.product_id || 'wind'}#blend@${at}`, is_estimated: true, time_blend, truthTag: null };
}
