/**
 * radarAdvection.js — near-term radar NOWCAST by advecting the last OBSERVED frame (backlog #2).
 *
 * WHY (runbook §6a / §1b coverage cliff): when the radar timeline crosses "now" into forecast, the
 * model (HRRR ~3.27% CONUS coverage) predicts precip over ~1/3 the AREA RainViewer just observed
 * (~9.71%) — the visuals "dissipate" at the boundary. RainViewer's own nowcast array is EMPTY
 * (discontinued Jan 2026), so there is no dense observed→forecast bridge feed. The fix is to
 * EXTRAPOLATE the last observed frames FORWARD along their motion for the near term (≤~30–60 min),
 * then cross-fade into HRRR for longer leads — carrying the observed echo continuously.
 *
 * ⚠️ GRAVEYARD (runbook §6a): a FROZEN-persistence underlay was TRIED and REVERTED — stale echoes
 * held in place read as ghosting. This module is DIFFERENT: the echo MOVES along an estimated
 * motion field (advection), it is NOT frozen. The eventual render integration MUST reuse the
 * existing per-frame-layer architecture (opacity crossfade) — NO moveLayer / source-recreate per
 * step (that churned the style during scrub).
 *
 * THIS FILE = the pure, DOM-free, unit-testable CORE only: estimate the dominant motion between two
 * observed tiles and warp a tile forward. It performs NO fetching, NO canvas, NO protocol work —
 * that is the `advect-rv://` protocol + frame wiring (separate, kill-switched:
 * __RAW_RADAR_ADVECTION_DISABLED__) and is verified on a LIVE CONUS storm. Operating on plain
 * `Uint8ClampedArray` RGBA + width/height keeps this layer testable headless with synthetic frames.
 *
 * Method (the SMALLEST version per §8c, before per-pixel optical flow): a single dominant motion
 * vector via SAD block-match on a downsampled "echo" field (tile ALPHA — RainViewer scheme-7 is
 * transparent where there's no precip), with parabolic sub-pixel refinement, echo/coherence gating,
 * and a plausibility clamp. Bilinear warp advects the latest tile by motion × leadFactor.
 */

export const ADVECTION_DEFAULTS = {
  gridSize: 64,       // downsample the S×S echo field the SAD search runs on (speed; 64 = 4px cells on a 256 tile)
  searchRadius: 12,   // max shift searched, in GRID cells, each direction
  minEchoFrac: 0.002, // need at least this fraction of echo cells in `curr` to trust a motion estimate
  maxMotionCells: 10, // clamp |motion| per observed-interval, in grid cells (reject wild/wrapping matches)
  minConfidence: 0.06,// below this the estimate is noise → treat as zero motion
};

/**
 * Downsample an RGBA tile into an S×S scalar "echo" field in [0,1] by box-averaging the ALPHA
 * channel (RainViewer scheme-7: alpha≈0 where no precip, ≈255 where precip). Pure.
 * @returns {Float32Array} length S*S, row-major.
 */
export function echoField(rgba, width, height, S) {
  const field = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    const y0 = Math.floor((j * height) / S);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * height) / S));
    for (let i = 0; i < S; i++) {
      const x0 = Math.floor((i * width) / S);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * width) / S));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) { sum += rgba[(row + x) * 4 + 3]; n++; }
      }
      field[j * S + i] = n ? sum / (n * 255) : 0;
    }
  }
  return field;
}

/** Fraction of cells with echo above `thresh` (default 0.1). */
export function echoFraction(field, thresh = 0.1) {
  let c = 0;
  for (let k = 0; k < field.length; k++) if (field[k] > thresh) c++;
  return field.length ? c / field.length : 0;
}

