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
// v3.11.2: Amplified for visible ocean energy animation
var MARINE_PARTICLE_ALPHA = 0.72; // was 0.55

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
 * Bilinear interpolation on marine grid.
 */
function interpolateMarine(grid, lng, lat) {
  if (!grid?.vectors?.length) return { u: 0, v: 0, speed: 0 };
  const { vectors, bounds, cols, rows } = grid;
  const { west, south, east, north } = bounds;
  if (!cols || !rows || vectors.length !== cols * rows) return { u: 0, v: 0, speed: 0 };

  // v3.6: Normalize longitude for wrap-aware interpolation
  let nLng = lng;
  while (nLng > 180) nLng -= 360;
  while (nLng < -180) nLng += 360;

  const gx = Math.max(0, Math.min(cols - 1, ((nLng - west) / (east - west)) * (cols - 1)));
  const gy = Math.max(0, Math.min(rows - 1, ((lat - south) / (north - south)) * (rows - 1)));
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
  let nLng = lng;
  while (nLng > 180) nLng -= 360;
  while (nLng < -180) nLng += 360;
  if (lat < -85 || lat > 85) return false;

  const { vectors, bounds, cols, rows } = grid;
  // Strict bounding box check to prevent snapping to ocean edge cells when outside data bounds
  let inside = false;
  if (bounds.west <= bounds.east) {
    inside = (nLng >= bounds.west && nLng <= bounds.east);
  } else {
    inside = (nLng >= bounds.west || nLng <= bounds.east);
  }
  if (!inside || lat < bounds.south || lat > bounds.north) {
    return false;
  }

  // Nearest-neighbour cell lookup
  const gx = Math.round(((nLng - bounds.west) / (bounds.east - bounds.west)) * (cols - 1));
  const gy = Math.round(((lat - bounds.south) / (bounds.north - bounds.south)) * (rows - 1));
  
  if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return false;

  const cell = vectors[gy * cols + gx];
  if (!cell) return false;
  // Wave height threshold: if wave height/speed is <= 0, it's not ocean or has 0 waves!
  return typeof cell.speed === 'number' && cell.speed > 0 && Number.isFinite(cell.speed);
}

