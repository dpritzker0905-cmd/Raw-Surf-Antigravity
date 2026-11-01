// Wave-set A/B recorder (2026-10-20, proportional wave sets): the SAME view on two local builds, recorded as video for the owner to
// watch side by side, plus rAF frame times over the recorded window. Offline only (serve_synthetic.py): nothing reaches the live backend.
//   PORT=4113 A=http://127.0.0.1:3171 B=http://127.0.0.1:3172 OUT=ab-out node scripts/visual-lab/wave_sets_ab.js
// VIEWS = semicolon list of lng,lat,zoom (default: the synthetic vortex off Mexico, whose period runs ~17 s at the core to ~8 s at the
// rim, at z5 and z8 — where #397's per-period bound inverted the band speed). RECORD = seconds per view, SETTLE = ms before recording.
const fs = require('fs');
const path = require('path');
const L = require('../offline-backend/ab_lib.js');

const PORT = +(process.env.PORT || 4113);
const ARMS = [['A', process.env.A || 'http://127.0.0.1:3171'], ['B', process.env.B || 'http://127.0.0.1:3172']];
const OUT = path.resolve(process.env.OUT || 'ab-out');
const VIEWS = (process.env.VIEWS || '-106,14,5;-103.5,15.5,8').split(';').map((v) => v.split(',').map(Number));
const RECORD = +(process.env.RECORD || 20), SETTLE = +(process.env.SETTLE || 12000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FRAMES = (ms) => new Promise((resolve) => {   // rAF intervals over ms
  const d = []; let last = performance.now(); const end = last + ms;
  const tick = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(d); };
  requestAnimationFrame(tick);
});
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = [];
  for (const [vi, [lng, lat, zoom]] of VIEWS.entries()) {
    for (const [arm, base] of ARMS) {
      const dir = path.join(OUT, `v${vi}-${arm}`); fs.mkdirSync(dir, { recursive: true });
      const { browser, ctx, page, log } = await L.launch({ port: PORT, video: dir });
      const t0 = Date.now();
      try {
        await page.goto(base + '/map', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 90000 });
        await sleep(1500);
        await L.jump(page, lng, lat, zoom);
        const on = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent || '').trim() === 'Waves'));
        if (!on) await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
        await sleep(SETTLE);
        const startS = (Date.now() - t0) / 1000;
        const d = await page.evaluate(FRAMES, RECORD * 1000);
        const kills = await page.evaluate(() => ({ prop: window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__ === true, bound: window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ === true }));
        const row = { view: vi, lng, lat, zoom, arm, base, startS: +startS.toFixed(2), frames: d.length, p50: pct(d, 0.5), p95: pct(d, 0.95), max: +Math.max(...d).toFixed(1),
          kills, hosts: Object.keys(log.hosts), blockedWs: log.blockedWs.length, errors: log.errors.length };
        summary.push(row); console.log(JSON.stringify(row));
        await page.screenshot({ path: path.join(OUT, `v${vi}-${arm}.png`) });
      } finally {
        const v = page.video(); await ctx.close();
        if (v) fs.renameSync(await v.path(), path.join(OUT, `v${vi}-${arm}.webm`));
        await browser.close();
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
})();
