/**
 * teardown-255-shaderuv.js — does the SHADER sample the mask where probeMaskGPU says it does?
 *
 * WHAT THE TEARDOWN HAS EXCLUDED, each by direct measurement at 32.69350 −17.12638:
 *   value gradient   |ON-OFF| = 0 exactly through the hole — the field is ABSENT, not merely different
 *   the mask data    base 255 / overlay 255 / effective 255 / src overlay_replace across the whole hole
 *   a covering layer identical basemap layers inside the hole and beyond it
 *   overlay state    coverage_gap and midcarve_replace both give 836 m
 *   data coverage    Florida grid and Madeira grid both give 836 m at fixed zoom
 *   basemap detail   the basemap shoreline sits at the probe coord at every zoom
 *   heightAlpha      u_heightAlphaEnabled defaults 0; edge feather keys on grid_uv (0.428 vs 0.18 width)
 *
 * WHAT THAT LEAVES. The mask BYTES are right and the field still does not paint, so the remaining
 * candidate is that the shader FETCHES A DIFFERENT TEXEL than the one probeMaskGPU reads — a UV or
 * bounds mismatch between the two. That fits the one unexplained property: the hole is 836 m at z9.3
 * but 24–98 m from z10.4 up, and a projection/bounds mismatch scales with the SPAN, which is exactly
 * what shrinks as you zoom in.
 *
 * THE INSTRUMENT IS ALREADY IN THE BUILD. `__GPU_DEBUG__.mode = 'mask'` makes the heatmap pass paint
 * the mask value it sampled (u_debug_mode = 2.0), so the screen shows the SHADER'S OWN view of the
 * coastline. Walk the coast normal in that mode and find where the shader's mask goes water:
 *
 *     shader edge at d≈0  ⇒ the shader samples correctly; the suppression is later in the pass
 *     shader edge at d≈8  ⇒ PROVEN: a mask-fetch displacement, and the hole is the shader reading
 *                           land where the mask stores water
 *
 * ⚠️ probeMaskGPU reads NEAREST at the exact coordinate and the shader reads LINEAR through its own
 * UV, so this compares the two paths rather than re-reading one of them — the point of the test.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-shaderuv-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[shaderuv] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const ZOOMS = [9.3, 11.4];

const walk = ({ pt }) => {
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
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2], img[o + 3]];
      };
      const isWater = (cx, cy) => {
        if (!(cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height)) return null;
        if ((document.elementFromPoint(cx, cy) || {}).tagName !== 'CANVAS') return null;
        try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
      };
      const c0 = m.project([pt.lng, pt.lat]);
      const R = 14; let sx = 0, sy = 0, nW = 0, nL = 0;
      for (let a = 0; a < 72; a++) {
        const th = (a / 72) * 2 * Math.PI;
        const w = isWater(c0.x + R * Math.cos(th), c0.y + R * Math.sin(th));
        if (w === true) { sx += Math.cos(th); sy += Math.sin(th); nW++; }
        else if (w === false) nL++;
      }
      if (nW < 6 || nL < 6) { resolve({ void: `ring not a coast (w${nW}/l${nL})` }); return; }
      const mag = Math.hypot(sx, sy) || 1, nx = sx / mag, ny = sy / mag;
      const rows = [];
      for (let d = -12; d <= 40; d++) {
        const x = c0.x + nx * d, y = c0.y + ny * d;
        rows.push({ d, water: isWater(x, y), c: px(x, y) });
      }
      resolve({ dpr, rows, zoom: +m.getZoom().toFixed(3),
        mPerCssPx: +(156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2).toFixed(2),
        overlayReason: ((window.__RAW_GPU__ || {}).overlayMask || {}).reason || null });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

const setDebug = (mode) => {
  if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
  window.__GPU_DEBUG__.mode = mode;
  if (window.map) window.map.triggerRepaint();
  return window.__GPU_DEBUG__.mode;
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

  const out = [];
  for (const z of ZOOMS) {
    await page.evaluate(({ p, zz }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: zz }), { p: PT, zz: z });
    await page.waitForTimeout(16000);
    const normal = await page.evaluate(walk, { pt: PT });
    await page.screenshot({ path: path.join(outdir, `SHADERUV_z${z}_normal.png`) });

    const mode = await page.evaluate(setDebug, 'mask');
    await page.waitForTimeout(4000);
    const dbg = await page.evaluate(walk, { pt: PT });
    await page.screenshot({ path: path.join(outdir, `SHADERUV_z${z}_maskdebug.png`) });
    await page.evaluate(setDebug, null);
    await page.waitForTimeout(2500);

    if (normal.void || dbg.void) { log(`z${z}: VOID ${normal.void || dbg.void}`); continue; }
    // In mask-debug the pass paints the sampled mask value; find where it turns bright (water).
    const lum = (c) => (c ? (c[0] + c[1] + c[2]) / 3 : null);
    const shore = dbg.rows.find((r) => r.water === true);
    const land = dbg.rows.filter((r) => r.d < -3).map((r) => lum(r.c)).filter((v) => v != null);
    const landRef = land.length ? land.reduce((a, b) => a + b, 0) / land.length : null;
    const far = dbg.rows.filter((r) => r.d >= 30).map((r) => lum(r.c)).filter((v) => v != null);
    const farRef = far.length ? far.reduce((a, b) => a + b, 0) / far.length : null;
    let shaderEdge = null;
    if (landRef != null && farRef != null && Math.abs(farRef - landRef) > 12) {
      const mid = (landRef + farRef) / 2;
      const hit = dbg.rows.find((r) => r.d >= (shore ? shore.d : 0) && lum(r.c) != null &&
        ((farRef > landRef) ? lum(r.c) >= mid : lum(r.c) <= mid));
      shaderEdge = hit ? hit.d - (shore ? shore.d : 0) : null;
    }
    const row = { z, mode, overlayReason: normal.overlayReason, mPerCssPx: normal.mPerCssPx,
      shoreD: shore ? shore.d : null, landLum: landRef == null ? null : +landRef.toFixed(1),
      farLum: farRef == null ? null : +farRef.toFixed(1), shaderEdgeCssPx: shaderEdge,
      shaderEdgeM: shaderEdge == null ? null : +(shaderEdge * normal.mPerCssPx).toFixed(0) };
    out.push(row);
    log(`z${z}  overlay=${row.overlayReason}  debugMode=${mode}  landLum=${row.landLum} farLum=${row.farLum}`);
    log(`     SHADER mask edge (from the basemap shoreline): `
      + (shaderEdge == null ? 'UNREADABLE — the debug view did not separate land from water, so this test says NOTHING'
        : `${shaderEdge} css px / ${row.shaderEdgeM} m`));
  }
  await ctx.close();

  log('');
  const wide = out.find((r) => r.z === 9.3);
  if (!wide || wide.shaderEdgeCssPx == null) {
    log('INCONCLUSIVE — no readable shader mask edge at z9.3. The debug view must separate land from '
      + 'water before this discriminates anything; reporting the failure rather than a number.');
  } else if (wide.shaderEdgeCssPx >= 5) {
    log(`PROVEN — the shader's OWN mask edge sits ${wide.shaderEdgeCssPx} css px seaward of the coast, `
      + 'matching the hole. The mask stores water there; the shader fetches land. It is a mask-FETCH '
      + 'displacement, not a mask-DATA defect — which is why every mask lever came back null.');
  } else {
    log(`REFUTED — the shader's mask edge is at ${wide.shaderEdgeCssPx} css px, i.e. on the coast, so the `
      + 'shader samples the mask correctly and the suppression happens further down the pass.');
  }
  fs.writeFileSync(path.join(outdir, 'shaderuv.json'), JSON.stringify({ base: BASE, pt: PT, out }, null, 1));
  log('written: ' + path.join(outdir, 'shaderuv.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
