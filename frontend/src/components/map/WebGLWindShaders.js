/**
 * WebGLWindShaders.js
 * GPU-native shaders for raw wind particle simulation.
 */

export const ADVECT_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const ADVECT_FS = `
precision highp float;
uniform sampler2D u_particles;    // current particle positions (RGBA = x_hi,x_lo,y_hi,y_lo)
uniform sampler2D u_wind;         // wind field texture (RG = u, BA = v)
uniform vec2 u_wind_min;          // min u,v values for decoding
uniform vec2 u_wind_max;          // max u,v values for decoding
uniform vec2 u_wind_res;          // wind grid resolution (cols, rows)
uniform float u_speed_scale;      // scale-invariant speed scale (float for Mercator)
uniform float u_rand_seed;        // per-frame random seed for respawn
uniform float u_drop_rate;        // base particle drop rate
uniform float u_drop_rate_bump;   // speed-dependent drop rate increase
uniform float u_edgeFeatherEnabled; // regional edge feather flag
uniform vec2 u_dataBounds_min;    // regional bounds min [west, south]
uniform vec2 u_dataBounds_max;    // regional bounds max [east, north]
uniform float u_zoom;             // v3.16: current map zoom for viewport-biased respawn
uniform vec4 u_viewport_bounds;   // v3.16: [west, south, east, north] in degrees
uniform vec2 u_tile_origin;       // v3.22: local tile origin for high zoom precision
uniform float u_tile_width;       // v3.22: local tile width for high zoom precision
uniform float u_lowband_bias;     // 2026-07-06: viewport-bias respawn floor in the z3.3-4.69 band (+~10% on-screen presence)
uniform float u_speed_gamma;      // 2026-07-06: speed-contrast gamma; 1.0 = exact linear (physics), >1 damps slow relative to fast
uniform float u_speed_max;        // 2026-07-06: |wind| normalization for the gamma term (data units, from u_wind_max)
uniform float u_vp_density_boost; // 2026-07-18: viewport-respawn density boost at z>=4 (0 = legacy curve)
uniform float u_density_uniform;  // 2026-07-18: bounded drop rate so density stops tracking speed (0 = legacy)
uniform float u_size_monotonic;   // 2026-07-19: mirrors DRAW_VS — the ink budget must use the size actually drawn
uniform float u_calm_marks;       // 2026-07-19: mirrors DRAW_VS calm band + the calm lifetime floor
uniform float u_closezoom_density; // 2026-07-19: close-zoom respawn bias extension (0 = legacy plateau)
varying vec2 v_uv;

// Decode position from 2-channel encoding (16-bit precision per axis)
vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}

vec4 encodePos(vec2 pos) {
  // Encode position into RGBA with sub-pixel precision
  vec2 clamped = clamp(pos, 0.0, 1.0);
  float x_hi = floor(clamped.x * 255.0);
  float x_lo = fract(clamped.x * 255.0);
  float y_hi = floor(clamped.y * 255.0);
  float y_lo = fract(clamped.y * 255.0);
  return vec4(x_hi / 255.0, x_lo, y_hi / 255.0, y_lo);
}

// Pseudo-random hash
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

float mercatorYToLat(float y) {
  float sinhVal = (exp(3.141592653589793 * (1.0 - 2.0 * y)) - exp(-3.141592653589793 * (1.0 - 2.0 * y))) * 0.5;
  return atan(sinhVal) * 180.0 / 3.141592653589793;
}

float latToMercatorY(float lat) {
  float latClamped = clamp(lat, -85.051129, 85.051129);
  float rad = latClamped * 3.141592653589793 / 180.0;
  return (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);
  
  // v3.22: Resolve high-zoom coordinate resolution bottleneck.
  // Use tile-relative coordinates [0, 1] when zoomed in (u_zoom > 6.0).
  vec2 global_pos = (u_zoom > 6.0) ? (u_tile_origin + pos * u_tile_width) : pos;

  // Convert global Mercator coordinates to geographic lng/lat
  float lng = global_pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(global_pos.y);

  // Map to local texture coordinate of u_wind
  float tex_u;
  if (u_dataBounds_min.x > u_dataBounds_max.x) {
    float span = (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x;
    tex_u = mod(lng - u_dataBounds_min.x, 360.0) / span;
  } else {
    tex_u = (lng - u_dataBounds_min.x) / (u_dataBounds_max.x - u_dataBounds_min.x);
  }
  float tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 tex_uv = vec2(tex_u, tex_v);

  // Lookup wind at this position
  vec4 windData = texture2D(u_wind, tex_uv);
  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windData.r, windData.g));
  float speed = length(wind);

  // Negate y for Mercator convention (+y is South, wind.y/v is Northward)
  vec2 windMerc = vec2(wind.x, -wind.y);

  // Advect: move particle by wind velocity (both components scaled by 1/merc_scale)
  float lat_rad = lat * 3.141592653589793 / 180.0;
  float merc_scale = max(0.1, cos(lat_rad));
  vec2 offset = (windMerc / merc_scale) * u_speed_scale;
  // SPEED-CONTRAST GAMMA (2026-07-06): motion is already LINEARLY proportional to |wind| (offset
  // above ∝ the decoded u/v — the webgl-wind lineage physics). gamma > 1.0 additionally damps SLOW
  // particles relative to fast ones (pow(speedNorm, gamma-1): →1 at max speed, <1 below) so speed
  // differences read visibly on screen. gamma == 1.0 is a exact no-op (pure linear preserved).
  float speedNorm = clamp(speed / max(u_speed_max, 1.0), 0.02, 1.0);
  offset *= pow(speedNorm, u_speed_gamma - 1.0);
  
  vec2 nextPos;
  if (u_zoom > 6.0) {
    nextPos = pos + (offset / u_tile_width);
    nextPos = fract(nextPos);
  } else {
    nextPos = pos + offset;
    nextPos.x = fract(nextPos.x);
    nextPos.y = clamp(nextPos.y, 0.001, 0.999);
  }

  // Respawn logic: randomly drop particles.
  vec2 seed = (nextPos + v_uv) * u_rand_seed;
  // INK BUDGET (2026-07-18 EVE-3, user: "some wind particle density is huge, while others is
  // proper"). What the eye reads is INK, not particle count:
  //     ink(speed) ~ mark AREA(speed) x COUNT(speed),  and  COUNT ~ lifetime ~ 1/dropRate.
  //
  // The legacy rule u_drop_rate + speed*u_drop_rate_bump is NOT a bug — measured against the
  // webgl-wind lineage's trail rendering (ink ~ speed/dropRate) it holds ink flat to 1.06x above
  // 4 kn. It is a well-tuned compensator and must not be "simplified" away.
  //
  // The clumping was introduced by THIS SESSION's low-wind size floor (DRAW_VS): it multiplied
  // calm-air mark AREA by up to ~10x — and un-zeroed the sub-0.5 kn marks that legacy had made
  // invisible entirely — without touching their LIFETIME. Measured on a real GFS Gulf field, the
  // point-sprite ink ratio went from 4.4x to 124x. Calm air was drawing ~28x its share of ink.
  //
  // Fix: pay for the enlarged marks in lifetime, so ink stays flat. dropRate is solved from the
  // area the mark will actually be drawn at (the speed-dependent part; DPR and zoom scale every
  // particle equally and so cannot change RELATIVE density). Taking max() with the legacy rule
  // means this can only ever recycle particles SOONER, never hoard them — so the >11 kn regime,
  // long shipped and tuned, is left bit-identical, and only the band the floor inflated changes.
  // Kill: __RAW_DISABLE_WIND_DENSITY_UNIFORM__ (u_density_uniform = 0 -> exact legacy formula).
  float legacyDrop = u_drop_rate + speed * u_drop_rate_bump;
  float sBase = speed < 0.5 ? 0.0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, speed);
  // Mirrors DRAW_VS's floor, INCLUDING its zoom scaling — the ink budget must be computed from the
  // size the mark is actually drawn at, or the compensation is wrong at exactly the zooms where
  // the floor is weakest.
  float floorZoomScale = mix(0.62, 1.0, smoothstep(3.0, 7.0, u_zoom));
  // MONOTONE FLOOR mirror (2026-07-19): flat at sizeBase(10 kn) = 3.073 css px, matching DRAW_VS
  // exactly — the slowness ramp lives on only behind the kill switch. (DPR scales every mark
  // equally and so cannot change RELATIVE density; it stays out of this budget by design.)
  float sFloor = (speed >= 1.0 && speed < 10.0)
    ? (u_size_monotonic > 0.5 ? 3.073 : mix(3.4, 4.2, smoothstep(10.0, 1.0, speed))) * floorZoomScale
    : ((u_calm_marks > 0.5 && speed >= 0.3 && speed < 1.0) ? 2.2 * floorZoomScale : 0.0);
  // The drawn mark is an oriented DASH, not a disc: DRAW_FS narrows the across-wind axis by
  // ~1.8-2.6x, so its true area is well below this square estimate. Using the square here is the
  // conservative direction (it can only over-estimate ink and shorten lifetime slightly).
  float sCss = max(sBase, sFloor);
  // I0 = the ink level the legacy rule already produces at mid speed (~11 kn, sprite 3.4 px),
  // so the two rules agree exactly at the calibration point rather than by taste.
  // DASH-TRUE INK (2026-07-19 night, user: "lighter winds were easier to see before"). The
  // square estimate over-charged the dash by its elongation factor (~2-2.6x at light winds), so
  // 1-8 kn marks were recycled ~2x faster than the pre-arc tuning — fewer simultaneous marks =
  // the visible GAPS in light air. Charging the dash's true area (square / elong, the same curve
  // DRAW_FS narrows by) returns light-wind lifetimes to the legacy pace the never-hoard max()
  // already enforces above ~4 kn. (With the dash killed the mark is round and this is slightly
  // generous — documented, bounded by the calm lifetime floor.)
  float dashElong = mix(1.8, 2.6, smoothstep(10.0, 0.5, speed));
  float inkFlatDrop = (sCss * sCss) / dashElong / 130.0;
  float dropRate = mix(legacyDrop, max(legacyDrop, inkFlatDrop), u_density_uniform);
  // CALM LIFETIME FLOOR (2026-07-19, the dead-zone report's second half). The flat-ink rule
  // recycles floored calm marks after ~15 frames (0.26 s) — calm PATCHES inside a circulation
  // read as emptiness with flickers. Below 4.75 kn (where legacyDrop < 0.04 so never-hoard
  // still holds via the max) lifetime is floored at 25 frames — a bounded, deliberate ink
  // premium (<=1.6x flat, ink ratio stays under the density gate's 3.0) spent exactly where the
  // user watches a low organise. Kill: __RAW_DISABLE_WIND_CALM_MARKS__.
  if (u_calm_marks > 0.5 && speed < 4.75) {
    dropRate = max(legacyDrop, min(dropRate, 0.04));
  }
  float drop = step(1.0 - dropRate, rand(seed));

  // If regional grid and exits bounding box, drop it. For global grid, only drop if it exits latitude bounds.
  bool isOob = false;
  if (u_zoom <= 6.0) {
    isOob = (tex_v < 0.0 || tex_v > 1.0 || (nextPos.y < 0.001 || nextPos.y > 0.999)) ||
            (u_edgeFeatherEnabled > 0.5 && (tex_u < 0.0 || tex_u > 1.0));
  }
  if (isOob) {
    drop = 1.0;
  }

  // Random new position for respawned particles
  vec2 randVal = vec2(rand(seed + 1.3), rand(seed + 2.1));
  vec2 newPos;
  
  if (u_zoom > 6.0) {
    newPos = randVal;
  } else {
    float randLng;
    float randY;
    if (u_edgeFeatherEnabled > 0.5) {
      // Regional grid spawn limits
      float spanX = u_dataBounds_min.x > u_dataBounds_max.x
        ? (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x
        : u_dataBounds_max.x - u_dataBounds_min.x;
      randLng = u_dataBounds_min.x > u_dataBounds_max.x
        ? mod(u_dataBounds_min.x + randVal.x * spanX + 180.0, 360.0) - 180.0
        : mix(u_dataBounds_min.x, u_dataBounds_max.x, randVal.x);
        
      float mercMinY = latToMercatorY(u_dataBounds_max.y); // North
      float mercMaxY = latToMercatorY(u_dataBounds_min.y); // South
      randY = mix(mercMinY, mercMaxY, randVal.y);
    } else {
      // v3.16: Viewport-biased respawning for global grids
      float vpWest  = u_viewport_bounds.x;
      float vpSouth = u_viewport_bounds.y;
      float vpEast  = u_viewport_bounds.z;
      float vpNorth = u_viewport_bounds.w;
      
      float spawnChoice = rand(seed + 3.7);
      // LOW-BAND DENSITY FLOOR (2026-07-06): the stock bias ramp starts at z4, leaving z3.3-4.69
      // nearly unbiased (uniform-global respawn -> sparse on screen). A small viewport-bias floor
      // there lifts on-screen presence ~10% (bias B redirects B of respawns into the padded
      // viewport; at these spans ~0.01 B ≈ +10% relative). Soft edges avoid pops at the band rim.
      float lowBand = smoothstep(3.1, 3.3, u_zoom) * (1.0 - smoothstep(4.69, 4.9, u_zoom));
      // DENSITY AT z>=4 (2026-07-18 EVE-3, user: "closer up zooms around 4 or closer need a
      // little bit more wind density"). Particle COUNT is fixed at init (particleRes^2), so
      // on-screen density is entirely a function of what fraction of respawns land in the
      // viewport. The old ramp only STARTED at z4 and did not reach 0.25 until z7 — so through
      // the whole z4-6 band respawn was still ~uniform-global while the viewport covered a tiny
      // fraction of the world, i.e. most particles were off-screen exactly where the user is
      // reading the field. Start the ramp earlier and take it higher; the global lane still gets
      // (1 - bias) of respawns, so off-viewport coverage never drops to zero.
      // Kill: __RAW_DISABLE_WIND_VIEWPORT_DENSITY__ (u_vp_density_boost = 0 -> legacy curve).
      float legacyBias = smoothstep(4.0, 7.0, u_zoom) * 0.25;
      float boostedBias = smoothstep(3.6, 6.0, u_zoom) * 0.45;
      // CLOSE-ZOOM EXTENSION (2026-07-19): the bias plateaued at 0.45 while the viewport share
      // of the world keeps shrinking with zoom — by z9 most respawns still landed off-screen.
      // Ramps 0.45 -> 0.60 across z6-9. Kill: __RAW_DISABLE_WIND_CLOSEZOOM_DENSITY__.
      boostedBias += u_closezoom_density * smoothstep(6.0, 9.0, u_zoom) * 0.15;
      float mainBias = mix(legacyBias, max(legacyBias, boostedBias), u_vp_density_boost);
      float viewportBias = max(mainBias, u_lowband_bias * lowBand);
      
      if (spawnChoice < viewportBias && vpEast > vpWest) {
        float padLng = (vpEast - vpWest) * 0.15;
        float padLat = (vpNorth - vpSouth) * 0.15;
        randLng = mix(vpWest - padLng, vpEast + padLng, randVal.x);
        float vpMercN = latToMercatorY(clamp(vpNorth + padLat, -85.0, 85.0));
        float vpMercS = latToMercatorY(clamp(vpSouth - padLat, -85.0, 85.0));
        randY = mix(vpMercN, vpMercS, randVal.y);
      } else {
        randLng = randVal.x * 360.0 - 180.0;
        float mercMinY = latToMercatorY(85.0);
        float mercMaxY = latToMercatorY(-80.0);
        randY = mix(mercMinY, mercMaxY, randVal.y);
      }
    }
    newPos = vec2((randLng + 180.0) / 360.0, randY);
  }
  
  pos = mix(nextPos, newPos, drop);
  if (u_zoom <= 6.0) {
    pos.y = clamp(pos.y, 0.001, 0.999);
  }

  gl_FragColor = encodePos(pos);
}`;

