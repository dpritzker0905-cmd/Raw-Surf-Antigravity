/**
 * WebGLMarineEngine.js
 * Ocean GPU v2 — Fully GPU-native, raster-free marine rendering engine.
 * Renders pulsing, perpendicular wave fronts using gl.drawArrays(gl.LINES)
 * overlayed on a smooth, continuous GPU wave height heatmap.
 * Strictly conforms to WebGL State Isolation Protocol and is < 600 lines of code.
 */

import {
  ADVECT_VS,
  ADVECT_FS,
  DRAW_VS,
  DRAW_FS,
  HEATMAP_VS,
  HEATMAP_FS
} from './WebGLMarineShaders';

// --- Utility Functions ---

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[WebGLMarine] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[WebGLMarine] Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function updateTexture(gl, tex, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureUploadCount++;
  }
}

function createTexture(gl, filter, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  
  // Set flip Y to false to match bottom-to-top South-to-North order
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureCount++;
    window.__RAW_GPU__.textureUploadCount++;
    window.__RAW_GPU__.gpuMemoryEstimate += width * height * 4;
  }
  return tex;
}

function unbindTexture(gl, tex) {
  if (!tex) return;
  var prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
  var maxUnits = Math.min(16, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8);
  for (var u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    if (gl.getParameter(gl.TEXTURE_BINDING_2D) === tex) {
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }
  gl.activeTexture(prevActive);
}

function bindTexture(gl, tex, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

// --- Safe Delete Guard ---
function safeDeleteTexture(gl, tex, engine) {
  if (!tex || !gl) return;
  if (engine) {
    if (tex === engine.particleStateA || tex === engine.particleStateB) {
      console.warn('[WebGLMarineEngine] Safeguarded particle state texture from accidental deletion!');
      return;
    }
  }
  gl.deleteTexture(tex);
}

function extrapolateOceanData(vectors, cols, rows) {
  // Perform 2 passes of coastal wave data extrapolation to cover GFS grid coast dead zones
  for (let pass = 0; pass < 2; pass++) {
    const nextVectors = vectors.map(v => ({ ...v }));
    let changes = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (vectors[idx].isOcean) continue;

        // Collect ocean neighbors
        let sumU = 0, sumV = 0, sumSpeed = 0, sumHeight = 0;
        let sumPeriod = 0, sumSwellHeight = 0;
        let sumSin = 0, sumCos = 0;
        let sumSwellSin = 0, sumSwellCos = 0;
        let count = 0;

        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            let nc = c + dc;
            if (nc < 0) nc = cols - 1;
            if (nc >= cols) nc = 0;

            const nIdx = nr * cols + nc;
            const neighbor = vectors[nIdx];
            if (neighbor.isOcean) {
              sumU += neighbor.u;
              sumV += neighbor.v;
              sumSpeed += neighbor.speed;
              sumHeight += neighbor.height;
              sumPeriod += neighbor.period || 0;
              sumSwellHeight += neighbor.swellHeight || 0;

              const dirRad = (neighbor.direction || 0) * (Math.PI / 180);
              sumSin += Math.sin(dirRad);
              sumCos += Math.cos(dirRad);

              const swellRad = (neighbor.swellDir || 0) * (Math.PI / 180);
              sumSwellSin += Math.sin(swellRad);
              sumSwellCos += Math.cos(swellRad);

              count++;
            }
          }
        }

        if (count > 0) {
          const target = nextVectors[idx];
          target.u = sumU / count;
          target.v = sumV / count;
          target.speed = sumSpeed / count;
          target.height = sumHeight / count;
          target.period = sumPeriod / count;
          target.swellHeight = sumSwellHeight / count;
          
          const avgDir = Math.atan2(sumSin / count, sumCos / count) * (180 / Math.PI);
          target.direction = (avgDir + 360) % 360;

          const avgSwellDir = Math.atan2(sumSwellSin / count, sumSwellCos / count) * (180 / Math.PI);
          target.swellDir = (avgSwellDir + 360) % 360;

          target.isOcean = true;
          changes++;
        }
      }
    }

    if (changes === 0) break;

    // Enforce periodic boundary synchronization on columns 0 and cols-1
    for (let r = 0; r < rows; r++) {
      const idx0 = r * cols + 0;
      const idxN = r * cols + cols - 1;
      
      // If either is ocean, both should be ocean
      if (nextVectors[idx0].isOcean || nextVectors[idxN].isOcean) {
        const avgSpeed = (nextVectors[idx0].speed + nextVectors[idxN].speed) * 0.5;
        const avgHeight = (nextVectors[idx0].height + nextVectors[idxN].height) * 0.5;
        const avgPeriod = ((nextVectors[idx0].period || 0) + (nextVectors[idxN].period || 0)) * 0.5;
        const avgU = (nextVectors[idx0].u + nextVectors[idxN].u) * 0.5;
        const avgV = (nextVectors[idx0].v + nextVectors[idxN].v) * 0.5;
        
        const dir0Rad = (nextVectors[idx0].direction || 0) * (Math.PI / 180);
        const dirNRad = (nextVectors[idxN].direction || 0) * (Math.PI / 180);
        const avgDir = Math.atan2(Math.sin(dir0Rad) + Math.sin(dirNRad), Math.cos(dir0Rad) + Math.cos(dirNRad)) * (180 / Math.PI);

        nextVectors[idx0].speed = nextVectors[idxN].speed = avgSpeed;
        nextVectors[idx0].height = nextVectors[idxN].height = avgHeight;
        nextVectors[idx0].period = nextVectors[idxN].period = avgPeriod;
        nextVectors[idx0].u = nextVectors[idxN].u = avgU;
        nextVectors[idx0].v = nextVectors[idxN].v = avgV;
        nextVectors[idx0].direction = nextVectors[idxN].direction = (avgDir + 360) % 360;
        
        nextVectors[idx0].isOcean = nextVectors[idxN].isOcean = true;
      }
    }

    for (let i = 0; i < vectors.length; i++) {
      vectors[i] = nextVectors[i];
    }
  }
}

