# 2026-10-10 · A fresh wind box built the whole forecast, one full garbage collection per hour; the next box then cancelled it

Side session of `local_2fe7cb68-b48c-421c-aaf1-a556555c9d65` (task: make a fresh wind box cheap on the 1-CPU serve box,
server side, behind a default-off flag). Branch `claude/jovial-cori-a0aa8d`, based on dev `0f73e2fb`, merged with dev
`9e11676c` (#300, the client half, now on dev). Read first: `log/2026-10-10-wind-series-supersede.md`. Nothing here
touched the live backend except ONE `GET /api/health` (HTTP 200, 1.2 s, running `9e11676c`); every number below comes from
the offline replay `backend/tests/test_wind_bg_build_bounded.py`.

## What the replay is

The real `ViewportService.fetch_viewport_grid` + real `WeatherNormalizer` + real `bg_process_remaining_hours_helper` +
real `build_grid_series` (4-wide, first hour serial, 20 s deadline), behind a mock 16-day upstream (385 hourly steps, 299
points for a 11x6-degree box) that honours the provider's 5-minute grid cache. It meters every `normalize` call, every
`fetch_grid` call and every `gc.collect`. `HARNESS_GC=real` runs the collections; `HARNESS_HEAP=app` first imports the route
stack so the heap is the serve process's. CPU is `time.process_time()` of the test process.

## Findings (all measured, in the order they changed the design)

1. **The cost per background hour is a full-heap garbage collection, not the physics.** `cProfile` of one fresh box (mini
   only, flag off): 201 s total, `gc.collect` 163 s in 391 calls (0.418 s each), `json.dump` of the dynamic index 10.7 s,
   the normalizer 3.9 s. `bg_process_remaining_hours_helper` calls `gc.collect()` after EVERY hour (`fbff4ace`,
   2026-06-22, "optimize memory footprint", on the then-512 MB box), on the event-loop thread, so each hour blocks the
   loop for the length of a full collection. **A full collection walks the whole heap**: the same build costs 0.047 s per
   collection in a bare test process and 0.42-0.58 s in one that has imported the app (`routes.weather`; three runs). The serve process
   (RSS ~1.65 GB) is the second kind, which is why a cold 48-frame page took ~24 s on Render (0.5 s/hour observed) and
   its tail timed out against `GRID_SERIES_DEADLINE_S` = 20. I could not measure the production per-collection cost
   without load; the offline figure for an app-sized heap (0.42 s) and the observed 0.5 s/hour agree.
2. **~337 of the 385 hours a box builds were never asked for** (a page asks 48 of them, 3 h apart).
3. **A new box cancels a task whose waiters then re-enter.** `finally` fails every unresolved hour future of the
   cancelled task; the waiters (up to 4 per page, one per semaphore slot) catch it, take the self-heal path, find
   their context gone, become fetchers (a provider-cache hit, so cheap in I/O, but a normalize + persist + a new
   background task) and **cancel the NEW box's task in turn**. Two boxes with a page in flight each: 19 cancels, 20
   `fetch_grid` calls for 2 boxes, 431 hours normalized (18 of them twice), the pages got 30 and 33 of 48 frames (app
   heap). Four pan views: 31 cancels and 28 re-entries (lean heap). The log's "5 cancels in 6 minutes" is this at the
   owner's real cadence.

## Design (smallest change that removes the amplifier)

`WIND_BG_BUILD_BOUNDED` (default 0; `os.environ` at call time; registered in `_RATING_FLAGS`; **wind only**), new module
`services/weather_pipeline/wind_bg_build.py`, three edits to `viewport_helper.py` / `viewport_service.py`:

- **Which hours:** waited-for hours first (unchanged), then a window of `WIND_BG_WINDOW_H` (default 6) hours either side of
  the fetch's own hour, nothing else. The fetch stays 16 days: the 14-day horizon and the tier contract are untouched,
  and an unbuilt hour resolves on demand (below).
- **How long:** after the window the task lingers `WIND_BG_LINGER_S` (default 3) seconds for late waiters of the same
  page, then retires and pops its context as today. A context nobody can wait on (the native-recovery build) does not
  linger, so the recovery lane is not held.
- **What it costs per hour:** a young-generation `gc.collect(1)`; the final full collection in the `finally` stays.
- **The slot:** a new box no longer cancels a task that still has a pending waiter (it is held in `KEPT_BG_TASKS`,
  because asyncio holds tasks weakly); a task with no waiter is speculative work and is still cancelled, as today.

No served number moves: every hour that is built goes through the same normalizer call with the same arguments; the test
pins page vectors and an unbuilt hour equal, flag on vs off. No `SCOREBOARD.md` row (no surf height, rating, glyph, hub
or wind value changes).

## Results

Python 3.12.10, this machine, 24 cores, nothing else on the test process. Collections run for real (`HARNESS_GC=real`)
over the app heap (`HARNESS_HEAP=app`: `routes.weather` imported, 620-800k gc-tracked objects; the serve process is
larger, so its per-collection cost is at least this). "CPU" is the test process's `time.process_time()` until the
background build ended. Command:
`HARNESS_TABLE=1 HARNESS_GC=real HARNESS_HEAP=app python -m pytest tests/test_wind_bg_build_bounded.py -k test_table -s`
(flag off 29 minutes; flag on 1 minute). The flag-off rows ran on the code before the spawn-time collection also went
young-generation; the flag-on rows were re-run on the final code.

| scenario (per fresh box unless stated) | flag | hours normalized | full `gc.collect` | upstream fetches / `fetch_grid` calls | cancels | CPU-seconds | frames per 48-frame page |
|---|---|---|---|---|---|---|---|
| mini only (1 frame asked) | off | 385 | 386 | 1 / 1 | 0 | 188.0 | - |
| | **on** | **9** | **1** | 1 / 1 | 0 | **0.8** | - |
| mini + cold page 0 (49 frames asked), then rest | off | 385 | 386 | 1 / 1 | 0 | 211.2 | **27** (the tail timed out) |
| | **on** | **54** | **1** | 1 / 1 | 0 | **2.5** | **48** |
| two boxes, the second lands mid-page (8 builds later) | off | 431 (413 distinct) | 432 | 2 / **20** | **19** | 230.0 | 30, 33 |
| | **on** | **108** | **2** | 2 / 2 | **0** | **5.4** | **48, 48** |
| a pan session: 6 views, one every 40 builds | off | 595 (592 distinct) | 596 | 6 / **24** | **23** | 362.1 | 47, 43, 43, 28, 24, 24 |
| | **on** | **324** | **6** | 6 / 6 | **0** | **14.7** | **48 x 6** |

Per fresh box that rests: 385 -> 54 hours, 211 -> 2.5 CPU-seconds (84x), and the page that lost its tail now arrives whole.
(The mini's window is 9 hours, not 13, because this run's "now" is hour 02 UTC and the window clamps at the start of
the 16-day array; the tests derive the expected set from the same function, so they hold at any hour.)
The flag-on cost is the hours the views asked for (a page's 48 plus the mini's window, shared) and nothing else; a box
that is only glanced at (mini) costs one window. What is left per built hour (~45 ms of CPU, profiled) is about a third
the dynamic index rewriting its file (see "Not done" 2).

**Memory (same 385-hour flag-off build, three collection policies, psutil):** peak working set 262 MB with no
collection at all, 261 MB with a young-generation pass per hour, 262 MB with a full pass per hour (start 259 MB each); CPU 6.3 / 5.9 / 224 s. The
per-hour full collection bought no measurable memory in this build and cost 224 CPU-seconds of it. Limits: a Windows
process, a 299-point box, no other traffic; the Linux allocator and a world-size box were not measured, so the read-back
includes peak memory.

**The old path serves frames of another box under churn (probe, 4 pan views, stubbed collections):** flag off, the
later pages carried 6, 8 and 4 frames (of 48) whose `product_id` belongs to a DIFFERENT box (the self-heal path's stale
fallback), none flagged `frame_substituted`; flag on, 0 of 192. Not changed here; it is a second reason to
stop the cancel churn.

## Tests (`backend/tests/test_wind_bg_build_bounded.py`, 17 tests, ~50 s; every one mutation-checked)

Every test runs offline (collections counted, not run, so the file takes ~46 s). Run once per mutation, one text change at a time,
source restored byte for byte after each (`-x`; the first red test is named):

| mutation | red test |
|---|---|
| the flag never turns on | `test_on_a_fresh_box_builds_the_window_not_the_forecast` |
| the window is the whole forecast | `test_on_a_fresh_box_builds_the_window_not_the_forecast` |
| the helper ignores the window | `test_on_a_fresh_box_builds_the_window_not_the_forecast` |
| no linger | `test_a_registered_context_lingers_for_late_waiters_then_retires` |
| linger even when nobody can wait (native-recovery shape) | `test_a_context_nobody_can_wait_on_does_not_linger` |
| the next box always cancels | `test_a_new_box_does_not_cancel_a_task_a_request_is_waiting_on` |
| the slot's context is never recorded | the same test |
| the kept task is not held (asyncio keeps tasks weakly) | the same test |
| a waiter never counts | `test_off_the_new_box_cancels...` (its helper waits for a waiter) and `test_keeps_task_needs_...` |
| a full collection per hour again | `test_on_a_young_generation_collection_replaces_the_full_one_per_hour` |
| the registry default is "1" | `test_the_flag_is_declared_in_the_registry_off_by_default` (and the lane-parity guard) |
| the flag applies to marine too | `test_the_flag_is_wind_only_and_off_by_default` |

Beyond the mutations: the flag-off behaviour is PINNED (385 hours, a full collection per hour, a new box cancels the task
and the waiting hours refetch), so the "on" tests cannot pass for the wrong reason; page vectors and an unbuilt hour are
equal flag on vs off; the unbuilt hour resolves from the provider cache, and from one fresh fetch after the cache is
cleared. 110 neighbouring tests (dynamic viewport, orphaned waiter, shared-context poison, upstream timeout, wind native
recovery, stale-cache reval, flag-lane parity, config fingerprint, grid-series deadline and anchor) pass with the flag
off. CI floor: guards 194/2635 -> 195/2652 and `_FLOOR_SET_FROM["guards"]` 2641 -> 2658 (hosted reading on dev
`9e11676c`: 194 files, 2641 passed; this PR adds 17 and must read 195 / 2658).

## What the flag costs (read before flipping it)

- **Scrubbing a rested view to an hour outside the window** is a cache miss: the request becomes the fetcher, which is a
  provider-cache hit inside 5 minutes of the box's fetch and ONE fresh upstream fetch after that (the cost every fresh
  box pays today), then builds that hour and its own window. Today every hour of a rested box is on disk (until the 30-min
  stale refresh), so those scrubs are instant. The 14-day scrubber is NOT capped: `timeline_scrub_start` pages request
  hours the same way and are served; the test requests hours +100 and +200 after the cache is cleared.
