# 2026-10-27 (claude, side session of the lead): EURO z9 "never draws" h141-155 was the simplified-layer fallback, and the line kept describing the unmounted layer

Branch `claude/euro-z9-fallback-truth` from dev 4bd90d0d9. Client words + the drawn-frame record + harness only: no served number,
no fetch, no commit rule changes. Kill: `window.__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__ = true` (the record outlives the layer and the line
describes it, as before). Round 2 (below) adds the guardrail's throttle-cadence rule, ON, kill
`window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__ = true`: the live trip was Chrome's 1 Hz throttle, not a slow device.

## Ask

- **The lead's live read** (2026-10-27 13:58-14:08Z, dev--rawsurf at dev 89a494aca, backend f179f495b, EURO waves, z9.0 over the
  Florida east coast): an in-page probe stepped the ForecastWheel one hour at a time.
  - h120-140: 3-hourly frames, "nearest" between them, "Loading" 576-980 ms on frame hours.
  - h141-155 (valid 11-02T11Z to 11-03T01Z): "Loading X… still showing Mon, Nov 2, 4 AM" at all 15 hours; `__MARINE_DRAWN__` stayed at
    11-02T09Z (estimated, runMs null, store false); every `/grid` answered 200 in 123-776 ms; h156 later drew 11-03T03Z.
  - `__RAW_FRAME_STORE__`: `shows.misses.crop_only_set` 24, `commits.no_served_time` 29.
- **Questions:** what `/grid` serves at z9 in the band (and from which product); why the client did not commit it; whether z9 EURO
  should fall back to the store's 6-hourly frames.

## Q1: what `/grid` serves (ONE health-gated live read, 17:08:43-17:08:55Z)

- `/api/health` before: 200, healthy, backend f179f495b. After: 200, healthy.
- Six z9 asks, bbox `-81.2,27.8,-79.6,28.9`, sequential, 219-341 ms each.
- **Every answer is the `florida_east_coast` REGIONAL tile** (13 x 17 after the 2-deg snap clip, 0.25 deg), an estimate:
  `euro_marine_waves_florida_east_coast_<vt>_estimated.json`, provider `estimated`, source `estimated_blend`, basis
  `euro_persistence_gfs_blend` (EURO anchor 10-28T18Z, weight on GFS 0.96-1.0), `model_run_time` null / `conflicting`, ingest run_time
  10-27 06:29Z (the "run 06Z" the line saw).
- **The served times are honest and 3-hourly through the band:**

| ask (Z) | served_valid_time | frame_offset_hours |
|---|---|---|
| 11-02 10 | 11-02 09 | -1.0 |
| 11-02 11 | 11-02 12 | +1.0 |
| 11-02 12 | 11-02 12 | 0 |
| 11-02 15 | 11-02 15 | 0 |
| 11-02 21 | 11-02 21 | 0 |
| 11-03 03 | 11-03 03 | 0 |

- **No server gap.** `storage.objects` (read-only SQL): every regional estimate 11-02T00Z..11-03T09Z exists, created 10-19..10-20 and
  never re-created (none was deleted). The storage edge log shows the box downloading those same objects during the probe: 09Z at
  13:58:06.6, **12Z at 13:58:08.7**, 15Z 13:58:18.5, 18Z 13:58:27.6, 21Z 13:58:36.5, 11-03T00Z 13:58:45.5, 03Z 13:58:54.5 (about 3 s a
  step from the 12Z ask on, the probe's per-step wait timing out).
- The CDN EURO set at probe time (index `20261027T000000Z-ee3a62fe5858`, written 13:51:10Z) was run 00Z, 6-hourly from 11-02T00Z with
  no estimated frames between; a later index (17:48Z) added `native_time_interpolation` frames at 03/09/15/21Z. Not what z9 reads.

## Q2: why nothing was drawn

- **The lead's own snapshot has the answer:** `shows.misses` = `{"crop_only_set": 24, "no_target": 18}`.
  - `no_target` = `marineFrameStoreRuntime.showStored` found no registered layer (`rt.target === null`).
  - Only `WebGLMarineLayer`'s unmount sets that (`registerFrameStoreTarget(null)` in its `[]` effect's cleanup).
  - MapWebGL unmounts the layer only to swap in the simplified fallback (`webglMarineFailed`):
    - `useWebGLGuardrail`: 12 consecutive seconds under 20 fps; first retry after 60 s; needs `document.hasFocus()`.
    - `useMarineWebglRecovery`: three render errors in 10 s; retry after 4 s.
  - So during the band the WebGL marine layer was off.
  - The orchestrator still asked `/grid` every step (200s); there was no layer to commit to, so `no_served_time` and
    `crop_only_set` stopped counting and `no_target` took their place (37 steps: 24 + 18 = 42 show attempts with the setup).
