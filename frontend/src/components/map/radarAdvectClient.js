/**
 * radarAdvectClient.js — the main-thread side of the radar advection worker (2026-11-12, "instant, no stall on scrub").
 * The nowcast frames beside "now" used to be estimated, warped and PNG-encoded on the main thread (profiled on a throttled phone:
 * `radarAdvection` warp 782 ms + `convertToBlob` 333 ms inside one scrub). advectTileOffThread() hands the whole tile to
 * radarAdvectWorker.js and resolves with a decoded ImageBitmap, which maplibre uses as is (no encode, no second decode).
 * Fail-open: no Worker / no OffscreenCanvas, a worker that errors, or the kill -> null, and the caller runs the main-thread path.
 * Kill: window.__RAW_DISABLE_RADAR_ADVECT_WORKER__ = true (main-thread warp + PNG, as before).
 * Telemetry: window.__RAW_RADAR_ADVECT_WORKER__ { state, tiles, cached, blank, cancelled, fallback, ms[] }.
 */
const W = () => (typeof window !== 'undefined' ? window : {});
const MS_KEEP = 60;

export const advectWorkerOn = () => W().__RAW_DISABLE_RADAR_ADVECT_WORKER__ !== true;

const _waiters = new Map();     // message id -> resolve
let _workerP = null; let _seq = 0;

function tel() {
  const w = W();
  if (!w.__RAW_RADAR_ADVECT_WORKER__) {
    w.__RAW_RADAR_ADVECT_WORKER__ = { state: 'idle', tiles: 0, cached: 0, blank: 0, cancelled: 0, fallback: 0, ms: [] };
  }
  return w.__RAW_RADAR_ADVECT_WORKER__;
}

const supported = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
  && typeof createImageBitmap === 'function';

function failAll(state) {
  tel().state = state;
  _workerP = Promise.resolve(null);
  for (const r of _waiters.values()) r({ error: state });
  _waiters.clear();
}

// The worker, created once. Resolves null when there is none or it failed (every request then falls back).
function worker() {
  if (_workerP) return _workerP;
  if (!supported()) { tel().state = 'none'; _workerP = Promise.resolve(null); return _workerP; }
  _workerP = import('./radarAdvectWorkerFactory').then((m) => {
    const w = m.createRadarAdvectWorker();
    w.onmessage = (e) => { const r = _waiters.get(e.data.id); if (r) { _waiters.delete(e.data.id); r(e.data); } };
    w.onerror = () => failAll('failed');
    tel().state = 'module';
    return w;
  }).catch(() => { tel().state = 'none'; return null; });
  return _workerP;
}

const abortError = () => Object.assign(new Error('advect tile aborted'), { name: 'AbortError' });

/**
 * One advect-rv tile from the worker. Resolves { data: ImageBitmap } (maplibre's protocol response), or null when the worker
 * cannot serve it (the caller computes on the main thread). Rejects with an AbortError only when maplibre aborted the request.
 */
export async function advectTileOffThread(url, flags, abortController) {
  if (!advectWorkerOn()) return null;
  const t = tel();
  const w = await worker();
  if (!w) { t.fallback++; return null; }
  const signal = abortController && abortController.signal;
  if (signal && signal.aborted) { t.cancelled++; throw abortError(); }
  const id = ++_seq;
  const loc = W().location;
  const reply = await new Promise((resolve) => {
    _waiters.set(id, resolve);
    if (signal && signal.addEventListener) {
      signal.addEventListener('abort', () => {
        if (!_waiters.has(id)) return;
        _waiters.delete(id);
        try { w.postMessage({ cancel: id }); } catch (e) { /* the worker is gone: nothing to cancel */ }
        resolve({ cancelled: true });
      }, { once: true });
    }
    try {
      w.postMessage({ id, url, base: (loc && loc.href) || '', flags: flags || {} });
    } catch (e) {
      _waiters.delete(id);
      resolve({ error: 'post failed' });
    }
  });
  if (reply.cancelled) { t.cancelled++; throw abortError(); }
  if (reply.error || !reply.bitmap) {
    // The worker cannot do this job (unsupported there, or bitmap creation threw): stop asking it, fall back for good.
    if (t.state === 'module') failAll('failed');
    t.fallback++;
    return null;
  }
  t.tiles++;
  if (reply.cached) t.cached++;
  if (reply.blank) t.blank++;
  t.ms.push(reply.ms);
  if (t.ms.length > MS_KEEP) t.ms.shift();
  return { data: reply.bitmap };
}

/** Tests only: forget the worker and its waiters. */
export function __resetAdvectWorkerForTests() {
  _workerP = null; _seq = 0; _waiters.clear();
  delete W().__RAW_RADAR_ADVECT_WORKER__;
}
