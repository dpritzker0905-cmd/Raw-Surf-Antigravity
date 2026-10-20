# 2026-10-20: the marine advection pass's two GPU sync points (FBO status cache, teardown only when attached)

Session opened 2026-10-20T02:24Z. The weather-simulation audit session started it after PR #402: once
`captureWebGLState` stopped calling getParameter, "marine engine draw" grew by about the time the capture lost, because
the main thread waits on queued GPU work at the next synchronous GL call. Branch `claude/fbo-status-cache`, cut from dev
`b240d7276` (#400, #386 and #402 merged). Measurements ran in a dot-free worktree (`C:/Users/David/App/rs-fbocache`).
Client only. **No served number changes** (no SCOREBOARD row): the same draws run with the same state. One status
answer is remembered instead of re-asked, and one teardown that did nothing on a normal frame is skipped. Both ship ON,
each with its own kill switch. Evidence: `evidence/adv-fbo-sync-2026-10-20.json`.

## 1. The sync point (in-page timing, no app edit)

`frontend/scripts/visual-lab/gpu_sync_ab.js GLTIME=1` wraps every WebGL method in the page with performance.now and
bills it while the marine `engine.render` is on the stack (same steady scrub as PR #402's A/B). On the #402 build, two
runs, per marine render:

| GL call | mean | calls over 1 ms |
|---|---|---|
| `checkFramebufferStatus` (advection pass) | **2.71 / 2.69 ms** | 608 of 642 / 620 of 654 |
| `isFramebuffer` (the render's `finally`) | 0.45 / 0.51 ms | 55 / 57 |
| everything else (80k getUniformLocation, uniforms, binds, draws) | under 0.2 ms in total | - |

The marine render mean was 4.07 ms, so the status query alone was two thirds of it. That confirms the audit's suspect.

## 2. The fix, and the wait moving once

**Status cache** (`advFboSync.cachedFramebufferStatus`; kill `window.__RAW_DISABLE_FBO_STATUS_CACHE__`). This is the
status per (FBO, attached texture object); only COMPLETE is cached. Why it is sound: the advection FBO only ever has
COLOR_ATTACHMENT0, and it holds one of the two ping-pong particle-state textures. Those textures are RGBA8 at
`particleRes`, and they are never re-specified in place: a reseed is `texSubImage2D`, and a resize or reinit makes new
texture objects (`reinitParticles`, `initEngine`), so they are new keys. Completeness depends only on the attachment's
format and size. A new FBO object or a new GL context drops the cache. An incomplete answer is re-asked every frame, and
it evicts the texture. `__RAW_GPU__.advFboStatus` keeps its exact strings; `__RAW_GPU__.fboStatusCache = {on, hits,
checks}` is new.

**The wait moved, exactly as the brief warned.** On a build with only the cache, `checkFramebufferStatus` left the
table and `isFramebuffer` in the `finally` took the wait: 0.59 -> **2.72 ms** per render. The marine render barely
moved (4.60 -> 3.51 ms with wrappers on: the one round trip saved). On the final build with only the cache on (the
teardown kill set): isFramebuffer 3.08 ms, marine render 4.11 ms, no gain at all.

**Teardown only when attached** (`advFboSync.advTeardownNeeded`; kill `window.__RAW_DISABLE_ADV_TEARDOWN_SKIP__`). The
`finally` re-bound the advection FBO and detached its colour attachment on every frame, behind
`gl.isFramebuffer(this.advFBO)`. On every frame that does not throw, the pass has already detached (both the COMPLETE
and the incomplete branch end with `framebufferTexture2D(..., null)`), so that teardown did nothing. The engine now
records the attachment in JS: `_advAttached` is set on the attach line and cleared on each of the three detach lines.
The teardown, still behind isFramebuffer, runs only when a texture was left attached, which means an exception escaped
between attach and detach. Telemetry: `__RAW_GPU__.advTeardown = {on, ran, skipped}`. The hunk is the advection pass
and its `finally` only (five lines changed, each kept on its own line so the LOC ratchet does not move; the land-mask
session owns the mask phase).

With both on there is no synchronous call left in the marine render (GLTIME: the top entry is `getParameter`, 8,862
cached reads totalling 15.9 ms over 633 renders).

## 3. Measured (offline; never the live backend)

**Controlled, one build, kill switches only** (PR #402's recipe: zoom 3, 10 s settle, 40 ArrowRight 250 ms apart, every
`engine.render` timed; `mapFrame` = MapLibre `map._render` per frame, its own draw plus both custom layers):

| arm | marine engine.render mean / p95 | whole map frame mean / p95 | fps |
|---|---|---|---|
| both kills (legacy) | 4.11 / 6.2 ms | 5.70 / 8.0 ms | 59.2 |
| on | **0.45 / 0.7 ms** | **1.64 / 2.4 ms** | 58.9 |
| both kills (legacy) | 4.82 / 7.2 ms | 6.26 / 8.8 ms | 59.3 |
| on | **0.59 / 0.9 ms** | **2.03 / 2.9 ms** | 58.8 |

A first A/B without the frame timer read 4.33 / 3.76 -> 0.54 / 0.57 ms (p95 6.4 / 4.9 -> 0.8 / 0.8). The **whole map
frame falls by the same ~4 ms**, so the wait did not move to a later synchronous call elsewhere in the frame: the main
thread simply stops waiting. fps stays at the 60 Hz cap in every arm, because this scrub was never frame-bound on this
machine. The gain is main-thread time handed back (about 4 ms of every 16.7 ms frame), not frames. Wind null control
(marine not drawn): wind render 3.81 / 3.86 -> 3.99 / 3.40 ms, noise.

**Real-GPU correctness** (`CHECK=1 THROW_ONCE=1`: after every marine render, the advection FBO's attachment type and
`gl.getError`; one advection draw made to throw): 323 renders on, 318 with the kills; **0 left attached, 0 GL errors**.
The thrown render ran the teardown (`advTeardown.ran` 1, `skipped` 793).

**Erratic lab** (`FLOWS=erratic LAB_TRACE=1`, interleaved off1 on1 off2 on2 on the same build; `stall_profile.js` at 50
and 1). The profiler files `advFboSync.js` under "other app code", so in the kill arm the status-query wait is billed
there and not to "marine engine draw". Read the two together:

| run | busy time (thr 1) | marine render + advFboSync.js (thr 1) | browser/native (thr 1) | stalls (thr 50) | marine + advFboSync in stalls |
|---|---|---|---|---|---|
| off1 (kills) | 46.4 s | 4.01 + 4.82 = 8.8 s | 13.7 s | 10.0 s | 254 + 252 ms |
| on1 | 42.4 s | 2.41 + 0 = 2.4 s | 16.8 s | 7.2 s | 68 ms |
| off2 (kills) | 46.8 s | 4.14 + 7.57 = 11.7 s | 13.2 s | 7.4 s | 192 + 258 ms |
| on2 | 30.1 s | 1.32 + 0 = 1.3 s | 12.9 s | 5.2 s | 25 ms |

The marine sync time falls 8.8 / 11.7 s -> 2.4 / 1.3 s per run. What remains in `renderHeatmapAndParticles` is its
own JS, since no sync is left. Total busy time falls 46.4 / 46.8 -> 42.4 / 30.1 s. **Honest caveat:**
"browser/native (program)" rose 3.1 s in on1 and fell 0.3 s in on2. Some of the wait may surface there as native
time outside any JS frame (n = 2, unresolved); the steady A/B's whole-frame timer did not see it move into the frame.
Pacing (rAF gaps over 50 ms 17 / 8 -> 13 / 5, long tasks 13 / 5 -> 7 / 5) and the lab's correctness columns show no
systematic change. The worst stalls are shader compiles and the land mask, not this pass.

## Tests

- `advFboSync.test.js` (11): ask once per (FBO, texture) through the ping-pong (2 driver calls in 100 frames); new
  texture objects, a new FBO and a new context re-ask; non-COMPLETE never cached and evicts; both kill switches (strict
  `true`, take effect next frame); an attach/detach/teardown skeleton of the pass against a GL mock that tracks the real
  attachment (complete, incomplete, throw mid-pass, throw before attach: nothing attached after any frame, isFramebuffer
  only on the throw frames); source pins on the engine (the cache call after the attach, no direct
  checkFramebufferStatus in render, `_advAttached` on the attach and all three detach lines, one isFramebuffer behind
  advTeardownNeeded, the HUD strings unchanged). Mutations, each red: no FBO reset, caching any status, never tearing
  down, always tearing down, one engine detach not recorded.
- New instrument: `frontend/scripts/visual-lab/gpu_sync_ab.js` (the #402 controlled A/B as a script, plus GLTIME,
  mapFrame, CHECK and THROW_ONCE).

## Not done / follow-ups

- The wind engine's render is still about 3.8 ms per frame in the same scrub, with the same shape (it has its own
  advection FBO and a `checkFramebufferStatus` in `WebGLWindUtils.js`). It was not timed per call here; it is the obvious
  next candidate, with the same A/B.
- No real-device or owner-console reading. The ~4 ms per frame is this PC (AMD 890M, ANGLE D3D11) in headless Chrome.
  On a GPU-bound phone the GPU still does the same work; what this removes is the main thread waiting for it.

## PR

PR #405 against dev (not merged), ledger seq 1501 (`pr_open`; re-chained from 1500 by the lead session after #404 merged). STATE's ledger-head anchor moved from 1463 (stale: dev's
ledger was already at 1499) to 1501.
