import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WaveParticleCanvas — Animated wave-height visualization (Windy-style).
 * Dual-canvas: color-coded heatmap (Layer 1) + directional particle flow (Layer 2).
 * Data: Open-Meteo Marine API (wave_height, wave_direction, wave_period).
 */

const PARTICLE_COUNT = 3500;
const MAX_AGE = 90;
const LINE_WIDTH = 1.0;
const FIELD_CELL_SIZE = 5;
const FIELD_BLUR_PX = 8;
const FIELD_PAD = 1.0;
const DEG2RAD = Math.PI / 180;
const PI = Math.PI;

// Marine layer → API variable mapping
const LAYER_VARS = {
  waves:      { h: 'wave_height', d: 'wave_direction', p: 'wave_period' },
  swell_1:    { h: 'swell_wave_height', d: 'swell_wave_direction', p: 'swell_wave_period' },
  swell_2:    { h: 'secondary_swell_wave_height', d: 'secondary_swell_wave_direction', p: 'secondary_swell_wave_period' },
  wind_waves: { h: 'wind_wave_height', d: 'wind_wave_direction', p: 'wind_wave_period' },
};

// --- Inline Mercator (zero-dep, mirrors WindParticleCanvas) ---
class FastMercator {
  constructor() {
    this.scale = 1; this.cx = 0; this.cy = 0; this.hw = 0; this.hh = 0;
    this._pt = { x: 0, y: 0 }; this._geo = { lng: 0, lat: 0 };
  }
  sync(map) {
    const c = map.getCenter(), z = map.getZoom(), el = map.getContainer();
    this.scale = Math.pow(2, z) * 512;
    this.cx = ((c.lng + 180) / 360) * this.scale;
    this.cy = ((1 - Math.log(Math.tan(PI / 4 + c.lat * DEG2RAD / 2)) / PI) / 2) * this.scale;
    this.hw = el.clientWidth / 2; this.hh = el.clientHeight / 2;
  }
  project(lng, lat) {
    const p = this._pt;
    p.x = ((lng + 180) / 360) * this.scale - this.cx + this.hw;
    p.y = ((1 - Math.log(Math.tan(PI / 4 + lat * DEG2RAD / 2)) / PI) / 2) * this.scale - this.cy + this.hh;
    return p;
  }
  unproject(px, py) {
    const g = this._geo;
    g.lng = ((px - this.hw + this.cx) / this.scale) * 360 - 180;
    g.lat = (Math.atan(Math.exp(PI * (1 - 2 * ((py - this.hh + this.cy) / this.scale)))) - PI / 4) * 2 / DEG2RAD;
    return g;
  }
}

// --- Color Ramps (wave height in meters) ---
const FIELD_COLORS = {
  dark: [
    [0,10,30,80,0.25],[0.3,20,60,120,0.35],[0.6,30,100,160,0.45],[1,40,140,180,0.55],
    [1.5,50,175,160,0.65],[2,70,190,100,0.70],[2.5,140,200,50,0.75],[3,210,190,30,0.80],
    [4,240,140,25,0.85],[5,240,80,30,0.90],[7,200,30,60,0.92],[10,160,20,120,0.95],
  ],
  light: [
    [0,200,220,240,0.20],[0.3,160,200,230,0.30],[0.6,100,170,210,0.40],[1,60,145,190,0.50],
    [1.5,40,130,170,0.60],[2,50,150,80,0.65],[2.5,110,165,30,0.70],[3,175,155,15,0.75],
    [4,210,110,15,0.80],[5,210,55,20,0.85],[7,175,20,45,0.90],[10,130,10,90,0.95],
  ],
  beach: [
    [0,10,40,60,0.22],[0.3,20,70,90,0.32],[0.6,30,100,120,0.42],[1,40,130,140,0.52],
    [1.5,50,150,130,0.62],[2,80,160,80,0.68],[2.5,130,170,40,0.74],[3,190,160,25,0.80],
    [4,220,120,20,0.85],[5,220,65,25,0.90],[7,185,25,50,0.92],[10,140,15,100,0.95],
  ],
};

