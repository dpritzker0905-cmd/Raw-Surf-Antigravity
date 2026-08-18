/**
 * ring-layer-isolate.js — which single layer paints the island ring?
 *
 * ⛔ WHY EVERY PREVIOUS MEASUREMENT MISSED IT. island-halo-survey.js and island-rim-metric.js both
 * suppress EVERY layer above the marine layer before measuring — a defence against the road-shield
 * artifact. But that also hides `ocean-mask-buffer`, `ocean-mask-line` and everything else in the
 * mask family, so those runs measured a scene with all the suspects already removed. They reported
 * "no band" while the owner, whose view has them ON, sees one. The un-suppressed screenshot shows
 * the ring; the suppressed ones do not. That contrast is the finding.
 *
 * THE TEST. Nothing suppressed by default. Measure the rim, then take ONE layer to opacity 0, remeasure,
 * restore, and move to the next. The layer whose removal collapses the rim is the painter.
 *
 * CAMERA. z8.5 at Madeira, where the rim measured strongest (47 px on 24/24 bearings), and where
 * `ocean-mask-buffer`'s opacity ramp (1.0 at z8.5 -> 0 at z9.5) is at full strength. z9.3 is measured
 * too because that is the camera the owner's screenshots came from.
 *
 * ⛔ OPACITY, NEVER `visibility` — OceanMask.js reverts visibility on its sync pass, which would clear
 * a guilty layer with a false negative.
 * ⛔ ORDER FROM `map.style._order`; getStyle().layers omits the custom marine layer.
 *
 * READING IT. A layer is the painter only if removing it collapses the rim AND the open-water control
 * stays quiet — a global change that moves both is a palette shift, not a coastal band.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'ring-isolate-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[ring] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const CAMERAS = [
  { id: 'madeira_z8.5', center: [-16.95, 32.75], z: 8.5 },
  { id: 'madeira_z9.3', center: [-16.95, 32.75], z: 9.3 },
];

const run = ({ nBearings, maxR }) => {
  const m = window.map;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => new Promise((res) => {
    const g = () => {
      m.off('render', g);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
      res({ d: c2.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height,
        dpr: src.width / rect.width, W: rect.width, H: rect.height });
    };
    m.on('render', g); m.triggerRepaint();
  });

  return (async () => {
    const order = (m.style && m.style._order) ? m.style._order.slice() : [];
    const styleIds = new Set((m.getStyle().layers || []).map((l) => l.id));
    const idxs = order.filter((id) => !styleIds.has(id)).map((id) => order.indexOf(id)).filter((i) => i >= 0);
    const marineIdx = idxs.length ? Math.min.apply(null, idxs) : null;
    const PROPS = { line: 'line-opacity', fill: 'fill-opacity', symbol: 'icon-opacity',
      circle: 'circle-opacity', raster: 'raster-opacity' };

    const waterIds = (m.getStyle().layers || [])
      .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
      .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });

    const measure = async () => {
      const S = await snap();
      const pick = (cx, cy) => {
        const X = Math.round(cx * S.dpr), Y = Math.round(cy * S.dpr);
        if (X < 0 || Y < 0 || X >= S.w || Y >= S.h) return null;
        const o = (Y * S.w + X) * 4; return [S.d[o], S.d[o + 1], S.d[o + 2]];
      };
      const isWater = (cx, cy) => {
        if (!(cx >= 0 && cy >= 0 && cx < S.W && cy < S.H)) return null;
        try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
      };
      const dev = (a, b) => (!a || !b) ? 0 : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      const cx0 = S.W / 2, cy0 = S.H / 2;
      const walk = (ux, uy, start) => {
        const far = [];
        for (let r = start + 70; r <= start + 110; r++) {
          if (isWater(cx0 + ux * r, cy0 + uy * r) !== true) continue;
          const c = pick(cx0 + ux * r, cy0 + uy * r); if (c) far.push(c);
        }
        if (far.length < 15) return null;
        const ref = [0, 1, 2].map((k) => far.reduce((s, c) => s + c[k], 0) / far.length);
        let width = 0, peak = 0, broke = false;
        for (let r = start; r <= start + 60; r++) {
          if (isWater(cx0 + ux * r, cy0 + uy * r) !== true) continue;
          const c = pick(cx0 + ux * r, cy0 + uy * r); if (!c) break;
          const d = dev(c, ref);
          if (d > peak) peak = d;
          if (!broke) { if (d > 12) width++; else broke = true; }
        }
        return { width, peak };
      };
      const rims = [], peaks = [];
      for (let i = 0; i < nBearings; i++) {
        const th = (i / nBearings) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
        let shore = null, prevLand = false, seenLand = false;
        for (let r = 6; r <= maxR; r++) {
          const w = isWater(cx0 + ux * r, cy0 + uy * r);
          if (w === null) break;
          if (w === false) { prevLand = true; seenLand = true; continue; }
          if (w === true && prevLand) { shore = r; break; }
        }
        if (shore === null || !seenLand) continue;
        const res = walk(ux, uy, shore);
        if (res) { rims.push(res.width); peaks.push(res.peak); }
      }
      // open-water control: same walk started far offshore
      const ctrl = [];
      for (let i = 0; i < 8; i++) {
        const th = (i / 8) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
        let start = null;
        for (let r = maxR; r >= 40; r--) { if (isWater(cx0 + ux * r, cy0 + uy * r) === true) { start = r - 130; break; } }
        if (start === null || start < 20) continue;
        const res = walk(ux, uy, start);
        if (res) ctrl.push(res.width);
      }
      const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
      return { n: rims.length, rimMed: med(rims), peakMed: med(peaks), ctrlMed: med(ctrl) };
    };

    const stock = await measure();
    const candidates = order
      .filter((id) => /^ocean-mask|^water-shadow$|^water$|buffer|coast/i.test(id))
      .filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });

    const legs = [];
    for (const id of candidates) {
      const layer = m.getLayer(id);
      const prop = PROPS[layer.type];
      if (!prop) { legs.push({ id, type: layer.type, skipped: 'no opacity prop' }); continue; }
      let prev; try { prev = m.getPaintProperty(id, prop); } catch (e) { legs.push({ id, skipped: 'unreadable' }); continue; }
      try { m.setPaintProperty(id, prop, 0); } catch (e) { legs.push({ id, skipped: 'unsettable' }); continue; }
      m.triggerRepaint(); await wait(1600);
      const res = await measure();
      try { m.setPaintProperty(id, prop, prev === undefined ? 1 : prev); } catch (e) {}
      m.triggerRepaint(); await wait(900);
      legs.push({ id, type: layer.type, aboveMarine: marineIdx !== null && order.indexOf(id) > marineIdx,
        idx: order.indexOf(id), ...res });
    }
    return { marineIdx, zoom: +m.getZoom().toFixed(2), stock, legs };
  })();
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 180000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 180000 });

  const all = [];
  for (const cam of CAMERAS) {
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: cam.center, z: cam.z });
    await page.waitForTimeout(15000);
    await page.screenshot({ path: path.join(outdir, `RING_${cam.id}_stock.png`) });
    const r = await page.evaluate(run, { nBearings: 24, maxR: 420 });
    all.push({ cam: cam.id, ...r });
    log(`=== ${cam.id}  (marine at ${r.marineIdx}) ===`);
    log(`  STOCK (nothing hidden):  rim ${r.stock.rimMed} px  peak ${r.stock.peakMed}  n=${r.stock.n}/24  openwater ${r.stock.ctrlMed}`);
    for (const leg of r.legs) {
      if (leg.skipped) { log(`  ${leg.id.padEnd(28)} SKIPPED ${leg.skipped}`); continue; }
      const drop = (r.stock.rimMed !== null && leg.rimMed !== null) ? r.stock.rimMed - leg.rimMed : null;
      log(`  hide ${leg.id.padEnd(26)} idx${String(leg.idx).padStart(4)} above=${String(leg.aboveMarine).padEnd(5)} `
        + `rim ${String(leg.rimMed).padStart(4)} peak ${String(leg.peakMed).padStart(4)} openwater ${String(leg.ctrlMed).padStart(4)}`
        + (drop !== null ? `   Δrim ${drop > 0 ? '-' : '+'}${Math.abs(drop)}` : ''));
    }
    log('');
  }
  await ctx.close(); await browser.close();
  fs.writeFileSync(path.join(outdir, 'ring.json'), JSON.stringify({ base: BASE, all }, null, 1));
  log('written: ' + path.join(outdir, 'ring.json'));
})().catch((e) => { console.error(e); process.exit(1); });
