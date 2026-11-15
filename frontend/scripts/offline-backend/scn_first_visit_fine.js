// FIRST-VISIT FINE GRID after a scrub step (2026-11-15; the advisor + animation lane: at coastal zooms the engine draws the coarse
// world grid at once and the fine /grid only lands 1.5-4 s later). Offline only. Per ArrowRight step to an hour never visited in
// this session, in the page's clock from the keydown: every /api/weather/grid request (sent / answered), every change of what the
// marine engine draws (hour, cols x rows, series / store / decimated), and the [SCRUB-SETTLE] / [CACHE] / [Marine] log lines.
//   AB_BASE=http://127.0.0.1:<spa> PORT=4298 OUT=fine.json node scn_first_visit_fine.js
// Env: VIEW (desktop | phone), CPU (1; phone default 4), ZOOM (8), CENTER (-80.05,28.45), MODEL (GFS), STEPS (6), DWELL (5000),
// FLAGS ('{}' JSON window flags set before boot).
if (process.env.AB_LIVE === '1') throw Error('scn_first_visit_fine is offline only (never load the live box)');
const fs = require('fs');
const L = require('./ab_lib.js');

const PORT = +(process.env.PORT || 4298);
const OUT = process.env.OUT || 'first-visit-fine.json';
const VIEW = process.env.VIEW || 'desktop';
const CPU = +(process.env.CPU || (VIEW === 'phone' ? 4 : 1));
const ZOOM = +(process.env.ZOOM || 8);
const MODEL = process.env.MODEL || 'GFS';
const STEPS = +(process.env.STEPS || 6);
const DWELL = +(process.env.DWELL || 5000);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const [CLNG, CLAT] = (process.env.CENTER || '-80.05,28.45').split(',').map(Number);
const VP = {
  desktop: { width: 1280, height: 800, dpr: 1, contextOptions: {} },
  phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = () => {
  const F = (window.__FV__ = { key: null, ev: [] });
  const t = () => performance.now();
  window.addEventListener('keydown', () => { F.key = t(); F.ev = []; }, true);
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = String((u && u.url) || u);
    if (!/\/api\/weather\/grid(\?|$)/.test(url)) return of(u, o);
    const hour = (/[?&]hour(?:_offset)?=([^&]+)/.exec(url) || [])[1];
    const z = (/[?&]zoom=([^&]+)/.exec(url) || [])[1];
    const rec = { k: 'grid', sent: t(), hour, z, stack: String(new Error().stack || '').split('\n').slice(2, 6).map((x) => x.trim().slice(0, 80)) };
    F.ev.push(rec);
    return of(u, o).then((r) => { rec.done = t(); rec.status = r.status; return r; }, (e) => { rec.done = t(); rec.err = String(e && e.name); throw e; });
  };
  const ol = console.log.bind(console);
  console.log = (...a) => {
    const s = typeof a[0] === 'string' ? a[0] : '';
    if (/^\[(SCRUB-SETTLE|CACHE|Marine|Release|FETCH)\]/.test(s)) F.ev.push({ k: 'log', at: t(), s: s.slice(0, 140) });
    return ol(...a);
  };
  let last = '';
  const loop = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const sig = g ? `h${g.hourOffset} ${g.cols}x${g.rows}${g.__fromSeries ? ' series' : ''}${g.__fromFrameStore ? ' store' : ''}${g.__decimatedStride ? ' dec' + g.__decimatedStride : ''}` : 'none';
    if (sig !== last) { F.ev.push({ k: 'draw', at: t(), sig, cells: g && g.vectors ? g.vectors.length : 0 }); last = sig; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

(async () => {
  const vp = VP[VIEW];
  const { browser, page } = await L.launch({ port: PORT, width: vp.width, height: vp.height, dpr: vp.dpr, contextOptions: vp.contextOptions });
  const out = { view: VIEW, cpu: CPU, zoom: ZOOM, center: [CLNG, CLAT], model: MODEL, flags: FLAGS, at: new Date().toISOString(), steps: [] };
  try {
    await page.addInitScript(PROBE);
    await page.addInitScript((flags) => { for (const [k, v] of Object.entries(flags)) window[k] = v; }, FLAGS);
    if (CPU > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
    await page.goto(L.BASE + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 });
    await sleep(1500);
    await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), MODEL);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await page.evaluate(() => window.toggleLayer('waves'));
    await sleep(15000);
    await page.evaluate(() => {
      const body = document.getElementById('weather-mobile-timeline-body');
      if (!body || !body.inert) return;
      const h = [...document.querySelectorAll('button[aria-controls="weather-mobile-timeline-body"][aria-expanded="false"]')]
        .find((b) => b.offsetParent !== null && /Open timeline/.test(b.getAttribute('aria-label') || ''));
      if (h) h.click();
    });
    await sleep(1500);
    for (let i = 0; i < STEPS; i += 1) {
      const w = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
      await w.focus().catch(() => {});
      await page.keyboard.press('ArrowRight');
      await sleep(DWELL);
      const s = await page.evaluate(() => {
        const F = window.__FV__; const k = F.key;
        const wh = [...document.querySelectorAll('[role="slider"][aria-label*="timeline wheel"]')].find((x) => x.offsetParent !== null);
        return { target: wh ? Number(wh.getAttribute('aria-valuenow')) : null,
          ev: F.ev.map((e) => ({ ...e, sent: e.sent != null ? Math.round(e.sent - k) : undefined, done: e.done != null ? Math.round(e.done - k) : undefined, at: e.at != null ? Math.round(e.at - k) : undefined })) };
      });
      // time to fine: the first draw after the key of a NON-series, NON-decimated grid at the target hour
      const fine = s.ev.find((e) => e.k === 'draw' && new RegExp(`^h${s.target} `).test(e.sig) && !/series|dec/.test(e.sig));
      const firstDraw = s.ev.find((e) => e.k === 'draw');
      const grid = s.ev.filter((e) => e.k === 'grid');
      s.summary = { target: s.target, firstDrawMs: firstDraw ? firstDraw.at : null, firstDraw: firstDraw ? firstDraw.sig : null,
        fineMs: fine ? fine.at : null, fine: fine ? fine.sig : null, gridSentMs: grid.length ? grid[0].sent : null, gridDoneMs: grid.length ? grid[0].done : null, gridCount: grid.length };
      console.log(`step ${i + 1} -> h${s.target}: first draw ${s.summary.firstDrawMs} ms (${s.summary.firstDraw}); /grid sent ${s.summary.gridSentMs} done ${s.summary.gridDoneMs} (${grid.length}); fine ${s.summary.fineMs} ms (${s.summary.fine})`);
      out.steps.push(s);
    }
  } catch (e) { out.error = String(e && e.message || e).slice(0, 200); console.log('ERROR', out.error); }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
})();
