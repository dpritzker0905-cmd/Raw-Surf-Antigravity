/**
 * ownRasterDecode.js — decode ONE field of an own-raster frame straight to Float32, off the main thread (2026-11-15, the
 * gusts/currents phone gate; the series decode worker's pattern, #921: an inline Blob worker, transferred buffers, a
 * main-thread fallback, a kill).
 *
 * WHY. The shared path (staticFrames.loadFrameParsed -> parseFrame -> ownRasterFrames.toField) decodes EVERY field of a frame
 * into Float64 on the main thread and then copies the drawn one into Float32: for a 0.25-degree frame that is 1.04 M nodes per
 * field (a currents frame carries two: ~16 MB allocated and three passes per frame, during the prefetch that runs WHILE the
 * user scrubs). On a phone at 4x CPU the profile showed 60-180 ms long tasks around scrub steps. Here the worker decodes only
 * the field the layer draws, writes MISSING for no data, finds min / max in the same pass, and transfers the Float32 back.
 *
 * ONE DECODER. `decodeFieldCore` is self-contained (no imports, no closure) so the SAME function text runs in the worker
 * (Function.prototype.toString) and on the main thread (the fallback: no Worker, a worker error, the kill). It reads the RSWF
 * layout exactly as staticFrameCodec.parseFrame does (encoding 1, transform 1, south-first rows, west-first columns, u8 / u16
 * byte-shuffled / u32 planes, code -> code * scale + offset, the missing code -> no data); ownRasterDecode.test.js pins it
 * against parseFrame + toField value for value.
 * Kill: window.__RAW_DISABLE_RASTER_DECODE_WORKER__ = true (decode on the main thread, same function).
 */

export function decodeFieldCore(buf, fieldId, missingValue, dirFieldId) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (bytes.length < 72 || bytes[0] !== 82 || bytes[1] !== 83 || bytes[2] !== 87 || bytes[3] !== 70) throw new Error('raster frame: bad magic');
  if (dv.getUint16(4, true) !== 1 || dv.getUint16(6, true) !== 1) throw new Error('raster frame: unsupported version');
  const cols = dv.getUint16(8, true); const rows = dv.getUint16(10, true);
  if (dv.getUint8(16) !== 0 || dv.getUint8(17) !== 0) throw new Error('raster frame: unsupported node order');
  const fieldCount = dv.getUint8(18); const headerBytes = dv.getUint32(20, true);
  const bounds = { west: dv.getFloat64(24, true), south: dv.getFloat64(32, true), east: dv.getFloat64(40, true), north: dv.getFloat64(48, true) };
  const validEpoch = dv.getFloat64(56, true); const runEpoch = dv.getFloat64(64, true);
  const n = cols * rows;
  // `fieldId`: one id or a preference list (a one-byte band field first, then its two-byte form: both decode during a rollout)
  const wanted = Array.isArray(fieldId) ? fieldId : [fieldId];
  const present = [];
  for (let f = 0; f < fieldCount; f++) present.push(dv.getUint8(72 + f * 24));
  const pick = wanted.find((id) => present.indexOf(id) >= 0);
  if (pick === undefined) return null;
  // CURRENTS PARTICLES (2026-11-22, currentParticles.js): `dirFieldId` (one id or a preference list) also decodes the flow
  // direction, as one byte a cell (dirCodes: round(deg / 1.40625) mod 256), wherever the drawn field has data; absent = none.
  const dirWanted = dirFieldId === undefined || dirFieldId === null ? [] : (Array.isArray(dirFieldId) ? dirFieldId : [dirFieldId]);
  const dirPick = dirWanted.find((id) => present.indexOf(id) >= 0);
  let out = null; let dirCodes = null;
  let pos = headerBytes;
  for (let f = 0; f < fieldCount; f++) {
    const d = 72 + f * 24;
    const id = dv.getUint8(d); const dtype = dv.getUint8(d + 1); const layout = dv.getUint8(d + 2);
    const missing = dv.getUint32(d + 4, true); const scale = dv.getFloat64(d + 8, true); const offset = dv.getFloat64(d + 16, true);
    if (dtype !== 1 && dtype !== 2 && dtype !== 4) throw new Error(`raster frame: unsupported dtype ${dtype}`);
    const size = n * dtype;
    if (pos + size > bytes.length) throw new Error(`raster frame: truncated field ${id}`);
    if (dirPick !== undefined && id === dirPick) {
      dirCodes = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const code = dtype === 1 ? bytes[pos + k] : (layout === 1 ? (bytes[pos + k] | (bytes[pos + n + k] << 8)) : (bytes[pos + 2 * k] | (bytes[pos + 2 * k + 1] << 8)));
        const deg = code * scale + offset;
        dirCodes[k] = ((Math.round(deg * 256 / 360) % 256) + 256) % 256;
      }
    }
    if (id === pick) {
      const values = new Float32Array(n);
      let min = Infinity; let max = -Infinity;
      const hasMissing = missing !== 0xFFFFFFFF;
      for (let k = 0; k < n; k++) {
        let code;
        if (dtype === 1) code = bytes[pos + k];
        else if (dtype === 2) code = layout === 1 ? (bytes[pos + k] | (bytes[pos + n + k] << 8)) : (bytes[pos + 2 * k] | (bytes[pos + 2 * k + 1] << 8));
        else code = layout === 1
          ? bytes[pos + k] + bytes[pos + n + k] * 256 + bytes[pos + 2 * n + k] * 65536 + bytes[pos + 3 * n + k] * 16777216
          : bytes[pos + 4 * k] + bytes[pos + 4 * k + 1] * 256 + bytes[pos + 4 * k + 2] * 65536 + bytes[pos + 4 * k + 3] * 16777216;
        if (hasMissing && code === missing) { values[k] = missingValue; continue; }
        const v = code * scale + offset;
        values[k] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out = { cols, rows, bounds, values, min, max, validMs: validEpoch * 1000, runMs: Number.isFinite(runEpoch) ? runEpoch * 1000 : null, fieldId: pick };
      if (dirPick === undefined || dirCodes) break;
    }
    pos += size;
  }
  if (out && dirCodes) out.dirCodes = dirCodes;
  return out;
}