function renderMaskToCanvas(geojson, bounds) {
  const dpr = (typeof window !== 'undefined') ? (window.devicePixelRatio || 1) : 1;
  const width = Math.floor(2048 * dpr);
  const height = Math.floor(1024 * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  // 1. Fill entire canvas with white (255 represents ocean)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  if (!geojson?.features?.length) return canvas;
  
  // 2. Draw land polygons as black (0 represents land)
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  
  const { west, south, east, north } = bounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  
  function project(lng, lat) {
    let projectedLng = lng;
    if (west >= -180 && east <= 180) {
      projectedLng = lng;
    } else {
      if (lng < west) projectedLng += 360;
      if (lng > east) projectedLng -= 360;
    }
    const x = ((projectedLng - west) / lngSpan) * width;
    const y = (1.0 - (lat - south) / latSpan) * height;
    return [x, y];
  }
  
  geojson.features.forEach(feature => {
    const geom = feature.geometry;
    if (!geom) return;
    
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

function encodeMarineTexture(gl, waveGrid, landGeoJSON, engine) {
  const { vectors, cols, rows, bounds } = waveGrid;
  if (!vectors?.length || !cols || !rows) return null;

  // Deep copy vectors for safe shoreline in-painting (extrapolation)
  const extVectors = vectors.map(v => ({ ...v }));
  extrapolateOceanData(extVectors, cols, rows);

  // Allocate arrays for the four textures
  const dataWave = new Uint8Array(cols * rows * 4);
  const dataChl = new Uint8Array(cols * rows * 4);
  const dataBath = new Uint8Array(cols * rows * 4);
  const dataMask = new Uint8Array(cols * rows * 4);

  // We calculate distance-to-land for a robust bathymetry shelf structure (using original vectors).
  const grid = new Uint8Array(cols * rows);
  for (let i = 0; i < vectors.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const gfsIdx = row * cols + col;
    const v = vectors[gfsIdx];
    const lat = bounds.south + (row / (rows - 1)) * (bounds.north - bounds.south);
    // Keep precise land mask by respecting v.isOcean if defined
    const isLand = v.isOcean === false || v.isOcean === 0;
    const isOcean = !isLand && (v.isOcean === true || v.isOcean === 1 || v.speed > 0.001 || v.u !== 0 || v.v !== 0);
    grid[i] = isOcean ? 1 : 0;
  }

  // Multi-pass distance transform in Javascript
  const dist = new Float32Array(cols * rows);
  dist.fill(Infinity);
  
  // Pass 1: Top-left to bottom-right (with horizontal wrapping & settlement)
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
    // Enforce horizontal wrapping for column 0 and cols-1
    let minEdge = Math.min(dist[r * cols + 0], dist[r * cols + cols - 1]);
    dist[r * cols + 0] = minEdge;
    dist[r * cols + cols - 1] = minEdge;

    // Propagate horizontal wrapped value forward and backward along the row
    for (let c = 1; c < cols; c++) {
      dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c - 1] + 1);
    }
    for (let c = cols - 2; c >= 0; c--) {
      dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c + 1] + 1);
    }
  }

  // Pass 2: Bottom-right to top-left (with horizontal wrapping & settlement)
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
    // Enforce horizontal wrapping for column 0 and cols-1
    let minEdge = Math.min(dist[r * cols + 0], dist[r * cols + cols - 1]);
    dist[r * cols + 0] = minEdge;
    dist[r * cols + cols - 1] = minEdge;

    // Propagate horizontal wrapped value forward and backward along the row
    for (let c = 1; c < cols; c++) {
      dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c - 1] + 1);
    }
    for (let c = cols - 2; c >= 0; c--) {
      dist[r * cols + c] = Math.min(dist[r * cols + c], dist[r * cols + c + 1] + 1);
    }
  }

  // Procedural noise for organic chlorophyll patterns inside JS
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

  for (let i = 0; i < extVectors.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const gfsIdx = row * cols + col;
    const v = extVectors[gfsIdx];

    const lng = bounds.west + (col / (cols - 1)) * (bounds.east - bounds.west);
    const lat = bounds.south + (row / (rows - 1)) * (bounds.north - bounds.south);

    // Keep raw speed and directions exactly as returned by the API to prevent artificial seams.
    let speed = v.speed;
    let u = v.u;
    let v_y = v.v;

    // 1. Wave texture (RG = u/v vector, B = normalized wave height, A = normalized wave period)
    const nu = Math.max(0.0, Math.min(1.0, (u / 10.0) * 0.5 + 0.5));
    const nv = Math.max(0.0, Math.min(1.0, (v_y / 10.0) * 0.5 + 0.5));
    const height = Math.min(1.0, speed / 10.0);
    const periodVal = v.period ? Math.min(1.0, v.period / 20.0) : 0.0;

    dataWave[i * 4 + 0] = Math.floor(nu * 255);
    dataWave[i * 4 + 1] = Math.floor(nv * 255);
    dataWave[i * 4 + 2] = Math.floor(height * 255);
    dataWave[i * 4 + 3] = Math.floor(periodVal * 255);

    // 2. Bathymetry depth factor (0.0 = coastline, 1.0 = deep ocean)
    const maxShelfDist = 8.0;
    const depthFactor = grid[i] === 0 ? 0.0 : Math.min(1.0, dist[i] / maxShelfDist);
    dataBath[i * 4 + 0] = Math.floor(depthFactor * 255);
    dataBath[i * 4 + 1] = Math.floor(depthFactor * 255);
    dataBath[i * 4 + 2] = Math.floor(depthFactor * 255);
    dataBath[i * 4 + 3] = 255;

    // 3. Chlorophyll density mapping
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

    // Gulf Stream streaking
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

    // 4. Land/ocean binary mask (using original vectors to keep land mask strictly at the shoreline!)
    const origV = vectors[gfsIdx];
    const isLand = origV.isOcean === false || origV.isOcean === 0;
    const isOcean = !isLand && (origV.isOcean === true || origV.isOcean === 1 || origV.speed > 0.001 || origV.u !== 0 || origV.v !== 0);
    const oceanFlag = isOcean ? 255 : 0;
    dataMask[i * 4 + 0] = oceanFlag;
    dataMask[i * 4 + 1] = oceanFlag;
    dataMask[i * 4 + 2] = oceanFlag;
    dataMask[i * 4 + 3] = oceanFlag;
  }

  // Synchronize chlorophyll boundary columns 0 and cols-1
  for (let r = 0; r < rows; r++) {
    const idx0 = (r * cols + 0) * 4;
    const idxN = (r * cols + cols - 1) * 4;
    
    const avgR = Math.floor((dataChl[idx0 + 0] + dataChl[idxN + 0]) * 0.5);
    const avgG = Math.floor((dataChl[idx0 + 1] + dataChl[idxN + 1]) * 0.5);
    const avgB = Math.floor((dataChl[idx0 + 2] + dataChl[idxN + 2]) * 0.5);
    
    dataChl[idx0 + 0] = dataChl[idxN + 0] = avgR;
    dataChl[idx0 + 1] = dataChl[idxN + 1] = avgG;
    dataChl[idx0 + 2] = dataChl[idxN + 2] = avgB;
  }

  // Synchronize land/ocean mask boundary columns 0 and cols-1
  for (let r = 0; r < rows; r++) {
    const idx0 = (r * cols + 0) * 4;
    const idxN = (r * cols + cols - 1) * 4;
    
    const avgFlag = Math.floor((dataMask[idx0 + 0] + dataMask[idxN + 0]) * 0.5);
    dataMask[idx0 + 0] = dataMask[idxN + 0] = avgFlag;
    dataMask[idx0 + 1] = dataMask[idxN + 1] = avgFlag;
    dataMask[idx0 + 2] = dataMask[idxN + 2] = avgFlag;
    dataMask[idx0 + 3] = dataMask[idxN + 3] = avgFlag;
  }

  // Create or reuse three linear-filtered textures
  let waveTex, chlTex, bathTex;
  if (engine && engine._residentWaveTex && engine._texWidth === cols && engine._texHeight === rows) {
    waveTex = engine._residentWaveTex;
    chlTex = engine._residentChlTex;
    bathTex = engine._residentBathTex;
    updateTexture(gl, waveTex, dataWave, cols, rows);
    updateTexture(gl, chlTex, dataChl, cols, rows);
    updateTexture(gl, bathTex, dataBath, cols, rows);
  } else {
    if (engine) {
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
    chlTex = createTexture(gl, gl.LINEAR, dataChl, cols, rows);
    bathTex = createTexture(gl, gl.LINEAR, dataBath, cols, rows);
    if (engine) {
      engine._residentWaveTex = waveTex;
      engine._residentChlTex = chlTex;
      engine._residentBathTex = bathTex;
      engine._texWidth = cols;
      engine._texHeight = rows;
    }
  }

  let maskTex;
  if (landGeoJSON) {
    if (engine && engine._cachedMaskTex && landGeoJSON === engine._cachedMaskGeoJSON) {
      maskTex = engine._cachedMaskTex;
    } else {
      try {
        const maskCanvas = renderMaskToCanvas(landGeoJSON, bounds);
        const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
        maskTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Flip Y during canvas upload to map North to top (v=1) and South to bottom (v=0)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Restore to default false
        
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        console.log(`[WebGLMarineEngine-Forensic] High-resolution land mask texture created (${maskCanvas.width}x${maskCanvas.height})`);
        
        if (engine) {
          engine._cachedMaskTex = maskTex;
          engine._cachedMaskGeoJSON = landGeoJSON;
          if (typeof window !== 'undefined' && window.__RAW_GPU__) {
            window.__RAW_GPU__.textureCount++;
            window.__RAW_GPU__.gpuMemoryEstimate += maskCanvas.width * maskCanvas.height * 4;
          }
        }
      } catch (e) {
        console.warn('[WebGLMarineEngine] Failed to create high-res mask texture, falling back to grid-mask', e);
        maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
      }
    }
  } else {
    if (engine && engine._cachedMaskTex) {
      maskTex = engine._cachedMaskTex;
    } else {
      maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
    }
  }

  return {
    u_waveTexture: waveTex,
    u_chlorophyllTexture: chlTex,
    u_bathymetryTexture: bathTex,
    u_oceanMaskTexture: maskTex,
    bounds
  };
}

