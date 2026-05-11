import React, { useEffect, useRef, useState } from 'react';

/**
 * WindParticleCanvas — True Global Animated Wind Overlay for MapLibre.
 *
 * Architecture:
 * - Fetches a static, 1-degree resolution global wind JSON to bypass Open-Meteo point API rate limits.
 * - This provides TRUE WORLDWIDE coverage instantly.
 * - Fading particle trails show wind flow direction via motion.
 * - Particles are rendered extremely subtly so landmasses remain highly visible.
 */

const PARTICLE_COUNT = 3500; 
const MAX_AGE = 100;
const FADE_ALPHA = 0.96; // Slower fade for smooth, elegant trails
const LINE_WIDTH = 0.8; // Very thin lines for subtlety
const SPEED_FACTOR = 3.0;
const GLOBAL_WIND_URL = 'https://sakitam.oss-cn-beijing.aliyuncs.com/codepen/wind-layer/json/wind.json';

// Subtle, transparent color ramp to blend seamlessly with the map
const COLOR_STOPS = [
  [0, 'rgba(50, 136, 189, 0.25)'],
  [4, 'rgba(102, 194, 165, 0.35)'],
  [8, 'rgba(171, 221, 164, 0.45)'],
  [12, 'rgba(230, 245, 152, 0.5)'],
  [16, 'rgba(255, 255, 191, 0.55)'],
  [20, 'rgba(254, 224, 139, 0.6)'],
  [25, 'rgba(253, 174, 97, 0.65)'],
  [30, 'rgba(244, 109, 67, 0.7)'],
  [40, 'rgba(213, 62, 79, 0.8)']
];

function getWindColor(speed) {
  for (let i = COLOR_STOPS.length - 1; i >= 0; i--) {
    if (speed >= COLOR_STOPS[i][0]) return COLOR_STOPS[i][1];
  }
  return COLOR_STOPS[0][1];
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
    // The JSON spans [-180.5, 179.5]. Only wrap if outside the grid completely.
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

  // Render loop
  useEffect(() => {
    const map = mapInstance;
    const trailCanvas = trailRef.current;
    if (!map || !trailCanvas || !isActive || !gridLoaded) return;

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
      const zoom = map.getZoom();
      const zoomScale = SPEED_FACTOR * Math.pow(zoom / 7, 0.8);
      const w = trailCanvas.width;
      const h = trailCanvas.height;
      const grid = windGridRef.current;

      // Fade existing trails slightly more slowly to build up the color layer
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.fillStyle = `rgba(0, 0, 0, 0.90)`; 
      tCtx.fillRect(0, 0, w, h);
      tCtx.globalCompositeOperation = 'source-over';

      if (grid) {
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
            
            // Geographic step (adjust based on speed and zoom scale)
            // Convert u, v (m/s) to approximate degrees. Very rough approximation.
            const degreeScale = 0.005 * zoomScale;
            p.lng += u * degreeScale;
            p.lat += v * degreeScale;
            p.age++;
            
            // Get new pixel position
            const newPos = map.project([p.lng, p.lat]);
            
            const angle = Math.atan2(newPos.y - prevPos.y, newPos.x - prevPos.x); 
            const arrowSize = 3 * (1 + zoomScale * 0.1); 
            
            tCtx.beginPath();
            tCtx.moveTo(prevPos.x, prevPos.y);
            tCtx.lineTo(newPos.x, newPos.y);
            
            // Draw subtle arrowhead
            tCtx.lineTo(newPos.x - arrowSize * Math.cos(angle - Math.PI / 6), newPos.y - arrowSize * Math.sin(angle - Math.PI / 6));
            tCtx.moveTo(newPos.x, newPos.y);
            tCtx.lineTo(newPos.x - arrowSize * Math.cos(angle + Math.PI / 6), newPos.y - arrowSize * Math.sin(angle + Math.PI / 6));
            
            tCtx.lineWidth = LINE_WIDTH;
            tCtx.strokeStyle = getWindColor(speed);
            tCtx.stroke();
          } else {
            p.age = MAX_AGE + 1; // Kill if outside valid data
          }
          
          // Check bounds using projected pixel coordinates
          const testPos = map.project([p.lng, p.lat]);
          if (p.age > MAX_AGE || testPos.x < 0 || testPos.x > w || testPos.y < 0 || testPos.y > h) {
            Object.assign(p, seedParticle());
            p.lng = undefined;
            p.lat = undefined;
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
  }, [isActive, mapInstance, gridLoaded]);

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
