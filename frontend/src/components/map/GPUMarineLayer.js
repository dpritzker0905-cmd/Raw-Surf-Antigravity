/**
 * GPUMarineLayer.js â€” Marine-only renderer (v3.1)
 *
 * Renders ocean energy fields (waves, swell, wind waves) with:
 * A) Scalar ocean heatmap â€” color mapped to wave HEIGHT (meters)
 * B) White foam/crest broken dashes â€” direction only, NOT velocity vectors
 *
 * This renderer is architecturally separated from GPUWindLayer.js.
 * Marine must NEVER visually resemble wind.
 */
import { useEffect, useRef } from 'react';
import { getAnimationCoordinator } from './CanvasAnimationCoordinator';

// --- SINGLETON REGISTRY ---
var ACTIVE_MARINE_ENGINES = new Set();

// --- VISUAL TUNING ---
// v3.3: Padding factor removed - particles now spawn at viewport bounds
var MARINE_PARTICLE_ALPHA = 0.55;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
 * v3.9: Robust land rejection for marine particles.
 * Uses a coarse continental bounding-box table to reject obvious land,
 * then falls back to grid wave energy for coastal resolution.
 */
var LAND_BOXES = [
  // North America (excl. coasts) — conservative interior boxes
  { s: 25, n: 50, w: -115, e: -75 },
  // South America interior
  { s: -55, n: 10, w: -75, e: -35 },
  // Africa interior
  { s: -35, n: 35, w: -15, e: 50 },
  // Europe interior
  { s: 36, n: 70, w: -10, e: 40 },
  // Asia interior
  { s: 10, n: 70, w: 40, e: 140 },
  // Australia interior
  { s: -40, n: -12, w: 115, e: 153 },
  // Antarctica
  { s: -90, n: -60, w: -180, e: 180 },
];

