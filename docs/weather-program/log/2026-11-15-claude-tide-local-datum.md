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
