/**
 * WebGLMarineEngine.js
 * GPU-accelerated wave crest simulation engine + continuous wave height heatmap.
 * Renders pulsing, perpendicular wave fronts using gl.drawArrays(gl.LINES)
 * overlayed on a smooth, continuous GPU wave height heatmap.
 * Strictly conforms to WebGL State Isolation Protocol and is < 600 lines of code.
 */

var ADVECT_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

var ADVECT_FS = `
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_marine_grid;
uniform vec2 u_speed_scale;
uniform vec2 u_dataBounds_min;
uniform vec2 u_dataBounds_max;
uniform float u_rand_seed;
uniform float u_drop_rate;
varying vec2 v_uv;

vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}

vec4 encodePos(vec2 pos) {
  vec2 clamped = clamp(pos, 0.0, 1.0);
  float x_hi = floor(clamped.x * 255.0);
  float x_lo = fract(clamped.x * 255.0);
  float y_hi = floor(clamped.y * 255.0);
  float y_lo = fract(clamped.y * 255.0);
  return vec4(x_hi / 255.0, x_lo, y_hi / 255.0, y_lo);
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);

  vec4 waveData = texture2D(u_marine_grid, pos);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;

  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, pos.y);
  float lat_rad = lat * 3.141592653589793 / 180.0;
  float merc_scale = max(0.1, cos(lat_rad));
  
  // v3.13.5: Gentler energy boost for realistic basin-scale propagation
  float energyBoost = 1.0 + smoothstep(1.0, 5.0, waveHeight) * 0.3;
  vec2 offset = vec2(waveVec.x / merc_scale, waveVec.y) * u_speed_scale * energyBoost;
  pos = pos + offset;

  vec2 seed = (pos + v_uv) * u_rand_seed;
  float drop = step(1.0 - u_drop_rate, rand(seed));

  // v3.13.6: Lowered waveHeight threshold 0.3→0.1 for calm ocean life.
  // Relaxed alpha from 0.4→0.3 for better coastal/polar coverage with LINEAR filtering.
  if (waveHeight < 0.1 || length(waveVec) < 0.005 || waveData.a < 0.3) {
    drop = 1.0;
  }

  // Out of bounds: wrap X (longitude) for antimeridian, drop Y (latitude)
  pos.x = fract(pos.x);
  float oobY = step(1.0, pos.y) + step(0.0, -pos.y);
  drop = max(drop, step(0.5, oobY));

  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  pos = mix(pos, newPos, drop);

  gl_FragColor = encodePos(pos);
}
`;

