// OWNER A/B CLIPS for wind between 3-hourly frames (2026-10-24, the lead's queue; OPT-IN, default off). Offline only.
//   Clip A (the status line names the nearest stored frame) shipped as #560's LABEL INSTANT and is the default, so the "off" arm
//   now shows it; there is no A flag.
//   CLIP=B  window.__RAW_WIND_TIME_BLEND__: in the f120+ tail (3-hourly; before f120 the frames are hourly, #580), hours between
//           frames draw a PCHIP-on-u/v blend of the frames t-3..t+6 (the hold-out's pick, SCOREBOARD S23), labelled
//           "Estimated forecast: interpolated between ... and ...".
// One fresh browser per arm (off, on), the SAME script: wind on, the wheel moved to START_HOUR (default 124: past f120 of the run
// even when the series anchor IS the run), then ArrowRight once every STEP_MS for STEPS hours. CDN_DIR must hold the wind set's
// frames out that far.
// Each arm is recorded (Playwright recordVideo) with a corner label naming the arm, and the status line's text is read at every
// step; `clips.html` in OUT_DIR plays the two recordings side by side, in sync, with the per-step lines under them.
//
//   EXPECT_STORE=<store> PORT=4196 CDN_DIR=<frames> AB_BASE=http://127.0.0.1:<spa> CLIP=B OUT_DIR=<dir> node scn_wind_clips.js
// Env: CENTER (-79.5,28.6), ZOOM (3.9), START_HOUR (124), STEPS (7), STEP_MS (2500), WIDTH/HEIGHT (1280x800), CDN_PORT (4194).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_wind_clips is offline only');
const PORT = +(process.env.PORT || 4100);
const CDN_DIR = process.env.CDN_DIR || '';
const CDN_PORT = +(process.env.CDN_PORT || 4194);
const CLIP = (process.env.CLIP || 'B').toUpperCase();
const OUT_DIR = path.resolve(process.env.OUT_DIR || `wind-clips-${CLIP}`);
const [CLNG, CLAT] = (process.env.CENTER || '-79.5,28.6').split(',').map(Number);
const ZOOM = +(process.env.ZOOM || 3.9);
const START_HOUR = +(process.env.START_HOUR || 124);
const STEPS = +(process.env.STEPS || 7);
const STEP_MS = +(process.env.STEP_MS || 2500);
const W = +(process.env.WIDTH || 1280); const H = +(process.env.HEIGHT || 800);
const FLAG = { B: '__RAW_WIND_TIME_BLEND__' }[CLIP];
if (!FLAG) throw Error(`CLIP must be B (clip A shipped as #560's default), got ${CLIP}`);
const WHAT = { B: 'the labelled f120+ tail blend (PCHIP u/v)' }[CLIP];
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!CDN_DIR || !file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
    return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json' });
  res.end(body);
});

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.click();
}

