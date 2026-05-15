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

export function WindParticleCanvas({ mapInstance, active, data, revision, id = "wind-canvas-layer" }) {
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

  // Heatmap Overlay Engine: Dynamically creates a smoothly interpolated base map for wind/marine
  useEffect(() => {
    if (!mapInstance || !active || !data?.vectors?.length) return;
    const isMarine = id === 'marine-canvas-layer';
    const sourceId = `${id}-heatmap-source`;
    const layerId = `${id}-heatmap-layer`;

    const generateHeatmap = () => {
      const W = 128; // High resolution for smooth WebGL interpolation
      const H = 128;
      const oc = document.createElement('canvas');
      oc.width = W;
      oc.height = H;
      const octx = oc.getContext('2d');
      const imgData = octx.createImageData(W, H);

      const { west, south, east, north } = data.bounds;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
           const lng = west + (x / (W - 1)) * (east - west);
           // Y=0 in image is top (north), Y=H-1 is bottom (south)
           const lat = north - (y / (H - 1)) * (north - south);

           const vec = interpolateWind(data, lng, lat);
           const i = (y * W + x) * 4;
           
           if (!vec || isNaN(vec.speed) || vec.speed < 0.1) {
             imgData.data[i] = 0; imgData.data[i+1] = 0; imgData.data[i+2] = 0; imgData.data[i+3] = 0;
           } else {
             const s = vec.speed;
             let r, g, b, a = 180; // Base alpha for the raster base
             if (isMarine) {
               if (s < 0.5)      { r = 140; g = 200; b = 255; }
               else if (s < 1.0) { r = 0;   g = 220; b = 255; }
               else if (s < 2.0) { r = 0;   g = 100; b = 255; }
               else if (s < 3.0) { r = 150; g = 50;  b = 255; }
               else              { r = 255; g = 50;  b = 50;  }
             } else {
               if (s < 5)        { r = 100; g = 200; b = 255; }
               else if (s < 10)  { r = 0;   g = 255; b = 150; }
               else if (s < 15)  { r = 150; g = 255; b = 50;  }
               else if (s < 20)  { r = 255; g = 200; b = 0;   }
               else if (s < 30)  { r = 255; g = 100; b = 0;   }
               else              { r = 255; g = 0;   b = 100; }
             }
             imgData.data[i] = r; imgData.data[i+1] = g; imgData.data[i+2] = b; imgData.data[i+3] = a;
           }
        }
      }
      octx.putImageData(imgData, 0, 0);
      return oc.toDataURL('image/png');
    };

    const dataUrl = generateHeatmap();
    const { west, south, east, north } = data.bounds;
    // MapLibre expects image coordinates as: NW, NE, SE, SW
    const coordinates = [
      [west, north], [east, north], [east, south], [west, south]
    ];

    if (!mapInstance.getSource(sourceId)) {
      mapInstance.addSource(sourceId, {
        type: 'image',
        url: dataUrl,
        coordinates
      });
      mapInstance.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 0.65,
          'raster-fade-duration': 300,
          'raster-resampling': 'linear'
        }
      });
    } else {
      const source = mapInstance.getSource(sourceId);
      if (source && source.updateImage) {
        source.updateImage({ url: dataUrl, coordinates });
      }
    }
  }, [mapInstance, data, revision]);

  // Sync Heatmap Visibility
  useEffect(() => {
    if (!mapInstance) return;
    const layerId = `${id}-heatmap-layer`;
    if (mapInstance.getLayer(layerId)) {
      mapInstance.setLayoutProperty(layerId, 'visibility', active ? 'visible' : 'none');
    }
  }, [mapInstance, active, id]);

  useEffect(() => {
    if (!mapInstance || !canvasRef.current) return;
    console.log('[Wind] === STARTING PERSISTENT ENGINE ===');

    // We no longer inject inline mock data. We rely exclusively on the live fetch pipeline.
    inlineMockRef.current = null;

    // 🔥 RUNTIME INVARIANT GUARD (FAIL FAST SYSTEM)
    // Ensures wind is global, not viewport restricted. Marine layers are naturally viewport bounded.
    const validateDomain = setInterval(() => {
      if (id === 'wind-canvas-layer' && windRef.current && windRef.current.bounds) {
        const { west, east, north, south } = windRef.current.bounds;
        const isGlobal = (east - west >= 350) && (north - south >= 160);
        if (!isGlobal) {
          throw new Error("WIND_DOMAIN_VIOLATION: viewport bounds detected");
        }
      }
    }, 2000);

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
      // Spawn across the FULL GRID domain (world space), not viewport
      // Particles represent a weather system, not a viewport effect
      const gb = grid?.bounds;
      const west = gb?.west ?? -180;
      const east = gb?.east ?? 180;
      const south = gb?.south ?? -85;
      const north = gb?.north ?? 85;
      
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

      // Trail decay: erase old trails by removing alpha (keeps canvas transparent)
      const trailOpacity = windState === WIND_THROTTLED ? 0.15 : 0.04;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailOpacity})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';

      const particles = particlesRef.current;

      const mb = mapInstance.getBounds();
      const bw = mb.getWest(), be = mb.getEast();
      const bs = mb.getSouth(), bn = mb.getNorth();

      // ----------------------------------------------------
      // DEBUG HARNESS
      // ----------------------------------------------------
      if (window.__WIND_DEBUG__ && grid && grid.cols && grid.rows) {
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
            } catch(e) {}
          }
        }
        frameRef.current = requestAnimationFrame(render);
        return;
      }
      // ----------------------------------------------------

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
          let wind = interpolateWind(grid, p.lng, p.lat);
          
          if (window.__WIND_DEBUG__) {
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
               } catch (e) {}
            }
          }

          if (wind.speed > 0.1 && withinVectorBounds && Number.isFinite(wind.u) && Number.isFinite(wind.v)) {
            try {
              const scale = 0.01 * dt * 60;
              const screen = mapInstance.project([p.lng, p.lat]);
              if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
                p.age = p.maxAge + 1; continue;
              }
              // Slower advection for dense water waves
              const speedMultiplier = id === 'marine-canvas-layer' ? 3 : 10;
              screen.x += wind.u * scale * speedMultiplier;
              screen.y -= wind.v * scale * speedMultiplier; 
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

          // Respawn if too old or out of GRID bounds (world space)
          const gb = grid.bounds || { west: -180, south: -85, east: 180, north: 85 };
          if (p.age > p.maxAge || p.lng < gb.west || p.lng > gb.east || p.lat < gb.south || p.lat > gb.north) {
            particles[i] = spawn(); continue;
          }

          // Only DRAW if particle is within viewport (cull, don't kill)
          if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn) continue;

          // Draw wind trail line from prev → current position
          try {
            const pt = mapInstance.project([p.lng, p.lat]);
            if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
            
            // Base alpha based on age, fading out at the end
            const ageRatio = p.age / p.maxAge;
            const alpha = Math.max(0.1, 1 - Math.pow(ageRatio, 2));

            if (id === 'marine-canvas-layer') {
              // Ocean aesthetic for waves: dynamic palette based on wave height (wind.speed represents height here)
              // 0-1m: Light Blue, 1-2m: Cyan, 2-3m: Blue, 3-5m: Purple, 5m+: Red
              let color = '';
              const h = wind.speed; // height in meters
              if (h < 1) color = `rgba(140, 200, 255, ${alpha})`;
              else if (h < 2) color = `rgba(0, 220, 255, ${alpha})`;
              else if (h < 3) color = `rgba(0, 100, 255, ${alpha})`;
              else if (h < 5) color = `rgba(150, 50, 255, ${alpha})`;
              else color = `rgba(255, 50, 50, ${alpha})`;
              
              ctx.strokeStyle = color;
              ctx.lineWidth = Math.min(4, 2 + h * 0.5); // Thicker for larger waves
            } else {
              // Heatmap aesthetic for wind (Windy style)
              // 0-5kts: Light Blue/Teal, 5-15kts: Green, 15-25kts: Yellow/Orange, 25kts+: Red/Magenta
              let color = '';
              const s = wind.speed; // speed in knots
              if (s < 5) color = `rgba(100, 200, 255, ${alpha})`;
              else if (s < 10) color = `rgba(0, 255, 150, ${alpha})`;
              else if (s < 15) color = `rgba(150, 255, 50, ${alpha})`;
              else if (s < 20) color = `rgba(255, 200, 0, ${alpha})`;
              else if (s < 30) color = `rgba(255, 100, 0, ${alpha})`;
              else color = `rgba(255, 0, 100, ${alpha})`;

              ctx.strokeStyle = color;
              ctx.lineWidth = Math.min(3, 1.2 + s * 0.05); // Thicker for stronger winds
            }
            
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

      if (window.__WIND_DEBUG__) {
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
      clearInterval(validateDomain);
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
      id={id}
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
