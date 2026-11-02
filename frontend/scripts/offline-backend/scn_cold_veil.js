// THE COLD VEIL at the first Waves click (D3, 2026-11-01). Offline only. One build, arms interleaved per round, a fresh browser each.
// The first frame of a cold activation is the instant 2-deg world CDN frame; at a coastal view the veil (marineColdVeil.js) holds the
// heatmap at 0 until the detailed resident lands (or a 4 s grace). Per session: open /map, jump to VIEW, wait IDLE ms, click Waves,
// then on every animation frame read what the engine holds, the heatmap opacity it drew, the veil and the visible status words.
//   firstMs    click -> the first resident (any resolution)
//   visibleMs  click -> the first frame drawn with heatmap opacity > 0 (blankMs = visibleMs - firstMs: an empty sea after the first frame)
//   detailMs   click -> the first resident that is not the coarse-global tier (firstToDetailMs = detailMs - firstMs)
//   lift       the veil's own lift reason ('adequate' = the detail came, 'grace' = 4 s passed, 'none' = never veiled)
//   mismatch   frames whose words disagree with what is drawn: blank_unworded (opacity 0, no wash, words not "Loading"),
//              veil_words_over_detail ("Loading the detailed forecast…" while a detailed resident is drawn), preview_unlabelled
//              (the coarse field drawn inside the veil window with no "Coarse … preview" words)
//   swap       at the coarse -> detail swap: |dH| ft between the two residents (bilinear, at the 9 sample points), and dE2000 between
//              the pixels drawn the frame before the detail and 450 ms after it (the visible pop; for the blank arm that is basemap ->
//              detail). The sample points are on the water side of the view.
// Arms (window flags set before boot):
//   cur        the default build (A words ON, B regional prewarm ON, regional bundles ON)
//   noprewarm  __RAW_DISABLE_REGIONAL_PREWARM__        nowords  __RAW_DISABLE_VEIL_WORDS__ (the D3 reading)
//   noregional __RAW_DISABLE_REGIONAL_BUNDLES__ (+ no prewarm: nothing regional from the CDN)
//   preview    the default (ON since the owner's pick)  nopreview  __RAW_DISABLE_COLD_PREVIEW__   preview_show  __RAW_COLD_PREVIEW_COAST__ = 'show'
//   preview_nr / preview_show_nr / cur_nr              the same with __RAW_DISABLE_REGIONAL_BUNDLES__ (the detail on /grid)
//
//   python frontend/scripts/offline-backend/serve_synthetic_selector.py --dir <store> --models GFS --regions florida_east_coast --dynamic 1 --port 4100
//   python backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   CDN_DIR=<cdn> PORT=4100 ARMS=cur,noprewarm,noregional VIEWS=cocoa,ocean ROUNDS=3 OUT=cold_veil.json node .../scn_cold_veil.js
// Env: ROUNDS (3), ARMS, VIEWS (cocoa = -80.6,28.1 z9 [the owner's live z9 box]; ocean = -50,30 z8), THEMES (dark), IDLE (3000),
//   WIN (9000), CDN_LAT (ms per static object, 0), LAT_GRID (ms added to each marine /grid and /grid_series, 0),
//   SHOTS=<dir>: a screenshot SHOT_MS (250) after the first frame and one at DETAIL+600 ms, per session.
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_cold_veil is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4193);
const ROUNDS = +(process.env.ROUNDS || 3);
const ARMS = (process.env.ARMS || 'cur,noprewarm,noregional').split(',');
const VIEWS = (process.env.VIEWS || 'cocoa,ocean').split(',');
const THEMES = (process.env.THEMES || 'dark').split(',');
const IDLE = +(process.env.IDLE || 3000);
const WIN = +(process.env.WIN || 9000);
const CDN_LAT = +(process.env.CDN_LAT || 0);
const LAT_GRID = +(process.env.LAT_GRID || 0);
const SHOTS = process.env.SHOTS || '';
const SHOT_MS = +(process.env.SHOT_MS || 250);
if (!CDN_DIR) throw Error('CDN_DIR=<publisher --out-dir> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEW = { cocoa: { c: [-80.6, 28.1], z: 9 }, ocean: { c: [-50, 30], z: 8 }, baja: { c: [-112.5, 24.5], z: 8 } };   // baja: Bahia Magdalena, no pilot box
const FLAGS = {
  cur: {}, nowords: { __RAW_DISABLE_VEIL_WORDS__: true }, noprewarm: { __RAW_DISABLE_REGIONAL_PREWARM__: true },
  noregional: { __RAW_DISABLE_REGIONAL_BUNDLES__: true },
  // the preview is ON by default since the owner's pick (2026-11-01); `preview` is kept as a name for the default
  preview: {}, nopreview: { __RAW_DISABLE_COLD_PREVIEW__: true }, preview_show: { __RAW_COLD_PREVIEW_COAST__: 'show' },
};
const flagsOf = (arm) => { const nr = /_nr$/.test(arm); const base = arm.replace(/_nr$/, ''); return { ...(FLAGS[base] || {}), ...(nr ? FLAGS.noregional : {}) }; };

const cdnLog = [];
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    const cors = { 'access-control-allow-origin': '*' };
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
    }
    const body = fs.readFileSync(file);
    cdnLog.push({ at: Date.now(), rel, bytes: body.length });
    res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  CDN_LAT ? setTimeout(send, CDN_LAT) : send();
});

