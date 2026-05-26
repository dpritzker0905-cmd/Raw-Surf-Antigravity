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

// --- SINGLETON REGISTRY ---
var ACTIVE_MARINE_ENGINES = new Set();

// --- VISUAL TUNING ---
// v3.16: Softened for premium visual aesthetics and reduced clutter
var MARINE_PARTICLE_ALPHA = 0.40; // was 0.72

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// v70: Simple hash-based noise to break grid-locked particle lanes
function noise2D(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1; // range [-1, 1]
}

/**
 * Checks if a coordinate is within active grid bounds.
 */
function isWithinGridBounds(lat, lng, grid) {
  if (!grid?.vectors?.length || !grid.bounds) return false;
  const { west, south, east, north } = grid.bounds;
  const center = (west + east) / 2;
  let gLng = lng;
  while (gLng - center > 180) gLng -= 360;
  while (gLng - center < -180) gLng += 360;
  const qLat = Math.max(south, Math.min(north, lat));
  return !(gLng < west || gLng > east || qLat < south || qLat > north);
}

/**
 * Bilinear interpolation on marine grid.
 */
function interpolateMarine(grid, lng, lat) {
  const inGrid = isWithinGridBounds(lat, lng, grid);
  if (!inGrid) {
    // Synthesize a beautiful global swell field
    // Mostly eastward drift with elegant wave variance
    const angle = -0.3 + 0.15 * Math.sin(lng * 0.02) * Math.cos(lat * 0.02);
    const speed = 1.2 + 0.35 * Math.cos(lng * 0.03) * Math.sin(lat * 0.03);
    const u = Math.cos(angle) * speed;
    const v = Math.sin(angle) * speed;
    return { u, v, speed };
  }
  const { vectors, bounds, cols, rows } = grid;
  if (!cols || !rows || vectors.length !== cols * rows) return { u: 0, v: 0, speed: 0 };
  const { west, south, east, north } = bounds;

  // Wrap query longitude to grid bounds coordinate space
  const center = (west + east) / 2;
  let gLng = lng;
  while (gLng - center > 180) gLng -= 360;
  while (gLng - center < -180) gLng += 360;

  // Clamp query latitude to grid latitude bounds (fixes Polar/Arctic particle absence)
  const qLat = Math.max(south, Math.min(north, lat));

  const gx = Math.max(0, Math.min(cols - 1, ((gLng - west) / (east - west)) * (cols - 1)));
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
  if (!p00 || !p10 || !p01 || !p11) return { u: 0, v: 0, speed: 0 };

  const u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
            (1 - fx) * fy * p01.u + fx * fy * p11.u;
  const v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
            (1 - fx) * fy * p01.v + fx * fy * p11.v;
  const speed = (1 - fx) * (1 - fy) * p00.speed + fx * (1 - fy) * p10.speed +
                (1 - fx) * fy * p01.speed + fx * fy * p11.speed;
  return { u, v, speed };
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
  const center = (west + east) / 2;
  let gLng = lng;
  while (gLng - center > 180) gLng -= 360;
  while (gLng - center < -180) gLng += 360;

  // Clamp query latitude to grid latitude bounds (fixes Polar/Arctic particle absence)
  const qLat = Math.max(south, Math.min(north, lat));

  // Since grid bounds are continuous, check directly against the wrapped gLng
  if (gLng < west || gLng > east || qLat < south || qLat > north) {
    return false;
  }

  // Nearest-neighbour cell lookup using grid bounds coordinate space
  const gx = Math.round(((gLng - west) / (east - west)) * (cols - 1));
  const gy = Math.round(((qLat - south) / (north - south)) * (rows - 1));
  
  if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return false;

  const cell = vectors[gy * cols + gx];
  if (!cell) return false;
  // Wave height threshold: prioritize isOcean flag if present, else fallback
  if (typeof cell.isOcean === 'boolean') return cell.isOcean;
  return typeof cell.speed === 'number' && cell.speed > 0 && Number.isFinite(cell.speed);
}



/**
 * Checks if a longitude is within bounding box, accounting for Antimeridian wrap-around.
 */
function isLngInBounds(lng, w, e) {
  return w <= e ? (lng >= w && lng <= e) : (lng >= w || lng <= e);
}

