/**
 * Wind bench, PATH mode metrics: on screen, is a colour WIND or MAP? Pure functions over RGB images; no DOM, no GL.
 *
 * Owner (2026-10-09): "there is still some ambiguity to the wind color vs the color of the map in light mode and beach
 * modes". Two directions, each measured on a pair of frames from the same camera, the map alone (`off`) and the map under
 * the wind (`comp`), at half CSS-pixel scale:
 *   mapLike   share of the wind-touched pixels (dE00(comp, off) >= 5) whose colour now sits within 5 dE00 of ANOTHER
 *             feature's colour on this map (a palette colour >= 10 dE00 from the pixel's own), e.g. tinted land that
 *             reads as water, or tinted water that reads as a park. `pairs` names the commonest swaps;
 *   mapLikeConv  the same against the STYLE's own area colours (every fill/background colour literal in the original
 *             style: water, park, wood, grass, sand ...), the viewer's convention for this map: tinted tan land that comes
 *             out the style's forest green reads as forest even where no forest is on screen. Scored against the original
 *             (unmuted) colours, so a muted basemap gets no credit for having hidden them;
 *   windLike  share of the bare map's area painted in colours that sit within 8 dE00 of the legend's wind colours
 *             (3-75 kn) and are chromatic (C* >= 10): map that reads as wind (a green park as a 16 kn band);
 *   hueShift  share of the wind-coloured pixels whose hue sits > 30 deg off the legend colour for the TRUE speed there
 *             (the served grid, sampled per pixel): the map's own hue bending the wind's, e.g. a 35 kn gold multiplied
 *             into cyan water comes out green, a 16-21 kn colour on the legend (a wrong reading, not just an ugly one);
 *   coast     land/water separation across the coastline: dE00 between a water pixel 2 inside and a land pixel 3 inside
 *             each boundary (past the coastline stroke), under the wind (coastDE) and as a share of the original (coastKept);
 * and what the cure must not cost:
 *   colourEdges  share of the map's colour edges (dE00 >= 8 between pixels 2 apart, hue-only edges included, which the
 *                L*-only line metric of map-run.js cannot see) that keep at least half their dE00 in another image;
 *   ink / cover  mean dE00 the wind adds, and the share of pixels it visibly changes (>= 5): the wind must stay visible;
 *   pops         samples whose ink jumps away from both neighbours by > 25% of the path's median (a flash or a drop-out);
 *   warpDiff     (field-only runs) the previous sample warped by the EXACT camera change onto this one: dE00 per pixel
 *                between them. A field glued to the map scores like the bare map does; the excess is the wind's own
 *                swimming, popping or drop-out in motion (no optical flow needed: the cameras are known).
 * Thresholds: ~2.3 dE is one JND; categorical "same colour" judgements sit near 5-10 dE00 (research_notes/Wind overlay
 * basemap colour separation/). Colours are binned at 6 bits per channel (<= ~1.5 dE00 of binning error) and cached.
 */

const { mercY, TILE_PX } = require('./camera');

const SRGB = new Float64Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
const XN = 0.95047, ZN = 1.08883;
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** CIE Lab (D65) of an 8-bit sRGB colour. */
function labOf(r, g, b) {
  const R = SRGB[r], G = SRGB[g], B = SRGB[b];
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN), y = f(0.2126729 * R + 0.7151522 * G + 0.0721750 * B), z = f((0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / ZN);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const DEG = Math.PI / 180;
/** CIEDE2000 (Sharma et al. 2005, kL = kC = kH = 1). */
function de00(L1, a1, b1, L2, a2, b2) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2, Cm7 = Math.pow(Cm, 7);
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 6103515625)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G), Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp1 = Cp1 === 0 ? 0 : (Math.atan2(b1, ap1) / DEG + 360) % 360, hp2 = Cp2 === 0 ? 0 : (Math.atan2(b2, ap2) / DEG + 360) % 360;
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * DEG);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { hm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * DEG) + 0.24 * Math.cos(2 * hm * DEG) + 0.32 * Math.cos((3 * hm + 6) * DEG) - 0.20 * Math.cos((4 * hm - 63) * DEG);
  const Lm50 = (Lm - 50) * (Lm - 50), SL = 1 + 0.015 * Lm50 / Math.sqrt(20 + Lm50), SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T;
  const Cpm7 = Math.pow(Cpm, 7), RT = -2 * Math.sqrt(Cpm7 / (Cpm7 + 6103515625)) * Math.sin(60 * Math.exp(-Math.pow((hm - 275) / 25, 2)) * DEG);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

