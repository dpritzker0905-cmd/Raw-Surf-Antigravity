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

## Findings (offline; numbers in the evidence file)
1. **The hour 3/6/9/0 window: the PIXELS were right offline. Whether the live 206-467 ms was only the record lagging is not
   proven.**
   - Setup: the read-back with the animation frozen, centred on the synthetic storm, dev `b88b5ca32`.
   - The screen changed only on the steps where the nearest 3-hourly frame changes: 2->3, 5->6, 8->9 and 10->0, the same
     steps the live record flagged.
   - On 3 of those 4 steps the first frame rendered after the key already showed the new hour. On 8->9, one frame drawn
     60 ms after the key, before the handler had run, still showed the old hour; the next frame showed the new one.
   - There were no mixed frames and no regressions. The coarse base moved with the hour.
   - The render-hour record stayed true throughout offline, so the live record lag did not reproduce. The record is computed
     from the layer's own last upload (`lastSig`), which a frame-store show does not touch; that would explain a lagging
     record, but it is not proven live.
2. **`getUniformLocation`: 131 calls per frame, every frame.** This is the always-on loop.
3. **`_captureCoarseBase` is cheap while every world grid shares one bounds box** (3-13 ms offline: the LRU shares the
   world mask). It turns expensive when two world grids of one model x layer have different bounds, e.g. the static/series
   frames (north 84) and the `/grid` request box the prewarm seeds with (north 85):
   - the two supersede each other in the LRU slot;
   - the superseded set frees its mask;
   - every alternation rasterizes the 4096 x 2048 mask again (canvas fill, or a 36.6 ms pristine-canvas copy, plus a
     ~32 ms upload);
   - the seed's capture ran inside a render frame ~180-210 ms after the key.
   The seed control reproduces this. With these fixes killed, every session had 3 interaction-path frames over 50 ms, all
   of them `_captureCoarseBase` (36-120 ms).
   The live trace's bounds variants are inferred, not read: dev sits behind an access code in this session's browser, so
   it could not be read live.

## Change (each ON, each with a kill switch)
- **`glUniformCache.js`** keeps each uniform location on its program. The engine and four helpers go through it.
  Kill: `__RAW_DISABLE_UNIFORM_CACHE__`.
- **`marineCoarseMaskCache.js`** keeps up to 2 rasterized coarse masks, keyed by bounds + land GeoJSON, past their sets
  (refcounted with the engine's `__rsRefs`; teardown frees each exactly once). Kill: `__RAW_DISABLE_COARSE_MASK_CACHE__`.
- **`renderMaskToCanvas(..., { readOnly: true })`** is used for the coarse-base capture only. A pristine-cache hit returns
  the cached canvas itself, and a miss caches the canvas it returns, so neither path pays the 4096 x 2048 copy.
  Kill: `__RAW_DISABLE_MASK_READONLY_CANVAS__`.
- **`marineQuietFrames.js`** makes the staged coarse-base seed wait for a frame with no input in the last 1 s and no zoom
  change. The input clock is live from module load, and the engine asks every frame. The seed is best-effort by design.
  Kill: `__RAW_DISABLE_QUIET_SEED__`.

## Results (offline A/B, one build, fresh browser per arm, arms interleaved on/off/off/on; "off" = all four kills)

| Control | Measure | on | off |
|---|---|---|---|
| Seed (2 bounds boxes alternate) | frames over 50 ms within 500 ms of a key | 1 and 2, all React keydown/commit work, **no capture** | 3 and 3, **all `_captureCoarseBase`** |
| Seed | seed consumed | 1,003-1,538 ms after the last key | 185-212 ms after a key, 36-120 ms each |
| Seed | key Event Timing p50 | 64 and 56 ms | 96 and 80 ms |
| Null (no seed) | frames over 50 ms | 0 and 1 | 0 and 0 |
| Null | key p50 | 64 ms | 64 ms |
| Null | idle engine render | 124 and 155 ms per 6 s | 289 and 208 ms per 6 s |
| Rapid scrub (400 ms steps) + seed | seed | after the scrub, in the zoom pause | in mid-scrub frames, 37-86 ms |

- The first raster of a NEW bounds variant still costs ~90 ms, once per variant per session. It now lands in a quiet frame,
  not on an interaction path.
- The idle loop offline is MapLibre `_render` at 7-12% of wall time and the engine render at 2-5%, not the live 54%. The
  uniform cache lowers the engine part by about a third. No animation was touched.

## Tests
- **5,554 tests are green** across `src/components/map` and `src/tests`. Two source pins were updated to the new spellings:
  the seed-consume order (`baseHourSync`) and `u_densityCut` (`marineCrestDensity`).
- **Mutants: 18 of 18 killed** (each in `scratchpad/mutants_jank.py`, one change each). They cover:
  - each kill switch ignored;
  - the uniform cache never keeping a location, and one engine lookup going back to the driver;
  - a cached mask never found, a raster never remembered, a mask without canvas dims cached, teardown keeping the masks,
    and eviction never letting go;
  - every frame quiet, the lazy install, a zoom change not counted, and the engine consuming the seed on any frame;
  - a read-only hit copied, a read-only miss copied, and the capture not read-only.
- **One equivalent mutant is documented, not counted:** removing the engine's `base.__maskCanvasDims` guard changes
  nothing, because `rememberCoarseMask` refuses a mask without dims. That module guard has its own test and mutant.

## Not done, next levers (measured, not changed here)
- **React's keydown handler and commits:** 52-87 ms frames remain on interaction paths. They hold `setWaveData` encodes of
  5-64 ms for grids that are not the frame store's resident; the live trace had the handler at 26-60 ms, 213 ms on the
  first key.
- **The once-per-variant first raster** could move off the main thread (OffscreenCanvas in a worker plus an ImageBitmap
  upload), or the variants could be removed at the source: the prewarm seeds from the static frame instead of the request
  box.
- **"Scrub as a uniform update"** (sampling the texture array by layer): today's store show (array -> 2D copy) is 0.4-2.4 ms
  per step (`shows.lastMs`, live), so it is not the bottleneck.
- **The `latest.json` poll re-reads ~57 frames.** The vectors LRU holds 12, so a re-requested 48-frame series page rebuilds
  them; live, one such worker-result handler took 90.8 ms at zoom-out. This needs its own reproduction (a re-published index
  for the same run).
- **The live read after the merge,** with the same instrument where it can run, or the lead's chrome-devtools profile.
