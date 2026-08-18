/**
 * island-rim-metric.js — the halo is a RIM, not a GAP. Measure the right quantity.
 *
 * WHAT THE GAP SURVEY SETTLED (island-halo-survey.js, symbol-suppressed, 24 bearings):
 *
 *     madeira z9.3 / z8.5, tenerife, abaco, portugal ....... band MEDIAN 0 m everywhere
 *
 * The marine field reaches the shoreline on essentially every bearing, island and mainland alike.
 * So the halo the owner sees is NOT missing field, and every "hole"-shaped metric in this arc —
 * including the one that produced the 836 m road-shield artifact — is measuring the wrong thing.
 *
 * ⭐ THE SHAPE THIS CODEBASE'S HALOS ACTUALLY HAVE. The dominant one (784b4c6c) was
 * `ocean-mask-buffer`: a NEAR-BLACK LINE against medium-slate water, fixed by taking its opacity to
 * 0 — a rim, not a gap. A rim scores 0 on a "where does the field start" metric while being obvious
 * to the eye. So: hold the field constant and ask whether the pixels NEAR the coast differ from the
 * SAME FIELD further out.
 *
 * THE METRIC. Per bearing, find the basemap shoreline, take a far-water reference from the field at
 * 70-110 px, then walk 0..50 px out and record the deviation from that reference:
 *     rimWidth  = consecutive px from the shore whose deviation exceeds the noise floor
 *     rimPeak   = the largest deviation, and its SIGN in luminance (darker rim vs lighter rim)
 * Sign matters: a DARK rim points at a line/casing painted over the field; a LIGHT rim points at the
 * field fading toward the basemap. They need opposite fixes, and a magnitude alone cannot tell them
 * apart.
 *
 * CONTROLS:
 *   symbols suppressed — every layer above the marine custom layer at opacity 0, or coastal road
 *                        shields and labels get scored as rim (the trap that produced the 255° ghost)
 *   an OPEN-WATER control ring far from any coast — its "rim" is the noise floor of this metric, and
 *                        any coastal number must be read against it, not against zero
 *   a MAINLAND camera — "islands are worse" needs land measured identically in the same run
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'island-rim-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[rim] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const CAMERAS = [
  { id: 'madeira_z9.3', center: [-16.95, 32.75], z: 9.3, kind: 'island' },
  { id: 'madeira_z8.5', center: [-16.95, 32.75], z: 8.5, kind: 'island' },
  { id: 'tenerife_z9.3', center: [-16.60, 28.29], z: 9.3, kind: 'island' },
  { id: 'abaco_z9.3', center: [-77.20, 26.40], z: 9.3, kind: 'island' },
  { id: 'portugal_z9.3', center: [-8.95, 38.85], z: 9.3, kind: 'mainland' },
];

const measure = ({ nBearings, maxR }) => {
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
    if (!idxs.length) return { err: 'no custom marine layer in style._order' };
    const marineIdx = Math.min.apply(null, idxs);
    const PROPS = { line: 'line-opacity', fill: 'fill-opacity', symbol: 'icon-opacity',
      circle: 'circle-opacity', raster: 'raster-opacity', 'fill-extrusion': 'fill-extrusion-opacity' };
    const restore = []; let hidden = 0;
    for (const id of order) {
      if (order.indexOf(id) <= marineIdx) continue;
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
    m.triggerRepaint(); await wait(3000);

    const S = await snap();
    const waterIds = (m.getStyle().layers || [])
      .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
      .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
    const pick = (cx, cy) => {
      const X = Math.round(cx * S.dpr), Y = Math.round(cy * S.dpr);
      if (X < 0 || Y < 0 || X >= S.w || Y >= S.h) return null;
      const o = (Y * S.w + X) * 4; return [S.d[o], S.d[o + 1], S.d[o + 2]];
    };
    const isWater = (cx, cy) => {
      if (!(cx >= 0 && cy >= 0 && cx < S.W && cy < S.H)) return null;
      try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
    };
    const dev = (a, b) => (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const lum = (c) => c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : null;

    const cx0 = S.W / 2, cy0 = S.H / 2;
    const mPerPx = 156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2;
    const NOISE = 12;

    const walk = (ux, uy, startR, label) => {
      // reference: the same field, far from this coast
      const far = [];
      for (let r = startR + 70; r <= startR + 110; r++) {
        if (isWater(cx0 + ux * r, cy0 + uy * r) !== true) continue;
        const c = pick(cx0 + ux * r, cy0 + uy * r); if (c) far.push(c);
      }
      if (far.length < 15) return { label, skip: 'no far-field reference' };
      const ref = [0, 1, 2].map((k) => far.reduce((s, c) => s + c[k], 0) / far.length);
      let width = 0, peak = 0, peakSignedLum = 0, broke = false;
      for (let r = startR; r <= startR + 50; r++) {
        if (isWater(cx0 + ux * r, cy0 + uy * r) !== true) continue;
        const c = pick(cx0 + ux * r, cy0 + uy * r); if (!c) break;
        const d = dev(c, ref);
        if (d > peak) { peak = d; peakSignedLum = Math.round(lum(c) - lum(ref)); }
        if (!broke) { if (d > NOISE) width++; else broke = true; }
      }
      return { label, rimPx: width, rimM: Math.round(width * mPerPx), peak, peakSignedLum,
        ref: ref.map((v) => Math.round(v)) };
    };

    const coastal = [];
    for (let i = 0; i < nBearings; i++) {
      const th = (i / nBearings) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
      let shore = null, prevLand = false, seenLand = false;
      for (let r = 6; r <= maxR; r++) {
        const w = isWater(cx0 + ux * r, cy0 + uy * r);
        if (w === null) break;
        if (w === false) { prevLand = true; seenLand = true; continue; }
        if (w === true && prevLand) { shore = r; break; }
      }
      if (shore === null || !seenLand) { coastal.push({ bearing: Math.round(i * 360 / nBearings), skip: 'no crossing' }); continue; }
      coastal.push(Object.assign({ bearing: Math.round(i * 360 / nBearings), shorePx: shore },
        walk(ux, uy, shore, 'coast')));
    }
    // OPEN-WATER CONTROL: same walk, started far offshore where no coast is involved.
    const control = [];
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
      let start = null;
      for (let r = maxR; r >= 40; r--) {
        if (isWater(cx0 + ux * r, cy0 + uy * r) === true) { start = r - 130; break; }
      }
      if (start === null || start < 20) continue;
      const w = walk(ux, uy, start, 'openwater');
      if (!w.skip) control.push(w);
    }

    for (const e of restore.reverse()) { try { m.setPaintProperty(e[0], e[1], e[2] === undefined ? 1 : e[2]); } catch (er) {} }
    m.triggerRepaint();
    return { hidden, mPerPx: +mPerPx.toFixed(2), zoom: +m.getZoom().toFixed(2),
      overlay: ((window.__RAW_GPU__ || {}).overlayMask || {}).reason || null, coastal, control };
  })();
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // LEVER: RIM_LANDAWARE=off sets the kill switch BEFORE the first frame, so the two legs differ
  // only in the land-aware fetch on the SAME BUILD — a within-build A/B, not a cross-build inference.
  const LEVER_OFF = String(process.env.RIM_LANDAWARE || '').toLowerCase() === 'off';
  await page.addInitScript((off) => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    if (off) window.__RAW_DISABLE_LAND_AWARE_FETCH__ = true;
  }, LEVER_OFF);
  log('leg: land-aware fetch ' + (LEVER_OFF ? 'DISABLED (control)' : 'ENABLED (shipped)'));
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
  log('camera                overlay            n/24   RIM med  p90   peak med   sign   | OPEN-WATER control');
  for (const cam of CAMERAS) {
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: cam.center, z: cam.z });
    await page.waitForTimeout(15000);
    const r = await page.evaluate(measure, { nBearings: 24, maxR: 420 });
    await page.screenshot({ path: path.join(outdir, `RIM_${cam.id}.png`) });
    if (r.err) { log(`${cam.id.padEnd(21)} ERR ${r.err}`); continue; }
    const good = r.coastal.filter((x) => typeof x.rimPx === 'number');
    const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
    const q90 = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(0.9 * a.length))] : null;
    const rims = good.map((x) => x.rimPx), peaks = good.map((x) => x.peak);
    const signs = good.map((x) => x.peakSignedLum);
    const ctrlRims = r.control.map((x) => x.rimPx), ctrlPeaks = r.control.map((x) => x.peak);
    const rec = { cam: cam.id, kind: cam.kind, overlay: r.overlay, mPerPx: r.mPerPx, hidden: r.hidden,
      n: good.length, rimMedPx: med(rims), rimP90Px: q90(rims), rimMedM: med(rims) === null ? null : Math.round(med(rims) * r.mPerPx),
      peakMed: med(peaks), signMed: med(signs), ctrlRimMed: med(ctrlRims), ctrlPeakMed: med(ctrlPeaks),
      coastal: r.coastal, control: r.control };
    out.push(rec);
    log(`${cam.id.padEnd(21)} ${String(r.overlay).padEnd(18)} ${String(good.length).padStart(2)}/24  `
      + `${String(rec.rimMedPx).padStart(5)}px ${String(rec.rimP90Px).padStart(4)}  ${String(rec.peakMed).padStart(7)}  `
      + `${String(rec.signMed).padStart(5)}   | rim ${String(rec.ctrlRimMed).padStart(3)}px peak ${String(rec.ctrlPeakMed).padStart(3)}`);
  }
  await ctx.close(); await browser.close();

  log('');
  for (const r of out) {
    if (r.rimMedPx === null || r.ctrlRimMed === null) { log(`${r.cam}: incomplete — no verdict`); continue; }
    const real = r.rimMedPx >= 2 && r.peakMed > (r.ctrlPeakMed || 0) * 1.8;
    log(`${r.cam.padEnd(21)} ${real ? 'RIM PRESENT' : 'no rim above the open-water noise floor'}`
      + (real ? `  — ${r.rimMedPx} px / ${r.rimMedM} m, peak ${r.peakMed} vs control ${r.ctrlPeakMed}, `
        + `${r.signMed < 0 ? 'DARKER than the field (a line/casing over it)' : 'LIGHTER than the field (fading toward basemap)'}` : ''));
  }
  fs.writeFileSync(path.join(outdir, 'rim.json'), JSON.stringify({ base: BASE, out }, null, 1));
  log('written: ' + path.join(outdir, 'rim.json'));
})().catch((e) => { console.error(e); process.exit(1); });
