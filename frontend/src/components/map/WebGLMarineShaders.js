/**
 * WebGLMarineShaders.js
 * Ocean GPU v2 — GLSL Shaders for the raster-free marine rendering engine.
 * Extracted from WebGLMarineEngine.js for code modularity and LOC compliance.
 */

export const ADVECT_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const ADVECT_FS = `
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_waveTexture;
uniform sampler2D u_oceanMaskTexture;
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

  vec4 waveData = texture2D(u_waveTexture, pos);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;
  float oceanFlag = texture2D(u_oceanMaskTexture, pos).r;

  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, pos.y);
  float lat_rad = lat * 3.141592653589793 / 180.0;
  float merc_scale = max(0.1, cos(lat_rad));
  
  float energyBoost = 1.0 + smoothstep(1.0, 5.0, waveHeight) * 0.3;
  vec2 offset = vec2(waveVec.x / merc_scale, waveVec.y) * u_speed_scale * energyBoost;
  pos = pos + offset;

  vec2 seed = (pos + v_uv) * u_rand_seed;
  float drop = step(1.0 - u_drop_rate, rand(seed));

  if (waveHeight < 0.1 || length(waveVec) < 0.005 || oceanFlag < 0.3) {
    drop = 1.0;
  }

  pos.x = fract(pos.x);
  float oobY = step(1.0, pos.y) + step(0.0, -pos.y);
  drop = max(drop, step(0.5, oobY));

  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  pos = mix(pos, newPos, drop);

  gl_FragColor = encodePos(pos);
}
`;

export const DRAW_VS = `
attribute float a_vertex_id;       // 0 to (numParticles * 2 - 1)
uniform sampler2D u_particles;     // particle position texture (RG=x, BA=y)
uniform sampler2D u_waveTexture;   // wave vector + height texture (R=u, G=v, B=height)
uniform sampler2D u_oceanMaskTexture; // land/ocean binary mask
uniform float u_particles_res;     // resolution of position texture (e.g. 256.0)
uniform mat4 u_matrix;             // MapLibre projection matrix
uniform vec2 u_dataBounds_min;     // bounds [west, south]
uniform vec2 u_dataBounds_max;     // bounds [east, north]
uniform float u_time;              // elapsed time for pulsation
uniform float u_dash_length_scale; // wave crest target pixel length per meter
uniform float u_zoom;              // map zoom level for pixel-to-degree conversion
uniform float u_lng_offset;        // world-copy offset: -360, 0, or +360

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

  vec4 waveData = texture2D(u_waveTexture, pos);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;
  v_wave_height = waveHeight;
  float oceanFlag = texture2D(u_oceanMaskTexture, pos).r;

  float particleHash = fract(sin(particleIndex * 12.9898) * 43758.5453);

  if (waveHeight < 0.1 || length(waveVec) < 0.005 || oceanFlag < 0.3) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    return;
  }

  float densityThreshold = clamp((u_zoom - 0.5) / 7.0, 0.35, 1.0);
  if (particleHash > densityThreshold) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    return;
  }

  vec2 dir = normalize(waveVec);
  
  float rotJitter = (particleHash - 0.5) * 1.57;
  float cosR = cos(rotJitter);
  float sinR = sin(rotJitter);
  vec2 jitteredDir = vec2(dir.x * cosR - dir.y * sinR, dir.x * sinR + dir.y * cosR);
  vec2 perp = vec2(-jitteredDir.y, jitteredDir.x);
  
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

  lng += u_lng_offset;
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }

  float derivedPeriod = 0.9 * sqrt(max(waveHeight, 0.3) * 5.12);
  float period = derivedPeriod * (0.6 + particleHash * 0.8);
  float phase = fract(u_time / period + particleHash);
  
  float rawPulse = sin(phase * 3.141592653589793);
  v_alpha = pow(max(rawPulse, 0.0), 0.5);
  
  float heightIntensity = smoothstep(0.0, 4.0, waveHeight);
  v_alpha *= mix(0.35, 1.0, heightIntensity);
}
`;

export const DRAW_FS = `
precision mediump float;
varying float v_alpha;
varying float v_wave_height;

void main() {
  if (v_alpha < 0.02) discard;

  float energy = smoothstep(0.0, 6.0, v_wave_height);
  
  vec3 calmColor = vec3(0.78, 0.92, 1.0);     // soft cyan for calm ocean
  vec3 activeColor = vec3(0.92, 0.98, 1.0);    // white-cyan for moderate swell
  vec3 stormColor = vec3(1.0, 1.0, 1.0);       // pure white for high energy
  vec3 finalColor = energy < 0.5 
    ? mix(calmColor, activeColor, energy * 2.0)
    : mix(activeColor, stormColor, (energy - 0.5) * 2.0);

  float boostedAlpha = v_alpha * mix(1.2, 1.8, energy);
  boostedAlpha = min(boostedAlpha, 0.95);
  gl_FragColor = vec4(finalColor * boostedAlpha, boostedAlpha);
}
`;

