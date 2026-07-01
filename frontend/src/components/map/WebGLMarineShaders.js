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
uniform float u_edgeFeatherWidth;   // CLAMP SOFTENER: how far the regional edge dissolves (grid-uv); engine widens it when a sub-viewport tile would otherwise show a hard rectangular clamp edge. Default 0.18.
uniform float u_is_estimated;
uniform float u_surfMode;   // 1.0 = Swell↔Surf coastal-band mode: rescale the color ramp to the surf range
uniform float u_time;       // seconds — drives the rating band's subtle living shimmer (free: render loop already runs)
uniform float u_heightAlphaEnabled; // BLEND BOTH: 1.0 on the regional overlay pass → fade near-flat cells so the retained coarse base shows through. Default 0.0 (no change anywhere else).
uniform float u_heightAlphaLo;       // height (m) below which a regional cell is fully translucent
uniform float u_heightAlphaHi;       // height (m) at/above which a regional cell is fully opaque
uniform highp float u_lng_offset;
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

float getSurfT(float h) {
  // Swell↔Surf mode: nearshore BREAKING height, FOCUSED on the surf range surfers actually read at the coast.
  // Densest color resolution in the common 2-8 ft band (waist→overhead), where almost every coastal day lives;
  // surf above ~16 ft (big-wave reefs, rare) saturates at the top. Same color family as the swell ramp — only
  // the height→color mapping changes. 7 levels (ft): 1, 2, 3, 5, 8, 12, 16+.
  if (h < 0.3) {
    return (h / 0.3) * 0.08;                              // 0-1 ft
  } else if (h < 0.6) {
    return 0.08 + ((h - 0.3) / 0.3) * 0.14;               // 1-2 ft
  } else if (h < 0.9) {
    return 0.22 + ((h - 0.6) / 0.3) * 0.16;               // 2-3 ft
  } else if (h < 1.5) {
    return 0.38 + ((h - 0.9) / 0.6) * 0.22;               // 3-5 ft (most-common band, widest color range)
  } else if (h < 2.4) {
    return 0.60 + ((h - 1.5) / 0.9) * 0.20;               // 5-8 ft
  } else if (h < 3.7) {
    return 0.80 + ((h - 2.4) / 1.3) * 0.12;               // 8-12 ft
  } else {
    return 0.92 + clamp((h - 3.7) / 1.3, 0.0, 1.0) * 0.08; // 12-16 ft+
  }
}

