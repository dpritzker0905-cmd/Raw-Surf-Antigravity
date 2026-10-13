/**
 * overlay-mask-profile.js — read the OVERLAY MASK's own coastal alpha, separated from every other
 * alpha factor.
 *
 * WHERE THIS SITS. The deployed A/B showed the shipped midcarve-REPLACE change is only ~10% of the
 * halo. What survives is narrow: under REPLACE the overlay ALONE governs the coast, yet composite
 * alpha still ramps 0.16 -> 0.66. Either the overlay mask itself is soft at the coast, or the mask
 * is crisp and one of the OTHER alpha factors (u_opacity, the height-keyed smoothstep) carries the
 * ramp. Those need different fixes, and nothing measured so far separates them.
 *
 * THE INSTRUMENT. The shader already has the separator built in: `__GPU_DEBUG__ = {mode:'mask'}`
 * emits `gl_FragColor = vec4(oceanAlpha, oceanAlpha, oceanAlpha, u_opacity)` — the mask value as
 * greyscale, with NO maskFade, NO height term, NO feather applied. Compositing that over two known
 * backgrounds recovers both unknowns instead of one:
 *
 *     C = u_opacity * grey + (1 - u_opacity) * B          (grey = oceanAlpha, replicated per channel)
 *     C1 - C2 = (1 - u_opacity)(B1 - B2)   =>  u_opacity  (must be CONSTANT with distance)
 *     grey = (C1 - (1 - u_opacity) * B1) / u_opacity      =>  oceanAlpha per sample
 *
 * u_opacity coming out flat across distance is the instrument's own self-check: it is a uniform, so
 * any coast-dependence in it would mean the solve is picking up something it should not.
 *
 * THE VERDICT THIS PRODUCES:
 *   oceanAlpha ramps 0.5 -> 1.0 over tens of px  => the MASK is soft; fix the mask.
 *   oceanAlpha is a hard step at the shoreline   => the mask is fine; the ramp is in u_opacity or
 *                                                   the height term, and the mask is exonerated.
 *
 * Run against the DEPLOYED alias: localhost does not exhibit this defect (min-combine reads 0.78 at
 * the shoreline there vs 0.09 on the alias), so a local reading would answer about the wrong scene.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.OM_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'overlay-mask-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[mask-profile] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { id: 'madeira', center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const FORCED_WATER = '#ff0000';
const MIN_SEP = 20;
const DISTS = [-8, -4, -2, -1, 0, 1, 2, 4, 8, 16, 32, 64, 128];
const REPLICATES = 3;

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
      const perRay = [];            // per-ray profiles: a mean can fake a ramp out of steps
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
        const ray = { b, vals: {} };
        for (const d of dists) {
          const i = coast + d; if (i > n || i < 0) continue;
          const c = px(p0.x + dx * i / n, p0.y + dy * i / n);
          if (c) { buckets[d].push(c); ray.vals['d' + d] = c; }
        }
        perRay.push(ray);
      }
      const mean = (a) => (a.length ? [0, 1, 2].map((k) => a.reduce((s, p) => s + p[k], 0) / a.length) : null);
      const o = { usedRays: used, perRay };
      for (const d of dists) o['d' + d] = mean(buckets[d]);
      resolve(o);
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

async function runOnce(browser, rep) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    window.__GPU_DEBUG__ = { mode: 'mask' };     // oceanAlpha as greyscale, before every alpha factor
    // NO LEVER. The missing cell is `midcarve_replace`'s OWN mask profile: coverage_gap measured
    // CRISP (0.911 -> 0.987 by d4) and min_combine measured SOFT (0.385 -> 0.982 over 32-64 px),
    // but the shipped path was never measured. Both REPLACE paths set the same uniform, so if
    // midcarve_replace is crisp the residual ramp is a LATER alpha term, and if it is soft the two
    // REPLACE paths differ in the overlay texture itself. The regime is not selectable — it depends
    // on whether the base mask happens to cover the viewport — so this takes replicates and groups
    // by the mode each one lands in.
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
    window.__GPU_DEBUG__ = { mode: 'mask' };
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
  await page.waitForTimeout(15000);
  await page.evaluate(() => { window.__GPU_DEBUG__ = { mode: 'mask' }; window.map.triggerRepaint(); });
  await page.waitForTimeout(2500);

  await setWater(null); await page.waitForTimeout(2000);
  const C1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWater(FORCED_WATER); await page.waitForTimeout(2000);
  const C2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWaves(false); await page.waitForTimeout(6500);
  const B2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWater(null); await page.waitForTimeout(2500);
  const B1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  const meta = await page.evaluate(() => {
    const g = window.__RAW_GPU__ || {}, om = g.overlayMask || {};
    const b = om.bounds || null;
    const m = window.map, c0 = m.getCenter();
    const pA = m.project([c0.lng, c0.lat]), pB = m.project([c0.lng + 1, c0.lat]);
    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const devPxPerDeg = Math.abs(pB.x - pA.x) * (src.width / rect.width);
    return { mode: om.reason || null, replace: om.replace, coversView: om.overlayCoversView,
      ovSpanDeg: b ? +(b.east - b.west).toFixed(3) : null,
      ovSpanDevPx: b ? +((b.east - b.west) * devPxPerDeg).toFixed(0) : null,
      baseCoversView: om.baseCoversView };
  });
  const mode = meta.mode;
  await page.screenshot({ path: path.join(outdir, `MASKDEBUG_rep${rep}.png`) });
  await ctx.close();

  const rows = DISTS.map((d) => {
    const c1 = C1['d' + d], c2 = C2['d' + d], b1 = B1['d' + d], b2 = B2['d' + d];
    if (!c1 || !c2 || !b1 || !b2) return { d, opacity: null, oceanAlpha: null };
    const ops = [], greys = [];
    for (let k = 0; k < 3; k++) {
      const sep = b1[k] - b2[k];
      if (Math.abs(sep) < MIN_SEP) continue;
      const a = 1 - (c1[k] - c2[k]) / sep;                 // = u_opacity here (a uniform)
      ops.push(a);
      if (a > 0.05) greys.push(((c1[k] - (1 - a) * b1[k]) / a) / 255);   // = oceanAlpha, 0..1
    }
    if (!ops.length) return { d, opacity: null, oceanAlpha: null };
    const med = (v) => { const s = v.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return { d, opacity: +med(ops).toFixed(3), oceanAlpha: greys.length ? +med(greys).toFixed(3) : null };
  });
  // ── PER-RAY DECOMPOSITION ──────────────────────────────────────────────────────────────────
  // A mean over 24 bearings cannot distinguish a FEATHERED coast (every ray ramps) from a DISPLACED
  // one (every ray steps hard, at a different distance). Those need opposite fixes: soften-the-paint
  // vs fix-the-geometry. Solve alpha per ray, then per ray measure (a) the 10-90% transition WIDTH
  // and (b) WHERE the 50% crossing sits. Narrow widths + scattered crossings = displacement.
  const rayIdx = (o) => Object.fromEntries((o.perRay || []).map((r) => [r.b, r.vals]));
  const iC1 = rayIdx(C1), iC2 = rayIdx(C2), iB1 = rayIdx(B1), iB2 = rayIdx(B2);
  const water = DISTS.filter((d) => d >= 0);
  const perRayStats = [];
  for (const b of Object.keys(iC1)) {
    if (!(iC2[b] && iB1[b] && iB2[b])) continue;
    const prof = [];
    for (const d of water) {
      const c1 = iC1[b]['d' + d], c2 = iC2[b]['d' + d], b1 = iB1[b]['d' + d], b2 = iB2[b]['d' + d];
      if (!c1 || !c2 || !b1 || !b2) { prof.push(null); continue; }
      const g = [];
      for (let k = 0; k < 3; k++) {
        const sep = b1[k] - b2[k];
        if (Math.abs(sep) < MIN_SEP) continue;
        const a = 1 - (c1[k] - c2[k]) / sep;
        if (a > 0.05) g.push(((c1[k] - (1 - a) * b1[k]) / a) / 255);
      }
      if (!g.length) { prof.push(null); continue; }
      g.sort((x, y) => x - y);
      prof.push(g[Math.floor(g.length / 2)]);
    }
    const ok = prof.map((v, i) => (v === null ? null : { d: water[i], v })).filter(Boolean);
    if (ok.length < 4) continue;
    const lo = ok[0].v, hi = ok[ok.length - 1].v;
    if (hi - lo < 0.15) { perRayStats.push({ b: +b, width: null, cross50: null, note: 'no transition on this ray' }); continue; }
    const at = (frac) => {
      const t = lo + frac * (hi - lo);
      for (let i = 1; i < ok.length; i++) {
        if (ok[i].v >= t) {
          const p = ok[i - 1], q = ok[i];
          return p.d + (q.d - p.d) * ((t - p.v) / Math.max(1e-6, q.v - p.v));
        }
      }
      return ok[ok.length - 1].d;
    };
    perRayStats.push({ b: +b, width: +(at(0.9) - at(0.1)).toFixed(1), cross50: +at(0.5).toFixed(1) });
  }
  const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const widths = perRayStats.map((r) => r.width), crosses = perRayStats.map((r) => r.cross50);
  const finite = crosses.filter(Number.isFinite);
  const crossSpread = finite.length > 1 ? +(Math.max(...finite) - Math.min(...finite)).toFixed(1) : null;
  return { rep, rays: C1.usedRays, mode, meta, rows,
    perRayMedianWidth: med(widths), perRayMedianCross50: med(crosses), perRayCrossSpread: crossSpread,
    perRayStats };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const runs = [];
  for (let rep = 1; rep <= REPLICATES; rep++) {
    const r = await runOnce(browser, rep);
    runs.push(r);
    log(`rep${rep} rays=${r.rays} mode=${r.mode} ovSpan=${r.meta.ovSpanDeg}deg/${r.meta.ovSpanDevPx}px baseCovers=${r.meta.baseCoversView}`);
    log('   d          : ' + r.rows.map((x) => String(x.d).padStart(7)).join(''));
    log('   u_opacity  : ' + r.rows.map((x) => String(x.opacity === null ? '-' : x.opacity.toFixed(3)).padStart(7)).join(''));
    log('   oceanAlpha : ' + r.rows.map((x) => String(x.oceanAlpha === null ? '-' : x.oceanAlpha.toFixed(3)).padStart(7)).join(''));
    log(`   PER-RAY: median 10-90% width = ${r.perRayMedianWidth} px | median 50% crossing = `
      + `${r.perRayMedianCross50} px | crossing SPREAD across bearings = ${r.perRayCrossSpread} px`);
  }
  // self-check: u_opacity is a UNIFORM, so it must not vary with distance
  for (const r of runs) {
    const ops = r.rows.map((x) => x.opacity).filter((v) => v !== null);
    const drift = ops.length ? +(Math.max(...ops) - Math.min(...ops)).toFixed(3) : null;
    log(`rep${r.rep} u_opacity drift across distance = ${drift}` +
      (drift !== null && drift > 0.12 ? '  ⚠ NOT CONSTANT — the solve is picking up something else' : '  (flat, as a uniform must be)'));
  }
  fs.writeFileSync(path.join(outdir, 'overlay-mask-profile.json'), JSON.stringify({ base: BASE, target: TARGET, dists: DISTS, runs }, null, 1));
  log('written: ' + path.join(outdir, 'overlay-mask-profile.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
