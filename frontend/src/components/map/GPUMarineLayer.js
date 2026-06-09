/**
 * GPUMarineLayer.js Marine-only renderer (v3.1)
 *
 * Renders ocean energy fields (waves, swell, wind waves) with:
 * A) Scalar ocean heatmap color mapped to wave HEIGHT (meters)
 * B) White foam/crest broken dashes direction only, NOT velocity vectors
 *
 * This renderer is architecturally separated from GPUWindLayer.js.
 * Marine must NEVER visually resemble wind.
 */
import { useEffect, useRef } from 'react';
import { getAnimationCoordinator } from './CanvasAnimationCoordinator';
import { wrapLongitude, wrapLngRelative, getCenterLng, isLngInBounds } from './mapUtils';

// --- SINGLETON REGISTRY ---
var ACTIVE_MARINE_ENGINES = new Set();

// --- VISUAL TUNING ---
// v3.16: Softened for premium visual aesthetics and reduced clutter
var MARINE_PARTICLE_ALPHA = 0.40; // was 0.72

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// v75: 2-octave fractional Brownian motion (fBm) noise for Kolmogorov-consistent
// energy cascade. Two octaves capture the dominant large-scale turbulence and its
// first sub-harmonic, per Richardson's energy cascade theory.
function _hash2D(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1; // range [-1, 1]
}
function noise2D(x, y) {
  // Octave 1: large-scale turbulence (amplitude=1.0)
  // Octave 2: sub-harmonic detail (amplitude=0.5, frequency=2x)
  // Kolmogorov -5/3 spectrum: amplitude ratio ≈ 2^(-5/6) ≈ 0.56, approximated as 0.5
  return (_hash2D(x, y) + 0.5 * _hash2D(x * 2.17, y * 2.17)) / 1.5;
}

/**
 * Checks if a coordinate is within active grid bounds.
 */
function isWithinGridBounds(lat, lng, grid) {
  if (!grid?.vectors?.length || !grid.bounds) return false;
  const { west, south, east, north } = grid.bounds;
  const center = getCenterLng(west, east);
  const wLng = wrapLngRelative(lng, center);
  const wWest = wrapLngRelative(west, center);
  const wEast = wrapLngRelative(east, center);
  const qLat = Math.max(south, Math.min(north, lat));
  return !(wLng < wWest || wLng > wEast || qLat < south || qLat > north);
}

/**
 * Bilinear interpolation on marine grid.
 */
function interpolateMarine(grid, lng, lat) {
  const inGrid = isWithinGridBounds(lat, lng, grid);
  if (!inGrid) {
    // Out-of-grid = land, polar, or uncovered ocean — return zero to prevent land particle spawning.
    // WAVEWATCH III / GFS-Wave only provides wave data for ocean grid cells.
    return { u: 0, v: 0, speed: 0, isOcean: 0 };
  }
  const { vectors, bounds, cols, rows } = grid;
  if (!cols || !rows || vectors.length !== cols * rows) return { u: 0, v: 0, speed: 0, isOcean: 0 };
  const { west, south, east, north } = bounds;

  // Wrap query longitude to grid bounds coordinate space
  const center = getCenterLng(west, east);
  const wLng = wrapLngRelative(lng, center);
  const wWest = wrapLngRelative(west, center);
  const wEast = wrapLngRelative(east, center);

  // Clamp query latitude to grid latitude bounds (fixes Polar/Arctic particle absence)
  const qLat = Math.max(south, Math.min(north, lat));

  const gx = Math.max(0, Math.min(cols - 1, ((wLng - wWest) / (wEast - wWest)) * (cols - 1)));
  const gy = Math.max(0, Math.min(rows - 1, ((qLat - south) / (north - south)) * (rows - 1)));
  const xi = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  const yi = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  const fx = gx - xi;
  const fy = gy - yi;
  const idx = (y, x) => y * cols + x;
  const p00 = vectors[idx(yi, xi)];
  const p10 = vectors[idx(yi, xi + 1)];
  const p01 = vectors[idx(yi + 1, xi)];
  const p11 = vectors[idx(yi + 1, xi + 1)];
  if (!p00 || !p10 || !p01 || !p11) return { u: 0, v: 0, speed: 0, isOcean: 0 };

  const u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
            (1 - fx) * fy * p01.u + fx * fy * p11.u;
  const v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
            (1 - fx) * fy * p01.v + fx * fy * p11.v;
  const speed = (1 - fx) * (1 - fy) * p00.speed + fx * (1 - fy) * p10.speed +
                (1 - fx) * fy * p01.speed + fx * fy * p11.speed;

  const p00_isOcean = p00.isOcean ? 1 : 0;
  const p10_isOcean = p10.isOcean ? 1 : 0;
  const p01_isOcean = p01.isOcean ? 1 : 0;
  const p11_isOcean = p11.isOcean ? 1 : 0;
  const isOcean = (1 - fx) * (1 - fy) * p00_isOcean + fx * (1 - fy) * p10_isOcean +
                  (1 - fx) * fy * p01_isOcean + fx * fy * p11_isOcean;

  return { u, v, speed, isOcean };
}

