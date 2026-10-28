# 2026-10-27 (claude, side session of the lead): EURO z9 "never draws" h141-155 was the simplified-layer fallback, and the line kept describing the unmounted layer

Branch `claude/euro-z9-fallback-truth` from dev 4bd90d0d9. Client words + the drawn-frame record + harness only: no served number,
no fetch, no commit rule changes. Kill: `window.__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__ = true` (the record outlives the layer and the line
describes it, as before).

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
- **Why the fallback engaged:** not established. Consistent with the guardrail:
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