// Mean absolute difference between `curr` and `prev` shifted by (sx,sy) grid cells, over the valid
// overlap. curr[i,j] is compared to prev[i-sx, j-sy] (i.e. prev shifted by (sx,sy) should match curr).
function meanAD(prev, curr, S, sx, sy) {
  let sum = 0, n = 0;
  for (let j = 0; j < S; j++) {
    const pj = j - sy;
    if (pj < 0 || pj >= S) continue;
    for (let i = 0; i < S; i++) {
      const pi = i - sx;
      if (pi < 0 || pi >= S) continue;
      sum += Math.abs(curr[j * S + i] - prev[pj * S + pi]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

// Parabolic sub-cell offset from three samples (left, center=min, right): peak of the fitted
// parabola. Returns 0 when the samples are flat/degenerate. Clamped to [-0.5, 0.5].
function subCell(a, b, c) {
  const denom = a - 2 * b + c;
  if (Math.abs(denom) < 1e-9) return 0;
  const off = (0.5 * (a - c)) / denom;
  return off < -0.5 ? -0.5 : off > 0.5 ? 0.5 : off;
}

/**
 * Estimate the dominant motion of the echo from `prev`→`curr` (the two latest OBSERVED tiles).
 * Returns motion in FULL-RESOLUTION tile pixels plus a [0,1] confidence.
 * { dx, dy, confidence } — {0,0,0} when there's too little echo or no coherent match.
 */
export function estimateMotion(prevRgba, currRgba, width, height, opts = {}) {
  const o = { ...ADVECTION_DEFAULTS, ...opts };
  const S = o.gridSize, R = o.searchRadius;
  const prev = echoField(prevRgba, width, height, S);
  const curr = echoField(currRgba, width, height, S);
  const ZERO = { dx: 0, dy: 0, confidence: 0 };

  if (echoFraction(curr) < o.minEchoFrac) return ZERO;

  const adZero = meanAD(prev, curr, S, 0, 0);
  let best = adZero, bsx = 0, bsy = 0;
  for (let sy = -R; sy <= R; sy++) {
    for (let sx = -R; sx <= R; sx++) {
      if (sx === 0 && sy === 0) continue;
      const ad = meanAD(prev, curr, S, sx, sy);
      if (ad < best) { best = ad; bsx = sx; bsy = sy; }
    }
  }

  // No shift beat the zero-shift baseline → the field is static (or pure noise): no motion.
  if (best >= adZero) return { dx: 0, dy: 0, confidence: adZero < 1e-4 ? 1 : 0 };

  // Plausibility clamp: a match at the search edge is usually a wrap/aliasing artifact.
  if (Math.abs(bsx) > o.maxMotionCells || Math.abs(bsy) > o.maxMotionCells) return ZERO;

  // Parabolic sub-cell refinement along each axis around the integer optimum.
  const axSx = subCell(meanAD(prev, curr, S, bsx - 1, bsy), best, meanAD(prev, curr, S, bsx + 1, bsy));
  const axSy = subCell(meanAD(prev, curr, S, bsx, bsy - 1), best, meanAD(prev, curr, S, bsx, bsy + 1));
  const fsx = bsx + axSx, fsy = bsy + axSy;

  // Confidence = how much the best shift beat doing nothing (0..1). A cleanly-advecting storm
  // drives adZero high (blob mismatched) and best→~0; a still/ambiguous field stays near 0.
  const confidence = adZero > 1e-6 ? Math.max(0, Math.min(1, (adZero - best) / adZero)) : 0;
  if (confidence < o.minConfidence) return ZERO;

  const cellW = width / S, cellH = height / S;
  return { dx: fsx * cellW, dy: fsy * cellH, confidence };
}

/**
 * Warp an RGBA tile by (dx,dy) full-resolution pixels via bilinear sampling; out-of-source samples
 * stay transparent. dst(x,y) = src(x-dx, y-dy). Pure — returns a new Uint8ClampedArray.
 */
export function advectTile(rgba, width, height, dx, dy) {
  const out = new Uint8ClampedArray(rgba.length); // zero-filled = transparent everywhere
  if (dx === 0 && dy === 0) { out.set(rgba); return out; }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x - dx, srcY = y - dy;
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) continue; // out → transparent
      const fx = srcX - x0, fy = srcY - y0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i00 = (y0 * width + x0) * 4, i10 = i00 + 4, i01 = i00 + width * 4, i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = rgba[i00 + c] * w00 + rgba[i10 + c] * w10 + rgba[i01 + c] * w01 + rgba[i11 + c] * w11;
      }
    }
  }
  return out;
}

