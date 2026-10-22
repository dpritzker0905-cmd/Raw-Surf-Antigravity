/**
 * marineFrameStoreRuntime.js — the GPU-resident forecast frames, wired (phase 2; spec docs/architecture/gpu-resident-forecast-frames.md).
 *
 * WHAT IT DOES, only while static frames are on (staticFrames.js, DARK) and the store is not killed:
 *   1. every static frame #422's loader parses (seam A's exact /grid, seam B's window, or this module's prefetch) is packed to
 *      the wave texture's bytes (marineFramePack: identical to encodeMarineTexture by construction and by test) and kept in a
 *      store (marineFrameStore) and, on WebGL2, in a texture-array layer (marineFrameStoreGpu);
 *   2. on a scrub step, tryShowStoredFrame() puts the stored frame on screen AT ONCE: it copies the layer into the engine's
 *      resident wave texture (or writes the CPU bytes on WebGL1), updates the engine's frame identity and the drawn-frame record,
 *      and asks for a repaint. The normal commit (vectors for the infobox, glyphs, arbiter, truth tags) still follows and writes
 *      the same bytes, so the picture never changes when it lands;
 *   3. noteStep() keeps the intent-gated prefetch running (marineFramePrefetch): the +-8 window, then the whole series once the
 *      wheel has moved 4 frames. CDN only, through #422's shared loader;
 *   4. ADAPTIVE IDLE FILL (2026-10-22): on a desktop with a good link, once the first frames have landed, the rest of the active
 *      run streams in idle time (requestIdleCallback), so later steps are eager's without eager's cost before the first draw.
 *      Phones, coarse pointers, Save-Data, 2g links and hidden tabs stay on demand (see idleFillBlocker); a desktop reading 3g fills.
 * The fast path refuses (and the normal path runs as before) unless the engine's resident texture holds a frame of the SAME set
 * (model, layer, pinned run, pack signature) with the SAME size and NEARLY the same validity, recorded by noteCommitted() after a
 * normal commit.
 *
 * VALIDITY TOLERANCE (2026-10-22, found by the live read): REAL GFS frames never share a validity mask. Of a run's 15,023 cells,
 * neighbouring hours differ in 1-15 (median 8, the sea-ice edges) and ANY two frames of the run in at most 36, so the exact-mask
 * rule refused 11 of 12 live steps. The wave texture a show copies is always the frame's own (exact bytes); only the chl/bath
 * textures derive from the mask (getMarineGeoData, 63 ms a frame: too slow for a step). So a frame whose mask differs from the
 * resident's by at most VALIDITY_TOLERANCE_CELLS is shown with the resident's chl/bath, and the normal commit that follows (it
 * always runs) brings that frame's own chl/bath. Kill: window.__RAW_DISABLE_FRAME_VALIDITY_TOLERANCE__ = true (exact masks only).
 *
 * EXACT AUX SHOW AND INSTANT MODEL TOGGLES (Stage A, 2026-10-22): a frame can also go on screen with its OWN chl/bath bytes
 * (marineFrameAux: the encoder's function on the frame's own masks, uploaded into the resident chl/bath textures beside the wave
 * texture). Then nothing about the resident matters but its size and bounds: a MODEL SWITCH (tryShowStoredFrameForSwitch, called
 * by the orchestrator at the click) shows the new model's stored frame for the current hour at once, and a step after a /grid
 * fallback commit (rt.resident null) re-enters the fast path. To have those frames ready, a capable desktop keeps the OTHER
 * published waves sets warm at the cursor +-1 frame (planWant's warm entries, after the +-8 window, before the run fill), once the
 * wheel has rested WARM_REST_MS (a drag never asks the other models for every hour it passes), and computes their chl/bath in idle.
 * Only a desktop tier computes chl/bath synchronously (~63 ms): at a click, or on a scrub step at most once a second.
 *
 * SHIPS ON behind static frames. Kills (read per call):
 *   window.__RAW_DISABLE_FRAME_STORE__ = true            everything here off: today's path, byte for byte
 *   window.__RAW_DISABLE_FRAME_PREFETCH__ = true         no prefetch: the store fills only from #422's own loads
 *   window.__RAW_DISABLE_FRAME_STORE_GPU__ = true        no texture arrays: CPU bytes + texSubImage2D per step
 *   window.__RAW_DISABLE_FRAME_IDLE_FILL__ = true        no idle fill: the intent-gated policy alone (the series after 4 frames)
 *   window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true     no show at a model switch and no warm frames of the other models
 *   window.__RAW_DISABLE_FRAME_AUX_SHOW__ = true         no exact chl/bath shows at all: the resident-gated path alone (phase 2)
 * Lever (OFF by default, egress): window.__RAW_FRAME_PREFETCH_EAGER__ = true streams the whole series from the first draw.
 * Lever: window.__RAW_FRAME_WARM_REST_MS__ (500): how long the wheel must rest before the other models' warm frames follow it.
 * Telemetry: window.__RAW_FRAME_STORE__ (store, prefetch, GPU, shows and misses by reason).
 */
