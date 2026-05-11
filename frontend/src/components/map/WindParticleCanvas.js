import React, { useEffect, useRef, useState } from 'react';

/**
 * WindParticleCanvas — Viewport-aware animated wind overlay for MapLibre.
 *
 * Architecture:
 * - Fetches a dynamic 15x15 grid of wind data (U/V) based on the current map viewport bounds.
 * - Slices API requests into batches to bypass Open-Meteo's 100-point limit, achieving FULL GLOBAL coverage.
 * - Fading particle trails show wind flow direction via motion.
 * - Particles are rendered subtly to allow the landmass to be clearly visible below.
 */

const PARTICLE_COUNT = 3000; // Reduced density for subtlety
const MAX_AGE = 100;
const FADE_ALPHA = 0.94; // slightly slower fade for smoother, longer trails
const LINE_WIDTH = 1.0; // Thinner lines
const SPEED_FACTOR = 3.5;

// Subtle, transparent color ramp to blend with landmass
const COLOR_STOPS = [
  [0, 'rgba(50, 136, 189, 0.4)'],
  [4, 'rgba(102, 194, 165, 0.5)'],
  [8, 'rgba(171, 221, 164, 0.5)'],
  [12, 'rgba(230, 245, 152, 0.6)'],
  [16, 'rgba(255, 255, 191, 0.6)'],
  [20, 'rgba(254, 224, 139, 0.7)'],
  [25, 'rgba(253, 174, 97, 0.7)'],
  [30, 'rgba(244, 109, 67, 0.8)'],
  [40, 'rgba(213, 62, 79, 0.8)']
];

function getWindColor(speed) {
  for (let i = COLOR_STOPS.length - 1; i >= 0; i--) {
    if (speed >= COLOR_STOPS[i][0]) return COLOR_STOPS[i][1];
  }
  return COLOR_STOPS[0][1];
}

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

/** 
 * Batched fetch to bypass API limits and enable true global coverage.
 * Open-Meteo restricts arrays to ~100 points per request.
 */
async function fetchBatchedWindGrid(bounds) {
  try {
    const latMin = Math.max(-90, bounds.south - 5);
    const latMax = Math.min(90, bounds.north + 5);
    const lngMin = bounds.west - 5;
    const lngMax = bounds.east + 5;

    // Use a dense 16x16 grid (256 points total).
    const latStep = Math.max(0.5, (latMax - latMin) / 16);
    const lngStep = Math.max(0.5, (lngMax - lngMin) / 16);

    const latSteps = [];
    for (let lat = latMax; lat >= latMin; lat -= latStep) latSteps.push(Number(lat.toFixed(2)));
    
    const lngSteps = [];
    for (let lng = lngMin; lng <= lngMax; lng += lngStep) {
      let normLng = lng;
      while (normLng > 180) normLng -= 360;
      while (normLng < -180) normLng += 360;
      lngSteps.push(Number(normLng.toFixed(2)));
    }

    const allPoints = [];
    for (const lat of latSteps) {
      for (const lng of lngSteps) { allPoints.push({ lat, lng }); }
    }

    // Split into batches of 80 points
    const BATCH_SIZE = 80;
    const batches = [];
    for (let i = 0; i < allPoints.length; i += BATCH_SIZE) {
      batches.push(allPoints.slice(i, i + BATCH_SIZE));
    }

    const fetchBatch = async (batch) => {
      const lats = batch.map(p => p.lat).join(',');
      const lons = batch.map(p => p.lng).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [data];
    };

    const batchResults = await Promise.all(batches.map(fetchBatch));
    const results = batchResults.flat();
    
    console.log(`[Wind] Loaded global batched grid: ${results.length} points over ${batches.length} requests`);
    return WindGrid.fromOpenMeteo(results, latSteps, lngSteps);
  } catch (err) {
    console.warn('[Wind] Batched fetch failed:', err.message);
    return null;
  }
}

const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const trailRef = useRef(null);
  const animRef = useRef(null);
  const windGridRef = useRef(null);
  const isFetchingRef = useRef(false);
  const [gridLoaded, setGridLoaded] = useState(false);

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
            tCtx.lineWidth = LINE_WIDTH;
            tCtx.strokeStyle = getWindColor(speed);
            tCtx.stroke();
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
      const newGrid = await fetchBatchedWindGrid({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      });
      if (newGrid) {
        windGridRef.current = newGrid;
        setGridLoaded(true);
      }
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
      updateGrid();
    }

    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    window.addEventListener('resize', resize);
    
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
    transition: 'opacity 1s ease-in-out',
    opacity: gridLoaded ? 1 : 0
  };

  return <canvas ref={trailRef} style={{ ...canvasStyle, zIndex: 5 }} />;
};

export default WindParticleCanvas;
