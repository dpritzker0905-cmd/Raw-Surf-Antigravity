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
// texture objects (reinitParticles / initEngine), and so new keys. The size the caller attaches at
// is part of the key as well (belt and braces: a size the texture was not verified at re-asks).
// Only COMPLETE is cached: any other status re-asks the driver every time (and the engine turns
// particles off anyway). A new FBO object or a new GL context drops the cache.
//
// Kill switch: window.__RAW_DISABLE_FBO_STATUS_CACHE__ = true asks the driver every frame (legacy).
// Debug: ?diag=1 in the page URL also asks every frame (fboSyncDiag below), so the HUD's
// advFboStatus is a live driver answer there. Only the URL flag: the HUD's localhost default and
// localStorage do not, or every local dev session and offline measurement would take this path.
// Telemetry: window.__RAW_GPU__.fboStatusCache = { on, diag, hits, checks } (the existing
// advFboStatus string is unchanged).

let _diagSearch = null;
let _diagOn = false;
export function fboSyncDiag(win) {
  if (!win || !win.location) return false;
  const q = win.location.search || '';
  if (q !== _diagSearch) {
    _diagSearch = q;
    try { _diagOn = new URLSearchParams(q).get('diag') === '1'; } catch (e) { _diagOn = false; }
  }
  return _diagOn;
}

export function fboStatusCacheDisabled(win) {
  return !!(win && win.__RAW_DISABLE_FBO_STATUS_CACHE__ === true);
}

const winOf = (win) => (win !== undefined ? win : (typeof window !== 'undefined' ? window : null));

// Status of the FBO currently bound to gl.FRAMEBUFFER, which the caller has just attached `tex`
// (width x height) to as COLOR_ATTACHMENT0. `holder` keeps the cache (the engine); `fbo` is the
// bound framebuffer.
export function cachedFramebufferStatus(gl, holder, fbo, tex, width, height, win) {
  const w = winOf(win);
  const diag = fboSyncDiag(w);
  const off = fboStatusCacheDisabled(w) || diag;
  let c = holder._fboStatusCache;
  if (!c || c.gl !== gl || c.fbo !== fbo) {
    c = holder._fboStatusCache = { gl, fbo, complete: new WeakMap(), hits: 0, checks: 0 };
  }
  const size = width + 'x' + height;
  let status;
  if (!off && tex && c.complete.get(tex) === size) {
    c.hits++;
    status = gl.FRAMEBUFFER_COMPLETE;
  } else {
    c.checks++;
    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status === gl.FRAMEBUFFER_COMPLETE && tex) c.complete.set(tex, size);
    else if (tex) c.complete.delete(tex);
  }
  if (w && w.__RAW_GPU__) w.__RAW_GPU__.fboStatusCache = { on: !off, diag, hits: c.hits, checks: c.checks };
  return status;
}

// 2. TEARDOWN ONLY WHEN ATTACHED: the render's `finally` re-bound the advection FBO and detached
// its colour attachment on every frame, behind `gl.isFramebuffer(this.advFBO)` (a sync, where the
// wait landed once the status was cached: 2.7 ms per frame, the same harness). On every frame that
// does not throw, the pass has already detached (both the COMPLETE and the incomplete branch end
// with framebufferTexture2D(..., null)), so that teardown was a no-op. The engine now records the
// attachment in JS (`_advAttached`: set on the attach line, cleared on each detach) and the
// teardown runs, still behind isFramebuffer, only when a texture was left attached, i.e. when an
// exception escaped between attach and detach. The WIND engine's render has the same `finally`
// (isFramebuffer + getParameter(FRAMEBUFFER_BINDING) + detach every frame) and uses the same rule,
// with its own telemetry key.
// Kill switch (both engines): window.__RAW_DISABLE_ADV_TEARDOWN_SKIP__ = true runs it every frame
// (legacy); ?diag=1 does too. Telemetry: window.__RAW_GPU__[key] = { on, diag, ran, skipped }, key
// 'advTeardown' (marine) or 'windAdvTeardown' (wind).
export function advTeardownNeeded(holder, win, key = 'advTeardown') {
  const w = winOf(win);
  const diag = fboSyncDiag(w);
  const off = !!(w && w.__RAW_DISABLE_ADV_TEARDOWN_SKIP__ === true) || diag;
  const need = off || holder._advAttached === true;
  const t = holder._advTeardownStats || (holder._advTeardownStats = { ran: 0, skipped: 0 });
  if (need) t.ran++; else t.skipped++;
  if (w && w.__RAW_GPU__) w.__RAW_GPU__[key] = { on: !off, diag, ran: t.ran, skipped: t.skipped };
  return need;
}