// In-page probe: the click's own timeStamp, then per animation frame what the engine holds, what it drew and what the line says;
// the engine's render is wrapped to read 9 screen pixels after its heatmap pass (before the crest pass binds its program).
const PROBE = () => {
  const P = (window.__CV__ = { armed: false, t0: null, frames: [], px: [], coarseGrid: null, detailGrid: null });
  const PTS = [[0.66, 0.3], [0.8, 0.3], [0.92, 0.3], [0.66, 0.5], [0.8, 0.5], [0.92, 0.5], [0.66, 0.7], [0.8, 0.7], [0.92, 0.7]];
  P.pts = PTS;
  window.addEventListener('click', (e) => { if (P.armed && P.t0 == null) { P.t0 = e.timeStamp; P.wall0 = Date.now(); } }, true);
  const coarse = (g) => !!(g && g.bounds && (g.bounds.east - g.bounds.west) >= 359 && (360 / g.cols) > 1);
  const words = () => [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null && /\bmt-1\b/.test(x.className))
    .map((x) => x.textContent.trim()).filter(Boolean).join(' | ');
  const wrap = () => {
    const e = window.__MARINE_ENGINE__;
    if (!e || e.__cvWrapped) return;
    const orig = e.render;
    e.render = function (gl, ...rest) {
      if (P.t0 == null || !gl || !gl.readPixels) return orig.call(this, gl, ...rest);
      const Wd = gl.drawingBufferWidth; const Hd = gl.drawingBufferHeight; const buf = new Uint8Array(4);
      const read = () => PTS.map(([fx, fy]) => { gl.readPixels(Math.round(fx * Wd), Math.round((1 - fy) * Hd), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); return [buf[0], buf[1], buf[2]]; });
      let wash = null; const eng = this; const origUse = gl.useProgram;
      gl.useProgram = function (p) { if (wash == null && p && p === eng.drawProgram) { try { wash = read(); } catch (err) { wash = null; } } return origUse.call(this, p); };
      let out; try { out = orig.call(this, gl, ...rest); } finally { gl.useProgram = origUse; }
      let post = wash; if (!post) { try { post = read(); } catch (err) { post = null; } }
      if (P.px.length < 3000) P.px.push({ t: performance.now() - P.t0, rgb: post });
      return out;
    };
    e.__cvWrapped = true;
  };
  let lastWords = null;
  const tick = () => {
    wrap();
    if (P.t0 != null && P.frames.length < 4000) {
      const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
      const G = window.__RAW_GPU__ || {}; const op = G.opacity || {}; const blend = G.blendBoth;
      const w = words();
      const f = { t: Math.round(performance.now() - P.t0), has: !!g, coarse: coarse(g), dims: g ? `${g.cols}x${g.rows}` : null,
        cell: g && g.bounds && g.cols > 1 ? +((g.bounds.east - g.bounds.west) / (g.cols - 1)).toFixed(3) : null,
        // the opacity of the LAST heatmap pass drawn since the click (an idle map keeps that frame on screen), null before the first
        static: !!(g && g.static_frame), op: Number.isFinite(op.heatmap) && op.t && op.t >= P.wall0 ? op.heatmap : null,
        wash: !!(blend && blend.engaged), veil: G.coldVeil ? { ...G.coldVeil } : null };
      if (w !== lastWords) { f.words = w; lastWords = w; }
      f.w = w;
      P.frames.push(f);
      if (g && coarse(g) && !P.coarseGrid) P.coarseGrid = g;
      if (g && !coarse(g) && !P.detailGrid) P.detailGrid = g;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // bilinear height (m) of a grid at lng/lat (row 0 = south)
  P.heightAt = (g, lng, lat) => {
    if (!g || !g.bounds) return null;
    const b = g.bounds; const fx = (lng - b.west) / (b.east - b.west) * (g.cols - 1); const fy = (lat - b.south) / (b.north - b.south) * (g.rows - 1);
    if (!(fx >= 0 && fy >= 0 && fx <= g.cols - 1 && fy <= g.rows - 1)) return null;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy); const x1 = Math.min(g.cols - 1, x0 + 1); const y1 = Math.min(g.rows - 1, y0 + 1);
    const h = (c, r) => { const v = g.vectors[r * g.cols + c]; if (!v || v.is_valid === false) return null; return typeof v.height === 'number' ? v.height : v.speed; };
    const a = h(x0, y0); const bb = h(x1, y0); const c = h(x0, y1); const dd = h(x1, y1);
    if ([a, bb, c, dd].some((x) => x == null)) return null;
    const tx = fx - x0; const ty = fy - y0;
    return (a * (1 - tx) + bb * tx) * (1 - ty) + (c * (1 - tx) + dd * tx) * ty;
  };
  P.swapFt = () => {
    const m = window.__MAP_INSTANCE__ || window.map; if (!m || !P.coarseGrid || !P.detailGrid) return null;
    const cv = m.getCanvas(); const out = [];
    for (const [fx, fy] of PTS) {
      const ll = m.unproject([fx * cv.clientWidth, fy * cv.clientHeight]);
      const a = P.heightAt(P.coarseGrid, ll.lng, ll.lat); const b = P.heightAt(P.detailGrid, ll.lng, ll.lat);
      out.push(a == null || b == null ? null : +((a - b) * 3.28084).toFixed(3));
    }
    return out;
  };
};

// CIEDE2000 between two sRGB triplets
function lab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r); const G = lin(g); const B = lin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047; let y = R * 0.2126 + G * 0.7152 + B * 0.0722; let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function de2000(c1, c2) {
  const [L1, a1, b1] = lab(c1); const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180; const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2); const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1; const a2p = (1 + G) * a2; const C1p = Math.hypot(a1p, b1); const C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (b === 0 && a === 0) return 0; const v = Math.atan2(b, a) / rad; return v >= 0 ? v : v + 360; };
  const h1p = h(b1, a1p); const h2p = h(b2, a2p);
  const dLp = L2 - L1; const dCp = C2p - C1p;
  let dhp = 0; if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2; const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p !== 0) { hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2) : (h1p + h2p) / 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2)); const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2); const SC = 1 + 0.045 * Cbp; const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTh * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