import { staticFramesEnabled, onStaticFrameParsed, getPinnedIndexSync, getPinnedIndex, loadFrameParsed, setKeyFor, staticEligible } from './staticFrames';
import { pickIndexFrame, frameMeta } from './staticFrameCodec';
import { packStaticFrame, packSignature, validityDiff } from './marineFramePack';
import { createFrameStore, resolveTier, setKeyOf } from './marineFrameStore';
import { createIntent, createPrefetcher, idleSlice, planWant } from './marineFramePrefetch';
import { createFrameArrays, isWebGL2, uploadBytesTo2D } from './marineFrameStoreGpu';
import { auxForPack } from './marineFrameAux';
import { publishMarineDrawn } from './marineDrawnFrame';
import { isHandheldDevice, isWeakDevice } from './deviceTier';
import { createCropShow } from './marineFrameStoreCropShow';   // the crop show (2026-10-22)

const DEPTH = 128;     // layers per array: every set's frame count fits (GFS/ICON 113, EURO 81 over the locked 14 days)
// Cells whose validity may differ between the shown frame and the resident's chl/bath (measured: at most 36 within a real run,
// 0.24% of 15,023; 64 leaves room and still refuses a different grid outright).
export const VALIDITY_TOLERANCE_CELLS = 64;
// Exact chl/bath (marineFrameAux) kept for this many frames (~117 KB each at 181 x 81), and how often a scrub step may compute one.
const AUX_CAP = 12;
const AUX_SYNC_EVERY_MS = 1000;
// Warm frames follow the cursor only once the wheel RESTS this long: a drag across the run would otherwise ask the other models
// for every position it passes (two whole runs, ~12 MB). While it moves, the last resting position's warm frames stay planned.
const WARM_REST_MS = 500;
const WARM_MODELS = ['GFS', 'ICON', 'EURO'];
const WORLD_BBOX = { west: -180, east: 180, south: -80, north: 80 };
const W = () => (typeof window !== 'undefined' ? window : {});
export const frameStoreOn = () => staticFramesEnabled() && W().__RAW_DISABLE_FRAME_STORE__ !== true;

const freshFill = () => ({ key: null, planned: false, armed: false, startedMs: null, doneMs: null, blocked: null });
const freshAux = () => ({ aux: new Map(), auxPending: new Set(), auxSyncAt: -Infinity, warmPinAt: new Map(), lastPressAt: -Infinity, lastWarm: [], warmTimer: null,
  auxStats: { computed: 0, idle: 0, sync: 0, failed: 0, lastMs: null }, switches: { asked: 0, shown: 0, lastMs: null } });
const rt = { store: null, prefetcher: null, intent: createIntent(), pool: null, poolDims: null, target: null, unhook: null,
  resident: null, pendingResident: null, want: null, sets: new Map(), shows: { n: 0, misses: {}, lastMs: null }, activeKey: null, commits: {},
  fill: freshFill(), lastStep: null, openedAt: null, onVis: null, onConn: null, ...freshAux() };

function miss(reason) { rt.shows.misses[reason] = (rt.shows.misses[reason] || 0) + 1; return false; }
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sinceOpen = () => (rt.openedAt === null ? null : Math.round(nowMs() - rt.openedAt));
// The crop show (#459) and model toggles on a crop resident (#458): marineFrameStoreCropShow.js, over this module's state.
const CS = createCropShow({ rt, store: () => store(), miss, deferredShow: (info, vt) => deferredShow(info, vt), W, nowMs, AUX_CAP, VALIDITY_TOLERANCE_CELLS });

// ADAPTIVE IDLE FILL. The owner asked "what is more state of the art? eager or on demand loading on desktop?"; the lead's answer
// (2026-10-22) is the plan: open on demand, then fill the run in idle time where the device and the link allow it. Returns why
// the fill may not run now, or null. Read per call: a link can drop to Save-Data and a tab can hide at any time.
function idleFillBlocker() {
  const w = W();
  if (w.__RAW_DISABLE_FRAME_IDLE_FILL__ === true) return 'killed';
  if (!rt.store || rt.store.tier !== 'desktop' || !rt.store.budget.full) return 'tier';
  const conn = (typeof navigator !== 'undefined' && navigator.connection) || null;
  if (conn && conn.saveData === true) return 'save_data';
  // 2g and slow-2g only: a desktop reading 3g still fills (owner, 2026-10-22; phones never reach here: the tier gate above).
  if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) return 'slow_link';   // no Network Information API = fine
  try { if (typeof w.matchMedia === 'function' && w.matchMedia('(pointer: coarse)').matches) return 'coarse_pointer'; } catch (e) { /* none */ }
  if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return 'hidden';
  return null;
}

// Arm the fill for the active set once its first frames have landed (the plan is idle), then grant it in an idle slice. Also
// re-plans a granted fill that a hidden tab paused.
function armIdleFill() {
  const f = rt.fill;
  if (f.armed || !rt.prefetcher || !rt.activeKey || !rt.lastStep || !rt.prefetcher.telemetry().opened) return;
  const granted = f.key === rt.activeKey;
  if (granted && f.planned) return;
  if (!granted && !rt.prefetcher.idle()) return;          // the first frames first
  f.blocked = idleFillBlocker();
  if (f.blocked) return;
  f.armed = true;
  idleSlice(() => {
    f.armed = false;
    f.blocked = idleFillBlocker();
    if (f.blocked || !rt.lastStep || !rt.activeKey) return;
    if (f.key !== rt.activeKey) Object.assign(f, { key: rt.activeKey, startedMs: sinceOpen(), doneMs: null });
    noteStep({ ...rt.lastStep, commit: true });
    const info = [...rt.sets.values()].find((x) => x.key === f.key);
    if (info) noteFillDone(info);                          // already whole (eager, or the run is short): done now
  });
}

