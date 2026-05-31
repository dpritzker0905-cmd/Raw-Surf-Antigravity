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
uniform vec2 u_speed_scale;       // scale-invariant speed scale
uniform float u_rand_seed;        // per-frame random seed for respawn
uniform float u_drop_rate;        // base particle drop rate
uniform float u_drop_rate_bump;   // speed-dependent drop rate increase
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

vec2 lookupWind(vec2 uv) {
  vec4 color = texture2D(u_wind, uv);
  // Decode from [0,1] range back to actual wind values
  return mix(u_wind_min, u_wind_max, vec2(color.r, color.g));
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);

  // Lookup wind at this position
  vec2 wind = lookupWind(pos);
  float speed = length(wind);

  // Advect: move particle by wind velocity (normalized to [0,1] space)
  // v3.11.1: Mercator latitude correction cos(lat) prevents polar distortion
  float lat_rad = (pos.y - 0.5) * 3.141592653589793; // [0,1] [-/2, /2]
  float merc_scale = max(0.1, cos(lat_rad));
  vec2 offset = vec2(wind.x / merc_scale, wind.y) * u_speed_scale;
  pos = pos + offset;

  // Respawn logic: randomly drop particles (more likely when slow)
  vec2 seed = (pos + v_uv) * u_rand_seed;
  float dropRate = u_drop_rate + speed * u_drop_rate_bump;
  float drop = step(1.0 - dropRate, rand(seed));

  // Random new position for respawned particles
  vec2 newPos = vec2(rand(seed + 1.3), rand(seed + 2.1));

  // Out of bounds: wrap X (longitude) for antimeridian, drop Y (latitude)
  pos.x = fract(pos.x);
  float oobY = step(1.0, pos.y) + step(0.0, -pos.y);
  drop = max(drop, step(0.5, oobY));

  pos = mix(pos, newPos, drop);
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
varying float v_speed;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_zoom;  // v3.13.5: for close-zoom density boost

vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}

void main() {
  // Particle UV in state texture
  float col = mod(a_index, u_particles_res);
  float row = floor(a_index / u_particles_res);
  vec2 uv = (vec2(col, row) + 0.5) / u_particles_res;

  vec4 encoded = texture2D(u_particles, uv);
  vec2 pos = decodePos(encoded);

  // Convert [0,1] to [lng, lat] then apply world-copy offset
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, pos.x) + u_lng_offset;
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, pos.y);

  // Speed for coloring
  vec4 windColor = texture2D(u_wind, pos);
  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windColor.r, windColor.g));
  v_speed = length(wind);

  // Convert to Mercator for MapLibre
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;

  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  if (gl_Position.w == 0.0) {
    gl_Position.w = 1.0;
  }
  // v3.13.5: Close-zoom density enhancement — larger particles at high zoom
  // for +20% visual density at the 3 closest zoom levels (≥8)
  float zoomBoost = u_zoom >= 8.0 ? 1.2 : 1.0;
  gl_PointSize = v_speed < 0.5 ? 0.0 : (2.0 + clamp(v_speed / 8.0, 0.0, 3.0)) * zoomBoost;
}`;

export const DRAW_FS = `precision mediump float;
varying float v_speed;
uniform sampler2D u_color_ramp;
uniform float u_max_speed;
void main() {
  float normalizedSpeed = clamp(v_speed / u_max_speed, 0.0, 1.0);
  vec4 color = texture2D(u_color_ramp, vec2(normalizedSpeed, 0.5));
  gl_FragColor = vec4(color.rgb, 1.0);
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
  float lng = mix(u_dataBounds_min.x, u_dataBounds_max.x, a_grid_uv.x) + u_lng_offset;
  float lat = mix(u_dataBounds_min.y, u_dataBounds_max.y, a_grid_uv.y);
  lat = clamp(lat, -85.051129, 85.051129);
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;
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
varying vec2 v_uv;

vec3 ramp(float t, float theme) {
  vec3 calm;
  vec3 breeze;
  vec3 fresh;
  vec3 gale;
  if (theme > 1.5) {
    calm = vec3(0.04, 0.45, 0.40);
    breeze = vec3(0.05, 0.78, 0.70);
    fresh = vec3(1.00, 0.68, 0.30);
    gale = vec3(1.00, 0.95, 0.86);
  } else if (theme > 0.5) {
    calm = vec3(0.78, 0.88, 0.95);
    breeze = vec3(0.25, 0.70, 0.95);
    fresh = vec3(0.18, 0.38, 0.90);
    gale = vec3(0.96, 0.98, 1.00);
  } else {
    calm = vec3(0.00, 0.04, 0.10);
    breeze = vec3(0.00, 0.85, 1.00);
    fresh = vec3(0.95, 0.12, 0.80);
    gale = vec3(1.00, 1.00, 1.00);
  }
  if (t < 0.45) return mix(calm, breeze, t / 0.45);
  if (t < 0.78) return mix(breeze, fresh, (t - 0.45) / 0.33);
  return mix(fresh, gale, (t - 0.78) / 0.22);
}

void main() {
  vec4 encoded = texture2D(u_wind, v_uv);
  vec2 wind = mix(u_wind_min, u_wind_max, encoded.rg);
  float speed = length(wind);
  float t = clamp(speed / 45.0, 0.0, 1.0);
  float alpha = u_opacity * smoothstep(0.4, 4.0, speed);
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
