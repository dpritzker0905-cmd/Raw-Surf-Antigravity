/**
 * mask-offset-jacobian.js — §22's discriminator, run as a JACOBIAN rather than a before/after.
 *
 * THE QUESTION. §19 measured the mask coastline DISPLACED ~6 px seaward of the basemap coastline
 * with a 47.9 px spread across bearings, and §21 proved the RINGS handed to the painter are correct
 * to within 1 px on every bearing. So the displacement enters downstream: in the RASTERISATION, or
 * in the BOUNDS the finished texture is sampled with. §22 proposed panning inside the repaint
 * hysteresis box and forcing a repaint. This measures the DERIVATIVES instead, which discriminate
 * more sharply than two points:
 *
 *   d(offset)/d(pan)   ~ 0   the mask is correctly georeferenced; the error is baked in at PAINT time
 *                      ~ +-1 the texture and the bounds it is sampled with disagree (STALENESS)
 *   d(offset)/d(zoom)        offset CONSTANT IN DEVICE PX  => a screen-space / rasterisation effect
 *                            offset DOUBLING PER ZOOM LEVEL => a GEOGRAPHIC displacement in the mask
 *                            (a fixed lat/lng error subtends 2x the pixels at 2x the scale)
 * The zoom derivative is the sharper of the two and costs nothing extra: zoom-ins INSIDE the truth
 * box are documented to skip the repaint (refreshViewportOverlayMask's hysteresis comment).
 *
 * ⭐ PER-RAY, NEVER MEANED. §19's whole lesson is that a mean over bearings converts displacement
 * variance into apparent softness. Every statistic here is computed on per-ray crossings; the median
 * and the spread are reported separately, and per-bearing offsets are kept so the SAME bearing can be
 * tracked across camera steps.
 *
 * THE INSTRUMENT — one capture per camera, no Waves toggling. Basemap water is forced to #ff0000
 * ONCE, up front. Along a ray outward from the island centroid that yields three regimes:
 *     land (basemap land colour) -> water with NO field (pure red, R=255) -> water WITH field (R<255)
 * so a single frame carries BOTH oracles:
 *     A = basemap coast   : first sustained `queryRenderedFeatures` water hit (the oracle §21 validated)
 *     B = mask edge       : where R falls through the midpoint between the red plateau and the
 *                           far-field plateau (R is a monotone proxy for alpha, since the field
 *                           composites C = a*F + (1-a)*(255,0,0) and F is dark)
 *     offset = B - A, in device px, sub-pixel by linear interpolation.
 * Toggling Waves would risk triggering a mask repaint and destroying the no-repaint precondition,
 * which is exactly what this run must hold fixed.
 *
 * CONTROLS (each one has already caught something real in this arc):
 *   - NO-REPAINT IS VERIFIED, NOT ASSUMED. __RAW_GPU__.basemapWaterMask.at (upload timestamp) and
 *     .bounds are captured at every step; any step where they moved is FLAGGED, and the pan/zoom
 *     derivatives are computed only across steps that share one paint.
 *   - AGREEMENT WITH §19. The baseline median offset must land near ~6 px. If it does not, this
 *     instrument disagrees with the one that produced §19 and the run says so rather than proceeding.
 *   - RAY REFUSALS. A ray is void unless it has a real red plateau (>=2 px of R>=240 seaward of the
 *     coast) AND a far-field plateau meaningfully below it (the field is actually painting there).
 *     A ray that cannot separate the two transitions must not contribute a number.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'mask-offset-jacobian-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[jac] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const CENTER = [-16.92, 32.74];
const Z0 = 9.30;
const RAY_DEG = 0.45;
const BEARINGS = 24;
const FORCED_WATER = '#ff0000';

// Camera steps. Pans are expressed in DEVICE PX at Z0 so the Jacobian is in consistent units.
// All are small enough to stay inside the 50%-padded truth box (viewport +-50%), so no repaint.
const STEPS = [
  { id: 'base',      panPx: 0,   dz: 0 },
  { id: 'pan+40',    panPx: 40,  dz: 0 },
  { id: 'pan+80',    panPx: 80,  dz: 0 },
  { id: 'pan+120',   panPx: 120, dz: 0 },
  { id: 'back',      panPx: 0,   dz: 0 },      // return: proves the pan series is reversible
  { id: 'zoom+0.25', panPx: 0,   dz: 0.25 },
  { id: 'zoom+0.50', panPx: 0,   dz: 0.50 },
];

const measure = ({ center, rayDeg, bearings }) => new Promise((resolve) => {
  const m = window.map;
  const fn = () => {
    m.off('render', fn);
    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
    const img = c2.getImageData(0, 0, cv.width, cv.height).data;
    const waterIds = (() => {
      try {
        const ids = (m.getStyle().layers || []).filter((l) => l['source-layer'] === 'water' || l.id === 'water')
          .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
        return ids.length ? ids : ['water'];
      } catch (e) { return ['water']; }
    })();
    const rays = [];
    for (let b = 0; b < bearings; b++) {
      const th = (b / bearings) * 2 * Math.PI;
      const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
        center[1] + rayDeg * Math.cos(th)];
      const p0 = m.project(center), p1 = m.project(dest);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const nDev = Math.max(8, Math.round(Math.hypot(dx, dy) * dpr));   // one sample per DEVICE px
      const at = (i) => ({ cx: p0.x + dx * i / nDev, cy: p0.y + dy * i / nDev });
      const inView = (cx, cy) => cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
        && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
      // A: basemap coast — first sustained water. ONE qRF per index, memoised into `water`, then
      // scanned: the 8-lookahead must not re-query (that is 8x the cost for the same answer).
      const water = [];
      let coast = -1;
      const isWater = (i) => {
        if (water[i] !== undefined) return water[i];
        const { cx, cy } = at(i);
        if (!inView(cx, cy)) { water[i] = null; return null; }
        let w = null;
        try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {}
        water[i] = w; return w;
      };
      for (let i = 1; i + 8 <= nDev; i++) {
        if (isWater(i) !== true) continue;
        let ok = true;
        for (let k = 1; k < 8; k++) if (isWater(i + k) !== true) { ok = false; break; }
        if (ok) { coast = i; break; }
      }
      if (coast < 0) { rays.push({ b, void: 'no_coast' }); continue; }
      // colour profile seaward of the coast
      const R = [];
      for (let d = 0; d + coast <= nDev; d++) {
        const { cx, cy } = at(coast + d);
        if (!inView(cx, cy)) break;
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) break;
        R.push(img[(Y * cv.width + X) * 4]);
      }
      if (R.length < 40) { rays.push({ b, void: 'short_ray' }); continue; }
      // red plateau immediately seaward of the coast
      let plat = 0; while (plat < R.length && R[plat] >= 240) plat++;
      if (plat < 2) { rays.push({ b, void: 'no_red_plateau', r0: R.slice(0, 4) }); continue; }
      // far-field plateau = median of the outer third
      const far = R.slice(Math.floor(R.length * 0.66)).slice().sort((x, y) => x - y);
      const farMed = far[Math.floor(far.length / 2)];
      if (255 - farMed < 25) { rays.push({ b, void: 'no_field', farMed }); continue; }
      const mid = (255 + farMed) / 2;
      let cross = -1;
      for (let d = 1; d < R.length; d++) {
        if (R[d - 1] > mid && R[d] <= mid) {
          cross = (d - 1) + (R[d - 1] - mid) / Math.max(R[d - 1] - R[d], 1e-6);
          break;
        }
      }
      if (cross < 0) { rays.push({ b, void: 'no_crossing', farMed }); continue; }
      // 10-90% width, for comparison with §19's 3.5-4.6 px per-ray figure
      const lo = 255 - 0.1 * (255 - farMed), hi = 255 - 0.9 * (255 - farMed);
      let iLo = -1, iHi = -1;
      for (let d = 1; d < R.length; d++) { if (iLo < 0 && R[d] <= lo) iLo = d; if (iHi < 0 && R[d] <= hi) iHi = d; }
      rays.push({ b, offset: +cross.toFixed(2), farMed, width: (iLo >= 0 && iHi >= 0) ? iHi - iLo : null });
    }
    const g = window.__RAW_GPU__ || {};
    const bw = g.basemapWaterMask || null;
    resolve({
      rays,
      zoom: +m.getZoom().toFixed(3),
      center: [+m.getCenter().lng.toFixed(5), +m.getCenter().lat.toFixed(5)],
      dpr,
      paintAt: bw ? bw.at : null,
      paintBounds: bw ? bw.bounds : null,
      overlayReason: g.overlayMask ? g.overlayMask.reason : null,
    });
  };
  m.on('render', fn); m.triggerRepaint();
});

const stat = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { n: s.length, median: +q(0.5).toFixed(2), p10: +q(0.1).toFixed(2), p90: +q(0.9).toFixed(2),
    min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2), spread: +(s[s.length - 1] - s[0]).toFixed(2) };
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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: CENTER, z: Z0 });
  await page.waitForTimeout(15000);
  await page.evaluate((col) => {
    const m = window.map;
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col); } catch (e) {}
      }
    }
  }, FORCED_WATER);
  await page.waitForTimeout(3000);

  const degPerDevicePx0 = 360 / (256 * Math.pow(2, Z0)) / 2;
  const results = [];
  for (const s of STEPS) {
    const lngOff = s.panPx * degPerDevicePx0;
    await page.evaluate(({ c, z, off }) => window.map.jumpTo({ center: [c[0] + off, c[1]], zoom: z }),
      { c: CENTER, z: Z0 + s.dz, off: lngOff });
    await page.waitForTimeout(4000);
    const r = await page.evaluate(measure, { center: CENTER, rayDeg: RAY_DEG, bearings: BEARINGS });
    const offs = r.rays.filter((x) => x.offset !== undefined).map((x) => x.offset);
    const widths = r.rays.filter((x) => x.width !== null && x.width !== undefined).map((x) => x.width);
    results.push({ step: s, ...r, stat: stat(offs), widthStat: stat(widths) });
    const st = stat(offs);
    log(`${s.id.padEnd(10)} z=${r.zoom} pan=${s.panPx}px  rays=${offs.length}/${BEARINGS}`
      + `  offset med=${st ? st.median : '-'} p10-p90=${st ? st.p10 + '..' + st.p90 : '-'}`
      + ` spread=${st ? st.spread : '-'}  perRayWidth med=${stat(widths) ? stat(widths).median : '-'}`
      + `  paintAt=${r.paintAt ? String(r.paintAt).slice(11, 23) : 'null'}`);
    const voids = r.rays.filter((x) => x.void);
    if (voids.length) log(`${' '.repeat(10)} refused ${voids.length}: `
      + JSON.stringify(voids.reduce((a, x) => { a[x.void] = (a[x.void] || 0) + 1; return a; }, {})));
  }

  // ── FORCED REPAINT: leave the truth box entirely, come back, re-measure at base camera ──
  log('');
  log('forcing a repaint (jump 3 deg away and back)...');
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: [c[0] + 3.0, c[1]], zoom: z }), { c: CENTER, z: Z0 });
  await page.waitForTimeout(9000);
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: CENTER, z: Z0 });
  await page.waitForTimeout(12000);
  const after = await page.evaluate(measure, { center: CENTER, rayDeg: RAY_DEG, bearings: BEARINGS });
  const afterOffs = after.rays.filter((x) => x.offset !== undefined).map((x) => x.offset);
  results.push({ step: { id: 'repainted', panPx: 0, dz: 0 }, ...after, stat: stat(afterOffs) });
  const aSt = stat(afterOffs);
  log(`${'repainted'.padEnd(10)} z=${after.zoom} rays=${afterOffs.length}/${BEARINGS}`
    + `  offset med=${aSt ? aSt.median : '-'} spread=${aSt ? aSt.spread : '-'}`
    + `  paintAt=${after.paintAt ? String(after.paintAt).slice(11, 23) : 'null'}`);
  await ctx.close(); await browser.close();

  // ── CONTROLS ──────────────────────────────────────────────────────────────
  const byId = Object.fromEntries(results.map((r) => [r.step.id, r]));
  const paintAts = [...new Set(results.slice(0, STEPS.length).map((r) => r.paintAt))];
  const onePaint = paintAts.length === 1;
  const baseSt = byId.base.stat;
  const agrees19 = baseSt && baseSt.median >= 2 && baseSt.median <= 12;
  log('');
  log('CONTROLS');
  log(`  one paint across the pan/zoom series : ${onePaint}  (paintAt values: ${paintAts.length})`);
  if (!onePaint) log(`    -> ${JSON.stringify(paintAts)}  DERIVATIVES ACROSS A REPAINT ARE NOT VALID`);
  log(`  baseline agrees with 19 (~6 px)      : ${agrees19}  (median ${baseSt ? baseSt.median : '-'} px,`
    + ` per-ray width median ${byId.base.widthStat ? byId.base.widthStat.median : '-'} px vs 19's 3.5-4.6)`);
  log(`  pan series reversible (base vs back) : ${baseSt && byId.back.stat ? Math.abs(baseSt.median - byId.back.stat.median).toFixed(2) + ' px' : '-'}`);

  // ── JACOBIANS ─────────────────────────────────────────────────────────────
  log('');
  log('JACOBIAN d(offset)/d(pan)   [staleness => ~+-1 px per px;  paint-time => ~0]');
  const panSteps = ['base', 'pan+40', 'pan+80', 'pan+120'];
  const xs = panSteps.map((k) => byId[k].step.panPx), ys = panSteps.map((k) => byId[k].stat && byId[k].stat.median);
  if (ys.every((y) => y !== null && y !== undefined)) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    panSteps.forEach((k, i) => log(`   pan ${String(xs[i]).padStart(4)} px -> median offset ${ys[i]} px`));
    log(`   => slope = ${slope.toFixed(4)} px offset per px pan`);
    log(`   => ${Math.abs(slope) < 0.15 ? 'GEOREFERENCED: the offset does NOT track the camera -> baked in at PAINT time'
      : 'TRACKS THE CAMERA -> texture/bounds STALENESS mismatch'}`);
  } else log('   incomplete');

  log('');
  log('JACOBIAN d(offset)/d(zoom)  [device-px constant => screen-space;  x2 per level => GEOGRAPHIC]');
  const zSteps = ['base', 'zoom+0.25', 'zoom+0.50'];
  const zs = zSteps.map((k) => byId[k].stat && byId[k].stat.median);
  if (zs.every((y) => y !== null && y !== undefined)) {
    zSteps.forEach((k, i) => log(`   ${k.padEnd(10)} z=${byId[k].zoom}  median offset ${zs[i]} px`
      + `   (geographic prediction ${(zs[0] * Math.pow(2, byId[k].step.dz)).toFixed(2)},`
      + ` screen-space prediction ${zs[0]})`));
    const geoPred = zs[0] * Math.pow(2, 0.5), scrPred = zs[0], obs = zs[2];
    log(`   => observed ${obs} vs geographic ${geoPred.toFixed(2)} vs screen-space ${scrPred}`);
    log(`   => ${Math.abs(obs - geoPred) < Math.abs(obs - scrPred) ? 'GEOGRAPHIC displacement in the mask raster'
      : 'SCREEN-SPACE / rasterisation-scale effect'}`);
  } else log('   incomplete');

  log('');
  log(`REPAINT TEST: base median ${baseSt ? baseSt.median : '-'} -> repainted ${aSt ? aSt.median : '-'} px`
    + `  (spread ${baseSt ? baseSt.spread : '-'} -> ${aSt ? aSt.spread : '-'})`);
  log(`  => ${baseSt && aSt && Math.abs(baseSt.median - aSt.median) < 1.0
    ? 'a fresh paint reproduces the same displacement -> DETERMINISTIC, not staleness'
    : 'the displacement CHANGED with a fresh paint -> paint depends on camera/tile state'}`);

  fs.writeFileSync(path.join(outdir, 'mask-offset-jacobian.json'), JSON.stringify({ base: BASE, results }, null, 1));
  log('written: ' + path.join(outdir, 'mask-offset-jacobian.json'));
})().catch((e) => { console.error(e); process.exit(1); });
