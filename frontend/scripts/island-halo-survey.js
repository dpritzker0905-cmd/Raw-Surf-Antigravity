/**
 * island-halo-survey.js — measure the island coastal band with an instrument SYMBOLS CANNOT FOOL.
 *
 * ⛔ WHY EVERY EARLIER READING IN THIS ARC IS SUSPECT. The 255° "residual" turned out to be a
 * `road-number-shield` ICON sitting on the probe coordinate: hiding that one symbol layer flipped the
 * hole to the debug colour, while every ocean-mask-* and water layer changed nothing. The detector
 * used throughout — "the pixel equals its own waves-OFF colour, so there is no field here" — CANNOT
 * TELL "no field" FROM "covered by a label", because a label paints identically with Waves on and
 * off. Shields and labels sit above the marine layer wherever there is a coastal road, which is
 * precisely where coastlines are.
 *
 * THE FIX: take EVERY layer painted above the marine custom layer to opacity 0 before measuring.
 * Order comes from `map.style._order` (getStyle().layers omits custom layers); opacity, never
 * `visibility`, which OceanMask.js:658 silently reverts.
 *
 * REPORTED IN METRES, MEDIAN AND P90 OVER BEARINGS. A fixed geographic error grows in pixels as you
 * zoom, so metres is the only zoom-invariant unit; and this arc has already been misled once by a
 * MEAN over bearings and once by a SINGLE ray, so the distribution is reported, never a point.
 *
 * CONTROLS, without which none of it means anything:
 *   symbols ON vs OFF at one camera — quantifies how much the old instrument was inflating the band
 *   a MAINLAND camera in the same run — "islands are worse than land" needs land measured identically
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'island-halo-survey-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[survey] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const CAMERAS = [
  { id: 'madeira_z9.3', center: [-16.95, 32.75], z: 9.3, kind: 'island', suppress: true },
  { id: 'madeira_z9.3_SYMBOLS_ON', center: [-16.95, 32.75], z: 9.3, kind: 'island', suppress: false },
  { id: 'madeira_z8.5', center: [-16.95, 32.75], z: 8.5, kind: 'island', suppress: true },
  { id: 'tenerife_z9.3', center: [-16.60, 28.29], z: 9.3, kind: 'island', suppress: true },
  { id: 'abaco_z9.3', center: [-77.20, 26.40], z: 9.3, kind: 'island', suppress: true },
  { id: 'portugal_z9.3', center: [-8.95, 38.85], z: 9.3, kind: 'mainland', suppress: true },
];

const measure = ({ suppress, nBearings, maxR }) => {
  const m = window.map;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickWaves = (want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  };
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
    const customIds = order.filter((id) => !styleIds.has(id));
    const idxs = customIds.map((id) => order.indexOf(id)).filter((i) => i >= 0);
    if (!idxs.length) return { err: 'no custom marine layer in style._order' };
    const marineIdx = Math.min.apply(null, idxs);
    const PROPS = { line: 'line-opacity', fill: 'fill-opacity', symbol: 'icon-opacity',
      circle: 'circle-opacity', raster: 'raster-opacity', 'fill-extrusion': 'fill-extrusion-opacity' };

    const restore = []; let hidden = 0;
    if (suppress) {
      for (const id of order) {
        if (order.indexOf(id) <= marineIdx) continue;   // below the field cannot hide it
        let layer = null; try { layer = m.getLayer(id); } catch (e) {}
        if (!layer) continue;
        const props = [PROPS[layer.type]];
        if (layer.type === 'symbol') props.push('text-opacity');
        let did = false;
        for (const p of props) {
          if (!p) continue;
          let prev; try { prev = m.getPaintProperty(id, p); } catch (e) { continue; }
          try { m.setPaintProperty(id, p, 0); restore.push([id, p, prev]); did = true; } catch (e) {}
        }
        if (did) hidden++;
      }
      m.triggerRepaint(); await wait(2500);
    }

    clickWaves(true); await wait(1500);
    const ON = await snap();
    clickWaves(false); await wait(6500);
    const OFF = await snap();
    clickWaves(true); await wait(4500);

    const waterIds = (m.getStyle().layers || [])
      .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
      .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
    const pick = (S, cx, cy) => {
      const X = Math.round(cx * S.dpr), Y = Math.round(cy * S.dpr);
      if (X < 0 || Y < 0 || X >= S.w || Y >= S.h) return null;
      const o = (Y * S.w + X) * 4; return [S.d[o], S.d[o + 1], S.d[o + 2]];
    };
    const isWater = (cx, cy) => {
      if (!(cx >= 0 && cy >= 0 && cx < ON.W && cy < ON.H)) return null;
      try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
    };
    const d3 = (a, b) => (!a || !b) ? 0 : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

    const cx0 = ON.W / 2, cy0 = ON.H / 2;
    const mPerPx = 156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2;
    const rows = [];
    for (let i = 0; i < nBearings; i++) {
      const th = (i / nBearings) * 2 * Math.PI;
      const ux = Math.cos(th), uy = Math.sin(th);
      // walk outward: the shoreline is the first land -> water transition on this ray
      let shore = null, prevLand = false, seenLand = false;
      for (let r = 6; r <= maxR; r++) {
        const w = isWater(cx0 + ux * r, cy0 + uy * r);
        if (w === null) break;
        if (w === false) { prevLand = true; seenLand = true; continue; }
        if (w === true && prevLand) { shore = r; break; }
      }
      if (shore === null || !seenLand) { rows.push({ bearing: Math.round(i * 360 / nBearings), skip: 'no land->water crossing' }); continue; }
      let field = null;
      for (let r = shore; r <= Math.min(maxR, shore + 120); r++) {
        if (isWater(cx0 + ux * r, cy0 + uy * r) !== true) continue;
        if (d3(pick(ON, cx0 + ux * r, cy0 + uy * r), pick(OFF, cx0 + ux * r, cy0 + uy * r)) > 10) { field = r; break; }
      }
      rows.push({ bearing: Math.round(i * 360 / nBearings), shorePx: shore,
        bandPx: field === null ? null : field - shore,
        bandM: field === null ? null : Math.round((field - shore) * mPerPx) });
    }
    for (const entry of restore.reverse()) {
      try { m.setPaintProperty(entry[0], entry[1], entry[2] === undefined ? 1 : entry[2]); } catch (e) {}
    }
    m.triggerRepaint();
    return { marineIdx, hiddenLayers: hidden, mPerPx: +mPerPx.toFixed(2),
      zoom: +m.getZoom().toFixed(2), overlay: ((window.__RAW_GPU__ || {}).overlayMask || {}).reason || null, rows };
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

  const out = [];
  log('camera                      overlay             m/px   n/24   MEDIAN    p90     max   (band, metres)');
  for (const cam of CAMERAS) {
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: cam.center, z: cam.z });
    await page.waitForTimeout(15000);
    const r = await page.evaluate(measure, { suppress: cam.suppress, nBearings: 24, maxR: 420 });
    await page.screenshot({ path: path.join(outdir, `SURVEY_${cam.id}.png`) });
    if (r.err) { log(`${cam.id.padEnd(27)} ERR ${r.err}`); out.push({ cam: cam.id, err: r.err }); continue; }
    const vals = r.rows.filter((x) => typeof x.bandM === 'number').map((x) => x.bandM).sort((a, b) => a - b);
    const q = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : null;
    const rec = { cam: cam.id, kind: cam.kind, suppress: cam.suppress, hiddenLayers: r.hiddenLayers,
      overlay: r.overlay, mPerPx: r.mPerPx, n: vals.length, median: q(0.5), p90: q(0.9),
      max: vals.length ? vals[vals.length - 1] : null, rows: r.rows };
    out.push(rec);
    log(`${cam.id.padEnd(27)} ${String(r.overlay).padEnd(19)} ${String(r.mPerPx).padStart(6)}  ${String(vals.length).padStart(2)}/24  `
      + `${String(rec.median).padStart(7)} ${String(rec.p90).padStart(6)} ${String(rec.max).padStart(7)}   (hid ${r.hiddenLayers})`);
  }
  await ctx.close(); await browser.close();

  log('');
  const sup = out.find((r) => r.cam === 'madeira_z9.3');
  const unsup = out.find((r) => r.cam === 'madeira_z9.3_SYMBOLS_ON');
  if (sup && unsup && sup.median != null && unsup.median != null) {
    log(`SYMBOL CONTAMINATION at madeira z9.3 — symbols ON median ${unsup.median} m vs suppressed ${sup.median} m`
      + `  =>  the old instrument was inflating the band by ${unsup.median - sup.median} m`);
  } else {
    log('SYMBOL CONTAMINATION: not measurable this run (a leg produced no band values) — reporting the gap, not a number.');
  }
  const isl = out.filter((r) => r.kind === 'island' && r.suppress && r.median != null);
  const land = out.filter((r) => r.kind === 'mainland' && r.median != null);
  if (isl.length && land.length) {
    const im = Math.round(isl.reduce((s, r) => s + r.median, 0) / isl.length);
    log(`ISLANDS median ${im} m  vs  MAINLAND ${land[0].median} m  =>  `
      + (im > land[0].median * 1.5 ? 'ISLANDS ARE WORSE, matching the report'
        : 'no island/mainland gap in this sample — the reported difference is NOT reproduced by this metric'));
  } else {
    log('ISLAND vs MAINLAND: incomplete — no comparison claimed.');
  }
  fs.writeFileSync(path.join(outdir, 'survey.json'), JSON.stringify({ base: BASE, cameras: CAMERAS, out }, null, 1));
  log('written: ' + path.join(outdir, 'survey.json'));
})().catch((e) => { console.error(e); process.exit(1); });
