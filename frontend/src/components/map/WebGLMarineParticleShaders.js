/**
 * WebGLMarineParticleShaders.js
 * Ocean GPU v2 — GLSL Shaders for the particle advection and drawing layers.
 * Extracted from WebGLMarineShaders.js for code modularity and LOC compliance.
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
uniform float u_speedHeightCap;   // cap (m) on the height term that drives drift speed: big swell otherwise drifts ~linearly with height (7m ≈ 7×), reading as unnaturally fast at mid-zoom. Real phase speed scales with period, not height.
uniform vec2 u_dataBounds_min;
uniform vec2 u_dataBounds_max;
uniform vec2 u_maskBounds_min;     // ocean-mask texture bounds (== the data grid; kept separate for auditability)
uniform vec2 u_maskBounds_max;
uniform sampler2D u_overlayMaskTexture; // viewport-truth land mask — applies ONLY inside u_overlayBounds (stale-safe fallback outside)
uniform vec2 u_overlayBounds_min;
uniform vec2 u_overlayBounds_max;
uniform float u_overlayMaskEnabled;
uniform float u_overlayReplace;    // 1 = replace the base sample (wide grid); 0 = min() combine (regional base already truthful)
uniform float u_rand_seed;
uniform float u_drop_rate;
uniform float u_zoom;
uniform float u_tileZoomMin;   // zoom above which particles use the camera-centered tile (concentrated). Below it they seed globally (sparse). Lowering it extends adequate density into the zoom-out range.
uniform vec2 u_tile_origin;
uniform float u_tile_width;
uniform float u_dirCoherenceMin;   // close-zoom coherence floor: drop particles where the BILINEAR |waveVec| < this. In nearest mode this culls SEAM STRIPS between divergent cells (side-by-side opposite motion, Baja 2026-07-02); bilinear magnitude is measured BEFORE the nearest override so the signal survives. 0 = off.
uniform float u_coarseNearestDir;  // >0.5: advect along the NEAREST coarse cell-center heading. On a magnified coarse-global grid, bilinear blending of divergent ~10°-cell headings synthesizes the smooth full-screen vortex; uniform per-cell headings cannot swirl, so crests may animate in the vortex band again. Matches DRAW_VS.
uniform vec2 u_waveGridSize;       // wave texture texel dims (cols, rows) — cell-center snapping for the nearest-direction sample
uniform float u_particles_res;     // particle state texture resolution — stratum width for stratified reseeding
uniform float u_stratifiedReseed;  // >0.5: respawn each particle inside ITS OWN stratum (its state-texel footprint) instead of uniform-random — Jobard–Lefer-style even coverage, kills reseed clumps at low density (U2, 2026-07-02)
uniform float u_motionUnlock;      // §4.2 motion-unlock: 1 = rating mode with __RAW_RATING_MOTION_UNLOCK__ — land checks lift to max(mask.r, mask.g), where g = MOTION-water (geographic water incl. band-masked cells). 0 = legacy (mask.r only); on geography masks r==g so this is inert either way.
uniform float u_ringFillEnabled;   // CREST RING-FILL (2026-07-16): >0.5 = particles beyond the resident grid fall back to the held coarse-global base — the SAME field the phase-0 wash paints in the revealed ring — instead of dying at the isOob drop (66-frame split-speckle proof: wash but ZERO crests past the grid edge). The engine forces 0 unless the base set is bound (the samplers below are fallback-bound, never read unbound). Kill: __RAW_DISABLE_CREST_RINGFILL__.
uniform sampler2D u_coarseWaveTexture; // held coarse-global base field (== the wash's texture)
uniform sampler2D u_coarseMaskTexture; // the base's OWN world mask — the RESIDENT mask/wave pair must never be read beyond their bounds (CLAMP_TO_EDGE junk)
uniform vec2 u_coarseBounds_min;   // base grid bounds; its mask was encoded with the base grid, so mask bounds == grid bounds (matches _drawCoarseBasePass)
uniform vec2 u_coarseBounds_max;
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

float latToMercatorY(float lat) {
  float latClamped = clamp(lat, -85.051129, 85.051129);
  float rad = latClamped * 3.141592653589793 / 180.0;
  return (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
}

void main() {
  vec4 encoded = texture2D(u_particles, v_uv);
  vec2 pos = decodePos(encoded);

  // Convert global Mercator coordinates to geographic lng/lat
  vec2 global_pos = (u_zoom > u_tileZoomMin) ? (u_tile_origin + pos * u_tile_width) : pos;
  float lng = global_pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(global_pos.y);

  // Map to local texture coordinate of u_waveTexture and u_oceanMaskTexture
  float tex_u;
  if (u_dataBounds_min.x > u_dataBounds_max.x) {
    float span = (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x;
    tex_u = mod(lng - u_dataBounds_min.x, 360.0) / max(span, 0.0001);
  } else {
    tex_u = (lng - u_dataBounds_min.x) / max(u_dataBounds_max.x - u_dataBounds_min.x, 0.0001);
  }
  float tex_v = (lat - u_dataBounds_min.y) / max(u_dataBounds_max.y - u_dataBounds_min.y, 0.0001);
  vec2 tex_uv = vec2(tex_u, tex_v);

  // Calculate Web Mercator mask coordinates from the MASK's own bounds (decoupled from the data
  // grid, 2026-07-04 — the resident mask can be a viewport-scoped basemap-truth texture).
  float mercMinY = latToMercatorY(u_maskBounds_max.y); // North
  float mercMaxY = latToMercatorY(u_maskBounds_min.y); // South
  float mask_u;
  if (u_maskBounds_min.x > u_maskBounds_max.x) {
    float mspan = (u_maskBounds_max.x + 360.0) - u_maskBounds_min.x;
    mask_u = mod(lng - u_maskBounds_min.x, 360.0) / max(mspan, 0.0001);
  } else {
    mask_u = (lng - u_maskBounds_min.x) / max(u_maskBounds_max.x - u_maskBounds_min.x, 0.0001);
  }
  float mask_v = (mercMaxY - global_pos.y) / max(mercMaxY - mercMinY, 0.0001);
  vec2 mask_uv = vec2(mask_u, mask_v);

  // CREST RING-FILL (2026-07-16): coarse-base coords for this particle — wave rows are LAT-linear,
  // the base's mask is MERCATOR (the same two conventions as the resident pair above).
  float c_u;
  if (u_coarseBounds_min.x > u_coarseBounds_max.x) {
    float cspan = (u_coarseBounds_max.x + 360.0) - u_coarseBounds_min.x;
    c_u = mod(lng - u_coarseBounds_min.x, 360.0) / max(cspan, 0.0001);
  } else {
    c_u = (lng - u_coarseBounds_min.x) / max(u_coarseBounds_max.x - u_coarseBounds_min.x, 0.0001);
  }
  float c_v = (lat - u_coarseBounds_min.y) / max(u_coarseBounds_max.y - u_coarseBounds_min.y, 0.0001);
  float cMercMinY = latToMercatorY(u_coarseBounds_max.y);
  float cMercMaxY = latToMercatorY(u_coarseBounds_min.y);
  bool inResident = !(tex_u < 0.0 || tex_u > 1.0 || tex_v < 0.0 || tex_v > 1.0);
  bool useCoarse = (u_ringFillEnabled > 0.5) && !inResident
    && c_u >= 0.0 && c_u <= 1.0 && c_v >= 0.0 && c_v <= 1.0;

  vec4 waveData = useCoarse ? texture2D(u_coarseWaveTexture, vec2(c_u, c_v))
                            : texture2D(u_waveTexture, tex_uv);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  // SEAM COHERENCE (2026-07-02): the BILINEAR magnitude, captured BEFORE the nearest override. ~1 inside
  // cells and between AGREEING cells; drops toward 0 mid-seam between DIVERGENT cells — exactly the strips
  // where nearest-snapped neighbours animate in opposite directions side by side (Baja live report).
  float dirCoherence = length(waveVec);
  // COARSE-BAND NEAREST DIRECTION (2026-07-02): take the heading from the nearest CELL CENTER instead of the
  // bilinear blend. LINEAR-sampling exactly at a texel center returns that texel unblended, so each ~10° cell
  // advects uniformly — the swirl (a synthesis of divergent neighbouring headings) cannot form. HEIGHT keeps
  // the smooth bilinear sample below (drift speed / sizes stay continuous across cells).
  // RING-FILL particles skip the snap: u_waveGridSize is the RESIDENT grid's texel dims — snapping
  // the coarse texture with them lands on wrong cell centers. The fallback stays bilinear (height
  // already is), matching how the wash reads the same texture.
  if (u_coarseNearestDir > 0.5 && !useCoarse) {
    vec2 cell = min(floor(tex_uv * u_waveGridSize), u_waveGridSize - 1.0);
    vec2 cellUV = (cell + 0.5) / max(u_waveGridSize, vec2(1.0));
    waveVec = texture2D(u_waveTexture, cellUV).rg * 2.0 - 1.0;
  }
  // v5.5: Negate y for Mercator convention. Geographic +v=northward, but
  // Mercator +y=southward (y=0 is North Pole). Without this flip, the N-S
  // component of all wave advection is inverted (e.g. ENE swell travels
  // WNW instead of WSW off Florida).
  waveVec.y = -waveVec.y;
  // §0e (2026-07-14): waveData.b is ALWAYS the honest height now — on rating grids the encoder
  // packs the score into a SEPARATE heatmap-only texture, so drift needs no channel switch here.
  float waveHeight = waveData.b * 10.0;
  // §4.2 motion-unlock: base land check lifts masked-ocean (g=motion-water) BEFORE the overlay
  // combine; the overlay carries geography truth, which EQUALS motion semantics, so it stays as-is.
  // RING-FILL: out-of-resident particles read the base's OWN world mask (mercator, its bounds);
  // the overlay combine below still refines it — the overlay is viewport-truth and bounds-agnostic.
  vec4 baseMaskSample = useCoarse
    ? texture2D(u_coarseMaskTexture, vec2(c_u, (cMercMaxY - global_pos.y) / max(cMercMaxY - cMercMinY, 0.0001)))
    : texture2D(u_oceanMaskTexture, mask_uv);
  float oceanFlag = max(baseMaskSample.r, baseMaskSample.g * u_motionUnlock);
  // Viewport-truth overlay (2026-07-04): override ONLY inside the overlay bounds; outside falls
  // back to the base mask (stale-safe — see HEATMAP_FS note).
  float oMercMinY = latToMercatorY(u_overlayBounds_max.y);
  float oMercMaxY = latToMercatorY(u_overlayBounds_min.y);
  if (u_overlayMaskEnabled > 0.5) {
    float o_u = (lng - u_overlayBounds_min.x) / max(u_overlayBounds_max.x - u_overlayBounds_min.x, 0.0001);
    float o_v = (oMercMaxY - global_pos.y) / max(oMercMaxY - oMercMinY, 0.0001);
    if (o_u > 0.0 && o_u < 1.0 && o_v > 0.0 && o_v < 1.0) {
      float ovs = texture2D(u_overlayMaskTexture, vec2(o_u, o_v)).r;
      oceanFlag = (u_overlayReplace > 0.5) ? ovs : min(oceanFlag, ovs);
    }
  }

  float lat_rad = lat * 3.141592653589793 / 180.0;
  float merc_scale = max(0.1, cos(lat_rad));
  
  float energyBoost = 1.0 + smoothstep(1.0, 5.0, waveHeight) * 0.3;
  // v4.0: waveVec is now a unit direction vector (RG encode direction only).
  // Scale by waveHeight * 0.1 for height-proportional drift, but CAP the height so big swell doesn't race
  // unnaturally (a 7m wave would otherwise drift ~7× a 1m wave). Above the cap, speed flattens — closer to the
  // physical fact that phase speed depends on period, not height. Tunable via window.__RAW_SPEED_HEIGHT_CAP__.
  float driftHeight = min(waveHeight, u_speedHeightCap);
  vec2 offset = (waveVec * driftHeight * 0.1 / merc_scale) * u_speed_scale * energyBoost;
  // CONFUSED-SEA drift damping (2026-07-03): where neighboring cell directions conflict (low bilinear
  // coherence), the nearest-cell heading is a coin-flip between opposing systems — streaming crests
  // confidently along it reads as "waves moving the wrong way" (Baja live report: split paths at a
  // 177° seam). Physically a crossing-sea zone has no clean propagation direction, so drift slows
  // toward the seam core (0.35× floor) instead of racing the wrong way. 0 floor = off (legacy).
  if (u_dirCoherenceMin > 0.001) {
    offset *= mix(0.35, 1.0, smoothstep(0.0, u_dirCoherenceMin, dirCoherence));
  }
  
  vec2 nextPos;
  if (u_zoom > u_tileZoomMin) {
    nextPos = pos + (offset / u_tile_width);
    nextPos = fract(nextPos);
  } else {
    nextPos = pos + offset;
    nextPos.x = fract(nextPos.x);
    nextPos.y = clamp(nextPos.y, 0.001, 0.999);
  }

  // Check land / oob for next position
  vec2 next_global_pos = (u_zoom > u_tileZoomMin) ? (u_tile_origin + nextPos * u_tile_width) : nextPos;
  float next_lng = next_global_pos.x * 360.0 - 180.0;
  float next_lat = mercatorYToLat(next_global_pos.y);
  float next_tex_u;
  if (u_dataBounds_min.x > u_dataBounds_max.x) {
    float span = (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x;
    next_tex_u = mod(next_lng - u_dataBounds_min.x, 360.0) / max(span, 0.0001);
  } else {
    next_tex_u = (next_lng - u_dataBounds_min.x) / max(u_dataBounds_max.x - u_dataBounds_min.x, 0.0001);
  }
  float next_tex_v = (next_lat - u_dataBounds_min.y) / max(u_dataBounds_max.y - u_dataBounds_min.y, 0.0001);
  
  float next_mask_u;
  if (u_maskBounds_min.x > u_maskBounds_max.x) {
    float nmspan = (u_maskBounds_max.x + 360.0) - u_maskBounds_min.x;
    next_mask_u = mod(next_lng - u_maskBounds_min.x, 360.0) / max(nmspan, 0.0001);
  } else {
    next_mask_u = (next_lng - u_maskBounds_min.x) / max(u_maskBounds_max.x - u_maskBounds_min.x, 0.0001);
  }
  float next_mask_v = (mercMaxY - next_global_pos.y) / max(mercMaxY - mercMinY, 0.0001);
  vec2 next_mask_uv = vec2(next_mask_u, next_mask_v);

  // RING-FILL: the next position gets the same coarse fallback (a ring particle advecting on the
  // coarse field must be land-checked against the SAME mask, or it dies at the resident edge).
  float nc_u;
  if (u_coarseBounds_min.x > u_coarseBounds_max.x) {
    float ncspan = (u_coarseBounds_max.x + 360.0) - u_coarseBounds_min.x;
    nc_u = mod(next_lng - u_coarseBounds_min.x, 360.0) / max(ncspan, 0.0001);
  } else {
    nc_u = (next_lng - u_coarseBounds_min.x) / max(u_coarseBounds_max.x - u_coarseBounds_min.x, 0.0001);
  }
  float nc_v = (next_lat - u_coarseBounds_min.y) / max(u_coarseBounds_max.y - u_coarseBounds_min.y, 0.0001);
  bool nextInResident = !(next_tex_u < 0.0 || next_tex_u > 1.0 || next_tex_v < 0.0 || next_tex_v > 1.0);
  bool nextUseCoarse = (u_ringFillEnabled > 0.5) && !nextInResident
    && nc_u >= 0.0 && nc_u <= 1.0 && nc_v >= 0.0 && nc_v <= 1.0;

  vec4 nextMaskSample = nextUseCoarse
    ? texture2D(u_coarseMaskTexture, vec2(nc_u, (cMercMaxY - next_global_pos.y) / max(cMercMaxY - cMercMinY, 0.0001)))
    : texture2D(u_oceanMaskTexture, next_mask_uv);
  float nextOceanFlag = max(nextMaskSample.r, nextMaskSample.g * u_motionUnlock);
  if (u_overlayMaskEnabled > 0.5) {
    float no_u = (next_lng - u_overlayBounds_min.x) / max(u_overlayBounds_max.x - u_overlayBounds_min.x, 0.0001);
    float no_v = (oMercMaxY - next_global_pos.y) / max(oMercMaxY - oMercMinY, 0.0001);
    if (no_u > 0.0 && no_u < 1.0 && no_v > 0.0 && no_v < 1.0) {
      float novs = texture2D(u_overlayMaskTexture, vec2(no_u, no_v)).r;
      nextOceanFlag = (u_overlayReplace > 0.5) ? novs : min(nextOceanFlag, novs);
    }
  }

  vec2 seed = (nextPos + v_uv) * u_rand_seed;
  float drop = step(1.0 - u_drop_rate, rand(seed));

  // Detect NaN or extreme values
  bool isNan = !(pos.x >= 0.0 || pos.x < 0.0) || 
               !(pos.y >= 0.0 || pos.y < 0.0) || 
               !(waveHeight >= 0.0 || waveHeight < 0.0) ||
               !(waveVec.x >= 0.0 || waveVec.x < 0.0) ||
               !(waveVec.y >= 0.0 || waveVec.y < 0.0);

  // RING-FILL: out-of-resident only counts as OOB when the coarse fallback can't take the particle
  // (ring-fill off, or outside the coarse bounds too) — a covered ring particle lives and advects.
  bool isOob = (!inResident && !useCoarse) || (!nextInResident && !nextUseCoarse);

  // Sanity floor on the ADVECTED vector stays at 0.005. NO coherence-based drop here (2026-07-03):
  // even the half-floor "seam core" cull produced a crest DEAD ZONE at divergence hotspots — at Baja
  // the fusion-era rows were 177° apart, so coherence ~0 across a strip DEGREES wide right where the
  // user sat (live report z3.74-6.9). Advection under nearest-cell mode is per-cell coherent anyway;
  // seam de-emphasis is now the DRAW shader's job alone, which dims alpha to a floor instead of
  // culling — always-visible motion, never a hole. dirCoherence stays computed for DRAW parity.
  if (waveHeight < 0.01 || length(waveVec) < 0.005 || oceanFlag < 0.3 || nextOceanFlag < 0.3 || isNan || isOob) {
    drop = 1.0;
  }

  if (u_zoom <= u_tileZoomMin) {
    float oobY = step(1.0, nextPos.y) + step(0.0, -nextPos.y);
    drop = max(drop, step(0.5, oobY));
  }

  vec2 randVal = vec2(rand(seed + 1.3), rand(seed + 2.1));
  vec2 newPos;
  if (u_zoom > u_tileZoomMin) {
    // U2 STRATIFIED RESEED (2026-07-02): uniform-random respawn leaves visible clumps/voids at low density
    // (flow-viz best practice is EVEN image-space spacing — Jobard–Lefer). Each particle's own state-texel
    // coordinate (v_uv, a perfect res×res lattice over the tile) is its stratum: respawn jittered WITHIN it.
    // Full ±half-texel jitter tiles the strata seamlessly — evenly-spaced seeds at every density, still random
    // inside each stratum. Kill: window.__RAW_STRATIFIED_RESEED__ = 0 (legacy uniform-random).
    newPos = (u_stratifiedReseed > 0.5)
      ? fract(v_uv + (randVal - 0.5) / max(u_particles_res, 1.0))
      : randVal;
  } else {
    float span = u_dataBounds_max.x + 360.0 - u_dataBounds_min.x;
    float randLng = u_dataBounds_min.x > u_dataBounds_max.x
      ? mod(u_dataBounds_min.x + randVal.x * span + 180.0, 360.0) - 180.0
      : mix(u_dataBounds_min.x, u_dataBounds_max.x, randVal.x);
    float randLat = mix(u_dataBounds_min.y, u_dataBounds_max.y, randVal.y);
    newPos = vec2((randLng + 180.0) / 360.0, latToMercatorY(randLat));
  }

  if (drop > 0.5) {
    pos = newPos;
  } else {
    pos = nextPos;
  }

  // Prevent pole clamping leakage
  if (u_zoom <= u_tileZoomMin) {
    pos.y = clamp(pos.y, 0.001, 0.999);
  }

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
uniform vec2 u_maskBounds_min;     // ocean-mask texture bounds (== the data grid; kept separate for auditability)
uniform vec2 u_maskBounds_max;
uniform sampler2D u_overlayMaskTexture; // viewport-truth land mask — applies ONLY inside u_overlayBounds (stale-safe fallback outside)
uniform vec2 u_overlayBounds_min;
uniform vec2 u_overlayBounds_max;
uniform float u_overlayMaskEnabled;
uniform float u_overlayReplace;    // 1 = replace the base sample (wide grid); 0 = min() combine (regional base already truthful)
uniform float u_time;              // elapsed time in seconds
uniform float u_zoom;              // map zoom level
uniform float u_tileZoomMin;       // zoom above which the camera-centered tile is used (matches ADVECT_FS)
uniform float u_merc_offset;       // world-copy offset (-1.0, 0.0, or +1.0)
uniform float u_debug_mode;        // debug mode selector
uniform vec2 u_viewport;           // v5.3: canvas size in device pixels
uniform float u_device_pixel_ratio; // v5.3: DPR for CSS pixel correction
uniform float u_edgeFeatherEnabled;
uniform float u_motionUnlock;      // §4.2 motion-unlock — see ADVECT_FS; 0 = legacy .r-only land checks
uniform float u_edgeFeatherWidth;   // CLAMP SOFTENER (matches heatmap): widen the crest edge dissolve for sub-viewport tiles. Default 0.18.
uniform float u_crestDirJitter;     // radians: per-crest random heading spread (directional spectrum) to break the parallel-crest LATTICE over uniform/coarse fields. 0 = off.
uniform float u_orbitalPitch;       // CSS px: phase-synced forward/back sway along waveDir so crests PITCH with the wave orbit, not just translate. 0 = off.
uniform float u_dirCoherenceMin;    // coherence floor on the BILINEAR |waveVec| (measured before the nearest override; matches ADVECT_FS) — dims divergent-cell seam strips. 0 = off.
uniform float u_seamFadeFloor;      // alpha FLOOR of the seam fade (2026-07-03): crests in incoherent-direction zones dim to this, never vanish — a dead ocean at divergence hotspots (Baja) reads as a bug; a dimmed one reads as low confidence.
uniform float u_farzoomSizeFloor;   // U3: crest size scale at far zoom (0.55 default; 0.4 = legacy). smoothstep(2,12,z) ramps from this floor to 1.
uniform float u_coarseNearestDir;   // >0.5: orient crests along the NEAREST coarse cell-center heading (vortex band; matches ADVECT_FS so orientation == motion).
uniform vec2 u_waveGridSize;        // wave texture texel dims (cols, rows) for cell-center snapping.
uniform sampler2D u_bathTexture;    // bathymetry depthFactor (R: 0=shelf/reef shallow, 1=deep ocean) — same encoding the heatmap uses; for shoaling foam.
uniform float u_shoalFoam;          // boost whitecap strength in shallow water (shelfProximity·u_shoalFoam). 0 = off. Engine forces 0 unless a bath texture is bound.
uniform float u_motion_scale;
uniform vec2 u_tile_origin;
uniform float u_tile_width;
uniform float u_opacity;
uniform float u_densityBase;   // engine-computed constant-screen-density cull fraction (z>tileZoomMin); <=0 → legacy per-zoom curve
uniform float u_endpointLandFade; // 1 = fade ribbon corners whose along-crest END lies over land (0 = legacy center-only cull)
uniform float u_crestLandThreshold; // crest-center oceanFlag discard cut (2026-07-07): match the heatmap's 0.5 so crests don't survive on soft/partial-land mask values (thin cays, coastal edges) the wash discards
// COAST SDF (2026-07-21): when the mask .b carries a signed distance-to-coast, threshold the DISTANCE
// (not the binary .r) so crests cut at the SAME crisp, eroded coast as the heatmap wash — no crest
// streaks surviving past the wash coastline. Must equal the HEATMAP_FS uniforms every frame.
uniform float u_coastSDFEnabled;    // 1.0 = base mask .b is a signed dist-to-coast
uniform float u_overlaySDFEnabled;  // 1.0 = overlay mask .b is a signed dist-to-coast
uniform float u_coastErode;         // coast erosion offset in normalized SDF units (matches heatmap)
uniform float u_coastAA;            // coast smoothstep half-width
uniform float u_ringFillEnabled;    // CREST RING-FILL (2026-07-16) — must match ADVECT_FS exactly (advected positions and drawn crests share field semantics beyond the grid edge, or crests die where particles advect and vice versa).
uniform sampler2D u_coarseWaveTexture; // held coarse-global base field (== the wash's texture)
uniform sampler2D u_coarseMaskTexture; // the base's OWN world mask (bounds == u_coarseBounds)
uniform vec2 u_coarseBounds_min;
uniform vec2 u_coarseBounds_max;

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

float latToMercatorY(float lat) {
  float latClamped = clamp(lat, -85.051129, 85.051129);
  float rad = latClamped * 3.141592653589793 / 180.0;
  return (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
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

  vec2 global_pos = (u_zoom > u_tileZoomMin) ? (u_tile_origin + pos * u_tile_width) : pos;
  float lng = global_pos.x * 360.0 - 180.0;
  float lat = mercatorYToLat(global_pos.y);

  float tex_u;
  if (u_dataBounds_min.x > u_dataBounds_max.x) {
    float span = (u_dataBounds_max.x + 360.0) - u_dataBounds_min.x;
    tex_u = mod(lng - u_dataBounds_min.x, 360.0) / max(span, 0.0001);
  } else {
    tex_u = (lng - u_dataBounds_min.x) / max(u_dataBounds_max.x - u_dataBounds_min.x, 0.0001);
  }
  float tex_v = (lat - u_dataBounds_min.y) / max(u_dataBounds_max.y - u_dataBounds_min.y, 0.0001);
  vec2 tex_uv = vec2(tex_u, tex_v);

  // Calculate Web Mercator mask coordinates from the MASK's own bounds (decoupled from the data
  // grid, 2026-07-04 — matches ADVECT_FS exactly).
  float mercMinY = latToMercatorY(u_maskBounds_max.y); // North
  float mercMaxY = latToMercatorY(u_maskBounds_min.y); // South
  float mask_u;
  if (u_maskBounds_min.x > u_maskBounds_max.x) {
    float mspan = (u_maskBounds_max.x + 360.0) - u_maskBounds_min.x;
    mask_u = mod(lng - u_maskBounds_min.x, 360.0) / max(mspan, 0.0001);
  } else {
    mask_u = (lng - u_maskBounds_min.x) / max(u_maskBounds_max.x - u_maskBounds_min.x, 0.0001);
  }
  float mask_v = (mercMaxY - global_pos.y) / max(mercMaxY - mercMinY, 0.0001);
  vec2 mask_uv = vec2(mask_u, mask_v);

  // CREST RING-FILL (2026-07-16): coarse-base coords — matches ADVECT_FS exactly (wave rows
  // LAT-linear, base mask MERCATOR over the base's own bounds).
  float c_u;
  if (u_coarseBounds_min.x > u_coarseBounds_max.x) {
    float cspan = (u_coarseBounds_max.x + 360.0) - u_coarseBounds_min.x;
    c_u = mod(lng - u_coarseBounds_min.x, 360.0) / max(cspan, 0.0001);
  } else {
    c_u = (lng - u_coarseBounds_min.x) / max(u_coarseBounds_max.x - u_coarseBounds_min.x, 0.0001);
  }
  float c_v = (lat - u_coarseBounds_min.y) / max(u_coarseBounds_max.y - u_coarseBounds_min.y, 0.0001);
  float cMercMinY = latToMercatorY(u_coarseBounds_max.y);
  float cMercMaxY = latToMercatorY(u_coarseBounds_min.y);
  bool inResident = !(tex_u < 0.0 || tex_u > 1.0 || tex_v < 0.0 || tex_v > 1.0);
  bool useCoarse = (u_ringFillEnabled > 0.5) && !inResident
    && c_u >= 0.0 && c_u <= 1.0 && c_v >= 0.0 && c_v <= 1.0;

  vec4 waveData = useCoarse ? texture2D(u_coarseWaveTexture, vec2(c_u, c_v))
                            : texture2D(u_waveTexture, tex_uv);
  vec2 waveVec = waveData.rg * 2.0 - 1.0;
  // SEAM COHERENCE (2026-07-02): bilinear magnitude BEFORE the nearest override — matches ADVECT_FS, culls
  // the divergent-cell seam strips where nearest-snapped crests would move opposite ways side by side.
  float dirCoherence = length(waveVec);
  // COARSE-BAND NEAREST DIRECTION (2026-07-02): heading from the nearest CELL CENTER instead of the bilinear
  // blend — matches ADVECT_FS exactly, so crest orientation always agrees with crest motion. Height keeps the
  // smooth bilinear sample (sizes stay continuous across cells).
  // RING-FILL particles skip the snap (u_waveGridSize = RESIDENT texel dims — wrong cell centers
  // for the coarse texture); the fallback stays bilinear, matching ADVECT_FS.
  if (u_coarseNearestDir > 0.5 && !useCoarse) {
    vec2 cell = min(floor(tex_uv * u_waveGridSize), u_waveGridSize - 1.0);
    vec2 cellUV = (cell + 0.5) / max(u_waveGridSize, vec2(1.0));
    waveVec = texture2D(u_waveTexture, cellUV).rg * 2.0 - 1.0;
  }
  // v5.5: Negate y for Mercator convention (geographic +v=north, Mercator +y=south).
  // Without this, the N-S component of wave travel direction is inverted.
  waveVec.y = -waveVec.y;
  // §0e (2026-07-14): waveData.b is ALWAYS the honest height — score lives in a heatmap-only
  // texture on rating grids, so crest size/alpha/density need no channel switch (see ADVECT_FS).
  float waveHeight = waveData.b * 10.0;
  v_wave_height = waveHeight;
  // §4.2 motion-unlock: matches ADVECT_FS — base check lifts to motion-water BEFORE overlay combine.
  // RING-FILL: out-of-resident crests are land-checked against the base's OWN world mask; the
  // viewport-truth overlay below still refines it (bounds-agnostic) — matches ADVECT_FS exactly.
  vec4 baseMaskSample = useCoarse
    ? texture2D(u_coarseMaskTexture, vec2(c_u, (cMercMaxY - global_pos.y) / max(cMercMaxY - cMercMinY, 0.0001)))
    : texture2D(u_oceanMaskTexture, mask_uv);
  // COAST SDF: threshold the .b distance (crisp, eroded coast == the heatmap wash) when active; else legacy binary.
  float oceanFlag = (u_coastSDFEnabled > 0.5 && !useCoarse)
    ? smoothstep(-u_coastAA, u_coastAA, (baseMaskSample.b - 0.5) - u_coastErode)
    : max(baseMaskSample.r, baseMaskSample.g * u_motionUnlock);
  // Viewport-truth overlay (2026-07-04): override ONLY inside the overlay bounds; outside falls
  // back to the base mask (stale-safe — see HEATMAP_FS note). Matches ADVECT_FS exactly.
  float oMercMinY = latToMercatorY(u_overlayBounds_max.y);
  float oMercMaxY = latToMercatorY(u_overlayBounds_min.y);
  if (u_overlayMaskEnabled > 0.5) {
    float o_u = (lng - u_overlayBounds_min.x) / max(u_overlayBounds_max.x - u_overlayBounds_min.x, 0.0001);
    float o_v = (oMercMaxY - global_pos.y) / max(oMercMaxY - oMercMinY, 0.0001);
    if (o_u > 0.0 && o_u < 1.0 && o_v > 0.0 && o_v < 1.0) {
      vec4 ovSample = texture2D(u_overlayMaskTexture, vec2(o_u, o_v));
      float ovs = (u_overlaySDFEnabled > 0.5)
        ? smoothstep(-u_coastAA, u_coastAA, (ovSample.b - 0.5) - u_coastErode)
        : ovSample.r;
      oceanFlag = (u_overlayReplace > 0.5) ? ovs : min(oceanFlag, ovs);
    }
  }

  float particleHash = fract(sin(particleIndex * 12.9898) * 43758.5453);

  bool bypassDiscard = (u_debug_mode > 7.5);

  bool isNan = !(pos.x >= 0.0 || pos.x < 0.0) ||
               !(pos.y >= 0.0 || pos.y < 0.0) ||
               !(waveHeight >= 0.0 || waveHeight < 0.0) ||
               !(waveVec.x >= 0.0 || waveVec.x < 0.0) ||
               !(waveVec.y >= 0.0 || waveVec.y < 0.0);

  // RING-FILL: out-of-resident is only OOB when the coarse fallback can't take it (matches ADVECT_FS).
  bool isOob = !inResident && !useCoarse;

  // v5.9: Raised discard threshold to 0.10m to match infobox low-energy suppression.
  // Trace-level waves (especially Swell 2) have unreliable directions — no animation.
  // NO coherence discard here (2026-07-03): incoherent-direction seams DIM via u_seamFadeFloor below
  // instead of vanishing — the core discard made divergence hotspots a band-wide crest dead zone.
  // COAST SDF: when active, oceanFlag is a coverage crossing 0.5 at the eroded coast — cut there
  // (matching the heatmap wash discard) instead of the binary crest threshold.
  float _crestCut = (u_coastSDFEnabled > 0.5 || u_overlaySDFEnabled > 0.5) ? 0.5 : u_crestLandThreshold;
  if (!bypassDiscard && (waveHeight < 0.01 || length(waveVec) < 0.02 || oceanFlag < _crestCut || isNan || isOob)) {
    gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
    v_alpha = 0.0; v_phase = 0.0; v_period_norm = 0.5; v_whitecap = 0.0;
    v_debug_color = vec4(0.0);
    return;
  }

  // === CONSTANT-SCREEN-DENSITY CULL (flow-viz best practice) ===
  // The old ad-hoc per-zoom fraction (0.12→0.90 with a close-zoom cut) pinned density to ZOOM, not to the screen,
  // so the same sea read crisp at z11, sparse at z13, blobby at z15. Best practice (Agafonkin/webgl-wind render to
  // a screen-sized buffer; flow-viz density-control research) is to hold a CONSTANT on-screen seed count at every
  // zoom and let the field thin calm areas. The engine computes that cull fraction (u_densityBase) from the
  // viewport's share of the particle tile. heightBoost still lets storms read a touch denser. u_densityBase<=0 →
  // legacy per-zoom curve (z<=6 path + safety fallback). Refs: blog.mapbox.com webgl-wind; Springer 10.1007/978-3-030-61864-3_26.
  float closeup = smoothstep(12.0, 15.0, u_zoom);
  float heightBoost = smoothstep(1.0, 4.0, waveHeight) * mix(0.02, 0.10, smoothstep(5.0, 10.0, u_zoom));
  // Legacy curve now only governs z<=tileZoomMin(3) + the partTarget=0 fallback. The +0.0076 term is the
  // second user-tuned density pass (2026-07-02): ~+5% visible crests across z2.7–3.0 specifically (ramped in
  // over 2.4→2.7 so the deliberate z2 globe-thinning floor stays put). Mirror: WebGLMarineEngineDiagnostics.
  float effBase = u_densityBase > 0.0 ? u_densityBase
    : (mix(0.128, 0.90, smoothstep(2.0, 10.0, u_zoom)) + 0.0076 * smoothstep(2.4, 2.7, u_zoom));
  float densityThreshold = clamp(effBase + heightBoost, 0.02, 0.97);

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

  // Directional-spectrum spread: real seas are NOT perfectly parallel. Rotate each crest by a small per-particle
  // random heading so a uniform/coarse direction field stops reading as a rigid parallel LATTICE ("grid"). Visual
  // only — does not change advection (that's ADVECT_FS). u_crestDirJitter = 0 → unchanged (legacy parallel crests).
  if (u_crestDirJitter > 0.0001) {
    float jitterAng = (particleHash - 0.5) * 2.0 * u_crestDirJitter;
    float cj = cos(jitterAng), sj = sin(jitterAng);
    dir = vec2(dir.x * cj - dir.y * sj, dir.x * sj + dir.y * cj);
  }

  vec2 vertexPos = global_pos;
  vertexPos.x += u_merc_offset;
  vec4 clipPos = u_matrix * vec4(vertexPos.x, vertexPos.y, 0.0, 1.0);
  vec2 ndc0 = clipPos.xy / max(clipPos.w, 0.001);
  vec2 pixel0 = (ndc0 + 1.0) * 0.5 * u_viewport;

  vec2 matCol0 = u_matrix[0].xy;
  vec2 matCol1 = u_matrix[1].xy;
  vec2 pixelDelta = (dir.x * matCol0 + dir.y * matCol1) * u_viewport;
  vec2 waveDir = length(pixelDelta) > 2.0 ? normalize(pixelDelta) : vec2(1.0, 0.0);
  vec2 crestDir = vec2(-waveDir.y, waveDir.x); // perpendicular = crest axis

  // === v5.3: INDEPENDENT CREST LENGTH AND THICKNESS (CSS pixels) ===
  float sizeEnergy = smoothstep(0.1, 4.0, waveHeight);
  float smallBoost = (1.0 - smoothstep(0.5, 1.5, waveHeight));

  // Crest LENGTH: 36-80 CSS px total (halfLength = 18-40)
  float halfLength = mix(18.0, 40.0, sizeEnergy) + smallBoost * 6.0;

  // Crest THICKNESS: 6-16 CSS px total (halfThickness = 3-8)
  float halfThickness = mix(3.0, 8.0, sizeEnergy) + smallBoost * 2.0;

  // Zoom scaling (gentler) + v7.1 close-zoom crest lift → more defined crests when zoomed right in.
  // U3 DENSITY-AWARE SIZE (2026-07-02): the far-zoom size floor is now a uniform (default 0.55, legacy 0.4)
  // so low-zoom crests read larger and coverage FEELS constant where the seed count is capped.
  float zoomScale = smoothstep(2.0, 12.0, u_zoom) * (1.0 - u_farzoomSizeFloor) + u_farzoomSizeFloor + closeup * 0.20;
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

  // === ORBITAL PITCH (gated) — phase-synced forward/back sway of the whole crest along waveDir, so crests
  // PITCH with the wave orbit instead of only translating. Synced to the SAME wave-train phase as the foam
  // roll below (so the sway and the breaking front agree). 0 = off (legacy). Live: window.__RAW_ORBITAL_PITCH__.
  if (u_orbitalPitch > 0.0001) {
    float mp = waveData.a * 20.0;
    float pv = mp > 0.5 ? mp : (6.0 + waveHeight * 2.0);
    float sf = clamp(800.0 / max(36.0, pv * pv), 3.0, 25.0);
    float ts = (u_time * u_motion_scale) / max(2.0, pv);
    float orbPhase = fract(dot(global_pos, dir) * sf - ts) * 6.28318530718;
    pixel0 += waveDir * sin(orbPhase) * u_orbitalPitch * dpr;
  }

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
  float temporalSpeed = (u_time * u_motion_scale) / max(2.0, periodVal);
  float trainPhase = fract(dot(global_pos, dir) * spatialFreq - temporalSpeed);
  v_phase = trainPhase;

  // === v5.8: WAVE-TRAIN ENVELOPE — period controls visible band spacing ===
  // Short-period wind waves: tighter, more frequent visible bands.
  // Long-period swell: wider spacing, organized sets.
  // Modulates alpha softly (never fully invisible) to create visible wave sets.
  float train = fract(dot(global_pos, dir) * spatialFreq - temporalSpeed);
  float crestBand = 1.0 - smoothstep(0.08, 0.30, abs(train - 0.5));
  float trainEnvelope = mix(0.25, 1.0, crestBand);

  // === v5.8: ZOOM-AWARE ALPHA (far = subtler, close = detailed) ===
  float heightAlpha = smoothstep(0.0, 4.0, waveHeight);
  float zoomAlphaScale = mix(0.45, 1.0, smoothstep(3.0, 9.0, u_zoom));
  v_alpha = mix(0.50, 0.85, heightAlpha) * zoomAlphaScale * u_opacity;

  // v5.8: Apply wave-train envelope for visible period spacing
  v_alpha *= trainEnvelope;

  // Per-particle brightness variation (±10%) — subtle, NOT on phase speed
  v_alpha *= 0.9 + particleHash * 0.2;

  // SEAM FADE (2026-07-02; dim-not-kill 2026-07-03): two-segment coherence dim.
  //  [0.5·floor, floor]  → alpha ramps u_seamFadeFloor..1 (mild seams stay visible, de-emphasized)
  //  [0, 0.5·floor]      → the floor itself ramps 0..u_seamFadeFloor, so only the thin ANTI-PARALLEL
  //                        core line (coherence→0, headings ~180° apart) approaches invisible.
  // The 2026-07-02 zero-alpha CULL of the whole strip made divergence hotspots a band-wide crest dead
  // zone (Baja); a flat 0.3 floor instead showed half-bright crests streaming opposite ways ("split
  // paths", same live session). Pairs with ADVECT's confused-sea drift damping: conflict zones render
  // as dim, slow shimmer — never a hole, never confident wrong-way motion.
  if (u_dirCoherenceMin > 0.001) {
    float seamT = smoothstep(u_dirCoherenceMin * 0.5, u_dirCoherenceMin, dirCoherence);
    float coreT = smoothstep(0.0, u_dirCoherenceMin * 0.5, dirCoherence);
    v_alpha *= mix(u_seamFadeFloor * coreT, 1.0, seamT);
  }

  // Smoothstep boundary feathering so particles dissolve softly near grid edges.
  // RING-FILL particles skip it: tex_u/v are OOB out there, so min(tex_u, 1-tex_u) goes negative
  // and the feather would zero every ring crest — the exact deficit ring-fill exists to fix. The
  // coarse base is world-spanning, so there is no data edge to soften in the ring.
  float edgeFade = 1.0;
  if (u_edgeFeatherEnabled > 0.5 && !useCoarse) {
    float distToEdgeX = min(tex_u, 1.0 - tex_u);
    float distToEdgeY = min(tex_v, 1.0 - tex_v);
    float minDistToEdge = min(distToEdgeX, distToEdgeY);
    edgeFade = smoothstep(0.0, max(u_edgeFeatherWidth, 0.01), minDistToEdge);
  }
  v_alpha *= edgeFade;

  // === RIBBON-ENDPOINT LAND FADE (2026-07-04, "dashes crossing Venice/Lido") ===
  // The ocean cull above tests only the particle CENTER, so a water-centered ribbon OVERHANGS land:
  // at z11+ a crest quad is 32–96 CSS px long along the crest axis — comparable to an entire barrier
  // island (Lido is ~500 m wide; live texel forensics showed the island line masked 0 yet dashes
  // still crossed it). Convert THIS corner's along-crest pixel offset back to MERCATOR (invert the
  // pixel-per-mercator 2×2 jacobian already available from the matrix columns), sample the ocean
  // mask at the ribbon END, and scale this corner's alpha by it. Fragments interpolate the corner
  // alphas, so a ribbon dissolves per-pixel toward a land end; a ribbon fully in water is untouched
  // (both factors 1). Kill: u_endpointLandFade=0 via window.__RAW_DISABLE_ENDPOINT_LAND_FADE__=true.
  if (u_endpointLandFade > 0.5) {
    vec2 jx = matCol0 * 0.5 * u_viewport / max(clipPos.w, 0.001);
    vec2 jy = matCol1 * 0.5 * u_viewport / max(clipPos.w, 0.001);
    float jdet = jx.x * jy.y - jy.x * jx.y;
    if (abs(jdet) > 0.000000001) {
      vec2 pxDelta = crestDir * (deviceHalfLength * cornerUV.x);
      vec2 mercDelta = vec2(jy.y * pxDelta.x - jy.x * pxDelta.y, jx.x * pxDelta.y - jx.y * pxDelta.x) / jdet;
      vec2 endMerc = global_pos + mercDelta;
      float endLng = endMerc.x * 360.0 - 180.0;
      // RING-FILL: a coarse-fallback crest's ribbon END is checked against the base's world mask
      // (the resident mask is CLAMP_TO_EDGE junk out there); the overlay refinement below is
      // bounds-agnostic and applies to both branches unchanged.
      vec4 endMaskSample;
      if (useCoarse) {
        float cend_u;
        if (u_coarseBounds_min.x > u_coarseBounds_max.x) {
          float cendSpan = (u_coarseBounds_max.x + 360.0) - u_coarseBounds_min.x;
          cend_u = mod(endLng - u_coarseBounds_min.x, 360.0) / max(cendSpan, 0.0001);
        } else {
          cend_u = (endLng - u_coarseBounds_min.x) / max(u_coarseBounds_max.x - u_coarseBounds_min.x, 0.0001);
        }
        float cend_v = (cMercMaxY - endMerc.y) / max(cMercMaxY - cMercMinY, 0.0001);
        endMaskSample = texture2D(u_coarseMaskTexture, vec2(cend_u, cend_v));
      } else {
        float end_u;
        if (u_maskBounds_min.x > u_maskBounds_max.x) {
          float endSpan = (u_maskBounds_max.x + 360.0) - u_maskBounds_min.x;
          end_u = mod(endLng - u_maskBounds_min.x, 360.0) / max(endSpan, 0.0001);
        } else {
          end_u = (endLng - u_maskBounds_min.x) / max(u_maskBounds_max.x - u_maskBounds_min.x, 0.0001);
        }
        float end_v = (mercMaxY - endMerc.y) / max(mercMaxY - mercMinY, 0.0001);
        endMaskSample = texture2D(u_oceanMaskTexture, vec2(end_u, end_v));
      }
      float endFlag = max(endMaskSample.r, endMaskSample.g * u_motionUnlock);
      if (u_overlayMaskEnabled > 0.5) {
        float eo_u = (endLng - u_overlayBounds_min.x) / max(u_overlayBounds_max.x - u_overlayBounds_min.x, 0.0001);
        float eo_v = (oMercMaxY - endMerc.y) / max(oMercMaxY - oMercMinY, 0.0001);
        if (eo_u > 0.0 && eo_u < 1.0 && eo_v > 0.0 && eo_v < 1.0) {
          float eovs = texture2D(u_overlayMaskTexture, vec2(eo_u, eo_v)).r;
          endFlag = (u_overlayReplace > 0.5) ? eovs : min(endFlag, eovs);
        }
      }
      v_alpha *= smoothstep(0.20, 0.45, endFlag);
    }
  }

  // === WHITECAP STRENGTH (separate from base ripple) ===
  // Only significant for waves with real breaking potential. v7.1: more breaking foam at close zoom.
  v_whitecap = smoothstep(0.5, 3.0, waveHeight) * (1.0 + closeup * 0.5);

  // === SHOALING FOAM (gated) — real waves shoal and break as they run onto the continental shelf / reefs, so
  // intensify whitecap where the water is shallow. Samples the SAME bathymetry depthFactor the heatmap uses
  // (R: 0=shelf/reef shallow, 1=deep ocean) at the wave-grid coord. 0 = off (legacy). Live: window.__RAW_SHOAL_FOAM__.
  // The engine forces u_shoalFoam=0 unless a bathymetry texture is bound, so u_bathTexture is never read unbound.
  // RING-FILL particles skip it: the bath texture is resident-bounds aligned and tex_uv is OOB out there.
  if (u_shoalFoam > 0.0001 && !useCoarse) {
    float depthFactor = texture2D(u_bathTexture, tex_uv).r;
    float shelfProximity = clamp(1.0 - depthFactor, 0.0, 1.0);
    v_whitecap *= 1.0 + shelfProximity * u_shoalFoam;
  }
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
uniform float u_trochoidal;   // [0..1] warp the symmetric ribbon into an asymmetric TROCHOIDAL crest (sharp leading face, broad trailing back). 0 = legacy symmetric ellipse.
uniform float u_crestContrast; // [0..1] zoom-band SELF-CONTRAST (2026-07-03): dark skirt + brighter core + slight white lift so crests read on any heatmap hue. Engine ramps it in around z3.65-4.25 where the crest and heatmap palettes collide (dark: mint on teal/cyan; light: navy on azure). 0 = legacy (byte-identical).
uniform float u_lowHCrestContrast; // [0..1] LOW-HEIGHT self-contrast (2026-07-05): the same palette collision happens at ANY zoom wherever crest height <~0.75 m (island swell shadows: pale dash on pale wash = "animations don't cover the heatmap"). Ramped out by 1.05 m in main(). 0 = legacy.

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

  // === RIBBON SHAPE: soft ellipse (default) → asymmetric TROCHOIDAL crest (gated) ===
  // A real wave crest is not a symmetric ellipse: the forward (leading, +waveDir) face is steep and the
  // trailing back is broad/gentle (trochoidal / Gerstner profile). u_trochoidal in [0,1] warps the across-wave
  // coordinate so the leading half falls off sooner (sharp face) and the trailing half later (broad back).
  // 0 = unchanged symmetric ellipse (legacy v5.x). Live-tunable: window.__RAW_TROCHOIDAL__.
  float acWarp = acrossCrest;
  if (u_trochoidal > 0.001) {
    // ORIENTATION FIX (2026-07-02): acrossCrest = +1 is the LEADING (+waveDir/travel) side — the corner offset
    // is +waveDir*cornerUV.y and the (visually verified) foam roll sweeps toward +1. The original warp had
    // lead/trail swapped, so the sharp face pointed BACKWARDS (broad slope forward) — crests read as traveling
    // the wrong way ("rolling out to sea") once Natural defaults enabled trochoidal on 2026-07-01.
    float lead = max(0.0, acrossCrest);    // leading (+waveDir) side, 0..1
    float trail = max(0.0, -acrossCrest);  // trailing (-waveDir) side, 0..1
    float warped = pow(lead, 0.65) - pow(trail, 1.5); // sharpen leading, broaden trailing
    acWarp = mix(acrossCrest, warped, clamp(u_trochoidal, 0.0, 1.0));
  }
  float ellipseDist = length(vec2(alongCrest, acWarp));
  float shape = 1.0 - smoothstep(0.55, 1.0, ellipseDist);

  // Soften ribbon tips along crest axis
  float tipFade = 1.0 - smoothstep(0.6, 0.95, abs(alongCrest));
  shape *= tipFade;

  // === ROLLING WHITEWATER ACROSS RIBBON WIDTH ===
  // Map acrossCrest [-1,1] to waveLocal [0,1].
  // DIRECTION FIX (2026-06-29): v_phase = fract(spatial - temporalSpeed) DECREASES over time, so the breaking
  // foam front (waveLocal==rollFront) swept toward LOW acrossCrest = -waveDir — i.e. the whitewater rolled
  // AGAINST the wave's travel direction, reading as "waves moving the wrong way" (the wave-train bands move
  // correctly with +dir, so it was a foam/band mismatch). Negate acrossCrest so the front rolls toward +waveDir,
  // with the trailing wash behind it — now consistent with both the advection and the bands.
  float waveLocal = clamp(-acrossCrest * 0.5 + 0.5, 0.0, 1.0);

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
    // Beach Mode
    calmColor = vec3(1.00, 0.45, 0.65);    // orchid-pink
    activeColor = vec3(0.00, 0.92, 0.85);  // electric turquoise
    stormColor = vec3(0.80, 0.20, 0.90);   // sunset magenta
    foamHighlight = vec3(0.95, 0.95, 1.00);
  } else if (u_theme > 0.5) {
    // Light Mode
    calmColor = vec3(0.05, 0.15, 0.45);    // deep navy
    activeColor = vec3(0.85, 0.50, 0.00);  // amber-gold
    stormColor = vec3(0.75, 0.10, 0.05);   // crimson red
    foamHighlight = vec3(1.00, 1.00, 1.00);
  } else {
    // Dark Mode
    calmColor = vec3(0.10, 0.95, 0.60);    // mint-green
    activeColor = vec3(1.00, 0.80, 0.10);  // yellow-gold
    stormColor = vec3(1.00, 0.40, 0.10);   // fiery orange
    foamHighlight = vec3(1.00, 1.00, 1.00);
  }

  vec3 baseColor = energy < 0.5
    ? mix(calmColor, activeColor, energy * 2.0)
    : mix(activeColor, stormColor, (energy - 0.5) * 2.0);

  // === WHITECAP HIGHLIGHT (separate from base ripple) ===
  // Bright white/cyan at the breaking front, proportional to v_whitecap
  float whiteBlend = whitecapRoll * 0.45;
  vec3 finalColor = mix(baseColor, foamHighlight, whiteBlend);

  // === SELF-CONTRAST: zoom band (2026-07-03) + low-height band (2026-07-05) ===
  // In the coarse band the crest palette can land on a same-hue heatmap (mint on teal, navy on
  // azure) and the ribbon washes out. The SAME collision happens at any zoom wherever the wave is
  // small (<~0.75 m): the low end of the wash ramp and the crest color converge, so island
  // swell-shadow zones (Catalina/San Clemente lee) render dashes in wash-camouflage — "animations
  // don't cover the heatmap". Give each crest an INTERNAL luminance gradient — darkened skirt,
  // boosted + slightly whitened core — so it reads on any background color without changing any
  // theme palette. Gated: both terms 0 → byte-identical legacy output.
  float crestContrastEff = max(u_crestContrast,
    u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)));
  if (crestContrastEff > 0.001) {
    float core = 1.0 - smoothstep(0.15, 0.85, ellipseDist);
    float lum = mix(0.55, 1.30, core);
    vec3 contrasted = finalColor * lum + foamHighlight * core * 0.18;
    finalColor = mix(finalColor, contrasted, clamp(crestContrastEff, 0.0, 1.0));
  }

  // Premultiplied alpha output (gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  float boostedAlpha = alpha * mix(1.2, 1.8, energy);
  boostedAlpha = min(boostedAlpha, 0.85);
  gl_FragColor = vec4(finalColor * boostedAlpha, boostedAlpha);
}
`;
