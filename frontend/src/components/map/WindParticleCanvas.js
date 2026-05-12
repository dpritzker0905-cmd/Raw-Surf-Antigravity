import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WindParticleCanvas — V145 High-performance wind visualization.
 *
 * Architecture:
 *   Layer 1 (Color Field): Padded 2x canvas, color-grouped fillRect, CSS transform pan-sync.
 *   Layer 2 (Particle Trails): Struct-of-Arrays layout, inline Mercator projection,
 *     batched drawing, paused during all map interactions (drag/zoom/pitch).
 *
 * V145 changes:
 *   - FIX: zoomend now resets isInteracting (was missing, caused particles to vanish on zoom)
 *   - PERF: Struct-of-Arrays particle storage (Float64Array) — zero object allocation in hot loop
 *   - PERF: Reusable projection result object — eliminates ~7,000 {x,y} allocs/frame
 *   - PERF: Reusable wind result array — eliminates ~3,500 [u,v,s] allocs/frame
 *   - PERF: Debounced zoom interaction (150ms) — keeps particles visible during scroll-zoom
 */

const PARTICLE_COUNT = 3500;
const MAX_AGE = 90;
const LINE_WIDTH = 1.0;
const FIELD_CELL_SIZE = 14;
const FIELD_BLUR_PX = 16;
const FIELD_PAD = 1.0;
const DEG2RAD = Math.PI / 180;
const PI = Math.PI;
// Zoom interaction debouncing removed to keep particles continuously rendering during scroll-zoom

// --- Inline Mercator Projection ---
// Snapshots map state once per frame, projects via pure arithmetic.
// Uses reusable result objects to avoid allocation in the hot loop.
class FastMercator {
  constructor() {
    this.scale = 1; this.cx = 0; this.cy = 0;
    this.hw = 0; this.hh = 0;
    // Reusable result objects — avoids ~10,500 object allocations per frame
    this._pt = { x: 0, y: 0 };
    this._geo = { lng: 0, lat: 0 };
  }

  /** Snapshot map state — call ONCE per frame */
  sync(map) {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const container = map.getContainer();
    this.scale = Math.pow(2, zoom) * 512;
    this.cx = ((center.lng + 180) / 360) * this.scale;
    this.cy = ((1 - Math.log(Math.tan(PI / 4 + center.lat * DEG2RAD / 2)) / PI) / 2) * this.scale;
    this.hw = container.clientWidth / 2;
    this.hh = container.clientHeight / 2;
  }

  /** lng/lat to pixel — returns REUSABLE object (do not store reference) */
  project(lng, lat) {
    const pt = this._pt;
    pt.x = ((lng + 180) / 360) * this.scale - this.cx + this.hw;
    pt.y = ((1 - Math.log(Math.tan(PI / 4 + lat * DEG2RAD / 2)) / PI) / 2) * this.scale - this.cy + this.hh;
    return pt;
  }

  /** pixel to lng/lat — returns REUSABLE object (do not store reference) */
  unproject(px, py) {
    const geo = this._geo;
    const wx = (px - this.hw + this.cx) / this.scale;
    const wy = (py - this.hh + this.cy) / this.scale;
    geo.lng = wx * 360 - 180;
    geo.lat = (Math.atan(Math.exp(PI * (1 - 2 * wy))) - PI / 4) * 2 / DEG2RAD;
    return geo;
  }
}

// --- Color Ramps ---
const THEME_FIELD_COLORS = {
  dark: [
    [0,30,60,160,0.20],[2,25,100,185,0.25],[3,20,145,195,0.30],[5,15,180,175,0.35],
    [7,30,190,120,0.40],[9,70,195,60,0.45],[11,150,205,30,0.50],[14,220,200,25,0.53],
    [17,245,160,20,0.56],[21,245,100,25,0.59],[25,235,50,35,0.62],[30,210,25,55,0.65],
    [36,175,15,110,0.68],[44,135,10,160,0.70],
  ],
  light: [
    [0,20,45,130,0.20],[2,15,80,155,0.25],[3,10,115,160,0.30],[5,10,145,140,0.35],
    [7,20,155,100,0.40],[9,50,160,40,0.45],[11,120,165,20,0.50],[14,180,165,10,0.53],
    [17,210,125,10,0.56],[21,210,75,15,0.59],[25,200,35,25,0.62],[30,175,15,40,0.65],
    [36,145,10,85,0.68],[44,110,5,130,0.70],
  ],
  beach: [
    [0,160,120,70,0.15],[2,180,105,55,0.20],[3,195,90,45,0.25],[5,210,70,45,0.30],
    [7,220,50,50,0.35],[9,215,35,70,0.40],[11,205,30,95,0.45],[14,190,25,120,0.48],
    [17,170,20,145,0.51],[21,145,15,165,0.54],[25,120,10,180,0.57],[30,90,10,195,0.60],
    [36,60,5,205,0.63],[44,40,0,215,0.65],
  ],
};

