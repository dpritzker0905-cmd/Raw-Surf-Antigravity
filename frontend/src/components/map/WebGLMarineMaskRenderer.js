import { getCenterLng, wrapLngRelative } from './mapUtils';

// --- Coordinate Projection and Land Mask Renderer ---

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
  const isRegional = _lonSpanFor(bounds) < 30;
  const width = isRegional ? 2048 : 1024;
  const height = isRegional ? 1024 : 512;
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
