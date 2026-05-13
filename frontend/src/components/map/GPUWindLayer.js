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
 * v179 FIXES:
 * 1. ANIMATED RED TEST DOT — moves 2px/frame to prove RAF drives screen updates
 * 2. try/catch in animate() prevents silent RAF loop death from exceptions
 * 3. Frame counter logs every 60 frames to prove continuous execution
 * 4. map.triggerRepaint() ensures MapLibre container composites correctly
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const animRef = useRef(null);
  const windRef = useRef(null);

  useEffect(() => { windRef.current = windVectors; }, [windVectors]);

  useEffect(() => {
    if (!mapInstance || !active) return;

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
      console.log('[Wind] Resized:', cw, 'x', ch, 'dpr:', dpr);
    };
    resize();
    console.log('[Wind] MOUNTED');

    const PARTICLE_COUNT = 300;
    const particles = [];
    const spawnParticle = () => {
      const b = mapInstance.getBounds();
      return {
        lng: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
        lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
        prevX: -1, prevY: -1, age: 0, maxAge: 2.5 + Math.random() * 4
      };
    };
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());

    const speedColor = (speed) => {
      if (speed < 5) return '120,210,255';
      if (speed < 10) return '80,255,180';
      if (speed < 20) return '255,220,50';
      return '255,100,60';
    };

    let lastTime = performance.now();
    let frameCount = 0;
    // Animated test dot — proves RAF is driving visible screen changes
    let testDotX = 50;

    const animate = (now) => {
      try {
        const dt = Math.min(50, now - lastTime) / 1000;
        lastTime = now;
        frameCount++;

        // Log every 60 frames to prove loop continuity
        if (frameCount % 60 === 1) {
          console.log(`[Wind] Frame ${frameCount}, testDot:${testDotX.toFixed(0)}, hasData:${!!windRef.current}`);
        }

        // === STEP 1: Clear canvas fully ===
        ctx.clearRect(0, 0, cw, ch);

        // === STEP 2: ANIMATED TEST DOT — red circle moves 2px/frame ===
        // If this dot does NOT move, the RAF loop is not driving screen updates
        testDotX += 2;
        if (testDotX > cw) testDotX = 50;
        ctx.fillStyle = 'rgba(255,50,50,0.9)';
        ctx.beginPath();
        ctx.arc(testDotX, 40, 8, 0, Math.PI * 2);
        ctx.fill();
        // Label
        ctx.fillStyle = 'white';
        ctx.font = '11px monospace';
        ctx.fillText(`frame:${frameCount}`, testDotX + 12, 44);

        // === STEP 3: Draw wind particles ===
        const grid = windRef.current;
        if (grid?.vectors?.length) {
          const b = mapInstance.getBounds();
          const bw = b.getWest(), be = b.getEast();
          const bs = b.getSouth(), bn = b.getNorth();

          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.age += dt;
            const wind = interpolateWind(grid, p.lng, p.lat);

            if (wind.speed > 0.1) {
              const scale = 0.003 * dt * 60;
              p.lng += wind.u * scale;
              p.lat += wind.v * scale;
            }

            const pt = mapInstance.project([p.lng, p.lat]);

            // Draw line segment from prev to current position
            if (p.prevX >= 0 && p.prevY >= 0) {
              const dx = pt.x - p.prevX;
              const dy = pt.y - p.prevY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 0.3 && dist < 80) {
                const rgb = speedColor(wind.speed);
                const alpha = Math.min(0.95, 0.4 + wind.speed / 12);
                ctx.beginPath();
                ctx.moveTo(p.prevX, p.prevY);
                ctx.lineTo(pt.x, pt.y);
                ctx.strokeStyle = `rgba(${rgb},${alpha})`;
                ctx.lineWidth = Math.max(1, Math.min(3, wind.speed / 6));
                ctx.stroke();
              }
            }
            p.prevX = pt.x;
            p.prevY = pt.y;

            // Respawn when out of bounds or aged out
            if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn || p.age > p.maxAge) {
              particles[i] = spawnParticle();
            }
          }
        }

        // Force MapLibre to composite our overlay
        mapInstance.triggerRepaint();

      } catch (err) {
        // CRITICAL: prevent RAF death from uncaught exceptions
        console.error('[Wind] animate error:', err.message);
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    const onMove = () => {
      for (const p of particles) { p.prevX = -1; p.prevY = -1; }
    };
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
