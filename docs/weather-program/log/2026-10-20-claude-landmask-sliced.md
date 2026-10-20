# Land mask off the critical frame: a sliced prototype, priced for the owner (2026-10-20)

Session opened 2026-10-20T12:11Z, started by the lead session after PR #408 (log `2026-10-20-claude-landmask-fast.md`
sections 1, 2 and 9). Task: design and prototype moving the EVENT-DRIVEN land-mask repaints off the critical frame, **not**
shipped on without the owner's word, and say with numbers how much stall time moves and exactly which transient frames
change. Branch `claude/landmask-offframe` on `dev` 0fc67408a, worktree `.claude/worktrees/landmask-offframe`. Client and
harness only; **no served number changes** (no SCOREBOARD row). Offline throughout: the real backend over synthetic data on
:4195 (`serve_synthetic.py --thin-bounds 1 --dynamic 1 --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind
--regions flagship`), the bundle on :3195 with the 10 m land file served locally; the live box was never touched.

## 1. What was built (OFF by default: `window.__RAW_SLICED_LAND_MASK__ = true` turns it on)

**Option chosen: time-slicing, not a Worker.** The painter (`overlayBasemapWaterOnMask`), the shelter classifier and the
inland-water guard become step GENERATORS. The synchronous callers run them to completion inside one call, so with the
flag off (and on every data-commit path with the flag on) the canvas receives the same calls in the same order as before.
With the flag on, a map-event refresh (idle / moveend / zoomend / sourcedata) does this:

1. **Now, inside the event:** every existing gate (zoom, span, hysteresis, delivered coverage, tile readiness), then every
   map read the paint needs, at once (`snapshotOverlayInputs`: the rendered water features, the strict viewport, the two
   wetland source queries; this is the only change of order on the default path: the wetland query moved up from step 4,
   same map state, no side effect).
2. **Then, across short tasks** (`maskSliceScheduler.js`, `setTimeout(0)` per slice, 8 ms budget): the pristine Natural-
   Earth canvas, the water / hole / wetland draws, the inland guard, the island re-assert, the shelter classifier, the
   open-water verdict. Chrome's 2D canvas records draws and rasterizes them at the next read, so each slice forces its own
   raster with a 1 px `getImageData` (every 24 draws and after every pass); otherwise the raster would land in whichever
   slice reads next.
3. **Last task:** the same commit code the synchronous path runs (coast SDF, `texImage2D`, hysteresis state, patch
   carry-forward), then `triggerRepaint`. (The nested z >= 8 overlay is not requested from here: see below.)

Safety: one job per engine; a request while a job runs only marks it pending (one re-drive when it ends, which bypasses the
layer's 700 ms throttle); the job is dropped before any slice, and before the commit, if its target changed (new mask
texture / geojson / bounds, the wave data unbound, or a SYNCHRONOUS paint of the same texture landed: each commit bumps a
per-target paint sequence). So an older job can never overwrite a newer mask, and no half-painted mask is ever uploaded.
At z >= 8 the regional paint's nested overlay is requested in the same event and waits in a FIFO behind the regional job
with its own inputs already read (section 3 says why; one edge differs from the default path: the default path skips the
nested overlay when the regional paint ends up painting nothing, the queued one still paints the view).
Telemetry: `window.__RAW_GPU__.maskSlicing` (scheduled / committed / stale / coalesced / failed, slices, per-slice log,
longest piece per named pass, request-to-upload latency).

**Why not the Worker (priced, not built):** browser support is not the obstacle (the lead's MDN read: OffscreenCanvas 2D
in workers Chrome 69 / Firefox 105 / Safari 16.4; `scheduler.yield` has no Safari, so slicing needs the `setTimeout`
fallback used here). OffscreenCanvas 2D in a worker needs `willReadFrequently` parity and has no
guarantee of the same raster bytes as the main-thread software canvas; every paint would clone ~2 MB of features (the
geometry getters are lazy on the main thread, so they would all be forced first); the basin-verdict stash, the shelter
cache and the settle gate are module state the main thread also reads (the crisp overlays darken with the stashed basin
verdict) and would have to move or be mirrored. The slice prototype keeps all of that where it is, and its bytes are equal
by construction (section 3).

