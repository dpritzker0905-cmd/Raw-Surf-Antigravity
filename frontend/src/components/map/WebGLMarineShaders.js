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
uniform float u_speed_scale;
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

float mercatorYToLat(float y) {
  float sinhVal = (exp(3.141592653589793 * (1.0 - 2.0 * y)) - exp(-3.141592653589793 * (1.0 - 2.0 * y))) * 0.5;
  return atan(sinhVal) * 180.0 / 3.141592653589793;
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);

  // Convert global Mercator coordinates to geographic lng/lat
  float lng = pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(pos.y);

  // Map to local texture coordinate of u_waveTexture and u_oceanMaskTexture
  float tex_u = (lng - u_dataBounds_min.x) / (u_dataBounds_max.x - u_dataBounds_min.x);
  float tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 tex_uv = vec2(tex_u, tex_v);

  vec4 waveData = texture2D(u_waveTexture, tex_uv);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;
  float oceanFlag = texture2D(u_oceanMaskTexture, tex_uv).r;

  float lat_rad = lat * 3.141592653589793 / 180.0;
  float merc_scale = max(0.1, cos(lat_rad));
  
  float energyBoost = 1.0 + smoothstep(1.0, 5.0, waveHeight) * 0.3;
  // v4.0: waveVec is now a unit direction vector (RG encode direction only).
  // Scale by waveHeight * 0.1 to restore height-proportional advection speed.
  vec2 offset = (waveVec * waveHeight * 0.1 / merc_scale) * u_speed_scale * energyBoost;
  
  vec2 nextPos = pos + offset;
  nextPos.x = fract(nextPos.x);
  nextPos.y = clamp(nextPos.y, 0.001, 0.999);

  // Check land / oob for next position
  float next_lng = nextPos.x * 360.0 - 180.0;
  float next_lat = mercatorYToLat(nextPos.y);
  float next_tex_u = (next_lng - u_dataBounds_min.x) / (u_dataBounds_max.x - u_dataBounds_min.x);
  float next_tex_v = (next_lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 next_tex_uv = vec2(next_tex_u, next_tex_v);
  
  float nextOceanFlag = texture2D(u_oceanMaskTexture, next_tex_uv).r;

  vec2 seed = (nextPos + v_uv) * u_rand_seed;
  float drop = step(1.0 - u_drop_rate, rand(seed));

  // Detect NaN or extreme values
  bool isNan = !(pos.x >= 0.0 || pos.x < 0.0) || 
               !(pos.y >= 0.0 || pos.y < 0.0) || 
               !(waveHeight >= 0.0 || waveHeight < 0.0) ||
               !(waveVec.x >= 0.0 || waveVec.x < 0.0) ||
               !(waveVec.y >= 0.0 || waveVec.y < 0.0);

  bool isOob = (tex_u < 0.0 || tex_u > 1.0 || tex_v < 0.0 || tex_v > 1.0 ||
                next_tex_u < 0.0 || next_tex_u > 1.0 || next_tex_v < 0.0 || next_tex_v > 1.0);

  if (waveHeight < 0.1 || length(waveVec) < 0.005 || oceanFlag < 0.3 || nextOceanFlag < 0.3 || isNan || isOob) {
    drop = 1.0;
  }

  float oobY = step(1.0, nextPos.y) + step(0.0, -nextPos.y);
  drop = max(drop, step(0.5, oobY));

  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  if (drop > 0.5) {
    pos = newPos;
  } else {
    pos = nextPos;
  }

  // Prevent pole clamping leakage
  pos.y = clamp(pos.y, 0.001, 0.999);

  gl_FragColor = encodePos(pos);
}
`;

export const DRAW_VS = `
attribute highp float a_vertex_id;       // 0 to (numParticles - 1), one vertex per particle
uniform sampler2D u_particles;     // particle position texture (RG=x, BA=y)
uniform sampler2D u_waveTexture;   // wave vector + height texture (R=u, G=v, B=height, A=period)
uniform sampler2D u_oceanMaskTexture; // land/ocean binary mask
uniform float u_particles_res;     // resolution of position texture (e.g. 296.0)
uniform mat4 u_matrix;             // MapLibre projection matrix
uniform vec2 u_dataBounds_min;     // bounds [west, south]
uniform vec2 u_dataBounds_max;     // bounds [east, north]
uniform float u_time;              // elapsed time for animation
uniform float u_dash_length_scale; // wave crest target pixel size scale
uniform float u_zoom;              // map zoom level
uniform float u_merc_offset;       // world-copy offset in Mercator units (-1.0, 0.0, or +1.0)
uniform float u_debug_mode;        // debug mode selector
uniform float u_max_point_size;    // GPU max point size from ALIASED_POINT_SIZE_RANGE

