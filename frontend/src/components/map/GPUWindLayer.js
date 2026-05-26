// Data fetching has been moved to WeatherEngine.js to decouple from MapLibre events.
// This file now only handles the GPU/Canvas particle rendering.

/**
 * Bilinear interpolation of u/v wind components.
 */
function interpolateWind(windGrid, lng, lat, prevGrid = null, transitionProgress = 1) {
  if (!windGrid?.vectors?.length) return { u: 0, v: 0, speed: 0 };

  const getUV = (grid, queryLng, queryLat) => {
    const { vectors, bounds, cols, rows } = grid;
    const { west, south, east, north } = bounds;
    
    if (!cols || !rows || vectors.length !== cols * rows) return null;

    // v3.6: Normalize longitude for wrap-aware interpolation
    let nLng = queryLng;
    while (nLng > 180) nLng -= 360;
    while (nLng < -180) nLng += 360;

    const gx = Math.max(0, Math.min(cols - 1, ((nLng - west) / (east - west)) * (cols - 1)));
    const gy = Math.max(0, Math.min(rows - 1, ((queryLat - south) / (north - south)) * (rows - 1)));
    const xi = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
    const yi = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
    const fx = gx - xi;
    const fy = gy - yi;
    
    const idx = (y, x) => y * cols + x;
    
    const p00 = vectors[idx(yi, xi)];
    const p10 = vectors[idx(yi, xi + 1)];
    const p01 = vectors[idx(yi + 1, xi)];
    const p11 = vectors[idx(yi + 1, xi + 1)];

    if (p00 === undefined || p10 === undefined || p01 === undefined || p11 === undefined) {
      return null;
    }

    const u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
              (1 - fx) * fy * p01.u + fx * fy * p11.u;
    const v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
              (1 - fx) * fy * p01.v + fx * fy * p11.v;
    return { u, v };
  };

  const curr = getUV(windGrid, lng, lat);
  if (!curr) return { u: 0, v: 0, speed: 0 };

  if (prevGrid && transitionProgress < 1) {
    const prev = getUV(prevGrid, lng, lat);
    if (prev) {
      const u = prev.u + (curr.u - prev.u) * transitionProgress;
      const v = prev.v + (curr.v - prev.v) * transitionProgress;
      return { u, v, speed: Math.sqrt(u * u + v * v) };
    }
  }

  return { u: curr.u, v: curr.v, speed: Math.sqrt(curr.u * curr.u + curr.v * curr.v) };
}

/**
 * Canvas-based wind particle advection engine.
 *
 * v186 Production-ready:
 * - React-managed canvas (v183 fix for stacking context)
 * - Latitude clamped to [-85, 85] to prevent map.project() crash
 * - Bounds check BEFORE projection (not after)
 * - Diagnostic visuals removed (wind confirmed working)
 * - Error logging throttled to prevent console flood
 */
import { useEffect, useRef } from 'react';
import { getAnimationCoordinator } from './CanvasAnimationCoordinator';

// --- SINGLETON REGISTRY: Prevents duplicate RAF loops ---
var ACTIVE_ENGINES = new Set();