const WORKER_SRC = `const decodeFieldCore = ${decodeFieldCore.toString()};
self.onmessage = (e) => {
  const { id, buf, fieldId, missingValue, dirFieldId } = e.data;
  try {
    const out = decodeFieldCore(buf, fieldId, missingValue, dirFieldId);
    if (out) self.postMessage({ id, out }, out.dirCodes ? [out.values.buffer, out.dirCodes.buffer] : [out.values.buffer]);
    else self.postMessage({ id, out: null });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};`;

// FAILURE RULES (the series decode worker's, #921, as Move 3 asked): only a DECODE-stage failure falls back to the main thread,
// and the fallback LATCHES after WORKER_FAIL_LATCH worker deaths (a single crash restarts the worker); a bad frame (the decoder
// throws: stage 'parse') rejects to the caller, whose own backoff retries later. This module never fetches, so no failure here
// can cause a second fetch.
export const WORKER_FAIL_LATCH = 2;
let _worker = null; let _failed = false; let _seq = 0; let _deaths = 0;
const _pending = new Map();
const W = () => (typeof window !== 'undefined' ? window : {});
export const decodeWorkerKilled = () => W().__RAW_DISABLE_RASTER_DECODE_WORKER__ === true;

function worker() {
  if (_worker || _failed) return _worker;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) { _failed = true; return null; }
    _worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    _worker.onmessage = (e) => {
      const p = _pending.get(e.data.id);
      if (!p) return;
      _pending.delete(e.data.id);
      if (e.data.error) { const err = new Error(e.data.error); err.stage = 'parse'; p.reject(err); } else p.resolve(e.data.out);
    };
    _worker.onerror = () => {   // the worker died (stage 'decode'): its waiters decode on the main thread; latch after 2 deaths
      _deaths += 1;
      if (_deaths >= WORKER_FAIL_LATCH) _failed = true;
      for (const p of _pending.values()) p.fallback();
      _pending.clear();
      try { _worker.terminate(); } catch (e) { /* gone */ }
      _worker = null;
    };
  } catch (e) { _failed = true; _worker = null; }
  return _worker;
}

/** Decode one field of a frame buffer (inflated RSWF bytes). Resolves to { cols, rows, bounds, values (Float32, `missingValue`
 *  for no data), min, max, validMs, runMs, offThread } or null when the frame has no such field; rejects on a bad frame. The
 *  buffer is TRANSFERRED to the worker (do not reuse it). */
export function decodeOwnField(buf, fieldId, missingValue, dirFieldId) {
  const w = decodeWorkerKilled() ? null : worker();
  if (!w) return Promise.resolve().then(() => { const out = decodeFieldCore(buf, fieldId, missingValue, dirFieldId); return out && { ...out, offThread: false }; });
  const id = ++_seq;
  // The buffer is transferred to the worker; keep a copy only for the fallback a worker death needs (a decode on the main thread).
  const keep = buf.slice(0);
  const mainThread = (resolve, reject) => {
    try { const out = decodeFieldCore(keep, fieldId, missingValue, dirFieldId); resolve(out && { ...out, offThread: false }); } catch (e2) { e2.stage = 'parse'; reject(e2); }
  };
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve: (out) => resolve(out && { ...out, offThread: true }), reject, fallback: () => mainThread(resolve, reject) });
    try { w.postMessage({ id, buf, fieldId, missingValue, dirFieldId }, [buf]); } catch (e) { _pending.delete(id); mainThread(resolve, reject); }
  });
}