varying highp float v_alpha;
varying highp float v_wave_height;
varying highp vec2 v_screen_dir;   // wave propagation direction in screen space
varying highp float v_aspect;      // elongation ratio for foam dash
varying highp vec4 v_debug_color;

float mercatorYToLat(float y) {
  float sinhVal = (exp(3.141592653589793 * (1.0 - 2.0 * y)) - exp(-3.141592653589793 * (1.0 - 2.0 * y))) * 0.5;
  return atan(sinhVal) * 180.0 / 3.141592653589793;
}

void main() {
  // v5.1: One vertex per particle (gl.POINTS foam sprites), not two (gl.LINES needles)
  float particleIndex = a_vertex_id;

  float col = mod(particleIndex, u_particles_res);
  float row = floor(particleIndex / u_particles_res);
  vec2 p_uv = (vec2(col, row) + 0.5) / u_particles_res;

  vec4 encodedPos = texture2D(u_particles, p_uv);
  vec2 pos = vec2(
    encodedPos.r + encodedPos.g / 255.0,
    encodedPos.b + encodedPos.a / 255.0
  );

  // Convert global Mercator coordinates to geographic lng/lat
  float lng = pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(pos.y);

  // Map to local texture coordinate of u_waveTexture and u_oceanMaskTexture
  float tex_u = (lng - u_dataBounds_min.x) / (u_dataBounds_max.x - u_dataBounds_min.x);
  float tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 tex_uv = vec2(tex_u, tex_v);

  vec4 waveData = texture2D(u_waveTexture, tex_uv);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  float waveHeight = waveData.b * 10.0;
  v_wave_height = waveHeight;
  float oceanFlag = texture2D(u_oceanMaskTexture, tex_uv).r;

  float particleHash = fract(sin(particleIndex * 12.9898) * 43758.5453);

  bool bypassDiscard = (u_debug_mode > 7.5);

  // Detect NaN or extreme values
  bool isNan = !(pos.x >= 0.0 || pos.x < 0.0) || 
               !(pos.y >= 0.0 || pos.y < 0.0) || 
               !(waveHeight >= 0.0 || waveHeight < 0.0) ||
               !(waveVec.x >= 0.0 || waveVec.x < 0.0) ||
               !(waveVec.y >= 0.0 || waveVec.y < 0.0);

  bool isOob = (tex_u < 0.0 || tex_u > 1.0 || tex_v < 0.0 || tex_v > 1.0);

  if (!bypassDiscard && (waveHeight < 0.1 || length(waveVec) < 0.005 || oceanFlag < 0.3 || isNan || isOob)) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    v_screen_dir = vec2(1.0, 0.0);
    v_aspect = 4.0;
    v_debug_color = vec4(0.0);
    gl_PointSize = 0.0;
    return;
  }

  float densityThreshold = smoothstep(2.0, 8.0, u_zoom) * 0.85 + 0.15;
  if (!bypassDiscard && particleHash > densityThreshold) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0;
    v_screen_dir = vec2(1.0, 0.0);
    v_aspect = 4.0;
    v_debug_color = vec4(0.0);
    gl_PointSize = 0.0;
    return;
  }

  // Debug mode colors (unchanged from v5.0)
  if (u_debug_mode > 0.5) {
    if (u_debug_mode < 5.5) {
      v_debug_color = vec4(p_uv.x, p_uv.y, 0.0, 1.0);
    } else if (u_debug_mode < 6.5) {
      v_debug_color = vec4(pos.x, pos.y, 0.0, 1.0);
    } else if (u_debug_mode < 7.5) {
      v_debug_color = vec4(waveVec.x * 0.5 + 0.5, waveVec.y * 0.5 + 0.5, 0.0, 1.0);
    } else {
      v_debug_color = vec4(1.0, 0.0, 0.0, 1.0);
    }
  } else {
    v_debug_color = vec4(0.0);
  }

  // === SCREEN-SPACE DIRECTION (Correction #1) ===
  // Project both the particle position and a nearby point along the forecast
  // wave direction through u_matrix. This produces a screen-space propagation
  // vector that stays correct under map rotation, pitch, and zoom.
  vec2 dir = length(waveVec) > 0.0001 ? normalize(waveVec) : vec2(1.0, 0.0);

  vec2 vertexPos = pos;
  vertexPos.x += u_merc_offset;
  vec4 clipPos = u_matrix * vec4(vertexPos.x, vertexPos.y, 0.0, 1.0);

  float eps = 1.0 / (256.0 * exp2(u_zoom)) * 20.0;
  vec2 offsetMerc = vertexPos + dir * eps;
  vec4 clipPosOffset = u_matrix * vec4(offsetMerc.x, offsetMerc.y, 0.0, 1.0);

  vec2 ndc0 = clipPos.xy / max(clipPos.w, 0.001);
  vec2 ndc1 = clipPosOffset.xy / max(clipPosOffset.w, 0.001);
  vec2 screenDelta = ndc1 - ndc0;

  v_screen_dir = length(screenDelta) > 0.0001
    ? normalize(screenDelta)
    : vec2(1.0, 0.0);

  gl_Position = clipPos;
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }

  // === POINT SIZE (Correction #4: no rotation, variation in size only) ===
  float baseCrestSize = pow(max(0.001, waveHeight), 0.5) * u_dash_length_scale;
  float zoomScale = smoothstep(2.0, 10.0, u_zoom) * 1.5 + 0.5;
  float sizeVariation = 0.85 + particleHash * 0.3;
  float pointSize = baseCrestSize * zoomScale * sizeVariation;
  pointSize = clamp(pointSize, 3.0, u_max_point_size);
  gl_PointSize = pointSize;

  // === FOAM DASH ASPECT RATIO ===
  // Per-particle variation in elongation (3.5:1 to 5:1), dash length variety
  v_aspect = 3.5 + particleHash * 1.5;

  // === WAVE-TRAIN PHASE (Correction #3: aesthetic, not physical wavelength) ===
  // spatialFreq is a VISUAL wave-train parameter, not a true wavelength.
  // Period and direction come from real forecast data.
  float modelPeriod = waveData.a * 20.0;
  float derivedPeriod = 6.0 + waveHeight * 2.0;
  float periodVal = modelPeriod > 0.5 ? modelPeriod : derivedPeriod;

  float visualSpatialFreq = 80.0 / max(1.0, periodVal);
  float spatialPhase = dot(pos, dir) * visualSpatialFreq;
  float temporalPhase = u_time / max(2.0, periodVal * (0.8 + particleHash * 0.4));
  float phase = fract(spatialPhase + temporalPhase);

  float rawPulse = sin(phase * 3.141592653589793);
  v_alpha = pow(max(rawPulse, 0.0), 0.6);

  float heightIntensity = smoothstep(0.0, 4.0, waveHeight);
  v_alpha *= mix(0.35, 1.0, heightIntensity);

  // Slight opacity variation per particle (Correction #4: variation in opacity, NOT rotation)
  v_alpha *= 0.8 + particleHash * 0.4;
}
`;

export const DRAW_FS = `
precision mediump float;
varying highp float v_alpha;
varying highp float v_wave_height;
varying highp vec2 v_screen_dir;   // wave propagation direction in screen space
varying highp float v_aspect;      // elongation ratio for foam dash
varying highp vec4 v_debug_color;
uniform float u_theme;

