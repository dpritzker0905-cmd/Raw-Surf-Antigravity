// THE LATE CORRECTION AFTER A MULTI-HOUR JUMP (2026-11-15; pre-registered in docs/weather-program/log/2026-11-15-claude-marine-late-wash.md).
// The hour-blend lane saw, with its blend killed, a coastal regional picture differ from the SAME hour at rest by ~4.1 luminance units
// at 250 / 900 ms after a 6 h jump and by 0.000 at 2.5 s. Offline only (serve_synthetic + the publisher's frames as the CDN).
//
// Per (arm, view): fresh browser, the layer on at the view, settle; Home; settle; then STEPS x ArrowRight on the timeline wheel in one
// burst (a +STEPS h jump). In the map's 'render' event the drawn frame's luminance (Rec. 709, every 2nd pixel) is captured at
// 250, 900, 2500, 5000 ms after the jump and at REST (10 s); per capture: the wash decision (window.__MARINE_WASH_TIME__.last), the
// coarse base's and the resident's valid times and sizes. NULL control: the same captures with no key pressed (the hour at rest
// against itself). Verdict lines: diff vs rest per offset, and the wash state at each.
//   AB_BASE=http://127.0.0.1:3106 PORT=4151 CDN_DIR=<cdn> ARMS=cur,kill:__RAW_DISABLE_X__ OUT=<json> node scn_hour_jump_wash.js
// Env: VIEWS ("layer,lng,lat,zoom;..." default Florida waves z7.5 and the world z2.5), STEPS (6), CDN_PORT (4373).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_hour_jump_wash is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4373);
const STEPS = +(process.env.STEPS || 6);
const AT = [250, 900, 2500, 5000];
const REST_MS = 10000;
const VIEWS = (process.env.VIEWS || 'waves,-80.3,29.0,7.5;waves,-60,25,2.5').split(';').map((s) => { const [l, a, b, z] = s.split(','); return [l, +a, +b, +z]; });
const ARMS = (process.env.ARMS || 'cur').split(',').map((s) => { const [name, rest] = s.split(':'); return { name, levers: rest ? rest.split('+') : [] }; });
if (!CDN_DIR) throw Error('CDN_DIR is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

// In page: capture the drawn frame's luminance at given ms after a mark (read in 'render', while the drawing buffer holds it).
function installCapture() {
  const W = window; const H = W.__HJW__ = { want: [], got: [] };
  const state = () => {
    const e = W.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; const cb = e && e._coarseBaseData;
    const cbg = cb && (cb.waveGrid || cb.grid || cb);
    const wt = W.__MARINE_WASH_TIME__;
    return { resident: g ? `${g.cols}x${g.rows}@${g.served_valid_time || g.valid_time || g.validTime || ''}` : null,
      base: cbg ? `${cbg.cols}x${cbg.rows}@${cbg.served_valid_time || cbg.valid_time || cbg.validTime || (cb && (cb.valid_time || cb.validTime)) || ''}` : null,
      wash: wt && wt.last ? { ok: wt.last.ok, why: wt.last.why, offH: wt.last.offH } : null, refused: wt ? wt.refused : null,
      asked: wt ? wt.asked || 0 : null, scrubbing: !!W.isScrubbingTimeline,
      prewarm: W.__MARINE_GLOBAL_PREWARM__ && W.__MARINE_GLOBAL_PREWARM__.last
        ? `${W.__MARINE_GLOBAL_PREWARM__.last.reason}${W.__MARINE_GLOBAL_PREWARM__.last.why ? ':' + W.__MARINE_GLOBAL_PREWARM__.last.why : ''}@${W.__MARINE_GLOBAL_PREWARM__.last.hour}` : null };
  };
  const read = () => {
    const m = W.__MAP_INSTANCE__ || W.map; const gl = m.painter.context.gl; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const cw = Math.floor(w / 2); const ch = Math.floor(h / 2); const out = new Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = ((y * 2) * w + x * 2) * 4; out[y * cw + x] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; }
    return out;
  };
  const m = W.__MAP_INSTANCE__ || W.map;
  m.on('render', () => {
    if (!H.want.length) return;
    const now = performance.now();
    while (H.want.length && now >= H.want[0].at) { const w = H.want.shift(); H.got.push({ label: w.label, t: Math.round(now - H.mark), lum: read(), st: state() }); }
  });
  H.plan = (labels) => { H.mark = performance.now(); H.got = []; H.want = labels.map(([label, ms]) => ({ label, at: H.mark + ms })); };
  // keep frames coming so 'render' fires at each offset even on a still map
  const kick = () => { try { (W.__MAP_INSTANCE__ || W.map).triggerRepaint(); } catch (e) { /* diagnostics only */ } requestAnimationFrame(kick); };
  requestAnimationFrame(kick);
}

const diff = (a, b) => { if (!a || !b || a.length !== b.length) return null; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return +(s / a.length).toFixed(3); };

async function capture(page, labels, act) {
  await page.evaluate((ls) => window.__HJW__.plan(ls), labels);
  if (act) await act();
  await sleep(labels[labels.length - 1][1] + 600);
  return page.evaluate(() => window.__HJW__.got);
}

