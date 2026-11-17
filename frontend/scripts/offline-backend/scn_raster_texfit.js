// RASTER TEXTURE FIT, IN A REAL PAGE (2026-11-16; gate T1 + T2 of docs/weather-program/log/2026-11-16-opus-raster-0125-texture-gate.md).
// Loads the app's own `ownRasterLayer.js` (it has no imports) as an ES module into a headless Chromium page with a REAL WebGL2 context,
// and drives the layer exactly as MapLibre does (onAdd, prerender, render with a projection matrix). Offline; no backend, no map.
//   node frontend/scripts/offline-backend/scn_raster_texfit.js [out.json]
// T1: MAX_TEXTURE_SIZE forced to 2048 (an instrument wrapper around the context's getParameter; every other call is the real GPU's):
//     a 2880 x 1441 field must upload as 1440 x 721 with gl.getError() === NO_ERROR after every call it makes and no lost context.
// T2: the device's own limit; a 30-step scrub of 2880 x 1441 frames (two frames per step); the layer's resident bytes (its own
//     accounting, window.__RAW_OWN_RASTER_TEX__) sampled after every frame must never exceed 48 MiB; GL errors and context loss counted.
// Arm `kill` repeats T1 with window.__RAW_DISABLE_RASTER_TEX_FIT__ (the full-size upload; on a real 2048 device that is an error).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const OUT = process.argv[2] || 'raster-texfit.json';
const SRC = path.join(__dirname, '..', '..', 'src', 'components', 'map', 'ownRasterLayer.js');
const PAGE = `<!doctype html><meta charset="utf-8"><canvas id="c" width="512" height="256"></canvas>
<script type="module">
import * as M from './ownRasterLayer.js';
window.run = async (mode) => {
  const canvas = document.getElementById('c');
  const real = canvas.getContext('webgl2');
  if (!real) return { error: 'no webgl2' };
  const errs = []; let calls = 0; const forced = mode === 't1' || mode === 'kill' ? 2048 : null;
  const deviceMax = real.getParameter(real.MAX_TEXTURE_SIZE);
  // A pass-through wrapper: every call goes to the real context and is followed by a real getError; only the limit read is forced.
  const gl = new Proxy(real, { get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    if (k === 'getParameter') return (p) => (forced && p === t.MAX_TEXTURE_SIZE ? forced : t.getParameter(p));
    if (k === 'getError' || k === 'isContextLost') return v.bind(t);
    return (...a) => { calls += 1; const r = v.apply(t, a); const e = t.getError(); if (e !== t.NO_ERROR) errs.push([String(k), e]); return r; };
  } });
  if (mode === 'kill') window.__RAW_DISABLE_RASTER_TEX_FIT__ = true; else delete window.__RAW_DISABLE_RASTER_TEX_FIT__;
  delete window.__RAW_OWN_RASTER_TEX__;
  const map = { getCanvas: () => canvas, canvas, getZoom: () => 4, triggerRepaint: () => {} };
  const L = M.createOwnRasterLayer({ id: 'own-raster-rain' });
  L.onAdd(map, gl);
  L.setLut(M.buildStepLut({ breakpoints: [0], colors: [[1, 2, 3, 1]] }));
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const args = { defaultProjectionData: { mainMatrix: I } };
  const big = (seed) => { const cols = 2880, rows = 1441, v = new Float32Array(cols * rows);
    for (let i = 0; i < v.length; i += 1) v[i] = ((i * 2654435761 + seed) >>> 0) % 1000;
    return { cols, rows, bounds: { west: -180, south: -90, east: 179.875, north: 90 }, values: v, validMs: seed }; };
  const frame = () => { L.prerender(gl, args); L.render(gl, args); };
  let peak = 0; const samples = [];
  const steps = mode === 't2' ? 30 : 1;
  for (let i = 0; i < steps; i += 1) {
    L.offerField('h' + i, big(i)); L.want('h' + i);
    for (let j = 0; j < 2; j += 1) { frame(); const b = (window.__RAW_OWN_RASTER_TEX__ || {}).residentBytes || 0; samples.push(b); peak = Math.max(peak, b); }
  }
  const tel = window.__RAW_OWN_RASTER_TEX__ ? JSON.parse(JSON.stringify(window.__RAW_OWN_RASTER_TEX__)) : null;
  return { mode, deviceMax, forced, calls, glErrors: errs.length, firstErrors: errs.slice(0, 5), lost: real.isContextLost(),
    shown: L.shownPath(), peakBytes: peak, overBudgetSamples: samples.filter((b) => b > M.RESIDENT_BYTES_MAX).length,
    samples: samples.length, budget: M.RESIDENT_BYTES_MAX, tel };
};
window.ready = true;
</script>`;

(async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/ownRasterLayer.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fs.readFileSync(SRC)); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = { at: new Date().toISOString(), runs: [] };
  try {
    for (const mode of ['t1', 't2', 'kill']) {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
      const r = await page.evaluate((m) => window.run(m), mode);
      out.runs.push(r);
      console.log(JSON.stringify({ mode: r.mode, deviceMax: r.deviceMax, forced: r.forced, calls: r.calls, glErrors: r.glErrors, firstErrors: r.firstErrors,
        lost: r.lost, shown: r.shown, peakMiB: r.peakBytes && +(r.peakBytes / 1048576).toFixed(2), over: r.overBudgetSamples, samples: r.samples,
        factor: r.tel && r.tel.lastFactor, downsampled: r.tel && r.tel.downsampled, error: r.error }));
      await page.close();
    }
  } catch (e) { out.error = String(e && e.message || e); console.log('ERROR', out.error); }
  await browser.close(); srv.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
})();