// Simple hash for foam breakup noise
float foamHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  if (v_debug_color.a > 0.5) {
    gl_FragColor = v_debug_color;
    return;
  }

  if (v_alpha < 0.02) discard;

  // === WAVE-ALIGNED FOAM DASH GLYPH ===
  // Transform gl_PointCoord into wave-aligned local coordinates.
  // v_screen_dir = wave propagation direction in screen space.
  // Crests run perpendicular to propagation.
  vec2 uv = gl_PointCoord * 2.0 - 1.0; // centered [-1, 1]

  vec2 crestAxis = vec2(-v_screen_dir.y, v_screen_dir.x); // perpendicular to propagation
  vec2 waveAxis = v_screen_dir;                             // along propagation

  float alongCrest = dot(uv, crestAxis);   // long axis of the dash
  float acrossCrest = dot(uv, waveAxis);   // short axis (narrow)

  // Elongated ellipse: wide along crest, narrow across
  float ex = alongCrest;
  float ey = acrossCrest * v_aspect; // v_aspect stretches the narrow axis

  float ellipseDist = sqrt(ex * ex + ey * ey);

  // Soft feathered edge falloff
  float shape = 1.0 - smoothstep(0.5, 1.0, ellipseDist);

  // Foam breakup noise along the crest for organic feel
  vec2 noiseCoord = vec2(alongCrest * 3.0 + v_wave_height, acrossCrest * 2.0);
  float breakup = foamHash(floor(noiseCoord * 4.0 + 0.5));
  shape *= mix(0.55, 1.0, breakup);

  // Soften the dash tips
  float tipFade = 1.0 - smoothstep(0.55, 0.95, abs(alongCrest));
  shape *= tipFade;

  float alpha = v_alpha * shape;
  if (alpha < 0.01) discard;

  // === THEMED CREST COLORS (unchanged from v5.0) ===
  float energy = smoothstep(0.0, 6.0, v_wave_height);

  vec3 calmColor, activeColor, stormColor;

  if (u_theme > 1.5) {
    // Beach Mode
    calmColor = vec3(0.05, 0.70, 0.60);
    activeColor = vec3(1.00, 0.65, 0.45);
    stormColor = vec3(1.00, 0.98, 0.92);
  } else if (u_theme > 0.5) {
    // Light Mode
    calmColor = vec3(0.10, 0.35, 0.80);
    activeColor = vec3(0.40, 0.75, 0.95);
    stormColor = vec3(1.00, 1.00, 1.00);
  } else {
    // Dark Mode
    calmColor = vec3(0.00, 0.90, 1.00);
    activeColor = vec3(1.00, 0.10, 0.80);
    stormColor = vec3(1.00, 1.00, 1.00);
  }

  vec3 finalColor = energy < 0.5
    ? mix(calmColor, activeColor, energy * 2.0)
    : mix(activeColor, stormColor, (energy - 0.5) * 2.0);

  // Premultiplied alpha output (Correction #5: gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  float boostedAlpha = alpha * mix(1.2, 1.8, energy);
  boostedAlpha = min(boostedAlpha, 0.85);
  gl_FragColor = vec4(finalColor * boostedAlpha, boostedAlpha);
}
`;

export const HEATMAP_VS = `
attribute highp vec2 a_grid_uv;
uniform mat4 u_matrix;
uniform vec2 u_dataBounds_min;   // [west, south]
uniform vec2 u_dataBounds_max;   // [east, north]
uniform float u_lng_offset;
varying highp vec2 v_grid_uv;

