// Raster lab (2026-10-22): toggle-on and scrub timing for the seven RASTER weather layers, measured from what MapLibre draws.
//
// Owner, 2026-10-22: "all the layers in the weather simulation system ... instant load upon activating the toggle, and instant
// scrub, when scrubbing the timeline" -- measured first. One fresh browser per combo (viewport x layer x model x zoom):
//   map load -> model -> camera -> TOGGLE the layer on -> 10 single steps (ArrowRight on the timeline wheel) -> one long jump.
// Per animation frame the page records which raster slot is VISIBLE (raster-opacity != 0), the time step and model its source
// URL names, the source's tile states and isSourceLoaded. Node classifies each frame against the hour the user asked for:
//   o  correct hour + model, every tile loaded (fully drawn)        p  correct hour, some tiles still loading
//   s  STALE: a different hour/model drawn under the new label      b  BLANK: nothing drawn (no slot, transparent, 0 tiles)
// Radar keeps one MapLibre source per frame (+-2 preloaded) and swaps opacity: its "current" source is the requested frame by
// construction, so its classes are o / p / b, plus s while the previous frame's source is still the visible one.
// Tiles come through rr.js (record once, replay with recorded latency): third-party hosts are hit once per unique range/tile.
//
//   python ../offline-backend/serve_synthetic.py --dir <store> --port 4198 --models GFS,ICON,EURO
//   node ../offline-backend/serve_spa.js <build> 3198
//   AB_BASE=http://127.0.0.1:3198 PORT=4198 RR_DIR=<cache> OUT=<dir> node lab.js
// Env: VPS=desktop,phone LAYERS=rain,radar,satellite,pressure,temperature,water_temp,fog MODELS=GFS,EURO ZOOMS=2,4,6,9
//      STEPS=10 STEP_TIMEOUT=20000 DWELL=1000 CENTER=-79.8,28.0 FLAGS='{"__RAW_X__":true}' (window levers set before load)
//      PHONE_CPU=4 (CPU throttle for the phone viewport) RR_MODE=auto|replay RR_LAT=1|0|x2
const fs = require('fs');
const path = require('path');
const L = require('../offline-backend/ab_lib.js');
const { RR } = require('./rr.js');

const PORT = +(process.env.PORT || 4198);
const OUT = process.env.OUT || 'raster-lab-out';
const RR_DIR = process.env.RR_DIR || path.join(OUT, 'rr-cache');
const VPS = (process.env.VPS || 'desktop,phone').split(',');
const LAYERS = (process.env.LAYERS || 'rain,radar,satellite,pressure,temperature,water_temp,fog').split(',');
const MODELS = (process.env.MODELS || 'GFS,EURO').split(',');
const ZOOMS = (process.env.ZOOMS || '2,4,6,9').split(',').map(Number);
const STEPS = +(process.env.STEPS || 10);
const STEP_TIMEOUT = +(process.env.STEP_TIMEOUT || 20000);
const TOGGLE_TIMEOUT = +(process.env.TOGGLE_TIMEOUT || 30000);
const DWELL = +(process.env.DWELL || 1000);
const LONG_JUMP_H = +(process.env.LONG_JUMP_H || 96);
const [CLNG, CLAT] = (process.env.CENTER || '-79.8,28.0').split(',').map(Number);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const PHONE_CPU = +(process.env.PHONE_CPU || 4);
const TAG = process.env.TAG || 'base';
const RADAR_DIR = +(process.env.RADAR_DIR || -1);
// AB='name=url,name=url': paired arms per combo, run back to back in alternating order (one browser each); a row's `arm` names it.
const ARMS = process.env.AB ? process.env.AB.split(',').map((x) => { const [name, url] = x.split('='); return { name, url }; })
  : [{ name: TAG, url: L.BASE }];
