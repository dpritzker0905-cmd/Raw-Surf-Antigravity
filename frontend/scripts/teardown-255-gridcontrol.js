/**
 * teardown-255-gridcontrol.js — hold the zoom, vary ONLY the data grid.
 *
 * WHERE THE TEARDOWN GOT TO. At 255° the mask reads 255 (full water) on every term through the whole
 * hole, no basemap layer is unique to it, and the painted pixel is byte-identical to waves-OFF: the
 * field is simply never drawn. The one term left standing is the WAVE DATA, and its geometry fits —
 * arriving at z9.3 the resident grid is still the PREVIOUS REGION (Florida, west −81.5) while z10.4+
 * hold Madeira (west −18.23), and the hole is 836 m at z9.3 against 24–98 m above it.
 *
 * ⛔ BUT ZOOM AND GRID MOVED TOGETHER, so that is a correlation, not a cause — the same confound that
 * has already produced two contradictory lever sweeps in this arc. Separate them:
 *
 *   COLD   jump straight to z9.3      → Madeira grid absent   (expect the 836 m hole to reproduce)
 *   WARM   z11.4 first, THEN to z9.3  → Madeira grid resident (SAME ZOOM, SAME PIXEL SCALE)
 *
 * The zoom, the camera, the mask path and the screen scale are identical in both legs; the only thing
 * that differs is which wave grid is loaded.
 *
 *   WARM hole collapses  ⇒ PROVEN: the residual is data coverage, not coastline fidelity, and no
 *                          mask lever could ever have moved it.
 *   WARM hole unchanged  ⇒ REFUTED: the grid is a passenger and the cause is zoom-dependent.
 *
 * Each leg gets its own browser context so the warm leg cannot leak into the cold one — the harness
 * isolation lesson from the lever sweep, applied up front.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-gridcontrol-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[gridctl] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const Z = 9.30;
const LEGS = [
  { id: 'COLD_direct_to_z9.3', warmup: null },
  { id: 'WARM_via_z11.4', warmup: 11.4 },
];

const samplePass = ({ pt }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = () => {
      m.off('render', fn);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const waterIds = (m.getStyle().layers || [])
        .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
        .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const isWater = (cx, cy) => {
        if (!(cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height)) return null;
        if ((document.elementFromPoint(cx, cy) || {}).tagName !== 'CANVAS') return null;
        try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
      };
      const c0 = m.project([pt.lng, pt.lat]);
      const R = 14; let sx = 0, sy = 0, nW = 0, nL = 0;
      for (let a = 0; a < 72; a++) {
        const th = (a / 72) * 2 * Math.PI;
        const w = isWater(c0.x + R * Math.cos(th), c0.y + R * Math.sin(th));
        if (w === true) { sx += Math.cos(th); sy += Math.sin(th); nW++; }
        else if (w === false) nL++;
      }
      if (nW < 6 || nL < 6) { resolve({ void: `ring not a coast (w${nW}/l${nL})` }); return; }
      const mag = Math.hypot(sx, sy) || 1, nx = sx / mag, ny = sy / mag;
      const rows = [];
      for (let d = -10; d <= 60; d++) rows.push({ d, water: isWater(c0.x + nx * d, c0.y + ny * d), c: px(c0.x + nx * d, c0.y + ny * d) });
      const eng = window.__MARINE_ENGINE__ || {};
      resolve({ dpr, rows, ringWater: nW, ringLand: nL,
        zoom: +m.getZoom().toFixed(3),
        overlayMask: (window.__RAW_GPU__ || {}).overlayMask || null,
        waveBounds: eng._waveData && eng._waveData.bounds ? eng._waveData.bounds : null,
        mPerCssPx: +(156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2).toFixed(2) });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

async function runLeg(browser, leg) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  }, on);
  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });

  if (leg.warmup) {
    await page.evaluate(({ p, zz }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: zz }), { p: PT, zz: leg.warmup });
    await page.waitForTimeout(18000);
  }
  await page.evaluate(({ p, zz }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: zz }), { p: PT, zz: Z });
  await page.waitForTimeout(16000);
  const ON = await page.evaluate(samplePass, { pt: PT });
  await page.screenshot({ path: path.join(outdir, `GRIDCTL_${leg.id}.png`) });
  await setWaves(false); await page.waitForTimeout(7000);
  const OFF = await page.evaluate(samplePass, { pt: PT });
  await ctx.close();
  if (ON.void || OFF.void) return { leg: leg.id, void: ON.void || OFF.void };

  const d3 = (a, b) => (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const shore = ON.rows.find((r) => r.water === true);
  let hole = null;
  if (shore) {
    const first = ON.rows.find((r) => r.d >= shore.d && r.water === true &&
      (d3(r.c, (OFF.rows.find((q) => q.d === r.d) || {}).c) || 0) > 10);
    hole = first ? first.d - shore.d : null;
  }
  const wb = ON.waveBounds;
  return { leg: leg.id, zoom: ON.zoom, mPerCssPx: ON.mPerCssPx,
    overlayReason: ON.overlayMask && ON.overlayMask.reason,
    waveWest: wb ? +wb.west.toFixed(3) : null,
    gridIsMadeira: !!(wb && wb.west < -14 && wb.west > -22 && wb.north > 32),
    holeCssPx: hole, holeMetres: hole === null ? null : +(hole * ON.mPerCssPx).toFixed(0) };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const rows = [];
  log('leg                    zoom   overlay             grid=Madeira  waveWest   HOLE(css)  HOLE(m)');
  for (const leg of LEGS) {
    const r = await runLeg(browser, leg);
    rows.push(r);
    if (r.void) { log(`${r.leg.padEnd(22)} VOID ${r.void}`); continue; }
    log(`${r.leg.padEnd(22)} ${String(r.zoom).padStart(5)}   ${String(r.overlayReason).padEnd(18)}  `
      + `${String(r.gridIsMadeira).padEnd(12)}  ${String(r.waveWest).padStart(8)}  ${String(r.holeCssPx).padStart(9)}  ${String(r.holeMetres).padStart(7)}`);
  }
  log('');
  const cold = rows.find((r) => r.leg.startsWith('COLD')), warm = rows.find((r) => r.leg.startsWith('WARM'));
  if (!cold || !warm || cold.void || warm.void || cold.holeMetres === null || warm.holeMetres === null) {
    log('INCONCLUSIVE — a leg did not produce a hole measurement.');
  } else if (!warm.gridIsMadeira) {
    log('INCONCLUSIVE — the WARM leg never loaded the Madeira grid, so the intervention did not happen. '
      + 'This is NOT evidence either way; lengthen the warm-up and re-run.');
  } else if (cold.gridIsMadeira) {
    log('INCONCLUSIVE — the COLD leg ALSO had the Madeira grid, so the two legs are not contrasted. '
      + 'The cold path must arrive at z9.3 without the regional grid for this test to mean anything.');
  } else {
    log(`same zoom ${cold.zoom} / same scale ${cold.mPerCssPx} m per css px, only the grid differs:`);
    log(`  COLD (grid absent):  ${cold.holeMetres} m      WARM (grid resident): ${warm.holeMetres} m`);
    log(warm.holeMetres <= cold.holeMetres * 0.4
      ? 'PROVEN — the 255 deg residual is DATA COVERAGE, not coastline fidelity. No mask lever could move it.'
      : 'REFUTED — the grid is a passenger; the hole does not follow it at fixed zoom.');
  }
  fs.writeFileSync(path.join(outdir, 'gridcontrol.json'), JSON.stringify({ base: BASE, pt: PT, z: Z, rows }, null, 1));
  log('written: ' + path.join(outdir, 'gridcontrol.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