var DRAW_VS = `
attribute float a_vertex_id;       // 0 to (numParticles * 2 - 1)
uniform sampler2D u_particles;     // particle position texture (RG=x, BA=y)
uniform sampler2D u_marine_grid;   // wave vector texture (R=u, G=v, B=height)
uniform float u_particles_res;     // resolution of position texture (e.g. 256.0)
uniform mat4 u_matrix;             // MapLibre projection matrix
uniform vec2 u_dataBounds_min;     // bounds [west, south]
uniform vec2 u_dataBounds_max;     // bounds [east, north]
uniform float u_time;              // elapsed time for pulsation
uniform float u_dash_length_scale; // wave crest target pixel length per meter
uniform float u_zoom;              // map zoom level for pixel-to-degree conversion
uniform float u_lng_offset;        // v3.13.7: world-copy offset: -360, 0, or +360

varying float v_alpha;
varying float v_wave_height;

void main() {
  float particleIndex = floor(a_vertex_id / 2.0);
  float vertexType = mod(a_vertex_id, 2.0); // 0.0 = start, 1.0 = end

  float col = mod(particleIndex, u_particles_res);
  float row = floor(particleIndex / u_particles_res);
  vec2 p_uv = (vec2(col, row) + 0.5) / u_particles_res;

  vec4 encodedPos = texture2D(u_particles, p_uv);
  vec2 pos = vec2(
    encodedPos.r + encodedPos.g / 255.0,
    encodedPos.b + encodedPos.a / 255.0
  );

  vec4 waveData = texture2D(u_marine_grid, pos);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;
  v_wave_height = waveHeight;

  float particleHash = fract(sin(particleIndex * 12.9898) * 43758.5453);

  // v3.13.6: Lowered thresholds for calm ocean life
  if (waveHeight < 0.1 || length(waveVec) < 0.005 || waveData.a < 0.3) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    return;
  }

  // v3.13.6: ZOOM-ADAPTIVE DENSITY CULLING — tuned for calmer feel
  // Min 35% particles at any zoom; scales to 100% at zoom 8+
  float densityThreshold = clamp((u_zoom - 0.5) / 7.0, 0.35, 1.0);
  if (particleHash > densityThreshold) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    return;
  }

  vec2 dir = normalize(waveVec);
  
  // v3.13.7: Increased rotation jitter from ±30° to ±45° to break stripe patterns
  float rotJitter = (particleHash - 0.5) * 1.57;
  float cosR = cos(rotJitter);
  float sinR = sin(rotJitter);
  vec2 jitteredDir = vec2(dir.x * cosR - dir.y * sinR, dir.x * sinR + dir.y * cosR);
  vec2 perp = vec2(-jitteredDir.y, jitteredDir.x);
  
  // Zoom-aware pixel-to-degree conversion
  float pixelInDegrees = 360.0 / (256.0 * exp2(u_zoom));
  float crestPixels = max(2.0, pow(waveHeight, 0.7) * u_dash_length_scale);
  vec2 coordOffset = perp * crestPixels * pixelInDegrees * 0.5;

  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, pos.x);
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, pos.y);

  if (vertexType < 0.5) {
    lng -= coordOffset.x;
    lat -= coordOffset.y;
  } else {
    lng += coordOffset.x;
    lat += coordOffset.y;
  }
  lat = clamp(lat, -85.051129, 85.051129);

  // v3.13.7: Apply world-copy offset for seamless global wrapping (matches wind engine).
  // Do NOT wrap to [-180,180] here — that forces all copies into a single tile.
  // Instead, offset lng and convert directly to Mercator x.
  lng += u_lng_offset;
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }

  // Deep water wave period: T ≈ 0.9 * sqrt(H * 5.12)
  float derivedPeriod = 0.9 * sqrt(max(waveHeight, 0.3) * 5.12);
  float period = derivedPeriod * (0.6 + particleHash * 0.8);
  float phase = fract(u_time / period + particleHash);
  
  // v3.13.6: Rolling swell perception — smoother sinusoidal with extended crest visibility
  float rawPulse = sin(phase * 3.141592653589793);
  // Wider crest peak: pow(0.5) makes crests visible for longer portion of cycle
  v_alpha = pow(max(rawPulse, 0.0), 0.5);
  
  // Energy-driven intensity: calm=faint but visible, storms=bright
  float heightIntensity = smoothstep(0.0, 4.0, waveHeight);
  v_alpha *= mix(0.35, 1.0, heightIntensity);
}
`;

var DRAW_FS = `
precision mediump float;
varying float v_alpha;
varying float v_wave_height;

void main() {
  if (v_alpha < 0.02) discard;

  // Wave height drives crest color: calm=soft cyan, moderate=bright white, storm=intense white
  float energy = smoothstep(0.0, 6.0, v_wave_height);
  
  // 3-stop color ramp: soft blue-white → bright white → intense bright white
  vec3 calmColor = vec3(0.78, 0.92, 1.0);     // soft cyan for calm ocean
  vec3 activeColor = vec3(0.92, 0.98, 1.0);    // white-cyan for moderate swell
  vec3 stormColor = vec3(1.0, 1.0, 1.0);       // pure white for high energy
  vec3 finalColor = energy < 0.5 
    ? mix(calmColor, activeColor, energy * 2.0)
    : mix(activeColor, stormColor, (energy - 0.5) * 2.0);

  // Progressive alpha boost: more visible particles in high-energy zones
  float boostedAlpha = v_alpha * mix(1.2, 1.8, energy);
  boostedAlpha = min(boostedAlpha, 0.95);
  gl_FragColor = vec4(finalColor * boostedAlpha, boostedAlpha);
}
`;

var HEATMAP_VS = `
attribute vec2 a_grid_uv;
uniform mat4 u_matrix;
uniform vec2 u_dataBounds_min;   // [west, south]
uniform vec2 u_dataBounds_max;   // [east, north]
varying vec2 v_grid_uv;

void main() {
  v_grid_uv = a_grid_uv;
  
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, a_grid_uv.x);
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, a_grid_uv.y);
  lat = clamp(lat, -85.051129, 85.051129);

  // Wrap longitude to [-180, 180] for antimeridian crossing
  float wrappedLng = lng - 360.0 * floor((lng + 180.0) / 360.0);
  float x = (wrappedLng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
}
`;

