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
 * v177 FIXES — Pixel-to-screen coordinate alignment:
 * 1. Back to getCanvasContainer() — map.project() returns coords in this space
 * 2. Trail fade uses destination-out (fades to transparent, NOT accumulating black)
 * 3. clearRect every frame before drawing (no ghost accumulation)
 * 4. DPR diagnostic logging on mount
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const animRef = useRef(null);
  const windRef = useRef(null);

  useEffect(() => { windRef.current = windVectors; }, [windVectors]);

  useEffect(() => {
    if (!mapInstance || !active) return;

    // Use getCanvasContainer() — map.project() returns coords relative to THIS element
    const container = mapInstance.getCanvasContainer();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let cw = 0, ch = 0;

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === cw && h === ch) return;
      cw = w; ch = h;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Diagnostic: verify coordinate alignment
    console.log('[Wind] MOUNTED — canvas:', canvas.width, 'x', canvas.height,
      'style:', cw, 'x', ch, 'dpr:', dpr,
      'container:', container.className);

    const PARTICLE_COUNT = 250;
    const TRAIL_LEN = 6;
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
    let frameCount = 0;

    const animate = (now) => {
      const dt = Math.min(50, now - lastTime) / 1000;
      lastTime = now;
      frameCount++;
      if (frameCount <= 2) console.log(`[Wind] RAF frame ${frameCount}`);

      // CRITICAL FIX: Clear canvas fully each frame — prevents black accumulation
      ctx.clearRect(0, 0, cw, ch);

      const grid = windRef.current;
      if (!grid?.vectors?.length) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const b = mapInstance.getBounds();
      const bw = b.getWest(), be = b.getEast(), bs = b.getSouth(), bn = b.getNorth();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.age += dt;
        const wind = interpolateWind(grid, p.lng, p.lat);
        if (wind.speed > 0.1) {
          const scale = 0.0003 * dt * 60;
          p.lng += wind.u * scale;
          p.lat += wind.v * scale;
        }
        const pt = mapInstance.project([p.lng, p.lat]);
        p.trail.push({ x: pt.x, y: pt.y });
        if (p.trail.length > TRAIL_LEN) p.trail.shift();

        // Draw trail segments with decreasing opacity (oldest → newest)
        if (p.trail.length > 1) {
          const rgb = speedColor(wind.speed);
          for (let j = 1; j < p.trail.length; j++) {
            const segAlpha = (j / p.trail.length) * Math.min(0.9, 0.3 + wind.speed / 15);
            ctx.beginPath();
            ctx.moveTo(p.trail[j - 1].x, p.trail[j - 1].y);
            ctx.lineTo(p.trail[j].x, p.trail[j].y);
            ctx.strokeStyle = `rgba(${rgb},${segAlpha})`;
            ctx.lineWidth = Math.max(1, wind.speed / 8);
            ctx.stroke();
          }
        }

        if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn || p.age > p.maxAge) {
          particles[i] = spawnParticle();
        }
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    const onMove = () => { for (const p of particles) p.trail = []; };
    mapInstance.on('move', onMove);
    mapInstance.on('resize', resize);

    return () => {
      console.log('[Wind] UNMOUNTING');
      cancelAnimationFrame(animRef.current);
      mapInstance.off('move', onMove);
      mapInstance.off('resize', resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [mapInstance, active]);

  return null;
}
