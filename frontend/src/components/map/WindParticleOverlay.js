/**
 * WindParticleOverlay.js Canvas2D Wind Particle System (v3.12.3)
 *
 * Ventusky-style flowing wind trails using Canvas2D overlay.
 * Uses same proven architecture as MarineParticleCanvas:
 *   - Absolute-positioned canvas overlay on top of MapLibre
 *   - Trail persistence via destination-out compositing
 * - World-coordinate advection (lng/lat pixel projection)
 *   - CanvasAnimationCoordinator for single RAF loop
 *
 * WHY Canvas2D instead of WebGL custom layer:
 *   Ventusky uses 5 stacked Canvas2D layers. MapLibre's custom layer API
 *   has WebGL state conflicts that prevent reliable compositing. Canvas2D
 *   is proven to work (MarineParticleCanvas renders perfectly).
 */
import { useEffect, useRef } from 'react';
import { getAnimationCoordinator } from './CanvasAnimationCoordinator';

// --- SINGLETON GUARD ---
var ACTIVE_WIND_ENGINES = new Set();

// --- VISUAL TUNING (Ventusky-parity) ---
// Slow fade = long vapor trails. Must balance with particle count.
var TRAIL_FADE = 0.015;
var TRAIL_FADE_THROTTLED = 0.05;

// --- ZOOM-CALIBRATED SPEED TABLE ---
// Replaces single exponential with piecewise function tuned per zoom range.
// Each entry: { zoom, base } — interpolated linearly between breakpoints.
var SPEED_TABLE = [
  { zoom: 2,  base: 2200 },
  { zoom: 4,  base: 2800 },
  { zoom: 6,  base: 3200 },
  { zoom: 8,  base: 3800 },
  { zoom: 10, base: 4200 },
  { zoom: 14, base: 5000 },
];
function getCalibratedSpeedScale(zoom, dt) {
  // Find bracketing entries
  var lo = SPEED_TABLE[0], hi = SPEED_TABLE[SPEED_TABLE.length - 1];
  for (var i = 0; i < SPEED_TABLE.length - 1; i++) {
    if (zoom >= SPEED_TABLE[i].zoom && zoom <= SPEED_TABLE[i + 1].zoom) {
      lo = SPEED_TABLE[i];
      hi = SPEED_TABLE[i + 1];
      break;
    }
  }
  if (zoom < SPEED_TABLE[0].zoom) { lo = hi = SPEED_TABLE[0]; }
  if (zoom > SPEED_TABLE[SPEED_TABLE.length - 1].zoom) { lo = hi = SPEED_TABLE[SPEED_TABLE.length - 1]; }
  // Linearly interpolate base factor
  var t = (hi.zoom === lo.zoom) ? 0 : (zoom - lo.zoom) / (hi.zoom - lo.zoom);
  var base = lo.base + t * (hi.base - lo.base);
  // Apply Mercator decay from the interpolated zoom point
  var refZoom = lo.zoom + t * (hi.zoom - lo.zoom);
  return dt * base * Math.pow(0.55, zoom - refZoom);
}

/**
 * Bilinear interpolation on the wind grid O(1).
 * Grid is DENSE (extractWindAtOffset pads missing cells with zeros).
 *
 * NO strict bounds rejection grid points are snapped to .toFixed(2) but
 * bounds are raw viewport floats, so edge points can fall outside bounds.
 * Instead: CLAMP to grid domain (returns nearest-edge value for OOB queries).
 */
