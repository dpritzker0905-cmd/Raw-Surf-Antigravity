// Scrub replay + A/B of the SERVER's SERIES_THIN_NODE_BOUNDS on the real client, using the app's own diagnostics:
//   __MARINE_RENDER_HOUR_PARITY__  { requestedHour, renderedDataHour, parity }      <- the owner's "rendered/requested" gaps
//   __WEBGL_MARINE_UPLOAD_COUNT__ / __WEBGL_MARINE_UPLOAD_SIG_DIFF__ { hour, bounds, vectorCount, provider }  <- every engine upload
//   engine._lastMaskEncodeMode and the WebGL texture-upload spy (ab_lib.js)         <- mask rebuilds
// PORT=4100 (flag off) | PORT=4101 (flag on)   node scn_swap_ab.js     AB_OUT=<file> writes the full timeline.
const fs = require('fs');
const L = require('./ab_lib.js');
const PORT = +(process.env.PORT || 4100);
// LAT_SERIES / LAT_GRID (ms) hold each /grid_series page / /grid reply back, to replay live-like latency (the live box answers a 48-frame world page in ~7-13 s).
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = () => {
  const e = window.__MARINE_ENGINE__; const sig = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; const par = window.__MARINE_RENDER_HOUR_PARITY__ || {};
  const hs = window.__MARINE_HEATMAP_STATUS__ || {}; const b = sig.bounds;
  const w = document.querySelector('[role="slider"][aria-label*="Forecast timeline"]');
  return {
    t: Math.round(performance.now()), up: window.__WEBGL_MARINE_UPLOAD_COUNT__ || 0, hour: sig.hour, vc: sig.vectorCount, prov: sig.provider,
    bn: b ? b.north : null, bs: b ? b.south : null, be: b ? b.east : null, bw: b ? b.west : null,
    req: par.requestedHour, ren: par.renderedDataHour, parity: par.parity, hstatus: hs.status, retained: hs.retainedPrevious,
    wheel: w ? Number(w.getAttribute('aria-valuenow')) : null, mask: e && e._lastMaskEncodeMode, big: window.__TEX__ ? window.__TEX__.big : null,
  };
};

(async () => {
  const { browser, page, log } = await L.launch({ port: PORT, hooks: { beforeWeather: async (url) => { const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
  const timeline = []; let last = ''; let stop = false;
  const sampler = (async () => {
    while (!stop) {
      let s = null; try { s = await page.evaluate(read); } catch (e) { /* navigating */ }
      if (s) {
        const sig = [s.up, s.req, s.ren, s.parity, s.wheel, s.hstatus].join('|');
        if (sig !== last) { timeline.push({ ...s, wall: Date.now() - log.t0 }); last = sig; }
      }
      await sleep(100);
    }
  })();
  const marks = [];
  const mark = (name) => marks.push({ name, wall: Date.now() - log.t0 });
  const press = async (key, n = 1, gap = 300) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(gap); } };
  try {
    await L.openMap(page);
    await L.jump(page, -108, 16, 2.6); mark('camera');
    await L.clickText(page, 'Waves'); mark('waves-on');
    await sleep(14000);                                        // activation settles
    await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
    const jumps = [['PageUp', 1], ['PageUp', 2], ['Home', 1], ['PageUp', 6], ['PageUp', 6], ['Home', 1]];
    for (const [key, n] of jumps) { mark(`${key}x${n}`); await press(key, n); await sleep(16000); }
    stop = true; await sampler;

    // per-jump: how long until the rendered hour equals the requested hour, and what was uploaded meanwhile
    const per = marks.filter((m) => /^(PageUp|Home)/.test(m.name)).map((m, i, all) => {
      const end = i + 1 < all.length ? all[i + 1].wall : Infinity;
      const win = timeline.filter((s) => s.wall >= m.wall && s.wall < end);
      const target = win.length ? win[win.length - 1].req : null;
      const reached = win.find((s) => s.req === target && s.parity === true);
      const uploads = win.length ? win[win.length - 1].up - (timeline.filter((s) => s.wall < m.wall).slice(-1)[0] || { up: 0 }).up : 0;
      const bigs = win.length ? (win[win.length - 1].big || 0) - ((timeline.filter((s) => s.wall < m.wall).slice(-1)[0] || { big: 0 }).big || 0) : 0;
      return { jump: m.name, requestedHour: target, parityAfterMs: reached ? reached.wall - m.wall : null, uploads, bigTextureUploads: bigs,
               uploadDims: [...new Set(win.filter((s) => s.vc).map((s) => `${s.vc}v@n${s.bn}`))] };
    });
    const dimsSeen = [...new Set(timeline.filter((s) => s.vc).map((s) => `${s.vc}v@n${s.bn}`))];
    const summary = {
      port: PORT, uploads: timeline.length ? timeline[timeline.length - 1].up : 0, dimsSeen,
      thinnedUploads: timeline.filter((s) => s.vc && s.vc < 3000).length, exactUploads: timeline.filter((s) => s.vc && s.vc >= 10000).length,
      maskModes: timeline.reduce((a, s) => { a[s.mask] = (a[s.mask] || 0) + 1; return a; }, {}),
      bigTextureUploadsTotal: timeline.length ? timeline[timeline.length - 1].big : 0,
      gridRequests: log.requests.filter((r) => r.path === '/grid').length, seriesRequests: log.requests.filter((r) => r.path === '/grid_series').length,
      errors: log.errors.length, blockedWs: log.blockedWs.length, per,
    };
    console.log(JSON.stringify(summary, null, 1));
    if (process.env.AB_OUT) fs.writeFileSync(process.env.AB_OUT, JSON.stringify({ summary, marks, timeline, requests: log.requests.map((r) => ({ t: r.t, ms: r.ms, path: r.path, vt: r.q && r.q.valid_time, hours: r.q && r.q.hours ? r.q.hours.split(',').length : undefined, first: r.q && r.q.hours ? r.q.hours.split(',')[0] : undefined, status: r.status })) }, null, 1));
  } finally { stop = true; await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
