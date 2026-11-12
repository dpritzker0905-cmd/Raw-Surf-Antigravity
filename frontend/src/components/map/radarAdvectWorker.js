// The radar advection nowcast, off the main thread (2026-11-12). radarAdvectClient.js posts one message per advect-rv tile; this
// worker fetches + decodes the observed RainViewer tiles, estimates the motion and warps (radarAdvectCore.js, the same code the
// main-thread kill path runs), and answers with a decoded ImageBitmap (transferred: no PNG encode here, no decode in maplibre).
// In:  { id, url, base, flags: { smoothOff, neighborOff } }   or   { cancel: id }
// Out: { id, bitmap, ms, cached, blank } (bitmap transferred) | { id, cancelled: true } | { id, error }
//   blank = an observed tile could not be had (expired RainViewer path, 404): a TRANSPARENT tile, never a frozen echo.
//   error = this worker cannot do the job at all (no OffscreenCanvas / createImageBitmap here): the client falls back for good.
import { createAdvectPipeline, parseAdvectUrl, pruneOldest, ADVECT_TTL_MS } from './radarAdvectCore';

const OUT_MAX = 64;               // warped RGBA kept for re-asks (a 256 px tile is 262 kB: about 17 MB at the cap)
const _decoded = new Map();       // absolute observed tile url -> { data, w, h, ts }
const _decoding = new Map();      // absolute observed tile url -> Promise (one fetch + decode per tile)
const _out = new Map();           // advect url + flags -> { data, w, h, ts }
const _jobs = new Map();          // advect url + flags -> { ids: Set, promise }
const _cancelled = new Set();     // message ids the client no longer wants
let _base = '';

const capable = () => typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
  && typeof ImageData !== 'undefined' && typeof fetch === 'function';

async function decodeTile(abs) {
  const resp = await fetch(abs);
  if (!resp.ok) throw new Error('advect tile ' + resp.status);
  const bitmap = await createImageBitmap(await resp.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const rec = { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, w: bitmap.width, h: bitmap.height, ts: Date.now() };
  if (bitmap.close) bitmap.close();
  return rec;
}

// Decode-once cache for observed tiles (the lead frames and the neighbour fills all read the same handful of tiles).
function getTile(url) {
  const abs = _base ? new URL(url, _base).href : url;
  const hit = _decoded.get(abs);
  if (hit && Date.now() - hit.ts < ADVECT_TTL_MS) return Promise.resolve(hit);
  const pending = _decoding.get(abs);
  if (pending) return pending;
  const p = decodeTile(abs).then((rec) => {
    _decoded.set(abs, rec);
    pruneOldest(_decoded);
    return rec;
  }).finally(() => _decoding.delete(abs));
  _decoding.set(abs, p);
  return p;
}

const _pipeline = createAdvectPipeline({ getTile });

// One computation per (url, flags), shared by every message that asks for it; it stops only when ALL its askers cancelled.
function warped(id, url, flags) {
  const key = url + (flags.smoothOff ? '|s0' : '') + (flags.neighborOff ? '|n0' : '');
  const hit = _out.get(key);
  if (hit && Date.now() - hit.ts < ADVECT_TTL_MS) return Promise.resolve({ ...hit, cached: true });
  let job = _jobs.get(key);
  if (job) { job.ids.add(id); return job.promise; }
  const parsed = parseAdvectUrl(url);
  if (!parsed) return Promise.reject(new Error('malformed advect url'));
  job = { ids: new Set([id]) };
  const allCancelled = () => { for (const i of job.ids) if (!_cancelled.has(i)) return false; return true; };
  job.promise = _pipeline.warp(parsed, flags, allCancelled).then((r) => {
    const rec = { data: r.data, w: r.w, h: r.h, ts: Date.now() };
    _out.set(key, rec);
    pruneOldest(_out, OUT_MAX);
    return { ...rec, cached: false };
  }).finally(() => _jobs.delete(key));
  _jobs.set(key, job);
  return job.promise;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.cancel != null) { _cancelled.add(m.cancel); return; }
  const { id, url, base, flags } = m;
  const t0 = Date.now();
  if (!capable()) { self.postMessage({ id, error: 'unsupported' }); return; }
  if (base) _base = base;
  let r = null; let blank = false;
  try {
    r = await warped(id, url, flags || {});
  } catch (err) {
    blank = true;                                       // observed tile missing / decode failed / malformed -> transparent
  }
  if (_cancelled.has(id)) { _cancelled.delete(id); self.postMessage({ id, cancelled: true }); return; }
  try {
    const img = blank ? new ImageData(256, 256) : new ImageData(r.data, r.w, r.h);
    const bitmap = await createImageBitmap(img);
    self.postMessage({ id, bitmap, ms: Date.now() - t0, cached: !blank && r.cached === true, blank }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
