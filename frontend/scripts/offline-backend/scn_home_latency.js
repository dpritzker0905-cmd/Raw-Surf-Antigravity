// After a far scrub and "Home" under live-like latency, is the SCREEN back at hour 0, or only the diagnostics' story?
// Screenshots at hour 0, at +72, and after Home (twice); image-difference fractions tell which frame is on screen.
const L = require('./ab_lib.js');
const path = require('path');
const { diffFraction } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAT_SERIES = +(process.env.LAT_SERIES || 8000); const LAT_GRID = +(process.env.LAT_GRID || 3000);
(async () => {
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4100), hooks: { beforeWeather: async (url) => { const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
  const par = () => page.evaluate(() => { const e = window.__MARINE_ENGINE__; const p = window.__MARINE_RENDER_HOUR_PARITY__ || {}; const h = window.__MARINE_HEATMAP_STATUS__ || {}; const q = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; const to = (v) => String(v).split('->').pop().trim(); return `req ${p.requestedHour} ren ${p.renderedDataHour} ${p.parity} ${h.status || ''} | last upload: hour ${to(q.hour)} vc ${to(q.vectorCount)} hash ${to(q.contentHash)} uploads ${window.__WEBGL_MARINE_UPLOAD_COUNT__} | engine grid hourOffset ${e && e._waveData && e._waveData.waveGrid && e._waveData.waveGrid.hourOffset} truthTag ${e && e._waveData && e._waveData.truthTag && (e._waveData.truthTag.valid_time + ' off ' + e._waveData.truthTag.timeOffsetHours)}`; });
  const info = async () => page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const c = m.getContainer().getBoundingClientRect(); return { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) }; });
  const settle = []; const t00 = Date.now();
  page.on('console', (m) => { const x = m.text(); if (/SCRUB-SETTLE|Abort-Gate|Post-scrub/.test(x)) settle.push(((Date.now() - t00) / 1000).toFixed(1) + 's ' + x.slice(0, 190)); });
  try {
    await L.openMap(page); await L.jump(page, -108, 16, 2.6); await L.clickText(page, 'Waves'); await sleep(16000);
    const clip = await info(); const shot = async () => { await sleep(800); return page.screenshot({ clip }); };
    const S0 = await shot(); console.log('hour 0   :', await par());
    await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
    for (let i = 0; i < 3; i++) { await page.keyboard.press('PageUp'); await sleep(300); }
    let waited = 0; while (waited < 30000 && !(await par()).includes('true')) { await sleep(500); waited += 500; }
    const S72 = await shot(); console.log('hour +72 :', await par(), `(waited ${waited} ms for parity)`);
    await page.keyboard.press('Home'); await sleep(800);
    console.log('Home +0.8s:', await par());
    console.log('BADGE @ +0.8s:', JSON.stringify(await page.evaluate(() => [...new Set((document.body.innerText || '').split(String.fromCharCode(10)).map((x) => x.trim()).filter((x) => /stale|retained|updating|latest|not yet/i.test(x)))].slice(0, 8))));
    const SH = await shot(); await sleep(14000); const SH2 = await shot(); console.log('Home +15s :', await par());
    console.log('VISIBLE TEXT matching stale/retained/updating:', JSON.stringify(await page.evaluate(() => [...new Set((document.body.innerText || '').split(String.fromCharCode(10)).map((x) => x.trim()).filter((x) => /stale|retained|updating|latest|not yet/i.test(x)))].slice(0, 8))));
    console.log('SETTLE/ABORT-GATE log lines:'); settle.forEach((l) => console.log('  ' + l));
    const f = (a, b) => (+diffFraction(a, b)).toFixed(4);
    console.log(`image diff  hour0 vs +72: ${f(S0, S72)} | hour0 vs afterHome(+1s): ${f(S0, SH)} | +72 vs afterHome(+1s): ${f(S72, SH)} | afterHome +1s vs +15s: ${f(SH, SH2)} | hour0 vs afterHome(+15s): ${f(S0, SH2)}`);
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