void main() {
  v_grid_uv = a_grid_uv;
  
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, a_grid_uv.x);
  lng += u_lng_offset;
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, a_grid_uv.y);
  lat = clamp(lat, -85.051129, 85.051129);

  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
}
`;

export const HEATMAP_FS = `
precision mediump float;
varying highp vec2 v_grid_uv;
uniform sampler2D u_waveTexture;
uniform sampler2D u_chlorophyllTexture;
uniform sampler2D u_bathymetryTexture;
uniform sampler2D u_oceanMaskTexture;
uniform float u_opacity;
uniform float u_debug_mode;
uniform float u_theme;

float getNonlinearT(float h) {
  // v4.1: Refined breakpoints — 0.5-1.5m gets 35% of color range for best open-ocean differentiation
  if (h < 0.5) {
    return (h / 0.5) * 0.15;
  } else if (h < 1.5) {
    return 0.15 + ((h - 0.5) / 1.0) * 0.35;
  } else if (h < 3.0) {
    return 0.50 + ((h - 1.5) / 1.5) * 0.30;
  } else if (h < 5.0) {
    return 0.80 + ((h - 3.0) / 2.0) * 0.12;
  } else {
    return 0.92 + clamp((h - 5.0) / 5.0, 0.0, 1.0) * 0.08;
  }
}

