/**
 * coastband-ladder.js — measure the residual coastal band BELOW the carve threshold.
 *
 * CONTEXT. LOP-0002 attributed the band that remained after the `ocean-mask-buffer` fix to
 * `MIDZOOM_OVERLAY_CARVE_MIN_Z`: below it the viewport-truth overlay never runs, so the marine
 * field's coastline comes from GENERALIZED land geometry instead of basemap water truth, and the
 * field is masked off real water by the generalization error. LOP-0003 shipped 9 -> 8. That moved
 * the boundary; it did not remove the regime. Everything below z8 still runs on generalized truth.
 *
 * THE JACOBIAN. If the mechanism is a FIXED GROUND ERROR, then
 *      band_px(z) = band_km / metres_per_pixel(z),      m/px = 78271.5 * cos(lat) / 2^z / dpr
 * so band_km is INVARIANT in z and band_px halves per zoom level out. Two refutations:
 *   - band_px roughly constant across the ladder  => band_km GROWS as you zoom out => the cause is
 *     screen-space (a shader/compositing width), NOT geometry generalization.
 *   - band_km grows below the world-grid switch   => a SECOND mechanism (the coarse base pass
 *     REPLACEs with PADDED overlay bounds, WebGLMarineEngine.js:3096) owns the wide regime.
 * A mechanism that predicts the wrong SIGN is refuted, not partial.
 *
 * THE INSTRUMENT. Never asks a layer whether it painted; asks the PIXELS.
 *   pass A (Waves ON)  : canvas pixels along fixed GEOGRAPHIC transects
 *   pass B (Waves OFF) : the same transects -> basemap reference pixels + per-sample basemap
 *                        water truth from queryRenderedFeatures on the vector water layers
 *   band = the run of samples that are basemap WATER but where ON == OFF (the field did not paint),
 *          measured outward from the land->water transition.
 * Both controls are mandatory (a 0 is worthless without a positive control):
 *   NEG  z8.4 stock            -> carve engaged -> band must be ~0
 *   POS  z8.4 carve disabled   -> band must be > 0, or the instrument is blind and every 0 is void
 *
 * Usage:  CB_BASE=https://dev--rawsurf.netlify.app node scripts/coastband-ladder.js <outdir>
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.CB_BASE || 'https://dev--rawsurf.netlify.app';
const THEME = process.env.CB_THEME || 'beach';
// POSITIVE CONTROL: kill basemap water truth BEFORE the map loads, so no stale overlay covers the
// view. The mask then falls back to the generalized coastline geojson — the exact mechanism LOP-0002
// blames — and must produce a band, or every zero this harness reports is void.
const KILL_WATERMASK = process.env.CB_KILL_WATERMASK === '1';
const outdir = process.argv[2] || path.join(__dirname, 'coastband-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[coastband] ' + m);

const CENTER = [-79.35, 26.85];
// Long enough that the land->water transition is FOUND, not assumed. from = expected landward end.
const TRANSECTS = [
  { id: 'FL-A', coast: 'SE Florida (control coast)', from: [-80.35, 26.60], to: [-79.85, 26.60] },
  { id: 'FL-B', coast: 'SE Florida (control coast)', from: [-80.35, 27.20], to: [-79.85, 27.20] },
  { id: 'GB-A', coast: 'Grand Bahama (owner coast)', from: [-78.65, 26.55], to: [-78.65, 26.90] },
  { id: 'GB-B', coast: 'Grand Bahama (owner coast)', from: [-78.45, 26.55], to: [-78.45, 26.90] },
];
// id, zoom, flags. z8.4 appears twice in the ON pass: stock (negative control) and carve-off (positive).
const STOPS = [
  { id: 'z8.40_stock', z: 8.40, flags: {} },
  { id: 'z8.40_carveoff_POSCTRL', z: 8.40, flags: { __RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__: true } },
  { id: 'z8.00_boundary', z: 8.00, flags: {} },
  { id: 'z7.90', z: 7.90, flags: {} },
  { id: 'z7.50', z: 7.50, flags: {} },
  { id: 'z7.00', z: 7.00, flags: {} },
  { id: 'z6.50', z: 6.50, flags: {} },
  { id: 'z6.00', z: 6.00, flags: {} },
  { id: 'z5.00', z: 5.00, flags: {} },
];
const CARVE_FLAG = '__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__';

const USER = {
  id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true,
};

const findWaves = () => {
  const all = Array.from(document.querySelectorAll('button'));
  let b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
  if (!b) {
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')) &&
      !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
  }
  return b || null;
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('crash', () => log('*** PAGE CRASHED ***'));
  // ⛔ VALIDITY GATE, added after the fact. useWebGLGuardrail drops the WebGL marine layer to
  // Open-Meteo RASTER TILES after 12 consecutive seconds under 20 FPS — measured firing at t=51 s
  // under SwiftShader. Any run longer than that is measuring third-party height tiles, not this
  // codebase's marine field. Runs before this flag existed are suspect for exactly that reason.
  if (process.env.CB_NO_GUARDRAIL === '1') {
    await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
    log('guardrail DISABLED — the WebGL marine field stays the painter for the whole run');
  }
  if (KILL_WATERMASK) {
    await page.addInitScript(() => { window.__RAW_BASEMAP_WATER_MASK__ = false; });
    log('POSITIVE CONTROL ARMED: __RAW_BASEMAP_WATER_MASK__ = false before any map load');
  }

  // Auth + theme + consent seeded exactly as frontend/e2e does — no credentials.
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(({ u, theme }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', theme);   // PIN THE THEME (light hid this band, beach showed it)
  }, { u: USER, theme: THEME });

  log('goto /map  base=' + BASE + '  theme=' + THEME);
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // NB: window.__MARINE_ENGINE__ is NOT reliably present on the deployed build (measured — it is
  // absent or transient, so every engine-sourced field silently reads null). Gate on window.map and
  // on the marine render path's own telemetry instead, and record the handle rather than assume it.
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });

  const env = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no-gl'),
      theme: localStorage.getItem('raw-surf-theme'),
      themeClass: document.documentElement.className,
      dpr: window.devicePixelRatio,
    };
  });
  log('renderer=' + env.renderer + ' dpr=' + env.dpr + ' themeClass=' + env.themeClass);

  const build = await page.evaluate(async () => {
    try { const r = await fetch('/service-worker.js', { cache: 'no-store' }); const t = await r.text();
      const m = t.match(/BUILD_VERSION\s*=\s*'([^']+)'/); return m ? m[1] : 'unknown';
    } catch (e) { return 'fetch-failed'; }
  });
  log('deployed BUILD_VERSION=' + build);

  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 60000 });
  await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
  // The marine render path writes __RAW_GPU__.overlayMask every frame it runs — its APPEARANCE is
  // proof the field rendered at least once, and it does not depend on the missing engine handle.
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  log('marine render path has run (engine handle present: ' +
    (await page.evaluate(() => !!window.__MARINE_ENGINE__)) + ')');

  // Dev-overlay guard (the trap zoomlab hit): a full-viewport iframe eats input and screenshots.
  const removed = await page.evaluate(() => {
    let n = 0;
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) { f.remove(); n++; }
    }
    return n;
  });
  if (removed) log('dev-overlay iframes removed: ' + removed);

  const readState = () => page.evaluate(() => {
    const g = window.__RAW_GPU__ || {};
    const e = window.__MARINE_ENGINE__;
    const b = window.map.getBounds();
    const span = (o) => (o ? +(o.east - o.west).toFixed(3) : null);
    return {
      z: +window.map.getZoom().toFixed(3),
      center: window.map.getCenter().toArray().map((v) => +v.toFixed(4)),
      view: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      overlayOn: g.overlayMask ? g.overlayMask.on : null,
      overlayReason: g.overlayMask ? g.overlayMask.reason : null,
      overlayCoversView: g.overlayMask ? g.overlayMask.overlayCoversView : null,
      maskDelivered: g.maskDelivered || null,
      basemapWaterMask: g.basemapWaterMask || null,
      // REGIME. The overlay's REPLACE branch ("coverage_gap"/"world_grid") is driven by the resident
      // grid, not by MIDZOOM_OVERLAY_CARVE_MIN_Z; which grid is resident therefore decides whether
      // the carve threshold is even the operative gate. The legend states it in the UI.
      gridLegend: (() => {
        const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /km grid/.test(n.textContent || ''));
        return el ? el.textContent.trim() : null;
      })(),
      // STALENESS. __RAW_GPU__ is written by the render path; if it did not run for this camera the
      // values are last frame's. The reported eastGap is checkable against the LIVE view, so the
      // harness can tell "measured here" from "left over from somewhere else" instead of guessing.
      telemetryStale: (() => {
        const md = g.maskDelivered, ob = g.overlayMask && g.overlayMask.bounds;
        if (!md || !ob || typeof md.eastGap !== 'number') return null;
        return Math.abs((b.getEast() - ob.east) - md.eastGap) > 0.05;
      })(),
      engineHandle: !!e,
      repatchReason: e ? e._lastMaskRepatchReason : null,
      maskSpan: span(e && e._cachedMaskBounds), dataSpan: span(e && e._waveData && e._waveData.bounds),
      overlaySpan: span(e && e._overlayMaskBounds),
      bufferVisibility: (() => { try { return window.map.getLayoutProperty('ocean-mask-buffer', 'visibility'); } catch (x) { return 'absent'; } })(),
    };
  });

  // ── the sampler: canvas pixels + (optionally) basemap water truth along each transect ──
  const sample = (transects, wantWater) => page.evaluate(async ({ tr, wantWater }) => {
    const m = window.map;
    await new Promise((res) => { const fn = () => { m.off('render', fn); res(); }; m.on('render', fn); m.triggerRepaint(); });
    const src = m.getCanvas();
    const rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    c2.drawImage(src, 0, 0);
    const img = c2.getImageData(0, 0, cv.width, cv.height).data;
    const waterIds = (() => {
      try {
        const ids = (m.getStyle().layers || [])
          .filter((l) => l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id))
          .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
        return ids.length ? ids : ['water'];
      } catch (e) { return ['water']; }
    })();
    const out = [];
    for (const t of tr) {
      const p0 = m.project(t.from), p1 = m.project(t.to);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const cssLen = Math.hypot(dx, dy);
      const n = Math.max(2, Math.round(cssLen * dpr));   // one sample per DEVICE pixel
      const rgb = new Array(n + 1).fill(null);
      const water = new Array(n + 1).fill(null);
      let offscreen = 0;
      for (let i = 0; i <= n; i++) {
        const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
        const px = Math.round(cx * dpr), py = Math.round(cy * dpr);
        if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) { offscreen++; continue; }
        const o = (py * cv.width + px) * 4;
        rgb[i] = [img[o], img[o + 1], img[o + 2]];
        if (wantWater && cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height) {
          try { water[i] = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { water[i] = null; }
        }
      }
      out.push({ id: t.id, n, cssLen: +cssLen.toFixed(2), devLen: +(cssLen * dpr).toFixed(2), offscreen, rgb, water });
    }
    return { dpr, waterIds, transects: out };
  }, { tr: transects, wantWater });

  const settle = async (z) => {
    await page.evaluate(({ c, zz }) => window.map.jumpTo({ center: c, zoom: zz }), { c: CENTER, zz: z });
    await page.waitForTimeout(1500);
    try { await page.waitForFunction(() => window.map.isStyleLoaded() && window.map.loaded(), null, { timeout: 30000 }); }
    catch (e) { log('  (settle: style/loaded wait timed out — recorded, not assumed)'); }
    await page.waitForTimeout(6000);   // the engine repaints the mask on idle/zoomend, not on jumpTo
    await page.evaluate(() => window.map.triggerRepaint());
    await page.waitForTimeout(1200);
  };

  const report = {
    generated_at: new Date().toISOString(), base: BASE, deployed_build: build, theme: THEME,
    env, center: CENTER, transects: TRANSECTS, viewport: { w: 1280, h: 800, dpr: 2 },
    passes: {},
  };

  // ── PASS A: Waves ON ──
  log('=== PASS A — Waves ON ===');
  const passA = [];
  for (const s of STOPS) {
    await page.evaluate(([flag, on]) => { if (on) window[flag] = true; else delete window[flag]; },
      [CARVE_FLAG, !!s.flags[CARVE_FLAG]]);
    await settle(s.z);
    const st = await readState();
    const sm = await sample(TRANSECTS, false);
    await page.screenshot({ path: path.join(outdir, 'ON_' + s.id + '.png') });
    passA.push({ stop: s.id, targetZ: s.z, carveDisabled: !!s.flags[CARVE_FLAG], state: st, sample: sm });
    log(`  ${s.id}: z=${st.z} overlayOn=${st.overlayOn} reason=${st.overlayReason} stale=${st.telemetryStale} grid="${st.gridLegend}" buffer=${st.bufferVisibility}`);
  }
  await page.evaluate((f) => { delete window[f]; }, CARVE_FLAG);

  // ── PASS B: Waves OFF (basemap reference + water truth) ──
  log('=== PASS B — Waves OFF (basemap reference) ===');
  await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') === 'true') b.click(); })()`);
  await page.waitForTimeout(6000);
  const wavesOff = await page.evaluate(`(() => { const b = (${findWaves.toString()})(); return b ? b.getAttribute('aria-pressed') : 'no-button'; })()`);
  log('waves aria-pressed now: ' + wavesOff);
  const passB = [];
  for (const s of STOPS) {
    if (passB.some((p) => p.targetZ === s.z)) continue;       // one basemap frame per zoom
    await settle(s.z);
    const st = await readState();
    const sm = await sample(TRANSECTS, true);
    await page.screenshot({ path: path.join(outdir, 'OFF_z' + s.z.toFixed(2) + '.png') });
    passB.push({ stop: 'z' + s.z.toFixed(2), targetZ: s.z, state: st, sample: sm });
    log(`  z${s.z.toFixed(2)}: waterIds=${sm.waterIds.join(',')} n=${sm.transects.map((t) => t.n).join('/')}`);
  }

  report.passes = { waves_on: passA, waves_off: passB, waves_off_aria: wavesOff };
  fs.writeFileSync(path.join(outdir, 'coastband-raw.json'), JSON.stringify(report));
  log('raw written: ' + path.join(outdir, 'coastband-raw.json'));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