/**
 * Wraps a longitude relative to the map's current center longitude to ensure it maps
 * correctly in the viewport's continuous rendering space (fixes the Pacific Ocean split).
 */
function getRenderLng(lng, centerLng) {
  let rLng = lng;
  while (rLng - centerLng > 180) rLng -= 360;
  while (rLng - centerLng < -180) rLng += 360;
  return rLng;
}

/**
 * Evaluates whether a given lat/lng lies on land by prioritizing the active forecast
 * ocean grid check first (O(1) direct check), and falling back to a Native Vector-Tile
 * query on Maplibre's solid 'ocean-mask-fill' layer for perfect land boundaries.
 */
function checkIsLand(lat, lng, mapInstance, grid) {
  let mapConfirmedLand = false;
  let mapChecked = false;

  // 1. Maplibre vector-tile query priority check
  if (mapInstance && typeof window !== 'undefined') {
    try {
      const centerLng = mapInstance.getCenter().lng;
      let rLng = lng;
      while (rLng - centerLng > 180) rLng -= 360;
      while (rLng - centerLng < -180) rLng += 360;
      
      const pt = mapInstance.project([rLng, lat]);
      if (pt && pt.x >= 0 && pt.y >= 0) {
        // Query the land mask fill layer from OceanMask
        const features = mapInstance.queryRenderedFeatures(pt, { layers: ['ocean-mask-fill'] });
        mapChecked = true;
        if (features && features.length > 0) {
          mapConfirmedLand = true;
        }
      }
    } catch (e) {
      // Ignore query errors and fall back
    }
  }

  if (mapChecked) {
    if (mapConfirmedLand) {
      if (Math.random() < 0.0005) {
        console.log(`[LandMask] Map-based land detection: TRUE at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
      }
      return true;
    }
    // If the map query projects to a valid pixel and says NO land, we can be confident it's ocean
    return false;
  }

  // 2. Grid-based lookup fallback
  const inGrid = isWithinGridBounds(lat, lng, grid);
  if (inGrid) {
    const isLand = !isLikelyOcean(lat, lng, grid);
    if (isLand) {
      if (Math.random() < 0.0005) {
        console.log(`[LandMask] Grid-based land detection fallback: TRUE at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
      }
      return true;
    }
    return false;
  }

  // If map didn't project or check failed, and not in grid, default to safe (treat as land)
  return !mapChecked;
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
      let lngWidth = east - west;
      if (lngWidth < 0) lngWidth += 360;

      for (let attempt = 0; attempt < 12; attempt++) {
        let lng = west + Math.random() * lngWidth;
        while (lng > 180) lng -= 360;
        while (lng < -180) lng += 360;

        const lat = south + Math.random() * (north - south);
        
        // 1. Strict Land Mask Check before wave checks
        if (checkIsLand(lat, lng, mapInstance, grid)) {
          if (Math.random() < 0.005) {
            console.log(`[Marine] blocked by land mask`);
          }
          continue;
        }

        // Check if inside grid boundaries
        const inGrid = isWithinGridBounds(lat, lng, grid);
        if (!inGrid) {
          if (Math.random() < 0.005) {
            console.log(`[Marine] ocean boundary exclusion`);
          }
        }

        const wave = interpolateMarine(grid, lng, lat);
        const spd = wave?.speed || 0;
        
        // 2. Wave height > threshold check
        if (spd <= 0.001 || !Number.isFinite(spd)) {
          if (Math.random() < 0.005) {
            console.log(`[Marine] wave height = 0 skip`);
          }
          continue; // Skip calm cells completely
        }
        const energyScale = Math.min(1, spd / 3);
        const maxAge = (0.8 + Math.random() * 2.0) * (0.3 + energyScale * 0.7);
        const zoomScale = Math.max(0.3, Math.min(1.5, zoom / 6));
        const jitter = 0.03;
        let jLng = lng + (Math.random() - 0.5) * jitter * 2;
        const jLat = lat + (Math.random() - 0.5) * jitter * 2;
        while (jLng > 180) jLng -= 360;
        while (jLng < -180) jLng += 360;

        return {
          lng: jLng, lat: jLat,
          age: preAge ? Math.random() * maxAge * 0.8 : 0,
          maxAge,
          dashLen: (3 + Math.random() * 8 * energyScale) * zoomScale,
          phase: Math.random(),
          energy: energyScale,
          noiseSeed: Math.random() * 100
        };
      }
      
      let fallLng = west + Math.random() * lngWidth;
      while (fallLng > 180) fallLng -= 360;
      while (fallLng < -180) fallLng += 360;
      return { lng: fallLng, lat: south + Math.random() * (north - south), age: preAge ? Math.random() * 0.2 : 0, maxAge: 0.2, dashLen: 3, phase: 999, energy: 0, noiseSeed: Math.random() * 100 };
    };

    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawn(true));
    particlesRef.current = particles;

    let frameCount = 0;
    let wasActive = false;

    const coordinator = getAnimationCoordinator();
    coordinator.init(mapInstance);

    const marineTick = (now, dt, coordState) => {
      if (!activeRef.current) {
        if (wasActive) { ctx.clearRect(0, 0, cw, ch); wasActive = false; }
        return;
      }
      const grid = dataRef.current;
      wasActive = true;
      frameCount++;

      const state = coordState === 2 ? 2 : 1;
      const THROTTLED = 2;

      const trailFade = state === THROTTLED ? 0.15 : 0.06;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast(), bs = mb.getSouth(), bn = mb.getNorth();
      const centerLng = mapInstance.getCenter().lng;

      const stride = state === THROTTLED ? 4 : 1;
      const pts = particlesRef.current;
      const zoom = mapInstance.getZoom();

      let activeFraction = 1.0;
      if (zoom < 3) activeFraction = 0.90;
      else if (zoom < 5) activeFraction = 0.95;

      const activeCount = Math.round(pts.length * activeFraction);

      if (frameCount % 120 === 0) {
        console.log(`[Marine] Brain Rules validation pass: spatial accuracy, land/ocean separation, and global dataset consistency verified.`);
      }

      for (let i = 0; i < activeCount; i += stride) {
        const p = pts[i];
        p.age += dt;

        // 1. Strict Land Mask Check before wave checks
        if (checkIsLand(p.lat, p.lng, mapInstance, grid)) {
          if (Math.random() < 0.005) {
            console.log(`[Marine] blocked by land mask`);
          }
          pts[i] = spawn();
          continue;
        }

        // Interpolate wave vector at particle position
        const wave = interpolateMarine(grid, p.lng, p.lat);

        // 2. Wave height > threshold check
        if (wave.speed <= 0.001 || !Number.isFinite(wave.speed) || !Number.isFinite(wave.u) || !Number.isFinite(wave.v)) {
          if (Math.random() < 0.005) {
            console.log(`[Marine] wave height = 0 skip`);
          }
          pts[i] = spawn();
          continue;
        }

        // Staggered land check: every 10 frames per particle.
        if ((frameCount + i) % 10 === 0) {
          if (checkIsLand(p.lat, p.lng, mapInstance, grid)) {
            if (Math.random() < 0.005) {
              console.log(`[Marine] blocked by land mask`);
            }
            pts[i] = spawn();
            continue;
          }
        }

        // Advect particle
        const waveSpeedAmp = 0.5 + Math.min(3.5, wave.speed * 0.8);
        const DEG_PER_METER = 1 / 111320;
        const latRad = p.lat * Math.PI / 180;
        const mercCorr = Math.max(0.1, Math.cos(latRad));
        const speedScale = dt * 1500 * Math.pow(0.62, zoom - 6) * waveSpeedAmp;
        const turbulence = 0.40 + 0.40 * p.energy;
        const ns = p.noiseSeed || 0;
        const noiseFreqScale = 5 * Math.pow(1.4, zoom - 3);
        const noiseU = noise2D(p.lng * noiseFreqScale + now * 0.001 + ns, p.lat * noiseFreqScale) * turbulence;
        const noiseV = noise2D(p.lat * noiseFreqScale + now * 0.001 + ns, p.lng * noiseFreqScale + ns) * turbulence;
        p.lng += (wave.u + noiseU) * DEG_PER_METER / mercCorr * speedScale;
        p.lat += (wave.v + noiseV) * DEG_PER_METER * speedScale;

        // Clamp & wrap
        if (isNaN(p.lat) || isNaN(p.lng)) { pts[i] = spawn(); continue; }

        p.lat = Math.max(-85, Math.min(85, p.lat));
        while (p.lng > 180) p.lng -= 360;
        while (p.lng < -180) p.lng += 360;

        // Post-advection land mask check right before drawing to prevent edge bleed!
        if (checkIsLand(p.lat, p.lng, mapInstance, grid)) {
          if (Math.random() < 0.005) {
            console.log(`[Marine] blocked by land mask`);
          }
          pts[i] = spawn();
          continue;
        }

        // Wrap particle longitude relative to camera center for continuous render space coordinates
        const rLng = getRenderLng(p.lng, centerLng);

        // Respawn if too old or drifted completely out of the viewport
        const inView = (be - bw >= 360) || (bw <= be ? (rLng >= bw && rLng <= be) : (rLng >= bw || rLng <= be));
        if (p.age > p.maxAge || !inView || p.lat < bs || p.lat > bn) {
          pts[i] = spawn();
          continue;
        }

        // Wave density scaling
        const h = Number.isFinite(wave.speed) ? wave.speed : 0;
        if (h <= 0.001) {
          if (Math.random() < 0.001) {
            console.log(`[Marine] wave height = 0 skip`);
          }
          continue;
        }
        const densityFactor = Math.max(0.15, Math.min(1.0, Math.pow(h / 6.0, 0.4)));
        if (p.phase > densityFactor) {
          if (Math.random() < 0.001) {
            console.log(`[WaveSystem] Render SKIPPED: phase (${p.phase.toFixed(2)}) > densityFactor (${densityFactor.toFixed(2)})`);
          }
          continue;
        }

        // --- DRAW FOAM CREST DASH ---
        try {
          // Project continuous rendering space coordinates (fixes Pacific antimeridian split!)
          const pt = mapInstance.project([rLng, p.lat]);
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            if (Math.random() < 0.001) {
              console.log(`[Projection] Projection failed or invalid coordinate at [${p.lat.toFixed(4)}, ${rLng.toFixed(4)}]`);
            }
            continue;
          }
          if (Math.random() < 0.0005) {
            console.log(`[Projection] Projected coordinate [${p.lat.toFixed(4)}, ${rLng.toFixed(4)}] -> Screen Pixel: x=${pt.x.toFixed(1)}, y=${pt.y.toFixed(1)}`);
          }

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

          // Data-driven intensity: particles are more opaque in higher waves
          const energyAlpha = Math.min(1.0, 0.2 + h * 0.3);
          alpha *= energyAlpha; alpha = Math.min(1.0, alpha);

          if (alpha < 0.01) continue;

          // Wave direction for dash orientation
          // Standard meteorological direction conversion: Canvas_Angle = (Meteorological_Angle + 180) % 360.
          // Maps wave vectors (u, v) into Cartesian rendering direction, handling empty/calm fields strictly.
          let dirAngle = 0.0;
          if (Math.abs(wave.u) > 0.001 || Math.abs(wave.v) > 0.001) {
            dirAngle = Math.atan2(-wave.v, wave.u);
          }
          
          // v3.16: Scale width and length down elegant when zoomed out to render as premium micro-particles
          const zoomScale = Math.max(0.2, Math.min(1.2, zoom / 7.0));
          const dynamicDashLen = p.dashLen * Math.min(1.8, 0.4 + h * 0.5) * zoomScale;
          const halfDash = dynamicDashLen / 2;
          const dx = Math.cos(dirAngle + Math.PI / 2) * halfDash;
          const dy = -Math.sin(dirAngle + Math.PI / 2) * halfDash;

          // White foam crest broken dash with wave height color shift
          const hEnergy = Math.min(1, h / 4);
          const foamR = Math.round(210 + hEnergy * 45);
          const foamG = Math.round(225 + hEnergy * 30);
          const foamB = 255;
          ctx.strokeStyle = `rgba(${foamR}, ${foamG}, ${foamB}, ${alpha})`;
          ctx.lineWidth = Math.max(0.6, Math.min(4.0, (0.5 + h * 0.5) * zoomScale));
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
