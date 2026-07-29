/**
 * marineMaskProjection.js — where a lon/lat lands on the mask canvas, and how a ring that
 * straddles the antimeridian is kept continuous.
 *
 * Extracted verbatim from WebGLMarineMaskRenderer.js (2026-07-29) with no behavioural change:
 * that file was 1098 lines against the repo's 800-line governance limit, and this is its most
 * self-contained seam — pure geometry over `mapUtils`, depending on nothing else in the mask
 * pipeline.
 *
 * ⚠️ The two comment blocks below are load-bearing forensics, not narration. They record the
 * all-black regional mask (2026-07-03) and the N-Pacific "RECTANGLE" (2026-07-23) — both were
 * blank-heatmap incidents caused by longitude wrapping, and both fixes live in this file.
 * `WebGLMarineMaskRenderer` re-exports every symbol here, so importers are unchanged.
 */
import { getCenterLng, wrapLngRelative, wrapLongitude } from './mapUtils';

// --- Coordinate Projection and Land Mask Renderer ---

// Per-POLYGON bounding box (outer ring only — holes lie within it). Cached on the coordinates
// array. Exported for tests.
export function getPolygonBbox(polyCoords) {
  if (polyCoords.__bbox) return polyCoords.__bbox;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const ring = polyCoords[0] || [];
  for (const pt of ring) {
    if (pt[0] < west) west = pt[0];
    if (pt[0] > east) east = pt[0];
    if (pt[1] < south) south = pt[1];
    if (pt[1] > north) north = pt[1];
  }
  polyCoords.__bbox = { west, east, south, north };
  return polyCoords.__bbox;
}

// True when a polygon's bbox overlaps the (wrapped) target bounds. Exported for tests.
// THE ALL-BLACK REGIONAL MASK ROOT (2026-07-03): the 10m land file has ~10 CONTINENT-scale
// MultiPolygon features, so the FEATURE-level bbox test passes for nearly all of them on any
// regional target. Their far-side member polygons (e.g. Eurasia for a Florida tile) then project
// through wrapLngRelative with lng jumps of ±360° near the anti-center meridian — the filled path
// sweeps across the ENTIRE canvas and paints it black. An all-black ocean mask makes the advect
// shader drop every particle and masks out the regional heatmap: the "crests dead at close zoom
// until any bounds-changing commit" state (live repro + isolated deterministic replica, FL tile:
// 9/10 features drawn → 0% ocean). Culling per member POLYGON keeps only genuinely nearby land.
export function polygonOverlapsTarget(bbox, wrappedWest, wrappedEast, south, north, center) {
  const pad = 1.0;
  if (bbox.south > north + pad || bbox.north < south - pad) return false;
  const pCenter = (bbox.west + bbox.east) * 0.5;
  const projected = wrapLngRelative(pCenter, center);
  const halfSpan = (bbox.east - bbox.west) * 0.5;
  return (projected - halfSpan <= wrappedEast + pad) && (projected + halfSpan >= wrappedWest - pad);
}