const BITS = 6, SHIFT = 8 - BITS, NBIN = 1 << (3 * BITS);
/** The 6-bit-per-channel bin of an 8-bit colour. */
const binOf = (r, g, b) => ((r >> SHIFT) << (2 * BITS)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);

/** Lazily filled Lab of every bin (its centre colour). */
function labTable() {
  const L = new Float32Array(NBIN).fill(NaN), A = new Float32Array(NBIN), B = new Float32Array(NBIN), m = (1 << BITS) - 1, half = 1 << (SHIFT - 1);
  const get = (k) => {
    if (Number.isNaN(L[k])) {
      const r = ((k >> (2 * BITS)) & m) << SHIFT | half, g = ((k >> BITS) & m) << SHIFT | half, b = (k & m) << SHIFT | half, c = labOf(r, g, b);
      L[k] = c[0]; A[k] = c[1]; B[k] = c[2];
    }
    return k;
  };
  const de = (k1, k2) => (k1 === k2 ? 0 : (get(k1), get(k2), de00(L[k1], A[k1], B[k1], L[k2], A[k2], B[k2])));
  const lab = (k) => (get(k), [L[k], A[k], B[k]]);
  const chroma = (k) => (get(k), Math.hypot(A[k], B[k]));
  return { de, lab, chroma };
}

/** Box-average a WxH RGBA buffer by `s` (e.g. 4 = half CSS scale at DPR 2) into a bin image. */
function binImage(px, W, H, s) {
  const w = Math.floor(W / s), h = Math.floor(H / s), bins = new Uint32Array(w * h), q = s * s;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < s; j++) for (let k = 0; k < s; k++) { const p = ((y * s + j) * W + x * s + k) * 4; r += px[p]; g += px[p + 1]; b += px[p + 2]; }
      bins[y * w + x] = binOf(Math.round(r / q), Math.round(g / q), Math.round(b / q));
    }
  }
  return { w, h, bins };
}
/** A device-pixel 0/1 mask, point-sampled onto the same grid as binImage(…, s). */
function binMask(mask, W, H, s) {
  const w = Math.floor(W / s), h = Math.floor(H / s), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = mask[(y * s + (s >> 1)) * W + x * s + (s >> 1)];
  return m;
}

const hueName = (a, b) => {
  const h = (Math.atan2(b, a) / DEG + 360) % 360;
  return h < 50 || h >= 340 ? 'red' : h < 100 ? 'tan' : h < 165 ? 'green' : h < 255 ? 'blue' : 'violet';
};

/**
 * The map's own colours: bins covering >= minShare of the frame, merged greedily (largest first) within mergeDE.
 * Each entry: { k (bin), share, wet (share of its pixels on water), C (chroma), label 'water:blue' / 'land:grey' / ... }.
 */
function paletteOf(img, wet, lut, { minShare = 0.002, mergeDE = 3 } = {}) {
  const n = img.bins.length, cnt = new Map(), wetCnt = new Map();
  for (let i = 0; i < n; i++) { const k = img.bins[i]; cnt.set(k, (cnt.get(k) || 0) + 1); if (wet && wet[i]) wetCnt.set(k, (wetCnt.get(k) || 0) + 1); }
  const big = [...cnt.entries()].filter(([, c]) => c >= minShare * n).sort((x, y) => y[1] - x[1]);
  const entries = [];
  for (const [k, c] of big) {
    const hit = entries.find((e) => lut.de(e.k, k) < mergeDE);
    if (hit) { hit.n += c; hit.wetN += wetCnt.get(k) || 0; } else entries.push({ k, n: c, wetN: wetCnt.get(k) || 0 });
  }
  return entries.map((e) => {
    const [L, a, b] = lut.lab(e.k), C = Math.hypot(a, b), wetShare = e.n ? e.wetN / e.n : 0;
    return { k: e.k, L, C, share: e.n / n, wet: wetShare, label: `${wetShare >= 0.5 ? 'water' : 'land'}:${C < 8 ? 'grey' : hueName(a, b)}` };
  });
}

/** Nearest palette entry per bin (cached per palette). */
function nearestFinder(entries, lut) {
  const idx = new Int16Array(NBIN).fill(-1), dist = new Float32Array(NBIN);
  return (k) => {
    if (idx[k] < 0) {
      let best = 0, bd = Infinity;
      for (let e = 0; e < entries.length; e++) { const d = lut.de(entries[e].k, k); if (d < bd) { bd = d; best = e; } }
      idx[k] = best; dist[k] = bd;
    }
    return idx[k];
  };
}

const T = { tint: 5, mimic: 5, distinct: 10, windLike: 8, chroma: 10, edge: 8, keep: 0.5 };

