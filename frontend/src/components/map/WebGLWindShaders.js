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
  
  vec2 nextPos;
  if (u_zoom > 6.0) {
    nextPos = pos + (offset / u_tile_width);
    nextPos = fract(nextPos);
  } else {
    nextPos = pos + offset;
    nextPos.x = fract(nextPos.x);
    nextPos.y = clamp(nextPos.y, 0.001, 0.999);
  }

  // Respawn logic: randomly drop particles (more likely when slow)
  vec2 seed = (nextPos + v_uv) * u_rand_seed;
  float dropRate = u_drop_rate + speed * u_drop_rate_bump;
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
      float viewportBias = smoothstep(4.0, 7.0, u_zoom) * 0.25;
      
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
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_zoom;  // v3.13.5: for close-zoom density boost
uniform float u_edgeFeatherEnabled;
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
  float p_rand = rand(uv + vec2(0.123, 0.456));
  float keepRate = 1.0;
  if (u_zoom > 4.0) {
    keepRate = mix(1.0, 0.45, smoothstep(4.0, 8.0, u_zoom));
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

  // Edge feathering: compute edgeFade from particle position in wind grid
  float edgeFade = 1.0;
  if (u_edgeFeatherEnabled > 0.5) {
    float distToEdgeX = min(tex_u, 1.0 - tex_u);
    float distToEdgeY = min(tex_v, 1.0 - tex_v);
    float minDistToEdge = min(distToEdgeX, distToEdgeY);
    edgeFade = smoothstep(0.0, 0.18, minDistToEdge);
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
  float zoomBoost = 1.0 + smoothstep(5.0, 11.0, u_zoom) * 1.5;
  
  if (u_zoom > 7.0 && v_speed < 8.5) {
    float speedBoost = smoothstep(8.5, 2.0, v_speed) * smoothstep(7.0, 11.0, u_zoom) * 1.5;
    zoomBoost += speedBoost;
  }
  gl_PointSize = sizeBase * zoomBoost * edgeFade;

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
void main() {
  if (v_debug_color.a > 0.5) {
    gl_FragColor = v_debug_color;
    return;
  }
  // Turn square points into beautiful, soft, anti-aliased circles
  vec2 localCoord = gl_PointCoord - 0.5;
  float dist = length(localCoord);
  if (dist > 0.5) discard;
  
  // Smooth anti-aliasing edge softening
  float soft = smoothstep(0.5, 0.2, dist);
  
  float normalizedSpeed = clamp(v_speed / u_max_speed, 0.0, 1.0);
  vec4 color = texture2D(u_color_ramp, vec2(normalizedSpeed, 0.5));
  
  // Enhance particle contrast over heatmaps:
  // 1. Solid dark outline/rim (98% black) to separate particle from matching heatmap background
  float rim = smoothstep(0.28, 0.46, dist);
  vec3 rgb = mix(color.rgb, vec3(0.0), rim * 0.98);
  
  // 2. High-contrast bright core at the center (75% white) to make the particle pop
  float core = smoothstep(0.18, 0.0, dist);
  rgb = mix(rgb, vec3(1.0), core * 0.75);
  
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
  // v3.20: Theme-aware dynamic alpha floor (0.45 for beach, 0.35 for light, 0.20 for dark)
  // Ensures low wind speeds (0-7 mph) remain visible on all maps while scaling smoothly
  float baseAlpha = 0.20;
  if (u_theme > 1.5) {
    baseAlpha = 0.45;
  } else if (u_theme > 0.5) {
    baseAlpha = 0.35;
  }
  float alpha = u_opacity * (baseAlpha + (1.0 - baseAlpha) * smoothstep(0.0, 10.0, speed));
  if (u_edgeFeatherEnabled > 0.5) {
    float edgeDistX = min(v_uv.x, 1.0 - v_uv.x);
    float edgeDistY = min(v_uv.y, 1.0 - v_uv.y);
    float minEdgeDist = min(edgeDistX, edgeDistY);
    float feather = smoothstep(0.0, 0.18, minEdgeDist);
    alpha *= feather;
  }
  gl_FragColor = vec4(ramp(t, u_theme) * alpha, alpha);
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