const THEME_PARTICLE_COLORS = {
  dark: [
    [0,200,230,255,0.50],[5,170,245,245,0.60],[10,220,255,210,0.68],
    [15,255,255,170,0.74],[20,255,210,130,0.80],[28,255,150,150,0.85],[36,255,130,220,0.90],
  ],
  light: [
    [0,50,90,180,0.55],[5,40,140,170,0.65],[10,60,170,70,0.70],
    [15,180,170,20,0.75],[20,220,110,20,0.80],[28,200,40,40,0.85],[36,160,20,100,0.90],
  ],
  beach: [
    [0,255,230,190,0.50],[5,255,195,140,0.60],[10,255,155,120,0.68],
    [15,255,115,110,0.74],[20,245,80,130,0.80],[28,210,60,180,0.85],[36,160,50,220,0.90],
  ],
};

// Pre-compute rgba strings for each ramp entry to avoid string concat per frame
function buildStyleCache(ramp) {
  return ramp.map(e => ({
    speed: e[0],
    style: `rgba(${e[1]},${e[2]},${e[3]},${e[4]})`,
    glowStyle: `rgba(${e[1]},${e[2]},${e[3]},0.10)`,
    key: `${e[1]},${e[2]},${e[3]},${e[4]}`,
  }));
}

function lookupCached(speed, cache) {
  for (let i = cache.length - 1; i >= 0; i--) {
    if (speed >= cache[i].speed) return cache[i];
  }
  return cache[0];
}

function lookupColor(speed, ramp) {
  for (let i = ramp.length - 1; i >= 0; i--) {
    if (speed >= ramp[i][0]) return ramp[i];
  }
  return ramp[0];
}

function toRgba(e) { return `rgba(${e[1]},${e[2]},${e[3]},${e[4]})`; }
function colorKey(e) { return `${e[1]},${e[2]},${e[3]},${e[4]}`; }

// --- Wind Grid (reusable result array to avoid allocation per interpolation) ---
class GlobalWindGrid {
  constructor(data) {
    const u = data[0], v = data[1], h = u.header;
    this.lo1 = h.lo1; this.lo2 = h.lo2; this.la1 = h.la1; this.la2 = h.la2;
    this.dx = h.dx; this.dy = h.dy; this.nx = h.nx; this.ny = h.ny;
    this.uData = u.data; this.vData = v.data;
    this._result = new Float64Array(3); // Reusable [u, v, speed]
  }

  /** Returns reusable Float64Array [u, v, speed] or null. Do NOT store reference. */
  interpolate(lat, lng) {
    let lon = lng;
    while (lon < this.lo1) lon += 360;
    while (lon > this.lo2 + this.dx) lon -= 360;
    const fi = (lon - this.lo1) / this.dx;
    const fj = (this.la1 - lat) / this.dy;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || i >= this.nx - 1 || j < 0 || j >= this.ny - 1) return null;
    const fx = fi - i, fy = fj - j;
    const p = j * this.nx + i;
    const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
    const u = a * this.uData[p] + b * this.uData[p+1] + c * this.uData[p+this.nx] + d * this.uData[p+this.nx+1];
    const v = a * this.vData[p] + b * this.vData[p+1] + c * this.vData[p+this.nx] + d * this.vData[p+this.nx+1];
    const r = this._result;
    r[0] = u; r[1] = v; r[2] = Math.sqrt(u * u + v * v);
    return r;
  }
}

// --- Struct-of-Arrays Particle Storage ---
// Eliminates 3,500 object allocations. All particle data in contiguous typed arrays.
// Fields: lng, lat, age (per particle index)
class ParticlePool {
  constructor(count) {
    this.count = count;
    this.lng = new Float64Array(count);
    this.lat = new Float64Array(count);
    this.age = new Float32Array(count);
  }