/**
 * NEIGHBOR-AWARE advection warp (2026-07-09) — the fix for the "last-hour vertical rectangle" blanks.
 *
 * `advectTile` warps a tile in ISOLATION: content that should flow in from an adjacent tile is
 * unavailable, so the tile's upwind edge samples out of bounds and goes transparent. Because the whole
 * tiled radar layer advects by the SAME motion vector, those per-tile transparent edges line up into a
 * regular grid of blank bands ("rectangles"), and they GROW with lead — at the 60-min frame leadFactor≈6,
 * so a 40px/interval echo shift becomes a ~240px blank band, nearly a whole 256px tile. Real nowcasters
 * advect the MOSAIC, not the tile. Here we composite the (up to 3) UPWIND neighbor tiles around the
 * center into one 3×3 buffer and sample the warp from THAT, so the incoming edge is filled with the
 * neighbor's real echo instead of transparency. |motion| is clamped below one tile
 * (ADVECTION_DEFAULTS.maxMotionCells × the max leadFactor stays < width), so only IMMEDIATE neighbors
 * are ever sampled; a missing neighbor (grid edge) just leaves that one band transparent, as before.
 *
 * @param {object|Map} tiles keyed 'gx,gy' with gx,gy ∈ {-1,0,1} ('0,0' = center) → RGBA
 *   Uint8ClampedArray (width*height*4) or null/absent. Only the center + upwind cells need be present.
 * @returns {Uint8ClampedArray} the warped center tile (RGBA).
 */
export function advectTileWithNeighbors(tiles, width, height, dx, dy) {
  const get = (k) => (tiles instanceof Map ? tiles.get(k) : tiles && tiles[k]) || null;
  const center = get('0,0');
  const out = new Uint8ClampedArray(width * height * 4); // zero-filled = transparent
  if (!center) return out;
  if (dx === 0 && dy === 0) { out.set(center); return out; }
  // Composite the 3×3 neighborhood into one padded buffer; the center tile lives at offset (width,height).
  const W = width * 3, H = height * 3;
  const mos = new Uint8ClampedArray(W * H * 4);
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      const t = get(`${gx},${gy}`);
      if (!t) continue;
      const ox = (gx + 1) * width, oy = (gy + 1) * height;
      for (let y = 0; y < height; y++) {
        const s = y * width * 4;
        mos.set(t.subarray(s, s + width * 4), ((oy + y) * W + ox) * 4);
      }
    }
  }
  // dst(x,y) = mosaic(x + width - dx, y + height - dy) — the center-tile origin sits at (width,height).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x + width - dx, srcY = y + height - dy;
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue; // out → transparent
      const fx = srcX - x0, fy = srcY - y0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = mos[i00 + c] * w00 + mos[i10 + c] * w10 + mos[i01 + c] * w01 + mos[i11 + c] * w11;
      }
    }
  }
  return out;
}

/**
 * Predict a future tile at `leadFactor` (= leadMinutes / observedIntervalMinutes) from the two
 * latest observed tiles: estimate prev→curr motion, then warp `curr` forward by motion × leadFactor.
 * @returns {{ data: Uint8ClampedArray, dx: number, dy: number, confidence: number }}
 */
export function advectForecast(prevRgba, currRgba, width, height, leadFactor, opts = {}) {
  const { dx, dy, confidence } = estimateMotion(prevRgba, currRgba, width, height, opts);
  const wx = dx * leadFactor, wy = dy * leadFactor;
  return { data: advectTile(currRgba, width, height, wx, wy), dx, dy, confidence };
}

// Half-resolution estimateMotion options for the SMOOTH-FIELD vectors (2026-07-11, the "movement
// is very gridlike" report): every 3×3-neighborhood vector — INCLUDING the center's — is estimated
// with the SAME options so a physical tile always yields the SAME vector regardless of which
// neighborhood samples it; shared tile edges then interpolate identical vector pairs and the field
// is continuous across tile boundaries BY CONSTRUCTION. Half resolution (S=32, cell=8px on a 256
// tile) cuts the O(S²·R²) SAD cost ~16× so the 8 extra neighbor estimates don't jank the main
// thread; sub-cell refinement keeps the precision adequate for a display motion field.
export const SMOOTH_MOTION_OPTS = { gridSize: 32, searchRadius: 8, maxMotionCells: 6 };

