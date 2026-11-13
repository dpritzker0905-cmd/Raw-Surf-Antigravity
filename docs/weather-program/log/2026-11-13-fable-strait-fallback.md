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
- LongCat (LongCat-2.5, paid, payload sha256 6414ff79...9234, the sampler diff): 4 findings. Taken: the cap is now the
  MARINE domain's only (wind and pressure keep the old reach; pinned); the epsilon applies only on the capped path, so
  every other grid is byte-identical. Not taken, recorded as follow-ups: the accept distance uses a plain hypot while
  the nearest search is antimeridian-aware (pre-existing; a fix moves served points near +-180 on coarse grids, its own
  change); `grid_res` reads latitude spacing only (the tiles are square). Chain lane now +9 tests: 3879 must be read.
- SubQ (subq-snap-1.1, on the fix; the owner confirmed all three reviewers at 22:15 EST): addresses the cause 0.997;
  default ON reasonable 0.96; no data better than the wrong number 0.98; the unmeasured AFTER blocks merging 0.45 (a
  coin flip). The 0.373 vs 0.375 margin scored 1.66 of 3 ("material: verify before merge" 0.64): the land mask is
  Open-Meteo's copy, so the 33 unchanged spots, Inch Beach first, must be re-checked against OUR stored tiles before
  merge. OPEN, not done.

## Advisor red-team of #852 (PASS WITH LIMITS), answered from the code
1. **Other marine products below 0.5 deg.** Every pilot box is 0.25 deg (`pilot_regions.py`: 19 `"resolution": 0.25`
   entries, incl. extras and Stage B), and ICON / EURO marine pilots ride the same boxes (`get_all_pilot_regions`), so
   their 0.25-deg tiles ARE capped too, each with its OWN land mask. Copernicus regional tiles are stored at 0.5 deg
   (`scheduler.py`: `res_to_save = 0.5`), which the strict `< 0.5` threshold leaves on the old floor (pinned with the real
   axis generator). World tiers are 2 and 10 deg: unchanged. **NOT measured: the blast radius on the ICON and EURO masks.**
   The measurement covers the served default lane (GFS) only.
2. **Our stored tile mask for the 33 unchanged spots: NOT done.** It needs a Storage read (credentialed); asked the owner
   for an Actions job. Until then "0 spots change" rests on Open-Meteo's copy of the GFS-Wave mask.
3. **Threshold on real coordinates:** `test_a_real_half_degree_tile_axis_is_not_fine` builds 0.5 and 0.25 axes with
   `_coarse_axis` over real pilot bboxes (incl. the fractional us_northeast edges).
4. **Does a served number use the sample at 46267's coordinate?** None today. The calibration residuals feed the report,
   the skill ledger and the residual archive; the one consumer that turns them into a served number is
   `height_quantile_map.py` (HEIGHT_QUANTILE_MAP, default OFF, a pooled fit). With the cap on, 46267 writes no model row,
   so it leaves that pool too.

## To say plainly (the advisor's words, adopted)
- (a) The monitor will improve mostly because 46267's rows DISAPPEAR from the score, not because a forecast improved.
  The per-buoy split does not yet print an unavailable count; it must, so removal cannot read as skill. OWED.
- (b) The flag is GUARDED in name but the guardrail is blind to it (the filter replays spots, there is no
  unavailable-rate check, the after-state is unmeasured). Written on the flag's line in `runtime_flags.py`.
- (c) Enclosed-water map taps on 0.25-deg boxes now show '--'.
- Chain lane now +10 tests: 3880 must be read.

## Researcher input (draft PR #851, enclosed-water masking) and how #852 relates
- The researcher proposes an exposure sweep (72 bearings against a ~1 km land mask; a bearing is open if it reaches
  200 m+ water within 300 km without crossing land), serving the nearest-ocean value only for swell directions with open
  bearings, else "no open-ocean estimate" and dropping the point from the monitor. Its constants are assumptions to tune
  on the hole buoys with open-coast controls.
- #852 is the smaller step: a reach cap, no direction or exposure logic. For 46267 both give the same outcome (no
  estimate). The sweep is the fuller design for the cases the cap cannot separate: a point within 1.5 cells of water
  that is still sheltered (the 33 borderline spots; SoCal Bight buoys). NOT built here; it belongs with #817 / #851.
- The researcher's unverified item, the GFS-Wave wet mask at 46267, IS measured in this log (section "Cause, measured"):
  all four corners land; nearest wet cell (48.5, -124.25), 0.729 deg away.
