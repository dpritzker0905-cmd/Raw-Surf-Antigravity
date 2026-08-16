/* layer-order-probe.js — measure the LIVE style stack around the marine + OceanMask family.
 * Owner clue (2026-08-15): rivers/lakes/parks/buildings/non-highway roads COVERED + coastal halo.
 * Candidate mechanism: WS-CAN-0061's anchor rule (findMaskInsertionPoint, 08-13) skips LINE-type
 * layers, so the mask family can land above waterways/roads. This prints the measured order and
 * what sits between `water` and the mask family. Usage: ZL_BASE=... node scripts/layer-order-probe.js */
const path = require('path');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }
const BASE = process.env.ZL_BASE || 'http://localhost:3011';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 90000 });
  // Enable Waves (the owner's repro has a marine layer active).
  const findWaves = () => {
    const all = Array.from(document.querySelectorAll('button'));
    let b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (!b) {
      const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')) &&
        !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
      if (exp) exp.click();
    }
    return b || null;
  };
  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 45000 });
  await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
  await page.waitForFunction(() => { const e = window.__MARINE_ENGINE__; return e && e._waveData && e._waveData.bounds; }, null, { timeout: 90000 });
  // Coastal city with buildings, rivers, minor roads: Cocoa / Cocoa Beach.
  await page.evaluate(() => window.map.jumpTo({ center: [-80.61, 28.36], zoom: 12.5 }));
  await page.waitForTimeout(12000); // let tiles + styledata churn settle
  const dump = await page.evaluate(() => {
    // ⛔ 2026-08-16 (C4-MR-07): this read `getStyle().layers`, which OMITS CUSTOM LAYERS. The marine
    // field `webgl-marine-particles` IS a custom layer, so every earlier stack probe was blind to
    // the very thing it was measuring — which is why the coastal-halo hunt took eleven weeks and why
    // the 08-15 planner work had to re-derive the order by hand. `map.style._order` carries every
    // layer, custom included; resolve each id with getLayer() for its type/source.
    const order = window.map.style._order || [];
    const rows = order.map((id, i) => {
      let l = null;
      try { l = window.map.getLayer(id); } catch (e) { /* id present in _order but not resolvable */ }
      let vis = '?';
      try { vis = window.map.getLayoutProperty(id, 'visibility') || 'visible'; } catch (e) {}
      return { i, id, type: l ? l.type : 'UNRESOLVED', src: (l && (l.sourceLayer || l['source-layer'])) || null, vis };
    });
    const idx = (pred) => rows.filter(pred).map((r) => r.i);
    // ⚠️ MIRRORS LANDUSE_CLASS (waterTempAnchor.js) / landuseKeywords (OceanMask.js). The probe
    // previously carried a THREE-term regex against their twelve, so it silently misclassified
    // wood/forest/glacier/sand/pitch/grass/cemetery/hospital/school/university. Executably pinned in
    // waterTempAnchor.property.test.js — the three lists move together.
    const LANDUSE = /landuse|park|wood|forest|glacier|sand|pitch|grass|cemetery|hospital|school|university/i;
    return {
      n: rows.length,
      rows,
      waterFills: idx((r) => r.type === 'fill' && (r.src === 'water' || /(^|[-_])water([-_]|$)/i.test(r.id))),
      maskFamily: idx((r) => r.id.startsWith('ocean-mask-')),
      marine: idx((r) => /marine|wave|swell|wind/i.test(r.id) && !r.id.startsWith('ocean-mask-')),
      custom: idx((r) => r.type === 'custom'),
      waterway: idx((r) => /waterway|river|stream|canal/i.test(r.id + (r.src || ''))),
      building: idx((r) => /building/i.test(r.id + (r.src || ''))),
      roads: idx((r) => /road|street|highway|motorway|transportation/i.test(r.id + (r.src || ''))),
      landuse: idx((r) => LANDUSE.test(r.id + (r.src || ''))),
    };
  });
  const shot = path.join(__dirname, '..', '..', 'program', 'weather-simulation', 'evidence',
    'shaderlab-2026-08-15', 'layer-order-z12.5-cocoa.png');
  await page.screenshot({ path: shot });
  console.log('screenshot:', shot);
  console.log('layers:', dump.n, '(from map.style._order — custom layers INCLUDED)');
  const g = (name) => `${name}: [${dump[name].join(',')}]`;
  console.log(g('waterFills'), g('maskFamily'), g('marine'), g('custom'), g('waterway'), g('building'), g('roads'), g('landuse'));
  // NON-VACUITY. The whole point of reading _order is that custom layers appear. If none does, the
  // probe is blind again and its ordering claims are worthless — say so instead of printing a
  // clean-looking stack that silently omits the field.
  if (dump.custom.length === 0) {
    console.error('::error:: NO CUSTOM LAYER FOUND — the marine field is missing from the enumeration.');
    console.error('  Either the engine never mounted, or this is reading getStyle().layers again.');
    console.error('  Any ordering conclusion drawn from this run is INVALID. See ledger C4-MR-07.');
    process.exitCode = 2;
  }
  const lo = Math.max(0, Math.min(...dump.maskFamily, ...dump.waterFills) - 2);
  const hi = Math.min(dump.n - 1, Math.max(...dump.maskFamily, ...dump.waterFills) + 6);
  for (let i = lo; i <= hi; i++) {
    const r = dump.rows[i];
    console.log(`  ${String(i).padStart(3)} ${r.type.padEnd(7)} ${r.vis === 'none' ? 'HIDDEN ' : '       '} ${r.id}${r.src ? '  (' + r.src + ')' : ''}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
