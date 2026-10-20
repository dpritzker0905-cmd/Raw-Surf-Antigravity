import { getCenterLng, wrapLngRelative } from './mapUtils';
// ⚠️ Imported AND re-exported below. `export { x } from './y'` forwards a name without binding it
// in this module's scope, so the re-export block alone leaves every call site here undefined —
// ESLint no-undef caught exactly that on the first pass of this split.
import {
  maskRingUnwrapEnabled, unwrapRingLngs, ringCopyOffsets, polygonOverlapsTarget, getPolygonBbox,
} from './marineMaskProjection';
import { fastLandMaskOn, ringCopiesTouchRect, latRangeOf } from './maskFastPaths';
// The basemap-water painter lives in basemapWaterOverlay.js (2026-10-20); re-exported by name, nothing else changed.
export {
  isBasemapWaterSourceReady, ISLAND_REASSERT_MAX_DENSITY, islandReassertEnabled, reassertNeLand,
  prepareBasemapWaterOverlay, overlayBasemapWaterOnMask,
} from './basemapWaterOverlay';

// ── THE PUBLIC SURFACE IS UNCHANGED ──────────────────────────────────────────────────────────────
// This file was 1098 lines against the repo's 800-line governance limit. Two self-contained seams
// moved out (2026-07-29) — the projection/antimeridian geometry and the sheltered-water
// classifier — and everything they exported is re-exported here BY NAME. Nothing that imports
// this module had to change, and no test had to change, which is what makes the split provably
// behaviour-preserving rather than merely intended to be.
//
// New code should import from the specific module; these re-exports exist so the move cost
// nothing, not to make this the permanent front door.
export {
  getPolygonBbox, polygonOverlapsTarget, unwrapRingLngs, ringCopyOffsets,
  maskRingUnwrapEnabled, makeMaskProjector,
} from './marineMaskProjection';
export {
  classifySheltered, pickBasinVerdict, applyCachedShelteredVerdict, suppressShelteredWater,
} from './marineMaskShelter';




// Mask canvas width tier by the MASK BOUNDS' longitude span (pure; exported for tests).
// <10°-span tiles get 4096x2048 (2026-07-04, Long Beach report): at 2048 a ~6° tile is still
// ~330 m/px — harbor/inlet edges stair-step visibly at z10+ even with the 10m polygons.
// 10-30° (mid clips) keep 2048 (≤0.015°/px — already sub-pixel at those zooms).
// WORLD spans get 4096 too (2026-07-05, "land coastline shows over the heatmap below ~z5.8,
// corrects at z6.1"): while the GLOBAL grid is resident the mask bounds span 360°, so the old
// 1024x512 world tier = ~0.35°/px (~39 km) — the mask edge retreated a grey band (~15-25 px at
// z4.9) from every coastline and islands ballooned into blobs; the same view at mid/fine
// residency uses the finer tiers and adheres, which is why zooming past ~z6 "corrected" it.
// 4096 over 360° = ~0.088°/px (~10 km): the band shrinks to ~4 px at z4.9. Cost: one 32 MB
// texture + a 100-250 ms world polygon paint amortized by the pristine-canvas LRU below.
// Live override for the world tier: window.__RAW_WORLD_MASK_WIDTH__ (1024 restores legacy).
export function maskCanvasWidthForSpan(lonSpan) {
  if (lonSpan < 10) return 4096;
  if (lonSpan < 30) return 2048;
  const ov = typeof window !== 'undefined' ? Number(window.__RAW_WORLD_MASK_WIDTH__) : 0;
  return ov > 0 ? ov : 4096;
}

// MASK DENSITY HELPERS (2026-07-06, the mask no-downgrade retain — pure, exported for tests).
// Density = horizontal px per degree of a mask texture over its own bounds; the retain guard in
// the texture encoder compares the RESIDENT texture's density against what a rebuild for the
// incoming grid bounds WOULD produce (tier table above), so a mid-tier commit (span 10-30° →
// 2048 tier ≈ 870 m/px at span 16) can't replace a crisp coastal mask for the second before the
// fine grid returns — the Florida z9-10.5 "waves over land + intracoastal" transient.
export function maskDensityPxPerDeg(dims, b) {
  if (!dims || !dims.w || !b) return 0;
  const span = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  return span > 0 ? dims.w / span : 0;
}
export function incomingMaskDensityPxPerDeg(bounds) {
  if (!bounds) return 0;
  const span = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
  return span > 0 ? maskCanvasWidthForSpan(span) / span : 0;
}

