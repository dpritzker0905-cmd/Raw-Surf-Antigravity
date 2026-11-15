# 2026-11-15: /grid_series decode off the main thread (Opus, Move 3 next batch; the researcher's #912 item #2)

## 14:42Z: the question and what was measured before building

The director relays the researcher's #912 ranking: move the JSON series decode off the main thread (`marineGridSeries.js`'s
full page at `loadSeriesPage` and the h0 mini at `loadSeriesMini`), reusing the inline Blob-worker pattern of
`staticFrames.js`.

**Offline bench (Node 24, no throttle; `scratchpad/m3/series-parse-bench.js`).** One 48-frame GFS waves page each, from the
synthetic backend:

| page | bytes | vectors | `JSON.parse` | structured clone of the parsed frames | rebuilding the same objects from typed columns |
|---|---|---|---|---|---|
| world | 7.26 MB | 46,368 | 26.5 ms | 51.5 ms | 13.4 ms (0.51x) |
| regional | 1.68 MB | 10,800 | 5.4 ms | 10.1 ms | 4.3 ms (0.81x) |

The rebuilt frames are deep-equal to the parsed ones (key order included).

**What this rules out:**
1. **A parse-only worker.** The main thread would receive the object graph through structured clone, which costs about 2x
   the `JSON.parse` it saves. It would be WORSE.
2. **An eager columnar rebuild.** The worker packs typed columns and the main thread rebuilds every frame on arrival. That
   saves 19-49%, not reliably the 50% the gate asks for.

**The design this registers:**
- The worker fetches the page, parses it, and packs each frame's vectors into typed columns. A presence mask keeps a missing
  key, `null` and a number distinct, and the frame's own key order is kept. The columns are transferred (zero copy).
- The main thread stores the packed frames and rebuilds a frame's `vectors` only when that frame is first read, through a
  memoised getter. Consumers keep the plain object arrays they read today.
- When a page arrives, the main thread no longer reads the body, parses it or builds 48 frames. A frame's first use costs
  about 1/48 of the eager rebuild.
- No worker (no Worker / Blob / URL), a worker error, or the kill switch: today's main-thread path, unchanged.
  Kill: `window.__RAW_DISABLE_SERIES_DECODE_WORKER__ = true`.

## PRE-REGISTERED gate (written before any after-arm number is looked at)

Same build, two arms: the worker (default) vs `__RAW_DISABLE_SERIES_DECODE_WORKER__` (today's path). Offline only:
synthetic backend and replay cache, no live traffic.

1. **Main-thread blocking: >= 50% lower on the throttled phone profile** (390x844 @3x, 4x CPU).
   - **Metric:** the sum of long-task time (PerformanceObserver `longtask`, duration over 50 ms counted in full) from a cold
     map load through the three series pages landing (`__MARINE_SERIES_DIAG__.loads` reaching 3) plus a 10-step scrub.
     GFS waves at z2 and z6; 5 fresh loads per arm per zoom.
   - **Pass:** median(worker) <= 0.5 x median(kill) at both zooms.
   - **Secondary, reported but not gating:** the main-thread CPU-profile self time in the series ingest path per page.
2. **Decoded arrays byte-identical.**
   - Jest: for recorded pages (world and regional, GFS waves and a swell_2 page with null periods), pack then rebuild equals
     `JSON.parse` for every frame. Compared as `JSON.stringify` of the frame (key order) plus `Object.is` on every numeric
     cell (-0 / null / absent kept distinct).
   - In the app, both arms: `JSON.stringify` of the first committed series frame's grid is equal for the same page.
3. **No scrub regression.** Step p50 / p95 (the raster lab's marine scrub, desktop and phone) is not worse than the kill arm
   by more than 5 ms at p50 or 15 ms at p95. A frame's first-read rebuild is now on the step path, and this bounds it.
4. **Fallback.** With no Worker, or a worker error, the page is decoded on the main thread as today. Both are pinned by
   tests, plus a mutant.

Anything that misses a gate line is reported as written, and the default stays ON only if 1-3 pass.
