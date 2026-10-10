/**
 * Wind bench page (bundled by ../build.js with the app's own webpack; never part of the app).
 *
 * Renders the REAL WebGLWindEngine (the `wind-bench-engine` alias points at the working tree or an
 * extracted git ref) on a synthetic field, then scans its trail buffer. API for the Node runner and
 * the console: window.__WIND_BENCH__.run(configs) -> results, .runOne(config) -> result.
 */
const EngineModule = require('wind-bench-engine');
const { benchGrids, sampleSpeed } = require('../field');
const { makeCamera } = require('../camera');
const { mulberry32, blockStats, scanBlocks } = require('../scanner');
const { BASEMAP, ALL_VARIANTS, buildMatrix, controlConfigs } = require('../matrix');
const { formatTable, figureText, configKey } = require('../report');
const { mergeSeeds, controlAcrossSeeds } = require('../replicates');
const { KM_PER_DEG, thresholdRamp, eyeGeometry } = require('../eye');

const Engine = EngineModule.default || EngineModule.WebGLWindEngine || EngineModule;
const params = new URLSearchParams(window.location.search);
const CSS_W = 897, CSS_H = 914;                       // the owner's map pane on 2026-10-08
const DPR = Number(params.get('dpr')) || 2;           // fixed, so results do not depend on the machine
const THUMB_W = 448, THUMB_H = 457;
const FRAME_MS = 1000 / 60;
const realNow = performance.now.bind(performance);

const canvas = document.getElementById('gl');
canvas.width = Math.round(CSS_W * DPR);
canvas.height = Math.round(CSS_H * DPR);
const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
const GRIDS = benchGrids();
const statusEl = document.getElementById('status');
const sheetEl = document.getElementById('sheet');
const setStatus = (text) => { statusEl.textContent = text; };