function initParticleTexture(gl, resolution) {
  const numParticles = resolution * resolution;
  const data = new Uint8Array(numParticles * 4);
  for (let i = 0; i < numParticles; i++) {
    const x = Math.random();
    const y = Math.random();
    const xHi = Math.floor(x * 255);
    const xLo = Math.floor(((x * 255) - xHi) * 255);
    const yHi = Math.floor(y * 255);
    const yLo = Math.floor(((y * 255) - yHi) * 255);
    data[i * 4 + 0] = xHi;
    data[i * 4 + 1] = xLo;
    data[i * 4 + 2] = yHi;
    data[i * 4 + 3] = yLo;
  }
  return createTexture(gl, gl.NEAREST, data, resolution, resolution);
}

// --- Engine Definition ---

function WebGLMarineEngine() {
  this.particleRes = 296;       // 296² = 87,616 crests
  this.speedFactor = 0.05;      // drift speed scale
  this.dropRate = 0.003;        // particle drop rate
  this._initialized = false;
  this._waveData = null;
  this._startTime = Date.now();

  if (typeof window !== 'undefined') {
    window.__MARINE_ENGINE__ = this;
  }

  if (typeof window !== 'undefined' && !window.__RAW_GPU__) {
    window.__RAW_GPU__ = {
      textureCount: 0,
      textureUploadCount: 0,
      framebufferCount: 0,
      activeRafCount: 1,
      drawCallsPerFrame: 0,
      gpuMemoryEstimate: 0,
      shaderCompileCount: 6, // 6 shaders compiled at start
      frameTimeHistogram: [0, 0, 0, 0, 0], // <8ms, 8-16ms, 16-32ms, 32-64ms, >64ms
      droppedFrameCounter: 0,
      reactRerenderCounter: 0
    };
  }
}

