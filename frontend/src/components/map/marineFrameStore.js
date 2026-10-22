/**
 * marineFrameStore.js — the client-side store of forecast frames ready for the GPU (GPU-resident frames, phase 2 step 2).
 * Spec: docs/architecture/gpu-resident-forecast-frames.md sections 3.3 (states), 3.5 (run identity) and 5 (device tiers).
 *
 * Pure bookkeeping: no fetch, no GL, no timers. The prefetcher (marineFramePrefetch.js) fills it and the GPU module
 * (marineFrameStoreGpu.js) mirrors `resident` frames into texture layers. Nothing in the app calls this yet.
 *
 * A SET is one model x layer x domain of ONE run (keyed on `model_run_time`, the cycle that names the frame paths, never the
 * ingest `run_time`) packed under ONE pack signature (marineFramePack.packSignature: theme height scale, kill switches, float
 * type). A frame of a set is, by its valid time:
 *   absent    listed by the index, nothing held
 *   unbuilt   listed with `path: null` (#422 head 75d5318ea): a MISS that /grid serves; never replaced by a neighbour
 *   inflight  a request is out
 *   packed    RGBA8 bytes (+ raw RSWF bytes inside the cursor window, to build vectors at settle) on the CPU
 *   resident  also uploaded to a GPU layer; the handheld tier drops the CPU bytes once resident
 * Budgets are FIXED per tier (no API reports GPU memory; spec 1.4). Eviction is LRU by set, then by frame, and never touches
 * the frames the caller protects (the cursor's neighbours).
 */

export const TIERS = {
  desktop: { gpuBytes: 64 << 20, cpuBytes: 48 << 20, keepPackedWhenResident: true, full: true, interp: true },
  handheld: { gpuBytes: 16 << 20, cpuBytes: 12 << 20, keepPackedWhenResident: false, full: true, interp: true },
  constrained: { gpuBytes: 8 << 20, cpuBytes: 6 << 20, keepPackedWhenResident: false, full: false, interp: false },
  webgl1: { gpuBytes: 8 << 20, cpuBytes: 12 << 20, keepPackedWhenResident: true, full: true, interp: false },
};

/**
 * The device tier from facts the app already has (deviceTier.isHandheldDevice / isWeakDevice, navigator.deviceMemory and
 * connection, the GL context). `window.__RAW_FRAME_STORE_TIER__` forces one for an A/B.
 */
export function resolveTier(facts = {}, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (typeof w.__RAW_FRAME_STORE_TIER__ === 'string' && TIERS[w.__RAW_FRAME_STORE_TIER__]) return w.__RAW_FRAME_STORE_TIER__;
  const { webgl2 = true, maxArrayLayers = 256, frames = 115, handheld = false, weak = false, deviceMemoryGB = null,
    saveData = false, effectiveType = null } = facts;
  if (!webgl2) return 'webgl1';
  if ((deviceMemoryGB !== null && deviceMemoryGB <= 2) || saveData || effectiveType === '2g' || effectiveType === 'slow-2g'
    || effectiveType === '3g' || maxArrayLayers < frames) return 'constrained';
  if (handheld || weak || (deviceMemoryGB !== null && deviceMemoryGB <= 4)) return 'handheld';
  return 'desktop';
}

export function setKeyOf({ model, layer, domain = 'world', modelRunTime, signature }) {
  return `${String(model || '').toUpperCase()}/${String(layer || '').toLowerCase()}/${domain}/${modelRunTime || 'unknown'}/${signature || ''}`;
}