function interpolateWind(grid, lng, lat) {
  if (!grid?.vectors?.length || !grid.bounds) return { u: 0, v: 0, speed: 0 };
  var vectors = grid.vectors, bounds = grid.bounds;
  var cols = grid.cols, rows = grid.rows;
  if (!cols || !rows || cols < 2 || rows < 2) return { u: 0, v: 0, speed: 0 };

  var west = bounds.west, south = bounds.south;
  var east = bounds.east, north = bounds.north;
  var wrappedEast = east;
  if (wrappedEast < west) wrappedEast += 360;
  var lngSpan = wrappedEast - west, latSpan = north - south;
  if (lngSpan === 0 || latSpan === 0) return { u: 0, v: 0, speed: 0 };

  // Wrap query longitude to grid bounds coordinate space
  var center = (west + wrappedEast) / 2;
  var gLng = lng;
  while (gLng - center > 180) gLng -= 360;
  while (gLng - center < -180) gLng += 360;

  // Compute grid position CLAMP instead of reject
  var gx = ((gLng - west) / lngSpan) * (cols - 1);
  var gy = ((lat - south) / latSpan) * (rows - 1);
  gx = Math.max(0, Math.min(cols - 1.001, gx));
  gy = Math.max(0, Math.min(rows - 1.001, gy));

  var xi = Math.floor(gx), yi = Math.floor(gy);
  var fx = gx - xi, fy = gy - yi;
  var i00 = yi * cols + xi;

  // Bounds safety
  if (i00 + cols + 1 >= vectors.length) {
    var near = vectors[Math.min(i00, vectors.length - 1)];
    return near ? { u: near.u, v: near.v, speed: near.speed } : { u: 0, v: 0, speed: 0 };
  }

  var p00 = vectors[i00], p10 = vectors[i00 + 1];
  var p01 = vectors[i00 + cols], p11 = vectors[i00 + cols + 1];

  var u = (1 - fx) * (1 - fy) * p00.u + fx * (1 - fy) * p10.u +
          (1 - fx) * fy * p01.u + fx * fy * p11.u;
  var v = (1 - fx) * (1 - fy) * p00.v + fx * (1 - fy) * p10.v +
          (1 - fx) * fy * p01.v + fx * fy * p11.v;
  return { u: u, v: v, speed: Math.sqrt(u * u + v * v) };
}

// Simple hash-based noise to break grid-locked particle lanes
function noise2D(x, y) {
  var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1; // range [-1, 1]
}

/**
 * Wraps a longitude relative to the map's current center longitude to ensure it maps
 * correctly in the viewport's continuous rendering space (fixes the Pacific Ocean split).
 */
function getRenderLng(lng, centerLng) {
  var rLng = lng;
  while (rLng - centerLng > 180) rLng -= 360;
  while (rLng - centerLng < -180) rLng += 360;
  return rLng;
}

/**
 * Ventusky-style wind color: white/light trails with speed-based brightness.
 * Higher wind speeds = brighter, more opaque white.
 * Low speeds = faint, ghostly trails.
 */
function getWindColor(speed, alpha, theme) {
  var intensity = Math.min(1.0, speed / 30);
  var r, g, b;
  if (theme === 'dark') {
    r = Math.round(147 - intensity * 141);
    g = Math.round(51 + intensity * 131);
    b = Math.round(234 - intensity * 22);
  } else if (theme === 'beach') {
    r = Math.round(249 + intensity * 6);
    g = Math.round(115 + intensity * 128);
    b = Math.round(22 + intensity * 177);
  } else {
    r = Math.round(148 - intensity * 97);
    g = Math.round(163 - intensity * 98);
    b = Math.round(184 - intensity * 99);
  }
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(3) + ')';
}

/** Spawn particle at random viewport position with optional grid-stratified placement */
function spawnParticle(mapInstance, preAge, stratifyIdx, stratifyTotal) {
  var mb = mapInstance.getBounds();
  var west = mb.getWest(), east = mb.getEast();
  var south = Math.max(-85, mb.getSouth()), north = Math.min(85, mb.getNorth());
  var lngWidth = east - west;
  if (lngWidth < 0) lngWidth += 360;

  // Pad boundaries by 50% on all sides to disperse particles wider
  var padLng = lngWidth * 0.5;
  var padLat = (north - south) * 0.5;
  west -= padLng;
  east += padLng;
  south = Math.max(-85, south - padLat);
  north = Math.min(85, north + padLat);
  lngWidth = east - west;
  if (lngWidth < 0) lngWidth += 360;

  var lng, lat;
  if (stratifyIdx != null && stratifyTotal > 0) {
    var cols = Math.ceil(Math.sqrt(stratifyTotal * Math.max(1, lngWidth) / Math.max(1, north - south)));
    var rows = Math.ceil(stratifyTotal / cols);
    var ci = stratifyIdx % cols, ri = Math.floor(stratifyIdx / cols) % rows;
    var cellW = lngWidth / cols, cellH = (north - south) / rows;
    lng = west + (ci + Math.random()) * cellW;
    lat = south + (ri + Math.random()) * cellH;
  } else {
    lng = west + Math.random() * lngWidth;
    lat = south + Math.random() * (north - south);
  }
  var maxAge = 3.0 + Math.random() * 6.0;
  var jitter = 0.02; // Jitter to break cell alignment
  lng += (Math.random() - 0.5) * jitter * 2;
  lat += (Math.random() - 0.5) * jitter * 2;

  // Wrap query longitude to continuous [-180, 180] range
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;

  return { lng: lng, lat: lat, prevLng: lng, prevLat: lat,
    age: preAge ? Math.random() * maxAge : 0, maxAge: maxAge,
    noiseSeed: Math.random() * 100 };
}