WebGLMarineEngine.prototype.init = function(gl) {
  if (this._initialized) return;

  var advVS = createShader(gl, gl.VERTEX_SHADER, ADVECT_VS);
  var advFS = createShader(gl, gl.FRAGMENT_SHADER, ADVECT_FS);
  var drawVS = createShader(gl, gl.VERTEX_SHADER, DRAW_VS);
  var drawFS = createShader(gl, gl.FRAGMENT_SHADER, DRAW_FS);
  var heatVS = createShader(gl, gl.VERTEX_SHADER, HEATMAP_VS);
  var heatFS = createShader(gl, gl.FRAGMENT_SHADER, HEATMAP_FS);

  if (!advVS || !advFS || !drawVS || !drawFS || !heatVS || !heatFS) {
    console.error('[WebGLMarine] Failed to compile shaders');
    return;
  }

  this.advectProgram = createProgram(gl, advVS, advFS);
  this.drawProgram = createProgram(gl, drawVS, drawFS);
  this.heatmapProgram = createProgram(gl, heatVS, heatFS);

  this.quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const numParticles = this.particleRes * this.particleRes;
  const vertexIds = new Float32Array(numParticles * 2);
  for (let i = 0; i < vertexIds.length; i++) {
    vertexIds[i] = i;
  }
  this.vertexIdBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexIds, gl.STATIC_DRAW);

  const W = 96;
  const H = 96;
  const gridUVs = new Float32Array(W * H * 2);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const idx = (r * W + c) * 2;
      gridUVs[idx + 0] = c / (W - 1);
      gridUVs[idx + 1] = r / (H - 1);
    }
  }
  this.gridUVBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, gridUVs, gl.STATIC_DRAW);

  const gridIndices = new Uint16Array((W - 1) * (H - 1) * 6);
  let iIdx = 0;
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const i0 = r * W + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * W + c;
      const i3 = i2 + 1;
      gridIndices[iIdx++] = i0;
      gridIndices[iIdx++] = i1;
      gridIndices[iIdx++] = i2;
      gridIndices[iIdx++] = i1;
      gridIndices[iIdx++] = i3;
      gridIndices[iIdx++] = i2;
    }
  }
  this.gridIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);
  this.numGridIndices = gridIndices.length;

  this.particleStateA = initParticleTexture(gl, this.particleRes);
  this.particleStateB = initParticleTexture(gl, this.particleRes);

  this.advFBO = gl.createFramebuffer();
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.framebufferCount++;
  }
  this._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests + 96x96 grid');
};

