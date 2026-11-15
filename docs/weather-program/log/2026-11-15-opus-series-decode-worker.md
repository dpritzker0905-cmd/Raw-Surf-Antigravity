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

## 14:45Z: AMENDMENT to gate 1, made before any after-arm number exists (no worker code written yet)

Gate 1's metric was wrong for this change, so it is replaced here, in the open, before measuring.

**What was wrong:** long-task time over a whole cold load plus 10 scrub steps is dominated by work this change does not touch:
map and style init, React mount, and the ~150-250 ms per-step React re-render already profiled on the throttled phone
(next-batch item (b)). Removing the series decode entirely could not halve it, so it cannot judge this change.

**Second bench, made while deciding the design** (`series-path-bench.js`). Today's whole decode path per page is the body's
UTF-8 decode plus `JSON.parse` (world 1.6 + 25.1 ms; regional 0.4 + 4.3 ms). An EAGER rebuild from transferred columns would
leave 10.1 ms (0.38x) for a world page and 3.0 ms (0.63x) for a regional one. Eager fails 50% on regional pages, which are
the common case at close zoom. So the design is LAZY:
- A page's frames are kept packed; a frame is built (its vectors, then `frameToMarineData`, then the truth-tag mint on the
  real vectors) when it is first read.
- The two all-frame readers in `marineGridSeries.js` (the newest verified cycle and the coarse-preview check) read frame
  metadata without building frames.

**Gate 1 (replaces the version above):**
- **Metric:** main-thread milliseconds in the series DECODE PATH, summed per session.
  - Kill arm: `JSON.parse` of each page plus its frame loop (`frameToMarineData` for every frame).
  - Worker arm: the page's message handling plus every frame build, wherever it happens. A frame materialised later by a
    scrub or the frame store is counted.
  - Instrumented in both arms by the same in-app telemetry: `window.__MARINE_SERIES_DIAG__.decodeMs` / `.decodes`.
  - Session: a cold map load, the three series pages landing, then a 10-step scrub, on the throttled phone profile.
    GFS waves, z2 and z6, 5 fresh loads per arm per zoom.
- **Pass:** median(worker) <= 0.5 x median(kill) at both zooms.
- **Secondary, reported but not gating:** long tasks (> 50 ms) that overlap a series page's arrival, per arm.

Gates 2-4 are unchanged.

## 15:31Z: results, gates 1 and 2 (build cddf778ea; offline; host audit "ok" on every session)

**Gate 1 (as amended): PASS at both zooms.**
- Setup: `scn_series_decode.js`, phone 390x844 @3x, 4x CPU, GFS waves, 5 fresh sessions per arm per zoom, alternating order.
- Metric: decode-path main-thread ms per session (cold load, the pages landing, a 10-step scrub).

| zoom | worker, median (runs) | kill, median (runs) | ratio | pass at 0.5x |
|---|---|---|---|---|
| z2 | 83.7 ms (142, 86, 68, 75, 84) | 322.7 ms (565, 455, 323, 320, 220) | 0.26 | yes |
| z6 | 82.3 ms (57, 98, 102, 79, 82) | 213.7 ms (171, 433, 214, 253, 212) | 0.39 | yes |

- Pages decoded: the worker arm decoded every page in the worker (z2 4, z6 8 per session; 0 on the main thread). The kill arm
  decoded all of them on the main thread.
- Secondary (not gating): long tasks within 1 s of a page arrival, median ms, worker vs kill: z2 58 vs 433; z6 60 vs 69.
- Whole-session long-task totals were 6-42 s per session in BOTH arms. That confirms the amendment: the whole-session metric
  could not have judged this change.

**Gate 2: PASS where comparable.**
- Jest, against recorded offline pages (world, regional, a swell_2 page with null periods): pack then rebuild equals
  JSON.parse for every frame, by `JSON.stringify` (key order) and `Object.is` per cell. Edge values (-0, 1e-300, max double,
  null vs absent) and the raw fallback are tested. Mutants: dropping the null branch fails 7.