async function session(arm) {
  const dir = path.join(OUT_DIR, `rec-${arm}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const { browser, page } = await L.launch({ port: PORT, width: W, height: H, dpr: 1, video: dir });
  await page.addInitScript(({ base, flag, on, label }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    window.__RAW_STATIC_FRAMES_BASE__ = base;
    if (on) window[flag] = true;
    window.__WC_INIT__ = true;
    const put = () => {
      if (!document.body || document.getElementById('__wc_label')) return;
      const d = document.createElement('div');
      d.id = '__wc_label'; d.textContent = label;
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 8px;border-radius:4px;'
        + 'font:600 14px system-ui;background:rgba(0,0,0,.72);color:#fff;pointer-events:none';
      document.body.appendChild(d);
    };
    document.addEventListener('DOMContentLoaded', put); setInterval(put, 500);
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, flag: FLAG, on: arm === 'on', label: `Clip ${CLIP} ${arm === 'on' ? 'ON: ' + WHAT : 'OFF: today'}` });
  const out = { arm, steps: [] };
  try {
    await L.openMap(page);
    if (!(await page.evaluate(() => !!(window.__WC_INIT__ && window.__RAW_STATIC_FRAMES_BASE__)))) {
      throw Error('the init script did not run to the end: refusing this session');
    }
    await L.jump(page, CLNG, CLAT, ZOOM);
    await sleep(3000);
    await clickExact(page, 'Wind');
    await sleep(5000);
    const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
    const read = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="wind-time-status"]');
      const d = window.__WIND_DRAWN__ || null;
      // the timeline's time chip (forecastReadout): the leaf text that reads "Live" or "Sun 11 AM"
      const chip = Array.from(document.querySelectorAll('div,span')).find((e) => e.children.length === 0
        && /^(Live|[A-Z][a-z]{2} \d{1,2} (AM|PM))$/.test((e.textContent || '').trim()));
      return { label: chip ? chip.textContent.trim() : null, line: el ? el.textContent : null, state: el ? el.getAttribute('data-drawn-state') : null,
        drawnHour: d && d.hour, drawnMs: d && d.dataMs, estimated: d && d.estimated, blend: d && d.blendText,
        selected: window.__RAW_SELECTED_WIND__ || null, blends: (window.__RAW_WIND_STATIC__ || {}).blends || 0 };
    });
    for (let i = 0; i < START_HOUR; i++) { await page.keyboard.press('ArrowRight'); await sleep(30); }   // to the tail
    await sleep(STEP_MS * 2);
    out.steps.push({ hour: START_HOUR, ...(await read()) });
    for (let i = 1; i <= STEPS; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(STEP_MS);
      out.steps.push({ hour: START_HOUR + i, ...(await read()) });
    }
  } finally {
    const video = page.video();
    await page.context().close();
    out.video = video ? path.relative(OUT_DIR, await video.path()).replace(/\\/g, '/') : null;
    await browser.close();
  }
  return out;
}

function html(sessions) {
  const [off, on] = ['off', 'on'].map((a) => sessions.find((s) => s.arm === a));
  const rows = off.steps.map((s, i) => {
    const o = on.steps[i] || {};
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const cell = (x) => `<b>${esc((x && x.label) || '?')}</b> · ${x && x.line ? esc(x.line) : '<i>(no line)</i>'}`;
    return `<tr><td>+${s.hour} h</td><td>${cell(s)}</td><td>${cell(o)}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wind clip ${CLIP}</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#555;--line:#ccc}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#aaa;--line:#444}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:800px){.grid{grid-template-columns:1fr}}
video{width:100%;border:1px solid var(--line);border-radius:6px;background:#000}
h1{font-size:20px;margin:0 0 4px}p{color:var(--mut);margin:0 0 12px}button{font:inherit;padding:6px 14px;margin:0 0 12px}
table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border-top:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
</style></head><body>
<h1>Wind clip ${CLIP}: ${WHAT}</h1>
<p>Left: today (off). Right: ${WHAT} (on, opt-in). Same build, same data, same keys: wind on, the timeline moved to +${START_HOUR} h, then +1 hour every ${STEP_MS / 1000} s.</p>
<button id="play" type="button">Play both from the start</button>
<div class="grid"><figure style="margin:0"><video id="a" src="${off.video}" muted playsinline controls></video><figcaption>Off (today)</figcaption></figure>
<figure style="margin:0"><video id="b" src="${on.video}" muted playsinline controls></video><figcaption>On: ${WHAT}</figcaption></figure></div>
<table><thead><tr><th scope="col">Step</th><th scope="col">Off: time label · status line</th><th scope="col">On: time label · status line</th></tr></thead><tbody>${rows}</tbody></table>
<script>document.getElementById('play').onclick=()=>{for(const id of ['a','b']){const v=document.getElementById(id);v.currentTime=0;v.play();}};</script>
</body></html>`;
}

(async () => {
  const want = process.env.EXPECT_STORE;
  if (!want) throw Error('EXPECT_STORE is required');
  const id = await (await fetch(`http://127.0.0.1:${PORT}/__harness/identity`)).json().catch(() => null);
  if (!id || path.resolve(String(id.store)).toLowerCase() !== path.resolve(want).toLowerCase()) throw Error(`port ${PORT} is not our backend`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const sessions = [];
  try {
    for (const arm of ['off', 'on']) {
      const s = await session(arm);
      sessions.push(s);
      console.log(arm, JSON.stringify(s.steps.map((x) => [x.hour, x.label, x.state, x.line])));
    }
    fs.writeFileSync(path.join(OUT_DIR, 'clips.json'), JSON.stringify({ clip: CLIP, flag: FLAG, sessions }, null, 1));
    fs.writeFileSync(path.join(OUT_DIR, 'clips.html'), html(sessions));
    console.log('wrote', path.join(OUT_DIR, 'clips.html'));
  } finally { cdn.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
