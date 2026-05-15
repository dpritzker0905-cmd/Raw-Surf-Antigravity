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

    const gx = Math.max(0, Math.min(cols - 1, ((queryLng - west) / (east - west)) * (cols - 1)));
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
 * v186 — Production-ready:
 * - React-managed canvas (v183 fix for stacking context)
 * - Latitude clamped to [-85, 85] to prevent map.project() crash
 * - Bounds check BEFORE projection (not after)
 * - Diagnostic visuals removed (wind confirmed working)
 * - Error logging throttled to prevent console flood
 */
import { useEffect, useRef } from 'react';

// --- SINGLETON REGISTRY: Prevents duplicate RAF loops ---
const ACTIVE_ENGINES = new Set();

// --- VISUAL TUNING CONSTANTS ---
const WIND_PADDING_FACTOR = 2.4; // Inflate spawn bounds for wider visual spread
const WIND_PARTICLE_ALPHA = 0.22; // Global particle layer opacity (Windy-style)
const HEATMAP_RESOLUTION = 256; // Upsampled heatmap resolution for smooth gradients

/** Smoothstep for edge fade attenuation (0→1 ramp) */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Simple ocean heuristic — returns false for points likely over land.
 * Uses rough bounding boxes for major landmasses. Not pixel-perfect,
 * but prevents the worst land-bleeding in heatmap overlays.
 */
