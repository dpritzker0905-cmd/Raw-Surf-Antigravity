import React, { useEffect, useRef, useState } from 'react';

/**
 * WindParticleCanvas — Dual-canvas animated wind overlay for MapLibre.
 *
 * Architecture (inspired by earth.nullschool.net + Windy.com):
 * - Canvas 1 (trails): Fading particle trails show wind flow direction via motion
 * - Canvas 2 (barbs):  Persistent wind barbs/arrows show speed + direction at grid points
 * - Fetches live wind data from Open-Meteo Forecast API (wind_speed_10m + wind_direction_10m)
 * - Converts speed+direction to U/V vectors for bilinear interpolation
 * - Falls back to static GFS data if Open-Meteo is unavailable
 */

const PARTICLE_COUNT = 5000;
const MAX_AGE = 90;
const FADE_ALPHA = 0.92;
const LINE_WIDTH = 2.0;
const SPEED_FACTOR = 2.8;
const BARB_GRID_PX = 80; // Screen-space pixels between wind barbs

// Open-Meteo live wind grid — covers eastern US coast + Gulf
const GRID_LAT_MIN = 24;
const GRID_LAT_MAX = 46;
const GRID_LNG_MIN = -98;
const GRID_LNG_MAX = -64;
const GRID_STEP = 2; // degrees

const FALLBACK_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

// Speed-to-color ramp (m/s) — vivid Windy-style palette
const COLOR_STOPS = [
  [0, '#3288bd'], [2, '#66c2a5'], [4, '#abdda4'], [6, '#e6f598'],
  [8, '#ffffbf'], [10, '#fee08b'], [14, '#fdae61'], [18, '#f46d43'],
  [22, '#d53e4f'], [28, '#9e0142'],
];

function getWindColor(speed) {
  for (let i = COLOR_STOPS.length - 1; i >= 0; i--) {
    if (speed >= COLOR_STOPS[i][0]) return COLOR_STOPS[i][1];
  }
  return COLOR_STOPS[0][1];
}

/** Bilinear-interpolated wind field from U/V grid arrays */
class WindGrid {
  constructor({ lo1, la1, dx, dy, nx, ny, uData, vData }) {
    this.lo1 = lo1; this.la1 = la1;
    this.dx = dx; this.dy = dy;
    this.nx = nx; this.ny = ny;
    this.uData = uData; this.vData = vData;
  }

  static fromGFS(data) {
    const u = data[0], v = data[1], h = u.header;
    return new WindGrid({
      lo1: h.lo1, la1: h.la1, dx: h.dx, dy: h.dy,
      nx: h.nx, ny: h.ny, uData: u.data, vData: v.data,
    });
  }

  static fromOpenMeteo(results, latSteps, lngSteps) {
    const ny = latSteps.length;
    const nx = lngSteps.length;
    const uData = new Float32Array(nx * ny);
    const vData = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        const r = results[idx];
        const spd = r?.current?.wind_speed_10m ?? 0;
        const dir = (r?.current?.wind_direction_10m ?? 0) * Math.PI / 180;
        uData[idx] = -spd * Math.sin(dir);
        vData[idx] = -spd * Math.cos(dir);
      }
    }
    const lo1 = lngSteps[0] < 0 ? lngSteps[0] + 360 : lngSteps[0];
    return new WindGrid({ lo1, la1: latSteps[0], dx: GRID_STEP, dy: GRID_STEP, nx, ny, uData, vData });
  }

  interpolate(lat, lng) {
    const lon = lng < 0 ? lng + 360 : lng;
    const fi = (lon - this.lo1) / this.dx;
    const fj = (this.la1 - lat) / this.dy;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (i < 0 || i >= this.nx - 1 || j < 0 || j >= this.ny - 1) return null;
    const fx = fi - i;
    const fy = fj - j;
    const p = j * this.nx + i;
    const u = (1 - fx) * (1 - fy) * this.uData[p] + fx * (1 - fy) * this.uData[p + 1]
            + (1 - fx) * fy * this.uData[p + this.nx] + fx * fy * this.uData[p + this.nx + 1];
    const v = (1 - fx) * (1 - fy) * this.vData[p] + fx * (1 - fy) * this.vData[p + 1]
            + (1 - fx) * fy * this.vData[p + this.nx] + fx * fy * this.vData[p + this.nx + 1];
    return [u, v, Math.sqrt(u * u + v * v)];
  }
}

/** Fetch live wind grid, fall back to static GFS */
async function fetchWindGrid() {
  try {
    const latSteps = [];
    for (let lat = GRID_LAT_MAX; lat >= GRID_LAT_MIN; lat -= GRID_STEP) latSteps.push(lat);
    const lngSteps = [];
    for (let lng = GRID_LNG_MIN; lng <= GRID_LNG_MAX; lng += GRID_STEP) lngSteps.push(lng);
    const allLats = []; const allLngs = [];
    for (const lat of latSteps) {
      for (const lng of lngSteps) { allLats.push(lat); allLngs.push(lng); }
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${allLats.join(',')}&longitude=${allLngs.join(',')}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data) ? data : [data];
    if (results.length !== allLats.length) throw new Error('Mismatched result count');
    console.log(`[Wind] Loaded live grid: ${results.length} points`);
    return WindGrid.fromOpenMeteo(results, latSteps, lngSteps);
  } catch (err) {
    console.warn('[Wind] Open-Meteo failed, using GFS fallback:', err.message);
    const res = await fetch(FALLBACK_URL);
    return WindGrid.fromGFS(await res.json());
  }
}

