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
const { BASEMAP, VARIANTS, buildMatrix, controlConfigs } = require('../matrix');
const { formatTable, figureText, configKey } = require('../report');
const { mergeSeeds, controlAcrossSeeds } = require('../replicates');

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
  const variant = VARIANTS[cfg.variant];
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

window.__WIND_BENCH__ = { ready: !!gl, renderer: renderer(), dpr: DPR, runOne, run, presets: Object.keys(PRESETS), results: [] };

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
