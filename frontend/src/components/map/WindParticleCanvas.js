import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WindParticleCanvas — Dual-layer wind visualization engine.
 *
 * Layer 1 (Color Field): A smooth, semi-transparent heatmap showing wind speed
 *   magnitude across the viewport. Rendered to an offscreen canvas with CSS blur,
 *   updated only when the map viewport changes (not every frame).
 *
 * Layer 2 (Particle Trails): Animated particles flowing with the wind field,
 *   showing direction and relative speed. Uses PIXEL-SPACE movement to guarantee
 *   visibility at ALL zoom levels, including fully-zoomed-out world view.
 *
 * Data source: Static 1-degree GFS wind grid (u/v components).
 * Inspired by Windy.com but with theme-aware palettes and neon glow aesthetics.
 */

// --- Configuration ---
const PARTICLE_COUNT = 4000;
const MAX_AGE = 80;
const LINE_WIDTH = 1.3;
const FIELD_CELL_SIZE = 8;          // Pixels per grid cell for color field (smaller = smoother)
const FIELD_UPDATE_THROTTLE = 150;  // ms debounce for field redraws on map move
const GLOBAL_WIND_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

/**
 * Theme-aware PARTICLE color ramps — vivid, semi-transparent.
 * Format: [minSpeedKnots, r, g, b, alpha]
 */
const THEME_PARTICLE_COLORS = {
  dark: [
    [0,  100, 180, 255, 0.5],
    [4,  80,  210, 230, 0.6],
    [8,  50,  230, 200, 0.65],
    [12, 120, 255, 160, 0.7],
    [16, 255, 255, 120, 0.75],
    [20, 255, 190, 80,  0.8],
    [25, 255, 120, 70,  0.85],
    [30, 255, 60,  80,  0.9],
    [40, 200, 40,  120, 0.95],
  ],
  light: [
    [0,  30,  100, 180, 0.45],
    [4,  20,  130, 160, 0.55],
    [8,  15,  140, 120, 0.6],
    [12, 40,  150, 60,  0.65],
    [16, 180, 160, 20,  0.7],
    [20, 220, 120, 20,  0.75],
    [25, 210, 70,  30,  0.8],
    [30, 180, 30,  30,  0.85],
    [40, 140, 20,  80,  0.9],
  ],
  beach: [
    [0,  255, 200, 140, 0.45],
    [4,  255, 175, 100, 0.55],
    [8,  255, 140, 80,  0.6],
    [12, 255, 105, 90,  0.65],
    [16, 240, 80,  110, 0.7],
    [20, 210, 60,  140, 0.75],
    [25, 170, 50,  170, 0.8],
    [30, 130, 40,  190, 0.85],
    [40, 90,  30,  200, 0.9],
  ],
};

/**
 * Theme-aware FIELD color ramps — very low opacity for background tint.
 * Format: [minSpeedKnots, r, g, b, alpha]
 */
const THEME_FIELD_COLORS = {
  dark: [
    [0,  60,  120, 200, 0.06],
    [4,  50,  160, 210, 0.10],
    [8,  40,  190, 180, 0.14],
    [12, 80,  210, 120, 0.18],
    [16, 200, 210, 60,  0.22],
    [20, 230, 160, 50,  0.26],
    [25, 230, 100, 50,  0.30],
    [30, 220, 50,  60,  0.34],
    [40, 180, 30,  90,  0.38],
  ],
  light: [
    [0,  20,  80,  160, 0.05],
    [4,  15,  110, 150, 0.08],
    [8,  10,  120, 110, 0.12],
    [12, 30,  130, 50,  0.15],
    [16, 160, 140, 20,  0.18],
    [20, 200, 100, 20,  0.22],
    [25, 190, 60,  25,  0.26],
    [30, 160, 25,  25,  0.30],
    [40, 120, 15,  70,  0.34],
  ],
  beach: [
    [0,  240, 180, 120, 0.05],
    [4,  240, 155, 85,  0.08],
    [8,  240, 120, 65,  0.12],
    [12, 240, 90,  75,  0.15],
    [16, 220, 65,  95,  0.18],
    [20, 195, 50,  125, 0.22],
    [25, 155, 40,  155, 0.26],
    [30, 115, 30,  175, 0.30],
    [40, 75,  20,  185, 0.34],
  ],
};

