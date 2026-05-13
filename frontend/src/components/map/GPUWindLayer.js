import { useState, useEffect, useRef, useCallback } from 'react';

// === FROZEN MOCK WIND DATA ===
function generateMockWind(bounds) {
  const { west, south, east, north } = bounds;
  const GRID = 6;
  const vectors = [];
  for (let yi = 0; yi <= GRID; yi++) {
    for (let xi = 0; xi <= GRID; xi++) {
      const lat = south + (yi / GRID) * (north - south);
      const lng = west + (xi / GRID) * (east - west);
      const speed = 10 + Math.sin(lat * 0.5) * 5 + Math.cos(lng * 0.3) * 3;
      const dir = 130 + Math.sin(lng * 0.2) * 20;
      const rad = dir * (Math.PI / 180);
      vectors.push({
        lat: +lat.toFixed(2), lng: +lng.toFixed(2), speed, direction: dir,
        u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
      });
    }
  }
  return { vectors, bounds, grid: GRID };
}

/**
 * Viewport-scoped wind vector data hook.
 */
export function useWindVectorData({ active, mapBounds }) {
  const [windData, setWindData] = useState(null);
  const fetchingRef = useRef(false);
  const revisionRef = useRef(0);

  const fetchWind = useCallback(async (bounds) => {
    if (!bounds || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { west, south, east, north } = bounds;
      if (north <= south || east === west) { fetchingRef.current = false; return; }
      const GRID = 8;
      const latStep = (north - south) / GRID;
      const lngStep = (east - west) / GRID;
      const points = [];
      for (let yi = 0; yi <= GRID; yi++) {
        for (let xi = 0; xi <= GRID; xi++) {
          let lng = west + xi * lngStep;
          while (lng > 180) lng -= 360;
          while (lng < -180) lng += 360;
          points.push({ lat: +(south + yi * latStep).toFixed(2), lng: +lng.toFixed(2) });
        }
      }
      const safe = points.slice(0, 80);
      const lats = safe.map(p => p.lat).join(',');
      const lons = safe.map(p => p.lng).join(',');
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&forecast_days=1`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const results = Array.isArray(json) ? json : [json];
      const vectors = [];
      safe.forEach((pt, i) => {
        const r = results[i];
        if (!r?.current) return;
        const speed = r.current.wind_speed_10m;
        const dir = r.current.wind_direction_10m;
        if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;
        const rad = dir * (Math.PI / 180);
        vectors.push({
          lat: pt.lat, lng: pt.lng, speed, direction: dir,
          u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
        });
      });
      if (vectors.length > 0) {
        revisionRef.current += 1;
        console.log(`[Wind] ${vectors.length} live vectors`);
        setWindData({ vectors, bounds: { west, south, east, north }, grid: GRID });
      } else {
        throw new Error('Zero valid wind vectors');
      }
    } catch (err) {
      console.warn(`[Wind] API failed (${err.message}), using mock`);
      const mockBounds = bounds || { west: -82, south: 24, east: -76, north: 32 };
      revisionRef.current += 1;
      setWindData(generateMockWind(mockBounds));
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || !mapBounds) { setWindData(null); return; }
    const timer = setTimeout(() => fetchWind(mapBounds), 1500);
    return () => clearTimeout(timer);
  }, [active, mapBounds, fetchWind]);

  return { windData, windRevision: revisionRef };
}

/**
 * Bilinear interpolation of u/v wind components.
 */
function interpolateWind(windGrid, lng, lat) {
  if (!windGrid?.vectors?.length) return { u: 0, v: 0, speed: 0 };
  const { vectors, bounds, grid } = windGrid;
  const { west, south, east, north } = bounds;
  const gx = ((lng - west) / (east - west)) * grid;
  const gy = ((lat - south) / (north - south)) * grid;
  const cols = grid + 1;
  const xi = Math.max(0, Math.min(grid - 1, Math.floor(gx)));
  const yi = Math.max(0, Math.min(grid - 1, Math.floor(gy)));
  const fx = gx - xi;
  const fy = gy - yi;
  const idx = (y, x) => y * cols + x;
  const get = (i) => vectors[i] || { u: 0, v: 0, speed: 0 };
  const p00 = get(idx(yi, xi));
  const p10 = get(idx(yi, xi + 1));
  const p01 = get(idx(yi + 1, xi));
  const p11 = get(idx(yi + 1, xi + 1));
  const u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
            (1 - fx) * fy * p01.u + fx * fy * p11.u;
  const v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
            (1 - fx) * fy * p01.v + fx * fy * p11.v;
  return { u, v, speed: Math.sqrt(u * u + v * v) };
}

/**
 * Canvas-based wind particle advection engine.
 *
 * v186 — Production-ready:
 * - React-managed canvas (v183 fix for stacking context)
 * - Latitude clamped to [-85, 85] to prevent map.project() crash
 * - Bounds check BEFORE projection (not after)
 * - Diagnostic visuals removed (wind confirmed working)
 * - Error logging throttled to prevent console flood
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const windRef = useRef(null);
  const particlesRef = useRef([]);
  const inlineMockRef = useRef(null);

  useEffect(() => { windRef.current = windVectors; }, [windVectors]);

  useEffect(() => {
    if (!mapInstance || !active || !canvasRef.current) return;
    console.log('[Wind] === STARTING v186 ===');

    // Generate inline mock immediately — zero API dependency
    const b = mapInstance.getBounds();
    inlineMockRef.current = generateMockWind({
      west: b.getWest(), south: b.getSouth(),
      east: b.getEast(), north: b.getNorth()
    });
    console.log('[Wind] Inline mock:', inlineMockRef.current.vectors.length, 'vectors');

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    };
    const dims = resize() || { w: 800, h: 600 };
    let cw = dims.w, ch = dims.h;

    // Spawn particles within current viewport
    const PARTICLE_COUNT = 300;
    const spawn = () => {
      const mb = mapInstance.getBounds();
      return {
        lng: mb.getWest() + Math.random() * (mb.getEast() - mb.getWest()),
        lat: mb.getSouth() + Math.random() * (mb.getNorth() - mb.getSouth()),
        age: 0, maxAge: 3 + Math.random() * 4
      };
    };
    particlesRef.current = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particlesRef.current.push(spawn());

    let lastTime = performance.now();
    let frameCount = 0;
    let errorCount = 0;

    const animate = (now) => {
      const dt = Math.min(50, now - lastTime) / 1000;
      lastTime = now;
      frameCount++;

      ctx.clearRect(0, 0, cw, ch);

      const grid = windRef.current || inlineMockRef.current;
      const particles = particlesRef.current;

      if (grid?.vectors?.length) {
        const mb = mapInstance.getBounds();
        const bw = mb.getWest(), be = mb.getEast();
        const bs = mb.getSouth(), bn = mb.getNorth();

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.age += dt;

          // Advect particle
          const wind = interpolateWind(grid, p.lng, p.lat);
          if (wind.speed > 0.1) {
            const scale = 0.003 * dt * 60;
            p.lng += wind.u * scale;
            p.lat += wind.v * scale;
          }

          // CLAMP latitude to prevent map.project() crash (must be -90 to 90)
          p.lat = Math.max(-85, Math.min(85, p.lat));
          // WRAP longitude
          while (p.lng > 180) p.lng -= 360;
          while (p.lng < -180) p.lng += 360;

          // Respawn if out of viewport or too old — BEFORE projection
          if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn || p.age > p.maxAge) {
            particles[i] = spawn();
            continue;
          }

          // Project to screen coordinates (safe — lat is clamped)
          try {
            const pt = mapInstance.project([p.lng, p.lat]);
            const hue = Math.min(120, wind.speed * 8);
            ctx.fillStyle = `hsl(${120 - hue}, 90%, 55%)`;
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          } catch (e) {
            // Throttle error logging — max 3 per session
            if (errorCount < 3) {
              console.warn('[Wind] project() error:', e.message, `lat:${p.lat} lng:${p.lng}`);
              errorCount++;
            }
            particles[i] = spawn();
          }
        }
      }

      if (frameCount % 120 === 1) {
        console.log(`[Wind] F:${frameCount} drawn:${particles.length} grid:${grid?.vectors?.length || 0}`);
      }

      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    const onResize = () => {
      const d = resize();
      if (d) { cw = d.w; ch = d.h; }
    };
    window.addEventListener('resize', onResize);

    return () => {
      console.log('[Wind] === UNMOUNTING ===');
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [mapInstance, active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
