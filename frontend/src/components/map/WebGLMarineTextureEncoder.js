/**
 * WebGLMarineTextureEncoder.js
 * High-fidelity GPU texture encoding, coordinate projection, shoreline GFS extrapolation,
 * and distance transform calculations for the WebGLMarineEngine.
 */

// --- WebGL Shader and Program Creation Utilities ---

export function createShader(gl, type, source) {
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

export function createProgram(gl, vs, fs) {
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

// --- Texture Lifecycle Utilities ---

export function updateTexture(gl, tex, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureUploadCount++;
  }
}

export function createTexture(gl, filter, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
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
  
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureCount++;
    window.__RAW_GPU__.textureUploadCount++;
    window.__RAW_GPU__.gpuMemoryEstimate += width * height * 4;
  }
  return tex;
}

export function unbindTexture(gl, tex) {
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

export function bindTexture(gl, tex, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

export function safeDeleteTexture(gl, tex, engine) {
  if (!tex || !gl) return;
  if (engine) {
    if (tex === engine.particleStateA || tex === engine.particleStateB) {
      console.warn('[WebGLMarineEngine] Safeguarded particle state texture from accidental deletion!');
      return;
    }
  }
  gl.deleteTexture(tex);
}

// --- Dynamic GFS Shoreline Extrapolation (In-painting Coastline) ---

export function extrapolateOceanData(vectors, cols, rows) {
  for (let pass = 0; pass < 2; pass++) {
    const nextVectors = vectors.map(v => ({ ...v }));
    let changes = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (vectors[idx].isOcean) continue;

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

    for (let r = 0; r < rows; r++) {
      const idx0 = r * cols + 0;
      const idxN = r * cols + cols - 1;
      
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

// --- Coordinate Projection and Land Mask Renderer ---

export function renderMaskToCanvas(geojson, bounds) {
  const dpr = (typeof window !== 'undefined') ? (window.devicePixelRatio || 1) : 1;
  const width = Math.floor(2048 * dpr);
  const height = Math.floor(1024 * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  if (!geojson?.features?.length) return canvas;
  
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

// --- The Ocean GPU Grid Texture Compressor ---

export function encodeMarineTexture(gl, waveGrid, landGeoJSON, engine) {
  const { vectors, cols, rows, bounds } = waveGrid;
  if (!vectors?.length || !cols || !rows) return null;

  if (!encodeMarineTexture._forensicCount) encodeMarineTexture._forensicCount = 0;
  if (encodeMarineTexture._forensicCount < 3) {
    let minS = Infinity, maxS = 0, sumS = 0, cnt = 0;
    for (let fi = 0; fi < vectors.length; fi++) {
      if (vectors[fi] && vectors[fi].isOcean && vectors[fi].speed > 0) {
        cnt++;
        if (vectors[fi].speed < minS) minS = vectors[fi].speed;
        if (vectors[fi].speed > maxS) maxS = vectors[fi].speed;
        sumS += vectors[fi].speed;
      }
    }
    const meanS = cnt > 0 ? sumS / cnt : 0;
    console.log(`[FORENSIC-ENCODE] encodeMarineTexture input: ${vectors.length} vectors, ${cnt} ocean w/speed, speed: min=${minS.toFixed(3)}m max=${maxS.toFixed(3)}m mean=${meanS.toFixed(3)}m (${(meanS*3.281).toFixed(1)}ft), cols=${cols}, rows=${rows}`);
    encodeMarineTexture._forensicCount++;
  }

  const extVectors = vectors.map(v => ({ ...v }));
  extrapolateOceanData(extVectors, cols, rows);

  const dataWave = new Uint8Array(cols * rows * 4);
  const dataChl = new Uint8Array(cols * rows * 4);
  const dataBath = new Uint8Array(cols * rows * 4);
  const dataMask = new Uint8Array(cols * rows * 4);

  const grid = new Uint8Array(cols * rows);
  for (let i = 0; i < vectors.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const gfsIdx = row * cols + col;
    const v = vectors[gfsIdx];
    const isLand = v.isOcean === false || v.isOcean === 0;
    const isOcean = !isLand && (v.isOcean === true || v.isOcean === 1 || v.speed > 0.001 || v.u !== 0 || v.v !== 0);
    grid[i] = isOcean ? 1 : 0;
  }

  const dist = new Float32Array(cols * rows);
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
    let minEdge = Math.min(dist[r * cols + 0], dist[r * cols + cols - 1]);
    dist[r * cols + 0] = minEdge;
    dist[r * cols + cols - 1] = minEdge;

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
    let minEdge = Math.min(dist[r * cols + 0], dist[r * cols + cols - 1]);
    dist[r * cols + 0] = minEdge;
    dist[r * cols + cols - 1] = minEdge;

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

  for (let i = 0; i < extVectors.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const gfsIdx = row * cols + col;
    const v = extVectors[gfsIdx];

    const lng = bounds.west + (col / (cols - 1)) * (bounds.east - bounds.west);
    const lat = bounds.south + (row / (rows - 1)) * (bounds.north - bounds.south);

    let speed = v.speed;
    let u = v.u;
    let v_y = v.v;
    // v4.0: Encode direction as unit vector (RG channels) for full ±1.0 precision.
    // Height is stored separately in B channel. Previously divided by 10.0 which
    // crushed the directional signal to ±0.17 for typical 1-2m waves.
    const mag = Math.sqrt(u * u + v_y * v_y);
    const nu = mag > 0.001 ? Math.max(0.0, Math.min(1.0, (u / mag) * 0.5 + 0.5)) : 0.5;
    const nv = mag > 0.001 ? Math.max(0.0, Math.min(1.0, (v_y / mag) * 0.5 + 0.5)) : 0.5;
    const height = Math.min(1.0, speed / 10.0);
    const periodVal = v.period ? Math.min(1.0, v.period / 20.0) : 0.0;

    dataWave[i * 4 + 0] = Math.floor(nu * 255);
    dataWave[i * 4 + 1] = Math.floor(nv * 255);
    dataWave[i * 4 + 2] = Math.floor(height * 255);
    dataWave[i * 4 + 3] = Math.floor(periodVal * 255);

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

    const origV = vectors[gfsIdx];
    const isLand = origV.isOcean === false || origV.isOcean === 0;
    const isOcean = !isLand && (origV.isOcean === true || origV.isOcean === 1 || origV.speed > 0.001 || origV.u !== 0 || origV.v !== 0);
    const oceanFlag = isOcean ? 255 : 0;
    dataMask[i * 4 + 0] = oceanFlag;
    dataMask[i * 4 + 1] = oceanFlag;
    dataMask[i * 4 + 2] = oceanFlag;
    dataMask[i * 4 + 3] = oceanFlag;
  }

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

  for (let r = 0; r < rows; r++) {
    const idx0 = (r * cols + 0) * 4;
    const idxN = (r * cols + cols - 1) * 4;
    
    const avgFlag = Math.floor((dataMask[idx0 + 0] + dataMask[idxN + 0]) * 0.5);
    dataMask[idx0 + 0] = dataMask[idxN + 0] = avgFlag;
    dataMask[idx0 + 1] = dataMask[idxN + 1] = avgFlag;
    dataMask[idx0 + 2] = dataMask[idxN + 2] = avgFlag;
    dataMask[idx0 + 3] = dataMask[idxN + 3] = avgFlag;
  }

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
          const dpr = (typeof window !== 'undefined') ? (window.devicePixelRatio || 1) : 1;
          const w = Math.floor(2048 * dpr);
          const h = Math.floor(1024 * dpr);
          window.__RAW_GPU__.gpuMemoryEstimate -= w * h * 4;
        }
        engine._cachedMaskTex = null;
      }
      try {
        const maskCanvas = renderMaskToCanvas(landGeoJSON, bounds);
        const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
        maskTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        
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
