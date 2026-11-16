// THE RATED BAND RUN-AGE LABEL (2026-11-16, #933; advisor + director: the label must be visible, three themes, three layouts).
// Offline only. CDN_DIR should hold rated regional bundles ONE RUN behind their plain siblings (the live CDN on 2026-11-15); the
// band ON over Florida; the status line read per (theme, view) and screenshotted. Control: the same CDN with
// __RAW_DISABLE_RATED_RUN_LABEL__ (no line) and, separately, a CDN with no lag (no line).
//   AB_BASE=http://127.0.0.1:3111 PORT=4151 CDN_DIR=<cdn> SHOTS=<dir> OUT=<json> node scn_rated_run_label.js
// Views: desktop | phone (timeline drawer collapsed: no status line shows, as for every status line) | phone_expanded (layers sheet) |
//   phone_timeline (the timeline drawer opened). Env: THEMES (light,dark,beach), ZOOM (8.5), VIEWS (desktop,phone,phone_expanded), KILL (1: set the label kill), CDN_PORT (4393), SETTLE (12000).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_rated_run_label is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4393);
const THEMES = (process.env.THEMES || 'light,dark,beach').split(',');
const VIEWS = (process.env.VIEWS || 'desktop,phone_timeline,phone,phone_expanded').split(',');
const SETTLE = +(process.env.SETTLE || 12000);
const SHOTS = process.env.SHOTS || null;
if (!CDN_DIR) throw Error('CDN_DIR is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json', 'cache-control': 'no-cache' });
  res.end(body);
});

async function session(theme, view) {
  const phone = view !== 'desktop';
  const opts = phone ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } } : { width: 1280, height: 800, dpr: 1 };
  const { browser, page } = await L.launch({ port: PORT, ...opts });
  try {
    await page.addInitScript(({ base, theme, kill }) => {
      localStorage.setItem('raw-surf-theme', theme); localStorage.setItem('__SURF_MODE__', 'true');
      window.__RAW_STATIC_FRAMES_BASE__ = base; if (kill) window.__RAW_DISABLE_RATED_RUN_LABEL__ = true;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme, kill: process.env.KILL === '1' });
    await L.openMap(page);
    await L.jump(page, -80.3, 28.4, +(process.env.ZOOM || 8.5));   // inside the lab's Florida box: a view reaching uncovered coast goes to /grid (no lag)
    await sleep(1500);
    if (phone) { await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); await sleep(800); }
    await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
    if (view === 'phone' || view === 'phone_timeline') { await sleep(500); await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); }
    await sleep(SETTLE);
    if (view === 'phone_timeline') {   // the phone's status lines live in the timeline drawer: open it as a user would
      const hdr = page.locator('.weather-compact-timeline-header button, button:has-text("Timeline")').filter({ visible: true }).first();
      await hdr.click({ timeout: 3000 }).catch(() => {}); await sleep(1500);
    }
    const r = await page.evaluate(() => {
      // Every layout mounts its own status block: report the one on screen (a hidden twin first in DOM order read 'not visible').
      const shown = (x) => (x.checkVisibility ? x.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : x.offsetParent !== null) && x.getBoundingClientRect().height > 0 && x.getBoundingClientRect().top < innerHeight;
      const all = [...document.querySelectorAll('[data-rated-run-label]')];
      const el = all.find(shown) || all[0] || null;
      const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
      const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand;
      return { label: el ? el.textContent : null, role: el && el.getAttribute('role'), live: el && el.getAttribute('aria-live'),
        // checkVisibility, not offsetParent: the phone drawer is position:fixed, where offsetParent is null for a line that is on screen
        visible: !!(el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.offsetParent !== null) && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top < innerHeight),
        color: el ? getComputedStyle(el).color : null, bg: el ? getComputedStyle(el.closest('[class*="bg-"]') || document.body).backgroundColor : null,
        band: rb ? !!rb.active : null, ratedRun: g ? g.ratedRun || null : null, cols: g ? g.cols : null,
        src: g ? { fromSeries: !!g.__fromSeries, provider: g.provider || null, region: g.region_id || null, scope: g.coverage_scope || null, lane: g.__lane || g.lane || null } : null,
        rated: window.__RAW_STATIC_FRAMES_RATED__ ? { hits: window.__RAW_STATIC_FRAMES_RATED__.hits, lagH: window.__RAW_STATIC_FRAMES_RATED__.lagH, last: window.__RAW_STATIC_FRAMES_RATED__.last, misses: window.__RAW_STATIC_FRAMES_RATED__.misses } : null };
    });
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${theme}-${view}.png`) }); }
    return { theme, view, ...r };
  } finally { await browser.close(); }
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const res = [];
  for (const view of VIEWS) for (const theme of THEMES) {
    try { res.push(await session(theme, view)); } catch (e) { res.push({ theme, view, error: String(e && e.stack || e).slice(0, 300) }); }
    const x = res[res.length - 1];
    console.log(`${view} ${theme} | band ${x.band} | ratedRun ${JSON.stringify(x.ratedRun)} | visible ${x.visible} | ${x.label || x.error || '(no line)'}`);
  }
  cdn.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
})();