export function WindParticleOverlay({ mapInstance, active, data, id, theme }) {
  var layerId = id || 'wind-particle-overlay';
  var canvasRef = useRef(null);
  var dataRef = useRef(null);
  var particlesRef = useRef([]);
  var activeRef = useRef(active);
  var themeRef = useRef(theme);
  var debugRef = useRef({ logged: false, drawCount: 0 });

  useEffect(function() { activeRef.current = active; }, [active]);
  useEffect(function() { themeRef.current = theme; }, [theme]);
  useEffect(function() {
    if (data?.vectors?.length && data.renderable !== false) {
      dataRef.current = data;
      debugRef.current.logged = false; // Reset debug on new data
    } else {
      dataRef.current = null;
    }
  }, [data]);

  useEffect(function() {
    if (!mapInstance || !canvasRef.current) return;
    if (ACTIVE_WIND_ENGINES.has(layerId)) {
      console.error('[WindOverlay] DUPLICATE: ' + layerId);
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

    var isMobile = window.innerWidth < 768;
    var getCount = function() {
      var zoom = mapInstance.getZoom();
      var base = isMobile ? 1800 : 3800;
      if (zoom < 3) return Math.round(base * 0.3);
      if (zoom < 5) return Math.round(base * 0.5);
      if (zoom < 7) return Math.round(base * 0.75);
      return base;
    };
    var PARTICLE_COUNT = getCount();
    console.log('[WindOverlay] Spawning ' + PARTICLE_COUNT + ' particles');

    var particles = [];
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(spawnParticle(mapInstance, true, i, PARTICLE_COUNT));
    }
    particlesRef.current = particles;
    var wasActive = false;
    var lastDataId = null;
    var lastHourOffset = null;
    var lastBoundsHash = null;
    var warmedUp = false; // Track if we've done the initial warm-up
    var coordinator = getAnimationCoordinator();
    coordinator.init(mapInstance);

    var windTick = function(now, dt, coordState) {
      if (!activeRef.current) {
        if (wasActive) { ctx.clearRect(0, 0, cw, ch); wasActive = false; }
        return;
      }
      var grid = dataRef.current;
      if (!grid?.vectors?.length) return;
      wasActive = true;

      // Redistribute particles on MODEL change (full respawn) or
      // viewport grid bounds change (soft respawn & warm-up)
      var sourceModel = grid.source || 'GFS';
      var currentOffset = grid.hourOffset;
      var currentBoundsHash = grid.bounds ? `${grid.bounds.west.toFixed(2)}:${grid.bounds.east.toFixed(2)}` : '';

      if (lastDataId !== null && lastDataId !== sourceModel) {
        // Full respawn on model switch
        var pts2 = particlesRef.current;
        for (var ri = 0; ri < pts2.length; ri++) {
          pts2[ri] = spawnParticle(mapInstance, true, ri, pts2.length);
        }
        ctx.clearRect(0, 0, cw, ch);
        warmedUp = false;
      } else if (lastHourOffset !== null && lastHourOffset !== currentOffset) {
        // Soft redistribute on timeline scrub — expire 30% of particles
        // so they naturally respawn over ~1s, no flash
        var pts2b = particlesRef.current;
        var expireCount = Math.round(pts2b.length * 0.3);
        for (var ri2 = 0; ri2 < expireCount; ri2++) {
          var idx = Math.floor(Math.random() * pts2b.length);
          pts2b[idx].age = pts2b[idx].maxAge; // will respawn next frame
        }
      }
      lastDataId = sourceModel;
      lastHourOffset = currentOffset;
      lastBoundsHash = currentBoundsHash;

      var zoom = mapInstance.getZoom();
      var centerLng = mapInstance.getCenter().lng;

      // Spread the 15 warm-up steps over 5 frames (3 steps per frame) to prevent requestAnimationFrame violations
      if (warmedUp === false || (typeof warmedUp === 'number' && warmedUp < 15)) {
        var currentStep = typeof warmedUp === 'number' ? warmedUp : 0;
        var stepsToRun = 3;
        var pts3 = particlesRef.current;
        var DEG_PER_M = 1 / 111320;
        var wmb = mapInstance.getBounds();
        var wBW = getRenderLng(wmb.getWest(), centerLng);
        var wBE = getRenderLng(wmb.getEast(), centerLng);
        var wBS = wmb.getSouth(), wBN = wmb.getNorth();
        for (var step = 0; step < stepsToRun; step++) {
          for (var wi = 0; wi < pts3.length; wi++) {
            var wp = pts3[wi];
            var wWind = interpolateWind(grid, wp.lng, wp.lat);
            var wScale = getCalibratedSpeedScale(zoom, 0.016);
            var wNoiseFreqScale = 5 * Math.pow(1.4, zoom - 3);
            var wTurbulence = 0.02 + 0.06 * Math.min(1.0, wWind.speed / 15);
            var wNs = wp.noiseSeed || 0;
            var wNoiseU = noise2D(wp.lng * wNoiseFreqScale + wNs, wp.lat * wNoiseFreqScale) * wTurbulence;
            var wNoiseV = noise2D(wp.lat * wNoiseFreqScale + wNs, wp.lng * wNoiseFreqScale + wNs) * wTurbulence;

            if (wWind.speed > 0.3) {
              var wLatRad = wp.lat * Math.PI / 180;
              var wMerc = Math.max(0.1, Math.cos(wLatRad));
              wp.lng += (wWind.u + wNoiseU * wWind.speed) * DEG_PER_M / wMerc * wScale;
              wp.lat += (wWind.v + wNoiseV * wWind.speed) * DEG_PER_M * wScale;
            } else {
              wp.lng += wNoiseU * 0.005 * wScale;
              wp.lat += wNoiseV * 0.005 * wScale;
            }
            wp.prevLng = wp.lng;
            wp.prevLat = wp.lat;
            wp.lat = Math.max(-85, Math.min(85, wp.lat));
            while (wp.lng > 180) wp.lng -= 360;
            while (wp.lng < -180) wp.lng += 360;
          }
        }
        currentStep += stepsToRun;
        if (currentStep >= 15) {
          warmedUp = true;
          // Respawn particles that warm-up blew outside viewport 
          // prevents density clustering on the downwind side
          var respawned = 0;
          for (var ri2 = 0; ri2 < pts3.length; ri2++) {
            var rp = pts3[ri2];
            var rrpLng = getRenderLng(rp.lng, centerLng);
            if (rrpLng < wBW - 2 || rrpLng > wBE + 2 || rp.lat < wBS - 2 || rp.lat > wBN + 2) {
              pts3[ri2] = spawnParticle(mapInstance, true, ri2, pts3.length);
              respawned++;
            }
          }
          console.log('[WindOverlay] Warm-up complete: 15 steps (spread), ' + respawned + ' respawned');
        } else {
          warmedUp = currentStep;
        }
      }

      var isThrottled = coordState === 2;

      // --- DEBUG: Log data info on first frame ---
      if (!debugRef.current.logged) {
        debugRef.current.logged = true;
        var sampleV = grid.vectors[0];
        var testWind = interpolateWind(grid, sampleV?.lng || sampleV?.monotonicLng || 0, sampleV?.lat || 0);
        console.log('[WindOverlay] Grid: ' + grid.vectors.length + ' vecs, ' +
          'cols=' + grid.cols + ', rows=' + grid.rows +
          ', expected=' + (grid.cols * grid.rows) +
          ', bounds=' + JSON.stringify(grid.bounds) +
          ', sample_v0={u:' + (sampleV?.u?.toFixed(2)) + ', v:' + (sampleV?.v?.toFixed(2)) + ', speed:' + (sampleV?.speed?.toFixed(1)) + '}' +
          ', interp_test={speed:' + testWind.speed.toFixed(2) + '}');
      }

      // Trail fade
      var fade = isThrottled ? TRAIL_FADE_THROTTLED : TRAIL_FADE;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, ' + fade + ')';
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';

      var mb = mapInstance.getBounds();
      var bw = getRenderLng(mb.getWest(), centerLng);
      var be = getRenderLng(mb.getEast(), centerLng);
      var bs = mb.getSouth(), bn = mb.getNorth();
      var stride = isThrottled ? 3 : 1;
      var pts = particlesRef.current;
      var DEG_PER_METER = 1 / 111320;
      var drawnThisFrame = 0;

      var speedScale = getCalibratedSpeedScale(zoom, dt);
      var noiseFreqScale = 5 * Math.pow(1.4, zoom - 3);

      for (var i = 0; i < pts.length; i += stride) {
        var p = pts[i];
        p.age += dt;

        // Store previous position for line drawing
        p.prevLng = p.lng;
        p.prevLat = p.lat;

        // Interpolate wind at current position
        var wind = interpolateWind(grid, p.lng, p.lat);

        // Turbulence noise to create beautiful micro-swirls
        var turbulence = 0.02 + 0.06 * Math.min(1.0, wind.speed / 15);
        var ns = p.noiseSeed || 0;
        var noiseU = noise2D(p.lng * noiseFreqScale + now * 0.001 + ns, p.lat * noiseFreqScale) * turbulence;
        var noiseV = noise2D(p.lat * noiseFreqScale + now * 0.001 + ns, p.lng * noiseFreqScale + ns) * turbulence;

        // World-coordinate advection AMPLIFIED for visual effect
        // Real wind: 0.01px/frame. Amplify for Ventusky-style visible trails.
        if (wind.speed > 0.3) {
          var latRad = p.lat * Math.PI / 180;
          var mercCorr = Math.max(0.1, Math.cos(latRad));
          p.lng += (wind.u + noiseU * wind.speed) * DEG_PER_METER / mercCorr * speedScale;
          p.lat += (wind.v + noiseV * wind.speed) * DEG_PER_METER * speedScale;
        } else {
          // Continuous lazy drift in calm areas instead of shaky jitter
          p.lng += noiseU * 0.005 * speedScale;
          p.lat += noiseV * 0.005 * speedScale;
        }

        // Sanity clamp
        if (isNaN(p.lat) || isNaN(p.lng)) { pts[i] = spawnParticle(mapInstance, false); continue; }
        p.lat = Math.max(-85, Math.min(85, p.lat));
        while (p.lng > 180) p.lng -= 360;
        while (p.lng < -180) p.lng += 360;

        var rLng = getRenderLng(p.lng, centerLng);
        var inViewPadded = (rLng >= bw - 5 && rLng <= be + 5 && p.lat >= bs - 5 && p.lat <= bn + 5);
        if (p.age > p.maxAge || !inViewPadded) {
          pts[i] = spawnParticle(mapInstance, false); continue;
        }
        // Skip drawing if outside visible bounds
        var inViewStrict = (rLng >= bw && rLng <= be && p.lat >= bs && p.lat <= bn);
        if (!inViewStrict) continue;

        // --- DRAW WIND TRAIL SEGMENT ---
        try {
          var rPrevLng = getRenderLng(p.prevLng, centerLng);
          var curr = mapInstance.project([rLng, p.lat]);
          var prev = mapInstance.project([rPrevLng, p.prevLat]);
          if (!curr || !prev || !Number.isFinite(curr.x) || !Number.isFinite(prev.x)) continue;

          // Skip truly zero movements
          var dx = curr.x - prev.x, dy = curr.y - prev.y;
          var segLen = Math.sqrt(dx * dx + dy * dy);
          if (segLen < 0.05) continue;
          // Clamp extreme jumps (projection artifacts)
          if (segLen > 100) { pts[i] = spawnParticle(mapInstance, false); continue; }

          // Age-based alpha smooth fade-in and fade-out
          var ageRatio = p.age / p.maxAge;
          var fadeIn = Math.min(1, p.age / 0.3);
          var fadeOut = 1 - ageRatio * ageRatio;
          var alpha = fadeIn * fadeOut;

          // Speed-based emphasis faster wind = more visible
          var speedFactor = Math.min(1, wind.speed / 20);
          alpha *= (0.08 + speedFactor * 0.35);
          if (alpha < 0.01) continue;

          // Dynamic theme-aware color (beach mode opacity is scaled by 0.90 for extra elegance)
          var finalAlpha = themeRef.current === 'beach' ? alpha * 0.90 : alpha;
          ctx.strokeStyle = getWindColor(wind.speed, finalAlpha, themeRef.current);

          // Speed-aware dynamic line width (0.7px - 2.0px) for premium look
          ctx.lineWidth = Math.min(2.0, 0.7 + wind.speed * 0.025);
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.stroke();
          drawnThisFrame++;
        } catch (e) {
          pts[i] = spawnParticle(mapInstance, false);
        }
      }

      // Debug: log draw count once
      if (drawnThisFrame > 0 && debugRef.current.drawCount < 3) {
        debugRef.current.drawCount++;
        console.log('[WindOverlay] Drew ' + drawnThisFrame + ' segments this frame');
      }
    };

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
