# Step 3b PRE-REGISTRATION: period and coastal-wind correction against station truth (research lead, 2026-11-19)

**Owner word (David, about 00:35Z, typed in the director's session):** "Yes to 3b, start the NWPS archive , but if we
can be more SOTA than NOAA , we need to use their forecast to help us, not just parrot what they say".

**Ownership:**
- Research lead: this pre-registration and its gate.
- Wind long-range lane: builds the coastal wind MOS.
- Repair lead: builds the regional period correction AFTER the D-081 rule picks the served period.

Written BEFORE any data is read. Nothing is built before the advisor's read. No dispatch without David's word.

## 1. Question
Do statistical corrections of the served swell PERIOD and the served coastal WIND, trained on station truth, reduce the
errors that drive surf-rating level flips (36% period, 31% wind, 13% height)? Do they do this without making any region
worse?

## 2. Truth (licence-clean only)
- **US: public domain.**
  - NDBC buoys: DPD (dominant period), APD (mean period), MWD, WSPD/WDIR.
  - C-MAN stations: wind.
  - NOAA ISD / ASOS coastal stations from NCEI: wind.
- **Europe:** CMEMS In Situ TAC moored buoys (wave periods VTPK/VTM02 and wind where carried), under the CMEMS licence.
- **Other non-US surface stations (ISD SYNOP/METAR): EXCLUDED from v1** until their redistribution and commercial terms
  are read. Some national data carry WMO Resolution 40 restrictions.
- Station lists are frozen from the catalogue at a NAMED date before any fetch. Delayed-mode/QC'd records are
  preferred, and the NRT share is reported.

## 3. Mapping served quantities to truth (fixed now)
- **Period.** The served period under the D-081 rule:
  - if it is a peak or dominant swell period → compare with NDBC DPD / CMEMS VTPK;
  - if it is a mean period → compare with APD / VTM02.
  The mapping is recorded in an amendment the day D-081 picks its rule, before any score. Partition periods are
  compared only where the buoy provides spectral partitions; otherwise against bulk DPD, with the mismatch stated.
- **Wind.** 10 m wind at the station: speed (adjust anemometer height with a log profile, z0 = 0.0002 m over water) and
  direction.
- **Rating wind class.** Each station is paired to its nearest catalogue spot within 25 km on the same open coast. The
  class (offshore / cross / onshore × the strength bands) uses THAT spot's shore-normal and the rating code's own
  thresholds, as imported from the rating module, not re-coded. Stations with no spot within 25 km score speed and
  direction only.

## 4. Arms
- **P0 / W0:** today's served period / wind (raw chain output), per model (GFS, EURO, ICON) and for the consensus where
  served.
- **P1:** P0 plus a regional period correction. Fitted model: P_true = α_r,L + β_r,L · P0, pooled by region r and lead
  L, shrunk toward (0, 1).
- **W1:** the direction-aware coastal wind MOS. The observed (u, v) are regressed on the forecast (u, v), speed,
  hour-of-day (sin/cos) and lead.
  - Coefficients are pooled by coastal exposure class (shore-normal sector × region), with ridge shrinkage toward the
    identity.
  - A gradient-boosted alternative may be reported but not gated.
- **T (NWPS teacher arm, wind only where NWPS carries wind):** reported, not gated, in 3b.

## 5. Splits (no leakage)
- **Time-blocked.** TRAIN = the first 70% of the window. TEST = the last 30%, after a ≥ 10-day gap.
- **Leave-STATION-out within TEST:** 20% of stations per region are excluded from training. Spots are not stations, so
  this measures transfer to places with no station, which is what users get.
- **Fitting is per lead.** No test data is used to choose features. Feature and shrinkage choices are made by
  cross-validation inside TRAIN only.

## 6. Metrics
- **Wind (primary):** the hit rate of the rating's wind class (exact class).
- **Wind (secondary):**
  - speed MAE and ME;
  - circular direction MAE and mean signed direction error, wrapped to (−180°, 180°];
  - the class confusion matrix (offshore↔onshore errors listed separately; they are the damaging ones).
- **Period:** MAE and ME (s).
- **Rating outcome (reported, gated loosely):** the counterfactual level-flip rate.
  - Recompute the rating at paired spots with the corrected input, and again with the station-truth input, holding
    everything else fixed.
  - Measure the share of input-driven flips that the correction removes.

## 7. Statistics
- Paired differences (arm 1 − arm 0) per lead (+24, +48, +72, +120 h).
- Moving-block bootstrap over dates: blocks of max(3 days, lead), B = 10,000, seed fixed now (20261119).
- **Holm families:**
  - F-wind = {class hit rate, speed MAE, direction MAE} × 4 leads;
  - F-period = {MAE, |ME|} × 4 leads.
- **Regions:** US Pacific, US Atlantic + Gulf, Hawaii, Europe Atlantic, Mediterranean. Holm across regions inside each
  metric × lead.

## 8. Gate (all must hold)
- **G1 (wind).** On TEST:
  - the class hit rate improves (W1 − W0 > 0, Holm-adjusted CI lower bound > 0) at ≥ 3 of 4 leads;
  - speed MAE and |speed ME| are not worse at any lead (CI upper < +0.2 m/s);
  - offshore↔onshore swaps do not increase.
- **G2 (period).** On TEST:
  - MAE improves with CI lower bound > 0 at ≥ 3 of 4 leads;
  - |ME| is not worse at any lead.
- **G3 (transfer).** The leave-station-out stations are not worse (same tests, one-sided) for both G1 and G2.
- **G4 (regions).** No region is Holm-significantly worse on its primary metric.
- **G5 (replication).** The same sign in both halves of TEST.
- **G6 (rating).** The counterfactual flip rate does not rise. A reduction is reported with its CI.
- Each of G1 and G2 can pass separately. Each ships ON alone (D-080) with its own kill switch, whose fallback is the
  uncorrected input. Each gets a SCOREBOARD row.

## 9. Controls (VOID if any misbehaves)
- **Null:** an arm identical to arm 0 gives zero difference with a zero-width CI.
- **Shuffled pairing:** station-time pairs permuted within day → the correction must show no gain.
- **Planted, with the matching tests:**
  - wind direction rotated +30° on a random 15% of TEST rows: the signed-direction test must catch it;
  - period +1 s additive: the period ME test must catch it;
  - period × 1.10: period MAE must catch it.
  Each is judged at 1× and 2×. The 2× plant must be caught or the run is VOID.
- **Minimum data per region:** ≥ 10 three-day blocks across its stations, ≥ 5 stations with ≥ 70% of hours present.
  Else "insufficient" (no verdict).

## 10. One scored look
TEST is scored once. Any change after that is a new registration on later data.

## 11. "Don't parrot NOAA": the beat-the-teacher rule (applies to step 4 and any teacher; recorded here)
- Any teacher (NWPS, EWAM, CMEMS regional) is an INPUT, never the served answer.
- A teacher-informed chain may ship only if, on held-out buoys, it beats BOTH:
  - (a) the teacher served as-is, and
  - (b) our current chain.
  Paired, with MAE and ME, Holm, and replication halves.
- If it beats our chain but not the teacher, the teacher-informed chain is not good enough. Improve it, don't ship the
  teacher.

## AMENDMENT 1 (2026-11-19, before any data read): the wind lane's eight changes, all ADOPTED
1. **Wind class (replaces §3's "class thresholds").** `surf_rating.py` has no discrete class, so the class is fixed now
   from the module's own functions:
   - direction: `offshoreness()` ≥ +0.5 is offshore, ≤ −0.5 is onshore, else cross;
   - strength: < 3 kt glassy, 3-12 kt phase-in, ≥ 12 kt full effect, plus a "vetoed" flag when `wind_gate` < 1.
   - The 3.0 and 12.0 anchors are lifted into named constants in a byte-identical refactor with a pinned test. The
     scorer IMPORTS them.
   - **Co-primary, threshold-free:** the MAE of the rating's own wind factor `wq·wg`, computed by the imported
     functions, judged beside the class hit rate.
2. **Window and freeze date (§5).**
   - Window: valid times 2026-07-01 00Z to 2026-11-15 00Z. This is AFTER the L1 TEST window, so the period correction
     cannot touch L1's TEST buoys.
   - TRAIN: 2026-07-01 to 2026-10-06. GAP: 10 days. TEST: 2026-10-16 to 2026-11-15, 30 days = 10 three-day blocks.
   - Station lists are frozen from the catalogues as of 2026-11-19.
3. **Models (§4).** W0/P0 cover GFS and EURO only (both have open history). ICON enters in a LATER registration on a
   forward-collected window, because DWD keeps about 1 day.
4. **Height adjustment.** The log profile (z0 = 0.0002 m) applies to buoys and C-MAN only, at each station's own
   anemometer height from NDBC metadata. ASOS (10 m) is not adjusted.
5. **Direction plants.** 1× = +30°, 2× = +60°, on the same random 15% of TEST rows. Both are judged by the
   signed-direction ME test in the PLANT family, not F-wind.
6. **Hour-of-day** is LOCAL SOLAR time from the station longitude.
7. **Leave-station-out.** The 20% are excluded from TRAIN fitting entirely and scored on TEST only.
8. **Shipping.** W1 applies inside the one chain (the point wind feeding `compute_surf_rating`) for every surface and
   every spot.
   - The exposure class (shore-normal sector × region) is computed from spot metadata alone, so W1 is defined at
     unpaired spots too. Leave-station-out (§5) measures that transfer.
   - CMEMS In Situ is accessed by env-var NAME only, with the licence attribution carried.

## AMENDMENT 2 (2026-11-19, before any data read): the HRRR source arm; the period arm demoted
**Director's direction:** add an HRRR 3 km source arm (CONUS). W1 must beat BOTH HRRR as-is AND W0. If HRRR as-is wins,
the served answer is HRRR (plus MOS only if MOS adds to it). The period arm (P1) is DEMOTED until the flip attribution is
re-run with direction as its own input. G2 is suspended and P1 is not built.

**Arms added (CONUS stations only):**
- H0: HRRR as-is, bilinear at the station on HRRR's native 3 km Lambert grid, using cycles issued before the valid time.
- H1: W1-on-HRRR. The same MOS form, fitted on HRRR input in TRAIN.
- Source: AWS `noaa-hrrr-bdp-pds` (public domain), which covers the window.
- Leads: HRRR reaches +48 h only on the 00/06/12/18Z cycles, so the H arms exist at +24 and +48 h only. +72 and +120 h
  stay W0 vs W1.

**Gate additions:**
- G1-H (CONUS, +24 and +48): the served candidate must beat each other arm on the class hit rate AND the wq·wg MAE at
  BOTH leads (Holm across {W0, W1, H0, H1} pairs × 2 leads × 2 metrics). Speed |ME| must not be worse.
- **Choosing the served CONUS wind:** the best arm that beats W0. If H0 ≥ H1 (no significant gain from MOS), serve H0.
  If H1 beats H0, serve H1. If no H arm beats W0, keep W0/W1 per G1.

**How this differs from the FAILED #728 (RATING_WIND_HRRR rework, so the failed design is not re-run).**
#728's design:
- 7 anemometers (L6), 3 short windows (2024-12, 2025-10, 2026-10-17..30), 70 days, 6 blocks;
- metric: whole-RATING MAE gain;
- arms: HRRR raw sampled at the nearest sea cell or bilinear with land dropped (A1 −0.02, A2 −0.13 rating points, CIs
  about ±0.8 to 1.0);
- verdict: FAIL, with no arm worse.
Diagnosis carried forward:
- sea cells fixed the speed slope (0.94 → 1.00) but worsened the vector error (3.09 → 3.32 m/s);
- the gulf and the west coast gained, while the east-coast piers lost;
- untested: at barrier coasts the nearest water cell may be a lagoon or sound.
This test differs in five ways:
1. **POWER:** CONUS NDBC + C-MAN + ASOS coastal stations frozen as of 2026-11-19, about 10× the stations, with ≥ 10
   three-day blocks in TEST. #728 was underpowered (CIs ±0.8-1.0 points), so its FAIL is "not shown", not "shown no
   gain".
2. **METRIC:** the wind-specific class hit rate plus the wq·wg MAE. That isolates wind error from the rest of the rating,
   which diluted #728's signal.
3. **MOS:** H1 corrects HRRR's vector error. #728 tested raw HRRR only, and its own diagnosis was a vector-error problem.
4. **CELL:** native 3 km bilinear, plus a pre-registered SENSITIVITY arm for barrier coasts. There, take the first HRRR
   cell on the OCEAN side along the paired spot's shore-normal, testing #728's untested lagoon hypothesis. Reported, not
   gating.
5. **No reuse of #728's looked-at data:** #728's 7 anemometers are EXCLUDED from the H-arm TEST scoring, because their
   2026-10-17..30 window overlaps this TEST window. Results with them included are reported as a sensitivity line only.
- **Report by region** (gulf, west, east), since #728 saw opposite signs. Holm across regions inside G1-H's "no region
  worse" check.
- **Amendment 2 clarification (wind lane, adopted, pre-data). Lead and issue matching, with two framings:**
  - **PRIMARY (model skill):** every arm on a row (W0, W1, H0, H1) comes from the SAME init time (00/06/12/18Z), at
    exactly +24 or +48 h. An arm counts only if it was published by that init's W0 availability time, so HRRR cannot win
    on recency.
  - **SECONDARY (as-served, reported):** at a fixed issue clock (e.g. 06:00 local), each arm uses its LATEST cycle
    actually available by then. This measures the real recency advantage users would get.
  - The serve decision follows PRIMARY. If SECONDARY shows an extra HRRR gain, report it as the product effect.

## AMENDMENT 3 (2026-11-19, before any data read): the advisor's five changes, all ADOPTED
1. **PRIMARY population = MARINE-EXPOSED stations only.** The rule is fixed now and computed from the ETOPO 2022 15 s land
   mask (the same source as `shore_normals.json`) before any data.
   - A station qualifies if it is a buoy, OR it is within 1 km of the open-ocean shoreline AND the whole onshore sector
     (the paired spot's shore-normal ±60°) is water for ≥ 5 km upwind.
   - Typically that means NDBC buoys, C-MAN, and pier/jetty NOS met sites.
   - ASOS and any other station failing the rule form a separate REPORTED stratum. W1 and H1 are FITTED on marine-exposed
     stations only.
2. **Serve W1/H1 ONLY in regions that had marine-exposed stations in TEST and passed G1 there.** Everywhere else the
   served wind stays W0. This replaces Amendment 1 item 8's "every spot worldwide".
3. **The +48 h HRRR seam and model choice.**
   - If H0/H1 is served in CONUS, the hand-off is a LINEAR BLEND from HRRR to the W arm over +42 → +48 h (no hard
     switch).
   - Seam check at the paired spots: the served wind factor wq·wg change across +45 → +51 h must have a median ≤ the
     median, and p95 ≤ the p95, of its natural 6-hour change at +30 → +42 h.
   - Model choice: in CONUS ≤ 48 h, HRRR feeds the RATING whichever model the user selects. The map wind layer shows the
     selected model, so they disagree by design.
     - Count it: the share of spot-hours where the rating's wind class differs from the class computed from the map
       layer's wind.
     - The UI states "rating wind: HRRR" (a11y text) when it applies.
4. **Season and +120 h.**
   - TEST covers October-November only. The sea-breeze season is in TRAIN only, so the result is valid for autumn and
     winter regimes. Stated plainly.
   - The live guardrail must watch the wind-class hit rate through summer 2027.
   - +120 h uses 5-day blocks, so only about 6 blocks: labelled FRAGILE in advance and REPORTED, not gating.
   - G1 now requires +24, +48 and +72 h (all three). +120 is reported.
5. **Free choices fixed.**
   - (a) Leave-station-out: within each region, sort the station ids lexicographically, shuffle with seed 20261119, and
     hold out the first ceil(20%).
   - (b) Station → spot pairing:
     - candidates are catalogue spots within 25 km great-circle;
     - keep those whose straight segment from the station does not cross land in the ETOPO 15 s mask (the same open
       coast);
     - choose the minimum distance, breaking ties by the lowest spot id.
     - No manual judgement.
   - (c) Shuffled-pairing control: "no gain" means the gain's 95% CI includes 0. If not, the run is VOID.
   - (d) Selection: an arm is served only if it beats EVERY other arm at BOTH +24 and +48 h under the pairwise Holm rule.
     If no arm does, the served wind stays as it is. No tie-breaking after the fact.
- **Unseen-data statement.** As of this amendment, the research lead has NOT scored GFS or EURO short-lead wind against
  these stations for 2026-10-16 → 11-15. The wind long-range lane's hindcast report, which uses station wind in that
  period, must stay UNOPENED by anyone working on 3b until 3b is scored. The wind lane is to confirm the same in
  writing.

## AMENDMENT 4 (2026-11-19, before any data read): blinding against the long-range wind hindcast
- The long-range wind hindcast's truth covers this TEST window (2026-10-16 → 11-15) at overlapping NDBC/ASOS stations.
- **Director's ruling, option 2:** an INDEPENDENT reader reads the hindcast score log: the "Haiku 5.5 researcher:
  state-of-the-art evidence" session, which has no 3b role.
  - It reports ONLY the pre-registered PASS/FAIL line and the ledger line, to the director and the wind lane.
  - No numbers or per-station detail reach the advisor, the research lead or the wind lane until 3b TEST is scored.
- **Fallback if the advisor objects:** option 1. The hindcast score log stays closed until 3b is scored.
- **Wind-lane attestation** (2026-11-19): it has not opened any hindcast report or score log (runs 44376282465,
  43952101715, 44107750669) and has seen no truth.
  - It downloaded only the station list, the land mask and the decoded forecasts of one run, for a mirror check.
  - It did not download the truth snapshot.
  - It is deleting those copies.