- In the app (`series-identity-probe.js`, desktop): every hour the engine drew FROM A SERIES FRAME in both arms was fingerprinted
  (FNV-1a of the drawn waveGrid's vectors, cols, rows and bounds).
  - z2: h3, h6 and h9 IDENTICAL across arms (3/3).
  - z6: no hour was series-drawn in both arms (the store or /grid drew the others), so z6 is INCONCLUSIVE, not a pass.
  - z6, at fixed samples: hour 0 and hour 3 (both /grid-drawn) were identical across arms.

## 15:37Z: gate 3, first run INCONCLUSIVE; AMENDMENT of its instrument (made AFTER seeing that run, disclosed)

**Run:** `scn_instant_contract.js`, desktop, GFS waves, z2 and z4.6, 10 single steps plus one jump, one session per arm. Static
frames were killed in both arms to force the series path.

| arm | z2 step p50 / p95 | z4.6 step p50 / p95 | z4.6 steps missed |
|---|---|---|---|
| worker | 12 / 4884 ms | 1655 / 2259 ms | 6 of 11 |
| kill | 11 / 2538 ms | 1551 / 1902 ms | 6 of 11 |

Neither arm had a blank or mislabelled frame. In BOTH arms, 10 of 11 steps were drawn via /grid and only 1 via series. That is
the harness's documented limit: a series frame carries no product id, so it is never timed as exact. So this run did not
measure the series step path. Its p95 rests on one session per arm (a single slow /grid step decides it).

**Why amend.** As written, gate 3 named "the raster lab's marine scrub", and the raster lab does not measure marine layers. So the
pre-registered instrument did not exist. The only way this change can add step latency is the synchronous first-read build of
the frame a step shows. In the kill arm that work happens when the page lands, not on the step.

**Amended gate 3:**
- Metric: the decode-path ms each scrub step adds, i.e. `__MARINE_SERIES_DIAG__.decodeMs` read just before and 900 ms after
  each ArrowRight (`scn_series_decode.js`, stepBuildMs).
- Profile: phone 4x CPU, the gate 1 sessions' setup, 3 sessions per arm per zoom, z2 and z6.
- Pass: in the worker arm, per-step added ms p50 <= 5 and p95 <= 15. The kill arm is reported alongside (expected about 0).
- The inconclusive harness run above stays in the record.

## 15:55Z: amended gate 3, first run: FAIL at z6 p95; cause found and fixed; re-run on the fixed build follows

`scn_series_decode.js` (stepBuildMs), phone 4x CPU, 3 sessions per arm per zoom, 10 steps each (30 steps per cell), build cddf778ea.

| zoom | worker: ms added per step, p50 / p95 / max | kill: ms added per step, p50 / p95 / max | registered pass? |
|---|---|---|---|
| z2 | 0 / 11.7 / 15.9 | 0 / 0 / 0 | yes |
| z6 | 0 / **19.0** / 27.5 | 0 / 158.2 / 171.7 | **no** (p95 > 15) |

- At z6 the kill arm adds far more to a step: when stepping into a new page, the whole page decodes on the main thread. But the
  registered threshold is absolute, so this is a FAIL as written.
- **Cause:** `getMarineSeriesFrame` and `nearestFrameInEntry` called `entry.frames.get(h)` on every closer hour. On a lazy page
  that builds every frame from the page start to the target hour.
- **Fix (96f2033e8 + 6c….):** keep the nearest (entry, hour) and read it once. Same result.
- **Test:** a 12-frame lazy page, nearest h30, builds 1. Mutant: get on every improvement fails it.
- Gate 3 is re-run below on a rebuild, same instrument and same settings.
- Correction (15:56Z): the fix commit is `1a66cd4cf` (the two searches); `96f2033e8` only moves the test's import. The "6c…." above is
  a typo.
