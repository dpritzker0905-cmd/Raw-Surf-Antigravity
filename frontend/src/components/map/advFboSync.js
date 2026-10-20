// The two GPU sync points of the marine particle-advection pass (2026-10-20), and how each is avoided.
// A synchronous GL query (checkFramebufferStatus, isFramebuffer, getParameter...) is a round trip to
// the GPU process: it waits for all GL work queued before it, so whichever such call comes first in
// a frame absorbs the wait for the frame's queued draws. Removing one moves the wait to the next one.
//
// 1. FBO STATUS CACHE: the marine particle-advection pass asked the driver for its
// framebuffer status on EVERY frame. checkFramebufferStatus is a synchronous round trip to the GPU
// process, so it waits for all queued GL work and billed that wait to the marine draw. Measured on
// the offline harness after PR #402 (frontend/scripts/visual-lab/gpu_sync_ab.js, GLTIME=1, steady
// 10 s scrub, AMD 890M / ANGLE D3D11): 2.7 ms of a 4.07 ms marine render, more than 1 ms on 95% of
// frames. Evidence: docs/weather-program/evidence/adv-fbo-sync-2026-10-20.json.
//
// WHY A CACHE IS SOUND: the advection FBO only ever has COLOR_ATTACHMENT0, and it holds one of the
// two particle-state textures (they ping-pong). Framebuffer completeness depends only on the
// attachments' formats and sizes. These textures are RGBA8 at particleRes and are never re-specified
// in place: a reseed is texSubImage2D (same format, same size), and a resize or reinit creates NEW
// texture objects (reinitParticles / initEngine), and so new keys. So "this FBO with this texture
// object was COMPLETE once" stays true for the texture's lifetime. Only COMPLETE is cached: any
// other status re-asks the driver every time (and the engine turns particles off anyway).
// A new FBO object or a new GL context drops the cache.
//
// Kill switch: window.__RAW_DISABLE_FBO_STATUS_CACHE__ = true asks the driver every frame (legacy).
// Telemetry: window.__RAW_GPU__.fboStatusCache = { on, hits, checks } (the existing advFboStatus
// string is unchanged).

export function fboStatusCacheDisabled(win) {
  return !!(win && win.__RAW_DISABLE_FBO_STATUS_CACHE__ === true);
}

// Status of the FBO currently bound to gl.FRAMEBUFFER, which the caller has just attached `tex` to
// as COLOR_ATTACHMENT0. `holder` keeps the cache (the engine); `fbo` is the bound framebuffer.
export function cachedFramebufferStatus(gl, holder, fbo, tex, win) {
  const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
  const off = fboStatusCacheDisabled(w);
  let c = holder._fboStatusCache;
  if (!c || c.gl !== gl || c.fbo !== fbo) {
    c = holder._fboStatusCache = { gl, fbo, complete: new WeakSet(), hits: 0, checks: 0 };
  }
  let status;
  if (!off && tex && c.complete.has(tex)) {
    c.hits++;
    status = gl.FRAMEBUFFER_COMPLETE;
  } else {
    c.checks++;
    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status === gl.FRAMEBUFFER_COMPLETE && tex) c.complete.add(tex);
    else if (tex) c.complete.delete(tex);
  }
  if (w && w.__RAW_GPU__) w.__RAW_GPU__.fboStatusCache = { on: !off, hits: c.hits, checks: c.checks };
  return status;
}

// 2. TEARDOWN ONLY WHEN ATTACHED: the render's `finally` re-bound the advection FBO and detached
// its colour attachment on every frame, behind `gl.isFramebuffer(this.advFBO)` (a sync, where the
// wait landed once the status was cached: 2.7 ms per frame, the same harness). On every frame that
// does not throw, the pass has already detached (both the COMPLETE and the incomplete branch end
// with framebufferTexture2D(..., null)), so that teardown was a no-op. The engine now records the
// attachment in JS (`_advAttached`: set on the attach line, cleared on each detach) and the
// teardown runs, still behind isFramebuffer, only when a texture was left attached, i.e. when an
// exception escaped between attach and detach.
// Kill switch: window.__RAW_DISABLE_ADV_TEARDOWN_SKIP__ = true runs it every frame (legacy).
// Telemetry: window.__RAW_GPU__.advTeardown = { on, ran, skipped }.
export function advTeardownNeeded(holder, win) {
  const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
  const off = !!(w && w.__RAW_DISABLE_ADV_TEARDOWN_SKIP__ === true);
  const need = off || holder._advAttached === true;
  const t = holder._advTeardownStats || (holder._advTeardownStats = { ran: 0, skipped: 0 });
  if (need) t.ran++; else t.skipped++;
  if (w && w.__RAW_GPU__) w.__RAW_GPU__.advTeardown = { on: !off, ran: t.ran, skipped: t.skipped };
  return need;
}