vec3 getThemedWaveColor(float h, float theme) {
  float t = getNonlinearT(h);
  
  vec3 c0, c1, c2, c3, c4, c5;
  
  if (theme > 1.5) {
    // Beach Mode: tropical lagoon → warm coral → sunset → volcanic amber
    c0 = vec3(0.02, 0.38, 0.35); // 0.0m - Deep Calm Emerald-Teal
    c1 = vec3(0.05, 0.65, 0.58); // 0.5m - Lagoon Turquoise
    c2 = vec3(0.95, 0.60, 0.40); // 1.5m - Warm Coral Peach
    c3 = vec3(1.00, 0.40, 0.15); // 3.0m - Radiant Sunset Orange
    c4 = vec3(0.85, 0.25, 0.05); // 5.0m - Volcanic Golden Amber
    c5 = vec3(1.00, 0.95, 0.90); // 10.0m+ - Intense Sunlit White-Rose
  } else if (theme > 0.5) {
    // Light Mode: clean ocean-sky progression
    c0 = vec3(0.78, 0.87, 0.94); // 0.0m - Pale Oceanic Mist
    c1 = vec3(0.30, 0.70, 0.90); // 0.5m - Sky-Cyan
    c2 = vec3(0.12, 0.42, 0.85); // 1.5m - Deep Azure Blue
    c3 = vec3(0.42, 0.20, 0.82); // 3.0m - Vibrant Royal Purple
    c4 = vec3(0.85, 0.18, 0.50); // 5.0m - Neon Orchid
    c5 = vec3(1.00, 1.00, 1.00); // 10.0m+ - Pure Crisp White
  } else {
    // Dark Mode: cosmic navy → subtle teal → electric cyan → blue-violet → magenta → white
    c0 = vec3(0.01, 0.02, 0.08); // 0.0m - Deep Cosmic Navy-Indigo
    c1 = vec3(0.00, 0.55, 0.75); // 0.5m - Cool Deep Teal (subtle, not blinding)
    c2 = vec3(0.00, 0.92, 1.00); // 1.5m - Electric Cyan (vivid mid-range)
    c3 = vec3(0.35, 0.15, 1.00); // 3.0m - Vivid Electric Blue-Violet
    c4 = vec3(1.00, 0.10, 0.75); // 5.0m - Neon Magenta
    c5 = vec3(1.00, 1.00, 1.00); // 10.0m+ - Pure Glowing Neon White
  }
  
  // v4.1: Interpolation bands aligned to new getNonlinearT breakpoints
  if (t < 0.15) {
    return mix(c0, c1, t / 0.15);
  } else if (t < 0.50) {
    return mix(c1, c2, (t - 0.15) / 0.35);
  } else if (t < 0.80) {
    return mix(c2, c3, (t - 0.50) / 0.30);
  } else if (t < 0.92) {
    return mix(c3, c4, (t - 0.80) / 0.12);
  } else {
    return mix(c4, c5, (t - 0.92) / 0.08);
  }
}

