import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WindParticleCanvas — Professional dual-layer wind visualization engine.
 *
 * Architecture matches Windy.com's proven approach:
 *   Layer 1 (Color Field): The PRIMARY visual — a vivid, clearly-visible heatmap
 *     showing wind speed magnitude across the entire viewport. Uses rich, saturated
 *     colors at high enough alpha to be unmistakably visible on BOTH light and dark
 *     base maps. Rendered via ImageData → CSS blur for smooth gradients.
 *
 *   Layer 2 (Particle Trails): SECONDARY directional accents — bright animated
 *     lines flowing with the wind. Uses pixel-space movement for zoom-agnostic
 *     visibility at all zoom levels.
 *
 * Data: Static 1° GFS global wind grid (u/v components, bilinear interpolation).
 */

// --- Configuration ---
const PARTICLE_COUNT = 3500;
const MAX_AGE = 70;
const LINE_WIDTH = 1.0;
const FIELD_CELL_SIZE = 8;          // px per grid cell for color field
const FIELD_BLUR_PX = 12;           // CSS blur radius for smooth gradients
const FIELD_UPDATE_THROTTLE = 120;  // ms debounce for field redraws on map move
const GLOBAL_WIND_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

/**
 * FIELD color ramps — the PRIMARY visual layer.
 *
 * CRITICAL DESIGN PRINCIPLE: These colors must be clearly visible against
 * their respective map base tiles. Light themes need saturated mid-tone
 * colors (NOT pale/washed out). Dark themes can use brighter neons.
 *
 * Beaufort-scale 12-stop ramp for professional wind speed differentiation.
 * Format: [minSpeedMS, r, g, b, alpha]
 *
 * Alpha guideline: 0.40 minimum for calm, scaling to 0.75 for extreme.
 * This ensures the field is ALWAYS clearly visible while the map geography
 * (coastlines, city names, roads) remains readable underneath.
 */
const THEME_FIELD_COLORS = {
  dark: [
    [0,  40,  80,  160, 0.40],     // calm — deep navy
    [2,  30,  120, 185, 0.42],     // light air — ocean blue
    [4,  20,  155, 180, 0.44],     // light breeze — teal
    [6,  30,  180, 140, 0.46],     // gentle — sea green
    [8,  60,  195, 90,  0.48],     // moderate — green
    [11, 140, 210, 40,  0.50],     // fresh — lime
    [14, 220, 210, 30,  0.52],     // strong — yellow
    [17, 245, 170, 25,  0.55],     // near gale — amber
    [21, 245, 110, 30,  0.58],     // gale — orange
    [25, 235, 60,  40,  0.62],     // strong gale — red-orange
    [29, 210, 30,  60,  0.66],     // storm — red
    [34, 180, 20,  120, 0.70],     // violent storm — magenta
    [40, 140, 15,  160, 0.75],     // hurricane — purple
  ],
  light: [
    // On a WHITE map, we need darker, more saturated colors to be visible!
    [0,  25,  60,  140, 0.45],     // calm — rich navy (dark on white = visible)
    [2,  20,  95,  165, 0.47],     // light air — medium blue
    [4,  15,  130, 155, 0.49],     // light breeze — dark teal
    [6,  25,  155, 115, 0.51],     // gentle — forest green
    [8,  50,  165, 55,  0.53],     // moderate — green
    [11, 120, 175, 25,  0.55],     // fresh — olive-lime
    [14, 190, 170, 15,  0.57],     // strong — dark gold
    [17, 215, 130, 15,  0.60],     // near gale — amber
    [21, 210, 80,  20,  0.63],     // gale — burnt orange
    [25, 200, 40,  30,  0.66],     // strong gale — dark red
    [29, 175, 20,  50,  0.70],     // storm — crimson
    [34, 150, 15,  95,  0.73],     // violent storm — dark magenta
    [40, 115, 10,  135, 0.76],     // hurricane — dark purple
  ],
  beach: [
    [0,  170, 130, 80,  0.40],     // calm — warm sand
    [2,  190, 115, 60,  0.42],     // light air — caramel
    [4,  205, 95,  50,  0.44],     // light breeze — terracotta
    [6,  215, 75,  50,  0.46],     // gentle — burnt sienna
    [8,  220, 55,  55,  0.48],     // moderate — coral red
    [11, 215, 40,  75,  0.50],     // fresh — hot pink
    [14, 200, 35,  100, 0.53],     // strong — rose
    [17, 180, 30,  130, 0.56],     // near gale — magenta
    [21, 155, 25,  155, 0.59],     // gale — purple
    [25, 130, 20,  175, 0.62],     // strong gale — dark violet
    [29, 100, 15,  190, 0.66],     // storm — deep purple
    [34, 75,  10,  200, 0.70],     // violent storm — indigo
    [40, 50,  5,   210, 0.74],     // hurricane — royal blue
  ],
};

