// Moving clips of the marine crests, one arm per browser, for a side-by-side owner A/B (2026-11-12, one-way crests). Offline only.
//
// Per (theme, view, arm): the built client over serve_synthetic.py, the dev tuner OFF (on 127.0.0.1 it seeds every animation
// global, which would mask a kill switch), LAYER on at CENTER / ZOOM, SETTLE ms, then SECONDS of the compositor's own frames
// (CDP screencast, JPEG) written to OUT/<arm>-<theme>-<view>/ with frames.json (timestamps). crest_clips.py crops the same
// window from each arm and lays them side by side as an animated WebP.
//
//   <backend venv python> frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --dynamic 1 --port 4198
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3198
//   AB_BASE=http://127.0.0.1:3198 PORT=4198 CDN_DIR=<frames> OUT=<dir> node scn_crest_clips.js
//   <python> crest_clips.py <dir>
// Env: ARMS ('sway:__RAW_DISABLE_ONE_WAY_CRESTS__,oneway' = name[:flag+flag]), THEMES (dark,light,beach), VIEWS (desktop,phone),
//      LAYER (waves), CENTER (-112,14), ZOOM (5), SETTLE (9000), SECONDS (7), REDUCED=1 (prefers-reduced-motion: reduce).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_crest_clips is offline only');
const PORT = +(process.env.PORT || 4198);
const OUT = process.env.OUT || 'crest-clips-out';
const CDN_DIR = process.env.CDN_DIR || '';
const CDN_PORT = +(process.env.CDN_PORT || 4193);
const ARMS = (process.env.ARMS || 'sway:__RAW_DISABLE_ONE_WAY_CRESTS__,oneway').split(',').map((a) => { const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] }; });
const THEMES = (process.env.THEMES || 'dark,light,beach').split(',');
const VIEWS = (process.env.VIEWS || 'desktop,phone').split(',');
const LAYER = process.env.LAYER || 'waves';
const [CLNG, CLAT] = (process.env.CENTER || '-112,14').split(',').map(Number);
const ZOOM = +(process.env.ZOOM || 5);
const SETTLE = +(process.env.SETTLE || 9000);
const SECONDS = +(process.env.SECONDS || 7);
const REDUCED = process.env.REDUCED === '1';
const VP = {
  desktop: { width: 1280, height: 800, dpr: 1, contextOptions: {} },
  phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdn = !CDN_DIR ? null : http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const cors = { 'access-control-allow-origin': '*' };
  if (!path.resolve(file).startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json' });
  return res.end(body);
});

async function runOne(arm, theme, view) {
  const vp = VP[view];
  const { browser, page } = await L.launch({ port: PORT, width: vp.width, height: vp.height, dpr: vp.dpr,
    contextOptions: { ...vp.contextOptions, ...(REDUCED ? { reducedMotion: 'reduce' } : {}) } });
  const dir = path.join(OUT, `${arm.name}-${theme}-${view}`);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const res = { arm: arm.name, flags: arm.flags, theme, view, layer: LAYER, center: [CLNG, CLAT], zoom: ZOOM, reduced: REDUCED };
  try {
    await page.addInitScript(({ flags, theme, cdnBase }) => {
      try { localStorage.setItem('raw-surf-theme', theme); localStorage.setItem('__RAW_TUNER__', '0'); localStorage.removeItem('__RAW_STATIC_FRAMES__'); } catch (e) { /* none */ }
      if (cdnBase) window.__RAW_STATIC_FRAMES_BASE__ = cdnBase;
      for (const f of flags) window[f] = true;
    }, { flags: arm.flags, theme, cdnBase: cdn ? `http://127.0.0.1:${CDN_PORT}/` : null });
    await L.openMap(page);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await sleep(2500);
    await page.evaluate((layer) => window.toggleLayer(layer), LAYER);
    await sleep(SETTLE);
    res.anim = await page.evaluate(() => (window.__RAW_GPU__ && window.__RAW_GPU__.anim) ? { orbitalPitch: window.__RAW_GPU__.anim.orbitalPitch, reducedMotion: window.__RAW_GPU__.anim.reducedMotion, zoom: window.__RAW_GPU__.anim.zoom } : null);
    const cdp = await page.context().newCDPSession(page);
    let n = 0;
    cdp.on('Page.screencastFrame', (f) => {
      const file = `f${String(n++).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
      frames.push({ file, ts: f.metadata.timestamp * 1000 });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 });
    await sleep(SECONDS * 1000);
    await cdp.send('Page.stopScreencast').catch(() => {});
    await sleep(200);
    res.frames = frames;
  } catch (e) { res.error = String((e && e.message) || e).slice(0, 300); }
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(res));
  await browser.close().catch(() => {});
  console.log(`${arm.name} ${theme} ${view}: ${frames.length} frames, anim ${JSON.stringify(res.anim)} ${res.error || ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (cdn) await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  for (const theme of THEMES) for (const view of VIEWS) for (const arm of ARMS) await runOne(arm, theme, view);
  if (cdn) cdn.close();
})();
