import React, { useEffect, useRef, useState } from 'react';

/**
 * WindParticleCanvas — GPU-friendly animated wind particle overlay for MapLibre.
 *
 * Renders thousands of flowing particles on a canvas synced with the map,
 * mimicking Windy.com's signature directional wind flow visualization.
 *
 * Architecture:
 * - Fetches GFS-format wind grid data (U/V component arrays)
 * - Builds a bilinear-interpolated wind field
 * - Animates particles in screen-space, projecting to/from geo-coords
 * - Clears and reseeds on map pan/zoom for seamless interaction
 */

const PARTICLE_COUNT = 3500;
const MAX_AGE = 120;
const FADE_ALPHA = 0.93;
const LINE_WIDTH = 1.8;
const SPEED_FACTOR = 2.5;
const WIND_DATA_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

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

/** Bilinear-interpolated wind field from GFS U/V grid arrays */
class WindGrid {
  constructor(data) {
    const uComp = data[0];
    const vComp = data[1];
    const h = uComp.header;
    this.lo1 = h.lo1;
    this.la1 = h.la1;
    this.dx = h.dx;
    this.dy = h.dy;
    this.nx = h.nx;
    this.ny = h.ny;
    this.uData = uComp.data;
    this.vData = vComp.data;
  }

  interpolate(lat, lng) {
    let lon = lng < 0 ? lng + 360 : lng;
    const fi = (lon - this.lo1) / this.dx;
    const fj = (this.la1 - lat) / this.dy;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (i < 0 || i >= this.nx - 1 || j < 0 || j >= this.ny - 1) return null;

    const fx = fi - i;
    const fy = fj - j;
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

const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const [windGrid, setWindGrid] = useState(null);

  // 1. Fetch wind data when activated
  useEffect(() => {
    if (!isActive) { setWindGrid(null); return; }
    let cancelled = false;
    fetch(WIND_DATA_URL)
      .then(r => r.json())
      .then(data => { if (!cancelled) setWindGrid(new WindGrid(data)); })
      .catch(err => console.error('[Wind] Data fetch failed:', err));
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

    function resize() {
      const container = map.getContainer();
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    resize();

    function seedParticle() {
      return { x: Math.random() * canvas.width, y: Math.random() * canvas.height, age: Math.floor(Math.random() * MAX_AGE) };
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());

    function draw() {
      if (moving) { animRef.current = requestAnimationFrame(draw); return; }

      // Fade trails — longer persistence for visible wind streams
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
          const prevX = p.x;
          const prevY = p.y;
          p.x += u * zoomScale;
          p.y -= v * zoomScale;
          p.age++;

          // Progressive tapering: thicker at start, thinner as particle ages
          const ageRatio = 1 - (p.age / MAX_AGE);
          const lineW = LINE_WIDTH * Math.max(0.3, ageRatio);
          const alpha = Math.max(0.15, ageRatio * 0.9);

          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(p.x, p.y);
          ctx.lineWidth = lineW;
          ctx.strokeStyle = getWindColor(speed);
          ctx.globalAlpha = alpha;
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          p.age = MAX_AGE + 1;
        }

        if (p.age > MAX_AGE || p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
          Object.assign(p, seedParticle());
        }
      }
      animRef.current = requestAnimationFrame(draw);
    }

    function onMoveStart() { moving = true; ctx.clearRect(0, 0, canvas.width, canvas.height); }
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
