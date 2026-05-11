import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * WindParticleCanvas — Professional dual-layer wind visualization engine.
 *
 * Architecture:
 *   Layer 1 (Color Field): A vivid heatmap of wind speed across the viewport.
 *     Rendered via ImageData \u2192 CSS blur. Updates on moveend/zoomend with
 *     real-time CSS-transform tracking during pan to stay glued to the map.
 *
 *   Layer 2 (Particle Trails): Animated directional lines flowing with the wind.
 *     Uses pixel-space movement for zoom-agnostic visibility.
 *
 * Data: Static 1\u00B0 GFS global wind grid (u/v, bilinear interpolation).
 */

// --- Configuration ---
const PARTICLE_COUNT = 3500;
const MAX_AGE = 70;
const LINE_WIDTH = 1.0;
const FIELD_CELL_SIZE = 8;
const FIELD_BLUR_PX = 12;
const FIELD_UPDATE_THROTTLE = 80; // ms debounce for field redraws after pan
const GLOBAL_WIND_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

/**
 * FIELD color ramps \u2014 the primary visual.
 *
 * Windy-style hue spread: 6 distinct hue families across the 0\u201317 m/s range
 * (covers 95% of real-world conditions) so the user ALWAYS sees multi-color
 * differentiation, not a single monochrome tint.
 *
 * Key calibration: alpha at 0.55\u20130.80 so the overlay is the DOMINANT visual
 * while map geography stays readable beneath.
 *
 * Format: [minSpeedMS, r, g, b, alpha]
 */
const THEME_FIELD_COLORS = {
  dark: [
    //  Speed   R    G    B    A
    [0,   30,  60, 160, 0.55],   // calm \u2014 deep blue
    [2,   25, 100, 185, 0.56],   // light air \u2014 royal blue
    [3,   20, 145, 195, 0.57],   // \u2014 cyan-blue
    [5,   15, 180, 175, 0.58],   // light breeze \u2014 teal
    [7,   30, 190, 120, 0.59],   // gentle \u2014 sea green
    [9,   70, 195,  60, 0.60],   // moderate \u2014 green
    [11, 150, 205,  30, 0.61],   // fresh \u2014 lime-green
    [14, 220, 200,  25, 0.63],   // strong \u2014 yellow
    [17, 245, 160,  20, 0.65],   // near gale \u2014 amber
    [21, 245, 100,  25, 0.68],   // gale \u2014 orange
    [25, 235,  50,  35, 0.72],   // strong gale \u2014 red-orange
    [30, 210,  25,  55, 0.75],   // storm \u2014 red
    [36, 175,  15, 110, 0.78],   // violent storm \u2014 magenta
    [44, 135,  10, 160, 0.80],   // hurricane \u2014 purple
  ],
  light: [
    // Darker, saturated tones for contrast against white/light map base
    [0,   20,  45, 130, 0.55],   // calm \u2014 dark navy
    [2,   15,  80, 155, 0.56],
    [3,   10, 115, 160, 0.57],   // \u2014 dark cyan
    [5,   10, 145, 140, 0.58],   // \u2014 dark teal
    [7,   20, 155, 100, 0.59],
    [9,   50, 160,  40, 0.60],   // moderate \u2014 forest green
    [11, 120, 165,  20, 0.61],   // fresh \u2014 olive
    [14, 180, 165,  10, 0.63],   // strong \u2014 dark gold
    [17, 210, 125,  10, 0.65],   // near gale \u2014 dark amber
    [21, 210,  75,  15, 0.68],   // gale \u2014 burnt orange
    [25, 200,  35,  25, 0.72],   // strong gale \u2014 dark red
    [30, 175,  15,  40, 0.75],   // storm \u2014 crimson
    [36, 145,  10,  85, 0.78],   // violent storm \u2014 dark magenta
    [44, 110,   5, 130, 0.80],   // hurricane \u2014 dark purple
  ],
  beach: [
    [0,  160, 120,  70, 0.50],   // calm \u2014 warm sand
    [2,  180, 105,  55, 0.52],
    [3,  195,  90,  45, 0.54],
    [5,  210,  70,  45, 0.56],
    [7,  220,  50,  50, 0.58],   // \u2014 coral
    [9,  215,  35,  70, 0.60],
    [11, 205,  30,  95, 0.62],
    [14, 190,  25, 120, 0.64],   // \u2014 rose
    [17, 170,  20, 145, 0.66],
    [21, 145,  15, 165, 0.69],   // \u2014 purple
    [25, 120,  10, 180, 0.72],
    [30,  90,  10, 195, 0.75],   // \u2014 deep violet
    [36,  60,   5, 205, 0.78],
    [44,  40,   0, 215, 0.80],   // hurricane \u2014 indigo
  ],
};

/**
 * PARTICLE color ramps \u2014 bright accents above the field.
 * Format: [minSpeedMS, r, g, b, alpha]
 */
const THEME_PARTICLE_COLORS = {
  dark: [
    [0,  200, 230, 255, 0.50],
    [5,  170, 245, 245, 0.60],
    [10, 220, 255, 210, 0.68],
    [15, 255, 255, 170, 0.74],
    [20, 255, 210, 130, 0.80],
    [28, 255, 150, 150, 0.85],
    [36, 255, 130, 220, 0.90],
  ],
  light: [
    [0,   50,  90, 180, 0.55],
    [5,   40, 140, 170, 0.65],
    [10,  60, 170,  70, 0.70],
    [15, 180, 170,  20, 0.75],
    [20, 220, 110,  20, 0.80],
    [28, 200,  40,  40, 0.85],
    [36, 160,  20, 100, 0.90],
  ],
  beach: [
    [0,  255, 230, 190, 0.50],
    [5,  255, 195, 140, 0.60],
    [10, 255, 155, 120, 0.68],
    [15, 255, 115, 110, 0.74],
    [20, 245,  80, 130, 0.80],
    [28, 210,  60, 180, 0.85],
    [36, 160,  50, 220, 0.90],
  ],
};