/**
 * SMOOTH-FIELD advection warp (2026-07-11) — the fix for "gridlike" motion. The rigid warp gives
 * every pixel of a tile the SAME vector, so adjacent tiles slide as disagreeing blocks and the
 * animation reads as a grid of independently-moving squares. Real nowcasts advect along a smooth
 * motion FIELD. Here each output pixel's vector is bilinearly interpolated from the 3×3
 * neighborhood's per-tile vectors (positioned at tile centers, spacing = one tile), then the pixel
 * samples the 3×3 observed mosaic at its own upstream position. At a shared edge the interpolation
 * weights the same two physical tiles' vectors identically from both sides → no seam.
 *
 * @param {object|Map} tiles   'gx,gy' (gx,gy ∈ {-1,0,1}) → RGBA Uint8ClampedArray or null/absent.
 * @param {object|Map} motions 'gx,gy' → { dx, dy, confidence } per-baseline FULL-RES pixels.
 *   Every PRESENT entry is used VERBATIM — including confidence-0 identity verdicts. Seam
 *   symmetry demands it: two adjacent neighborhoods interpolate the same physical pair of
 *   vectors at their shared edge only if both read the same values, and a per-side "fall back
 *   to my own center" rule re-creates the seam whenever one side is a conf-0 identity
 *   (real-tile proof: z7/100,101 residual seam 14.6 under the fallback rule). Only MISSING
 *   entries (neighbor fetch failed) fall back to the center vector.
 * @returns {Uint8ClampedArray} the warped center tile (RGBA).
 */
export function advectTileSmoothField(tiles, motions, width, height, leadFactor) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m && m[k]) || null;
  const center = get(tiles, '0,0');
  const out = new Uint8ClampedArray(width * height * 4);
  if (!center) return out;
  const cm = get(motions, '0,0') || { dx: 0, dy: 0, confidence: 0 };
  // 3×3 vector grid at tile centers; entries verbatim, missing → center vector.
  const vx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vy = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      const m = get(motions, `${gx},${gy}`);
      vx[gy + 1][gx + 1] = m ? m.dx : cm.dx;
      vy[gy + 1][gx + 1] = m ? m.dy : cm.dy;
    }
  }
  if (leadFactor === 0) { out.set(center); return out; }
  // Composite every provided tile into the 3×3 mosaic (vectors vary per pixel, so inflow can come
  // from any side — unlike the rigid warp's upwind-only need).
  const W = width * 3, H = height * 3;
  const mos = new Uint8ClampedArray(W * H * 4);
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      const t = get(tiles, `${gx},${gy}`);
      if (!t) continue;
      const ox = (gx + 1) * width, oy = (gy + 1) * height;
      for (let y = 0; y < height; y++) {
        const s = y * width * 4;
        mos.set(t.subarray(s, s + width * 4), ((oy + y) * W + ox) * 4);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    // vertical interpolation setup: tile-center coordinate cy ∈ (-0.5, 0.5)
    const cy = (y + 0.5) / height - 0.5;
    const jy = cy < 0 ? 0 : 1;            // rows [jy, jy+1] of the 3×3 vector grid
    const ty = cy < 0 ? cy + 1 : cy;      // weight toward the lower row
    for (let x = 0; x < width; x++) {
      const cx = (x + 0.5) / width - 0.5;
      const jx = cx < 0 ? 0 : 1;
      const tx = cx < 0 ? cx + 1 : cx;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const dx = (vx[jy][jx] * w00 + vx[jy][jx + 1] * w10 + vx[jy + 1][jx] * w01 + vx[jy + 1][jx + 1] * w11) * leadFactor;
      const dy = (vy[jy][jx] * w00 + vy[jy][jx + 1] * w10 + vy[jy + 1][jx] * w01 + vy[jy + 1][jx + 1] * w11) * leadFactor;
      const srcX = x + width - dx, srcY = y + height - dy;
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue; // out → transparent
      const fx = srcX - x0, fy = srcY - y0;
      const s00 = (1 - fx) * (1 - fy), s10 = fx * (1 - fy), s01 = (1 - fx) * fy, s11 = fx * fy;
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = mos[i00 + c] * s00 + mos[i10 + c] * s10 + mos[i01 + c] * s01 + mos[i11 + c] * s11;
      }
    }
  }
  return out;
}