// The time from the first draw until every built frame of the filled set is packed (the harness reads it).
function noteFillDone(info) {
  const f = rt.fill;
  if (f.key !== info.key || f.doneMs !== null || f.startedMs === null) return;
  for (const v of info.validTimes) {
    const fr = info.byVt.get(v);
    const e = store().entry(info.key, v);
    if (fr && fr.path && !(e && e.pack) && !(e && e.unbuilt)) return;
  }
  f.doneMs = sinceOpen();
}

function tier() {
  const w = W(); const nav = typeof navigator !== 'undefined' ? navigator : {};
  const conn = nav.connection || {};
  const gl = rt.target && rt.target.getGl ? rt.target.getGl() : null;
  let handheld = false; let weak = false;
  try { handheld = isHandheldDevice(); weak = isWeakDevice(); } catch (e) { /* defaults */ }
  return resolveTier({ webgl2: gl ? isWebGL2(gl) : true, maxArrayLayers: gl && isWebGL2(gl) ? gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) : 2048,
    frames: DEPTH, handheld, weak, deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    saveData: !!conn.saveData, effectiveType: conn.effectiveType || null }, w);
}

function store() {
  if (!rt.store) rt.store = createFrameStore({ tier: tier() });
  return rt.store;
}

// The store set for a #422 set key and its pinned index (model, layer from the key; run identity = the cycle, never ingest time).
function setFor(key, index) {
  const [model, , layer] = key.split('/');
  const runId = (index && (index.model_run_time || index.run || index.path)) || 'unknown';
  const signature = packSignature();
  const desc = { model, layer, domain: 'world', modelRunTime: runId, signature };
  const sk = setKeyOf(desc);
  let info = rt.sets.get(sk);
  if (!info) {
    const s = store().ensureSet(desc);
    store().noteIndex(s.key, index.frames || []);
    const validTimes = (index.frames || []).map((f) => f.valid_time).filter(Boolean).sort();
    const byVt = new Map((index.frames || []).map((f) => [f.valid_time, f]));
    const byPid = new Map((index.frames || []).filter((f) => f.meta && f.meta.product_id).map((f) => [f.meta.product_id, f.valid_time]));
    const byPath = new Map((index.frames || []).filter((f) => f.path).map((f) => [f.path, f]));
    info = { key: s.key, staticKey: key, index, validTimes, byVt, byPid, byPath, layerOf: new Map(validTimes.map((v, i) => [v, i])) };
    rt.sets.set(sk, info);
    // A new run or signature retires the old sets of the same model x layer (theme change, kill switch, re-pin).
    const keep = new Set([...rt.sets.values()].filter((x) => x.staticKey !== key || x.key === s.key).map((x) => x.key));
    for (const [k, x] of [...rt.sets]) if (!keep.has(x.key)) { rt.sets.delete(k); if (rt.pool) rt.pool.release(x.key); }
    store().retainOnly((st) => keep.has(st.key));
  }
  return info;
}

function gpuPool(cols, rows) {
  const w = W();
  if (w.__RAW_DISABLE_FRAME_STORE_GPU__ === true || !rt.target) return null;
  const gl = rt.target.getGl && rt.target.getGl();
  if (!gl || !isWebGL2(gl)) return null;
  if (rt.pool && (rt.poolDims.cols !== cols || rt.poolDims.rows !== rows)) return null;  // one size per pool: others stay CPU
  if (!rt.pool) {
    const layerBytes = cols * rows * 4;
    const maxArrays = Math.max(1, Math.floor(store().budget.gpuBytes / (DEPTH * layerBytes)));
    rt.pool = createFrameArrays(gl, { cols, rows, depth: DEPTH, maxArrays });
    rt.poolDims = { cols, rows };
    if (rt.pool) rt.pool.ensureSpare();
  }
  return rt.pool;
}

// A frame just packed: if it is the one the last normal commit put on the engine, that commit's resident is now known.
function resolvePending(info, validTime) {
  const p = rt.pendingResident;
  const e = store().entry(info.key, validTime);
  if (!p || p.setKey !== info.key || p.validTime !== validTime || !e || !e.pack) return;
  const engine = rt.target && rt.target.getEngine ? rt.target.getEngine() : null;
  rt.pendingResident = null;
  if (!engine || engine._texWidth !== p.cols || engine._texHeight !== p.rows || p.cols !== e.pack.cols || p.rows !== e.pack.rows) return;
  rt.resident = { setKey: info.key, validityHash: e.pack.validityHash, validityBits: e.pack.validityBits || null, cols: e.pack.cols, rows: e.pack.rows, signature: packSignature() };
  rt.commits.resident_late = (rt.commits.resident_late || 0) + 1;
}

