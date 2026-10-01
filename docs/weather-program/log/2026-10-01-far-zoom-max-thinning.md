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