/**
 * PARTICLE color ramps — bright directional accents above the color field.
 * These use HIGH contrast colors (near-white for dark theme, dark for light)
 * so they pop above the field layer.
 * Format: [minSpeedMS, r, g, b, alpha]
 */
const THEME_PARTICLE_COLORS = {
  dark: [
    [0,  200, 230, 255, 0.50],     // calm — bright white-blue
    [5,  170, 245, 245, 0.60],     // moderate — bright cyan
    [10, 220, 255, 210, 0.68],     // fresh — bright green-white
    [15, 255, 255, 170, 0.74],     // strong — bright yellow-white
    [20, 255, 210, 130, 0.80],     // gale — bright orange-white
    [28, 255, 150, 150, 0.85],     // storm — bright red-white
    [36, 255, 130, 220, 0.90],     // hurricane — bright magenta-white
  ],
  light: [
    // On light map with dark field, particles should be LIGHTER to contrast
    [0,  50,  90,  180, 0.55],     // calm — medium blue (darker than field)
    [5,  40,  140, 170, 0.65],     // moderate — teal
    [10, 60,  170, 70,  0.70],     // fresh — green
    [15, 180, 170, 20,  0.75],     // strong — gold
    [20, 220, 110, 20,  0.80],     // gale — orange
    [28, 200, 40,  40,  0.85],     // storm — red
    [36, 160, 20,  100, 0.90],     // hurricane — magenta
  ],
  beach: [
    [0,  255, 230, 190, 0.50],     // calm — warm cream
    [5,  255, 195, 140, 0.60],     // moderate — peach
    [10, 255, 155, 120, 0.68],     // fresh — salmon
    [15, 255, 115, 110, 0.74],     // strong — coral
    [20, 245, 80,  130, 0.80],     // gale — hot pink
    [28, 210, 60,  180, 0.85],     // storm — purple
    [36, 160, 50,  220, 0.90],     // hurricane — violet
  ],
};

/** Look up [speed, r, g, b, a] from a structured ramp */
function lookupColor(speed, ramp) {
  for (let i = ramp.length - 1; i >= 0; i--) {
    if (speed >= ramp[i][0]) return ramp[i];
  }
  return ramp[0];
}

/** Build an rgba() CSS string from a ramp entry */
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

  /** Bilinear interpolation of wind [u, v, speed] at a geographic point */
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