/** Look up [r, g, b, a] from a structured ramp */
function lookupColor(speed, ramp) {
  for (let i = ramp.length - 1; i >= 0; i--) {
    if (speed >= ramp[i][0]) return ramp[i];
  }
  return ramp[0];
}

/** Build an rgba() string from a ramp entry */
function toRgba(entry) {
  return `rgba(${entry[1]}, ${entry[2]}, ${entry[3]}, ${entry[4]})`;
}

// --- Wind Grid Data Structure ---
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

// --- Main Component ---
const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const fieldRef = useRef(null);     // Color field canvas
  const trailRef = useRef(null);     // Particle trail canvas
  const animRef = useRef(null);
  const windGridRef = useRef(null);
  const fieldTimerRef = useRef(null);
  const [gridLoaded, setGridLoaded] = useState(false);
  const { theme } = useTheme();

  const particleRamp = useMemo(() => {
    if (theme === 'light') return THEME_PARTICLE_COLORS.light;
    if (theme === 'beach') return THEME_PARTICLE_COLORS.beach;
    return THEME_PARTICLE_COLORS.dark;
  }, [theme]);

  const fieldRamp = useMemo(() => {
    if (theme === 'light') return THEME_FIELD_COLORS.light;
    if (theme === 'beach') return THEME_FIELD_COLORS.beach;
    return THEME_FIELD_COLORS.dark;
  }, [theme]);

  // --- Fetch global wind data ONCE ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    })();
    return () => { cancelled = true; };
  }, []);

  // --- COLOR FIELD RENDERING (Layer 1) ---
  // Draws a smooth wind-speed heatmap using ImageData for performance.
  // Only re-renders when the map viewport changes (not every frame).
  const renderColorField = useCallback(() => {
    const map = mapInstance;
    const canvas = fieldRef.current;
    const grid = windGridRef.current;
    if (!map || !canvas || !grid) return;

    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    const cols = Math.ceil(w / FIELD_CELL_SIZE);
    const rows = Math.ceil(h / FIELD_CELL_SIZE);
    const imgData = ctx.createImageData(w, h);
    const pixels = imgData.data;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = (col + 0.5) * FIELD_CELL_SIZE;
        const cy = (row + 0.5) * FIELD_CELL_SIZE;
        const geo = map.unproject([cx, cy]);
        const wind = grid.interpolate(geo.lat, geo.lng);
        if (!wind) continue;

        const [, , speed] = wind;
        const c = lookupColor(speed, fieldRamp);
        const r = c[1], g = c[2], b = c[3], a = Math.round(c[4] * 255);

        // Fill the FIELD_CELL_SIZE x FIELD_CELL_SIZE block with this color
        const startX = col * FIELD_CELL_SIZE;
        const startY = row * FIELD_CELL_SIZE;
        const endX = Math.min(startX + FIELD_CELL_SIZE, w);
        const endY = Math.min(startY + FIELD_CELL_SIZE, h);

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * w + px) * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [mapInstance, fieldRamp]);

  // Color field effect: render on load + throttled on map move
  useEffect(() => {
    const map = mapInstance;
    if (!map || !isActive || !gridLoaded) return;

    // Initial render
    renderColorField();

    // Throttled re-render on viewport change
    const onViewChange = () => {
      clearTimeout(fieldTimerRef.current);
      fieldTimerRef.current = setTimeout(renderColorField, FIELD_UPDATE_THROTTLE);
    };

    map.on('moveend', onViewChange);
    map.on('zoomend', onViewChange);
    window.addEventListener('resize', onViewChange);

    return () => {
      map.off('moveend', onViewChange);
      map.off('zoomend', onViewChange);
      window.removeEventListener('resize', onViewChange);
      clearTimeout(fieldTimerRef.current);
    };
  }, [mapInstance, isActive, gridLoaded, renderColorField]);

  // --- PARTICLE ANIMATION (Layer 2) ---
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

    // Cache pixelsPerDegree at the map center — updated every ~60 frames
    let cachedPPD = 1;
    let frameCount = 0;
    function updatePPD() {
      const center = map.getCenter();
      const p1 = map.project([center.lng, center.lat]);
      const p2 = map.project([center.lng + 1, center.lat]);
      cachedPPD = Math.max(0.5, Math.abs(p2.x - p1.x));
    }
    updatePPD();

    function draw() {
      const container = map.getContainer();
      const w = container.clientWidth;
      const h = container.clientHeight;
      const grid = windGridRef.current;
      const ramp = particleRamp;

      // Update pixelsPerDegree every 60 frames (once per second at 60fps)
      frameCount++;
      if (frameCount % 60 === 0) updatePPD();

      // --- Fade existing trails ---
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0;
      tCtx.fillStyle = 'rgba(0, 0, 0, 0.92)';
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';
      tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      for (const p of particles) {
        // Initialize geographic coordinates from pixel position
        if (p.lng === undefined || p.lat === undefined) {
          const geo = map.unproject([p.x, p.y]);
          p.lng = geo.lng;
          p.lat = geo.lat;
        }

        const wind = grid.interpolate(p.lat, p.lng);
        if (wind) {
          const [u, v, speed] = wind;
          const prevPos = map.project([p.lng, p.lat]);

          // --- PIXEL-SPACE MOVEMENT ---
          // Calculate movement in target pixels, then convert to degrees.
          // This ensures particles move visibly at ANY zoom level.
          const targetPixels = 0.8 + speed * 0.15;  // 0.8px base + speed-proportional
          const degreesPerFrame = targetPixels / cachedPPD;

          // Apply wind direction (normalize u/v to unit vector, scale by degrees)
          const mag = Math.max(0.01, speed); // prevent division by zero
          p.lng += (u / mag) * degreesPerFrame;
          p.lat -= (v / mag) * degreesPerFrame; // negative because lat increases northward

          p.age++;

          const newPos = map.project([p.lng, p.lat]);
          const dx = newPos.x - prevPos.x;
          const dy = newPos.y - prevPos.y;

          // Skip sub-pixel movements
          if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) continue;

          const angle = Math.atan2(dy, dx);
          const entry = lookupColor(speed, ramp);
          const colorStr = toRgba(entry);

          // --- Subtle glow for strong winds ---
          if (speed > 10) {
            tCtx.beginPath();
            tCtx.moveTo(prevPos.x, prevPos.y);
            tCtx.lineTo(newPos.x, newPos.y);
            tCtx.lineWidth = LINE_WIDTH * 3;
            tCtx.strokeStyle = `rgba(${entry[1]}, ${entry[2]}, ${entry[3]}, 0.15)`;
            tCtx.stroke();
          }

          // --- Core particle stroke + arrowhead ---
          tCtx.beginPath();
          tCtx.moveTo(prevPos.x, prevPos.y);
          tCtx.lineTo(newPos.x, newPos.y);

          const arrowSize = 3;
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

        // Recycle expired or out-of-bounds particles
        const testPos = map.project([p.lng, p.lat]);
        if (p.age > MAX_AGE || testPos.x < -30 || testPos.x > w + 30 || testPos.y < -30 || testPos.y > h + 30) {
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
  }, [isActive, mapInstance, gridLoaded, particleRamp]);

  // --- Clean up color field when deactivated ---
  useEffect(() => {
    if (!isActive && fieldRef.current) {
      const ctx = fieldRef.current.getContext('2d');
      ctx.clearRect(0, 0, fieldRef.current.width, fieldRef.current.height);
    }
  }, [isActive]);

  if (!isActive) return null;

  const baseCanvasStyle = {
    position: 'absolute',
    top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none',
    transition: 'opacity 0.8s ease-in-out',
    opacity: gridLoaded ? 1 : 0,
  };

  return (
    <>
      {/* Layer 1: Wind speed color field (blurred for smooth gradients) */}
      <canvas
        ref={fieldRef}
        style={{
          ...baseCanvasStyle,
          zIndex: 4,
          filter: 'blur(10px)',
        }}
      />
      {/* Layer 2: Animated particle trails */}
      <canvas
        ref={trailRef}
        style={{
          ...baseCanvasStyle,
          zIndex: 5,
        }}
      />
    </>
  );
};

export default WindParticleCanvas;
