# Gate: rating-wind-coast-v1
Stamp: 2026-11-22 (research lead; DRAFT for the advisor. No forecast-observation pair for any arm has been read; section 10).
Candidate: the surf rating's wind source at the break. Do `NBM` (2.5 km, station-calibrated blend) or `HRRR_NATIVE` (3 km cell, not area-meaned) get the rating's own wind class right more often than today's `GFS` point wind, at coastal stations, all hours and at dawn?
Metric: M1 = category hit rate (fraction of station-hours whose forecast class equals the observed class) on the 7 rating wind classes (section 3), per region × stratum (ALL, DAWN). Reported beside it: M2 one-hour-tolerant hit rate, M3 vector RMSE (kn), M4 speed bias (kn), Heidke skill score.
Pass threshold: section 6. A challenger is BETTER than `GFS` in a region × stratum when its M1 gain is >= +3.0 percentage points AND one-sided Holm-adjusted p < 0.05. It is WORSE when the reverse holds at p < 0.05, whatever the size.
Controls: section 7. A permutation null (false-BETTER rate <= 0.08); a planted one-class shift toward onshore in 20 % of `GFS`'s non-calm, non-onshore hours (must be detected, section 7); `PERSIST` as the skill floor; a GFS parity check against stored products.
Decision rule: section 8. An arm becomes the rating-wind candidate in a region only if it is BETTER on DAWN, not WORSE on ALL, and BETTER than `PERSIST` on ALL. With both challengers qualifying, a pre-registered two-sided head-to-head decides. If that head-to-head is not significant, `NBM` is chosen, for coverage (section 8).
Unmeasured items: `HRRR_NATIVE` has no Hawaii or Puerto Rico rows (outside HRRR's domain): there it is "not measured", not a fail. Regions or strata under the floor are INSUFFICIENT. Non-US coasts are out of scope. Summer sea breeze is unmeasured by a winter window (section 9).
Served change: none from this gate. A pass is an owner decision to change the rating wind under D-065. It ships with a kill switch and a SCOREBOARD row, through the ONE chain (`rate_one_spot`), never as a second forecast path.

## 0. Why (research note Q10, #1163)
- The rating reads the GFS 0.25° point wind (`spot_ratings.rate_one_spot`, `resolver.resolve_point(domain="wind")`). HRRR draws the map only, and is area-meaned (D-071).
- Observations at one site over 13 days (n = 1, no forecast read): the La Jolla pier and the offshore buoy 46086 agree on offshore / cross / onshore in only 39 % of 310 hours. The disagreement is the land/sea-breeze cycle.
- D-071 graded vector RMSE at offshore-leaning buoys. RMSE carries the double penalty, so it can rank a smooth field above a sharper, more useful one. This gate scores what the rating uses, at the coast.

## 1. Arms
Every arm is read offline from public archives on a workstation or GitHub Actions, never from the Render box.

| Arm | Source | Read at the station |
|---|---|---|
| `GFS` (control) | NOAA GFS 0.25, `noaa-gfs-bdp-pds`, UGRD/VGRD 10 m | Bilinear from the four 0.25° nodes, the way the served point is resolved. Parity-checked against stored products (section 7). |
| `HRRR_NATIVE` | NOAA HRRR 3 km, `noaa-hrrr-bdp-pds`, 10 m wind rotated to earth | The nearest native cell whose `LAND:surface` is water. If the cell under the station is water, that cell. |
| `NBM` | NOAA NBM, `noaa-nbm-grib2-pds`, CONUS / Hawaii / Puerto Rico core grids, 10 m WIND and WDIR | Nearest grid cell to the station. The NBM version is written per row (section 9). |
| `PERSIST` (floor) | `GFS`'s earliest scored lead of the same cycle (6 h), held for every later valid time | As `GFS`. |
| `GFS_PLANT` (control only) | `GFS` with a planted shift (section 7) | As `GFS`. |

- **Cycles:** 00Z and 12Z, the cycles all three sources publish with leads to at least 36 h.
- **Leads:** 6 to 36 h, hourly where the source is hourly (GFS is hourly to 120 h, HRRR to 48 h, NBM to 36 h). Three lead bands are reported: 6-12, 13-24 and 25-36 h. The decision pools the leads.
- **Missing runs:** a station-hour is scored only when every arm present in that region has a value. A missing run drops the station-hours of that cycle for all arms in the region, and the drop count is reported per arm.

## 2. Truth (coastal stations)
- **Candidates:** NDBC `activestations.xml` rows with `type="fixed"` and `met="y"` (C-MAN and NOS/CO-OPS met stations mirrored by NDBC). Also NOAA CO-OPS met stations not mirrored there, read through the CO-OPS API.
- **Kept when all of these hold:**
  - within 15 km of a catalogued spot (`models/spots.py`);
  - an HRRR water cell AND an HRRR land cell both within 3 km, so only coastal stations qualify and offshore platforms and lights do not (Hawaii / Puerto Rico: an NBM water cell and an NBM land cell, from the NBM land mask; advisor, 2026-11-22);
  - outside the Great Lakes box (lat 41-49, lon -92.5 to -76);
  - an anemometer height on the station page.
- **Freeze.** The build writes the list (station id, lat, lon, height, region, linked spot id, shore normal) to `gates/rating-wind-coast-v1-stations.md`. That file is committed and gated (advisor line) BEFORE any arm is paired with any station. Nothing is added or removed after pairing.
- **Regions:**
  - West: lon < -109°, the middle of D-071's ramp;
  - East: lon >= -109°, outside the Gulf box;
  - Gulf: lat 18-31°, lon -98 to -81°;
  - Hawaii;
  - Puerto Rico / USVI.
- **Height to 10 m:** the neutral power law used by `grade_wind_lane_ndbc.py` (alpha 0.11). Its over-land use at piers is a known limit, reported, not corrected.
- **Observation hour:** the vector mean of samples within ±30 min of the valid time, at least 3 samples (6-min data) or 1 (hourly data).
- **Station QC:** a station whose observed speed is constant for 6 h or longer, or missing for more than 50 % of the window, is dropped for the whole window. The drop is reported.
- **Not truth:** CDIP (EXAM only), Open-Meteo (never in user data), any model analysis. URMA is reported beside the stations as a gridded check, never scored.

## 3. Classes (forecast and observation alike)
- **Shore normal:** the linked spot's served shore normal, from `surf_point.resolve_surf_geometry`, frozen in the station file.
- **Classes (7):**
  - calm: speed < 3 kt (`wind_quality`'s glassy edge);
  - otherwise, offshoreness `o = -cos(dir - normal)` gives offshore (o > 0.34), cross (-0.34 <= o <= 0.34) or onshore (o < -0.34),
  - each split into light (3-12 kt, the span over which `wind_quality` phases in direction) and strong (> 12 kt).
- **Strata:**
  - ALL: every scored hour.
  - DAWN: valid time 05:00-10:00 local solar time (UTC + longitude / 15 h). This is pre-named here and not moved.

## 4. Metrics
- **M1 (decision):** category hit rate.
- **M2:** hit when the forecast class equals the observed class at the valid hour or at the hour before or after (observation-side tolerance against the double penalty).
- **M3, M4:** vector RMSE and speed bias, in knots.
- **Heidke skill score:** for each arm on the 7 classes.
- **Confusion tables:** one per arm, region and stratum.

## 5. Statistics
- **Pairing:** by (station, cycle, lead, valid hour).
- **Bootstrap:** moving-block, resampling 7-day blocks of valid dates, every station together inside a block, 10,000 replicates, seed 1163.
- **p-value:** the one-sided p for "challenger M1 > GFS M1" is the fraction of replicates with a difference <= 0.
- **Holm family per region:** 4 lines (`NBM` vs `GFS` and `HRRR_NATIVE` vs `GFS`, each on ALL and DAWN), alpha 0.05. Hawaii and Puerto Rico have 2 lines (`NBM` only).
- **Floors:** a region × stratum is evaluable only with all of:
  - >= 42 valid days (6 blocks);
  - >= 3 stations;
  - >= 600 paired station-hours for ALL;
  - >= 300 paired station-hours for DAWN.

  Below the floor it is INSUFFICIENT, not a fail.

## 6. Labels
- **BETTER:** M1 gain >= +3.0 percentage points and Holm-adjusted one-sided p < 0.05.
- **WORSE:** M1 loss with one-sided p < 0.05 for "challenger < GFS", in a separate Holm family of the same shape.
- **NOT DIFFERENT:** otherwise.
- **PERSIST check:** each challenger must also beat `PERSIST` on ALL (one-sided p < 0.05, unadjusted). If it does not, that region is NO SKILL for that arm, whatever its label against `GFS`.

## 7. Controls (a failed control voids the region it fails in)
- **Permutation null:** within each 7-day block, arm labels `GFS` and challenger are swapped at random. Over 200 such permutations (seed 1163), the share labelled BETTER must be <= 0.08 per region. Otherwise the bootstrap is mis-calibrated there and the region is VOID.
- **Planted shift:** `GFS_PLANT` is `GFS` with its direction rotated toward onshore by the smallest angle that moves its class one step (offshore to cross, or cross to onshore). It is drawn from `GFS`'s non-calm, non-onshore hours only: a fixed 20 % of those hours (seed 1163). Calm and onshore hours cannot move one step toward onshore, so they are never drawn.
  - **Test level:** `GFS_PLANT`'s M1 must be lower than `GFS`'s on ALL in every evaluable region, at one-sided p < 0.05 (same bootstrap), unadjusted, with no +3 pp minimum (advisor, 2026-11-22). Otherwise the region is underpowered and VOID.
- **Skill floor:** `PERSIST` must be WORSE than `GFS` on ALL at leads 25-36 h in the pooled sample. Otherwise the pipeline is suspect and the whole gate is VOID.
- **GFS parity:** on 30 station-hours drawn with seed 1163, `GFS` must match the stored GFS wind product (Supabase `weather-products`, the product the rating serves) within 0.5 kt and 5° (directions only when >= 4 kt). Otherwise the gate is VOID until fixed.
  - **Read path:** the stored product is read through its public object URL, or through the same anonymous read the client uses. It is never read with the service-role key, and never through the live API (advisor, 2026-11-22).

## 8. Decision
- **In each region:** an arm qualifies if it is BETTER on DAWN, not WORSE on ALL, not NO SKILL, and no control is void there.
- **One qualifier:** it becomes the region's candidate.
- **Both qualify:** a two-sided head-to-head on DAWN M1 (`NBM` vs `HRRR_NATIVE`, same bootstrap, alpha 0.05, outside the Holm family) picks the winner. If it is not significant, `NBM` is chosen.
  - This tie-break is written now so it cannot be argued later: `NBM` covers Hawaii and Puerto Rico, one source then serves every US region, and it carries its own bias correction.
- **None qualifies:** `GFS` stays.
- **Serving read rule a pass would ship (fixed now, advisor, 2026-11-22).** The rating reads the winning source at the SPOT coordinate (the catalogue pin `rate_one_spot` resolves), never at a station:
  - `HRRR_NATIVE`: the nearest native 3 km cell whose `LAND:surface` is water. If the cell under the pin is water, that cell.
  - `NBM`: the nearest grid cell to the pin. If that cell is land in NBM's land mask, the nearest water cell instead.
  - The build may not choose another read (bilinear, area mean, a land cell) after the result. A different read is a new gate.
- **Scope of a candidate:** an owner decision, not a ship. The change ships under D-065: code default ON with a kill switch (`RATING_WIND_SOURCE`), a SCOREBOARD row, the history filter, and the ONE chain (the source is resolved inside `rate_one_spot`'s wind resolve, so every surface reads the same wind).

## 9. Known limits, written now
- **Season.** The first window is winter (collection starts after this gate merges, and needs David's word for any dispatch). Sea breezes are strongest in summer.
  - A winter pass ships only with the season named in the SCOREBOARD row.
  - A summer re-look, registered as an amendment before its data, is owed before any claim of year-round skill.
- **NBM versions.** A version change inside the window splits the rows. If more than 50 % of the window is on one side, only that side is scored. Otherwise `NBM` is VOID for the window.
- **One scored look.** The result is computed once on the full frozen window. Interim reads of any arm-truth pair are forbidden; collection health is checked from counts only.
- **Station siting.** Pier and harbour anemometers can be sheltered or channelled. The result reports per-station hit rates so a single station cannot drive a region unseen. A region whose verdict flips when its most influential station is dropped is labelled FRAGILE beside its verdict (a report, not a re-decision).

- **Stations, not spots.** The gate measures at coastal stations within 15 km of a spot, with the station's own nearest-cell read (section 1). A pass ships the spot-coordinate read above. The transfer from station to spot is assumed, not measured.
- **Class edges.** The ±0.34 offshoreness cut and the 3 / 12 kt speed cuts are this gate's own binning. A forecast near a class edge can miss on a small error, and an observation near an edge can be hit by luck. Hits that fall on a class edge are a property of this binning, not of the source. M3 and M4 are reported beside M1 for that reason.
- **Pull size before dispatch.** The NBM and HRRR pulls (byte-range `.idx` subsets of the 10 m wind fields only) are sized in GB per day and per window, and written to the build PR, before any dispatch request goes to David.
- **Shore normal per station.** The result reports each station's shore normal (the linked spot's served normal), beside its per-station hit rates.

## 10. What was seen before this gate (disclosure)
- No forecast value of any arm has been paired with any station by the author.
- Observations only (no forecast) were read at CO-OPS 9410230 La Jolla and NDBC 46086 for 2026-11-08 to 2026-11-22 (research note Q10). That read motivated the DAWN stratum. That window precedes collection and is not scored.
- Priors: the author's prior is `NBM`, and Reflection (advisory) preferred `HRRR_NATIVE`. Both are arms, so the gate tests the disagreement instead of settling it by argument.
