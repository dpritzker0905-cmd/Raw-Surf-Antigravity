// THE RATING BAND UNDER ZOOM AND PAN (2026-11-15, the owner on the dev site: "while zooming in and out, the heatmap colours in some
// areas CHANGED, then corrected themselves"; "sometimes the band did not appear at all, or was slow"; "panning is slow to cover the
// next tile"). Offline only: the built client over serve_synthetic.py (+ the publisher's frames as the CDN). Nothing reaches Render.
//
// One fresh browser per arm, Surf Rating ON, Waves, a Florida view. A per-frame in-page sampler records every frame on which the
// resident grid (identity, dims, hour, source) or the band's opacity (ratingBandFade.bandMult) changes, and at each such frame the
// band's score at fixed coastal PROBES (bilinear over the resident grid's rated cells, renormalised over valid cells the way the
// shader's land-aware sampler is). Real wheel and drag input (jumpTo leaves the engine telemetry stale: ratingband-gesture-probe.js).
// Steps: settle -> wheel out 1.5 zoom -> settle -> wheel in 2.5 -> settle -> drag east -> settle -> drag north -> settle.
//
// VERDICTS per arm (written to OUT, printed):
//   flash      a frame where the band is VISIBLE (bandMult >= 0.5) at a probe with a score that differs by >= FLASH_PTS from the
//              score that probe settles to at the end of the same step (same hour): the owner's "changed, then corrected".
//   firstPaint ms from Surf Rating ON (page ready + Waves) to the first frame with the band visible over the view.
//   panCover   ms from the end of each drag to the first frame whose rated resident covers the view with the band visible.
// Usage:
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves,wind \
//          --regions florida_east_coast,us_southeast_midatlantic --dynamic 1 --horizon 48 --port 4151
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3106
//   AB_BASE=http://127.0.0.1:3106 PORT=4151 CDN_DIR=<cdn> ARMS=fix,nofix OUT=<json> node frontend/scripts/offline-backend/scn_band_zoom_stability.js
// Env: ARMS (comma list; an arm is `name` or `name:__LEVER_A__,__LEVER_B__` whose levers are set to true before load),
//      THEME (dark), VIEW (desktop|phone), SETTLE (9000), FLASH_PTS (10), SHOTS (dir), CDN_PORT (4372).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_band_zoom_stability is offline only');
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4372);
const SETTLE = +(process.env.SETTLE || 9000);
const FLASH_PTS = +(process.env.FLASH_PTS || 10);
const THEME = process.env.THEME || 'dark';
const VIEW = process.env.VIEW || 'desktop';
const SHOTS = process.env.SHOTS || '';
const ARMS = (process.env.ARMS || 'fix,nofix').split(';').join(',').split(',').filter(Boolean);
if (!CDN_DIR && !process.env.RESCORE) throw Error('CDN_DIR=<the publisher out-dir> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = (process.env.START || '-80.45,28.2,8.0').split(',').map(Number);
// Probes ~0.1 deg off the Florida east coast (inside the rated coastal band), Daytona -> Jupiter.
const PROBES = [[-80.95, 29.2], [-80.52, 28.6], [-80.48, 28.1], [-80.33, 27.6], [-80.1, 26.9]];
// An arm's levers: everything after ':' (comma list of window flags set to true). The `nofix` default kills this lane's fixes.
const NOFIX = ['__RAW_DISABLE_RATED_MOSAIC__', '__RAW_DISABLE_RATED_PREFETCH__', '__RAW_DISABLE_COARSE_RATED_CACHE_SKIP__'];
function armLevers(spec) {
  const [name, rest] = spec.split(':');
  if (rest) return { name, levers: rest.split('+').filter(Boolean) };
  return { name, levers: name === 'nofix' ? NOFIX : [] };
}

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

// In-page: install a per-frame sampler. Each record = one frame where the resident grid or the band's opacity changed.
function installSampler(probes) {
  const W = window;
  W.__BZS__ = { recs: [], mark: 'start', moves: [] };
  try { const mm = W.__MAP_INSTANCE__ || W.map; ['movestart', 'moveend', 'idle'].forEach((ev) => mm.on(ev, () => W.__BZS__.moves.push([ev, Math.round(performance.now()), W.__BZS__.mark]))); } catch (e) { /* diagnostics only */ }
  let lastKey = null;
  function scoreAt(g, lng, lat) {
    const vs = g.vectors; const b = g.bounds; const C = g.cols; const R = g.rows;
    if (!vs || !b || !C || !R || vs.length < C * R) return null;
    const span = b.east >= b.west ? b.east - b.west : b.east + 360 - b.west;
    let x = lng - b.west; if (x < 0) x += 360;
    const fx = (x / span) * (C - 1);
    const northFirst = vs[0] && vs[C * (R - 1)] && typeof vs[0].lat === 'number' ? vs[0].lat > vs[C * (R - 1)].lat : true;
    const fyS = ((lat - b.south) / (b.north - b.south)) * (R - 1);
    const fy = northFirst ? (R - 1) - fyS : fyS;
    if (fx < 0 || fy < 0 || fx > C - 1 || fy > R - 1) return null;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
    let acc = 0; let wsum = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const xi = Math.min(C - 1, x0 + dx); const yi = Math.min(R - 1, y0 + dy);
      const v = vs[yi * C + xi];
      if (!v || v.is_valid === false || v.isOcean === false || !(v.speed > 0)) continue;
      acc += w * v.speed * 10; wsum += w;
    }
    return wsum > 1e-6 ? Math.round((acc / wsum) * 10) / 10 : null;
  }
  function tick() {
    try {
      const e = W.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
      const rf = W.__RAW_GPU__ && W.__RAW_GPU__.ratingBandFade;
      const bandMult = rf && typeof rf.bandMult === 'number' ? Math.round(rf.bandMult * 100) / 100 : null;
      const id = g ? `${g.cols}x${g.rows}|${g.hourOffset}|${g.__servedProductId || g.productId || ''}|${!!g.ratingMode}|${!!g.__fromSeries}|${g.bounds && g.bounds.west}` : 'none';
      const m0 = W.__MAP_INSTANCE__ || W.map; const b0 = m0.getBounds(); const gb0 = g && g.bounds;
      const cov0 = gb0 ? (gb0.west <= b0.getWest() + 1e-6 && gb0.east >= b0.getEast() - 1e-6 && gb0.south <= b0.getSouth() + 1e-6 && gb0.north >= b0.getNorth() - 1e-6) : false;
      const key = id + '|' + bandMult + '|' + cov0 + '|' + W.__BZS__.mark;
      if (key !== lastKey) {
        lastKey = key;
        const m = W.__MAP_INSTANCE__ || W.map; const vb = m.getBounds();
        const gb = g && g.bounds;
        const covers = gb ? (gb.west <= vb.getWest() + 1e-6 && gb.east >= vb.getEast() - 1e-6 && gb.south <= vb.getSouth() + 1e-6 && gb.north >= vb.getNorth() - 1e-6) : false;
        W.__BZS__.recs.push({ t: Math.round(performance.now()), mark: W.__BZS__.mark, zoom: +m.getZoom().toFixed(2), id, bandMult,
          heldBy: rf ? rf.heldBy : null, cellDeg: rf ? rf.cellDeg : null, rating: g ? !!g.ratingMode : false, series: g ? !!g.__fromSeries : false,
          hour: g ? g.hourOffset : null, run: (e._waveData && e._waveData.truthTag && e._waveData.truthTag.run_time) || (g && (g.run_time || g.runTime)) || null,
          valid: (e._waveData && e._waveData.truthTag && e._waveData.truthTag.valid_time) || (g && g.valid_time) || null,
          covers, probes: g && g.ratingMode ? probes.map(([lng, lat]) => scoreAt(g, lng, lat)) : probes.map(() => null) });
      }
    } catch (err) { W.__BZS__.err = String(err).slice(0, 200); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function wheel(page, dz) {
  if (VIEW === 'phone') { await page.evaluate((d) => { const m = window.__MAP_INSTANCE__ || window.map; m.easeTo({ zoom: m.getZoom() + d, duration: 500 }); }, dz); await sleep(520); return; }   // touch: an animated zoom
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  const steps = Math.round(Math.abs(dz) * 4);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dz > 0 ? -120 : 120); await sleep(60); }
}
async function drag(page, dx, dy) {
  // An animated panBy (300 ms): a real gesture's move events. Playwright's synthetic mouse drag never ended MapLibre's drag here (no moveend
  // until the next gesture), which made every pan look 4-9 s slow. Kept as the fallback with DRAG=mouse.
  if (process.env.DRAG !== 'mouse') { await page.evaluate(([x, y]) => (window.__MAP_INSTANCE__ || window.map).panBy([-x, -y], { duration: 300 }), [dx, dy]); await sleep(320); return; }
  const vp = page.viewportSize();
  const x = vp.width / 2; const y = vp.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12); await sleep(16); }
  await page.mouse.up();
}

