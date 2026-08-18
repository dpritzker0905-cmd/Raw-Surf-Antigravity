/**
 * AUDIT 13.1 — SERVED-RESOLUTION PROBE
 *
 * The legend self-discloses the grid actually used ("~223 km grid (2°)") and a degraded
 * mode ("Simplified wave layer — reduced graphics mode"). That disclosure is the cheapest
 * honest measurement of whether the resolution arc (a78428bc / 22ee14c2 / fb50fa6d — the
 * 0.083° island lane) reaches the served layer.
 *
 * Probe: for each camera x zoom, read the disclosed grid + degraded flag + the marine
 * request URLs actually issued, on whichever build is passed in. HUD forced OFF per the
 * repo's own probe contract (__RAW_DIAG__='0').
 *
 * node resprobe.js <baseUrl> <tag>
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2];
const TAG = process.argv[3] || 'x';
const OUT = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-13.1/evidence/scientific-validation';
fs.mkdirSync(OUT, { recursive: true });

const user = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer', username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const L = []; const say = (s) => { console.log(s); L.push(s); fs.writeFileSync(path.join(OUT, `${TAG}-resolution-log.txt`), L.join('\n')); };

// island + mainland cameras, swept through zoom
const CAMS = [
  { n: 'cocoa-FL', lng: -80.607, lat: 28.361 },
  { n: 'madeira-IS', lng: -16.92, lat: 32.75 },
  { n: 'portugal-EU', lng: -9.42, lat: 38.71 },
  { n: 'canary-IS', lng: -15.6, lat: 28.1 },
  { n: 'hawaii-IS', lng: -158.1, lat: 21.6 },
];
const ZOOMS = [5, 7, 8, 9, 10, 12];

const READ = () => {
  const body = document.body.innerText || '';
  const grid = (body.match(/~?\s*([\d.]+)\s*km grid\s*\(([^)]+)\)/) || []);
  const simplified = /Simplified wave layer|reduced graphics mode/i.test(body);
  const legend = (body.match(/(Combined Waves \([^)]+\)|Primary Swell \([^)]+\)|Wind Speed \(kts\)|Water Temp \([^)]+\))/) || [])[1] || null;
  const m = window.__M__;
  return { gridKm: grid[1] ? +grid[1] : null, gridDeg: grid[2] || null, simplified, legend,
    zoom: m ? +m.getZoom().toFixed(2) : null,
    marineLayerIds: (() => { try { return m.getStyle().layers.filter(l => /marine|heatmap|wave|swell/i.test(l.id)).map(l => l.id); } catch (e) { return []; } })(),
    layerCount: (() => { try { return m.getStyle().layers.length; } catch (e) { return null; } })() };
};

(async () => {
  say(`=== SERVED-RESOLUTION PROBE — ${TAG} — ${BASE} — ${new Date().toISOString()} ===`);
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', r => { const u = r.url();
    if (/grid_series|\/weather\/grid|\.om($|\?)|data_spatial/.test(u)) reqs.push({ t: Date.now(), u, m: r.method(), hdr: (r.headers()['range'] || null) }); });
  const resp = [];
  page.on('response', r => { const u = r.url();
    if (/grid_series|\/weather\/grid|\.om($|\?)|data_spatial/.test(u)) resp.push({ t: Date.now(), s: r.status(), u }); });
  const failed = [];
  page.on('requestfailed', r => { const u = r.url();
    if (/grid_series|\/weather\/grid|\.om($|\?)|data_spatial/.test(u)) failed.push({ t: Date.now(), u, e: (r.failure() || {}).errorText }); });

  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'dark');
    localStorage.setItem('__RAW_DIAG__', '0');   // repo probe contract: HUD off, it biases pixels
  }, { u: user });
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(16000);
  await page.evaluate(() => { for (const k of Object.keys(window)) { try { const v = window[k];
    if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function' && typeof v.jumpTo === 'function') { window.__M__ = v; return; } } catch (e) { } } });
  const click = async (l) => page.evaluate((x) => { const b = [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === x); if (!b) return false; b.click(); return true; }, l);

  // ensure Waves is ON (buttons are toggles with no aria-pressed, so verify via the legend)
  for (let i = 0; i < 3; i++) {
    const r = await page.evaluate(READ);
    if (r.legend && /Combined Waves/.test(r.legend)) break;
    await click('Waves'); await sleep(7000);
  }
  say('waves state: ' + JSON.stringify(await page.evaluate(READ)));

  const rows = [];
  for (const c of CAMS) for (const z of ZOOMS) {
    await page.evaluate(({ lng, lat, z }) => { if (window.__M__) window.__M__.jumpTo({ center: [lng, lat], zoom: z }); }, { lng: c.lng, lat: c.lat, z });
    const n0 = reqs.length, r0 = resp.length, f0 = failed.length;
    await sleep(9000);
    const r = await page.evaluate(READ);
    const newReqs = reqs.slice(n0), newResp = resp.slice(r0), newFail = failed.slice(f0);
    const omReqs = newReqs.filter(x => /\.om/.test(x.u)).map(x => (x.u.match(/data_spatial\/([^/]+)\//) || [])[1]).filter(Boolean);
    const gridReqs = newReqs.filter(x => /grid_series|\/weather\/grid/.test(x.u));
    const gsRes = (gridReqs.length ? (newResp.filter(x => /grid_series|\/weather\/grid/.test(x.u)).map(x => x.s)) : []);
    const row = { build: TAG, cam: c.n, requestedZoom: z, actualZoom: r.zoom,
      disclosedGridKm: r.gridKm, disclosedGridDeg: r.gridDeg, simplifiedMode: r.simplified,
      legend: r.legend, layerCount: r.layerCount, marineLayers: r.marineLayerIds.length,
      omProducts: [...new Set(omReqs)], omReqCount: omReqs.length,
      gridReqCount: gridReqs.length, gridStatuses: gsRes,
      failedInWindow: newFail.length, failedSample: newFail.slice(0, 3).map(x => (x.u.match(/data_spatial\/([^/]+)\//) || [])[1] || x.u.split('?')[0].slice(-50)) };
    rows.push(row);
    say(`  ${TAG} ${c.n.padEnd(12)} z${String(z).padStart(2)} -> actual ${String(r.zoom).padEnd(5)} | grid=${String(r.gridKm).padStart(6)} km (${r.gridDeg}) | simplified=${r.simplified} | om=${JSON.stringify([...new Set(omReqs)])} n=${omReqs.length} | gridReq=${gridReqs.length} st=${JSON.stringify(gsRes)} | fail=${newFail.length}`);
    fs.writeFileSync(path.join(OUT, `resolution-${TAG}.json`), JSON.stringify(rows, null, 2));
  }

  const allOm = [...new Set(reqs.filter(x => /\.om/.test(x.u)).map(x => (x.u.match(/data_spatial\/([^/]+)\//) || [])[1]).filter(Boolean))];
  const gridKmSeen = [...new Set(rows.map(r => r.disclosedGridKm))];
  say(`\nDISTINCT open-meteo products requested: ${JSON.stringify(allOm)}`);
  say(`DISTINCT disclosed grid resolutions: ${JSON.stringify(gridKmSeen)}`);
  say(`simplifiedMode TRUE in ${rows.filter(r => r.simplifiedMode).length} of ${rows.length} cells`);
  fs.writeFileSync(path.join(OUT, `resolution-${TAG}-summary.json`), JSON.stringify({ base: BASE, allOmProducts: allOm,
    distinctDisclosedGridKm: gridKmSeen, simplifiedCells: rows.filter(r => r.simplifiedMode).length, totalCells: rows.length,
    totalOmRequests: reqs.filter(x => /\.om/.test(x.u)).length,
    totalOmFailed: failed.filter(x => /\.om/.test(x.u)).length,
    totalGridSeriesRequests: reqs.filter(x => /grid_series/.test(x.u)).length,
    gridSeriesStatuses: resp.filter(x => /grid_series/.test(x.u)).reduce((a, x) => { a[x.s] = (a[x.s] || 0) + 1; return a; }, {}),
    gridSeriesFailed: failed.filter(x => /grid_series/.test(x.u)).length }, null, 2));
  await ctx.close(); await browser.close();
})().catch(e => { console.error('FATAL', e); fs.writeFileSync(path.join(OUT, `resolution-${TAG}-FATAL.txt`), String((e && e.stack) || e) + '\n' + L.join('\n')); process.exit(1); });