export const DRAW_VS = `
attribute float a_index;
uniform sampler2D u_particles;
uniform float u_particles_res;
uniform mat4 u_matrix;
uniform vec2 u_dataBounds_min;   // [west, south] in degrees
uniform vec2 u_dataBounds_max;   // [east, north] in degrees
uniform float u_lng_offset;      // world-copy offset: -360, 0, or +360
uniform vec2 u_tile_origin;       // v3.22: local tile origin for high zoom precision
uniform float u_tile_width;       // v3.22: local tile width for high zoom precision
varying float v_speed;
varying float v_alpha;
varying vec4 v_debug_color;
varying vec2 v_dir;              // 2026-07-18: screen-space wind direction — the mark is ORIENTED
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_zoom;  // v3.13.5: for close-zoom density boost
uniform float u_lowwind_boost;   // 2026-07-18: synoptic low-wind legibility (0 = off, kill switch)
uniform float u_dpr;             // 2026-07-18: devicePixelRatio — gl_PointSize is in DEVICE pixels
uniform float u_size_monotonic;  // 2026-07-19: slower must NEVER draw larger than faster (0 = legacy)
uniform float u_calm_marks;      // 2026-07-19: near-calm air draws small marks, not NOTHING (0 = legacy)
uniform float u_closezoom_density; // 2026-07-19: keepRate floor 0.45->0.70 at z>=8 (0 = legacy cull)
uniform float u_edgeFeatherEnabled;
uniform float u_edge_feather_frac;  // 2026-07-19: feather width as a fraction of grid span (see edgeFade)
uniform float u_debug_mode;

vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}

float mercatorYToLat(float y) {
  float sinhVal = (exp(3.141592653589793 * (1.0 - 2.0 * y)) - exp(-3.141592653589793 * (1.0 - 2.0 * y))) * 0.5;
  return atan(sinhVal) * 180.0 / 3.141592653589793;
}

float latToMercatorY(float lat) {
  float latClamped = clamp(lat, -85.051129, 85.051129);
  float rad = latClamped * 3.141592653589793 / 180.0;
  return (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
}

// Pseudo-random hash
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Particle UV in state texture
  float col = mod(a_index, u_particles_res);
  float row = floor(a_index / u_particles_res);
  vec2 uv = (vec2(col, row) + 0.5) / u_particles_res;

  // v3.20: Reduce particle density at higher zooms to prevent haze and keep landmasses visible
  // Seed rand with uv to prevent GPU precision loss on high index values.
  // CLOSE-ZOOM DENSITY (2026-07-19, user: "some closer up zooms have less animations"). The 0.45
  // cull floor was tuned in the fat-disc era; the oriented dash covers ~40% of that ink, so by
  // z8 the cull discarded 55% of particles that no longer threatened the basemap. Floor raised
  // to 0.70 — land visibility guarded by the dash geometry + the ink budget.
  // Kill: __RAW_DISABLE_WIND_CLOSEZOOM_DENSITY__ (u_closezoom_density = 0 -> the 0.45 floor).
  float p_rand = rand(uv + vec2(0.123, 0.456));
  float keepRate = 1.0;
  if (u_zoom > 4.0) {
    float keepFloor = (u_closezoom_density > 0.5) ? 0.70 : 0.45;
    keepRate = mix(1.0, keepFloor, smoothstep(4.0, 8.0, u_zoom));
  }
  if (p_rand > keepRate) {
    gl_Position = vec4(-2.0, -2.0, -2.0, 1.0);
    return;
  }

  vec4 encoded = texture2D(u_particles, uv);
  vec2 pos = decodePos(encoded);
  
  // v3.22: Resolve high-zoom coordinate resolution bottleneck.
  // Use tile-relative coordinates [0, 1] when zoomed in (u_zoom > 6.0).
  vec2 global_pos = (u_zoom > 6.0) ? (u_tile_origin + pos * u_tile_width) : pos;

  // Convert global Mercator coordinates to geographic lng/lat
  float lng = global_pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(global_pos.y);

  // Map to local texture coordinate of u_wind
  float tex_u;
  if (u_dataBounds_min.x > u_dataBounds_max.x) {
    float span = (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x;
    tex_u = mod(lng - u_dataBounds_min.x, 360.0) / span;
  } else {
    tex_u = (lng - u_dataBounds_min.x) / (u_dataBounds_max.x - u_dataBounds_min.x);
  }
  float tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 tex_uv = vec2(tex_u, tex_v);

  // Speed for coloring
  vec4 windColor = texture2D(u_wind, tex_uv);
  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windColor.r, windColor.g));
  v_speed = length(wind);
  // SCREEN-SPACE wind direction for the oriented mark. Mercator convention: +y is SOUTH on screen
  // while v is NORTHWARD, so the y component is negated — the same flip the advection step uses.
  // Falls back to +x for a genuinely zero vector so normalize() cannot produce NaN.
  v_dir = (v_speed > 1e-4) ? normalize(vec2(wind.x, -wind.y)) : vec2(1.0, 0.0);

  // Edge feathering: compute edgeFade from particle position in wind grid.
  // FEATHER WIDTH IS A UNIFORM NOW (2026-07-19): the hardcoded 0.18 was 18% OF THE GRID SPAN,
  // tuned for regional pilot tiles much larger than the viewport. A viewport-fine grid is
  // approximately THE viewport, so 18% of it lay INSIDE the screen on all four sides — the
  // "clamped wind heatmap" report. The engine now sends an absolute-width fraction
  // (~0.6 deg / span, capped at 0.18) so the fade band sits in the request pad, off-screen.
  float edgeFade = 1.0;
  if (u_edgeFeatherEnabled > 0.5) {
    float distToEdgeX = min(tex_u, 1.0 - tex_u);
    float distToEdgeY = min(tex_v, 1.0 - tex_v);
    float minDistToEdge = min(distToEdgeX, distToEdgeY);
    edgeFade = smoothstep(0.0, max(u_edge_feather_frac, 0.001), minDistToEdge);
  }
  v_alpha = edgeFade;

  // Convert to Web Mercator and apply world-copy offset
  float x = global_pos.x + u_lng_offset / 360.0;
  float y = global_pos.y;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
  // v3.21: Speed-proportional base sizing with zoom-adaptive low-speed boost
  // Calibrated to keep low-speed particles (<= 8.5 kts) highly visible at close zoom
  float sizeBase = v_speed < 0.5 ? 0.0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, v_speed);
  float zoomBoostBase = 1.0 + smoothstep(5.0, 11.0, u_zoom) * 1.5;
  float zoomBoost = zoomBoostBase;

  if (u_zoom > 7.0 && v_speed < 8.5) {
    // v3.21 additive low-speed boost — LEGACY ONLY: it decays with speed faster than sizeBase
    // grows, producing interior inversions in the 3-8 kn band at z8-9 (the enumeration gate
    // found them at ~1% magnitude after the first cap-only fix). The monotone path replaces it
    // with the uniform band LIFT below, which serves the same close-zoom visibility goal.
    float speedBoost = smoothstep(8.5, 2.0, v_speed) * smoothstep(7.0, 11.0, u_zoom) * 1.5;
    zoomBoost += speedBoost * (u_size_monotonic > 0.5 ? 0.0 : 1.0);
  }
  // SIZE MONOTONICITY + FULL DPR CORRECTNESS (2026-07-19, user: "slower wind particles are
  // appearing larger still than some of the faster wind particles"). Two stacked causes, both
  // measured (see windParticleMonotonic.test.js for the enumeration):
  //   1. the low-wind floor RAMPED UP as speed fell (mix 3.4->4.2 by slowness), so 1-8 kn marks
  //      out-drew 8-15 kn marks at EVERY zoom (z6: 1 kn = 4.0 px vs 8 kn = 3.3 px);
  //   2. sizeBase was DPR-BLIND while the floor was DPR-correct, so on a DPR-3 phone every
  //      unfloored (fast) mark rendered at 1/3 physical size — slow-bigger-than-fast was
  //      structural on mobile no matter what curve the floor used.
  // Flow-vis practice is unambiguous: speed is read from trail length and motion; the MARK may
  // grow with speed or stay constant, never shrink. Under u_size_monotonic the whole size path
  // is DPR-correct (physical parity mobile==desktop for every speed, completing what the floor
  // started), the floor is FLAT at sizeBase(10 kn) so it can never invert ordering, and the
  // legacy v3.21 close-zoom low-speed boost is CAPPED at the 10 kn size — slow marks are lifted
  // TO the moderate-wind size at close zoom, never beyond it.
  // Kill: __RAW_DISABLE_WIND_SIZE_MONOTONIC__ (u_size_monotonic = 0 -> yesterday's exact sizing).
  float dprAll = (u_size_monotonic > 0.5) ? max(u_dpr, 1.0) : 1.0;
  gl_PointSize = sizeBase * zoomBoost * edgeFade * dprAll;

  // === SYNOPTIC LOW-WIND LEGIBILITY (2026-07-18 EVE-3, user report: "at very light wind speeds
  // it's hard to tell wind direction, which we need to see when low pressure systems form") ===
  // THE GEOMETRY BUG, not a palette one. DRAW_FS separates a particle from the identically-coloured
  // field beneath it with a rim (dist 0.28-0.46) and a core (dist < 0.18). Those are FRACTIONS OF
  // THE SPRITE, so they only resolve if the sprite is big enough: a 2.5 px point puts the rim band
  // at ~0.45 px and the core at ~0.45 px — both SUB-PIXEL, so the particle rasterises as a flat dot
  // of exactly the field's colour and carries no direction cue at all.
  // And the existing low-speed rescue is gated on u_zoom > 7.0 — i.e. it only fires when zoomed IN,
  // while a forming low is read at SYNOPTIC scale (z3-6), where zoomBoost is 1.0. So the rescue was
  // absent at precisely the speed AND zoom the user needs.
  // Fix: a MINIMUM sprite diameter for slow-but-moving particles at any zoom, sized so the rim and
  // core are >= 1 px and the dot reads as an oriented mark rather than a speck. Truth is preserved —
  // colour still encodes speed exactly; only the MARK's legibility changes.
  // Kill: __RAW_DISABLE_LOWWIND_LEGIBILITY__ (u_lowwind_boost = 0.0).
  // LOW-WIND DIRECTION IS CARRIED BY ELONGATION, NOT BY AREA (2026-07-18 EVE-3 round 5).
  // Rounds 2-4 grew the MARK so the dual-tone casing rings could resolve. That was solving the
  // wrong problem: a round disc conveys ZERO direction information at any size, so growing it
  // improved legibility OF THE MARK while doing nothing for legibility OF THE DIRECTION — and it
  // covered the basemap (user: "particles are too large, you can't see land underneath"). The
  // flow-vis literature is explicit that direction comes from trails/streaks, and that tail LENGTH
  // is the speed cue. In this renderer the fade-buffer trail is proportional to displacement per
  // frame, so it vanishes exactly where it is needed — at low wind.
  // The mark is therefore ORIENTED instead of enlarged: DRAW_FS stretches it along v_dir into a
  // small dash. A 2x6 px dash shows direction and covers ~40% of the ink of the 6.5 px disc it
  // replaces, so land shows through AND the direction reads. The size floor drops back to a
  // modest value whose only job is to keep the dash from going sub-pixel.
  //
  // MOBILE / DPR: gl_PointSize is in DEVICE pixels and this pipeline had NO devicePixelRatio
  // handling anywhere (verified by absence across engine/layer/shaders/init). MapLibre sizes its
  // canvas at DPR, so an "N px" sprite is N/DPR CSS px — every particle physically ~3x smaller on
  // a DPR-3 phone. The floor is expressed in CSS px and multiplied by a clamped [1,3] u_dpr.
  // LOWER BOUND 0.15 -> 1.0 kn. Below ~1 kn the air is genuinely calm, and legacy deliberately
  // drew nothing there (sizeBase is 0 under 0.5 kn). Resurrecting those marks was pure cost: it
  // added ink with no meteorological signal, and at close zoom it was the single largest thing
  // this arc inflated. The band that actually matters for reading a forming low is light-but-real
  // air, not dead calm.
  if (u_lowwind_boost > 0.5 && v_speed >= 1.0 && v_speed < 10.0) {
    float slowness = smoothstep(10.0, 1.0, v_speed);            // 0 at 10 kn -> 1 at 1 kn
    // ZOOM-AWARE FLOOR (2026-07-18 round 5b, user: "the far out zoom is even worse"). The floor is
    // in CSS px and was ZOOM-INVARIANT, but a fixed CSS mark covers vastly more GEOGRAPHY as you
    // zoom out — and a wide view holds far more low-wind cells, so a larger share of the screen
    // gets floored. Both effects compound, which is why the damage was worst at global zoom.
    // Scale the floor down as the view widens: at z3 it lands near the legacy 2.5 px sizeBase
    // (i.e. barely raised at all), reaching full strength only at the inspection zooms where the
    // user is actually reading individual marks. Applied ONLY to this floor — sizeBase is the
    // long-shipped curve and stays untouched, so far-out zoom returns to the original look.
    float zoomScale = mix(0.62, 1.0, smoothstep(3.0, 7.0, u_zoom));
    // Keep this curve in sync with sFloor in ADVECT_FS — they are the same curve, and the density
    // gate asserts they agree (drift between the two stages IS a density bug).
    // NO close-zoom boost on the floor. sizeBase already grows via zoomBoost when zoomed in, so
    // stacking a second close-zoom multiplier here made the floor — whose only job is to stop a
    // mark going sub-pixel — the thing making marks LARGE at exactly the zooms where they were
    // already big enough. The floor stays flat-to-shrinking in CSS px across the whole range.
    // MONOTONE FLOOR (2026-07-19): the slowness ramp (3.4->4.2, larger when SLOWER) inverted the
    // size ordering against 8-15 kn marks at every zoom. Flat at sizeBase(10 kn) = 3.073 css px
    // (2.5 + 2.5*smoothstep(1,30,10)), the floor meets the base curve exactly at the band edge —
    // continuous, and a slower mark can never out-draw a faster one. Legacy ramp kept behind the
    // kill switch.
    float minCssPx = (u_size_monotonic > 0.5 ? 3.073 : mix(3.4, 4.2, slowness)) * zoomScale;
    gl_PointSize = max(gl_PointSize, minCssPx * max(u_dpr, 1.0) * edgeFade);
  }
  // CALM MARKS (2026-07-19, user: "particle dead zones in the gulf, when we have low pressure
  // spinning"). sizeBase is 0 below 0.5 kn and the low-wind floor starts at 1.0 — so near-calm
  // air rendered as NOTHING, and a circulation core (smeared wide by coarse data) became a
  // visible HOLE in the animation. A small flat floor for 0.3-1.0 kn draws that air as faint
  // small dashes: 2.2 css px < the 3.073 monotone floor, so size ordering stays intact, and the
  // ink budget below pays for the marks in lifetime. Dead-flat air (<0.3 kn) still draws nothing.
  // Kill: __RAW_DISABLE_WIND_CALM_MARKS__ (u_calm_marks = 0 -> the legacy hole).
  if (u_calm_marks > 0.5 && v_speed >= 0.3 && v_speed < 1.0) {
    float calmZoomScale = mix(0.62, 1.0, smoothstep(3.0, 7.0, u_zoom));
    gl_PointSize = max(gl_PointSize, 2.2 * calmZoomScale * max(u_dpr, 1.0) * edgeFade);
  }

  // MONOTONE CLOSE-ZOOM LIFT (replaces the v3.21 boost when u_size_monotonic). The whole
  // sub-10 kn band is blended TOWARD the 10 kn size by an s-INDEPENDENT factor — monotone by
  // construction (a monotone curve mixed with a constant stays monotone), while the v3.21 goal
  // (slow marks readable when zoomed in) is preserved: at z11 a 2 kn mark draws at ~7.5 px vs
  // the 10 kn mark's 7.7, instead of OVER-drawing it at 10.4. The min() guard also caps any
  // residual overshoot at exactly the 10 kn size, so a slower mark can never exceed it.
  if (u_size_monotonic > 0.5 && v_speed < 10.0 && v_speed >= 1.0) {
    // lower bound 1.0, NOT 0.5: the calm-marks band above must stay SMALL — lifting dead-calm
    // air to the 10 kn size at close zoom would draw calm as prominently as moderate wind.
    float cap10 = 3.073 * zoomBoostBase * max(u_dpr, 1.0) * edgeFade;
    float lift = smoothstep(7.0, 11.0, u_zoom) * 0.85;
    gl_PointSize = mix(min(gl_PointSize, cap10), cap10, lift);
  }

  // Debug mode colors
  if (u_debug_mode > 0.5) {
    if (u_debug_mode < 5.5) v_debug_color = vec4(uv.x, uv.y, 0.0, 1.0);
    else if (u_debug_mode < 6.5) v_debug_color = vec4(pos.x, pos.y, 0.0, 1.0);
    else if (u_debug_mode < 7.5) v_debug_color = vec4(wind.x * 0.5 + 0.5, wind.y * 0.5 + 0.5, 0.0, 1.0);
    else v_debug_color = vec4(1.0, 0.0, 0.0, 1.0);
  } else {
    v_debug_color = vec4(0.0);
  }
}`;