**File moves (the engine is over the 800-line cap):** the two engine refresh methods moved to `marineMaskRefresh.js`
(the prototype methods delegate; `WebGLMarineEngine.js` 3205 -> 2861 lines); the painter moved to `basemapWaterOverlay.js`
first in a byte-for-byte commit (2c841a09a; `WebGLMarineMaskRenderer.js` re-exports every name, 796 -> 290 lines).

## 2. How much stall time moves off the frame (in the app, same bundle, flag off vs on)

Two instruments, both offline, arms interleaved in the same hour on one bundle (the flag is set before boot).

**(a) The app's own receipts** (`scn_mask_calls.js`, 7 zoom/pan steps, 4 runs per arm, medians per step; "event-task mask
CPU" = the `maskRefresh*` phases, i.e. the whole idle/moveend/zoomend/sourcedata refresh as it ran inside the event's task;
"long tasks" = PerformanceObserver `longtask` time in the step):

| step | event-task mask CPU, ms (off -> on, per run) | long-task time, ms (off -> on, median) | sliced work, ms (max slice) | request -> upload, ms (median / max) |
|---|---|---|---|---|
| zoom 6 | 144 88 92 128 -> 21 23 23 30 | 341 -> 261 | 102 (20) | 210 / 234 |
| zoom 8 | 139 146 272 172 -> 40 36 36 35 | 910 -> 794 | 528 (40) | 642 / 917 |
| pan east | 464 362 440 329 -> 13 11 8 13 | 746 -> 31 | 282 (45) | 282 / 384 |
| zoom out 4 | 1 -> 1 (no paint) | 281 -> 334 | 0 | - |
| zoom 8 (b) | 114 198 144 139 -> 14 19 11 13 | 600 -> 36 | 145 (26) | 361 / 396 |
| pan (b) | 190 248 177 246 -> 12 11 10 11 | 434 -> 240 | 214 (28) | 186 / 260 |
| zoom out 3 | 1 -> 1 (no paint) | 0 -> 0 | 0 | - |
| **sum of medians** | **1,032 -> 97 (-91%)** | **3,310 -> 1,694 (-49%)** | **1,269** | |

Re-run on the final bundle (9a9dead63, after the section 3 fix), 2 more runs per arm: event-task mask CPU 1,067 -> 91 ms
(-91%), long-task time 3,141 -> 1,961 ms (-38%), latency medians 198-507 ms (max 641), max slice per step 21-48 ms.

Every run moves the same way (the per-run columns). What stays in the long tasks with the flag on is NOT the event-driven
paint: zoom 8's ~800 ms is the data commit (`waveDataUpdate`, the encoder's mask rebuild, the synchronous commit re-patch),
pan (b)'s ~230 ms is two commit re-patches, and the zoom-outs are world-mask rebuilds. Over the 4 runs: 32 jobs, 24 committed, 8 dropped as
`stale` (4 of 8 at zoom 8, 4 of 8 at pan east: a data commit landed mid-job and re-patched synchronously), 3 requests
coalesced, 0 failed (a data commit landed mid-job and re-patched synchronously), which is the design working, at
the price of that job's CPU.

**(b) CPU-profiled stalls** (`lab.js FLOWS=pan_zoom_future LAB_TRACE=1` + PR #400's `stall_profile.js` at 50 ms (a stall =
one main-thread task >= 50 ms) + `mask_split.js`, 6 runs per arm, medians):

| | flag off | flag on |
|---|---|---|
| all stall time in the flow | 4,255 ms | 2,445 ms (-43%) |
| land-mask time inside stalls (stall_profile stage) | 1,502 ms | 423 ms (-72%) |
| stall time on the zoom / pan steps | 2,769 ms | 1,015 ms (-63%) |
| per step: zoom 6 / zoom 8 / pan east / zoom out 4 | 431 / 751 / 492 / 323 | 288 / 165 / 38 / 253 |
| worst stall | 480 ms | 331 ms |
| mask stages inside stalls (mask_split; overlapping stall definition) | rasterize 623, overlay 448, shelter 421, inland 262 | rasterize 496, shelter 217, overlay 164, inland 108, slice driver 75 |

Run-to-run spread is wide (flag off 321 to 6,970 ms; one run per arm recorded a truncated trace, 321 and 1,300 ms: the
medians are the same with them excluded). The `erratic` flow (mostly scrubbing, 3 runs per arm) is too noisy to read:
land-mask stall time 916 -> 539 ms, all stall time 6,869 -> 8,813 ms in opposite directions run to run; its zoom 8 + pan
steps read 1,856 -> 1,547 ms. `mask_split` defines a stall as an unbroken non-idle stretch, so back-to-back slices can merge
into one there; `stall_profile` (per task) is the authority for "off the critical frame".

