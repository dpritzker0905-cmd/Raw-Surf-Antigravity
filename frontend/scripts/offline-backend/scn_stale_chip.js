// THE STALE-LAYER CHIP on the collapsed phone header (2026-11-16; gate: log 2026-11-15-claude-rating-band-sota.md section 12).
// Offline only. CDN_DIR with the rated regional bundles ONE RUN behind their plain siblings (the live CDN's state), the band ON over
// Florida z8.5. Per (width, theme): the collapsed phone view (layers sheet closed, timeline drawer collapsed), then the drawer opened,
// then desktop once per theme. Reads in the page: the chip's presence, visibility, accessible name, computed colours, its rectangle
// against the viewport and against every other visible control in the drawer (overlap = any intersection); screenshots of the drawer.
//   AB_BASE=http://127.0.0.1:3112 PORT=4151 CDN_DIR=<cdn> SHOTS=<dir> OUT=<json> node scn_stale_chip.js
// Env: WIDTHS (360,390,430), THEMES (light,dark,beach), KILL (1: set __RAW_DISABLE_STALE_CHIP__), DESKTOP (1), CDN_PORT (4394), SETTLE (12000).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_stale_chip is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4394);
const WIDTHS = (process.env.WIDTHS || '360,390,430').split(',').map(Number);
const THEMES = (process.env.THEMES || 'light,dark,beach').split(',');
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

function probe() {
  const shown = (x) => x && (x.checkVisibility ? x.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : x.offsetParent !== null)
    && x.getBoundingClientRect().width > 0;
  const chip = [...document.querySelectorAll('[data-stale-chip]')].find(shown) || null;
  const drawer = document.querySelector('[data-weather-timeline="mobile"]');
  const out = { chip: !!chip, kind: chip && chip.getAttribute('data-stale-chip'), name: chip && chip.getAttribute('aria-label'),
    text: chip && chip.textContent, color: chip && getComputedStyle(chip).color, overlaps: [], clipped: false, rect: null,
    // why a chip is absent: the band and the painted grid's run age (staleLayerState reads the same two)
    allChips: [...document.querySelectorAll('[data-stale-chip]')].map((x) => ({ vis: shown(x), rect: [...Object.values(x.getBoundingClientRect().toJSON())].map(Math.round), inHeader: !!x.closest('[data-weather-timeline]'), disp: getComputedStyle(x.closest('[data-weather-timeline]') || x).display })),
    headers: document.querySelectorAll('.weather-compact-timeline-header').length,
    collapsedAttr: (document.querySelector('[data-weather-timeline="mobile"]') || {}).getAttribute ? document.querySelector('[data-weather-timeline="mobile"]').getAttribute('data-timeline-collapsed') : null,
    band: !!(window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand && window.__RAW_GPU__.ratingBand.active),
    heldBy: (window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade && window.__RAW_GPU__.ratingBandFade.heldBy) || null,
    ratedRun: (() => { const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; return g ? (g.ratedRun || null) : 'no grid'; })() };
  if (!chip) return out;
  const r = chip.getBoundingClientRect();
  out.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  out.clipped = r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight || chip.scrollWidth > chip.clientWidth + 1;
  const others = [...(drawer || document).querySelectorAll('button, a, [role="slider"], [role="status"]')].filter((x) => x !== chip && !chip.contains(x) && shown(x));
  for (const o of others) {
    const q = o.getBoundingClientRect();
    if (r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom) out.overlaps.push((o.getAttribute('aria-label') || o.textContent || o.tagName).trim().slice(0, 40));
  }
  return out;
}