var HEATMAP_FS = `
precision mediump float;
varying vec2 v_grid_uv;
uniform sampler2D u_marine_grid;
uniform float u_opacity;

vec3 getMarineColor(float h) {
  // Breakpoints: 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10
  if (h <= 0.5) {
    return mix(vec3(14.0/255.0, 25.0/255.0, 65.0/255.0), vec3(25.0/255.0, 45.0/255.0, 100.0/255.0), clamp(h / 0.5, 0.0, 1.0));
  } else if (h <= 1.0) {
    return mix(vec3(25.0/255.0, 45.0/255.0, 100.0/255.0), vec3(35.0/255.0, 75.0/255.0, 135.0/255.0), clamp((h - 0.5) / 0.5, 0.0, 1.0));
  } else if (h <= 1.5) {
    return mix(vec3(35.0/255.0, 75.0/255.0, 135.0/255.0), vec3(45.0/255.0, 110.0/255.0, 160.0/255.0), clamp((h - 1.0) / 0.5, 0.0, 1.0));
  } else if (h <= 2.0) {
    return mix(vec3(45.0/255.0, 110.0/255.0, 160.0/255.0), vec3(60.0/255.0, 140.0/255.0, 175.0/255.0), clamp((h - 1.5) / 0.5, 0.0, 1.0));
  } else if (h <= 2.5) {
    return mix(vec3(60.0/255.0, 140.0/255.0, 175.0/255.0), vec3(80.0/255.0, 175.0/255.0, 180.0/255.0), clamp((h - 2.0) / 0.5, 0.0, 1.0));
  } else if (h <= 3.0) {
    return mix(vec3(80.0/255.0, 175.0/255.0, 180.0/255.0), vec3(120.0/255.0, 205.0/255.0, 165.0/255.0), clamp((h - 2.5) / 0.5, 0.0, 1.0));
  } else if (h <= 4.0) {
    return mix(vec3(120.0/255.0, 205.0/255.0, 165.0/255.0), vec3(180.0/255.0, 220.0/255.0, 140.0/255.0), clamp((h - 3.0) / 1.0, 0.0, 1.0));
  } else if (h <= 5.0) {
    return mix(vec3(180.0/255.0, 220.0/255.0, 140.0/255.0), vec3(230.0/255.0, 210.0/255.0, 95.0/255.0), clamp((h - 4.0) / 1.0, 0.0, 1.0));
  } else if (h <= 6.0) {
    return mix(vec3(230.0/255.0, 210.0/255.0, 95.0/255.0), vec3(245.0/255.0, 150.0/255.0, 50.0/255.0), clamp((h - 5.0) / 1.0, 0.0, 1.0));
  } else if (h <= 8.0) {
    return mix(vec3(245.0/255.0, 150.0/255.0, 50.0/255.0), vec3(220.0/255.0, 80.0/255.0, 40.0/255.0), clamp((h - 6.0) / 2.0, 0.0, 1.0));
  } else {
    return mix(vec3(220.0/255.0, 80.0/255.0, 40.0/255.0), vec3(160.0/255.0, 30.0/255.0, 70.0/255.0), clamp((h - 8.0) / 2.0, 0.0, 1.0));
  }
}

void main() {
  vec4 waveData = texture2D(u_marine_grid, v_grid_uv);
  float waveHeight = waveData.b * 10.0;

  // Ocean mask: alpha channel encodes land (0) vs ocean (1)
  // With LINEAR filtering on a coarse grid, alpha interpolates across the coast.
  // Threshold at 0.7 ensures only predominantly-ocean cells pass (crisp coastline).
  // The ocean-mask-fill vector layer on top provides precise coastline masking.
  if (waveData.a < 0.7 || waveHeight < 0.01) {
    discard;
  }

  vec3 rgb = getMarineColor(waveHeight);
  float alpha = u_opacity;
  
  // Smooth coastline fade with rich ocean fill
  float heightFade = smoothstep(0.01, 0.15, waveHeight);
  float maskFade = smoothstep(0.7, 0.9, waveData.a);
  alpha *= heightFade * maskFade;

  gl_FragColor = vec4(rgb * alpha, alpha);
}

`;

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