export const DRAW_FS = `precision mediump float;
varying float v_speed;
varying float v_alpha;
varying vec4 v_debug_color;
uniform sampler2D u_color_ramp;
uniform float u_max_speed;
uniform float u_theme;       // 2026-07-18: 0=dark 1=light 2=beach — the particle program never had it
uniform float u_theme_rim;   // 1 = theme-aware rim/core, 0 = legacy black/white (kill switch)
uniform float u_dash;        // 2026-07-18: 1 = oriented dash, 0 = legacy round mark (kill switch)
uniform float u_field_opacity; // heatmap u_opacity — the field is SEMI-TRANSPARENT
uniform float u_basemap_y;     // linear luminance of the basemap showing through it
varying vec2 v_dir;          // screen-space wind direction from DRAW_VS
void main() {
  if (v_debug_color.a > 0.5) {
    gl_FragColor = v_debug_color;
    return;
  }
  // ORIENTED DASH (2026-07-18 round 5). The point sprite is a square; rotate its local coordinate
  // into the WIND frame and squash the across-wind axis, so the resulting mark is a dash aligned
  // with the flow instead of a direction-less disc. Everything downstream (casing rings, alpha)
  // then works in that frame unchanged, because dist remains a normalised radius.
  // ELONGATION is capped at low speed rather than growing without bound: a very long dash at
  // near-calm would imply motion that is not there, and truth outranks legibility here.
  // Kill: __RAW_DISABLE_WIND_DASH__ (u_dash = 0 -> the legacy round mark).
  vec2 localCoord = gl_PointCoord - 0.5;
  if (u_dash > 0.5) {
    vec2 d = normalize(v_dir);
    vec2 along = vec2(dot(localCoord, d), dot(localCoord, vec2(-d.y, d.x)));
    // NARROW the across-wind axis rather than lengthening the along-wind one. Stretching along
    // would push the mark past the point sprite's own square and CLIP it into a rectangle; and it
    // would grow the mark, which is the opposite of what is wanted. Narrowing keeps the dash
    // inside the sprite, keeps its length equal to the sprite, and cuts area by ~1/elong — so the
    // basemap shows through MORE than with the round mark it replaces.
    // 2.6:1 at the slow end easing to 1.8:1 once real motion supplies its own streak.
    float elong = mix(1.8, 2.6, smoothstep(10.0, 0.5, v_speed));
    localCoord = vec2(along.x, along.y * elong);
  }
  float dist = length(localCoord);
  if (dist > 0.5) discard;
  
  // Smooth anti-aliasing edge softening
  float soft = smoothstep(0.5, 0.2, dist);
  
  float normalizedSpeed = clamp(v_speed / u_max_speed, 0.0, 1.0);
  vec4 color = texture2D(u_color_ramp, vec2(normalizedSpeed, 0.5));
  
  // Enhance particle contrast over heatmaps. THE STRUCTURAL PROBLEM (2026-07-18 EVE-3, user
  // report: "wind animations are hard to see as they blend too much with their heatmap colors"):
  // the particle and the field beneath it sample the SAME ramp at the SAME normalised speed —
  // texture2D(u_color_ramp, v_speed/u_max_speed) here vs ramp(speed/u_max_speed, u_theme) in
  // HEATMAP_FS — so a particle's colour is IDENTICAL to the pixel behind it BY CONSTRUCTION. No
  // palette edit can fix that; only a luminance separation can, which is what rim+core are for.
  //
  // THE GAP: rim/core were FIXED black/white, and this program was the one wind program that never
  // received u_theme (the engine bound it to heatmapProgram only). Tuned against the dark theme,
  // they invert in light mode — there the field ramp is DEEP NAVY/TEAL on a LIGHT basemap, so a
  // 98%-black rim is camouflage against the very field it must separate from. Beach's bright
  // coral/yellow field washes out the white core for the same reason, mirrored.
  // Now theme-aware: the rim always runs AWAY from the local field's luminance.
  // Kill: __RAW_DISABLE_THEMED_PARTICLE_RIM__ (u_theme_rim = 0.0 -> the legacy black/white pair).
  // DUAL-TONE CASING (2026-07-18 EVE-3 round 2 — the cartographic halo/casing technique).
  // A PER-THEME CONSTANT rim was still wrong. Measured contrast of the shipped rim against the
  // field colour it must separate from, per ramp stop (scripts/probe_wind_contrast.js):
  //   dark  worst 5.48:1 @39kn · light worst 3.78:1 @21kn · beach worst 3.30:1 @39kn
  // The light ramp's luminance is NON-MONOTONIC — it PEAKS at the 21 kn gold (Y=0.460) — so a
  // fixed near-white rim has the least headroom exactly in the common moderate-wind band. That is
  // the "still hard to see at SOME wind speeds" report, and it is not fixable by choosing a better
  // constant: a MID-luminance field contrasts poorly against BOTH poles at once.
  //
  // The fix is the technique mapmakers use for labels/lines over arbitrary terrain: give the mark
  // its OWN high-contrast edge. An outer ring and an inner ring at OPPOSITE luminance poles put a
  // ~21:1 boundary INSIDE the mark, so legibility stops depending on the field's luminance at all.
  // The orientation flips on the LOCAL field luminance (APCA coefficients) so the OUTER ring is
  // always the one opposing the field — that also makes the rule self-theming: the dark theme's
  // neon ramp is BRIGHT (Y 0.72-0.85) so it resolves to the dark-outer/light-inner pair the dark
  // theme was originally tuned with, while light's dark navy ramp resolves to the inverse.
  // The BODY keeps the speed colour: truth (colour == speed) is never traded away.
  // Kill: __RAW_DISABLE_THEMED_PARTICLE_RIM__ -> the legacy fixed black-rim/white-core pair.
  vec3 rgb = color.rgb;
  if (u_theme_rim > 0.5) {
    // THE POLE MUST BE CHOSEN FROM THE COMPOSITED BACKGROUND, NOT THE RAMP COLOUR
    // (2026-07-18 round 6 — the root behind "light mode is really hard to see").
    // The wind FIELD is semi-transparent: HEATMAP_FS draws it at
    //     u_opacity * (baseAlpha + (1-baseAlpha)*smoothstep(0,10,speed))
    // which in light mode is only ~0.23 at low wind. So the surface a particle actually sits on is
    // the ramp composited OVER THE BASEMAP — and in light mode that composite is BRIGHT (measured
    // bgY 0.27-0.56) even though the ramp itself is dark navy (rampY 0.03-0.20).
    // Choosing from the ramp alone therefore picked WHITE for 6 of 8 light-mode speeds, against a
    // bright background: measured 1.71:1 at 0 kn where 12.25:1 was available. Every contrast figure
    // this arc produced before now shares that error — they compared against a background that is
    // not what is on screen.
    // Linear luminance is still the right space (contrast-to-white equals contrast-to-black at
    // Y = 0.179 exactly), but it must be evaluated on the COMPOSITE.
    vec3 fieldLin = pow(color.rgb, vec3(2.2));
    float rampY = dot(fieldLin, vec3(0.2126729, 0.7151522, 0.0721750));
    float baseA = 0.28; // sync with HEATMAP_FS baseAlpha (dark raised 0.20->0.28, 2026-07-19)
    if (u_theme > 1.5) { baseA = 0.45; } else if (u_theme > 0.5) { baseA = 0.35; }
    float fieldA = u_field_opacity * (baseA + (1.0 - baseA) * smoothstep(0.0, 7.0, v_speed));
    float fieldY = mix(u_basemap_y, rampY, clamp(fieldA, 0.0, 1.0));
    float fieldIsBright = step(0.179, fieldY);
    float outerL = mix(1.0, 0.0, fieldIsBright);   // opposes the field
    float innerL = 1.0 - outerL;                   // opposes the outer ring
    float outer = smoothstep(0.38, 0.50, dist);
    float inner = smoothstep(0.38, 0.26, dist) * smoothstep(0.10, 0.20, dist);
    rgb = mix(rgb, vec3(innerL), inner * 0.92);
    rgb = mix(rgb, vec3(outerL), outer * 0.98);
  } else {
    float rim = smoothstep(0.28, 0.46, dist);
    rgb = mix(rgb, vec3(0.0), rim * 0.98);
    float core = smoothstep(0.18, 0.0, dist);
    rgb = mix(rgb, vec3(1.0), core * 0.75);
  }
  
  // v3.20: Use color.a from the theme color ramp LUT to regulate particle transparency
  float alpha = v_alpha * soft * color.a;
  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

export const HEATMAP_VS = `
attribute vec2 a_grid_uv;
uniform mat4 u_matrix;
uniform vec2 u_dataBounds_min;
uniform vec2 u_dataBounds_max;
uniform float u_lng_offset;
varying vec2 v_uv;
void main() {
  v_uv = a_grid_uv;
  float east = u_dataBounds_max.x < u_dataBounds_min.x ? u_dataBounds_max.x + 360.0 : u_dataBounds_max.x;
  float lng = mix(u_dataBounds_min.x, east, a_grid_uv.x);
  if (lng > 180.0) {
    lng -= 360.0;
  }
  lng += u_lng_offset;
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, a_grid_uv.y);
  float clampedLat = clamp(lat, -85.0511, 85.0511);
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(clampedLat)) + 1.0 / cos(radians(clampedLat))) / 3.141592653589793) / 2.0;
  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
}`;

export const HEATMAP_FS = `
precision mediump float;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_opacity;
uniform float u_theme;
uniform float u_max_speed;
uniform float u_edgeFeatherEnabled;
uniform float u_edge_feather_frac;  // 2026-07-19: absolute-width feather (see DRAW_VS edgeFade)
uniform sampler2D u_color_ramp;     // 2026-07-19: the SAME Beaufort LUT the particles use
uniform float u_field_lut;          // 1 = sample the LUT (default), 0 = legacy inline 7-stop ramp
uniform float u_debug_mode;
varying vec2 v_uv;

