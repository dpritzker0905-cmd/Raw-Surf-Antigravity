# Amendment 1 to the D-071 re-grade (reported-beside secondaries only)
Stamp: 2026-11-22 (research lead, drafted on the director's instruction). It must be committed to `dev` BEFORE the re-grade due 2026-11-26 reads any forecast-observation pair (section 4).
Candidate: the live skill-weighted HRRR wind lane (D-071, `WIND_LANE_SKILL_WEIGHTS=1`, on since 2026-11-12 19:49Z), re-graded per the ledger commitment with `backend/scripts/grade_wind_lane_ndbc.py` (#798's method).
Metric: UNCHANGED. The registered metric is vector RMSE (kn) per region × lead, LANE vs GFS, at NDBC `type="buoy"` stations. This amendment adds secondaries S1-S3 (section 2), reported beside it only.
Pass threshold: UNCHANGED. Revert if any region × lead cell with n >= 300 is worse than GFS by > 0.3 kn of vector RMSE (D-071).
Controls: UNCHANGED for the primary. S1-S3 carry their own checks (section 3). Those checks only void a secondary, never the primary.
Decision rule: UNCHANGED. Only the primary can keep or revert the lane. S1-S3 cannot pass, fail, revert, reopen or flip anything (section 1).
Unmeasured items: if S1-S3 are not built when the re-grade runs, the re-grade runs on time on the primary, and the secondaries are reported as "not measured". A missing secondary is never read as agreement.
Served change: none.

## 1. What this amendment does and does not do
- **Does not change the decision.** The registered metric (vector RMSE), the cells, the leads (3/12/24/36/47 h), the bootstrap (whole cycles, seed 970), the n >= 300 floor and the revert rule (> 0.3 kn worse than GFS) all stand as written in D-071.
  - Changing them after a fail-shaped hint would be metric shopping (director, 2026-11-22).
- **Adds information only.** S1-S3 are reported in the same result, in a separate section headed "Secondaries (amendment 1; not decision-bearing)".
- **Conflicts.** If the primary says revert and a secondary favours the lane, the revert stands. If the primary keeps the lane and a secondary disfavours it, the lane stays.
  - In both cases the secondary is evidence for gate `rating-wind-coast-v1` only. That gate is the one place a switch of the primary metric can happen.

## 2. Secondaries
All three use the re-grade's own rows, leads, cycles and arms (LANE, GFS, RAW = native HRRR cell, as the script defines them) and its own 10 m height adjustment.

### S1: category hit rate at the coastal buoys
- **Rows:** the script's `coastal` buoys only (< 50 km from the nearest HRRR land cell).
- **Shore normal per buoy:** the bearing from the nearest HRRR land cell to the buoy (seaward). It is fixed once from the land mask the script already loads, and written to the result.
- **Classes (7)**, the same for forecast and observation:
  - calm: speed < 3 kt (`surf_rating.wind_quality`'s glassy edge);
  - otherwise, offshoreness `o = -cos(dir - normal)`, giving offshore (o > 0.34), cross (-0.34 <= o <= 0.34) or onshore (o < -0.34),
  - each split into light (3-12 kt, the span over which `wind_quality` phases in direction) and strong (> 12 kt).
- **Score:** the fraction of rows whose forecast class equals the observed class, per arm and per region × lead.
- **Reported:** LANE - GFS and RAW - GFS, each with a 95 % interval from the script's whole-cycle bootstrap (seed 970), plus n.

### S2: coastal-station truth
- **Stations:** NDBC `activestations.xml` rows with `type="fixed"` and `met="y"` (C-MAN and NOS/CO-OPS met stations mirrored by NDBC).
  - Inside the lane's full-weight zone (space weight 1).
  - Kept only if an HRRR water cell lies within 3 km.
  - Great Lakes box excluded (lat 41-49, lon -92.5 to -76).
  - Region split at -109° longitude (West / East+Gulf), the middle of D-071's -112..-106 ramp.
- **Freeze.** The selected list (id, lat, lon, anemometer height, region) is written by the build and committed BEFORE any forecast is paired with these stations. Selection cannot change after pairing.
- **Height adjustment:** the script's neutral power law (alpha 0.11). Its over-land use at a pier is a known limit, reported, not corrected.
- **Shore normal:** the bearing from the station to the mean position of HRRR water cells within 10 km.
- **Reported:** per arm and per region × lead, vector RMSE, speed bias and the S1 hit rate, with n and the whole-cycle 95 % intervals of LANE - GFS and RAW - GFS.

### S3: dawn stratum
S1 and S2 are repeated for rows whose valid time falls between 05:00 and 10:00 local solar time (UTC + longitude / 15 h). Reported beside the all-hours numbers.

## 3. Checks on the secondaries (each voids its own secondary only)
- **Floor:** a cell with n < 300 is reported "below floor", with its numbers greyed and no interval read.
- **Planted check (S1, S2):** GFS with each hour's class moved one step toward onshore in a fixed 20 % of rows (seed 970). Its hit rate must fall below GFS's with an interval clear of 0 in the pooled coastal cell. If it does not, S1/S2 are marked "underpowered" for this re-grade.
- **Parity check (S2):** on 20 station-hours drawn with seed 970, the script's GFS value at a station must equal an independent bilinear read of the same GFS GRIB field within 0.1 kt. If not, S2 is voided.

## 4. What was seen before this amendment (disclosure)
- The author has not run `grade_wind_lane_ndbc.py`, or read any forecast-observation pair, for valid times after the flip (2026-11-12 19:49Z).
- The author HAS read observations only (no forecast) at NDBC 46086 and CO-OPS 9410230 / La Jolla for 2026-11-08 to 2026-11-22, for research note Q10 (#1163).
  - That read shows a land/sea-breeze cycle at the pier. It holds no lane or GFS value, and it informed the choice of S2 and S3.
- The director stated the position this amendment writes down before any 11-26 number exists.
