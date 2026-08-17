/**
 * alpha-lever-sweep.js — attribute the coastal alpha ramp to a TERM, by levering each one.
 *
 * The alpha solve (alpha-solve.js) isolated the halo as a reproducible alpha profile at Madeira:
 * 0.099 at the shoreline, 86% of full opacity by ~32 device px, ~0.75 far out. Reproducible to
 * three decimals across two runs. What it does not say is WHICH term multiplies the alpha down.
 *
 * The fragment shader has exactly three alpha factors:
 *     alpha *= maskFade                                    (the land mask)
 *     alpha *= smoothstep(u_heightAlphaLo, u_heightAlphaHi, displayHeight)   (height-keyed)
 *     alpha *= feather                                     (regional GRID-bounds feather)
 *
 * Each leg flips one lever and re-solves alpha at the SAME camera. The term that owns the ramp is
 * the one whose removal FLATTENS the profile. Legs share ONE page load and ONE resident field —
 * levers are per-frame window flags, so the only difference between legs is the flag.
 *
 * The Waves-OFF backgrounds B1/B2 are captured ONCE: no field is drawn in them, so no marine lever
 * can change them, and re-capturing per leg would only add drift.
 *
 * Madeira only. Nassau read 0.115 then 0.706 for the same camera across two runs and has failed
 * three times this session; a target that does not reproduce cannot arbitrate between levers.
 *
 * READING IT: `spread` = alpha(d128) - alpha(d0). Stock is ~0.60. A lever that owns the ramp drives
 * spread toward 0. A lever that merely dims everything moves the LEVEL and leaves spread alone —
 * which is why spread, not the absolute alpha, is the statistic.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AL_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'alpha-lever-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[lever-sweep] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGET = { id: 'madeira', center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const FORCED_WATER = '#ff0000';
const MIN_SEP = 20;
const DISTS = [0, 1, 2, 4, 8, 16, 32, 64, 128];
const LEGS = [
  { id: 'stock', flags: {} },
  { id: 'halo_damp_off', flags: { __RAW_DISABLE_HALO_DAMP__: true } },
  { id: 'blend_both_off', flags: { __RAW_DISABLE_BLEND_BOTH__: true } },
  { id: 'midzoom_carve_off', flags: { __RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__: true } },
  { id: 'crest_off', flags: { __RAW_CREST_LAND_THRESH__: 9, __RAW_DISABLE_COAST_SDF__: true } },
];
const ALL_FLAGS = ['__RAW_DISABLE_HALO_DAMP__', '__RAW_DISABLE_BLEND_BOTH__',
  '__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__', '__RAW_CREST_LAND_THRESH__', '__RAW_DISABLE_COAST_SDF__'];

const sampleRays = ({ tgt, dists }) => {
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
      const mean = (a) => (a.length ? [0, 1, 2].map((k) => a.reduce((s, p) => s + p[k], 0) / a.length) : null);
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
    if ((b.getAttribute('aria-pressed') === 'true') !== want) b.click();
    return b.getAttribute('aria-pressed');
  }, on);
  const setWater = (colour) => page.evaluate((col) => {
    const m = window.map; const done = [];
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col === null ? undefined : col); done.push(l.id); } catch (e) {}
      }
    }
    return done;
  }, colour);

  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(14000);

  // Backgrounds once — no field is drawn in them, so no marine lever can move them.
  await setWaves(false); await page.waitForTimeout(6000);
  await setWater(FORCED_WATER); await page.waitForTimeout(2500);
  const B2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWater(null); await page.waitForTimeout(2500);
  const B1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWaves(true); await page.waitForTimeout(11000);
  log(`backgrounds captured (rays ${B1.usedRays}/${B2.usedRays})`);

  const solve = (C1, C2) => DISTS.map((d) => {
    const c1 = C1['d' + d], c2 = C2['d' + d], b1 = B1['d' + d], b2 = B2['d' + d];
    if (!c1 || !c2 || !b1 || !b2) return { d, alpha: null };
    const per = [];
    for (let k = 0; k < 3; k++) {
      const sep = b1[k] - b2[k];
      if (Math.abs(sep) < MIN_SEP) continue;
      per.push(1 - (c1[k] - c2[k]) / sep);
    }
    if (!per.length) return { d, alpha: null };
    per.sort((x, y) => x - y);
    return { d, alpha: +per[Math.floor(per.length / 2)].toFixed(3) };
  });

  const results = [];
  for (const leg of LEGS) {
    await page.evaluate(({ all, flags }) => {
      for (const f of all) delete window[f];
      Object.assign(window, flags);
    }, { all: ALL_FLAGS, flags: leg.flags });
    await page.waitForTimeout(4000);
    await setWater(null); await page.waitForTimeout(2000);
    const C1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
    await setWater(FORCED_WATER); await page.waitForTimeout(2000);
    const C2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
    await setWater(null);
    const rows = solve(C1, C2);
    const a0 = rows[0].alpha, aFar = rows[rows.length - 1].alpha;
    const spread = (a0 !== null && aFar !== null) ? +(aFar - a0).toFixed(3) : null;
    results.push({ leg: leg.id, flags: leg.flags, rays: C1.usedRays, rows, spread });
    log(`${leg.id.padEnd(19)} rays=${C1.usedRays}  alpha: `
      + rows.map((r) => String(r.alpha === null ? '-' : r.alpha.toFixed(3)).padStart(7)).join('')
      + `   SPREAD=${spread}`);
  }
  await page.evaluate((all) => { for (const f of all) delete window[f]; }, ALL_FLAGS);

  const stock = results.find((r) => r.leg === 'stock');
  log('');
  log('d:                  ' + DISTS.map((d) => String(d).padStart(7)).join(''));
  for (const r of results) {
    const dsp = (stock && r.spread !== null && stock.spread !== null)
      ? ` (${((1 - r.spread / stock.spread) * 100).toFixed(0)}% flatter than stock)` : '';
    log(`${r.leg.padEnd(19)} spread=${r.spread}${dsp}`);
  }
  fs.writeFileSync(path.join(outdir, 'alpha-lever-sweep.json'),
    JSON.stringify({ base: BASE, target: TARGET, dists: DISTS, B1, B2, results }, null, 1));
  log('written: ' + path.join(outdir, 'alpha-lever-sweep.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