  seed(i, pLng, pLat, pAge) {
    this.lng[i] = pLng; this.lat[i] = pLat; this.age[i] = pAge;
  }

  seedRandom(i, w, h, proj) {
    const rx = Math.random() * w, ry = Math.random() * h;
    const geo = proj.unproject(rx, ry);
    this.lng[i] = geo.lng; this.lat[i] = geo.lat;
    this.age[i] = Math.floor(Math.random() * MAX_AGE);
  }
}

// ============================================================
const WindParticleCanvas = ({ mapInstance, isActive, hideColorField = false, particleColorOverride = null, activeModel = 'GFS', timeOffsetHours = 0 }) => {
  const fieldRef = useRef(null);
  const trailRef = useRef(null);
  const animRef = useRef(null);
  const windGridRef = useRef(null);
  const fieldTimerRef = useRef(null);
  const fieldOriginRef = useRef(null);
  const isDraggingRef = useRef(false);
  const [gridLoaded, setGridLoaded] = useState(false);
  const { theme } = useTheme();

  const particleRamp = useMemo(() => THEME_PARTICLE_COLORS[theme] || THEME_PARTICLE_COLORS.dark, [theme]);
  const fieldRamp = useMemo(() => THEME_FIELD_COLORS[theme] || THEME_FIELD_COLORS.dark, [theme]);
  const particleStyleCache = useMemo(() => {
    if (particleColorOverride === 'white') {
      return buildStyleCache([
        [0, 255, 255, 255, 0.35],
        [5, 255, 255, 255, 0.50],
        [10, 255, 255, 255, 0.65],
        [15, 255, 255, 255, 0.80],
        [20, 255, 255, 255, 0.95]
      ]);
    }
    return buildStyleCache(particleRamp);
  }, [particleRamp, particleColorOverride]);

  const isFetchingWind = useRef(false);
  const MODEL_MAP = {
    GFS:  'gfs_seamless',
    EURO: 'ecmwf_ifs025',
    ICON: 'icon_seamless',
  };

  // Fetch dynamic, bounds-based wind data
  useEffect(() => {
    if (!mapInstance || !isActive) return;

    let timeoutId;
    const updateWindGrid = async () => {
      if (isFetchingWind.current) return;
      isFetchingWind.current = true;
      
      try {
        const zoom = mapInstance.getZoom();
        let latMin, latMax, lngMin, lngMax;

        if (zoom < 4) {
          // Global view
          latMin = -80; latMax = 80;
          lngMin = -180; lngMax = 180;
        } else {
          // Local view
          const bounds = mapInstance.getBounds();
          let w = bounds.getWest();
          let e = bounds.getEast();
          if (e < w) e += 360; // Handle dateline wrap
          
          const latPad = Math.max(10, (bounds.getNorth() - bounds.getSouth()) * 1.5);
          const lngPad = Math.max(15, (e - w) * 1.5);
          
          latMin = Math.max(-85, bounds.getSouth() - latPad);
          latMax = Math.min(85, bounds.getNorth() + latPad);
          lngMin = w - lngPad;
          lngMax = e + lngPad;
        }

        // Sparse 9x9 grid (81 points total, < 100 API limit)
        const nx = 9;
        const ny = 9;
        const latStep = (latMax - latMin) / (ny - 1);
        const lngStep = (lngMax - lngMin) / (nx - 1);

        const safePoints = [];
        // Important: GlobalWindGrid expects points in row-major order starting from top-left (latMax to latMin)
        for (let j = 0; j < ny; j++) {
          const lat = latMax - j * latStep;
          for (let i = 0; i < nx; i++) {
            let lng = lngMin + i * lngStep;
            let normLng = lng;
            while (normLng > 180) normLng -= 360;
            while (normLng < -180) normLng += 360;
            safePoints.push({ lat: Number(lat.toFixed(2)), lng: Number(normLng.toFixed(2)) });
          }
        }

        const lats = safePoints.map(p => p.lat).join(',');
        const lons = safePoints.map(p => p.lng).join(',');

        const modelParam = MODEL_MAP[activeModel] || 'gfs_seamless';
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m&models=${modelParam}&forecast_days=2`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        const allResults = Array.isArray(data) ? data : [data];
        const targetTs = Date.now() + timeOffsetHours * 3600000;
        
        const uData = new Float32Array(nx * ny);
        const vData = new Float32Array(nx * ny);
        
        for (let i = 0; i < safePoints.length; i++) {
          const r = allResults[i];
          if (!r || !r.hourly) continue;
          
          // Find closest hourly time step
          let closest = 0;
          let minDiff = Infinity;
          r.hourly.time.forEach((t, idx) => {
            const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
            if (diff < minDiff) { minDiff = diff; closest = idx; }
          });
          const speed = r.hourly.wind_speed_10m?.[closest] || 0;
          const dir = r.hourly.wind_direction_10m?.[closest] || 0;
          
          // Convert speed from km/h to m/s
          const speedMs = speed * 0.277778;
          
          // Mathematical wind direction (0° is wind from North -> vector towards South)
          // U (zonal) = -speed * sin(dir), V (meridional) = -speed * cos(dir)
          const rad = dir * Math.PI / 180;
          const u = -speedMs * Math.sin(rad);
          const v = -speedMs * Math.cos(rad);
          
          uData[i] = u;
          vData[i] = v;
        }

        const gridData = [
          { header: { lo1: lngMin, lo2: lngMax, la1: latMax, la2: latMin, dx: lngStep, dy: latStep, nx, ny }, data: uData },
          { header: { lo1: lngMin, lo2: lngMax, la1: latMax, la2: latMin, dx: lngStep, dy: latStep, nx, ny }, data: vData }
        ];

        windGridRef.current = new GlobalWindGrid(gridData);
        setGridLoaded(true);
      } catch (err) {
        console.warn('[WindParticleCanvas] Dynamic grid fetch failed:', err);
      } finally {
        isFetchingWind.current = false;
      }
    };

    const debouncedUpdate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateWindGrid, 1200); // 1.2s debounce
    };

    // Initial fetch
    updateWindGrid();

    // Re-fetch when map stops moving
    mapInstance.on('moveend', debouncedUpdate);
    return () => {
      clearTimeout(timeoutId);
      mapInstance.off('moveend', debouncedUpdate);
    };
  }, [isActive, mapInstance, activeModel, timeOffsetHours]);

  // ==========================================================
  //  LAYER 1: Color Field (padded + fast projection + fillRect)
  // ==========================================================
  const renderColorField = useCallback(() => {
    if (hideColorField) return;
    const map = mapInstance, canvas = fieldRef.current, grid = windGridRef.current;
    if (!map || !canvas || !grid) return;

    const container = map.getContainer();
    const w = container.clientWidth, h = container.clientHeight;
    const padX = Math.round(w * FIELD_PAD), padY = Math.round(h * FIELD_PAD);
    const rw = w + padX * 2, rh = h + padY * 2;

    canvas.width = rw; canvas.height = rh;
    canvas.style.width = rw + 'px'; canvas.style.height = rh + 'px';
    canvas.style.left = -padX + 'px'; canvas.style.top = -padY + 'px';

    const ctx = canvas.getContext('2d');
    const ramp = fieldRamp;
    const cols = Math.ceil(rw / FIELD_CELL_SIZE), rows = Math.ceil(rh / FIELD_CELL_SIZE);

    // Row-based fast projection
    const leftGeo = map.unproject([-padX, 0]);
    const rightGeo = map.unproject([w + padX, 0]);
    const lngLeft = leftGeo.lng, lngSpan = rightGeo.lng - leftGeo.lng;

    const rowLats = new Float64Array(rows);
    for (let row = 0; row < rows; row++) {
      rowLats[row] = map.unproject([0, (row + 0.5) * FIELD_CELL_SIZE - padY]).lat;
    }

    // Color-grouped fillRect
    const buckets = new Map();
    for (let row = 0; row < rows; row++) {
      const lat = rowLats[row];
      for (let col = 0; col < cols; col++) {
        const lng = lngLeft + ((col + 0.5) / cols) * lngSpan;
        const wind = grid.interpolate(lat, lng);
        if (!wind) continue;
        const c = lookupColor(wind[2], ramp);
        const key = colorKey(c);
        if (!buckets.has(key)) buckets.set(key, { style: toRgba(c), rects: [] });
        buckets.get(key).rects.push(col * FIELD_CELL_SIZE, row * FIELD_CELL_SIZE);
      }
    }

    ctx.clearRect(0, 0, rw, rh);
    for (const b of buckets.values()) {
      ctx.fillStyle = b.style;
      const r = b.rects;
      for (let i = 0; i < r.length; i += 2) ctx.fillRect(r[i], r[i+1], FIELD_CELL_SIZE, FIELD_CELL_SIZE);
    }

    const center = map.getCenter();
    const centerPx = map.project([center.lng, center.lat]);
    fieldOriginRef.current = { lng: center.lng, lat: center.lat, px: centerPx.x, py: centerPx.y };
    canvas.style.transform = '';
  }, [mapInstance, fieldRamp]);

  // Pan-sync CSS transform + threshold-based mid-pan re-render for mobile stability
  const lastFieldCenter = useRef({ lng: 0, lat: 0 });
  const onMapMove = useCallback(() => {
    const map = mapInstance, origin = fieldOriginRef.current;
    if (!map || !origin) return;
    try {
      const cur = map.project([origin.lng, origin.lat]);
      if (fieldRef.current) {
        fieldRef.current.style.transform = `translate(${cur.x - origin.px}px,${cur.y - origin.py}px)`;
      }
      // Threshold re-render: if panned >40% of viewport, re-render field immediately
      const center = map.getCenter();
      const container = map.getContainer();
      const w = container.clientWidth;
      const dxPx = Math.abs(cur.x - origin.px);
      if (dxPx > w * 0.4) {
        lastFieldCenter.current = { lng: center.lng, lat: center.lat };
        cancelAnimationFrame(fieldTimerRef.current);
        fieldTimerRef.current = requestAnimationFrame(renderColorField);
      }
    } catch (_) { /* ignore */ }
  }, [mapInstance, renderColorField]);

  // Event wiring for field + interaction state
  useEffect(() => {
    const map = mapInstance;
    if (!map || !isActive || !gridLoaded || hideColorField) return;
    renderColorField();

    const onViewChange = () => {
      cancelAnimationFrame(fieldTimerRef.current);
      fieldTimerRef.current = requestAnimationFrame(renderColorField);
    };

    // --- Drag: simple start/end ---
    const onDragStart = () => { isDraggingRef.current = true; };
    const onDragEnd = () => { isDraggingRef.current = false; };

    map.on('move', onMapMove);
    map.on('moveend', onViewChange);
    map.on('zoomend', onViewChange);
    map.on('dragstart', onDragStart);
    map.on('dragend', onDragEnd);
    window.addEventListener('resize', onViewChange);

    return () => {
      map.off('move', onMapMove);
      map.off('moveend', onViewChange);
      map.off('zoomend', onViewChange);
      map.off('dragstart', onDragStart);
      map.off('dragend', onDragEnd);
      window.removeEventListener('resize', onViewChange);
      cancelAnimationFrame(fieldTimerRef.current);
    };
  }, [mapInstance, isActive, gridLoaded, renderColorField, onMapMove]);

  useEffect(() => {
    if (isActive && gridLoaded && mapInstance && !hideColorField) renderColorField();
  }, [fieldRamp, isActive, gridLoaded, mapInstance, hideColorField, renderColorField]);

  // ==========================================================
  //  LAYER 2: Particles (Struct-of-Arrays + Inline Mercator)
  // ==========================================================
  useEffect(() => {
    const map = mapInstance, trailCanvas = trailRef.current;
    if (!map || !trailCanvas || !isActive || !gridLoaded) return;

    const tCtx = trailCanvas.getContext('2d');
    const proj = new FastMercator();
    const pool = new ParticlePool(PARTICLE_COUNT);

    function resize() {
      const c = map.getContainer();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      trailCanvas.width = c.clientWidth * dpr;
      trailCanvas.height = c.clientHeight * dpr;
      trailCanvas.style.width = c.clientWidth + 'px';
      trailCanvas.style.height = c.clientHeight + 'px';
      tCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    // Initial seeding
    proj.sync(map);
    for (let i = 0; i < PARTICLE_COUNT; i++) pool.seedRandom(i, map.getContainer().clientWidth, map.getContainer().clientHeight, proj);

    let cachedPPD = 1;
    let frameCount = 0;
    function updatePPD() {
      const center = map.getCenter();
      const p1x = ((center.lng + 180) / 360) * proj.scale - proj.cx + proj.hw;
      const p2x = ((center.lng + 1 + 180) / 360) * proj.scale - proj.cx + proj.hw;
      cachedPPD = Math.max(0.5, Math.abs(p2x - p1x));
    }
    updatePPD(); // FIX: Initialize immediately so first frame particles don't stretch massively

    function draw() {
      const container = map.getContainer();
      const w = container.clientWidth, h = container.clientHeight;
      const grid = windGridRef.current;
      const cache = particleStyleCache;

      frameCount++;
      proj.sync(map);
      if (frameCount % 30 === 0) updatePPD();

      // Fade existing trails
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0;
      tCtx.fillStyle = 'rgba(0,0,0,0.90)';
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';
      tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      // Batched drawing with struct-of-arrays + inline projection
      const batches = new Map();
      const pLng = pool.lng, pLat = pool.lat, pAge = pool.age;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const wind = grid.interpolate(pLat[i], pLng[i]);
        if (wind) {
          const u = wind[0], v = wind[1], speed = wind[2];

          // Project previous position (reusable result — copy values immediately)
          const prev = proj.project(pLng[i], pLat[i]);
          const px0 = prev.x, py0 = prev.y;

          const targetPx = Math.max(0.8, speed * 0.2);
          const degStep = targetPx / cachedPPD;
          const mag = Math.max(0.01, speed);

          pLng[i] += (u / mag) * degStep;
          pLat[i] += (v / mag) * degStep;
          pAge[i]++;

          // Project new position (reuses same result object)
          const next = proj.project(pLng[i], pLat[i]);
          const px1 = next.x, py1 = next.y;
          const dx = px1 - px0, dy = py1 - py0;

          if (dx * dx + dy * dy >= 0.1) {
            const entry = lookupCached(speed, cache);
            if (!batches.has(entry.key)) {
              batches.set(entry.key, { style: entry.style, glowStyle: entry.glowStyle, segs: [], glow: speed > 12 });
            }
            batches.get(entry.key).segs.push(px0, py0, px1, py1);
          }

          // Bounds check using already-computed new position
          if (pAge[i] > MAX_AGE || px1 < -50 || px1 > w + 50 || py1 < -50 || py1 > h + 50) {
            pool.seedRandom(i, w, h, proj);
          }
        } else {
          pool.seedRandom(i, w, h, proj);
        }
      }

      // Draw batched segments (single stroke per color)
      for (const batch of batches.values()) {
        const segs = batch.segs;
        if (batch.glow) {
          tCtx.beginPath();
          for (let j = 0; j < segs.length; j += 4) { tCtx.moveTo(segs[j], segs[j+1]); tCtx.lineTo(segs[j+2], segs[j+3]); }
          tCtx.lineWidth = LINE_WIDTH * 3.5;
          tCtx.strokeStyle = batch.glowStyle;
          tCtx.stroke();
        }
        tCtx.beginPath();
        for (let j = 0; j < segs.length; j += 4) { tCtx.moveTo(segs[j], segs[j+1]); tCtx.lineTo(segs[j+2], segs[j+3]); }
        tCtx.lineWidth = LINE_WIDTH;
        tCtx.strokeStyle = batch.style;
        tCtx.stroke();
      }

      animRef.current = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
      tCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    };
  }, [isActive, mapInstance, gridLoaded, particleStyleCache]);

  // Cleanup on deactivation
  useEffect(() => {
    if (!isActive) {
      [fieldRef, trailRef].forEach(ref => {
        if (ref.current) ref.current.getContext('2d').clearRect(0, 0, ref.current.width, ref.current.height);
      });
    }
  }, [isActive]);

  if (!isActive) return null;

  return (
    <>
      <canvas ref={fieldRef} style={{
        position: 'absolute', pointerEvents: 'none', zIndex: 4,
        filter: `blur(${FIELD_BLUR_PX}px)`, willChange: 'transform',
        transition: 'opacity 0.6s ease-in-out', opacity: gridLoaded ? 1 : 0,
      }} />
      <canvas ref={trailRef} style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 5,
        transition: 'opacity 0.6s ease-in-out', opacity: gridLoaded ? 1 : 0,
      }} />
    </>
  );
};

export default WindParticleCanvas;
