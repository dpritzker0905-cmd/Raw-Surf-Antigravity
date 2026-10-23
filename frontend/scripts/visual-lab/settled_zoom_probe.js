// Settled high-zoom probe (2026-10-19, nightly SETTLED_STEP investigation): replays the nightly's zoom-in staircase leg over the
// offline backend and records, per rendered frame, the same whole-canvas luminance zoomlab measures PLUS the marine engine's
// identity (resident grid, mask, coarse base). A luminance step measured over a 1 s window (as the nightly gate now does) is then
// matched with what changed inside the engine in that window.
//   PORT=4103 OUT=probe-out node scripts/visual-lab/settled_zoom_probe.js     (serve_synthetic with --thin-bounds 1 or 0)
// Offline only: nothing reaches the live backend.
const fs = require('fs');
const path = require('path');
const L = require('../offline-backend/ab_lib.js');

const PORT = +(process.env.PORT || 4103);
const OUT = path.resolve(process.env.OUT || 'probe-out');
const CENTER = (process.env.CENTER || '-80.2,28.33').split(',').map(Number);   // the nightly's ZL_CENTER
const Z0 = +(process.env.Z0 || 12), Z1 = +(process.env.Z1 || 14.5), DZ = +(process.env.DZ || 0.18), SETTLE = +(process.env.SETTLE || 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAPTURE = () => {
  const m = window.map; const src = m.getCanvas();
  const W = 160, H = Math.round(160 * src.height / src.width);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const T = (window.__PROBE__ = { frames: [], t0: performance.now() });
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
  const ident = () => {
    const e = window.__MARINE_ENGINE__; if (!e) return null;
    const g = e._waveData && e._waveData.waveGrid; const b = g && g.bounds; const mb = e._cachedMaskBounds; const cb = e._coarseBaseData;
    return {
      grid: g ? `${g.__sourceModel}|${g.__componentLayer}|h${g.hourOffset}|${g.cols}x${g.rows}|${b ? [b.west, b.south, b.east, b.north].map(r2).join(',') : '-'}|${g.__fromSeries ? 'S' : 'G'}|st${g.__decimatedStride || 0}` : null,
      mask: mb ? `${[mb.west, mb.south, mb.east, mb.north].map(r2).join(',')}|${JSON.stringify(e._cachedMaskTexDims || null)}|${e._lastMaskEncodeMode || ''}` : null,
      base: cb ? String(cb.__key || '').slice(0, 80) : null,
      ovm: (() => { const tb = e._overlayMaskTruthBox; const bw = window.__RAW_GPU__ && window.__RAW_GPU__.basemapWaterMask;
        return `${r2(e._overlayMaskPaintZoom)}|${tb ? [tb.west, tb.south, tb.east, tb.north].map((v) => r2(v)).join(',') : '-'}|deg${e._overlayPaintDegraded ? 1 : 0}|${bw && bw.overlay ? bw.at : '-'}`; })(),
      ovlOn: !!(window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask && window.__RAW_GPU__.overlayMask.on),
    };
  };
  m.on('render', () => {
    try {
      ctx.drawImage(src, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data; let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 8) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      let id = null; try { id = ident(); } catch (e) { id = { err: String(e && e.message).slice(0, 80) }; }
      T.frames.push({ t: Math.round(performance.now() - T.t0), z: +m.getZoom().toFixed(3), L: +(s / n).toFixed(1), id });
    } catch (e) { T.err = String(e && e.message); }
  });
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const LIVE = process.env.LIVE_BASE;   // e.g. http://localhost:3009 (dev server on the LIVE backend, as the nightly runs it)
  let browser, page;
  if (LIVE) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
    page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.addInitScript(() => { const m = { register: () => new Promise(() => {}), ready: new Promise(() => {}), addEventListener() {}, removeEventListener() {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) }; Object.defineProperty(navigator, 'serviceWorker', { get() { return m; }, configurable: true }); });
    // the nightly's own setup: stub the authenticated message badge (the dev mock token is refused by the live backend, and that
    // 401 sends the tab to the sign-in form), then wait for the marine page exactly as zoomlab does.
    const H = require('../zoomlab-harness.cjs'); await H.stubZoomlabMessageBadge(page);
    page.__H = H;
    const reqs = []; page.on('requestfinished', (r) => { const u = r.url(); if (/tiles|\.pbf|\.mvt|api\/weather/.test(u)) reqs.push({ t: Date.now(), u: u.slice(0, 160) }); });
    page.__reqs = reqs;
  } else ({ browser, page } = await L.launch({ port: PORT, width: 1280, height: 800 }));
  if (process.env.PROBE_FLAGS) await page.addInitScript((fl) => { for (const k of fl) window[k] = true; }, process.env.PROBE_FLAGS.split(','));   // A/B on one build
  try {
    if (LIVE) {
      await page.goto(LIVE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.__H.waitForMarineReady(page);
      await page.evaluate(() => { const d = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Decline'); if (d) d.click(); });
    } else await L.openMap(page);
    await L.jump(page, CENTER[0], CENTER[1], 9);
    const waves = page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first();
    const on = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent || '').trim() === 'Waves'));
    if (!on) await waves.evaluate((el) => el.click());
    await sleep(10000);
    await page.evaluate(CAPTURE);
    for (let z = Z0; z <= Z1 + 1e-6; z += DZ) {
      await page.evaluate(([c, zz]) => window.map.jumpTo({ center: c, zoom: zz }), [CENTER, +z.toFixed(3)]);
      await sleep(SETTLE);
    }
    if (process.env.SHOTS) for (let k = 0; k < +process.env.SHOTS; k++) { await page.screenshot({ path: path.join(OUT, `z-end-${k}.png`) }); await sleep(2500); }   // stills at the last zoom, 2.5 s apart
    const frames = await page.evaluate(() => window.__PROBE__.frames);
    if (page.__reqs) fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(page.__reqs));
    const perr = await page.evaluate(() => window.__PROBE__.err || null); if (perr) console.log('capture error:', perr);
    fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify({ center: CENTER, frames }));
    // Windowed steps (as zoomlab-verdict's settledWindowMs = 1000) and what changed in the engine across each window.
    const steps = []; let a = null;
    for (const b of frames) {
      if (!a || Math.abs(b.z - a.z) >= 0.01) { a = b; continue; }
      if (b.t - a.t < 1000) continue;
      const dL = b.L - a.L;
      if (Math.abs(dL) > 16) {
        const inWin = frames.filter((f) => f.t > a.t && f.t <= b.t);
        const changed = { grid: new Set(), mask: new Set(), base: new Set(), ovm: new Set() };
        for (const f of [a, ...inWin]) if (f.id) { changed.grid.add(f.id.grid); changed.mask.add(f.id.mask); changed.base.add(f.id.base); changed.ovm.add(f.id.ovm); }
        steps.push({ t: b.t, z: b.z, dL: +dL.toFixed(1), gridChanged: changed.grid.size > 1, maskChanged: changed.mask.size > 1, baseChanged: changed.base.size > 1, ovmChanged: changed.ovm.size > 1, ovms: [...changed.ovm],
          grids: [...changed.grid], masks: [...changed.mask] });
      }
      a = b;
    }
    // Identity transitions at settled zoom, whether or not they stepped the luminance.
    const trans = [];
    for (let i = 1; i < frames.length; i++) {
      const p = frames[i - 1], c = frames[i]; if (!p.id || !c.id || Math.abs(c.z - p.z) >= 0.01) continue;
      for (const k of ['grid', 'mask', 'base', 'ovm']) if (p.id[k] !== c.id[k]) trans.push({ t: c.t, z: c.z, k, from: p.id[k], to: c.id[k], dL: +(c.L - p.L).toFixed(1) });
    }
    const out = { frames: frames.length, steps, transitions: trans };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ frames: frames.length, steps: steps.length, gridSteps: steps.filter((s) => s.gridChanged).length,
      maskSteps: steps.filter((s) => s.maskChanged).length, baseSteps: steps.filter((s) => s.baseChanged).length, ovmSteps: steps.filter((s) => s.ovmChanged).length, ovmTransitions: trans.filter((x) => x.k === 'ovm').length, transitions: trans.length }));
  } finally { await browser.close(); }
})();
