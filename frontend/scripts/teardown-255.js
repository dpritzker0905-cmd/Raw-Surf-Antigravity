/**
 * teardown-255.js — the single-coordinate teardown at bearing 255° (32.69350, −17.12638).
 *
 * WHAT IS LEFT TO EXPLAIN. Along the local coast normal the field starts 16 device px seaward of the
 * basemap coastline. Every lever (island re-assert, midcarve REPLACE, blend-both, crests) leaves it
 * untouched, so no more lever sweeps — take the one coordinate apart into its three terms and find
 * which one disagrees:
 *
 *   1. BASEMAP WATER   queryRenderedFeatures on the water fills — where the coast really is.
 *   2. THE MASK        engine.probeMaskGPU — a GPU read-back of the very texel the shader samples:
 *                      .base / .overlay / .effective (+ .effB, the coast-SDF byte, when SDF is live).
 *   3. THE PAINTED PIXEL   canvas read-back.
 *
 * ⭐ THE DISCRIMINATOR THIS ADDS, and the reason a fourth lever sweep would have been wasted: the
 * onset metric asks "is this pixel the FAR-FIELD colour yet", which cannot separate
 *
 *      A HOLE          — no field here at all           (a real halo)
 *      A DIFFERENT VALUE — field present, but nearshore  (NOT a halo; a wave-height gradient, and
 *                          the metric would be reporting physics as a defect)
 *
 * So every sample is compared TWICE: against the far-field reference (the old question) and against
 * ITS OWN waves-OFF colour (the new one). Field absent ⇒ the pixel still looks like bare basemap.
 *
 * ⚠️ UNITS. The earlier harness reported `(d - shore) * dpr`, i.e. DEVICE px at dpr=2. 16 device px
 * is 8 CSS px. At this camera ~104 m/CSS px, so the residual is ~830 m — against a mask texel of
 * ~65 m (4096 over ~2.4°). Mask rasterization is ~13× too fine to produce it, which is precisely why
 * "the field is present but reading a different value" has to be excluded by measurement, not by
 * assumption. Distances below are CSS px; the device-px equivalent is printed alongside.
 *
 * CONTROLS. The repaired bearing (75°, now 0) and a bearing that was always clean (285°) run in the
 * same pass. A classifier that cannot tell them apart from 255° has not measured anything.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[td255] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
// Camera is overridable because WHICH MASK IS OPERATIVE depends on it. From the HOME camera the
// overlay is off (`coverage_gap`) and every probeMaskGPU read falls back to the coarse world base —
// so that run never read the overlay mask at all. Centred on the probe the overlay engages
// (`midcarve_replace`) and the SAME 836 m hole is there, so the operative mask has to be read in
// THAT camera to say whether the hole is in the mask or downstream of it.
//   TD_CENTER='[-17.12638,32.69350]' TD_ZOOM=9.30 TD_PROBES=residual_255
const HOME = process.env.TD_CENTER ? JSON.parse(process.env.TD_CENTER) : [-16.92, 32.74];
const Z = process.env.TD_ZOOM ? Number(process.env.TD_ZOOM) : 9.30;
const ALL_PROBES = [
  { id: 'residual_255', lng: -17.12638, lat: 32.69350 },
  { id: 'repaired_75', lng: -16.80684, lat: 32.76552 },
  { id: 'clean_285', lng: -17.26110, lat: 32.81689 },
];
const PROBES = process.env.TD_PROBES
  ? ALL_PROBES.filter((p) => process.env.TD_PROBES.split(',').includes(p.id)) : ALL_PROBES;

// ---- in-page: geometry + sampling ------------------------------------------------------------
// Returns, per probe, the sample points along the local coast normal plus the basemap-water flag
// and the canvas colour at each. Called once with waves ON and once with waves OFF; the screen
// coordinates are computed from the SAME camera both times, so `d` indexes the same pixel.
const samplePass = ({ probes, home }) => {
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
      const out = [];
      for (const p of probes) {
        const c0 = m.project([p.lng, p.lat]);
        // local coast normal from a ring of basemap-water truth (same estimator as coast-normal-onset)
        const R = 14; let sx = 0, sy = 0, nW = 0, nL = 0;
        for (let a = 0; a < 72; a++) {
          const th = (a / 72) * 2 * Math.PI;
          const w = isWater(c0.x + R * Math.cos(th), c0.y + R * Math.sin(th));
          if (w === true) { sx += Math.cos(th); sy += Math.sin(th); nW++; }
          else if (w === false) nL++;
        }
        if (nW < 6 || nL < 6) { out.push({ id: p.id, void: `ring not a coast (w${nW}/l${nL})` }); continue; }
        const mag = Math.hypot(sx, sy) || 1;
        const nx = sx / mag, ny = sy / mag;
        const ray = { x: c0.x - m.project(home).x, y: c0.y - m.project(home).y };
        const rmag = Math.hypot(ray.x, ray.y) || 1;
        const cosObl = Math.abs((ray.x / rmag) * nx + (ray.y / rmag) * ny);
        const rows = [];
        for (let d = -8; d <= 48; d++) {
          const x = c0.x + nx * d, y = c0.y + ny * d;
          const ll = m.unproject([x, y]);
          rows.push({ d, x: +x.toFixed(2), y: +y.toFixed(2), lng: ll.lng, lat: ll.lat,
            water: isWater(x, y), c: px(x, y) });
        }
        // far-field reference: open water well seaward along the same normal
        const far = [];
        for (let d = 60; d <= 100; d++) { const c = px(c0.x + nx * d, c0.y + ny * d); if (c) far.push(c); }
        const fieldRef = far.length >= 10
          ? [0, 1, 2].map((k) => Math.round(far.reduce((s, c) => s + c[k], 0) / far.length)) : null;
        out.push({ id: p.id, dpr, nx: +nx.toFixed(3), ny: +ny.toFixed(3),
          obliquityDeg: +(Math.acos(Math.min(1, cosObl)) * 180 / Math.PI).toFixed(1), rows, fieldRef });
      }
      resolve(out);
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

// ---- in-page: the mask itself, straight off the GPU -------------------------------------------
const sampleMask = ({ perProbe }) => {
  const eng = window.__MARINE_ENGINE__;
  if (!eng || typeof eng.probeMaskGPU !== 'function') return { err: 'no engine.probeMaskGPU' };
  const m = window.map;
  const env = {
    overlayMask: (window.__RAW_GPU__ || {}).overlayMask || null,
    hasSDF: !!eng._cachedMaskHasSDF,
    sdfDisabled: window.__RAW_DISABLE_COAST_SDF__ === true,
    erode: Number(window.__RAW_COAST_ERODE__) || 0,
    zoom: +m.getZoom().toFixed(3),
    // metres per CSS px at this latitude/zoom (MapLibre 512-px tiles)
    mPerCssPx: +(156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2).toFixed(1),
    overlayBoundsSpanDeg: null, overlayTexelM: null,
  };
  const ob = env.overlayMask && env.overlayMask.bounds;
  if (ob) {
    const span = ob.east - ob.west;
    const w = (span >= 0.35 && span < 6) ? 4096 : (span < 10 ? 4096 : 2048);
    env.overlayBoundsSpanDeg = +span.toFixed(4);
    env.overlayTexelM = +(span / Math.min(w, 4096) * 111320 * Math.cos(m.getCenter().lat * Math.PI / 180)).toFixed(1);
  }
  const out = {};
  for (const p of perProbe) {
    let mv = [];
    try { mv = eng.probeMaskGPU(p.pts) || []; } catch (e) { out[p.id] = { err: 'threw: ' + e.message }; continue; }
    out[p.id] = mv.map((s) => (s ? { base: s.base, overlay: s.overlay, effective: s.effective, src: s.src, effB: s.effB } : null));
  }
  return { env, out };
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

  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: HOME, z: Z });
  await page.waitForTimeout(14000);

  const ON = await page.evaluate(samplePass, { probes: PROBES, home: HOME });
  const perProbe = ON.filter((p) => !p.void)
    .map((p) => ({ id: p.id, pts: p.rows.map((r) => ({ lng: r.lng, lat: r.lat })) }));
  const MASK = await page.evaluate(sampleMask, { perProbe });
  await page.screenshot({ path: path.join(outdir, 'TD255_waves_on.png') });

  await setWaves(false); await page.waitForTimeout(7000);
  const OFF = await page.evaluate(samplePass, { probes: PROBES, home: HOME });
  await ctx.close();

  const d3 = (a, b) => (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  log('env: ' + JSON.stringify(MASK.env));
  log('');

  const report = [];
  for (const p of ON) {
    if (p.void) { log(`${p.id}: VOID ${p.void}`); continue; }
    const off = OFF.find((q) => q.id === p.id);
    const mv = (MASK.out || {})[p.id] || [];
    const dpr = p.dpr;
    log(`--- ${p.id}   obliquity ${p.obliquityDeg}°   fieldRef ${JSON.stringify(p.fieldRef)} ---`);
    log('  d(css) d(dev)  basemap   mask.base ovl  eff  src        effB   |ON-OFF|  |ON-far|  reading');
    const rows = [];
    for (let i = 0; i < p.rows.length; i++) {
      const r = p.rows[i], o = off && off.rows[i], s = mv[i] || null;
      const dOff = d3(r.c, o && o.c), dFar = d3(r.c, p.fieldRef);
      // HOLE: the painted pixel is still its own bare-basemap colour => no field here.
      // FIELD-DIFF: field present but not the far-field value => a value gradient, not a halo.
      const reading = (dOff == null || dFar == null) ? '—'
        : (dOff <= 10 ? 'HOLE (no field)'
          : (dFar <= 16 ? 'field @ far value' : 'FIELD-DIFF (present, other value)'));
      rows.push({ ...r, off: o && o.c, mask: s, dOff, dFar, reading });
      if (r.d >= -4 && r.d <= 26) {
        log(`  ${String(r.d).padStart(5)} ${String(r.d * dpr).padStart(6)}  `
          + `${(r.water === null ? '?' : r.water ? 'water' : 'LAND ').padEnd(8)} `
          + `${String(s && s.base).padStart(4)} ${String(s && s.overlay).padStart(4)} `
          + `${String(s && s.effective).padStart(4)} ${String(s && s.src).padEnd(10)} `
          + `${String(s && s.effB).padStart(5)}   ${String(dOff).padStart(7)}   ${String(dFar).padStart(7)}  ${reading}`);
      }
    }
    // shoreline = first basemap-water sample; onset = first sample carrying ANY field
    const shore = rows.find((r) => r.water === true);
    const firstField = rows.find((r) => r.water === true && r.reading !== 'HOLE (no field)' && r.reading !== '—');
    const firstFar = rows.find((r) => r.water === true && r.reading === 'field @ far value');
    const gapAny = (shore && firstField) ? (firstField.d - shore.d) : null;
    const gapFar = (shore && firstFar) ? (firstFar.d - shore.d) : null;
    log(`  => shoreline d=${shore ? shore.d : '?'}   first ANY field d=${firstField ? firstField.d : 'none'}`
      + `   first FAR-value d=${firstFar ? firstFar.d : 'none'}`);
    log(`  => HOLE width ${gapAny === null ? '?' : gapAny + ' css / ' + gapAny * dpr + ' dev px'}`
      + `   |   old onset metric would report ${gapFar === null ? '?' : gapFar + ' css / ' + gapFar * dpr + ' dev px'}`);
    log('');
    report.push({ id: p.id, obliquityDeg: p.obliquityDeg, fieldRef: p.fieldRef, dpr,
      shoreD: shore ? shore.d : null, firstFieldD: firstField ? firstField.d : null,
      firstFarD: firstFar ? firstFar.d : null, holeCssPx: gapAny, onsetCssPx: gapFar, rows });
  }
  fs.writeFileSync(path.join(outdir, 'teardown-255.json'),
    JSON.stringify({ base: BASE, camera: { center: HOME, zoom: Z }, env: MASK.env, report }, null, 1));
  log('written: ' + path.join(outdir, 'teardown-255.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
