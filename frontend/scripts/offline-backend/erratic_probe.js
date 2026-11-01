// In-page probe for scn_erratic_fuzz.js (2026-10-27). Injected with page.addInitScript(PROBE). It judges EVERY rendered map frame
// (MapLibre 'render' event: the frame the user sees, not 'idle') against the app's own instruments and records violation
// EPISODES (start, end, frames, a snapshot at the start), plus rAF deltas and long tasks per action bucket. Pure observation:
// it sets no app flag and changes no app state. The one active part is the opt-in pixel window (readPixels around the marine
// engine's render), armed by the driver for a few frames at a time because a readPixels stalls the GPU pipeline.
//
// Truth used (never the engine's `truthTag`, which lags):
//   resident  = __MARINE_ENGINE__._waveData.waveGrid (what the engine holds; the custom layer draws it this frame)
//   dataMs    = its product stamp (frame store __servedProductId / productId) > served_valid_time > __readoutServedTime > a series
//               frame's own valid_time > an estimate's held_from
//   selected  = the UI: the pressed model / marine-layer chips, the Surf Rating button, the wheel's aria-valuenow; labelMs is
//               __RAW_SELECTED_FRAME__.labelMs (the app's own selection instant) when it names the wheel hour, else round(now) + hour
//   drawn     = __MARINE_DRAWN__ (what the status line words are computed from)
//   words     = the visible role=status lines
/* eslint-disable no-undef */
const PROBE = () => {
  const H = 3600000;
  const MARINE = { Waves: 'waves', Swell: 'swell_1', 'Swell 2': 'swell_2', 'Wind Waves': 'wind_waves' };
  const MODELS = ['GFS', 'EURO', 'ICON'];
  const F = (window.__FZ__ = { t0: performance.now(), frames: 0, episodes: [], open: {}, bucket: null, buckets: [], longtasks: [], arm: null,
    firstPaint: {}, mapSeen: null, pixel: null, pixelLog: [], band: { offAt: null, onAt: null }, faultActive: false, lastActionAt: 0, cfg: { maxEpisodes: 400 } });
  const stamp = (pid) => { const m = /(\d{8}T\d{6}Z)/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  const modelOfPid = (pid) => { const m = /^(gfs|euro|icon|ecmwf)_/i.exec(String(pid || '').split('/').pop()); return m ? (m[1].toUpperCase() === 'ECMWF' ? 'EURO' : m[1].toUpperCase()) : null; };
  F.stamp = stamp;
  // ---- the UI's selection (DOM; buttons may be hidden on the phone's collapsed sheet: last known kept) ----
  let ui = { model: null, layer: null, band: null, wind: false, hour: null, statuses: [], at: 0 };
  const readUi = () => {
    const now = performance.now();
    if (now - ui.at < 4) return ui;   // fresh every rendered frame (a cached read made 1-frame label lags look like mislabels)
    const out = { ...ui, at: now };
    const btns = document.querySelectorAll('button[aria-pressed]');
    let seenModel = false; let seenLayer = false; let layer = null; let bandDom = null;
    for (const b of btns) {
      const t = (b.textContent || '').trim(); const p = b.getAttribute('aria-pressed') === 'true';
      if (MODELS.includes(t)) { seenModel = true; if (p) out.model = t; }
      else if (MARINE[t] !== undefined) { seenLayer = true; if (p) layer = MARINE[t]; }
      else if (t === 'Wind') out.wind = p;
      // MapPage mounts TWO MapWeatherControls (desktop + mobile), each with its own band state: only a VISIBLE button is what the
      // user reads (a hidden one goes stale by design of the two instances, and shows when the viewport crosses the md breakpoint)
      else if (/^Surf Rating: (ON|OFF)$/.test(t) && b.offsetParent !== null) bandDom = /ON$/.test(t);
    }
    // the band: the button when it is in the DOM (the phone's collapsed sheet unmounts it), else the app's own flag (the engine
    // reads the same flag: marineSurfMode / getSurfModeFlag); both are kept so a disagreement is its own finding
    let bandFlag = null;
    try { bandFlag = window.__SURF_MODE__ !== undefined ? window.__SURF_MODE__ === true : localStorage.getItem('__SURF_MODE__') === 'true'; } catch (e) { bandFlag = null; }
    out.bandDom = bandDom; out.bandFlag = bandFlag;
    out.band = bandDom != null ? bandDom : bandFlag;
    if (seenLayer) out.layer = layer;
    if (!seenModel && out.model == null) out.model = null;
    const w = document.querySelector('[role="slider"][aria-label*="Forecast timeline"]');
    if (w) out.hour = +w.getAttribute('aria-valuenow');
    const lines = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null && /\bmt-1\b/.test(x.className));
    out.statuses = lines.filter((x) => x.getAttribute('data-testid') !== 'wind-time-status').map((x) => x.textContent.trim());
    out.windStatuses = lines.filter((x) => x.getAttribute('data-testid') === 'wind-time-status').map((x) => x.textContent.trim());
    // words that exist but are not on screen (the phone's collapsed sheet): a separate fact, never counted as said
    out.hiddenStatuses = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent === null && /\bmt-1\b/.test(x.className) && x.getAttribute('data-testid') !== 'wind-time-status').map((x) => x.textContent.trim()).filter(Boolean);
    ui = out; return ui;
  };
  F.readUi = () => { ui.at = 0; return readUi(); };
  const selectedLabelMs = (hour) => {
    const s = window.__RAW_SELECTED_FRAME__;
    if (s && Number.isFinite(s.labelMs) && s.hour === hour) return s.labelMs;
    return Math.round(Date.now() / H) * H + hour * H;
  };
  // ---- the resident (what the engine holds) ----
  const resident = () => {
    const e = window.__MARINE_ENGINE__; const d = e && e._waveData; const g = d && d.waveGrid;
    if (!g) return { has: false };
    const pid = (g.__fromFrameStore && g.__servedProductId) || g.__servedProductId || g.productId || null;
    const basis = g.estimate_basis || null;
    const dataMs = stamp(pid) || Date.parse(g.served_valid_time || g.__readoutServedTime || '') || (g.__fromSeries ? Date.parse(g.valid_time || '') : NaN)
      || (basis && basis.held_from ? Date.parse(basis.held_from) : NaN) || null;
    return { has: true, g, pid, dataMs, hour: g.hourOffset, layer: g.__componentLayer || 'waves', model: g.__sourceModel || modelOfPid(pid) || 'GFS',
      pidModel: modelOfPid(pid), stride: g.__decimatedStride || 0, series: !!g.__fromSeries, store: !!g.__fromFrameStore, rating: !!g.ratingMode,
      estimated: !!(g.is_estimated || g.isEstimated), basis: basis && basis.type, dims: `${g.cols}x${g.rows}` };
  };
  F.resident = () => { const r = resident(); delete r.g; return r; };
  const brief = (r) => (r.has ? { model: r.model, layer: r.layer, hour: r.hour, dataIso: r.dataMs ? new Date(r.dataMs).toISOString() : null, pid: r.pid && String(r.pid).slice(-60),
    via: r.store ? 'store' : (r.series ? 'series' : 'grid'), stride: r.stride, rating: r.rating, est: r.estimated, basis: r.basis, dims: r.dims } : { has: false });
  // ---- episodes: a condition that holds over consecutive rendered frames ----
  const openEp = (key, kind, snap) => {
    if (F.open[key]) { F.open[key].frames += 1; F.open[key].last = performance.now(); return; }
    if (F.episodes.length >= F.cfg.maxEpisodes) return;
    const ep = { kind, key, t: Math.round(performance.now() - F.t0), last: performance.now(), frames: 1, action: F.bucket ? F.bucket.idx : null, sinceAction: Math.round(performance.now() - F.lastActionAt), fault: F.faultActive, ...snap };
    F.open[key] = ep; F.episodes.push(ep);
  };
  const closeEp = (key) => { const ep = F.open[key]; if (!ep) return; ep.durMs = Math.round(ep.last - F.t0 - ep.t); delete ep.last; delete F.open[key]; };
  F.closeAll = () => { for (const k of Object.keys(F.open)) closeEp(k); };
  const HONEST = /Loading|Holding|nearest|still showing|not arriving|Estimated|held from|Verifying|does not match|beyond|stand-in|blended/i;
  // ---- per rendered frame ----
  const onRender = () => {
    const now = performance.now();
    F.frames += 1;
    const u = readUi(); const r = resident();
    const map = window.__MAP_INSTANCE__ || window.map;
    const marineOn = !!u.layer;
    const layerKey = `${u.layer}`;
    if (marineOn && r.has && r.layer === u.layer) F.firstPaint[layerKey] = F.firstPaint[layerKey] || now;
    if (!marineOn) F.firstPaint = {};
    // the TIME words: the band's own held lines ("Surf ratings paused ... still loading") say nothing about which hour is drawn
    const status = u.statuses.filter((s) => !/^Surf ratings|^Loading wave heights for this view/.test(s)).join(' | ');
    const bandWords = u.statuses.filter((s) => /^Surf ratings|^Loading wave heights for this view/.test(s)).join(' | ');
    const snap = () => ({ sel: { model: u.model, layer: u.layer, hour: u.hour, band: u.band, zoom: map ? +map.getZoom().toFixed(2) : null }, res: brief(r), status: status.slice(0, 200),
      hidden: (u.hiddenStatuses || []).join(' | ').slice(0, 160) || undefined,
      gpu: (() => { const G = window.__RAW_GPU__ || {}; const o = G.opacity || {}; return { op: o.heatmap, opAgeMs: o.t ? Date.now() - o.t : null, mult: o.mult, coarse: o.coarseFade, ease: G.opacityEase || null, bandMult: G.ratingBandFade ? G.ratingBandFade.bandMult : null, heldBy: G.ratingBandFade ? G.ratingBandFade.heldBy : null, blend: G.blendBoth ? G.blendBoth.engaged : null, veil: G.coldVeil || null }; })(),
      drawn: window.__MARINE_DRAWN__ ? { model: window.__MARINE_DRAWN__.model, layer: window.__MARINE_DRAWN__.layer, hour: window.__MARINE_DRAWN__.hour, dataIso: window.__MARINE_DRAWN__.dataMs ? new Date(window.__MARINE_DRAWN__.dataMs).toISOString() : null } : null });
    // INV1 blank: a marine layer on, painted once since it went on, and the engine holds nothing (the render returns early)
    if (marineOn && F.firstPaint[layerKey] && !r.has) openEp('blank', 'inv1_blank', snap()); else closeEp('blank');
    // alpha 0: the heatmap pass ran this frame (its opacity record is stamped per draw) and drew at opacity 0; and the pass not
    // running at all while the engine holds a frame (the record goes stale: an early return after the resident check)
    const op = window.__RAW_GPU__ && window.__RAW_GPU__.opacity;
    const opFresh = !!(op && op.t && Date.now() - op.t < 250);
    // with BLEND BOTH engaged the honest coarse wash draws under the main pass (the band's dead zone and the band-off hide zero the
    // main pass on purpose and the wash shows through): only a main pass at 0 with NO wash under it is an empty sea
    const blend = window.__RAW_GPU__ && window.__RAW_GPU__.blendBoth; const washUnder = !!(blend && blend.engaged);
    if (marineOn && r.has && opFresh && op.heatmap === 0 && !washUnder) openEp('alpha0', 'inv1_alpha0', snap()); else closeEp('alpha0');
    if (marineOn && r.has && F.firstPaint[layerKey] && op && op.t && Date.now() - op.t > 600 && now - F.firstPaint[layerKey] > 1000) openEp('nodraw', 'inv1_heatmap_not_drawing', snap()); else closeEp('nodraw');
    // ONE FRAME, ONE RUN: under BLEND BOTH the coarse base wash and the resident are drawn together; their verified cycles must agree
    const eng = window.__MARINE_ENGINE__; const base = eng && eng._coarseBaseData && eng._coarseBaseData.waveGrid;
    const runOf = (g) => (g ? (g.model_run_time_status === 'known' && g.model_run_time) || g.__readoutModelRun || null : null);
    const rr = r.has ? runOf(r.g) : null; const br = runOf(base);
    if (marineOn && r.has && washUnder && base && base.__sourceModel === r.model && rr && br && Date.parse(rr) !== Date.parse(br)) openEp('runmix', 'inv2_runs_mixed_in_frame', { ...snap(), resRun: rr, baseRun: br });
    else closeEp('runmix');
    F.lastRuns = { res: rr, base: br };
    // ONE FRAME, ONE TIME: the BLEND BOTH base wash (captured from the last global-coarse commit, picked by model|layer|flavor only)
    // must hold the same instant as the resident it is drawn with; a base from another hour is another time on the same screen
    if (marineOn && r.has && washUnder && base && base.__sourceModel === r.model && Number.isFinite(r.dataMs)) {
      const bpid = base.__servedProductId || base.productId || null;
      const bms = stamp(bpid) || Date.parse(base.served_valid_time || base.__readoutServedTime || '') || (base.__fromSeries ? Date.parse(base.valid_time || '') : NaN) || null;
      const offB = Number.isFinite(bms) ? (bms - r.dataMs) / H : null;
      if (offB != null && Math.abs(offB) > 1.01) openEp('basetime', 'inv2_base_wash_other_time', { ...snap(), baseIso: new Date(bms).toISOString(), baseHour: base.hourOffset, baseDims: `${base.cols}x${base.rows}`, offBaseH: +offB.toFixed(2) });
      else closeEp('basetime');
    } else closeEp('basetime');
    // INV2 / INV5 mislabel and wrong model/layer, judged against the words on screen
    if (marineOn && r.has && Number.isFinite(u.hour)) {
      const labelMs = selectedLabelMs(u.hour);
      const runMs = window.__MARINE_DRAWN__ && window.__MARINE_DRAWN__.runMs;
      // the APP's nearest rule (drawnFrameReadout.latticeNearestMaxHours: EURO past model step 144, by the drawn run, else by the
      // timeline hour) and the TRUE half step of the lattice this frame comes from (EURO WAM waves are 6-hourly past step 144 when
      // authoritative; every other stored marine lattice, EURO's swells and every estimated tail included, is 3-hourly)
      const step = Number.isFinite(runMs) && labelMs >= runMs ? (labelMs - runMs) / H : u.hour;
      const nearest = u.model === 'EURO' && step > 144 ? 3 : 1;
      const trueNearest = u.model === 'EURO' && u.layer === 'waves' && !r.estimated && step > 144 ? 3 : 1;
      if (u.model && r.model !== u.model) {
        const ok = /still showing|not arriving/i.test(status) && status.includes(u.model);
        if (!ok) openEp('model', 'inv5_wrong_model_silent', snap()); else closeEp('model');
      } else closeEp('model');
      if (r.layer !== u.layer && !(r.rating && u.band)) {
        const ok = /still showing|not arriving/i.test(status);
        if (!ok) openEp('layer', 'inv2_wrong_layer_silent', snap()); else closeEp('layer');
      } else closeEp('layer');
      if (r.model === u.model && r.layer === u.layer && Number.isFinite(r.dataMs)) {
        const offH = (r.dataMs - labelMs) / H;
        const a = Math.abs(offH);
        if (a > nearest + 0.01) {
          // further than the lattice's half step: must read Loading / Holding (pending / held), never "nearest" or nothing
          if (!/Loading|Holding|not arriving|still showing/i.test(status)) openEp('mislabel', /nearest/i.test(status) ? 'inv2_mislabel_says_nearest' : 'inv2_mislabel_silent', { ...snap(), offH: +offH.toFixed(2) });
          else closeEp('mislabel');
        } else if (a >= 0.5 && !HONEST.test(status)) openEp('mislabel', 'inv2_nearest_unworded', { ...snap(), offH: +offH.toFixed(2) });
        else if (a > trueNearest + 0.01 && /nearest/i.test(status)) openEp('mislabel', 'inv2_nearest_claim_overbroad', { ...snap(), offH: +offH.toFixed(2) });
        else closeEp('mislabel');
        // the record the words are built from must describe the resident
        const dr = window.__MARINE_DRAWN__;
        if (dr && Number.isFinite(dr.dataMs) && Math.abs(dr.dataMs - r.dataMs) >= H && (dr.model === r.model)) openEp('drawnlie', 'inv2_drawn_record_disagrees', snap()); else closeEp('drawnlie');
      } else { closeEp('mislabel'); closeEp('drawnlie'); }
      // INV3 stuck: "Loading" for > 3 s with nothing in flight and no action / fault in the last 3 s
      // the band-off hold's own line ("Loading wave heights for this view…") is a loading promise too
      const loading = /Loading/.test(status) || /^Loading wave heights/m.test(bandWords.split(' | ').join('\n'));
      if (loading) { F.loadingSince = F.loadingSince || now; } else F.loadingSince = null;
      const inflight = window.__MARINE_INFLIGHT__ && window.__MARINE_INFLIGHT__.active ? window.__MARINE_INFLIGHT__.active.length : 0;
      const pending = !!window.__MARINE_FETCH_PENDING__;
      if (F.loadingSince && now - F.loadingSince > 3000 && !inflight && !pending && !F.faultActive && now - F.lastActionAt > 3000) openEp('stuck', 'inv3_loading_idle', { ...snap(), loadingMs: Math.round(now - F.loadingSince) });
      else closeEp('stuck');
    } else { closeEp('model'); closeEp('layer'); closeEp('mislabel'); closeEp('stuck'); closeEp('drawnlie'); F.loadingSince = null; }
    // WIND (the overlay): cleared while its chip stays on; a drawn hour far from the selection with no words on its own line
    const wd = window.__WIND_DRAWN__;
    if (u.wind && wd) F.windPainted = F.windPainted || now;
    if (!u.wind) F.windPainted = null;
    if (u.wind && F.windPainted && !wd) openEp('windclear', 'inv1_wind_cleared', snap()); else closeEp('windclear');
    if (u.wind && wd && Number.isFinite(wd.dataMs) && Number.isFinite(u.hour)) {
      const wl = selectedLabelMs(u.hour); const off = (wd.dataMs - wl) / H; const ws = (u.windStatuses || []).join(' | ');
      if (Math.abs(off) > 1.01 && !/Loading|Holding|still showing|not arriving|nearest|Estimated/i.test(ws)) openEp('windlabel', 'inv2_wind_mislabel_silent', { ...snap(), offH: +off.toFixed(2), windStatus: ws.slice(0, 160) });
      else closeEp('windlabel');
    } else closeEp('windlabel');
    // INV4 band: OFF = no band paint 100 ms after the click; the paint = engine band active AND its fade multiplier not 0 (#598)
    const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand; const rf = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade;
    const painting = !!(rb && rb.active && !(rf && rf.bandMult === 0));
    F.bandPainting = painting;
    const bandOffBoth = u.band === false && u.bandFlag === false;   // the button (or its absence) AND the flag the engine reads say OFF
    if (bandOffBoth && painting && F.band.offAt != null && now - F.band.offAt > 100) openEp('bandlate', 'inv4_band_paints_after_off', { ...snap(), sinceOff: Math.round(now - F.band.offAt) });
    else if (bandOffBoth && painting && F.band.offAt == null && marineOn) openEp('bandlate', 'inv4_band_paints_while_off', snap());
    else closeEp('bandlate');
    if (u.bandDom != null && u.bandFlag != null && u.bandDom !== u.bandFlag) openEp('bandui', 'inv4_band_button_disagrees_with_flag', { ...snap(), bandDom: u.bandDom, bandFlag: u.bandFlag });
    else closeEp('bandui');
    // the ring of recent frames (an arm set a few ms after the input judges the frames already drawn since)
    const fr = { t: now, has: r.has, model: r.model, layer: r.layer, dataMs: r.dataMs, stride: r.stride, rating: r.rating, via: r.store ? 'store' : (r.series ? 'series' : 'grid'), dims: r.dims, painting, bandWords: !!bandWords };
    F.ring.push(fr); if (F.ring.length > 1500) F.ring.shift();
    if (F.arm && !F.arm.done) judgeArm(F.arm, fr);
    // the pixel window is read inside the engine's render (below); here only the frame counter
    if (F.pixel && F.pixel.left > 0 && F.pixel.lastRenderSeen !== F.frames) F.pixel.lastRenderSeen = F.frames;
  };
  // the armed action: the first frame whose resident is the expected one (time, model, layer) and the first at full resolution
  const judgeArm = (A, fr) => {
    A.frames += 1;
    if (fr.has && fr.model === A.model && fr.layer === A.layer && Number.isFinite(fr.dataMs) && A.expected.includes(fr.dataMs) && (!fr.rating || A.band)) {
      if (A.exactAt == null) { A.exactAt = fr.t; A.via = fr.via; A.dims = fr.dims; }
      if (A.fullAt == null && fr.stride === 0) A.fullAt = fr.t;
    }
    if (A.bandWant != null && A.bandAt == null && ((A.bandWant && (fr.painting || fr.bandWords)) || (!A.bandWant && !fr.painting))) A.bandAt = fr.t;
  };
  F.ring = [];
  // ---- pixel window: readPixels right before and right after the marine engine draws, at fixed screen points ----
  const wrapEngine = () => {
    const e = window.__MARINE_ENGINE__;
    if (!e || e.__fzWrapped) return;
    const orig = e.render;
    e.render = function (gl, ...rest) {
      const P = F.pixel;
      if (!P || P.left <= 0 || !gl || !gl.readPixels) return orig.call(this, gl, ...rest);
      const W = gl.drawingBufferWidth; const Hh = gl.drawingBufferHeight; const buf = new Uint8Array(4);
      const read = () => P.pts.map(([fx, fy]) => { const x = Math.round(fx * W); const y = Math.round((1 - fy) * Hh); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); return [buf[0], buf[1], buf[2]]; });
      let pre = null; try { pre = read(); } catch (err) { pre = null; }
      // CREST-FREE: the wash is sampled the moment the engine switches to its particle DRAW program (after the heatmap pass, before
      // the crests are laid), so a crest crossing a sample point cannot tint it; without a crest pass, after the render
      let washPost = null; const eng = this; const origUse = gl.useProgram;
      gl.useProgram = function (p) { if (washPost == null && p && p === eng.drawProgram) { try { washPost = read(); } catch (err) { washPost = null; } } return origUse.call(this, p); };
      let out;
      try { out = orig.call(this, gl, ...rest); } finally { gl.useProgram = origUse; }
      let post = null; try { post = washPost || read(); } catch (err) { post = null; }
      const r = resident();
      const rb = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand; const rf = window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade;
      const op = window.__RAW_GPU__ && window.__RAW_GPU__.opacity;
      if (F.pixelLog.length < 4000) F.pixelLog.push({ t: Math.round(performance.now() - F.t0), tag: P.tag, pre, post, crestFree: washPost != null, pid: r.has ? r.pid : null, dataMs: r.has ? r.dataMs : null, model: r.has ? r.model : null, layer: r.has ? r.layer : null,
        band: !!(rb && rb.active && !(rf && rf.bandMult === 0)), opacity: op ? op.heatmap : null, theme: document.documentElement.classList.contains('beach-mode') ? 'beach' : (document.documentElement.classList.contains('light') ? 'light' : 'dark') });
      P.left -= 1;
      return out;
    };
    e.__fzWrapped = true;
  };
  F.armPixels = (tag, pts, frames) => { F.pixel = { tag, pts, left: frames }; };
  // ---- per-action buckets: rAF deltas, long tasks ----
  F.beginAction = (idx, type) => {
    if (F.bucket) F.buckets.push(F.bucket);
    F.bucket = { idx, type, t: Math.round(performance.now() - F.t0), rafN: 0, rafMax: 0, raf50: 0, rafSum: 0, long: 0, longMax: 0 };
    F.lastActionAt = performance.now();
  };
  F.markInput = () => { F.lastActionAt = performance.now(); };
  F.setArm = (a) => {
    const t0 = performance.now() - (a.lagMs || 0);
    F.arm = { ...a, t0, frames: 0, exactAt: null, fullAt: null, via: null, bandAt: null, done: false };
    for (const fr of F.ring) if (fr.t >= t0) judgeArm(F.arm, fr);
  };
  // the expectation arrives later (the driver asks the backend without blocking the action loop): re-judge from the ring
  F.fillArm = (id, expected) => {
    const A = F.arm; if (!A || A.id !== id) return false;
    A.expected = expected; A.frames = 0; A.exactAt = null; A.fullAt = null; A.via = null; const bandAt = A.bandAt; A.bandAt = null;
    for (const fr of F.ring) if (fr.t >= A.t0) judgeArm(A, fr);
    if (A.bandAt == null) A.bandAt = bandAt;
    return true;
  };
  F.restartArmClock = () => { if (F.arm) { F.arm.t0 = performance.now(); F.arm.exactAt = null; F.arm.fullAt = null; F.arm.bandAt = null; } };
  F.readArm = () => { const a = F.arm; if (!a) return null; return { exactMs: a.exactAt == null ? null : Math.round(a.exactAt - a.t0), fullMs: a.fullAt == null ? null : Math.round(a.fullAt - a.t0), via: a.via, dims: a.dims, frames: a.frames, bandMs: a.bandAt == null ? null : Math.round(a.bandAt - a.t0) }; };
  let lastRaf = null;
  const raf = (t) => {
    if (lastRaf != null && F.bucket) { const d = t - lastRaf; const b = F.bucket; b.rafN += 1; b.rafSum += d; if (d > b.rafMax) b.rafMax = d; if (d > 50) b.raf50 += 1; }
    lastRaf = t;
    // hook the map's render event and the engine as soon as they exist (a theme switch remounts both)
    const map = window.__MAP_INSTANCE__ || window.map;
    if (map && map !== F.mapSeen) { F.mapSeen = map; F.mapGen = (F.mapGen || 0) + 1; F.firstPaint = {}; map.on('render', onRender); }
    wrapEngine();
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) { if (F.longtasks.length < 3000) F.longtasks.push({ t: Math.round(e.startTime - F.t0), d: Math.round(e.duration) }); if (F.bucket) { F.bucket.long += 1; F.bucket.longMax = Math.max(F.bucket.longMax, Math.round(e.duration)); } } }).observe({ type: 'longtask', buffered: true });
  } catch (e) { /* no long-task timing in this browser */ }
  window.addEventListener('unhandledrejection', (ev) => { (F.rejections = F.rejections || []).push({ t: Math.round(performance.now() - F.t0), r: String(ev.reason && (ev.reason.stack || ev.reason.message) || ev.reason).slice(0, 300) }); });
  // The Surf Rating button's own click (capture phase, before React toggles it): OFF starts the band's 100 ms clock.
  window.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest && ev.target.closest('button');
    const t = b ? (b.textContent || '').trim() : '';
    if (t === 'Surf Rating: ON') { F.band.offAt = performance.now(); F.band.onAt = null; }
    else if (t === 'Surf Rating: OFF') { F.band.onAt = performance.now(); F.band.offAt = null; }
  }, true);
  // Closed episodes leave; open ones stay (they are still being counted) until closeAll().
  F.drain = () => {
    const closed = F.episodes.filter((e) => e.durMs !== undefined); F.episodes = F.episodes.filter((e) => e.durMs === undefined);
    const pixelMeta = F.pixelMeta || {}; F.pixelMeta = {};
    return { episodes: closed, buckets: F.buckets.splice(0), longtasks: F.longtasks.splice(0), pixelLog: F.pixelLog.splice(0), pixelMeta, rejections: (F.rejections || []).splice(0), frames: F.frames };
  };
};

module.exports = { PROBE };
