import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WindParticleCanvas — V144 High-performance wind visualization.
 *
 * Key V144 optimization: Inline Mercator projection replaces all map.project()
 * calls in the particle loop. Eliminates ~10,500 Mapbox API calls/frame,
 * replacing them with pure arithmetic (~50-100x faster per projection).
 *
 * Layer 1 (Color Field): Padded 2x canvas, color-grouped fillRect, CSS transform sync.
 * Layer 2 (Particle Trails): Inline projection, batched drawing, paused during interaction.
 */

const PARTICLE_COUNT = 3500;
const MAX_AGE = 70;
const LINE_WIDTH = 1.0;
const FIELD_CELL_SIZE = 14;
const FIELD_BLUR_PX = 16;
const FIELD_PAD = 0.5;
const GLOBAL_WIND_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';
const DEG2RAD = Math.PI / 180;
const PI = Math.PI;

// --- Inline Mercator Projection (replaces map.project/unproject) ---
// Snapshots map state once per frame, then projects all particles via pure math.
// Eliminates ~10,500 Mapbox API calls per frame → pure arithmetic.
class FastMercator {
  constructor() {
    this.scale = 1; this.cx = 0; this.cy = 0;
    this.hw = 0; this.hh = 0;
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

  /** lng/lat → pixel (replaces map.project) */
  project(lng, lat) {
    const wx = ((lng + 180) / 360) * this.scale;
    const wy = ((1 - Math.log(Math.tan(PI / 4 + lat * DEG2RAD / 2)) / PI) / 2) * this.scale;
    return { x: wx - this.cx + this.hw, y: wy - this.cy + this.hh };
  }

  /** pixel → lng/lat (replaces map.unproject) */
  unproject(px, py) {
    const wx = (px - this.hw + this.cx) / this.scale;
    const wy = (py - this.hh + this.cy) / this.scale;
    const lng = wx * 360 - 180;
    const lat = (Math.atan(Math.exp(PI * (1 - 2 * wy))) - PI / 4) * 2 / DEG2RAD;
    return { lng, lat };
  }
}

// --- Color Ramps ---
const THEME_FIELD_COLORS = {
  dark: [
    [0,30,60,160,0.48],[2,25,100,185,0.50],[3,20,145,195,0.52],[5,15,180,175,0.54],
    [7,30,190,120,0.56],[9,70,195,60,0.58],[11,150,205,30,0.60],[14,220,200,25,0.63],
    [17,245,160,20,0.66],[21,245,100,25,0.69],[25,235,50,35,0.72],[30,210,25,55,0.75],
    [36,175,15,110,0.77],[44,135,10,160,0.78],
  ],
  light: [
    [0,20,45,130,0.48],[2,15,80,155,0.50],[3,10,115,160,0.52],[5,10,145,140,0.54],
    [7,20,155,100,0.56],[9,50,160,40,0.58],[11,120,165,20,0.60],[14,180,165,10,0.63],
    [17,210,125,10,0.66],[21,210,75,15,0.69],[25,200,35,25,0.72],[30,175,15,40,0.75],
    [36,145,10,85,0.77],[44,110,5,130,0.78],
  ],
  beach: [
    [0,160,120,70,0.44],[2,180,105,55,0.46],[3,195,90,45,0.48],[5,210,70,45,0.50],
    [7,220,50,50,0.52],[9,215,35,70,0.55],[11,205,30,95,0.58],[14,190,25,120,0.61],
    [17,170,20,145,0.64],[21,145,15,165,0.67],[25,120,10,180,0.70],[30,90,10,195,0.73],
    [36,60,5,205,0.76],[44,40,0,215,0.78],
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

// --- Wind Grid ---
class GlobalWindGrid {
  constructor(data) {
    const u = data[0], v = data[1], h = u.header;
    this.lo1 = h.lo1; this.lo2 = h.lo2; this.la1 = h.la1; this.la2 = h.la2;
    this.dx = h.dx; this.dy = h.dy; this.nx = h.nx; this.ny = h.ny;
    this.uData = u.data; this.vData = v.data;
  }

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
    const u = (1-fx)*(1-fy)*this.uData[p] + fx*(1-fy)*this.uData[p+1]
            + (1-fx)*fy*this.uData[p+this.nx] + fx*fy*this.uData[p+this.nx+1];
    const v = (1-fx)*(1-fy)*this.vData[p] + fx*(1-fy)*this.vData[p+1]
            + (1-fx)*fy*this.vData[p+this.nx] + fx*fy*this.vData[p+this.nx+1];
    return [u, v, Math.sqrt(u*u + v*v)];
  }
}

// ============================================================
const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const fieldRef = useRef(null);
  const trailRef = useRef(null);
  const animRef = useRef(null);
  const windGridRef = useRef(null);
  const fieldTimerRef = useRef(null);
  const fieldOriginRef = useRef(null);
  const isInteractingRef = useRef(false);
  const [gridLoaded, setGridLoaded] = useState(false);
  const { theme } = useTheme();

  const particleRamp = useMemo(() => THEME_PARTICLE_COLORS[theme] || THEME_PARTICLE_COLORS.dark, [theme]);
  const fieldRamp = useMemo(() => THEME_FIELD_COLORS[theme] || THEME_FIELD_COLORS.dark, [theme]);
  const particleStyleCache = useMemo(() => buildStyleCache(particleRamp), [particleRamp]);

  // Fetch wind data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(GLOBAL_WIND_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) { windGridRef.current = new GlobalWindGrid(data); setGridLoaded(true); }
      } catch (err) { console.warn('[Wind] Grid fetch failed:', err); }
    })();
    return () => { cancelled = true; };
  }, []);

  // ==========================================================
  //  LAYER 1: Color Field (padded + fast projection + fillRect)
  // ==========================================================
  const renderColorField = useCallback(() => {
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

  // Pan-sync CSS transform
  const onMapMove = useCallback(() => {
    const map = mapInstance, origin = fieldOriginRef.current;
    if (!map || !origin) return;
    try {
      const cur = map.project([origin.lng, origin.lat]);
      if (fieldRef.current) {
        fieldRef.current.style.transform = `translate(${cur.x - origin.px}px,${cur.y - origin.py}px)`;
      }
    } catch (_) {}
  }, [mapInstance]);

  // Event wiring for field
  useEffect(() => {
    const map = mapInstance;
    if (!map || !isActive || !gridLoaded) return;
    renderColorField();

    const onViewChange = () => {
      cancelAnimationFrame(fieldTimerRef.current);
      fieldTimerRef.current = requestAnimationFrame(renderColorField);
    };
    const onInteractStart = () => { isInteractingRef.current = true; };
    const onInteractEnd = () => { isInteractingRef.current = false; };

    map.on('move', onMapMove);
    map.on('moveend', onViewChange);
    map.on('zoomend', onViewChange);
    map.on('dragstart', onInteractStart);
    map.on('dragend', onInteractEnd);
    map.on('zoomstart', onInteractStart);
    map.on('pitchstart', onInteractStart);
    map.on('pitchend', onInteractEnd);
    window.addEventListener('resize', onViewChange);

    return () => {
      map.off('move', onMapMove);
      map.off('moveend', onViewChange);
      map.off('zoomend', onViewChange);
      map.off('dragstart', onInteractStart);
      map.off('dragend', onInteractEnd);
      map.off('zoomstart', onInteractStart);
      map.off('pitchstart', onInteractStart);
      map.off('pitchend', onInteractEnd);
      window.removeEventListener('resize', onViewChange);
      cancelAnimationFrame(fieldTimerRef.current);
    };
  }, [mapInstance, isActive, gridLoaded, renderColorField, onMapMove]);

  useEffect(() => {
    if (isActive && gridLoaded && mapInstance) renderColorField();
  }, [fieldRamp, isActive, gridLoaded, mapInstance, renderColorField]);

  // ==========================================================
  //  LAYER 2: Particles (INLINE MERCATOR — zero map.project calls)
  // ==========================================================
  useEffect(() => {
    const map = mapInstance, trailCanvas = trailRef.current;
    if (!map || !trailCanvas || !isActive || !gridLoaded) return;

    const tCtx = trailCanvas.getContext('2d');
    const proj = new FastMercator();
    let particles = [];

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

    function seedParticle() {
      const c = map.getContainer();
      const x = Math.random() * c.clientWidth;
      const y = Math.random() * c.clientHeight;
      const geo = proj.unproject(x, y);
      return { x, y, age: Math.floor(Math.random() * MAX_AGE), lng: geo.lng, lat: geo.lat };
    }

    // Snapshot projection for initial seeding
    proj.sync(map);
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());

    let cachedPPD = 1;
    let frameCount = 0;
    function updatePPD() {
      try {
        const center = map.getCenter();
        const p1 = proj.project(center.lng, center.lat);
        const p2 = proj.project(center.lng + 1, center.lat);
        cachedPPD = Math.max(0.5, Math.abs(p2.x - p1.x));
      } catch (_) { cachedPPD = 1; }
    }

    function draw() {
      const container = map.getContainer();
      const w = container.clientWidth, h = container.clientHeight;
      const grid = windGridRef.current;
      const cache = particleStyleCache;

      frameCount++;

      // Sync projection state once per frame (replaces 10,500+ map.project calls)
      proj.sync(map);
      if (frameCount % 30 === 0) updatePPD();

      // Pause during interaction — free main thread for smooth panning
      if (isInteractingRef.current) {
        tCtx.globalCompositeOperation = 'destination-in';
        tCtx.globalAlpha = 1.0;
        tCtx.fillStyle = 'rgba(0,0,0,0.85)';
        tCtx.fillRect(0, 0, w, h);
        tCtx.globalCompositeOperation = 'source-over';
        tCtx.globalAlpha = 1.0;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Fade trails
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0;
      tCtx.fillStyle = 'rgba(0,0,0,0.90)';
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';
      tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      // Batched drawing with inline projection
      const batches = new Map();

      for (let pi = 0; pi < particles.length; pi++) {
        const p = particles[pi];

        const wind = grid.interpolate(p.lat, p.lng);
        if (wind) {
          const [u, v, speed] = wind;
          // Inline projection — pure arithmetic, no map.project()
          const prev = proj.project(p.lng, p.lat);

          const targetPx = 1.0 + speed * 0.12;
          const degStep = targetPx / cachedPPD;
          const mag = Math.max(0.01, speed);

          p.lng += (u / mag) * degStep;
          p.lat -= (v / mag) * degStep;
          p.age++;

          const next = proj.project(p.lng, p.lat);
          const dx = next.x - prev.x, dy = next.y - prev.y;

          if (dx * dx + dy * dy >= 0.25) { // skip sqrt: compare squared
            const entry = lookupCached(speed, cache);
            if (!batches.has(entry.key)) {
              batches.set(entry.key, { style: entry.style, glowStyle: entry.glowStyle, segs: [], glow: speed > 12 });
            }
            batches.get(entry.key).segs.push(prev.x, prev.y, next.x, next.y);
          }

          // Bounds check using already-computed next (eliminates redundant testPos)
          if (p.age > MAX_AGE || next.x < -50 || next.x > w + 50 || next.y < -50 || next.y > h + 50) {
            const geo = proj.unproject(Math.random() * w, Math.random() * h);
            p.x = Math.random() * w; p.y = Math.random() * h;
            p.lng = geo.lng; p.lat = geo.lat;
            p.age = Math.floor(Math.random() * MAX_AGE);
          }
        } else {
          // Off-grid: reseed
          const geo = proj.unproject(Math.random() * w, Math.random() * h);
          p.x = Math.random() * w; p.y = Math.random() * h;
          p.lng = geo.lng; p.lat = geo.lat;
          p.age = Math.floor(Math.random() * MAX_AGE);
        }
      }

      // Draw batched segments (single stroke per color)
      for (const batch of batches.values()) {
        const segs = batch.segs;
        if (batch.glow) {
          tCtx.beginPath();
          for (let i = 0; i < segs.length; i += 4) { tCtx.moveTo(segs[i], segs[i+1]); tCtx.lineTo(segs[i+2], segs[i+3]); }
          tCtx.lineWidth = LINE_WIDTH * 3.5;
          tCtx.strokeStyle = batch.glowStyle;
          tCtx.stroke();
        }
        tCtx.beginPath();
        for (let i = 0; i < segs.length; i += 4) { tCtx.moveTo(segs[i], segs[i+1]); tCtx.lineTo(segs[i+2], segs[i+3]); }
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
