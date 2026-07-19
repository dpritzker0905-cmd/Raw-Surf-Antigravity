/**
 * probe_wind_finegrid_visual.js — the REGIONAL (viewport-fine) wind grid render test (2026-07-19).
 *
 * The zoomclamp ladder can only exercise the fine-grid path when the backend's dynamic upstream
 * happens to be healthy; during rate-limited windows every step degrades to the global product
 * and the REGIONAL rendering path (edge feather width, box edges — where the user-visible
 * "clamp" rectangle lives) goes untested. This probe removes the upstream entirely: it injects a
 * synthetic regional windGrid straight into the running engine via setWindData.
 *
 * Case A — the box the tier actually requests (viewport + pad, edges OFF-screen):
 *          PASS = full-viewport coverage, no quadrant asymmetry, i.e. NO visible rectangle.
 * Case B — a box deliberately SMALLER than the viewport (edges ~25% inside):
 *          documents the transitional look and MEASURES the feather band width in px
 *          (should be narrow — ~0.6 deg — not the legacy 18%-of-span smear).
 *
 * Usage: node probe_wind_finegrid_visual.js [baseUrl] [outdir]
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, ct = 6, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : 3;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

function quadCoverage(basePng, onPng) {
  const { w, h, ch } = basePng;
  const x0 = Math.floor(w * 0.18), x1 = Math.floor(w * 0.82);
  const y0 = Math.floor(h * 0.18), y1 = Math.floor(h * 0.78);
  const midX = (x0 + x1) >> 1, midY = (y0 + y1) >> 1;
  const q = [{ n: 0, d: 0 }, { n: 0, d: 0 }, { n: 0, d: 0 }, { n: 0, d: 0 }];
  const TH = 10;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * ch;
    const changed = (Math.abs(basePng.data[i] - onPng.data[i]) > TH
      || Math.abs(basePng.data[i + 1] - onPng.data[i + 1]) > TH
      || Math.abs(basePng.data[i + 2] - onPng.data[i + 2]) > TH) ? 1 : 0;
    const qi = (x < midX ? 0 : 1) + (y < midY ? 0 : 2);
    q[qi].n += changed; q[qi].d++;
  }
  const quads = q.map((s) => +(s.n / Math.max(1, s.d)).toFixed(3));
  return { total: +(q.reduce((a, s) => a + s.n, 0) / q.reduce((a, s) => a + s.d, 0)).toFixed(3), quads };
}

// Scan one screen row across a known box edge; return the feather band width in px
// (pixels between "fully changed" and "unchanged" runs).
function edgeBandWidth(basePng, onPng, yPix, xFrom, xTo) {
  const { w, ch } = basePng;
  const TH = 10;
  const changed = [];
  for (let x = xFrom; x < xTo; x++) {
    const i = (yPix * w + x) * ch;
    changed.push((Math.abs(basePng.data[i] - onPng.data[i]) > TH
      || Math.abs(basePng.data[i + 1] - onPng.data[i + 1]) > TH
      || Math.abs(basePng.data[i + 2] - onPng.data[i + 2]) > TH) ? 1 : 0);
  }
  // smooth with a 9-px box to kill particle speckle, then find the 0.8->0.2 transition span
  const sm = changed.map((_, k) => {
    let s = 0, n = 0;
    for (let j = -4; j <= 4; j++) { const kk = k + j; if (kk >= 0 && kk < changed.length) { s += changed[kk]; n++; } }
    return s / n;
  });
  let hi = -1, lo = -1;
  for (let k = 0; k < sm.length; k++) { if (sm[k] >= 0.8) hi = k; }
  for (let k = sm.length - 1; k >= 0; k--) { if (sm[k] <= 0.2) lo = k; }
  return (hi >= 0 && lo > hi) ? lo - hi : -1;
}

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3011';
const OUT = process.argv[3] || path.join(__dirname, 'wind-finegrid-out');
fs.mkdirSync(OUT, { recursive: true });
const CENTER = { lng: -89, lat: 24, zoom: 6.5 };

async function boot(browser, windOn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try {
    localStorage.setItem('raw-surf-theme', 'dark');
    localStorage.setItem('__RAW_TUNER__', '0');
    localStorage.setItem('__RAW_DIAG__', '0');
  } catch (e) {} });
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!(window.__RAW_MAP__ || window.map), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
      if (d) d.click();
    }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.evaluate((c) => {
    const m = window.__RAW_MAP__ || window.map;
    if (m && m.jumpTo) m.jumpTo({ center: [c.lng, c.lat], zoom: c.zoom });
  }, CENTER);
  if (windOn) {
    await page.waitForFunction(() => {
      const all = Array.from(document.querySelectorAll('button'));
      const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
      if (all.some((x) => label(x) === 'Wind')) return true;
      const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
      if (exp) exp.click();
      return false;
    }, null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button'));
      const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
      const b = all.find((x) => label(x) === 'Wind');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    });
    // wait for ANY wind commit so the engine + GL are warm
    await page.waitForFunction(() => {
      const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
      return !!(e && e._windData && e._windData.texture);
    }, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  return { ctx, page };
}

async function injectGrid(page, bounds) {
  return page.evaluate((b) => {
    const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
    const m = window.__RAW_MAP__ || window.map;
    const gl = m && m.painter && m.painter.context && m.painter.context.gl;
    if (!e || !gl) return 'no engine/gl';
    const cols = 40, rows = 32;
    const dlng = (b.east - b.west) / (cols - 1), dlat = (b.north - b.south) / (rows - 1);
    const vectors = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lat = b.south + r * dlat, lng = b.west + c * dlng;
        // a broad rotation so direction + speed both vary visibly across the box
        const dx = (lng - (b.west + b.east) / 2), dy = (lat - (b.south + b.north) / 2);
        const u = -dy * 3.0 + 6.0, v = dx * 3.0 + 4.0;
        const speed = Math.hypot(u, v);
        vectors.push({ lat, lng, speed, direction: 0, u, v });
      }
    }
    e.setWindData(gl, { vectors, cols, rows, bounds: b, coverage_scope: 'viewport' });
    if (typeof e.reinitParticles === 'function') e.reinitParticles(gl, { keepTrails: true });
    m.triggerRepaint();
    return 'injected ' + cols + 'x' + rows + ' ' + JSON.stringify(b);
  }, bounds);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

  // Baseline (wind OFF)
  const off = await boot(browser, false);
  const basePath = path.join(OUT, 'off.png');
  await off.page.screenshot({ path: basePath });
  await off.ctx.close();

  const on = await boot(browser, true);
  // viewport at z6.5/1280px: lng span ~9.95, lat span ~5.6 -> box A pads ~1.5 deg beyond
  const A = { west: -95.5, south: 20.5, east: -82.5, north: 27.5 };
  console.log(await injectGrid(on.page, A));
  await on.page.waitForTimeout(4500);
  const aPath = path.join(OUT, 'fine_A_padded.png');
  await on.page.screenshot({ path: aPath });

  // Case B: box edges INSIDE the viewport (east edge at ~ -86.5, well on screen)
  const B = { west: -92.5, south: 22.0, east: -86.5, north: 26.0 };
  console.log(await injectGrid(on.page, B));
  await on.page.waitForTimeout(4500);
  const bPath = path.join(OUT, 'fine_B_inside.png');
  await on.page.screenshot({ path: bPath });
  await on.ctx.close();

  const base = decodePNG(fs.readFileSync(basePath));
  const aPng = decodePNG(fs.readFileSync(aPath));
  const bPng = decodePNG(fs.readFileSync(bPath));

  const covA = quadCoverage(base, aPng);
  console.log(`CASE A (padded box, edges off-screen): total ${covA.total} quads ${JSON.stringify(covA.quads)}`);
  const aPass = covA.total >= 0.5 && Math.min(...covA.quads) >= Math.max(...covA.quads) * 0.45;
  console.log(aPass ? 'A PASS — no visible rectangle with the box the tier requests.' : 'A FAIL — the padded box still shows an edge.');

  const covB = quadCoverage(base, bPng);
  // B's east edge (-86.5 deg) in screen px: viewport centre -89 at 640px, 1280px/9.95deg
  const pxPerDeg = 1280 / 9.95;
  const edgeX = Math.round(640 + (-86.5 - (-89)) * pxPerDeg);
  const band = edgeBandWidth(base, bPng, 400, Math.max(0, edgeX - 160), Math.min(1280, edgeX + 160));
  console.log(`CASE B (box inside viewport): total ${covB.total} quads ${JSON.stringify(covB.quads)}; feather band ~${band}px at the east edge (0.6deg ~= ${(0.6 * pxPerDeg).toFixed(0)}px expected)`);
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ covA, aPass, covB, band }, null, 1));
  await browser.close();
})();