// --- VISUAL TUNING CONSTANTS ---
// v3.3: Padding factor removed particles now spawn at viewport bounds
// v3.12: Scientific atmospheric particles visible but not overpowering
var WIND_PARTICLE_ALPHA = 0.40; // Atmospheric transparency (was 0.55)
var HEATMAP_RESOLUTION = 256;
var TURBULENCE_AMP = 0.03; // Subtle natural variation (was 0.06)

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function WindParticleCanvas({ mapInstance, active, data, revision, id = "wind-canvas-layer" }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const windRef = useRef(null);
  const particlesRef = useRef([]);

  const activeRef = useRef(active);

  useEffect(() => { activeRef.current = active; }, [active]);
  const prevDataIdRef = useRef(null);
  
  // B2: Temporal Interpolation Refs
  const prevWindRef = useRef(null);
  const transitionStartRef = useRef(0);

  useEffect(() => {
    if (data?.vectors?.length) {
      if (windRef.current) {
        prevWindRef.current = windRef.current;
        transitionStartRef.current = performance.now();
      }
      windRef.current = data;
      // Only log when data actually changes, NOT on every revision tick
      const dataId = `${data.cols}x${data.rows}:${data.vectors.length}`;
      if (dataId !== prevDataIdRef.current) {
        prevDataIdRef.current = dataId;
        const sample = data.vectors[0];
        console.log(`[Wind] Data updated: ${data.vectors.length} vectors, ${data.cols}x${data.rows}, sample: u=${sample.u?.toFixed(2)} v=${sample.v?.toFixed(2)} speed=${sample.speed?.toFixed(1)}`);
      }
    }
  }, [data]);

  // v3.2: Wind heatmap overlay is now handled by OM raster tiles (wind_gusts_10m)
  // in MapWebGL.js via the LAYER_REGISTRY omVariable. This provides full global
  // coverage instead of the old 49-point canvas interpolation.


  useEffect(() => {
    if (!mapInstance || !canvasRef.current) return;

    // SINGLETON GUARD: Prevent duplicate engines
    if (ACTIVE_ENGINES.has(id)) {
      console.error(`[Wind] DUPLICATE_WIND_ENGINE: ${id} already running. Aborting duplicate.`);
      return;
    }
    ACTIVE_ENGINES.add(id);
    console.log(`[Wind] === STARTING ENGINE (${id}) ===`);

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

    // v3.11.2: Doubled particle counts for visible density
    const isMobile = window.innerWidth < 768;
    const isWeak = (navigator.hardwareConcurrency || 4) <= 4;
    const zoom = mapInstance.getZoom();
    const baseCount = isMobile ? (isWeak ? 2000 : 4000) : (isWeak ? 8000 : 16000);
    const PARTICLE_COUNT = zoom < 3 ? Math.round(baseCount * 0.3) : zoom < 5 ? Math.round(baseCount * 0.6) : baseCount;
    console.log(`[Wind] Spawning ${PARTICLE_COUNT} particles (zoom: ${zoom.toFixed(1)}, isMobile: ${isMobile})`);
    
    const spawn = (preAge = false) => {
      const mb = mapInstance.getBounds();
      const west = mb.getWest();
      const east = mb.getEast();
      const south = Math.max(-85, mb.getSouth());
      const north = Math.min(85, mb.getNorth());
      
      const maxAge = 3 + Math.random() * 4;
      const noiseSeed = Math.random() * Math.PI * 2;
      const noiseFreq = 0.5 + Math.random() * 1.5;
      return {
        lng: west + Math.random() * (east - west),
        lat: south + Math.random() * (north - south),
        age: preAge ? Math.random() * maxAge * 0.8 : 0,
        maxAge,
        noiseSeed,
        noiseFreq
      };
    };
    particlesRef.current = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particlesRef.current.push(spawn(true));

    let frameCount = 0;
    let errorCount = 0;
    let wasActive = false;

 // v3.9.7: Phase 2 register with shared CanvasAnimationCoordinator
    // Interaction throttling is now handled by the coordinator (single source of truth)
    const coordinator = getAnimationCoordinator();
    coordinator.init(mapInstance);

    // v3.9.7: Tick function called by CanvasAnimationCoordinator (not self-scheduled)
    const windTick = (now, dt, coordState) => {
      if (!activeRef.current) {
        if (wasActive) {
          ctx.clearRect(0, 0, cw, ch);
          wasActive = false;
        }
        return;
      }
      const grid = windRef.current;
      if (!grid?.vectors?.length) return;
      
      wasActive = true;
      frameCount++;
      // v3.9.7: Throttle state from coordinator (2 = throttled)
      const windState = coordState === 2 ? 2 : 1;
      const WIND_THROTTLED = 2;

      // Trail decay: erase old trails by removing alpha (keeps canvas transparent)
      const trailOpacity = windState === WIND_THROTTLED ? 0.15 : 0.04;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailOpacity})`;
      ctx.fillRect(0, 0, cw, ch);
      // v3.11.3: source-over for scientific compositing (screen causes white accumulation)
      ctx.globalCompositeOperation = 'source-over';

      const particles = particlesRef.current;

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast();
      const bs = mb.getSouth(), bn = mb.getNorth();

      // ----------------------------------------------------
 // DEBUG HARNESS (dev-only tree-shakes in production)
      // ----------------------------------------------------
      if (process.env.NODE_ENV !== 'production' && window.__WIND_DEBUG__ && grid && grid.cols && grid.rows) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillStyle = 'white';
        ctx.font = '10px monospace';
        
        for (let r = 0; r < grid.rows; r++) {
          for (let c = 0; c < grid.cols; c++) {
            const vec = grid.vectors[r * grid.cols + c];
            if (!vec) continue;
            const dLat = (grid.bounds.north - grid.bounds.south) / Math.max(1, grid.rows - 1);
            const dLng = (grid.bounds.east - grid.bounds.west) / Math.max(1, grid.cols - 1);
            const lat = grid.bounds.south + r * dLat;
            const lng = grid.bounds.west + c * dLng;
            
            if (lng < bw || lng > be || lat < bs || lat > bn) continue;
            
            try {
              const pt = mapInstance.project([lng, lat]);
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
              ctx.fill();
              
              ctx.beginPath();
              ctx.moveTo(pt.x, pt.y);
              ctx.lineTo(pt.x + vec.u * 10, pt.y - vec.v * 10);
              ctx.stroke();
              
              if (window.__WIND_DEBUG__.showLabels) {
                ctx.fillText(`u:${vec.u.toFixed(1)} v:${vec.v.toFixed(1)}`, pt.x + 5, pt.y - 5);
              }
            } catch(e) { /* projection may fail near dateline */ }
          }
        }
 // v3.9.7: No self-scheduling coordinator handles RAF
        return;
      }
      // ----------------------------------------------------

 // v243: Stride from lifecycle state NEVER restart loop
      const stride = windState === WIND_THROTTLED ? 4 : 1;

      for (let i = 0; i < particles.length; i += stride) {
          const p = particles[i];
          p.age += dt;

          const transitionProgress = prevWindRef.current 
            ? Math.min(1, (now - transitionStartRef.current) / 1500)
            : 1;

           // v3.3: Use viewport bounds for particle lifecycle (global coverage)
           const paddedW = bw, paddedE = be, paddedS = bs, paddedN = bn;

          // Store previous screen position for trail drawing
          let prevScreen = null;
          try {
            const ps = mapInstance.project([p.lng, p.lat]);
            if (ps && Number.isFinite(ps.x) && Number.isFinite(ps.y)) prevScreen = ps;
          } catch (e) { /* projection may fail near dateline */ }

          // Bilinear interpolate from grid
          let wind = interpolateWind(grid, p.lng, p.lat, prevWindRef.current, transitionProgress);
          
          if (process.env.NODE_ENV !== 'production' && window.__WIND_DEBUG__) {
            // Single vector test mode (object or boolean compatibility)
            if (window.__WIND_SINGLE_VECTOR__ || window.__WIND_DEBUG__.forceVector) {
              const forceU = window.__WIND_DEBUG__.forceVector?.u ?? 10;
              const forceV = window.__WIND_DEBUG__.forceVector?.v ?? 0;
              wind = { u: forceU, v: forceV, speed: Math.sqrt(forceU*forceU + forceV*forceV) };
            }
            if ((window.__WIND_DEBUG__.showSpawnPoints !== false) && p.age < dt * 2) {
               // Highlight spawn origin points
               try {
                 const sp = mapInstance.project([p.lng, p.lat]);
                 ctx.fillStyle = 'magenta';
                 ctx.beginPath();
                 ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
                 ctx.fill();
               } catch (e) { /* projection may fail near dateline */ }
            }
          }

          if (wind.speed > 0.1 && Number.isFinite(wind.u) && Number.isFinite(wind.v)) {
              // v3.12: World-coordinate advection (Ventusky-style)
              // Wind u/v are in m/s. Convert to degrees/second using:
 // 1 latitude 111,320 m
 // 1 longitude 111,320 * cos(lat) m
              // This is zoom-independent and physically coherent.
              const DEG_PER_METER = 1 / 111320;
              const latRad = p.lat * Math.PI / 180;
              const mercCorr = Math.max(0.1, Math.cos(latRad));

              // Turbulence noise for natural flow (subtle, not chaotic)
              const noisePhase = p.noiseSeed + p.age * p.noiseFreq;
              const noiseU = Math.sin(noisePhase) * wind.speed * 0.03;
              const noiseV = Math.cos(noisePhase * 1.3) * wind.speed * 0.03;

              // Advance in lng/lat space directly
              const speedScale = dt * 150; // Tuned for visual trail length
              p.lng += (wind.u + noiseU) * DEG_PER_METER / mercCorr * speedScale;
              p.lat += (wind.v + noiseV) * DEG_PER_METER * speedScale;
          } else {
            p.age = p.maxAge + 1;
          }

          // CLAMP latitude to prevent map.project() crash
          if (isNaN(p.lat) || isNaN(p.lng)) { particles[i] = spawn(); continue; }
          p.lat = Math.max(-85, Math.min(85, p.lat));
          while (p.lng > 180) p.lng -= 360;
          while (p.lng < -180) p.lng += 360;

          // Respawn if too old or out of PADDED bounds (wider than grid)
          if (p.age > p.maxAge || p.lng < paddedW || p.lng > paddedE || p.lat < paddedS || p.lat > paddedN) {
            particles[i] = spawn(); continue;
          }

          // Only DRAW if particle is within viewport (cull, don't kill)
          if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn) continue;

 // Draw wind trail line from prev current position
          try {
            const pt = mapInstance.project([p.lng, p.lat]);
            if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
            
            // Base alpha from age + edge fade for soft viewport boundaries
            const ageRatio = p.age / p.maxAge;
            let alpha = Math.max(0.1, 1 - Math.pow(ageRatio, 2));

            // Edge fade: smoothstep attenuation near padded domain edges
            const edgePadDeg = Math.max(1, (paddedE - paddedW) * 0.12);
            const fadeW = smoothstep(paddedW, paddedW + edgePadDeg, p.lng);
            const fadeE = smoothstep(paddedE, paddedE - edgePadDeg, p.lng);
            const fadeS = smoothstep(paddedS, paddedS + edgePadDeg, p.lat);
            const fadeN = smoothstep(paddedN, paddedN - edgePadDeg, p.lat);
            alpha *= fadeW * fadeE * fadeS * fadeN * WIND_PARTICLE_ALPHA;

 // v3.11.3: Atmospheric directional particles coherent, not glowing
            // Calm wind = subtle gray-blue, strong wind = warm amber-white
            const s = wind.speed;
            const speedAlpha = Math.min(1.0, 0.35 + (s / 25));
            const finalAlpha = Math.min(0.70, alpha * speedAlpha);
 // Speed-based color: gray-blue white warm amber at high speed
            const intensity = Math.min(1.0, s / 30);
            const r = Math.round(120 + intensity * 135);
            const g = Math.round(140 + intensity * 100);
            const b = Math.round(180 + intensity * 50);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
            ctx.lineWidth = Math.min(1.8, 0.6 + s * 0.03);
            
            ctx.beginPath();
            if (prevScreen) {
              ctx.moveTo(prevScreen.x, prevScreen.y);
              ctx.lineTo(pt.x, pt.y);
            } else {
 // No previous position draw a dot seed
              ctx.moveTo(pt.x - 0.5, pt.y);
              ctx.lineTo(pt.x + 0.5, pt.y);
            }
            ctx.stroke();
          } catch (e) {
            if (errorCount < 3) { console.warn('[Wind] project() error:', e.message); errorCount++; }
            particles[i] = spawn();
          }
        }

      if (process.env.NODE_ENV !== 'production' && window.__WIND_DEBUG__) {
        // Draw debug grid overlay
        if (window.__WIND_DEBUG__.logPerFrame !== false && grid && grid.cols && grid.rows && grid.bounds && frameCount % 10 === 0) {
           const cLng = (bw + be) / 2;
           const cLat = (bs + bn) / 2;
           const centerWind = interpolateWind(grid, cLng, cLat);
           const angleRad = Math.atan2(centerWind.v, centerWind.u);
           const angleDeg = angleRad * (180 / Math.PI);

           console.log(`[WIND DEBUG FRAME]
- u: ${centerWind.u.toFixed(3)}
- v: ${centerWind.v.toFixed(3)}
- speed: ${centerWind.speed.toFixed(3)}
- angle (rad): ${angleRad.toFixed(3)}
- angle (deg): ${angleDeg.toFixed(1)}
- grid cell: center
- particle count: ${particles.length}
- advection step delta: ${(dt * 60).toFixed(2)}`);
        }

        // Velocity heat overlay and vector lines sampled across a grid
        if (window.__WIND_DEBUG__.drawGrid !== false) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
          const stepX = (be - bw) / 10;
          const stepY = (bn - bs) / 10;
          for (let x = bw; x < be; x += stepX) {
             for (let y = bs; y < bn; y += stepY) {
                const pt = mapInstance.project([x, y]);
                const w = interpolateWind(grid, x, y);
                
                // Magnitude Heat
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, Math.min(20, w.speed * 2), 0, Math.PI * 2);
                ctx.fill();

                // Vector lines
                if (window.__WIND_DEBUG__.drawVectors !== false) {
                  ctx.strokeStyle = 'cyan';
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(pt.x, pt.y);
                  ctx.lineTo(pt.x + (w.u * 2), pt.y - (w.v * 2));
                  ctx.stroke();
                }
             }
          }
        }
      }

      if (frameCount % 1800 === 1) {
        console.log(`[Wind] F:${frameCount} drawn:${particles.length} grid:${grid?.vectors?.length || 0}`);
      }

    };

    // v3.9.7: Register with shared coordinator instead of self-scheduling RAF
    coordinator.register(id, windTick, () => activeRef.current);

    const onResize = () => {
      const d = resize();
      if (d) { cw = d.w; ch = d.h; }
    };
    window.addEventListener('resize', onResize);

    return () => {
      console.log(`[Wind] === UNMOUNTING (${id}) ===`);
      ACTIVE_ENGINES.delete(id);
      coordinator.unregister(id);
      window.removeEventListener('resize', onResize);
    };
  }, [mapInstance]); // Deliberately omitted 'active', 'data', 'id' to ensure persistence across data updates

  return (
    <canvas
      id={id}
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
        // Opacity is driven synchronously by MapWebGL.js shared weather animation clock
        opacity: active ? 1 : 0,
        transition: 'opacity 0.3s ease'
      }}
    />
  );
}
