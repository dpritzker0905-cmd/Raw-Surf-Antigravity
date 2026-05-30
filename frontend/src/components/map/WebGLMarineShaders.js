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
  // v5.5: Negate y for Mercator convention. Geographic +v=northward, but
  // Mercator +y=southward (y=0 is North Pole). Without this flip, the N-S
  // component of all wave advection is inverted (e.g. ENE swell travels
  // WNW instead of WSW off Florida).
  waveVec.y = -waveVec.y;
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
attribute highp float a_vertex_id;       // 0 to (numParticles*6 - 1), six vertices per particle
uniform sampler2D u_particles;     // particle position texture (RG=x, BA=y)
uniform sampler2D u_waveTexture;   // wave vector + height texture (R=u, G=v, B=height, A=period)
uniform sampler2D u_oceanMaskTexture; // land/ocean binary mask
uniform float u_particles_res;     // resolution of position texture
uniform mat4 u_matrix;             // MapLibre projection matrix
uniform vec2 u_dataBounds_min;     // bounds [west, south]
uniform vec2 u_dataBounds_max;     // bounds [east, north]
uniform float u_time;              // elapsed time in seconds
uniform float u_zoom;              // map zoom level
uniform float u_merc_offset;       // world-copy offset (-1.0, 0.0, or +1.0)
uniform float u_debug_mode;        // debug mode selector
uniform vec2 u_viewport;           // v5.3: canvas size in device pixels
uniform float u_device_pixel_ratio; // v5.3: DPR for CSS pixel correction

varying highp float v_alpha;
varying highp float v_wave_height;
varying highp vec2 v_local_uv;     // v5.3: quad local coords [-1,1] (replaces gl_PointCoord)
varying highp float v_phase;       // wave-train phase for rolling whitewater
varying highp float v_period_norm; // normalized period [0=short choppy, 1=long swell]
varying highp float v_whitecap;    // v5.3: whitecap foam strength (0=ripple only, 1=full whitecap)
varying highp vec4 v_debug_color;

float mercatorYToLat(float y) {
  float sinhVal = (exp(3.141592653589793 * (1.0 - 2.0 * y)) - exp(-3.141592653589793 * (1.0 - 2.0 * y))) * 0.5;
  return atan(sinhVal) * 180.0 / 3.141592653589793;
}

