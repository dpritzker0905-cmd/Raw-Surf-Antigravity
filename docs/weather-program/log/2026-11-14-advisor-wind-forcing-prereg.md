# 2026-11-14: wind forcing for the surf rating, pre-registered offline test (advisor)

Append-only. Docs plus one offline script. No code path, flag, served number, workflow dispatch or live backend call.
Asked by the director (session local_d6b521eb) on 2026-11-13 21:34 EST, as the gap Reflection flagged on the
state-of-the-art path (#866). All times UTC.

## 1. Pre-registration, written 2026-11-14 02:37Z, BEFORE any row or result was read

**What I had seen when this was written.** The published wind-vector RMSE table of the wind-lane fit (log
2026-11-12-claude-wind-lane-skill-weights.md: HRRR's lane is worse than GFS in the west at every lead, the blend beats
both in 8 of 8 cells). I had NOT opened the row file and had computed no rating from any row. The hypotheses below are
therefore informed by the wind result and are not blind to it; what is untested is whether a wind error of that size
moves the surf RATING, which nobody has measured.

**Question.** Which wind should the surf rating read as its primary input on each coast: GFS, HRRR, or ECMWF?

**Data, existing and local only.** The matched rows written by `backend/scripts/grade_wind_lane_ndbc.py --rows`
(2026-11-11 run, 100 HRRR cycles 2026-10-15 00Z .. 11-08 18Z, leads 3/12/24/36 h, about 38,700 rows, on this machine
outside the repo). Each row: buoy id, coast (WMO prefix), zone, coastal flag, cycle, lead, the buoy's observed wind
adjusted to 10 m, and three forecasts at the buoy: `gfs`, `raw` (HRRR alone) and `lane` (the HRRR lane as drawn today).
Rows with zone = "full" only (space weight 1), as in the fit.

**Arms.**
- G: GFS. H: HRRR alone (`raw`). L: the lane as drawn today (`lane`).
- B: the skill-weight blend, `w*lane + (1-w)*gfs` on speed with the bearing from the blended vector, w from
  `wind_lane_skill_weights.json` (west 0.4/0.3/0.2/0.2, east 0.5/0.6/0.5/0.5 at 3/12/24/36 h). Those weights were
  fitted on the ODD cycles of this same window, so B is scored on the EVEN cycles only ((day of month + cycle hour / 6)
  even), and any comparison with B uses the even cycles for every arm.
- E: ECMWF. **Not in the rows and not on this machine: UNTESTABLE here, whatever else is found.** It needs ECMWF
  open-data 10 m wind matched to the same buoys and hours (a public-archive fetch), which this brief does not allow.

**The rating, from the real chain.** `surf_rating.compute_surf_rating(surf_h_m, tp_s, wind_speed_ms, wind_from_deg,
shore_normal_deg, swell_from_deg=shore_normal_deg)` imported from the repo, everything else at its default. For each
row the rating is computed with the buoy's observed wind (the reference) and with each arm's wind, for a FIXED grid of
3 surf states x 8 shore normals: (1.0 m, 10 s), (1.5 m, 14 s), (2.5 m, 12 s); shore normal 0, 45, .. 315 degrees, swell
head-on. Only the wind differs between the reference and an arm, so every rating difference is a wind effect.

**Metrics, per row then averaged.**
- M1 (primary): mean over the 24 grid cases of |rating(arm) - rating(observed wind)|, in rating points (0-100).
- M2: share of the 24 cases where the arm's LEVEL (very_poor .. epic) equals the observed-wind level.
- M3: share of rows whose wind class (offshore / cross-shore / onshore, `spot_ratings.wind_relation`) matches the
  observed class, for a coast-facing normal (west 270, east 90, Gulf 180), rows with observed wind >= 4 kn only.
- M4: the blown-out gate (`surf_rating.wind_gate` < 1) under the observed wind against under the arm, same
  coast-facing normal: miss rate and false-alarm rate.
- Secondary M1c: M1 with the coast-facing normal only (sea-breeze errors are orientation-specific).

**Cells.** coast (west = 46, east = 41/44, Gulf = 42) x lead (3, 12, 24, 36). Each also split coastal / offshore by the
row's own flag, reported, not part of the verdict. A cell needs >= 300 rows AND >= 10 distinct cycle days, else
UNTESTABLE. Great Lakes (45) reported only.

**Statistic.** Paired difference of M1 between two arms on the same rows; 2000-draw bootstrap, block = the cycle's UTC
day, seed 20261114; 95% interval. A difference is MATERIAL when its interval excludes 0 AND |difference| >= 1.0 rating
point. Interval excludes 0 but under 1.0: "detectable, not material". Otherwise "no difference shown".

**Hypotheses.**
- H1 (west): G beats L (lower M1) at 12, 24 and 36 h, materially. Direction fixed by the wind result.
- H2 (east): two-sided, no direction claimed: L against G at each lead.
- H3 (blend): on the even cycles, B is no worse than the better of G and L in every testable cell, and materially
  better than L in the west.
- H4 (HRRR alone): H against G, two-sided, each cell.

**Verdict rule per coast.** An arm is the recommended primary input only if it materially beats every other tested arm
in at least 3 of the 4 leads and is materially worse in none. Otherwise: "no material difference: no case to change the
rating's wind input". A recommendation is advice for a dark build; it changes nothing served.

**Controls, each must hold or the run is void.**
- C0 wiring: the observed wind used as the forecast gives M1 = 0 exactly and M2 = M3 = 1.
- C1 null: G and L swapped at random per row (seed 20261114); the G-minus-L interval must include 0 in every testable
  cell but at most one.
- C2 positive: +3 kn added to G's speed everywhere; planted-G minus G must be > 0 with the interval clear of 0 in every
  testable cell.
- C3 direction wiring: G's bearing rotated 180 degrees; M3 must fall below 0.40 in every testable cell.

**Breaking height.** Not testable as a wind-input choice, and stated now: wind does not enter the height chain
(`surf_point.estimate_surf_at`, `surf_transform`). The wave models' own wind forcing is fixed by their providers (GFS
winds drive GFS-Wave, IFS winds drive ECMWF's wave model). The scored surf archive is private and is not read from this
machine. The script asserts that `estimate_surf_at` takes no wind argument; no height number will be reported.

**Limits, stated before the result.** One 25-day autumn window. Buoys sit seaward of the surf zone, where the sea
breeze is weaker than at the beach. The buoy wind is adjusted to 10 m by a power law. The rating is exercised on a
fixed grid of surf states, not on the surf that was running. The rating today reads the model's own wind point, not the
lane, so this informs a design choice only. No ECMWF arm.

## 2. Result (run 2026-11-14 02:42Z): VOID by the pre-registered controls. No verdict on the wind input.

Instrument: `backend/scripts/wind_forcing_rating_test.py` on the 2026-11-11 rows (38,709 read, 27,820 used: zone
"full", four leads). Evidence: `docs/weather-program/evidence/2026-11-14-wind-forcing/result.json`. The
pre-registration commit is 5a18db20d (02:38:30Z); the row file was first opened after it.

**Controls.** C0 held (observed wind as forecast: M1 = 0, M2 = M3 = 1 in all 12 testable cells). C1 held (1 cell of 12
excludes 0, west 24 h; the rule allows one). C3 held (rotated bearing: M3 0.14-0.17). **C2 FAILED: +3 kn added to GFS
was detected in only 5 of 12 testable cells** (all four west cells and Gulf 36 h; in the east the planted arm's M1 rose
by 0.04-0.27 with intervals spanning 0). Section 1 says every control must hold or the run is void. It is void.

**Why C2 failed (a reading made after the result, not a tested claim).** The control was badly designed, and that is my
error. Adding 3 kn to an arm that already reads LOW moves it toward the truth before it moves it away, so the planted
error partly cancels the arm's own. A valid positive control plants the error on a copy of the OBSERVED wind, where the
unplanted error is zero. I did not check GFS's speed bias in these rows to confirm this.

**What the table shows, for the record only (M1 in rating points, L minus G positive = the lane is worse).**

| Coast | Lead | Rows | M1 GFS / HRRR / lane | lane minus GFS [95%] | HRRR minus GFS [95%] | blend minus GFS, even cycles |
|---|---|---|---|---|---|---|
| west | 3 | 2267 | 6.54 / 7.19 / 6.94 | +0.40 [+0.22, +0.61] | +0.65 [+0.46, +0.86] | -0.27 [-0.40, -0.15] |
| west | 12 | 2266 | 7.78 / 8.44 / 8.10 | +0.31 [-0.02, +0.66] | +0.65 [+0.29, +1.04] | -0.41 [-0.54, -0.27] |
| west | 24 | 2266 | 8.35 / 9.85 / 9.51 | +1.16 [+0.76, +1.59] | +1.50 [+1.08, +1.94] | -0.33 [-0.46, -0.19] |
| west | 36 | 2265 | 8.89 / 10.62 / 10.20 | +1.32 [+0.76, +1.96] | +1.73 [+1.15, +2.41] | -0.41 [-0.58, -0.22] |
| east | 3 | 3512 | 6.34 / 6.24 / 6.56 | +0.22 [+0.04, +0.40] | -0.11 [-0.31, +0.09] | -0.20 [-0.34, -0.08] |
| east | 12 | 3513 | 6.85 / 6.47 / 6.65 | -0.21 [-0.42, +0.00] | -0.39 [-0.60, -0.19] | -0.49 [-0.70, -0.30] |
| east | 24 | 3515 | 7.11 / 6.75 / 6.82 | -0.30 [-0.46, -0.11] | -0.36 [-0.61, -0.09] | -0.58 [-0.68, -0.45] |
| east | 36 | 3515 | 7.40 / 7.13 / 7.13 | -0.28 [-0.57, +0.06] | -0.27 [-0.63, +0.08] | -0.63 [-0.81, -0.46] |
| Gulf | 3-36 | 396-397 | 4.87-6.11 (all arms within 0.25) | every interval spans 0 | every interval spans 0 | -0.19 .. -0.59 |

- Had the run been valid: H1 (west, GFS materially better than the lane at 12, 24 AND 36 h) would NOT have held as
  written (12 h: +0.31, interval spans 0). At 24 and 36 h the difference is material, and it sits in the coastal buoys
  (+1.33 and +1.55; offshore buoys under the 300-row floor).
- Had the run been valid, the verdict rule would have returned "no material difference: no case to change the rating's
  wind input" on every coast: no arm materially beats every other in 3 of 4 leads. East differences are all under half
  a point. The blend's edge over GFS is 0.2-0.6 points everywhere, under the 1.0 threshold.
- Sizes: a wind arm moves the rating by 6-10 points on average against the observed-wind rating, and the level agrees
  in 50-63% of cases. The arms differ from each other by about a tenth of that.
- ECMWF: UNTESTABLE as registered (not in the rows). Breaking height: wind is not an input (the script's assertion
  passed).

**Not done.** No rerun with a repaired control: these rows are now seen. A second pre-registration (C2 planted on the
observed wind; nothing else changed) is for the director to ask for, and it should be scored by someone other than its
author. An ECMWF arm needs a public-archive fetch that this brief did not allow.
