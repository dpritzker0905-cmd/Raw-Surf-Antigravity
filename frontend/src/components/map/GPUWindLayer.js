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
 * v181 — MAXIMUM SIMPLICITY PARTICLE TEST:
 * 1. clearRect every frame (proven to work with red dot test)
 * 2. Draw particles as CIRCLES (not line segments) — maximum visibility
 * 3. Hard test dot at top of screen (x += 2/frame)
 * 4. Aggressive logging: particle positions, draw counts, data state
 * 5. No destination-out, no compositing tricks, no trail persistence
 *
 * Goal: Determine if particles are visible and moving.
 * Once confirmed, add trail persistence back.
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const animRef = useRef(null);
  const windRef = useRef(null);

  useEffect(() => { windRef.current = windVectors; }, [windVectors]);

  useEffect(() => {
    if (!mapInstance || !active) return;
    console.log('[Wind] === EFFECT TRIGGERED === mapInstance:', !!mapInstance, 'active:', active);

    const container = mapInstance.getCanvasContainer();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    container.appendChild(canvas);
    console.log('[Wind] Canvas appended to:', container.className, 'inDOM:', document.body.contains(canvas));

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
      console.log('[Wind] Resize:', cw, 'x', ch, 'backing:', canvas.width, 'x', canvas.height);
    };
    resize();

    // === PARTICLE POOL ===
    const PARTICLE_COUNT = 200;
    const particles = [];
    const spawnParticle = () => {
      const b = mapInstance.getBounds();
      return {
        lng: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
        lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
        age: 0, maxAge: 3 + Math.random() * 4
      };
    };
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());

    const speedColor = (speed) => {
      if (speed < 5) return '#78d2ff';
      if (speed < 10) return '#50ffb4';
      if (speed < 20) return '#ffdc32';
      return '#ff6444';
    };

    let lastTime = performance.now();
    let frameCount = 0;
    let testX = 30; // hard test dot

    const animate = (now) => {
      try {
        const dt = Math.min(50, now - lastTime) / 1000;
        lastTime = now;
        frameCount++;

        // === STEP 1: Clear entire canvas ===
        ctx.clearRect(0, 0, cw, ch);

        // === STEP 2: HARD TEST — animated red dot (no wind data needed) ===
        testX += 2;
        if (testX > cw - 10) testX = 30;
        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(testX, 30, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.fillText(`F:${frameCount} D:${windRef.current ? 'YES' : 'NO'}`, testX + 10, 34);

        // === STEP 3: Draw wind particles as circles ===
        const grid = windRef.current;
        let drawnCount = 0;

        if (grid?.vectors?.length) {
          const b = mapInstance.getBounds();
          const bw = b.getWest(), be = b.getEast();
          const bs = b.getSouth(), bn = b.getNorth();

          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.age += dt;
            const wind = interpolateWind(grid, p.lng, p.lat);

            // Move particle
            if (wind.speed > 0.1) {
              const scale = 0.003 * dt * 60;
              p.lng += wind.u * scale;
              p.lat += wind.v * scale;
            }

            // Project to screen coordinates
            const pt = mapInstance.project([p.lng, p.lat]);

            // Draw as CIRCLE — maximum visibility
            ctx.fillStyle = speedColor(wind.speed);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
            ctx.fill();
            drawnCount++;

            // Log first particle position on first few frames
            if (frameCount <= 3 && i === 0) {
              console.log(`[Wind] P0: lng=${p.lng.toFixed(3)} lat=${p.lat.toFixed(3)} → screen(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) wind:${wind.speed.toFixed(1)}`);
            }

            // Respawn
            if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn || p.age > p.maxAge) {
              particles[i] = spawnParticle();
            }
          }
        }

        // Log every 60 frames
        if (frameCount % 60 === 1) {
          console.log(`[Wind] Frame:${frameCount} drawn:${drawnCount} testX:${testX} data:${!!grid} canvas:${cw}x${ch}`);
        }

        mapInstance.triggerRepaint();
      } catch (err) {
        console.error('[Wind] animate error:', err.message, err.stack);
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    const onMove = () => {}; // No trail state to reset with circle mode
    mapInstance.on('resize', resize);

    return () => {
      console.log('[Wind] === UNMOUNTING ===');
      cancelAnimationFrame(animRef.current);
      mapInstance.off('resize', resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [mapInstance, active]);

  return null;
}
