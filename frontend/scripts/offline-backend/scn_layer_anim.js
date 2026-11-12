// Layer ANIMATION probe (2026-11-11, Fable layer-animation lane): what the user SEES when a weather layer is toggled, scrubbed,
// zoomed and panned, measured the same way for every layer (waves, wind, pressure, rain, radar). Offline only.
//
// One fresh browser per (layer, viewport, theme). After the map settles: CDP screencast on (every composited frame, JPEG, saved
// with its compositor timestamp), a rAF loop (frame intervals) and Long Animation Frame / longtask observers. Then, each marked:
//   toggle   window.toggleLayer(layer), DWELL_TOGGLE ms
//   step1..N ArrowRight on the timeline wheel (radar: ArrowLeft, back through the observed frames), STEP_GAP ms apart
//   zoom     map.zoomTo(z + 1, 600 ms), DWELL ms
//   pan      map.panBy([W/4, 0], 600 ms), DWELL ms
// anim_frames.py turns the frames + marks into: toggle -> first visible change, blank frames (the layer gone: the picture falls
// back to the pre-toggle basemap), flashes, step -> settled change, rAF p50/p95 and dropped frames (> 33 ms) per phase.
// Raster hosts (Open-Meteo S3, RainViewer, IEM, DWD) go through raster-lab/rr.js: record once, then RR_MODE=replay.
//
//   <backend venv python> frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves,wind --dynamic 1 --port 4198
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3198
//   AB_BASE=http://127.0.0.1:3198 PORT=4198 RR_DIR=<cache> OUT=<dir> LAYERS=waves,wind,pressure,rain,radar VPS=desktop,phone THEMES=dark node scn_layer_anim.js
//   <python> anim_frames.py <dir>
// Env: ARM (name, 'base'), FLAGS (JSON window levers set before load), STEPS (6), STEP_GAP (700), DWELL (2500), DWELL_TOGGLE (6000),
//      ZOOM (5), CENTER (-79.8,28.0), PHONE_CPU (4), SHOTS=1 keeps every JPEG (default keeps them: the analyser reads them).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');
const { RR } = require('../raster-lab/rr.js');

if (process.env.AB_LIVE === '1') throw Error('scn_layer_anim is offline only');
const PORT = +(process.env.PORT || 4198);
const OUT = process.env.OUT || 'layer-anim-out';
const RR_DIR = process.env.RR_DIR || path.join(OUT, 'rr-cache');
const LAYERS = (process.env.LAYERS || 'waves,wind,pressure,rain,radar').split(',');
const VPS = (process.env.VPS || 'desktop,phone').split(',');
const THEMES = (process.env.THEMES || 'dark').split(',');
const ARM = process.env.ARM || 'base';
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const STEPS = +(process.env.STEPS || 6);
const STEP_GAP = +(process.env.STEP_GAP || 700);
const DWELL = +(process.env.DWELL || 2500);
const DWELL_TOGGLE = +(process.env.DWELL_TOGGLE || 6000);
const ZOOM = +(process.env.ZOOM || 5);
const [CLNG, CLAT] = (process.env.CENTER || '-79.8,28.0').split(',').map(Number);
const PHONE_CPU = +(process.env.PHONE_CPU || 4);
// CDN_DIR=<publish_frame_images --out-dir>: the static-frames CDN production has (window.__RAW_STATIC_FRAMES_BASE__). Without it
// the waves and wind toggles take the /grid_series path, which production only uses as the fallback.
const CDN_DIR = process.env.CDN_DIR || '';
const CDN_PORT = +(process.env.CDN_PORT || 4193);
const cdn = !CDN_DIR ? null : http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const cors = { 'access-control-allow-origin': '*' };
  if (!path.resolve(file).startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  return res.end(body);
});
const VP = {
  desktop: { width: 1280, height: 800, dpr: 1, contextOptions: {} },
  phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The raster lab pins the page clock to its recording, so every session asks for the same frames.
const DATE_SHIM = (offset) => {
  if (!offset) return;
  const RD = Date;
  function D(...a) { if (!(this instanceof D)) return new RD(RD.now() + offset).toString(); return a.length ? new RD(...a) : new RD(RD.now() + offset); }
  D.prototype = RD.prototype; D.now = () => RD.now() + offset; D.parse = RD.parse; D.UTC = RD.UTC;
  window.Date = D;
};
// Page-side probe: rAF intervals, long tasks, LoAF, marks (epoch ms from the REAL clock, to line up with the screencast).
const PROBE = () => {
  const realNow = Object.getPrototypeOf(performance).now ? () => performance.timeOrigin + performance.now() : () => 0;
  const P = (window.__ANIM__ = { raf: [], lt: [], loaf: [], marks: [], on: false });
  P.mark = (name) => P.marks.push([realNow(), name]);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push([performance.timeOrigin + e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false }); } catch (e) { /* none */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.loaf.push([performance.timeOrigin + e.startTime, e.duration, e.blockingDuration || 0, (e.scripts || []).filter((x) => x.duration >= 5).map((x) => [Math.round(x.duration), x.invokerType || '', (x.invoker || '').slice(0, 60), (x.sourceFunctionName || '').slice(0, 60), ((x.sourceURL || '').split('/').pop() || '').split('.')[0] + '@' + (x.sourceCharPosition || 0), Math.round(x.forcedStyleAndLayoutDuration || 0)])]); }).observe({ type: 'long-animation-frame', buffered: false }); } catch (e) { /* none */ }
  const loop = () => { if (P.on) P.raf.push(realNow()); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
};