// DEFERRED SHOW (measured 2026-10-21: a big jump past the prefetched window missed at the press and waited for the normal
// commit, ~800 ms at 340 ms CDN latency): the step that missed with `not_ready` is remembered, and the moment its frame lands
// packed it is shown, if nothing has superseded that step since (another step, a normal commit, a set change, 3 s).
const WANT_TTL_MS = 3000;
function deferredShow(info, validTime) {
  const w = rt.want;
  if (!w || w.setKey !== info.key || w.validTime !== validTime) return;
  rt.want = null;
  if (Date.now() - w.at > WANT_TTL_MS) return;
  if (showStored(w.args, !!w.switching)) rt.shows.deferred = (rt.shows.deferred || 0) + 1;
}

function upload(info, validTime) {
  resolvePending(info, validTime);
  uploadGpu(info, validTime);
  if (rt.activeKey && info.key !== rt.activeKey) auxInIdle(info.key, validTime);   // a warm frame: its chl/bath before the click
  deferredShow(info, validTime);
  noteFillDone(info);
  armIdleFill();
}

// ── Exact chl/bath (Stage A) ──────────────────────────────────────────────────────────────────────────────────────────────
// The frame's own chl/bath bytes, from the LRU or computed now (`compute`), else null.
function auxFor(setKey, validTime, e, compute, how) {
  const id = `${setKey}@${validTime}`;
  const hit = rt.aux.get(id);
  if (hit && hit.validityHash === e.pack.validityHash && hit.cols === e.pack.cols && hit.rows === e.pack.rows) {
    rt.aux.delete(id); rt.aux.set(id, hit);
    return hit;
  }
  if (!compute) return null;
  const t0 = nowMs();
  let a = null;
  try { a = auxForPack(e.pack); } catch (err) { a = null; }
  rt.auxStats.lastMs = +(nowMs() - t0).toFixed(1);
  if (!a) { rt.auxStats.failed += 1; return null; }
  rt.auxStats.computed += 1; rt.auxStats[how] = (rt.auxStats[how] || 0) + 1;
  rt.aux.set(id, a);
  while (rt.aux.size > AUX_CAP) rt.aux.delete(rt.aux.keys().next().value);
  return a;
}

function auxInIdle(setKey, validTime) {
  const id = `${setKey}@${validTime}`;
  if (W().__RAW_DISABLE_FRAME_AUX_SHOW__ === true || rt.aux.has(id) || rt.auxPending.has(id)) return;
  rt.auxPending.add(id);
  idleSlice(() => {
    rt.auxPending.delete(id);
    const e = store().entry(setKey, validTime);
    if (e && e.pack) auxFor(setKey, validTime, e, true, 'idle');
  });
}

// WARM FRAMES: the other published waves sets of this layer, at the cursor's time +-1 frame, on a capable desktop only (the idle
// fill's gate). A set whose run index is not pinned yet is pinned in the background (latest.json is cached; one index fetch).
function warmPlan(info, layer, requestedValidTime) {
  if (W().__RAW_DISABLE_FRAME_MODEL_TOGGLE__ === true || W().__RAW_DISABLE_FRAME_AUX_SHOW__ === true || idleFillBlocker()) { rt.lastWarm = []; return []; }
  const restMs = typeof W().__RAW_FRAME_WARM_REST_MS__ === 'number' ? W().__RAW_FRAME_WARM_REST_MS__ : WARM_REST_MS;
  const moving = Date.now() - rt.lastPressAt;
  if (moving < restMs) {
    if (!rt.warmTimer) rt.warmTimer = setTimeout(() => { rt.warmTimer = null; if (rt.lastStep) noteStep({ ...rt.lastStep, commit: true }); }, restMs - moving + 20);
    return rt.lastWarm.filter((w) => w.key !== info.key);
  }
  const askMs = Date.parse(requestedValidTime);
  const out = [];
  for (const m of WARM_MODELS) {
    const k = setKeyFor(m, layer);
    if (k === info.staticKey || !staticEligible({ model: m, layer, bbox: WORLD_BBOX, surf: false })) continue;
    const idx = getPinnedIndexSync(k);
    if (!idx) { pinWarm(k); continue; }
    const wi = setFor(k, idx);
    const f = pickIndexFrame(idx, askMs);
    const i = f ? wi.layerOf.get(f.valid_time) : undefined;
    if (i === undefined) continue;
    for (const j of [i, i + 1, i - 1]) {
      const v = wi.validTimes[j];
      if (!v) continue;
      out.push({ key: wi.key, validTime: v, built: !!(wi.byVt.get(v) || {}).path });
      const e = store().entry(wi.key, v);
      if (e && e.pack) auxInIdle(wi.key, v);        // already packed (the set was active before): its chl/bath in idle
      if (CS.crop.window) CS.buildCrop(wi, v);            // a mid-zoom window is resident: its pack of this warm frame too
    }
  }
  rt.lastWarm = out;
  return out;
}