WebGLMarineEngine.prototype.isHighResMaskLoaded = function() {
  return !!this._cachedMaskGeoJSON;
};

WebGLMarineEngine.prototype.setWaveData = function(gl, waveGrid, landGeoJSON) {
  if (!waveGrid?.vectors?.length) return;
  
  if (landGeoJSON) {
    this._landGeoJSON = landGeoJSON;
  }
  const activeGeoJSON = landGeoJSON || this._landGeoJSON;
  console.log(`[WebGLMarineEngine-Forensic] setWaveData: ${waveGrid.vectors.length} vectors, landGeoJSON present: ${!!activeGeoJSON}`);

  if (this._waveData) {
    if (this._waveData.u_waveTexture && this._waveData.u_waveTexture !== this._residentWaveTex) {
      safeDeleteTexture(gl, this._waveData.u_waveTexture, this);
    }
    if (this._waveData.u_chlorophyllTexture && this._waveData.u_chlorophyllTexture !== this._residentChlTex) {
      safeDeleteTexture(gl, this._waveData.u_chlorophyllTexture, this);
    }
    if (this._waveData.u_bathymetryTexture && this._waveData.u_bathymetryTexture !== this._residentBathTex) {
      safeDeleteTexture(gl, this._waveData.u_bathymetryTexture, this);
    }
    
    if (this._waveData.u_oceanMaskTexture && this._waveData.u_oceanMaskTexture === this._cachedMaskTex) {
      // Keep it
    } else {
      if (this._waveData.u_oceanMaskTexture) safeDeleteTexture(gl, this._waveData.u_oceanMaskTexture, this);
    }
  }
  
  console.log('[WebGLMarineEngine] setWaveData input:', {vectors: waveGrid.vectors.length, cols: waveGrid.cols, rows: waveGrid.rows, hasBounds: !!waveGrid.bounds, hasGeoJSON: !!activeGeoJSON});
  this._waveData = encodeMarineTexture(gl, waveGrid, activeGeoJSON, this);
  console.log('[WebGLMarineEngine] setWaveData result:', {hasData: !!this._waveData, hasWaveTexture: !!this._waveData?.u_waveTexture});
};