function isLikelyOcean(lat, lng) {
  // North America interior
  if (lat > 25 && lat < 50 && lng > -125 && lng < -65) {
    // East coast buffer
    if (lng > -82 && lat > 25 && lat < 45) return false;
    // Central US
    if (lng > -105 && lng < -82 && lat > 28 && lat < 49) return false;
    // West coast (keep coast pixels)
    if (lng > -125 && lng < -115 && lat > 32 && lat < 49) return false;
  }
  // Mexico interior
  if (lat > 15 && lat < 25 && lng > -105 && lng < -88) return false;
  // Central America
  if (lat > 7 && lat < 18 && lng > -92 && lng < -77) return false;
  // South America interior
  if (lat > -55 && lat < 12 && lng > -80 && lng < -35) {
    if (lng > -75 && lng < -40 && lat > -35 && lat < 5) return false;
  }
  // Europe
  if (lat > 36 && lat < 70 && lng > -10 && lng < 40) return false;
  // Africa
  if (lat > -35 && lat < 37 && lng > -18 && lng < 52) return false;
  // Asia
  if (lat > 10 && lat < 75 && lng > 40 && lng < 145) return false;
  // Australia
  if (lat > -45 && lat < -10 && lng > 112 && lng < 155) return false;
  return true;
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

  // Heatmap Overlay Engine: Dynamically creates a smoothly interpolated base map for wind/marine
  useEffect(() => {
    if (!mapInstance || !active || !data?.vectors?.length) return;
    const isMarine = id === 'marine-canvas-layer';
    if (isMarine) return; // B4: Marine uses pure directional particles, no underlying heatmap
    
    const sourceId = `${id}-heatmap-source`;
    const layerId = `${id}-heatmap-layer`;

    const generateHeatmap = () => {
      const W = HEATMAP_RESOLUTION;
      const H = HEATMAP_RESOLUTION;
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
           
           if (!vec || isNaN(vec.speed) || vec.speed < 0.05) {
             imgData.data[i] = 0; imgData.data[i+1] = 0; imgData.data[i+2] = 0; imgData.data[i+3] = 0;
           } else if (isMarine && !isLikelyOcean(lat, lng)) {
             // LAND MASK: Skip marine rendering over land
             imgData.data[i] = 0; imgData.data[i+1] = 0; imgData.data[i+2] = 0; imgData.data[i+3] = 0;
           } else {
             const s = vec.speed;
             
             const lerp = (a, b, t) => a + (b - a) * t;
             const lerpColor = (c1, c2, t) => ({
               r: Math.round(lerp(c1.r, c2.r, t)),
               g: Math.round(lerp(c1.g, c2.g, t)),
               b: Math.round(lerp(c1.b, c2.b, t))
             });
             
             let scale;
             if (isMarine) {
               scale = [
                 { s: 0.0, c: { r: 140, g: 200, b: 255 } },
                 { s: 0.5, c: { r: 0,   g: 220, b: 255 } },
                 { s: 1.0, c: { r: 0,   g: 100, b: 255 } },
                 { s: 2.0, c: { r: 150, g: 50,  b: 255 } },
                 { s: 3.0, c: { r: 255, g: 50,  b: 50  } },
                 { s: 10.0, c: { r: 255, g: 0, b: 0 } }
               ];
             } else {
               scale = [
                 { s: 0,  c: { r: 100, g: 200, b: 255 } },
                 { s: 5,  c: { r: 0,   g: 255, b: 150 } },
                 { s: 10, c: { r: 150, g: 255, b: 50  } },
                 { s: 15, c: { r: 255, g: 200, b: 0   } },
                 { s: 20, c: { r: 255, g: 100, b: 0   } },
                 { s: 30, c: { r: 255, g: 0,   b: 100 } },
                 { s: 100, c: { r: 255, g: 0, b: 255 } }
               ];
             }

             let r, g, b;
             if (s <= scale[0].s) {
               ({ r, g, b } = scale[0].c);
             } else if (s >= scale[scale.length - 1].s) {
               ({ r, g, b } = scale[scale.length - 1].c);
             } else {
               for (let j = 0; j < scale.length - 1; j++) {
                 if (s >= scale[j].s && s < scale[j+1].s) {
                   const t = (s - scale[j].s) / (scale[j+1].s - scale[j].s);
                   ({ r, g, b } = lerpColor(scale[j].c, scale[j+1].c, t));
                   break;
                 }
               }
             }

             // Marine: lower alpha for see-through overlay. Wind: standard density.
             const pixelAlpha = isMarine ? 65 : 180;
             imgData.data[i] = r; imgData.data[i+1] = g; imgData.data[i+2] = b; imgData.data[i+3] = pixelAlpha;
           }
        }
      }
      octx.putImageData(imgData, 0, 0);
      return oc.toDataURL('image/png');
    };

    const dataUrl = generateHeatmap();
    const { west, south, east, north } = data.bounds;
    const coordinates = [
      [west, north], [east, north], [east, south], [west, south]
    ];

    // Priority 8: Convert data URL to Image to avoid postMessage clone errors.
    // MapLibre's worker can't serialize Request objects for data: URLs.
    const img = new Image();
    img.onload = () => {
      try {
        if (!mapInstance.getSource(sourceId)) {
          mapInstance.addSource(sourceId, {
            type: 'canvas',
            canvas: (() => {
              // Create a named canvas for MapLibre's canvas source
              const c = document.createElement('canvas');
              c.width = 128;
              c.height = 128;
              c.id = `${sourceId}-canvas`;
              const cCtx = c.getContext('2d');
              cCtx.drawImage(img, 0, 0);
              return c;
            })(),
            coordinates,
            animate: false
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
          // Update existing canvas source
          const source = mapInstance.getSource(sourceId);
          if (source) {
            const existingCanvas = source.getCanvas?.();
            if (existingCanvas) {
              const ctx2 = existingCanvas.getContext('2d');
              ctx2.clearRect(0, 0, 128, 128);
              ctx2.drawImage(img, 0, 0);
              source.play?.(); // Triggers a re-render
            }
          }
        }
      } catch (e) {
        // Silently handle race conditions during map style transitions
      }
    };
    img.src = dataUrl;
  }, [mapInstance, data]);

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

    // SINGLETON GUARD: Prevent duplicate RAF loops
    if (ACTIVE_ENGINES.has(id)) {
      console.error(`[Wind] DUPLICATE_WIND_ENGINE: ${id} already running. Aborting duplicate.`);
      return;
    }
    ACTIVE_ENGINES.add(id);
    console.log(`[Wind] === STARTING ENGINE (${id}) ===`);

    // v3: Domain validation removed. Wind is now viewport-based per contract.
    // No global domain enforcement needed.

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
      // Spawn across PADDED GRID domain for wider visual spread
      const gb = grid?.bounds;
      const rawW = gb?.west ?? -180;
      const rawE = gb?.east ?? 180;
      const rawS = gb?.south ?? -85;
      const rawN = gb?.north ?? 85;
      // Inflate bounds by padding factor for visual spread (rendering only)
      const cLng = (rawW + rawE) / 2;
      const cLat = (rawS + rawN) / 2;
      const halfW = (rawE - rawW) / 2 * WIND_PADDING_FACTOR;
      const halfH = (rawN - rawS) / 2 * WIND_PADDING_FACTOR;
      const west = Math.max(-180, cLng - halfW);
      const east = Math.min(180, cLng + halfW);
      const south = Math.max(-85, cLat - halfH);
      const north = Math.min(85, cLat + halfH);
      
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
      const grid = windRef.current;
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
      ctx.globalCompositeOperation = 'screen';

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

          const transitionProgress = prevWindRef.current 
            ? Math.min(1, (now - transitionStartRef.current) / 1500)
            : 1;

          // Padded domain for particle lifecycle (wider than API grid)
          const gb2 = grid.bounds || { west: bw, south: bs, east: be, north: bn };
          const pcLng = (gb2.west + gb2.east) / 2;
          const pcLat = (gb2.south + gb2.north) / 2;
          const phW = (gb2.east - gb2.west) / 2 * WIND_PADDING_FACTOR;
          const phH = (gb2.north - gb2.south) / 2 * WIND_PADDING_FACTOR;
          const paddedW = Math.max(-180, pcLng - phW);
          const paddedE = Math.min(180, pcLng + phW);
          const paddedS = Math.max(-85, pcLat - phH);
          const paddedN = Math.min(85, pcLat + phH);

          // Store previous screen position for trail drawing
          let prevScreen = null;
          try {
            const ps = mapInstance.project([p.lng, p.lat]);
            if (ps && Number.isFinite(ps.x) && Number.isFinite(ps.y)) prevScreen = ps;
          } catch (e) {}

          // Bilinear interpolate from grid
          const wind = interpolateWind(grid, p.lng, p.lat, prevWindRef.current, transitionProgress);
          
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

          if (wind.speed > 0.1 && Number.isFinite(wind.u) && Number.isFinite(wind.v)) {
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

          // Respawn if too old or out of PADDED bounds (wider than grid)
          if (p.age > p.maxAge || p.lng < paddedW || p.lng > paddedE || p.lat < paddedS || p.lat > paddedN) {
            particles[i] = spawn(); continue;
          }

          // Only DRAW if particle is within viewport (cull, don't kill)
          if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn) continue;

          // Draw wind trail line from prev → current position
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

            if (id === 'marine-canvas-layer') {
              // Ocean aesthetic for waves: dynamic palette based on wave height (wind.speed represents height here)
              const h = wind.speed; // height in meters
              
              // B3: Velocity-based opacity and saturation
              const heightAlpha = Math.min(1.2, 0.4 + (h / 4));
              const finalAlpha = alpha * heightAlpha;
              
              let color = '';
              if (h < 1) color = `hsla(210, 60%, 70%, ${finalAlpha})`;
              else if (h < 2) color = `hsla(190, 80%, 60%, ${finalAlpha})`;
              else if (h < 3) color = `hsla(220, 90%, 60%, ${finalAlpha})`;
              else if (h < 5) color = `hsla(270, 100%, 65%, ${finalAlpha})`;
              else color = `hsla(350, 100%, 60%, ${finalAlpha})`;
              
              ctx.strokeStyle = color;
              ctx.lineWidth = Math.min(4, 2 + h * 0.5); // Thicker for larger waves
            } else {
              // Heatmap aesthetic for wind (Windy style)
              const s = wind.speed; // speed in knots
              
              // B3: Velocity-based opacity and saturation
              const speedAlpha = Math.min(1.2, 0.3 + (s / 35));
              const finalAlpha = alpha * speedAlpha;
              
              let color = '';
              if (s < 5) color = `hsla(200, 70%, 60%, ${finalAlpha})`;
              else if (s < 10) color = `hsla(150, 80%, 50%, ${finalAlpha})`;
              else if (s < 15) color = `hsla(70, 90%, 50%, ${finalAlpha})`;
              else if (s < 20) color = `hsla(45, 100%, 50%, ${finalAlpha})`;
              else if (s < 30) color = `hsla(15, 100%, 50%, ${finalAlpha})`;
              else color = `hsla(330, 100%, 60%, ${finalAlpha})`;

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

    let isMounted = true;
    return () => {
      console.log(`[Wind] === UNMOUNTING (${id}) ===`);
      isMounted = false;
      ACTIVE_ENGINES.delete(id);
      cancelAnimationFrame(animRef.current);
      clearTimeout(idleTimer);
      window.removeEventListener('resize', onResize);
      mapInstance.off('dragstart', onDragStart);
      mapInstance.off('zoomstart', onZoomStart);
      mapInstance.off('dragend', onDragEnd);
      mapInstance.off('zoomend', onZoomEnd);
      mapInstance.off('moveend', onIdle);
    };
  }, [mapInstance, active, data, id]); // Intentionally omitting dependencies to prevent re-renders on every data tick

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