void main() {
  // === v5.3: QUAD RIBBON EXPANSION ===
  // 6 vertices per particle (2 triangles). Vertex ID encodes both particle and corner.
  float particleIndex = floor(a_vertex_id / 6.0);
  float cornerIndex = a_vertex_id - particleIndex * 6.0;

  // Map corner index to local quad UV: tri1=(0,1,2) tri2=(3,4,5)
  // 0→BL(-1,-1) 1→BR(1,-1) 2→TL(-1,1) 3→TL(-1,1) 4→BR(1,-1) 5→TR(1,1)
  vec2 cornerUV;
  if (cornerIndex < 0.5) cornerUV = vec2(-1.0, -1.0);
  else if (cornerIndex < 1.5) cornerUV = vec2(1.0, -1.0);
  else if (cornerIndex < 2.5) cornerUV = vec2(-1.0, 1.0);
  else if (cornerIndex < 3.5) cornerUV = vec2(-1.0, 1.0);
  else if (cornerIndex < 4.5) cornerUV = vec2(1.0, -1.0);
  else cornerUV = vec2(1.0, 1.0);

  v_local_uv = cornerUV;

  // Decode particle position from texture
  float col = mod(particleIndex, u_particles_res);
  float row = floor(particleIndex / u_particles_res);
  vec2 p_uv = (vec2(col, row) + 0.5) / u_particles_res;

  vec4 encodedPos = texture2D(u_particles, p_uv);
  vec2 pos = vec2(
    encodedPos.r + encodedPos.g / 255.0,
    encodedPos.b + encodedPos.a / 255.0
  );

  float lng = pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(pos.y);

  float tex_u = (lng - u_dataBounds_min.x) / (u_dataBounds_max.x - u_dataBounds_min.x);
  float tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 tex_uv = vec2(tex_u, tex_v);

  vec4 waveData = texture2D(u_waveTexture, tex_uv);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  // v5.5: Negate y for Mercator convention (geographic +v=north, Mercator +y=south).
  // Without this, the N-S component of wave travel direction is inverted.
  waveVec.y = -waveVec.y;
  float waveHeight = waveData.b * 10.0;
  v_wave_height = waveHeight;
  float oceanFlag = texture2D(u_oceanMaskTexture, tex_uv).r;

  float particleHash = fract(sin(particleIndex * 12.9898) * 43758.5453);

  bool bypassDiscard = (u_debug_mode > 7.5);

  bool isNan = !(pos.x >= 0.0 || pos.x < 0.0) ||
               !(pos.y >= 0.0 || pos.y < 0.0) ||
               !(waveHeight >= 0.0 || waveHeight < 0.0) ||
               !(waveVec.x >= 0.0 || waveVec.x < 0.0) ||
               !(waveVec.y >= 0.0 || waveVec.y < 0.0);

  bool isOob = (tex_u < 0.0 || tex_u > 1.0 || tex_v < 0.0 || tex_v > 1.0);

  // v5.9: Raised discard threshold to 0.10m to match infobox low-energy suppression.
  // Trace-level waves (especially Swell 2) have unreliable directions — no animation.
  if (!bypassDiscard && (waveHeight < 0.10 || length(waveVec) < 0.02 || oceanFlag < 0.3 || isNan || isOob)) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0; v_phase = 0.0; v_period_norm = 0.5; v_whitecap = 0.0;
    v_debug_color = vec4(0.0);
    return;
  }

  // === v5.8: AGGRESSIVE ZOOM-DENSITY CURVE ===
  // zoom 2 → ~12%, zoom 4-5 → ~25%, zoom 7-8 → ~55%, zoom 10+ → ~90%
  float baseVisibility = mix(0.12, 0.90, smoothstep(2.0, 10.0, u_zoom));
  // Height boost: big waves survive culling even at far zoom, but capped
  float heightBoost = smoothstep(1.0, 4.0, waveHeight) * mix(0.02, 0.10, smoothstep(5.0, 10.0, u_zoom));
  float densityThreshold = clamp(baseVisibility + heightBoost, 0.08, 0.95);

  if (!bypassDiscard && particleHash > densityThreshold) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0; v_phase = 0.0; v_period_norm = 0.5; v_whitecap = 0.0;
    v_debug_color = vec4(0.0);
    return;
  }

  // Debug mode colors
  if (u_debug_mode > 0.5) {
    if (u_debug_mode < 5.5) v_debug_color = vec4(p_uv.x, p_uv.y, 0.0, 1.0);
    else if (u_debug_mode < 6.5) v_debug_color = vec4(pos.x, pos.y, 0.0, 1.0);
    else if (u_debug_mode < 7.5) v_debug_color = vec4(waveVec.x * 0.5 + 0.5, waveVec.y * 0.5 + 0.5, 0.0, 1.0);
    else v_debug_color = vec4(1.0, 0.0, 0.0, 1.0);
  } else {
    v_debug_color = vec4(0.0);
  }

  // === v5.4: STABILIZED SCREEN-SPACE DIRECTION ===
  // Higher magnitude threshold prevents jittery near-zero directions
  vec2 dir = length(waveVec) > 0.01 ? normalize(waveVec) : vec2(1.0, 0.0);

  vec2 vertexPos = pos;
  vertexPos.x += u_merc_offset;
  vec4 clipPos = u_matrix * vec4(vertexPos.x, vertexPos.y, 0.0, 1.0);

  // Larger eps (50×) for more stable screen-space direction across frames
  float eps = 1.0 / (256.0 * exp2(u_zoom)) * 50.0;
  vec2 offsetMerc = vertexPos + dir * eps;
  vec4 clipPosOffset = u_matrix * vec4(offsetMerc.x, offsetMerc.y, 0.0, 1.0);

  // Convert to pixel space for direction computation
  vec2 ndc0 = clipPos.xy / max(clipPos.w, 0.001);
  vec2 ndc1 = clipPosOffset.xy / max(clipPosOffset.w, 0.001);
  vec2 pixel0 = (ndc0 + 1.0) * 0.5 * u_viewport;
  vec2 pixel1 = (ndc1 + 1.0) * 0.5 * u_viewport;

  // Stabilized: require at least 2 device pixels of delta for valid direction
  vec2 pixelDelta = pixel1 - pixel0;
  vec2 waveDir = length(pixelDelta) > 2.0
    ? normalize(pixelDelta)
    : vec2(1.0, 0.0);
  vec2 crestDir = vec2(-waveDir.y, waveDir.x); // perpendicular = crest axis

  // === v5.3: INDEPENDENT CREST LENGTH AND THICKNESS (CSS pixels) ===
  float sizeEnergy = smoothstep(0.1, 4.0, waveHeight);
  float smallBoost = (1.0 - smoothstep(0.5, 1.5, waveHeight));

  // Crest LENGTH: 36-80 CSS px total (halfLength = 18-40)
  float halfLength = mix(18.0, 40.0, sizeEnergy) + smallBoost * 6.0;

  // Crest THICKNESS: 6-16 CSS px total (halfThickness = 3-8)
  float halfThickness = mix(3.0, 8.0, sizeEnergy) + smallBoost * 2.0;

  // Zoom scaling (gentler)
  float zoomScale = smoothstep(2.0, 12.0, u_zoom) * 0.6 + 0.4;
  halfLength *= zoomScale;
  halfThickness *= zoomScale;

  // Per-particle size variation
  halfLength *= 0.85 + particleHash * 0.3;
  halfThickness *= 0.9 + particleHash * 0.2;

  // Guaranteed minimums (CSS pixels)
  halfLength = max(halfLength, 16.0);
  halfThickness = max(halfThickness, 2.5);

  // Convert CSS pixels to device pixels
  float dpr = max(u_device_pixel_ratio, 1.0);
  float deviceHalfLength = halfLength * dpr;
  float deviceHalfThickness = halfThickness * dpr;

  // === OFFSET QUAD CORNER IN PIXEL SPACE, CONVERT BACK TO CLIP ===
  vec2 cornerPixel = pixel0
    + crestDir * cornerUV.x * deviceHalfLength
    + waveDir * cornerUV.y * deviceHalfThickness;

  vec2 cornerNdc = cornerPixel / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(cornerNdc * clipPos.w, clipPos.z, clipPos.w);

  // === v5.8: DEEP-WATER PERIOD SPACING + WAVE-TRAIN ENVELOPE ===
  // L ≈ g·T²/(2π) → spatialFreq ∝ 1/T². Cap for visual range.
  float modelPeriod = waveData.a * 20.0;
  float derivedPeriod = 6.0 + waveHeight * 2.0;
  float periodVal = modelPeriod > 0.5 ? modelPeriod : derivedPeriod;

  float periodNorm = smoothstep(4.0, 18.0, periodVal);
  v_period_norm = periodNorm;

  float spatialFreq = 800.0 / max(36.0, periodVal * periodVal);
  spatialFreq = clamp(spatialFreq, 3.0, 25.0);

  // v5.8: COHERENT temporal phase — no per-particle hash jitter on speed.
  // All ribbons in the same wave train advance at the same rate.
  float temporalSpeed = u_time / max(2.0, periodVal);
  float trainPhase = fract(dot(pos, dir) * spatialFreq - temporalSpeed);
  v_phase = trainPhase;

  // === v5.8: WAVE-TRAIN ENVELOPE — period controls visible band spacing ===
  // Short-period wind waves: tighter, more frequent visible bands.
  // Long-period swell: wider spacing, organized sets.
  // Modulates alpha softly (never fully invisible) to create visible wave sets.
  float train = fract(dot(pos, dir) * spatialFreq - temporalSpeed);
  float crestBand = 1.0 - smoothstep(0.08, 0.30, abs(train - 0.5));
  float trainEnvelope = mix(0.25, 1.0, crestBand);

  // === v5.8: ZOOM-AWARE ALPHA (far = subtler, close = detailed) ===
  float heightAlpha = smoothstep(0.0, 4.0, waveHeight);
  float zoomAlphaScale = mix(0.45, 1.0, smoothstep(3.0, 9.0, u_zoom));
  v_alpha = mix(0.50, 0.85, heightAlpha) * zoomAlphaScale;

  // v5.8: Apply wave-train envelope for visible period spacing
  v_alpha *= trainEnvelope;

  // Per-particle brightness variation (±10%) — subtle, NOT on phase speed
  v_alpha *= 0.9 + particleHash * 0.2;

  // === WHITECAP STRENGTH (separate from base ripple) ===
  // Only significant for waves with real breaking potential
  v_whitecap = smoothstep(0.5, 3.0, waveHeight);
}
`;

export const DRAW_FS = `
precision mediump float;
varying highp float v_alpha;
varying highp float v_wave_height;
varying highp vec2 v_local_uv;     // v5.3: quad local coords [-1,1] x=alongCrest y=acrossCrest
varying highp float v_phase;       // wave-train phase for rolling whitewater
varying highp float v_period_norm; // normalized period [0=short choppy, 1=long swell]
varying highp float v_whitecap;    // v5.3: whitecap strength (0=ripple only, 1=full whitecap)
varying highp vec4 v_debug_color;
uniform float u_theme;