/**
 * Data-driven ocean detection based on wave height value from the forecast grid.
 */
function isLikelyOcean(lat, lng, grid) {
  if (!grid?.vectors?.length) return false;
  if (lat < -85 || lat > 85) return false;

  const { vectors, bounds, cols, rows } = grid;
  const { west, south, east, north } = bounds;

  // Wrap query longitude to grid bounds coordinate space
  const center = getCenterLng(west, east);
  const wLng = wrapLngRelative(lng, center);
  const wWest = wrapLngRelative(west, center);
  const wEast = wrapLngRelative(east, center);

  // Clamp query latitude to grid latitude bounds (fixes Polar/Arctic particle absence)
  const qLat = Math.max(south, Math.min(north, lat));

  // Since grid bounds are continuous, check directly against the wrapped gLng
  if (wLng < wWest || wLng > wEast || qLat < south || qLat > north) {
    return false;
  }

  // Nearest-neighbour cell lookup using grid bounds coordinate space
  const gx = Math.round(((wLng - wWest) / (wEast - wWest)) * (cols - 1));
  const gy = Math.round(((qLat - south) / (north - south)) * (rows - 1));
  
  if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return false;

  const cell = vectors[gy * cols + gx];
  if (!cell) return false;
  // Wave height threshold: prioritize isOcean flag if present, else fallback
  if (typeof cell.isOcean === 'boolean') return cell.isOcean;
  return typeof cell.speed === 'number' && cell.speed > 0 && Number.isFinite(cell.speed);
}

/**
 * Wraps a longitude relative to the map's current center longitude to ensure it maps
 * correctly in the viewport's continuous rendering space (fixes the Pacific Ocean split).
 */
function getRenderLng(lng, centerLng) {
  return wrapLngRelative(lng, centerLng);
}

/**
 * Evaluates whether a given lat/lng lies on land by prioritizing the active forecast
 * ocean grid check first (O(1) direct check), and falling back to a Native Vector-Tile
 * query on Maplibre's solid 'ocean-mask-fill' layer for perfect land boundaries.
 */
// Land layer IDs to query from Mapbox/MapLibre vector tile styles.
// Pre-built array avoids creating it per-call. queryRenderedFeatures with a layers
// filter is O(1) per MapLibre docs (ref 84) vs O(n) querying all features.
var LAND_LAYER_IDS = null;

function _getLandLayerIds(mapInstance) {
  if (LAND_LAYER_IDS) return LAND_LAYER_IDS;
  try {
    const style = mapInstance.getStyle();
    if (!style?.layers) return null;
    LAND_LAYER_IDS = style.layers
      .filter(l => {
        if (l.type !== 'fill') return false;
        const id = l.id || '';
        return id.includes('land') || id.includes('landuse') || id.includes('landcover') ||
          id.includes('building') || id.includes('park') || id.includes('national') ||
          id.includes('structure') || id.includes('grass') || id.includes('wood') ||
          id.includes('scrub') || id.includes('crop') || id.includes('sand') ||
          id === 'ocean-mask-fill';
      })
      .map(l => l.id);
    return LAND_LAYER_IDS;
  } catch (e) {
    return null;
  }
}