const PARTICLE_COLORS = {
  dark: [
    [0,150,200,255,0.40],[0.5,120,220,255,0.50],[1,180,240,250,0.60],
    [2,220,255,230,0.70],[3,255,255,180,0.78],[5,255,200,140,0.85],[8,255,140,160,0.90],
  ],
  light: [
    [0,40,80,160,0.45],[0.5,30,110,180,0.55],[1,20,140,160,0.63],
    [2,40,160,80,0.70],[3,160,150,20,0.78],[5,200,90,20,0.85],[8,180,30,50,0.90],
  ],
  beach: [
    [0,180,220,240,0.40],[0.5,160,200,230,0.50],[1,200,230,220,0.60],
    [2,240,240,190,0.70],[3,255,210,150,0.78],[5,255,160,130,0.85],[8,240,100,150,0.90],
  ],
};

function buildCache(ramp) {
  return ramp.map(e => ({ speed: e[0], style: `rgba(${e[1]},${e[2]},${e[3]},${e[4]})`,
    glowStyle: `rgba(${e[1]},${e[2]},${e[3]},0.10)`, key: `${e[1]},${e[2]},${e[3]},${e[4]}` }));
}
function lookupCached(v, c) { for (let i = c.length - 1; i >= 0; i--) if (v >= c[i].speed) return c[i]; return c[0]; }
function lookupColor(v, r) { for (let i = r.length - 1; i >= 0; i--) if (v >= r[i][0]) return r[i]; return r[0]; }
function toRgba(e) { return `rgba(${e[1]},${e[2]},${e[3]},${e[4]})`; }
function colorKey(e) { return `${e[1]},${e[2]},${e[3]},${e[4]}`; }

// --- Marine Wave Grid (sparse — NaN = land/no-data) ---
class MarineWaveGrid {
  constructor(nx, ny, lo1, lo2, la1, la2, dx, dy, hData, uData, vData) {
    this.nx = nx; this.ny = ny; this.lo1 = lo1; this.lo2 = lo2;
    this.la1 = la1; this.la2 = la2; this.dx = dx; this.dy = dy;
    this.hData = hData; this.uData = uData; this.vData = vData;
    this._r = new Float64Array(3);
  }
  interpolate(lat, lng) {
    let lon = lng;
    while (lon < this.lo1) lon += 360;
    while (lon > this.lo2 + this.dx) lon -= 360;
    const fi = (lon - this.lo1) / this.dx, fj = (this.la1 - lat) / this.dy;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || i >= this.nx - 1 || j < 0 || j >= this.ny - 1) return null;
    const p = j * this.nx + i;
    const fx = fi - i, fy = fj - j;
    const a = (1-fx)*(1-fy), b = fx*(1-fy), c = (1-fx)*fy, d = fx*fy;
    
    // Smooth partial interpolation at land/ocean boundaries
    if (isNaN(this.hData[p]) || isNaN(this.hData[p+1]) || isNaN(this.hData[p+this.nx]) || isNaN(this.hData[p+this.nx+1])) {
      let sumH=0, sumU=0, sumV=0, w=0;
      if (!isNaN(this.hData[p])) { sumH+=a*this.hData[p]; sumU+=a*this.uData[p]; sumV+=a*this.vData[p]; w+=a; }
      if (!isNaN(this.hData[p+1])) { sumH+=b*this.hData[p+1]; sumU+=b*this.uData[p+1]; sumV+=b*this.vData[p+1]; w+=b; }
      if (!isNaN(this.hData[p+this.nx])) { sumH+=c*this.hData[p+this.nx]; sumU+=c*this.uData[p+this.nx]; sumV+=c*this.vData[p+this.nx]; w+=c; }
      if (!isNaN(this.hData[p+this.nx+1])) { sumH+=d*this.hData[p+this.nx+1]; sumU+=d*this.uData[p+this.nx+1]; sumV+=d*this.vData[p+this.nx+1]; w+=d; }
      if (w > 0) {
        this._r[0] = sumH/w; this._r[1] = sumU/w; this._r[2] = sumV/w; return this._r;
      }
      return null;
    }
    
    this._r[0] = a*this.hData[p]+b*this.hData[p+1]+c*this.hData[p+this.nx]+d*this.hData[p+this.nx+1];
    this._r[1] = a*this.uData[p]+b*this.uData[p+1]+c*this.uData[p+this.nx]+d*this.uData[p+this.nx+1];
    this._r[2] = a*this.vData[p]+b*this.vData[p+1]+c*this.vData[p+this.nx]+d*this.vData[p+this.nx+1];
    return this._r;
  }
}