function createTexture(gl, filter, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
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

function encodeMarineTexture(gl, waveGrid) {
  const { vectors, cols, rows, bounds } = waveGrid;
  if (!vectors?.length || !cols || !rows) return null;

  let maxVal = 0.001;
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const len = Math.sqrt(v.u * v.u + v.v * v.v);
    if (len > maxVal) maxVal = len;
  }

  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const nu = (v.u / maxVal) * 0.5 + 0.5;
    const nv = (v.v / maxVal) * 0.5 + 0.5;
    const height = Math.min(1.0, v.speed / 10.0);
    // v3.13.3: Strict ocean mask — require explicit isOcean===true from API data.
    // The marine API returns null wave_height for land points, which sets isOcean=false.
    // v3.13.5: If the API says this is ocean (wave_height was not null), mark as ocean
    // regardless of wave data magnitude. Calm oceans (Arctic, Mediterranean) still need coverage.
    // The draw shader's waveHeight threshold (0.3m) handles filtering out truly calm areas.
    const oceanFlag = (v.isOcean === true) ? 255 : 0;
    
    data[i * 4 + 0] = Math.floor(nu * 255);
    data[i * 4 + 1] = Math.floor(nv * 255);
    data[i * 4 + 2] = Math.floor(height * 255);
    data[i * 4 + 3] = oceanFlag;
  }

  // v3.13.3: Use LINEAR filtering for smooth wave field interpolation across the
  // coarse global grid, but rely on strict alpha thresholds in shaders to prevent
  // land bleeding. NEAREST causes visible grid artifacts with 15x15 global data.
  const tex = createTexture(gl, gl.LINEAR, data, cols, rows);
  return {
    texture: tex,
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
  // v3.13.5: Global ocean field normalization
  // Density now handled by zoom-adaptive culling in draw shader
  this.particleRes = 136;       // 136² = 18,496 crests (zoom culling controls visible count)
  this.speedFactor = 0.05;      // Further halved for calm basin-scale drift
  this.dropRate = 0.003;        // Low recycling = coherent wave fronts
  this._initialized = false;
  this._waveData = null;
  this._startTime = Date.now();
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

  // High-res 96x96 grid mesh for smooth continuous heatmap rendering
  // (96×96 keeps indices within Uint16Array limit: 95*95*6 = 54,150 < 65,535)
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
  this._initialized = true;
  console.log('[WebGLMarine] Initialized engine with ' + numParticles + ' wave crests + 64x64 grid');
};

WebGLMarineEngine.prototype.setWaveData = function(gl, waveGrid) {
  if (!waveGrid?.vectors?.length) return;
  if (this._waveData?.texture) {
    gl.deleteTexture(this._waveData.texture);
  }
  console.log('[WebGLMarineEngine] setWaveData input:', {vectors: waveGrid.vectors.length, cols: waveGrid.cols, rows: waveGrid.rows, hasBounds: !!waveGrid.bounds});
  this._waveData = encodeMarineTexture(gl, waveGrid);
  console.log('[WebGLMarineEngine] setWaveData result:', {hasData: !!this._waveData, hasTexture: !!this._waveData?.texture, hasBounds: !!this._waveData?.bounds});
};