function pinWarm(k) {
  const now = Date.now();
  if ((rt.warmPinAt.get(k) || 0) > now - 60000) return;
  rt.warmPinAt.set(k, now);
  Promise.resolve(getPinnedIndex(k)).then((idx) => { if (idx && rt.lastStep) noteStep({ ...rt.lastStep, commit: true }); }).catch(() => {});
}

// A pool whose WebGL context was lost (marineFrameStoreGpu: its arrays are dead objects): drop it and the store's GPU residency (the
// frames keep their CPU bytes where the tier keeps them, else they are fetched again), so shows use CPU bytes and the next upload
// builds a new pool on the restored context.
function dropDeadPool() {
  if (!rt.pool || rt.pool.alive()) return false;
  for (const x of rt.sets.values()) store().dropResidency(x.key);
  rt.pool = null; rt.poolDims = null;
  rt.shows.poolLost = (rt.shows.poolLost || 0) + 1;
  return true;
}

function uploadGpu(info, validTime) {
  if (rt.activeKey && info.key !== rt.activeKey) return;   // a warm set stays in CPU bytes: no 7.5 MB array for a few frames
  const e = store().entry(info.key, validTime);
  if (!e || !e.packed || !e.pack || (e.layer !== null && e.layer !== undefined && rt.pool && rt.pool.has(info.key))) return;
  let pool = gpuPool(e.pack.cols, e.pack.rows);
  if (pool && !pool.alive()) { dropDeadPool(); pool = gpuPool(e.pack.cols, e.pack.rows); }
  if (!pool) return;
  const { evicted } = pool.acquire(info.key);
  if (evicted) store().dropResidency(evicted);
  const layer = info.layerOf.get(validTime);
  if (layer === undefined) return;
  if (pool.uploadMany(info.key, [{ layer, bytes: e.packed }]) === 1) store().markResident(info.key, validTime, layer, pool.bytesPerLayer);
}

function packInto(info, validTime, parsed, buffer) {
  const s = store();
  const pack = packStaticFrame(parsed);
  if (!pack) { if (s.markInflight(info.key, validTime)) s.markUnpackable(info.key, validTime, 'unpackable'); return null; }
  if (!s.putPacked(info.key, validTime, pack, buffer || null)) return null;
  upload(info, validTime);
  return pack;
}

// Frames #422's own loads parsed (seam A / seam B): pack them, unless the prefetcher owns the request (it packs its own).
function onParsed({ key, frame, parsed, buffer }) {
  if (!frameStoreOn() || !frame || !frame.valid_time) return;
  const index = getPinnedIndexSync(key);
  if (!index) return;
  const info = setFor(key, index);
  CS.cropFromParsed(info, frame.valid_time, parsed);                 // a resident crop window: this frame's crop pack too
  const e = store().entry(info.key, frame.valid_time);
  if (!e || e.state !== 'absent') return;
  const run = () => { const now = store().entry(info.key, frame.valid_time); if (now && now.state === 'absent') packInto(info, frame.valid_time, parsed, buffer); };
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 200 }); else setTimeout(run, 0);
}

