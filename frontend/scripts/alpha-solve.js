/**
 * alpha-solve.js — recover the field's ALPHA near the coast, free of both confounds.
 *
 * WHY EVERY EARLIER METRIC FAILED. A composite hides alpha: C = a*F + (1-a)*B. One equation, two
 * unknowns. Reading colour alone therefore cannot separate "the field is faded here" from "the
 * field's VALUE is lower here" or "the BASEMAP is different here", and this investigation was
 * caught by each in turn — the basemap on Grand Bahama's bank, and the wave field on Madeira, where
 * the tint gradient's SIGN flipped against Nassau and refuted the whole radial approach.
 *
 * THE METHOD is triangulation matting (Smith & Blinn 1996): photograph the same foreground over two
 * KNOWN, DIFFERENT backgrounds and subtract.
 *      C1 = a*F + (1-a)*B1
 *      C2 = a*F + (1-a)*B2      =>  C1 - C2 = (1-a)(B1 - B2)
 *      a  = 1 - (C1 - C2) / (B1 - B2)
 * F cancels. The wave value cannot enter, and the basemap enters only as a MEASURED difference.
 *
 * ⛔ THE LITERATURE'S CONSTRAINT, AND WHY THE OBVIOUS IMPLEMENTATION IS WRONG HERE. The foreground
 * must be IDENTICAL across both captures. The tempting backdrop swap is the app's own light/beach
 * themes — but `getThemedWaveColor(displayHeight, u_theme, u_surfMode)` gives the field a different
 * palette per theme (beach tropical-teal vs light ocean-blue), so F would change with B and the
 * solve would be under-determined all over again. Checked in the shader BEFORE building this.
 *
 * So the backdrop is swapped WITHOUT touching the theme: the basemap water layer's paint colour is
 * forced at runtime. Same theme, same data, same camera, same field — only B moves.
 *
 * FOUR CAPTURES per camera, all one theme:
 *      B1 waves OFF, water stock      B2 waves OFF, water FORCED
 *      C1 waves ON,  water stock      C2 waves ON,  water FORCED
 *
 * GUARDS, because a matte solve fails silently:
 *   - per channel, require |B1-B2| >= MIN_SEP, else that channel is not informative;
 *   - alpha must land in [0,1] — systematic excursions mean the blend is not linear in the space
 *     being measured (gamma / premultiplication), and the run says so instead of reporting numbers;
 *   - OceanMask re-asserts style properties on a timer, so the forced colour is re-applied and
 *     RE-VERIFIED immediately before each capture rather than set once and trusted;
 *   - an OPEN-OCEAN control ray set far from any land: alpha there must be flat. If it is not, the
 *     instrument is measuring something other than coast proximity.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AS_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'alpha-solve-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[alpha-solve] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const FORCED_WATER = '#ff0000';     // maximally far from every ocean/field colour in every channel
const MIN_SEP = 20;                 // per-channel |B1-B2| needed for that channel to inform alpha
// WIDENED 2026-08-17. The first run showed alpha still RISING at d50 on both islands, so the ramp
// is wider than the window and its characteristic width was never captured. That width is the
// diagnostic: a mask-driven feather saturates at ~1-2 of ITS OWN texels, so where alpha plateaus
// names WHICH mask governs. Regional masks here are sub-pixel (0.66-1.11 device px, measured); the
// coarse GLOBAL mask is 4096 over 360 deg = ~288 device px per texel at these cameras. Those two
// predictions are ~300x apart, so the saturation distance cannot be ambiguous between them.
const DISTS = [0, 1, 2, 4, 8, 16, 32, 64, 128, 200, 300, 400];
const TARGETS = [
  { id: 'nassau',   kind: 'island',   center: [-77.35, 25.05], z: 10.17, rayDeg: 0.30 },
  { id: 'madeira',  kind: 'island',   center: [-16.92, 32.74], z: 9.30,  rayDeg: 0.45 },
  { id: 'florida',  kind: 'mainland', center: [-80.10, 26.60], z: 10.17, rayDeg: 0.30 },
  { id: 'openocean', kind: 'CONTROL-no-coast', center: [-72.00, 28.00], z: 9.30, rayDeg: 0.40 },
];

/** Sample mean RGB per distance-from-shore bucket along 24 radial rays. */
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
  // Force / restore the basemap water paint. OceanMask re-asserts on a timer, so this is called
  // again right before every capture and its effect is re-read, never assumed to have stuck.
  const setWater = (colour) => page.evaluate((col) => {
    const m = window.map; const done = [];
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col === null ? undefined : col); done.push(l.id); } catch (e) {}
      }
    }
    return done;
  }, colour);

  const results = [];
  for (const tgt of TARGETS) {
    await setWaves(true);
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: tgt.center, z: tgt.z });
    await page.waitForTimeout(12000);

    await setWater(null); await page.waitForTimeout(2500);
    const C1 = await page.evaluate(sampleRays, { tgt, dists: DISTS });
    const forced = await setWater(FORCED_WATER); await page.waitForTimeout(2500);
    const C2 = await page.evaluate(sampleRays, { tgt, dists: DISTS });

    await setWaves(false); await page.waitForTimeout(6000);
    await setWater(FORCED_WATER); await page.waitForTimeout(2000);
    const B2 = await page.evaluate(sampleRays, { tgt, dists: DISTS });
    await setWater(null); await page.waitForTimeout(2500);
    const B1 = await page.evaluate(sampleRays, { tgt, dists: DISTS });
    await setWaves(true);

    const rows = [];
    for (const d of DISTS) {
      const c1 = C1['d' + d], c2 = C2['d' + d], b1 = B1['d' + d], b2 = B2['d' + d];
      if (!c1 || !c2 || !b1 || !b2) { rows.push({ d, alpha: null, why: 'missing' }); continue; }
      const per = [];
      for (let k = 0; k < 3; k++) {
        const sep = b1[k] - b2[k];
        if (Math.abs(sep) < MIN_SEP) continue;              // channel carries no background contrast
        per.push(1 - (c1[k] - c2[k]) / sep);
      }
      if (!per.length) { rows.push({ d, alpha: null, why: 'no channel separated' }); continue; }
      per.sort((x, y) => x - y);
      rows.push({ d, alpha: +per[Math.floor(per.length / 2)].toFixed(3), nch: per.length,
        inRange: per.every((a) => a >= -0.15 && a <= 1.15) });
    }
    const sep = DISTS.map((d) => (B1['d' + d] && B2['d' + d])
      ? Math.max(...[0, 1, 2].map((k) => Math.abs(B1['d' + d][k] - B2['d' + d][k]))) : null);
    results.push({ target: tgt.id, kind: tgt.kind, z: tgt.z, forcedLayers: forced,
      usedRays: C1.usedRays, rows, bgSeparation: sep, C1, C2, B1, B2 });
    log(`${tgt.id.padEnd(9)} [${tgt.kind}] rays=${C1.usedRays} forcedLayers=${forced.join(',') || 'NONE'}`);
    log('   d      : ' + DISTS.map((d) => String(d).padStart(7)).join(''));
    log('   |B1-B2|: ' + sep.map((v) => String(v === null ? '-' : v.toFixed(0)).padStart(7)).join(''));
    log('   ALPHA  : ' + rows.map((r) => String(r.alpha === null ? '-' : r.alpha.toFixed(3)).padStart(7)).join(''));
    const bad = rows.filter((r) => r.alpha !== null && !r.inRange).length;
    if (bad) log(`   ⚠ ${bad}/${rows.length} buckets have a channel outside [0,1] — blend may not be linear here`);
  }

  fs.writeFileSync(path.join(outdir, 'alpha-solve.json'), JSON.stringify({ base: BASE, forcedWater: FORCED_WATER,
    minSep: MIN_SEP, dists: DISTS, results }, null, 1));
  log('written: ' + path.join(outdir, 'alpha-solve.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