- **The drawn record is a module singleton** (`marineDrawnFrame.js`) that only the layer and the frame store publish to. Nothing
  cleared it when the layer went away, so `ForecastTimeStatus` compared every new selection with the last WebGL frame:
  "Loading <hour>… still showing Mon, Nov 2, 4 AM" (09Z EST), for good, while the map showed the simplified layer.
- **Why the fallback engaged:** not established in round 1 (ESTABLISHED in round 2 below, from the lead's own tab: the guardrail
  tripped on Chrome's 1 Hz throttle). What round 1 had was consistent with the guardrail:
  - the redraw came "later" at h156, after a pause, which fits its 60 s retry (the error path would have retried in 4 s);
  - keyboard steps on the wheel never set `window.lastScrubTime`, so a stepping session gets no guardrail bypass;
  - an automation tab's frame rate is the obvious suspect for the 20 fps floor.
- **Why no offline run had seen it:** the guardrail is OFF on `localhost` / `127.0.0.1` (`useWebGLGuardrail.js`), which is where every
  harness SPA runs.

### Offline reproduction (the real mechanism)

- **Setup:**
  - `serve_synthetic.py --euro-regional-estimated-after 42` (new): EURO waves regional tiles carry production's
    `euro_persistence_gfs_blend` fields every 3 h, straight through the global 6-hourly band.
  - The probe-time live EURO CDN set (index ee3a62fe5858 and its frames, copied from the public bucket).
  - `scn_euro_z9_band.js` (new): z9 at (-80.4, 28.4), Waves, EURO, one ArrowRight per step, a 3 s wait per step.
  - `AB_CHROME_ARGS="--host-resolver-rules=MAP rawsurf.test 127.0.0.1"` (new in `ab_lib.js`), so the SPA runs on a non-local host
    and the guardrail is live.
  - `TRIP_AT=133`: a rAF-paced 70 ms main-thread load for 16 s, about 12 fps, a slow device's frame.
- **Without the trip** (four runs, phase 1 and 2 anchors, slow series pages up to 20 s, synthetic and live CDN sets): the band
  draws every hour.
  - Frame hours take 0.3-3.7 s, the others 20-100 ms.
  - The only "stuck" steps are offline-backend latency over the 3-4 s wait. No 15-hour stall.
- **With the trip, dev 4bd90d0d9 (bundle main.4a7d43f8):**
  - the guardrail engaged at h133;
  - 18 steps in the fallback read 16 x "Loading <hour>… still showing" the h132 frame, plus one "nearest" and one "Estimated"
    over it;
  - `__MARINE_DRAWN__` frozen, `no_target` 1 -> 19, `crop_only_set` and `no_served_time` frozen, 7 `/grid` 200s in the band;
  - the first step after the 60 s retry drew (h151).
  - This is every live number.

## The fix (this PR, client only, ON, kill switch)

- `marineDrawnFrame.retireMarineDrawn(reason)`: clears the record (`window.__MARINE_DRAWN__ = null`, `__MARINE_DRAWN_RETIRED__ =
  { reason, at }`) and notifies the readers. `WebGLMarineLayer`'s unmount cleanup calls it next to `registerFrameStoreTarget(null)`
  (same line; the file stays at 1098 lines).
- `ForecastTimeStatus`: while the marine fallback is engaged (`useMarineFallbackState`, the legend notice's own source) for a marine
  layer, the line says "Simplified wave layer (reduced graphics mode): this app’s forecast frames are off" (`role="status"`,
  `aria-live="polite"`, `data-drawn-state="fallback"`, the theme's amber tone), and nothing about frames or the rating band.
  Raster layers are untouched.
- When the layer comes back, its first upload publishes the record again and the line reads normally.
- Q3: **no store fallback.** `/grid` had a frame within the window at every hour, and the store's EURO set was not the problem.
  Adding a crop source would not have drawn anything: the layer that draws it was unmounted.

## Tests

- **New: `drawnFrameFallback.test.js` (8 tests).**
  - The live band through the real `ForecastTimeStatus` at the probe clock (13:58Z, anchor 14Z), over the conformed regional estimate
    the layer held at h140 (served 09Z, runMs null).
  - Control: h140 reads "nearest" before the trip.
  - After the trip: none of h141-h155 says "still showing" or is `aria-busy`; all 15 read the fallback words; the record is null.
  - POSITIVE CONTROL with the kill: all 15 read the live line, "Loading <hour>… still showing" the 09Z frame (dated from h144 at the
    probe clock).
  - The retry: h156 over 03Z reads "nearest" again.
  - Every theme.
  - A raster layer is not spoken for.
  - The REAL `WebGLMarineLayer` (the parity test's mocks): the upload publishes h140, the unmount leaves no record; the kill keeps it.
- **Red first:** dev's code fails 4 of 8 (the fix-dependent ones); the 4 controls pass on dev.
- **Mutations:**
  - dropping the layer's retire call fails 1;
  - disabling the status-line branch fails 3.
- **Suites:** `src/components/map` + `src/tests`: 428 suites, 6,082 tests, all pass.
- **Lint:** `check_eslint.js` exit 0, debt only down; the build passes.

## Offline before/after (the same probe)

| arm | steps in the fallback | "Loading … still showing" the retired frame | other words over it | fallback words | `__MARINE_DRAWN__` | first draw after the 60 s retry |
|---|---|---|---|---|---|---|
| dev 4bd90d0d9 (main.4a7d43f8) | 18 | 16 | 2 ("nearest", "Estimated") | 0 | frozen at h132's frame | h151 |
| fix (main.82679fbc) | 19 | 0 | 0 | 19 | null | h152 |

`no_target` climbs 1 -> 19/20 in both arms and `/grid` answers 200 in both (7 times in the band): the fix changes words and the
record, not what is fetched or drawn.

## Not measured / follow-ups

- **Why the live tab fell under 20 fps.** Read `window.__WEBGL_GUARDRAIL_FALLBACK__`, `__MAP_RENDER_FPS__` and the console's
  `[WebGLGuardrail]` lines on the next live read.
- **Keyboard and button hour steps are not "scrubbing" to the guardrail** (only drags set `lastScrubTime`). A slow device stepping
  hour by hour can trip it. That is a design question for the guardrail, not changed here.
- **Wording:** `ESTIMATE_WORDS` has no `euro_persistence_gfs_blend`, so the EURO regional tail reads "Estimated forecast: estimated".
- Not replayed: the phone layout, wind (it has its own guardrail path), the live box.

Evidence (outside the repo, this session's scratchpad): `live_read_z9_euro.json`, `band_dev_6_trip.json`, `band_fix_trip.json`,
`realcdn/` (the probe-time EURO index).

## Round 2 (2026-10-28 03:20Z): the cause was Chrome's throttle, which the guardrail counted as a slow device

### The lead's correction (its own tab, read after round 1)

- **The tab's churn log:**
  - `marine_webgl_fallback` (cause `fps_guardrail`, fps 1) at **13:58:14Z**, 5 s before the probe's steps (13:58:19-13:59:01Z);
  - `marine_webgl_recover` (attempt 2) only at **14:04:04Z**.
- **The same tab, measured afterwards:** `requestAnimationFrame` at **1.1/s**, largest interval **1015 ms**, with
  `visibilityState` 'visible' and `hasFocus()` true. Chrome was throttling the window, and the guardrail read each 1 s window as 1 fps.
- **The lead asked for two things:**
  - confirm the stall does not reproduce offline at a normal frame rate. Done in round 1: four runs without a trip draw every hour,
    so the live symptom was the guardrail;
  - if so, fix the guardrail, ON with a kill switch, plus a Jest pin.

### The rule (`useWebGLGuardrail.js`, THROTTLE CADENCE)

A low-FPS window is the browser pausing us, not evidence, when BOTH hold:
- every frame interval in it sits on the throttle cadence: `THROTTLE_CADENCE_MIN_MS` = 900 ms up to the existing 2000 ms suspend gate;
- its marine render calls were measured and cheap: calls were recorded in the engine's own `frameTimeHistogram` since the previous
  render event, and none was 33.3 ms or more.

Such a window breaks a streak, as the suspend gate does, and counts into `window.__RAW_GUARDRAIL_THROTTLED__ { windows, lastAt, lastFps }`.

Unchanged:
- a slow marine call at the same cadence (SwiftShader's 1 fps, the hook's founding case);
- any shorter interval (a GPU-bound device at 5 fps);
- a cost the hook cannot read (no histogram, no recorded call, a throwing getter).

Kill: `window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__ = true`.

### Tests

- **New: `useWebGLGuardrail.throttle.test.js` (7 tests).**
  - The live tab: 990/1015/1002 ms, cheap calls, 70 s: no trip, 12+ throttled windows.
  - Controls that must still trip:
    - SwiftShader: the 1 s cadence with every call ≥ 66 ms;
    - a GPU-bound device at 5 fps;
    - a throttled minute, then 14 s of real slow frames;
    - a cost the hook cannot read;
    - an interval just under the floor.
  - The kill, which trips the live tab again.
- **Red first:** dev fails 3 of 7; the 4 controls pass on dev.
- **Mutations:**
  - dropping the cost condition fails 2 (SwiftShader among them);
  - dropping the cadence condition fails 2.
- **The four existing guardrail suites pass unchanged** (63 tests in 5 files).
  - The evidence suite's fixture is a 1 fps cadence whose histogram never moves. That is an unmeasured cost, so it still trips;
    this is why the rule needs recorded calls, not just "no slow call".
- **Full map + tests run:** 428 of 429 suites, 6,086 of 6,089 tests.
  - The 3 failures were 5 s timeouts in `marineFrameStoreCrop.test.js` while three harness servers ran (the suite took 92 s).
  - Alone it passed 31/31 on the second re-run.
- **Lint:** `check_eslint.js` exit 0.

### Offline A/B through the real app

- **Setup:** the same `scn_euro_z9_band.js` probe on a non-local host. `THROTTLE_AT=131 THROTTLE_MS=20000` holds `requestAnimationFrame`
  to the next whole second for 20 s with no input, as the live tab did, with cheap frames.

| arm | under the 1 Hz throttle | after it, h131-h144 |
|---|---|---|
| dev 4bd90d0d9 (main.4a7d43f8) | **fallback engaged**, fps 1 | 14 of 14 steps simplified layer, `no_target` 1 -> 14, "Loading… still showing" the h130 frame |
| both fixes (main.ba97586d) | **no fallback**, fps 1, `__RAW_GUARDRAIL_THROTTLED__.windows` 12 | `no_target` 0; every step draws its nearest regional estimate |
| both fixes, control `TRIP_AT=131` (real ~12 fps frames, 70 ms each) | fallback engaged | 6 of 6 simplified layer, line "Simplified wave layer (reduced graphics mode)…" |

### Not measured / follow-ups (round 2)

- **The live tab with the fix.** Next live read: `__RAW_GUARDRAIL_THROTTLED__` should count windows and `marine_webgl_fallback`
  should not appear when the window is throttled.
- **Chrome's throttle in other shapes:** budget-based timer throttling, or intervals near 2 s. These are only covered up to the
  existing 2000 ms gate.
- **A real device whose GPU alone takes about 1 s a frame with cheap CPU calls** is now exempt. That shape is unseen.

## Round 3 (2026-10-28 06:10Z): no blank-sea fallback, and main-thread load is not a renderer problem

### The lead's second live session (built-in browser pane, 22:41-23:35Z on 10-27, dev 4bd90d0d9; this PC loaded by four agents)

- **Blank sea.** The third trip (23:23:42Z, fps 4) came with EURO + Swell selected. The ocean went blank under "Simplified wave layer -
  reduced graphics mode".
- **Main-thread load.** The trips came with 3,522 long tasks in 54 min (28 over 500 ms, max 7,003 ms). The frame gaps were irregular
  (300-7,000 ms), not the throttle rhythm.
- Evidence: the lead's `live-1027/live_session_summary.md`.

### What the fallback can draw (read from the code)

- The fallback is Open-Meteo raster tiles. `useOpenMeteoTileUrls` draws a transparent tile when the raster model lacks the layer's
  variable ("no cross-model fallback").
- The variable lists are `MODEL_METADATA_CACHE`'s: the bootstrap lists until live metadata replaces them.
  - `ecmwf_wam025` carries wave height only.
  - `dwd_gwam` has no secondary swell.
  - Past 240 h (EURO) and 168 h (ICON) the raster is GFS Wave, which has all four layers.

| model | Waves | Swell | Swell 2 | Wind Waves |
|---|---|---|---|---|
| GFS | yes | yes | yes | yes |
| ICON (to 168 h) | yes | yes | **blank** | yes |
| EURO (to 240 h) | yes | **blank** | **blank** | **blank** |

### The rules (`marineGuardrailRules.js`, used by `useWebGLGuardrail.js`)

- **BLANK GUARD.** At the 12th low-FPS window, the hook checks the selected model, layer and hour (`window.activeModel`,
  `activeTimeOffsetHours`).
  - If the fallback has no raster for them, the hook does not engage it: the WebGL layer keeps drawing.
  - It records `window.__RAW_GUARDRAIL_NO_FALLBACK__ { model, layer, hour, rasterModel, variable, fps, at }` and the churn event
    `marine_webgl_fallback_refused`.
  - Live metadata decides when it is there.
  - Kill: `__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__`.
- **MAIN-THREAD LOAD.** A low-FPS window is not evidence when its marine draws were measured and cheap AND long tasks (PerformanceObserver
  'longtask') cover at least half of it. Such a window counts into `__RAW_GUARDRAIL_MAIN_THREAD__`.
  - The long-task observer runs only through an episode of cheap low-FPS windows. The first such window starts it and still counts as
    evidence, so no observer runs while the renderer is healthy or its cost is unmeasured.
  - Kill: `__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__`.
- **Still evidence:**
  - slow draws (the renderer is the cost);
  - cheap draws on a quiet main thread (a GPU-bound device: the CPU-call histogram cannot see GPU completion, and the evidence receipt
    itself says `gpuCompletionMeasured: false`);
  - long tasks under half the window;
  - no Long Tasks API (Safari keeps today's rule).

### Why not "trip only on slow draws" (the lead's alternative)

- It would stop protecting a device whose GPU, not its CPU calls, is the cost. On such a device WebGL calls return fast and the frames
  are slow.
- The two false-trip shapes measured live are a throttled tab and a busy main thread. Both are excluded by name, and each has its own
  kill switch.

### Tests

- **New: `useWebGLGuardrail.blankAndLoad.test.js` (12 tests).**
  - The drawable matrix, including the cutover hours.
  - EURO + Swell with slow draws: no trip, and the refusal recorded.
  - ICON Swell 2: no trip; past 168 h it trips.
  - Controls: EURO Waves and GFS Swell trip.
  - Live metadata that carries swell makes EURO Swell drawable.
  - The blank-guard kill.
  - The live gaps (300-800 ms) with cheap draws and long tasks over 70% of each: no trip, 12+ main-thread windows.
  - Controls that trip: the same load with slow draws; cheap draws on a quiet thread; long tasks at 30%; no Long Tasks API; the
    main-thread kill.
- **Red first:** the round-2 hook fails 3 of 12; the controls pass.
- **Mutations:** removing the blank guard fails 2; not starting the meter fails 1.
- **All six guardrail suites pass:** 75 tests.
  - The existing `mainThread` suite's single-observer-per-streak pins hold because the meter is episodic.
- **Full map + tests run:** 429 of 430 suites, 6,100 of 6,101 tests.
  - The one failure was a 5 s timeout in `marineFrameStoreCrop.test.js`, which does not call the guardrail.
  - Alone it passed 31/31.
- **Lint:** `check_eslint.js` exit 0.

### Offline A/B through the real app

- **Setup:**
  - `scn_euro_z9_band.js` on a non-local host.
  - The store has GFS + EURO with waves and swell_1, the Florida tile and `--euro-regional-estimated-after 42`.
  - `SLOW_DRAW_AT`: every marine draw takes 70 ms more and is recorded as slow, so the renderer is the cost.
  - `TRIP_AT`: 70 ms of main-thread work per frame, with cheap draws.

| case | dev 4bd90d0d9 (main.4a7d43f8) | the fix (main.295dccc2) |
|---|---|---|
| EURO Swell, slow draws 16 s | **fallback engaged** (the blank-sea configuration: `ecmwf_wam025` lacks `swell_wave_height`); `no_target` 1 -> 5, "Loading… still showing" | **refused**: `__RAW_GUARDRAIL_NO_FALLBACK__` {EURO, swell_1, ecmwf_wam025, swell_wave_height}; WebGL keeps drawing, `no_target` 0 |
| EURO Waves, main-thread load 16 s | **tripped** (fps 13); the fallback for 3 of 3 later steps | **not tripped**: 12 windows in `__RAW_GUARDRAIL_MAIN_THREAD__`, WebGL keeps drawing |
| EURO Waves, slow draws 30 s (control) | tripped (fps 14) | tripped (fps 13) |

- A first 16 s slow-draw control on the fix had not reached 12 consecutive windows when it was read. The same case at 30 s trips on
  both bundles.

### Not measured / follow-ups (round 3)

- **The render-error fallback** (`useMarineWebglRecovery`: three render errors in 10 s) does not consult the blank guard. A hard error
  on EURO Swell still shows a blank sea for its 4 s retry.
- **The blank guard reads `window.activeModel` / `activeTimeOffsetHours`**, which the orchestrator publishes. MapWebGL.js is over the
  line-count ratchet, so no prop was added.
- **A selection change to an undrawable layer while the fallback is engaged.** MapWebGL already resets the flag on any model or layer
  change, so it does not stay blank. Not replayed.
- The live tab with these rules.

## Round 4 (2026-10-28 10:20Z): the 1.5 h gates do not stall EURO at z9 (offline, guardrail off); no fix

### The lead's question

- A forensics pass named a candidate cause separate from #615. #610 taught EURO's 6-hourly steps (past model step 144) only to the
  readouts. Three gates still use a 1.5 h window, so at a 6-hourly hour the nearest stored frame can sit 3 h away:
  - `marineGridSeries.getMarineSeriesFrame`'s `bestDiff > 1.5`;
  - `marineStaleHour.SAME_STEP_TOL_MS`;
  - `marineExactUpgrade.EXACT_UPGRADE_HOUR_TOLERANCE`.
- Ask: reproduce it offline at z9 Florida, EURO, Home then PgUp to h144, stepping h141-h155, with the FPS guardrail out of the picture.

### Setup

- Dev's client: `build-dev` (main.4a7d43f8). dev 890623110 has no `frontend/src` change since its base 4bd90d0d9.
- The SPA ran on 127.0.0.1, where `useWebGLGuardrail` is off; `fb=false` at every step.
- `scn_euro_z9_band.js VIA=home PGUP_TO=144 FROM=141 TO=155`: Home, PageUp x6 to h144, ArrowLeft x3 to h141, then one ArrowRight per step.
  - New harness options: `VIA=home` (the lead's key path) and `PASS_TOL_H` (the data-time window a step must reach).
- Two fresh stores, both run 10-28T00Z, GFS + EURO waves, the Florida tile, `--dynamic 1`:
  - **live-like:** `--euro-regional-estimated-after 42`, so the regional tile is a 3-hourly estimate through the band, as live served it
    on 10-27 (round 1, Q1);
  - **6-hourly only:** no estimated tail, so past model step 144 (timeline h134 here) the regional and global tiers both hold only
    6-hourly frames. This is the case the 1.5 h gates could bite: in h141-h155 the stored frames are h140, h146, h152 and h158, so
    h143, h149 and h155 sit 3 h from both neighbours.

### Result: neither store stalls

| store | steps committed for their hour | "Loading" | "nearest" | exact | farthest drawn frame | per-step time |
|---|---|---|---|---|---|---|
| live-like, 4 s wait | 14 in the window + h154 at 4.9 s | 0 | 10 | 5 | 2 h | 17-82 ms; 2.2-3.9 s on the steps that fetched |
| 6-hourly only, 8 s wait | 15 of 15 | 0 | 13 | 2 | 3 h (h143, h149, h155) | 22-113 ms; 3.2 s at h150, the one `/grid` fetch |

- **The live-like miss is offline latency, not a gate.** h154's ask (20Z) went out as `/grid@21Z` and the offline backend answered in
  4,919 ms, past the 4 s step wait; it committed in h155's window.
- **The 6-hourly store commits every hour.** Each step draws the nearest stored frame, and the line reads "Showing <time>: the nearest
  stored forecast" (#610's EURO 3 h window).
- **The instrument does see a stall.** The same scenario counted 16 of 18 stuck steps when the fallback engaged (round 1).

### Why the three gates do not stall z9 (code reading)

- **`getMarineSeriesFrame`'s 1.5 h** decides only whether the series cache answers. A miss returns null, and the caller takes the
  per-hour path, where `/grid` serves the nearest stored frame within 3 h (`regional_tile_first.find_candidates`). It costs at most one
  fetch: h150 in the 6-hourly run.
- **`SAME_STEP_TOL_MS`** judges WORLD-width frames only: the zoom-out base sync, the F-22 bridge's promotion, and the stale dim (which
  starts at 3.5 h). A z9 resident is a regional tile.
- **`EXACT_UPGRADE_HOUR_TOLERANCE`** applies only to a thinned WORLD frame at a wide view (`not_wide_view` at z9). It compares the hour
  LABEL (the ask's echo), which a 6-hourly lattice does not move.

### Not measured

- **Far zoom in the 6-hourly band**, where `SAME_STEP_TOL_MS` does run. A world base 3 h from the selection counts as "another step",
  so the F-22 bridge will not promote it on a zoom-out and the older rule draws instead. By reading that is a hold, not a stall; it was
  not replayed.
- **The live box:** no live load, per the lead.

Evidence (this session's scratchpad): `gates_live_like_dev.json`, `gates_6h_dev.json`.