WebGLMarineEngine.prototype.renderHeatmapAndParticles = function(gl, matrix, screenWidth, screenHeight, zoom) {
  if (!this._initialized || !this._waveData || !matrix || !matrix.length) {
    if (this._renderLogged === undefined) {
      this._renderLogged = 0;
    }
    this._renderLogged++;
    if (this._renderLogged === 1 || this._renderLogged % 180 === 0) {
      console.log("[WebGLMarineEngine] render returned early! _initialized:", this._initialized, "_waveData:", !!this._waveData, "matrix:", !!matrix, "matrix.length:", matrix?.length);
    }
    return;
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

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);

  // Clear any existing WebGL errors from MapLibre's previous drawing operations
  while (gl.getError() !== gl.NO_ERROR) {}

  // Prevent MapLibre vertex attribute pollution by disabling all attribute arrays
  var maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 16;
  for (var i = 0; i < maxAttribs; i++) {
    try {
      gl.disableVertexAttribArray(i);
    } catch (e) {}
  }


  // Capture and unbind all texture units to prevent feedback loops with MapLibre's active drawing textures
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


  // Capture and unbind WebGL2 VAO to prevent MapLibre attribute pollution
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
  // ==========================================
  // PHASE 1: WAVE HEIGHT HEATMAP (GPU-driven, replaces raster tiles)
  // ==========================================
  // Renders the wave data texture as a colored heatmap over the ocean.
  // Uses the same data texture as particles (u_marine_grid).
  // This REPLACES the OpenMeteo raster tile pipeline for marine layers,
  // eliminating all SourceCache/tile/clipping issues.
  const z = typeof zoom === 'number' ? zoom : 6;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha

  gl.useProgram(this.heatmapProgram);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_marine_grid'), 0);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);

  // Zoom-based opacity: matches the previous raster paint expression
  // interpolate(['linear'], ['zoom'], 2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70)
  var heatmapOpacity;
  if (z <= 2) heatmapOpacity = 0.45;
  else if (z <= 5) heatmapOpacity = 0.45 + (z - 2) / 3 * 0.10;
  else if (z <= 8) heatmapOpacity = 0.55 + (z - 5) / 3 * 0.10;
  else if (z <= 12) heatmapOpacity = 0.65 + (z - 8) / 4 * 0.05;
  else heatmapOpacity = 0.70;
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);

  bindTexture(gl, this._waveData.texture, 0);

  var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
  gl.enableVertexAttribArray(heatUVLoc);
  gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
  gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(heatUVLoc);

  // ==========================================
  // PHASE 2: WAVE CREST PARTICLE SIMULATION
  // ==========================================
  const baseScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6));
  const lngSpan = Math.max(0.01, Math.abs(waveBounds.east - waveBounds.west));
  const latSpan = Math.max(0.01, Math.abs(waveBounds.north - waveBounds.south));
  const speedScaleX = Math.max(3.0e-4, baseScale / lngSpan);
  const speedScaleY = Math.max(3.0e-4, baseScale / latSpan);

  if (this.frameCount === undefined) this.frameCount = 0;
  this.frameCount++;
  if (this.frameCount === 1) {
    console.log(`[MARINE-TELEMETRY] Frame 1 matrix: [${mat4[0].toFixed(4)}, ${mat4[1].toFixed(4)}, ${mat4[2].toFixed(4)}, ${mat4[3].toFixed(4)}] | prevColorMask: [${prevColorMask[0]}, ${prevColorMask[1]}, ${prevColorMask[2]}, ${prevColorMask[3]}]`);
  }
  if (this.frameCount === 1 || this.frameCount % 60 === 0) {
    console.log(`[MARINE-TELEMETRY] Frame: ${this.frameCount} | RAF tick executed | wave/swell update advection step = [${speedScaleX.toFixed(6)}, ${speedScaleY.toFixed(6)}] | interpolation step: GFS-Wave / WW3 ocean grid bilinear lookup | particle buffer mutated (State A/B ping-pong active) | draw call: gl.drawElements(TRIANGLES, ${this.numGridIndices}, UNSIGNED_SHORT) (heatmap) + gl.drawArrays(LINES, 0, ${this.particleRes * this.particleRes * 2}) (crests) | shader active: heatmapProgram + advectProgram + drawProgram | uniforms: u_matrix, u_opacity, u_speed_scale, u_rand_seed, u_drop_rate`);
  }

  gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
  gl.useProgram(this.advectProgram);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_marine_grid'), 1);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), speedScaleX, speedScaleY);

  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
  gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);

  // Unbind potential feedback loop textures from units 0 and 1
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);

  unbindTexture(gl, this.particleStateB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
  gl.viewport(0, 0, this.particleRes, this.particleRes);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.texture, 1);

  var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
  gl.enableVertexAttribArray(advPosLoc);
  gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(advPosLoc);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

  // Swap buffers
  var tmp = this.particleStateA;
  this.particleStateA = this.particleStateB;
  this.particleStateB = tmp;

  // Draw wave crest lines
  // Unbind potential feedback loop textures from units 0 and 1
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.viewport(0, 0, screenWidth, screenHeight);

  gl.enable(gl.BLEND); // CRITICAL: Enable blend for particle rendering!
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(this.drawProgram);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
  gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_marine_grid'), 1);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);

  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
  gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);

  const zVal = typeof zoom === 'number' ? zoom : 6.0;
  // v3.13.4: Reduced from 12.0 to 5.0 — shorter crests break visible horizontal stripe
  // patterns that form when many particles share similar wave direction
  const dashLengthScale = 5.0;
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dash_length_scale'), dashLengthScale);
  gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), zVal);

  bindTexture(gl, this.particleStateA, 0);
  bindTexture(gl, this._waveData.texture, 1);

  var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
  var lngOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_lng_offset');
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
  gl.enableVertexAttribArray(idLoc);
  gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);

  // v3.13.7: Draw multiple world copies for seamless global wrapping.
  // Matches wind engine's approach: at low zoom, draw 3 copies at -360, 0, +360.
  var worldOffsets = (zVal < 3.5) ? [0.0, -360.0, 360.0] : [0.0];
  for (var wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(lngOffsetLoc, worldOffsets[wi]);
    gl.drawArrays(gl.LINES, 0, this.particleRes * this.particleRes * 2);
  }
  gl.disableVertexAttribArray(idLoc);

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
};

WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles;

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  // No screen FBOs are used (direct drawing), so there is no trail residue.
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
  if (this._waveData?.texture) gl.deleteTexture(this._waveData.texture);
  this._waveData = null;
  this._initialized = false;
  console.log('[WebGLMarine] Engine Disposed');
};

export default WebGLMarineEngine;
