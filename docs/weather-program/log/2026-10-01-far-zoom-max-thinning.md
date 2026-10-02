# 2026-10-01 session far-zoom-max-thinning: max thinning built dark, and the legend that describes the grid drawn

Worktree `C:\Users\David\App\raw-surf-wt`, branch `claude/far-zoom-max-thinning` from `origin/dev` at `63a70425` (#215).
Owner decision (chat, 2026-10-01, answering the audit's "which fix direction for the thinned frames"): **"go with max
thinning plus the legend fix, also note I am at the time stamp and zoom level where you zoom in and out erratically,
that the bigger swell heat map disappears from the FLA coast intermittently, so test again"**. The audit that found the
defect is `audit/weather-direction-drift-2026-10-01/` (untracked, REPORT.md section 8.8, finding F-19); this log carries
the numbers a reader of the repo needs. Times are clock reads (`date -u`) or file timestamps (L-P10).

**No served number changes while the switch is off, and the switch ships off.** `SERIES_DECIMATE_MODE` unset (or anything
but `max`) is the plain stride that has served since 2026-08-03; a test pins every thinning site byte-for-byte to it and
pins that no response gains a key. The legend change is text only (it reports the grid that is drawn); it is a UI fix,
not a forecast number. There is no SCOREBOARD row yet: the row is written at the flip, with the live read-back (below).

## 11:56-12:02Z · the user's Chrome could not be used for this test
Claude in Chrome connected, but the window it opened was occluded (`document.visibilityState` 'hidden'): requestAnimationFrame
never fires, so no frame is drawn and a frame-by-frame test is void. The replay ran in the headless harness instead (a
local production build of the deployed frontend, which differs from `63a70425` in no frontend file, against the live
backend, GET only). The tab was closed.

## 12:00-12:21Z · "test again": what the owner sees, reproduced (harness `scn_erratic_fl*.js`, `scn_farzoom_scrub_legend.js`)
- **The thinned far-zoom frame is committed and stays.** After the far-hour world series pages are cached (about 50 s after
  load, as in the owner's long-open tab), "Jump to now" then +6 days +3 hours at z3.6 commits `series_GFS_waves_h146/147`:
  **46 x 20, an 8-degree lattice**, in 4.1 s, and it is never replaced by the exact frame (observed 8 s; the exact frame was
  fetched but not drawn). Swell at three offshore Florida points, interpolated from the committed grid: **1.34 m against 2.33 m
  on the exact 2-degree frame (-42%)**. The same frame is what a zoom-out from z9 shows. The world page's thin frames had no
  cell inside the Florida box at all (flNodes 0), which the audit's "0 m in the box" meant.
- **The legend was wrong in both directions.** With the thinned frame drawn the notice was SILENT (the diagnostics record still
  described the regional 0.25-degree tile, and 0.25 is "native"), and once the exact frame had been fetched but not drawn it
  read "~223 km grid (2 degrees)". The grid under the colours was neither.
- **Erratic zoom at the fixed timestamp, exact frame in the client's cache:** 3 seeds x 25 s, 3,839 sampled frames, **0 frames
  without the Florida swell**; one 44 ms heatmap dropout (2 frames) at a series/mid tier flip at z5.4-5.7. So the intermittent
  loss needs a thinned or wrong-hour frame to be the committed one; with the exact frame cached the zoom path is steady.
- **A third state, cold or unwarmed (OPEN, new): the far-zoom frame is the WRONG HOUR.** Right after a zoom-out (or a scrub at
  far zoom) the engine keeps drawing the world frame it already had (the "now" hour, Oct 1 12Z, swell 0.78 m at the Florida
  points) while the readout already says "Wed 11 AM", until the selected hour's exact world frame arrives: 3.1 s on a warm
  backend, and 4.2-8.9 s in another run; on a just-restarted backend (this session's first run, minutes after #215's deploy)
  the committed frame did not catch up for over 75 s. Swell reads 0.78 m against 2.33 m (-67%) in that window.
- **A fourth, cosmetic and also OPEN:** on the cold run, at z4.6-6.2 with a regional frame committed, the crest animation (not
  the heat map) dropped out for 0.4-0.7 s (screenshots show the field drawn without crests): the same z4.4-6 band as the
  audit's earlier blank frames.

## 12:22-12:30Z · max thinning on the real frame: the maximum is not free (`max_thinning_real_data.py`, `thinning_variants.py`)
Exact GFS waves world frame for Wed 2026-10-07 15Z (model run 06Z, 181 x 83, 10,378 ocean nodes) thinned to the stride-4
lattice (46 x 21); the lattice interpolated back to every 2-degree ocean node and compared with the exact value:

| thinning | nodes under by >1 m | nodes over by >1 m | mean bias | mean abs error | 30N 79.5W (exact 2.33) | 30N 80W (exact 2.41) |
|---|---|---|---|---|---|---|
| stride (served today) | 454 | 173 | -0.08 m | 0.30 m | 1.34 m | 1.21 m |
| **max, 3x3 window (the default built)** | **23** | 1,291 | +0.46 m | 0.51 m | **2.37 m** | **2.29 m** |
| max, 5x5 window (`SERIES_MAX_POOL_HALF=2`) | 3 | 3,403 | +0.88 m | 0.89 m | 3.00 m | 2.98 m |
| mean, 3x3 (not built) | 351 | 194 | -0.03 m | 0.29 m | 1.49 m | 1.45 m |
| kept cell or window mean, 5x5 (not built) | 227 | 363 | +0.09 m | 0.30 m | 1.87 m | 1.80 m |

**The first build used a 5x5 window (every cell within half a stride) and the measurement above refuted it:** it fixed Florida
and read the whole ocean 0.88 m high (mean abs error three times the stride's). The window rule is now "the largest odd
window not wider than the stride" (3x3 at stride 4). That halves the bias and still puts Florida within 5% of exact. Max
thinning cannot be unbiased: an 8-degree lattice speaks for 8-degree neighbourhoods. **What it costs is stated, not hidden:**
about 12% of ocean nodes (1,291 of 10,378) read more than 1 m high at far zoom, the picture is a high envelope. The exact
frame (zoom in) and the thinned frame will still differ, now by over-read where they used to differ by under-read. Cost:
3.4 ms per frame (48 frames, about 0.16 s per page; the stride is 0.03 ms).

## 12:05-12:40Z · what was built (dark) and how it was tested
- `backend/services/weather_pipeline/series_vector_budget.py`: `thinning_mode(layer, domain)` ('max' only when
  `SERIES_DECIMATE_MODE=max` and the layer is a marine height: waves, swell, swell_1, swell_2, wind_waves), `_pool_half`,
  `_max_pool`, and `decimate_vectors(..., mode=)`. **Same lattice, different values**: cols, rows, lat/lng and bounds are the
  stride's; a kept cell takes the whole winning cell (speed, direction, period, u, v, extra fields travel together, with the
  kept cell's lat/lng); a kept cell that already holds the peak is returned unchanged (the same object); an all-invalid
  window keeps the kept cell; input cells are never mutated (copies, because they may be the L1 cache's objects). A grid over
  `SERIES_MAX_POOL_MAX_VECTORS` (default 60,000) or cells it cannot read fall back to the plain stride.
- The four sites that thin a series frame take ONE mode (ONE QUANTITY, TWO FLOORS): the mid tier's clip
  (`mid_res_tier._stride_clipped_grid`, where the world page's far-zoom frames are thinned), the build-time stride
  (`grid_series_helper._apply_build_stride`, first hour included), the end-stage `apply_vector_budget`, and the load-time
  raw-dict `stride_raw_grid_dicts`. A response gains `decimated_mode: "max"` only when max thinning was in force.
- `backend/tests/test_series_max_thinning.py`: 65 tests (dark by default; the Florida case in miniature; a brute-force
  oracle over random fields with invalid, None and NaN cells at several strides and both windows; models and dicts; no input
  mutated; fallbacks; all four wiring sites; the mid tier through a real L1-shaped store). **17 mutations, each turns the suite
  RED** (pool never engages, window 0, window widened, override ignored, identity lost, lattice moves, invalid wins, each
  site ignoring the mode, the stamp lost, wind thinned by max, the switch defaulting ON). The 20 existing test files that
  touch these modules plus the new one and the floor-staleness test: 350 passed, 1 xfailed; flake8 (CI gate) clean.
- `frontend/src/components/map/drawnGridResolution.js` (new) and `legendTicks.js`: the legend's "~N km grid (D°)" now reads the
  DRAWN grid (`__MARINE_ENGINE__._waveData.waveGrid` cols/rows/bounds, through the diag's own `deriveResolutionDeg`, now
  exported) on a 600 ms timer, and falls back to the diagnostics record only when nothing is drawn. The timer runs only for a
  legend that shows the notice. `drawnGridResolution.test.js`: 11 tests (the defect both ways, fallback, opt-in, timer
  start and stop); mutation: legend ignoring the drawn grid turns 3 RED. Legend suites 44 passed; the ESLint ratchet passes
  (1144 files, no rule above its baseline). **Replayed on a production build with the change:** with the thinned frame drawn
  the legend reads "~913 km grid (8.2°)" (before: silent, then "(2°)"), at the zoom-out moment too.
- To turn it on (owner-only, a Render env var): `SERIES_DECIMATE_MODE=max` (add `SERIES_MAX_POOL_HALF=2` for the 5x5 window).
  Rollback: unset it (the next request serves the stride; no data to migrate, the pages are built per request).
  Read-back: the Wed 15Z world page's Florida points interpolated from its thinned frame against the exact frame
  (`max_thinning_real_data.py` logic; target within 5%), and S11 (`series_page_probe.py`) for completeness.

## 12:39-12:41Z · the owner saw "Couldn't load surf spots": my replays were loading the live backend (CORRECTION)
The owner reported the dev site's "Couldn't load surf spots" toast while this session was running. **I caused the load.** Between
12:00Z and 12:40Z I ran six headless replays against the live backend (the far-zoom, erratic-zoom and scrub-and-legend
scenarios). A fresh page load asks for up to three 48-frame world series pages (the commitment-228 profile put one at 10-13 s of
CPU), and the erratic-zoom scenarios asked for dozens more, on a box with ONE CPU that serves production and dev. Measured:
`/api/health` took **1.7, 7.2 and 7.9 s while a replay ran (12:39:42Z) and 0.27-0.41 s within seconds of killing it
(12:39:57Z)**; `/api/surf-spots` answered 200 in 0.46-0.73 s (759 KB) once idle. Render's event list shows no restart,
out-of-memory kill or failed deploy after #215's deploy ended 11:54:53Z, so the box was saturated, not down. The map's spots fetch
gives up after two retries (`useMapData.js`), so a 40-60 s saturation is enough to raise the toast. The replay running at that
moment (the SIM below) was killed. No further live replay was run. Render's CPU and latency metrics need a workspace the owner
has not selected, so the saturation is shown by the health timings, not by Render's graphs.
**Lesson (agent-local memory `harness-load-on-live-backend`; to be mirrored in LESSONS.md):** a live replay is a load test of a
shared 1-CPU box. One scenario at a time, short, health probed before and after, never the multi-seed erratic-zoom runs against
live (record the responses once and replay them locally with `page.route`), and say so in the reply before running.

## SIM · the dark build exercised end to end in the app: NOT RUN
The planned replay (`SIM_MAX_THIN`: a JS port of the pool applied to the target hour's frame in the world series pages the app
receives, so the app's own far-zoom scrub path commits a max-thinned frame) was started at 12:38:33Z and killed at 12:39:57Z
because of the load above. The port is in `scn_farzoom_scrub_legend.js`. What is established without it: the Python pool on the
real exact frame (the table above), the unit and mutation tests, and the legend replay. What is not: the app's rendering of a
max-thinned frame on the scrub path. Run it once, on a quiet backend, or against responses recorded locally.

## Not done, and why
- **No PR.** `gh auth status` is invalid on this machine (a machine reset; only the owner can `gh auth login`), so neither
  `gh pr create` nor `git push` can run. The branch is committed locally. Ledger lines for the push and the PR belong to
  whoever opens it.
- **CI floors not moved.** The guards lane gains 65 tests (`test_series_max_thinning.py`, claimed by the guards lane; the floor
  staleness test passes). The hosted reading does not exist yet, and the local interpreter reads about 2 fewer than hosted, so
  the floor, and `_FLOOR_SET_FROM`, should be raised from the first hosted reading (hosted reading + 65 - margin 6).
- **The wrong-hour far-zoom frame and the crest dropouts are findings, not fixes** (ledger `finding`). Neither is touched by
  max thinning. The wrong-hour state is the arbiter holding the last world frame until the selected hour's arrives; the
  thinned frame staying drawn after the exact one was fetched is the same arbiter keeping what it has.
- The owner's real Chrome was not usable for frame-level tests (occluded window); a re-check there, with the window in
  view, is still the best final confirmation after a flip.

## 13:12-14:45Z · the exact-frame fix for far zoom: built, and replayed offline (owner: "yes, build the exact-frame fix for far zoom")
**Decision and scope.** The owner's answer (chat, 2026-10-01), after the max-thinning build above, was **"yes, build the exact-frame
fix for far zoom"**. This is a CLIENT-ONLY change on this branch (the backend is untouched): at far zoom the app now draws the exact
world frame, with the thinned series frame only as the instant placeholder. It is **default ON**, not dark: it chooses which
already-served frame to draw, computes no forecast number differently, and the exact frame is the one the app already draws at the
2-degree tier and zoomed in. No UI element was added or changed (themes and accessibility: no surface touched). Kill switch
(both halves): `window.__RAW_DISABLE_EXACT_UPGRADE__ = true`. Telemetry: `window.__MARINE_EXACT_UPGRADE__` = `{ triggers, kept, last }`.

**No live replay was run for this.** After the 12:39Z incident every replay used `harness/mock_backend.js` (in the untracked audit
folder): a `page.route` mock of the four weather endpoints, built from ONE recorded exact world frame (Wed 2026-10-07 15Z, GFS 06Z
run) plus four small GET captures taken with health probed between them (`capture_templates.py`), thinned with the repo's own stride
rule (a 48-frame world page is 46 x 21, `decimated_stride` 4), latency set to the live-box measurements (world grid 3 s, world page
8 s). The client under test is a local production build of this working tree; the unfixed arm is a build of `git archive HEAD`
(`79a66131`, the commit before this one). Same mock, same seeds, one arm after the other, nothing else running.

**Three mistakes made one defect (located this session; the first two I had put down to "the arbiter")**
1. `frameToMarineData` dropped the backend's `decimated_stride`. A thinned frame has the same product id and valid time as the exact
   frame it is a view of, so every identity check in the client reads "already showing this".
2. The global prewarm reused a series frame as the world grid for an hour ("zero network, identical pixels"), true only for an
   unthinned frame.
3. **The scrub-settle check read the hour LABEL as the identity of the data.** Far-horizon model data is 3-hourly, so the selected hour
   is usually between two frames and every frame that serves it carries a different `hourOffset` (the series page's own hour 145, the
   exact `/grid` result's 144, the selection 146: all valid 15Z). `runScrubSettleCheck` reads "rendered label != selected hour" as a
   stale frame and commits the warmed series frame, which at world zoom is the thinned one, OVER an exact frame of the same valid
   time; the commit arbiter's rule 4 (`hour_change`) lets it through for the same reason (a label differs, so it commits before the
   tier-downgrade rule is reached). With every engine commit traced (`setWaveData` wrapped, lane and dims per call), the unfixed
   client handed the engine a thinned world frame 100 times in 25 trials, every call from the scrub-settle check (97 `series_settle`,
   3 `recovery_2b`); 58 of them came straight after an exact 181 x 82 world frame, the rest after a regional one. The traces record
   lane and dims, not valid time, so "same valid time" is the reading of the labels, and the evidence for it is the intervention:
   comparing valid times instead of labels removed 89 of those 100 calls. This is the mechanism of "the bigger swell heat map
   disappears from the FLA coast intermittently" while zooming at that timestamp (the exact frame is in the client's cache, and is
   replaced anyway).

**What was built** (`frontend/src/components/map/`: one new module, three small call sites; the engine is untouched)
- `marineSeriesFrame.js`: keeps `decimated_stride` as `grid.__decimatedStride` (0 = exact).
- `marineGlobalPrewarm.js`: a thinned series frame no longer stands in for the world grid (it still seeds the zoom-out bridge as a
  placeholder; the exact world grid is fetched in the background like any other hour).
- `marineExactUpgrade.js` (new, 250 lines):
  - `tryExactUpgrade`: a settled, thinned WORLD frame for the selected hour at a wide view starts the exact fetch through the NORMAL
    path (source `exact_upgrade`: the arbiter, the dedupe ledger and the truth tags see an ordinary commit). Bounded: >= 2.5 s apart
    per hour, >= 1.5 s apart across hours, 3 per hour per 120 s, budget given back when an exact world frame lands.
  - `useMarineExactUpgrade`: re-drives the settle check 1.5 s after a thinned frame lands (and once more at 4.5 s), and waits for the
    selected hour to hold still (button steps move the hour under a frame that does not change). Keyed on the GRID, not on
    `marineData`: the settle check re-commits the same cached grid in a fresh wrapper, and keyed on the wrapper the re-drive was a
    1 Hz loop (caught in the first replay).
  - `keepExactResident` / `exactResidentSupersedes`: a thinned world frame never replaces an exact world resident of the same served
    valid time, same model run (compared as instants), same surf-rating flavor, and at least as fine a lattice.
- `useMarineScrubSettle.js` (790 -> 792 lines, under the 800 ceiling): calls the upgrade before the zoom-out recovery, the keep in the
  series-first branch, and mounts the hook.
- Tests: 69 tests in 4 suites (`marineExactUpgrade.test.js`, `marineExactUpgrade.keepExact.test.js`,
  `useMarineScrubSettle.exactUpgrade.test.js`, `marineGlobalPrewarm.thinnedFrame.test.js`), including the call sites (the recorded
  "pure helper passes, call site untested" class): the real `useMarineScrubSettle` is mounted with the upgrade hook spied and read.
  29 frontend mutations (an exact-string edit, run, restore), each turns at least one test red. ESLint clean on every touched
  file.

**Offline results.** Swell at three offshore Florida points interpolated from the committed grid, at Wed 2026-10-07 15Z (exact frame
2.33 m). "Weak" = under 75% of that, i.e. the thinned or stale placeholder is what is drawn. A rendered frame is 16-25 ms, so a count
of frames is a duration. Erratic zoom = 25 s of random eases and jumps between z3 and z9 (seeded), the exact world frame in the
client's cache. Every row is a different alignment of the clock (the app's hour 0 is the current time rounded to the hour; the
selected hour must sit BETWEEN two 3-hourly steps to show the defect, and the harness was re-aimed for that each time).
| erratic zoom, A/B (thin commits = visible frame changes to a 46 x 20/21 frame) | unfixed client | fixed client | seeds where fixed is lower |
|---|---|---|---|
| batch 1, 5 seeds | 509 of 5,604 frames weak (9.1%), 17 thin commits | 65 of 6,181 (1.1%), 3 | 5 of 5 |
| batch 2, 10 NEW seeds | 1,542 of 12,729 (12.1%), 51 | 28 of 12,736 (0.2%), 3 | 10 of 10 |
| final build, clock re-aimed, 5 seeds | 694 of 6,458 (10.7%), 22 | 72 of 6,249 (1.2%), 3 | 5 of 5 |
| **pooled, 25 trials** | **2,745 of 24,791 (11.1%), 90** | **165 of 25,166 (0.7%), 9** | 20 of 20 |
The thin frames that remain are placeholders after a zoom-out from a regional tile (nothing exact resident to keep): they last
0.6-1.7 s (the 1.5 s hold, then the exact frame from the cache), against the whole dwell before. The first build of this fix (the
upgrade alone) scored 504 of 6,015 (8.4%) on batch 1 and 26 thin commits: it followed each thin commit with an upgrade and the
settle check put the thin frame back, which is what found mistake 3.
| far-zoom scrub (+6 d, then an hour between steps), far-hour pages cached | unfixed | fixed |
|---|---|---|
| committed frame | `series_GFS_waves_h148` 46 x 20 at 4.0 s, **never replaced** (12 s watched), 1.34 m | the same at 3.8 s, then **`global_mid_..T180000Z` 181 x 82 at 8.2 s (2.33 m)**: 1.5 s hold + the 3 s mock fetch |
| legend | "~913 km grid (8.2 degrees)" | "~913 km" while thin, "~223 km grid (2 degrees)" once exact |
| a zoom-out after selecting at z9 | thin frame at 0.35 s, exact at 4.5 s | **exact at 0.35 s** |
| exact world `/grid` fetches | 1 (in the zoom-out part) | 1 (in the scrub part: the zoom-out then used the cache) |
Network cost in the erratic scenario: 4 exact world `/grid` fetches in each arm, the same four. The one extra cost class is a far-zoom
scrub that settles on hours the app has not fetched exactly: one exact world `/grid` (2.3 MB, about 3 s of the 1-CPU box) per
settled hour, which the unfixed client never fetched on that path, and the prewarm now also fetches the exact grid for hours whose
series frame it used to reuse.

**Not fixed, and what the replays showed about it**
- **The wrong-hour window (REPORT F-21) is a different mechanism and is untouched.** Right after a zoom-out on a cold page the engine
  draws the hour-0 world frame (Oct 1 12Z, 0.78 m) while the readout names the new hour, for 4.4 s here (4.5 s unfixed; 3-9 s and
  over 75 s after a restart live). Source maps place the commit in `WebGLMarineEngine.bridgeToCoarseGlobalIfHeld` (the zoom-out
  bridge promoting the held coarse base, whatever hour it is). The engine file is grandfathered over the LOC ceiling; the fix
  belongs in the bridge's hour check or in the readout, and is a separate packet. This replaces my earlier "the arbiter holds the
  last frame" (seq 276), which named the wrong place.
- **Whole-heat-map dropouts at z4.3-6.3 during a zoom** (heat opacity under 0.2 for 0.1-1.1 s while a regional frame is resident and the
  next one has not landed) are unchanged: 4.9% of frames unfixed against 6.0% fixed, pooled; per batch 3.7 -> 5.8, 4.9 -> 6.4,
  5.9 -> 5.3 (2 of 15 seeds in batches 1 and 2 worse by 100+ frames). The episode counts were identical in batch 2 (53 and 53), and none of those
  episodes contains an `exact_upgrade` commit or a pending fetch (0 of 821 frames), so I do not attribute them to this change, but
  15 seeds do not rule out a small effect. The crest-only dropouts (F-22) did not recur in any of these offline runs (0 frames; they were seen on the live backend on a cold page).
- **An engine-empty blank** (no frame committed) was rare in both arms: unfixed 2 episodes (25 frames, about 0.5 s, and 1 frame),
  fixed 2 (58 frames, about 1.2 s, and 6 frames). Not distinguishable.
- **Not tested:** the live backend (by choice), the owner's own Chrome, a real phone, EURO and ICON at far zoom (the upgrade asks the
  normal fetch path for the active model; the Copernicus transport was not exercised), and the surf-rating flavor end to end (unit
  tests only; the replays ran with it off). The mock labels frames from the app's own hour arithmetic; the live backend's labels
  were seen once ("selected 147 against warmed frame h146", valid 15Z) and the mechanism is read from code, so the live read-back
  below is the check that matters.

**Read-back after a deploy (owner flips nothing: it is on).** In the dev site's console at far zoom on a settled future hour:
`__MARINE_EXACT_UPGRADE__` shows `triggers` rising by one per settled hour and `kept` rising during zooms; the Network tab shows one
`/grid` with the world bbox per settled hour; Florida swell for Wed 15Z at far zoom steady at about 2.3 m (it read 1.34 m).
Rollback: `__RAW_DISABLE_EXACT_UPGRADE__ = true` per session, or `git revert` of the commit.

**Caught before any commit, by the replays (each is a test now)**: the upgrade never fired because the selected hour (147) never
equals the warmed frame's label (146) (strict equality; now a 1.5 h tolerance); a 1 Hz re-commit loop (the hook keyed on a wrapper);
the upgrade alone fighting the settle check (mistake 3); the upgrade budget spent by an erratic zoom whose exact frame was already in
hand (now returned when an exact world frame lands); a first fetch for an hour the next click replaced (now waits for the hour to
hold still); and a run-time comparison by string (now by instant).

## 18:58Z · owner: "notate that I'm seeing runs fail in my email notifications, one just happened at 2:47pm EST"

Read-only, from the repo's public Actions API and one GET of `/api/weather/buoy-calibration` (no `gh` auth, no secrets, nothing changed).
- **The 2:47 pm email** (Eastern; October is EDT, UTC-4, so 18:47Z) matches **Forecast Accuracy Monitor run #205** (schedule, `dev` @
  `63a70425`): created 18:49:02Z, failed 18:49:22Z in the step "Grade forecast accuracy against buoy truth". Run #204 (07:08:20Z) fails
  with the same four annotations: *SKILL LEDGER SCORED ZERO past the recovery window (2026-08-12T06:00Z)*; *SKILL FLOOR UNMEASURED* (scored
  segment not readable); *ARCHIVE READER BLIND* (credentials present, the residual history segment would not load); *SKILL LEDGER DEAD* (a
  fresh calibration report carries no `forecast_skill_ops` block).
- **Onset:** green on #199-#203 (2026-09-29 14:00Z to 09-30 22:58Z), red on #204 and #205, so it turned red between 22:58Z and 07:08Z and has
  been red for at least 11.7 h. (#198, 09-29 06:49Z, was the known single-pass false alarm that #166 fixed: a different message.)
- **The live report the monitor grades** (`GET /api/weather/buoy-calibration`, 18:50-18:58Z): `generated_at` 16:35:30Z (fresh, under 8 h),
  height MAE 0.211 m over 59 spots (healthy), `archive.n_entries` 20,000 (a round number: check whether it is a cap), and **no
  `forecast_skill_ops` key** (top-level keys: available, version, generated_at, summary, spots, archive). The monitor's "ledger dead" line is
  literally true: the calibration run did not attach the skill ledger.
- **Other red runs since 06:00Z today** (public run list, the last 40 runs; NOT diagnosed): E2E Tests on the push to `dev` (11:52Z, the #215
  merge), CI on the PR branch `claude/ledger-215-merge` (12:14Z), MOP Nearshore Ingest stage 4 by workflow_dispatch (13:24Z), Marine Nightly's
  zoomlab-battery step "Verdict (budgeted)" (13:46Z; the known item, REPORT 8.7), and the Accuracy Monitor twice.
- **Not from this session.** Nothing here is pushed (gh auth is invalid), every replay since 12:39Z ran against the offline mock, and no secret
  was touched. The audit's earlier live GETs (00:20Z-04:03Z) and the 12:00-12:39Z replays hit the serve path; the monitor reads its archives from
  Supabase Storage inside Actions, so shared Storage pressure cannot be ruled out but is unproven.
- **Leads, unverified, in the order I would check them:** (1) did the calibration step (`precompute.yml`, the forecast ingest) run and swallow
  an error before attaching `forecast_skill_ops`? It needs the run log: `gh run view <id> --log` after `gh auth login`. (2) Supabase Storage:
  the residual-history and scored-segment objects (429 "too many connections"; an object at a size cap, since `archive.n_entries` is exactly
  20,000 and the ledger's pending queue sat at 29,477 of 30,000 on 09-30, which #189 raises). (3) The Actions secrets `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` against the keys rotated after the 2026-09 leak ("credentials present" but the reads fail). (4) The merges in the
  onset window: #208, #210, #211, #212 (03:48-04:13Z), #215 (11:52Z), and the backend redeploy at about 03:10Z.
- **What it blocks:** commitments seq 149 (the GFS_SCALAR lane's first paired rows) and seq 172 (S7/S8's first graded rows) both need the skill
  ledger to run; if it stays dead they cannot be fulfilled.

### 19:43Z · addendum to the 18:58Z failing-runs note: the first lead, from the commit history (read-only)
The skill ledger's code changed on 09-30, hours before the monitor turned red: S7/S8 (`aeb72670`, 14:41Z: period and direction graded per lane and lead),
S9 (`e28b1031`, 17:30Z: wind graded; "the calibration fetch finally parses wind, wind_n read 0 for 52 days") and W-23 (`8fb511ad`, 17:55Z: a refused L2 read
is retried). `PENDING_MAX_ENTRIES` was raised from 30,000 to 54,000 by #189 (03:15Z 09-30), so after S7/S8/S9 the pending object
(`calibration/skill/pending.json`, read whole by the strict L2 GET with a 30 s timeout, retried on 429 since A15-19) can grow toward 54,000 rows.
The monitor was still green at 22:58Z (#203) and red at the next report. **Lead 1, to check first:** did the pending object (or the residual-history
segment, `archive.n_entries` 20,000) grow past what the strict read and the upload can move inside their timeouts, so the ledger was skipped and
the report went out without `forecast_skill_ops`? It needs the precompute run log (`gh auth login`) or the object's size in Supabase Storage.
Not verified; nothing was changed. (The forecast data lanes themselves are healthy: `/api/health/data` read all ten lanes ok at 19:17Z, freshest run 1.1 h.)

## 17:10-21:35Z · the wrong-hour world frame (F-21): built, replayed offline, client only, ON by default

Owner: "keep it on, defer the flip, now fix the wrong-hour frame." (Keep it on: the exact-frame fix stays the default. Defer the flip:
`SERIES_DECIMATE_MODE=max` is not turned on in Render; nothing to do.) Third local commit on `claude/far-zoom-max-thinning`, NOT pushed (gh auth is
invalid). It chooses what to draw and when a base is replaced; no served number changes, so no SCOREBOARD row. Every replay below ran against the
offline mock (no live request) on the final local build, against a build of the previous commit (`a0323a5f`), the app's clock pinned.

**The defect.** Select a far hour at a regional zoom and zoom out: the engine drew the world frame the page had loaded with (the "now" hour; swell
0.78 m where Wednesday reads 2.33 m) at full strength, crest animation and all, for 3.2 to 3.8 s in every cell of the final offline matrix (once
8.7 s, in a first-build just-opened run whose right hour had not arrived when the 9 s watch ended; 3 to 9 s live, over 75 s after a restart),
under a readout that named Wednesday. The panel's own line "Forecast time does not match this selection." (`ForecastTimeStatus`, a `role="status"`
line) was showing in both builds: the app knew, the picture did not say so.

**Mechanism** (code, commit traces, source maps, and the interventions; this replaces "belongs in the bridge's hour check" in the entry above):
1. At a zoom-out the engine promotes the coarse base it holds (`bridgeToCoarseGlobalIfHeld`) whatever hour that base is for. All 20 unfixed runs of
   the final matrix show a `manual`-lane commit of the hour-0 frame: 12 to 822 ms after a jump zoom starts, 498 to 643 ms after a wheel zoom
   starts (when it crosses the zoom-out gate).
2. The base was refreshed only when a world frame COMMITTED. The prewarm's staging gate (`_coarseBaseMatches`) and the engine's seed consumption
   (`_stale`) asked only "same model and layer?", so a seed for the selected hour was refused, and then discarded, for as long as the page-load
   frame was held. Nothing asked the hour.
3. When no right-hour world data exists yet, nothing marked the frame as the wrong hour: full strength until the exact grid arrived.
4. (found with the read-back telemetry added during this work; I had not seen it from the code) The world grid that could arrive BEFORE the
   zoom-out must pass the background lane's single slot ("after anything on screen"). On a page that has just opened it never did, in any
   replay: the fetch path's own prewarm call (the old order: its world series half first, then the grid) had already claimed the in-flight key, so
   a later call for the same valid time answers `in_flight` and cannot send the grid, and its grid stayed queued behind a world series page
   (in all 16 (10 on the flat 8 s mock, 6 with live-like latencies) fixed just-opened runs `__MARINE_GLOBAL_PREWARM__.grid` read `gridFirst:false, queuedAt, no startedAt` at the END of the 9 s
   watch). What it queued behind depends on the latencies: on the flat 8 s mock the one-hour half (8 s); with live-like latencies (one-hour page 2.4 s,
   48-frame page 20 s: the earlier live runs read 1.1 to 2.4 s and 2 to 25 s) the 48-frame world page that the selection starts. With a free lane
   (the map open a minute) the same grid goes out 1.5 s after the hour is set and lands 3 s later.
5. (found in the 2.5 s dwell replay) A right-hour seed that lands AFTER the zoom-out replaces the base, but not the frame already drawn: that
   is the earlier promotion of the old base, and the pipeline's own commit is a network round trip away. My first answer, re-driving the fetch
   path when the warm landed, fired (`redrove: 1`) and changed nothing: the zoom-out's own fetch was already pending and the pipeline dedupes
   it. It was removed.

**Built** (client only; each piece default ON with its own kill switch; 112 new tests in 9 files, 69 mutations each turning a test red):
- *Hour-aware base and seed* (`marineStaleHour.js`, pure and import-free; called from `marineGlobalPrewarm.js` and the engine's one seed line, which
  went from 3 lines to 1, so `WebGLMarineEngine.js` 3207 -> 3205): a seed for another hour REPLACES a base made for the old one. The valid time
  decides (served first, then the ask's echo, then the truth tag), never the label (L-F10); an unknown time fails open (nothing replaced).
  Kill: `__RAW_DISABLE_BASE_HOUR_SYNC__`.
- *A world frame for another hour than the selected one is drawn provisional* (`marineStaleHourLayer.js`, one multiplier in
  `WebGLMarineCustomLayer.js`): 0.4 of its strength (the heat map settles at 0.265 against 0.662) once the hour has held still 0.6 s; never while
  scrubbing; never for a regional frame; an unknown time fails open; the engine's own ease ramps it over about 0.5 s. The selected instant comes from
  the readout's own `displayedForecastTime`, so the dim and the readout cannot disagree. Kill: `__RAW_DISABLE_STALE_HOUR_DIM__`; tune:
  `__RAW_STALE_HOUR_DIM__` (0.4).
- *A world warm that keeps the base on the selected hour* (`marineWorldWarmOnSettle.js`, one call line in `useMarineScrubSettle.js`, 792 -> 794 lines):
  once the hour has held still 1.5 s at a regional zoom (GFS and ICON; not EURO, whose world product takes the slow Copernicus transport), ask the
  existing prewarm for that hour's world grid, grid FIRST and the series half after it (opt-in `gridFirst`); a moved hour or a scrub in progress
  re-arms the wait, so a commit that keeps the same grid cannot lose the warm; when the grid lands the seed replaces the stale base. Kill:
  `__RAW_DISABLE_HOUR_WORLD_WARM__`, `__RAW_DISABLE_WORLD_GRID_FIRST__`.
- *A stale world frame already drawn is replaced by the held base when that is the selected hour* (`staleResidentSwapWanted` in `marineStaleHour.js`;
  `shouldBridgeToCoarseGlobal` in `marineCommitGate.js` gained an optional sixth argument, the selected instant, which is absent everywhere else and
  makes the clause inert; the engine's existing per-frame bridge call passes `this.__staleSwapMs`, so the engine gained no line). The layer hands that
  instant to the engine only in the frames it judged the drawn frame stale and the hour held still (the dim's own judgment, `judgeStaleWorld`), so a
  seed landing after the zoom-out ends the wrong hour in the same frame instead of waiting for the zoom-out's own fetch. It never promotes an older
  base over the right resident, and never across a model, layer or surf-rating switch. Kill: `__RAW_DISABLE_STALE_RESIDENT_SWAP__` (the dim's kill
  switch does not stop it, and it does not stop the dim).
- *Read-back telemetry*: `window.__MARINE_GLOBAL_PREWARM__` (what every prewarm call did: fetched, declined and why, in flight, cache; when the grid
  was queued, started and done), `__MARINE_HOUR_WORLD_WARM__` ({fired}), `__RAW_GPU__.staleHour` (why the layer did or did not dim this frame, and
  whether it asked for the swap).

**Offline A/B** (final build against the previous commit; the app's clock pinned to hour 0 = Oct 1 17Z; the selected hour Oct 7 17Z, which snaps to the
18Z model step, the "between two steps" case of the owner's Wed 15Z report; mock latencies as measured live: world `/grid` 3 s, every world series
page 8 s; one run at a time, arm order alternating between repetitions). "Dwell" is how long the user stays on the selected hour at the regional zoom
before zooming out, counted from the moment the harness sees that hour's regional frame committed: in the warm runs that was 1.65 to 1.92 s after the
hour was set (the world warm's grid was queued 0.15 to 0.42 s before it), so a dwell of d here is about d + 1.8 s from the pick. "Just opened" cells
select the hour about 10 s after the page loads; "map open a minute" cells wait 60 s first. Times are medians over the repetitions (range in brackets):

| dwell | regime / zoom | build | wrong hour at full strength | wrong hour dimmed | right hour drawn after | blank |
|---|---|---|---|---|---|---|
| 5 s | cold / jump | unfixed | 3,204 ms (3 runs: 3,202-3,204) | 0 ms (3 runs: 0-0) | 3,564 ms (3 runs: 3,563-3,567) | 0 ms (3 runs: 0-0) |
| 5 s | cold / jump | fixed | 316 ms (3 runs: 311-324) | 2,904 ms (3 runs: 2,887-2,905) | 3,556 ms (3 runs: 3,542-3,698) | 0 ms (3 runs: 0-0) |
| 5 s | warm / jump | unfixed | 3,292 ms (3 runs: 3,215-3,704) | 0 ms (3 runs: 0-0) | 3,660 ms (3 runs: 3,478-4,544) | 0 ms (3 runs: 0-0) |
| 5 s | warm / jump | fixed | 0 ms (3 runs: 0-0) | 0 ms (3 runs: 0-0) | 503 ms (3 runs: 316-832) | 0 ms (3 runs: 0-0) |
| 2.5 s | warm / jump | unfixed | 3,224 ms (3 runs: 3,223-3,353) | 0 ms (3 runs: 0-0) | 3,640 ms (3 runs: 3,610-4,675) | 0 ms (3 runs: 0-0) |
| 2.5 s | warm / jump | fixed | 71 ms (3 runs: 68-192) | 0 ms (3 runs: 0-0) | 653 ms (3 runs: 653-1,337) | 0 ms (3 runs: 0-0) |
| 0.8 s | cold / jump | unfixed | 3,340 ms (3 runs: 3,250-3,664) | 0 ms (3 runs: 0-0) | 3,800 ms (3 runs: 3,764-4,238) | 0 ms (3 runs: 0-0) |
| 0.8 s | cold / jump | fixed | 273 ms (3 runs: 208-317) | 3,007 ms (3 runs: 2,904-3,840) | 3,785 ms (3 runs: 3,678-4,600) | 0 ms (3 runs: 0-0) |
| 0.8 s | cold / wheel | unfixed | 3,430 ms (4 runs: 3,273-3,656) | 0 ms (4 runs: 0-0) | 4,540 ms (4 runs: 4,114-4,631) | 284 ms (4 runs: 251-292) |
| 0.8 s | cold / wheel | fixed | 16 ms (4 runs: 16-16) | 3,553 ms (4 runs: 3,311-4,429) | 4,523 ms (4 runs: 4,161-5,372) | 280 ms (4 runs: 276-288) |
| 0.8 s | warm / jump | unfixed | 3,291 ms (2 runs: 3,273-3,309) | 0 ms (2 runs: 0-0) | 3,748 ms (2 runs: 3,561-3,936) | 0 ms (2 runs: 0-0) |
| 0.8 s | warm / jump | fixed | 321 ms (2 runs: 318-324) | 1,238 ms (2 runs: 1,224-1,253) | 2,314 ms (2 runs: 1,993-2,636) | 0 ms (2 runs: 0-0) |
| 0.8 s | warm / wheel | unfixed | 3,714 ms (2 runs: 3,658-3,770) | 0 ms (2 runs: 0-0) | 4,623 ms (2 runs: 4,376-4,870) | 298 ms (2 runs: 276-321) |
| 0.8 s | warm / wheel | fixed | 16 ms (2 runs: 16-16) | 943 ms (2 runs: 687-1,199) | 2,722 ms (2 runs: 2,154-3,290) | 271 ms (2 runs: 266-276) |

**Reading.**
- *Unfixed* (20 runs in 7 cells): the previous hour's world frame is drawn at full strength for 3.2 to 3.8 s after the zoom-out, whatever the stay (0.8, 2.5 or 5 s), the zoom (jump or wheel) or the session (just opened, map open a minute): nothing the old build does while you wait changes what the zoom-out promotes.
- *Fixed, map open a minute* (the background lane is free): the world warm's grid goes out about 1.5 s after the hour is set and lands about 3 s later, and its seed replaces the stale base. After a 5 s stay it has landed: 0 s of the wrong hour (all 3 runs), and the right hour is drawn 0.5 s after the zoom-out (unfixed 3.7 s). After 2.5 s it lands just after the zoom-out and the engine's per-frame bridge swaps it in: 0.07 s at full strength, right hour at 0.7 s (unfixed 3.6 s), and the zoom-out's own fetch goes out as well (one duplicate world /grid). After 0.8 s the grid is already in flight when you zoom out: 0.32 s at full strength, dimmed 1.2 s, right hour at 2.3 s (unfixed 3.7 s); the wheel cell reads the same (0.02 s at full strength, dimmed 0.9 s, right hour 2.7 s against 4.6 s).
- *Fixed, just opened* (the lane is held: the fetch path's own prewarm call owns the world grid, queued behind its own world page): the right hour arrives when the zoom-out's own fetch delivers it, within noise of the unfixed build (3.6 to 4.5 s across the cells, both builds), and the wrong-hour frame is drawn at 40% instead of full strength: 0.02 to 0.3 s at full strength while the engine eases the opacity down (one frame in the wheel cells), then dimmed for 2.9 to 3.6 s.
- *Unchanged by the fix:* the right hour's arrival in the just-opened cells; and the whole-heat-map blank of 0.25 to 0.32 s in the wheel cells, present in both builds (the known dropout, not caused by this change).

**Live-like latencies, just-opened cells only.** The earlier live harness runs read a one-hour world page at 1.1 to 2.4 s, a 48-frame world page at 2 s on a
fresh box and 15 to 25 s after a restart, and a world `/grid` at 0.7 to 4.9 s; the flat 8 s mock is too slow for the first and too fast for the second. The
just-opened cells were run again with a one-hour world page of 2.4 s, a 48-frame world page of 20 s and a world `/grid` of 3 s (`MOCK_WORLD_MINI_MS`,
`run_live_like.sh`; 3 runs per cell, arms alternating; for a run that never drew the right hour the harness's "settled level" is the dimmed one, so the
table recomputes those against the reference level):

| dwell | regime / zoom | build | wrong hour at full strength | wrong hour dimmed | right hour drawn after | blank |
|---|---|---|---|---|---|---|
| 5 s, live-like latencies | cold / jump | unfixed | 4,078 ms (3 runs: 4,035-4,081) | 0 ms (3 runs: 0-0) | 4,472 ms (3 runs: 4,464-4,486) | 0 ms (3 runs: 0-0) |
| 5 s, live-like latencies | cold / jump | fixed | 209 ms (3 runs: 200-210) | 3,841 ms (3 runs: 3,833-3,890) | 4,460 ms (3 runs: 4,459-4,482) | 0 ms (3 runs: 0-0) |
| 0.8 s, live-like latencies | cold / jump | unfixed | 8,623 ms (3 runs: 4,102-8,677) | 0 ms (3 runs: 0-0) | 4,411 ms (3 runs: 4,411-4,411, 2 n/a) | 0 ms (3 runs: 0-0) |
| 0.8 s, live-like latencies | cold / jump | fixed | 120 ms (3 runs: 0-207) | 8,301 ms (3 runs: 3,783-8,509) | 4,492 ms (3 runs: 4,492-4,492, 2 n/a) | 0 ms (3 runs: 0-0) |

- After a 5 s stay the picture is the flat-mock one with a longer window: the right hour at 4.5 s in both builds (the zoom-out's own world `/grid`
  went out in 3 of 3 runs of each build); the wrong hour at full strength for 4.1 s unfixed, 0.2 s fixed and then dimmed for 3.8 s.
- After 0.8 s the zoom-out's own world `/grid` was sent in only 1 of 3 runs of each build (the first 48-frame world page was already in flight and a
  second went out at the zoom-out), so in the other two runs of each build the right hour had NOT arrived when the 9 s watch ended: unfixed, the wrong
  hour at full strength for the whole watch; fixed, dimmed for it. The fix makes the wrong hour visible there; it does not bring the right one.
  Why the request is not sent was not traced. It happens in both builds, so it is not from this change, and it looks like the "over 75 s after a
  restart" state of the earlier live reads. It is the first thing I would look at next.
- In all 6 fixed live-like runs the legacy grid stayed queued behind the 48-frame page the selection starts (`gridFirst:false`, queued, not started),
  and the world warm's call answered `in_flight`.

**What it does not do, and costs.**
- It does not make the right hour arrive sooner when no right-hour data exists on the client. That is the backend's world `/grid` (3 s offline)
  plus the zoom-out's own debounce (0.4 to 1.2 s), and a busy background lane can add more; with live-like latencies the zoom-out's own request can itself wait behind
  the 20 s world pages (above). A faster right hour needs a cheaper right-hour world
  product, or a fetch at the START of the zoom gesture that bypasses the single background lane (deferred: the lane is the box's protection, A15-11).
- A dimmed wash is still the wrong hour: the dim says so, it does not fix it. The panel's line stays on during that window.
- Cost: at most one world `/grid` (2.3 MB, about 3 s of the 1-CPU box) per settled valid time at a regional zoom, GFS and ICON, in the background
  lane, deduped by valid time. In the 5 s warm cell it MOVED the fetch earlier (the zoom-out then fetched nothing); in the 2.5 s and 0.8 s cells BOTH went out (the
  zoom-out's own request had left before the warm landed, and the pipeline does not look in the cache again before sending it): one duplicate world
  `/grid` for that zoom-out. A user who never zooms out pays one extra fetch per settled hour.
- Not built, possible later: a zoom-out that starts while the warm's grid is in flight could join that request instead of sending its own (it
  saves the duplicate 2.3 MB and lands the right hour at the warm's pace); the fetch path has no lookup of the prewarm's in-flight key today (the
  2.5 s and 0.8 s warm cells both sent two world grids).
- A world frame at least 3.5 h from the selected instant is dimmed whatever the cause: that includes an hour-0 frame in a tab left open for hours
  (the app has no periodic marine refresh), which `ForecastTimeStatus` already calls a mismatch.
- Not tested: the live backend (by choice), the owner's Chrome, a real phone, EURO and ICON at far zoom, light and beach themes beyond the two
  screenshots in `evidence/screenshots`, and the wash ring under a regional frame at z6 to 8: there the base is drawn undimmed (the dim is for world
  frames only) and follows the selected hour only where the warm's seed landed, so on a just-opened page it is still the page-load hour until the
  zoom-out commits a world frame. Expected from the code, not measured.
- My mock's world-series latency decides how bad the unfixed window looks (L-P24): with a flat 8 s for every world page (live reads from the earlier
  runs: one-hour page 1.1 to 2.4 s, 48-frame page 2 to 25 s, world `/grid` 0.7 to 4.9 s) the unfixed window is 3.2 to 3.8 s (once 8.7 s), inside
  the live reads of 3 to 9 s; with latency proportional to the frames (a one-hour page 0.3 s) the same flow shows 0.1 to 0.5 s, and the fix changes little.

**Read-back after a deploy.** In the dev site's console, on a page that has been open a minute or more, after selecting a far hour at a regional zoom and
waiting 5 s: `__MARINE_GLOBAL_PREWARM__.grid` has `startedAt` and `doneAt` with `ok: true`; then zoom out: `__RAW_GPU__.staleHour.why` reads `same_step`,
never `stale_world`, and the drawn frame is the selected hour's. With a short dwell, `staleHour.why` reads `stale_world` (mult 0.4) until the right hour is
drawn (`swap: true` in the frame the engine may promote the base). On a page that has just opened the world grid may still be queued behind the fetch
path's own world page (`grid` has `queuedAt` and no `startedAt`): the dim path then shows, which is the design, not a failure. Rollback: the kill switches above per session (`__RAW_DISABLE_STALE_HOUR_DIM__`, `__RAW_DISABLE_BASE_HOUR_SYNC__`,
`__RAW_DISABLE_HOUR_WORLD_WARM__`, `__RAW_DISABLE_WORLD_GRID_FIRST__`, `__RAW_DISABLE_STALE_RESIDENT_SWAP__`), or `git revert` of the commit.

**Caught before the commit, by the tests and the replays** (each is a test now): the dim call had been placed between the no-data stamp and the engine
call, which a source guard in `WebGLMarineCustomLayer.stamp.test.js` pins together; a regional-frame test whose viewport made the layer bail instead of
draw; the warm gave up when the hour moved inside one frame (no new commit re-arms it); the prewarm's `in_flight` skip was invisible until the
telemetry existed; a first A/B whose "unfixed" arm never fetched the exact grid inside 9 s turned out to be the mock's flat 8 s series page holding the
lane (L-P24); and the re-drive described in mechanism 5, built, replayed, found inert and replaced by the swap (see the 2.5 s dwell cell).

## 21:39Z · a correction to the section above (ledger seq 287)
The sentence in its A/B intro, "mock latencies as measured live: world `/grid` 3 s, every world series page 8 s", is too strong. The live reads in
the audit's own evidence (`runs/scn_farzoom_cold_result.json`, `scn_farzoom_result.json`, `scn_timeline_result.json`) are: world `/grid` 0.7 to 4.9 s (3 s is
a mid value), a world one-hour series page 1.1 to 2.4 s, a world 48-frame series page 2 s on a fresh box and 15 to 25 s after a restart. The flat 8 s is a
stand-in inside the 48-frame range and 3 to 7 times too slow for the one-hour page; the live-like paragraph above re-runs the just-opened cells with
2.4 s, 20 s and 3 s and says so. The other wrong claim of this work, "the live latency of the one-hour world page was never measured" (my uncommitted
draft of LESSONS L-P24), never left the working tree and was fixed before the commit (ledger seq 285 item 3).

## 21:45-22:26Z · why the zoom-out's world grid is not sent: the cause is found (owner: "go with 1, diagnose why the zoom-out grid isn't sent"); diagnosis only, NO product code changed

**What was asked and what was done.** The owner picked the first item of my "not touched" list. Nothing in `frontend/` or `backend/` was edited. The tools: the offline
harness (`scn_wronghour.js` gained `TRACE_APP=1`: the app's console, every weather request the PAGE issues, a 50 ms state sampler and the app's own forensic ring
`window.__RAW_FORENSIC__`), and ONE scratch build of the committed frontend (`dd28a1dd`) plus a trace/intervention patch (`patch_trace.py`, `build_trace.sh`, never
applied to the repo): it records every enqueue, dispatch (and which pending run it cancels), run and fetch of the marine fetcher in that ring, and has one runtime
switch for the candidate fix (`window.__DIAG_NO_SU_CANCEL__`). Without the switch it behaves as committed. Every run is offline (mock backend, no live request).

**Cause, in one paragraph.** After a zoom-out the grid fetch is not made directly: `moveend` waits a 900 ms debounce (50 ms if the viewport is cached), enqueues
`'moveend'` on the fetcher's single dispatch slot, and the dispatch arms a 300 ms timer whose callback runs `updateMarineGrid` with THAT enqueue's source. Any LATER
enqueue clears that pending timer and installs its own. A regional series page that lands in those 300 ms fires `marine_series_revalidated`, which enqueues
`'series_upgrade'`: a cache-only lane that returns before any network request. It cancels the pending `moveend` run and runs in its place. Nothing re-arms the fetch
(`moveend` already fired; the camera hash is unchanged), so the zoom-out's world `/grid` is never requested and the map keeps whatever frame it had until the next
gesture. The lane's own comment says it is "opportunistic: never buffer against, release, or abort a real fetch" and the code honours that only for a fetch IN FLIGHT
(`locks.isFetching`), not for one still PENDING.

**The code path** (line numbers at `dd28a1dd`):
- `useMarineOrchestrator.js:344-346` `onMoveEnd`: `debounceTime = isCached ? 50 : 900`, then `enqueueMarineUpdate('moveend')`.
- `useMarineDataFetcherCore.js:808` `enqueueMarineUpdate`: one slot (`scheduledRef`, :899-901); `_runDispatch` (:913-943) does `if (timeoutIdRef.current) clearTimeout(...)` at :917,
  then `timeoutIdRef.current = setTimeout(..., stableDelay)` (300 ms; 20 ms when cached, manual, flavor_toggle or timeline_scrub), and its callback calls `updateMarineGrid(source)`.
- `useMarineDataFetcher.js:218-225`: `marine_series_revalidated` -> `enqueueMarineUpdate('series_upgrade')`.
- `marineGridSeries.js:376-382` and `:470-477`: the event is dispatched whenever a non-coarse series page, or the hour-0 mini, lands (regional or world).
- `useMarineDataFetcherCore.js:444-447`: `if (source === 'series_upgrade') return;` before any network fetch.
- `useMarineDataFetcherCore.js:833-836`: the lane skips only `if (locks.isFetching)`.
- Dating (`git blame`): the shared slot and its clear-on-dispatch since 2026-06-20 (`d697db43`), the 900 ms debounce since 2026-05-25, the `series_upgrade` lane since
  2026-07-17 (`f74214fd`, "flavor-cache fast path + series-arrival upgrade lane"). The race has existed since that commit, about 2.5 months.

**The proof (offline, traced build, live-like latencies, just-opened page, 0.8 s stay, jump zoom; times in ms after the zoom start).** A failing run
(`wh2_diagB_rm250_sw0_r1`):
`932 enq moveend (nothing pending)` -> `949 dispatch moveend (timer armed, 300 ms)` -> `1005 enq series_upgrade (a pending run exists: moveend)` -> `1017 dispatch series_upgrade,
cancels "moveend"` -> `1317 run series_upgrade` -> `1318 returns, no fetch` (and no `dx_fetch` for `moveend` anywhere). A run that got its grid (`..._sw0_r4`): the series page
landed at 852, BEFORE the dispatch; at 929 the `moveend` dispatch cancelled the pending `series_upgrade` (the harmless direction); `moveend` fetched at 1234.

| switch | regional series page reached the app (ms) | a pending `moveend` run cancelled by `series_upgrade` at (ms) | `series_upgrade` skipped, run kept at (ms) | `moveend` world grid fetched at (ms) | outcome |
|---|---|---|---|---|---|
| committed behaviour | 1,006 | 1,017 | - | - | **grid NOT sent** |
| committed behaviour | 1,056 | 1,065 | - | - | **grid NOT sent** |
| committed behaviour | 1,066 | 1,081 | - | - | **grid NOT sent** |
| committed behaviour | 852 | - | - | 1,234 | grid sent |
| candidate fix ON | 953 | - | 948 | 1,249 | grid sent |
| candidate fix ON | 1,095 | - | 1,139 | 1,337 | grid sent |
| candidate fix ON | 965 | - | 964 | 1,252 | grid sent |
| candidate fix ON | 899 | - | 920 | 1,267 | grid sent |

The first column is the harness's request-finished time and the others the page's own clock; they differ by up to about 10 ms, which is why a skip can read a few ms before the landing.

| regional series latency in the mock | series page reaches the app (median, ms) | committed behaviour: grids lost / runs | candidate fix ON: grids lost / runs |
|---|---|---|---|
| 800 ms | 632 | 0 / 2 | 0 / 2 |
| 1,000 ms | 986 | 3 / 4 | 0 / 4 |
| 1,080 ms | 1,201 | 2 / 2 | 0 / 2 |
| 1,200 ms | 1,276 | 0 / 2 | 0 / 2 |
| 1,360 ms | 1,356 | 1 / 2 | 0 / 2 |

**The second order, injected (experiment D, 8 runs).** By reading `:899-901` a second order exists: a `series_upgrade` run scheduled FIRST takes the single slot, and a fetch-capable enqueue that arrives while the slot is taken is dropped silently by `if (scheduledRef.current) return;`. It never occurred naturally: in the 26 natural-order traced runs (experiments B and C, and the two natural-order runs of D) no `moveend` enqueue found the slot taken; the only slot-taken enqueues were `series_upgrade` finding another `series_upgrade`'s slot (two series pages landing a few ms apart; harmless, the lane is cache-only). So I injected it: `patch_trace2.py` makes the `moveend` debounce callback fire `marine_series_revalidated` synchronously just before it enqueues (`window.__DIAG_SU_FIRST__`), and adds the complete capability-aware dispatcher behind `window.__DIAG_FULL_FIX__`. Cold jump, live-like latencies, 0.8 s stay, ms after the zoom start:

| variant | runs | what the trace shows | grid sent |
|---|---|---|---|
| committed behaviour, order injected | 2 | `moveend` dropped at the slot check (`dx_enq_dropped_sched`, at 911 and 914 ms); the cache-only run executes at 1,351 and 1,272 ms and returns without a fetch | 0 of 2 |
| the one-switch fix of the first order, order injected | 2 | `moveend` dropped again (at 920 and 915 ms): the switch does not cover this order | 0 of 2 |
| complete dispatcher, order injected | 2 | one run took the replace path (`dx_sched_replaced` at 908 ms; `moveend` run and fetch at 1,217 ms); in the other a natural landing at 755 ms had already dispatched, so the injection met a free slot, `series_upgrade` was skipped and the `moveend` dispatch at 962 ms cancelled the pending cache-only run (the harmless direction); fetch at 1,262 ms | 2 of 2 |
| complete dispatcher, natural order | 2 | the series page landed inside the window (1,137 and 1,142 ms), `series_upgrade` skipped, `moveend` fetch at 1,222 and 1,239 ms | 2 of 2 |

The injection is synthetic: it shows the second order is real code behaviour and that the one-switch fix would leave it open, not that it happens live. Its window is the time between an enqueue and its dispatch (one animation frame, longer when the thread stalls), against 300 ms for the first order, so by the code it should be much rarer.

**Before the traced build, the same thing from the plain runs.** In 8 untraced runs of the same cell the grid was lost in exactly the 2 whose regional series page reached
the page at 941 ms or later (`series_upgrade` ran its cache-only fast path at 1265 and 1391 in place of the fetch); the 6 that landed at 919 ms or earlier were sent. Across all 34
cold jump runs of the F-21 work: 26 of 26 with no series landing in the window sent their grid; 6 of 8 with one in the window lost it. The two that did not: a run whose viewport was
cached (a 50 ms debounce and a 20 ms stable delay put its window near 300 ms, not 1,000), and `fin800_r1_after_cold_jump` (flat mock, no trace): the skip on `locks.isFetching` may have
protected it; not shown.

**When it bites.** It needs (1) a zoom-out that needs a fetch (an uncached viewport: the 300 ms window; a cached one has about 20 ms) and (2) a series page landing in those
300 ms. In the harness, at a 0.8 s stay on a just-opened page with live-like latencies, 6 of 14 zoom-outs lost the grid (4 of 6 in the F-21 matrix, 2 of 8 in the first traced set); at a 5 s stay 0 of 6, because the
regional pages the selection triggers have landed long before. Not measured live. Any series page (regional or world) or hour-0 mini fires the event, and a page that is slow under load lands at a random moment, so it would hit the window now and then (live: the regional mini 0.2 s; the world pages 2 to 25 s). The same path serves a PAN at an uncached viewport (not tested). Effect: the map keeps its frame until the
next gesture: with the previous hour that is the wrong-hour frame of F-21 (full strength before the F-21 fix, dimmed after it). It is consistent with, but NOT shown to be, the cause
of the "far-zoom frame stays wrong or blank until I zoom in" reports of 2026-09-30 (commitment 228); the live read-back below is how to tell.

**Proposed fix (NOT built; the owner decides).** Make the dispatcher capability-aware, so the opportunistic lane is opportunistic in BOTH orders: (1) a `'series_upgrade'` enqueue returns
when a run is already pending (`scheduledRef.current || timeoutIdRef.current`): this is what the lane's comment already promises for an in-flight fetch (the next landing re-fires the event,
so a skip costs nothing) and it closes the order observed here; (2) a fetch-capable enqueue that finds a cache-only run SCHEDULED but not yet dispatched (`scheduledRef.current`, :900)
replaces its source instead of being dropped: by reading the code this second order is possible when a series page lands in the same frame, or during a main-thread stall, before the
`moveend` enqueue (the jump zoom here stalls the thread about 300 ms); it did not occur in the 26 natural-order traced runs, and injected (above) it is NOT covered by
(1) alone. About a dozen lines, default ON with a kill switch
(`__RAW_DISABLE_SU_NO_CANCEL__`), a `series_upgrade_skipped_pending` event in the forensic ring for the read-back, and call-site tests with fake timers for both orders (`moveend` then
`series_upgrade` inside the stable delay, and the reverse: `updateMarineGrid` must run with `moveend` each time). The scratch build has (1) as one switch (`__DIAG_NO_SU_CANCEL__`) and (1)+(2) as another (`__DIAG_FULL_FIX__`): with (1), 0 grids lost at
landings inside the window; with (1)+(2), 2 of 2 sent in the injected order (above). Rejected: making `series_upgrade` fetch-capable (it exists to avoid re-serving the interim tier), and shortening the stable delay (narrows the window,
does not close it).

**Read-back after a deploy of the fix.** On the dev site, zoom out 1 to 2 s after picking a far hour on a page that has just opened, ten times: `__RAW_FORENSIC__.dump()` shows a
`series_upgrade_skipped_pending` event whenever a page landed in the window and a `moveend` fetch after every zoom-out; without the fix a zoom-out with a landing in the window shows
`flavor_fastpath_miss src:series_upgrade` and no `moveend` fetch.

**Limits.** Offline only. The candidate fix was tested as a runtime switch in a scratch build, not as a code change in the repo. The mock's regional series latency (1 s) is
slower than the live mini (0.2 s), so how often a landing falls in the window live is not known. Pans and other `moveend` sources were not run. The link to the owner's
earlier reports is a hypothesis. The second order was injected (a synthetic hook fires the series event just before the `moveend` enqueue), not seen naturally: it shows the
code behaves that way, not that it happens live, and its window (an enqueue to its dispatch, about one frame) is far narrower than the 300 ms of the first order.

## 22:50Z to 00:33Z (2026-10-02) · the scheduler slot fix (F-23): built, tested, replayed offline; client only, ON by default (owner: "go, build the scheduler fix")

**What was built (commit e29cddde, local, NOT pushed).** The fix proposed in the diagnosis section above, both parts, client only; nothing in `backend/`, no served number changes
(no SCOREBOARD row). `enqueueMarineUpdate`'s single dispatch slot now knows what an enqueue can DO. The rules live in a new module, `marineEnqueueSlot.js` (62 lines), and
`useMarineDataFetcherCore.js` calls it (+6 -3 lines, 959 -> 962; the LOC baseline is 966):
- a cache-only enqueue (`series_upgrade`) never displaces a pending run: it is SKIPPED when the slot is taken or a stable-delay timer is armed (the order seen in the traces). A skip costs
  nothing: the next landing re-fires the event, and a run that executes after the page landed reads it from the cache (`updateMarineGrid` applies the same gates to every source).
- a fetch-capable enqueue that finds the slot taken by a cache-only enqueue SUPERSEDES it (the second order, injected in the diagnosis). `scheduledRef.current` now holds a slot object
  `{cacheOnly}` instead of `true` (nothing else reads it), and a dispatch runs only while `scheduledRef.current` is still ITS slot; a superseded dispatch finds another slot there and does nothing.
- everything else is as before: a second fetch-capable enqueue in a frame is dropped (the first one's run does the work), a fetch-capable enqueue in a later frame replaces the pending run.
Kill: `window.__RAW_DISABLE_SU_NO_CANCEL__ = true` restores the previous slot exactly. Telemetry: `__RAW_FORENSIC__` events `series_upgrade_skipped_pending {slotted}` (a landing that used to
cancel or be dropped) and `cache_only_slot_superseded {by}`. Rejected, as proposed: making `series_upgrade` fetch-capable (it exists so the lane never re-serves the interim tier) and
shortening the 300 ms stable delay (narrows the window, does not close it).

**Tests.** 38 new tests in 2 files. `marineEnqueueSlot.test.js` (25): the verdict for every state of the slot (source kind x slot held by what x timer armed x kill switch) and the claim
(slot object stored, skipped/dropped/superseded return and the forensic events). `useMarineDataFetcherCore.enqueueSlot.test.js` (13): the REAL `enqueueMarineUpdate` under fake timers, with
`updateMarineGrid` driven for real and observed through the source it logs at its first gate: first order (a page lands inside the stable delay, late in it, and in the slot's own frame),
second order (the lane scheduled first; the superseded dispatch neither runs twice nor frees the slot; a hidden tab with no animation frames, where only the 1.5 s fallbacks fire), what did
not change (the lane runs when nothing is pending and after the pending run has gone out; latest wins across frames; first wins within a frame; a fetch in flight still returns first),
and the kill switch reproducing both old behaviours. **17 exact-string mutations** (`harness/mutation_check_su_no_cancel.py`: every rule, the capability stamp, both forensic events, the
kill switch in two ways, the slot ownership check, the old slot check put back) **each turned the two suites red** (1 to 14 failing tests); the restored baseline is green. The whole
`src/components/map` folder: 208 suites, 2,237 tests green. ESLint gate OK (4 pre-existing warnings in the touched file). LOC ratchet OK.

**Offline replay in the BUILT apps (A/B).** BASE = the committed frontend (`git archive HEAD`, 5deb4e23) and FIX = the working tree, both built with the same flags (`CI=false GENERATE_SOURCEMAP=false craco build`)
and served on :3101 and :3100; mock backend, NO live request, the app clock pinned (`PIN_NOW`). The just-opened cell (cold session, jump zoom-out, 0.8 s stay) with live-like latencies (one-hour world page 2.4 s,
48-frame page 20 s, world `/grid` 3 s) and `TRACE_APP=1` (the page's own requests and the forensic ring). The mock's regional series latency is swept so the series page reaches the app before, inside and after the
zoom-out's dispatch window (about 0.93 to 1.25 s after the zoom start); 3 reps per latency, arms alternating, one run at a time (`harness/run_f23.sh f23a 3 200 250 270 300 340`, `harness/f23_tables.py`).

| regional series latency in the mock | series page reaches the app (median, ms): committed / fix | committed code: grids lost / runs | with the fix: grids lost / runs |
|---|---|---|---|
| 800 ms | 871 / 847 | 0 / 3 | 0 / 3 |
| 1,000 ms | 1,089 / 1,057 | 3 / 3 | 0 / 3 |
| 1,080 ms | 1,158 / 1,132 | 3 / 3 | 0 / 3 |
| 1,200 ms | 1,268 / 1,261 | 1 / 3 | 0 / 3 |
| 1,360 ms | 1,407 / 1,424 | 0 / 3 | 0 / 3 |

Where a series page landed inside the window (the committed code's telltale: a `series_upgrade` run that missed the cache, `flavor_fastpath_miss` at 1.37 to 1.65 s; the fix's own: `series_upgrade_skipped_pending` at the
landing) the committed code lost the zoom-out's world `/grid` 7 of 7 times and never drew the right hour inside the 9 s watch. The fix requested it 6 of 6 times
(at 1.25 to 1.34 s, the moment the runs with no landing in the window request it, 1.24 to 1.31 s) and drew the right hour at 4.44 to 4.53 s (median 4.48 s; the runs outside the window: 4.45 s).
Outside the window neither build lost one (0 of 8, 0 of 9). Page errors 0, blocked writes 0.

**Regression replays in the same two built apps.**
- *The F-21 cells at a 5 s stay* (live-like latencies, no trace sampler; `harness/run_f23_reg.sh`, `run_f23c.sh`, `tab_f23b.py`). Cold jump, 3 runs each, committed vs fix: the wrong hour at full strength 203 vs 204 ms, dimmed 3,857 vs 3,826 ms, the right hour drawn after 4,472 vs 4,482 ms, blank 0 vs 0. Warm jump, 7 runs each: no wrong-hour frame in either; the right hour 374 ms (344 to 535) vs 391 ms (365 to 600): the means (395 vs 442 ms) differ by less than the run-to-run spread (exact permutation test, p = 0.27), and the frame is drawn by the zoom-out bridge, upstream of the scheduler.
- *The far-zoom scrub* (`scn_farzoom_scrub_legend.js`): the same in both. The thinned placeholder (46x20, Florida 1.34 m) at 3.2 s vs 3.1 s, the exact 2-degree frame (181x82, 2.33 m) 4.38 s vs 4.34 s later, and after a zoom-out the exact right-hour frame at 0.36 s vs 0.35 s.
- *The owner's own pattern, erratic zoom in and out at the Florida timestamp* (5 seeds, then seeds 23 and 67 replicated 3 times per build with the fetcher's events recorded; `harness/run_f23_erratic.sh`, `tab_f23_erratic.py`). The frame metrics do not differ in a way the data supports. Pooled over both passes (14,671 frames committed, 14,971 fix): frames with the Florida swell under 75% of the exact frame 0.65% vs 0.69%; frames with the heat map faded 3.3% vs 2.4% (first pass 4.5% vs 2.7%, replicates 2.3% vs 2.2%: not consistent, so not an effect I claim); no frame without a committed frame in either. **One unforced occurrence of the defect.** Every run begins with the scenario's own set-up: select the far hour at z9, jump to z3.6, watch 20 s. In 1 of 4 committed-code runs (`f23_e_before_r3`) the selected hour's world `/grid` was never requested (no 360-degree `10-07T18:00` response for 33 s): the dimmed wrong-hour frame was drawn for all 1,194 frames of the watch and 3 s more, against 186 to 190 frames in the other three. With the fix 0 of 4 (188 to 241 frames; the grid answered at 22.2 to 23.0 s, as in the normal committed runs). One run, recorded, not a rate.
- *What the fix's own events show.* In the six 25 s erratic trials with the fix, `series_upgrade_skipped_pending` fired 45 times and `cache_only_slot_superseded` 12 times. **Correction:** the second order is not rare under erratic input (my "far narrower window, much rarer" was a prediction from the code, and the 26 cold-cell runs of the diagnosis could not show it); each supersede is a fetch-capable enqueue the committed code dropped at the slot check. Whether those drops cost a visible frame is not shown (a later gesture re-enqueues, and the frame metrics did not differ). **Second correction:** REPORT V41's "weak frames 1.0% to 0%" for the F-21 build was one lucky sample; that build reads 0.65% here over 14,671 frames, the F-21 fix does not change weak frames, and the 0.7% residue is the placeholder windows of the F-19 work (11.1% to 0.7%).
**What this fix is not.** It removes a real lost request (the lost-grid runs have the shape of the owner's 2026-09-30 report: the right hour never arrives until a gesture; that they are the same defect is a hypothesis). It does NOT change the erratic-zoom disappearances the owner reported (the faded heat map and the placeholder windows are the same in both builds): those stay open (F-22 and the placeholder windows).

**Limits.** Offline only (mock backend, no live request; the harness's regional series page takes 1 s, the live mini 0.2 s, so how often a landing falls in the window live is still not
known). The first order is replayed in the built app with the committed code losing the grid; the second order is covered by the call-site tests and shows up naturally in the built fix app's erratic runs
(12 `cache_only_slot_superseded` events in six trials), but no built-app run shows the COMMITTED code losing a frame to it. Pans and the other `moveend` sources use the same slot and are covered by the
call-site tests, not replayed. The cost, stated: where a page used to cancel the zoom-out's grid, the zoom-out now sends
it: one world `/grid` (2.3 MB JSON, about 3 s of the 1-CPU box), the request every zoom-out that needs one has always sent when no page happened to land in the window.

**Read-back after a deploy (the owner's dev site; commitment in the ledger).** Pick a far hour at a regional zoom on a page that has just opened, zoom out 1 to 2 s later, ten times.
Each zoom-out must show a `/api/weather/grid?...bbox=-180,-80,180,85` request in the Network tab; `__RAW_FORENSIC__.summary().counts.series_upgrade_skipped_pending` counts the landings that
used to cancel it (0 is fine: it only fires when a page lands in the window); without the fix a landing in the window shows `flavor_fastpath_miss` with `src: 'series_upgrade'` about 1.3 s
after the zoom-out and no grid request. Rollback: `__RAW_DISABLE_SU_NO_CANCEL__ = true` per session, or revert the commit.

## 00:40Z to 02:05Z (2026-10-02) · why the heat map fades on a zoom-out (F-22): the cause is found; diagnosis only, NO product code changed (owner: "go, diagnose the faded heat map next, also use the new plugins and connectors and skills I added to help us")

**What was asked and what was done.** The owner asked for the faded heat map (the "bigger swell heat map disappears from the FLA coast intermittently" of the first order of this session) to be diagnosed, with the newly added
plugins, connectors and skills used where they help. Nothing in `frontend/` or `backend/` was edited. Method: `superpowers:systematic-debugging` (root cause before any fix; the matrix below is its "one variable at a time").
Tools: a new offline scenario `scn_heatfade.js` (generated by `gen_heatfade.py`) that records, for EVERY rendered frame, the layer's gate inputs and decision, the engine's opacity-chain terms, the coarse base the engine holds, the camera state and the pixels
at two offshore Florida points; runtime knobs as interventions (never fixes); the built app = the working-tree frontend (the committed code at `e29cddde`, F-21 and F-23 included) on :3100, mock backend, NO live request. Live evidence: the repo's own
Marine Nightly (the live app on prod data), read-only through `gh` (it is authenticated now; see the correction at the end).

**A correction first: what the harness called "HEAT0" is not a vanished heat map.** My reports and the F-23 section above call a frame with `opacity.heatmap < 0.2` "the heat map faded" or HEAT0, and the nightly names the same state MULT0_FRAME, "blank-flash class" (`zoomlab-verdict.js:18`).
It is neither blank nor a whole-layer fade: the layer's zoom-out gate sets the multiplier `mult` to 0, which hides the regional pass AND the crest animation, while the retained coarse wash (`_coarseBaseData`, the 2-degree 181x82 world frame for GFS) keeps painting at about 0.49.
Evidence: of 401 HEAT0 episodes listed in the earlier erratic runs, `heat` was 0 in all and `mult` was 0 in 396 (5 had `mult` 1: the cold-veil lift ramp, inferred, not shown); 83 screenshots taken at the first HEAT0 frame show 57 to 78% of the pixels coloured; at a Florida probe the colour
spread (max minus min of R, G, B over a 5x5 patch) falls 22 to 38% (median about 32%) against the level just before, never to a blank (0 probe frames under a spread of 30). The visible loss is the regional detail and the animation, which is where a "bigger swell" would be. The band the cause below predicts is where they happened: 399 of the 401 episodes began between z4.0 and z7.5 (z4.5: 70, z5.0: 64, z5.5: 108,
z6.0: 98, z6.5: 33, z7.0: 25; the band is z4.5 to 7 at 1280 px); 249 were zoom-outs, 118 flat, 34 zoom-ins (`runs/f22/heat0_episodes_summary.txt`).

**Cause, in one paragraph (code, then three independent confirmations below).** Two predicates that were designed to agree stopped agreeing on 2026-07-22. The layer's display gate (`WebGLMarineCustomLayer.js:241` the zoomed-out test, `:268-282` the cover fraction and the reject, `:314` the call into `marineZoomOutGate.resolveRejectedOpacity`) hides a REGIONAL resident
that covers less than 0.6 of the viewport (`__RAW_DOWNGRADE_COVER_FRAC__`) whenever the view counts as zoomed out: `zoom <= 7.0 || span > 15 degrees`. With a coarse base held it takes branch 1 and the layer multiplier becomes the coarse-bridge grace, which is OFF by default, so `mult = 0`; with no base held it
blanks (the 2026-08-06 model). That is safe only if the ENGINE then promotes the held coarse base to be the resident, so the hidden band is covered by something drawn at full strength. The design said so (`8625841b`, 2026-07-16, repeated in the layer comment at `:268-270` and in the module header): "guard keeps >=0.6,
gate shows >=0.6, bridge promotes <0.6 - no coverage band is resident-but-hidden". `06b3dbc2` (2026-07-22, "don't bridge the 2 degree mid to the 10 degree coarse in the 15-40 degree zoom-out band", for EURO's 5 s flash of the 10-degree base) narrowed the PROMOTION to `span > 40 degrees`
(`_midBandBridgeWide`, `marineCommitGate.js:66-74`, used by `shouldBridgeToCoarseGlobal` and the mirror `shouldRejectSubcoveringRegional`, and mirrored by the arbiter's `subcover_at_wide`) and did not touch the gate. So in the band **zoom <= 7 and span <= 40 degrees** (about z4.5 to 7 at a
1280 px wide map, z5.1 to 7 at 1920 px, z2.8 to 7 on a 390 px phone) a resident that covers under 0.6 is hidden and nothing is promoted: it stays resident-but-hidden until a wider clip commits. That needs the gesture to settle (the `moveend` debounce 900 ms, 50 ms if the viewport is cached; the 300 ms stable delay, 20 ms
cached; `updateMarineGrid` then waits for `isMoving`/`isZooming` to clear), then the fetch, then the commit; or the user zooming back in. The commit message of `06b3dbc2` says the intent was that "below it the mid is HELD through zoom-out", and its zoomlab check (EURO to z5.35, a continuous wheel) reports the mid held with no flash. A continuous zoom-out lets the clip keep
pace; a stepped one whose first step outruns the clip does not (my inference from the traces: the commit does not record the cover fraction).

**Confirmation 1: interventions, one runtime knob at a time (offline; the owner's pattern: seeded erratic zoom at the Florida timestamp, 5 seeds of 25 s; frames = every rendered frame).** A frame is HIDE when `mult < 0.5`, OTHER when `heat < 0.5` with `mult >= 0.5`.

| run | knob | frames | HIDE | OTHER | what it shows |
|---|---|---|---|---|---|
| baseline a | none | 6,438 | 2.4% (11 episodes; median 236 ms, max 1,428) | 0.0% | |
| baseline b | none | 5,943 | 3.6% (26 episodes; median 36 ms, max 886) | 0.0% | |
| bridge ceiling off | `__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__` (the old rule `zoom <= 7 or span > 15` for the bridge, the reject and the arbiter) | 6,042 | **0.0%** | 0.2% | the hidden state never occurs; the frames that were hidden show the 2-degree world frame instead |
| cover fraction 0.01 | `__RAW_DOWNGRADE_COVER_FRAC__` | 6,515 | 0.3% | 5.5% | the sub-covering tile is left visible (resident stays a clip on 76.9% of frames, 37% in the baseline) and the dip moves to the tiny-tile fade: the documented "motion rectangle" trade (`b21cf29d`) |
| cold veil off | `__RAW_DISABLE_COLD_COARSE_VEIL__` | 6,716 | 2.8% | 0.0% | unchanged: the cold veil is not the cause |

Deterministic jumps from z7 to {3.6, 4.4, 5.0} with {300, 900} ms eases (4,258 to 4,284 frames per arm): baseline HIDE 2.2% (the hide lasts 0.5 s at 7 to 4.4 with 30 to 32 frames); bridge ceiling off HIDE 0.0%; cover fraction 0.01 OTHER 16.3%; the 6.1% DIM in both
(6.1% and 6.2%) is F-21's provisional stale-hour dim (0.4x for a world frame of another hour, 3.8 to 4.5 s on a just-opened page; by design, a different fade).

**Confirmation 2: Jacobian sweeps (one input at a time, offline; `run_hf_jacobian.sh`).**
- A. Target zoom by a jump from z8 (resident = the 17x13 Florida tile): a hide of 91 to 361 ms at EVERY target from z7 to z4.25 where the tile covers under 0.6 (cover 0.01 to 0.13 at the first frame), ended by a new clip commit: 91 to 120 ms when the viewport is already cached, 345 to 361 ms when a fetch is needed
  (mock regional 250 ms). It is not a narrow zoom window: it is any zoom-out past the clip's coverage, at least about 6 frames.
- B. Regional /grid latency in the mock (first, uncached zoom-out by a jump 8 -> 5.5 / 8 -> 4.75): hide 1.43 / 2.28 s at 125 ms, 1.52 / 1.50 s at 250 ms, 1.74 / 1.73 s at 500 ms, 2.28 / 2.27 s at 1,000 ms, and at 2,000 ms 3.27 s with the other cell still hidden at the end of the 6 s hold. Hide = about
  1.3 s (900 ms debounce + 300 ms stable delay + commit) + the fetch latency, slope about 1:1.
- C. Gesture duration (8 -> 4.75): jump 1.41 s; eased 300 ms 0.34 s; 900 ms 0.80 s; 2,000 ms 1.68 s (cached viewports: the hide lasts to the end of the gesture plus about 100 ms).
- D. Cached repeat (8 -> 5.5 jump, three times): 1.50 s, then 0.08 s and 0.11 s.
- Frame-gap cost of the bridge ceiling knob: gaps over 100 ms per minute 66.0 and 67.4 (two baselines), 69.8 with the knob, run-to-run spread 45 to 70: no measurable cost.

**Confirmation 3: the live app (Marine Nightly zoomlab, prod data).** 70 scheduled runs, 2026-08-24 to 10-01 (`gh run list/view`, read-only; `runs/f22/nightly_history.tsv`, whose "verdict_line" column is NOT reliable, it greps the first `[verdict]` in the log): MULT0_FRAME in 19 runs (95 frames); over the budget of 2 on that
finding alone in 7: 08-25 (5), 08-31 (4), 09-01 (4), and the last four in a row, **09-28 (4), 09-29 (12), 09-30 (9), 10-01 (12)**. The nightly of 10-01 (run 36871159427, commit `63a70425`, artifact `zoomlab-nightly-36871159427`, `runs/f22/nightly_2026-10-01_mult0_frames.json`) has the engine state per frame; both episodes
are the band above (the sampler runs at about 1 Hz, so 12 findings are two episodes):
1. 306.3 to 308.7 s: z6.24, span 10.0 degrees, resident `-84,25,-79,31` (a 21-column 2-degree mid clip), covF 0.456, `hm` 0, `mult` 0; replaced at 310.0 s by `-90,20,-70,36`.
2. 335.8 to 344.0 s (9 samples, 8.3 s; 9.2 s to the commit): z4.72, 4.54, 4.36 (spans 28.7, 32.6, 36.9 degrees; covF 0.596, 0.465, 0.363), `hm` 0, `mult` 0, the SAME resident `-90,20,-70,36` across three zoom steps, until a wider clip `-104,6,-52,50` committed at 345.0 s (covF 1, `hm` 0.677, `mult` 1).
   The frames just before were shown (z4.90, covF 0.764, `hm` 0.688). The trace's `bridge` field (`__MARINE_ZOOMOUT_BRIDGE__.count`, the engine's promotions) is 0 for the whole 444 s run.
The artifact's own network summary classes 253 of 601 requests slow, and the two it classifies as weather grid took 7.0 s and 3.8 s: the live hide lasts as long as the clip's fetch, the offline law above. **What this does and does not explain about the red nightly:** MULT0_FRAME is the red finding of 09-28 to 10-01 (CONSOLE_ERROR=3 and 2 on two
of them). The mechanism is 10 weeks old, 9 of the 10 runs of 09-18 to 09-27 had none (09-26: one), and nothing in this diagnosis says why it started to be sampled on 09-28. Between the last green run's commit (`47be25fd`, 09-27) and the first red one's (`89b13a0a`, 09-28) there are 46 commits; the ones that touch `frontend/src` are the A15-11 fetch-ordering
changes of 09-27 (`83d17848`, `74a79b45`, `c34173b7`, `4c19d497`) and three e2e recorder commits (`e7b219da`, `6726a393`, `29d874df`). Whether the live backend was slower from 09-28 or one of those lengthened the clip's fetch is NOT shown (an offline A/B of the commits at one mock latency would tell; not run).

**What the history says, so a fix does not repeat one.** The gate and the bridge have drifted before: `4050a9d3` (2026-08-16) found the gate module and the layer already different after nine days. Known-bad, and re-measured here: (1) lower the cover fraction (`b21cf29d`, reverted: "motion rectangle"; the cover knob row above); (2) route the no-bridge case
into the fade branch (a no-op, `zoomFade` is 0 below z5.5; `89f61d87`). Built and left DARK: the coarse-bridge grace (`e17f0332`, 2026-08-15, `__RAW_COARSE_BRIDGE_GRACE__`, default off): after 4 s of being hidden with no map motion it reveals the partial regional over the wash (its own model: 14.5 of the 18.8 s episode of
08-13 visible, 0.5 of 4.9 s on 08-15). The wash stays under the hidden pass because `f172f898` (2026-07-23) floors it whenever the resident stops covering: a clear before that commit, a fade after it. I found no record of a decision on switching the grace on in the docs I searched (the 08-15 handoff lists it as open, and the 08-15 rule is that a default-on commit would itself be a release).

**Recommendation (NOT built; the owner decides): make the promotion honour the gate where it loses nothing.** The 40-degree ceiling exists for a held base of 10 degrees; since 2026-07-23 (`MARINE_MID_RES_MAX_SPAN=400`, `mid_res_tier.py`, whose comment covers GFS, ICON and EURO) the world request is served the pre-computed 2-degree `global_mid`, the
live nightly's (GFS) world frame is that 181x82 field, and a mid clip is that same field cropped to the viewport, so promoting a 2-degree base is lossless (checked live for GFS only). Rule: in `_midBandBridgeWide`, when the held base's cell is 2.5 degrees or finer use the gate's own wide test (`zoom <= 7 || span > 15`, the pre-07-22 rule), otherwise keep the 40-degree ceiling. The cell is
computable from the coarse grid each caller already holds (`shouldBridgeToCoarseGlobal(coarse)`, `shouldRejectSubcoveringRegional(resident)`); the arbiter's `subcover_at_wide` takes it through `ctx` and the existing 3,000-fixture differential harness enforces that the three agree. About 10 lines, default ON, a kill switch
(`__RAW_DISABLE_BASE_AWARE_BRIDGE__`), and the 07-16 invariant as a pure test over (zoom, span, cover, base cell): wherever `resolveRejectedOpacity` returns `coarseBridge`, the bridge must fire for a 2-degree base. Acceptance: offline HIDE share about 0 in `scn_heatfade.js` (6,042 frames with the ceiling knob, the superset of this rule) and the nightly's MULT0_FRAME at 2 or fewer.
**The cost, stated:** the promoted frame is drawn the way a world frame is drawn, not the way a clip is: Florida colour spread 146 (global frame shown, 59.1% of the frames of the second baseline), against 181 for a clip and 117 while hidden, so the dip becomes a step of about 19% instead of 35% at the moment a covering clip commits; the data are
the same, the difference is the render path (a tuning item, not part of this fix). Not tested: EURO and ICON (the nightly runs GFS only; `ZL_MODEL=EURO|ICON` exists and was not run, it would be a live replay), a phone-width map, the rating (surf) flavor, the live app after a change.

**What this diagnosis does not establish.** (1) That the owner's own faded heat map is only this state: F-21's stale-hour dim (0.4x, by design), the tiny-tile fade and the cold-veil ramp are other fades. (2) A faint lighter rectangle at the old clip's bounds, present in every deterministic screenshot, shown and hidden: unexplained.
(3) `HEAT0|null` (8 of 401: the engine reported nothing): not reproduced. (4) The cold-veil ramp as the cause of the 5 episodes with `mult` 1: inferred only. (5) Why the nightly started sampling it on 09-28 (above).

**Tools used, and which of the owner's new ones were not usable.** Used: `superpowers:systematic-debugging`; two Explore subagents (the opacity-chain map worked; the history search stalled for over an hour with no result and was stopped, the history above is from `git log`, `git show` and the repo's own docs); GitHub through `gh` (works, read-only). Not usable in this
session (reported by the harness as failed to connect or needing authorization): `chrome-devtools-mcp` (connection closed), `mapbox` (OAuth/timeouts), `render` and `supabase` (OAuth metadata fetch failed), `sourcegraph` (needs `SOURCEGRAPH_ENDPOINT`), `desktop-commander`, `gitkraken` (connection closed). None was needed for the diagnosis.

**Corrections and notes (dated 2026-10-02).** (a) The 18:58Z note above says "gh auth is invalid"; it was true then, `gh` is authenticated now (the owner connected GitHub during this work) and every read here used it read-only; the ledger correction for seq 291 waits for the ledger order (below). (b) The F-23 section above reports "frames with the heat map faded 3.3% vs 2.4%": those
are HEAT0 frames, this state (the wash stays); the number is unchanged and the wording is corrected. (c) A peer's review of F-23, verified in the code: `lastInvocationRef.current = { source, time: now }` (`useMarineDataFetcherCore.js:900`) is set BEFORE `claimEnqueueSlot` (`:902`), so a skipped `series_upgrade` still arms the 800 ms same-source dedupe (50 ms cached); the committed code
stamped it with the cancelling enqueue too, so nothing changed and it is harmless; the stamp can move below the claim if wanted. (d) The ledger is NOT appended for this work yet: a peer's PR #216 (seq 274 to 278) and its stacked #217 (279 to 285) share the chain with this branch's 274 to 292; the order is agreed with the owner first, then this adds one `finding` (F-22), the `correction` for seq 291, the peer-review record, and the `pr_merge #218` line that the CLAUDE.md session asked me to carry (verified read-only with `gh` at 02:20Z: PR #218 merged 2026-10-02T02:17:18Z, merge commit `48460019`).

**Files** (in `audit/weather-direction-drift-2026-10-01/`, untracked): REPORT section 8.14 and V55 to V63; `evidence/harness/scn_heatfade.js`, `gen_heatfade.py`, `hf_*.py`, `run_hf_matrix.sh`, `run_hf_jacobian.sh`, `heat0_episodes.py`, `shots_colour.py`, `nightly_history.sh`; `evidence/runs/f22/` (compact episode exports of 18 runs, the nightly extract, verdict and history table, the HEAT0 summaries), `evidence/screenshots/f22_*` (three).
**Read-back after a fix is deployed** (not applicable yet): the nightly's MULT0_FRAME count on the first scheduled run, and on the dev site a zoom-out by steps from z8 to z4.4 with `__RAW_GPU__.opacity.mult` sampled per frame: no frame at 0 while a coarse base is held.

## 03:15Z to 05:42Z (2026-10-02) · the faded heat map (F-22) is FIXED in the client, ON by default (owner: "go, build the heat map fix")

**What landed.** One local commit on `claude/far-zoom-max-thinning`, `083fbd3c` (NOT pushed; built as three commits and squashed with the tree verified identical: the fix, the antimeridian guard, the review round). Client only, so no served number changes and no SCOREBOARD row (D-001 does not apply; D-014 records the decision). The engine's zoom-out BRIDGE (`shouldBridgeToCoarseGlobal`), its MIRROR (`shouldRejectSubcoveringRegional`) and the arbiter's rule 8 (`subcover_at_wide`) are now **base-aware**:
- a held base of **2.5 degrees or finer** (`marineCommitArbiter.isFineWorldBase`: the engine's own coarse-global grid, span 359 or more and a cell over 1 degree, with a cell of 2.5 or finer: the 2-degree world frame) is judged by **the display gate's own wide test** (`marineZoomOutGate.isGateWideView`: z <= 7 or an axis over 15 degrees; the layer now reads the same function) **or** the 40-degree ceiling's, whichever is wider, so an operator's tuned `__RAW_MARINE_GLOBAL_SPAN__` is never narrowed; a coarser (10-degree) base keeps the ceiling alone, which is the 07-22 trade (`06b3dbc2`) unchanged;
- in the band the ceiling used to leave (z <= 7 and span <= 40 degrees), the fine base is promoted only when it is the **same model and layer** as the resident and made for **the selected hour**: `marineStaleHour.isWorldGridForSelectedHour`, its valid time within a snapped step (1.5 h) of the instant the layer now publishes every frame as `engine.__selectedMs` (`marineStaleHourLayer.staleWorldDimMult`); an unknown hour fails CLOSED, because a promotion is a new action;
- **near the antimeridian** (a wrapped clip, west > east, or a view past +-180 degrees: `marineCommitArbiter.coverageWrapSafe`) the engine's coverage arithmetic has no longitude wrap, and the band keeps the old rule. A documented limit: the dip stays there.
- the engine's Phase-B shadow `arbiterDecide` context carries the same switch as `decideMarineCommit` (else every band reject would have logged an `arb_shadow_diverge`).
Kill: `window.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true` (the older `__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__` still wins). With the switch on, past the 40-degree ceiling, and for a 10-degree base, the behaviour is byte-identical to before. Production files: `marineCommitArbiter.js`, `marineCommitGate.js`, `marineZoomOutGate.js`, `marineStaleHour.js`, `marineStaleHourLayer.js`, `WebGLMarineCustomLayer.js` (one line), `WebGLMarineEngine.js` (two lines edited in place: 3,205 lines, the LOC baseline untouched).

**Why it is shaped this way (each point was a choice, and each has a test).** (1) *Why not restore the 15-degree rule for every base:* that is the `__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__` knob, 0.0% hidden in the diagnosis, and exactly what `06b3dbc2` removed for EURO (a ~5 s flash of a 10-degree frame over a covering 2-degree mid clip). The ceiling only has a job when the base is coarser than the clip. (2) *Why a promotion needs the selected hour:* F-21's dim starts at 3.5 h, so a base for the neighbouring 3-hourly step would have appeared at full strength where it used to be the faded wash; the first version did exactly that (a reviewer found it) and an unknown hour promoted too. (3) *Why the antimeridian steps aside:* found reading my own diff before any replay (LESSONS L-F15): the backend returns a Fiji-style clip WRAPPED (`marineBboxGeometry`) while MapLibre reports the view unwrapped (east 192); the engine reads it as covering 0, so the first version would have promoted the base over a covering clip and then rejected every clip as sub-covering until z > 7. (4) *Why the layer and the bridge share `isGateWideView`:* the 07-22 break was two readings of one test drifting; other readings of the same test remain (orchestrator, fetcher helpers, the rating-band fade, the guards' `wideView`, the arbiter's rule 6) and were not moved.

**How it was built and checked.** Test-driven: each group of tests was seen failing for the stated reason before its code. New tests: `marineBridgeGateInvariant.test.js` (the gate hides a clip <=> the bridge promotes, over 7 zooms x 8 spans x 8 coverages, plus the mirror and the arbiter in both modes, the hour and model rules, the antimeridian, a tuned ceiling, `isGateWideView` and `isFineWorldBase` tables), `.wiring.test.js` (the REAL layer swept over the same grid for GFS, EURO and ICON: the layer hides <=> the shared oracle <=> the real engine method promotes; an antimeridian view on the real layer; both F-21 switches on; the call-site pins), `.sequence.test.js` and one shared gate oracle `marineBridgeGateOracle.testutil.js`. The `src/components/map` folder: 211 suites / 2,282 tests green (was 208 / 2,237); `node scripts/check_eslint.js` and `scripts/loc_ratchet.py` clean. **The sweep:** 82,320 interleavings through BOTH commit modes with the real bridge in the loop (events: seven views including an antimeridian view and a span-only view, plain and rated clips, 2-degree world frames for the selected hour and for another hour; starts including a covering clip beside a fresh and a stale base): 19,494 bridge promotions (9,416 in the band, none for another hour), 19,123 stashes, 3,930 wrapped clips held beside a fine base (the antimeridian rule), 3,879 hand-backs (every one a rated clip over an unrated frame), **0 bounces, 0 wedges, 0 guard/arbiter divergence classes and 0 interleavings that end with a clip the gate hides beside a fine base for the selected hour**; with the switch on, **10,064 of them (12.2%) end that way** and the bridge never fires in the band (the positive control, asserted).. **Mutations:** 22 mutations of the final code (the switch off; no hour rule; an unknown hour failing open; a 3.5 h tolerance; no model/layer parity; the mirror or the arbiter ignoring a fine base; the threshold at 10 degrees; the layer's inline copy back; the kill switch ignored; the engine not passing, or the layer not publishing, the selected instant; the gate's wide test with the height axis dropped, `>=`, or zoom only; the cover fraction changed in the bridge; the wrap guard off; the ceiling's union dropped in the bridge and in the arbiter; a looser base definition; the shadow context and `decideMarineCommit`'s context without the switch) each turn between 1 and 16 named tests red (`runs/f22fix/mutation_f22_final.txt`); the first round of 12, before the review round, did too (`mutation_f22_round1.txt`)..

**Two independent reviews** (the owner's new plugins: `pr-review-toolkit:code-reviewer` and `pr-review-toolkit:pr-test-analyzer`, each read-only on the commit). Code review: the antimeridian blocker (already fixed), the shadow context, a base up to 3.5 h off drawn at full strength, an unknown hour promoting (should fail closed), a tuned ceiling narrowed, `isFineWorldBase` looser than the guard, stale comments ("the ONE copy"); one finding I did not remove: a RATED clip over an unrated base commits as a deliberate flavor switch and the bridge hands the base back once (below). Test review: the gate oracle was a transcription never checked against the layer (now a real-layer sweep), the sweep's `cols === 181` and missing positive control, a bounce detector that could not fire (mutants never made it non-zero; now hand-backs are classified), loose floors, no span-only view, no hour variation, no wedge check, no antimeridian case on the real layer. Every valid finding is in the commit.

**Offline A/B in two BUILT apps** (the commit before the fix, `befdb707`, against the fix; mock backend, NO live request; the owner's erratic-zoom pattern at 1280x800 plus a 390x844 mobile emulation; one run at a time; the harness now records the nightly's own whole-frame luminance `L` exactly as `zoomlab.js` computes it, so the nightly's verdict rules are scored on frames thinned to its ~1.25 s rate). Hidden = the layer gate hid the regional pass (`mult` under 0.5, stale-hour factor 1). `runs/f22fix/f22fix_ab_tables.txt` has every table; the compact episode exports are beside it.

| suite (trials; frames before / after) | frames hidden | episodes (median / max ms) | the nightly's rules at its rate: MULT0 / SETTLED_STEP (median, max over 5 sampling phases) |
|---|---|---|---|
| the owner's erratic zoom, 1280x800 (5 seeds x 25 s; 5,132 / 5,670) | 4.25% -> **0.00%** | 23 (175 / 805) -> 0 | 4 (7) / 0 -> **0 / 0** |
| deterministic zoom-outs from z7 to z3.6, 4.4, 5.0, 5.6, 6.2, eased 300 and 900 ms (10; 6,728 / 7,039) | 1.46% -> 0.37% | 5 (464 / 688) -> 2 (283 / 448) | 1 (2) / 0 (2) -> 0 / 0 (1) |
| erratic zoom, 390x844 phone emulation (3 seeds; 3,922 / 3,821) | 1.76% -> **2.70%** | 9 -> 10 | 1 (1) / 0 -> 3 (4) / 0 |
| zoom-outs, phone (4; 2,842 / 2,842) | 5.21% -> 4.96% | 3 -> 3 | 2 (3) / 0 -> 2 (2) / 0 (1) |

**By the class of the held base**, which is what decides whether the fix acts: with a 2-degree base for the selected hour (the fix's domain) the gate hid 4.25%, 1.14% and 1.79% of the frames of the erratic, zoom-out and phone-erratic replays before and **0.00% in all three after** (5,597, 6,687 and 1,109 frames). A base for ANOTHER hour (the page-load frame while a far hour is selected, before the F-21 world warm lands) is unchanged by design (7.40% -> 7.39% in the zoom-outs; 9.18% -> 8.76% on the phone), and so is a thinned 46x20 world-series base (an 8-degree lattice: the phone erratic run held it for 65% of its frames, 3.51% hidden, unchanged). **So on a 390-px map the hidden frames did NOT fall in these replays**: the held base was rarely the right 2-degree frame. The remaining 26 hidden frames of the desktop zoom-outs are the first trial, whose base was the page-load hour (Oct 1) while Oct 7 was selected.

Other measures, fixed against unfixed: after a promotion the viewport's clip was resident again in a median of 879 ms (38 promotions, 3 not within the trial) against 1,075 ms (32, 3), so the promotion does not hold the world frame longer; trials ending on the world frame 3 and 3; frame gaps over 100 ms per minute 81.2 -> 73.5 (erratic) and 8.5 -> 5.5 (zoom-outs), no cost. Whole-frame luminance steps between consecutive frames at 60 Hz (the nightly's `L`): at a promotion median 4.8, p90 22.7, max 28.1 (41 promotions) against 5.2, 19.6 and 26.6 for the unfixed build's own past-ceiling promotions, and 6.1 (max 22.5) for the clip commit that ended a hide: no new kind of step. The wrong-hour cells of F-21 (cold and warm x jump and wheel at a dwell of 800 ms, one at 2,500 ms; `scn_wronghour.js`): wrong hour at full strength 316 / 314 ms, 16 / 16, 322 / 324, 16 / 16 and 80 / 70 ms (unfixed / fixed), the right hour drawn after 3.6 / 3.6, 4.4 / 4.5, 2.2 / 2.2, 2.2 / 2.2 and 0.55 / 0.59 s: unchanged. Screenshots of the first hidden frame at z4.4 and the same instant promoted: `screenshots/f22fix_before_hidden_first_frame_z4.4.jpg` (a smooth wash, no crests) and `f22fix_after_promoted_first_frame_z4.4.jpg` (crests across the whole view).

**What the fix costs, stated.** The promoted frame is a world frame, drawn the way a world frame is drawn past 40 degrees: Florida-probe colourfulness 146 (the world frame) against 180 to 185 (a clip) and 117 to 123 (hidden), so the step when the clip commits is about 19% instead of 35% to 38%; the coastline carve is the world mask's (about 10 km a texel) until the clip commits (a median of 0.9 s later); faint rectangular seams can be seen in the promoted screenshot (cause not investigated). Each promotion forces a full mask rebuild (the escaped-mask recipe every past-ceiling promotion already uses; no measurable frame-gap cost). A rated clip over an unrated base is committed and then handed back once (older, see below).

**The limit of this fix, and the ONE thing I recommend next.** The fix acts only on a 2-degree base for the selected hour. The replays show the two ways the engine is NOT holding one: a base for another hour (a far hour picked before the F-21 world warm lands; the warm asks for the selected hour's world grid only once the hour has held still at a regional zoom, so a map browsed only at z5 to 7 would not get it from the warm) and a thinned 8-degree world-series frame that replaced the 2-degree base (the series page's frames are thinned to the vector budget and are captured as the base whenever one commits). Recommended, NOT built (the owner's word): **make the held base the exact 2-degree frame for the selected hour at every zoom of the band**: extend the world warm below the regional zoom, and do not let a thinned frame of the same hour replace a held 2-degree base. The nightly (hour 0, a 181-column world frame) is in the fix's domain; a phone-width map and a far hour picked just before zooming out are not.

**Found along the way, none of it changed by this fix.** (1) The arbiter's rule 7 (`tier_downgrade`) rejects a 10-degree world frame offered over a 2-degree world resident while the guard chain commits it (arbiter mode, off by default). (2) At a realistic 1.9-degree clip cell (the harness clips are 0.25) the guards stash and the arbiter commits a 2-degree world frame offered over a covering clip: 6 classes, 1,574 interleavings, arbiter mode only (a reviewer's measurement; both appear with the new switch on). (3) A rated clip over an unrated world frame commits (a flavor switch the mirror never holds) and, if the gate hides it, the bridge hands the base back once: one flip, not a loop, and the same past the 40-degree ceiling since 07-16; the sweep counts it (3,879 interleavings) and fails on any other hand-back. (4) The engine's coverage arithmetic has no longitude wrap, in the guards, the bridge and the arbiter: harmless at world zoom, a hazard in the band, and now pinned by `coverageWrapSafe`. (5) The arbiter's rule 8 does not look at `hourOffset` while the guard does (an undefined label: guard commits, arbiter rejects), older.

**Not tested.** The live app, and the nightly's first scheduled run after a merge (the acceptance, below). EURO and ICON on the real backend: the unit tests and the real-layer sweep run them with 2-degree and 10-degree bases, but whether their live world frame is 2 degrees is not established (the backend code builds `global_mid` for all three models; a 10-degree base keeps the old behaviour by design). The rating (surf) flavor: no rated grids in the mock; the unit sweep covers it. The antimeridian keeps the old rule (a limit, not a test gap).

**Dated corrections.** (a) The log's 02:05Z section says the ledger order dev -> #216 -> #217 -> this branch's lines was only relayed by a peer. It has since happened: #216 merged 02:21:51Z, #217 02:42:26Z, #219 03:43:27Z (`gh pr view`); `origin/dev` is `c4a59c01` and its ledger head is seq 293, a `pr_open` for #219 (read from git, not from the peers' notes; `pr_merge #219` is the next PR's to record, and #220 is open), `pr_merge #218` is dev's seq 286, so this branch's planned copy of that line is DROPPED. The owner's word on pushing is still what gates re-chaining my lines (a peer's note is data). (b) The `Ledger` paragraph of the 00:40Z section and STATE still say "nothing appended"; that remains true: this branch's F-22 finding, the seq-291 correction, the F-23 review record, this build's decision and its read-back commitment are prepared in `scratchpad/append_ledger_f22.py` and NOT appended: the owner has not answered the chain-order question, and dev's head keeps moving (seq 293 now, read from git), so they are re-chained after dev's head when the owner says to push.

**Read-back after a deploy.** (1) The Marine Nightly's `MULT0_FRAME` count on its first scheduled run after the merge: 2 or fewer (budget 2 findings in all, `SETTLED_STEP` included: the live 10-01 trace shows the pre-fix clip commit as a settled step of 13 to 14, under the 16 limit); `bridge` in its trace rises by one per zoom-out in the band. (2) On the dev site: zoom out by steps from z8 to z4.4 with `__RAW_GPU__.opacity.mult` sampled per frame: no frame at 0 while `__RAW_GPU__.blendBoth.haveCoarseBase` is true and the held base is for the selected hour; `__MARINE_ZOOMOUT_BRIDGE__.count` goes up by one per zoom-out through the band; `window.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true` plus a reload restores the old frames for an A/B in the same browser. (3) `__RAW_ARBITER_SHADOW__.disagree` stays at 0 in guard mode.

**Files.** In the repo (commit `083fbd3c`): the production files above, the three new test files and `marineBridgeGateOracle.testutil.js`, `WebGLMarineEngine.baseHourSync.test.js` (its call-site pin takes the new argument). Docs: this entry, STATE, DECISIONS D-014, LESSONS L-F13 (mechanized), L-F14, L-F15. In `audit/weather-direction-drift-2026-10-01/` (untracked): REPORT section 8.15, `evidence/harness/run_f22_ab.sh`, `f22_ab_summary.py`, `scn_heatfade.js` (viewport and whole-frame `L` added), `evidence/runs/f22fix/`.