// --- Particle Pool (Struct-of-Arrays) ---
class ParticlePool {
  constructor(n) { this.count=n; this.lng=new Float64Array(n); this.lat=new Float64Array(n); this.age=new Float32Array(n); }
  seedRandom(i, w, h, proj) {
    const g = proj.unproject(Math.random()*w, Math.random()*h);
    this.lng[i]=g.lng; this.lat[i]=g.lat; this.age[i]=Math.floor(Math.random()*MAX_AGE);
  }
}

// ============================================================
const WaveParticleCanvas = ({ mapInstance, isActive, activeLayer = 'waves', timeOffsetHours = 0 }) => {
  const fieldRef = useRef(null);
  const trailRef = useRef(null);
  const animRef = useRef(null);
  const gridRef = useRef(null);
  const fieldTimerRef = useRef(null);
  const fieldOriginRef = useRef(null);
  const isFetching = useRef(false);
  const [gridLoaded, setGridLoaded] = useState(false);
  const { theme } = useTheme();

  const fieldRamp = useMemo(() => FIELD_COLORS[theme] || FIELD_COLORS.dark, [theme]);
  const particleCache = useMemo(() => buildCache(PARTICLE_COLORS[theme] || PARTICLE_COLORS.dark), [theme]);

  // --- Data Fetch ---
  useEffect(() => {
    if (!mapInstance || !isActive) return;
    const vars = LAYER_VARS[activeLayer] || LAYER_VARS.waves;
    let timeoutId;

    const fetchGrid = async () => {
      if (isFetching.current) return;
      isFetching.current = true;
      try {
        const zoom = mapInstance.getZoom();
        let latMin, latMax, lngMin, lngMax;

        if (zoom < 4) {
          // Global view — simple, always valid
          latMin = -80; latMax = 80;
          lngMin = -180; lngMax = 180;
        } else {
          // Local view — clamp to [-180,180] so grid header and point coords match
          const bounds = mapInstance.getBounds();
          const latPad = Math.max(10, (bounds.getNorth() - bounds.getSouth()) * 1.5);
          const lngPad = Math.max(15, (bounds.getEast() - bounds.getWest()) * 1.5);
          latMin = Math.max(-85, bounds.getSouth() - latPad);
          latMax = Math.min(85, bounds.getNorth() + latPad);
          // Always clamp to [-180,180] — interpolator can't handle unnormalized bounds
          lngMin = Math.max(-180, bounds.getWest() - lngPad);
          lngMax = Math.min(180, bounds.getEast() + lngPad);
        }

        const nx = 9, ny = 9;
        const latStep = (latMax - latMin) / (ny - 1);
        const lngStep = (lngMax - lngMin) / (nx - 1);

        const pts = [];
        // Row-major order: latMax → latMin, lngMin → lngMax
        // lngMin/lngMax are already clamped to [-180,180] so no normalization needed
        for (let j = 0; j < ny; j++) {
          const lat = latMax - j * latStep;
          for (let i = 0; i < nx; i++) {
            const lng = lngMin + i * lngStep;
            pts.push({ lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)) });
          }
        }
        const safe = pts.slice(0, 100);
        const lats = safe.map(p => p.lat).join(',');
        const lons = safe.map(p => p.lng).join(',');

        const hourlyVars = `${vars.h},${vars.d},${vars.p}`;
        const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=${hourlyVars}&forecast_days=2`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const all = Array.isArray(data) ? data : [data];
        const targetTs = Date.now() + timeOffsetHours * 3600000;

        const hData = new Float32Array(nx * ny).fill(NaN);
        const uData = new Float32Array(nx * ny).fill(0);
        const vData = new Float32Array(nx * ny).fill(0);

        for (let idx = 0; idx < safe.length; idx++) {
          const r = all[idx];
          if (!r || !r.hourly) continue;
          const times = r.hourly.time;
          let closest = 0, minD = Infinity;
          for (let t = 0; t < times.length; t++) {
            // Append 'Z' because API returns UTC without 'Z'
            const diff = Math.abs(new Date(times[t] + 'Z').getTime() - targetTs);
            if (diff < minD) { minD = diff; closest = t; }
          }
          const h = r.hourly[vars.h]?.[closest];
          const d = r.hourly[vars.d]?.[closest];
          if (h == null || d == null) continue;
          hData[idx] = h;
          const rad = d * DEG2RAD;
          // Wave direction = direction waves come FROM; particles move in opposite direction
          uData[idx] = -Math.sin(rad) * Math.max(0.3, h * 0.4);
          vData[idx] = -Math.cos(rad) * Math.max(0.3, h * 0.4);
        }

        gridRef.current = new MarineWaveGrid(nx, ny, lngMin, lngMax, latMax, latMin, lngStep, latStep, hData, uData, vData);
        setGridLoaded(true);
      } catch (err) {
        console.warn('[WaveParticleCanvas] fetch failed:', err);
      } finally { isFetching.current = false; }
    };

    const debounced = () => { clearTimeout(timeoutId); timeoutId = setTimeout(fetchGrid, 1200); };
    fetchGrid();
    mapInstance.on('moveend', debounced);
    return () => { clearTimeout(timeoutId); mapInstance.off('moveend', debounced); };
  }, [isActive, mapInstance, activeLayer, timeOffsetHours]);

  // --- Layer 1: Color Field ---
  const renderField = useCallback(() => {
    const map = mapInstance, canvas = fieldRef.current, grid = gridRef.current;
    if (!map || !canvas || !grid) return;
    const el = map.getContainer();
    const w = el.clientWidth, h = el.clientHeight;
    const px = Math.round(w * FIELD_PAD), py = Math.round(h * FIELD_PAD);
    const rw = w + px * 2, rh = h + py * 2;
    canvas.width = rw; canvas.height = rh;
    canvas.style.width = rw + 'px'; canvas.style.height = rh + 'px';
    canvas.style.left = -px + 'px'; canvas.style.top = -py + 'px';

    const ctx = canvas.getContext('2d');
    const cols = Math.ceil(rw / FIELD_CELL_SIZE), rows = Math.ceil(rh / FIELD_CELL_SIZE);
    const leftGeo = map.unproject([-px, 0]), rightGeo = map.unproject([w + px, 0]);
    const lngLeft = leftGeo.lng, lngSpan = rightGeo.lng - leftGeo.lng;
    const rowLats = new Float64Array(rows);
    for (let r = 0; r < rows; r++) rowLats[r] = map.unproject([0, (r + 0.5) * FIELD_CELL_SIZE - py]).lat;

    const buckets = new Map();
    for (let row = 0; row < rows; row++) {
      const lat = rowLats[row];
      for (let col = 0; col < cols; col++) {
        const lng = lngLeft + ((col + 0.5) / cols) * lngSpan;
        const wave = grid.interpolate(lat, lng);
        if (!wave || isNaN(wave[0])) continue;
        const c = lookupColor(wave[0], fieldRamp);
        const k = colorKey(c);
        if (!buckets.has(k)) buckets.set(k, { style: toRgba(c), rects: [] });
        buckets.get(k).rects.push(col * FIELD_CELL_SIZE, row * FIELD_CELL_SIZE);
      }
    }
    ctx.clearRect(0, 0, rw, rh);
    for (const b of buckets.values()) {
      ctx.fillStyle = b.style;
      const rc = b.rects;
      for (let i = 0; i < rc.length; i += 2) ctx.fillRect(rc[i], rc[i+1], FIELD_CELL_SIZE, FIELD_CELL_SIZE);
    }
    const center = map.getCenter(), cp = map.project([center.lng, center.lat]);
    fieldOriginRef.current = { lng: center.lng, lat: center.lat, px: cp.x, py: cp.y };
    canvas.style.transform = '';
  }, [mapInstance, fieldRamp]);

  // Pan-sync
  const onMove = useCallback(() => {
    const map = mapInstance, origin = fieldOriginRef.current;
    if (!map || !origin) return;
    try {
      const cur = map.project([origin.lng, origin.lat]);
      if (fieldRef.current) fieldRef.current.style.transform = `translate(${cur.x-origin.px}px,${cur.y-origin.py}px)`;
    } catch (_) { /* ignore */ }
  }, [mapInstance]);

  // Event wiring
  useEffect(() => {
    const map = mapInstance;
    if (!map || !isActive || !gridLoaded) return;
    renderField();
    const onView = () => { cancelAnimationFrame(fieldTimerRef.current); fieldTimerRef.current = requestAnimationFrame(renderField); };
    map.on('move', onMove); map.on('moveend', onView); map.on('zoomend', onView);
    window.addEventListener('resize', onView);
    return () => { map.off('move', onMove); map.off('moveend', onView); map.off('zoomend', onView); window.removeEventListener('resize', onView); cancelAnimationFrame(fieldTimerRef.current); };
  }, [mapInstance, isActive, gridLoaded, renderField, onMove]);

  useEffect(() => { if (isActive && gridLoaded && mapInstance) renderField(); }, [fieldRamp, isActive, gridLoaded, mapInstance, renderField]);

  // --- Layer 2: Particles ---
  useEffect(() => {
    const map = mapInstance, tc = trailRef.current;
    if (!map || !tc || !isActive || !gridLoaded) return;
    const tCtx = tc.getContext('2d');
    const proj = new FastMercator();
    const pool = new ParticlePool(PARTICLE_COUNT);

    function resize() {
      const el = map.getContainer(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      tc.width = el.clientWidth * dpr; tc.height = el.clientHeight * dpr;
      tc.style.width = el.clientWidth + 'px'; tc.style.height = el.clientHeight + 'px';
      tCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    proj.sync(map);
    for (let i = 0; i < PARTICLE_COUNT; i++) pool.seedRandom(i, map.getContainer().clientWidth, map.getContainer().clientHeight, proj);

    let cachedPPD = 1, frameCount = 0;
    function updatePPD() {
      const c = map.getCenter();
      const p1 = ((c.lng + 180) / 360) * proj.scale - proj.cx + proj.hw;
      const p2 = ((c.lng + 1 + 180) / 360) * proj.scale - proj.cx + proj.hw;
      cachedPPD = Math.max(0.5, Math.abs(p2 - p1));
    }
    updatePPD();

    function draw() {
      const el = map.getContainer(), w = el.clientWidth, h = el.clientHeight;
      const grid = gridRef.current, cache = particleCache;
      frameCount++; proj.sync(map);
      if (frameCount % 30 === 0) updatePPD();

      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0; tCtx.fillStyle = 'rgba(0,0,0,0.88)'; tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over'; tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      const batches = new Map();
      const pLng = pool.lng, pLat = pool.lat, pAge = pool.age;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const wave = grid.interpolate(pLat[i], pLng[i]);
        if (wave && !isNaN(wave[0])) {
          const height = wave[0], u = wave[1], v = wave[2];
          const prev = proj.project(pLng[i], pLat[i]);
          const px0 = prev.x, py0 = prev.y;
          const speed = Math.sqrt(u * u + v * v);
          const targetPx = Math.max(0.8, speed * 0.3); // Increased minimum draw length
          const degStep = targetPx / cachedPPD;
          const mag = Math.max(0.01, speed);
          pLng[i] += (u / mag) * degStep;
          // Wave v is 'towards south' (u=-sin, v=-cos for waves FROM dir)
          pLat[i] -= (v / mag) * degStep;
          pAge[i]++;

          const next = proj.project(pLng[i], pLat[i]);
          const px1 = next.x, py1 = next.y;
          const dx = px1 - px0, dy = py1 - py0;
          if (dx * dx + dy * dy >= 0.1) { // Lowered culling threshold to show low speeds
            const entry = lookupCached(height, cache);
            if (!batches.has(entry.key)) batches.set(entry.key, { style: entry.style, glowStyle: entry.glowStyle, segs: [], glow: height > 3 });
            batches.get(entry.key).segs.push(px0, py0, px1, py1);
          }
          if (pAge[i] > MAX_AGE || px1 < -50 || px1 > w + 50 || py1 < -50 || py1 > h + 50) pool.seedRandom(i, w, h, proj);
        } else {
          pool.seedRandom(i, w, h, proj);
        }
      }

      for (const batch of batches.values()) {
        const segs = batch.segs;
        if (batch.glow) {
          tCtx.beginPath();
          for (let j = 0; j < segs.length; j += 4) { tCtx.moveTo(segs[j], segs[j+1]); tCtx.lineTo(segs[j+2], segs[j+3]); }
          tCtx.lineWidth = LINE_WIDTH * 3.5; tCtx.strokeStyle = batch.glowStyle; tCtx.stroke();
        }
        tCtx.beginPath();
        for (let j = 0; j < segs.length; j += 4) { tCtx.moveTo(segs[j], segs[j+1]); tCtx.lineTo(segs[j+2], segs[j+3]); }
        tCtx.lineWidth = LINE_WIDTH; tCtx.strokeStyle = batch.style; tCtx.stroke();
      }
      animRef.current = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    draw();
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener('resize', resize); tCtx.clearRect(0, 0, tc.width, tc.height); };
  }, [isActive, mapInstance, gridLoaded, particleCache]);

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

export default WaveParticleCanvas;
