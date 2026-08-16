/**
 * halo-isolate.js — SURFACE ATTRIBUTION for the land-mask halo (Audit 3.1 Gate 2 / A3.1-05).
 *
 * "Halo" names at least four visually confusable mechanisms: the heatmap wash (mask-short strip),
 * crest particles (their own data-bounds-only OOB contract), the GPU overlay REPLACE flood, and the
 * deliberate OceanMask style coast band. A whole-scene A/B cannot say WHICH surface painted a bad
 * pixel. This script drives a REAL wheel ladder into the delivered-short SAFE_DEGRADED state at the
 * historical coast, then captures an isolation matrix AT THE SAME SETTLED CAMERA, one lever at a
 * time, with per-leg renderer-state snapshots and per-rect pixel extracts so every diff is
 * state-conditioned (the H6 lesson: never compare two frames without proving same-state).
 *
 * Legs (each: flags applied per-frame-readable window levers, 2 rAF + settle, capture):
 *   L1 composite_clip_on      — the lane's default render
 *   L2 composite_clip_off     — __RAW_DISABLE_MASK_SHORT_CLIP__ (the terminal-clip A/B)
 *   L3 gate_off               — __RAW_DISABLE_HEATMAP_BOUNDS_GATE__ (MUST be a null diff vs L1 —
 *                               the measured pixel-inert gate is the built-in negative control)
 *   L4 particles_off          — __RAW_CREST_LAND_THRESH__=9 (+ SDF off so the threshold path is
 *                               taken): every crest center discards; wash+style remain
 *   L4b particles_off_clip_off— crest-free clip A/B (the halo A/B without crest noise)
 *   L5 style_buffer_hidden    — MapLibre setLayoutProperty('ocean-mask-buffer','visibility','none')
 *   L6 basemap_reference      — Waves layer toggled OFF (pure basemap ground truth; LAST because
 *                               re-enabling refetches and may reset the short state)
 *
 * Analysis rects (projected per capture, so camera identity is enforced not assumed):
 *   - gap strips: view bounds minus the engine's LIVE _cachedMaskBounds, one per short edge —
 *     the exact region the SAFE_DEGRADED clip governs;
 *   - a fixed LAND band on the Florida mainland (lng −81.00..−80.75, lat 28.10..28.60) — marine
 *     paint here IS the user-visible halo, whatever surface produced it;
 *   - an in-mask OCEAN control band — proves levers didn't nuke the honest field.
 *
 * Usage: ZL_BASE=http://localhost:3011 node scripts/halo-isolate.js <outdir>
 * Output: halo-isolate-report.json (stats + base64 rect pixels + per-leg state) and one PNG per leg.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.ZL_BASE || 'http://localhost:3011';
const outdir = process.argv[2] || path.join(__dirname, 'halo-isolate-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[halo-isolate] ' + m);

const LAND_BAND = { west: -81.00, south: 28.10, east: -80.75, north: 28.60 };
const OCEAN_BAND = { west: -80.35, south: 28.10, east: -80.10, north: 28.60 };

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });
  page.on('crash', () => log('*** PAGE CRASHED ***'));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log('framenavigated: ' + f.url()); });
  log('goto /map');
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 90000 });
  try {
    await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
      if (d) d.click();
    });
  } catch (e) {}
  // Enable Waves via its real button (zoomlab house pattern).
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
  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 45000 });
  await page.evaluate(`(() => {
    const b = (${findWaves.toString()})();
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  })()`);
  await page.waitForFunction(() => {
    const e = window.__MARINE_ENGINE__;
    return e && e._waveData && e._waveData.bounds;
  }, null, { timeout: 90000 });
  log('waves resident committed');
  // DEV-OVERLAY GUARD (same trap zoomlab hit): remove full-viewport dev iframes or real wheel dies.
  const removed = await page.evaluate(() => {
    let n = 0;
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) { f.remove(); n++; }
    }
    return n;
  });
  if (removed) log('dev-overlay iframes removed: ' + removed);

  await page.evaluate(() => window.map.jumpTo({ center: [-80.2, 28.33], zoom: 9 }));
  await page.waitForTimeout(5000);
  await page.mouse.move(640, 400);

  const readState = () => page.evaluate(() => {
    const g = window.__RAW_GPU__ || {};
    const e = window.__MARINE_ENGINE__;
    const b = window.map.getBounds();
    return {
      z: +window.map.getZoom().toFixed(3),
      view: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      terminal: g.heatmapGate && g.heatmapGate.resident && g.heatmapGate.resident.terminal,
      clipValue: g.heatmapGate && g.heatmapGate.resident && g.heatmapGate.resident.clipValue,
      gateLocationActive: g.heatmapGate && g.heatmapGate.resident && g.heatmapGate.resident.gateLocationActive,
      mDel: g.maskDelivered || null,
      ovl: g.overlayMask && g.overlayMask.reason,
      maskBounds: e && e._cachedMaskBounds ? { ...e._cachedMaskBounds } : null,
      dataBounds: e && e._waveData && e._waveData.bounds ? { ...e._waveData.bounds } : null,
      overlayBounds: e && e._overlayMaskBounds ? { ...e._overlayMaskBounds } : null,
    };
  });

  // ── Hunt the SAFE_DEGRADED state with real wheel notches. Two modes:
  //    default — out-ladder from z9 (the regional mask==data regime; strip belongs to the WASH);
  //    HI_WORLD=1 — zoom OUT until the WORLD grid is resident, then ROUTE-ABORT the backend so the
  //    regional sharpen can never land (client-side mask rebuilds continue), then walk back IN:
  //    the world quad + viewport-scoped mask is the mask≠data regime of the 2026-08-01 live halo
  //    measurement — the resident pass rasterizes the strip and the SAFE_DEGRADED clip governs it.
  let state = null, found = false;
  if (process.env.HI_WORLD === '1') {
    log('WORLD MODE: zooming out to force the world grid resident');
    for (let i = 0; i < 42; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(90); }
    await page.waitForTimeout(9000);
    state = await readState();
    const span = state.dataBounds ? (state.dataBounds.east - state.dataBounds.west) : 0;
    log(`after zoom-out: z=${state.z} data span=${span.toFixed(1)}`);
    if (span < 340) log('*** world grid NOT resident — world-mode preconditions failed ***');
    let blocked = 0;
    await page.route('**raw-surf**', (route) => { blocked++; route.abort(); });
    await page.route('**onrender.com**', (route) => { blocked++; route.abort(); });
    log('backend route-abort armed (regional sharpen starved)');
    for (let i = 0; i < 30 && !found; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(2300);
      state = await readState();
      const dspan = state.dataBounds ? (state.dataBounds.east - state.dataBounds.west) : 0;
      const mspan = state.maskBounds ? (state.maskBounds.east - state.maskBounds.west) : 0;
      log(`in-notch ${i}: z=${state.z} dataSpan=${dspan.toFixed(1)} maskSpan=${mspan.toFixed(2)} terminal=${state.terminal} ovl=${state.ovl} mDel=${JSON.stringify(state.mDel && [state.mDel.deliveredShort, state.mDel.forcedRepaint, state.mDel.eastGap, state.mDel.westGap])}`);
      if (state.terminal === 'safe_degraded' && dspan >= 340 && mspan > 0 && mspan < 340) found = true;
      if (state.z >= 8.6) break;
    }
    log('backend requests blocked so far: ' + blocked);
  } else {
    for (let leg = 0; leg < 2 && !found; leg++) {
      const notches = leg === 0 ? 14 : 10;
      const dir = leg === 0 ? 120 : -120;   // out first, then back in through the band
      for (let i = 0; i < notches; i++) {
        await page.mouse.wheel(0, dir);
        await page.waitForTimeout(2300);
        state = await readState();
        log(`notch ${leg}/${i}: z=${state.z} terminal=${state.terminal} ovl=${state.ovl} mDel=${JSON.stringify(state.mDel)}`);
        if (state.terminal === 'safe_degraded') { found = true; break; }
      }
    }
  }
  if (!found) log('*** target state never entered — captures proceed but the clip A/B is VOID (rule 16) ***');
  // Settle the camera fully before the matrix; re-verify state after the settle.
  await page.waitForTimeout(4000);
  state = await readState();
  log('capture camera: z=' + state.z + ' terminal=' + state.terminal + ' mask=' + JSON.stringify(state.maskBounds));

  // ── Analysis rect extraction: map-canvas pixels for a geographic rect (map.project → 2d copy). ──
  const grabRects = (rects) => page.evaluate((rr) => {
    const src = window.map.getCanvas();
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    return new Promise((res) => {
      const fn = () => {
        window.map.off('render', fn);
        ctx.drawImage(src, 0, 0);
        const dpr = src.width / window.map.getContainer().getBoundingClientRect().width;
        const out = {};
        for (const [name, r] of Object.entries(rr)) {
          if (!r) { out[name] = null; continue; }
          const p1 = window.map.project([r.west, r.north]);
          const p2 = window.map.project([r.east, r.south]);
          const x = Math.max(0, Math.round(p1.x * dpr)), y = Math.max(0, Math.round(p1.y * dpr));
          const w = Math.min(cv.width - x, Math.round((p2.x - p1.x) * dpr));
          const h = Math.min(cv.height - y, Math.round((p2.y - p1.y) * dpr));
          if (w < 3 || h < 3) { out[name] = { empty: true, x, y, w, h }; continue; }
          const img = ctx.getImageData(x, y, w, h);
          let sL = 0, sR = 0, sG = 0, sB = 0;
          for (let i = 0; i < img.data.length; i += 4) {
            sR += img.data[i]; sG += img.data[i + 1]; sB += img.data[i + 2];
            sL += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
          }
          const n = img.data.length / 4;
          // CHUNKED base64 (2026-08-15 crash fix): String.fromCharCode.apply on a rect's full
          // Uint8ClampedArray exceeds the engine's apply-argument limit on any band bigger than
          // ~64k entries and killed the first run mid-capture. 0x8000-element chunks are safe.
          let bin = '';
          const cap = Math.min(img.data.length, 1200000);
          for (let o = 0; o < cap; o += 0x8000) {
            bin += String.fromCharCode.apply(null, img.data.subarray(o, Math.min(o + 0x8000, cap)));
          }
          out[name] = {
            x, y, w, h, n,
            meanL: +(sL / n).toFixed(2), meanR: +(sR / n).toFixed(2),
            meanG: +(sG / n).toFixed(2), meanB: +(sB / n).toFixed(2),
            px: btoa(bin),
          };
        }
        res(out);
      };
      window.map.on('render', fn);
      window.map.triggerRepaint();
    });
  }, rects);

  // Gap strips from the LIVE delivered mask vs the LIVE view — the clip's exact jurisdiction.
  const gapStrips = (st) => {
    const v = st.view, m = st.maskBounds;
    if (!m) return {};
    const out = {};
    if (m.east < v.east) out.strip_east = { west: m.east, south: Math.max(v.south, m.south), east: v.east, north: Math.min(v.north, m.north) };
    if (m.west > v.west) out.strip_west = { west: v.west, south: Math.max(v.south, m.south), east: m.west, north: Math.min(v.north, m.north) };
    if (m.north < v.north) out.strip_north = { west: v.west, south: m.north, east: v.east, north: v.north };
    if (m.south > v.south) out.strip_south = { west: v.west, south: v.south, east: v.east, north: m.south };
    return out;
  };

  const LEGS = [
    { id: 'L1_composite_clip_on', flags: {} },
    { id: 'L2_composite_clip_off', flags: { __RAW_DISABLE_MASK_SHORT_CLIP__: true } },
    { id: 'L3_gate_off_control', flags: { __RAW_DISABLE_HEATMAP_BOUNDS_GATE__: true } },
    { id: 'L4_particles_off', flags: { __RAW_DISABLE_COAST_SDF__: true, __RAW_CREST_LAND_THRESH__: 9 } },
    { id: 'L4b_particles_off_clip_off', flags: { __RAW_DISABLE_COAST_SDF__: true, __RAW_CREST_LAND_THRESH__: 9, __RAW_DISABLE_MASK_SHORT_CLIP__: true } },
    { id: 'L5_style_buffer_hidden', flags: {}, styleHide: true },
    { id: 'L6_basemap_reference', flags: {}, wavesOff: true },
  ];
  const ALL_FLAGS = ['__RAW_DISABLE_MASK_SHORT_CLIP__', '__RAW_DISABLE_HEATMAP_BOUNDS_GATE__',
    '__RAW_DISABLE_COAST_SDF__', '__RAW_CREST_LAND_THRESH__'];

  const report = {
    artifact_sha: (() => { try { return execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim(); } catch (e) { return 'unknown'; } })(),
    base: BASE, generated_at: new Date().toISOString(),
    entered_safe_degraded: found, camera: { z: state.z, view: state.view },
    mask_bounds_at_entry: state.maskBounds, legs: [],
  };

  for (const leg of LEGS) {
    // reset all levers, then apply this leg's
    await page.evaluate(([all, flags]) => { for (const f of all) delete window[f]; Object.assign(window, flags); },
      [ALL_FLAGS, leg.flags]);
    if (leg.styleHide) {
      await page.evaluate(() => { try { window.map.setLayoutProperty('ocean-mask-buffer', 'visibility', 'none'); } catch (e) {} });
    }
    if (leg.wavesOff) {
      await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') === 'true') b.click(); })()`);
      await page.waitForTimeout(3500);
    }
    await page.evaluate(() => window.map.triggerRepaint());
    await page.waitForTimeout(1600);
    const st = await readState();
    const rects = { land_band: LAND_BAND, ocean_band: OCEAN_BAND, ...gapStrips(st) };
    let px;
    try {
      px = await grabRects(rects);
    } catch (e) {
      log(`${leg.id}: grabRects failed (${String(e.message).slice(0, 80)}) — one retry after 3s`);
      await page.waitForTimeout(3000);
      px = await grabRects(rects);
    }
    const shot = path.join(outdir, leg.id + '.png');
    await page.screenshot({ path: shot });
    report.legs.push({ id: leg.id, flags: leg.flags, styleHide: !!leg.styleHide, wavesOff: !!leg.wavesOff, state: st, rects: px });
    log(`${leg.id}: terminal=${st.terminal} clip=${st.clipValue} land L=${px.land_band && px.land_band.meanL} ocean L=${px.ocean_band && px.ocean_band.meanL} stripE L=${px.strip_east && px.strip_east.meanL}`);
    if (leg.styleHide) {
      await page.evaluate(() => { try { window.map.setLayoutProperty('ocean-mask-buffer', 'visibility', 'visible'); } catch (e) {} });
    }
  }
  await page.evaluate((all) => { for (const f of all) delete window[f]; }, ALL_FLAGS);

  fs.writeFileSync(path.join(outdir, 'halo-isolate-report.json'), JSON.stringify(report, null, 1));
  log('report written: ' + path.join(outdir, 'halo-isolate-report.json'));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