// Multi-octave procedural noise for organic foam breakup
float foamHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float foamNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = foamHash(i);
  float b = foamHash(i + vec2(1.0, 0.0));
  float c = foamHash(i + vec2(0.0, 1.0));
  float d = foamHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  if (v_debug_color.a > 0.5) {
    gl_FragColor = v_debug_color;
    return;
  }

  if (v_alpha < 0.02) discard;

  // === v5.3: QUAD LOCAL COORDINATES (replaces gl_PointCoord) ===
  // v_local_uv.x = along crest axis [-1,1], v_local_uv.y = across wave axis [-1,1]
  float alongCrest = v_local_uv.x;
  float acrossCrest = v_local_uv.y;

  // === RIBBON SHAPE: soft ellipse without aspect compression ===
  // Length/thickness already handled in VS quad expansion
  float ellipseDist = length(v_local_uv);
  float shape = 1.0 - smoothstep(0.55, 1.0, ellipseDist);

  // Soften ribbon tips along crest axis
  float tipFade = 1.0 - smoothstep(0.6, 0.95, abs(alongCrest));
  shape *= tipFade;

  // === ROLLING WHITEWATER ACROSS RIBBON WIDTH ===
  // Map acrossCrest [-1,1] to waveLocal [0,1]
  float waveLocal = clamp(acrossCrest * 0.5 + 0.5, 0.0, 1.0);

  // Rolling front sweeps 0→1 as v_phase advances
  float rollFront = fract(v_phase);

  // Signed distance from the rolling breaking front
  float d = waveLocal - rollFront;

  // Leading edge: bright Gaussian peak at the breaking front
  float leadingFoam = exp(-d * d * 20.0);

  // Trailing wash: exponential decay behind the front
  float behindFront = max(0.0, -d);
  float trailingWash = exp(-behindFront * 3.5) * 0.5;

  // Ahead of front: quiet water
  float aheadFront = max(0.0, d);
  float quietAhead = exp(-aheadFront * 8.0) * 0.25;

  // Combined rolling intensity
  float rollIntensity = max(leadingFoam, max(trailingWash, quietAhead));

  // === v5.4: WAVE MOTION vs WHITECAP SEPARATION (anti-blink) ===
  // Base ripple: always visible, gently modulated by roll (min 0.5 shape)
  // The ribbon never disappears — only the highlight moves.
  float baseRipple = mix(0.5, 1.0, rollIntensity);

  // Whitecap layer: only for waves with breaking potential
  float whitecapRoll = leadingFoam * v_whitecap;

  shape *= baseRipple;

  // === v5.4: SPATIALLY ANCHORED FOAM BREAKUP ===
  // Noise is position-based (stable). Time component scrolls gently (0.3×),
  // not rapidly (was 2.0×). Wider smoothstep prevents pop-on/off.
  float n1 = foamNoise(vec2(alongCrest * 5.0 + v_wave_height, acrossCrest * 4.0));
  float n2 = foamNoise(vec2(alongCrest * 8.0 - v_phase * 0.3, acrossCrest * 6.0 + v_wave_height * 0.5));
  float foamBreakup = mix(n1, n2, 0.35);
  foamBreakup = smoothstep(0.1, 0.75, foamBreakup);

  // Period-aware density: short period = denser choppy foam, long period = cleaner
  float periodDensity = mix(0.5, 0.75, v_period_norm);
  shape *= mix(periodDensity, 1.0, foamBreakup);

  float alpha = v_alpha * shape;
  if (alpha < 0.01) discard;

  // === THEMED CREST COLORS ===
  float energy = smoothstep(0.0, 6.0, v_wave_height);

  vec3 calmColor, activeColor, stormColor, foamHighlight;

  if (u_theme > 1.5) {
    // Beach Mode — v5.4: pale seafoam-white to contrast green heatmap
    calmColor = vec3(0.92, 0.98, 0.90);    // pale seafoam-white (was teal 0.05,0.70,0.60)
    activeColor = vec3(1.00, 0.92, 0.72);  // warm sunlit foam (was orange 1.00,0.65,0.45)
    stormColor = vec3(1.00, 0.98, 0.90);   // warm white
    foamHighlight = vec3(1.00, 0.98, 0.90);
  } else if (u_theme > 0.5) {
    // Light Mode
    calmColor = vec3(0.10, 0.35, 0.80);
    activeColor = vec3(0.40, 0.75, 0.95);
    stormColor = vec3(1.00, 1.00, 1.00);
    foamHighlight = vec3(1.00, 1.00, 1.00);
  } else {
    // Dark Mode
    calmColor = vec3(0.00, 0.90, 1.00);
    activeColor = vec3(1.00, 0.10, 0.80);
    stormColor = vec3(1.00, 1.00, 1.00);
    foamHighlight = vec3(0.85, 0.95, 1.00);
  }

  vec3 baseColor = energy < 0.5
    ? mix(calmColor, activeColor, energy * 2.0)
    : mix(activeColor, stormColor, (energy - 0.5) * 2.0);

  // === WHITECAP HIGHLIGHT (separate from base ripple) ===
  // Bright white/cyan at the breaking front, proportional to v_whitecap
  float whiteBlend = whitecapRoll * 0.45;
  vec3 finalColor = mix(baseColor, foamHighlight, whiteBlend);

  // Premultiplied alpha output (gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
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
