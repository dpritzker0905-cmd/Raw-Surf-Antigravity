/**
 * teardown-255-whatcovers.js — the hole is DOWNSTREAM of the mask. Which family?
 *
 * WHAT IS ESTABLISHED (teardown-255.js, camera centred on the probe, overlay engaged):
 * from the shoreline out to 7 CSS px the mask reads **255 — full water — on every term**
 * (base 255, overlay 255, effective 255, src `overlay_replace`), and the painted pixel is still
 * BYTE-IDENTICAL to its waves-OFF colour. The mask is right; the field is missing anyway.
 * ⇒ every lever swept in this arc was a MASK lever, which is why all of them returned null.
 *
 * TWO FAMILIES REMAIN, and they need opposite fixes:
 *   NEVER DRAWN   — the heatmap pass skips these pixels (data coverage, a gate uniform, a clip).
 *   DRAWN & COVERED — the heatmap paints, and a basemap layer ABOVE the marine custom layer hides
 *                     it. |ON-OFF| = 0 fits this perfectly: an opaque layer on top paints the same
 *                     colour whether Waves is on or off.
 *
 * THE DISCRIMINATOR. queryRenderedFeatures with NO layer filter, inside the hole vs just beyond it:
 * a layer present at d=4 but absent at d=20 is a candidate cover. Then read the paint order and keep
 * only the candidates that sit ABOVE the marine layer — a layer underneath cannot hide anything.
 *
 * ⛔ `getStyle().layers` OMITS custom layers, so the marine layer is INVISIBLE in it and every
 * candidate would look "above" by default. The order must come from `map.style._order`, which
 * includes them. (Landmine from the 08-16 halo arc; re-applied here rather than re-learned.)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-covers-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[covers] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const Z = 9.30;

const probe = ({ pt }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = () => {
      m.off('render', fn);
      const rect = m.getContainer().getBoundingClientRect();
      const waterIds = (m.getStyle().layers || [])
        .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
        .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
      const isWater = (cx, cy) => {
        if (!(cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height)) return null;
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
      const mag = Math.hypot(sx, sy) || 1, nx = sx / mag, ny = sy / mag;

      // ⛔ custom layers are absent from getStyle().layers — the real paint order is style._order
      let order = [];
      try { order = (m.style && m.style._order) ? m.style._order.slice() : []; } catch (e) {}
      const styleIds = new Set((m.getStyle().layers || []).map((l) => l.id));
      const customIds = order.filter((id) => !styleIds.has(id));

      const at = (d) => {
        const x = c0.x + nx * d, y = c0.y + ny * d;
        let feats = [];
        try { feats = m.queryRenderedFeatures([x, y]) || []; } catch (e) {}
        const ids = [];
        for (const f of feats) if (f.layer && ids.indexOf(f.layer.id) < 0) ids.push(f.layer.id);
        return { d, x: +x.toFixed(1), y: +y.toFixed(1), layers: ids };
      };
      const samples = [-4, 1, 3, 5, 7, 10, 20, 40].map(at);
      resolve({ nx: +nx.toFixed(3), ny: +ny.toFixed(3), ringWater: nW, ringLand: nL,
        order, customIds, samples, zoom: +m.getZoom().toFixed(2) });
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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ p, z }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: z }), { p: PT, z: Z });
  await page.waitForTimeout(14000);
  const r = await page.evaluate(probe, { pt: PT });
  await page.screenshot({ path: path.join(outdir, 'covers.png') });
  await ctx.close();

  log(`zoom ${r.zoom}  normal (${r.nx}, ${r.ny})  ring w${r.ringWater}/l${r.ringLand}`);
  log(`custom (non-style) layers in paint order: ${JSON.stringify(r.customIds)}`);
  log('');
  for (const s of r.samples) log(`  d=${String(s.d).padStart(3)}  ${s.layers.length} layers: ${s.layers.join(', ') || '(none)'}`);
  log('');
  const inHole = r.samples.filter((s) => s.d >= 1 && s.d <= 7);
  const beyond = r.samples.filter((s) => s.d >= 10);
  const beyondSet = new Set(beyond.flatMap((s) => s.layers));
  const common = inHole.length
    ? inHole.map((s) => s.layers).reduce((a, b) => a.filter((x) => b.includes(x)))
    : [];
  const candidates = common.filter((id) => !beyondSet.has(id));
  // only a layer painted ABOVE the marine custom layer can hide it
  const marineIdx = Math.min(...r.customIds.map((id) => r.order.indexOf(id)).filter((i) => i >= 0));
  const above = candidates.filter((id) => r.order.indexOf(id) > marineIdx);
  log(`present in the WHOLE hole but absent beyond it: ${JSON.stringify(candidates)}`);
  log(`  ...of those, painted ABOVE the first custom layer (index ${marineIdx}): ${JSON.stringify(above)}`);
  log('');
  log(above.length
    ? 'DRAWN & COVERED is live — these layers sit over the marine layer exactly across the hole.'
    : 'NO COVERING LAYER — nothing basemap-side is unique to the hole and above the marine layer, '
      + 'so the field is NEVER DRAWN there and the cause is in the heatmap pass (coverage / gate / clip), '
      + 'not in compositing.');
  fs.writeFileSync(path.join(outdir, 'covers.json'), JSON.stringify({ base: BASE, pt: PT, z: Z, ...r, candidates, above }, null, 1));
  log('written: ' + path.join(outdir, 'covers.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
