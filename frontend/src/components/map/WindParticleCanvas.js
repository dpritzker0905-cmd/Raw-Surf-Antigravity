import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WindParticleCanvas — Premium Global Animated Wind Overlay for MapLibre.
 *
 * Architecture:
 * - Fetches a static 1-degree resolution global wind grid (GFS snapshot).
 * - Renders animated particle trails that convey wind speed & direction.
 * - Land masses remain FULLY VISIBLE underneath — trails are thin, short-lived,
 *   and the canvas clears aggressively to prevent opacity buildup.
 * - Theme-aware color palettes for Dark, Light, and Beach modes.
 *
 * Design inspiration: Windy.com's transparent particle layer, but with
 * our own premium neon-glow aesthetic tuned per theme.
 */

const PARTICLE_COUNT = 2500;
const MAX_AGE = 60;
const LINE_WIDTH = 1.2;
const SPEED_FACTOR = 2.8;
const GLOBAL_WIND_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

/**
 * Theme-aware color ramps. Each theme uses a carefully curated palette
 * that remains highly visible against its base map style while staying
 * transparent enough to let geography show through.
 *
 * Format: [minSpeedKnots, 'rgba(r,g,b,a)']
 */
const THEME_COLOR_RAMPS = {
  dark: [
    [0,  'rgba(100, 180, 255, 0.35)'],   // calm — soft sky blue
    [4,  'rgba(80, 210, 230, 0.45)'],     // light — cyan
    [8,  'rgba(50, 230, 200, 0.55)'],     // moderate — teal
    [12, 'rgba(120, 255, 160, 0.6)'],     // fresh — green
    [16, 'rgba(255, 255, 120, 0.65)'],    // strong — warm yellow
    [20, 'rgba(255, 190, 80, 0.7)'],      // very strong — orange
    [25, 'rgba(255, 120, 70, 0.75)'],     // gale — red-orange
    [30, 'rgba(255, 60, 80, 0.8)'],       // storm — red
    [40, 'rgba(200, 40, 120, 0.85)'],     // hurricane — magenta
  ],
  light: [
    [0,  'rgba(30, 100, 180, 0.3)'],      // calm — deep blue
    [4,  'rgba(20, 130, 160, 0.4)'],      // light — dark teal
    [8,  'rgba(15, 140, 120, 0.5)'],      // moderate — forest teal
    [12, 'rgba(40, 150, 60, 0.55)'],      // fresh — green
    [16, 'rgba(180, 160, 20, 0.6)'],      // strong — olive gold
    [20, 'rgba(220, 120, 20, 0.65)'],     // very strong — amber
    [25, 'rgba(210, 70, 30, 0.7)'],       // gale — burnt orange
    [30, 'rgba(180, 30, 30, 0.75)'],      // storm — crimson
    [40, 'rgba(140, 20, 80, 0.8)'],       // hurricane — dark magenta
  ],
  beach: [
    [0,  'rgba(255, 200, 140, 0.3)'],     // calm — warm sand
    [4,  'rgba(255, 175, 100, 0.4)'],     // light — golden
    [8,  'rgba(255, 140, 80, 0.5)'],      // moderate — sunset orange
    [12, 'rgba(255, 105, 90, 0.55)'],     // fresh — coral
    [16, 'rgba(240, 80, 110, 0.6)'],      // strong — pink-coral
    [20, 'rgba(210, 60, 140, 0.65)'],     // very strong — magenta
    [25, 'rgba(170, 50, 170, 0.7)'],      // gale — purple
    [30, 'rgba(130, 40, 190, 0.75)'],     // storm — deep purple
    [40, 'rgba(90, 30, 200, 0.8)'],       // hurricane — violet
  ],
};

function getWindColor(speed, colorRamp) {
  for (let i = colorRamp.length - 1; i >= 0; i--) {
    if (speed >= colorRamp[i][0]) return colorRamp[i][1];
  }
  return colorRamp[0][1];
}

/** Parse rgba string to extract base RGB for glow rendering */
function parseRgba(rgbaStr) {
  const m = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return { r: 200, g: 200, b: 255 };
  return { r: +m[1], g: +m[2], b: +m[3] };
}

class GlobalWindGrid {
  constructor(data) {
    const u = data[0];
    const v = data[1];
    const h = u.header;
    this.lo1 = h.lo1;
    this.lo2 = h.lo2;
    this.la1 = h.la1;
    this.la2 = h.la2;
    this.dx = h.dx;
    this.dy = h.dy;
    this.nx = h.nx;
    this.ny = h.ny;
    this.uData = u.data;
    this.vData = v.data;
  }