function isLikelyOcean(lat, lng, grid) {
  // Normalize longitude
  let nLng = lng;
  while (nLng > 180) nLng -= 360;
  while (nLng < -180) nLng += 360;

  // Fast reject: if deep inside a continental bounding box, definitely land
  for (const box of LAND_BOXES) {
    // Shrink box by 2° to avoid rejecting actual coastline
    if (lat > box.s + 2 && lat < box.n - 2 &&
        nLng > box.w + 2 && nLng < box.e - 2) {
      return false;
    }
  }

  // Grid-based check: zero wave energy = land or calm ocean
  if (grid) {
    const wave = interpolateMarine(grid, lng, lat);
    if (wave.speed < 0.05 && wave.u === 0 && wave.v === 0) return false;
  }
  return true;
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
    const getParticleCount = () => {
      const zoom = mapInstance.getZoom();
      const base = isMobile ? (isWeak ? 200 : 500) : (isWeak ? 1000 : 2000);
      if (zoom < 3) return Math.round(base * 0.25);
      if (zoom < 5) return Math.round(base * 0.5);
      return base;
    };
    const PARTICLE_COUNT = getParticleCount();
    console.log(`[Marine] Spawning ${PARTICLE_COUNT} foam particles (zoom: ${mapInstance.getZoom().toFixed(1)})`);

    const spawn = (preAge = false) => {
      const mb = mapInstance.getBounds();
      const west = mb.getWest(), east = mb.getEast();
      const south = Math.max(-85, mb.getSouth()), north = Math.min(85, mb.getNorth());
      const grid = dataRef.current;
      const zoom = mapInstance.getZoom();
      for (let attempt = 0; attempt < 12; attempt++) {
        const lng = west + Math.random() * (east - west);
        const lat = south + Math.random() * (north - south);
        if (!isLikelyOcean(lat, lng, grid)) continue;
        const wave = grid ? interpolateMarine(grid, lng, lat) : null;
        const spd = wave?.speed || 0;
        if (spd < 0.1 && Math.random() > 0.05) continue;
        const energyScale = Math.min(1, spd / 3);
        const maxAge = (0.8 + Math.random() * 2.0) * (0.3 + energyScale * 0.7);
        const zoomScale = Math.max(0.3, Math.min(1.5, zoom / 6));
        return {
          lng, lat,
          age: preAge ? Math.random() * maxAge * 0.8 : 0,
          maxAge,
          dashLen: (3 + Math.random() * 8 * energyScale) * zoomScale,
          phase: Math.random(),
          energy: energyScale
        };
      }
      const maxAge = 0.2;
      return { lng: west + Math.random() * (east - west), lat: south + Math.random() * (north - south), age: preAge ? Math.random() * maxAge : 0, maxAge, dashLen: 3, phase: 0, energy: 0 };
    };

    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawn(true));
    particlesRef.current = particles;

    let frameCount = 0;
    let wasActive = false;

    // v3.9.7: Phase 2 — register with shared CanvasAnimationCoordinator
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

      // Fast trail decay for foam (wispy, not streaming)
      const trailFade = state === THROTTLED ? 0.3 : 0.12;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'screen';

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast(), bs = mb.getSouth(), bn = mb.getNorth();

      // v3.3: Use viewport bounds for particle lifecycle (global coverage)
      const paddedW = bw, paddedE = be, paddedS = bs, paddedN = bn;

      const stride = state === THROTTLED ? 4 : 1;
      const pts = particlesRef.current;

      for (let i = 0; i < pts.length; i += stride) {
        const p = pts[i];
        p.age += dt;

        // Interpolate wave vector at particle position
        const wave = interpolateMarine(grid, p.lng, p.lat);

        // Slow advection (ocean drift, not atmospheric flow)
        if (wave.speed > 0.01 && Number.isFinite(wave.u) && Number.isFinite(wave.v)) {
          try {
            const scale = 0.003 * dt * 60; // Much slower than wind
            const screen = mapInstance.project([p.lng, p.lat]);
            if (!screen || !Number.isFinite(screen.x)) { p.age = p.maxAge + 1; continue; }
            screen.x += wave.u * scale * 30;
            screen.y -= wave.v * scale * 30;
            const next = mapInstance.unproject(screen);
            if (!next || !Number.isFinite(next.lng)) { p.age = p.maxAge + 1; continue; }
            p.lng = next.lng;
            p.lat = next.lat;
          } catch (e) { p.age = p.maxAge + 1; }
        } else {
          p.age = p.maxAge + 1;
        }

        // Clamp & wrap
        if (isNaN(p.lat) || isNaN(p.lng)) { pts[i] = spawn(); continue; }
        // v3.6: Kill particles that drift over land (data-driven)
        if (!isLikelyOcean(p.lat, p.lng, grid)) { pts[i] = spawn(); continue; }
        p.lat = Math.max(-85, Math.min(85, p.lat));
        while (p.lng > 180) p.lng -= 360;
        while (p.lng < -180) p.lng += 360;

        // Respawn if out of bounds or too old
        if (p.age > p.maxAge || p.lng < paddedW || p.lng > paddedE || p.lat < paddedS || p.lat > paddedN) {
          pts[i] = spawn(); continue;
        }
        // Cull outside viewport (don't kill)
        if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn) continue;

        // --- DRAW FOAM CREST DASH ---
        try {
          const pt = mapInstance.project([p.lng, p.lat]);
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;

          // Age-based alpha: fade in quickly, fade out slowly
          const ageRatio = p.age / p.maxAge;
          const fadeIn = Math.min(1, p.age / 0.3); // 0.3s fade in
          const fadeOut = 1 - Math.pow(ageRatio, 1.5);
          let alpha = fadeIn * fadeOut;

          // Edge fade
          const edgePad = Math.max(1, (paddedE - paddedW) * 0.12);
          alpha *= smoothstep(paddedW, paddedW + edgePad, p.lng);
          alpha *= smoothstep(paddedE, paddedE - edgePad, p.lng);
          alpha *= smoothstep(paddedS, paddedS + edgePad, p.lat);
          alpha *= smoothstep(paddedN, paddedN - edgePad, p.lat);
          alpha *= MARINE_PARTICLE_ALPHA;

          // v3.4: Data-driven intensity — particles fade in calm water
          const h = wave.speed;
          const energyAlpha = p.energy !== undefined ? (0.15 + p.energy * 0.85) : Math.min(1.5, 0.6 + h / 3);
          alpha *= energyAlpha; alpha = Math.min(1.0, alpha);

          if (alpha < 0.01) continue;

          // Wave direction for dash orientation
          // Wave propagation direction — particles flow WITH energy movement (like Windy.com)
          const dirAngle = Math.atan2(-wave.v, wave.u) ;
          const halfDash = p.dashLen / 2;
          const dx = Math.cos(dirAngle) * halfDash;
          const dy = -Math.sin(dirAngle) * halfDash;

          // White foam crest â€” broken dash, NOT continuous trail
          ctx.strokeStyle = `rgba(230, 240, 255, ${alpha})`;
          // v3.6: Zoom-scaled line width
          const zScale = Math.max(0.4, Math.min(1.2, mapInstance.getZoom() / 6));
          ctx.lineWidth = Math.min(3, (0.8 + h * 0.4) * zScale);
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