export const HEATMAP_VS = `
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

  float wrappedLng = lng - 360.0 * floor((lng + 180.0) / 360.0);
  float x = (wrappedLng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
}
`;

export const HEATMAP_FS = `
precision mediump float;
varying vec2 v_grid_uv;
uniform sampler2D u_waveTexture;
uniform sampler2D u_chlorophyllTexture;
uniform sampler2D u_bathymetryTexture;
uniform sampler2D u_oceanMaskTexture;
uniform float u_opacity;

void main() {
  vec4 waveData = texture2D(u_waveTexture, v_grid_uv);
  float waveHeight = waveData.b * 10.0;
  float oceanAlpha = texture2D(u_oceanMaskTexture, v_grid_uv).r;

  // Ocean mask: discard land pixels
  if (oceanAlpha < 0.5 || waveHeight < 0.001) {
    discard;
  }

  // Decode swell direction from normalized [0,1] -> [-1,1]
  vec2 swellDir = (waveData.rg - 0.5) * 2.0;
  float swellMag = length(swellDir);

  // ── LAYER 1: BASE DEPTH COLOR (Bathymetry-driven) ──
  // deep ocean -> dark navy, mid ocean -> blue gradient, continental shelf -> turquoise glow, reefs -> bright shallow highlights
  // depthFactor: 0.0 = shelf/reef, 1.0 = deep ocean
  float depthFactor = texture2D(u_bathymetryTexture, v_grid_uv).r;
  vec3 deepNavy = vec3(0.015, 0.04, 0.12);
  vec3 midOceanBlue = vec3(0.04, 0.12, 0.28);
  vec3 shelfTurquoise = vec3(0.08, 0.38, 0.44);
  vec3 reefHighlight = vec3(0.18, 0.68, 0.62);

  vec3 baseDepthColor;
  if (depthFactor < 0.2) {
    baseDepthColor = mix(reefHighlight, shelfTurquoise, depthFactor / 0.2);
  } else if (depthFactor < 0.6) {
    baseDepthColor = mix(shelfTurquoise, midOceanBlue, (depthFactor - 0.2) / 0.4);
  } else {
    baseDepthColor = mix(midOceanBlue, deepNavy, (depthFactor - 0.6) / 0.4);
  }

  // ── LAYER 2: CHLOROPHYLL SATELLITE REALISM LAYER ──
  // high chlorophyll -> green tint overlay
  // (Chlorophyll precalculated including latitude bands, Gulf Stream and coastal blooms)
  float chlDensity = texture2D(u_chlorophyllTexture, v_grid_uv).r;
  vec3 chlorophyllGreen = vec3(0.06, 0.42, 0.24);
  vec3 chlorophyllTint = chlorophyllGreen * chlDensity;

  // ── LAYER 3: WAVE ENERGY MODULATION ──
  // storm systems brighten ocean surface, calm zones remain dark and stable
  float waveEnergy = smoothstep(0.0, 8.0, waveHeight);
  vec3 stormBright = vec3(0.12, 0.28, 0.55); // Storm surge blue-white glow
  vec3 calmStable = vec3(0.0, 0.0, 0.0);
  vec3 waveEnergyBoost = mix(calmStable, stormBright, waveEnergy);

  // ── LAYER 4: SHALLOW WATER SHELF GLOW ──
  // Bahamian / Florida style turquoise glow pop
  float shelfProximity = 1.0 - depthFactor;
  float shelfGlowFactor = smoothstep(0.6, 1.0, shelfProximity);
  vec3 shallowWaterShelfGlow = vec3(0.12, 0.52, 0.48) * shelfGlowFactor * 0.45;

  // ── LAYER 5: DIRECTIONAL SWELL LIGHTING ──
  vec2 lightDir = normalize(vec2(-0.5, 0.7)); // light source from northwest/top-left
  float directional = 0.0;
  if (swellMag > 0.05) {
    directional = dot(normalize(swellDir), lightDir);
    directional = directional * 0.5 + 0.5; // [0,1] bias
    directional *= swellMag;
  }
  vec3 directionalSwellLighting = vec3(0.03, 0.05, 0.08) * directional;

  // ── FINAL PIXEL EQUATION (MANDATORY) ──
  vec3 finalColor = baseDepthColor + chlorophyllTint + waveEnergyBoost + shallowWaterShelfGlow + directionalSwellLighting;

  float alpha = u_opacity;
  float maskFade = smoothstep(0.3, 0.8, oceanAlpha);
  float heightFade = smoothstep(0.001, 0.15, waveHeight);
  alpha *= maskFade * heightFade;

  gl_FragColor = vec4(finalColor * alpha, alpha);
}
`;