function renderer() {
  if (!gl) return 'no WebGL2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

function clearLevers() {
  Object.keys(window).filter((k) => k.startsWith('__RAW_')).forEach((k) => { delete window[k]; });
}

// Seeded by view and theme, NOT variant: both arms of a pair start from the same random stream
// (paired rows), so two variants whose levers the engine ignores must give identical numbers.
function seedOf(cfg) {
  let h = 2166136261;
  for (const ch of `${cfg.view}/${cfg.theme}/${cfg.res}/${cfg.frames}/${cfg.seed || 0}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function nextFrame(fn) {
  return new Promise((resolve, reject) => requestAnimationFrame((ts) => {
    try { fn(); resolve(ts); } catch (e) { reject(e); }
  }));
}

/** Speed (kn) under each block centre: the view's regional grid first, then the world grid. */
function blockSpeeds(cam, bw, bh, B, regional) {
  const speed = new Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const ll = cam.unproject((bx + 0.5) * B, (by + 0.5) * B);
      const own = regional ? sampleSpeed(regional, ll.lng, ll.lat) : null;
      speed[by * bw + bx] = own != null ? own : sampleSpeed(GRIDS.world, ((ll.lng + 540) % 360) - 180, ll.lat);
    }
  }
  return speed;
}

function readTrail(engine) {
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const pixels = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, engine.screenA.fbo);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { pixels, W, H };
}

async function runOne(cfg) {
  const variant = ALL_VARIANTS[cfg.variant];
  if (!variant) throw new Error('unknown variant ' + cfg.variant);
  const realRandom = Math.random;
  clearLevers();
  Object.assign(window, variant.levers);
  Math.random = mulberry32(seedOf(cfg));        // same view, same particles
  // The engine scales each step by elapsed performance.now() (frameTimeScale), so rAF jitter would
  // make every run differ. A virtual clock advances exactly one 60 Hz frame per draw instead;
  // `clock: 'real'` keeps wall time (to study jitter itself).
  let virtualMs = 0;
  if (cfg.clock !== 'real') performance.now = () => virtualMs;
  const engine = new Engine();
  try {
    engine.particleRes = cfg.res;
    engine.init(gl);
    engine.setWindData(gl, GRIDS.world);         // the app always has the world grid first
    const regional = cfg.grid === 'world' ? null : GRIDS[cfg.grid];
    if (regional) engine.setWindData(gl, regional);
    const fineActive = regional ? !!engine._windFine : null;
    const cam = makeCamera(cfg.lng, cfg.lat, cfg.z, CSS_W, CSS_H);
    const bm = BASEMAP[cfg.theme];
    let cpu = 0;
    const draw = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(bm[0], bm[1], bm[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      virtualMs += FRAME_MS;
      const t0 = realNow();
      engine.render(gl, cam.matrix, canvas.width, canvas.height, cfg.z, cfg.theme, null, cam.viewBounds);
      cpu += realNow() - t0;
    };
    const stamps = [];
    for (let i = 0; i < cfg.frames; i++) stamps.push(await nextFrame(draw));
    let result = null;
    await nextFrame(() => {
      draw();
      const { pixels, W, H } = readTrail(engine);
      const blocks = blockStats(pixels, W, H, CSS_W, CSS_H, DPR);
      blocks.speed = blockSpeeds(cam, blocks.bw, blocks.bh, 32, regional);
      const scan = scanBlocks(blocks);
      const thumb = document.createElement('canvas');
      thumb.width = THUMB_W; thumb.height = THUMB_H;
      thumb.getContext('2d').drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
      result = {
        ...cfg, ...scan, saturated: +blocks.saturatedFrac.toFixed(3), fineActive,
        msPerFrame: stamps.length > 1 ? +((stamps[stamps.length - 1] - stamps[0]) / (stamps.length - 1)).toFixed(1) : null,
        cpuMs: +(cpu / (cfg.frames + 1)).toFixed(2),
        shot: thumb.toDataURL('image/jpeg', 0.75),
      };
    });
    const err = gl.getError();
    if (err !== gl.NO_ERROR) result.glError = err;
    return result;
  } finally {
    engine.dispose(gl);
    delete performance.now;                     // back to Performance.prototype.now
    Math.random = realRandom;
    clearLevers();
  }
}

/**
 * EYE mode (eye.js): one heatmap frame of the real engine per threshold, its LUT swapped for a
 * white-below-T ramp, read back as the eye's T-kn contour. cfg: {base, fine, lng, lat, z,
 * thresholds, ref, theme, levers}. The particle pool is 2x2 so the trails cannot cover the field.
 */
async function eyeOne(cfg) {
  clearLevers();
  Object.assign(window, cfg.levers || {});
  const engine = new Engine();
  try {
    engine.particleRes = 2;
    engine.init(gl);
    engine.setWindData(gl, cfg.base);
    let verdict = cfg.fine ? engine.setWindData(gl, cfg.fine) : null;
    // cfg.after: grids delivered after the fine one, in order (a zoom's later arrivals); the last verdict is reported.
    for (const g of cfg.after || []) verdict = engine.setWindData(gl, g);
    const cam = makeCamera(cfg.lng, cfg.lat, cfg.z, CSS_W, CSS_H);
    const draw = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      engine.render(gl, cam.matrix, canvas.width, canvas.height, cfg.z, cfg.theme || 'dark', null, cam.viewBounds);
    };
    await nextFrame(draw);                       // builds the ramps for this grid's max speed
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
    const pxKm = (360 / (512 * Math.pow(2, cfg.z) * DPR)) * KM_PER_DEG * Math.cos(cfg.ref.lat * Math.PI / 180);
    const pxToLngLat = (x, y) => cam.unproject(x / DPR, y / DPR);
    const eyes = {};
    for (const T of cfg.thresholds) {
      const ramp = thresholdRamp(engine._maxWindSpeed, T);
      [engine._colorRamp, engine._fieldRamp].filter(Boolean).forEach((tex) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
      });
      await nextFrame(() => {
        draw();
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      });
      const mask = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = px[((H - 1 - y) * W + x) * 4] > 8 ? 1 : 0;
      eyes[T] = eyeGeometry(mask, W, H, pxToLngLat, pxKm, cfg.ref);
    }
    const err = gl.getError();
    return { verdict, fineActive: !!engine._windFine, maxSpeed: +engine._maxWindSpeed.toFixed(1), fineOverlay: window.__WIND_FINE_OVERLAY__, eyes, glError: err !== gl.NO_ERROR ? err : null };
  } finally {
    engine.dispose(gl);
    clearLevers();
  }
}

/**
 * A picture of what the engine draws for {base, fine, lng, lat, z, theme}: one heatmap frame with the theme's real
 * colour ramp (the particle pool 2x2, so the field is not hidden), on an opaque dark ground, downscaled to `width` css
 * px. Returns a PNG data URL (lane-run.js writes before/after images with it).
 */
async function eyeShot(cfg) {
  clearLevers();
  Object.assign(window, cfg.levers || {});
  const engine = new Engine();
  try {
    engine.particleRes = 2;
    engine.init(gl);
    engine.setWindData(gl, cfg.base);
    if (cfg.fine) engine.setWindData(gl, cfg.fine);
    const cam = makeCamera(cfg.lng, cfg.lat, cfg.z, CSS_W, CSS_H);
    const draw = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.06, 0.08, 0.11, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      engine.render(gl, cam.matrix, canvas.width, canvas.height, cfg.z, cfg.theme || 'dark', null, cam.viewBounds);
    };
    await nextFrame(draw);
    const w = cfg.width || 520, h = Math.round(w * CSS_H / CSS_W);
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    const ctx = c2.getContext('2d');
    await nextFrame(() => { draw(); ctx.drawImage(canvas, 0, 0, w, h); });
    if (cfg.contourKn) {
      // The T-kn contour, as eyeOne reads it: swap in the white-below-T ramp, read back, paint the mask's edge white.
      const ramp = thresholdRamp(engine._maxWindSpeed, cfg.contourKn);
      [engine._colorRamp, engine._fieldRamp].filter(Boolean).forEach((tex) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
      });
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
      await nextFrame(() => { draw(); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); });
      const on = (x, y) => px[((H - 1 - y) * W + x) * 4] > 8;
      ctx.fillStyle = '#ffffff';
      for (let y = 1; y < H - 1; y += 1) {
        for (let x = 1; x < W - 1; x += 1) {
          if (on(x, y) && (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1))) {
            ctx.fillRect(Math.floor(x * w / W), Math.floor(y * h / H), 1, 1);
          }
        }
      }
    }
    const url = c2.toDataURL('image/png');
    return { url, maxSpeed: +engine._maxWindSpeed.toFixed(1), fineActive: !!engine._windFine };
  } finally {
    engine.dispose(gl);
    clearLevers();
  }
}

/**
 * EYE mode, particles: the trail ink the respawn and density levers produce in the eye (disc of
 * `rKm` around `ref`) and on its wall (annulus `wallKm`), after `frames` real frames with a fixed
 * grid. If those levers reshaped the eye, the eye/wall ink ratio would move with zoom.
 */
async function eyeInk(cfg) {
  const realRandom = Math.random;
  clearLevers();
  Math.random = mulberry32(cfg.seed || 1);
  let virtualMs = 0;
  performance.now = () => virtualMs;
  const engine = new Engine();
  try {
    engine.particleRes = cfg.res || 384;
    engine.init(gl);
    engine.setWindData(gl, cfg.base);
    if (cfg.fine) engine.setWindData(gl, cfg.fine);
    const cam = makeCamera(cfg.lng, cfg.lat, cfg.z, CSS_W, CSS_H);
    const draw = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      virtualMs += FRAME_MS;
      engine.render(gl, cam.matrix, canvas.width, canvas.height, cfg.z, cfg.theme || 'dark', null, cam.viewBounds);
    };
    for (let i = 0; i < (cfg.frames || 180); i++) await nextFrame(draw);
    let out = null;
    await nextFrame(() => {
      draw();
      const { pixels, W, H } = readTrail(engine);
      const cos = Math.cos(cfg.ref.lat * Math.PI / 180), acc = { eye: [0, 0], wall: [0, 0] };
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const ll = cam.unproject(x / DPR, (H - 1 - y) / DPR);
          const dKm = Math.hypot((ll.lng - cfg.ref.lng) * cos, ll.lat - cfg.ref.lat) * KM_PER_DEG;
          const k = dKm <= cfg.rKm ? 'eye' : (dKm >= cfg.wallKm[0] && dKm <= cfg.wallKm[1] ? 'wall' : null);
          if (!k) continue;
          const p = (y * W + x) * 4;
          acc[k][0] += Math.max(pixels[p], pixels[p + 1], pixels[p + 2]); acc[k][1]++;
        }
      }
      const eye = acc.eye[0] / Math.max(acc.eye[1], 1), wall = acc.wall[0] / Math.max(acc.wall[1], 1);
      out = { eyeInk: +eye.toFixed(1), wallInk: +wall.toFixed(1), ratio: +(eye / Math.max(wall, 1e-6)).toFixed(3) };
    });
    return out;
  } finally {
    engine.dispose(gl);
    delete performance.now;
    Math.random = realRandom;
    clearLevers();
  }
}

/**
 * LAND mode (land-run.js): how much of the land's line work (roads, rivers, coasts) survives the
 * wind layer. Each frame the canvas is cleared to the theme's LAND colour with a 1-css-px line grid
 * every 24 css px in the basemap's own road polarity (darker than land in light and beach, lighter
 * in dark, as navigation-night draws them), then the real engine draws on top. The final canvas is
 * read back and every vertical line pixel is paired with the background 6 css px to its right:
 * retain = mean (L*line - L*bg) / the same on the bare basemap; lost = share of pairs below 0.5.
 * A field-only run (res <= 2) caches its L* image; the next full run of the same view and seed
 * then also returns sal (mean |dL*| the particles add) and cover (share of pixels moved > 5 L*).
 * cfg: {view, z, grid, lng, lat, theme, res, frames, seed, levers}; res 2 = the field alone (4 particles).
 */
const LAND = Object.freeze({ dark: [0.07, 0.08, 0.10], light: [236 / 255, 236 / 255, 232 / 255], beach: [222 / 255, 208 / 255, 180 / 255] });
const LINE = Object.freeze({ dark: [0.30, 0.34, 0.40], light: LAND.light.map((c) => c * 0.55), beach: LAND.beach.map((c) => c * 0.55) });
const LINE_EVERY = 24, BG_OFFSET = 6;
const fieldCache = new Map();
const lstar = (r, g, b) => {
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const Y = 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b);
  return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
};

async function landOne(cfg) {
  clearLevers();
  Object.assign(window, cfg.levers || {});
  const realRandom = Math.random;
  Math.random = mulberry32(seedOf({ ...cfg, view: `land-${cfg.view}` }));
  let virtualMs = 0;
  performance.now = () => virtualMs;
  const engine = new Engine();
  try {
    engine.particleRes = cfg.res;
    engine.init(gl);
    engine.setWindData(gl, GRIDS.world);
    const regional = cfg.grid === 'world' ? null : GRIDS[cfg.grid];
    if (regional) engine.setWindData(gl, regional);
    const cam = makeCamera(cfg.lng, cfg.lat, cfg.z, CSS_W, CSS_H);
    const land = LAND[cfg.theme], line = LINE[cfg.theme];
    const draw = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(land[0], land[1], land[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.clearColor(line[0], line[1], line[2], 1);
      for (let x = LINE_EVERY; x < CSS_W; x += LINE_EVERY) { gl.scissor(x * DPR, 0, DPR, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); }
      for (let y = LINE_EVERY; y < CSS_H; y += LINE_EVERY) { gl.scissor(0, y * DPR, canvas.width, DPR); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.disable(gl.SCISSOR_TEST);
      virtualMs += FRAME_MS;
      engine.render(gl, cam.matrix, canvas.width, canvas.height, cfg.z, cfg.theme, null, cam.viewBounds);
    };
    for (let i = 0; i < cfg.frames; i++) await nextFrame(draw);
    let out = null;
    await nextFrame(() => {
      draw();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const Limg = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) Limg[i] = lstar(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      const L = (x, y) => Limg[y * W + x];
      const d0 = lstar(...line.map((c) => c * 255)) - lstar(...land.map((c) => c * 255));
      let sum = 0, n = 0, lost = 0;
      for (let y = 0; y < H; y += 2) {
        if ((y / DPR) % LINE_EVERY < 2) continue;                       // skip rows on a horizontal line
        for (let x = LINE_EVERY; x + BG_OFFSET < CSS_W; x += LINE_EVERY) {
          const r = (L(x * DPR, y) - L((x + BG_OFFSET) * DPR, y)) / d0;
          sum += r; n++; if (r < 0.5) lost++;
        }
      }
      out = { retain: +(sum / n).toFixed(3), lost: +(lost / n).toFixed(3), pairs: n, glError: gl.getError() || 0 };
      const key = `${cfg.theme}/${cfg.z}/${cfg.lng}/${cfg.lat}/${cfg.seed}/${cfg.frames}/${JSON.stringify(cfg.levers || {})}`;
      if (cfg.res <= 2) fieldCache.set(key, Limg);
      else if (fieldCache.has(key)) {
        const F = fieldCache.get(key); let s = 0, c = 0;
        for (let i = 0; i < W * H; i++) { const d = Math.abs(Limg[i] - F[i]); s += d; if (d > 5) c++; }
        out.sal = +(s / (W * H)).toFixed(3); out.cover = +(c / (W * H)).toFixed(4);
        fieldCache.delete(key);
      }
    });
    return out;
  } finally {
    engine.dispose(gl);
    delete performance.now;
    Math.random = realRandom;
    clearLevers();
  }
}

const caption = (r) => `${configKey(r)} · ${figureText(r)}`;

function addFigure(r) {
  const fig = document.createElement('figure');
  const img = document.createElement('img');
  img.src = r.shot;
  img.alt = caption(r);
  const cap = document.createElement('figcaption');
  cap.textContent = caption(r);
  if (r.artifacts) fig.className = 'flagged';
  fig.append(img, cap);
  sheetEl.appendChild(fig);
}

async function run(configs) {
  const results = [];
  for (let i = 0; i < configs.length; i++) {
    setStatus(`running ${i + 1}/${configs.length}: ${configKey(configs[i])}`);
    const r = await runOne(configs[i]);
    results.push(r);
    addFigure(r);
  }
  window.__WIND_BENCH__.results = results;
  const control = controlAcrossSeeds(results);
  document.getElementById('table').textContent = formatTable(mergeSeeds(results), control);
  setStatus(`done: ${results.length} configurations` + (control ? ` · positive control ${control.status}` : ''));
  return results;
}

const PRESETS = {
  control: () => controlConfigs(),
  dark: () => buildMatrix({ themes: ['dark'] }),
  full: () => buildMatrix(),
};

window.__WIND_BENCH__ = { ready: !!gl, renderer: renderer(), dpr: DPR, runOne, run, eyeOne, eyeInk, eyeShot, landOne, presets: Object.keys(PRESETS), results: [] };

document.getElementById('run').addEventListener('click', () => {
  const preset = document.getElementById('preset').value;
  sheetEl.textContent = '';
  run(PRESETS[preset]()).catch((e) => setStatus('error: ' + e.message));
});
setStatus(`ready · ${renderer()} · DPR ${DPR} · world ${GRIDS.world.cols}x${GRIDS.world.rows} · fine ${GRIDS.fine.cols}x${GRIDS.fine.rows}`);
const auto = params.get('auto');
if (auto && PRESETS[auto]) {
  document.getElementById('preset').value = auto;
  document.getElementById('run').click();
}