async function session(spec) {
  const { name, levers } = armLevers(spec);
  const size = VIEW === 'phone' ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } }
    : { width: 1280, height: 800, dpr: 1 };
  const { browser, page, log } = await L.launch({ port: PORT, ...size });
  const out = { arm: name, levers, theme: THEME, view: VIEW, steps: [], con: [] };
  if (process.env.LOGCON) page.on('console', (m) => { const t = m.text(); if (!/rating-band\] PAINTING|WEATHER_TRUTH|FORENSIC-SNAP/.test(t)) out.con.push(Date.now() + ' ' + t.slice(0, 220)); });
  try {
    await page.addInitScript(({ base, levers, theme }) => {
      localStorage.setItem('raw-surf-theme', theme);
      localStorage.removeItem('__RAW_STATIC_FRAMES__');
      window.__RAW_STATIC_FRAMES_BASE__ = base;
      window.__SURF_MODE__ = true;
      for (const k of levers) window[k] = true;
    }, { base: `http://127.0.0.1:${CDN_PORT}/`, levers, theme: THEME });
    await L.openMap(page);
    await L.jump(page, START[0], START[1], START[2]);
    await page.evaluate(installSampler, PROBES);
    const t0 = await page.evaluate(() => { window.__BZS__.mark = 'load'; return performance.now(); });
    if (VIEW === 'phone') {                                    // the mobile collapsed float: open the sheet (scn_band_toggle.js), pick Waves, close it
      const ex = page.locator('[aria-label="Weather layers"]').first();
      await ex.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await ex.evaluate((el) => el.click()).catch(() => {});
      await sleep(1000);
    }
    await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().evaluate((el) => el.click());
    if (VIEW === 'phone') { await sleep(500); await page.locator('[aria-label="Weather layers"]').first().evaluate((el) => el.click()).catch(() => {}); }
    out.t0 = Math.round(t0);
    const plan = [['load', null], ['zoom_out', () => wheel(page, -1.5)], ['zoom_in', () => wheel(page, 2.5)],
      ['pan_east', () => drag(page, -Math.round(size.width * 0.6), 0)], ['pan_north', () => drag(page, 0, Math.round(size.height * 0.6))],
      ['pan_small', () => drag(page, -Math.round(size.width * 0.3), Math.round(size.height * 0.2))]];
    for (const [mark, act] of plan) {
      const tAct = await page.evaluate((mk) => { window.__BZS__.mark = mk; return performance.now(); }, mark);
      if (act) await act();
      const tEnd = await page.evaluate(() => performance.now());
      await sleep(SETTLE);
      out.steps.push({ mark, tAct: Math.round(tAct), tEnd: Math.round(tEnd) });
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}-${THEME}-${VIEW}-${mark}.png`) }); }
    }
    const bz = await page.evaluate(() => window.__BZS__);
    out.recs = bz.recs; out.samplerErr = bz.err || null; out.moves = bz.moves;
    out.rated = await page.evaluate(() => JSON.parse(JSON.stringify({ rated: window.__RAW_STATIC_FRAMES_RATED__ || null, regional: window.__RAW_STATIC_REGIONAL__ || null, pin: (window.__RAW_STATIC_FRAMES__ || {}).pin || null })));
    out.ring = await page.evaluate(() => { try { return { ring: ((window.__RAW_FORENSIC__.dump() || {}).events || []).slice(-80), cache: window.__MARINE_CACHE_DIAG__ ? { counts: window.__MARINE_CACHE_DIAG__.counts, log: window.__MARINE_CACHE_DIAG__.log.slice(0, 20) } : null, now: Date.now(), perf: performance.now() }; } catch (e) { return String(e); } });
    out.forensic = await page.evaluate(() => (window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.summary ? window.__RAW_FORENSIC__.summary() : null));
    out.asks = log.requests.filter((r) => r.q && (r.q.surf === '1' || r.q.surf === 'true')).map((r) => ({ t: r.t, ms: r.ms, p: r.path, bbox: r.q.bbox, hour: r.q.hour || r.q.hours, status: r.status }));
    out.errors = log.errors.slice(0, 4);
  } finally { await browser.close(); }
  return out;
}

// The verdicts, computed from the records alone (so a saved OUT can be re-scored).
function score(run) {
  const flashes = []; const panCover = []; let firstPaint = null;
  for (const st of run.steps || []) {
    const recs = (run.recs || []).filter((r) => r.mark === st.mark);
    if (!recs.length) continue;
    const final = recs[recs.length - 1];
    for (const r of recs) {
      if (!(r.bandMult >= 0.5) || !r.rating) continue;
      r.probes.forEach((s, i) => {
        const f = final.probes[i];
        if (typeof s === 'number' && typeof f === 'number' && final.hour === r.hour && final.bandMult >= 0.5 && Math.abs(s - f) >= FLASH_PTS) {
          flashes.push({ step: st.mark, t: r.t - st.tAct, probe: i, shown: s, settled: f, id: r.id, finalId: final.id, series: r.series, cellDeg: r.cellDeg });
        }
      });
    }
    const vis = recs.find((r) => r.bandMult >= 0.5 && r.rating && r.covers);
    if (st.mark === 'load') firstPaint = vis ? vis.t - st.tAct : null;
    if (st.mark.startsWith('pan')) {
      const me = (run.moves || []).filter((x) => x[0] === 'moveend' && x[2] === st.mark).pop();
      const lost = recs.find((r) => !(r.bandMult >= 0.5 && r.rating && r.covers));
      const back = lost ? recs.find((r) => r.t > lost.t && r.bandMult >= 0.5 && r.rating && r.covers) : null;
      panCover.push({ step: st.mark, gapMs: lost ? (back ? back.t - lost.t : null) : 0, fromMoveend: me && back ? back.t - me[1] : null });
    }
  }
  const bandAtEnd = (run.steps || []).map((st) => { const rs = (run.recs || []).filter((r) => r.mark === st.mark); const l = rs[rs.length - 1]; return { step: st.mark, visible: !!(l && l.bandMult >= 0.5 && l.rating), covers: !!(l && l.covers), heldBy: l ? l.heldBy : null, cellDeg: l ? l.cellDeg : null }; });
  return { arm: run.arm, bandAtEnd, flashes: flashes.length, flashProbeSteps: [...new Set(flashes.map((f) => `${f.step}:${f.probe}`))].length, firstPaint, panCover, sample: flashes.slice(0, 6) };
}

if (require.main === module) {
  (async () => {
    if (process.env.RESCORE) {
      for (const r of JSON.parse(fs.readFileSync(process.env.RESCORE, 'utf8'))) console.log(JSON.stringify(score(r)));
      return;
    }
    await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
    const res = [];
    for (const spec of ARMS) {
      try { res.push(await session(spec)); } catch (e) { res.push({ arm: spec, error: String(e && e.stack || e).slice(0, 800) }); }
    }
    cdn.close();
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
    for (const r of res) console.log(r.error ? `${r.arm} ERROR ${r.error}` : JSON.stringify(score(r)));
  })();
}
module.exports = { score };