  interpolate(lat, lng) {
    let lon = lng;
    while (lon < this.lo1) lon += 360;
    while (lon > this.lo2 + this.dx) lon -= 360;

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

const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const trailRef = useRef(null);
  const animRef = useRef(null);
  const windGridRef = useRef(null);
  const [gridLoaded, setGridLoaded] = useState(false);
  const { theme } = useTheme();

  // Resolve color ramp from theme
  const colorRamp = useMemo(() => {
    if (theme === 'light') return THEME_COLOR_RAMPS.light;
    if (theme === 'beach') return THEME_COLOR_RAMPS.beach;
    return THEME_COLOR_RAMPS.dark;
  }, [theme]);

  // Fetch global wind data ONLY ONCE
  useEffect(() => {
    let cancelled = false;
    const fetchGlobal = async () => {
      try {
        const res = await fetch(GLOBAL_WIND_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          windGridRef.current = new GlobalWindGrid(data);
          setGridLoaded(true);
        }
      } catch (err) {
        console.warn('[Wind] Global fetch failed:', err);
      }
    };
    fetchGlobal();
    return () => { cancelled = true; };
  }, []);

  // Animation render loop
  useEffect(() => {
    const map = mapInstance;
    const trailCanvas = trailRef.current;
    if (!map || !trailCanvas || !isActive || !gridLoaded) return;

    const tCtx = trailCanvas.getContext('2d');
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
      return {
        x: Math.random() * c.clientWidth,
        y: Math.random() * c.clientHeight,
        age: Math.floor(Math.random() * MAX_AGE),
        lng: undefined,
        lat: undefined,
      };
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(seedParticle());

    function draw() {
      const zoom = map.getZoom();
      const zoomScale = SPEED_FACTOR * Math.pow(zoom / 7, 0.8);
      const container = map.getContainer();
      const w = container.clientWidth;
      const h = container.clientHeight;
      const grid = windGridRef.current;
      const ramp = colorRamp;

      // --- CRITICAL: Aggressive fade for map transparency ---
      // Instead of destination-in (which accumulates), use a clear + redraw approach.
      // We fade existing trails by painting a translucent rect over them.
      // Lower alpha = faster fade = more transparent canvas = more map visible.
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0;
      tCtx.fillStyle = 'rgba(0, 0, 0, 0.82)';
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';
      tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      for (const p of particles) {
        // Initialize geographic coordinates if not set
        if (p.lng === undefined || p.lat === undefined) {
          const geo = map.unproject([p.x, p.y]);
          p.lng = geo.lng;
          p.lat = geo.lat;
        }

        const wind = grid.interpolate(p.lat, p.lng);
        if (wind) {
          const [u, v, speed] = wind;

          // Get previous pixel position
          const prevPos = map.project([p.lng, p.lat]);

          // Geographic step — velocity-scaled for dynamic streaks
          const velocityScalar = Math.max(0.5, Math.min(1.8, speed / 12));
          const degreeScale = 0.004 * zoomScale * velocityScalar;

          p.lng += u * degreeScale;
          p.lat += v * degreeScale;
          p.age++;

          // Get new pixel position
          const newPos = map.project([p.lng, p.lat]);

          // Skip if movement is too small (sub-pixel)
          const dx = newPos.x - prevPos.x;
          const dy = newPos.y - prevPos.y;
          if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) continue;

          const angle = Math.atan2(dy, dx);
          const colorStr = getWindColor(speed, ramp);

          // --- SUBTLE GLOW (thin, low alpha) ---
          // Only draw glow for faster winds (speed > 8 kts) to avoid saturation
          if (speed > 8) {
            const { r, g, b } = parseRgba(colorStr);
            tCtx.beginPath();
            tCtx.moveTo(prevPos.x, prevPos.y);
            tCtx.lineTo(newPos.x, newPos.y);
            tCtx.lineWidth = LINE_WIDTH * 2.5;
            tCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
            tCtx.stroke();
          }

          // --- CORE PARTICLE LINE ---
          tCtx.beginPath();
          tCtx.moveTo(prevPos.x, prevPos.y);
          tCtx.lineTo(newPos.x, newPos.y);

          // Subtle arrowhead for direction clarity
          const arrowSize = 3 * (1 + zoomScale * 0.08);
          tCtx.lineTo(
            newPos.x - arrowSize * Math.cos(angle - Math.PI / 6),
            newPos.y - arrowSize * Math.sin(angle - Math.PI / 6)
          );
          tCtx.moveTo(newPos.x, newPos.y);
          tCtx.lineTo(
            newPos.x - arrowSize * Math.cos(angle + Math.PI / 6),
            newPos.y - arrowSize * Math.sin(angle + Math.PI / 6)
          );

          tCtx.lineWidth = LINE_WIDTH;
          tCtx.strokeStyle = colorStr;
          tCtx.stroke();
        } else {
          p.age = MAX_AGE + 1;
        }

        // Bounds check — recycle particles that leave the viewport or expire
        const testPos = map.project([p.lng, p.lat]);
        if (p.age > MAX_AGE || testPos.x < -20 || testPos.x > w + 20 || testPos.y < -20 || testPos.y > h + 20) {
          Object.assign(p, seedParticle());
        }
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
  }, [isActive, mapInstance, gridLoaded, colorRamp]);

  if (!isActive) return null;

  return (
    <canvas
      ref={trailRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
        transition: 'opacity 0.8s ease-in-out',
        opacity: gridLoaded ? 1 : 0,
      }}
    />
  );
};

export default WindParticleCanvas;