void main() {
  float oceanAlpha = texture2D(u_oceanMaskTexture, v_grid_uv).r;
  vec4 waveData = texture2D(u_waveTexture, v_grid_uv);
  float depthFactor = texture2D(u_bathymetryTexture, v_grid_uv).r;
  float waveHeight = waveData.b * 10.0;

  if (u_debug_mode > 0.5) {
    if (u_debug_mode < 1.5) { // 'uv' -> 1.0
      gl_FragColor = vec4(v_grid_uv.x, v_grid_uv.y, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 2.5) { // 'mask' -> 2.0
      gl_FragColor = vec4(oceanAlpha, oceanAlpha, oceanAlpha, u_opacity);
      return;
    } else if (u_debug_mode < 3.5) { // 'grid' -> 3.0
      gl_FragColor = vec4(0.0, 1.0, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 4.5) { // 'mercator' -> 4.0
      gl_FragColor = vec4(v_grid_uv.x, 1.0 - v_grid_uv.y, 1.0, u_opacity);
      return;
    }
  }

  // Ocean mask: discard land pixels
  if (oceanAlpha < 0.5) {
    discard;
  }

  // Decode swell direction from normalized [0,1] -> [-1,1]
  vec2 swellDir = (waveData.rg - 0.5) * 2.0;
  float swellMag = length(swellDir);

  // ── LAYER 1: BASE DEPTH COLOR (Bathymetry-driven) ──
  // deep ocean -> dark navy, mid ocean -> blue gradient, continental shelf -> turquoise glow, reefs -> bright shallow highlights
  // depthFactor: 0.0 = shelf/reef, 1.0 = deep ocean
  vec3 deepNavy, midOceanBlue, shelfTurquoise, reefHighlight;
  vec3 shallowWaterShelfGlowColor;

  if (u_theme > 1.5) {
    // Beach Mode: luxurious tropical crystal lagoon base (emerald/turquoise)
    deepNavy = vec3(0.015, 0.24, 0.22);       // deep tropical teal
    midOceanBlue = vec3(0.03, 0.44, 0.40);   // vibrant turquoise-blue
    shelfTurquoise = vec3(0.05, 0.60, 0.52); // sparkling emerald-turquoise
    reefHighlight = vec3(0.18, 0.78, 0.65);  // luminous warm shallow reef
    shallowWaterShelfGlowColor = vec3(0.08, 0.72, 0.60);
  } else if (u_theme > 0.5) {
    // Light Mode: clean sky/ocean base
    deepNavy = vec3(0.12, 0.35, 0.68);       // rich ocean blue
    midOceanBlue = vec3(0.25, 0.52, 0.80);   // bright azure blue
    shelfTurquoise = vec3(0.45, 0.70, 0.88); // soft sky-cyan
    reefHighlight = vec3(0.68, 0.88, 0.95);  // crystalline shallow slate
    shallowWaterShelfGlowColor = vec3(0.30, 0.68, 0.85);
  } else {
    // Dark Mode: glowing cosmic neon base
    deepNavy = vec3(0.005, 0.015, 0.05);     // deep space navy/black
    midOceanBlue = vec3(0.01, 0.04, 0.12);   // glowing royal navy
    shelfTurquoise = vec3(0.015, 0.12, 0.22);// electric deep cyan
    reefHighlight = vec3(0.02, 0.30, 0.40);  // neon cyan shoreline
    shallowWaterShelfGlowColor = vec3(0.00, 0.80, 0.95);
  }

  vec3 baseDepthColor = mix(midOceanBlue, deepNavy, depthFactor);

  // ── LAYER 2: CHLOROPHYLL SATELLITE REALISM LAYER ──
  float chlDensity = texture2D(u_chlorophyllTexture, v_grid_uv).r;
  vec3 chlorophyllGreen = vec3(0.06, 0.42, 0.24);

  // ── LAYER 3: SHALLOW WATER SHELF GLOW ──
  float shelfProximity = 1.0 - depthFactor;
  float shelfGlowFactor = smoothstep(0.6, 1.0, shelfProximity);
  vec3 shallowWaterShelfGlow = vec3(0.0);

  // ── LAYER 4: THEMED WAVE HEATMAP COLORS & BASE BLENDING ──
  vec3 waveColor = getThemedWaveColor(waveHeight, u_theme);
  
  // Conformal 3D-Volumetric Blending:
  // Flat water shows detailed natural floor/shelf, rising waves smoothly overlay waveColors
  // while keeping volumetric shadows and reefs highlights fully intact.
  float waveBlend = smoothstep(0.1, 0.8, waveHeight);
  vec3 baseColor = baseDepthColor + shallowWaterShelfGlow;
  vec3 baseWithChl = mix(baseColor, baseColor + chlorophyllGreen * chlDensity, 0.4);
  
  vec3 blendedWaveColor = mix(baseWithChl, waveColor, waveBlend * 0.90);

  // ── LAYER 5: DIRECTIONAL SWELL LIGHTING ──
  vec2 lightDir = normalize(vec2(-0.5, 0.7)); // light source from northwest/top-left
  float directional = 0.0;
  if (swellMag > 0.05) {
    directional = dot(normalize(swellDir), lightDir);
    directional = directional * 0.5 + 0.5; // [0,1] bias
    // v4.0: swellDir is now unit vector, scale by height for proportional lighting
    directional *= smoothstep(0.2, 3.0, waveHeight);
  }
  vec3 directionalSwellLighting = vec3(0.03, 0.05, 0.08) * directional;

  // ── FINAL PIXEL EQUATION (MANDATORY) ──
  vec3 finalColor = blendedWaveColor + directionalSwellLighting;

  float alpha = u_opacity;
  float maskFade = smoothstep(0.3, 0.8, oceanAlpha);
  alpha *= maskFade;

  gl_FragColor = vec4(finalColor * alpha, alpha);
}
`;
