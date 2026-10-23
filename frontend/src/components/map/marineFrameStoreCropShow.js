/**
 * marineFrameStoreCropShow.js — the GPU frame store's CROP show, wired: the mid-zoom clip resident (#459) and instant model toggles on
 * it (#458). Moved out of marineFrameStoreRuntime.js (2026-10-22) to keep that file under the 800-line cap; the runtime creates ONE
 * instance over its own state (`rt`, `store`, `miss`, `deferredShow`), so behaviour is the same as when this lived inline.
 * The packing (frameWindowOf, packWindow, the LRU) is marineFrameStoreCrop.js; this module is the runtime half.
 */
import { cropAheadChains, cropAheadCount, cropAheadOrder, cropShowOn, cropToleranceCells, createCropPacks, frameWindowOf, packWindow } from './marineFrameStoreCrop';
import { loadFrameParsed } from './staticFrames';
import { frameMeta } from './staticFrameCodec';
import { packSignature, validityDiff } from './marineFramePack';
import { uploadBytesTo2D } from './marineFrameStoreGpu';
import { publishMarineDrawn } from './marineDrawnFrame';
import { auxForPack } from './marineFrameAux';

export function createCropShow({ rt, store, miss, deferredShow, W, nowMs, AUX_CAP, VALIDITY_TOLERANCE_CELLS, supersedeStash, idleFillBlocker = () => 'none' }) {
  // ── THE CROP SHOW (2026-10-22, marineFrameStoreCrop.js) ───────────────────────────────────────────────────────────────────────
  // At mid zoom the resident is a viewport CLIP of the frame (staticFrameCrop), not the world frame. While such a window is resident,
  // every frame this module sees parsed also gets the window's exact pack, and a step shows that pack (texSubImage2D into the
  // resident texture; a 27 x 20 window is 2 KB). Kill: window.__RAW_DISABLE_FRAME_STORE_CROP__ = true.
  // A new window's packs are built ahead for the stored frames (marineFrameStoreCrop.cropAheadCount: every one on a desktop that
  // fills the run, else the cursor +-24 / +-8), nearest the frame where the window appeared first; the rest are built as they are
  // stepped to (a miss, then the deferred show) or parsed.
  const crop = { packs: createCropPacks(), window: null, pending: null, resident: null, building: new Set(), built: 0, shows: 0, ahead: 0, queue: null };
  const idleRun = (fn) => { if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 200 }); else setTimeout(fn, 0); };

  // The window a set may have packs for: the resident set's own, or (instant model toggles at mid zoom) another set's when its run
  // lattice is the window's (packWindow refuses any frame on another lattice either way).
  const nearL = (a, b) => !!(a && b) && ['west', 'south', 'east', 'north'].every((k) => Math.abs(a[k] - b[k]) < 1e-6);
  function cropWindowFor(info) {
    const w = crop.window;
    if (!w || !cropShowOn() || !info) return null;
    if (w.setKey === info.key) return w;
    const g = info.index && info.index.grid;
    return w.lattice && g && g.cols === w.lattice.cols && g.rows === w.lattice.rows && nearL(g.bounds, w.lattice.bounds) ? w : null;
  }

  // The window's pack for a parsed frame of a set on the window's lattice; then the pending resident and a deferred show that waited.
  function cropFromParsed(info, validTime, parsed, now = false) {
    const w = cropWindowFor(info);
    if (!w || !parsed || crop.packs.has(info.key, validTime, w.key)) return;
    const run = () => {
      const w2 = cropWindowFor(info);
      if (!w2 || w2.key !== w.key || crop.packs.has(info.key, validTime, w2.key)) return;
      let p = null;
      try { p = packWindow(parsed, w2); } catch (e) { p = null; }
      if (!p) return;
      crop.packs.put(info.key, validTime, w2.key, p);
      crop.built += 1;
      resolveCropPending(info, validTime);
      deferredShow(info, validTime);
    };
    if (now) run(); else idleRun(run);
  }

  // Build one window pack through #422's shared loader (the frame's bytes are usually in the HTTP cache already). `priority`:
  // 'high' for the frame a step or a click needs now, 'low' for build-ahead and warm sets (staticFrames.fetchPriorityOf).
  function buildCrop(info, validTime, priority) {
    const w = cropWindowFor(info);
    const frame = info.byVt.get(validTime);
    if (!w || !frame || !frame.path || crop.packs.has(info.key, validTime, w.key)) return null;
    const id = `${info.key}|${validTime}|${w.key}`;
    if (crop.building.has(id)) return null;
    crop.building.add(id);
    return loadFrameParsed(info.staticKey, frame, undefined, { priority })
      .then((got) => { if (got) cropFromParsed(info, validTime, got.parsed, true); })
      .catch(() => {})
      .finally(() => crop.building.delete(id));
  }

  // A new window (or a model switch onto it): build the packs of the stored frames nearest `validTime` in idle time. Only frames the
  // store already holds (their bytes were fetched under the store's own egress policy); frames that land later get theirs as they are
  // parsed. Each build re-reads the frame through the shared loader (the HTTP cache when it is warm; with the cache off, a download
  // outside the prefetch limiter), and every pan is a new window: hence the whole run only where the run is filled anyway (2026-10-22
  // pass 2: a far jump after a new window missed beyond +-24), on two chains there. The latest call owns the queue.
  function buildAhead(info, validTime) {
    const idx = new Map(info.validTimes.map((v, i) => [v, i]));
    const at = idx.get(validTime);
    if (at === undefined) return;
    const fills = !idleFillBlocker();
    const ahead = cropAheadCount({ tier: store().tier, fills });
    const stored = info.validTimes.filter((v) => { const e = store().entry(info.key, v); return !!(e && e.pack); });
    const winKey = crop.window && crop.window.key;
    const q = (crop.queue = { setKey: info.key, winKey, list: cropAheadOrder(stored, (v) => idx.get(v), at).slice(0, ahead) });
    const next = () => {
      if (crop.queue !== q || !crop.window || crop.window.key !== winKey || !q.list.length) return;
      const p = buildCrop(info, q.list.shift(), 'low');
      crop.ahead += p ? 1 : 0;
      (p || Promise.resolve()).then(() => idleRun(next));
    };
    for (let i = 0; i < cropAheadChains({ fills }); i++) idleRun(next);
  }

  // The ENGINE holds that clip: the same texture size and the same (trimmed) bounds. A commit the guard refused, or a world frame
  // that replaced the clip, is told apart by this, never by which grid was last offered.
  const nearB = (a, b) => ['west', 'south', 'east', 'north'].every((k) => Math.abs(a[k] - b[k]) < 1e-6);
  // IDENTITY TOO (2026-10-22, #458 on #461): a clip of ANOTHER model (a normal EURO/ICON commit, which the store no longer
  // indexes) or a rating grid of the same box has the same size and bounds; it is not this resident either.
  const idOf = (r) => { const [m, l] = String(r.setKey || '').split('/'); return { model: r.model || m || 'GFS', layer: r.layer || l || 'waves' }; };
  function engineHolds(r) {
    const engine = rt.target && rt.target.getEngine ? rt.target.getEngine() : null;
    const wg = engine && engine._waveData && engine._waveData.waveGrid;
    const id = idOf(r);
    return !!(engine && wg && wg.bounds && engine._texWidth === r.cols && engine._texHeight === r.rows && nearB(wg.bounds, r.bounds)
      && (wg.__sourceModel || 'GFS') === id.model && (wg.__componentLayer || 'waves') === id.layer && !wg.ratingMode);
  }

  // A normal commit of a set the store does not index (EURO/ICON since #461: /grid's world Gulf fill) that is a clip of a known run
  // lattice: remember the window as a FOREIGN resident, so a model click back to an indexed set (GFS) still shows that set's
  // window with its own chl/bath (showCropSwitch). Anything else ends the crop resident.
  function noteForeignCommit(grid, model, layer) {
    if (!cropShowOn() || !grid) return;
    const lat = [...rt.sets.values()].find((x) => x.index && x.index.grid && String(x.staticKey || '').split('/')[2] === (layer || 'waves'));
    const win = lat ? frameWindowOf(grid, lat.index.grid) : null;
    const engine = rt.target && rt.target.getEngine ? rt.target.getEngine() : null;
    const wg = engine && engine._waveData && engine._waveData.waveGrid;
    if (!win || !wg || !wg.bounds || grid.ratingMode) { Object.assign(crop, { resident: null, window: null, pending: null }); return; }
    const r = { setKey: null, foreign: true, model: model || 'GFS', layer: layer || 'waves', crop: true,
      window: { c0: win.c0, r0: win.r0, cols: win.cols, rows: win.rows, key: win.key }, bounds: { ...wg.bounds },
      validityHash: null, validityBits: null, cols: engine._texWidth, rows: engine._texHeight, signature: packSignature() };
    if (!engineHolds(r)) { Object.assign(crop, { resident: null, window: null, pending: null }); return; }   // the engine refused it
    Object.assign(crop, { window: { ...win, setKey: null }, pending: null, resident: r });
  }

  // After a normal commit. A window of frame `validTime`: remember it (the resident is known once its own window pack exists). Any
  // other grid: keep the clip resident only while the engine still holds it (the guard may have refused the commit).
  function noteCropCommitted(info, validTime, grid) {
    const own = info.byVt.get(validTime);                     // a frame on its own lattice (frame.grid) is windowed on that one
    const win = cropShowOn() ? frameWindowOf(grid, (own && own.grid) || (info.index && info.index.grid)) : null;
    if (!win) {
      if (crop.resident && !engineHolds(crop.resident)) Object.assign(crop, { resident: null, window: null, pending: null });
      return false;
    }
    const fresh = !(crop.window && crop.window.key === win.key && crop.window.setKey === info.key);
    crop.window = { ...win, setKey: info.key };
    crop.pending = { setKey: info.key, validTime, winKey: win.key };
    if (crop.packs.get(info.key, validTime, win.key, packSignature())) resolveCropPending(info, validTime);
    else buildCrop(info, validTime, 'high');
    if (fresh) { buildAhead(info, validTime); cropWarm(); }
    return true;
  }

  // The warm frames (other models at the cursor +-1, warmPlan) get the resident window's packs too, so a model click at mid zoom
  // finds the new model's window ready. Through the shared loader, deduped; a no-op without a window or a warm plan.
  function cropWarm() {
    for (const w of rt.lastWarm) {
      const wi = [...rt.sets.values()].find((x) => x.key === w.key);
      if (wi) buildCrop(wi, w.validTime, 'low');
    }
  }

  function resolveCropPending(info, validTime) {
    const pd = crop.pending; const w = crop.window;
    if (!pd || !w || pd.setKey !== info.key || pd.validTime !== validTime || pd.winKey !== w.key) return;
    const p = crop.packs.get(info.key, validTime, w.key, packSignature());
    if (!p) return;
    crop.pending = null;
    const r = { setKey: info.key, crop: true, window: { c0: w.c0, r0: w.r0, cols: w.cols, rows: w.rows, key: w.key }, bounds: { ...p.bounds },
      validityHash: p.validityHash, validityBits: p.validityBits || null, cols: p.cols, rows: p.rows, signature: p.signature };
    if (!engineHolds(r)) { crop.resident = null; rt.commits.crop_not_resident = (rt.commits.crop_not_resident || 0) + 1; return; }
    crop.resident = r;
  }

  // tryShowStoredFrame's first question: is a clip of this lattice resident? (Checked against the engine on every step.)
  function cropResidentFor(info) {
    const r = crop.resident;
    if (!r || !cropShowOn()) return null;
    if (!engineHolds(r)) { Object.assign(crop, { resident: null, window: null, pending: null }); return null; }
    return r.setKey === info.key ? r : null;
  }

  function showCropFrame(info, index, frame, { model, layer, hourOffset, requestedValidTime }, t0) {
    const r = crop.resident;
    if (r.signature !== packSignature()) return miss('resident_not_this_set');
    const p = crop.packs.get(info.key, frame.valid_time, r.window.key, r.signature);
    if (!p) {
      rt.want = { args: { model, layer, hourOffset, requestedValidTime }, switching: false, setKey: info.key, validTime: frame.valid_time, at: Date.now() };
      buildCrop(info, frame.valid_time, 'high');
      return miss('crop_not_ready');
    }
    const engine = rt.target.getEngine && rt.target.getEngine();
    const gl = rt.target.getGl && rt.target.getGl();
    const tex = engine && engine._residentWaveTex;
    const wg = engine && engine._waveData && engine._waveData.waveGrid;
    if (!engine || !gl || !tex || !wg) return miss('no_engine');
    let maskCells = 0;
    if (r.validityHash !== p.validityHash) {
      if (W().__RAW_DISABLE_FRAME_VALIDITY_TOLERANCE__ === true) return miss('validity_differs');
      maskCells = validityDiff(r.validityBits, p.validityBits);
      if (!(maskCells <= cropToleranceCells(p.cols * p.rows, VALIDITY_TOLERANCE_CELLS))) return miss('validity_differs');   // scaled to the window
    }
    if (engine._texWidth !== p.cols || engine._texHeight !== p.rows || wg.cols !== p.cols || wg.rows !== p.rows) return miss('dims_differ');
    if (!uploadBytesTo2D(gl, tex, p.bytes, p.cols, p.rows)) return miss('copy_failed');
    const meta = frameMeta(index, frame);
    engine._waveData.waveGrid = { ...wg, hourOffset, valid_time: requestedValidTime, served_valid_time: frame.valid_time, run_time: meta.run_time ?? wg.run_time,
      model_run_time: meta.model_run_time ?? wg.model_run_time, productId: meta.product_id || wg.productId, __servedProductId: meta.product_id || null,
      is_estimated: !!meta.is_estimated, __fromFrameStore: true };
    supersedeStash(engine, { model, layer, productId: meta.product_id || null, hourOffset });
    publishMarineDrawn(engine._waveData.waveGrid, { hour: hourOffset, layer, model });
    const map = rt.target.getMap && rt.target.getMap();
    if (map && typeof map.triggerRepaint === 'function') map.triggerRepaint();
    rt.shows.n += 1; crop.shows += 1;
    if (maskCells > 0) { rt.shows.maskTolerated = (rt.shows.maskTolerated || 0) + 1; rt.shows.maskCellsMax = Math.max(rt.shows.maskCellsMax || 0, maskCells); }
    rt.shows.lastMs = +(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)).toFixed(3);
    return true;
  }

  // A clip of ANOTHER set (the previous model) is resident and the engine holds it: a model click may show this set's window.
  function cropResidentOther(info) {
    const r = crop.resident;
    if (!r || !cropShowOn() || r.setKey === info.key) return null;
    if (!engineHolds(r)) { Object.assign(crop, { resident: null, window: null, pending: null }); return null; }
    return cropWindowFor(info) ? r : null;
  }

  // The window's exact chl/bath (marineFrameAux on the window pack: the encoder's function on the clip's own masks). A window is
  // small (27 x 20 = 540 cells against the world's 15,023), so this is computed at the click on any tier; cached with the world aux.
  function cropAuxFor(setKey, validTime, winKey, p) {
    const id = `${setKey}@${validTime}#${winKey}`;
    const hit = rt.aux.get(id);
    if (hit && hit.validityHash === p.validityHash && hit.cols === p.cols && hit.rows === p.rows) { rt.aux.delete(id); rt.aux.set(id, hit); return hit; }
    const t1 = nowMs();
    let a = null;
    try { a = auxForPack(p); } catch (err) { a = null; }
    rt.auxStats.lastMs = +(nowMs() - t1).toFixed(1);
    if (!a) { rt.auxStats.failed += 1; return null; }
    rt.auxStats.computed += 1; rt.auxStats.crop = (rt.auxStats.crop || 0) + 1;
    rt.aux.set(id, a);
    while (rt.aux.size > AUX_CAP) rt.aux.delete(rt.aux.keys().next().value);
    return a;
  }

  // INSTANT MODEL TOGGLE AT MID ZOOM (2026-10-22, #458 on #459): the resident is a clip of the previous model's frame; show the new
  // model's window of its frame with the window's OWN chl/bath, so the engine then holds exactly that clip, and it becomes the crop
  // resident (later steps on the new model take showCropFrame). Same checks as the world switch: resident textures in use, the same
  // size and trimmed bounds. Kills: __RAW_DISABLE_FRAME_MODEL_TOGGLE__ (no switch show), __RAW_DISABLE_FRAME_AUX_SHOW__ (no exact
  // chl/bath shows), __RAW_DISABLE_FRAME_STORE_CROP__ (no crop shows).
  function showCropSwitch(info, index, frame, { model, layer, hourOffset, requestedValidTime }, t0) {
    const auxMiss = (why) => { rt.shows.auxMiss = { ...(rt.shows.auxMiss || {}), [why]: ((rt.shows.auxMiss || {})[why] || 0) + 1 }; return miss('crop_switch_refused'); };
    if (W().__RAW_DISABLE_FRAME_AUX_SHOW__ === true) return auxMiss('killed');
    const w = cropWindowFor(info);
    if (!w) return auxMiss('lattice');
    const sig = packSignature();
    const p = crop.packs.get(info.key, frame.valid_time, w.key, sig);
    if (!p) {
      rt.want = { args: { model, layer, hourOffset, requestedValidTime }, switching: true, setKey: info.key, validTime: frame.valid_time, at: Date.now() };
      buildCrop(info, frame.valid_time, 'high');
      return miss('crop_not_ready');
    }
    const engine = rt.target.getEngine && rt.target.getEngine();
    const gl = rt.target.getGl && rt.target.getGl();
    const tex = engine && engine._residentWaveTex;
    const wd = engine && engine._waveData;
    const wg = wd && wd.waveGrid;
    if (!engine || !gl || !tex || !wg) return miss('no_engine');
    if (!engine._residentChlTex || !engine._residentBathTex || wd.u_chlorophyllTexture !== engine._residentChlTex
      || wd.u_bathymetryTexture !== engine._residentBathTex || (wd.u_waveTexture && wd.u_waveTexture !== engine._residentWaveTex)) return auxMiss('textures');
    if (wg.ratingMode || (wg.__componentLayer || 'waves') !== (layer || 'waves')) return auxMiss('flavor');
    if (engine._texWidth !== p.cols || engine._texHeight !== p.rows || wg.cols !== p.cols || wg.rows !== p.rows) return auxMiss('dims');
    if (!nearL(wg.bounds, p.bounds)) return auxMiss('bounds');
    const aux = cropAuxFor(info.key, frame.valid_time, w.key, p);
    if (!aux) return auxMiss('aux_failed');
    if (!(uploadBytesTo2D(gl, engine._residentChlTex, aux.chl, aux.cols, aux.rows) && uploadBytesTo2D(gl, engine._residentBathTex, aux.bath, aux.cols, aux.rows)
      && uploadBytesTo2D(gl, tex, p.bytes, p.cols, p.rows))) { Object.assign(crop, { resident: null, pending: null }); return miss('copy_failed'); }
    const meta = frameMeta(index, frame);
    engine._waveData.waveGrid = { ...wg, hourOffset, valid_time: requestedValidTime, served_valid_time: frame.valid_time, run_time: meta.run_time ?? wg.run_time,
      model_run_time: meta.model_run_time ?? wg.model_run_time, productId: meta.product_id || wg.productId, __servedProductId: meta.product_id || null,
      is_estimated: !!meta.is_estimated, __fromFrameStore: true, __sourceModel: model, provider: meta.provider ?? wg.provider, estimate_basis: meta.estimate_basis ?? null };
    // The engine now holds exactly this clip of this set: the crop resident (its own masks), and the window belongs to this set.
    crop.window = { ...w, setKey: info.key };
    crop.pending = null;
    crop.resident = { setKey: info.key, crop: true, window: { c0: w.c0, r0: w.r0, cols: w.cols, rows: w.rows, key: w.key }, bounds: { ...p.bounds },
      validityHash: p.validityHash, validityBits: p.validityBits || null, cols: p.cols, rows: p.rows, signature: p.signature };
    buildAhead(info, frame.valid_time);
    supersedeStash(engine, { model, layer, productId: meta.product_id || null, hourOffset });
    publishMarineDrawn(engine._waveData.waveGrid, { hour: hourOffset, layer, model });
    const map = rt.target.getMap && rt.target.getMap();
    if (map && typeof map.triggerRepaint === 'function') map.triggerRepaint();
    rt.shows.n += 1; crop.shows += 1;
    rt.shows.aux = (rt.shows.aux || 0) + 1; rt.shows.crossModel = (rt.shows.crossModel || 0) + 1; rt.shows.cropSwitch = (rt.shows.cropSwitch || 0) + 1;
    rt.shows.lastMs = +(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)).toFixed(3);
    return true;
  }


  return {
    crop, cropFromParsed, buildCrop, noteCropCommitted, noteForeignCommit, cropResidentFor, showCropFrame, cropResidentOther, showCropSwitch,
    telemetry: () => ({ on: cropShowOn(), window: crop.window, resident: crop.resident && { ...crop.resident, validityBits: undefined },
      packs: crop.packs.size(), built: crop.built, shows: crop.shows, ahead: crop.ahead, queued: crop.queue ? crop.queue.list.length : 0, pending: crop.pending }),
    reset: () => Object.assign(crop, { packs: createCropPacks(), window: null, pending: null, resident: null, building: new Set(), built: 0, shows: 0, ahead: 0, queue: null }),
  };
}