// BACK=1: after the long jump, one jump back to hour 0 (a revisit: what a block cache serves). RELOAD=1: then reload the page
// in the same browser (Cache Storage survives) and toggle the layer on again (Open-Meteo layers only).
const BACK = process.env.BACK === '1';
const RELOAD = process.env.RELOAD === '1';
// Layers whose routing ignores the selected model in our harness region: fog is pinned to GFS; radar in CONUS is RainViewer
// past + advection + HRRR for every model.
const MODEL_FREE = new Set(['fog', 'radar']);
const VP = {
  desktop: { width: 1280, height: 800, dpr: 1, contextOptions: {} },
  phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app's clock pinned to the recording's start, so every session asks for the same frames (rr hits) whatever the hour.
const DATE_SHIM = (offset) => {
  if (!offset) return;
  const RD = Date;
  function D(...a) { if (!(this instanceof D)) return new RD(RD.now() + offset).toString(); return a.length ? new RD(...a) : new RD(RD.now() + offset); }
  D.prototype = RD.prototype; D.now = () => RD.now() + offset; D.parse = RD.parse; D.UTC = RD.UTC;
  window.Date = D;
};

const SAMPLER = () => {
  const R = (window.__RL__ = { on: false, layer: null, frames: [], keys: [], marks: [], want: null, wv: 0, axes: {}, last: null });
  const PRECIP = { GFS: 'ncep_gfs013', ICON: 'dwd_icon', EURO: 'ecmwf_ifs025' };
  const OMM = { GFS: 'ncep_gfs025', ICON: 'dwd_icon', EURO: 'ecmwf_ifs025' };
  // useOpenMeteoTileUrls.resolveModel, mirrored (atmospheric cutovers ICON 168 h, EURO 228 h; fog pinned; water temp on ICON -> GFS).
  R.expModel = (layer, model, h) => {
    if (layer === 'fog') return 'ncep_gfs025';
    if (layer === 'pressure') {
      const b = OMM[model] || 'ncep_gfs025';
      if (b === 'ecmwf_ifs025' && h > 228) return 'ncep_gfs025';
      if (b === 'dwd_icon' && h > 168) return 'ncep_gfs025';
      return b;
    }
    const b = PRECIP[model] || 'dwd_icon';
    if (b === 'dwd_icon' && layer === 'water_temp') return 'ncep_gfs013';
    if (b === 'dwd_icon' && h > 168) return 'ncep_gfs013';
    if (b === 'ecmwf_ifs025' && h > 228) return 'ncep_gfs013';
    return b;
  };
  const closest = (vt, ms) => { let c = 0; let md = Infinity; for (let i = 0; i < vt.length; i++) { const d = Math.abs(Date.parse(vt[i]) - ms); if (d < md) { md = d; c = i; } } return c; };
  const parse = (url) => { if (!url || url.includes('transparent-tile')) return null; const m = url.match(/data_spatial\/([^/]+)\/latest\.json\?time_step=valid_times_(\d+)/); return m ? { model: m[1], idx: +m[2] } : null; };
  const tiles = (m, sid) => {
    const tm = m.style && m.style.tileManagers && m.style.tileManagers[sid];
    let n = 0; let ld = 0; let rl = 0;
    if (tm && tm._inViewTiles) for (const t of tm._inViewTiles.getAllTiles()) { n += 1; if (t.state === 'loaded') ld += 1; else if (t.state === 'reloading') rl += 1; }
    return [n, ld, rl];
  };
  const loadedOf = (m, sid) => { try { return m.isSourceLoaded(sid) === true; } catch (e) { return false; } };
  // What the GPU blends THIS frame, not the target paint value: a layer counts as lit when its evaluated raster-opacity
  // (mid-transition included) is above 0.02 and it is not hidden. Two lit layers of one raster = two hours on screen.
  const evOp = (m, id) => { try { const l = m.style._layers[id]; if (!l || l.visibility === 'none' || (l.layout && l.layout.get && l.layout.get('visibility') === 'none')) return 0; const v = l.paint.get('raster-opacity'); return typeof v === 'number' ? v : 0; } catch (e) { return 0; } };
  R.lit = (m) => {
    const ids = R.layer === 'radar' ? ((m.style && m.style._order) || []).filter((id) => id.startsWith('radar-frame-')) : [0, 1, 2].map((i) => `${R.layer}-slot-${i}-layer`);
    return ids.filter((id) => evOp(m, id) > 0.02).length;
  };
  // Tiles of the visible source still inside their raster-fade-duration (a per-tile fade-in = patchwork).
  R.fading = (m, sid, lid) => {
    try {
      const tm = m.style.tileManagers[sid]; const fd = m.getPaintProperty(lid, 'raster-fade-duration') || 0;
      if (!tm || !fd) return 0; const now = performance.now(); let f = 0;
      for (const t of tm._inViewTiles.getAllTiles()) if (t.timeAdded && now - t.timeAdded < fd) f += 1;
      return f;
    } catch (e) { return 0; }
  };
  // Is a "Loading ... still showing ..." line on screen (the status under the timeline, any layout)? 1 = a stale frame ADMITTED.
  R.admitted = () => ([...document.querySelectorAll('[role="status"][data-drawn-state="pending"]')].some((el) => el.offsetParent !== null) ? 1 : 0);
  R.wheel = () => [...document.querySelectorAll('[role="slider"][aria-label*="timeline wheel"]')].find((el) => el.offsetParent !== null) || null;
  R.sampleOM = (m) => {
    const L = R.layer; let vis = -1;
    for (let i = 0; i < 3; i++) {
      const lid = `${L}-slot-${i}-layer`;
      if (!m.getLayer(lid)) continue;
      const op = m.getPaintProperty(lid, 'raster-opacity'); const v = m.getLayoutProperty(lid, 'visibility');
      if (op !== 0 && op != null && v !== 'none') { vis = i; break; }
    }
    if (vis < 0) return { cls: 'b', vis, n: 0, ld: 0, rl: 0, id: null };
    const sid = `${L}-slot-${vis}-source`; const src = m.getSource(sid); const p = parse(src && src.url);
    const [n, ld, rl] = tiles(m, sid); const loaded = loadedOf(m, sid);
    if (!p) return { cls: 'b', vis, n, ld, rl, id: null };
    const W = R.want; let ok = false; let exp = null;
    if (W) {
      const em = R.expModel(L, W.model, W.hour); const vt = R.axes[em];
      const ei = vt ? closest(vt, Date.now() + W.hour * 3600000) : null; exp = em + ':' + ei;
      ok = p.model === em && p.idx === ei;
    }
    // The tiles on screen belong to the URL only if the source's tile template does (an aborted TileJSON leaves a source
    // "loaded" with the previous URL's tiles and template under the new URL): otherwise they are another hour's.
    const tpl = Array.isArray(src.tiles) ? src.tiles[0] : null;
    const own = typeof tpl !== 'string' || tpl.startsWith(src.url);
    const cls = ok && own ? (loaded && n > 0 ? 'o' : (ld > 0 ? 'p' : 'b')) : (ld + rl > 0 ? 's' : 'b');
    const out = { cls, vis, n, ld, rl, id: p.model + ':' + p.idx, exp, fading: R.fading(m, sid, `${L}-slot-${vis}-layer`) };
    if (window.__RL_DBG__) {   // DUMP debugging: the tile template the source loaded, its loaded/errored flags
      const tm = m.style.tileManagers[sid];
      out.dbg = [String((src.tiles && src.tiles[0]) || '').replace(/.*valid_times_(\d+).*/, 't$1').slice(-40), src._loaded, tm && tm._sourceLoaded, tm && tm._sourceErrored];
    }
    return out;
  };
  R.sampleRadar = (m) => {
    const order = (m.style && m.style._order) || [];
    let cur = null;
    for (const id of order) { if (!id.startsWith('radar-frame-')) continue; const op = m.getPaintProperty(id, 'raster-opacity'); if (op && op > 0) cur = id; }
    if (!cur) return { cls: 'b', vis: -1, n: 0, ld: 0, rl: 0, id: null };
    const [n, ld, rl] = tiles(m, cur); const loaded = loadedOf(m, cur);
    const W = R.want;
    if (W && W.prevId && cur === W.prevId) return { cls: ld + rl > 0 ? 's' : 'b', vis: 0, n, ld, rl, id: cur };
    return { cls: loaded && n > 0 ? 'o' : (ld > 0 ? 'p' : 'b'), vis: 0, n, ld, rl, id: cur, fading: R.fading(m, cur, cur) };
  };
  window.addEventListener('keydown', (e) => { R.keys.push([e.timeStamp, e.key]); }, true);
  let prevT = null;
  const loop = (t) => {
    if (R.on) {
      const m = window.__MAP_INSTANCE__ || window.map;
      if (m && m.style) {
        let s;
        try { s = R.layer === 'radar' ? R.sampleRadar(m) : R.sampleOM(m); } catch (e) { s = { cls: 'x', err: String(e).slice(0, 80) }; }
        const w = R.wheel();
        R.last = s;
        R.frames.push([Math.round(t * 10) / 10, s.cls, s.vis, s.n, s.ld, s.rl, s.id, s.exp || null, w ? Number(w.getAttribute('aria-valuenow')) : null, prevT == null ? 0 : Math.round(t - prevT), R.wv, R.lit(m), s.fading || 0, s.dbg || null, R.admitted()]);
      }
    }
    prevT = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

async function waitFor(page, pred, timeout, every = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await pred()) return Date.now() - t0;
    await sleep(every);
  }
  return null;
}

// Fully drawn = the visible slot carries the asked-for hour with every tile loaded, for 3 consecutive samples.
async function waitFull(page, rr, timeout) {
  let streak = 0;
  return waitFor(page, async () => {
    const cls = await page.evaluate((axes) => { Object.assign(window.__RL__.axes, axes); return window.__RL__.last && window.__RL__.last.cls; }, rr.axes);
    streak = cls === 'o' ? streak + 1 : 0;
    return streak >= 3;
  }, timeout);
}

// Only frames sampled under this action's own target (want version) count: the next target is set a few frames before its key.
function classify(frames, t0, t1, wv) {
  const seg = frames.filter((f) => f[0] >= t0 && f[0] < t1 && f[10] === wv);
  const firstIdx = (pred) => { const i = seg.findIndex(pred); return i < 0 ? null : i; };
  const iFirst = firstIdx((f) => f[1] === 'o' || f[1] === 'p');
  const iFull = firstIdx((f) => f[1] === 'o');
  const until = iFull == null ? seg.length : iFull;
  const count = (arr, c) => arr.filter((f) => f[1] === c).length;
  const before = seg.slice(0, until);
  const after = iFull == null ? [] : seg.slice(iFull);
  const drawnBefore = seg.slice(0, iFirst == null ? seg.length : iFirst);
  return {
    msFirst: iFirst == null ? null : Math.round(seg[iFirst][0] - t0),
    msFull: iFull == null ? null : Math.round(seg[iFull][0] - t0),
    frames: seg.length,
    stale: count(before, 's'), blank: count(before, 'b'), partial: count(before, 'p'),
    blankBeforeFirst: count(drawnBefore, 'b'),
    afterFullNotOk: after.filter((f) => f[1] !== 'o').length,
    maxGap: seg.reduce((m, f) => Math.max(m, f[9] || 0), 0),
    ids: [...new Set(seg.map((f) => f[6]).filter(Boolean))].slice(0, 6),
    exp: seg.length ? seg[seg.length - 1][7] : null,
    seq: rle(seg.map((f) => f[1])),
    mixed: seg.filter((f) => (f[11] || 0) >= 2).length,          // two hours lit at once (opacity cross-fade)
    staleAdmitted: before.filter((f) => f[1] === 's' && f[14] === 1).length,   // stale frames with the pending line on screen
    staleSilentLate: before.filter((f) => f[1] === 's' && f[14] !== 1 && f[0] - t0 > 350).length,   // silent past the 300 ms quiet
    fadingFrames: seg.filter((f) => (f[12] || 0) > 0).length,    // per-tile fade-ins in the visible source
  };
}

// 'bbbbsso' -> 'b4s2o1': the frame classes of one action, in order.
function rle(arr) {
  let out = ''; let prev = null; let n = 0;
  for (const c of arr) { if (c === prev) n += 1; else { if (prev) out += prev + n; prev = c; n = 1; } }
  if (prev) out += prev + n;
  return out.length > 240 ? out.slice(0, 237) + '...' : out;
}

// The app's own tile counters (openMeteoProtocol TILE_TRUTH): decodes vs decoded-tile cache hits.
const TRUTH = () => { const t = window.__TILE_TRUTH__; return t ? [t.protocolCalls, t.cacheHits] : [0, 0]; };

async function runCombo(rr, offset, vpName, layer, model, zoom, base = L.BASE) {
  const vp = VP[vpName];
  const { browser, page, log } = await L.launch({ port: PORT, width: vp.width, height: vp.height, dpr: vp.dpr, contextOptions: vp.contextOptions });
  const res = { tag: TAG, vp: vpName, layer, model, zoom, at: new Date().toISOString() };
  try {
    await rr.install(page);
    await page.addInitScript(DATE_SHIM, offset);
    await page.addInitScript((flags) => { for (const [k, v] of Object.entries(flags)) window[k] = v; }, FLAGS);
    if (process.env.DUMP) await page.addInitScript(() => { window.__RL_DBG__ = true; });
    await page.addInitScript(SAMPLER);
    if (vpName === 'phone' && PHONE_CPU > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE_CPU });
    }
    await page.goto(base + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 90000 });
    await sleep(1500);
    await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), model);
    await L.jump(page, CLNG, CLAT, zoom);
    await waitFor(page, () => page.evaluate(() => { const m = window.__MAP_INSTANCE__; return !!(m && m.loaded() && m.areTilesLoaded()); }), 20000, 200);
    await sleep(1500);
    let hasWheel = false;
    const actions = [];
    // TOGGLE ON
    const wall0 = Date.now();
    const truth0 = await page.evaluate(TRUTH);
    const tToggle = await page.evaluate(({ layer, model }) => {
      const R = window.__RL__; R.layer = layer; R.want = { hour: 0, model }; R.wv = 1; R.on = true;
      const t = performance.now(); R.marks.push([t, 'toggle']); window.toggleLayer(layer); return t;
    }, { layer, model });
    const msToggle = await waitFull(page, rr, TOGGLE_TIMEOUT);
    await sleep(DWELL);
    actions.push({ kind: 'toggle', t: tToggle, wall: wall0, timedOut: msToggle == null, target: 0, truth: truth0, wv: 1 });
    // The timeline wheel mounts once a layer is on.
    hasWheel = await page.evaluate(() => !!window.__RL__.wheel());
    res.hasWheel = hasWheel;
    // Wheel focus (desktop and phone alike: the key path is the wheel's own commit path).
    let hour = 0; let radarPrev = null;
    const doStep = async (kind, i) => {
      const before = await page.evaluate(() => { const w = window.__RL__.wheel() || document.querySelector('[role="slider"][aria-label*="timeline wheel"]'); return { v: w ? Number(w.getAttribute('aria-valuenow')) : null, max: w ? Number(w.getAttribute('aria-valuemax')) : null, id: window.__RL__.last && window.__RL__.last.id }; });
      radarPrev = before.id;
      let target;
      // Radar's axis is 13 observed frames (10 min) + 4 nowcast frames (15 min); it opens on "now" (index 12): steps go back
      // through the observed frames, the long jump goes to the last nowcast frame.
      if (layer === 'radar') target = kind === 'long' ? before.max : (before.v == null ? null : before.v + RADAR_DIR);
      else target = kind === 'long' ? hour + LONG_JUMP_H : kind === 'back' ? 0 : hour + 1;
      const wv = await page.evaluate(({ target, model, prevId, radar }) => {
        window.__RL__.want = radar ? { prevId, model } : { hour: target, model };
        window.__RL__.wv += 1; return window.__RL__.wv;
      }, { target, model, prevId: radarPrev, radar: layer === 'radar' });
      const truth = await page.evaluate(TRUTH);
      const wall = Date.now();
      let t;
      if (hasWheel) {
        const key = kind !== 'step' ? null : (layer === 'radar' && RADAR_DIR < 0 ? 'ArrowLeft' : 'ArrowRight');
        if (key) {
          await page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first().focus().catch(() => {});
          const k0 = await page.evaluate(() => window.__RL__.keys.length);
          await page.keyboard.press(key);
          t = await page.evaluate((k0) => { const k = window.__RL__.keys[k0]; return k ? k[0] : performance.now(); }, k0);
        } else {
          t = await page.evaluate(({ h, radar }) => { const t = performance.now(); window.__RL__.marks.push([t, 'long']); if (radar) window.setRadarFrameIndex(h); else window.setTimeOffsetHours(h); return t; }, { h: target, radar: layer === 'radar' });
        }
      } else if (layer === 'radar') {
        t = await page.evaluate((i) => { const t = performance.now(); window.setRadarFrameIndex(i); return t; }, target);
      } else {
        t = await page.evaluate((h) => { const t = performance.now(); window.setTimeOffsetHours(h); return t; }, target);
      }
      if (layer !== 'radar') hour = target;
      const ms = await waitFull(page, rr, STEP_TIMEOUT);
      await sleep(DWELL);
      actions.push({ kind, i, t, wall, target, timedOut: ms == null, truth, wv });
    };
    for (let i = 0; i < STEPS; i++) await doStep('step', i);
    await doStep('long', STEPS);
    if (BACK && layer !== 'radar') await doStep('back', STEPS + 1);
    const truthEnd = await page.evaluate(TRUTH);
    const page_ = await page.evaluate(() => ({ frames: window.__RL__.frames, keys: window.__RL__.keys }));
    if (process.env.DUMP) fs.writeFileSync(path.join(OUT, `frames-${vpName}-${layer}-${model}-z${zoom}.json`), JSON.stringify({ frames: page_.frames, actions }));
    const tEnd = page_.frames.length ? page_.frames[page_.frames.length - 1][0] + 1 : 0;
    const wallEnd = Date.now();
    res.actions = actions.map((a, k) => {
      const next = actions[k + 1];
      const c = classify(page_.frames, a.t, next ? next.t : tEnd, a.wv);
      const net = rr.window(a.wall, next ? next.wall : wallEnd);
      const tb = next ? next.truth : truthEnd;
      return { kind: a.kind, i: a.i, target: a.target, timedOut: a.timedOut, ...c, req: net.n, bytes: net.bytes, live: net.live, refused: net.refused, byHost: net.byHost,
        decodes: tb[0] - a.truth[0], tileCacheHits: tb[1] - a.truth[1] };
    });
    if (RELOAD && layer !== 'radar') {
      // Same browser, new page load: the in-memory caches are gone, Cache Storage is not. Toggle the layer on at hour 0 again.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
      await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), model);
      await L.jump(page, CLNG, CLAT, zoom);
      await waitFor(page, () => page.evaluate(() => { const m = window.__MAP_INSTANCE__; return !!(m && m.loaded() && m.areTilesLoaded()); }), 20000, 200);
      await sleep(1500);
      const w1 = Date.now();
      const t1 = await page.evaluate(({ layer, model }) => {
        const R = window.__RL__; R.layer = layer; R.want = { hour: 0, model }; R.wv = 1; R.on = true;
        const t = performance.now(); window.toggleLayer(layer); return t;
      }, { layer, model });
      const ms1 = await waitFull(page, rr, TOGGLE_TIMEOUT);
      await sleep(300);
      const f1 = await page.evaluate(() => window.__RL__.frames);
      const net1 = rr.window(w1, Date.now());
      res.actions.push({ kind: 'reload_toggle', target: 0, timedOut: ms1 == null, ...classify(f1, t1, Infinity, 1), req: net1.n, bytes: net1.bytes, live: net1.live, refused: net1.refused, byHost: net1.byHost });
    }
    res.errors = log.errors.slice(0, 5);
    // The protocol's own decode failures (it then hands MapLibre a transparent fallback: a "loaded" slot that draws nothing).
    res.decodeErrors = log.console.filter((c) => /OM-Protocol\].*(decoding|parsing) error/.test(c.text)).map((c) => c.text.slice(0, 160));
    res.hosts = log.hosts;
  } catch (e) {
    res.error = String(e && e.stack || e).slice(0, 400);
  } finally {
    await browser.close().catch(() => {});
  }
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rr = new RR(RR_DIR);
  const metaPath = path.join(RR_DIR, 'meta.json');
  let meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  if (!meta) { meta = { tRec: Date.now(), created: new Date().toISOString() }; fs.writeFileSync(metaPath, JSON.stringify(meta)); }
  const outFile = path.join(OUT, `results-${TAG}.jsonl`);
  let combo = 0;
  for (const vp of VPS) {
    for (const layer of LAYERS) {
      const models = MODEL_FREE.has(layer) ? [MODELS[0]] : MODELS;
      for (const model of models) {
        for (const zoom of ZOOMS) {
          combo += 1;
          const arms = combo % 2 ? ARMS : [...ARMS].reverse();   // alternate which arm goes first
          for (const arm of arms) {
            const offset = meta.tRec - Date.now();   // re-pinned per session: every session starts at the recording's clock
            const t0 = Date.now();
            const r = await runCombo(rr, offset, vp, layer, model, zoom, arm.url);
            r.arm = arm.name; r.wallMs = Date.now() - t0;
            fs.appendFileSync(outFile, JSON.stringify(r) + '\n');
            const tg = r.actions && r.actions[0];
            const st = r.actions ? r.actions.filter((a) => a.kind === 'step').map((a) => a.msFull) : [];
            const lj = r.actions ? r.actions.find((a) => a.kind === 'long') : null;
            console.log(`[${arm.name}] ${vp} ${layer} ${model} z${zoom}: toggle first ${tg && tg.msFirst} full ${tg && tg.msFull} | steps full ${st.join(',')} | long ${lj && lj.msFull}` + (r.error ? ` ERROR ${r.error.slice(0, 120)}` : ''));
          }
        }
      }
    }
  }
})();
