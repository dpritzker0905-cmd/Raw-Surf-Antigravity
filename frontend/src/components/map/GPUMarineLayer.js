/**
 * GPUMarineLayer.js — Marine-only renderer (v3.1)
 *
 * Renders ocean energy fields (waves, swell, wind waves) with:
 * A) Scalar ocean heatmap — color mapped to wave HEIGHT (meters)
 * B) White foam/crest broken dashes — direction only, NOT velocity vectors
 *
 * This renderer is architecturally separated from GPUWindLayer.js.
 * Marine must NEVER visually resemble wind.
 */
import { useEffect, useRef } from 'react';

// --- SINGLETON REGISTRY ---
const ACTIVE_MARINE_ENGINES = new Set();

// --- VISUAL TUNING ---
const MARINE_PADDING_FACTOR = 2.4;
const MARINE_PARTICLE_ALPHA = 0.55;

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

  const gx = Math.max(0, Math.min(cols - 1, ((lng - west) / (east - west)) * (cols - 1)));
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
 * Simple ocean heuristic — returns false for points likely over land.
 */
function isLikelyOcean(lat, lng) {
  if (lat > 25 && lat < 50 && lng > -125 && lng < -65) {
    if (lng > -82 && lat > 25 && lat < 45) return false;
    if (lng > -105 && lng < -82 && lat > 28 && lat < 49) return false;
    if (lng > -125 && lng < -115 && lat > 32 && lat < 49) return false;
  }
  if (lat > 15 && lat < 25 && lng > -105 && lng < -88) return false;
  if (lat > 7 && lat < 18 && lng > -92 && lng < -77) return false;
  if (lat > -55 && lat < 12 && lng > -80 && lng < -35) {
    if (lng > -75 && lng < -40 && lat > -35 && lat < 5) return false;
  }
  if (lat > 36 && lat < 70 && lng > -10 && lng < 40) return false;
  if (lat > -35 && lat < 37 && lng > -18 && lng < 52) return false;
  if (lat > 10 && lat < 75 && lng > 40 && lng < 145) return false;
  if (lat > -45 && lat < -10 && lng > 112 && lng < 155) return false;
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
    const PARTICLE_COUNT = isMobile ? (isWeak ? 400 : 1000) : (isWeak ? 2000 : 4000);
    console.log(`[Marine] Spawning ${PARTICLE_COUNT} foam particles`);

    const spawn = () => {
      const grid = dataRef.current;
      const gb = grid?.bounds;
      const rawW = gb?.west ?? -180, rawE = gb?.east ?? 180;
      const rawS = gb?.south ?? -85, rawN = gb?.north ?? 85;
      const cLng = (rawW + rawE) / 2, cLat = (rawS + rawN) / 2;
      const halfW = (rawE - rawW) / 2 * MARINE_PADDING_FACTOR;
      const halfH = (rawN - rawS) / 2 * MARINE_PADDING_FACTOR;
      const west = Math.max(-180, cLng - halfW), east = Math.min(180, cLng + halfW);
      const south = Math.max(-85, cLat - halfH), north = Math.min(85, cLat + halfH);
      // v3.2: Only spawn particles over ocean, retry up to 5 times
      for (let attempt = 0; attempt < 5; attempt++) {
        const lng = west + Math.random() * (east - west);
        const lat = south + Math.random() * (north - south);
        if (isLikelyOcean(lat, lng)) {
          return { lng, lat, age: 0, maxAge: 1.5 + Math.random() * 2.5, dashLen: 4 + Math.random() * 10, phase: Math.random() };
        }
      }
      // Fallback: place at random ocean-ish position
      return { lng: west + Math.random() * (east - west), lat: south + Math.random() * (north - south), age: 0, maxAge: 0.5, dashLen: 4, phase: 0 };
    };

    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawn());
    particlesRef.current = particles;

    let lastTime = performance.now();
    let frameCount = 0;
    let wasActive = false;

    // Interaction throttling
    const RUNNING = 1, THROTTLED = 2;
    let state = RUNNING, interactionCount = 0, idleTimer = null;
    const onDragStart = (e) => { if (!e?.originalEvent) return; interactionCount++; clearTimeout(idleTimer); state = THROTTLED; };
    const onZoomStart = (e) => { if (!e?.originalEvent) return; interactionCount++; clearTimeout(idleTimer); state = THROTTLED; };
    const onDragEnd = (e) => { if (!e?.originalEvent) return; interactionCount = Math.max(0, interactionCount - 1); };
    const onZoomEnd = (e) => { if (!e?.originalEvent) return; interactionCount = Math.max(0, interactionCount - 1); };
    const onIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (interactionCount === 0) state = RUNNING; }, 300);
    };
    mapInstance.on('dragstart', onDragStart);
    mapInstance.on('zoomstart', onZoomStart);
    mapInstance.on('dragend', onDragEnd);
    mapInstance.on('zoomend', onZoomEnd);
    mapInstance.on('moveend', onIdle);

    const animate = (now) => {
      if (!activeRef.current) {
        if (wasActive) { ctx.clearRect(0, 0, cw, ch); wasActive = false; }
        setTimeout(() => { if (animRef.current) animRef.current = requestAnimationFrame(animate); }, 500);
        return;
      }
      const grid = dataRef.current;
      if (!grid?.vectors?.length) { lastTime = now; animRef.current = requestAnimationFrame(animate); return; }
      wasActive = true;

      const dt = Math.min(50, now - lastTime) / 1000;
      lastTime = now;
      frameCount++;

      // Fast trail decay for foam (wispy, not streaming)
      const trailFade = state === THROTTLED ? 0.3 : 0.12;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'screen';

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast(), bs = mb.getSouth(), bn = mb.getNorth();

      const gb2 = grid.bounds || { west: bw, south: bs, east: be, north: bn };
      const pcLng = (gb2.west + gb2.east) / 2, pcLat = (gb2.south + gb2.north) / 2;
      const phW = (gb2.east - gb2.west) / 2 * MARINE_PADDING_FACTOR;
      const phH = (gb2.north - gb2.south) / 2 * MARINE_PADDING_FACTOR;
      const paddedW = Math.max(-180, pcLng - phW), paddedE = Math.min(180, pcLng + phW);
      const paddedS = Math.max(-85, pcLat - phH), paddedN = Math.min(85, pcLat + phH);

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
        // v3.2: Kill particles that drift over land
        if (!isLikelyOcean(p.lat, p.lng)) { pts[i] = spawn(); continue; }
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

          // Height-based intensity boost
          const h = wave.speed;
          alpha *= Math.min(1.5, 0.6 + h / 3);
          alpha = Math.min(1.0, alpha);

          if (alpha < 0.01) continue;

          // Wave direction for dash orientation
          // Wave propagation direction � particles flow WITH energy movement (like Windy.com)
          const dirAngle = Math.atan2(-wave.v, wave.u) ;
          const halfDash = p.dashLen / 2;
          const dx = Math.cos(dirAngle) * halfDash;
          const dy = -Math.sin(dirAngle) * halfDash;

          // White foam crest — broken dash, NOT continuous trail
          ctx.strokeStyle = `rgba(230, 240, 255, ${alpha})`;
          ctx.lineWidth = Math.min(3, 1.2 + h * 0.4);
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(pt.x - dx, pt.y - dy);
          ctx.lineTo(pt.x + dx, pt.y + dy);
          ctx.stroke();
        } catch (e) {
          pts[i] = spawn();
        }
      }

      if (frameCount % 120 === 1) {
        console.log(`[Marine] F:${frameCount} drawn:${pts.length} grid:${grid?.vectors?.length || 0}`);
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    const onResize = () => { const d = resize(); if (d) { cw = d.w; ch = d.h; } };
    window.addEventListener('resize', onResize);

    return () => {
      console.log(`[Marine] === UNMOUNTING (${id}) ===`);
      ACTIVE_MARINE_ENGINES.delete(id);
      cancelAnimationFrame(animRef.current);
      clearTimeout(idleTimer);
      window.removeEventListener('resize', onResize);
      mapInstance.off('dragstart', onDragStart);
      mapInstance.off('zoomstart', onZoomStart);
      mapInstance.off('dragend', onDragEnd);
      mapInstance.off('zoomend', onZoomEnd);
      mapInstance.off('moveend', onIdle);
    };
  }, [mapInstance]);

  return (
    <canvas
      id={id}
      ref={canvasRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 10,
        opacity: 0, transition: 'none'
      }}
    />
  );
}