// v3.17: Spatial cache for checkIsLand — avoids re-querying same screen locations
const _landCache = new Map();
const _LAND_CACHE_MAX = 2000;
const _LAND_CACHE_RESOLUTION = 100; // ~0.01° quantization

function _landCacheKey(lat, lng) {
  return (Math.round(lat * _LAND_CACHE_RESOLUTION) << 16) | (Math.round(((lng + 180) % 360) * _LAND_CACHE_RESOLUTION) & 0xFFFF);
}

function checkIsLand(lat, lng, mapInstance, grid) {
  if (!grid) return true;

  // 1. Grid-based lookup first (super fast O(1))
  const inGrid = isWithinGridBounds(lat, lng, grid);
  if (!inGrid) return true; // Treat out-of-bounds as land

  const wave = interpolateMarine(grid, lng, lat);
  
  // Fast deep water and deep land checks to bypass expensive vector tile queries
  if (wave.isOcean >= 0.999) return false; // Definitely deep ocean
  if (wave.isOcean <= 0.001) return true;  // Definitely deep land

  // 2. Check spatial cache before expensive vector tile query
  const cacheKey = _landCacheKey(lat, lng);
  if (_landCache.has(cacheKey)) return _landCache.get(cacheKey);

  // 3. Coastal Zone: MapLibre vector-tile query fallback with layer filter
  let result = wave.isOcean < 0.5; // default fallback
  if (mapInstance && typeof window !== 'undefined') {
    try {
      const centerLng = mapInstance.getCenter().lng;
      const rLng = wrapLngRelative(lng, centerLng);
      
      const pt = mapInstance.project([rLng, lat]);
      if (pt && pt.x >= 0 && pt.y >= 0) {
        const layerIds = _getLandLayerIds(mapInstance);
        // Use layer filter when available for O(1) MapLibre lookup
        const features = layerIds && layerIds.length > 0
          ? mapInstance.queryRenderedFeatures(pt, { layers: layerIds })
          : mapInstance.queryRenderedFeatures(pt);
        if (!features || features.length === 0) {
          result = false;
        } else if (layerIds && layerIds.length > 0) {
          result = true;
        } else {
          result = features.some(f => {
            const id = f.layer?.id || '';
            return f.layer?.type === 'fill' && (
              id.includes('land') || id.includes('landuse') || id.includes('landcover') ||
              id.includes('building') || id.includes('park') || id.includes('national') ||
              id.includes('structure') || id.includes('grass') || id.includes('wood') ||
              id.includes('scrub') || id.includes('crop') || id.includes('sand') ||
              id === 'ocean-mask-fill'
            );
          });
        }
      }
    } catch (e) {
      result = true;
    }
  }

  // Store in cache (evict oldest if full)
  if (_landCache.size >= _LAND_CACHE_MAX) {
    const oldestKey = _landCache.keys().next().value;
    _landCache.delete(oldestKey);
  }
  _landCache.set(cacheKey, result);
  return result;
}