WebGLMarineEngine.prototype.renderHeatmapAndParticles = function(gl, matrix, screenWidth, screenHeight, zoom, theme) {
  const renderStart = (typeof window !== 'undefined' && window.__RAW_GPU__) ? performance.now() : 0;
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.drawCallsPerFrame = 0;
    window.__RAW_GPU__.particlePassExecuted = false;
  }
  if (!this._initialized || !this._waveData || !matrix || !matrix.length) {
    if (this._renderLogged === undefined) {
      this._renderLogged = 0;
    }
    this._renderLogged++;
    if (this._renderLogged === 1 || this._renderLogged % 180 === 0) {
      console.log("[WebGLMarineEngine] render returned early! _initialized:", this._initialized, "_waveData:", !!this._waveData, "matrix:", !!matrix);
    }
    return;
  }

  var themeVal = 0.0;
  if (typeof window !== 'undefined' && window.__DIAGNOSTIC_THEME__ !== undefined) {
    themeVal = window.__DIAGNOSTIC_THEME__;
  } else if (theme === 'light') {
    themeVal = 1.0;
  } else if (theme === 'beach') {
    themeVal = 2.0;
  }

  // WebGL State Isolation Protocol
  var prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  var prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  var prevBlend = gl.getParameter(gl.BLEND);
  var prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  var prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  var prevElementArrayBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  var prevViewport = gl.getParameter(gl.VIEWPORT);

  var prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
  var prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
  var prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
  var prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);

  var prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
  var prevDepthWriteMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  var prevStencilTest = gl.getParameter(gl.STENCIL_TEST);
  var prevScissorTest = gl.getParameter(gl.SCISSOR_TEST);
  var prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK);

  var prevCullFace = gl.getParameter(gl.CULL_FACE);
  gl.disable(gl.CULL_FACE);

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);

  while (gl.getError() !== gl.NO_ERROR) {}

  var prevAttribsEnabled = [];
  var maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 16;
  for (var i = 0; i < maxAttribs; i++) {
    try {
      var enabled = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
      prevAttribsEnabled.push(enabled);
      if (enabled) {
        gl.disableVertexAttribArray(i);
      }
    } catch (e) {
      prevAttribsEnabled.push(false);
    }
  }

  var prevTextures2D = [];
  var prevTexturesCube = [];
  var maxUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8;
  for (var u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    prevTextures2D.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
    gl.bindTexture(gl.TEXTURE_2D, null);
    try {
      prevTexturesCube.push(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP));
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    } catch (e) {
      prevTexturesCube.push(null);
    }
  }

  var prevVAO = null;
  var isWebGL2 = false;
  if (gl.bindVertexArray) {
    isWebGL2 = true;
    prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(null);
  }

  var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  var time = (Date.now() - this._startTime) / 1000.0;
  const waveBounds = this._waveData.bounds;
  const z = typeof zoom === 'number' ? zoom : 6;

  // ==========================================
  // PHASE 1: GPU HEATMAP BASE LAYER (Upgraded Multi-Texture)
  // Skip rendering the heatmap base layer until the high-resolution land mask is loaded
  // to prevent the transient bleed/glitch where the heatmap covers the continents.
  // ==========================================
  if (this._cachedMaskGeoJSON) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.heatmapProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);

    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_waveTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_chlorophyllTexture'), 1);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_bathymetryTexture'), 2);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_oceanMaskTexture'), 3);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);

    if (typeof window !== 'undefined' && !window.__GPU_DEBUG__) {
      window.__GPU_DEBUG__ = { mode: null };
    }
    let debugModeVal = 0.0;
    if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
      const mode = window.__GPU_DEBUG__.mode;
      if (mode === 'uv') debugModeVal = 1.0;
      else if (mode === 'mask') debugModeVal = 2.0;
      else if (mode === 'grid') debugModeVal = 3.0;
      else if (mode === 'mercator') debugModeVal = 4.0;
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_debug_mode'), debugModeVal);

    var heatmapOpacity;
    if (z <= 2) heatmapOpacity = 0.45;
    else if (z <= 5) heatmapOpacity = 0.45 + (z - 2) / 3 * 0.10;
    else if (z <= 8) heatmapOpacity = 0.55 + (z - 5) / 3 * 0.10;
    else if (z <= 12) heatmapOpacity = 0.65 + (z - 8) / 4 * 0.05;
    else heatmapOpacity = 0.70;
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);

    bindTexture(gl, this._waveData.u_waveTexture, 0);
    bindTexture(gl, this._waveData.u_chlorophyllTexture, 1);
    bindTexture(gl, this._waveData.u_bathymetryTexture, 2);
    bindTexture(gl, this._waveData.u_oceanMaskTexture, 3);

    var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
    var heatLngOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
    gl.enableVertexAttribArray(heatUVLoc);
    gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);

    var worldOffsets = [0.0, -360.0, 360.0];
    for (var wi = 0; wi < worldOffsets.length; wi++) {
      gl.uniform1f(heatLngOffsetLoc, worldOffsets[wi]);
      gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.drawCallsPerFrame++;
      }
    }
    gl.disableVertexAttribArray(heatUVLoc);
  }

  // ==========================================
  // PHASE 2: WAVE CREST RENDERER
  // ==========================================
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(this.drawProgram);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_waveTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_oceanMaskTexture'), 2);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_theme'), themeVal);

  let drawDebugModeVal = 0.0;
  if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
    const mode = window.__GPU_DEBUG__.mode;
    if (mode === 'part_uv') drawDebugModeVal = 5.0;
    else if (mode === 'part_pos') drawDebugModeVal = 6.0;
    else if (mode === 'part_offset') drawDebugModeVal = 7.0;
    else if (mode === 'part_fbo') drawDebugModeVal = 8.0;
  }
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_debug_mode'), drawDebugModeVal);

  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);

  const dashLengthScale = 5.0;
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dash_length_scale'), dashLengthScale);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.u_waveTexture, 1);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

  var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
  var mercOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_merc_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.enableVertexAttribArray(idLoc);
  gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);

  var worldOffsets = [0.0, -1.0, 1.0];
  for (var wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(mercOffsetLoc, worldOffsets[wi]);
    gl.drawArrays(gl.LINES, 0, this.particleRes * this.particleRes * 2);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.drawCallsPerFrame++;
    }
  }
  gl.disableVertexAttribArray(idLoc);

  // ==========================================
  // PHASE 3: PARTICLE ADVECTION SYSTEM (Simulate next state)
  // ==========================================
  const stableSpeedScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6)) * 1.5e-5;

  gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_waveTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_oceanMaskTexture'), 2);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), stableSpeedScale);

  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);

  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);

  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);

  // STEP 2 SAFETY AUDIT: Assert that readTex !== writeTex
  const readTex = this.particleStateA;
  const writeTex = this.particleStateB;
  console.assert(readTex !== writeTex, "Assertion failed: readTex === writeTex inside WebGL advection loop!");

  // STEP 1/5 Framebuffer status check and diagnostic update
  const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  let fboStatusStr = 'UNKNOWN';
  if (fboStatus === gl.FRAMEBUFFER_COMPLETE) fboStatusStr = 'FRAMEBUFFER_COMPLETE';
  else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT) fboStatusStr = 'INCOMPLETE_ATTACHMENT';
  else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT) fboStatusStr = 'INCOMPLETE_MISSING';
  else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS) fboStatusStr = 'INCOMPLETE_DIMENSIONS';
  else if (fboStatus === gl.FRAMEBUFFER_UNSUPPORTED) fboStatusStr = 'UNSUPPORTED';
  else fboStatusStr = 'INCOMPLETE_STATUS_' + fboStatus;

  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.particleStateATexUnit = 0;
    window.__RAW_GPU__.particleStateBTexUnit = 'FBO_ATTACH_COLOR0';
    window.__RAW_GPU__.advFboStatus = fboStatusStr;
    window.__RAW_GPU__.particlePassExecuted = true;
  }

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.u_waveTexture, 1);
  bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);

  var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(advPosLoc);
  gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.drawCallsPerFrame++;
  }
  gl.disableVertexAttribArray(advPosLoc);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

  // Swap buffers
  var tmp = this.particleStateA;
  this.particleStateA = this.particleStateB;
  this.particleStateB = tmp;

  // Restore State
  gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prevElementArrayBuffer);

  if (isWebGL2 && gl.bindVertexArray) {
    gl.bindVertexArray(prevVAO);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.useProgram(prevProg);
  gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  for (var u = 0; u < prevTextures2D.length; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, prevTextures2D[u]);
    if (prevTexturesCube[u]) {
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, prevTexturesCube[u]);
    }
  }

  gl.activeTexture(prevActiveTex);
  
  for (var i = 0; i < prevAttribsEnabled.length; i++) {
    try {
      if (prevAttribsEnabled[i]) {
        gl.enableVertexAttribArray(i);
      } else {
        gl.disableVertexAttribArray(i);
      }
    } catch (e) {}
  }
  
  if (prevBlend) {
    gl.enable(gl.BLEND);
  } else {
    gl.disable(gl.BLEND);
  }
  gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcAlpha, prevBlendDstAlpha);

  if (prevDepthTest) {
    gl.enable(gl.DEPTH_TEST);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.depthMask(prevDepthWriteMask);

  if (prevStencilTest) {
    gl.enable(gl.STENCIL_TEST);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  if (prevScissorTest) {
    gl.enable(gl.SCISSOR_TEST);
  } else {
    gl.disable(gl.SCISSOR_TEST);
  }
  gl.colorMask(prevColorMask[0], prevColorMask[1], prevColorMask[2], prevColorMask[3]);

  if (prevCullFace) {
    gl.enable(gl.CULL_FACE);
  } else {
    gl.disable(gl.CULL_FACE);
  }

  // Frame Time Telemetry Updates
  if (typeof window !== 'undefined' && window.__RAW_GPU__ && renderStart > 0) {
    const renderDuration = performance.now() - renderStart;
    if (renderDuration < 8.0) window.__RAW_GPU__.frameTimeHistogram[0]++;
    else if (renderDuration < 16.6) window.__RAW_GPU__.frameTimeHistogram[1]++;
    else if (renderDuration < 33.3) window.__RAW_GPU__.frameTimeHistogram[2]++;
    else if (renderDuration < 66.6) window.__RAW_GPU__.frameTimeHistogram[3]++;
    else window.__RAW_GPU__.frameTimeHistogram[4]++;

    if (renderDuration > 16.6) {
      window.__RAW_GPU__.droppedFrameCounter++;
    }
  }
};

WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles;

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  // Direct drawing to screen FBO.
};