## 3. Same bytes

**Replay bench, fixed inputs** (`mask_replay.js` with the new `SLICED=1`: #408's 56 captured paints, dark 21 / light 17 /
beach 18, each run through `origin/dev`'s one-call painter and through this branch's steps exactly as the scheduler drives
them, flushes included; 2 reps): **56/56 canvases byte-identical on both reps, applied/degraded verdicts and the painter's
receipts identical**, before and after the two classifiers became generators. The flag-off path is the same steps run to
completion, so it is covered by the same compare; the full Jest trees pass unchanged (342 suites / 5,065 tests).

**In the app, settled masks read back from the GPU** (`scn_mask_identity.js`, 7 views, after the mask settles; the
settle check now also waits for a sliced job in flight), off vs on, 2 runs per arm per theme:

- **First batch (commit 02447074c): one real settled difference, found and fixed.** 37 of 41 (theme, view, texture,
  bounds) groups both arms reached were identical; the SoCal z10 overlay was not, in every run and every theme (dark and
  light: off `81d4ab49` both runs, on `a7ac5bd3` both runs; beach: off `c56c54c0`, on `a7a4b2ba` / `685c3109`; water
  fraction +0.00025). Cause: the regional job's COMMIT requested the nested z >= 8 overlay, so that overlay read the map
  L ms after the event, where the synchronous path reads it in the event; the hysteresis then held the late read as the
  settled overlay. (#408's evidence shows dev itself settling `a7ac5bd3` once, in a run where another grid was resident:
  a real alternate input, now made the rule by the flag.) Fix 9a9dead63: the nested overlay is requested inside the
  event, queued behind the regional job with its inputs already read.