// v3.15: Premium 7-stop Windy/Ventusky-grade color ramp per theme
vec3 ramp(float t, float theme) {
  // Dark theme: deep navy > teal > cyan > green-yellow > amber > hot red > white/magenta
  // Light theme: pale ice > sky blue > medium blue > indigo > purple > rose > near-white
  // Beach theme: deep sea > warm teal > seafoam > warm amber > tangerine > coral > cream
  vec3 c0, c1, c2, c3, c4, c5, c6;
  if (theme > 1.5) {
    // Beach: Warm sand -> tropical seafoam -> sunny lime -> amber -> tangerine -> coral -> sunset purple
    c0 = vec3(0.92, 0.82, 0.60);  // warm sandy gold
    c1 = vec3(0.30, 0.85, 0.75);  // bright tropical seafoam
    c2 = vec3(0.65, 0.88, 0.35);  // sunny lime-yellow
    c3 = vec3(0.95, 0.70, 0.20);  // warm amber
    c4 = vec3(0.98, 0.45, 0.20);  // tangerine orange
    c5 = vec3(0.90, 0.25, 0.40);  // deep coral/rose
    c6 = vec3(0.60, 0.20, 0.65);  // sunset purple
  } else if (theme > 0.5) {
    // Light: Mint green -> Lime green -> Warm yellow -> Vibrant orange -> Deep red -> Rich purple -> Deep violet
    c0 = vec3(0.55, 0.82, 0.68);  // pale mint green
    c1 = vec3(0.68, 0.85, 0.38);  // bright lime-green
    c2 = vec3(0.92, 0.88, 0.30);  // warm yellow
    c3 = vec3(0.96, 0.65, 0.15);  // vibrant orange
    c4 = vec3(0.92, 0.32, 0.20);  // deep red
    c5 = vec3(0.78, 0.18, 0.52);  // rich purple
    c6 = vec3(0.55, 0.10, 0.65);  // deep violet
  } else {
    // Dark: Rich blue-teal -> bright teal -> cyan -> green-yellow -> amber -> hot red -> white-magenta
    c0 = vec3(0.05, 0.25, 0.42);  // richer blue-teal (better base visibility)
    c1 = vec3(0.03, 0.48, 0.60);  // bright teal
    c2 = vec3(0.05, 0.75, 0.90);  // vivid cyan
    c3 = vec3(0.40, 0.85, 0.45);  // green-yellow
    c4 = vec3(0.95, 0.72, 0.15);  // amber
    c5 = vec3(0.95, 0.25, 0.18);  // hot red
    c6 = vec3(1.00, 0.80, 0.90);  // white-magenta
  }
  // 7 stops with smooth transitions across Beaufort-inspired thresholds
  if (t < 0.12) return mix(c0, c1, smoothstep(0.0, 0.12, t));
  if (t < 0.25) return mix(c1, c2, smoothstep(0.12, 0.25, t));
  if (t < 0.42) return mix(c2, c3, smoothstep(0.25, 0.42, t));
  if (t < 0.58) return mix(c3, c4, smoothstep(0.42, 0.58, t));
  if (t < 0.78) return mix(c4, c5, smoothstep(0.58, 0.78, t));
  return mix(c5, c6, smoothstep(0.78, 1.0, t));
}