async function clickExact(page, text) {
  const clicked = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === t && x.offsetParent !== null);
    if (b) b.click();
    return !!b;
  }, text, { timeout: 15000 });
  if (!(await clicked.jsonValue())) throw Error(`no ${text} control`);
}

function judge(frames) {
  const first = frames.find((f) => f.has);
  const visible = frames.find((f) => f.has && f.op != null && f.op > 0);
  const detail = frames.find((f) => f.has && !f.coarse);
  const veils = frames.filter((f) => f.veil);
  const lifted = veils.find((f) => f.veil.lifted);
  const mis = { blank_unworded: 0, veil_words_over_detail: 0, preview_unlabelled: 0 };
  let showingBeforeDraw = 0;   // a resident uploaded, no heatmap pass yet, and the line already says "Showing …" (reported, not a veil defect)
  for (const f of frames) {
    if (f.has && f.op == null && /^Showing/.test(f.w)) showingBeforeDraw += 1;
    if (!f.has || f.op == null) continue;
    if (f.op === 0 && !f.wash && !/Loading|loading/.test(f.w)) mis.blank_unworded += 1;
    if (!f.coarse && f.op > 0 && /Loading the detailed forecast/.test(f.w)) mis.veil_words_over_detail += 1;
    if (f.coarse && f.op > 0 && f.veil && !f.veil.lifted && !/Coarse .*preview/.test(f.w)) mis.preview_unlabelled += 1;
  }
  const wordsSeen = []; for (const f of frames) if (f.words !== undefined) wordsSeen.push([f.t, f.words.slice(0, 140)]);
  return {
    firstMs: first ? first.t : null, firstStatic: first ? first.static : null, firstCoarse: first ? first.coarse : null,
    visibleMs: visible ? visible.t : null, blankMs: first && visible ? visible.t - first.t : null,
    detailMs: detail ? detail.t : null, firstToDetailMs: first && detail ? detail.t - first.t : null, detailDims: detail ? detail.dims : null, detailCellDeg: detail ? detail.cell : null,
    fineMs: (frames.find((f) => f.has && f.cell != null && f.cell < 1) || {}).t ?? null, detailStatic: detail ? detail.static : null,
    lift: lifted ? lifted.veil.reason : (veils.length ? 'unlifted' : 'none'), veilFrames: veils.length,
    previewFrames: veils.filter((f) => f.veil.preview).length, previewWhy: (veils.find((f) => f.veil.previewWhy) || {}).veil?.previewWhy || null,
    showingBeforeDraw, mismatch: mis, mismatchTotal: mis.blank_unworded + mis.veil_words_over_detail + mis.preview_unlabelled, words: wordsSeen,
  };
}

