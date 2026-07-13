// WebGLMarineGeoData.js
// Marine geo-derivation extracted VERBATIM from WebGLMarineTextureEncoder.js for LOC compliance.
// Builds the shelf-distance / bathymetry / chlorophyll / ocean-mask RGBA channels for a grid,
// viewport-cached by cols/rows/bounds + ocean-cell count. Pure derivation — no engine / mask-texture
// coupling. Returns the same { dataBath, dataChl, dataMask, grid } object the encoder consumed inline.

import { getCenterLng, wrapLngRelative, wrapLongitude } from './mapUtils';
import { FloatArrayConstructor } from './WebGLMarineFieldMath';

const _geoCache = new Map();

export function getMarineGeoData(cols, rows, bounds, oceanArr, numGridToProcess, isGlobal, motionOceanArr) {
  const N = cols * rows;

  // Cache key includes the OCEAN-CELL COUNT (2026-07-03): products of identical shape+bounds can
  // carry radically different validity masks — a surf-banded grid (open ocean is_valid:false, ~3%
  // ocean) and the plain grid (~60% ocean) share cols/rows/bounds, so whichever encoded FIRST used
  // to win the cached mask/bathymetry/chlorophyll for every later product of that shape (audit
  // finding, 2026-07-03). The ocean count discriminates the validity profile at zero hash cost.
  // MOTION-UNLOCK (§4.2): rating grids pass motionOceanArr (geographic water incl. masked cells)
  // → dataMask.g carries it. The key gains the motion count so a rating grid can never win the
  // cached mask for its plain sibling (or vice versa); absent (null) keys stay identical to before.
  let _oceanCount = 0;
  for (let i = 0; i < N; i++) _oceanCount += oceanArr[i];
  let _motionCount = -1;
  if (motionOceanArr) {
    _motionCount = 0;
    for (let i = 0; i < N; i++) _motionCount += motionOceanArr[i];
  }
  const cacheKey = `${cols}_${rows}_${bounds ? `${bounds.west.toFixed(3)}_${bounds.south.toFixed(3)}_${bounds.east.toFixed(3)}_${bounds.north.toFixed(3)}` : 'global'}_o${_oceanCount}${motionOceanArr ? `_m${_motionCount}` : ''}`;
  let geoData = _geoCache.get(cacheKey);

  if (!geoData) {
    const grid = new Uint8Array(cols * rows);
    for (let i = 0; i < numGridToProcess; i++) {
      grid[i] = oceanArr[i];
    }

    const dist = new FloatArrayConstructor(cols * rows);
    dist.fill(Infinity);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (grid[idx] === 0) {
          dist[idx] = 0;
        } else {
          let minD = Infinity;
          if (r > 0) minD = Math.min(minD, dist[(r - 1) * cols + c] + 1);
          if (c > 0) minD = Math.min(minD, dist[r * cols + c - 1] + 1);
          dist[idx] = minD;
        }
      }
      if (isGlobal) {
        let minEdge = Math.min(dist[r * cols + 0], dist[r * cols + cols - 1]);
        dist[r * cols + 0] = minEdge;
        dist[r * cols + cols - 1] = minEdge;
      }

      for (let c = 1; c < cols; c++) {
        dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c - 1] + 1);
      }
      for (let c = cols - 2; c >= 0; c--) {
        dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c + 1] + 1);
      }
    }

    for (let r = rows - 1; r >= 0; r--) {
      for (let c = cols - 1; c >= 0; c--) {
        const idx = r * cols + c;
        if (grid[idx] !== 0) {
          let minD = dist[idx];
          if (r < rows - 1) minD = Math.min(minD, dist[(r + 1) * cols + c] + 1);
          if (c < cols - 1) minD = Math.min(minD, dist[r * cols + c + 1] + 1);
          dist[idx] = minD;
        }
      }
      if (isGlobal) {
        let minEdge = Math.min(dist[r * cols + 0], dist[r * cols + cols - 1]);
        dist[r * cols + 0] = minEdge;
        dist[r * cols + cols - 1] = minEdge;
      }

      for (let c = 1; c < cols; c++) {
        dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c - 1] + 1);
      }
      for (let c = cols - 2; c >= 0; c--) {
        dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c + 1] + 1);
      }
    }

    function hash(x, y) {
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return s - Math.floor(s);
    }
    function noise(x, y) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const ux = fx * fx * (3.0 - 2.0 * fx);
      const uy = fy * fy * (3.0 - 2.0 * fy);
      const a = hash(ix, iy);
      const b = hash(ix + 1, iy);
      const c = hash(ix, iy + 1);
      const d = hash(ix + 1, iy + 1);
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    }

    const centerLng = getCenterLng(bounds.west, bounds.east);
    const wrappedWestLng = wrapLngRelative(bounds.west, centerLng);
    const wrappedEastLng = wrapLngRelative(bounds.east, centerLng);
    const lngSpan = wrappedEastLng - wrappedWestLng;

    const dataChl = new Uint8Array(cols * rows * 4);
    const dataBath = new Uint8Array(cols * rows * 4);
    const dataMask = new Uint8Array(cols * rows * 4);

    for (let i = 0; i < numGridToProcess; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lng = wrapLongitude(wrappedWestLng + (col / (cols - 1)) * lngSpan);
      const lat = bounds.south + (row / (rows - 1)) * (bounds.north - bounds.south);

      const maxShelfDist = 8.0;
      const depthFactor = grid[i] === 0 ? 0.0 : Math.min(1.0, dist[i] / maxShelfDist);
      dataBath[i * 4 + 0] = Math.floor(depthFactor * 255);
      dataBath[i * 4 + 1] = Math.floor(depthFactor * 255);
      dataBath[i * 4 + 2] = Math.floor(depthFactor * 255);
      dataBath[i * 4 + 3] = 255;

      const absLat = Math.abs(lat);
      let tropicalChl = 0.0;
      if (absLat < 35.0) {
        tropicalChl = (1.0 - (absLat / 35.0)) * 0.25;
      }
      let temperateChl = 0.0;
      if (absLat > 25.0 && absLat < 65.0) {
        const scale1 = (absLat - 25.0) / 20.0;
        const scale2 = (65.0 - absLat) / 20.0;
        temperateChl = Math.max(0.0, Math.min(scale1, scale2)) * 0.15;
      }
      let coastalChl = 0.0;
      if (grid[i] === 1 && dist[i] <= 3.0) {
        coastalChl = (1.0 - (dist[i] / 3.0)) * 0.35;
      }

      let gulfStreamChl = 0.0;
      if (lng > -85 && lng < -35 && lat > 20 && lat < 50) {
        const x1 = -80, y1 = 25, x2 = -40, y2 = 45;
        const A = lat - y1;
        const B = lng - x1;
        const C = x2 - x1;
        const D = y2 - y1;
        const dotVal = B * C + A * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dotVal / lenSq;
        let xx, yy;
        if (param < 0) {
          xx = x1; yy = y1;
        } else if (param > 1) {
          xx = x2; yy = y2;
        } else {
          xx = x1 + param * C;
          yy = y1 + param * D;
        }
        const dx = lng - xx;
        const dy = lat - yy;
        const streamDist = Math.sqrt(dx * dx + dy * dy);
        if (streamDist < 5.0) {
          const streamNoise = noise(lng * 0.5, lat * 0.5) * 0.15;
          gulfStreamChl = (1.0 - (streamDist / 5.0)) * (0.2 + streamNoise);
        }
      }

      const chlNoiseVal = noise(lng * 0.2, lat * 0.2) * 0.12;
      const rawChl = tropicalChl + temperateChl + coastalChl + gulfStreamChl + chlNoiseVal;
      const chlDensity = Math.max(0.0, Math.min(0.65, rawChl));

      dataChl[i * 4 + 0] = Math.floor(chlDensity * 255);
      dataChl[i * 4 + 1] = Math.floor(chlDensity * 255);
      dataChl[i * 4 + 2] = Math.floor(chlDensity * 255);
      dataChl[i * 4 + 3] = 255;

      const oceanFlag = grid[i] === 1 ? 255 : 0;
      dataMask[i * 4 + 0] = oceanFlag;
      // G = MOTION-water when provided (rating grids); otherwise duplicates the color flag
      // exactly as before. Land is 0 on both channels, so max(r, g*unlock) can never leak land.
      dataMask[i * 4 + 1] = motionOceanArr ? (motionOceanArr[i] === 1 ? 255 : 0) : oceanFlag;
      dataMask[i * 4 + 2] = oceanFlag;
      dataMask[i * 4 + 3] = oceanFlag;
    }

    if (isGlobal) {
      for (let r = 0; r < rows; r++) {
        const idx0 = (r * cols + 0) * 4;
        const idxN = (r * cols + cols - 1) * 4;

        const avgR = Math.floor((dataChl[idx0 + 0] + dataChl[idxN + 0]) * 0.5);
        const avgG = Math.floor((dataChl[idx0 + 1] + dataChl[idxN + 1]) * 0.5);
        const avgB = Math.floor((dataChl[idx0 + 2] + dataChl[idxN + 2]) * 0.5);

        dataChl[idx0 + 0] = dataChl[idxN + 0] = avgR;
        dataChl[idx0 + 1] = dataChl[idxN + 1] = avgG;
        dataChl[idx0 + 2] = dataChl[idxN + 2] = avgB;

        const avgFlag = Math.floor((dataMask[idx0 + 0] + dataMask[idxN + 0]) * 0.5);
        // G averaged separately: it may carry motion-water (rating grids), which must not be
        // stomped by the color flag at the antimeridian wrap. Identical to avgFlag when g==r.
        const avgMotionG = Math.floor((dataMask[idx0 + 1] + dataMask[idxN + 1]) * 0.5);
        dataMask[idx0 + 0] = dataMask[idxN + 0] = avgFlag;
        dataMask[idx0 + 1] = dataMask[idxN + 1] = avgMotionG;
        dataMask[idx0 + 2] = dataMask[idxN + 2] = avgFlag;
        dataMask[idx0 + 3] = dataMask[idxN + 3] = avgFlag;
      }
    }

    geoData = { dataBath, dataChl, dataMask, grid };
    _geoCache.set(cacheKey, geoData);
    // Bound the cache (audit 2026-07-03): keys vary with viewport bounds + ocean count, so panning
    // across many viewports grew it without limit (~150KB/entry regional). FIFO-evict the oldest.
    if (_geoCache.size > 12) {
      _geoCache.delete(_geoCache.keys().next().value);
    }
  }

  return geoData;
}
