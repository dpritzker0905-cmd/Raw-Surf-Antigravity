// The Surf Rating band toggle (2026-10-26, the owner's live test: "the surf rating band stays on for a few seconds, when its turned off").
// Offline only. One fresh browser per (scenario, zoom): the band ON and settled, a toggle click, and a per-animation-frame probe.
//
// Probe (in page, every frame from the click): flag (window.__SURF_MODE__), band painting (__RAW_GPU__.ratingBand.active), the resident
// grid's ratingMode and dims, the band-fade multiplier. Reported per run:
//   offMs     the first frame at/after the click where the band is NOT painting and stays off for 400 ms ("band gone");
//   honestMs  the first frame where the resident grid is no longer a rating grid (the honest field drawn);
//   blankMs   frames with no resident grid at all after the click (a blank heatmap), counted in ms;
//   strandedMs the longest span a toggle intent sat buffered: the max gap between a forensic `intent_buffered` for the toggle and the next
//             commit/settle; plus the console lines "[Abort-Gate] Preserving", "[Release] Releasing active fetch (flavor_toggle_pending)",
//             "Stranded fetch-pending released" counted from the click;
//   mislabel   frames whose drawn model differs from the selected model (silent: the status line says nothing) after the click.
// Scenarios (SCN): rest | scrub (toggle OFF mid-scrub, the scrub's asks delayed) | inflight (toggle OFF while a /grid is held) |
//   rapid (10 clicks, 150 ms apart, ending OFF) | modelswitch (EURO clicked, then OFF at once) | on (toggle ON from OFF: paint at once if rated else fetch)
//   AB_BASE=http://127.0.0.1:3110 PORT=4151 CDN_DIR=<cdn> SCN=rest ZOOM=5 THEME=dark VIEW=desktop OUT=<json> node scn_band_toggle.js
// Env: SCRUB_WAIT (800 ms between the last scrub key and the click), SCN (rest), ZOOM (8), CENTER ("-80.6,28.1"), THEME (dark), VIEW (desktop|phone), HOLD_MS (4000: how long a held ask takes), SETTLE (9000),
//   WATCH (6000: ms watched after the last click), ARM (default: the build as it ships | nohold: __RAW_DISABLE_BAND_HOLD_LEGS__ style kills are set by KILLS),
//   KILLS (JSON of window levers to set, e.g. {"__RAW_DISABLE_BAND_RES_FADE__":true}), CDN_PORT (4391), SHOTS (dir: a PNG at the click, +1 frame, +1 s).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));

if (process.env.AB_LIVE === '1') throw Error('scn_band_toggle is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4391);
const SCN = process.env.SCN || 'rest';
const ZOOM = +(process.env.ZOOM || 8);
const [CLNG, CLAT] = (process.env.CENTER || '-80.6,28.1').split(',').map(Number);
const THEME = process.env.THEME || 'dark';
const VIEW = process.env.VIEW || 'desktop';
const HOLD_MS = +(process.env.HOLD_MS || 4000);
const SETTLE = +(process.env.SETTLE || 9000);
const WATCH = +(process.env.WATCH || 6000);
const KILLS = process.env.KILLS ? JSON.parse(process.env.KILLS) : {};
const SHOTS = process.env.SHOTS || '';
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIMS = VIEW === 'phone' ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } }
  : { width: 1280, height: 800, dpr: 1, contextOptions: {} };

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
    return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