async function runOne(rr, offset, layer, vpName, theme) {
  const vp = VP[vpName];
  const { browser, page, log } = await L.launch({ port: PORT, width: vp.width, height: vp.height, dpr: vp.dpr, contextOptions: vp.contextOptions });
  const tag = `${ARM}-${layer}-${vpName}-${theme}`;
  const dir = path.join(OUT, tag);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const res = { arm: ARM, layer, vp: vpName, theme, flags: FLAGS, at: new Date().toISOString() };
  try {
    await rr.install(page);
    await page.addInitScript(DATE_SHIM, offset);
    await page.addInitScript(({ flags, theme, cdnBase }) => {
      if (cdnBase) { try { localStorage.removeItem('__RAW_STATIC_FRAMES__'); } catch (e) { /* none */ } window.__RAW_STATIC_FRAMES_BASE__ = cdnBase; }
      for (const [k, v] of Object.entries(flags)) window[k] = v;
      try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* none */ }
    }, { flags: FLAGS, theme, cdnBase: cdn ? `http://127.0.0.1:${CDN_PORT}/` : null });
    await page.addInitScript(PROBE);
    const cdp = await page.context().newCDPSession(page);
    if (vpName === 'phone' && PHONE_CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE_CPU });
    await L.openMap(page);
    await L.jump(page, CLNG, CLAT, ZOOM);
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const ok = await page.evaluate(() => { const m = window.__MAP_INSTANCE__; return !!(m && m.loaded() && m.areTilesLoaded()); }).catch(() => false);
      if (ok) break; await sleep(250);
    }
    await sleep(2000);
    let n = 0;
    cdp.on('Page.screencastFrame', async (f) => {
      const i = n++;
      const file = path.join(dir, `f${String(i).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      frames.push({ i, ts: f.metadata.timestamp * 1000, file: path.basename(file) });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 480, maxHeight: 480, everyNthFrame: 1 });
    await page.evaluate(() => { window.__ANIM__.on = true; window.__ANIM__.mark('ref'); });
    await sleep(800);
    await page.evaluate((layer) => { window.__ANIM__.mark('toggle'); window.toggleLayer(layer); }, layer);
    await sleep(DWELL_TOGGLE);
    const wheel = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
    const hasWheel = (await wheel.count()) > 0;
    res.hasWheel = hasWheel;
    for (let i = 1; i <= STEPS; i++) {
      if (hasWheel) {
        await wheel.focus().catch(() => {});
        await page.evaluate((i) => window.__ANIM__.mark('step' + i), i);
        await page.keyboard.press(layer === 'radar' ? 'ArrowLeft' : 'ArrowRight');
      } else {
        await page.evaluate(({ i, radar }) => { window.__ANIM__.mark('step' + i); if (radar) window.setRadarFrameIndex(Math.max(0, 12 - i)); else window.setTimeOffsetHours(i); }, { i, radar: layer === 'radar' });
      }
      await sleep(STEP_GAP);
    }
    await sleep(DWELL);
    await page.evaluate(() => { window.__ANIM__.mark('zoom'); const m = window.__MAP_INSTANCE__; m.zoomTo(m.getZoom() + 1, { duration: 600 }); });
    await sleep(DWELL);
    await page.evaluate((dx) => { window.__ANIM__.mark('pan'); window.__MAP_INSTANCE__.panBy([dx, 0], { duration: 600 }); }, Math.round(vp.width / 4));
    await sleep(DWELL);
    await page.evaluate(() => window.__ANIM__.mark('end'));
    await cdp.send('Page.stopScreencast').catch(() => {});
    await sleep(300);
    const A = await page.evaluate(() => ({ raf: window.__ANIM__.raf, lt: window.__ANIM__.lt, loaf: window.__ANIM__.loaf, marks: window.__ANIM__.marks }));
    Object.assign(res, A, { frames, errors: log.errors.slice(0, 10) });
  } catch (e) {
    res.error = String(e && e.message || e).slice(0, 400);
  } finally {
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(res));
    await browser.close().catch(() => {});
  }
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (cdn) await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const rr = new RR(RR_DIR);
  const metaPath = path.join(RR_DIR, 'meta.json');
  let meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  if (!meta) { meta = { tRec: Date.now() }; fs.writeFileSync(metaPath, JSON.stringify(meta)); }
  for (const layer of LAYERS) {
    for (const vp of VPS) {
      for (const theme of THEMES) {
        const offset = meta.tRec - Date.now();
        const r = await runOne(rr, offset, layer, vp, theme);
        console.log(`${ARM} ${layer} ${vp} ${theme}: frames ${(r.frames || []).length} raf ${(r.raf || []).length} ${r.error || ''}`);
      }
    }
  }
  if (cdn) cdn.close();
})();