/** Draw a meteorological wind barb at screen position */
function drawBarb(ctx, x, y, u, v, speed, zoom) {
  const angle = Math.atan2(-v, u);
  const scale = Math.pow(zoom / 7, 0.4);
  const shaftLen = Math.min(10 + speed * 1.5, 32) * scale;
  const color = getWindColor(speed);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Shaft line
  ctx.beginPath();
  ctx.moveTo(-shaftLen * 0.4, 0);
  ctx.lineTo(shaftLen * 0.6, 0);
  ctx.lineWidth = Math.max(1.5, 2.2 * scale);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.stroke();

  // Arrowhead (filled triangle)
  const headL = shaftLen * 0.35;
  const headW = headL * 0.55;
  ctx.beginPath();
  ctx.moveTo(shaftLen * 0.6, 0);
  ctx.lineTo(shaftLen * 0.6 - headL, -headW);
  ctx.lineTo(shaftLen * 0.6 - headL, headW);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Speed label at center
  if (zoom >= 6 && speed >= 1) {
    const kts = Math.round(speed * 1.944);
    ctx.rotate(-angle); // Reset rotation for text
    ctx.font = `bold ${Math.max(8, 9 * scale)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.strokeText(`${kts}`, 0, -shaftLen * 0.5 - 4);
    ctx.fillText(`${kts}`, 0, -shaftLen * 0.5 - 4);
  }

  ctx.restore();
}

const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const trailRef = useRef(null);  // Canvas 1: particle trails (fading)
  const barbRef = useRef(null);   // Canvas 2: wind barbs (persistent, redrawn each frame)
  const animRef = useRef(null);
  const [windGrid, setWindGrid] = useState(null);

  // Fetch wind data
  useEffect(() => {
    if (!isActive) { setWindGrid(null); return; }
    let cancelled = false;
    fetchWindGrid().then(grid => { if (!cancelled) setWindGrid(grid); });
    return () => { cancelled = true; };
  }, [isActive]);

  // Animation loop — dual canvas
  useEffect(() => {
    const map = mapInstance;
    const trailCanvas = trailRef.current;
    const barbCanvas = barbRef.current;
    if (!map || !trailCanvas || !barbCanvas || !isActive || !windGrid) return;

    const tCtx = trailCanvas.getContext('2d');
    const bCtx = barbCanvas.getContext('2d');
    let particles = [];
    let moving = false;

    function resize() {
      const c = map.getContainer();
      trailCanvas.width = c.clientWidth;
      trailCanvas.height = c.clientHeight;
      barbCanvas.width = c.clientWidth;
      barbCanvas.height = c.clientHeight;
    }
    resize();

    function seedParticle() {
      return {
        x: Math.random() * trailCanvas.width,
        y: Math.random() * trailCanvas.height,
        age: Math.floor(Math.random() * MAX_AGE),
      };
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());

    function draw() {
      if (moving) { animRef.current = requestAnimationFrame(draw); return; }

      const zoom = map.getZoom();
      const zoomScale = SPEED_FACTOR * Math.pow(zoom / 7, 0.8);
      const w = trailCanvas.width;
      const h = trailCanvas.height;

      // --- Canvas 1: Fading particle trails ---
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';

      for (const p of particles) {
        const geo = map.unproject([p.x, p.y]);
        const wind = windGrid.interpolate(geo.lat, geo.lng);
        if (wind) {
          const [u, v, speed] = wind;
          const px = p.x;
          const py = p.y;
          p.x += u * zoomScale;
          p.y -= v * zoomScale;
          p.age++;
          const ageRatio = 1 - (p.age / MAX_AGE);
          tCtx.beginPath();
          tCtx.moveTo(px, py);
          tCtx.lineTo(p.x, p.y);
          tCtx.lineWidth = LINE_WIDTH * Math.max(0.3, ageRatio);
          tCtx.strokeStyle = getWindColor(speed);
          tCtx.globalAlpha = Math.max(0.15, ageRatio * 0.85);
          tCtx.stroke();
          tCtx.globalAlpha = 1;
        } else {
          p.age = MAX_AGE + 1;
        }
        if (p.age > MAX_AGE || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          Object.assign(p, seedParticle());
        }
      }

      // --- Canvas 2: Persistent wind barbs (full clear + redraw each frame) ---
      bCtx.clearRect(0, 0, w, h);
      const step = BARB_GRID_PX;
      for (let sx = step / 2; sx < w; sx += step) {
        for (let sy = step / 2; sy < h; sy += step) {
          const geo = map.unproject([sx, sy]);
          const wind = windGrid.interpolate(geo.lat, geo.lng);
          if (wind && wind[2] > 0.3) {
            drawBarb(bCtx, sx, sy, wind[0], wind[1], wind[2], zoom);
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    function onMoveStart() {
      moving = true;
      tCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      bCtx.clearRect(0, 0, barbCanvas.width, barbCanvas.height);
    }
    function onMoveEnd() {
      moving = false;
      resize();
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());
    }

    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    window.addEventListener('resize', resize);
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      window.removeEventListener('resize', resize);
      tCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      bCtx.clearRect(0, 0, barbCanvas.width, barbCanvas.height);
    };
  }, [isActive, mapInstance, windGrid]);

  if (!isActive) return null;

  const canvasStyle = {
    position: 'absolute',
    top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none',
  };

  return (
    <>
      <canvas ref={trailRef} style={{ ...canvasStyle, zIndex: 5 }} />
      <canvas ref={barbRef} style={{ ...canvasStyle, zIndex: 6 }} />
    </>
  );
};

export default WindParticleCanvas;
