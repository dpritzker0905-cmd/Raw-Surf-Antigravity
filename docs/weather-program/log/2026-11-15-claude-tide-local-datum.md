# 2026-11-15 - Tide local datum (TIDE_LOCAL_DATUM), claude session tide-overlay-cf8266

Owner, in session (13:19 EST): do the "Tide height datum: fix the 0.3-0.5 m MSL offset" task here. At 13:3x EST, asked
where the fix goes, the owner chose **"At the source"** (over "display only" and "NOAA station offsets").
Also 13:21 EST: "the meters vs foot button for wave heights should also be working for tide heights too" - done in
PR #923 commit `74d8fde22` (the infobox Tide row was always ft, the hub chart always m).

## Finding (measured first)
Open-Meteo `sea_level_height_msl` (our ONE tide source) vs NOAA CO-OPS harmonic predictions on each station's MSL
datum, hourly GMT, 14 days 2026-11-08..22 (7 past + 7 ahead), 25 stations (Boston returned no overlap).
Script: `backend/scripts/tide_datum_vs_coops.py` (public read-only GETs; nothing touches Render).

- The model level sits a **stable per-place offset** from local MSL: +0.53..0.54 m at all four Hawaii stations,
  +0.36..0.45 m US West Coast, +0.49 Neah Bay, -0.45..-0.51 m Northeast, -0.47/-0.45 Carolinas, -0.40 Fernandina,
  -0.14..-0.24 m Florida/Gulf, +0.05 Galveston, +0.36/+0.37 Caribbean. Daily sd median 0.048 m. The Pacific-high /
  Atlantic-low sign pattern is the mean dynamic topography: the model's "msl" is a GLOBAL reference.
- Shape is good: r 0.82-0.98 (Pensacola 0.65, diurnal + small range), range ratio 0.95-1.34.
- Candidates scored against CO-OPS MSL (RMSE, median / p90 / max over 25 stations):
  raw 0.459 / 0.547 / 0.617; **de-meaned over the served 72 h series 0.117 / 0.213 / 0.316**; de-meaned over 7 days
  0.111 / 0.242 / 0.321 (better at only 8/25); per-station offset fitted week 1, scored week 2: 0.100 / 0.234 / 0.346.

## Reach (why "at the source" matters)
`SURF_TIDE_DEPTH` is ON: `point_surf_augment` threads `tide_norm_at(...).height_m` as eta into the depth-limited
breaking cap. The biased level made Hawaii's water ~0.54 m deeper and the Northeast's ~0.5 m shallower at every
hour, so wherever the cap binds the served surf height carried it (cap shift = gamma x d(eta): Oahu 0.81 x 0.54 =
0.44 m). Fixing only the display would have left the physics on the biased level and the infobox's Tide row (from the
rating) disagreeing with the tide block beneath it.

## Change
- `tide.to_local_datum` (PURE) + `local_datum_offset`: minus the mean of the first 72 h (>= 48 finite hours, else the
  model level is served and labelled `model_msl`). Applied once in `fetch_tide_hourly`, the door every consumer uses:
  `/api/weather/point-tide` (now also reports `datum_basis`, `datum_offset_m`), `/tides/{id}`, the rating's tide, eta.
- `eval_replay._local_datum_window`: the replay twin (72 h from 00Z of the valid day), so the history filter and the
  6-hourly guardrail see the arms differ. `flag_guardrail.COVERAGE` declares it REPLAY.
- Client fallback `tideClient.ensureTideState` (browser-direct Open-Meteo, glyph card): same rule (`toLocalDatum`),
  now 3 days; kill `window.__RAW_DISABLE_TIDE_LOCAL_DATUM__`.
