/**
 * WindParticleOverlay.js — Canvas2D Wind Particle System (v3.12.3)
 *
 * Ventusky-style flowing wind trails using Canvas2D overlay.
 * Uses same proven architecture as MarineParticleCanvas:
 *   - Absolute-positioned canvas overlay on top of MapLibre
 *   - Trail persistence via destination-out compositing
 *   - World-coordinate advection (lng/lat → pixel projection)
 *   - CanvasAnimationCoordinator for single RAF loop
 *
 * WHY Canvas2D instead of WebGL custom layer:
 *   Ventusky uses 5 stacked Canvas2D layers. MapLibre's custom layer API
 *   has WebGL state conflicts that prevent reliable compositing. Canvas2D
 *   is proven to work (MarineParticleCanvas renders perfectly).
 *
 * Architecture:
 *   - SOLE AUTHORITY for wind particle visualization
 *   - WebGLWindLayer kept for potential future WebGL compute (data-only)
 *   - Registered with CanvasAnimationCoordinator (shared RAF)
 */
import { useEffect, useRef } from 'react';
import { getAnimationCoordinator } from './CanvasAnimationCoordinator';
import { sampleColorRamp } from './WindColorRamp';

// --- SINGLETON GUARD ---
var ACTIVE_WIND_ENGINES = new Set();

// --- VISUAL TUNING (Ventusky-parity) ---
var TRAIL_FADE = 0.012;          // Very slow fade → long flowing trails
var TRAIL_FADE_THROTTLED = 0.04; // Faster fade when throttled

/**
 * Bilinear interpolation on wind grid.
 * Returns { u, v, speed } at (lng, lat).
 */
function interpolateWind(grid, lng, lat) {
  if (!grid?.vectors?.length) return { u: 0, v: 0, speed: 0 };
  var vectors = grid.vectors, bounds = grid.bounds, cols = grid.cols, rows = grid.rows;
  var west = bounds.west, south = bounds.south, east = bounds.east, north = bounds.north;
  if (!cols || !rows || vectors.length !== cols * rows) return { u: 0, v: 0, speed: 0 };

  var nLng = lng;
  while (nLng > 180) nLng -= 360;
  while (nLng < -180) nLng += 360;

  var gx = Math.max(0, Math.min(cols - 1, ((nLng - west) / (east - west)) * (cols - 1)));
  var gy = Math.max(0, Math.min(rows - 1, ((lat - south) / (north - south)) * (rows - 1)));
  var xi = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  var yi = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  var fx = gx - xi, fy = gy - yi;
  var idx = function(y, x) { return y * cols + x; };
  var p00 = vectors[idx(yi, xi)], p10 = vectors[idx(yi, xi + 1)];
  var p01 = vectors[idx(yi + 1, xi)], p11 = vectors[idx(yi + 1, xi + 1)];
  if (!p00 || !p10 || !p01 || !p11) return { u: 0, v: 0, speed: 0 };

  var u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
          (1 - fx) * fy * p01.u + fx * fy * p11.u;
  var v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
          (1 - fx) * fy * p01.v + fx * fy * p11.v;
  var speed = Math.sqrt(u * u + v * v);
  return { u: u, v: v, speed: speed };
}

/**
 * Get RGBA color for wind speed using the scientific color ramp.
 * Returns CSS rgba() string.
 */
function getWindColor(speed, alpha) {
  var color = sampleColorRamp(speed);
  if (!color) return 'rgba(150, 180, 220, ' + alpha + ')';
  return 'rgba(' +
    Math.round(color[0] * 255) + ', ' +
    Math.round(color[1] * 255) + ', ' +
    Math.round(color[2] * 255) + ', ' +
    (alpha * color[3]).toFixed(3) + ')';
}

/**
 * Spawn a wind particle at a random position within viewport bounds.
 */
