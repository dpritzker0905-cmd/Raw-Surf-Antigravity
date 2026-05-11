import React, { useEffect, useRef, useState } from 'react';

/**
 * WindParticleCanvas — GPU-friendly animated wind particle overlay for MapLibre.
 *
 * Renders flowing particles + directional arrows on a canvas synced with the map,
 * mimicking Windy.com's signature directional wind flow visualization.
 *
 * Architecture:
 * - Fetches live wind data from Open-Meteo (speed + direction at grid points)
 * - Converts to U/V vectors and builds a bilinear-interpolated wind field
 * - Animates particles in screen-space, projecting to/from geo-coords
 * - Draws directional arrow barbs at regular screen-space intervals
 * - Clears and reseeds on map pan/zoom for seamless interaction
 */

const PARTICLE_COUNT = 4000;
const MAX_AGE = 100;
const FADE_ALPHA = 0.91;
const LINE_WIDTH = 2.2;
const SPEED_FACTOR = 3.0;
const ARROW_GRID_PX = 100; // Screen-space pixels between direction arrows

// Open-Meteo live wind grid parameters
const GRID_LAT_MIN = 20;
const GRID_LAT_MAX = 50;
const GRID_LNG_MIN = -100;
const GRID_LNG_MAX = -60;
const GRID_STEP = 2; // degrees

// Legacy fallback (static GFS snapshot)
const FALLBACK_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

// Windy-inspired color ramp keyed on wind speed (m/s)
const COLOR_STOPS = [
  [0, '#3288bd'], [3, '#66c2a5'], [6, '#abdda4'], [9, '#e6f598'],
  [12, '#fee08b'], [15, '#fdae61'], [20, '#f46d43'], [25, '#d53e4f'],
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

  /** Build from GFS-format JSON (legacy fallback) */
  static fromGFS(data) {
    const u = data[0], v = data[1], h = u.header;
    return new WindGrid({ lo1: h.lo1, la1: h.la1, dx: h.dx, dy: h.dy, nx: h.nx, ny: h.ny, uData: u.data, vData: v.data });
  }

  /** Build from Open-Meteo multi-coord current response */
  static fromOpenMeteo(results, latSteps, lngSteps) {
    const ny = latSteps.length;
    const nx = lngSteps.length;
    const uData = new Array(nx * ny);
    const vData = new Array(nx * ny);
    // Open-Meteo returns array in same order as input coords
    // Input is row-major: lat[0]lng[0], lat[0]lng[1], ... (north to south, west to east)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        const r = results[idx];
        const speed = r?.current?.wind_speed_10m ?? 0;
        const dir = (r?.current?.wind_direction_10m ?? 0) * Math.PI / 180;
        uData[idx] = -speed * Math.sin(dir);
        vData[idx] = -speed * Math.cos(dir);
      }
    }
    // lo1 in 0-360 convention for interpolation compatibility
    const lo1 = lngSteps[0] < 0 ? lngSteps[0] + 360 : lngSteps[0];
    return new WindGrid({ lo1, la1: latSteps[0], dx: GRID_STEP, dy: GRID_STEP, nx, ny, uData, vData });
  }

  interpolate(lat, lng) {
    let lon = lng < 0 ? lng + 360 : lng;
    const fi = (lon - this.lo1) / this.dx;
    const fj = (this.la1 - lat) / this.dy;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (i < 0 || i >= this.nx - 1 || j < 0 || j >= this.ny - 1) return null;
    const fx = fi - i; const fy = fj - j;
    const idx00 = j * this.nx + i;
    const idx10 = idx00 + 1;
    const idx01 = idx00 + this.nx;
    const idx11 = idx01 + 1;
    const u = (1 - fx) * (1 - fy) * this.uData[idx00] + fx * (1 - fy) * this.uData[idx10]
            + (1 - fx) * fy * this.uData[idx01] + fx * fy * this.uData[idx11];
    const v = (1 - fx) * (1 - fy) * this.vData[idx00] + fx * (1 - fy) * this.vData[idx10]
            + (1 - fx) * fy * this.vData[idx01] + fx * fy * this.vData[idx11];
    return [u, v, Math.sqrt(u * u + v * v)];
  }
}