/** Look up [speed, r, g, b, a] from a sorted ramp */
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
  // Stores the geographic anchor point at the time the field was last rendered.
  // Used to compute CSS-transform offset during pan so the overlay stays glued.
  const fieldOriginRef = useRef(null);
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
        const cx = (col + 0.5) * FIELD_CELL_SIZE;
        const cy = (row + 0.5) * FIELD_CELL_SIZE;
        const geo = map.unproject([cx, cy]);
        const wind = grid.interpolate(geo.lat, geo.lng);
        if (!wind) continue;

        const [, , speed] = wind;
        const c = lookupColor(speed, ramp);
        const r = c[1], g = c[2], b = c[3], a = Math.round(c[4] * 255);

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

    // --- PAN-SYNC: Record the anchor point for CSS transform tracking ---
    const center = map.getCenter();
    const centerPx = map.project([center.lng, center.lat]);
    fieldOriginRef.current = {
      lng: center.lng, lat: center.lat,
      px: centerPx.x, py: centerPx.y,
    };
    // Reset any CSS transform left from a prior drag
    canvas.style.transform = '';
    if (trailRef.current) trailRef.current.style.transform = '';
  }, [mapInstance, fieldRamp]);

  // --- PAN-SYNC: CSS-transform tracking during drag ---
  const onMapMove = useCallback(() => {
    const map = mapInstance;
    const origin = fieldOriginRef.current;
    if (!map || !origin) return;
    try {
      const cur = map.project([origin.lng, origin.lat]);
      const dx = cur.x - origin.px;
      const dy = cur.y - origin.py;
      const t = `translate(${dx}px, ${dy}px)`;
      if (fieldRef.current) fieldRef.current.style.transform = t;
      if (trailRef.current) trailRef.current.style.transform = t;
    } catch (_) { /* map not ready */ }
  }, [mapInstance]);

  // Render field on load + throttled on viewport change + pan sync
  useEffect(() => {
    const map = mapInstance;
    if (!map || !isActive || !gridLoaded) return;

    renderColorField();

    const onViewChange = () => {
      clearTimeout(fieldTimerRef.current);
      fieldTimerRef.current = setTimeout(renderColorField, FIELD_UPDATE_THROTTLE);
    };

    // `move` fires every frame during pan/zoom \u2014 used for CSS transform sync
    map.on('move', onMapMove);
    // `moveend`/`zoomend` fires after interaction \u2014 used for full re-render
    map.on('moveend', onViewChange);
    map.on('zoomend', onViewChange);
    window.addEventListener('resize', onViewChange);

    return () => {
      map.off('move', onMapMove);
      map.off('moveend', onViewChange);
      map.off('zoomend', onViewChange);
      window.removeEventListener('resize', onViewChange);
      clearTimeout(fieldTimerRef.current);
    };
  }, [mapInstance, isActive, gridLoaded, renderColorField, onMapMove]);

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

      frameCount++;
      if (frameCount % 30 === 0) updatePPD();

      // Fade existing trails
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.globalAlpha = 1.0;
      tCtx.fillStyle = 'rgba(0, 0, 0, 0.90)';
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';
      tCtx.globalAlpha = 1.0;

      if (!grid) { animRef.current = requestAnimationFrame(draw); return; }

      for (const p of particles) {
        if (p.lng === undefined || p.lat === undefined) {
          const geo = map.unproject([p.x, p.y]);
          p.lng = geo.lng;
          p.lat = geo.lat;
        }

        const wind = grid.interpolate(p.lat, p.lng);
        if (wind) {
          const [u, v, speed] = wind;
          const prevPos = map.project([p.lng, p.lat]);

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

          if (pixelDist < 0.5) continue;

          const entry = lookupColor(speed, ramp);

          // Glow halo for strong winds
          if (speed > 12) {
            tCtx.beginPath();
            tCtx.moveTo(prevPos.x, prevPos.y);
            tCtx.lineTo(newPos.x, newPos.y);
            tCtx.lineWidth = LINE_WIDTH * 3.5;
            tCtx.strokeStyle = `rgba(${entry[1]}, ${entry[2]}, ${entry[3]}, 0.10)`;
            tCtx.stroke();
          }

          // Core particle line
          tCtx.beginPath();
          tCtx.moveTo(prevPos.x, prevPos.y);
          tCtx.lineTo(newPos.x, newPos.y);
          tCtx.lineWidth = LINE_WIDTH;
          tCtx.strokeStyle = toRgba(entry);
          tCtx.stroke();
        } else {
          p.age = MAX_AGE + 1;
        }

        if (p.lng !== undefined) {
          const testPos = map.project([p.lng, p.lat]);
          if (p.age > MAX_AGE || testPos.x < -50 || testPos.x > w + 50
              || testPos.y < -50 || testPos.y > h + 50) {
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
    // Wrapper clips CSS blur bleed at viewport edges
    <div style={{
      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
      overflow: 'hidden', pointerEvents: 'none', zIndex: 4,
    }}>
      {/* Layer 1: Wind speed color field (blurred for smooth gradients) */}
      <canvas
        ref={fieldRef}
        style={{
          ...baseCanvasStyle,
          zIndex: 4,
          filter: `blur(${FIELD_BLUR_PX}px)`,
        }}
      />
      {/* Layer 2: Animated particle trails (directional accents) */}
      <canvas
        ref={trailRef}
        style={{
          ...baseCanvasStyle,
          zIndex: 5,
        }}
      />
    </div>
  );
};

export default WindParticleCanvas;