- **Second batch (final bundle 9a9dead63): 42 of 43 groups identical, 0 hashes produced only with the flag on.** The one
  group that differs is dark FL z8's overlay, where the FLAG-OFF arm produced two hashes on its own (`812d1cc6` run 1,
  `9e21392f` run 2) and the on arm `9e21392f` twice: timing, within the null control. 3 groups were reached by one arm
  only (which grid is committed at a view, a -96..-64 mid clip or a 4-degree tile, is timing-dependent, as in #408).
  SoCal z10 overlay: dark and light `81d4ab49`, beach `c56c54c0`, in all four runs each.

## 4. Exactly which transient frames change (flag on only)

Only frames drawn between a map event that WOULD paint and the sliced job's upload. Everything else is untouched:

- **Data commits do not change.** A commit re-encodes the mask without the basemap overlay and re-patches it in the same
  call (the `commit` trigger, about half of a pan's paints in #408's count); that stays synchronous with the flag on, so
  the Natural-Earth-only mask is still never presented after a commit (the bays-flicker class cannot return through
  this). A sliced job in flight when a commit lands is dropped (`stale`), never uploaded over it.
- **Skipped refreshes do not change.** Every gate (hysteresis, delivered coverage, tile readiness, zoom and span) still
  runs inside the event, with the same answers.
- **What changes:** after an idle / moveend / zoomend / sourcedata refresh decides to paint, today the event's task paints
  and uploads before the browser can draw again (the map shows its last frame, frozen, for the paint's duration). With the
  flag on, the map keeps drawing and animating for the job's latency (section 2) with the mask that was resident BEFORE
  the event, then switches to the new one in one frame. Concretely, for that window:
  - **regional grid, base mask (z >= 6, span <= 16 deg):** the texture holds the previous truth box's basemap patch; any
    part of the view outside that box shows Natural-Earth coast (no port landfill, piers, marsh, sheltered-basin verdict),
    so wash or crests can sit over those for the window, as they do today until the paint finishes;
  - **viewport overlay (wide grids from z 4.4, and regional grids from z 8):** the previous overlay covers where the view
    WAS; outside it the shader falls back per pixel to the base mask (world mask for wide grids: ~10 km texels);
  - **a degraded paint's self-heal** (grey-rectangle class: a partial tile query re-driven by idle) shows the degraded
    mask for the window before the healed one;
  - **a gesture started during the window** moves the camera over the previous mask instead of waiting for the paint
    (today the gesture's first frames wait behind it).
- **Settled masks:** the job paints from the inputs read at the event (the same inputs the synchronous paint would read at
  that instant), and a request arriving during the job is re-driven once when it ends, so the last paint of a settled view
  runs on settled inputs. Section 3 checks this in the app.

## 5. What still blocks a frame (flag on), and the next levers

- **The data-commit re-patches** (synchronous by design; about half of a pan's paints in #408's count) and the
  encoder's world-mask rebuilds on zoom-out (`rasterize` in the table above). Untouched here.
- **The largest single piece of a sliced job** (replay bench, longest piece any captured paint ran in one go; median /
  max over 112 paint-reps): the Natural-Earth raster of a new overlay canvas (`renderMaskToCanvas`, LRU miss) 11-22 /
  44-86 ms; one shelter chamfer pass 5-11 / 67-115 ms (outliers: the first pass after a cache miss also builds the hash and
  arrays); one flush of 24 recorded draws 2-4 / 40-63 ms (a single huge water polygon); the commit (coast SDF + one
  4096x2048 `texImage2D`) ~12 ms. In the app: median max-slice per step 20-45 ms, 1.5-6.5 slices > 16 ms per step.
- **Next levers, each byte-identical by the same construction:** make `renderMaskToCanvas`'s polygon loop a generator too
  (the base-raster piece); flush per draw when a polygon is large (vertex count known before the draw); split the
  chamfer passes by row bands; upload only the truth box's rows with `texSubImage2D`. A per-frame budget from
  `scheduler.yield` (Chrome 129+) would interleave better than `setTimeout(0)`, with this as the Safari fallback.
- **Latency is the price:** request -> upload median 186-642 ms per step (max 917 ms at zoom 8, where it competes with the
  data commit), against today's 70-300 ms freeze. A smaller slice budget lowers jank further and raises latency.

## 6. Owner decision

The trade, in one line: with the flag on, ~90% of the event-driven mask CPU leaves the map-event tasks (1,032 -> 97 ms over
the 7-step scenario), zoom/pan stall time falls by about half to two thirds, and settled masks are the same bytes (section
3). The cost is that the mask a moveend / idle / zoomend / sourcedata paint would have shown at once lands 0.2-0.6 s later
(up to ~0.9 s next to a data commit), with the previous mask on screen and animating meanwhile (section 4).

- **Ship it on:** flip the default (`landMaskSlicingOn` -> `window.__RAW_DISABLE_SLICED_LAND_MASK__ !== true`), since no
  served number changes (a client-only visual change ships on with a kill switch), then the live read-back: in the owner's
  browser, `window.__RAW_GPU__.maskSlicing` after a zoom/pan session (committed > 0, failed 0, latency list), and the
  same session with the kill switch for the feel.
- **Keep it off:** nothing changes; the refactor (generators, the moved modules) is behaviour-preserving either way.
- Either way, section 5's levers are next if more stall time must move (the commit re-patches are now the largest
  mask cost left on the critical frame).

## 7. Tools changed (all offline) and tests

`mask_replay.js` gains `SLICED=1` (drives the steps like the scheduler; per-pass longest piece). `scn_mask_calls.js` reports
`sliced` (jobs, outcomes, slices, max slice, latency) and jobs by trigger; `scn_mask_identity.js` waits for an in-flight
job before reading back; `mask_split.js` knows `basemapWaterOverlay.js`, `marineMaskRefresh.js` (glue / upload) and
`maskSliceScheduler.js` (`slice`) and generator declarations. New Jest: `maskSliceScheduler.test.js` (8: opt-in flag,
nothing runs inside the event, one commit, flushes are 1 px reads, stale drop, coalescing, FIFO queue + where the re-drive
goes, failure frees the slot) and `marineMaskRefresh.sliced.test.js` (8: flag off = old call, data-commit path stays
synchronous, map read in the event and upload later, a synchronous paint makes the job stale, a new mask texture drops it,
coalesced re-drive, the queued nested overlay, the wide-grid overlay). Jest trees 342 suites / 5,065 tests before the
queue fix; the 5 mask/engine suites (79 tests) after it. ESLint ratchet and LOC ratchet pass.

## 8. PR and ledger

Draft PR against `dev` (below). Nothing merged, nothing flipped; STATE.md not edited (its ledger anchor is the lead's).
