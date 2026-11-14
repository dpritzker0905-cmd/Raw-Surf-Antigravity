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

## HOLD: the blast radius does not survive NOAA's native mask (2026-11-13, the owed check)
- Our 0.25-deg GFS tiles read NOAA's exact native cell (`REGRID_NATIVE_CELL: '1'` in forecast-ingest.yml and
  forecast-ingest-pilots.yml), so the right mask is NOAA's, not Open-Meteo's. One public NOMADS field
  (gfswave.t00z.global.0p25.f000, HTSGW, 2026-11-13; decoded with eccodes; no credentials) over the same 1,782 points:
  - 1,259 in a 0.25-deg box; **76 have four land corners (Open-Meteo's copy said 34)**.
  - Under the 1.5-cell cap, **8 change to no data: 46267 and 7 SURF SPOTS**: Salthill Beach 0.481 deg, Silverstrand
    Beach 0.449, Boca Barranca (Costa Rica) 0.448, Rossbeigh White Strand 0.439, Rathmullan 0.404, Bishopsquarter 0.398,
    Kells 0.396. Inch Beach stays at 0.3726.
  - 46267's nearest wet native cell is (48.5, -124.5), 0.958 deg: (48.5, -124.25) is LAND natively and wet in
    Open-Meteo's copy. Open-Meteo's `ncep_gfswave025` is therefore not cell-identical to NOAA's field at coasts
    (5 of the 34 common points disagree on distance by 0.03..0.23 deg).
- So "0 of 1,259 spots change" in the PR, the flag comment, the registry line and the first SCOREBOARD wording was WRONG
  on the mask that matters. SubQ's flag (verify the margin against our own tiles) was right. SCOREBOARD row corrected.
- Not settled: whether the stored tiles equal the native field at every one of those cells (one f000 field; the stored
  tiles were not read). The served sampled cell for 46267 will be in the calibration rows once the serve-path logging
  lands, which answers it for the buoy.
- Options, NOT chosen here: (a) keep 1.5 cells and accept 7 spots at '--' (they are 0.4..0.48 deg from model water, so
  today they show a cell 2 cells away); (b) a 2-cell reach (0.5 deg) keeps all 7 and still excludes 46267 (0.958), but
  is fitted to this list with a 0.019 deg margin (Salthill); (c) the researcher's exposure sweep (#851). Owner's call.
- D-065 history filter on this PR (run 43360118157): **SKIPPED**, "no cached history window: the replay did not run".
  No numbers exist. AFTER: not measurable before a deploy.

## Two more measurements (2026-11-13, #852 still HELD; advisor verdict on #852 as built: FAIL)
**ICON and EURO masks (indicative only).** Same method on Open-Meteo's `gwam` and `ecmwf_wam025`, 1,259 boxed points:
EURO 4 points with four land corners, ICON 0; under the cap 0 change on either. Indicative: Open-Meteo's copy of GFS-Wave
was shown NOT cell-identical to NOAA's at coasts (34 vs 76 above), and whether our EURO / ICON pilot tiles sit on those
native grids was not checked. The native-mask check for those lanes is NOT done.

**Exposure sweep feasibility (researcher's #851 rule, measured before building anything).** 72 bearings from each point
over ETOPO 1-arc-minute relief (NOAA ERDDAP `etopo180`); a bearing is open if it reaches water deeper than 200 m within
300 km before land; rays start 3 km out.

| Point | Open bearings of 72 | Open arc (deg) | Nearest 200 m water on an open ray |
|---|---|---|---|
| 46267 Juan de Fuca (the buoy to EXCLUDE) | 4 | 45-50, 290-295 | 38 km |
| Boca Barranca | 9 | 170-210 | 40 km |
| Kells | 2 | 270, 280 | 87 km |
| Silverstrand Beach | 2 | 225, 235 | 201 km |
| Salthill Beach | 1 | 230 | 208 km |
| Rossbeigh White Strand | 1 | 265 | 94 km |
| Rathmullan | 0 | none | none |
| Bishopsquarter | 0 | none | none |
| Inch Beach (control) | 5 | 235-255 | 94 km |
| Fort Point, San Francisco (control) | 12 | 235-290 | 54 km |

**The rule as specified does NOT separate them; it ranks them the wrong way.** 46267 scores MORE open than six of the
seven surf spots. Two reasons, both physical: (1) "200 m water" is not "open ocean": the Strait of Juan de Fuca is itself
deeper than 200 m 38 km from the buoy, and a straight ray at 290-295 deg runs down the strait to the Pacific; (2) the
Irish spots sit behind a wide shallow shelf (200 m water is 87-208 km away) and inside bays, so few rays qualify.
Rathmullan (Lough Swilly) and Bishopsquarter score zero, yet 46267 is the one measured wrong by 1.5 m. A served rule built
on this sweep would keep 46267 and drop the spots. NOT built. What 46267 needs is attenuation along a 100 km channel
(refraction and dissipation), which a visibility test does not model; the researcher's own note says spectral models
underpredict strait penetration, i.e. this is model physics, not geometry.
- Limits: one relief dataset, altitude >= 0 as land, 5-degree bearings, no islands smaller than 1 arc-minute; the seven
  spots' true exposure is not measured against any observation (no buoys there).

## The researcher's pre-registered corridor ratio (#851 section 10, 3eb279831), computed as written: FAIL
- Rule: shortest water path from P to the nearest cell at least 1000 m deep (ETOPO 1 arc-min, 8-connected); L = its length;
  W = narrowest cross-channel width along it; R = L / W; serve if R < 2 or L < 10 km. Frozen criteria: 46267 rejected;
  Inch Beach, Fort Point and at least 5 of the 7 spots served. No constant tuned.
- Result (L km / W km / R): 46267 184 / 3.0 / 61; Salthill 230 / 2.0 / 115; Silverstrand 229 / 2.0 / 114; Boca Barranca
  62 / 6.0 / 10; Rossbeigh 159 / 3.0 / 53; Rathmullan 169 / 2.0 / 85; Bishopsquarter 231 / 2.0 / 115; Kells 148 / 3.0 / 49;
  Inch Beach 163 / 3.0 / 54; Fort Point 65 / 3.0 / 22. **Every point is rejected**: 46267 yes, controls NOT served, 0 of 7
  spots served. By the pre-registration it is discarded.
- Why: 1000 m water is 60-230 km from every one of these points (continental shelf), so L is large everywhere, and the
  narrowest width along a shortest path is always a few km (the path starts in the surf zone or an inlet and cuts through
  gaps between islands and headlands). R does not distinguish a 100 km strait from a beach behind a wide shelf.
- My operationalisation, stated because the rule leaves it open: W is the shortest land-to-land chord through a path
  cell over 18 directions (rays capped at 300 km), and the path is the SHORTEST one, which prefers narrow passes. A
  widest-path reading would raise W; it was not computed, since changing the reading after seeing the result would be tuning.
- Standing conclusion: neither geometric rule measured (exposure sweep, corridor ratio) separates 46267 from the surf spots.

## 2026-11-14 01:38Z The hold is resolved: 46267 is excluded BY NAME; the reach cap is withdrawn

**Decision, as relayed.** The director session (`local_d6b521eb`) relayed the owner's words of 2026-11-13 20:28 EST, said in
that session, on this question: "make the decision based on science". The director's decision: exclude 46267 by name, as a
station entry that states its reason. The owner did not say it in this session; it is recorded here as a relay.

**Basis (all measured above in this log; nothing new measured today).** Both pre-registered geometric separators failed
(exposure sweep, corridor ratio). The 2-cell reach is fitted to today's list with a 0.019 deg margin. The 1.5-cell cap
sends 7 real surf spots to "no data" on no evidence that their values are wrong. A named entry with its reason is
representativeness metadata: how verification handles a station that does not represent the grid.

**What this PR now is.** The reach cap (`SAMPLER_FINE_GRID_FALLBACK_CAP`) and everything built for it are gone from the
diff. In their place:
- `services/weather_pipeline/unresolved_stations.py`: one entry, NDBC-46267, with its reason and evidence; match radius
  0.02 deg around NDBC's published position (48.171 N, 123.600 W, read from NDBC's station table today).
- `sampler.py`: in the all-land-corner branch only, for marine products only, a point at a named station returns
  "no data" with the reason. Every other point takes the unchanged fallback.
- Flag `SAMPLER_UNRESOLVED_STATIONS`, code default "1", in `runtime_flags.GUARDED`, `_RATING_FLAGS` and the guardrail's
  COVERAGE as BLIND. Kill "0" restores the old read exactly.
- 9 tests (`tests/test_sampler_unresolved_stations.py`): the station reads "no data" and names itself; the kill switch
  restores 2.24 m from (48.5, -124.25) exactly; four points beside the station read identically with the switch on and
  off (the null arm); the entry lapses on a grid that gives the station a wet corner; a wind product is untouched; the
  registry holds exactly one station. Chain floor fragment +9 tests, +1 file.

**Reach, measured.** No catalogue surf spot is within 0.6 deg of the station (1,773 spots, the 2026-08-12 catalogue;
3 of 1,776 live spots unchecked, as before). The 7 spots the cap would have blanked are untouched. A map tap exactly on
the buoy (within about 2 km) reads "no data"; a tap elsewhere in the strait still reads far water, unchanged.

**Said plainly.** The accuracy monitor will improve because 46267's rows LEAVE the score, not because any forecast got
better. The per-buoy split's no-served-row count (#870) is where that removal shows.

**Not done / not known.**
- No AFTER measurement: it needs a deploy and one dispatch of the per-buoy split, on the owner's word.
- The history filter replays surf spots, so it will read NO_CHANGE; the live guardrail cannot see this flag (BLIND).
- The 7 spots, and every other point in the all-land-corner branch (76 on NOAA's native mask), still read far water,
  unvalidated. Our own stored EURO, ICON and Copernicus masks are still unread.
- Whether any served number uses the sample at 46267's coordinate through a calibration residual (red-team limit 5)
  was not traced.