export function createFrameStore({ tier = 'desktop', now = () => Date.now() } = {}) {
  const budget = TIERS[tier] || TIERS.desktop;
  const sets = new Map();
  const stats = { hits: 0, misses: {}, evictions: 0, stale: 0 };
  let cpuBytes = 0; let gpuBytes = 0;

  const frameBytes = (e) => (e.packed ? e.packed.byteLength : 0) + (e.raw ? e.raw.byteLength : 0);
  function miss(reason) { stats.misses[reason] = (stats.misses[reason] || 0) + 1; }

  function ensureSet(desc) {
    const key = setKeyOf(desc);
    let s = sets.get(key);
    if (!s) {
      s = { key, model: desc.model, layer: desc.layer, domain: desc.domain || 'world', modelRunTime: desc.modelRunTime,
        signature: desc.signature, dims: null, frames: new Map(), lastActive: now(), mode: 'INDEXED' };
      sets.set(key, s);
    }
    return s;
  }

  /** Record a run index's frames: `frames` = [{ valid_time, path|null, unbuilt?, meta? }]. Keeps what is already held. */
  function noteIndex(key, frames) {
    const s = sets.get(key);
    if (!s || !Array.isArray(frames)) return;
    for (const f of frames) {
      if (!f || !f.valid_time) continue;
      const prev = s.frames.get(f.valid_time);
      if (prev && prev.state !== 'absent' && prev.state !== 'unbuilt') continue;
      s.frames.set(f.valid_time, { validTime: f.valid_time, path: f.path || null, state: f.path ? 'absent' : 'unbuilt',
        unbuilt: f.path ? null : (f.unbuilt || 'unknown'), packed: null, raw: null, meta: f.meta || null, layer: null, lastUse: 0 });
    }
  }

  function entry(key, validTime) {
    const s = sets.get(key);
    return s ? s.frames.get(validTime) || null : null;
  }

  /** The frame to draw for (set, valid time), or null with the miss reason counted. Never a neighbour. */
  function lookup(key, validTime) {
    const e = entry(key, validTime);
    if (!e) { miss('not_indexed'); return null; }
    if (e.state === 'unbuilt') { miss(`unbuilt_${e.unbuilt}`); return null; }
    if (e.state !== 'packed' && e.state !== 'resident') { miss(e.state); return null; }
    e.lastUse = now();
    const s = sets.get(key); s.lastActive = e.lastUse;
    stats.hits += 1;
    return e;
  }

  function markInflight(key, validTime) {
    const e = entry(key, validTime);
    if (e && e.state === 'absent') { e.state = 'inflight'; return true; }
    return false;
  }

  function markAbsent(key, validTime) {
    const e = entry(key, validTime);
    if (e && e.state === 'inflight') e.state = 'absent';
  }

  /** The frame landed but cannot be packed (out of the packer's scope): a terminal miss, never fetched again for this set. */
  function markUnpackable(key, validTime, reason = 'unpackable') {
    const e = entry(key, validTime);
    if (e && e.state === 'inflight') { e.state = 'unbuilt'; e.unbuilt = reason; }
  }

  /** A packed frame landed. `pack` = marineFramePack.packStaticFrame's result; `raw` = the inflated RSWF bytes or null. */
  function putPacked(key, validTime, pack, raw = null) {
    const s = sets.get(key); const e = entry(key, validTime);
    // A refused pack leaves the frame `inflight`: the caller marks it absent or unpackable (marineFramePrefetch makes it a terminal
    // miss, so a set whose signature went stale is never re-fetched in a loop; the orchestration retires that set).
    if (!s || !e || !pack || pack.signature !== s.signature) { miss('signature'); return false; }
    if (!s.dims) s.dims = { cols: pack.cols, rows: pack.rows, validityHash: pack.validityHash };
    cpuBytes -= frameBytes(e);
    e.packed = pack.bytes; e.raw = raw; e.pack = { cols: pack.cols, rows: pack.rows, bounds: pack.bounds, isGlobal: pack.isGlobal,
      validityHash: pack.validityHash, validityBits: pack.validityBits || null, oceanBitsPost: pack.oceanBitsPost || null, trimmed: pack.trimmed };
    e.state = e.layer !== null ? 'resident' : 'packed'; e.lastUse = now();
    cpuBytes += frameBytes(e);
    return true;
  }

  /** The GPU module uploaded this frame to `layer` (bytes = its GPU size). The handheld tier then drops the CPU copy. */
  function markResident(key, validTime, layer, layerBytes) {
    const e = entry(key, validTime);
    if (!e || !e.packed) return false;
    if (e.layer === null) gpuBytes += layerBytes;
    e.layer = layer; e.gpuBytes = layerBytes; e.state = 'resident';
    if (!budget.keepPackedWhenResident) { cpuBytes -= e.packed.byteLength; e.packed = null; }
    return true;
  }

  /** The GPU module gave this set's array to another set: its frames are no longer resident (CPU bytes, if kept, stay). */
  function dropResidency(key) {
    const s = sets.get(key); if (!s) return 0;
    let n = 0;
    for (const e of s.frames.values()) {
      if (e.layer === null) continue;
      gpuBytes -= e.gpuBytes || 0; e.layer = null; e.gpuBytes = 0; n += 1;
      e.state = e.packed ? 'packed' : (e.path ? 'absent' : 'unbuilt');
    }
    return n;
  }

  /** Drop raw RSWF bytes outside the cursor window (vectors are built only for the settled hour). */
  function trimRaw(key, keepValidTimes) {
    const s = sets.get(key); if (!s) return;
    const keep = new Set(keepValidTimes || []);
    for (const e of s.frames.values()) if (e.raw && !keep.has(e.validTime)) { cpuBytes -= e.raw.byteLength; e.raw = null; }
  }

  function dropFrame(s, e) {
    cpuBytes -= frameBytes(e);
    if (e.layer !== null) gpuBytes -= e.gpuBytes || 0;
    e.packed = null; e.raw = null; e.layer = null; e.gpuBytes = 0;
    e.state = e.path ? 'absent' : 'unbuilt';
    stats.evictions += 1;
  }

  /**
   * Keep both byte counts inside the tier budget: least recently active SET first (never `activeKey`), then least recently
   * used frames of the active set, never one in `protect` (valid times). Returns the evicted [setKey, validTime, layer] so the
   * GPU module can free layers.
   */
  function enforceBudget(activeKey, protect = []) {
    const evicted = [];
    const guard = new Set(protect);
    const over = () => cpuBytes > budget.cpuBytes || gpuBytes > budget.gpuBytes;
    if (!over()) return evicted;
    const others = [...sets.values()].filter((s) => s.key !== activeKey).sort((a, b) => a.lastActive - b.lastActive);
    for (const s of others) {
      for (const e of s.frames.values()) if (e.packed || e.layer !== null) { evicted.push([s.key, e.validTime, e.layer]); dropFrame(s, e); }
      if (!over()) return evicted;
    }
    const act = sets.get(activeKey);
    if (act) {
      const lru = [...act.frames.values()].filter((e) => (e.packed || e.layer !== null) && !guard.has(e.validTime)).sort((a, b) => a.lastUse - b.lastUse);
      for (const e of lru) { evicted.push([act.key, e.validTime, e.layer]); dropFrame(act, e); if (!over()) break; }
    }
    return evicted;
  }

  /** Forget every set whose pack signature or run differs (a theme change, a kill switch, a new pinned run). */
  function retainOnly(predicate) {
    const dropped = [];
    for (const s of [...sets.values()]) {
      if (predicate(s)) continue;
      for (const e of s.frames.values()) if (e.packed || e.layer !== null) { dropped.push([s.key, e.validTime, e.layer]); dropFrame(s, e); }
      sets.delete(s.key); stats.stale += 1;
    }
    return dropped;
  }

  function telemetry() {
    const list = [...sets.values()].map((s) => {
      const c = { absent: 0, unbuilt: 0, inflight: 0, packed: 0, resident: 0 };
      for (const e of s.frames.values()) c[e.state] += 1;
      return { key: s.key, mode: s.mode, dims: s.dims, frames: s.frames.size, ...c };
    });
    return { tier, budget: { gpuMB: budget.gpuBytes / 1048576, cpuMB: budget.cpuBytes / 1048576 },
      gpuMB: +(gpuBytes / 1048576).toFixed(2), cpuMB: +(cpuBytes / 1048576).toFixed(2), sets: list, ...stats };
  }

  return { tier, budget, sets, ensureSet, noteIndex, entry, lookup, markInflight, markAbsent, markUnpackable, putPacked, markResident, dropResidency, trimRaw,
    enforceBudget, retainOnly, telemetry, bytes: () => ({ cpu: cpuBytes, gpu: gpuBytes }) };
}
