// maskSmoothing.js — zoom-transition mask smoothness helpers (2026-07-06).
//
// THE FLICKER (user report: "rapid zoom in/out from both extremes — heatmap flickers on bays,
// usually corrects itself"): every commit that changes grid bounds REBUILDS the ocean mask from
// Natural Earth only — the basemap-water truth patch (bays/lagoons/piers/sheltered verdicts,
// painted at meter accuracy by refreshMaskWithBasemapWater) is dropped, and the re-patch is ASYNC
// (700 ms throttle + tile-readiness gate, which legitimately fails mid-gesture while water tiles
// load). Rapid zoom cycling produces a rebuild per residency swap, so bays repaint as NE-land for
// hundreds of ms each time — the flicker.
//
// PATCH CARRY-FORWARD: transplant the LAST painted truth box into the freshly rebuilt canvas
// SYNCHRONOUSLY. Both canvases use renderMaskToCanvas's projection — affine in Mercator-Y and in
// longitude (for non-antimeridian bounds) — so a geo rect maps to a pixel rect on each canvas and
// drawImage's linear scaling between the two rects is geometrically EXACT. The async repaint still
// follows (fresher, current-view truth); the carry only bridges the gap, so the worst case equals
// today's behavior. Kill switch: window.__RAW_DISABLE_MASK_PATCH_CARRY__ = true.

const MERC_LAT_LIMIT = 85.051129;

function mercY(lat) {
  const l = Math.max(-MERC_LAT_LIMIT, Math.min(MERC_LAT_LIMIT, lat));
  const rad = (l * Math.PI) / 180;
  return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
}

// Pixel rect of a geo box on a canvas rendered for `bounds` (renderMaskToCanvas projection,
// non-antimeridian bounds: X is linear in longitude, Y affine in Mercator-Y).
function boxToCanvasRect(box, bounds, w, h) {
  const x0 = ((box.west - bounds.west) / (bounds.east - bounds.west)) * w;
  const x1 = ((box.east - bounds.west) / (bounds.east - bounds.west)) * w;
  const yTop = mercY(bounds.north);
  const ySpan = mercY(bounds.south) - yTop;
  const y0 = ((mercY(box.north) - yTop) / ySpan) * h;
  const y1 = ((mercY(box.south) - yTop) / ySpan) * h;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Source/dest pixel rects for transplanting `truthBox` from a canvas rendered for `srcBounds`
 * onto one rendered for `dstBounds`, or null when the transplant is unsafe/pointless:
 *  - any box crosses the antimeridian (west >= east) or is degenerate — the linear-X mapping
 *    only holds for plain boxes; fall back to today's behavior;
 *  - the clipped box vanishes (no overlap with either canvas);
 *  - the source rect is sub-2px (nothing real to copy) or the dest rect is sub-8px (a smeared
 *    blob at world tiers helps nobody).
 */
export function computePatchCarryRects(truthBox, srcBounds, srcW, srcH, dstBounds, dstW, dstH) {
  for (const b of [truthBox, srcBounds, dstBounds]) {
    if (!b || !(b.east > b.west) || !(b.north > b.south)) return null;
  }
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return null;
  const clipped = {
    west: Math.max(truthBox.west, srcBounds.west, dstBounds.west),
    east: Math.min(truthBox.east, srcBounds.east, dstBounds.east),
    south: Math.max(truthBox.south, srcBounds.south, dstBounds.south),
    north: Math.min(truthBox.north, srcBounds.north, dstBounds.north),
  };
  if (!(clipped.east > clipped.west) || !(clipped.north > clipped.south)) return null;
  const src = boxToCanvasRect(clipped, srcBounds, srcW, srcH);
  const dst = boxToCanvasRect(clipped, dstBounds, dstW, dstH);
  if (src.w < 2 || src.h < 2 || dst.w < 8 || dst.h < 8) return null;
  return { sx: src.x, sy: src.y, sw: src.w, sh: src.h, dx: dst.x, dy: dst.y, dw: dst.w, dh: dst.h };
}

/**
 * Draw the retained patch's truth box onto a freshly rebuilt mask canvas. `patchState` is the
 * engine's `_lastPatchedMask` ({ canvas, bounds, box }). Returns true when pixels were painted.
 * Never throws — the NE-only canvas stands on any failure.
 */
export function applyPatchCarry(maskCanvas, dstBounds, patchState) {
  try {
    if (!maskCanvas || !dstBounds || !patchState || !patchState.canvas || !patchState.bounds || !patchState.box) {
      return false;
    }
    const rects = computePatchCarryRects(
      patchState.box, patchState.bounds, patchState.canvas.width, patchState.canvas.height,
      dstBounds, maskCanvas.width, maskCanvas.height
    );
    if (!rects) return false;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(
      patchState.canvas,
      rects.sx, rects.sy, rects.sw, rects.sh,
      rects.dx, rects.dy, rects.dw, rects.dh
    );
    return true;
  } catch (e) {
    return false;
  }
}

// ── HIRES-MASK SWAP HYSTERESIS ──────────────────────────────────────────────────────────────────
// The 50m↔10m land-GeoJSON swap re-uploads the whole marine texture set (a `land_mask_res_swap`
// commit). With a single z=8 threshold, rapid zoom cycling across it fires a swap per gesture —
// pure churn (the encoder's last-mile hires substitution already pins REGIONAL masks to the 10m
// cache, so most of these re-encodes change nothing visually). Enter hires at 8, exit below 7.3:
// the band absorbs threshold-straddling gestures.
export const HIRES_MASK_ENTER_ZOOM = 8;
export const HIRES_MASK_EXIT_ZOOM = 7.3;

export function desiredMaskRes(zoom, current, hiresAllowed) {
  if (!hiresAllowed || typeof zoom !== 'number' || Number.isNaN(zoom)) return 'standard';
  if (current === 'hires') return zoom >= HIRES_MASK_EXIT_ZOOM ? 'hires' : 'standard';
  return zoom >= HIRES_MASK_ENTER_ZOOM ? 'hires' : 'standard';
}