// The particle (crest) draws are skipped, as the hour-blend lane's instrument does (a program whose shader has u_trochoidal), so the
// animated crests do not swamp a 4-unit colour difference: what is left is the colour pass (heatmap + wash) and the basemap.
const SPY = () => {
  const src = new WeakMap(); const isParticle = new WeakMap(); const P = WebGL2RenderingContext.prototype;
  const ss = P.shaderSource; P.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
  const as = P.attachShader; P.attachShader = function (pr, sh) { if (/u_trochoidal/.test(src.get(sh) || '')) isParticle.set(pr, true); return as.call(this, pr, sh); };
  let cur = null; const up = P.useProgram; P.useProgram = function (pr) { cur = pr; return up.call(this, pr); };
  for (const k of ['drawArrays', 'drawElements']) { const o = P[k]; P[k] = function (...a) { if (cur && isParticle.get(cur)) return undefined; return o.apply(this, a); }; }
};

async function session(arm, view) {
  const [layer, lng, lat, zoom] = view;
  const { browser, page, log } = await L.launch({ port: PORT, width: 1280, height: 800 });
  const out = { arm: arm.name, levers: arm.levers, view };
  try {
    await page.addInitScript(SPY);
    await page.addInitScript(({ base, levers }) => {
      localStorage.setItem('raw-surf-theme', 'dark'); window.__RAW_STATIC_FRAMES_BASE__ = base; window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true;
      for (const k of levers) window[k] = true;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, levers: arm.levers });
    await L.openMap(page);
    await L.jump(page, lng, lat, zoom);
    await sleep(1500);
    const label = { waves: /^\s*Waves\s*$/, swell_1: /^\s*Swell\s*1?\s*$/ }[layer] || /^\s*Waves\s*$/;
    if (await page.evaluate((l) => typeof window.toggleLayer === 'function' && (window.toggleLayer(l), true), layer) !== true) {
      await page.locator('button').filter({ hasText: label }).filter({ visible: true }).first().evaluate((el) => el.click());
    }
    await sleep(9000);
    await page.evaluate(installCapture);
    const key = (k, n) => page.evaluate(({ k2, n2 }) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/i.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
      if (!el) return false; el.focus(); for (let i = 0; i < n2; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: k2, bubbles: true, cancelable: true })); return true; }, { k2: k, n2: n });
    await key('Home', 1); await sleep(8000);
    const labels = AT.map((ms) => [`+${ms}`, ms]).concat([['rest', REST_MS]]);
    // NULL control: the same captures with no key pressed
    const nul = await capture(page, labels, null);
    const nRest = nul.find((g) => g.label === 'rest');
    out.null = nul.map((g) => ({ label: g.label, t: g.t, d: diff(g.lum, nRest && nRest.lum), wash: g.st.wash, resident: g.st.resident, base: g.st.base }));
    // the jump
    const pressed = await (async () => { let ok = null; const got = await capture(page, labels, async () => { ok = await key('ArrowRight', STEPS); }); return { ok, got }; })();
    const rest = pressed.got.find((g) => g.label === 'rest');
    out.keyOk = pressed.ok;
    out.jump = pressed.got.map((g) => ({ label: g.label, t: g.t, d: diff(g.lum, rest && rest.lum), wash: g.st.wash, refused: g.st.refused, resident: g.st.resident, base: g.st.base }));
    // PASS 2: back to the start hour, settle, the same jump again (every grid of both hours fetched once: the cache-settled case)
    await key('Home', 1); await sleep(8000);
    const p2 = await capture(page, labels, async () => { await key('ArrowRight', STEPS); });
    const rest2 = p2.find((g) => g.label === 'rest');
    out.jump2 = p2.map((g) => ({ label: g.label, t: g.t, d: diff(g.lum, rest2 && rest2.lum), wash: g.st.wash, resident: g.st.resident, base: g.st.base,
      asked: g.st.asked, scrubbing: g.st.scrubbing, prewarm: g.st.prewarm }));
    out.asks = log.requests.length;
    out.errors = log.errors.slice(0, 3);
  } finally { await browser.close(); }
  return out;
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const res = [];
  for (const arm of ARMS) for (const v of VIEWS) {
    try { res.push(await session(arm, v)); } catch (e) { res.push({ arm: arm.name, view: v, error: String(e && e.stack || e).slice(0, 600) }); }
  }
  cdn.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  for (const r of res) {
    if (r.error) { console.log(`${r.arm} ${r.view} ERROR ${r.error}`); continue; }
    const fmt = (rows) => rows.map((g) => `${g.label}=${g.d}${g.wash ? `[${g.wash.why}]` : ''}`).join(' ');
    console.log(`${r.arm} ${r.view.join(',')} key=${r.keyOk} | JUMP ${fmt(r.jump)} | JUMP2 ${fmt(r.jump2 || [])} | NULL ${fmt(r.null)}`);
    console.log(`   jump2 states: ${(r.jump2 || []).map((g) => `${g.label}: res ${g.resident} base ${g.base} scrub=${g.scrubbing} asked=${g.asked} prewarm=${g.prewarm}`).join(' ; ')}`);
    console.log(`   jump states: ${r.jump.map((g) => `${g.label}: res ${g.resident} base ${g.base}`).join(' ; ')}`);
  }
})();
