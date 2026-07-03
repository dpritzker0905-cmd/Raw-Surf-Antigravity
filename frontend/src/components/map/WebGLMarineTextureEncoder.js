import { getCenterLng, wrapLngRelative, wrapLongitude } from './mapUtils';
import { renderMaskToCanvas } from './WebGLMarineMaskRenderer';
import {
  createShader,
  createProgram,
  unbindTexture,
  bindTexture,
  safeDeleteTexture
} from './WebGLWindUtils';

export {
  createShader,
  createProgram,
  unbindTexture,
  bindTexture,
  safeDeleteTexture
};

// --- Texture Lifecycle Utilities ---

export function updateTexture(gl, tex, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureUploadCount++;
  }
}

export function createTexture(gl, filter, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureCount++;
    window.__RAW_GPU__.textureUploadCount++;
    window.__RAW_GPU__.gpuMemoryEstimate += width * height * 4;
  }
  return tex;
}

const FloatArrayConstructor = (typeof window !== 'undefined' && window.Float16Array) ? window.Float16Array : Float32Array;

// --- Dynamic GFS Shoreline Extrapolation (In-painting Coastline) ---

// Reusable scratch buffers to avoid TypedArray allocation in hot path
let uReadScratch = null;
let vReadScratch = null;
let hReadScratch = null;
let pReadScratch = null;
let oceanReadScratch = null;

let uArrScratch = null;
let vArrScratch = null;
let hArrScratch = null;
let pArrScratch = null;
let oceanArrScratch = null;
let dataWaveScratch = null;

function getEncoderScratchBuffers(N) {
  if (!uArrScratch || uArrScratch.length < N) {
    uArrScratch = new FloatArrayConstructor(N);
    vArrScratch = new FloatArrayConstructor(N);
    hArrScratch = new FloatArrayConstructor(N);
    pArrScratch = new FloatArrayConstructor(N);
    oceanArrScratch = new Uint8Array(N);
    dataWaveScratch = new Uint8Array(N * 4);
  }
  return {
    uArr: uArrScratch,
    vArr: vArrScratch,
    hArr: hArrScratch,
    pArr: pArrScratch,
    oceanArr: oceanArrScratch,
    dataWave: dataWaveScratch
  };
}

