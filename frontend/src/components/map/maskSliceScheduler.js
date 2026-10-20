// SLICED LAND-MASK PAINTS (2026-10-20, PROTOTYPE, OFF unless window.__RAW_SLICED_LAND_MASK__ === true; owner decides).
//
// A map-event mask refresh (idle / moveend / zoomend / sourcedata) used to paint its whole canvas inside the event's
// task: ~70 ms per paint after #408, 4-5 paints per pan step, every one a frame the map could not draw. Here the SAME
// paint steps (overlayBasemapWaterSteps, run to completion by the synchronous path) run across short tasks instead,
// and the texture upload + engine state change happen in one final task, only if nothing newer replaced the target.
//
// What changes on screen, and only while this flag is on: for the ~100-300 ms a sliced paint takes, frames keep showing
// the PREVIOUS mask (today those frames are not drawn at all; the main thread is busy painting). No half-painted mask
// is ever uploaded. Data-commit re-patches stay synchronous (they keep the Natural-Earth-only mask from being shown).
//
// Chrome's 2D canvas RECORDS draws and rasterizes them at the next read, so a slice that only records would push the
// raster into whichever slice reads next. flushCanvas() reads one pixel to make each slice pay for its own draws.
// Telemetry: window.__RAW_GPU__.maskSlicing. Tunables: __RAW_LAND_MASK_SLICE_MS__ (8), __RAW_LAND_MASK_FLUSH_EVERY__ (24).

export function landMaskSlicingOn() {
  return typeof window !== 'undefined' && window.__RAW_SLICED_LAND_MASK__ === true;
}

// What a map-event refresh passes the engine: nothing while the flag is off (so every call is the old one).
export function landMaskSliceOpts(rerun) {
  return landMaskSlicingOn() ? { sliced: true, rerun } : undefined;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function stats() {
  const blank = () => ({ scheduled: 0, committed: 0, stale: 0, coalesced: 0, failed: 0, slices: 0, sliceMs: 0, maxSliceMs: 0,
    flushes: 0, latencyMs: [], sliceLog: [], segMaxMs: {}, lastOutcome: null });
  if (typeof window === 'undefined') return blank();
  const g = window.__RAW_GPU__;
  if (!g) return blank();
  if (!g.maskSlicing) g.maskSlicing = blank();
  return g.maskSlicing;
}

function flushCanvas(canvas) {
  try { canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1, 1); } catch (e) { /* nothing to flush */ }
}

// One job per engine. A second sliced request while one runs only marks it pending (re-driven once when the job ends).
export function maskJobInFlight(engine) {
  if (engine && engine._maskJob) {
    engine._maskJob.pending = true;
    stats().coalesced++;
    return true;
  }
  return false;
}

// job = { kind, steps (iterator; sets holder.canvas before its first yield; yields 1 after a draw, a pass name after a pass), holder, isStale(), commit(result), onEnd(outcome, pending) }
// A job requested while another runs (the regional paint's nested overlay, requested in the same event as the default path
// does) waits in a FIFO queue with its inputs already read; it starts when the running job ends.
export function startMaskJob(engine, job) {
  const s = stats();
  s.scheduled++;
  const j = { ...job, pending: false, t0: now(), draws: 0 };
  if (engine._maskJob || (engine._maskJobQueue && engine._maskJobQueue.length)) {
    (engine._maskJobQueue || (engine._maskJobQueue = [])).push(j);
    s.queued = (s.queued || 0) + 1;
    return true;
  }
  runMaskJob(engine, j, s);
  return true;
}

function runMaskJob(engine, j, s) {
  engine._maskJob = j;
  const budget = num(typeof window !== 'undefined' && window.__RAW_LAND_MASK_SLICE_MS__, 8);
  const flushEvery = num(typeof window !== 'undefined' && window.__RAW_LAND_MASK_FLUSH_EVERY__, 24);
  const end = (outcome) => {
    if (engine._maskJob === j) engine._maskJob = null;
    s.lastOutcome = outcome;
    if (outcome === 'committed') {
      s.committed++;
      s.latencyMs.push(Math.round(now() - j.t0));
      if (s.latencyMs.length > 200) s.latencyMs.shift();
    } else if (outcome === 'stale') s.stale++;
    else s.failed++;
    const q = engine._maskJobQueue;
    const next = !engine._maskJob && q && q.length ? q.shift() : null;
    let pending = j.pending;
    if (next) { next.pending = next.pending || pending; pending = false; }   // the re-drive waits for the queue to drain
    try { if (j.onEnd) j.onEnd(outcome, pending); } catch (e) { /* re-drive is best effort */ }
    if (next) runMaskJob(engine, next, s);
  };
  const timed = (fn) => {
    const t = now();
    try { return fn(); } finally {
      const d = now() - t;
      s.slices++; s.sliceMs += d; if (d > s.maxSliceMs) s.maxSliceMs = d;
      s.sliceLog.push(Math.round(d * 10) / 10); if (s.sliceLog.length > 4000) s.sliceLog.shift();
    }
  };
  const commitSlice = (result) => {
    if (engine._maskJob !== j) return;
    if (j.isStale()) { end('stale'); return; }
    engine._maskJob = null;   // free the slot first: a regional commit may start the nested overlay job
    let ok = false;
    const tc = now();
    try { ok = timed(() => j.commit(result)); } catch (e) {
      console.warn('[maskSliceScheduler] sliced mask commit skipped:', e && e.message);
      end('failed'); return;
    }
    const dc = now() - tc;
    if (!(s.segMaxMs.commit >= dc)) s.segMaxMs.commit = Math.round(dc * 10) / 10;
    end(ok ? 'committed' : 'failed');
  };
  const slice = () => {
    if (engine._maskJob !== j) return;   // replaced (a newer job owns the slot)
    if (j.isStale()) { end('stale'); return; }
    let r;
    try {
      r = timed(() => {
        const t = now();
        for (;;) {
          const t1 = now();
          const step = j.steps.next();
          if (step.done) { if (j.draws) { flushCanvas(j.holder.canvas); s.flushes++; j.draws = 0; } return step; }
          if (step.value === 1) j.draws++;
          if (j.draws && (j.draws >= flushEvery || step.value !== 1)) { flushCanvas(j.holder.canvas); s.flushes++; j.draws = 0; }
          // The longest piece each named pass took in one go (what bounds a slice from below).
          const lab = step.value === 1 ? 'draws' : String(step.value);
          const d1 = now() - t1;
          if (!(s.segMaxMs[lab] >= d1)) s.segMaxMs[lab] = Math.round(d1 * 10) / 10;
          if (now() - t >= budget) return step;
        }
      });
    } catch (e) {
      console.warn('[maskSliceScheduler] sliced mask paint skipped:', e && e.message);
      end('failed'); return;
    }
    if (r.done) setTimeout(() => commitSlice(r.value), 0);
    else setTimeout(slice, 0);
  };
  setTimeout(slice, 0);
  return true;
}
