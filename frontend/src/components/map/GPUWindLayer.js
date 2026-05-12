import { useState, useEffect, useRef, useCallback } from 'react';

// === FROZEN MOCK WIND DATA ===
// Known-good dataset for Atlantic/Florida coast, proving rendering independently of API.
// Wind from ESE ~15 km/h — realistic subtropical trade wind pattern.
function generateMockWind(bounds) {
  const { west, south, east, north } = bounds;
  const GRID = 6;
  const vectors = [];
  for (let yi = 0; yi <= GRID; yi++) {
    for (let xi = 0; xi <= GRID; xi++) {
      const lat = south + (yi / GRID) * (north - south);
      const lng = west + (xi / GRID) * (east - west);
      // Vary wind slightly across grid for visual realism
      const speed = 10 + Math.sin(lat * 0.5) * 5 + Math.cos(lng * 0.3) * 3;
      const dir = 130 + Math.sin(lng * 0.2) * 20; // ESE with variation
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
 * Uses live API when available, falls back to frozen mock data on failure/rate-limit.
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
        console.log(`[Wind] ${vectors.length} vectors from live API`);
        setWindData({ vectors, bounds: { west, south, east, north }, grid: GRID });
      } else {
        throw new Error('Zero valid wind vectors');
      }
    } catch (err) {
      // FALLBACK: use frozen mock data so rendering is never blocked by API
      console.warn(`[Wind] API failed (${err.message}), using mock data`);
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
 * Bilinear interpolation of u/v wind components at any lat/lng.
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
 * KEY FIX: Canvas is NOT resized every frame (resizing clears content on most browsers).
 * Trail effect uses semi-transparent clear instead of destination-in compositing.
 * z-index elevated to 5 to ensure visibility above MapLibre's internal canvas.
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const animRef = useRef(null);

  useEffect(() => {
    if (!mapInstance || !windVectors?.vectors?.length || !active) return;

    const container = mapInstance.getCanvasContainer();
    const canvas = document.createElement('canvas');
    // z-index 5 ensures above map tiles; pointer-events none allows map interaction through
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;display:block;';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Size canvas ONCE (and on explicit resize events only)
    let cw = 0, ch = 0;
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === cw && h === ch) return; // Skip if unchanged — prevents content wipe
      cw = w; ch = h;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Spawn particles across viewport
    const PARTICLE_COUNT = 250;
    const TRAIL_LEN = 7;
    const particles = [];
    const spawnParticle = () => {
      const b = mapInstance.getBounds();
      return {
        lng: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
        lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
        trail: [], age: 0, maxAge: 3 + Math.random() * 5
      };
    };
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());

    const speedColor = (speed) => {
      if (speed < 5) return '100,200,255';
      if (speed < 10) return '50,255,150';
      if (speed < 20) return '255,200,0';
      return '255,80,50';
    };

    let lastTime = performance.now();
    const animate = (now) => {
      const dt = Math.min(50, now - lastTime) / 1000;
      lastTime = now;

      // Fade previous frame with semi-transparent black (trail effect)
      // DO NOT use destination-in — it produces invisible canvas on first frames
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillRect(0, 0, cw, ch);

      const b = mapInstance.getBounds();
      const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.age += dt;

        const wind = interpolateWind(windVectors, p.lng, p.lat);
        if (wind.speed > 0.1) {
          const scale = 0.0003 * dt * 60;
          p.lng += wind.u * scale;
          p.lat += wind.v * scale;
        }

        const pt = mapInstance.project([p.lng, p.lat]);
        p.trail.push({ x: pt.x, y: pt.y });
        if (p.trail.length > TRAIL_LEN) p.trail.shift();

        if (p.trail.length > 1) {
          const rgb = speedColor(wind.speed);
          const alpha = Math.min(0.9, 0.3 + wind.speed / 15);
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let j = 1; j < p.trail.length; j++) ctx.lineTo(p.trail[j].x, p.trail[j].y);
          ctx.strokeStyle = `rgba(${rgb},${alpha})`;
          ctx.lineWidth = Math.max(1, wind.speed / 8);
          ctx.stroke();
        }

        // Respawn if out of viewport or aged out
        if (p.lng < w || p.lng > e || p.lat < s || p.lat > n || p.age > p.maxAge) {
          particles[i] = spawnParticle();
        }
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    // Clear trails on map move (prevents smearing)
    const onMove = () => { for (const p of particles) p.trail = []; };
    mapInstance.on('move', onMove);
    mapInstance.on('resize', resize);

    console.log('[Wind] Particle canvas mounted, z-index:5, particles:', PARTICLE_COUNT);

    return () => {
      cancelAnimationFrame(animRef.current);
      mapInstance.off('move', onMove);
      mapInstance.off('resize', resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [mapInstance, windVectors, active]);

  return null;
}
