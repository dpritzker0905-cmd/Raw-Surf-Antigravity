// ICON far hours: switch to ICON, scrub into the ESTIMATED range (native ends at hour 168) and back, under live-like latency
// (LAT_SERIES / LAT_GRID ms, defaults 8000 / 3000). Per step: time to render-hour parity, the last upload's provider and hour, the
// layer's own drop record, and what the ENGINE holds (grid hourOffset, truth tag), plus the settle / abort-gate console lines.
const L = require('./ab_lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAT_SERIES = +(process.env.LAT_SERIES ?? 8000); const LAT_GRID = +(process.env.LAT_GRID ?? 3000);
const WINDOW_MS = +(process.env.WINDOW_MS || 24000);
(async () => {
  const { browser, page, log } = await L.launch({ port: +(process.env.PORT || 4100), hooks: { beforeWeather: async (url) => { const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
  const lines = []; const t00 = Date.now();
  page.on('console', (m) => { const x = m.text(); if (/SCRUB-SETTLE|Abort-Gate|SWELL2_DROP|not whitelisted|provider/i.test(x)) lines.push(((Date.now() - t00) / 1000).toFixed(1) + 's ' + x.slice(0, 170)); });
  const snap = () => page.evaluate(() => {
    const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; const tt = e && e._waveData && e._waveData.truthTag;
    const p = window.__MARINE_RENDER_HOUR_PARITY__ || {}; const q = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; const to = (v) => String(v).split('->').pop().trim();
    const d = window.__SWELL2_LAST_DROP__;
    const w = document.querySelector('[role="slider"][aria-label*="Forecast timeline"]');
    return { wheel: w && w.getAttribute('aria-valuenow'), par: `req ${p.requestedHour} ren ${p.renderedDataHour} ${p.parity} ${p.reason || ''}`, up: `hour ${to(q.hour)} prov ${to(q.provider)} vc ${to(q.vectorCount)} #${window.__WEBGL_MARINE_UPLOAD_COUNT__}`,
      engine: g ? `hourOffset ${g.hourOffset} ${(tt && tt.valid_time) || ''} prov ${g.__gridProvider || (tt && tt.provider) || ''}` : 'none', drop: d ? `${d.reason} ${d.gridProvider}/${d.componentLayer}` : null, ok: p.parity === true };
  });
  const step = async (name, action) => {
    await action(); const t0 = Date.now(); let s = await snap();
    while (!s.ok && Date.now() - t0 < WINDOW_MS) { await sleep(400); s = await snap(); }
    console.log(`${name.padEnd(16)} ${s.ok ? 'parity after ' + String(Date.now() - t0).padStart(5) + ' ms' : 'NO parity in ' + WINDOW_MS + ' ms'} | wheel ${s.wheel} | ${s.par} | upload ${s.up} | engine ${s.engine} | drop ${s.drop}`);
  };
  try {
    await L.openMap(page); await L.jump(page, -108, 16, 3); await L.clickText(page, 'Waves'); await sleep(14000);
    await step('GFS activation', async () => {});
    await step('click ICON', async () => { await L.clickText(page, 'ICON'); });
    await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
    for (let i = 0; i < 4; i++) await page.keyboard.press('PageUp');
    await step('+96 (native)', async () => {});
    for (let i = 0; i < 4; i++) await page.keyboard.press('PageUp');
    await step('+192 (estimated)', async () => {});
    for (let i = 0; i < 4; i++) await page.keyboard.press('PageUp');
    await step('+288 (estimated)', async () => {});
    await step('Home', async () => { await page.keyboard.press('Home'); });
    for (let i = 0; i < 12; i++) await page.keyboard.press('PageUp');
    await step('+288 again', async () => {});
    console.log('console lines:'); lines.slice(0, 25).forEach((l) => console.log('  ' + l));
    console.log('hosts', JSON.stringify(log.hosts), 'blockedWs', log.blockedWs.length, 'errors', log.errors.length);
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