vec3 getThemedWaveColor(float h, float theme, float surfMode) {
  // Reuse the existing per-theme ramps (already theme-aware: beach/light/dark) but pick the height->color
  // mapping by mode so the surf coastal band uses the full ramp across the surf range.
  float t = surfMode > 0.5 ? getSurfT(h) : getNonlinearT(h);
  
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

// Surf-quality RATING colormap: a 0-100 score -> one of 7 discrete levels (very_poor -> epic).
// Industry-standard surf-rating palette: red -> orange -> yellow -> green -> teal, with the rare
// Good/Epic in purple. Used by the "surf" toggle's rating overlay (see getRatingColor branch in main).
vec3 getRatingColor(float score) {
  if (score < 14.0) return vec3(0.941, 0.278, 0.420); // very poor  #f0476b
  if (score < 28.0) return vec3(0.961, 0.620, 0.173); // poor       #f59e2c
  if (score < 42.0) return vec3(0.969, 0.816, 0.220); // poor-fair  #f7d038
  if (score < 56.0) return vec3(0.184, 0.816, 0.478); // fair       #2fd07a
  if (score < 70.0) return vec3(0.078, 0.722, 0.651); // fair-good  #14b8a6
  if (score < 84.0) return vec3(0.486, 0.227, 0.929); // good       #7c3aed
  return vec3(0.659, 0.333, 0.969);                    // epic       #a855f7
}

// SMOOTH variant of the rating palette: continuously interpolates between the same 7 industry-standard
// anchor colors instead of snapping to discrete plateaus. The wave texture is LINEAR-filtered, so the score
// is already smooth across space — the OLD hard-step getRatingColor quantized it into blocky bands. This
// mixes through the palette so the coastal band reads as a polished quality gradient (the discrete 7 levels
// still drive the legend + the per-spot glyphs).
vec3 getRatingColorSmooth(float s) {
  vec3 c0 = vec3(0.941, 0.278, 0.420); // very poor  #f0476b
  vec3 c1 = vec3(0.961, 0.620, 0.173); // poor       #f59e2c
  vec3 c2 = vec3(0.969, 0.816, 0.220); // poor-fair  #f7d038
  vec3 c3 = vec3(0.184, 0.816, 0.478); // fair       #2fd07a
  vec3 c4 = vec3(0.078, 0.722, 0.651); // fair-good  #14b8a6
  vec3 c5 = vec3(0.486, 0.227, 0.929); // good       #7c3aed
  vec3 c6 = vec3(0.659, 0.333, 0.969); // epic       #a855f7
  if (s < 14.0) return mix(c0, c1, s / 14.0);
  if (s < 28.0) return mix(c1, c2, (s - 14.0) / 14.0);
  if (s < 42.0) return mix(c2, c3, (s - 28.0) / 14.0);
  if (s < 56.0) return mix(c3, c4, (s - 42.0) / 14.0);
  if (s < 70.0) return mix(c4, c5, (s - 56.0) / 14.0);
  if (s < 84.0) return mix(c5, c6, (s - 70.0) / 14.0);
  return c6;
}

void main() {
  float lng = v_mercator_xy.x * 360.0 - 180.0 - u_lng_offset;
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

  // ── Surf-quality RATING overlay (the "surf" toggle) ──
  // The rating grid packs score/10 into the height channel, so the 0-100 score is waveHeight*10. Colour the
  // coastal band by the 7-level rating palette and return, bypassing the swell-height ramp, the is_estimated
  // transform, and the bathymetry blend below. The normal marine/swell path (u_surfMode <= 0.5) is untouched.
  if (u_surfMode > 0.5) {
    float ratingScore = waveHeight * 10.0;
    if (ratingScore <= 0.5) discard;   // no rideable wave -> no band here

    // Smooth gradient through the 7-level industry palette — no hard-step plateaus, so no blocky bands.
    vec3 ratingColor = getRatingColorSmooth(ratingScore);

    // Gentle living shimmer: a slow, low-amplitude brightness ripple over space+time. Rides the existing
    // per-frame render loop (wave-crest particles already drive u_time) so it costs nothing extra, and is
    // subtle by design (FPS rule) — it makes the band feel alive without strobing.
    float shimmer = 0.05 * sin(v_mercator_xy.x * 520.0 + v_mercator_xy.y * 520.0 - u_time * 1.4)
                  + 0.03 * sin(v_mercator_xy.y * 900.0 + u_time * 0.9);
    ratingColor *= (1.0 + shimmer);

    // Soft alpha: fade in faint (near-flat) cells, dissolve the seaward edge instead of a hard cut, and apply
    // the ocean-mask fade + optional regional edge feather. Premultiplied (matches the ONE/1-SRC_ALPHA blend
    // and the normal path below) — the old branch emitted non-premultiplied color, which over-saturated.
    float bandAlpha = u_opacity * smoothstep(0.5, 4.0, ratingScore) * smoothstep(0.3, 0.8, oceanAlpha);
    if (u_edgeFeatherEnabled > 0.5) {
      float edgeDistX = min(grid_uv.x, 1.0 - grid_uv.x);
      float edgeDistY = min(grid_uv.y, 1.0 - grid_uv.y);
      bandAlpha *= smoothstep(0.0, 0.18, min(edgeDistX, edgeDistY));
    }
    gl_FragColor = vec4(ratingColor * bandAlpha, bandAlpha);
    return;
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
  vec3 waveColor = getThemedWaveColor(displayHeight, u_theme, u_surfMode);
  
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

  // BLEND BOTH (regional-over-coarse composite): on the regional OVERLAY pass, fade near-flat cells to
  // translucent so the retained, faded coarse-global base painted underneath shows through where the regional
  // signal is ~0. Low surf encodes a near-black color on the dark basemap, which read as "the heatmap cleared"
  // when GFS swapped its vivid global-coarse preview for the accurate-but-faint regional tile. Default off
  // (u_heightAlphaEnabled = 0 → factor forced to 1), so every other render path is byte-for-byte unchanged.
  if (u_heightAlphaEnabled > 0.5) {
    alpha *= smoothstep(u_heightAlphaLo, u_heightAlphaHi, displayHeight);
  }

  // Smoothstep edge feathering to dissolve regional bounds softly (width adapts to soften the zoom-out clamp)
  if (u_edgeFeatherEnabled > 0.5) {
    float edgeDistX = min(grid_uv.x, 1.0 - grid_uv.x);
    float edgeDistY = min(grid_uv.y, 1.0 - grid_uv.y);
    float minEdgeDist = min(edgeDistX, edgeDistY);
    float feather = smoothstep(0.0, max(u_edgeFeatherWidth, 0.01), minEdgeDist);
    alpha *= feather;
  }

  gl_FragColor = vec4(finalColor * alpha, alpha);
}
`;