// v3.15: High-precision simplified Natural Earth land mask helper functions
function prepareLandPolygons(geojson) {
  if (!geojson?.features) return [];
  const polys = [];
  geojson.features.forEach(f => {
    const geom = f.geometry;
    if (!geom) return;
    const rings = [];
    if (geom.type === 'Polygon') {
      rings.push(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(r => rings.push(r));
    }
    rings.forEach(ring => {
      const outer = ring[0];
      if (!outer || outer.length === 0) return;
      let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
      outer.forEach(pt => {
        const lng = pt[0], lat = pt[1];
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      });
      polys.push({
        outer,
        holes: ring.slice(1),
        bbox: { west, east, south, north }
      });
    });
  });
  return polys;
}

function isPointInRing(lng, lat, ring) {
  let inside = false;
  const len = ring.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isCoordOnLand(lng, lat, landPolygons) {
  if (!landPolygons || landPolygons.length === 0) return false;
  let nLng = lng;
  while (nLng > 180) nLng -= 360;
  while (nLng < -180) nLng += 360;
  for (let i = 0; i < landPolygons.length; i++) {
    const poly = landPolygons[i];
    const bbox = poly.bbox;
    if (nLng < bbox.west || nLng > bbox.east || lat < bbox.south || lat > bbox.north) {
      continue;
    }
    if (isPointInRing(nLng, lat, poly.outer)) {
      let inHole = false;
      if (poly.holes) {
        for (let k = 0; k < poly.holes.length; k++) {
          if (isPointInRing(nLng, lat, poly.holes[k])) {
            inHole = true;
            break;
          }
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/**
 * Checks if a longitude is within bounding box, accounting for Antimeridian wrap-around.
 */
function isLngInBounds(lng, w, e) {
  return w <= e ? (lng >= w && lng <= e) : (lng >= w || lng <= e);
}

export function MarineParticleCanvas({ mapInstance, active, data, revision, id = "marine-canvas-layer" }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const dataRef = useRef(null);
  const particlesRef = useRef([]);
  const activeRef = useRef(active);

  // v3.15: Reference to Natural Earth simplified global land mask polygons
  const landPolygonsRef = useRef([]);

  useEffect(() => {
    fetch('/ne_110m_land.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(geojson => {
        const polys = prepareLandPolygons(geojson);
        landPolygonsRef.current = polys;
        console.log(`[Marine] Loaded offline-friendly 110m land mask: ${polys.length} polygons`);
      })
      .catch(err => {
        console.warn('[Marine] Local land mask failed, attempting CDN fallback:', err.message);
        fetch('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/110m/physical/ne_110m_land.json')
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then(geojson => {
            const polys = prepareLandPolygons(geojson);
            landPolygonsRef.current = polys;
            console.log(`[Marine] Loaded CDN fallback 110m land mask: ${polys.length} polygons`);
          })
          .catch(cdnErr => {
            console.warn('[Marine] CDN land mask fallback also failed:', cdnErr.message);
          });
      });
  }, []);

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
    // v3.11.2: Doubled marine particle counts for visible ocean animation
    const getParticleCount = () => {
      const zoom = mapInstance.getZoom();
      // v3.12: Boosted baseline particle counts for dynamic global wave animations
      const base = isMobile ? (isWeak ? 800 : 2000) : (isWeak ? 3500 : 8000);
      if (zoom < 3) return Math.round(base * 0.25);
      if (zoom < 5) return Math.round(base * 0.5);
      return base;
    };
    const PARTICLE_COUNT = getParticleCount();
    console.log(`[Marine] Spawning ${PARTICLE_COUNT} foam particles (zoom: ${mapInstance.getZoom().toFixed(1)})`);

    const spawn = (preAge = false) => {
      const mb = mapInstance.getBounds();
      if (!mb) {
        return { lng: 0, lat: 0, age: 0, maxAge: 0.1, dashLen: 0, phase: 999, energy: 0, noiseSeed: 0 };
      }
      const west = mb.getWest(), east = mb.getEast();
      const south = Math.max(-85, mb.getSouth()), north = Math.min(85, mb.getNorth());
      const grid = dataRef.current;
      const zoom = mapInstance.getZoom();
      const landPolys = landPolygonsRef.current;

      // Force particles to stay inactive (dummy state) if land mask is not loaded yet
      if (!landPolys || landPolys.length === 0) {
        return { lng: 0, lat: 0, age: 0, maxAge: 0.1, dashLen: 0, phase: 999, energy: 0, noiseSeed: 0 };
      }

      // Calculate the true visible longitude width
      let lngWidth = east - west;
      let isCrossed = false;
      if (west > east) {
        lngWidth = 360 - (west - east);
        isCrossed = true;
      }

      for (let attempt = 0; attempt < 12; attempt++) {
        let lng = west + Math.random() * lngWidth;
        if (isCrossed) {
          while (lng > 180) lng -= 360;
          while (lng < -180) lng += 360;
        }
        const lat = south + Math.random() * (north - south);
        if (isCoordOnLand(lng, lat, landPolys)) continue;
        if (!isLikelyOcean(lat, lng, grid)) continue;

        const wave = grid ? interpolateMarine(grid, lng, lat) : null;
        const spd = wave?.speed || 0;
        if (spd <= 0.01 || !Number.isFinite(spd)) continue; // Skip calm/land cells completely
        const energyScale = Math.min(1, spd / 3);
        const maxAge = (0.8 + Math.random() * 2.0) * (0.3 + energyScale * 0.7);
        const zoomScale = Math.max(0.3, Math.min(1.5, zoom / 6));
        // v74: Add spawn jitter to break grid-cell center alignment
        const jitter = 0.03; // 0.03 random offset
        const jLng = lng + (Math.random() - 0.5) * jitter * 2;
        const jLat = lat + (Math.random() - 0.5) * jitter * 2;
        let finalLng = jLng;
        while (finalLng > 180) finalLng -= 360;
        while (finalLng < -180) finalLng += 360;

        return {
          lng: finalLng, lat: jLat,
          age: preAge ? Math.random() * maxAge * 0.8 : 0,
          maxAge,
          dashLen: (3 + Math.random() * 8 * energyScale) * zoomScale,
          phase: Math.random(),
          energy: energyScale,
          // v74: Per-particle noise seed for organic flow variation
          noiseSeed: Math.random() * 100
        };
      }
      // Fallback particle: assign phase=999 to guarantee it will never be rendered
      const maxAge = 0.2;
      let fallLng = west + Math.random() * lngWidth;
      if (isCrossed) {
        while (fallLng > 180) fallLng -= 360;
        while (fallLng < -180) fallLng += 360;
      }
      return { lng: fallLng, lat: south + Math.random() * (north - south), age: preAge ? Math.random() * maxAge : 0, maxAge, dashLen: 3, phase: 999, energy: 0, noiseSeed: Math.random() * 100 };
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
      if (!grid?.vectors?.length) return;
      wasActive = true;
      frameCount++;

      // v3.9.7: Throttle state from coordinator (2 = throttled)
      const state = coordState === 2 ? 2 : 1;
      const THROTTLED = 2;

      // v3.11.2r1: Slower trail decay for visible foam persistence (was 0.12/0.3)
      const trailFade = state === THROTTLED ? 0.15 : 0.06;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
      ctx.fillRect(0, 0, cw, ch);
      // v3.11.3: source-over for scientific compositing (screen causes white foam)
      ctx.globalCompositeOperation = 'source-over';

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast(), bs = mb.getSouth(), bn = mb.getNorth();

      // v3.3: Use viewport bounds for particle lifecycle (global coverage)
      const paddedW = bw, paddedE = be, paddedS = bs, paddedN = bn;

      const stride = state === THROTTLED ? 4 : 1;
      const pts = particlesRef.current;
      const zoom = mapInstance.getZoom();

      for (let i = 0; i < pts.length; i += stride) {
        const p = pts[i];
        p.age += dt;

        // Interpolate wave vector at particle position
        const wave = interpolateMarine(grid, p.lng, p.lat);

        // Check if wave speed/height is 0 or too small (i.e. we hit land or calm water)
        if (wave.speed <= 0.01 || !Number.isFinite(wave.speed) || !Number.isFinite(wave.u) || !Number.isFinite(wave.v)) {
          pts[i] = spawn();
          continue;
        }

        // Staggered high-precision land mask check: check once every 10 frames to optimize CPU
        const landPolys = landPolygonsRef.current;
        if ((frameCount + i) % 10 === 0 && isCoordOnLand(p.lng, p.lat, landPolys)) {
          pts[i] = spawn();
          continue;
        }

        // Advect particle - speed scales with wave height/speed and dt!
        const waveSpeedAmp = 0.5 + Math.min(3.5, wave.speed * 0.8); // bigger waves flow dramatically faster
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

        // Respawn if out of bounds or too old
        const inPaddedBounds = isLngInBounds(p.lng, paddedW, paddedE) && p.lat >= paddedS && p.lat <= paddedN;
        if (p.age > p.maxAge || !inPaddedBounds) {
          pts[i] = spawn(); continue;
        }
        // Cull outside viewport (don't kill)
        if (!isLngInBounds(p.lng, bw, be) || p.lat < bs || p.lat > bn) continue;

        // Wave density scaling: absolutely 0 waves if speed <= 0.01, else scale up by wave height
        const h = Number.isFinite(wave.speed) ? wave.speed : 0;
        if (h <= 0.01) continue;
        const densityFactor = Math.min(1.0, Math.pow(h / 2.5, 0.9));
        if (p.phase > densityFactor) continue;

        // --- DRAW FOAM CREST DASH ---
        try {
          const pt = mapInstance.project([p.lng, p.lat]);
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;

          // Age-based alpha: fade in quickly, fade out slowly
          const ageRatio = p.age / p.maxAge;
          const fadeIn = Math.min(1, p.age / 0.3); // 0.3s fade in
          const fadeOut = 1 - Math.pow(ageRatio, 1.5);
          let alpha = fadeIn * fadeOut;

          // Edge fade (wrap-aware longitude fading)
          let viewLngWidth = paddedE - paddedW;
          if (paddedW > paddedE) viewLngWidth = 360 - (paddedW - paddedE);
          const edgePadLng = Math.max(0.5, viewLngWidth * 0.12);

          let distWest = p.lng - paddedW;
          while (distWest < 0) distWest += 360;
          while (distWest >= 360) distWest -= 360;

          if (distWest < edgePadLng) {
            alpha *= smoothstep(0, edgePadLng, distWest);
          }
          const distEast = viewLngWidth - distWest;
          if (distEast < edgePadLng) {
            alpha *= smoothstep(0, edgePadLng, distEast);
          }

          const latHeight = paddedN - paddedS;
          const edgePadLat = Math.max(0.5, latHeight * 0.12);
          alpha *= smoothstep(paddedS, paddedS + edgePadLat, p.lat);
          alpha *= smoothstep(paddedN, paddedN - edgePadLat, p.lat);
          alpha *= MARINE_PARTICLE_ALPHA;

          // Data-driven intensity: particles are more opaque in higher waves
          const energyAlpha = Math.min(1.0, 0.2 + h * 0.3);
          alpha *= energyAlpha; alpha = Math.min(1.0, alpha);

          if (alpha < 0.01) continue;

          // Wave direction for dash orientation
          const dirAngle = Math.atan2(-wave.v, wave.u) ;
          
          // Dynamically scale dash length and width by local wave height!
          const dynamicDashLen = p.dashLen * Math.min(2.2, 0.4 + h * 0.6);
          const halfDash = dynamicDashLen / 2;
          const dx = Math.cos(dirAngle) * halfDash;
          const dy = -Math.sin(dirAngle) * halfDash;

          // White foam crest broken dash with wave height color shift
          const hEnergy = Math.min(1, h / 4);
          const foamR = Math.round(210 + hEnergy * 45);
          const foamG = Math.round(225 + hEnergy * 30);
          const foamB = 255;
          ctx.strokeStyle = `rgba(${foamR}, ${foamG}, ${foamB}, ${alpha})`;
          const zScale = Math.max(0.5, Math.min(1.5, mapInstance.getZoom() / 6));
          ctx.lineWidth = Math.min(5.5, (0.7 + h * 0.8) * zScale);
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
        opacity: 0, transition: 'none'
      }}
    />
  );
}