- The memory policy changes (no per-hour full collection). Python frees the per-hour pydantic products by reference
  count; the full collection only matters for cycles, and the task still ends with one. Measured above: no memory difference in a 385-hour build.

## Not done, and why

1. **`/grid` and the wind series lane still send different boxes for one pan** (the whole-degree box vs the raw viewport
   snapped outward), so one pan is still two 16-day fetches and two bounded builds. Sharing the box (one fetch through
   `IN_FLIGHT_REQUESTS`) can flip `choose_adaptive_resolution`'s 0.5°/1.0° step, which is a step function of the
   snapped area (area 100 deg²: the log's boxes are 14x7 = 98 → 0.5° and 15x7 = 105 → 1°). That moves served values, so
   it ships dark and is the owner's call; not touched here (PR #300 owns the series lane).
2. **`dynamic_index.add_product` rewrites the whole index file on every call** (`prune_expired` + `_load_index` + `_save_index`,
   on the loop thread): ~5 s of the 15 s CPU of a flag-on 6-view pan, and quadratic in the hours a box builds. The next hotspot once the
   collections are gone; batching the index write is a separate change.
3. **The fetch is still 16 days per fresh box.** Open-Meteo load and 429s are unchanged; only the provider's 5-minute cache absorbs repeats.
4. Marine (`conjoined` layers) has the same per-hour full collection and no window; out of scope, wind only.
5. Under churn the OLD behaviour completes pages with frames from neighbouring boxes' products (the stale fallback of the
   self-heal path): see the probe line in the results. Not changed.

## Rollback and read-back

Off by default: nothing changes until the owner sets `WIND_BG_BUILD_BOUNDED=1` on Render. Rollback = unset it (the
next deploy/restart; the flag is read at call time). Read-back owed after a flip (ledger commitment): in a Render log
window over an owner pan session, `Canceling stale background task for gfs_wind` is rare and `Keeping background task`
appears, no `hour +NNh timed out` on page tails, `Background task finished without processing this hour` absent, and
`/api/health` stays under ~2 s while the map is panned. Do not replay live (CLAUDE.md).
