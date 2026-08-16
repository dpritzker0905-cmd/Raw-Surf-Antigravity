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
    const layers = window.map.getStyle().layers;
    const rows = layers.map((l, i) => ({
      i, id: l.id, type: l.type, src: l['source-layer'] || null,
      vis: (l.layout && l.layout.visibility) || 'visible',
    }));
    const idx = (pred) => rows.filter(pred).map((r) => r.i);
    return {
      n: rows.length,
      rows,
      waterFills: idx((r) => r.type === 'fill' && (r.src === 'water' || /(^|[-_])water([-_]|$)/i.test(r.id))),
      maskFamily: idx((r) => r.id.startsWith('ocean-mask-')),
      marine: idx((r) => /marine|wave|swell|wind/i.test(r.id) && !r.id.startsWith('ocean-mask-')),
      waterway: idx((r) => /waterway|river|stream|canal/i.test(r.id + (r.src || ''))),
      building: idx((r) => /building/i.test(r.id + (r.src || ''))),
      roads: idx((r) => /road|street|highway|motorway|transportation/i.test(r.id + (r.src || ''))),
      landuse: idx((r) => /landuse|park|landcover/i.test(r.id + (r.src || ''))),
    };
  });
  const shot = path.join(__dirname, '..', '..', 'program', 'weather-simulation', 'evidence',
    'shaderlab-2026-08-15', 'layer-order-z12.5-cocoa.png');
  await page.screenshot({ path: shot });
  console.log('screenshot:', shot);
  console.log('layers:', dump.n);
  const g = (name) => `${name}: [${dump[name].join(',')}]`;
  console.log(g('waterFills'), g('maskFamily'), g('marine'), g('waterway'), g('building'), g('roads'), g('landuse'));
  const lo = Math.max(0, Math.min(...dump.maskFamily, ...dump.waterFills) - 2);
  const hi = Math.min(dump.n - 1, Math.max(...dump.maskFamily, ...dump.waterFills) + 6);
  for (let i = lo; i <= hi; i++) {
    const r = dump.rows[i];
    console.log(`  ${String(i).padStart(3)} ${r.type.padEnd(7)} ${r.vis === 'none' ? 'HIDDEN ' : '       '} ${r.id}${r.src ? '  (' + r.src + ')' : ''}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