void main() {
  if (u_debug_mode > 0.5) {
    if (u_debug_mode < 1.5) { // 'uv' -> 1.0
      gl_FragColor = vec4(v_uv.x, v_uv.y, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 2.5) { // 'mask' -> 2.0
      gl_FragColor = vec4(0.0, 0.0, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 3.5) { // 'grid' -> 3.0
      gl_FragColor = vec4(0.0, 1.0, 0.0, u_opacity);
      return;
    } else if (u_debug_mode < 4.5) { // 'mercator' -> 4.0
      gl_FragColor = vec4(v_uv.x, 1.0 - v_uv.y, 1.0, u_opacity);
      return;
    }
  }
  vec4 encoded = texture2D(u_wind, v_uv);
  vec2 wind = mix(u_wind_min, u_wind_max, encoded.rg);
  float speed = length(wind);
  float t = clamp(speed / max(u_max_speed, 1.0), 0.0, 1.0);
  // v3.20: Theme-aware dynamic alpha floor (0.45 beach, 0.35 light, dark 0.20 -> 0.28 on
  // 2026-07-19: measured calm-band screen delta in dark was 26-44/765 — sub-visible. MUST stay
  // in sync with DRAW_FS's casing baseA and windParticleContrast.test.js's fieldAlpha mirror:
  // three sites, one constant set.
  float baseAlpha = 0.28;
  if (u_theme > 1.5) {
    baseAlpha = 0.45;
  } else if (u_theme > 0.5) {
    baseAlpha = 0.35;
  }
  // Ramp saturates at 7 kn, not 10 (2026-07-19 night, user: light winds not visible). The field
  // is the AREA signal for light air — at the old 10 kn ramp a 3-5 kn breeze sat at 19-27% of
  // full alpha and read as bare basemap. 7 kn lifts 3 kn +19% and 5 kn +35%; >=7 kn unchanged.
  // SYNC: DRAW_FS casing fieldA + windParticleContrast fieldAlpha mirror use the same 7.0.
  float alpha = u_opacity * (baseAlpha + (1.0 - baseAlpha) * smoothstep(0.0, 7.0, speed));
  if (u_edgeFeatherEnabled > 0.5) {
    float edgeDistX = min(v_uv.x, 1.0 - v_uv.x);
    float edgeDistY = min(v_uv.y, 1.0 - v_uv.y);
    float minEdgeDist = min(edgeDistX, edgeDistY);
    float feather = smoothstep(0.0, max(u_edge_feather_frac, 0.001), minEdgeDist);
    alpha *= feather;
  }
  // FIELD == LUT (2026-07-19, the palette split). Round 3 Beaufort-anchored the PARTICLE LUT
  // (13 stops in KNOTS — a colour change means a named sea-state change) but this shader kept
  // its own 7-stop ramp keyed to FRACTIONS of the data max: the field's colours stretched with
  // whatever max the grid had, the 0-21 kn band (where nearly all weather lives) collapsed into
  // ~1.5 hue bands (the "flat wash" / "needs a longer range of spectrum" report), and the field
  // no longer matched the LUT that DRAW_FS's composited-background casing math assumes it sits
  // on. windParticleContrast.test.js has modelled the field FROM the LUT all along — the gate
  // was right, this shader was wrong. Sampling the LUT restores one palette everywhere: ~6
  // distinct hue bands below 21 kn in every theme, field == particle == legend convention.
  // Alpha keeps THIS shader's formula (field transparency is a separate, tuned contract).
  // Kill: __RAW_DISABLE_WIND_FIELD_LUT__ (u_field_lut = 0 -> the legacy inline ramp above).
  vec3 fieldRgb = (u_field_lut > 0.5)
    ? texture2D(u_color_ramp, vec2(t, 0.5)).rgb
    : ramp(t, u_theme);
  gl_FragColor = vec4(fieldRgb * alpha, alpha);
}`;

export const SCREEN_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const SCREEN_FS = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_screen, v_uv);
  // v3.12.2: FBO uses RGB-fade (alpha=1.0), so derive alpha from brightness.
  // Black = transparent, bright = opaque. Creates proper vapor trail effect.
  float brightness = max(color.r, max(color.g, color.b));
  gl_FragColor = vec4(color.rgb, brightness * u_opacity);
}`;

export const FADE_FS = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_fade;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_screen, v_uv);
  // v3.12.2 CRITICAL FIX: Fade RGB, keep alpha=1.0 (mapbox/webgl-wind technique).
  // Fading alpha causes compound decay invisible trails.
  // Fading RGB creates visible dimming premultiplied blend makes black = transparent.
  gl_FragColor = vec4(floor(color.rgb * 255.0 * u_fade) / 255.0, 1.0);
}`;
