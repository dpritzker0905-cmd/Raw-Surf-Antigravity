/**
 * residual-coast-form.js — is the amplitude residual a DEFECT, or is my coast detector standing in
 * a harbour?
 *
 * WHERE THIS SITS. §28 refuted sheltering (35 deg swell rotation -> 0.0 deg arc movement) and empty
 * grid cells (wrong sign: 0.5 vs 2.92 empty cells). The suppression is real and large — far fields
 * match (105.6 vs 111.7) while the shoreline value differs 14x (G0 8.3 vs 119.3), and G0 is exactly
 * ZERO on bearings 195 and 203 deg. The suppressed set is mostly one contiguous run, 180-233 deg:
 * MADEIRA'S SOUTH COAST, where Funchal and its harbour/marinas are.
 *
 * THE HYPOTHESIS THIS TESTS — and it accuses the INSTRUMENT, not the renderer. `a0` is sampled at
 * the FIRST SUSTAINED BASEMAP WATER along each ray. The marine mask deliberately suppresses
 * sheltered and inland water (applyInlandWaterGuard re-blacks water >~10 km from NE water; the
 * sheltered/wetland passes darken lagoons and marshes). If the detector latches onto a harbour, a
 * marina or a river mouth, then the field is CORRECTLY absent there and the "residual" is my own
 * sampling, not a halo.
 *   (I) INSTRUMENT  -> suppressed bearings sit on enclosed/sheltered water: the ray RE-ENTERS LAND
 *                      shortly after the detected coast, and the field turns on again just past it.
 *   (II) DEFECT     -> suppressed bearings sit on open coast with no land re-entry, and the field
 *                      stays off for a long distance seaward.
 * These make opposite predictions about two things that are cheap to measure: LAND RE-ENTRY after
 * the detected coast, and the ONSET DISTANCE at which the field reaches half its far value.
 *
 * ⛔ Nine causes in this arc died because a render explanation was preferred to an instrument one.
 * This runs the instrument check FIRST.
 *
 * Runs with the island re-assert DISABLED, which is TODAY'S SHIPPED BEHAVIOUR at this density
 * (ISLAND_REASSERT_MAX_DENSITY = 400, Madeira's overlay ~850 px/deg), so this is the residual a user
 * actually sees. Alpha is read off G — the channel the forced-red backdrop zeroes.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'residual-coast-form-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[form] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const BEARINGS = 48;
const FORCED_WATER = '#ff0000';
const PROFILE_AT = [0, 2, 5, 10, 20, 40, 80, 160];

const probe = ({ center, rayDeg, bearings, profAt }) => new Promise((resolve) => {
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
    const out = [];
    for (let b = 0; b < bearings; b++) {
      const th = (b / bearings) * 2 * Math.PI;
      const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
        center[1] + rayDeg * Math.cos(th)];
      const p0 = m.project(center), p1 = m.project(dest);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const nDev = Math.max(8, Math.round(Math.hypot(dx, dy) * dpr));
      const at = (i) => ({ cx: p0.x + dx * i / nDev, cy: p0.y + dy * i / nDev });
      const okv = (cx, cy) => cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
        && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
      const water = [];
      const isWater = (i) => {
        if (water[i] !== undefined) return water[i];
        const { cx, cy } = at(i);
        if (!okv(cx, cy)) { water[i] = null; return null; }
        let w = null;
        try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {}
        water[i] = w; return w;
      };
      let coast = -1;
      for (let i = 1; i + 8 <= nDev; i++) {
        if (isWater(i) !== true) continue;
        let ok = true;
        for (let k = 1; k < 8; k++) if (isWater(i + k) !== true) { ok = false; break; }
        if (ok) { coast = i; break; }
      }
      if (coast < 0) { out.push({ b, void: 'no_coast' }); continue; }
      const G = [];
      for (let d = 0; d + coast <= nDev; d++) {
        const { cx, cy } = at(coast + d);
        if (!okv(cx, cy)) break;
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) break;
        G.push(img[(Y * cv.width + X) * 4 + 1]);
      }
      if (G.length < 40) { out.push({ b, void: 'short_ray' }); continue; }
      const far = G.slice(Math.floor(G.length * 0.66)).slice().sort((x, y) => x - y);
      const gFar = far[Math.floor(far.length / 2)];
      if (gFar < 40) { out.push({ b, void: 'no_field', gFar }); continue; }
      // (I) vs (II) discriminator #1: does the ray RE-ENTER LAND after the detected coast?
      let reentry = 0, firstReentry = -1;
      for (let d = 1; d < Math.min(G.length, 200); d++) {
        if (isWater(coast + d) === false) { reentry++; if (firstReentry < 0) firstReentry = d; }
      }
      // discriminator #2: how far out does the field reach half its far value?
      let onset = -1;
      for (let d = 0; d < G.length; d++) if (G[d] >= 0.5 * gFar) { onset = d; break; }
      const cpt = at(coast);
      const ll = m.unproject([cpt.cx, cpt.cy]);
      out.push({ b, bearingDeg: +(b * 360 / bearings).toFixed(1), coast, gFar,
        a0: +Math.max(0, Math.min(1.5, G[0] / gFar)).toFixed(3),
        onset, reentry, firstReentry,
        coastLngLat: [+ll.lng.toFixed(5), +ll.lat.toFixed(5)],
        prof: profAt.map((d) => (d < G.length ? G[d] : null)) });
    }
    resolve(out);
  };
  m.on('render', fn); m.triggerRepaint();
});

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    window.__RAW_DISABLE_ISLAND_REASSERT__ = true;
  });
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
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
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

  // FIELD-ALIVE PRECHECK + REGIME GUARD. The first run of this harness returned gFar=0 on all 48
  // bearings — the field painted NOTHING, and without this check that reads as "48 voids" rather
  // than "the subject never rendered". island-reassert-ab.js already had this guard; not carrying it
  // over cost a whole run. It also captures overlayMask.reason, because that first run landed in
  // `coverage_gap` while every §27/§28 measurement ran in `midcarve_replace` — a DIFFERENT REGIME,
  // and comparing across regimes is precisely the error §16 already recorded once.
  // ⛔ THE SENTINEL MUST BE VALIDATED, NOT HARD-CODED. A fixed offset of -0.30 deg lands at
  // (-17.22, 32.74), which is ON Madeira's western end — land reads G=0 forever however healthy the
  // field is, so the "field not painting" refusal would be FALSE, the exact mirror of the failure
  // this check exists to catch. Instead: ring 8 candidates at 0.40 deg, keep only those the BASEMAP
  // itself calls water, and take the best G among them. A sentinel that cannot be confirmed as water
  // is reported as such rather than being allowed to veto the run.
  const alive = async () => page.evaluate(({ c }) => {
    const m = window.map;
    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    cv.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0);
    const ctx2 = cv.getContext('2d', { willReadFrequently: true });
    const waterIds = (() => {
      try {
        const ids = (m.getStyle().layers || []).filter((l) => l['source-layer'] === 'water' || l.id === 'water')
          .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
        return ids.length ? ids : ['water'];
      } catch (e) { return ['water']; }
    })();
    let bestG = -1, nWater = 0;
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * 2 * Math.PI;
      const lng = c[0] + 0.40 * Math.sin(th) / Math.cos(c[1] * Math.PI / 180);
      const lat = c[1] + 0.40 * Math.cos(th);
      const p = m.project([lng, lat]);
      if (p.x < 0 || p.y < 0 || p.x >= rect.width || p.y >= rect.height) continue;
      let isW = false;
      try { isW = m.queryRenderedFeatures([p.x, p.y], { layers: waterIds }).length > 0; } catch (e) {}
      if (!isW) continue;                       // only trust points the BASEMAP calls water
      nWater++;
      const d = ctx2.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data;
      if (d[1] > bestG) bestG = d[1];
    }
    return { g: bestG < 0 ? 0 : bestG, waterPoints: nWater,
      reason: (window.__RAW_GPU__ || {}).overlayMask ? window.__RAW_GPU__.overlayMask.reason : null };
  }, { c: TARGET.center });
  // ⛔ WAITING ALONE DOES NOT FIX THIS. Measured across runs: in the `coverage_gap` regime the field
  // does not paint at this camera at all (0/48 rays, gFar=0 on every bearing, ~45 s of retries),
  // while every run that landed in `midcarve_replace` yielded 24/24 or 48/48. `coverage_gap` is by
  // definition "the base mask does not cover the viewport" — the known coverage-arrival race. So the
  // retry NUDGES THE CAMERA to provoke a fresh coverage commit instead of waiting on a state that
  // does not resolve itself.
  let av = await alive();
  for (let t = 0; t < 6 && av.g < 40; t++) {
    log(`  field not painting (G=${av.g}, waterPoints=${av.waterPoints}, regime=${av.reason}) — nudging…`);
    await page.evaluate(({ c, z, k }) => window.map.jumpTo({ center: [c[0] + (k % 2 ? 0.05 : -0.05), c[1]], zoom: z + (k % 2 ? 0.15 : -0.15) }),
      { c: TARGET.center, z: TARGET.z, k: t });
    await page.waitForTimeout(4000);
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
    await page.waitForTimeout(7000);
    av = await alive();
  }
  log(`field-alive: G=${av.g}  regime=${av.reason}`);
  if (av.g < 40) {
    log('=> REFUSED: the marine field never painted. Nothing measured; this is not a result.');
    await ctx.close(); await browser.close(); process.exit(1);
  }
  if (av.reason !== 'midcarve_replace') {
    log(`⚠️ REGIME MISMATCH: this run is '${av.reason}', but §27/§28 were measured in 'midcarve_replace'.`);
    log('   Numbers below are NOT directly comparable to those sections.');
  }

  const rows = await page.evaluate(probe, { center: TARGET.center, rayDeg: TARGET.rayDeg, bearings: BEARINGS, profAt: PROFILE_AT });
  const guard = await page.evaluate(() => ({
    inlandWaterGuard: (window.__RAW_GPU__ || {}).inlandWaterGuard || null,
    islandReassert: (window.__RAW_GPU__ || {}).islandReassert || null,
    overlay: (window.__RAW_GPU__ || {}).overlayMask ? window.__RAW_GPU__.overlayMask.reason : null,
  }));
  await ctx.close(); await browser.close();

  const ok = rows.filter((r) => r.a0 !== undefined);
  const sup = ok.filter((r) => r.a0 < 0.5), nor = ok.filter((r) => r.a0 >= 0.5);
  const avg = (a) => (a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : null);
  log(`overlay=${guard.overlay}  reassert.applied=${guard.islandReassert && guard.islandReassert.applied}`);
  log(`inlandWaterGuard=${JSON.stringify(guard.inlandWaterGuard)}`);
  log(`rays ${ok.length}/${BEARINGS}   suppressed ${sup.length}   normal ${nor.length}`);
  log('');
  log('DISCRIMINATOR 1 — does the ray RE-ENTER LAND after the detected coast?  (I) predicts YES for suppressed');
  log(`  suppressed: mean re-entry samples ${avg(sup.map((r) => r.reentry))}   with any re-entry: ${sup.filter((r) => r.reentry > 0).length}/${sup.length}`);
  log(`  normal    : mean re-entry samples ${avg(nor.map((r) => r.reentry))}   with any re-entry: ${nor.filter((r) => r.reentry > 0).length}/${nor.length}`);
  log('');
  log('DISCRIMINATOR 2 — how far out does the field reach half its far value?  (I) predicts SHORT for suppressed');
  log(`  suppressed: mean onset ${avg(sup.map((r) => r.onset))} px   median ${sup.map((r) => r.onset).sort((a, b) => a - b)[Math.floor(sup.length / 2)]}`);
  log(`  normal    : mean onset ${avg(nor.map((r) => r.onset))} px   median ${nor.map((r) => r.onset).sort((a, b) => a - b)[Math.floor(nor.length / 2)]}`);
  log('');
  log('SUPPRESSED BEARINGS in detail (coast point, onset, re-entry, G profile at ' + PROFILE_AT.join('/') + '):');
  for (const r of sup) {
    log(`  ${String(r.bearingDeg).padStart(5)} deg  coast@${String(r.coast).padStart(3)}px ${JSON.stringify(r.coastLngLat)}`
      + `  a0=${r.a0}  onset=${r.onset}px  reentry=${r.reentry}(first@${r.firstReentry})  G=[${r.prof.join(',')}]`);
  }
  log('');
  log('NORMAL bearings, for contrast (first 6):');
  for (const r of nor.slice(0, 6)) {
    log(`  ${String(r.bearingDeg).padStart(5)} deg  coast@${String(r.coast).padStart(3)}px ${JSON.stringify(r.coastLngLat)}`
      + `  a0=${r.a0}  onset=${r.onset}px  reentry=${r.reentry}  G=[${r.prof.join(',')}]`);
  }
  log('');
  const supRe = sup.filter((r) => r.reentry > 0).length / Math.max(1, sup.length);
  const norRe = nor.filter((r) => r.reentry > 0).length / Math.max(1, nor.length);
  const supOn = avg(sup.map((r) => r.onset)), norOn = avg(nor.map((r) => r.onset));
  if (supRe > 0.6 && supRe > norRe * 2) {
    log('=> (I) INSTRUMENT: the suppressed bearings sit on water the ray then LEAVES for land — enclosed/');
    log('   sheltered water (harbour, marina, river mouth). The field is correctly absent there and the');
    log('   metric is sampling the wrong kind of place. NOT a render defect.');
  } else if (supRe < 0.3 && supOn !== null && norOn !== null && supOn > norOn * 3) {
    log('=> (II) DEFECT: suppressed bearings are OPEN coast with no land re-entry, and the field stays');
    log('   off well seaward. That is a real render/mask failure and needs attribution.');
  } else {
    log('=> MIXED / INCONCLUSIVE — read the per-bearing table above before concluding anything.');
  }
  fs.writeFileSync(path.join(outdir, 'residual-coast-form.json'), JSON.stringify({ guard, rows }, null, 1));
  log('written: ' + path.join(outdir, 'residual-coast-form.json'));
})().catch((e) => { console.error(e); process.exit(1); });