export function extrapolateOceanData(uArr, vArr, hArr, pArr, oceanArr, cols, rows, isGlobal = true) {
  if (cols < 2 || rows < 2) return;
  const N = cols * rows;

  if (!uReadScratch || uReadScratch.length < N) {
    uReadScratch = new FloatArrayConstructor(N);
    vReadScratch = new FloatArrayConstructor(N);
    hReadScratch = new FloatArrayConstructor(N);
    pReadScratch = new FloatArrayConstructor(N);
    oceanReadScratch = new Uint8Array(N);
  }

  const uRead = uReadScratch.subarray(0, N);
  const vRead = vReadScratch.subarray(0, N);
  const hRead = hReadScratch.subarray(0, N);
  const pRead = pReadScratch.subarray(0, N);
  const oceanRead = oceanReadScratch.subarray(0, N);

  for (let pass = 0; pass < 2; pass++) {
    uRead.set(uArr);
    vRead.set(vArr);
    hRead.set(hArr);
    pRead.set(pArr);
    oceanRead.set(oceanArr);
    
    let changes = 0;

    for (let r = 0; r < rows; r++) {
      const rCols = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rCols + c;
        if (oceanRead[idx] !== 0) continue;

        let sumU = 0, sumV = 0, sumHeight = 0, sumPeriod = 0;
        let count = 0;

        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nrCols = nr * cols;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            let nc = c + dc;
            if (isGlobal) {
              if (nc < 0) nc = cols - 1;
              if (nc >= cols) nc = 0;
            } else {
              if (nc < 0 || nc >= cols) continue;
            }

            const nIdx = nrCols + nc;
            if (oceanRead[nIdx] !== 0) {
              sumU += uRead[nIdx];
              sumV += vRead[nIdx];
              sumHeight += hRead[nIdx];
              sumPeriod += pRead[nIdx];
              count++;
            }
          }
        }

        if (count > 0) {
          uArr[idx] = sumU / count;
          vArr[idx] = sumV / count;
          hArr[idx] = sumHeight / count;
          pArr[idx] = sumPeriod / count;
          oceanArr[idx] = 1;
          changes++;
        }
      }
    }

    if (changes === 0) break;

    if (isGlobal) {
      for (let r = 0; r < rows; r++) {
        const idx0 = r * cols + 0;
        const idxN = r * cols + cols - 1;
        
        if (oceanArr[idx0] !== 0 || oceanArr[idxN] !== 0) {
          const avgU = (uArr[idx0] + uArr[idxN]) * 0.5;
          const avgV = (vArr[idx0] + vArr[idxN]) * 0.5;
          const avgHeight = (hArr[idx0] + hArr[idxN]) * 0.5;
          const avgPeriod = (pArr[idx0] + pArr[idxN]) * 0.5;
          
          uArr[idx0] = uArr[idxN] = avgU;
          vArr[idx0] = vArr[idxN] = avgV;
          hArr[idx0] = hArr[idxN] = avgHeight;
          pArr[idx0] = pArr[idxN] = avgPeriod;
          oceanArr[idx0] = oceanArr[idxN] = 1;
        }
      }
    }
  }
}
// --- Direction-only dilation (land-aware seam coherence, 2026-07-03) ---
// The seam fade measures coherence as the bilinear |waveVec|, but the encode loop writes the ZERO
// vector (0.5,0.5) for any texel with no direction — land, is_valid:false, cells the 2-ring
// extrapolateOceanData pass doesn't reach. Bilinear samples collapse in magnitude within a full texel
// of such a cell, so on the 10° coarse grid the coherence floor faded/culled up to a cell-width of
// ocean beside every coastline ("missing patches all over" — HANDOFF-2026-07-03 §0A). This pass fills
// the DIRECTION of the nearest direction-bearing cell into every zero-direction texel. Direction ONLY:
// height, period and the ocean mask are untouched, so nothing new becomes renderable — but the bilinear
// magnitude now collapses only at true divergent-direction seams, making the fade safe to default on.
let dirResolvedScratch = null;
let dirResolvedReadScratch = null;

export function dilateDirectionField(uArr, vArr, cols, rows, isGlobal = true) {
  if (cols < 2 || rows < 2) return 0;
  const N = cols * rows;

  if (!dirResolvedScratch || dirResolvedScratch.length < N) {
    dirResolvedScratch = new Uint8Array(N);
    dirResolvedReadScratch = new Uint8Array(N);
  }
  const resolved = dirResolvedScratch.subarray(0, N);
  const resolvedRead = dirResolvedReadScratch.subarray(0, N);

  // Same zero test the encode loop applies (|u,v| > 0.001): anything it would write as (0.5,0.5)
  // is a fill target; everything else is a BFS source and is never modified.
  let sources = 0;
  for (let i = 0; i < N; i++) {
    const m2 = uArr[i] * uArr[i] + vArr[i] * vArr[i];
    const isSource = m2 > 1e-6 ? 1 : 0;
    resolved[i] = isSource;
    sources += isSource;
  }
  if (sources === 0 || sources === N) return 0;

  // Ring-by-ring relaxation (same structure as extrapolateOceanData, but unbounded passes — every
  // reachable texel must end up direction-bearing). Reads gate on the previous ring's snapshot, so
  // the fill is order-independent within a ring; terminates when a ring fills nothing (≤ max(cols,
  // rows) rings). Filled cells hold UNIT vectors — the encode loop normalizes anyway, and nothing
  // downstream reads uArr/vArr magnitude.
  let filled = 0;
  for (;;) {
    resolvedRead.set(resolved);
    let changes = 0;

    for (let r = 0; r < rows; r++) {
      const rCols = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rCols + c;
        if (resolvedRead[idx] !== 0) continue;

        let sumU = 0, sumV = 0, count = 0;
        let fallbackIdx = -1;

        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nrCols = nr * cols;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            let nc = c + dc;
            if (isGlobal) {
              if (nc < 0) nc = cols - 1;
              if (nc >= cols) nc = 0;
            } else if (nc < 0 || nc >= cols) {
              continue;
            }

            const nIdx = nrCols + nc;
            if (resolvedRead[nIdx] === 0) continue;
            const nu = uArr[nIdx];
            const nv = vArr[nIdx];
            const mag = Math.sqrt(nu * nu + nv * nv);
            if (mag <= 0) continue;
            if (fallbackIdx < 0) fallbackIdx = nIdx;
            // Normalize per neighbor: raw source magnitudes must not weight the direction average.
            sumU += nu / mag;
            sumV += nv / mag;
            count++;
          }
        }

        if (count === 0) continue;
        const sumMag = Math.sqrt(sumU * sumU + sumV * sumV);
        if (sumMag > 1e-3) {
          uArr[idx] = sumU / sumMag;
          vArr[idx] = sumV / sumMag;
        } else {
          // Opposing neighbors self-cancel — the exact failure mode this pass exists to remove.
          // Copy one neighbor's unit direction deterministically instead of writing another zero.
          const fu = uArr[fallbackIdx];
          const fv = vArr[fallbackIdx];
          const fm = Math.sqrt(fu * fu + fv * fv);
          uArr[idx] = fu / fm;
          vArr[idx] = fv / fm;
        }
        resolved[idx] = 1;
        filled++;
        changes++;
      }
    }

    if (changes === 0) break;
  }

  return filled;
}