// In-page probe, started before any click. P.mark(name) stamps an event time; frames after the first mark are recorded compactly.
const PROBE = () => {
  const P = (window.__BT__ = { marks: {}, frames: [], t0: null, console: [] });
  const flag = () => (window.__SURF_MODE__ !== undefined ? !!window.__SURF_MODE__ : (localStorage.getItem('__SURF_MODE__') === 'true'));
  P.mark = (n) => { const t = performance.now(); P.marks[n] = t; if (P.t0 === null) P.t0 = t; return t; };
  const origLog = console.log; const origWarn = console.warn;
  const grab = (a) => { const s = a.map((x) => (typeof x === 'string' ? x : '')).join(' '); if (/Abort-Gate\] Preserving|Releasing active fetch \(flavor_toggle|Stranded fetch-pending|Releasing in-flight fetch/.test(s)) P.console.push({ t: Math.round(performance.now() - (P.t0 || 0)), s: s.slice(0, 150) }); };
  console.log = function (...a) { try { grab(a); } catch (e) { /* ignore */ } return origLog.apply(this, a); };
  console.warn = function (...a) { try { grab(a); } catch (e) { /* ignore */ } return origWarn.apply(this, a); };
  const loop = (t) => {
    if (P.t0 !== null) {
      const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
      const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand; const rf = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade;
      // painting = the band path is on AND its opacity is above 0 (the instant hide keeps the path on at opacity 0)
      const bm = rf ? +(+rf.bandMult).toFixed(2) : null;
      P.frames.push({ t: Math.round(t - P.t0), flag: flag(), active: rb ? (!!rb.active && (bm === null || bm > 0)) : null, grid: g ? (g.ratingMode ? 'R' : 'H') + g.cols + 'x' + g.rows : null,
        model: g ? (g.__sourceModel || 'GFS') : null, bandMult: bm, held: rf ? rf.heldBy || null : null });
      if (P.frames.length > 4000) P.frames.shift();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

// Rating-band pixels: red/orange dominance (the 'very poor' / 'poor' levels, muted by their alpha over the dark map: ~ (180, 50-90, 80-120)): r > 150, r-g > 70, r-b > 40.
async function bandPixels(page) {
  // the map area only (the weather panel's own legend bar carries the same red/orange gradient): desktop x 210-1020, y 100-780; phone the middle band
  const clip = VIEW === 'phone' ? { x: 0, y: 150, width: 390, height: 380 } : { x: 210, y: 100, width: 800, height: 680 };
  const buf = await page.screenshot({ clip }); const png = decodePng(buf); let n = 0;
  for (let i = 0; i < png.width * png.height; i++) { const o = i * png.bpp; const r = png.data[o]; const g = png.data[o + 1]; const b = png.data[o + 2];
    if (r > 150 && (r - g) > 70 && (r - b) > 40) n += 1; }
  return n;
}
async function clickToggle(page) {
  // the Surf Rating pill: "Surf Rating: ON" / "Surf Rating: OFF" (desktop panel; the phone sheet has the same button)
  const b = page.locator('button').filter({ hasText: /Surf Rating/ }).filter({ visible: true }).first();
  const seen = await b.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
  if (seen) { await b.evaluate((el) => { window.__BT__.mark('click'); el.click(); }); return; }
  // The phone's expanded sheet can leave the pill outside its visible box (the sheet clips it): click the DOM button, the handler is the same.
  const ok = await page.evaluate(() => { const el = [...document.querySelectorAll('button')].find((x) => /Surf Rating/.test(x.textContent)); if (!el) return false; window.__BT__.mark('click'); el.click(); return true; });
  if (!ok) throw new Error('no Surf Rating button in the DOM');
}

async function session() {
  let gateUntil = 0;                    // while Date.now() < gateUntil, weather grid asks are delayed until gateUntil
  const { browser, page } = await L.launch({ port: PORT, width: DIMS.width, height: DIMS.height, dpr: DIMS.dpr, contextOptions: DIMS.contextOptions, hooks: {
    beforeWeather: async (url) => {
      if (Date.now() < gateUntil && /\/(grid|grid_series)$/.test(url.pathname)) await sleep(Math.max(0, gateUntil - Date.now()));
    },
  } });
  const out = { scn: SCN, zoom: ZOOM, theme: THEME, view: VIEW, kills: KILLS };
  try {
    await page.addInitScript(({ base, theme, kills, startOn }) => {
      localStorage.setItem('raw-surf-theme', theme);
      localStorage.removeItem('__RAW_STATIC_FRAMES__');
      window.__RAW_STATIC_FRAMES_BASE__ = base;
      window.__SURF_MODE__ = startOn;
      for (const [k, v] of Object.entries(kills)) window[k] = v;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme: THEME, kills: KILLS, startOn: SCN !== 'on' });
    await page.addInitScript(PROBE);
    await L.openMap(page);
    if (VIEW === 'phone') {
      const ex = page.locator('[aria-label="Weather layers"]').first();
      await ex.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await ex.evaluate((el) => el.click()).catch(() => {});
      await sleep(1000);
    }
    const wv = page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first();
    await wv.waitFor({ state: 'visible', timeout: 20000 });
    await wv.evaluate((el) => el.click());
    await sleep(3000);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await sleep(SETTLE);
    out.settled = await page.evaluate(() => { const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand; const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid; return { flag: window.__SURF_MODE__, active: rb && rb.active, grid: g ? `${g.ratingMode ? 'R' : 'H'}${g.cols}x${g.rows}` : null }; });
    await page.evaluate(() => window.__BT__.mark('start'));
    const key = (k) => page.keyboard.press(k);
    if (process.env.PIXELS) out.pxBefore = await bandPixels(page);
    if (SCN === 'rest' || SCN === 'on') {
      await clickToggle(page);
    } else if (SCN === 'scrub') {
      gateUntil = Date.now() + HOLD_MS + 1500;                       // the scrub's asks are slow
      for (let i = 0; i < 4; i++) { await key('PageUp'); await sleep(120); }
      await sleep(+(process.env.SCRUB_WAIT || 800));            // the scrub's (slow) fetch is now in flight
      await clickToggle(page);
    } else if (SCN === 'inflight') {
      gateUntil = Date.now() + HOLD_MS;
      await L.jump(page, CLNG + 0.3, CLAT, ZOOM);                    // a viewport ask goes out and is held
      await sleep(400);
      await clickToggle(page);
    } else if (SCN === 'rapid') {
      for (let i = 0; i < 10; i++) { await clickToggle(page); await sleep(150); }
      if (await page.evaluate(() => !!window.__SURF_MODE__)) await clickToggle(page);   // end OFF
    } else if (SCN === 'modelswitch') {
      await page.locator('button').filter({ hasText: /^\s*EURO\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
      await sleep(250);
      await clickToggle(page);
    }
    if (process.env.PIXELS) { await sleep(+(process.env.PIXELS_AT || 60)); out.pxAfter = await bandPixels(page); out.pxAfterAt = +(process.env.PIXELS_AT || 60); }
    await sleep(WATCH);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${SCN}-z${ZOOM}-${THEME}-${VIEW}-end.png`) }); }
    const rec = await page.evaluate(() => ({ marks: window.__BT__.marks, frames: window.__BT__.frames, console: window.__BT__.console, t0: window.__BT__.t0,
      ev: ((window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.events) || []).filter((e) => /surf_toggle|intent_buffered|flavor_cache_fastpath|flavor_fastpath|inflight_skip|stranded|release/i.test(e.type)).slice(-40).map((e) => JSON.stringify(e).slice(0, 200)) }));
    const clicks = [];
    out.console = rec.console;
    out.events = rec.ev;
    const fr = rec.frames; const click = rec.marks.click != null ? Math.round(rec.marks.click - rec.t0) : null; out.clickAtMs = click;
    const after = fr.filter((f) => click !== null && f.t >= click);
    const lastFlag = after.length ? after[after.length - 1].flag : null;
    out.finalFlag = lastFlag;
    // band gone: the first frame whose `active` is false and stays false for 400 ms
    let offMs = null;
    for (let i = 0; i < after.length; i++) { if (after[i].active === false) { const t0 = after[i].t; if (after.filter((f) => f.t >= t0 && f.t <= t0 + 400).every((f) => f.active === false)) { offMs = t0 - click; break; } } }
    out.offMs = offMs;
    const honest = after.find((f) => f.grid && f.grid[0] === 'H'); out.honestMs = honest ? honest.t - click : null;
    const flagFlip = after.find((f) => f.flag === false); out.flagOffMs = flagFlip ? flagFlip.t - click : null;
    let blank = 0; for (let i = 1; i < after.length; i++) if (!after[i].grid) blank += after[i].t - after[i - 1].t; out.blankMs = Math.round(blank);
    out.finalGrid = after.length ? after[after.length - 1].grid : null;
    out.finalActive = after.length ? after[after.length - 1].active : null;
    out.frames = after.length;
    out.timeline = [];
    let prev = '';
    for (const f of after) { const s = `${f.flag ? 'F' : 'f'}${f.active ? 'B' : 'b'}${f.grid || '-'}|${f.model}|${f.bandMult}|${f.held || ''}`; if (s !== prev) { out.timeline.push([f.t - click, s]); prev = s; } }
    out.timeline = out.timeline.slice(0, 40);
  } finally { await browser.close(); }
  return out;
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  let res;
  try { res = await session(); } catch (e) { res = { scn: SCN, zoom: ZOOM, error: String(e && e.stack || e).slice(0, 800) }; }
  cdn.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  if (res.error) { console.log('ERROR', res.error); return; }
  console.log(`${res.scn} z${res.zoom} px ${res.pxBefore}->${res.pxAfter} ${res.theme} ${res.view} | settled ${JSON.stringify(res.settled)} | flagOff ${res.flagOffMs} ms | bandGone ${res.offMs} ms | honest grid ${res.honestMs} ms | blank ${res.blankMs} ms | final flag=${res.finalFlag} band=${res.finalActive} grid=${res.finalGrid} | console ${res.console.length}`);
})();
