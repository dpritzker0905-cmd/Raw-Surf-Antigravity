import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Viewport-scoped wind vector data hook.
 * Fetches wind speed/direction for the current map bbox.
 * Returns structured grid for bilinear interpolation in the particle engine.
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
      if (north <= south || east === west) return;
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
        // Decompose into u/v components for proper interpolation
        const rad = dir * (Math.PI / 180);
        vectors.push({
          lat: pt.lat, lng: pt.lng, speed, direction: dir,
          u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
        });
      });
      if (vectors.length > 0) {
        revisionRef.current += 1;
        // Store grid metadata for bilinear interpolation
        setWindData({ vectors, bounds: { west, south, east, north }, grid: GRID });
      }
    } catch (err) {
      if (!err.message?.includes('429')) console.warn('[WindVectors] Fetch failed:', err);
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
 * Uses the structured grid to produce smooth, continuous velocity fields.
 */
function interpolateWind(windGrid, lng, lat) {
  if (!windGrid?.vectors?.length) return { u: 0, v: 0, speed: 0 };
  const { vectors, bounds, grid } = windGrid;
  const { west, south, east, north } = bounds;

  // Normalize position to grid coordinates [0, grid]
  const gx = ((lng - west) / (east - west)) * grid;
  const gy = ((lat - south) / (north - south)) * grid;
  const cols = grid + 1;

  // Grid cell indices
  const xi = Math.max(0, Math.min(grid - 1, Math.floor(gx)));
  const yi = Math.max(0, Math.min(grid - 1, Math.floor(gy)));
  const fx = gx - xi;
  const fy = gy - yi;

  // Four corners of the grid cell
  const idx = (y, x) => y * cols + x;
  const get = (i) => vectors[i] || { u: 0, v: 0, speed: 0 };
  const p00 = get(idx(yi, xi));
  const p10 = get(idx(yi, xi + 1));
  const p01 = get(idx(yi + 1, xi));
  const p11 = get(idx(yi + 1, xi + 1));

  // Bilinear interpolation of u and v components
  const u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
            (1 - fx) * fy * p01.u + fx * fy * p11.u;
  const v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
            (1 - fx) * fy * p01.v + fx * fy * p11.v;
  const speed = Math.sqrt(u * u + v * v);
  return { u, v, speed };
}

/**
 * Canvas-based wind particle advection engine.
 * Renders animated particles flowing along bilinearly-interpolated wind velocity fields.
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const animRef = useRef(null);

  useEffect(() => {
    if (!mapInstance || !windVectors?.vectors?.length || !active) return;

    const container = mapInstance.getCanvasContainer();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + 'px';
      canvas.style.height = container.clientHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Spawn particles distributed across the viewport
    const PARTICLE_COUNT = 300;
    const TRAIL_LEN = 8;
    const particles = [];

    const spawnParticle = () => {
      const b = mapInstance.getBounds();
      return {
        lng: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
        lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
        trail: [], age: 0, maxAge: 4 + Math.random() * 6
      };
    };
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());

    const speedColor = (speed) => {
      if (speed < 5) return [100, 200, 255];
      if (speed < 10) return [50, 255, 150];
      if (speed < 20) return [255, 200, 0];
      return [255, 80, 50];
    };

    let lastTime = performance.now();
    const animate = (now) => {
      const dt = Math.min(50, now - lastTime) / 1000;
      lastTime = now;
      resize();

      // Fade for trail effect
      ctx.fillStyle = 'rgba(0,0,0,0.93)';
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';

      const b = mapInstance.getBounds();
      const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.age += dt;

        // Bilinear interpolation — smooth continuous field
        const wind = interpolateWind(windVectors, p.lng, p.lat);
        if (wind.speed > 0.1) {
          // u = east component, v = north component (m/s → degrees/frame)
          const scale = 0.0003 * dt * 60;
          p.lng += wind.u * scale;
          p.lat += wind.v * scale;
        }

        const pt = mapInstance.project([p.lng, p.lat]);
        p.trail.push({ x: pt.x, y: pt.y });
        if (p.trail.length > TRAIL_LEN) p.trail.shift();

        // Draw trail with speed-based color
        if (p.trail.length > 1) {
          const [r, g, b_] = speedColor(wind.speed);
          const alpha = Math.min(0.85, wind.speed / 12);
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let j = 1; j < p.trail.length; j++) ctx.lineTo(p.trail[j].x, p.trail[j].y);
          ctx.strokeStyle = `rgba(${r},${g},${b_},${alpha})`;
          ctx.lineWidth = Math.max(0.8, wind.speed / 8);
          ctx.stroke();
        }

        // Respawn if out of bounds or aged out
        if (p.lng < w || p.lng > e || p.lat < s || p.lat > n || p.age > p.maxAge) {
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
      cancelAnimationFrame(animRef.current);
      mapInstance.off('move', onMove);
      mapInstance.off('resize', resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [mapInstance, windVectors, active]);

  return null;
}