/**
 * One camera's pair. off/comp: bin images of the same size; wet: 0/1 per pixel; legendBins: bins of the legend's wind
 * colours (3-75 kn). Returns the mapLike / windLike / ink / cover numbers and the commonest swaps.
 */
function frameMetrics({ off, comp, orig = off, wet, legendBins, stylePal = [], lut, thresholds = T }) {
  const entries = paletteOf(off, wet, lut), near = nearestFinder(entries, lut), n = off.bins.length;
  const distinct = entries.map((e) => entries.map((o) => lut.de(e.k, o.k) >= thresholds.distinct));
  const sNear = nearestFinder(stylePal, lut), sDistinct = stylePal.map((e) => stylePal.map((o) => lut.de(e.k, o.k) >= thresholds.distinct));
  let ink = 0, cover = 0, mimic = 0, conv = 0, chroma = 0;
  const pairs = new Map(), convPairs = new Map();
  for (let i = 0; i < n; i++) {
    const o = off.bins[i], c = comp.bins[i], d = lut.de(o, c);
    chroma += lut.chroma(o);
    ink += d;
    if (d < thresholds.tint) continue;
    cover++;
    const own = near(o), m = near(c);
    if (m !== own && distinct[own][m] && lut.de(entries[m].k, c) <= thresholds.mimic) {
      mimic++;
      const key = `${entries[own].label}>${entries[m].label}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    if (stylePal.length) {
      const so = sNear(orig.bins[i]), sc = sNear(c);
      if (stylePal[sc].label !== stylePal[so].label && sDistinct[so][sc] && lut.de(stylePal[sc].k, c) <= thresholds.mimic) {
        conv++;
        const key = `${stylePal[so].label}>${stylePal[sc].label}`;
        convPairs.set(key, (convPairs.get(key) || 0) + 1);
      }
    }
  }
  let windLike = 0;
  for (const e of entries) {
    if (e.C < thresholds.chroma) continue;
    let bd = Infinity;
    for (const k of legendBins) bd = Math.min(bd, lut.de(e.k, k));
    if (bd <= thresholds.windLike) windLike += e.share;
  }
  const top = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => ({ swap: k, share: +(v / Math.max(cover, 1)).toFixed(4) }));
  return { ink: ink / n, cover: cover / n, mapLike: cover ? mimic / cover : 0, mapLikeConv: cover ? conv / cover : 0, windLike, chroma: chroma / n,
    pairs: top(pairs), convPairs: top(convPairs), palette: entries.length };
}

/** Style area colours as palette entries: [{ k (bin), label }] from [{ rgb: [r, g, b], label }], deduplicated by bin. */
function stylePalette(colours) {
  const seen = new Map();
  for (const c of colours) { const k = binOf(...c.rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))))); if (!seen.has(k)) seen.set(k, { k, label: c.label }); }
  return [...seen.values()];
}

/** Land/water separation across each coastline crossing (rows and columns): water 2 px inside, land 3 px inside. */
function coastMetrics(orig, comp, wet, lut) {
  const { w, h } = orig, de0 = [], de1 = [], ratio = [];
  const probe = (iw, il) => {
    const e0 = lut.de(orig.bins[iw], orig.bins[il]), e1 = lut.de(comp.bins[iw], comp.bins[il]);
    de0.push(e0); de1.push(e1); if (e0 >= 3) ratio.push(e1 / e0);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 2; x < w - 4; x++) {
      const i = y * w + x;
      if (wet[i] && !wet[i + 1] && wet[i - 2] && !wet[i + 3]) probe(i - 2, i + 3);
      else if (!wet[i] && wet[i + 1] && !wet[i - 2] && wet[i + 3]) probe(i + 3, i - 2);
    }
  }
  for (let y = 2; y < h - 4; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (wet[i] && !wet[i + w] && wet[i - 2 * w] && !wet[i + 3 * w]) probe(i - 2 * w, i + 3 * w);
      else if (!wet[i] && wet[i + w] && !wet[i - 2 * w] && wet[i + 3 * w]) probe(i + 3 * w, i - 2 * w);
    }
  }
  const med = (v) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : null);
  return { n: de1.length, coastDE0: med(de0), coastDE: med(de1), coastKept: med(ratio) };
}

/**
 * Exact-camera warp difference between two samples of a path (bin images from readPixels: row 0 is the BOTTOM of the
 * screen). geom: { cssW, cssH, px } with px = css px per image pixel. cam: { lng, lat, z }. Returns the mean and 99th
 * percentile dE00 over the pixels both frames see, and the share above 5 dE00.
 */
function warpDiff(prev, prevCam, img, cam, geom, lut) {
  const { w, h, bins } = img, per = (z) => 1 / (TILE_PX * Math.pow(2, z));
  const c1 = { x: (cam.lng + 180) / 360, y: mercY(cam.lat), k: per(cam.z) }, c0 = { x: (prevCam.lng + 180) / 360, y: mercY(prevCam.lat), k: per(prevCam.z) };
  const ds = [];
  for (let r = 0; r < h; r++) {
    // screen offset below the centre (css px; mercator y grows southward), then the same point in the previous frame
    const sy = geom.cssH / 2 - (r + 0.5) * geom.px, my = c1.y + sy * c1.k, syPrev = (my - c0.y) / c0.k;
    const rp = Math.floor((geom.cssH / 2 - syPrev) / geom.px);
    if (rp < 0 || rp >= prev.h) continue;
    for (let x = 0; x < w; x++) {
      const mx = c1.x + ((x + 0.5) * geom.px - geom.cssW / 2) * c1.k, x0 = Math.floor(((mx - c0.x) / c0.k + geom.cssW / 2) / geom.px);
      if (x0 < 0 || x0 >= prev.w) continue;
      ds.push(lut.de(bins[r * w + x], prev.bins[rp * prev.w + x0]));
    }
  }
  if (!ds.length) return { n: 0, mean: null, p99: null, over5: null };
  const sorted = Float32Array.from(ds).sort(), mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  return { n: ds.length, mean, p99: sorted[Math.floor(0.99 * (sorted.length - 1))], over5: ds.filter((d) => d > 5).length / ds.length };
}

/**
 * Share of `ref`'s colour edges (dE00 >= T.edge between a pixel and the pixel 2 to its right or 2 below) that keep at
 * least T.keep of their dE00 in each image of `others` (same size). Hue-only edges (a park on equally light land) count.
 */
function colourEdges(ref, others, lut, thresholds = T) {
  const { w, h, bins } = ref, kept = others.map(() => 0);
  let edges = 0;
  for (let y = 0; y < h - 2; y++) {
    for (let x = 0; x < w - 2; x++) {
      const i = y * w + x;
      for (const j of [i + 2, i + 2 * w]) {
        const e0 = lut.de(bins[i], bins[j]);
        if (e0 < thresholds.edge) continue;
        edges++;
        others.forEach((img, n) => { if (lut.de(img.bins[i], img.bins[j]) >= thresholds.keep * e0) kept[n]++; });
      }
    }
  }
  return { edges, kept: kept.map((k) => (edges ? k / edges : null)) };
}

/**
 * Hue fidelity: per pixel with a true speed >= 3 kn (`speeds`, NaN = unknown), the CIE hue angle of `comp` against the
 * legend colour at that speed (`legend(v)` -> [L, a, b]); scored where both are chromatic (comp C* >= 6, legend >= 10).
 * Returns the median shift (deg) and the share above 30 deg (a colour-category jump: gold -> green is ~45).
 */
function hueFidelity(comp, speeds, legend, lut) {
  const shifts = [];
  for (let i = 0; i < comp.bins.length; i++) {
    const v = speeds[i];
    if (!(v >= 3)) continue;
    const [, a, b] = lut.lab(comp.bins[i]);
    if (Math.hypot(a, b) < 6) continue;
    const [, la, lb] = legend(v);
    if (Math.hypot(la, lb) < 10) continue;
    let d = Math.abs(Math.atan2(b, a) - Math.atan2(lb, la)) / DEG;
    if (d > 180) d = 360 - d;
    shifts.push(d);
  }
  if (!shifts.length) return { n: 0, med: null, over30: null };
  const sorted = Float32Array.from(shifts).sort();
  return { n: shifts.length, med: sorted[sorted.length >> 1], over30: shifts.filter((d) => d > 30).length / shifts.length };
}

/** Samples whose value leaves BOTH neighbours by more than `rel` x the series median (flashes and drop-outs). */
function pops(series, rel = 0.25) {
  const v = series.filter((x) => x != null), med = v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : 0, out = [];
  for (let t = 1; t < series.length - 1; t++) {
    const a = series[t - 1], b = series[t], c = series[t + 1];
    if (a == null || b == null || c == null) continue;
    if (Math.abs(b - a) > rel * med && Math.abs(b - c) > rel * med && Math.sign(b - a) === Math.sign(b - c)) out.push(t);
  }
  return out;
}

module.exports = { labOf, de00, binOf, labTable, binImage, binMask, paletteOf, stylePalette, frameMetrics, coastMetrics, colourEdges, warpDiff, hueFidelity, pops, THRESHOLDS: T };
