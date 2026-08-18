/**
 * AUDIT 13.1 — PAINT-TRUTH CONTROL
 * Does the marine field actually PAINT? Answered with pixels, at 5 cameras,
 * on whichever build is passed in. A protocol counter cannot answer "did it paint".
 *
 * node paintcontrol.js <baseUrl> <tag>
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2];
const TAG = process.argv[3] || 'x';
const OUT = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-13.1/evidence';
const SHOT = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOT, { recursive: true });

const user = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer', username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const L = []; const say = (s) => { console.log(s); L.push(s); };

// Cameras: name, lng, lat, zoom, and an ocean-only crop box (x,y,w,h) in the 1280x800 viewport
const CAMS = [
  { n: 'cocoa-z8', lng: -80.607, lat: 28.361, z: 8, crop: { x: 900, y: 120, width: 340, height: 300 } },
  { n: 'cocoa-z11', lng: -80.55, lat: 28.361, z: 11, crop: { x: 900, y: 120, width: 340, height: 300 } },
  { n: 'madeira-z9', lng: -16.9, lat: 32.75, z: 9, crop: { x: 470, y: 120, width: 340, height: 300 } },
  { n: 'openatlantic-z5', lng: -40.0, lat: 30.0, z: 5, crop: { x: 470, y: 200, width: 340, height: 300 } },
  { n: 'portugal-z8', lng: -9.9, lat: 38.7, z: 8, crop: { x: 400, y: 200, width: 300, height: 300 } },
];
const LAYERS = ['Wind', 'Waves', 'Swell', 'Water Temp'];

// decode PNG -> colour statistics, pure JS (zlib inflate + PNG unfilter)
const zlib = require('zlib');
function pngStats(buf) {
  let p = 8; let w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); bd = buf[p + 16]; ct = buf[p + 17]; }
    else if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) return { err: `bitdepth ${bd}` };
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (!ch) return { err: `colortype ${ct}` };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch; const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++]; const line = raw.slice(q, q + stride); q += stride;
    const o = y * stride; const pr = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0; const b = y > 0 ? out[pr + x] : 0;
      const c = (x >= ch && y > 0) ? out[pr + x - ch] : 0; const v = line[x];
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[o + x] = r & 255;
    }
  }
  const colors = new Map(); let sr = 0, sg = 0, sb = 0, n = 0;
  const sat = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * stride + x * ch; const R = out[i], G = out[i + 1] ?? R, B = out[i + 2] ?? R;
    const key = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
    colors.set(key, (colors.get(key) || 0) + 1);
    sr += R; sg += G; sb += B; n++;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat.push(mx === 0 ? 0 : (mx - mn) / mx);
  }
  const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, c]) => ({ rgb: [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3], pct: +(100 * c / n).toFixed(1) }));
  const meanSat = sat.reduce((a, b) => a + b, 0) / sat.length;
  return { w, h, px: n, distinctColors5bit: colors.size,
    mean: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    topColors: top, dominantPct: top[0] ? top[0].pct : null, meanSaturation: +meanSat.toFixed(3) };
}

(async () => {
  say(`=== PAINT CONTROL — ${TAG} — ${BASE} — ${new Date().toISOString()} ===`);
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const fails = []; const errs = []; const gridReq = [];
  page.on('requestfailed', r => fails.push(r.url().split('?')[0]));
  page.on('response', r => { const u = r.url(); if (/grid_series|\/weather\/grid/.test(u)) gridReq.push({ status: r.status(), u: u.split('?')[0] }); });
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'dark');
  }, { u: user });
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(16000);

  const ensureMap = async () => { for (let i = 0; i < 30; i++) {
    const k = await page.evaluate(() => { if (window.__M__ && typeof window.__M__.getZoom === 'function') { try { window.__M__.getZoom(); return 'cached'; } catch (e) { } }
      for (const kk of Object.keys(window)) { try { const v = window[kk];
        if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function' && typeof v.jumpTo === 'function') { window.__M__ = v; return kk; } } catch (e) { } } return null; });
    if (k) return k; await sleep(2000); } return null; };
  say('map handle: ' + await ensureMap());

  const click = async (l) => page.evaluate((x) => { const b = [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === x); if (!b) return false; b.click(); return true; }, l);
  const hud = async () => page.evaluate(() => { const body = document.body.innerText || '';
    const g = (lbl) => { const i = body.indexOf(lbl); if (i < 0) return null; const s = body.slice(i + lbl.length, i + lbl.length + 140).split('\n').filter(Boolean); return (s[0] || '').trim().slice(0, 40); };
    return { modelLayer: g('Model / Layer:'), renderMode: g('Render Mode:'), raster: g('Raster Source:'), provider: g('Provider:'), klass: g('Class:'),
      truth: (() => { const i = body.indexOf('TRUTH VIOLATIONS'); return i < 0 ? null : body.slice(i + 16, i + 190).replace(/\s+/g, ' ').trim().slice(0, 150); })() }; });

  const rows = [];
  for (const layer of LAYERS) {
    await click(layer); await sleep(2000);
    for (const c of CAMS) {
      await page.evaluate(({ lng, lat, z }) => { if (window.__M__) window.__M__.jumpTo({ center: [lng, lat], zoom: z }); }, c);
      await sleep(9000);
      const g0 = gridReq.length;
      const full = path.join(SHOT, `${TAG}-paint-${layer.replace(/\s+/g, '')}-${c.n}.png`);
      await page.screenshot({ path: full }).catch(() => { });
      const cropBuf = await page.screenshot({ clip: c.crop }).catch(() => null);
      const st = cropBuf ? pngStats(cropBuf) : { err: 'no crop' };
      const h = await hud();
      const row = { build: TAG, layer, cam: c.n, hud: h,
        distinctColors: st.distinctColors5bit, dominantPct: st.dominantPct, mean: st.mean,
        meanSaturation: st.meanSaturation, topColors: st.topColors,
        gridResponsesSinceCam: gridReq.length - g0 };
      rows.push(row);
      say(`  ${TAG} ${layer.padEnd(11)} ${c.n.padEnd(16)} colors=${String(st.distinctColors5bit).padStart(4)} dom=${String(st.dominantPct).padStart(5)}% sat=${st.meanSaturation} mean=${JSON.stringify(st.mean)} raster=${h.raster} provider=${h.provider} class=${h.klass}`);
      fs.writeFileSync(path.join(OUT, `paint-control-${TAG}.json`), JSON.stringify(rows, null, 2));
    }
  }

  const gs = gridReq.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  say(`grid_series/grid response statuses: ${JSON.stringify(gs)}`);
  say(`total failed requests: ${fails.length}; console errors: ${errs.length}`);
  fs.writeFileSync(path.join(OUT, `paint-control-${TAG}-meta.json`), JSON.stringify({ base: BASE, gridStatuses: gs, failedCount: fails.length, consoleErrorCount: errs.length,
    topFails: Object.entries(fails.reduce((a, u) => { a[u] = (a[u] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 20),
    topErrs: Object.entries(errs.reduce((a, u) => { a[u.slice(0, 110)] = (a[u.slice(0, 110)] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 20) }, null, 2));
  fs.writeFileSync(path.join(OUT, `paint-control-${TAG}-log.txt`), L.join('\n'));
  await ctx.close(); await browser.close();
})().catch(e => { console.error('FATAL', e); fs.writeFileSync(path.join(OUT, `paint-control-${TAG}-FATAL.txt`), String((e && e.stack) || e) + '\n' + L.join('\n')); process.exit(1); });