async function session(theme, width, view) {
  const phone = view !== 'desktop';
  const opts = phone ? { width, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } } : { width: 1280, height: 800, dpr: 1 };
  const { browser, page } = await L.launch({ port: PORT, ...opts });
  try {
    await page.addInitScript(({ base, theme, kill }) => {
      localStorage.setItem('raw-surf-theme', theme); localStorage.setItem('__SURF_MODE__', 'true');
      window.__RAW_STATIC_FRAMES_BASE__ = base; if (kill) window.__RAW_DISABLE_STALE_CHIP__ = true;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme, kill: process.env.KILL === '1' });
    await L.openMap(page);
    await L.jump(page, -80.3, 28.4, 8.5);
    await sleep(1500);
    if (phone) { await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); await sleep(800); }
    await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
    if (phone) { await sleep(500); await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); }
    await sleep(SETTLE);
    if (view === 'scrub') {   // the advisor's #978 check: the chip must not flicker or move the header while scrubbing (gate 5 in motion)
      const scrub = await page.evaluate(async ({ steps, cadence }) => {
        const out = { mounts: 0, unmounts: 0, heights: [], chipAtStart: !!document.querySelector('[data-stale-chip]'), stepsDone: 0, laggedFrames: 0, frames: 0 };
        const panel = document.querySelector('[data-weather-timeline="mobile"] > div');
        const mo = new MutationObserver((ms) => { for (const m of ms) {
          for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('[data-stale-chip], .weather-stale-chip-row') || n.querySelector('[data-stale-chip]'))) out.mounts += 1;
          for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches('[data-stale-chip], .weather-stale-chip-row') || n.querySelector('[data-stale-chip]'))) out.unmounts += 1; } });
        mo.observe(document.body, { childList: true, subtree: true });
        let lastH = panel ? Math.round(panel.getBoundingClientRect().height) : null;
        const ro = panel ? new ResizeObserver(() => { const h = Math.round(panel.getBoundingClientRect().height); if (h !== lastH) { out.heights.push([lastH, h]); lastH = h; } }) : null;
        if (ro) ro.observe(panel);
        const wheel = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/i.test(x.getAttribute('aria-label') || ''));
        const sample = () => { const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; out.frames += 1; if (g && g.ratedRun && g.ratedRun.lagH > 0) out.laggedFrames += 1; };
        for (let i = 0; i < steps; i++) {
          if (wheel) { wheel.focus(); for (let k = 0; k < 3; k++) wheel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); out.stepsDone += 1; }
          await new Promise((r) => setTimeout(r, cadence)); sample();
        }
        await new Promise((r) => setTimeout(r, 2500));
        mo.disconnect(); if (ro) ro.disconnect();
        out.wheelFound = !!wheel; out.chipAtEnd = !!document.querySelector('[data-stale-chip]');
        return out;
      }, { steps: +(process.env.SCRUB_STEPS || 20), cadence: +(process.env.SCRUB_MS || 400) });
      return { view, theme, width, scrub };
    }
    if (view === 'drawer_open') {
      await page.locator('.weather-compact-timeline-header button.weather-drawer-time').filter({ visible: true }).first().click({ timeout: 3000 }).catch(() => {});
      await sleep(1500);
    }
    await sleep(1200);   // longer than the chip's 500 ms poll, so a grid committed just before the probe is on the chip
    const r = await page.evaluate(probe);
    // GATE 2 / 4 as one rule: a chip exactly when the painted grid lags (band painted, not held, ratedRun.lagH > 0)
    r.shouldShow = !!(r.band && !(r.heldBy && r.heldBy !== 'off') && r.ratedRun && typeof r.ratedRun === 'object' && r.ratedRun.lagH > 0);
    r.consistent = view === 'collapsed' ? r.shouldShow === r.chip : !r.chip;
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const drawer = page.locator('[data-weather-timeline="mobile"]').first();
      const file = path.join(SHOTS, `${view}-${theme}-${phone ? width : 1280}.png`);
      if (phone && await drawer.isVisible().catch(() => false)) await drawer.screenshot({ path: file }); else await page.screenshot({ path: file });
    }
    return { view, theme, width: phone ? width : 1280, ...r };
  } finally { await browser.close(); }
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const res = [];
  const runs = [];
  for (const theme of THEMES) {
    for (const w of WIDTHS) runs.push([theme, w, 'collapsed']);
    runs.push([theme, 390, 'drawer_open']);
    if (process.env.DESKTOP !== '0') runs.push([theme, 1280, 'desktop']);
  }
  if (process.env.SCRUB === '1') { runs.length = 0; for (const theme of THEMES) for (const w of WIDTHS) runs.push([theme, w, 'scrub']); }
  for (const [theme, w, view] of runs) {
    try { res.push(await session(theme, w, view)); } catch (e) { res.push({ view, theme, width: w, error: String(e && e.stack || e).slice(0, 300) }); }
    const x = res[res.length - 1];
    if (x.scrub) { console.log(`scrub ${theme} ${x.width} | ${JSON.stringify(x.scrub)}`); continue; }
    console.log(`${view} ${theme} ${x.width} | band ${x.band} held ${x.heldBy} run ${JSON.stringify(x.ratedRun)} | all ${JSON.stringify(x.allChips)} headers ${x.headers} collapsed ${x.collapsedAttr} | should ${x.shouldShow} chip ${x.chip} CONSISTENT ${x.consistent} ${x.text || ''} | clipped ${x.clipped} | overlaps ${JSON.stringify(x.overlaps || [])} | ${x.color || ''}${x.error ? ' | ERROR ' + x.error.slice(0, 120) : ''}`);
  }
  cdn.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
})();