async function session(arm, view, theme, round) {
  const flags = flagsOf(arm);
  const hooks = LAT_GRID ? { beforeWeather: async (url) => { if (/\/grid(_series)?$/.test(url.pathname) && !/wind/.test(url.search)) await sleep(LAT_GRID); } } : {};
  const { browser, page, log } = await L.launch({ port: PORT, hooks });
  await page.addInitScript(({ base, flags, theme }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); localStorage.setItem('raw-surf-theme', theme); window.__RAW_STATIC_FRAMES_BASE__ = base;
    for (const [k, v] of Object.entries(flags)) window[k] = v;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, flags, theme });
  await page.addInitScript(PROBE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  const c0 = cdnLog.length;
  try {
    await L.openMap(page);
    const v = VIEW[view];
    await L.jump(page, v.c[0], v.c[1], v.z);
    await sleep(IDLE);
    const warm = await page.evaluate(() => (window.__RAW_STATIC_REGIONAL__ && window.__RAW_STATIC_REGIONAL__.prewarm) || null);
    const cBefore = cdnLog.length; const rBefore = log.requests.length;
    await page.evaluate(() => { window.__CV__.armed = true; });
    await clickExact(page, 'Waves');
    const t0 = Date.now(); let st; const shots = [];
    const tag = `${view}_${theme}_${arm}_r${round}`;
    let shotFirst = false; let shotDetail = false;
    do {
      await sleep(30);
      st = await page.evaluate(() => { const f = window.__CV__.frames; const first = f.find((x) => x.has); const det = f.find((x) => x.has && !x.coarse);
        return { first: first ? first.t : null, detail: det ? det.t : null, now: f.length ? f[f.length - 1].t : 0 }; });
      if (SHOTS && st.first != null && !shotFirst && st.now >= st.first + SHOT_MS) {
        shotFirst = true; const p = path.join(SHOTS, `${tag}_veil.png`); await page.screenshot({ path: p }); shots.push(p);
      }
      if (SHOTS && st.detail != null && !shotDetail && st.now >= st.detail + 600) {
        shotDetail = true; const p = path.join(SHOTS, `${tag}_detail.png`); await page.screenshot({ path: p }); shots.push(p);
      }
    } while ((st.detail == null || st.now < st.detail + 1500) && Date.now() - t0 < WIN);
    const raw = await page.evaluate(() => ({ frames: window.__CV__.frames, px: window.__CV__.px, swapFt: window.__CV__.swapFt() }));
    const j = judge(raw.frames);
    let dE = null;
    if (j.detailMs != null && j.firstCoarse) {   // a coarse -> detail swap happened: the frame before the detail vs 450 ms after it
      const pre = raw.px.filter((p) => p.rgb && p.t >= j.firstMs && p.t < j.detailMs).pop();
      const post = raw.px.find((p) => p.rgb && p.t >= j.detailMs + 450);
      if (pre && post) dE = pre.rgb.map((c, i) => +de2000(c, post.rgb[i]).toFixed(2));
    }
    const after = log.requests.slice(rBefore).map((q) => q.path);
    const objs = (a, b) => cdnLog.slice(a, b).map((x) => x.rel.replace(/^v1\/gfs\/marine\/waves\//, '').slice(0, 48));
    return { arm, view, theme, round, idle: IDLE, ...j, swapFt: raw.swapFt, dE, warm,
      cdnBeforeClick: objs(c0, cBefore), cdnAfterClick: objs(cBefore, cdnLog.length),
      gridAsks: after.filter((p) => p.endsWith('/grid')).length, seriesAsks: after.filter((p) => p.endsWith('/grid_series')).length, shots,
      errors: [...errors, ...log.errors.slice(0, 5).map((e) => e.text)] };
  } finally { await browser.close(); }
}

const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
const mean = (a) => { const s = a.filter((x) => x != null); return s.length ? +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2) : null; };
(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const out = [];
  try {
    for (let round = 0; round < ROUNDS; round++) {
      for (const view of VIEWS) for (const theme of THEMES) {
        const order = round % 2 ? ARMS.slice().reverse() : ARMS;
        for (const arm of order) {
          let s;
          try { s = await session(arm, view, theme, round); } catch (e) { s = { arm, view, theme, round, failed: String(e).slice(0, 200) }; }
          out.push(s);
          console.log(`${view}/${theme}/${arm} r${round}: first ${s.firstMs} visible ${s.visibleMs} blank ${s.blankMs} detail ${s.detailMs} (${s.detailDims}, static ${s.detailStatic})`
            + ` lift ${s.lift} preview ${s.previewFrames}/${s.veilFrames}${s.previewWhy ? ' ' + s.previewWhy : ''} mismatch ${JSON.stringify(s.mismatch)} dE ${s.dE ? mean(s.dE) : '-'} dFt ${s.swapFt ? mean(s.swapFt.map(Math.abs)) : '-'}`
            + ` | /grid ${s.gridAsks} series ${s.seriesAsks} | warm ${s.warm ? (s.warm.frame || s.warm.skipped) : '-'}${s.failed ? ' FAILED ' + s.failed : ''}${s.errors && s.errors.length ? ' errors ' + s.errors.length : ''}`);
        }
      }
    }
  } finally { cdn.close(); }
  const summary = {};
  for (const view of VIEWS) for (const arm of ARMS) {
    const rows = out.filter((s) => s.arm === arm && s.view === view && !s.failed);
    const lifts = {}; for (const r of rows) lifts[r.lift] = (lifts[r.lift] || 0) + 1;
    summary[`${view}/${arm}`] = { n: rows.length, blankP50: pct(rows.map((s) => s.blankMs), 0.5), blankP95: pct(rows.map((s) => s.blankMs), 0.95),
      firstToDetailP50: pct(rows.map((s) => s.firstToDetailMs), 0.5), firstToDetailP95: pct(rows.map((s) => s.firstToDetailMs), 0.95),
      firstToFineP50: pct(rows.map((s) => (s.fineMs != null && s.firstMs != null ? s.fineMs - s.firstMs : null)), 0.5),
      firstToFineP95: pct(rows.map((s) => (s.fineMs != null && s.firstMs != null ? s.fineMs - s.firstMs : null)), 0.95),
      detailCellDeg: [...new Set(rows.map((s) => s.detailCellDeg))],
      lifts, mismatchFrames: rows.reduce((a, s) => a + (s.mismatchTotal || 0), 0),
      dEmean: mean(rows.map((s) => (s.dE ? mean(s.dE) : null))), dFtAbsMean: mean(rows.map((s) => (s.swapFt ? mean(s.swapFt.map((x) => (x == null ? null : Math.abs(x)))) : null))) };
  }
  console.log('SUMMARY', JSON.stringify(summary, null, 1));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ env: { IDLE, CDN_LAT, LAT_GRID, ROUNDS, ARMS, VIEWS, THEMES }, summary, sessions: out }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
