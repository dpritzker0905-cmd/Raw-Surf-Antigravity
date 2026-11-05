# 2026-11-05 · claude · RATING_WIND_HRRR rework: nearest HRRR sea cell (FAIL, stays '0')

Branch `claude/rework-rating-wind-hrrr-sea` = #711 (`claude/rating-wind-hrrr`) + `origin/dev` (merge e0b6da2a). Draft
PR #728. One writer: this session. Authority: the owner via the lead's round-7 rework brief (2026-11-04), and the
owner's "Yes" to running the scoring on GitHub Actions on the draft PRs. Never touched: the live backend, Render,
Netlify, env, secrets, main, Codex's branches.

## What was tested (pre-registered before any scoring, commit 4923754b)

`docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/rating-wind-hrrr-sea-preregistration.md`.
Hypothesis: #711's lane lost to Open-Meteo's `gfs_hrrr` (+0.22 vs +1.27 rating pts) because the lane averages LAND
cells into a pier's wind, while Open-Meteo picks the cell whose elevation matches the request (a sea cell).

- A1 `sea_nearest`: the native 3 km HRRR cell with LAND == 0 nearest the spot (<= 10 cells).
- A2 `sea_bilinear`: the 2x2 stencil with land weights dropped, renormalised.
- Reference: #711's served lane (production `Lane` + `sample_point` built from the same messages).
- Baseline: the served GFS pgrb2 10 m wind, same 6-hourly cycle, fh 1..6, production `PointSampler`.
- Every arm: the lane's feather, time weight and `wind_lane.blend_vector`. Marine: GFS-Wave AWS, same for all arms.
- Truth: the chain graded with the NDBC anemometer wind (L6's 7 stations). Windows W1 2024-12-01..28, W4
  2025-10-01..28, W26 2026-10-17..30.
- Gate: D-066 two-way block x day (`eval_twoway.two_way_ci`), Holm across A1/A2 on the gain, Holm at 0.05 on
  "worse" across season, region and #711's 9 wind regimes; null / x0.8 / x1.25 controls.

## Where it ran

`.github/workflows/rework-score-hrrr.yml` on PR #728: 10 extract jobs (NOAA AWS HRRR + GFS + GFS-Wave), 3 truth jobs
(NDBC), one gate job. First run 41938532670 (head cea6dff6). 283 cycles extracted, 0 failed.

## Result

n = 8,347 station-hours, 70 UTC days, 6 blocks (mavericks + obsf share one).

| arm | gain (rating pts, + = better than GFS) | two-way 95% CI | p (one-sided) | worse after Holm | verdict |
|---|---|---|---|---|---|
| A1 sea_nearest | -0.02 | [-0.78, +0.74] | 0.52 | none | **FAIL** (gain not significant) |
| A2 sea_bilinear | -0.13 | [-1.12, +0.85] | 0.61 | none | **FAIL** |
| lane (reference, #711) | +0.32 | [-0.59, +1.23] | 0.24 | none | FAIL (reference) |

Advisory (never decides): MAE 8.53 -> 8.55 (A1) / 8.66 (A2) / 8.21 (lane); level-miss 44.5% -> 45.0% / 45.9% /
44.8%; vector RMSE vs the anemometer (obs >= 3 m/s) 3.32 / 3.35 / 3.09 m/s; speed slope 1.00 / 1.03 / 0.94.
Per station, A1: galveston +0.81, obsf +1.11, mavericks +0.43, torrey 0.00; duck -0.51, wrightsville -0.76,
cocoa -0.40. No stratum is worse after Holm for any arm (closest: A1 region=east p_worse 0.030, A2 0.043, both above
the Holm threshold).

Coverage (pre-registered: a row needs truth): LJPC1 (torrey) and 46012 (mavericks) have no wind in the NDBC archive
for W1 and W4; 46026 (obsf) none in W1. So W1 and W4 are East + Gulf + (W4) obsf only; W26 has all 7.

**Controls.** The first run's null control read FAIL (CI [0, 0]) instead of REFUSED: the scorer built the null as
`truth + 1.0 x (gfs - truth)`, which is not bit-identical to `gfs`, so 5,366 rows counted as "moved" by rounding.
That is a scorer bug against the pre-registration (null = cand = gfs), not a property of any arm: the arms' numbers
do not depend on the controls. Fixed (`control_fn`, regression test `test_scorer_null_control_is_the_baseline_bit_for_bit`)
and the gate re-run on the cached inputs; see the PR comment for that run's controls (null REFUSED, x0.8 PASS, x1.25
FAIL expected). The x0.8 and x1.25 controls behaved in the first run (PASS [0.93, 2.48], FAIL [-3.11, -1.16]).

## Diagnosis

- **The sea-cell hypothesis is refuted for NOAA HRRR.** Sampling water cells moves the wind closer to the
  anemometer's speed (slope 0.94 -> 1.00) but the vector error gets WORSE (3.09 -> 3.32 m/s) and the rating does not
  improve. A plausible reason, NOT measured here: at a barrier coast the nearest water cell may be sound or lagoon
  water (Currituck Sound at Duck, the Banana River at Cocoa) rather than the ocean the pier stands in, so "the
  nearest sea cell" is not the right water. An ocean-side-only cell would be a NEW pre-registration.
- **The lane itself is still no better than GFS on history** (+0.32 [-0.59, 1.23]), consistent with #711's fresh
  window (+0.22). Open-Meteo's `gfs_hrrr` advantage (+1.27 on #711's window) therefore comes from something other than
  land/sea cell choice: rotation (ruled out in #711), the area mean (ruled out), and now the sea cell (ruled out).
  Remaining candidates, not tested here: Open-Meteo's own downscaling/interpolation of HRRR, its 15-minute HRRR
  sub-hourly fields, or a different HRRR run selection (it serves the latest run, leads 0-1 h, where the lane uses
  1-6 h).
- The east coast (the piers) is where every HRRR arm is weakest; the gulf and west gain. A per-region or
  per-station lane would be a NEW pre-registration, not a re-cut of this one.

## What this PR therefore is

Dark code plus evidence: `rating_wind.sea_sample` / `sea_wind` (tested, not served), the offline scorer and its
workflow, the pre-registration and this record. `RATING_WIND_HRRR` stays `'0'` in code and in every lane; no served
number moves, so no SCOREBOARD row and no DECISIONS entry. Tests: `tests/test_rating_wind_hrrr_sea.py`, 16 (guards
lane); floor `rederive_floor.py --lane guards --add 41 --add-files 2` (#711's 25 + 16), guards must read 3562.
