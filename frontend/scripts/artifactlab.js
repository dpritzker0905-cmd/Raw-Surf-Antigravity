/**
 * artifactlab.js — rapid pan/zoom ARTIFACT HUNT with video proof (2026-07-23).
 *
 * House lineage: zoomlab.js (Playwright + trusted wheel/drag input + recordVideo). What this adds
 * is an OBJECTIVE artifact DETECTOR, so "I see a few artifacts" becomes data:
 *
 *   FLAT-BLOCK DETECTOR — the marine/wind failure signature all session has been a region of
 *   CONSTANT colour (the all-land mask flood read as one flat RGB across the whole viewport; the
 *   "gray box" and "rectangle holes" are the same class). Every sampled frame is scanned for
 *   axis-aligned runs of identical RGB, and any block bigger than MIN_BLOCK is reported WITH ITS
 *   GEOGRAPHIC BOUNDS via map.unproject — measured, not eyeballed.
 *
 *   DEAD-BAND DETECTOR — per-column frame-to-frame |delta| profile (zoomlab's anim columns). A
 *   column with ~zero change while its neighbours animate is a "line with no animations".
 *
 * Usage:  node artifactlab.js <outdir>
 * Env: AL_BASE (default http://localhost:3007), AL_MODEL (EURO), AL_LAYER (Waves|Wind),
 *      AL_RATING (1 = surf rating ON), AL_FLAGS (comma-separated pre-boot window globals)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AL_BASE || 'http://localhost:3007';
const MODEL = (process.env.AL_MODEL || 'EURO').trim().toUpperCase();
const LAYER = (process.env.AL_LAYER || 'Waves').trim();
const RATING = process.env.AL_RATING === '1';
const outdir = process.argv[2] || path.join(__dirname, 'artifactlab-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => { const s = `[artifactlab] ${m}`; console.log(s); fs.appendFileSync(path.join(outdir, 'log.txt'), s + '\n'); };

// The tour: regions where artifacts were reported or are structurally likely.
const STOPS = [
  { name: 'na-wide',        center: [-90, 30],    zoom: 3.4 },   // the screenshot camera
  { name: 'hudson-bay',     center: [-85, 57],    zoom: 4.2 },   // flat cyan rectangle #1
  { name: 'colombia',       center: [-74, 5],     zoom: 4.6 },   // flat cyan rectangle #2
  { name: 'gulf',           center: [-90, 26],    zoom: 6.0 },
  { name: 'florida-coast',  center: [-80.2, 28.4],zoom: 8.5 },
  { name: 'antimeridian',   center: [180, 12],    zoom: 4.6 },   // today's fix zone
  { name: 'antimeridian-z7',center: [-176, 12],   zoom: 7.5 },   // the z>6 tile regime
  { name: 'hawaii',         center: [-157.9, 21], zoom: 6.5 },
];

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: outdir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  if (process.env.AL_FLAGS) {
    const flags = process.env.AL_FLAGS.split(',').map((s) => s.trim()).filter(Boolean);
    await page.addInitScript((fl) => { for (const f of fl) window[f] = true; }, flags);
    log('AL_FLAGS: ' + flags.join(', '));
  }
  // Theme matters (three-theme mandate) — and the reported artifacts were seen in DARK.
  const THEME = (process.env.AL_THEME || 'dark').trim();
  await page.addInitScript((t) => { try { localStorage.setItem('raw-surf-theme', t); } catch (e) {} }, THEME);
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });

  log('goto ' + BASE + '/map');
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Decline');
    if (d) d.click();
  });

  const clickByLabel = (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === l);
    if (b && b.getAttribute('aria-pressed') !== 'true') { b.click(); return 'clicked'; }
    return b ? 'already-on' : 'NOT FOUND';
  }, label);

  log('layer ' + LAYER + ': ' + await clickByLabel(LAYER));
  await page.waitForFunction(() => { const e = window.__MARINE_ENGINE__; return e && e._waveData; }, null, { timeout: 90000 })
    .catch(() => log('resident wait timed out (continuing)'));
  await page.evaluate((m) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === m);
    if (b) b.click();
  }, MODEL);
  log('model ' + MODEL);
  if (RATING) {
    const r = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        ((x.getAttribute('aria-label') || '') + (x.title || '') + (x.textContent || '')).includes('Surf Rating'));
      if (b && b.getAttribute('aria-pressed') !== 'true') { b.click(); return 'clicked'; }
      return b ? 'already-on' : 'NOT FOUND';
    });
    log('rating: ' + r);
  }
  await page.waitForTimeout(6000);

  // ---- in-page detectors ---------------------------------------------------------------------
  await page.evaluate(() => {
    const src = window.map.getCanvas();
    const W = 128, H = Math.round(128 * src.height / src.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let prev = null;
    window.__AL = { frames: [], W, H };

    // Grab must happen INSIDE a render callback: outside it the WebGL drawing buffer is already
    // cleared (preserveDrawingBuffer:false) and every read comes back blank.
    window.__alScan = () => new Promise((res) => {
      let n = 0;
      const h = () => {
        n++; if (n < 2) return;
        window.map.off('render', h);
        ctx.drawImage(src, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const key = (i) => d[i * 4] + ',' + d[i * 4 + 1] + ',' + d[i * 4 + 2];

        // FLAT-BLOCK DETECTOR: grow axis-aligned rectangles of identical RGB.
        // CHROMA GATE (added after run 1): the BASEMAP's own land fill is flat and near-grey
        // (rgb 251,252,248 over the Great Plains — chroma 4), so an ungated detector reports the
        // map itself. Every real artifact this session has been SATURATED: the all-land mask flood
        // read 93,117,126 (chroma 33) and the user's reported rectangles are vivid cyan. So flag a
        // flat block only when it is chromatic, or when it is large enough that a flat grey slab
        // is itself the bug.
        const chromaOf = (i) => {
          const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
          return Math.max(r, g, b) - Math.min(r, g, b);
        };
        const MIN_CHROMA = 20, BIG_AREA_PCT = 5;
        const seen = new Uint8Array(W * H);
        const blocks = [];
        const MIN_W = 8, MIN_H = 6;                       // in 128-wide sample units
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (seen[i]) continue;
            const k = key(i);
            let w = 0; while (x + w < W && !seen[y * W + x + w] && key(y * W + x + w) === k) w++;
            if (w < MIN_W) continue;
            let hgt = 1;
            grow: while (y + hgt < H) {
              for (let xx = 0; xx < w; xx++) if (key((y + hgt) * W + x + xx) !== k) break grow;
              hgt++;
            }
            if (hgt < MIN_H) continue;
            for (let yy = 0; yy < hgt; yy++) for (let xx = 0; xx < w; xx++) seen[(y + yy) * W + x + xx] = 1;
            const areaPct = +(w * hgt / (W * H) * 100).toFixed(2);
            const ch = chromaOf(i);
            if (ch < MIN_CHROMA && areaPct < BIG_AREA_PCT) continue;   // basemap land fill — not an artifact
            blocks.push({ x, y, w, h: hgt, rgb: k, chroma: ch, areaPct });
          }
        }

        // DEAD-BAND DETECTOR: per-column mean |delta| vs the previous scanned frame.
        const NC = 64; const cols = new Array(NC).fill(0); const cn = new Array(NC).fill(0);
        if (prev) {
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const dd = Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
            const c = Math.min(NC - 1, Math.floor(x / W * NC)); cols[c] += dd; cn[c]++;
          }
          for (let c = 0; c < NC; c++) cols[c] = +(cols[c] / Math.max(1, cn[c])).toFixed(1);
        }
        prev = d.slice(0);

        // distinct-colour count: 1 == the whole viewport is one flat fill
        const set = new Set(); for (let i = 0; i < W * H; i++) set.add(key(i));

        const sx = src.clientWidth / W, sy = src.clientHeight / H;
        const geo = (bx, by) => { const ll = window.map.unproject([bx * sx, by * sy]); return [+ll.lng.toFixed(2), +ll.lat.toFixed(2)]; };
        res({
          distinct: set.size,
          animCols: cols,
          blocks: blocks.map((b) => ({ ...b, nw: geo(b.x, b.y), se: geo(b.x + b.w, b.y + b.h) })),
        });
      };
      window.map.on('render', h); window.map.triggerRepaint();
    });
  });

  const findings = [];
  const snap = async (tag) => {
    let s = await page.evaluate(() => window.__alScan());
    // MASK GATE (added after runs 1-2): chroma alone cannot separate "flat BASEMAP over land"
    // (dark theme land is rgb 54,68,74 — chroma 20) from "flat FIELD over water" (the actual
    // artifact). Over land the marine layer is SUPPOSED to be absent, so flatness there is
    // correct. Ask the engine's own ocean mask what is under each candidate block and keep only
    // the ones over WATER. probeMaskGPU returns .effective as 0-255 red, >=128 = water.
    if (s.blocks.length) {
      s.blocks = await page.evaluate((blocks) => {
        const e = window.__MARINE_ENGINE__;
        if (!e || typeof e.probeMaskGPU !== 'function') return blocks;
        const pts = blocks.map((b) => ({ lng: (b.nw[0] + b.se[0]) / 2, lat: (b.nw[1] + b.se[1]) / 2 }));
        let m = null;
        try { m = e.probeMaskGPU(pts); } catch (err) { return blocks; }
        if (!m) return blocks;
        return blocks
          .map((b, i) => ({ ...b, mask: m[i] && m[i].effective, maskSrc: m[i] && m[i].src }))
          .filter((b) => b.mask == null || b.mask >= 128);   // keep WATER (and unknown) only
      }, s.blocks);
    }
    const st = await page.evaluate(() => {
      const e = window.__MARINE_ENGINE__, wd = e && e._waveData, g = window.__RAW_GPU__ || {};
      return { z: +window.map.getZoom().toFixed(2), c: window.map.getCenter(),
        cols: wd && wd.waveGrid && wd.waveGrid.cols, bounds: wd && wd.bounds,
        overlay: g.overlayMask, neOpen: g.openWaterVerdict && g.openWaterVerdict.neOpen,
        inland: g.inlandWaterGuard, wash: g.washFloor };
    });
    // dead bands: columns with ~no change while the frame overall animates
    const ac = s.animCols.filter((v) => typeof v === 'number');
    const mean = ac.length ? ac.reduce((a, b) => a + b, 0) / ac.length : 0;
    const dead = mean > 3 ? s.animCols.map((v, i) => ({ i, v })).filter((o) => o.v < mean * 0.15) : [];
    const rec = { tag, ...st, distinct: s.distinct, blocks: s.blocks, animMean: +mean.toFixed(1), deadCols: dead };
    findings.push(rec);
    if (s.blocks.length || dead.length || s.distinct < 40) {
      await page.screenshot({ path: path.join(outdir, `ARTIFACT_${tag}.png`) });
      log(`!! ${tag}: ${s.blocks.length} flat block(s), ${dead.length} dead column(s), distinct=${s.distinct}`);
      for (const b of s.blocks) log(`     block rgb(${b.rgb}) chroma${b.chroma} ${b.areaPct}% mask=${b.mask}(${b.maskSrc}) NW=${b.nw} SE=${b.se}`);
    } else {
      await page.screenshot({ path: path.join(outdir, `ok_${tag}.png`) });
      log(`   ${tag}: clean (distinct=${s.distinct}, anim=${mean.toFixed(1)})`);
    }
    return rec;
  };

  // ---- the rapid tour ------------------------------------------------------------------------
  const box = await page.evaluate(() => {
    const r = window.map.getCanvasContainer().getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  for (const stop of STOPS) {
    log(`--- ${stop.name} z${stop.zoom} ---`);
    await page.evaluate(([c, z]) => window.map.jumpTo({ center: c, zoom: z }), [stop.center, stop.zoom]);
    await page.waitForTimeout(7000);
    await snap(stop.name + '_settled');

    // RAPID PAN: four trusted drags, no settle between (this is what the user does)
    for (const [dx, dy] of [[-260, 0], [0, -180], [260, 0], [0, 180]]) {
      await page.mouse.move(box.cx, box.cy);
      await page.mouse.down();
      for (let s = 1; s <= 6; s++) await page.mouse.move(box.cx + dx * s / 6, box.cy + dy * s / 6);
      await page.mouse.up();
      await page.waitForTimeout(450);
      await snap(`${stop.name}_pan${dx}_${dy}`);
    }

    // RAPID ZOOM BURST out then in, mid-gesture sampling
    await page.mouse.move(box.cx, box.cy);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(45); }
    await snap(stop.name + '_zoomout_midgesture');
    await page.waitForTimeout(2500);
    await snap(stop.name + '_zoomout_settled');
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(45); }
    await snap(stop.name + '_zoomin_midgesture');
    await page.waitForTimeout(2500);
    await snap(stop.name + '_zoomin_settled');
  }

  const artifacts = findings.filter((f) => (f.blocks && f.blocks.length) || (f.deadCols && f.deadCols.length) || f.distinct < 40);
  fs.writeFileSync(path.join(outdir, 'report.json'), JSON.stringify({ findings, consoleErrors }, null, 1));
  fs.writeFileSync(path.join(outdir, 'SUMMARY.txt'), [
    `stops scanned: ${findings.length}`,
    `frames WITH artifacts: ${artifacts.length}`,
    '',
    ...artifacts.map((a) => `${a.tag}  z${a.z}  distinct=${a.distinct}  blocks=${a.blocks.length}  dead=${a.deadCols.length}\n` +
      a.blocks.map((b) => `    FLAT rgb(${b.rgb}) ${b.areaPct}%  NW=${b.nw}  SE=${b.se}`).join('\n')),
    '', 'console errors:', ...consoleErrors.slice(0, 10),
  ].join('\n'));
  log(`DONE — ${artifacts.length}/${findings.length} frames flagged. See SUMMARY.txt + ARTIFACT_*.png + the .webm video.`);

  await context.close();   // flushes the video
  await browser.close();
}

main().catch((e) => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