// ============================================================
//  Main Component
// ============================================================
const WindParticleCanvas = ({ mapInstance, isActive }) => {
  const fieldRef = useRef(null);
  const trailRef = useRef(null);
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

  // --- Fetch global wind grid data ONCE ---
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
        console.warn('[Wind] Global grid fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ==========================================================
  //  LAYER 1: Color Field Heatmap (PRIMARY VISUAL)
  // ==========================================================
  const renderColorField = useCallback(() => {
    const map = mapInstance;
    const canvas = fieldRef.current;
    const grid = windGridRef.current;
    if (!map || !canvas || !grid) return;

    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Size canvas to match viewport (no DPR scaling for field — blur smooths anyway)
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    const ramp = fieldRamp;
    const cols = Math.ceil(w / FIELD_CELL_SIZE);
    const rows = Math.ceil(h / FIELD_CELL_SIZE);
    const imgData = ctx.createImageData(w, h);
    const pixels = imgData.data;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Sample wind at the center of each cell
        const cx = (col + 0.5) * FIELD_CELL_SIZE;
        const cy = (row + 0.5) * FIELD_CELL_SIZE;
        const geo = map.unproject([cx, cy]);
        const wind = grid.interpolate(geo.lat, geo.lng);
        if (!wind) continue;

        const [, , speed] = wind;
        const c = lookupColor(speed, ramp);
        const r = c[1], g = c[2], b = c[3], a = Math.round(c[4] * 255);

        // Fill the cell block with the looked-up color
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

  // Render field on load + throttled on viewport change
  useEffect(() => {
    const map = mapInstance;
    if (!map || !isActive || !gridLoaded) return;

    renderColorField();

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

  // Re-render field when theme changes
  useEffect(() => {
    if (isActive && gridLoaded && mapInstance) renderColorField();
  }, [fieldRamp, isActive, gridLoaded, mapInstance, renderColorField]);

  // ==========================================================
  //  LAYER 2: Particle Trail Animation (SECONDARY)
  // ==========================================================
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

    // Cache pixels-per-degree at the map center for pixel-space movement
    let cachedPPD = 1;
    let frameCount = 0;
    function updatePPD() {
      try {
        const center = map.getCenter();
        const p1 = map.project([center.lng, center.lat]);
        const p2 = map.project([center.lng + 1, center.lat]);
        cachedPPD = Math.max(0.5, Math.abs(p2.x - p1.x));
      } catch (e) {
        cachedPPD = 1;
      }
    }
    updatePPD();

    function draw() {
      const container = map.getContainer();
      const w = container.clientWidth;
      const h = container.clientHeight;
      const grid = windGridRef.current;
      const ramp = particleRamp;

      // Refresh PPD every ~30 frames (~0.5s at 60fps)
      frameCount++;
      if (frameCount % 30 === 0) updatePPD();

      // --- Fade existing trails ---
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0;
      tCtx.fillStyle = 'rgba(0, 0, 0, 0.90)';
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';
      tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      for (const p of particles) {
        // Initialize geographic coords from random pixel position
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
          // Target a constant pixel displacement per frame regardless of zoom.
          // This guarantees visible particle motion at ALL zoom levels.
          const targetPx = 1.0 + speed * 0.12;
          const degStep = targetPx / cachedPPD;
          const mag = Math.max(0.01, speed);

          p.lng += (u / mag) * degStep;
          p.lat -= (v / mag) * degStep;
          p.age++;

          const newPos = map.project([p.lng, p.lat]);
          const dx = newPos.x - prevPos.x;
          const dy = newPos.y - prevPos.y;
          const pixelDist = Math.sqrt(dx * dx + dy * dy);

          // Skip sub-pixel movements (invisible)
          if (pixelDist < 0.5) continue;

          const entry = lookupColor(speed, ramp);

          // --- Subtle glow halo for strong winds ---
          if (speed > 12) {
            tCtx.beginPath();
            tCtx.moveTo(prevPos.x, prevPos.y);
            tCtx.lineTo(newPos.x, newPos.y);
            tCtx.lineWidth = LINE_WIDTH * 3.5;
            tCtx.strokeStyle = `rgba(${entry[1]}, ${entry[2]}, ${entry[3]}, 0.10)`;
            tCtx.stroke();
          }

          // --- Core particle line ---
          tCtx.beginPath();
          tCtx.moveTo(prevPos.x, prevPos.y);
          tCtx.lineTo(newPos.x, newPos.y);
          tCtx.lineWidth = LINE_WIDTH;
          tCtx.strokeStyle = toRgba(entry);
          tCtx.stroke();
        } else {
          // No wind data at this position — recycle immediately
          p.age = MAX_AGE + 1;
        }

        // Recycle expired or out-of-viewport particles
        if (p.lng !== undefined) {
          const testPos = map.project([p.lng, p.lat]);
          if (p.age > MAX_AGE || testPos.x < -50 || testPos.x > w + 50 || testPos.y < -50 || testPos.y > h + 50) {
            Object.assign(p, seedParticle());
          }
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

  // Clean up both canvases when layer deactivated
  useEffect(() => {
    if (!isActive) {
      [fieldRef, trailRef].forEach(ref => {
        if (ref.current) {
          const ctx = ref.current.getContext('2d');
          ctx.clearRect(0, 0, ref.current.width, ref.current.height);
        }
      });
    }
  }, [isActive]);

  if (!isActive) return null;

  const baseCanvasStyle = {
    position: 'absolute',
    top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none',
    transition: 'opacity 0.6s ease-in-out',
    opacity: gridLoaded ? 1 : 0,
  };

  return (
    <>
      {/* Layer 1: Wind speed color field — PRIMARY (blurred for smooth gradients) */}
      <canvas
        ref={fieldRef}
        style={{
          ...baseCanvasStyle,
          zIndex: 4,
          filter: `blur(${FIELD_BLUR_PX}px)`,
        }}
      />
      {/* Layer 2: Animated particle trails — SECONDARY (directional accents) */}
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
