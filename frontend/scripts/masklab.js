/**
 * masklab.js — WHICH PASS PAINTS ON LAND? (2026-07-24)
 *
 * The marine heatmap fragment shader hard-discards land (`if (oceanAlpha < 0.5) discard;`,
 * WebGLMarineShaders.js ~:399) and the ocean mask reads CORRECT at the land points
 * (probeMaskGPU .effective == 0). Yet the field visibly extends inland at wide zoom.
 *
 * The discriminator: HEATMAP_FS's debug block (u_debug_mode == 2.0, 'mask') returns
 * `vec4(oceanAlpha, oceanAlpha, oceanAlpha, u_opacity)` BEFORE the discard. So in debug mode:
 *   - any pixel the HEATMAP painted becomes GREY (its own oceanAlpha), and
 *   - any pixel painted by a DIFFERENT pass (or by the basemap) keeps its colour.
 * Comparing the normal frame against the debug frame at the same pixels therefore attributes
 * every painted pixel to a pass, instead of guessing.
 *
 * Run headless so compositing is guaranteed (the in-app Browser pane stops rAF when hidden,
 * which silently hangs any canvas read).
 *
 * Usage: node masklab.js <outdir>
 * Env: ML_BASE (default http://localhost:3007), ML_MODEL (EURO), ML_ZOOMS ("6.0,3.1"),
 *      ML_CENTER ("-82.0,28.0"), ML_LAT (28.0), ML_FLAGS
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.ML_BASE || 'http://localhost:3007';
const MODEL = (process.env.ML_MODEL || 'EURO').trim().toUpperCase();
const ZOOMS = (process.env.ML_ZOOMS || '6.0,3.1').split(',').map(Number);
const CENTER = (process.env.ML_CENTER || '-82.0,28.0').split(',').map(Number);
const LAT = Number(process.env.ML_LAT || 28.0);
const outdir = process.argv[2] || path.join(__dirname, 'masklab-out');
fs.mkdirSync(outdir, { recursive: true });
const out = [];
const log = (m) => { console.log(m); out.push(m); fs.writeFileSync(path.join(outdir, 'transects.txt'), out.join('\n')); };

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  // ML_FLAGS accepts bare names (=> true) AND name=value pairs, because several of the live levers
  // are "set me to FALSE" switches (e.g. __MARINE_SIBLING_PREWARM__=false) or numeric
  // (__RAW_WORLD_MASK_WIDTH__=1024). A true-only setter cannot A/B those.
  if (process.env.ML_FLAGS) {
    const flags = process.env.ML_FLAGS.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const i = s.indexOf('='); if (i < 0) return [s, true];
        const raw = s.slice(i + 1);
        const val = raw === 'true' ? true : raw === 'false' ? false : (isNaN(Number(raw)) ? raw : Number(raw));
        return [s.slice(0, i), val]; });
    await page.addInitScript((fl) => { for (const [k, v] of fl) window[k] = v; }, flags);
    log('ML_FLAGS: ' + flags.map(([k, v]) => `${k}=${v}`).join(', '));
  }
  // THEME MATTERS for this test: in LIGHT theme the basemap's own water is a bright cyan that
  // reads exactly like the marine field, so a colour-based judgement flips between themes. The
  // debug-uniform attribution below is theme-independent, but the human-facing colours are not —
  // always run the theme the user is actually on.
  if (process.env.ML_THEME) {
    await page.addInitScript((t) => { try { localStorage.setItem('raw-surf-theme', t); } catch (e) {} }, process.env.ML_THEME.trim());
    log('ML_THEME: ' + process.env.ML_THEME.trim());
  }
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });

  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Decline');
    if (d) d.click();
    const w = [...document.querySelectorAll('button')]
      .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (w && w.getAttribute('aria-pressed') !== 'true') w.click();
  });
  await page.waitForFunction(() => { const e = window.__MARINE_ENGINE__; return e && e._waveData; }, null, { timeout: 90000 })
    .catch(() => log('resident wait timed out'));
  await page.evaluate((m) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === m);
    if (b) b.click();
  }, MODEL);
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    window.__GRAB__ = (W) => new Promise((res) => {
      const src = window.map.getCanvas();
      const H = Math.round(W * src.height / src.width);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      let n = 0;
      const h = () => { n++; if (n < 3) return; window.map.off('render', h);
        ctx.drawImage(src, 0, 0, W, H); res({ W, H, d: Array.from(ctx.getImageData(0, 0, W, H).data) }); };
      window.map.on('render', h);
      window.map.triggerRepaint();
      setTimeout(() => window.map.triggerRepaint(), 60);
      setTimeout(() => window.map.triggerRepaint(), 140);
    });
  });

  for (const z of ZOOMS) {
    await page.evaluate(([c, zz]) => window.map.jumpTo({ center: c, zoom: zz }), [CENTER, z]);
    await page.waitForTimeout(14000);

    const state = await page.evaluate(() => {
      const e = window.__MARINE_ENGINE__, wd = e._waveData, g = window.__RAW_GPU__ || {};
      return { z: +window.map.getZoom().toFixed(2), cols: wd && wd.waveGrid && wd.waveGrid.cols,
        rows: wd && wd.waveGrid && wd.waveGrid.rows, bounds: wd && wd.bounds,
        blendBoth: g.blendBoth && g.blendBoth.engaged, bridge: g.coarseBridgeActive,
        washEff: g.washEff, maskDims: g.maskId && g.maskId.dims, drawCalls: g.drawCallsPerFrame,
        crestRingFill: g.crestRingFill && g.crestRingFill.enabled, opacity: g.opacity && g.opacity.heatmap };
    });

    const res = await page.evaluate(async ([lat]) => {
      const c = window.map.getCanvas();
      const normal = await window.__GRAB__(c.clientWidth);
      window.__GPU_DEBUG__ = { mode: 'mask' };
      await new Promise((r) => setTimeout(r, 2200));
      const dbg = await window.__GRAB__(c.clientWidth);
      window.__GPU_DEBUG__ = { mode: null };
      const e = window.__MARINE_ENGINE__;
      const sc = normal.W / c.clientWidth;
      const pts = []; for (let L = -84.6; L <= -80.6; L += 0.2) pts.push(+L.toFixed(2));
      const m = e.probeMaskGPU(pts.map((lng) => ({ lng, lat })));
      return pts.map((lng, i) => {
        const s = window.map.project([lng, lat]);
        const x = Math.round(s.x * sc), y = Math.round(s.y * sc);
        if (x < 0 || x >= normal.W || y < 0 || y >= normal.H) return { lng, off: true };
        const j = (y * normal.W + x) * 4;
        const nr = normal.d[j], ng = normal.d[j + 1], nb = normal.d[j + 2];
        const dr = dbg.d[j], dg = dbg.d[j + 1], db = dbg.d[j + 2];
        return { lng, mask: m[i] && m[i].effective,
          normal: [nr, ng, nb], chroma: Math.max(nr, ng, nb) - Math.min(nr, ng, nb),
          debug: [dr, dg, db], greyish: Math.abs(dr - dg) < 25 && Math.abs(dg - db) < 25,
          changed: Math.abs(nr - dr) + Math.abs(ng - dg) + Math.abs(nb - db) > 20 };
      });
    }, [LAT]);

    log(`\n===== z${state.z}  resident ${state.cols}x${state.rows}  blendBoth=${state.blendBoth} bridge=${state.bridge} wash=${state.washEff} mask=${state.maskDims} draws=${state.drawCalls} ringFill=${state.crestRingFill} opacity=${state.opacity}`);
    log(`lat ${LAT} transect  (FIELD = chroma>60; HEATMAP = debug frame turned grey; OTHER = debug frame unchanged colour)`);
    for (const r of res) {
      if (r.off) { log(`  lng ${String(r.lng).padStart(6)}  offscreen`); continue; }
      const painted = r.chroma > 60;
      const attribution = !painted ? 'bare'
        : (r.changed && r.greyish ? 'HEATMAP' : 'OTHER-PASS/BASEMAP');
      const flag = (painted && r.mask < 128) ? '   <<< PAINTED OVER LAND' : '';
      log(`  lng ${String(r.lng).padStart(6)}  mask=${String(r.mask).padStart(3)}(${r.mask < 128 ? 'LAND ' : 'water'})  N=${String(r.normal).padEnd(12)} c=${String(r.chroma).padStart(3)} ${painted ? 'FIELD' : 'bare '}  D=${String(r.debug).padEnd(12)} -> ${attribution}${flag}`);
    }
    await page.screenshot({ path: path.join(outdir, `z${state.z}.png`) });
  }

  await context.close();
  await browser.close();
}
main().catch((e) => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
