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
