import React, { useEffect, useRef } from 'react';

/**
 * WindParticleCanvas — Viewport-aware animated wind overlay for MapLibre.
 *
 * Architecture:
 * - Fetches a dynamic 12x12 grid of wind data (U/V) based on the current map viewport bounds.
 * - Fading particle trails show wind flow direction via motion.
 * - No overpowering barbs; purely elegant particle flow.
 */

const PARTICLE_COUNT = 4000;
const MAX_AGE = 120;
const FADE_ALPHA = 0.90;
const LINE_WIDTH = 1.8;
const SPEED_FACTOR = 3.5;

// Speed-to-color ramp (m/s) — elegant, less overpowering palette
const COLOR_STOPS = [
  [0, '#3288bd'], [3, '#66c2a5'], [6, '#abdda4'], [9, '#e6f598'],
  [12, '#ffffbf'], [15, '#fee08b'], [20, '#fdae61'], [25, '#f46d43'],
  [30, '#d53e4f'], [40, '#9e0142'],
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
    return new WindGrid({ lo1, la1: latSteps[0], dx: Math.abs(lngSteps[1] - lngSteps[0]), dy: Math.abs(latSteps[1] - latSteps[0]), nx, ny, uData, vData });
  }

  interpolate(lat, lng) {
    const lon = lng < 0 ? lng + 360 : lng;
    const fi = (lon - this.lo1) / this.dx;
    // Note: la1 is the maximum latitude (top of bounds), so we subtract lat
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

/** Fetch dynamic wind grid for viewport */
async function fetchDynamicWindGrid(bounds) {
  try {
    const latMin = Math.max(-90, bounds.south - 5);
    const latMax = Math.min(90, bounds.north + 5);
    const lngMin = bounds.west - 5;
    const lngMax = bounds.east + 5;

    const latStep = Math.max(0.5, (latMax - latMin) / 12);
    const lngStep = Math.max(0.5, (lngMax - lngMin) / 12);

    const latSteps = [];
    for (let lat = latMax; lat >= latMin; lat -= latStep) latSteps.push(Number(lat.toFixed(2)));
    
    const lngSteps = [];
    for (let lng = lngMin; lng <= lngMax; lng += lngStep) {
      // Normalize longitude for Open-Meteo (-180 to 180)
      let normLng = lng;
      while (normLng > 180) normLng -= 360;
      while (normLng < -180) normLng += 360;
      lngSteps.push(Number(normLng.toFixed(2)));
    }

    const allLats = []; const allLngs = [];
    for (const lat of latSteps) {
      for (const lng of lngSteps) { allLats.push(lat); allLngs.push(lng); }
    }

    // Limit to 200 points max to prevent API errors
    if (allLats.length > 250) {
        console.warn("[Wind] Grid too large, reducing resolution");
        return null;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${allLats.join(',')}&longitude=${allLngs.join(',')}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data) ? data : [data];
    
    if (results.length !== allLats.length) throw new Error('Mismatched result count');
    console.log(`[Wind] Loaded dynamic viewport grid: ${results.length} points`);
    return WindGrid.fromOpenMeteo(results, latSteps, lngSteps);
  } catch (err) {
    console.warn('[Wind] Dynamic fetch failed:', err.message);
    return null;
  }
}

const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const trailRef = useRef(null);
  const animRef = useRef(null);
  const windGridRef = useRef(null);
  const isFetchingRef = useRef(false);

  // Animation loop
  useEffect(() => {
    const map = mapInstance;
    const trailCanvas = trailRef.current;
    if (!map || !trailCanvas || !isActive) return;

    const tCtx = trailCanvas.getContext('2d');
    let particles = [];
    let moving = false;

    function resize() {
      const c = map.getContainer();
      trailCanvas.width = c.clientWidth;
      trailCanvas.height = c.clientHeight;
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
      const grid = windGridRef.current;

      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';

      if (grid) {
        for (const p of particles) {
          const geo = map.unproject([p.x, p.y]);
          const wind = grid.interpolate(geo.lat, geo.lng);
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
            tCtx.globalAlpha = Math.max(0.1, ageRatio * 0.85);
            tCtx.stroke();
            tCtx.globalAlpha = 1;
          } else {
            p.age = MAX_AGE + 1;
          }
          if (p.age > MAX_AGE || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
            Object.assign(p, seedParticle());
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    const updateGrid = async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      const bounds = map.getBounds();
      const newGrid = await fetchDynamicWindGrid({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      });
      if (newGrid) windGridRef.current = newGrid;
      isFetchingRef.current = false;
    };

    function onMoveStart() {
      moving = true;
      tCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    }
    
    function onMoveEnd() {
      moving = false;
      resize();
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());
      updateGrid(); // Fetch new grid for the new viewport
    }

    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    window.addEventListener('resize', resize);
    
    // Initial fetch
    updateGrid();
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      window.removeEventListener('resize', resize);
      tCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    };
  }, [isActive, mapInstance]);

  if (!isActive) return null;

  const canvasStyle = {
    position: 'absolute',
    top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none',
  };

  return <canvas ref={trailRef} style={{ ...canvasStyle, zIndex: 5 }} />;
};

export default WindParticleCanvas;
