/**
 * WebGLMarineShaders.js
 * Ocean GPU v2 — GLSL Shaders for the raster-free marine rendering engine.
 * Extracted from WebGLMarineEngine.js for code modularity and LOC compliance.
 */

export const HEATMAP_VS = `
attribute highp vec2 a_grid_uv;
uniform mat4 u_matrix;
uniform highp vec2 u_dataBounds_min;   // [west, south]
uniform highp vec2 u_dataBounds_max;   // [east, north]
uniform float u_lng_offset;
varying highp vec2 v_mercator_xy;

float latToMercatorY(float lat) {
  float latClamped = clamp(lat, -85.051129, 85.051129);
  float rad = latClamped * 3.141592653589793 / 180.0;
  return (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
}

void main() {
  float lng = u_dataBounds_min.x > u_dataBounds_max.x
    ? u_dataBounds_min.x + a_grid_uv.x * (u_dataBounds_max.x + 360.0 - u_dataBounds_min.x)
    : mix(u_dataBounds_min.x, u_dataBounds_max.x, a_grid_uv.x);
  lng += u_lng_offset;
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, a_grid_uv.y);
  lat = clamp(lat, -85.051129, 85.051129);

  float x = (lng + 180.0) / 360.0;
  float y = latToMercatorY(lat);

  v_mercator_xy = vec2(x, y);

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
}
`;

