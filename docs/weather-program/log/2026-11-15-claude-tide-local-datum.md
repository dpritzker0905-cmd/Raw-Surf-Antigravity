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