// Pristine-canvas LRU for renderMaskToCanvas (see comment at its cache-read site).
const _maskCanvasCache = new Map();
let _maskCanvasCacheGeo = null;
const MASK_CANVAS_CACHE_MAX = 3;

export function renderMaskToCanvas(geojson, bounds, opts) {
  // Base resolution 1024x512 avoids massive rendering/memory overhead on high-DPI (Retina) screens;
  // linear filtering (gl.LINEAR) keeps the clipping smooth. REGIONAL grids get 2048x1024 (2026-07-02):
  // on a ~3° coastal tile 1024px is ~340 m/px — too coarse for barrier islands/inlets, which is the
  // residual crest LAND-BLEED the user saw at z9.1 even with the 10m polygons loaded. 2048x1024 on a
  // small tile is ~170 m/px for one extra 8 MB texture — only paid when the tile is regional (<30°),
  // so the global mask keeps the cheap footprint.
  const _lonSpanFor = (b) => {
    if (!b) return 360;
    return (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  };
  const lonSpan = _lonSpanFor(bounds);
  const isRegional = lonSpan < 30;
  let width = maskCanvasWidthForSpan(lonSpan);
  // opts.maxWidth: small viewport OVERLAY canvases cap at 2048 — the 4096 tier costs 4× the paint
  // + texImage2D upload and its extra density is wasted on a ≤1° box (stair-climb choppiness fix).
  if (opts && opts.maxWidth && width > opts.maxWidth) width = opts.maxWidth;
  const height = width / 2;
  // PRISTINE-CANVAS LRU (zoom-in/out choppiness): every commit re-renders this canvas — 100-250 ms
  // of main-thread polygon fill — and cycling zoom bands re-commits the SAME few bounds over and
  // over. A hit returns a fast BLIT COPY (callers mutate their canvas; the cached one stays
  // pristine). Keyed on geojson identity + bounds + size; 3 entries ≈ ≤96 MB worst-case, cleared
  // whenever the land geojson upgrades. Kill: window.__RAW_DISABLE_MASK_CANVAS_CACHE__ = true.
  const cacheOn = typeof window === 'undefined' || window.__RAW_DISABLE_MASK_CANVAS_CACHE__ !== true;
  const cacheKey = (bounds ? `${bounds.west}_${bounds.south}_${bounds.east}_${bounds.north}` : 'global') + `_${width}`;
  if (cacheOn) {
    if (_maskCanvasCacheGeo !== geojson) { _maskCanvasCache.clear(); _maskCanvasCacheGeo = geojson; }
    const hit = _maskCanvasCache.get(cacheKey);
    if (hit) {
      _maskCanvasCache.delete(cacheKey); _maskCanvasCache.set(cacheKey, hit); // LRU touch
      const copy = document.createElement('canvas');
      copy.width = hit.width; copy.height = hit.height;
      copy.getContext('2d', { willReadFrequently: true }).drawImage(hit, 0, 0);
      return copy;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (!geojson?.features?.length) return canvas;
  
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  
  const { west, south, east, north } = bounds;

  // Web Mercator projection helpers
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
  const mercMinY = latToMercatorY(north); // North maps to smaller Mercator Y
  const mercMaxY = latToMercatorY(south); // South maps to larger Mercator Y
  
  const mercXSpan = mercMaxX - mercMinX;
  const mercYSpan = mercMaxY - mercMinY;
  
  function project(lng, lat) {
    const projectedLng = wrapLngRelative(lng, center);
    const mx = (projectedLng + 180.0) / 360.0;
    const my = latToMercatorY(lat);

    // Normalize and scale to canvas dimensions
    const x = ((mx - mercMinX) / mercXSpan) * width;
    const y = ((my - mercMinY) / mercYSpan) * height;
    return [x, y];
  }
  // Continuous-ring variant: the longitude is already placed (unwrapRingLngs) — do NOT re-wrap it.
  function projectRaw(lng, lat) {
    const mx = (lng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  }
  
  const isGlobalTarget = (east - west) >= 359.0;
  // Fast path: polygons whose pixel box (+ AA, the 1 px stroke's miter reach) misses the canvas paint nothing.
  const canvasCull = fastLandMaskOn() ? { x0: 0, y0: 0, x1: width, y1: height } : null;
  
  geojson.features.forEach(feature => {
    const geom = feature.geometry;
    if (!geom) return;

    // 1. Calculate & cache bounding box for this feature
    if (!feature._bbox) {
      let fWest = Infinity, fEast = -Infinity, fSouth = Infinity, fNorth = -Infinity;
      const updateBBox = (pt) => {
        const lng = pt[0];
        const lat = pt[1];
        if (lng < fWest) fWest = lng;
        if (lng > fEast) fEast = lng;
        if (lat < fSouth) fSouth = lat;
        if (lat > fNorth) fNorth = lat;
      };
      if (geom.type === 'Polygon') {
        geom.coordinates.forEach(ring => ring.forEach(updateBBox));
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(updateBBox)));
      }
      feature._bbox = { west: fWest, south: fSouth, east: fEast, north: fNorth };
    }

    // 2. Perform bounding box intersection check
    if (!isGlobalTarget) {
      const fb = feature._bbox;
      const pad = 1.0;
      const fCenter = (fb.west + fb.east) * 0.5;
      const projectedFCenter = wrapLngRelative(fCenter, center);
      const halfSpan = (fb.east - fb.west) * 0.5;
      const fWestWrapped = projectedFCenter - halfSpan;
      const fEastWrapped = projectedFCenter + halfSpan;
      
      const overlapX = (fWestWrapped <= wrappedEast + pad) && (fEastWrapped >= wrappedWest - pad);
      const overlapY = (fb.south <= north + pad) && (fb.north >= south - pad);
      
      if (!overlapX || !overlapY) {
        return; // Skip rendering this feature completely
      }
    }
    
    const drawPolygon = (coords) => {
      // Per-POLYGON cull on regional targets (2026-07-03): the feature-level bbox test above is
      // useless against continent-scale 10m features — a member polygon on the far side of the
      // globe wraps its projected x by ±360° near the anti-center meridian and its fill sweeps the
      // whole canvas black (the dead-crest close-zoom state). Only draw member polygons whose own
      // bbox is actually near the target box.
      if (!isGlobalTarget && !polygonOverlapsTarget(getPolygonBbox(coords), wrappedWest, wrappedEast, south, north, center)) {
        return;
      }
      // ANTIMERIDIAN RING UNWRAP (see unwrapRingLngs): trace each ring CONTINUOUSLY and place it at
      // the 360° offsets that actually overlap the window. Without this, a ring straddling the
      // anti-center meridian (Afro-Eurasia when the viewport sits near ±180) teleports 360° mid-path
      // and floods the whole canvas black — the N-Pacific rectangle.
      if (maskRingUnwrapEnabled()) {
        const rings = [];
        let rMin = Infinity, rMax = -Infinity;
        coords.forEach((ring) => {
          if (!ring || !ring.length) return;
          const u = unwrapRingLngs(ring, center);
          rings.push({ ring, lngs: u.lngs });
          if (u.min < rMin) rMin = u.min;
          if (u.max > rMax) rMax = u.max;
        });
        if (!rings.length) return;
        const offsets = ringCopyOffsets(rMin, rMax, wrappedWest, wrappedEast);
        if (canvasCull && !isGlobalTarget && offsets.length) {   // a world canvas culls nothing: skip the check
          const lr = coords.__latRange || (coords.__latRange = latRangeOf(coords.filter((r) => r && r.length)));   // cached like __bbox
          if (!ringCopiesTouchRect(projectRaw, rMin, rMax, lr[0], lr[1], offsets, canvasCull, 8)) return;
        }
        for (const off of offsets) {
          ctx.beginPath();
          for (const r of rings) {
            for (let i = 0; i < r.ring.length; i++) {
              const [px, py] = projectRaw(r.lngs[i] + off, r.ring[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        return;
      }
      ctx.beginPath();
      coords.forEach((ring) => {
        if (!ring || !ring.length) return;
        ring.forEach((pt, ptIdx) => {
          const [px, py] = project(pt[0], pt[1]);
          if (ptIdx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    if (geom.type === 'Polygon') {
      drawPolygon(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(polyCoords => drawPolygon(polyCoords));
    }
  });

  // Store a PRISTINE copy for the LRU (the returned canvas gets mutated by the basemap/wetland/
  // sheltered painters); a later same-bounds render becomes a ~5-10 ms blit instead of a
  // 100-250 ms polygon fill.
  if (cacheOn) {
    try {
      const keep = document.createElement('canvas');
      keep.width = canvas.width; keep.height = canvas.height;
      keep.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
      _maskCanvasCache.delete(cacheKey);
      _maskCanvasCache.set(cacheKey, keep);
      while (_maskCanvasCache.size > MASK_CANVAS_CACHE_MAX) {
        _maskCanvasCache.delete(_maskCanvasCache.keys().next().value);
      }
    } catch (e) { /* caching is an optimization only */ }
  }

  return canvas;
}