- Flag `TIDE_LOCAL_DATUM` GUARDED, code default '1' (D-065), registered in `_RATING_FLAGS`. `surf_forecast.py` was at
  the 800-line cap: its stale pre-entry comment for SURF_TIDE_DEPTH ("DEFAULT OFF ... NO SERVING CALLER SUPPLIES A
  WATER LEVEL YET", false since D-065) was replaced by one accurate line.

## Not changed
Timing, trend, extrema and the rating's normalized tide position (affine-invariant): pinned by tests. Labels already
say "mean sea level"; they are now true locally.

## Gate (pre-registered here, before the PR)
1. Unit: offset math, gaps, <48 h fallback, kill switch, timing/trend/norm invariance, reach through
   `fetch_tide_hourly` into `tide_norm_at` (eta), replay twin == production. Mutation (no subtraction) must turn it red.
2. Existing suites touching tide, replay, flags, guardrail: no regression.
3. History filter (`default-on-filter.yml`, runs on the PR): must not be significantly WORSE (it may read inert: buoys
   are offshore, the cap binds rarely).
4. Displayed tide vs CO-OPS: the measurement above (median 0.459 -> 0.117 m).

## Results
1. PASS: `test_tide_local_datum.py` 7/7; mutation (`v - 0`) -> 3 red.
2. PASS: 43 backend test files referencing tide/replay/flags/guardrail: 951 + 24 passed after declaring COVERAGE
   (the only failure was the guardrail's "every guarded flag declares what can see it"). Frontend tide/client/kill
   suites 57/57. flake8 gate clean; file sizes under 800.
3. Pending: runs on the PR.
4. As measured above.

## Advisor red-team follow-up (2026-11-15 ~21:30Z) - PRE-REGISTERED before the run below
The advisor (PASS WITH LIMITS, notes `redteam-926-923-tide-2026-11-15.md`) asked for three gaps closed. Corrections first:
- Gate 3 "Pending" -> **SKIPPED**: the filter's verdict line on the PR is `TIDE_LOCAL_DATUM | SKIPPED | no cached history
  window: the replay did not run`. Neither the history filter nor the 6-hourly guardrail can see a wrong eta at a surf
  spot (buoys are offshore; the cap binds on ~1.7% of spot-hours). The eta evidence is the station comparison alone.
- "replay twin == production" was too strong: they are equal only for leads under 24 h (the replay anchors at 00Z of
  the VALID day, production at 00Z of the SERVING day), as the code comment says. The unit test pins the lead-0 case.

Run (`backend/scripts/tide_datum_observed.py`): 27 CO-OPS stations (the 25 + Anchorage 9455920 + Eastport 8410140), the
7 past days scored against OBSERVED water level (`water_level`, MSL, preliminary, on the hour); offsets fitted on the
14 days before. Arms: raw model; demean72 (production: 72 h from 00Z); demean74.5 (74.5 h = 3 lunar days = 6.00 M2
cycles, from 00Z, needs a 4-day fetch); fitted offset (median model - observed over the prior 14 days; US-only, a
yardstick, not shippable worldwide).
Pass lines, written before the run:
- **P1 keep de-meaning:** the shipped window's median RMSE vs observed is below raw's median AND within 0.03 m of the
  fitted-offset yardstick. If it fails the first, TIDE_LOCAL_DATUM is set to '0' in this PR.
- **P2 does the model carry surge:** r between the 25 h low-passed (model raw - prediction) and (observed - prediction)
  per station; median r >= 0.5 = "carries surge", < 0.3 = "does not", else "weakly".
- **P3 day-roll step** (offset of day d+1 minus day d, |m|, every station-day): accept the window if median <= 0.03 m and
  p90 <= 0.06 m. **Switch to 74.5 h** if it cuts the median step by >= 30% and its P1 RMSE is not worse by > 0.01 m.

## Results of the pre-registered checks (run 2026-11-15 ~21:40Z, `tide_datum_observed.py`; raw JSON in notes
`datum-observed-P1-P3.json`). 26 stations scored (Galveston returned no observations); 7 past days vs OBSERVED water.
| median RMSE vs observed (p90, max) | raw | demean72 (shipped) | demean74.5 | fitted offset (yardstick) |
|---|---|---|---|---|
| m | 0.456 (0.712, 1.278) | 0.346 (0.579, 1.329) | 0.346 (0.575, 1.322) | 0.120 (0.389, 1.247) |
- **P1: FAIL.** demean72 is below raw at the median (first clause met, so by the registered rule the flag is NOT set to
  '0'), but 0.226 m worse than the yardstick (second clause failed). Worse than raw at 9/26 stations: the whole US West
  Coast (La Jolla 0.122 -> 0.469, Monterey 0.115 -> 0.440, Neah Bay 0.414 -> 0.579), the Caribbean and Anchorage. THE
  ADVISOR WAS RIGHT: on the West Coast the real water ran ~0.4 m above the station datum this season and the raw model
  carried it; the 72 h mean removed real water, and scoring against predictions had called that a gain.
- **P2: the model CARRIES surge.** Median r = 0.958 between the 25 h low-passed (model - prediction) and (observed -
  prediction); 24/26 stations r >= 0.9. (Observed non-tidal sd 0.02-0.19 m.)
- **P3: FAIL on p90.** Day-roll step demean72: median 0.020, p90 0.080, max 0.178 m (n = 364 station-days); demean74.5:
  0.019 / 0.074 / 0.167 m. 74.5 h cuts the median by 5% (< 30%): no switch.

## Exploratory (NOT pre-registered; chosen after seeing the above): the model's own 1-year mean as the datum
`tide_datum_climatology.py`, raw JSON `datum-climatology.json`: per cell, the mean of the model over the 365 days BEFORE
the scored week (out of sample), subtracted from the raw level. Median RMSE vs observed **0.211 m** (p90 0.391), beats
demean72 at 23/26 and raw at 21/26, gives back little on the West Coast (La Jolla 0.169 vs raw 0.122), and has NO
day-roll step (a fixed number per cell). It removes only the model's permanent offset (Hawaii +0.57, Northeast -0.50 m)
and keeps real seasonal and surge water. Because it was selected after the fact, it needs a fresh held-out week and
the owner's word before it replaces demean72; proposed gate in the reply to the advisor.

## 2026-11-15 ~22:50Z: decisions after the observed-water results + the SOTA research
- **TIDE_LOCAL_DATUM is now held OFF (code default '0')** in this PR: the advisor's verdict on merging demean72 is
  FAIL (served-number regression on the whole US West Coast, displayed tide and eta). With it off the served level is
  today's raw model, the status quo. The client fallback mirrors it (`window.__RAW_ENABLE_TIDE_LOCAL_DATUM__`).
- **Datum check (advisor 4), `tide_datum_check_obs.py`:** CO-OPS preliminary `water_level` honours datum=MSL: the mean
  observed MSL - MLLW gap equals the published MSL - MLLW (mdapi datums) exactly at La Jolla 0.832, Honolulu 0.251,
  Anchorage 5.020, Sandy Hook 0.785 m. Mean observed - predicted this week: La Jolla +0.405, Monterey +0.372, Crescent
  City +0.313, Sandy Hook +0.245, Lake Worth +0.201, Anchorage +0.248, Charleston +0.085, Honolulu +0.044 m: the water
  really is above the station datum, most on the West Coast.
- **SOTA research** (sota-researcher, notes `tide-datum-sota-2026-11-15.md`): operational datums are station-anchored
  where stations exist (VDatum); elsewhere a static geoid-referenced MDT (CNES-CLS22, 1993-2012); display = astronomical
  tide, physics = still water (tide + surge) - two levels; a model-mean datum needs >= 12 complete months, 19-20 years
  preferred. Open-Meteo's marine archive starts ~2022-12 (probed: 2022-12-01 has data, 2022-10-01 none).

## PRE-REGISTERED (before the run): held-out test of the long-term model mean as the datum
Script `backend/scripts/tide_datum_heldout.py`. 26 CO-OPS stations x 4 held-out weeks (7 days from 2025-12-15,
2026-03-15, 2026-06-15, 2026-09-15), each scored against OBSERVED water (`water_level`, MSL, on the hour). Arms:
raw; demean72; **clim1y** = raw minus the model's mean over the 365 days before the week; **climAll** = raw minus the
model's mean over 2022-12-01 .. the week (the whole archive, ~3-4 years); yardstick = raw minus median(model -
observed) over the 14 days before the week (US-only, not shippable).
Pass lines (advisor's, per candidate), on station-week RMSE:
- **H1** median below raw's median AND below demean72's median;
- **H2** at every US West Coast station (La Jolla, Los Angeles, Monterey, Point Reyes, Crescent City, South Beach, Neah
  Bay) the candidate's 4-week median RMSE is not worse than raw's by more than 0.05 m;
- **H3** median within 0.10 m of the yardstick's median.
Choice: a candidate that passes all three replaces demean72 in this PR (ON); if both pass, **climAll** ships (the
research: longer is better); if neither passes, TIDE_LOCAL_DATUM stays OFF and the served level stays raw.
Reported alongside (advisor's additions, not gating): per station-week the max |observed non-tidal| (25 h low-pass of
observed - predicted); P2 median r over TESTABLE station-weeks only (max >= 0.10 m; "not answered" if < 5); P2b on hours
with |observed non-tidal| > 0.15 m, RMSE of demean72 vs the chosen candidate vs the yardstick; the 72 h day-roll step
per station incl. Anchorage and Eastport (either alone > 0.10 m would have counted toward a 74.5 h switch; moot while
demean72 is off).

## Held-out result (run as registered above; raw JSON notes `datum-heldout.json`)
103 station-weeks (Anchorage 2026-03-15 had 18 observed hours: excluded by the rule). Median RMSE vs OBSERVED water:
raw 0.414 · demean72 0.180 · **clim1y 0.177** · climAll 0.181 · yardstick 0.127 m.
- **clim1y: PASS** - H1 (0.177 < 0.414 and < 0.180), H2 (West Coast 4-week median minus raw: Neah Bay -0.007, Point
  Reyes +0.014, Los Angeles +0.014, Crescent City +0.001, Monterey +0.015, South Beach -0.001, La Jolla +0.003 m; all
  <= 0.05), H3 (0.050 <= 0.10).
- **climAll: FAIL on H1** (0.181 vs demean72 0.180), passes H2/H3. By the registered choice rule **clim1y ships** and
  replaces demean72 in this PR, ON. (Over these four weeks demean72 itself did well, 0.180: its West Coast failure in
  November is the season's anomaly, which the 1-year mean keeps.)
- P2 (advisor's addition): 38 testable station-weeks (observed non-tidal max >= 0.10 m): **median r 0.925**, the model
  carries surge. P2b, surge hours (|observed non-tidal| > 0.15 m, 25 station-weeks): demean72 0.297, climAll 0.294,
  clim1y 0.284, yardstick 0.244 m: demean72 is 0.053 m worse than the yardstick there (> 0.05: the 72 h stop-gap
  under-reads surge, as the advisor expected; it no longer ships). clim1y keeps more of it (0.040 m worse than yardstick).
- P3 per station is moot: clim1y is one fixed number per cell (no day-roll step); the yearly table refresh moves it by
  the drift of a 365-day mean (tiny, weekly).

## Built (2026-11-15 ~23:10Z): the 1-year model mean replaces the 72 h de-mean in this PR, ON
- `services/weather_pipeline/tide_datum.py`: reads `tides/model_datum.json` (6 h cache, 5 min failure cooldown); exact
  0.1-degree cell, else the nearest table cell within 0.5 degree, else None. `tide.fetch_tide_hourly` subtracts it
  (`to_local_datum(series, offset)`, datum `local_msl_1y`); no entry / storage failure / kill -> the model level as
  today (`model_msl`). The 72 h code, its replay twin and the client-side de-mean are removed (the browser cannot
  read the table; #931 retires that fallback); this PR no longer touches the frontend.
- `scripts/tide_datum_ingest.py` + `.github/workflows/tide-datum.yml` (daily 04:41Z, off switch repo var
  TIDE_DATUM_INGEST=0): the catalogued spots' cells, 365-day mean, >= 330 days of hours required, rolling refresh
  (missing first, then older than 7 days, <= 300 cells a run).
- Guardrail coverage BLIND (no table offline, buoys offshore): the evidence is the held-out test above.
- Tests `test_tide_local_datum.py` 9 (mutation: no subtraction -> 3 red); tide/flag/guardrail suites 144 passed.
- **After merge:** the table is empty until the first `tide-datum.yml` run (dispatch it, then again over ~5 days or
  with a larger limit to cover every cell); until a cell has an entry it serves the model level, unchanged.

## Limits (advisor re-check, PASS WITH LIMITS, 2026-11-15 ~23:40Z)
- On the four held-out weeks the de-meaning arms differ by 0.001-0.004 m (72 h 0.180, 1-year 0.177, all-archive
  0.181): the choice of the 1-year mean rests on the registered rule, the November week (where 72 h failed the whole
  West Coast) and having no day-roll step, NOT on the held-out medians themselves.
- Rollout is mixed until the table fills: a cell with no entry serves the raw model level, which can sit up to ~0.5 m
  from a neighbouring corrected cell. At merge, dispatch `tide-datum.yml` wide (a larger --limit, or several runs) so
  every spot cell has an entry before users compare neighbours.
- #926 alone leaves the glyph card's browser-direct fallback (`tideClient.ensureTideState`) on the raw level beside a
  corrected infobox; #931 retires that fallback (`glyphTide.js` reads the door). Merge #926 together with #931.

## OWNER DECISION 2026-11-15 18:14 EST ("Yes, before merge", in the senior research lead's session, relayed by the
director) and the change it made
#926 serves a FIXED long-term datum: the model's own `sea_level_height_msl` mean over the 365 days before the table
build (the series family `tide_datum_climatology.py` reads), a static per-cell asset rebuilt at most monthly
(`tide-datum.yml`, --max-age-days 30). /point-tide reports `datum_basis = "model_mean_365d"`. Where no datum exists:
the 72 h de-mean, `datum_basis = "window_72h"`; the ingest's summary counts the spots on that fallback
(`spots_on_window_72h_fallback`). TIDE_LOCAL_DATUM stays the kill switch; eta stays relative to local MSL. MLLW display
is NOT in #926 (the CO-OPS PR's follow-up).

## PRE-REGISTERED (before the rerun) - the owner's gate (a)-(d)
Script `backend/scripts/tide_datum_gate_fixed.py`. The same 25 CO-OPS stations as the first check (IDS of
`tide_datum_vs_coops.py`; Boston 8443970 returned no data then and is reported if it fails again). Window: the 14 UTC
days before today 00Z. Arms: **A72** = raw minus the mean of the 72 h window from 00Z of each day (the fallback);
**M365** = raw minus the model's mean over the 365 days before the window. Truth: (a) CO-OPS harmonic PREDICTIONS (MSL,
hourly); (b)-(d) CO-OPS OBSERVED water (`water_level`, MSL, on the hour). Per-station 95% intervals: day-block bootstrap
(resample the 14 days with replacement, 1000 draws, seeded).
- **(a)** median over stations of RMSE vs predictions: M365 minus A72 <= +0.01 m.
- **(b)** per station d = RMSE(M365) - RMSE(A72) vs observed; the station counts when the 95% interval's upper bound < 0;
  PASS when >= 60% of the scored stations count.
- **(c) negative control:** 200 seeded random derangements give each station another station's 365-day mean; PASS when
  the swapped arm's median RMSE vs observed exceeds BOTH A72's and M365's medians in >= 95% of draws (>= 190).
- **(d) positive control:** M365 shifted by +0.10 m vs M365, same bootstrap; DETECTED when the 95% interval of the RMSE
  difference excludes 0 at >= 80% of stations, and the mean signed error moves by 0.100 +- 0.005 m at every station.
Also recorded: the 0.211 vs 0.346 m reading (7 days, 26 stations, vs observed) is restated with its truth defined.
Outcome rule: all four pass -> #926 is ready as built (M365 ON, A72 fallback). Any failure is reported to the owner
before merge; nothing is flipped automatically.

## Owner's gate (a)-(d): RESULT (run as registered above; raw JSON notes `datum-owner-gate-a-d.json`)
Window 2026-11-01 .. 2026-11-15 (14 days). 24 stations scored; Boston (no model history at its cell) and Galveston (no
observations) failed to load.
- **(a) FAIL.** vs CO-OPS PREDICTIONS: median RMSE A72 0.132, M365 0.197 m (+0.065 > +0.01).
- **(b) PASS.** vs OBSERVED water: median A72 0.335, M365 0.193 m; M365 beats A72 with the 95% interval below 0 at
  22/24 stations (Honolulu tie [-0.003, +0.007]; Nawiliwili A72 better [+0.014, +0.025]).
- **(c) PASS.** Negative control: the label-swapped datum lost to both arms in 193/200 draws.
- **(d) PASS.** Positive control: the +0.10 m datum shift detected at 24/24 stations; the mean signed error moved by
  exactly 0.100 m at every station.
- ALL_PASS: false -> per the rule, reported to the owner before merge; nothing flipped.
Reading of (a) vs (b): the two truths disagree by construction. Predictions are astronomical tide only; M365 keeps the
real non-tidal water (US West Coast this month: observed - predicted +0.31..+0.41 m), so it MUST read worse against
predictions exactly where it reads better against what the water did (La Jolla: vs predictions A72 0.125 / M365 0.306,
vs observed A72 0.452 / M365 0.173). A72 scores well against predictions because it removes that water too. For the
displayed tide AND eta the target is the water the surfer stands in, i.e. (b). Restated with its truth: the earlier
"0.211 vs 0.346 m" (7 days) and this "0.193 vs 0.335 m" (14 days) are RMSE against OBSERVED water.

## OWNER DECISION 2026-11-15 19:11 EST on the failed gate (a)
Asked in session: "Your check (a) failed. Does #926 still merge with its fixed datum?" Owner: **"Yes, merge with it."**
So #926 ships with the fixed 365-day datum despite (a), on the reading above: (a) scores against astronomical
predictions, which the fixed datum must miss wherever the real water departs from them; (b)-(d) pass against observed
water. The merge itself stays with the director, after hosted CI is green on the head.

## Correction (2026-11-16 01:11Z): header times written ahead of the clock (LESSONS L-P10)
These headers carried an ESTIMATED time later than the moment they were written; the true times are the commit
times below. The order of registrations and results is unchanged (each registration's commit precedes its run's).
- 'Advisor red-team follow-up (2026-11-15 ~21:30Z) - PRE-REGISTERED before the run below' -> written 2026-11-15T21:19:08Z
- 'Results of the pre-registered checks (run 2026-11-15 ~21:40Z, `tide_datum_observed.py`; raw JSON in notes' -> written 2026-11-15T21:31:37Z
- '2026-11-15 ~22:50Z: decisions after the observed-water results + the SOTA research' -> written 2026-11-15T22:36:24Z
- 'Built (2026-11-15 ~23:10Z): the 1-year model mean replaces the 72 h de-mean in this PR, ON' -> written 2026-11-15T23:00:30Z


## Rollout order (advisor's last open condition on #926) - OWNER DECISION 2026-11-15 20:46 EST
The table is empty at deploy and fills <= 300 cells a run; with the 72 h fallback that would have served EVERY spot the
72 h de-mean for days (La Jolla 0.452 vs fixed 0.173 m vs observed). Asked in session with three options, the owner
chose **"Raw until first fill"**: `tide_datum.table_ready` - the 72 h fallback applies only once the table holds cells;
before the first build, or when the table cannot be read, every spot keeps today's raw level (`model_msl`). After the
fill the owner's fallback rule applies as decided. Test: empty table -> raw; built table, uncovered cell -> window_72h;
storage down -> raw. OWED after the fill: how many spots stay on the window fallback for good (cells without 330 days
of archive) and where (the ingest's `spots_on_window_72h_fallback`).
- **Refined (advisor, at d3ac967ff): "until the fill is COMPLETE", not "any cell".** The ingest now records every
  attempted spot cell (a too-short archive is stored with `mean_m: null`: attempted, never served, retried monthly)
  and sets `complete: true` (+ `completed_at`) once every spot cell is in the table; `table_ready` reads that marker.
  So after the first 300-cell run, the cells built serve their fixed datum and every other spot stays raw - none drops
  onto the 72 h fallback until the first full fill is done. Test: a partly filled table without the marker serves raw
  for an uncovered cell and the fixed datum for a covered one.
