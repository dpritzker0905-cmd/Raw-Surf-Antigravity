# 2026-10-27 (claude, GPU-frames session): EURO's 6-hourly range by model step, not timeline hour

Branch `claude/euro-step-nearest` from dev dcc514bf3. Client only, words only: no served number, no fetch, no commit rule changes.
Kill: `window.__RAW_DISABLE_LATTICE_MODEL_STEP__ = true` (the timeline hour decides again).

## Ask

- **The lead**, live read on dev dcc514bf3, 06:03-06:19Z, z4.6 at -75,30: "across EURO's 6-hourly steps, the status line reads
  "Loading X… still showing Y" for good over a correct frame. Please fix it as a small client PR to dev, shipped ON with a kill
  switch (it changes words, no served number)."
- **The lead's measurements:**
  - The EURO world run was 10-26 12Z at ~06Z on 10-27, so it was 18 h old.
  - Timeline hour 128 (valid 11-01 14Z, step 146) read "Loading Sun 9 AM… still showing Sun 7 AM" for 20+ s, with no request in
    flight.
  - The engine held the server's nearest stored 6-hourly product (served 12Z).
  - The cause: `latticeNearestMaxHours` returned 3 only when the TIMELINE hour was over 144.
- **The lead's definition of done:**
  - The rule uses the model step, with the cycle taken from what the client already holds (not the ingest clock `run_time`).
  - An unknown cycle fails toward today's behaviour.
  - A unit test at timeline 128 on an 18 h-old run, plus a 3-hourly control.
  - The owner scenario re-run at EURO h126-h140.
  - A check of whether the frame store's nearest/prefetch rule makes the same assumption.

## The server's rule, read

- **Candidates:** every product within 3 h of the ask (`grid_resolver_selection.find_candidates`, `diff <= 3 * 3600`).
- **The pick:** authoritative first, else estimated; the smallest diff within a class (`mid_res_tier.pick_mid_item`).
- **The live EURO index** (CDN, run 10-26 12Z, status `known` on every frame) past step 144:
  - authoritative every 6 h (144, 150, ... 240);
  - estimated `native_time_interpolation` frames at the 3-h steps between;
  - all estimated from 243.
  - So a selection in (144, 243] is served an authoritative frame up to 3 h away, and the status line owes "nearest" there.

## Fix

- **`drawnFrameReadout.latticeNearestMaxHours(model, hour, { selectedMs, runMs })`:**
  - EURO gets 3 h when the MODEL STEP `(selectedMs - runMs) / 1 h` is over 144.
  - Without a finite cycle at or before the selection, it falls back to the timeline hour (today).
  - Other models: 1 h, unchanged.
- **The cycle is the DRAWN frame's own verified one** (`marineDrawnFrame` `runMs`, on the marine and wind records):
  - **A grid naming status `known`:** its `model_run_time` (series frames, wind grids).
  - **A store show:** its index meta's `model_run_time` (the publisher writes verified cycles only), never the resident's it was
    spread over.
  - **A `/grid` frame:** its receipt's cycle, carried through the `useMarineWindData` conform under a readout-only name,
    `__readoutModelRun` (`readoutModelRun`). This follows the precedent of `__readoutServedTime`; nothing else reads it.
- **EURO's own mapper** (`backendCopernicusServiceClient.mapNormalizedCopernicusGridToWebGL`) now builds the same diagnostic
  `frameReceipt` as the GFS/ICON mapper. Its legacy identity fields (`run_time`, `valid_time`) are unchanged, and `model_run_time` is
  not added to the grid, because the commit rules read it there.
- **Callers:** `ForecastTimeStatus` (the line), `WindTimeStatus`, and `MapForecastOverlay` (the point card's stale badge) pass the
  selection's own instant (the series anchor plus the hour) and the drawn record's `runMs`.

## The frame store's own rule

- **No timeline-hour assumption.** `staticFrameCodec.pickIndexFrame` picks by valid time over the index's own frames, authoritative
  before estimated, within 3 h: the server's rule.
- **The prefetch cursor** (`marineFrameStoreRuntime.noteStep`) goes through the same pick.
- **`CROP_AHEAD_RUN = 144`** is a frame count, not hours (the live EURO index has 122 frames).
- **`marineGridSeries` / `windGridSeries` `PAGE_SPAN_HOURS = 144`** is timeline paging (48 frames x 3 h), not a lattice rule.

## Tests

- **New file: `drawnFrameModelStep.test.js`** (22 tests).
  - The rule at timeline 128 on an 18 h-old run (step 146, 3 h) and at the step-144 boundary (126 -> 1, 127 -> 3).
  - The 3-hourly control (timeline 100, step 118: 1 h).
  - Unknown, unparsable or future cycles keep the timeline hour.
  - The lead's live sequence through the drawn record:
    - 128 over the served 12Z reads "Showing …: the nearest stored forecast";
    - every hour 127-140 reads nearest, or no words at the exactly stored steps;
    - a 3-hourly frame 2 h off still reads "Loading";
    - the kill, or no cycle, restores the stuck "Loading".
  - The run sources (conform, store show, unverified cycle, `run_time`, wind).
  - The /grid JSON through BOTH mappers.
  - `ForecastTimeStatus` rendered at the live clock in all three themes, plus its kill control.
  - `windReadout`.
  - The point card's stale badge.
- **Mutations:**
  - dev's `drawnFrameReadout.js` fails 7 of the 20 tests then in the file (the step-dependent tests; the controls pass);
  - deleting the Copernicus mapper's receipt fails the both-mappers test.

## Offline replay: EURO h126-h140

- **Setup:**
  - The synthetic store (EURO run 10-26 06Z, about 27 h old at 09:24Z, so step = timeline + 27).
  - WAM 6-hourly past step 144 (`serve_synthetic.EURO_WAVES_6H_AFTER`), with the server's real resolver.
  - z4.6 at -75,30, dark, desktop.
  - `scn_instant_contract.js` with `MODELS=EURO PLAN=J:126,R x14,J:100,R,R`.
  - Builds: dev 04a32f9d9 (bundle main.15345816) and dev + this fix (main.a4f0403f).
- **The line, read 0.5 s after the exact frame:**

| arm | h126-h140 reading "Loading … still showing" (stuck, nothing in flight) | 3-hourly control h100-h102 | blank frames |
|---|---|---|---|
| dev 04a32f9d9 | 8 of 15: h126, 127, 131, 132, 133, 137, 138, 139 | nearest, nearest, (exact) | 0 |
| fix | 0 of 15: 13 "Showing …: the nearest stored forecast", 2 exact with no words (h129, h135) | the same | 0 |
| fix + kill | 8 of 15: the same 8 hours as dev | the same | 0 |

- **The first fix build did NOT move the words** (the same 8 hours as dev).
  - A probe of `window.__MARINE_DRAWN__` at h127 showed `runMs: null` and the engine grid's `__readoutModelRun: null`, while the
    synthetic `/grid` answer carried `model_run_time` with status `known`.
  - EURO's grids come through the Copernicus mapper, which built no `frameReceipt`. The unit fixtures had built the conformed grid by
    hand, so they never crossed that mapper.
  - The second build adds the receipt there, and the probe then read `runMs` = 10-26 06Z with `__readoutModelRun` set.
  - Lesson: build a fixture from the WIRE shape through the real mapper, not from the shape the consumer expects.
- **Not measured:** the live box (the lead re-runs live before merging), the phone layout, swell_1/wind_waves (EURO's
  Copernicus layers ride the same mapper, but were not replayed), and the wind line offline.
