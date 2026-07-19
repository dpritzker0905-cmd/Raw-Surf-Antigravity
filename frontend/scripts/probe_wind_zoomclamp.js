/**
 * probe_wind_zoomclamp.js — the zoom-transition CLAMP/CLEAR gate (2026-07-19).
 * User: "clamping and clearing of the wind heatmaps and animations ... when zooming in and out."
 *
 * PIXEL-BASED, because the committed-grid STATE can look correct while the SCREEN shows a hole.
 * Per theme x device: walk a zoom ladder IN and OUT at a fixed ocean centre, once with wind OFF
 * (baseline) and once with wind ON. Wind coverage at each step = fraction of crop pixels that
 * differ from the baseline beyond a noise threshold. A CLAMP shows up as quadrant asymmetry
 * (one side of the viewport with wind, the other bare); a CLEAR shows up as a step whose
 * coverage collapses versus its neighbours.
 *
 * Usage: node probe_wind_zoomclamp.js [baseUrl] [outdir] [themes] [devices]
 *   env ZC_LADDER  csv zoom ladder     (default 4.2,5.5,6.2,6.8,7.5,9,11,9,6.8,5.5,4.2,3)
 *   env ZC_CENTER  lng,lat             (default -89,24 — Gulf of Mexico)
 *   env ZC_REUSE_BASELINE=1            reuse an existing baseline dir (runs 2/3)
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

// Central crop (avoids sidebar/header/UI chrome), split into quadrants.
function coverage(basePng, onPng) {
  const { w, h, ch } = basePng;
  const x0 = Math.floor(w * 0.18), x1 = Math.floor(w * 0.82);
  const y0 = Math.floor(h * 0.18), y1 = Math.floor(h * 0.78);
  const midX = (x0 + x1) >> 1, midY = (y0 + y1) >> 1;
  const q = [{ n: 0, d: 0 }, { n: 0, d: 0 }, { n: 0, d: 0 }, { n: 0, d: 0 }];
  // SUM of channel deltas, not per-channel: the dark theme's calm field wash measures a uniform
  // ~(-8,-9,-10) — a per-channel >10 test sat exactly on that knife-edge and read threshold
  // wobble as quadrant asymmetry (a phantom CLAMP verdict on a uniformly-covered screen).
  // Sum separates cleanly: wash ~27-31, AA/tile noise ~6-9.
  const TH_SUM = 20;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * ch;
      const dr = Math.abs(basePng.data[i] - onPng.data[i]);
      const dg = Math.abs(basePng.data[i + 1] - onPng.data[i + 1]);
      const db = Math.abs(basePng.data[i + 2] - onPng.data[i + 2]);
      const changed = (dr + dg + db > TH_SUM) ? 1 : 0;
      const qi = (x < midX ? 0 : 1) + (y < midY ? 0 : 2);
      q[qi].n += changed; q[qi].d++;
    }
  }
  const quads = q.map((s) => +(s.n / Math.max(1, s.d)).toFixed(3));
  const total = +(q.reduce((a, s) => a + s.n, 0) / q.reduce((a, s) => a + s.d, 0)).toFixed(3);
  return { total, quads, minQuad: Math.min(...quads), maxQuad: Math.max(...quads) };
}

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3011';
const OUT = process.argv[3] || path.join(__dirname, 'wind-zoomclamp-out');
const THEMES = (process.argv[4] || 'dark,light,beach').split(',');
const DEVICES = (process.argv[5] || 'desktop,mobile').split(',');
const LADDER = (process.env.ZC_LADDER || '4.2,5.5,6.2,6.8,7.5,9,11,9,6.8,5.5,4.2,3').split(',').map(Number);
const [CLNG, CLAT] = (process.env.ZC_CENTER || '-89,24').split(',').map(Number);
const REUSE = process.env.ZC_REUSE_BASELINE === '1';
fs.mkdirSync(OUT, { recursive: true });

const DEV = { desktop: { width: 1280, height: 800, dpr: 1 }, mobile: { width: 390, height: 844, dpr: 3 } };

async function bootPage(browser, theme, device) {
  const D = DEV[device];
  const ctx = await browser.newContext({ viewport: { width: D.width, height: D.height }, deviceScaleFactor: D.dpr });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try {
    localStorage.setItem('raw-surf-theme', t);
    localStorage.setItem('__RAW_TUNER__', '0');
    localStorage.setItem('__RAW_DIAG__', '0');
  } catch (e) {} }, theme);
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!(window.__RAW_MAP__ || window.map), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
      if (d) d.click();
    }).catch(() => {});
    await page.waitForTimeout(700);
  }
  return { ctx, page };
}

async function setWind(page, on) {
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    if (all.some((x) => label(x) === 'Wind')) return true;
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))
      && !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
    return false;
  }, null, { timeout: 90000 }).catch(() => {});
  await page.evaluate((want) => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    const b = all.find((x) => label(x) === 'Wind');
    if (!b) return 'NOT FOUND';
    const pressed = b.getAttribute('aria-pressed') === 'true';
    if (pressed !== want) b.click();
    return 'ok';
  }, on);
  await page.waitForTimeout(1500);
}

async function ladder(page, tag, dirName, settleMs) {
  const shots = [];
  for (let i = 0; i < LADDER.length; i++) {
    const z = LADDER[i];
    await page.evaluate((a) => {
      const m = window.__RAW_MAP__ || window.map;
      if (m && m.jumpTo) m.jumpTo({ center: [a.lng, a.lat], zoom: a.z });
    }, { lng: CLNG, lat: CLAT, z });
    await page.waitForTimeout(settleMs);
    const file = path.join(dirName, `${tag}_step${String(i).padStart(2, '0')}_z${z}.png`);
    await page.screenshot({ path: file });
    const state = await page.evaluate(() => {
      const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
      const g = e && e._windData && e._windData.windGrid;
      return g ? { cols: g.cols, rows: g.rows, w: g.bounds && g.bounds.west, e: g.bounds && g.bounds.east,
        s: g.bounds && g.bounds.south, n: g.bounds && g.bounds.north } : null;
    });
    shots.push({ i, z, file, state });
  }
  return shots;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const results = [];
  for (const device of DEVICES) {
    for (const theme of THEMES) {
      const key = `${device}_${theme}`;
      const baseDir = path.join(OUT, 'baseline_' + key);
      fs.mkdirSync(baseDir, { recursive: true });
      let baseShots;
      if (REUSE && fs.existsSync(path.join(baseDir, 'manifest.json'))) {
        baseShots = JSON.parse(fs.readFileSync(path.join(baseDir, 'manifest.json'), 'utf8'));
        console.log(`[${key}] baseline reused`);
      } else {
        const b = await bootPage(browser, theme, device);
        await setWind(b.page, false);
        baseShots = await ladder(b.page, 'off', baseDir, 3500);
        fs.writeFileSync(path.join(baseDir, 'manifest.json'), JSON.stringify(baseShots));
        await b.ctx.close();
        console.log(`[${key}] baseline captured`);
      }
      const runDir = path.join(OUT, 'run_' + key);
      fs.mkdirSync(runDir, { recursive: true });
      const s = await bootPage(browser, theme, device);
      await setWind(s.page, true);
      await s.page.waitForTimeout(6000);
      const onShots = await ladder(s.page, 'on', runDir, 7000);
      await s.ctx.close();

      for (let i = 0; i < LADDER.length; i++) {
        const basePng = decodePNG(fs.readFileSync(baseShots[i].file));
        const onPng = decodePNG(fs.readFileSync(onShots[i].file));
        const cov = coverage(basePng, onPng);
        const st = onShots[i].state;
        const gridStr = st ? `${st.cols}x${st.rows} [${st.w},${st.s}..${st.e},${st.n}]` : 'none';
        results.push({ key, step: i, z: LADDER[i], ...cov, grid: gridStr });
        console.log(`[${key}] step${i} z${LADDER[i]}: total ${cov.total} quads ${JSON.stringify(cov.quads)} grid ${gridStr}`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 1));

  console.log('\n=== CLAMP/CLEAR VERDICT ===');
  let fails = 0;
  for (const r of results) {
    // CLEAR: wind visibly present means total >= 0.10 after settle (the heatmap tints most ocean).
    // CLAMP: quadrant asymmetry — the weakest quadrant under half the strongest, with wind clearly
    // present overall, means one side of the screen is bare.
    const clear = r.total < 0.10;
    const clamp = !clear && r.maxQuad > 0.2 && r.minQuad < r.maxQuad * 0.45;
    if (clear || clamp) {
      fails++;
      console.log(`FAIL [${r.key}] step${r.step} z${r.z}: ${clear ? 'CLEAR (total ' + r.total + ')' : 'CLAMP (quads ' + JSON.stringify(r.quads) + ')'} grid ${r.grid}`);
    }
  }
  console.log(fails === 0 ? 'ALL STEPS PASS — no clamping, no clearing across the ladder.' : `${fails} failing step(s).`);
  await browser.close();
  process.exit(0);
})();
