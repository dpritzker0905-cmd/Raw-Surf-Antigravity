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
