/**
 * maskFastPaths.js — the land-mask paint, same pixels, less main thread (2026-10-20).
 *
 * MEASURED FIRST. An offline CPU profile of the owner's erratic session (PR #400's stall_profile.js) put 46% of zoom and pan
 * stall time in the land-mask build; `scripts/visual-lab/mask_split.js` split it, and a replay of every real paint captured
 * from the app (dark, light and beach basemaps; zoom 6 to 9.5 over Florida) priced each native call:
 *
 *     closePath() in a multi-ring path      ~10% of a paint   Chrome makes each close O(path length): a water polygon with
 *                                                             hundreds of island holes costs O(n^2). 400 rings x 800 points:
 *                                                             100-125 ms closed vs 8-10 ms open, same fill.
 *     verdict stamp-back (shelter, inland)  ~15-20%           a nearest-neighbour upscale over the WHOLE 4096 x 2048 canvas
 *                                                             (~20 ms each) to change a few sheltered / inland blocks.
 *     open-water plausibility read-back     ~10%              a full-canvas copy plus two viewport-sized getImageData reads
 *                                                             (~18 MB each at zoom 8) to sample ~4,000 points.
 *
 * Each fast path below produces the SAME BYTES as the code it replaces, for a stated reason, and the replay bench checks it
 * paint by paint against origin/dev (identical canvases on every captured paint):
 *   - fill() closes open subpaths itself, and GeoJSON rings are already closed (last point = first point), so a fill-only
 *     trace without closePath() builds the same edges. A trace that is STROKED keeps closePath(): joins vs caps differ.
 *   - a stamp is drawn with source-over, so its transparent texels change nothing; drawing only the rectangle that holds
 *     opaque texels, at the same integer scale and aligned to whole texels, samples the same source texel for every
 *     destination pixel. A non-integer scale falls back to the full draw.
 *   - the plausibility verdict reads only the rows it samples, from the same pixels: the Natural-Earth rows straight from
 *     the pristine canvas before the paint (the full copy was a 1:1 copy of an opaque canvas), the painted rows after it.
 *
 * Kill switch: window.__RAW_DISABLE_FAST_LAND_MASK__ = true restores every replaced call exactly.
 */

export function fastLandMaskOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_FAST_LAND_MASK__ === true);
}

// Draw a downsampled verdict canvas `ds` onto `ctx`'s canvas (W x H) with the caller's smoothing state, as
// ctx.drawImage(ds, 0, 0, W, H) would, but only over the texels flagged in `flags` (dsW x dsH, 1 = opaque in `ds`).
export function stampVerdict(ctx, ds, flags, dsW, dsH, W, H) {
  const fx = W / dsW, fy = H / dsH;
  if (!fastLandMaskOn() || !Number.isInteger(fx) || !Number.isInteger(fy)) { ctx.drawImage(ds, 0, 0, W, H); return; }
  let x0 = dsW, y0 = dsH, x1 = -1, y1 = -1;
  for (let y = 0; y < dsH; y++) {
    const row = y * dsW;
    let first = -1, last = -1;
    for (let x = 0; x < dsW; x++) if (flags[row + x]) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    if (y < y0) y0 = y;
    y1 = y;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
  }
  if (x1 < 0) return;   // nothing opaque: the full draw would change nothing either
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  ctx.drawImage(ds, x0, y0, w, h, x0 * fx, y0 * fy, w * fx, h * fy);
}

// OPEN-WATER PLAUSIBILITY sampling, moved here verbatim from overlayBasemapWaterOnMask (step 6). `readCur(y)` and
// `readNe(y)` return row y (relative to the rect) as RGBA bytes of width sw. Returns { neOpen, falseLand }.
export function sampleOpenWaterDamage(sw, sh, readCur, readNe) {
  const step = Math.max(4, Math.floor(Math.min(sw, sh) / 64));
  const ring = Math.max(4, step);                    // "open" = NE water with clear NE water around it
  let neOpen = 0, falseLand = 0;
  for (let y = ring; y < sh - ring; y += step) {
    const ne = readNe(y), neN = readNe(y - ring), neS = readNe(y + ring);
    let cur = null;
    for (let x = ring; x < sw - ring; x += step) {
      const i = x * 4;
      if (ne[i] < 200) continue;                     // NE land/coast at the sample
      if (neN[i] < 200 || neS[i] < 200 || ne[(x - ring) * 4] < 200 || ne[(x + ring) * 4] < 200) continue; // near an NE coastline
      neOpen++;
      if (!cur) cur = readCur(y);
      if (cur[i] < 30) falseLand++;                  // hard black over NE open water
    }
  }
  return { neOpen, falseLand };
}

// Row readers for sampleOpenWaterDamage. `whole` = one getImageData of the rect (the original read); `rows` = one
// getImageData per sampled row, memoised. Both answer the same bytes for every row the sampler asks for.
export function rectRowReader(ctx, sx, sy, sw, sh, whole) {
  if (whole) {
    const d = ctx.getImageData(sx, sy, sw, sh).data;
    return (y) => d.subarray(y * sw * 4, (y + 1) * sw * 4);
  }
  const memo = new Map();
  return (y) => { let r = memo.get(y); if (!r) { r = ctx.getImageData(sx, sy + y, sw, 1).data; memo.set(y, r); } return r; };
}

// The Natural-Earth rows the sampler will ask for, read from the pristine canvas BEFORE the paint (rows 0, ring, 2*ring...
// relative to the rect: ring === step for every rect, so N/S neighbours are sample rows too). Returns a reader.
export function captureNeRows(ctx, sx, sy, sw, sh) {
  const step = Math.max(4, Math.floor(Math.min(sw, sh) / 64));
  const ring = Math.max(4, step);
  const rows = new Map();
  for (let y = ring; y < sh - ring; y += step) {
    for (const yy of [y - ring, y, y + ring]) if (!rows.has(yy)) rows.set(yy, ctx.getImageData(sx, sy + yy, sw, 1).data);
  }
  return (y) => rows.get(y);
}

// OFF-CLIP CULL. A paint draws thousands of shapes per refresh (one fill per island hole, a fill + dilation stroke per
// wetland polygon from every loaded tile, a fill + stroke per Natural Earth island within a 1-degree pad), and most lie
// outside the pixels that can change (the viewport clip of the water paint, or the canvas itself). A shape whose pixel
// box, grown by `margin` (anti-aliasing + half the stroke width + the miter reach), misses `rect` paints nothing, so
// skipping it is exact. `rawXY(lng, lat)` must be separable and monotone in each axis (both mask projectors are), so
// the projected corners bound every projected vertex. Only called with at least one copy offset: with none, the caller
// draws nothing and must keep its original path state.
export function ringCopiesTouchRect(rawXY, rMin, rMax, latMin, latMax, offsets, rect, margin) {
  if (![rMin, rMax, latMin, latMax].every(Number.isFinite)) return true;   // never cull what cannot be bounded
  const yTop = rawXY(0, latMax)[1], yBottom = rawXY(0, latMin)[1];
  if (yBottom < rect.y0 - margin || yTop > rect.y1 + margin) return false;
  for (const off of offsets) {
    const xLeft = rawXY(rMin + off, 0)[0], xRight = rawXY(rMax + off, 0)[0];
    if (xRight >= rect.x0 - margin && xLeft <= rect.x1 + margin) return true;
  }
  return false;
}

export function latRangeOf(rings) {
  let lo = Infinity, hi = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) { const v = r[i][1]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}