function spawnParticle(mapInstance, preAge) {
  var mb = mapInstance.getBounds();
  var west = mb.getWest(), east = mb.getEast();
  var south = Math.max(-85, mb.getSouth()), north = Math.min(85, mb.getNorth());
  var lng = west + Math.random() * (east - west);
  var lat = south + Math.random() * (north - south);
  var maxAge = 4.0 + Math.random() * 8.0; // 4-12 seconds
  return {
    lng: lng, lat: lat,
    prevLng: lng, prevLat: lat,
    age: preAge ? Math.random() * maxAge * 0.6 : 0,
    maxAge: maxAge
  };
}

export function WindParticleOverlay({ mapInstance, active, data, id }) {
  var layerId = id || 'wind-particle-overlay';
  var canvasRef = useRef(null);
  var dataRef = useRef(null);
  var particlesRef = useRef([]);
  var activeRef = useRef(active);

  useEffect(function() { activeRef.current = active; }, [active]);
  useEffect(function() { if (data?.vectors?.length) dataRef.current = data; }, [data]);

  useEffect(function() {
    if (!mapInstance || !canvasRef.current) return;
    if (ACTIVE_WIND_ENGINES.has(layerId)) {
      console.error('[WindOverlay] DUPLICATE: ' + layerId + ' already running.');
      return;
    }
    ACTIVE_WIND_ENGINES.add(layerId);
    console.log('[WindOverlay] === STARTING WIND PARTICLE ENGINE ===');

    var canvas = canvasRef.current;
    var ctx = canvas.getContext('2d', { willReadFrequently: false });
    var dpr = window.devicePixelRatio || 1;

    var resize = function() {
      var rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return null;
      var w = Math.round(rect.width), h = Math.round(rect.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: w, h: h };
    };
    var dims = resize() || { w: 800, h: 600 };
    var cw = dims.w, ch = dims.h;

    // Particle density — Ventusky uses very dense fields
    var isMobile = window.innerWidth < 768;
    var getCount = function() {
      var zoom = mapInstance.getZoom();
      // Higher density at all zoom levels for visible flowing streams
      var base = isMobile ? 3000 : 8000;
      if (zoom < 3) return Math.round(base * 0.4);
      if (zoom < 5) return Math.round(base * 0.7);
      if (zoom < 7) return base;
      return Math.round(base * 1.2);
    };
    var PARTICLE_COUNT = getCount();
    console.log('[WindOverlay] Spawning ' + PARTICLE_COUNT + ' particles (zoom: ' + mapInstance.getZoom().toFixed(1) + ')');

    // Initialize particle pool
    var particles = [];
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(spawnParticle(mapInstance, true));
    }
    particlesRef.current = particles;

    var wasActive = false;
    var coordinator = getAnimationCoordinator();
    coordinator.init(mapInstance);

    /**
     * Per-frame tick — called by CanvasAnimationCoordinator at 60fps.
     * Implements Ventusky-style trail persistence via destination-out compositing.
     */
    var windTick = function(now, dt, coordState) {
      if (!activeRef.current) {
        if (wasActive) { ctx.clearRect(0, 0, cw, ch); wasActive = false; }
        return;
      }
      var grid = dataRef.current;
      if (!grid?.vectors?.length) return;
      wasActive = true;

      var isThrottled = coordState === 2;

      // --- TRAIL FADE (Ventusky technique) ---
      // Instead of clearing: draw semi-transparent black over the entire canvas.
      // This dims previous frames gradually → creates flowing trail effect.
      var fade = isThrottled ? TRAIL_FADE_THROTTLED : TRAIL_FADE;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, ' + fade + ')';
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';

      var mb = mapInstance.getBounds();
      var bw = mb.getWest(), be = mb.getEast(), bs = mb.getSouth(), bn = mb.getNorth();
      var stride = isThrottled ? 3 : 1;
      var pts = particlesRef.current;
      var DEG_PER_METER = 1 / 111320;

      for (var i = 0; i < pts.length; i += stride) {
        var p = pts[i];
        p.age += dt;

        // Store previous position for line drawing
        p.prevLng = p.lng;
        p.prevLat = p.lat;

        // Interpolate wind at current position
        var wind = interpolateWind(grid, p.lng, p.lat);

        // World-coordinate advection
        if (wind.speed > 0.01 && Number.isFinite(wind.u) && Number.isFinite(wind.v)) {
          var latRad = p.lat * Math.PI / 180;
          var mercCorr = Math.max(0.1, Math.cos(latRad));
          // Atmospheric flow speed — faster than marine drift
          var speedScale = dt * 80;
          p.lng += wind.u * DEG_PER_METER / mercCorr * speedScale;
          p.lat += wind.v * DEG_PER_METER * speedScale;
        } else {
          p.age = p.maxAge + 1; // Kill stalled particles
        }

        // Sanity clamp
        if (isNaN(p.lat) || isNaN(p.lng)) { pts[i] = spawnParticle(mapInstance, false); continue; }
        p.lat = Math.max(-85, Math.min(85, p.lat));
        while (p.lng > 180) p.lng -= 360;
        while (p.lng < -180) p.lng += 360;

        // Respawn if too old or out of viewport
        if (p.age > p.maxAge || p.lng < bw - 5 || p.lng > be + 5 || p.lat < bs - 5 || p.lat > bn + 5) {
          pts[i] = spawnParticle(mapInstance, false); continue;
        }
        // Skip drawing if outside visible bounds (don't kill)
        if (p.lng < bw || p.lng > be || p.lat < bs || p.lat > bn) continue;

        // --- DRAW WIND TRAIL SEGMENT ---
        try {
          var curr = mapInstance.project([p.lng, p.lat]);
          var prev = mapInstance.project([p.prevLng, p.prevLat]);
          if (!curr || !prev || !Number.isFinite(curr.x) || !Number.isFinite(prev.x)) continue;

          // Skip tiny movements (particle hasn't moved enough for visible trail)
          var dx = curr.x - prev.x, dy = curr.y - prev.y;
          var segLen = Math.sqrt(dx * dx + dy * dy);
          if (segLen < 0.5) continue;

          // Age-based alpha: fade in quickly, fade out slowly
          var ageRatio = p.age / p.maxAge;
          var fadeIn = Math.min(1, p.age / 0.5); // 0.5s fade in
          var fadeOut = 1 - Math.pow(ageRatio, 2.0);
          var alpha = fadeIn * fadeOut;

          // Speed-based emphasis — fast wind is brighter
          var speedAlpha = 0.3 + Math.min(0.7, wind.speed / 25);
          alpha *= speedAlpha;
          alpha = Math.min(0.85, alpha);
          if (alpha < 0.02) continue;

          // Color from scientific ramp
          ctx.strokeStyle = getWindColor(wind.speed, alpha);

          // Line width scales with speed — fast wind = thicker trails
          var zoomScale = Math.max(0.5, Math.min(2.0, mapInstance.getZoom() / 6));
          ctx.lineWidth = Math.max(1, (1.0 + wind.speed * 0.08) * zoomScale);
          ctx.lineCap = 'round';

          // Draw trail segment from previous to current position
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.stroke();
        } catch (e) {
          pts[i] = spawnParticle(mapInstance, false);
        }
      }
    };

    // Register with shared RAF coordinator
    coordinator.register(layerId, windTick, function() { return activeRef.current; });

    var onResize = function() { var d = resize(); if (d) { cw = d.w; ch = d.h; } };
    window.addEventListener('resize', onResize);

    return function() {
      console.log('[WindOverlay] === UNMOUNTING ===');
      ACTIVE_WIND_ENGINES.delete(layerId);
      coordinator.unregister(layerId);
      window.removeEventListener('resize', onResize);
    };
  }, [mapInstance]);

  return (
    <canvas
      id={layerId}
      ref={canvasRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 6,
        opacity: active ? 1 : 0,
        transition: 'opacity 0.3s ease'
      }}
    />
  );
}

export default WindParticleOverlay;