/** Fetch live wind grid from Open-Meteo, fall back to static GFS */
async function fetchWindGrid() {
  try {
    const latSteps = [];
    for (let lat = GRID_LAT_MAX; lat >= GRID_LAT_MIN; lat -= GRID_STEP) latSteps.push(lat);
    const lngSteps = [];
    for (let lng = GRID_LNG_MIN; lng <= GRID_LNG_MAX; lng += GRID_STEP) lngSteps.push(lng);
    // Build paired coordinate arrays for cross-product grid
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
    return WindGrid.fromOpenMeteo(results, latSteps, lngSteps);
  } catch (err) {
    console.warn('[Wind] Open-Meteo fetch failed, falling back to static GFS:', err.message);
    const res = await fetch(FALLBACK_URL);
    const data = await res.json();
    return WindGrid.fromGFS(data);
  }
}

/** Draw a directional arrow barb at (x, y) pointing in wind direction */
function drawArrow(ctx, x, y, u, v, speed, zoom) {
  const angle = Math.atan2(-v, u); // screen-space angle (v inverted)
  const len = Math.min(8 + speed * 1.2, 24) * Math.pow(zoom / 7, 0.3);
  const headLen = len * 0.4;
  const headAngle = 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.lineTo(len / 2 - headLen * Math.cos(headAngle), -headLen * Math.sin(headAngle));
  ctx.moveTo(len / 2, 0);
  ctx.lineTo(len / 2 - headLen * Math.cos(headAngle), headLen * Math.sin(headAngle));
  ctx.strokeStyle = getWindColor(speed);
  ctx.lineWidth = Math.max(1.5, 2.5 * Math.pow(zoom / 7, 0.3));
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.restore();
}

const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const [windGrid, setWindGrid] = useState(null);

  // 1. Fetch wind data when activated
  useEffect(() => {
    if (!isActive) { setWindGrid(null); return; }
    let cancelled = false;
    fetchWindGrid().then(grid => { if (!cancelled) setWindGrid(grid); });
    return () => { cancelled = true; };
  }, [isActive]);

  // 2. Run animation loop
  useEffect(() => {
    const map = mapInstance;
    const canvas = canvasRef.current;
    if (!map || !canvas || !isActive || !windGrid) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let moving = false;
    let arrowTick = 0;

    function resize() {
      const c = map.getContainer();
      canvas.width = c.clientWidth; canvas.height = c.clientHeight;
    }
    resize();

    function seedParticle() {
      return { x: Math.random() * canvas.width, y: Math.random() * canvas.height, age: Math.floor(Math.random() * MAX_AGE) };
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());

    function draw() {
      if (moving) { animRef.current = requestAnimationFrame(draw); return; }
      // Fade trails
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';

      const zoom = map.getZoom();
      const zoomScale = SPEED_FACTOR * Math.pow(zoom / 7, 0.8);

      for (const p of particles) {
        const geo = map.unproject([p.x, p.y]);
        const wind = windGrid.interpolate(geo.lat, geo.lng);
        if (wind) {
          const [u, v, speed] = wind;
          const prevX = p.x; const prevY = p.y;
          p.x += u * zoomScale; p.y -= v * zoomScale;
          p.age++;
          const ageRatio = 1 - (p.age / MAX_AGE);
          const lineW = LINE_WIDTH * Math.max(0.3, ageRatio);
          const alpha = Math.max(0.2, ageRatio * 0.9);
          ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(p.x, p.y);
          ctx.lineWidth = lineW; ctx.strokeStyle = getWindColor(speed);
          ctx.globalAlpha = alpha; ctx.stroke(); ctx.globalAlpha = 1;
        } else {
          p.age = MAX_AGE + 1;
        }
        if (p.age > MAX_AGE || p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
          Object.assign(p, seedParticle());
        }
      }

      // Draw directional arrows at grid intervals (every 5th frame for perf)
      arrowTick++;
      if (arrowTick % 5 === 0) {
        for (let sx = ARROW_GRID_PX / 2; sx < canvas.width; sx += ARROW_GRID_PX) {
          for (let sy = ARROW_GRID_PX / 2; sy < canvas.height; sy += ARROW_GRID_PX) {
            const geo = map.unproject([sx, sy]);
            const wind = windGrid.interpolate(geo.lat, geo.lng);
            if (wind) {
              const [u, v, speed] = wind;
              if (speed > 0.5) drawArrow(ctx, sx, sy, u, v, speed, zoom);
            }
          }
        }
      }
      animRef.current = requestAnimationFrame(draw);
    }

    function onMoveStart() { moving = true; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    function onMoveEnd() {
      moving = false; resize(); arrowTick = 0;
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [isActive, mapInstance, windGrid]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
};

export default WindParticleCanvas;
