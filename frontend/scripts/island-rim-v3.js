/**
 * island-rim-v3.js — the residual ring, on a baseline that cannot lie, with a validity gate.
 *
 * TWO FAULTS IN v2 THIS FIXES.
 *
 * 1. NASSAU KEPT PAINTING NOTHING. Each leg was its own page load and its own fetch, so the ON leg
 *    twice came back with no field and read identical to OFF — which would have said "the lever
 *    changed nothing" if the ON-vs-OFF check had not caught that the comparison did not exist.
 *    Here ALL legs share ONE page load and one resident field; the crest lever is a window flag the
 *    engine reads per frame, so it is toggled live and the three legs differ ONLY in that flag.
 *
 * 2. GRAND BAHAMA'S BASELINE IS NOT FLAT. Its Waves-OFF profile ramps 118 -> 143 because the
 *    basemap lightens off the shallow bank, so a semi-transparent field over a CHANGING backdrop
 *    manufactures part of the apparent tint ramp. Deep-water volcanic islands are added: Madeira
 *    and La Palma drop to abyssal depth within a few km, so their Waves-OFF backdrop is uniform by
 *    construction and any surviving ramp is the field's own.
 *
 * VALIDITY GATE: the ON leg must differ from OFF by >= MIN_TINT at d20, or the target is retried
 * and, failing that, REPORTED VOID. A leg that painted nothing is not a measurement of anything.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.RV_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'island-rim-v3-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[rim-v3] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGETS = [
  { id: 'nassau',   bathy: 'shallow bank', center: [-77.35, 25.05], z: 10.17, rayDeg: 0.30 },
  { id: 'madeira',  bathy: 'deep/steep',   center: [-16.92, 32.74], z: 9.30,  rayDeg: 0.45 },
  { id: 'la_palma', bathy: 'deep/steep',   center: [-17.87, 28.68], z: 9.60,  rayDeg: 0.35 },
];
const DISTS = [1, 2, 3, 5, 8, 12, 20, 35];
const MIN_TINT = 6;       // ON must differ from OFF by this much at d20 or the leg is void
const MAX_TRIES = 3;

// ⚠️ ONE destructured parameter, not two. page.evaluate(fn, arg) passes a SINGLE argument, so a
// two-parameter signature silently binds the whole wrapper to the first name and leaves the second
// undefined — every ray then projected `undefined`, threw, and the leg came back null. The gate
// caught it as "tint = null" rather than as a small tint, which is the only reason it did not read
// as a real measurement of "no halo".
const sampleLeg = ({ tgt, dists }) => {
  const m = window.map;
  return new Promise((resolve) => {
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
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const buckets = {}; for (const d of dists) buckets[d] = [];
      let used = 0;
      for (let b = 0; b < 24; b++) {
        const th = (b / 24) * 2 * Math.PI;
        const dest = [tgt.center[0] + tgt.rayDeg * Math.sin(th) / Math.cos(tgt.center[1] * Math.PI / 180),
          tgt.center[1] + tgt.rayDeg * Math.cos(th)];
        const p0 = m.project(tgt.center), p1 = m.project(dest);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
        const water = [];
        for (let i = 0; i <= n; i++) {
          const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
          const okv = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
            && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
          let w = null;
          if (okv) { try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {} }
          water.push(w);
        }
        let coast = -1;
        for (let i = 1; i + 8 <= n; i++) {
          if (water[i] !== true) continue;
          let ok = true; for (let k = 0; k < 8; k++) if (water[i + k] !== true) { ok = false; break; }
          if (ok && water.slice(0, i).some((x) => x === false)) { coast = i; break; }
        }
        if (coast < 0) continue;
        used++;
        for (const d of dists) {
          const i = coast + d; if (i > n) continue;
          const c = px(p0.x + dx * i / n, p0.y + dy * i / n); if (c) buckets[d].push(c);
        }
      }
      const mean = (a) => (a.length ? [0, 1, 2].map((k) => Math.round(a.reduce((s, p) => s + p[k], 0) / a.length)) : null);
      const o = { usedRays: used };
      for (const d of dists) o['d' + d] = mean(buckets[d]);
      resolve(o);
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
    if (!b) return 'no-button';
    const is = b.getAttribute('aria-pressed') === 'true';
    if (is !== want) b.click();
    return b.getAttribute('aria-pressed');
  }, on);
  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });

  const results = [];
  for (const tgt of TARGETS) {
    let rec = null;
    for (let attempt = 1; attempt <= MAX_TRIES && !rec; attempt++) {
      await setWaves(true);
      await page.evaluate(() => { delete window.__RAW_CREST_LAND_THRESH__; delete window.__RAW_DISABLE_COAST_SDF__; });
      await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: tgt.center, z: tgt.z });
      await page.waitForTimeout(9000 + attempt * 6000);
      const on = await page.evaluate(sampleLeg, { tgt, dists: DISTS }).catch(() => null);

      // crest lever, applied LIVE to the same resident field
      await page.evaluate(() => { window.__RAW_CREST_LAND_THRESH__ = 9; window.__RAW_DISABLE_COAST_SDF__ = true; });
      await page.waitForTimeout(3500);
      const nocrest = await page.evaluate(sampleLeg, { tgt, dists: DISTS }).catch(() => null);
      await page.evaluate(() => { delete window.__RAW_CREST_LAND_THRESH__; delete window.__RAW_DISABLE_COAST_SDF__; });

      await setWaves(false);
      await page.waitForTimeout(7000);
      const off = await page.evaluate(sampleLeg, { tgt, dists: DISTS }).catch(() => null);

      const tintAt = (a, b, d) => (a && b && a['d' + d] && b['d' + d])
        ? Math.max(...[0, 1, 2].map((k) => Math.abs(a['d' + d][k] - b['d' + d][k]))) : null;
      const gate = tintAt(on, off, 20);
      if (gate !== null && gate >= MIN_TINT) {
        rec = { target: tgt.id, bathy: tgt.bathy, z: tgt.z, attempt, on, nocrest, off,
          tint: DISTS.map((d) => ({ d, on: tintAt(on, off, d), nocrest: tintAt(nocrest, off, d) })) };
      } else {
        log(`${tgt.id}: attempt ${attempt} VOID (tint@d20 = ${gate}, need >= ${MIN_TINT}) — retrying`);
      }
    }
    if (!rec) { log(`${tgt.id}: VOID after ${MAX_TRIES} attempts — the field never painted here`);
      results.push({ target: tgt.id, void: true }); continue; }
    results.push(rec);
    const flat = (a) => DISTS.map((d) => { const o = a.off['d' + d]; return o ? Math.max(...o) - Math.min(...o) : null; });
    log(`${tgt.id.padEnd(9)} [${rec.bathy}] rays=${rec.on.usedRays} attempt=${rec.attempt}`);
    log('   OFF baseline R: ' + DISTS.map((d) => String(rec.off['d' + d] ? rec.off['d' + d][0] : '-').padStart(6)).join(''));
    log('   tint ON       : ' + rec.tint.map((t) => String(t.on === null ? '-' : t.on).padStart(6)).join(''));
    log('   tint NO-CREST : ' + rec.tint.map((t) => String(t.nocrest === null ? '-' : t.nocrest).padStart(6)).join(''));
  }
  fs.writeFileSync(path.join(outdir, 'island-rim-v3.json'), JSON.stringify({ base: BASE, dists: DISTS, results }, null, 1));
  log('written: ' + path.join(outdir, 'island-rim-v3.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
