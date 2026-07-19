/**
 * probe_wind_themes.js — tri-theme WIND legibility forensic (2026-07-18 EVE-3).
 * Boots /map per theme, enables Wind, parks at a SYNOPTIC view (the low-pressure-spotting scale),
 * and measures the particle layer's separation from its own heatmap — A/B against the two kill
 * switches. Screenshots per theme/leg are the visual proof.
 *
 * Usage: node probe_wind_themes.js [baseUrl] [outdir]
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// Minimal PNG reader (8-bit, non-interlaced, colour type 2/6 — what Playwright emits).
// Needed because gl.readPixels returns nothing after compositing, and the page's CSP blocks
// loading the screenshot back as a data: URL. Node's zlib makes this the reliable path.
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

// Central ocean crop -> mean luminance, SD, and mean |Laplacian|. LOCAL contrast is the signal:
// particles are small marks on a smooth field, so global SD is dominated by the field's own
// gradient while the Laplacian responds to the marks themselves.
function cropStats(png, CW, CH) {
  const { w, h, ch, data } = png;
  const x0 = Math.max(0, (w >> 1) - (CW >> 1)), y0 = Math.max(0, (h >> 1) - (CH >> 1));
  const W = Math.min(CW, w - x0), H = Math.min(CH, h - y0);
  const lum = new Float64Array(W * H);
  let sum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = ((y0 + y) * w + (x0 + x)) * ch;
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lum[y * W + x] = L; sum += L;
    }
  }
  const mean = sum / lum.length;
  let v = 0;
  for (let p = 0; p < lum.length; p++) { const d = lum[p] - mean; v += d * d; }
  let edge = 0, n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      edge += Math.abs(4 * lum[p] - lum[p - 1] - lum[p + 1] - lum[p - W] - lum[p + W]);
      n++;
    }
  }
  return { mean: +mean.toFixed(2), sd: +Math.sqrt(v / lum.length).toFixed(2), localContrast: +(edge / n).toFixed(3) };
}
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3011';
const OUT = process.argv[3] || path.join(__dirname, 'wind-themes-out');
fs.mkdirSync(OUT, { recursive: true });

// Synoptic view over the N Atlantic — mid-latitude lows form here, with broad light-wind fields.
const CENTER = { lng: -40, lat: 42, zoom: 4.2 };
const DEVICES=[{name:'desktop',width:1280,height:800,dpr:1},{name:'mobile',width:390,height:844,dpr:3}];

async function leg(browser, theme, flags, tag, device) {
  const D = device || { name: 'desktop', width: 1280, height: 800, dpr: 1 };
  const ctx = await browser.newContext({ viewport: { width: D.width, height: D.height }, deviceScaleFactor: D.dpr });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try {
    localStorage.setItem('raw-surf-theme', t);
    // Suppress the localhost-only dev chrome: on a 390px viewport the Marine Anim Tuner covers
    // the WHOLE screen, so a centre crop measures the PANEL, not the map — that is exactly how
    // the first mobile run produced an identical 10.318 in both legs (a 0.0% 'result').
    localStorage.setItem('__RAW_TUNER__', '0');
  } catch (e) {} }, theme);
  if (flags.length) {
    await page.addInitScript((fl) => { for (const f of fl) window[f] = true; }, flags);
  }
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 180000 });
  await page.waitForTimeout(3000);

  // dismiss any consent/decline overlay
  await page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
    if (d) d.click();
  }).catch(() => {});

  // WAIT for the controls to actually render before hunting the button. (First version searched
  // after a fixed 3 s; leg 1 passed warm and every later leg reported NOT FOUND — a race, not a
  // selector bug.) Expand the panel if collapsed, then poll until the Wind chip exists.
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    if (all.some((x) => label(x) === 'Wind')) return true;
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))
      && !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
    return false;
  }, null, { timeout: 90000 }).catch(() => {});

  // Enable the Wind layer via its real control (expand the panel first if collapsed).
  const toggled = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    let b = all.find((x) => label(x) === 'Wind');
    if (!b) {
      const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))
        && !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
      if (exp) exp.click();
    }
    const all2 = Array.from(document.querySelectorAll('button'));
    b = all2.find((x) => label(x) === 'Wind');
    if (b) { b.click(); return 'clicked'; }
    return 'NOT FOUND';
  });

  await page.waitForTimeout(2000);
  await page.evaluate((c) => {
    const m = window.__RAW_MAP__ || window.map;
    if (m && m.jumpTo) m.jumpTo({ center: [c.lng, c.lat], zoom: c.zoom });
  }, CENTER);
  await page.waitForTimeout(9000);   // let the field load + particles populate

  const state = await page.evaluate(() => ({
    theme: (() => { try { return localStorage.getItem('raw-surf-theme'); } catch (e) { return null; } })(),
    windEngine: !!window.__RAW_WIND__ || !!window.__WIND_ENGINE__,
    themeRim: window.__RAW_DISABLE_THEMED_PARTICLE_RIM__ === true ? 'OFF' : 'ON',
    lowWind: window.__RAW_DISABLE_LOWWIND_LEGIBILITY__ === true ? 'OFF' : 'ON',
    zoom: (() => { const m = window.__RAW_MAP__ || window.map; return m && m.getZoom ? +m.getZoom().toFixed(2) : null; })(),
  }));

  const file = path.join(OUT, `${tag}.png`);
  await page.screenshot({ path: file });
  // Pixel stats must come from the COMPOSITED frame. gl.readPixels on the live canvas returns
  // nothing once the frame is composited (no preserveDrawingBuffer) — the first version reported
  // pixels=null for every leg because of it. Round-trip the screenshot back through a 2D canvas,
  // which reads back fine.
  const _png = decodePNG(fs.readFileSync(file));
  const stats = cropStats(_png, Math.floor(_png.w*0.42), Math.floor(_png.h*0.42));
  stats.device = D.name; stats.dpr = D.dpr; stats.png = _png.w+"x"+_png.h;

  console.log(`[${tag}] toggle=${toggled} ${JSON.stringify(state)} pixels=${JSON.stringify(stats)}`);
  await ctx.close();
  return { tag, theme, state, stats };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const results = [];
  for (const D of DEVICES) {
    for (const theme of ['dark', 'light', 'beach']) {
      results.push(await leg(browser, theme, [], D.name + '_' + theme + '_FIXED', D));
      results.push(await leg(browser, theme,
        ['__RAW_DISABLE_THEMED_PARTICLE_RIM__', '__RAW_DISABLE_LOWWIND_LEGIBILITY__'],
        D.name + '_' + theme + '_BEFORE', D));
    }
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
  console.log('\n=== A/B — localContrast (mean |Laplacian|) = how much the MARKS stand out ===');
  for (const D of DEVICES) {
    for (const t of ['dark', 'light', 'beach']) {
      const f = results.find((r) => r.tag === D.name + '_' + t + '_FIXED');
      const b = results.find((r) => r.tag === D.name + '_' + t + '_BEFORE');
      const fc = f && f.stats && f.stats.localContrast;
      const bc = b && b.stats && b.stats.localContrast;
      const eng = (f && f.state.windEngine) && (b && b.state.windEngine) ? '' : '  [!] wind not engaged';
      const delta = (fc && bc) ? (((fc / bc - 1) * 100).toFixed(1) + '%') : 'n/a';
      console.log(`${D.name.padEnd(8)}${t.padEnd(6)} before=${bc}  fixed=${fc}  delta=${delta}${eng}`);
    }
  }
  await browser.close();
})();