export function MarineParticleCanvas({ mapInstance, active, data, revision, id = "marine-canvas-layer" }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const dataRef = useRef(null);
  const particlesRef = useRef([]);
  const activeRef = useRef(active);



  useEffect(() => { activeRef.current = active; }, [active]);
  const prevDataIdRef = useRef(null);

  useEffect(() => {
    if (data?.vectors?.length) {
      dataRef.current = data;
      const dataId = `${data.cols}x${data.rows}:${data.vectors.length}`;
      if (dataId !== prevDataIdRef.current) {
        prevDataIdRef.current = dataId;
        console.log(`[Marine] Data updated: ${data.vectors.length} vectors, ${data.cols}x${data.rows}`);
      }
    }
  }, [data]);

  // v3.2: Marine heatmap overlay is now handled by OM raster tiles
  // (wave_height, swell_wave_height, etc.) in MapWebGL.js via LAYER_REGISTRY.
  // These tiles provide full global ocean coverage with built-in land masking.
  // Only the particle animation engine below renders on this canvas.

  // --- MAIN FOAM PARTICLE ENGINE ---
  useEffect(() => {
    if (!mapInstance || !canvasRef.current) return;
    if (ACTIVE_MARINE_ENGINES.has(id)) {
      console.error(`[Marine] DUPLICATE_ENGINE: ${id} already running.`);
      return;
    }
    ACTIVE_MARINE_ENGINES.add(id);
    console.log(`[Marine] === STARTING FOAM ENGINE (${id}) ===`);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const w = Math.round(rect.width), h = Math.round(rect.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    };
    const dims = resize() || { w: 800, h: 600 };
    let cw = dims.w, ch = dims.h;

    const isMobile = window.innerWidth < 768;
    const isWeak = (navigator.hardwareConcurrency || 4) <= 4;
    // v3.16: Optimized baseline particle count to prevent panning lag
    const PARTICLE_COUNT = isMobile ? (isWeak ? 500 : 1000) : (isWeak ? 1200 : 2200);
    console.log(`[Marine] Spawning up to ${PARTICLE_COUNT} foam particles (max baseline)`);

    const spawn = (preAge = false) => {
      const mb = mapInstance.getBounds();
      if (!mb) {
        return { lng: 0, lat: 0, age: 0, maxAge: 0.1, dashLen: 0, phase: 999, energy: 0, noiseSeed: 0 };
      }
      const west = mb.getWest(), east = mb.getEast();
      const south = Math.max(-85, mb.getSouth()), north = Math.min(85, mb.getNorth());
      const grid = dataRef.current;
      const zoom = mapInstance.getZoom();
      // Calculate the true visible longitude width (handles continuous bounds beautifully)
      let lngWidth = east - west;
      if (lngWidth < 0) lngWidth += 360;

      for (let attempt = 0; attempt < 12; attempt++) {
        const lng = wrapLongitude(west + Math.random() * lngWidth);
        const lat = south + Math.random() * (north - south);
        
        // 1. Strict Land Mask Check before wave checks
        if (checkIsLand(lat, lng, mapInstance, grid)) continue;

        const wave = interpolateMarine(grid, lng, lat);
        const spd = wave?.speed || 0;
        
        // 2. Wave height > threshold check
        if (spd <= 0.001 || !Number.isFinite(spd)) continue;
        const energyScale = Math.min(1, spd / 3);
        const maxAge = (1.0 + Math.random() * 2.5) * (0.3 + energyScale * 0.7);
        const zoomScale = Math.max(0.3, Math.min(1.5, zoom / 6));
        // v3.17: Jitter must cover full grid cell (GFS 0.25°) to eliminate grid-aligned clustering
        const jitter = 0.25;
        const jLng = wrapLongitude(lng + (Math.random() - 0.5) * jitter);
        const jLat = lat + (Math.random() - 0.5) * jitter;

        return {
          lng: jLng, lat: jLat,
          age: preAge ? Math.random() * maxAge * 0.8 : 0,
          maxAge,
          dashLen: (3 + Math.random() * 10 * energyScale) * zoomScale,
          phase: Math.random(),
          energy: energyScale,
          noiseSeed: Math.random() * 100
        };
      }
      // Fallback particle: assign phase=999 to guarantee it will never be rendered
      const fallLng = wrapLongitude(west + Math.random() * lngWidth);
      return { lng: fallLng, lat: south + Math.random() * (north - south), age: preAge ? Math.random() * 0.2 : 0, maxAge: 0.2, dashLen: 3, phase: 999, energy: 0, noiseSeed: Math.random() * 100 };
    };

    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawn(true));
    particlesRef.current = particles;

    let frameCount = 0;
    let wasActive = false;

 // v3.9.7: Phase 2 register with shared CanvasAnimationCoordinator
    const coordinator = getAnimationCoordinator();
    coordinator.init(mapInstance);

    // v3.9.7: Tick function called by CanvasAnimationCoordinator
    const marineTick = (now, dt, coordState) => {
      if (!activeRef.current) {
        if (wasActive) { ctx.clearRect(0, 0, cw, ch); wasActive = false; }
        return;
      }
      const grid = dataRef.current;
      wasActive = true;
      frameCount++;

      // v3.9.7: Throttle state from coordinator (2 = throttled)
      const state = coordState === 2 ? 2 : 1;
      const THROTTLED = 2;

      // v3.17: Slower trail decay for swell band persistence (Ventusky-style energy fronts)
      const trailFade = state === THROTTLED ? 0.12 : 0.04;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
      ctx.fillRect(0, 0, cw, ch);
      // v3.11.3: source-over for scientific compositing (screen causes white foam)
      ctx.globalCompositeOperation = 'source-over';

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast(), bs = mb.getSouth(), bn = mb.getNorth();
      const centerLng = mapInstance.getCenter().lng;

      const stride = state === THROTTLED ? 4 : 1;
      const pts = particlesRef.current;
      const zoom = mapInstance.getZoom();

      // Dynamic zoom-based active particle limits to ensure flawless panning performance
      let activeFraction = 1.0;
      if (zoom < 3) activeFraction = 0.90;
      else if (zoom < 5) activeFraction = 0.95;

      const activeCount = Math.round(pts.length * activeFraction);

      for (let i = 0; i < activeCount; i += stride) {
        const p = pts[i];
        p.age += dt;

        // Interpolate wave vector at particle position
        const wave = interpolateMarine(grid, p.lng, p.lat);

        // Wave height > threshold check
        if (wave.speed <= 0.001 || !Number.isFinite(wave.speed) || !Number.isFinite(wave.u) || !Number.isFinite(wave.v)) {
          pts[i] = spawn();
          continue;
        }

        // Advect particle - speed scales with wave height/speed and dt!
        const waveSpeedAmp = 0.5 + Math.min(3.5, wave.speed * 0.8); // bigger waves flow dramatically faster
        const DEG_PER_METER = 1 / 111320;
        const latRad = p.lat * Math.PI / 180;
        const mercCorr = Math.max(0.1, Math.cos(latRad));
        const speedScale = dt * 1500 * Math.pow(0.62, zoom - 6) * waveSpeedAmp;
        // v3.17: Ventusky-style directional coherence — high-energy swell propagates cleanly,
        // calm seas get more turbulence (natural choppiness). Inverse energy scaling.
        const turbulence = 0.45 * (1.0 - p.energy * 0.65);
        const ns = p.noiseSeed || 0;
        const noiseFreqScale = 4 * Math.pow(1.3, zoom - 3);
        const noiseU = noise2D(p.lng * noiseFreqScale + now * 0.0008 + ns, p.lat * noiseFreqScale) * turbulence;
        const noiseV = noise2D(p.lat * noiseFreqScale + now * 0.0008 + ns, p.lng * noiseFreqScale + ns) * turbulence;
        p.lng += (wave.u + noiseU) * DEG_PER_METER / mercCorr * speedScale;
        p.lat += (wave.v + noiseV) * DEG_PER_METER * speedScale;

        // Clamp & wrap
        if (isNaN(p.lat) || isNaN(p.lng)) { pts[i] = spawn(); continue; }

        p.lng = wrapLongitude(p.lng);

        // Post-advection land kill: catch particles that drifted across coastlines during advection.
        // Uses precise, highly optimized land-checking which combines fast grid checks and MapLibre.
        if (checkIsLand(p.lat, p.lng, mapInstance, grid)) {
          pts[i] = spawn();
          continue;
        }

        // Wrap particle longitude relative to camera center for continuous render space coordinates
        const rLng = getRenderLng(p.lng, centerLng);

        // Respawn if too old or drifted completely out of the viewport
        const inView = (be - bw >= 360) || isLngInBounds(rLng, bw, be);
        if (p.age > p.maxAge || !inView || p.lat < bs || p.lat > bn) {
          pts[i] = spawn();
          continue;
        }

        // Wave density scaling: calibrate for slow motion & visual presence in calm ocean waters
        const h = Number.isFinite(wave.speed) ? wave.speed : 0;
        if (h <= 0.001) continue;
        // Maintain a beautiful 15% base minimum particle density in calm water so foam flow is global
        const densityFactor = Math.max(0.15, Math.min(1.0, Math.pow(h / 6.0, 0.4)));
        if (p.phase > densityFactor) continue;

        // --- DRAW FOAM CREST DASH ---
        try {
          // Project continuous rendering space coordinates (fixes Pacific antimeridian split!)
          const pt = mapInstance.project([rLng, p.lat]);
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;

          // Age-based alpha: fade in quickly, fade out slowly
          const ageRatio = p.age / p.maxAge;
          const fadeIn = Math.min(1, p.age / 0.3); // 0.3s fade in
          const fadeOut = 1 - Math.pow(ageRatio, 1.5);
          let alpha = fadeIn * fadeOut;

          // Edge fade (wrap-aware continuous longitude fading)
          const viewLngWidth = be - bw;
          const edgePadLng = Math.max(0.5, viewLngWidth * 0.12);

          const distWest = rLng - bw;
          if (distWest < edgePadLng) {
            alpha *= smoothstep(0, edgePadLng, distWest);
          }
          const distEast = be - rLng;
          if (distEast < edgePadLng) {
            alpha *= smoothstep(0, edgePadLng, distEast);
          }

          const latHeight = bn - bs;
          const edgePadLat = Math.max(0.5, latHeight * 0.12);
          alpha *= smoothstep(bs, bs + edgePadLat, p.lat);
          alpha *= smoothstep(bn, bn - edgePadLat, p.lat);
          alpha *= MARINE_PARTICLE_ALPHA;

          // v3.17: Aggressive wave height → intensity scaling (Ventusky-style energy representation)
          // Calm seas (< 1m): very faint traces. Active swell (2-4m): visible energy. Storm (6m+): bright crests.
          const energyAlpha = Math.min(1.0, 0.12 + Math.pow(h / 5.0, 0.6) * 0.88);
          alpha *= energyAlpha; alpha = Math.min(1.0, alpha);

          if (alpha < 0.01) continue;

          // Wave direction for dash orientation
          // Standard meteorological direction conversion: Canvas_Angle = (Meteorological_Angle + 180) % 360.
          // Maps wave vectors (u, v) into Cartesian rendering direction, handling empty/calm fields strictly.
          let dirAngle = 0.0;
          if (Math.abs(wave.u) > 0.001 || Math.abs(wave.v) > 0.001) {
            dirAngle = Math.atan2(-wave.v, wave.u);
          }
          
          // v3.17: Scale dash length and width based on zoom + wave height for Ventusky-style crests
          const zoomScale = Math.max(0.2, Math.min(1.2, zoom / 7.0));
          const dynamicDashLen = p.dashLen * Math.min(2.2, 0.35 + h * 0.55) * zoomScale;
          const halfDash = dynamicDashLen / 2;
          const dx = Math.cos(dirAngle + Math.PI / 2) * halfDash;
          const dy = -Math.sin(dirAngle + Math.PI / 2) * halfDash;

          // v3.17: White foam crests with subtle warm shift at high energy (storm intensity)
          const hEnergy = Math.min(1, h / 5);
          const foamR = Math.round(215 + hEnergy * 40);
          const foamG = Math.round(228 + hEnergy * 27);
          const foamB = 255;
          ctx.strokeStyle = `rgba(${foamR}, ${foamG}, ${foamB}, ${alpha})`;
          ctx.lineWidth = Math.max(0.5, Math.min(4.5, (0.4 + h * 0.6) * zoomScale));
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(pt.x - dx, pt.y - dy);
          ctx.lineTo(pt.x + dx, pt.y + dy);
          ctx.stroke();
        } catch (e) {
          pts[i] = spawn();
        }
      }

    };

    // v3.9.7: Register with shared coordinator instead of self-scheduling RAF
    coordinator.register(id, marineTick, () => activeRef.current);

    const onResize = () => { const d = resize(); if (d) { cw = d.w; ch = d.h; } };
    window.addEventListener('resize', onResize);

    return () => {
      console.log(`[Marine] === UNMOUNTING (${id}) ===`);
      ACTIVE_MARINE_ENGINES.delete(id);
      coordinator.unregister(id);
      window.removeEventListener('resize', onResize);
    };
  }, [mapInstance]);

  return (
    <canvas
      id={id}
      ref={canvasRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 5,
        opacity: active ? 1 : 0,
        transition: 'opacity 0.3s ease'
      }}
    />
  );
}
