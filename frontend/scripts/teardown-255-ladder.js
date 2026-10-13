/**
 * teardown-255-ladder.js — the control for the teardown's attribution.
 *
 * THE CLAIM TO TEST. teardown-255.js found that at the measuring camera (z9.30) the viewport overlay
 * mask is NOT engaged — `__RAW_GPU__.overlayMask = {on:false, reason:'coverage_gap', bounds:null}`
 * and every probeMaskGPU read falls back to `src:'coarse_base'`, the world grid. If that is why the
 * field holds ~830 m off the coast at bearing 255°, then the hole is a property of the COARSE MASK,
 * and every lever that came back null did so because it acts on the overlay path that is switched off.
 *
 * ⭐ THE TEST HAS TO BE IN METRES, NOT PIXELS. A fixed GEOGRAPHIC error grows in px as you zoom in; a
 * fixed PIXEL error does not. Reporting px would let a coarse-mask hole masquerade as a shrinking one
 * (or vice versa) purely through the unit. So: walk the coast normal at each zoom, convert to metres,
 * and read the hole against the overlay's engagement state.
 *
 *   overlay OFF, hole large in metres, roughly constant   ⇒ the coarse mask owns the coast here
 *   hole collapses exactly when overlayMask.on flips true ⇒ attribution proven, and the fix is
 *                                                            COVERAGE, not coastline fidelity
 *   hole survives with the overlay ON                     ⇒ attribution refuted; it is not coverage
 *
 * HOLE = the first basemap-water sample whose painted pixel still equals its OWN waves-OFF colour.
 * Comparing each pixel to itself is what makes this immune to the basemap restyle the Waves toggle
 * causes — the rule that has held throughout this arc.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-ladder-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[ladder] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const ZOOMS = [9.3, 10.4, 11.4, 12.4, 13.4];

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
      const mag = Math.hypot(sx, sy) || 1;
      const nx = sx / mag, ny = sy / mag;
      const rows = [];
      for (let d = -10; d <= 160; d++) {
        const x = c0.x + nx * d, y = c0.y + ny * d;
        rows.push({ d, water: isWater(x, y), c: px(x, y) });
      }
      resolve({ dpr, nx: +nx.toFixed(3), ny: +ny.toFixed(3), ringWater: nW, ringLand: nL, rows,
        overlayMask: (window.__RAW_GPU__ || {}).overlayMask || null,
        zoom: +m.getZoom().toFixed(3),
        mPerCssPx: +(156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2).toFixed(2) });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
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

  const rows = [];
  log(' zoom   overlay.on  reason                m/cssPx   HOLE(css)   HOLE(metres)   verdict');
  for (const z of ZOOMS) {
    await setWaves(true);
    await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
    await page.evaluate(({ p, zz }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: zz }), { p: PT, zz: z });
    await page.waitForTimeout(14000);
    const ON = await page.evaluate(samplePass, { pt: PT });
    await page.screenshot({ path: path.join(outdir, `LADDER_z${z}.png`) });
    await setWaves(false); await page.waitForTimeout(7000);
    const OFF = await page.evaluate(samplePass, { pt: PT });

    if (ON.void || OFF.void) { log(` ${String(z).padStart(5)}   VOID ${ON.void || OFF.void}`); rows.push({ z, void: ON.void || OFF.void }); continue; }
    const d3 = (a, b) => (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const shore = ON.rows.find((r) => r.water === true);
    let hole = null;
    if (shore) {
      const first = ON.rows.find((r) => r.d >= shore.d && r.water === true &&
        (d3(r.c, (OFF.rows.find((q) => q.d === r.d) || {}).c) || 0) > 10);
      hole = first ? first.d - shore.d : null;
    }
    const om = ON.overlayMask || {};
    const holeM = hole === null ? null : +(hole * ON.mPerCssPx).toFixed(0);
    rows.push({ z, overlayOn: !!om.on, reason: om.reason, mPerCssPx: ON.mPerCssPx,
      holeCssPx: hole, holeMetres: holeM, shoreD: shore ? shore.d : null, ringWater: ON.ringWater, ringLand: ON.ringLand });
    log(` ${String(z).padStart(5)}   ${String(!!om.on).padEnd(10)}  ${String(om.reason).padEnd(20)}  `
      + `${String(ON.mPerCssPx).padStart(7)}   ${String(hole).padStart(9)}   ${String(holeM).padStart(12)}   `
      + (hole === null ? 'no field found within 160 px' : hole === 0 ? 'no hole' : ''));
  }
  log('');
  const off = rows.filter((r) => !r.void && !r.overlayOn && r.holeMetres !== null);
  const on = rows.filter((r) => !r.void && r.overlayOn && r.holeMetres !== null);
  if (!off.length || !on.length) {
    log('INCONCLUSIVE — the ladder never crossed the overlay engagement boundary '
      + `(overlay ON at ${on.length} zooms, OFF at ${off.length}). No contrast, so no attribution.`);
  } else {
    const offMax = Math.max(...off.map((r) => r.holeMetres)), onMax = Math.max(...on.map((r) => r.holeMetres));
    log(`overlay OFF: hole up to ${offMax} m   |   overlay ON: hole up to ${onMax} m`);
    log(onMax <= 200 && offMax >= 400
      ? 'ATTRIBUTION HOLDS — the hole belongs to the coarse world mask, and it collapses when the overlay engages.'
      : 'ATTRIBUTION REFUTED — the hole does not track the overlay engagement state.');
  }
  fs.writeFileSync(path.join(outdir, 'ladder.json'), JSON.stringify({ base: BASE, pt: PT, rows }, null, 1));
  log('written: ' + path.join(outdir, 'ladder.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
