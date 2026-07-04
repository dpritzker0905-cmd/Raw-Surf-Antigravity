import { getCenterLng, wrapLngRelative } from './mapUtils';

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
  return (lng, lat) => {
    const projectedLng = wrapLngRelative(lng, center);
    const mx = (projectedLng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  };
}

// ── BASEMAP-WATER TRUTH OVERLAY (2026-07-04, "Gull Park / Pier 15-16 under water") ──────────────
// Natural Earth (any resolution) has NO man-made port landfill, piers, or inner-island detail, so
// an NE-based mask can never keep waves off Port-of-Long-Beach-class terrain. The BASEMAP's own
// vector water polygons are OSM-derived and meter-accurate. Within the (padded) viewport, repaint
// the mask from that truth: land-black everywhere, then ONLY ocean/sea-class water white. Two user
// reports fixed at once: port landfill stops reading "under water" (it isn't in the water polys),
// and ocean waves stop animating up NON-ocean waterways (canals/rivers/marina basins are water but
// not ocean-class, so they stay black for the WAVE mask — the basemap still renders them as water).
// Outside the viewport the NE mask remains (tiles there aren't loaded). Returns true when applied.
export function overlayBasemapWaterOnMask(canvas, bounds, mapInstance) {
  if (!canvas || !mapInstance || typeof mapInstance.querySourceFeatures !== 'function') return false;
  let waterSource = 'composite';
  let waterSourceLayer = 'water';
  try {
    const style = mapInstance.getStyle();
    const baseWater = style?.layers?.find(l => l.id === 'water');
    if (baseWater) {
      if (baseWater.source) waterSource = baseWater.source;
      if (baseWater['source-layer']) waterSourceLayer = baseWater['source-layer'];
    }
  } catch (e) { /* defaults */ }

  // FINEST-TILE TRUTH (2026-07-04, the Lido gap-island): querySourceFeatures returns polygons from
  // EVERY loaded tile LEVEL. An overzoomed PARENT tile's simplified ocean boundary cuts ACROSS
  // gap-islands — land that separates two water polygons (barrier islands: Lido) without being a
  // hole ring in either — so painting it white drowns them, and the hole-reassert pass below has
  // nothing to restore (live texel read at Venice z11.5: Venice hole 0 ✓, Lido 255 ✗ → crest
  // particles visibly ran over Lido). queryRenderedFeatures returns only the tiles actually being
  // RENDERED (the finest loaded), so a parent's wrong boundary never paints once the real tile is
  // in. Falls back to the source query when the render query fails or returns nothing (patch is
  // then parent-vulnerable but never blank; the painter re-runs on map events + wave uploads).
  let feats = null;
  try {
    if (typeof mapInstance.queryRenderedFeatures === 'function') {
      const layerIds = (mapInstance.getStyle()?.layers || [])
        .filter(l => l.type === 'fill' && l.source === waterSource && l['source-layer'] === waterSourceLayer)
        .map(l => l.id);
      if (layerIds.length) feats = mapInstance.queryRenderedFeatures({ layers: layerIds });
    }
  } catch (e) { feats = null; }
  if (!feats || !feats.length) {
    try {
      feats = mapInstance.querySourceFeatures(waterSource, { sourceLayer: waterSourceLayer });
    } catch (e) {
      return false;
    }
  }
  if (!feats || !feats.length) return false;

  // Padded viewport in geographic coords — the truth patch region.
  let vb;
  try {
    const b = mapInstance.getBounds();
    const padX = (b.getEast() - b.getWest()) * 0.15;
    const padY = (b.getNorth() - b.getSouth()) * 0.15;
    vb = { west: b.getWest() - padX, south: b.getSouth() - padY, east: b.getEast() + padX, north: b.getNorth() + padY };
  } catch (e) {
    return false;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const project = makeMaskProjector(bounds, canvas.width, canvas.height);

  // 1. Land-black the viewport patch (clipped to the canvas).
  const [px0, py0] = project(vb.west, vb.north);
  const [px1, py1] = project(vb.east, vb.south);
  const rx = Math.max(0, Math.min(px0, px1)), ry = Math.max(0, Math.min(py0, py1));
  const rw = Math.min(canvas.width, Math.max(px0, px1)) - rx;
  const rh = Math.min(canvas.height, Math.max(py0, py1)) - ry;
  if (rw <= 1 || rh <= 1) return false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(rx, ry, rw, rh);

  // 2. Paint ocean/sea-class water white inside the patch. Features without a class are treated
  //    as ocean (some styles omit class on the open-ocean polygon).
  const forEachPoly = (fn) => {
    for (const f of feats) {
      const cls = f.properties && f.properties.class;
      if (cls !== undefined && cls !== 'ocean' && cls !== 'sea') continue;
      const geom = f.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : null);
      if (!polys) continue;
      for (const poly of polys) fn(poly);
    }
  };
  const tracePoly = (rings) => {
    ctx.beginPath();
    for (const ring of rings) {
      if (!ring || !ring.length) continue;
      ring.forEach((pt, i) => {
        const [x, y] = project(pt[0], pt[1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  };

  ctx.fillStyle = '#ffffff';
  let painted = 0;
  forEachPoly((poly) => { tracePoly(poly); painted++; });

  // 3. RE-ASSERT LAND HOLES (the Venice regression, 2026-07-04): querySourceFeatures returns water
  //    polygons from EVERY loaded tile level — an overzoomed PARENT tile's simplified polygon has
  //    small land islands (Venice, Lido) simplified away, so painting it white erases the fine
  //    tile's correct hole. Second pass: every hole ring (land island) paints BLACK after all the
  //    whites, so the finest-detail land always wins regardless of tile paint order.
  ctx.fillStyle = '#000000';
  forEachPoly((poly) => {
    for (let h = 1; h < poly.length; h++) {
      const ring = poly[h];
      if (!ring || !ring.length) continue;
      ctx.beginPath();
      ring.forEach((pt, i) => {
        const [x, y] = project(pt[0], pt[1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
  });

  // 4. WETLAND/TIDAL-FLAT BLACK-OUT (2026-07-04, Venice lagoon marshes): OSM puts sea-connected
  //    lagoons on the WATER side of the coastline, so the whole lagoon arrives as ocean-class water
  //    and steps 2-3 leave it wave-eligible — but the tiles ALSO ship the marshes (barene) as
  //    WETLAND polygons drawn on top. They are visibly land; crest dashes marching over them was
  //    the live user report. Painted from querySourceFeatures, NOT queryRenderedFeatures: this
  //    app's style has no layer that renders wetlands, so a render query can never see them — and
  //    for painting land BLACK a parent tile's simplified wetland over-covers in the SAFE direction
  //    (a little less wave over marsh-adjacent water, never wave over marsh). Schema-agnostic:
  //    Mapbox Streets ships wetlands in `landuse_overlay` (class wetland/wetland_noveg),
  //    OpenMapTiles in `landcover` (class wetland, subclass incl. tidalflat).
  try {
    ctx.fillStyle = '#000000';
    for (const sl of ['landuse_overlay', 'landcover']) {
      let fs = [];
      try { fs = mapInstance.querySourceFeatures(waterSource, { sourceLayer: sl }) || []; } catch (e) { fs = []; }
      for (const f of fs) {
        const cls = f.properties && f.properties.class;
        const sub = f.properties && f.properties.subclass;
        if (cls !== 'wetland' && cls !== 'wetland_noveg' && sub !== 'wetland' && sub !== 'tidalflat') continue;
        const geom = f.geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : null);
        if (!polys) continue;
        for (const poly of polys) tracePoly(poly);
      }
    }
  } catch (e) { /* wetland truth unavailable — water-only patch stands */ }

  ctx.restore();
  return painted > 0;
}

export function renderMaskToCanvas(geojson, bounds) {
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
  // <10°-span tiles get 4096x2048 (2026-07-04, Long Beach report): at 2048 a ~6° tile is still
  // ~330 m/px — harbor/inlet edges stair-step visibly at z10+ even with the 10m polygons. ~165 m/px
  // halves the blockiness; the larger canvas is only paid on close-zoom regional commits.
  const width = lonSpan < 10 ? 4096 : (isRegional ? 2048 : 1024);
  const height = lonSpan < 10 ? 2048 : (isRegional ? 1024 : 512);
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
  
  const isGlobalTarget = (east - west) >= 359.0;
  
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
  
  return canvas;
}
