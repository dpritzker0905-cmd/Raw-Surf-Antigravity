// Data fetching has been moved to WeatherEngine.js to decouple from MapLibre events.
// This file now only handles the GPU/Canvas particle rendering.

/**
 * Bilinear interpolation of u/v wind components.
 */
function interpolateWind(windGrid, lng, lat) {
  if (!windGrid?.vectors?.length) return { u: 0, v: 0, speed: 0 };
  const { vectors, bounds, cols, rows } = windGrid;
  const { west, south, east, north } = bounds;
  
  if (!cols || !rows) {
    console.error(`[Wind] WIND_TOPOLOGY_MISSING: Interpolation requires cols/rows metadata.`);
    return { u: 0, v: 0, speed: 0 };
  }

  if (vectors.length !== cols * rows) {
    console.warn(`[Wind] WIND_TOPOLOGY_INVALID: length=${vectors.length}, expected=${cols*rows}`);
    return { u: 0, v: 0, speed: 0 };
  }

  const gx = Math.max(0, Math.min(cols - 1, ((lng - west) / (east - west)) * (cols - 1)));
  const gy = Math.max(0, Math.min(rows - 1, ((lat - south) / (north - south)) * (rows - 1)));
  const xi = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  const yi = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  const fx = gx - xi;
  const fy = gy - yi;
  
  const idx = (y, x) => y * cols + x;
  
  const i00 = idx(yi, xi);
  const i10 = idx(yi, xi + 1);
  const i01 = idx(yi + 1, xi);
  const i11 = idx(yi + 1, xi + 1);

  const p00 = vectors[i00];
  const p10 = vectors[i10];
  const p01 = vectors[i01];
  const p11 = vectors[i11];

  if (p00 === undefined || p10 === undefined || p01 === undefined || p11 === undefined) {
    if (Math.random() < 0.005) console.warn('[Wind] INTERPOLATION_NEIGHBOR_INVALID');
    return { u: 0, v: 0, speed: 0 };
  }

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
import { useEffect, useRef } from 'react';

export function WindParticleCanvas({ mapInstance, active, data, revision }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const windRef = useRef(null);
  const particlesRef = useRef([]);
  const inlineMockRef = useRef(null);

  const activeRef = useRef(active);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    windRef.current = data;
    // v245: Data pipeline diagnostic — helps debug "dots only, no animation"
    if (data?.vectors?.length) {
      const sample = data.vectors[0];
      console.log(`[Wind] Data received: ${data.vectors.length} vectors, cols=${data.cols}, rows=${data.rows}, sample: u=${sample.u?.toFixed(2)} v=${sample.v?.toFixed(2)} speed=${sample.speed?.toFixed(1)}`);
    }
  }, [data, revision]);

  useEffect(() => {
    if (!mapInstance || !canvasRef.current) return;
    console.log('[Wind] === STARTING PERSISTENT ENGINE ===');

    // We no longer inject inline mock data. We rely exclusively on the live fetch pipeline.
    inlineMockRef.current = null;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

    // Adaptive particle count based on hardware / viewport size
    const isMobile = window.innerWidth < 768;
    const isWeak = (navigator.hardwareConcurrency || 4) <= 4;
    const PARTICLE_COUNT = isMobile ? (isWeak ? 300 : 800) : (isWeak ? 1500 : 3000);
    console.log(`[Wind] Spawning ${PARTICLE_COUNT} particles (isMobile: ${isMobile}, cores: ${navigator.hardwareConcurrency})`);
    
    const spawn = () => {
      const grid = windRef.current;
      const mb = mapInstance.getBounds();
      // Bound spawning to the vector grid if available to prevent spawning dead particles
      const west = grid?.bounds ? Math.max(mb.getWest(), grid.bounds.west) : mb.getWest();
      const east = grid?.bounds ? Math.min(mb.getEast(), grid.bounds.east) : mb.getEast();
      const south = grid?.bounds ? Math.max(mb.getSouth(), grid.bounds.south) : mb.getSouth();
      const north = grid?.bounds ? Math.min(mb.getNorth(), grid.bounds.north) : mb.getNorth();
      
      return {
        lng: west + Math.random() * (east - west),
        lat: south + Math.random() * (north - south),
        age: 0, maxAge: 3 + Math.random() * 4
      };
    };
    particlesRef.current = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particlesRef.current.push(spawn());

    let lastTime = performance.now();
    let frameCount = 0;
    let errorCount = 0;
    let wasActive = false;

    // v245: Reference-counted interaction — only USER gestures, not programmatic flyTo/easeTo
    const WIND_RUNNING = 1;
    const WIND_THROTTLED = 2;
    let windState = WIND_RUNNING;
    let windInteractionCount = 0;
    let idleTimer = null;

    const onDragStart = (e) => { if (!e?.originalEvent) return; windInteractionCount++; clearTimeout(idleTimer); windState = WIND_THROTTLED; };
    const onZoomStart = (e) => { if (!e?.originalEvent) return; windInteractionCount++; clearTimeout(idleTimer); windState = WIND_THROTTLED; };
    const onDragEnd = (e) => { if (!e?.originalEvent) return; windInteractionCount = Math.max(0, windInteractionCount - 1); };
    const onZoomEnd = (e) => { if (!e?.originalEvent) return; windInteractionCount = Math.max(0, windInteractionCount - 1); };
    const onIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (windInteractionCount === 0) windState = WIND_RUNNING;
      }, 300);
    };
    mapInstance.on('dragstart', onDragStart);
    mapInstance.on('zoomstart', onZoomStart);
    mapInstance.on('dragend', onDragEnd);
    mapInstance.on('zoomend', onZoomEnd);
    mapInstance.on('moveend', onIdle);

    const animate = (now) => {
      if (!activeRef.current) {
        if (wasActive) {
          ctx.clearRect(0, 0, cw, ch);
          wasActive = false;
        }
        // Throttled RAF when dormant (check every 500ms instead of 16ms)
        setTimeout(() => {
          if (animRef.current) animRef.current = requestAnimationFrame(animate);
        }, 500);
        return;
      }
      const grid = windRef.current || inlineMockRef.current;
      if (!grid?.vectors?.length) {
        lastTime = now;
        animRef.current = requestAnimationFrame(animate);
        return;
      }
      
      wasActive = true;

      const dt = Math.min(50, now - lastTime) / 1000;
      lastTime = now;
      frameCount++;

      // v246: Trail decay fix — use simple fade to black to prevent endless streaking
      const trailOpacity = windState === WIND_THROTTLED ? 0.1 : 0.03;
      ctx.fillStyle = `rgba(0, 0, 0, ${trailOpacity})`;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillRect(0, 0, cw, ch);

      const particles = particlesRef.current;

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast();
      const bs = mb.getSouth(), bn = mb.getNorth();

      // v243: Stride from lifecycle state — NEVER restart loop
      const stride = windState === WIND_THROTTLED ? 4 : 1;

      for (let i = 0; i < particles.length; i += stride) {
          const p = particles[i];
          p.age += dt;

          const { west, south, east, north } = grid.bounds || { west: bw, south: bs, east: be, north: bn };
          const withinVectorBounds = p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north;

          // Store previous screen position for trail drawing
          let prevScreen = null;
          try {
            const ps = mapInstance.project([p.lng, p.lat]);
            if (ps && Number.isFinite(ps.x) && Number.isFinite(ps.y)) prevScreen = ps;
          } catch (e) {}

          // Advect particle
          const wind = interpolateWind(grid, p.lng, p.lat);
          if (wind.speed > 0.1 && withinVectorBounds && Number.isFinite(wind.u) && Number.isFinite(wind.v)) {
            try {
              const scale = 0.01 * dt * 60;
              const screen = mapInstance.project([p.lng, p.lat]);
              if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
                p.age = p.maxAge + 1; continue;
              }
              screen.x += wind.u * scale * 10;
              screen.y -= wind.v * scale * 10; 
              const nextLngLat = mapInstance.unproject(screen);
              if (!nextLngLat || !Number.isFinite(nextLngLat.lng) || !Number.isFinite(nextLngLat.lat)) {
                p.age = p.maxAge + 1; continue;
              }
              p.lng = nextLngLat.lng;
              p.lat = nextLngLat.lat;
            } catch (e) {
              p.age = p.maxAge + 1;
            }
          } else {
            p.age = p.maxAge + 1;
          }

          // CLAMP latitude to prevent map.project() crash
          if (isNaN(p.lat) || isNaN(p.lng)) { particles[i] = spawn(); continue; }
          p.lat = Math.max(-85, Math.min(85, p.lat));
          while (p.lng > 180) p.lng -= 360;
          while (p.lng < -180) p.lng += 360;

          // Respawn if out of viewport or too old
          if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn || p.age > p.maxAge) {
            particles[i] = spawn(); continue;
          }

          // Draw wind trail line from prev → current position
          try {
            const pt = mapInstance.project([p.lng, p.lat]);
            if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
            
            const hue = Math.min(120, wind.speed * 8);
            const alpha = Math.max(0.2, 1 - (p.age / p.maxAge));
            ctx.strokeStyle = `hsla(${120 - hue}, 90%, 55%, ${alpha})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            if (prevScreen) {
              ctx.moveTo(prevScreen.x, prevScreen.y);
              ctx.lineTo(pt.x, pt.y);
            } else {
              // No previous position — draw a dot seed
              ctx.moveTo(pt.x - 0.5, pt.y);
              ctx.lineTo(pt.x + 0.5, pt.y);
            }
            ctx.stroke();
          } catch (e) {
            if (errorCount < 3) { console.warn('[Wind] project() error:', e.message); errorCount++; }
            particles[i] = spawn();
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
      clearTimeout(idleTimer);
      window.removeEventListener('resize', onResize);
      mapInstance.off('dragstart', onDragStart);
      mapInstance.off('zoomstart', onZoomStart);
      mapInstance.off('dragend', onDragEnd);
      mapInstance.off('zoomend', onZoomEnd);
      mapInstance.off('moveend', onIdle);
    };
  }, [mapInstance]); // Deliberately omitted 'active' to ensure persistence

  return (
    <canvas
      id="wind-canvas-layer"
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
        // Opacity is driven synchronously by MapWebGL.js shared weather animation clock
        opacity: 0,
        transition: 'none'
      }}
    />
  );
}