export const HEATMAP_FS = `
precision mediump float;
varying highp vec2 v_mercator_xy;
uniform sampler2D u_waveTexture;
uniform sampler2D u_chlorophyllTexture;
uniform sampler2D u_bathymetryTexture;
uniform sampler2D u_oceanMaskTexture;
uniform float u_opacity;
uniform float u_debug_mode;
uniform float u_theme;
uniform float u_edgeFeatherEnabled;
uniform float u_is_estimated;
uniform highp vec2 u_dataBounds_min;   // [west, south]
uniform highp vec2 u_dataBounds_max;   // [east, north]

float mercatorYToLat(float y) {
  float sinhVal = (exp(3.141592653589793 * (1.0 - 2.0 * y)) - exp(-3.141592653589793 * (1.0 - 2.0 * y))) * 0.5;
  return atan(sinhVal) * 180.0 / 3.141592653589793;
}

float latToMercatorY(float lat) {
  float latClamped = clamp(lat, -85.051129, 85.051129);
  float rad = latClamped * 3.141592653589793 / 180.0;
  return (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
}

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
  float lng = v_mercator_xy.x * 360.0 - 180.0;
  float lat = mercatorYToLat(v_mercator_xy.y);

  float tex_u;
  if (u_dataBounds_min.x > u_dataBounds_max.x) {
    float span = (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x;
    tex_u = mod(lng - u_dataBounds_min.x, 360.0) / max(span, 0.0001);
  } else {
    tex_u = (lng - u_dataBounds_min.x) / max(u_dataBounds_max.x - u_dataBounds_min.x, 0.0001);
  }
  float tex_v = (lat - u_dataBounds_min.y) / max(u_dataBounds_max.y - u_dataBounds_min.y, 0.0001);
  vec2 grid_uv = vec2(tex_u, tex_v);

  float mercMinY = latToMercatorY(u_dataBounds_max.y); // North
  float mercMaxY = latToMercatorY(u_dataBounds_min.y); // South
  float mask_v = (mercMaxY - v_mercator_xy.y) / max(mercMaxY - mercMinY, 0.0001);
  vec2 mask_uv = vec2(tex_u, mask_v);

  float oceanAlpha = texture2D(u_oceanMaskTexture, mask_uv).r;
  vec4 waveData = texture2D(u_waveTexture, grid_uv);
  float depthFactor = texture2D(u_bathymetryTexture, grid_uv).r;
  float waveHeight = waveData.b * 10.0;
  
  float displayHeight = waveHeight;
  if (u_is_estimated > 0.5 && waveHeight > 0.0) {
    displayHeight = clamp(pow(waveHeight, 0.45) * 0.95, 0.0, 10.0);
  }

  if (u_debug_mode > 0.5) {
    if (u_debug_mode < 1.5) { // 'uv' -> 1.0
      gl_FragColor = vec4(grid_uv.x, grid_uv.y, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 2.5) { // 'mask' -> 2.0
      gl_FragColor = vec4(oceanAlpha, oceanAlpha, oceanAlpha, u_opacity);
      return;
    } else if (u_debug_mode < 3.5) { // 'grid' -> 3.0
      gl_FragColor = vec4(0.0, 1.0, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 4.5) { // 'mercator' -> 4.0
      gl_FragColor = vec4(grid_uv.x, 1.0 - grid_uv.y, 1.0, u_opacity);
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

  // Multi-band branchless depth interpolation utilizing all theme colors
  float t1 = clamp(depthFactor / 0.2, 0.0, 1.0);
  float t2 = clamp((depthFactor - 0.2) / 0.3, 0.0, 1.0);
  float t3 = clamp((depthFactor - 0.5) / 0.5, 0.0, 1.0);
  vec3 c_reef_shelf = mix(reefHighlight, shelfTurquoise, t1);
  vec3 c_shelf_mid = mix(c_reef_shelf, midOceanBlue, t2);
  vec3 baseDepthColor = mix(c_shelf_mid, deepNavy, t3);

  // ── LAYER 2: CHLOROPHYLL SATELLITE REALISM LAYER ──
  float chlDensity = texture2D(u_chlorophyllTexture, grid_uv).r;
  vec3 chlorophyllGreen = vec3(0.06, 0.42, 0.24);

  // ── LAYER 3: SHALLOW WATER SHELF GLOW ──
  float shelfProximity = 1.0 - depthFactor;
  float shelfGlowFactor = smoothstep(0.6, 1.0, shelfProximity);
  vec3 shallowWaterShelfGlow = shallowWaterShelfGlowColor * shelfGlowFactor;

  // ── LAYER 4: THEMED WAVE HEATMAP COLORS & BASE BLENDING ──
  vec3 waveColor = getThemedWaveColor(displayHeight, u_theme);
  
  // Conformal 3D-Volumetric Blending:
  // Flat water shows detailed natural floor/shelf, rising waves smoothly overlay waveColors
  // while keeping volumetric shadows and reefs highlights fully intact.
  float waveBlend = smoothstep(0.0, 0.25, displayHeight);
  vec3 baseColor = baseDepthColor + shallowWaterShelfGlow;
  vec3 baseWithChl = mix(baseColor, baseColor + chlorophyllGreen * chlDensity, 0.4);
  
  vec3 blendedWaveColor = mix(baseWithChl, waveColor, waveBlend);

  // ── LAYER 5: DIRECTIONAL SWELL LIGHTING ──
  vec2 lightDir = normalize(vec2(-0.5, 0.7)); // light source from northwest/top-left
  float directional = 0.0;
  if (swellMag > 0.05) {
    directional = dot(normalize(swellDir), lightDir);
    directional = directional * 0.5 + 0.5; // [0,1] bias
    // v4.0: swellDir is now unit vector, scale by height for proportional lighting
    directional *= smoothstep(0.1, 3.0, displayHeight);
  }
  vec3 directionalSwellLighting = vec3(0.03, 0.05, 0.08) * directional;

  // ── FINAL PIXEL EQUATION (MANDATORY) ──
  vec3 finalColor = blendedWaveColor + directionalSwellLighting;

  float alpha = u_opacity;
  float maskFade = smoothstep(0.3, 0.8, oceanAlpha);
  alpha *= maskFade;

  // Smoothstep edge feathering to dissolve regional bounds softly
  if (u_edgeFeatherEnabled > 0.5) {
    float edgeDistX = min(grid_uv.x, 1.0 - grid_uv.x);
    float edgeDistY = min(grid_uv.y, 1.0 - grid_uv.y);
    float minEdgeDist = min(edgeDistX, edgeDistY);
    float feather = smoothstep(0.0, 0.18, minEdgeDist);
    alpha *= feather;
  }

  gl_FragColor = vec4(finalColor * alpha, alpha);
}
`;
