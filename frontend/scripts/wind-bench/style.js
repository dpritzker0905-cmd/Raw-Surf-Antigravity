/**
 * Wind bench: what do the wind's MARKS look like against what they sit on? Pure, no DOM, no GL.
 *
 * "Dark looks great, light and beach look pale" is a statement about the streaks, not about the colour field. This reads
 * it off the picture. Two frames from the same camera, tiles and particle seed: the map with the field alone, and the
 * map with field + particles. A MARK pixel is one the particles changed (more than `markDE` dE76). Over the mark
 * pixels of each surface (land, water):
 *
 *   cover    share of the surface's pixels that are mark pixels
 *   dL       signed L* of a mark pixel against the field under it: median, p10, p90 (+ = lighter than its ground)
 *   absDL    mean |dL|: how hard a mark stands off its ground
 *   strong   share of mark pixels with |dL| >= `strongDL` (a mark the eye separates at once)
 *   lighter  share of mark pixels lighter than their ground (the POLARITY: 1 = light on dark, 0 = ink on paper)
 *   Lfield / Lmark   median L* of the field under the marks / of the marks
 *   Cfield / Cmark   median chroma C*ab of the field under the marks / of the marks (do the marks carry colour?)
 *   dh       median hue difference, mark against the field under it, where both are chromatic (C* > `chromatic`):
 *            a low dh with a high Cmark is "a stronger shade of the field's own colour", which is dark's look
 *
 * Pixels are read at DEVICE resolution: a streak is 1.5-4 CSS px wide, and a CSS-pixel average would thin it.
 */

const DEFAULTS = Object.freeze({ markDE: 4, strongDL: 15, chromatic: 8 });

const SRGB = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; SRGB[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const F = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

/** CIE L*a*b* (D65) of an 8-bit sRGB colour, written into `out` at 0..2. */
function labInto(out, r, g, b) {
  const R = SRGB[r], G = SRGB[g], B = SRGB[b];
  const fx = F((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = F(0.2126729 * R + 0.7151522 * G + 0.072175 * B),
    fz = F((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

/** A value histogram with a fixed step, for medians and percentiles of millions of pixels without sorting them. */
function hist(lo, hi, step) {
  const n = Math.ceil((hi - lo) / step) + 1, bins = new Uint32Array(n);
  let count = 0;
  return {
    add(v) { bins[Math.max(0, Math.min(n - 1, Math.round((v - lo) / step)))]++; count++; },
    q(p) { if (!count) return null; let acc = 0; const want = p * count; for (let i = 0; i < n; i++) { acc += bins[i]; if (acc >= want) return lo + i * step; } return hi; },
    get count() { return count; },
  };
}

/**
 * @param {Uint8Array|Uint8ClampedArray} fullPx   RGBA, map + field + particles
 * @param {Uint8Array|Uint8ClampedArray} fieldPx  RGBA, map + field, same camera
 * @param {Uint8Array|null} mask  per pixel: 1 = water, 0 = land (null = one surface, reported as land)
 * @returns {[object, object]}  [land, water]
 */
function markStyle(fullPx, fieldPx, mask, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, n = fullPx.length >> 2, A = new Float64Array(3), B = new Float64Array(3);
  const acc = [0, 1].map(() => ({ px: 0, marks: 0, abs: 0, strong: 0, lighter: 0, dL: hist(-100, 100, 0.5), Lf: hist(0, 100, 0.5), Lm: hist(0, 100, 0.5),
    Cf: hist(0, 160, 0.5), Cm: hist(0, 160, 0.5), dh: hist(0, 180, 1) }));
  for (let i = 0; i < n; i++) {
    const s = acc[mask ? mask[i] : 0], p = i * 4;
    s.px++;
    if (fullPx[p] === fieldPx[p] && fullPx[p + 1] === fieldPx[p + 1] && fullPx[p + 2] === fieldPx[p + 2]) continue;
    labInto(A, fullPx[p], fullPx[p + 1], fullPx[p + 2]); labInto(B, fieldPx[p], fieldPx[p + 1], fieldPx[p + 2]);
    const dL = A[0] - B[0], da = A[1] - B[1], db = A[2] - B[2];
    if (dL * dL + da * da + db * db <= o.markDE * o.markDE) continue;
    const cm = Math.hypot(A[1], A[2]), cf = Math.hypot(B[1], B[2]);
    s.marks++; s.abs += Math.abs(dL); if (Math.abs(dL) >= o.strongDL) s.strong++; if (dL > 0) s.lighter++;
    s.dL.add(dL); s.Lf.add(B[0]); s.Lm.add(A[0]); s.Cf.add(cf); s.Cm.add(cm);
    if (cm > o.chromatic && cf > o.chromatic) { let d = Math.abs(Math.atan2(A[2], A[1]) - Math.atan2(B[2], B[1])) * 180 / Math.PI; if (d > 180) d = 360 - d; s.dh.add(d); }
  }
  const r = (x, d = 1) => (x == null ? null : +x.toFixed(d));
  return acc.map((s) => (s.marks ? {
    cover: r(s.marks / s.px, 4), dL: r(s.dL.q(0.5)), dL10: r(s.dL.q(0.1)), dL90: r(s.dL.q(0.9)), absDL: r(s.abs / s.marks, 2), strong: r(s.strong / s.marks, 3),
    lighter: r(s.lighter / s.marks, 3), Lfield: r(s.Lf.q(0.5)), Lmark: r(s.Lm.q(0.5)), Cfield: r(s.Cf.q(0.5)), Cmark: r(s.Cm.q(0.5)),
    dh: s.dh.count >= s.marks * 0.05 ? r(s.dh.q(0.5), 0) : null, pixels: s.px,
  } : { cover: 0, pixels: s.px }));
}

/** One table cell per surface, for the runners. */
function styleCell(s) {
  if (!s || !s.cover) return '   -   (no marks)'.padEnd(74);
  const f1 = (x) => (x == null ? '  - ' : (x >= 0 ? '+' : '') + x.toFixed(1)).padStart(6), n1 = (x) => (x == null ? '  - ' : x.toFixed(1)).padStart(5);
  return `${s.cover.toFixed(3)} ${f1(s.dL)} [${f1(s.dL10)},${f1(s.dL90)}] ${n1(s.absDL)} ${s.strong.toFixed(2)} ${s.lighter.toFixed(2)} ${n1(s.Lfield)}>${n1(s.Lmark)} ${n1(s.Cfield)}>${n1(s.Cmark)} ${s.dh == null ? '  -' : String(s.dh).padStart(3)}`;
}
const STYLE_HEADER = 'cover  dL med [  p10 ,  p90 ]  |dL| strong lighter L f>mark   C* f>mark  dh';

module.exports = { markStyle, styleCell, labInto, STYLE_HEADER, STYLE_DEFAULTS: DEFAULTS };