// ── ANTIMERIDIAN RING UNWRAP (2026-07-23 — the N-Pacific "RECTANGLE": heatmap AND crests blank) ──
// Both tracers here wrap every vertex INDEPENDENTLY (`wrapLngRelative(lng, center)`), so a ring that
// straddles the projector's ANTI-CENTER meridian (center ± 180) teleports 360° between two
// consecutive vertices and the `ctx.fill()` sweeps the whole canvas black.
//
// Live proof (viewport near ±180 ⇒ overlay bounds −183.6..−116.2, center −149.89 ⇒ seam at +30.1°E,
// straight through Africa/Eurasia): the NE-10m "Land" polygon (bbox −17.5..180 / −34.8..77.7) jumped
// **2732 px on a 512 px canvas** and painted **landFraction 1.0000** — an all-LAND overlay. That
// overlay is applied in REPLACE mode while a world grid is resident, so it overrides the (correct)
// base mask, and "land" suppresses the heatmap AND the crest particles TOGETHER — both read the same
// oceanFlag. GPU read-back at the time: base=255 water, overlay=0 land, effective=0, src=
// overlay_replace, across the entire open Pacific.
//
// This is the same FAMILY as the per-POLYGON cull in drawPolygon, but a cull cannot fix it: this
// polygon LEGITIMATELY reaches the target (Chukotka at +176..180 wraps to −184..−180). The cull is
// right to admit it; it is the TRACE that tears.
//
// Fix: walk each ring accumulating the SHORTEST delta between consecutive vertices, so the ring is
// continuous BY CONSTRUCTION (same live probe: max jump 2732 px → 13 px, landFraction 1.0 → 0.0009,
// with Hawaii still correctly drawn at −158.9/20.9). Then place the continuous ring into the target
// window at every 360° offset whose span actually overlaps — a ring straddling the window edge draws
// twice, which is what the per-vertex wrap was blindly (and destructively) approximating.
// Kill: `window.__RAW_DISABLE_MASK_RING_UNWRAP__ = true` restores the per-vertex wrap.
export function unwrapRingLngs(ring, center) {
  const lngs = new Array(ring.length);
  let prev = null, min = Infinity, max = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const raw = ring[i][0];
    let lng;
    if (prev === null) {
      lng = wrapLngRelative(raw, center);
    } else {
      // shortest step from the PREVIOUS (possibly already-unwrapped) vertex — never ±360
      let d = raw - wrapLongitude(prev);
      let wd = ((d + 180) % 360);
      if (wd < 0) wd += 360;
      wd -= 180;
      lng = prev + wd;
    }
    lngs[i] = lng;
    prev = lng;
    if (lng < min) min = lng;
    if (lng > max) max = lng;
  }
  return { lngs, min, max };
}

// Which 360° copies of a continuous ring [min,max] land inside the target window. Empty = the ring
// genuinely misses the window (a free, CORRECT cull — the span is authoritative once continuous).
// STRICTLY POSITIVE overlap: a copy that only touches the window edge fills zero area, and admitting
// it would make the GLOBAL world mask draw every ring twice (caught by the byte-identity test).
// Capped at 3 so a ring spanning >360° (Antarctica) cannot fan out unboundedly.
export function ringCopyOffsets(min, max, wrappedWest, wrappedEast) {
  if (!isFinite(min) || !isFinite(max)) return [];
  const kLo = Math.floor((wrappedWest - max) / 360) + 1;   // max + 360k >  wrappedWest
  const kHi = Math.ceil((wrappedEast - min) / 360) - 1;    // min + 360k <  wrappedEast
  const out = [];
  for (let k = kLo; k <= kHi && out.length < 3; k++) out.push(k * 360);
  return out;
}

export function maskRingUnwrapEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_RING_UNWRAP__ === true);
}

// Shared canvas projector for the mask renderers: Web-Mercator Y, wrap-relative X, scaled to the
// canvas. Same math renderMaskToCanvas uses internally — exported so the basemap-water overlay
// registers EXACTLY like the base mask.
export function makeMaskProjector(bounds, width, height) {
  const { west, south, east, north } = bounds;
  const latToMercatorY = (l) => {
    const latClamped = Math.max(-85.051129, Math.min(85.051129, l));
    const rad = latClamped * Math.PI / 180;
    return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
  };
  const center = getCenterLng(west, east);
  const wrappedWest = wrapLngRelative(west, center);
  const wrappedEast = wrapLngRelative(east, center);
  const mercMinX = (wrappedWest + 180.0) / 360.0;
  const mercMaxX = (wrappedEast + 180.0) / 360.0;
  const mercMinY = latToMercatorY(north);
  const mercMaxY = latToMercatorY(south);
  const mercXSpan = mercMaxX - mercMinX;
  const mercYSpan = mercMaxY - mercMinY;
  const project = (lng, lat) => {
    const projectedLng = wrapLngRelative(lng, center);
    const mx = (projectedLng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  };
  // RAW variant: the caller has ALREADY placed this longitude on a continuous ring (see
  // unwrapRingLngs) — re-wrapping it here would re-introduce the very 360° tear we just removed.
  project.raw = (lng, lat) => {
    const mx = (lng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  };
  project.center = center;
  project.wrappedWest = wrappedWest;
  project.wrappedEast = wrappedEast;
  return project;
}
