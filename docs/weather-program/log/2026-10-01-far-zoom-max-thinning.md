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
