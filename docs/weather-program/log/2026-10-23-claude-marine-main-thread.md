# 2026-10-23 (claude, GPU-frames session): marine main-thread jank on the scrub

Written 2026-10-23. Branch `claude/marine-main-thread-jank` from dev `b88b5ca32`, merged with dev `e7fc9efda`.
Evidence: `evidence/marine-main-thread-2026-10-23.json`. Client only. No served number changes. Each change is ON with a kill switch.

## Ask
- The lead's live trace of dev (2026-10-23; bundle 54718262 on the owner's 844x390 window, z3.9, GFS waves, 115 frames resident):
  - key -> next paint p50 88 ms, p95 248 ms (FAIL);
  - 23 frames over 50 ms in 144 s (max 216.8 ms);
  - `getUniformLocation` was 1.8 s of self time;
  - the render-hour record named the PREVIOUS hour for 206-467 ms on hours 3, 6, 9 and 0.
- The lead's ranked work, in this order: `_captureCoarseBase` off the critical path, cached uniform locations, the idle
  render loop's cost, and a pixel read-back of the hour 3/6/9/0 window. Then the gate: "zero tasks over 50 ms on every
  interaction path in a production-like trace".

## Instrument
`frontend/scripts/offline-backend/scn_main_thread.js` replays the trace's flow offline:
- z3.9 at (-79.5, 28.6), the owner window, 10 ArrowRight steps, PageDown, zoom out to 1.9 and back.
- It records LoAF with script attribution and keydown Event Timing.
- It times every engine call that can block a frame. For `_captureCoarseBase` it also records the caller, bounds, and
  whether the shared world mask was reused or rasterized.
- Per frame it records MapLibre `_render` ms, uniform lookups and texture uploads, plus an idle window.
- `READBACK=1` reads 48 framebuffer patches after every frame, with the animation frozen (the engine clock pinned, crests
  not advected), so only data moves a pixel.
- `SEED_STEPS` stages a coarse-base seed with the `/grid` request box (north 85) and an older hour after chosen keys. This
  is the positive control: a world grid whose bounds differ from the static frames' (north 84).

## Findings
_(filled below from the runs)_
