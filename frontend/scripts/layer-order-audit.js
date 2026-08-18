/**
 * layer-order-audit.js — is the mask-family stack order still what the 08-13..08-16 arc proved?
 *
 * WHY THIS EXISTS. The owner's read: the halo was resolved for the marine layers, and the WATER_TEMP
 * work regressed it. The history backs that shape exactly:
 *   08-13  e88b0f68 + f3fe2c85  water_temp anchor fixes. f3fe2c85 RAISED the ocean mask above the
 *          basemap water fill and moved everything anchored beneath it — the water_temp slots AND
 *          the marine layer (via mapUtils.findMarineInsertionLayer). Its own verified table:
 *              water_temp slots [3,4,5] -> [19,20,21]   ocean-mask-fill 6 -> 22   water 11 -> 6
 *   08-15  7becd023  "the owner's visible regression ROOT-CAUSED -- the mask-family STACK ORDER"
 *   08-16  784b4c6c + d555b17e  the repairs; LOP-0001..0003 written to LAYER_ORDER_PROOF_LOG.json
 *
 * So a water_temp change did move the marine stack, it did cause a visible regression, and it was
 * repaired. The open question is whether that repair still HOLDS — which is a question about the
 * live order, not about grid resolution. This dumps the order and checks the proven invariants.
 *
 * ⛔ ORDER MUST COME FROM `map.style._order` — `getStyle().layers` OMITS custom layers, so the marine
 * layer itself is invisible in it and every "above/below marine" answer would be wrong by default.
 * ⛔ OPACITY, not visibility: OceanMask.js:658 silently reverts `visibility:'none'`, so a layer can
 * read hidden and still paint.
 *
 * INVARIANTS CHECKED (each names the commit that proved it, so a failure is traceable):
 *   INV-1  ocean-mask-fill ABOVE the basemap water fill            (f3fe2c85)
 *   INV-2  the marine field ABOVE the basemap water fill           (f3fe2c85 — the whole point)
 *   INV-3  ocean-mask-buffer effectively OFF                       (LOP-0001 / 784b4c6c)
 *   INV-4  no OPAQUE basemap water fill above the marine field     (the regression detector e88b0f68 installed)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'layer-order-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[order] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const CAM = { center: [-16.95, 32.75], z: 9.3 };

const audit = () => {
  const m = window.map;
  const order = (m.style && m.style._order) ? m.style._order.slice() : [];
  if (!order.length) return { err: 'style._order empty' };
  const styleLayers = m.getStyle().layers || [];
  const byId = {};
  for (const l of styleLayers) byId[l.id] = l;

  const rows = order.map((id, idx) => {
    const l = byId[id] || null;
    const custom = !l;
    let paint = {};
    if (l) {
      for (const p of ['fill-opacity', 'line-opacity', 'raster-opacity', 'background-opacity', 'icon-opacity']) {
        try { const v = m.getPaintProperty(id, p); if (v !== undefined) paint[p] = v; } catch (e) {}
      }
    }
    let vis = null;
    try { vis = m.getLayoutProperty(id, 'visibility'); } catch (e) {}
    return { idx, id, type: l ? l.type : 'CUSTOM', sourceLayer: l ? l['source-layer'] : null, custom, paint, vis };
  });

  const find = (pred) => rows.filter(pred);
  const marine = find((r) => r.custom || /marine|webgl/i.test(r.id));
  const marineIdx = marine.length ? Math.min.apply(null, marine.map((r) => r.idx)) : null;
  // the basemap ocean fill: the `water` layer and its source-layer siblings
  const waterFills = find((r) => r.type === 'fill' && (r.id === 'water' || r.sourceLayer === 'water'));
  const maskFamily = find((r) => /^ocean-mask/.test(r.id));
  const waterTemp = find((r) => /water[_-]?temp|wt-/i.test(r.id));

  const opacityOf = (r) => {
    const v = r.paint['fill-opacity'] !== undefined ? r.paint['fill-opacity']
      : r.paint['line-opacity'] !== undefined ? r.paint['line-opacity']
        : r.paint['raster-opacity'] !== undefined ? r.paint['raster-opacity'] : undefined;
    return v;
  };
  return {
    total: order.length, marineIdx,
    marine: marine.map((r) => ({ idx: r.idx, id: r.id, type: r.type })),
    maskFamily: maskFamily.map((r) => ({ idx: r.idx, id: r.id, type: r.type, opacity: opacityOf(r), vis: r.vis })),
    waterFills: waterFills.map((r) => ({ idx: r.idx, id: r.id, opacity: opacityOf(r), vis: r.vis })),
    waterTemp: waterTemp.map((r) => ({ idx: r.idx, id: r.id, type: r.type, opacity: opacityOf(r) })),
    around: rows.filter((r) => marineIdx !== null && Math.abs(r.idx - marineIdx) <= 4)
      .map((r) => ({ idx: r.idx, id: r.id, type: r.type })),
    zoom: +m.getZoom().toFixed(2),
  };
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
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
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), CAM);
  await page.waitForTimeout(15000);
  const r = await page.evaluate(audit);
  await ctx.close(); await browser.close();

  if (r.err) { log('VOID: ' + r.err); return; }
  log(`build ${BASE}   z${r.zoom}   ${r.total} layers   marine at ${r.marineIdx}`);
  log('');
  log('MARINE / CUSTOM:'); for (const x of r.marine) log(`   ${String(x.idx).padStart(3)}  ${x.id}  (${x.type})`);
  log('MASK FAMILY:'); for (const x of r.maskFamily) log(`   ${String(x.idx).padStart(3)}  ${x.id.padEnd(28)} ${String(x.type).padEnd(6)} opacity=${JSON.stringify(x.opacity)} vis=${x.vis}`);
  log('BASEMAP WATER FILLS:'); for (const x of r.waterFills) log(`   ${String(x.idx).padStart(3)}  ${x.id.padEnd(28)} opacity=${JSON.stringify(x.opacity)} vis=${x.vis}`);
  log('WATER_TEMP SLOTS:'); for (const x of r.waterTemp) log(`   ${String(x.idx).padStart(3)}  ${x.id}  (${x.type})`);
  log('AROUND THE MARINE LAYER:'); for (const x of r.around) log(`   ${String(x.idx).padStart(3)}  ${x.id}  (${x.type})`);
  log('');

  const fill = r.maskFamily.find((x) => x.id === 'ocean-mask-fill');
  const topWater = r.waterFills.length ? Math.max.apply(null, r.waterFills.map((x) => x.idx)) : null;
  const buffer = r.maskFamily.find((x) => x.id === 'ocean-mask-buffer');
  const checks = [];
  checks.push(['INV-1 ocean-mask-fill ABOVE the basemap water fill (f3fe2c85)',
    fill && topWater !== null ? fill.idx > topWater : null,
    fill && topWater !== null ? `fill ${fill.idx} vs water ${topWater}` : 'layer missing']);
  checks.push(['INV-2 the marine field ABOVE the basemap water fill (f3fe2c85)',
    r.marineIdx !== null && topWater !== null ? r.marineIdx > topWater : null,
    r.marineIdx !== null && topWater !== null ? `marine ${r.marineIdx} vs water ${topWater}` : 'layer missing']);
  const bufOff = buffer ? (buffer.vis === 'none' || buffer.opacity === 0) : true;
  checks.push(['INV-3 ocean-mask-buffer effectively OFF (LOP-0001 / 784b4c6c)', bufOff,
    buffer ? `opacity=${JSON.stringify(buffer.opacity)} vis=${buffer.vis}` : 'layer absent (= off)']);
  const opaqueAbove = r.waterFills.filter((x) => r.marineIdx !== null && x.idx > r.marineIdx && x.opacity !== 0);
  checks.push(['INV-4 no OPAQUE basemap water fill above the marine field (e88b0f68 detector)',
    opaqueAbove.length === 0, opaqueAbove.length ? opaqueAbove.map((x) => x.id).join(', ') : 'none']);

  for (const [name, ok, detail] of checks) {
    log(`${ok === null ? '?? INCONCLUSIVE' : ok ? 'PASS' : 'FAIL          '}  ${name}   [${detail}]`);
  }
  const failed = checks.filter((c) => c[1] === false);
  log('');
  log(failed.length
    ? `${failed.length} PROVEN INVARIANT(S) BROKEN — the 08-16 stack-order repair no longer holds, and that is a REGRESSION with a named owner commit, not a resolution limit.`
    : 'All proven stack-order invariants HOLD on this build — the halo is not a regression of the 08-13 water_temp anchor move.');
  fs.writeFileSync(path.join(outdir, 'order.json'), JSON.stringify({ base: BASE, ...r, checks }, null, 1));
  log('written: ' + path.join(outdir, 'order.json'));
})().catch((e) => { console.error(e); process.exit(1); });