WebGLMarineEngine.prototype.dispose = function(gl) {
  if (!gl) return;
  if (this.advectProgram) gl.deleteProgram(this.advectProgram);
  if (this.drawProgram) gl.deleteProgram(this.drawProgram);
  if (this.heatmapProgram) gl.deleteProgram(this.heatmapProgram);
  if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
  if (this.vertexIdBuffer) gl.deleteBuffer(this.vertexIdBuffer);
  if (this.gridUVBuffer) gl.deleteBuffer(this.gridUVBuffer);
  if (this.gridIndexBuffer) gl.deleteBuffer(this.gridIndexBuffer);
  if (this.advFBO) gl.deleteFramebuffer(this.advFBO);
  if (this.particleStateA) gl.deleteTexture(this.particleStateA);
  if (this.particleStateB) gl.deleteTexture(this.particleStateB);
  
  if (this._residentWaveTex) gl.deleteTexture(this._residentWaveTex);
  if (this._residentChlTex) gl.deleteTexture(this._residentChlTex);
  if (this._residentBathTex) gl.deleteTexture(this._residentBathTex);
  if (this._cachedMaskTex) gl.deleteTexture(this._cachedMaskTex);
  
  this._residentWaveTex = null;
  this._residentChlTex = null;
  this._residentBathTex = null;
  this._cachedMaskTex = null;
  this._cachedMaskGeoJSON = null;
  this._landGeoJSON = null;

  if (this._waveData) {
    if (this._waveData.u_waveTexture && this._waveData.u_waveTexture !== this._residentWaveTex) {
      gl.deleteTexture(this._waveData.u_waveTexture);
    }
    if (this._waveData.u_chlorophyllTexture && this._waveData.u_chlorophyllTexture !== this._residentChlTex) {
      gl.deleteTexture(this._waveData.u_chlorophyllTexture);
    }
    if (this._waveData.u_bathymetryTexture && this._waveData.u_bathymetryTexture !== this._residentBathTex) {
      gl.deleteTexture(this._waveData.u_bathymetryTexture);
    }
    if (this._waveData.u_oceanMaskTexture && this._waveData.u_oceanMaskTexture !== this._cachedMaskTex) {
      gl.deleteTexture(this._waveData.u_oceanMaskTexture);
    }
  }
  this._waveData = null;
  this._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
};

export default WebGLMarineEngine;
