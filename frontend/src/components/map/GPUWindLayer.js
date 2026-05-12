import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Viewport-scoped wind vector data hook.
 * Fetches u/v wind components for the current map bbox.
 * Returns raw vector grid for the particle engine.
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
      // Validate bounds
      if (north <= south || east === west) return;
      const latStep = Math.max(0.5, (north - south) / 8);
      const lngStep = Math.max(0.5, (east - west) / 8);
      const points = [];
      for (let lat = south; lat <= north; lat += latStep) {
        for (let lng = west; lng <= east; lng += lngStep) {
          let n = lng;
          while (n > 180) n -= 360;
          while (n < -180) n += 360;
          points.push({ lat: +lat.toFixed(2), lng: +n.toFixed(2) });
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
        vectors.push({ lat: pt.lat, lng: pt.lng, speed, direction: dir });
      });
      if (vectors.length > 0) {
        revisionRef.current += 1;
        setWindData(vectors);
      }
    } catch (err) {
      console.warn('[WindVectors] Viewport fetch failed:', err);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || !mapBounds) { setWindData(null); return; }
    const timer = setTimeout(() => fetchWind(mapBounds), 1200);
    return () => clearTimeout(timer);
  }, [active, mapBounds, fetchWind]);

  return { windData, windRevision: revisionRef };
}

/**
 * Canvas-based wind particle advection engine.
 * Renders animated particles flowing along real wind velocity fields.
 * Particles move continuously, speed/direction driven by nearest vector data.
 */
export function WindParticleCanvas({ mapInstance, windVectors, active }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!mapInstance || !windVectors?.length || !active) return;

    const container = mapInstance.getCanvasContainer();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
    container.appendChild(canvas);
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width = container.clientWidth * (window.devicePixelRatio || 1);
      canvas.height = container.clientHeight * (window.devicePixelRatio || 1);
      canvas.style.width = container.clientWidth + 'px';
      canvas.style.height = container.clientHeight + 'px';
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    };
    resize();

    // Create particles — 4 per vector for good density
    const PARTICLES_PER_VECTOR = 4;
    const TRAIL_LENGTH = 6;
    const particles = [];
    windVectors.forEach(v => {
      for (let i = 0; i < PARTICLES_PER_VECTOR; i++) {
        const rad = v.direction * (Math.PI / 180);
        const maxDist = Math.max(0.3, v.speed * 0.06);
        particles.push({
          lng: v.lng + (Math.random() - 0.5) * maxDist,
          lat: v.lat + (Math.random() - 0.5) * maxDist,
          srcVec: v, rad, maxDist,
          trail: [], age: Math.random() * 100
        });
      }
    });

    // Find nearest vector for a given position (simple nearest-neighbor)
    const findNearest = (lng, lat) => {
      let best = windVectors[0], bestDist = Infinity;
      for (const v of windVectors) {
        const d = (v.lng - lng) ** 2 + (v.lat - lat) ** 2;
        if (d < bestDist) { bestDist = d; best = v; }
      }
      return best;
    };

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
      // Fade previous frame for trail effect
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';

      const bounds = mapInstance.getBounds();
      const w = bounds.getWest(), e = bounds.getEast();
      const s = bounds.getSouth(), n = bounds.getNorth();

      particles.forEach(p => {
        p.age += dt;
        // Advect particle by wind velocity
        const v = findNearest(p.lng, p.lat);
        const rad = v.direction * (Math.PI / 180);
        const moveScale = v.speed * 0.003 * dt * 60;
        p.lng += Math.sin(rad) * moveScale;
        p.lat -= Math.cos(rad) * moveScale;

        // Project to screen
        const pt = mapInstance.project([p.lng, p.lat]);
        p.trail.push({ x: pt.x, y: pt.y });
        if (p.trail.length > TRAIL_LENGTH) p.trail.shift();

        // Draw trail
        if (p.trail.length > 1) {
          const [r, g, b] = speedColor(v.speed);
          const alpha = Math.min(0.8, v.speed / 15);
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let i = 1; i < p.trail.length; i++) {
            ctx.lineTo(p.trail[i].x, p.trail[i].y);
          }
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = Math.max(1, v.speed / 10);
          ctx.stroke();
        }

        // Respawn if out of viewport
        if (p.lng < w || p.lng > e || p.lat < s || p.lat > n || p.age > 8) {
          const src = windVectors[Math.floor(Math.random() * windVectors.length)];
          p.lng = src.lng + (Math.random() - 0.5) * 0.3;
          p.lat = src.lat + (Math.random() - 0.5) * 0.3;
          p.srcVec = src;
          p.trail = [];
          p.age = 0;
        }
      });

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    // Clear trails on map move to prevent visual smearing
    const onMove = () => { particles.forEach(p => p.trail = []); };
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