// --- Land Mask Rendering imported from WebGLMarineMaskRenderer ---
// --- The Ocean GPU Grid Texture Compressor ---

export function encodeMarineTexture(gl, waveGrid, landGeoJSON, engine, opts) {
  // standalone (BLEND BOTH coarse-base capture): create FRESH, independently-owned textures and never touch the
  // engine's resident wave/chl/bath set or its cached land mask. Required because the resident textures are
  // reused/realloc'd in place on every commit — a naive "retain the old coarse textures" would hand back a
  // texture the next regional commit deletes. The caller (engine._captureCoarseBase) owns + frees these.
  const standalone = !!(opts && opts.standalone);
  const { vectors, cols, rows, bounds } = waveGrid;
  if (!vectors?.length || !cols || !rows || cols < 2 || rows < 2) return null;

  const activeLayer = waveGrid.__componentLayer || 'waves';
  const N = cols * rows;

  // Reusable scratch buffers to avoid TypedArray allocation in hot path
  const scratch = getEncoderScratchBuffers(N);
  const uArr = scratch.uArr.subarray(0, N);
  const vArr = scratch.vArr.subarray(0, N);
  const hArr = scratch.hArr.subarray(0, N);
  const pArr = scratch.pArr.subarray(0, N);
  const oceanArr = scratch.oceanArr.subarray(0, N);
  const dataWave = scratch.dataWave.subarray(0, N * 4);

  const numGridToProcess = Math.min(vectors.length, N);
  let flatSpeedNonzeroCount = 0;

  for (let i = 0; i < numGridToProcess; i++) {
    const v = vectors[i];
    if (!v) {
      oceanArr[i] = 0;
      continue;
    }
    const hasSub = activeLayer !== 'waves' && v[activeLayer];
    const sub = hasSub ? v[activeLayer] : {};
    
    let uVal = hasSub && typeof sub.u === 'number' ? sub.u : (typeof v.u === 'number' ? v.u : 0);
    let vVal = hasSub && typeof sub.v === 'number' ? sub.v : (typeof v.v === 'number' ? v.v : 0);
    const speed = hasSub && typeof sub.speed === 'number' ? sub.speed : (typeof v.speed === 'number' ? v.speed : 0);
    const height = hasSub && typeof sub.height === 'number' ? sub.height : (typeof v.height === 'number' ? v.height : (hasSub ? sub.speed || 0 : v.speed || 0));
    const period = hasSub && typeof sub.period === 'number' ? sub.period : (typeof v.period === 'number' ? v.period : 0);
    
    const direction = hasSub && typeof sub.direction === 'number' ? sub.direction : (typeof v.direction === 'number' ? v.direction : undefined);

    // The waves layer reads TOP-LEVEL u/v/direction, but coarse products mirror those from a v.waves
    // sub-record whose is_valid:false does NOT survive the mirror — land cells arrive top-level as
    // {direction: 0, u: 0, v: 0} with no is_valid. Consult the sub-record so land is land (2026-07-03).
    const waveSub = activeLayer === 'waves' && v.waves && typeof v.waves === 'object' ? v.waves : null;

    // Honor the backend's explicit is_valid=false (land / no-data / surf-band open-ocean mask) so those cells
    // render transparent. Only falls through to it when isOcean isn't set, so existing isOcean logic is intact.
    const isOcean = hasSub && sub.isOcean !== undefined ? sub.isOcean
      : (v.isOcean !== undefined ? v.isOcean
         : (v.is_valid === false || (waveSub && waveSub.is_valid === false) ? false : true));

    // Conform direction directly to unit vectors in uArr/vArr if uVal/vVal are zero — OCEAN cells only
    // (2026-07-03): invalid cells carry direction 0 as a PLACEHOLDER, and synthesizing from it stamped a
    // phantom due-south unit vector on every landmass — a coastline-wide fake direction seam against any
    // northish sea (the land-blind fade's second costume, after the zero-vector one). Left at zero here,
    // such cells get a REAL neighbor direction from extrapolateOceanData / dilateDirectionField below.
    if (uVal === 0 && vVal === 0 && direction !== undefined && isOcean) {
      const dirRad = direction * (Math.PI / 180);
      uVal = -Math.sin(dirRad);
      vVal = -Math.cos(dirRad);
    }
    
    uArr[i] = uVal;
    vArr[i] = vVal;
    hArr[i] = height;
    pArr[i] = period;
    oceanArr[i] = isOcean ? 1 : 0;

    if (speed > 0) {
      flatSpeedNonzeroCount++;
    }
  }

  // Clear any remaining elements in scratch buffers
  if (numGridToProcess < N) {
    uArr.fill(0, numGridToProcess, N);
    vArr.fill(0, numGridToProcess, N);
    hArr.fill(0, numGridToProcess, N);
    pArr.fill(0, numGridToProcess, N);
    oceanArr.fill(0, numGridToProcess, N);
  }

  if (!encodeMarineTexture._forensicCount) encodeMarineTexture._forensicCount = 0;
  if (encodeMarineTexture._forensicCount < 3) {
    let minS = Infinity, maxS = 0, sumS = 0, cnt = 0;
    for (let fi = 0; fi < numGridToProcess; fi++) {
      if (oceanArr[fi] !== 0 && hArr[fi] > 0) {
        cnt++;
        if (hArr[fi] < minS) minS = hArr[fi];
        if (hArr[fi] > maxS) maxS = hArr[fi];
        sumS += hArr[fi];
      }
    }
    const meanS = cnt > 0 ? sumS / cnt : 0;
    console.log(`[FORENSIC-ENCODE] encodeMarineTexture input: ${numGridToProcess} vectors, ${cnt} ocean w/speed, speed: min=${minS.toFixed(3)}m max=${maxS.toFixed(3)}m mean=${meanS.toFixed(3)}m (${(meanS*3.281).toFixed(1)}ft), cols=${cols}, rows=${rows}`);
    encodeMarineTexture._forensicCount++;
  }

  const isGlobal = bounds ? !(bounds.east - bounds.west < 359.0) : false;

  extrapolateOceanData(uArr, vArr, hArr, pArr, oceanArr, cols, rows, isGlobal);

  // LAND-AWARE SEAM COHERENCE (2026-07-03): fill DIRECTION into the zero-vector texels the pass above
  // doesn't reach, so the shaders' bilinear-|waveVec| coherence measure stops collapsing beside every
  // coastline (the "missing patches" regression). Direction only — height/period/mask untouched.
  // Kill switch (forensics): window.__RAW_DISABLE_DIR_DILATION__ = true.
  if (typeof window === 'undefined' || window.__RAW_DISABLE_DIR_DILATION__ !== true) {
    const dilatedCount = dilateDirectionField(uArr, vArr, cols, rows, isGlobal);
    if (typeof window !== 'undefined') {
      window.__MARINE_DIR_DILATION__ = { filled: dilatedCount, cols, rows, isGlobal, at: Date.now() };
    }
  }

  // Initialize geo data cache if it doesn't exist
  if (!encodeMarineTexture._geoCache) {
    encodeMarineTexture._geoCache = new Map();
  }

  // Cache key includes the OCEAN-CELL COUNT (2026-07-03): products of identical shape+bounds can
  // carry radically different validity masks — a surf-banded grid (open ocean is_valid:false, ~3%
  // ocean) and the plain grid (~60% ocean) share cols/rows/bounds, so whichever encoded FIRST used
  // to win the cached mask/bathymetry/chlorophyll for every later product of that shape (audit
  // finding, 2026-07-03). The ocean count discriminates the validity profile at zero hash cost.
  let _oceanCount = 0;
  for (let i = 0; i < N; i++) _oceanCount += oceanArr[i];
  const cacheKey = `${cols}_${rows}_${bounds ? `${bounds.west.toFixed(3)}_${bounds.south.toFixed(3)}_${bounds.east.toFixed(3)}_${bounds.north.toFixed(3)}` : 'global'}_o${_oceanCount}`;
  let geoData = encodeMarineTexture._geoCache.get(cacheKey);

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
      dataMask[i * 4 + 1] = oceanFlag;
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
        dataMask[idx0 + 0] = dataMask[idxN + 0] = avgFlag;
        dataMask[idx0 + 1] = dataMask[idxN + 1] = avgFlag;
        dataMask[idx0 + 2] = dataMask[idxN + 2] = avgFlag;
        dataMask[idx0 + 3] = dataMask[idxN + 3] = avgFlag;
      }
    }

    geoData = { dataBath, dataChl, dataMask, grid };
    encodeMarineTexture._geoCache.set(cacheKey, geoData);
    // Bound the cache (audit 2026-07-03): keys vary with viewport bounds + ocean count, so panning
    // across many viewports grew it without limit (~150KB/entry regional). FIFO-evict the oldest.
    if (encodeMarineTexture._geoCache.size > 12) {
      encodeMarineTexture._geoCache.delete(encodeMarineTexture._geoCache.keys().next().value);
    }
  }

  const { dataBath, dataChl, dataMask } = geoData;

  for (let i = 0; i < N; i++) {
    const u = uArr[i];
    const v_y = vArr[i];
    const height = hArr[i];
    const periodVal = pArr[i];

    let nu, nv;
    const mag = Math.sqrt(u * u + v_y * v_y);
    if (mag > 0.001) {
      nu = Math.max(0.0, Math.min(1.0, (u / mag) * 0.5 + 0.5));
      nv = Math.max(0.0, Math.min(1.0, (v_y / mag) * 0.5 + 0.5));
    } else {
      nu = 0.5;
      nv = 0.5;
    }
    const hEnc = Math.max(0.0, Math.min(1.0, height / 10.0));
    const periodEnc = periodVal > 0 ? Math.max(0.0, Math.min(1.0, periodVal / 20.0)) : 0.0;

    dataWave[i * 4 + 0] = Math.floor(nu * 255);
    dataWave[i * 4 + 1] = Math.floor(nv * 255);
    dataWave[i * 4 + 2] = Math.floor(hEnc * 255);
    dataWave[i * 4 + 3] = Math.floor(periodEnc * 255);
  }

  // Compute WebGL texture stats for GFS waves live trace
  if (waveGrid.__sourceModel === 'GFS' && activeLayer === 'waves') {
    let minH = 1.0, maxH = 0.0, sumH = 0.0, nonzeroCount = 0;
    let validOceanCount = 0;
    for (let i = 0; i < cols * rows; i++) {
      const h = dataWave[i * 4 + 2] / 255.0;
      if (h > 0) {
        nonzeroCount++;
        sumH += h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
      if (dataMask[i * 4 + 0] === 255) {
        validOceanCount++;
      }
    }
    const meanH = nonzeroCount > 0 ? sumH / nonzeroCount : 0;
    
    if (typeof window !== 'undefined') {
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__.webglTextureUpload = {
        uploadProductId: waveGrid.productId || null,
        uploadReason: window.__WEBGL_MARINE_UPLOAD_REASON__ || 'unknown',
        activeLayer: activeLayer,
        cols: cols,
        rows: rows,
        vectorCount: vectors.length,
        flatSpeedNonzeroCount: flatSpeedNonzeroCount,
        encodedTextureMin: nonzeroCount > 0 ? minH : 0.0,
        encodedTextureMax: maxH,
        encodedTextureMean: meanH,
        encodedNonzeroPixelCount: nonzeroCount,
        maskValidOceanCount: validOceanCount,
        colorRampName: window.__WEBGL_MARINE_THEME__ || 'default',
        opacity: window.__WEBGL_MARINE_OPACITY__ || 0.65,
        renderDecision: (nonzeroCount > 0 && validOceanCount > 0) ? 'render' : 'skip'
      };
      if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
        window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
      }
    }
  }

  if (isGlobal) {
    for (let r = 0; r < rows; r++) {
      const idx0 = (r * cols + 0) * 4;
      const idxN = (r * cols + cols - 1) * 4;

      const u0 = (dataWave[idx0 + 0] / 255.0) * 2.0 - 1.0;
      const v0 = (dataWave[idx0 + 1] / 255.0) * 2.0 - 1.0;
      const uN = (dataWave[idxN + 0] / 255.0) * 2.0 - 1.0;
      const vN = (dataWave[idxN + 1] / 255.0) * 2.0 - 1.0;

      const avgU = (u0 + uN) * 0.5;
      const avgV = (v0 + vN) * 0.5;
      const mag = Math.sqrt(avgU * avgU + avgV * avgV);

      let nu = 0.5, nv = 0.5;
      if (mag > 0.001) {
        nu = Math.max(0.0, Math.min(1.0, (avgU / mag) * 0.5 + 0.5));
        nv = Math.max(0.0, Math.min(1.0, (avgV / mag) * 0.5 + 0.5));
      }

      const avgH = Math.floor((dataWave[idx0 + 2] + dataWave[idxN + 2]) * 0.5);
      const avgP = Math.floor((dataWave[idx0 + 3] + dataWave[idxN + 3]) * 0.5);

      dataWave[idx0 + 0] = dataWave[idxN + 0] = Math.floor(nu * 255);
      dataWave[idx0 + 1] = dataWave[idxN + 1] = Math.floor(nv * 255);
      dataWave[idx0 + 2] = dataWave[idxN + 2] = avgH;
      dataWave[idx0 + 3] = dataWave[idxN + 3] = avgP;
    }
  }

  const allocatedTextures = [];
  let waveTex, chlTex, bathTex, maskTex;
  try {
    if (!standalone && engine && engine._residentWaveTex && engine._texWidth === cols && engine._texHeight === rows) {
      waveTex = engine._residentWaveTex;
      chlTex = engine._residentChlTex;
      bathTex = engine._residentBathTex;
      updateTexture(gl, waveTex, dataWave, cols, rows);
      updateTexture(gl, chlTex, dataChl, cols, rows);
      updateTexture(gl, bathTex, dataBath, cols, rows);
    } else {
      if (!standalone && engine) {
        if (engine._residentWaveTex) {
          safeDeleteTexture(gl, engine._residentWaveTex, engine);
          safeDeleteTexture(gl, engine._residentChlTex, engine);
          safeDeleteTexture(gl, engine._residentBathTex, engine);
          if (typeof window !== 'undefined' && window.__RAW_GPU__) {
            window.__RAW_GPU__.textureCount -= 3;
            window.__RAW_GPU__.gpuMemoryEstimate -= engine._texWidth * engine._texHeight * 12;
          }
        }
      }
      waveTex = createTexture(gl, gl.LINEAR, dataWave, cols, rows);
      if (waveTex) allocatedTextures.push(waveTex);
      chlTex = createTexture(gl, gl.LINEAR, dataChl, cols, rows);
      if (chlTex) allocatedTextures.push(chlTex);
      bathTex = createTexture(gl, gl.LINEAR, dataBath, cols, rows);
      if (bathTex) allocatedTextures.push(bathTex);
      if (!standalone && engine) {
        engine._residentWaveTex = waveTex;
        engine._residentChlTex = chlTex;
        engine._residentBathTex = bathTex;
        engine._texWidth = cols;
        engine._texHeight = rows;
      }
    }

    if (standalone) {
      // Coarse-base wash needs a HIGH-RES MERCATOR mask, NOT the grid mask. The heatmap shader samples the ocean
      // mask with a mercator-projected mask_v (built for renderMaskToCanvas output); the grid mask is linear in
      // latitude, so sampling it with mask_v reads the wrong row (e.g. lat 28° → ~lat 7°) and masks the wash out
      // entirely. Render a dedicated mercator mask for THIS grid's bounds, owned by the base (never engine-cached).
      if (landGeoJSON) {
        try {
          const maskCanvas = renderMaskToCanvas(landGeoJSON, bounds);
          const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
          const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
          maskTex = gl.createTexture();
          if (maskTex) allocatedTextures.push(maskTex);
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
          gl.bindTexture(gl.TEXTURE_2D, prevTex);
        } catch (e) {
          console.warn('[WebGLMarineTextureEncoder] standalone high-res mask failed, falling back to grid mask:', e && e.message);
          maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
          if (maskTex) allocatedTextures.push(maskTex);
        }
      } else {
        maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
        if (maskTex) allocatedTextures.push(maskTex);
      }
    } else if (landGeoJSON) {
      const boundsChanged = !engine || !engine._cachedMaskBounds ||
        engine._cachedMaskBounds.west !== bounds.west ||
        engine._cachedMaskBounds.south !== bounds.south ||
        engine._cachedMaskBounds.east !== bounds.east ||
        engine._cachedMaskBounds.north !== bounds.north;

      if (engine && engine._cachedMaskTex && landGeoJSON === engine._cachedMaskGeoJSON && !boundsChanged) {
        maskTex = engine._cachedMaskTex;
      } else {
        if (engine && engine._cachedMaskTex) {
          gl.deleteTexture(engine._cachedMaskTex);
          if (typeof window !== 'undefined' && window.__RAW_GPU__) {
            window.__RAW_GPU__.textureCount--;
            const w = 1024;
            const h = 512;
            window.__RAW_GPU__.gpuMemoryEstimate -= w * h * 4;
          }
          engine._cachedMaskTex = null;
        }
        try {
          const maskCanvas = renderMaskToCanvas(landGeoJSON, bounds);
          const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
          const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
          maskTex = gl.createTexture();
          if (maskTex) allocatedTextures.push(maskTex);
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);        
          gl.bindTexture(gl.TEXTURE_2D, prevTex);
          console.log(`[WebGLMarineEngine-Forensic] High-resolution land mask texture created (${maskCanvas.width}x${maskCanvas.height})`);
          
          if (engine) {
            engine._cachedMaskTex = maskTex;
            engine._cachedMaskGeoJSON = landGeoJSON;
            engine._cachedMaskBounds = { ...bounds };
            if (typeof window !== 'undefined' && window.__RAW_GPU__) {
              window.__RAW_GPU__.textureCount++;
              window.__RAW_GPU__.gpuMemoryEstimate += maskCanvas.width * maskCanvas.height * 4;
            }
          }
        } catch (e) {
          console.warn('[WebGLMarineEngine] Failed to create high-res mask texture, falling back to grid-mask', e);
          maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
          if (maskTex) allocatedTextures.push(maskTex);
        }
      }
    } else {
      if (engine && engine._cachedMaskTex) {
        maskTex = engine._cachedMaskTex;
      } else {
        maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
        if (maskTex) allocatedTextures.push(maskTex);
      }
    }
  } catch (err) {
    console.error('[WebGLMarineTextureEncoder] Error during texture upload transaction, rolling back allocations:', err);
    for (const tex of allocatedTextures) {
      try {
        gl.deleteTexture(tex);
      } catch (e) {}
    }
    if (engine && !standalone) {
      engine._residentWaveTex = null;
      engine._residentChlTex = null;
      engine._residentBathTex = null;
      engine._cachedMaskTex = null;
    }
    throw err;
  }

  return {
    u_waveTexture: waveTex,
    u_chlorophyllTexture: chlTex,
    u_bathymetryTexture: bathTex,
    u_oceanMaskTexture: maskTex,
    bounds
  };
}
