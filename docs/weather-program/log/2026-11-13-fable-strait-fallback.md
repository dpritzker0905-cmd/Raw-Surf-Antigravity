# 2026-11-13: the sampler's fine-grid fallback reach (Fable repair lead)

Append-only. Branch `fable/strait-fallback`. Follows `2026-11-12-fable-accuracy-monitor-red.md` and the per-buoy split
(Actions 43339322792; results and corrections in the shared notes file `fable-accuracy-per-buoy-split-results-2026-11-13.md`).

## Cause, measured
- GFS-Wave 0.25 deg marks the inner Strait of Juan de Fuca land (Open-Meteo `ncep_gfswave025`, same native grid, window
  47.75..48.5 N x -125.25..-123 W: the only wet cells are the open coast and the strait mouth 48.5 N, -124.5 / -124.25).
- NDBC 46267 (48.171, -123.600) has four land corners, so `sampler.py` took the zero-valid-corner branch, whose reach is
  `max(1.5 cells, 1.0 deg)`. The 1-deg floor was written for coarse grids; at 0.25 deg it reached 0.729 deg to
  (48.5, -124.25), open-Pacific swell. A degraded REGIONAL sample is returned as it is (only a degraded global-coarse
  sample falls through to an upstream point), so that was the served number.
- Size: +1.52 / +1.47 / +1.47 m vs best_match at +24/48/72 h over 14 days (n ~187, CI ~[+1.0, +2.0]); a derived
  27-48% of the 14-day +72 h monitor gap.

## Blast radius (every spot, not only buoys)
- Method: the tracked spot catalogue (2026-08-12, 1,773 of today's 1,776 spots; the public key cannot read the table,
  the 3 others were NOT identified) plus the 9 hole buoys; the 19 pilot boxes at <= 0.25 deg; land mask from Open-Meteo
  `ncep_gfswave025` at each point's four corners, then a 1-deg window for the points with four land corners.
- 1,259 points sit in a 0.25-deg box; **34 take the zero-corner branch**; 33 are surf spots whose nearest wet cell is
  0.251..0.373 deg away (inside 1.5 cells = 0.375: unchanged); **only 46267 (0.729 deg) changes, to no data**.
  Closest call: Inch Beach, Kerry, 0.373 deg. The comparison is inclusive with a 1e-6 deg epsilon, pinned.
- Also changes: a map tap in enclosed water on a 0.25-deg box (the strait, Puget Sound, bays) shows '--' instead of an
  open-ocean number. The other 8 hole buoys (46254, LJPC1, 46274, 46285, 44090, 51201, 51206, 51208) are NOT in the
  zero-corner branch: they keep a wet corner, so their path (bilinear-masked or the one-corner fallback) is untouched,
  which is the advisor's "do not make 46254 and LJPC1 worse" (they do not move at all).
- LIMIT: the mask is Open-Meteo's copy of the grid, not our stored tiles; a tile whose mask differs would change the count.

## Fix
- `SAMPLER_FINE_GRID_FALLBACK_CAP` (GUARDED, code default '1', kill '0'): on grids finer than 0.5 deg the zero-corner
  branch reaches 1.5 cells; beyond that it answers unavailable with the reason. Coarse grids and partitions unchanged.
  The two other nearest-ocean branches (one valid corner; corners with zero weight) stay unbounded: they start from a
  wet corner of the bracketing cell.
- Serve path recorded: `served.interp` and `served.sampled` in the calibration report and on each skill row
  (`skill_attribution.serve_path`, kill `CALIBRATION_SERVE_PATH=0`), so the next split can show 46267's rows stop
  existing BECAUSE the path changed, and can split 51202 (move 5: the chain adds +0.08 m there) by path.
- NOT done: a replacement value for 46267 (a finer model for enclosed water). No data is honest; a number needs #817's lane.

## Checks
- Tests: `test_sampler_fine_grid_fallback_cap.py` (8, the measured strait mask reproduced), 1 added and 1 re-scoped in
  `test_partition_absent_not_elsewhere.py`, one fixture coordinate moved in `test_sampler_carries_ensemble_spread.py`,
  `test_skill_attribution.py` pins the new keys and the kill switch. Mutations (branch disabled; threshold 5 deg;
  epsilon 0) each go red. 804 related tests pass locally.
- D-065 filter: NOT run locally (no cached window here). It replays spots through `rate_one_spot`; 0 measured spots
  change, so NO_CHANGE is the expected reading and is not evidence about 46267. The evidence for 46267 is the split.
- Reflection (design, before build): SOUND WITH CHANGES. Taken: inclusive comparison with epsilon; the unbounded
  sibling branches documented; a synthetic enclosed-water test. Not taken yet: an unavailable-rate guardrail and a canary.