function ensureInit() {
  if (!rt.unhook) rt.unhook = onStaticFrameParsed(onParsed);
  if (!rt.prefetcher) {
    rt.prefetcher = createPrefetcher({
      store: store(),
      fetchFrame: async (path, signal) => {
        const info = [...rt.sets.values()].find((x) => x.byPath.has(path));   // the active set's or a warm set's frame
        const frame = info && info.byPath.get(path);
        if (!info || !frame) return { error: 'unknown_frame' };
        const got = await loadFrameParsed(info.staticKey, frame, signal);
        return got ? { buffer: { parsed: got.parsed }, raw: got.buffer || null, wire: got.wire } : { error: signal && signal.aborted ? 'aborted' : 'load_failed' };
      },
      decodeAndPack: ({ parsed }) => packStaticFrame(parsed),
      onPacked: (key, validTime) => { const info = [...rt.sets.values()].find((x) => x.key === key); if (info) upload(info, validTime); },
    });
  }
  // A hidden tab or a link that turns slow or Save-Data pauses the fill (no new requests beyond the on-demand window); when the
  // blocker clears, the fill resumes in an idle slice. Before 2026-10-22 only visibility re-armed it: a link that read slow for a
  // moment left the fill stopped until the next landing or step (the live fill took 93 s against 7.9 s offline).
  if (!rt.onVis) {
    rt.onVis = () => {
      if (!rt.lastStep) return;
      if (idleFillBlocker()) { if (rt.fill.planned) noteStep({ ...rt.lastStep, commit: true }); } else armIdleFill();
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', rt.onVis);
    const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
    if (conn && typeof conn.addEventListener === 'function') { conn.addEventListener('change', rt.onVis); rt.onConn = conn; }
  }
}

/** WebGLMarineLayer registers how to reach its engine, GL context and map (refs, read at call time). */
export function registerFrameStoreTarget(target) {
  rt.target = target || null;
  if (target) ensureInit();
}

/** After a NORMAL commit: remember which stored frame the engine's resident texture now holds (or that it holds none). */
export function noteCommitted(grid, { hour, model, layer } = {}) {
  rt.resident = null; rt.pendingResident = null; rt.want = null;   // a normal commit supersedes a deferred show
  const why = (r) => { rt.commits[r] = (rt.commits[r] || 0) + 1; };
  if (!frameStoreOn() || !grid) return;
  const key = setKeyFor(model || grid.__sourceModel, layer || grid.__componentLayer);
  const index = getPinnedIndexSync(key);
  if (!index) return why('no_index');
  if (grid.ratingMode) return why('rating');
  const info = setFor(key, index);
  // Which stored frame is it? Its served time when it carries one; else its product id through the run index (the
  // useMarineWindData conform drops served_valid_time but keeps productId; a /grid valid_time only echoes the ask); else a
  // series frame's own valid time.
  const pidVt = grid.productId ? info.byPid.get(grid.productId) : null;
  const served = grid.served_valid_time || pidVt || (grid.__fromSeries ? grid.valid_time : null);
  if (!served) return why('no_served_time');
  const vt = new Date(Date.parse(served)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // Plan the prefetch around what is on screen FIRST, packed or not (at load the first frame's pack is often still out).
  noteStep({ model: model || grid.__sourceModel, layer: layer || grid.__componentLayer, hourOffset: hour, requestedValidTime: vt, commit: true });
  const e = store().entry(info.key, vt);
  // Compare with what the engine HOLDS: setWaveData trims dead edge rows (trimDeadEdges), so a world frame's texture is
  // 181 x 81 while the committed grid says 181 x 83; the pack is trimmed the same way.
  const engine = rt.target && rt.target.getEngine ? rt.target.getEngine() : null;
  if (!e) return why('not_indexed');
  if (CS.noteCropCommitted(info, vt, grid)) return why('resident_crop');   // a window of this frame (marineFrameStoreCrop)
  if (!e.pack) {
    // Committed before its own pack landed (the prefetch or the idle pack is still out): resolve when it lands.
    if (engine) rt.pendingResident = { setKey: info.key, validTime: vt, cols: engine._texWidth, rows: engine._texHeight };
    return why(`not_packed_${e.state}`);
  }
  if (!engine || engine._texWidth !== e.pack.cols || engine._texHeight !== e.pack.rows) return why('dims_differ');
  why('resident');
  rt.resident = { setKey: info.key, validityHash: e.pack.validityHash, validityBits: e.pack.validityBits || null, cols: e.pack.cols, rows: e.pack.rows, signature: packSignature() };
}

/** Every scrub step (and every normal commit): keep the prefetch plan on the cursor. */
export function noteStep({ model, layer, requestedValidTime, commit = false } = {}) {
  if (!frameStoreOn() || W().__RAW_DISABLE_FRAME_PREFETCH__ === true || !rt.target) return;
  ensureInit();
  const key = setKeyFor(model, layer);
  const index = getPinnedIndexSync(key);
  if (!index) return;
  const info = setFor(key, index);
  const frame = pickIndexFrame(index, Date.parse(requestedValidTime));
  const cursor = frame ? info.layerOf.get(frame.valid_time) : undefined;
  if (cursor === undefined) return;
  if (rt.activeKey !== info.key) {
    rt.intent.switchTo(info.key, cursor); rt.activeKey = info.key;
    if (!(rt.want && rt.want.setKey === info.key)) rt.want = null;
    for (const v of info.validTimes) uploadGpu(info, v);   // a set that was warm: its packed frames join the GPU now
  } else if (!commit) rt.intent.press(cursor);
  rt.lastStep = { model, layer, requestedValidTime };
  if (!commit) rt.lastPressAt = Date.now();       // a wheel step or a model click: warm frames wait for the rest
  const st = rt.intent.state(); const t = store().tier;
  const slow = t === 'constrained';
  // EAGER (a lever, OFF by default: egress): the whole series from the first draw, not only after the wheel moved 4 frames.
  const eager = W().__RAW_FRAME_PREFETCH_EAGER__ === true && !slow;
  // IDLE FILL: the whole series too, but only once armIdleFill granted it for this set (first frames landed, idle, allowed).
  const fill = rt.fill.key === info.key && !idleFillBlocker();
  rt.fill.planned = fill;
  const plan = planWant({ active: { key: info.key, validTimes: info.validTimes, built: (v) => !!(info.byVt.get(v) || {}).path },
    cursor, dir: st.dir, expanded: st.expanded || eager || fill, warm: warmPlan(info, layer, requestedValidTime), slow, full: store().budget.full });
  rt.prefetcher.replan(plan, info.key, { slow });
  const eng = rt.target.getEngine && rt.target.getEngine();
  if (eng && eng._waveData) {                                    // never before the first marine draw
    if (rt.openedAt === null) rt.openedAt = nowMs();
    rt.prefetcher.open();
    armIdleFill();
  }
  publishTelemetry();
}

/**
 * The fast path: put the stored frame for (model, layer, requested valid time) on screen now. Returns true when it did; false
 * (with the reason counted) when the normal path must do it. Never throws.
 */
export function tryShowStoredFrame(args) {
  return showStored(args, false);
}

/**
 * INSTANT MODEL TOGGLE (Stage A): the same, at a model switch. The resident is another model's frame, so the show carries this
 * frame's own chl/bath (computed now when a warm frame's are not ready yet, ~63 ms once). The orchestrator calls it at the click;
 * its coalesced fetch still follows and commits the same frame. Kill: window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true.
 */
export function tryShowStoredFrameForSwitch(args) {
  if (W().__RAW_DISABLE_FRAME_MODEL_TOGGLE__ === true) return false;
  const t0 = nowMs();
  rt.switches.asked += 1;
  const ok = showStored(args, true);
  if (ok) { rt.switches.shown += 1; rt.switches.lastMs = +(nowMs() - t0).toFixed(3); }
  return ok;
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
const sameBounds = (a, b) => !!(a && b) && near(a.west, b.west) && near(a.east, b.east) && near(a.south, b.south) && near(a.north, b.north);

// May this frame go on screen with its OWN chl/bath (whatever the resident is)? Returns the aux bytes, or the reason it may not.
function auxShowable(engine, wg, e, info, validTime, layer, switching) {
  if (W().__RAW_DISABLE_FRAME_AUX_SHOW__ === true) return 'killed';
  const wd = engine._waveData;
  if (!engine._residentChlTex || !engine._residentBathTex || wd.u_chlorophyllTexture !== engine._residentChlTex
    || wd.u_bathymetryTexture !== engine._residentBathTex || (wd.u_waveTexture && wd.u_waveTexture !== engine._residentWaveTex)) return 'textures';
  if (wg.ratingMode || (wg.__componentLayer || 'waves') !== (layer || 'waves')) return 'flavor';
  if (engine._texWidth !== e.pack.cols || engine._texHeight !== e.pack.rows || wg.cols !== e.pack.cols || wg.rows !== e.pack.rows) return 'dims';
  if (!sameBounds(wd.bounds || wg.bounds, e.pack.bounds)) return 'bounds';
  const now = nowMs();
  const cached = auxFor(info.key, validTime, e, false);
  if (cached) return cached;
  // Computed now only on a desktop tier (~63 ms; a phone would block its main thread several times longer), and on a scrub step
  // at most once a second (a drag never pays it on every step).
  if (store().tier !== 'desktop' || (!switching && now - rt.auxSyncAt < AUX_SYNC_EVERY_MS)) return 'aux_not_ready';
  rt.auxSyncAt = now;
  return auxFor(info.key, validTime, e, true, 'sync') || 'aux_failed';
}

function showStored({ model, layer, hourOffset, requestedValidTime }, switching) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  rt.want = null;                                   // a new step supersedes any deferred show
  try {
    if (!frameStoreOn()) return false;
    if (!rt.target) return miss('no_target');
    // ICON past 168 h is drawn from a client-side blend (backendWeatherServiceClient -> fetchBackendMarineGridIconExtended), never
    // its stored frame, unless the build reads the stored tail: the store never shows a frame the normal path will not draw.
    if (model === 'ICON' && hourOffset > 168 && process.env.REACT_APP_ICON_STORED_TAIL !== 'true') return miss('icon_blend_hour');
    const key = setKeyFor(model, layer);
    const index = getPinnedIndexSync(key);
    if (!index) return miss('no_index');
    const frame = pickIndexFrame(index, Date.parse(requestedValidTime));
    if (!frame) return miss('no_frame_in_window');
    if (!frame.path) return miss('unbuilt_frame');
    const info = setFor(key, index);
    if (CS.cropResidentFor(info)) return CS.showCropFrame(info, index, frame, { model, layer, hourOffset, requestedValidTime }, t0);
    if (switching && CS.cropResidentOther(info)) return CS.showCropSwitch(info, index, frame, { model, layer, hourOffset, requestedValidTime }, t0);
    const e = store().lookup(info.key, frame.valid_time);
    if (!e || !e.pack) {
      rt.want = { args: { model, layer, hourOffset, requestedValidTime }, switching, setKey: info.key, validTime: frame.valid_time, at: Date.now() };
      return miss('not_ready');
    }
    const engine = rt.target.getEngine && rt.target.getEngine();
    const gl = rt.target.getGl && rt.target.getGl();
    const tex = engine && engine._residentWaveTex;
    const wg = engine && engine._waveData && engine._waveData.waveGrid;
    if (!engine || !gl || !tex || !wg) return miss('no_engine');
    const r = rt.resident;
    // The resident path: the resident is this set's frame, and its chl/bath follow ITS mask until the next normal commit (a show
    // leaves rt.resident's mask as it was). Otherwise (another model, a /grid frame, too many cells apart) the exact aux path.
    let why = null; let maskCells = 0; let aux = null;
    if (!r || r.setKey !== info.key || r.signature !== packSignature()) why = 'resident_not_this_set';
    else if (r.validityHash !== e.pack.validityHash) {
      if (W().__RAW_DISABLE_FRAME_VALIDITY_TOLERANCE__ === true) why = 'validity_differs';
      else {
        maskCells = validityDiff(r.validityBits, e.pack.validityBits);
        if (!(maskCells <= VALIDITY_TOLERANCE_CELLS)) why = 'validity_differs';
      }
    }
    if (why) {
      const got = auxShowable(engine, wg, e, info, frame.valid_time, layer, switching);
      if (typeof got === 'string') { rt.shows.auxMiss = { ...(rt.shows.auxMiss || {}), [got]: ((rt.shows.auxMiss || {})[got] || 0) + 1 }; return miss(why); }
      aux = got; maskCells = 0;
    }
    if (engine._texWidth !== e.pack.cols || engine._texHeight !== e.pack.rows || wg.cols !== e.pack.cols || wg.rows !== e.pack.rows) return miss('dims_differ');
    if (aux && !(uploadBytesTo2D(gl, engine._residentChlTex, aux.chl, aux.cols, aux.rows)
      && uploadBytesTo2D(gl, engine._residentBathTex, aux.bath, aux.cols, aux.rows))) { rt.resident = null; return miss('copy_failed'); }
    let ok = false;
    if (e.layer !== null && rt.pool && rt.pool.has(info.key)) ok = rt.pool.copyToTexture(info.key, e.layer, tex);
    if (!ok) dropDeadPool();                       // a lost context: never trust the array again; the CPU bytes below are exact
    if (!ok && e.packed) ok = uploadBytesTo2D(gl, tex, e.packed, e.pack.cols, e.pack.rows);
    if (!ok) { if (aux) rt.resident = null; return miss('copy_failed'); }   // chl/bath already moved: no resident is known
    const meta = frameMeta(index, frame);
    const ask = requestedValidTime;
    const crossModel = (wg.__sourceModel || 'GFS') !== model;
    engine._waveData.waveGrid = { ...wg, hourOffset, valid_time: ask, served_valid_time: frame.valid_time, run_time: meta.run_time ?? wg.run_time,
      model_run_time: meta.model_run_time ?? wg.model_run_time, productId: meta.product_id || wg.productId, __servedProductId: meta.product_id || null,
      is_estimated: !!meta.is_estimated, __fromFrameStore: true,
      ...(crossModel ? { __sourceModel: model, provider: meta.provider ?? wg.provider, estimate_basis: meta.estimate_basis ?? null } : {}) };
    if (aux) {
      // The engine now holds exactly this frame (wave bytes and its own chl/bath): it is the resident a later step compares with.
      rt.resident = { setKey: info.key, validityHash: e.pack.validityHash, validityBits: e.pack.validityBits || null, cols: e.pack.cols, rows: e.pack.rows, signature: packSignature() };
      rt.shows.aux = (rt.shows.aux || 0) + 1;
      if (crossModel) rt.shows.crossModel = (rt.shows.crossModel || 0) + 1;
    }
    publishMarineDrawn(engine._waveData.waveGrid, { hour: hourOffset, layer, model });
    const map = rt.target.getMap && rt.target.getMap();
    if (map && typeof map.triggerRepaint === 'function') map.triggerRepaint();
    rt.shows.n += 1;
    if (maskCells > 0) { rt.shows.maskTolerated = (rt.shows.maskTolerated || 0) + 1; rt.shows.maskCellsMax = Math.max(rt.shows.maskCellsMax || 0, maskCells); }
    rt.shows.lastMs = +(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)).toFixed(3);
    return true;
  } catch (err) {
    return miss('error');
  } finally {
    publishTelemetry();
  }
}

function snapshot() {
  return {
    on: frameStoreOn(), ...(rt.store ? rt.store.telemetry() : {}),
    prefetch: rt.prefetcher ? rt.prefetcher.telemetry() : null, gpu: rt.pool ? rt.pool.telemetry() : null,
    shows: { ...rt.shows, misses: { ...rt.shows.misses } }, resident: rt.resident, commits: { ...rt.commits },
    aux: { ...rt.auxStats, cached: rt.aux.size }, switches: { ...rt.switches },
    fill: { ...rt.fill, blockedNow: rt.store ? idleFillBlocker() : null, sinceOpenMs: sinceOpen() },
    crop: CS.telemetry(),
  };
}
// A live getter: every read is current (a prefetch lands between scrub steps, so a snapshot taken at a step would lag).
function publishTelemetry() {
  if (typeof window === 'undefined') return;
  const d = Object.getOwnPropertyDescriptor(window, '__RAW_FRAME_STORE__');
  if (!d || d.get !== snapshot) Object.defineProperty(window, '__RAW_FRAME_STORE__', { configurable: true, enumerable: false, get: snapshot });
}

/** Test hook. */
export function _resetFrameStoreRuntimeForTest() {
  if (rt.unhook) rt.unhook();
  if (rt.pool) rt.pool.dispose();
  if (rt.onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', rt.onVis);
  if (rt.onVis && rt.onConn && typeof rt.onConn.removeEventListener === 'function') rt.onConn.removeEventListener('change', rt.onVis);
  if (rt.warmTimer) clearTimeout(rt.warmTimer);
  Object.assign(rt, { store: null, prefetcher: null, intent: createIntent(), pool: null, poolDims: null, target: null, unhook: null,
    resident: null, pendingResident: null, want: null, sets: new Map(), shows: { n: 0, misses: {}, lastMs: null }, activeKey: null, commits: {},
    fill: freshFill(), lastStep: null, openedAt: null, onVis: null, onConn: null, ...freshAux() });
  CS.reset();
}
