# Step 5 calibration design, the "agency teacher" review, and the period/wind ordering (research lead, 2026-11-19)

DESIGN ONLY: no dispatch, no data write, no fetch without David's word. Sources marked VERIFIED were read live;
everything else is marked UNVERIFIED or "from literature/memory".

## Part C first (the director's ordering question): YES, period and wind get their own step, BEFORE step 4
- **Why.** The rating's level flips come 36% from period, 31% from wind and 13% from height (repair lead's measure).
  Steps 1, 2 and 4 mostly move height.
- **Truth is cheap and licence-clean for both.**
  - Period: NDBC spectral buoys (dominant and peak period, public domain), already in our scored ledger.
  - Wind: NDBC buoy and C-MAN stations, and NOAA ASOS/METAR coastal stations (public domain). Abroad: the national
    met services' open SYNOP/METAR.
  - There is far more of this truth than breaking-height truth.
- **Proposed order:** 3 (the cap-period rule gate, D-081) → **3b (period + wind correction vs station truth)** → 4 (the
  per-spot transfer K) → 5 (height calibration) → 6 (uncertainty). Pins-first (only 20 of 1,773 verified) gates 4 and 5,
  not 3b: 3b is judged at stations, not at pins.
- **3b content:**
  - (a) Period: a regional bias and scale correction of the served swell period by lead, judged vs NDBC peak/dominant
    period (MAE + ME). It must be done after the D-081 rule is chosen, because the rule changes which period is served.
  - (b) Wind: direction-aware MOS of 10 m wind at the coast. Onshore/offshore classification accuracy matters more to the
    rating than speed MAE, so the primary metric is the hit rate of the rating's wind class (offshore / cross / onshore
    × strength band), with speed MAE + ME as secondary.
  - (c) The gate: the corrected arm beats the uncorrected one on held-out time blocks. Use paired block bootstrap
    (3-day), Holm across leads, a null (shuffled stations) and a planted positive control.
  - (d) Rating-level outcome: report the level-flip rate change on the held-out block. That is the number David cares
    about.

## Part B: step 5, calibration against truth

### B1. Truth we MAY use (licence-checked or to be checked; USACE FRF is EXCLUDED as non-commercial)
| Truth | What it observes | Use | Status |
|---|---|---|---|
| In-app check-ins / photographer reports (T1) | Breaking size class (ordinal), quality | Height and quality calibration at spots | Volume too low when last counted. Blind entry + server provenance per the T1 prereg (#989/#992 lineage). |
| Sentinel-2 (ESA, free and open) | Surf-zone foam width; breaking yes/no | ORDINAL consistency only (see A4) | Usable as a weak signal, not height truth |
| Sentinel-1 SAR (free and open) | Swell wavelength (gives period) and direction near the coast | Period/direction validation (3b), sector checks for K | Usable |
| CDIP nearshore buoys + MOP (Scripps) | Nearshore Hs/Tp/direction, CA etc. | The best nearshore truth in the US | LICENCE QUESTION OPEN with David: does the "no USACE" rule cover CDIP (USACE co-funded)? Until answered, use for research only, not for fitting served values. |
| NDBC (public domain) | Offshore Hs, period, direction, wind | Inputs (3b), offshore bias | Usable |
| Oahu lifeguard record (T4) | Daily surf-height estimates by observers, by shore | Ordinal height truth, Hawaii | ACCESS AND LICENCE UNCONFIRMED (the NCEI holding is not checked). Do not plan on it until read. |
| CMEMS In Situ TAC (Europe) | Coastal buoy Hs | European nearshore-ish truth | Usable (CMEMS licence) |

### B2. The metric
- **Height at a spot (ordinal truth):** the ranked probability score (RPS) of the served size class against the
  observed class. The served height is turned into class probabilities using the step-6 spread. Report the hit rate of
  the exact class and of ±1 class. **Bias:** the mean signed class error (the ME analogue) beside RPS, because RPS alone
  can hide a consistent under-call.
- **At buoys (continuous truth):** MAE + ME of Hs in metres, with 3-day blocks.
- **The rating outcome:** the level-flip rate vs truth-derived levels where truth supports a level.

### B3. The calibration model (low-dimensional, partial pooling)
- **Form:** log(H_obs / H_served) = b_region + b_site + g(direction sector, period bin) + ε.
  - Fit as a hierarchical model, so a site with little truth borrows its region's correction (no free per-site
    parameter without data).
  - g is smooth, shrunk to zero, and fitted only where the region has at least N truth points per sector.
  - For ordinal truth, fit the same structure inside an ordinal (cumulative-logit) likelihood.
- **Why this form:** our research found about half of a site's error is a stable bias (b_site), and that a free
  per-sector fit from short records is ill-posed (the 11-03 finding: weak sectors were off by up to 4e4×). So the
  pooled and shrunk version is the only one that survives sparse truth.
- **Cold start:** a spot with no truth gets b_region only, and is flagged "regional correction".

### B4. No leakage: how the step-4 K and the step-5 correction are fitted and validated
1. **Disjoint data roles.**
   - K (step 4) is fitted on MODEL data: the agency teacher, or physics. It is never fitted on step-5 truth.
   - Step 5 is fitted on TRUTH, on the residual after K. So the truth never tunes K directly. If the truth is ever used
     to choose K's form, that choice uses the TRAIN block only.
2. **Time-blocked splits.** TRAIN = earlier months, TEST = later months, with a ≥ 10-day gap (wave errors persist 3-5
   days). No random row splits.
3. **Site holdout.** Within each region, 20% of the spots are held out entirely (the T1 rule). This measures
   cold-start performance, i.e. what most of the catalogue gets.
4. **Check-in anchoring.** Users may have seen our forecast before reporting. Use blind-entry check-ins only, or weight
   them by provenance (the T1 rules). Report the effect as a sensitivity arm: blind-only vs all.
5. **Pins.** A spot's correction is only as good as its pin. Only human-verified pins get b_site; unverified pins get
   b_region. Report the split.

### B5. The pre-registered gate (draft for the advisor)
- **PASS** if, on the TEST block, all of these hold:
  - (a) the corrected arm's pooled RPS beats the uncorrected one, with the paired block-bootstrap 95% CI lower bound
    > 0;
  - (b) the mean signed class error moves toward 0 (CI excludes "worse");
  - (c) no region is significantly worse after Holm;
  - (d) held-out sites (cold start) are not worse;
  - (e) the rating level-flip rate does not rise.
- **Controls:**
  - null: shuffled site labels gives no gain;
  - positive: a planted +30% height bias at a random 20% of sites is recovered (its b_site CI covers the plant);
  - minimum truth volume per region before it is scored (n ≥ 200 truth-forecast pairs; else "insufficient").
- **Ships ON** with a kill switch (D-080) and a SCOREBOARD row. The kill switch falls back to the uncorrected chain.

## Part A: attacking the "agency teacher" idea (repair lead, fable-better-path-agency-nearshore-teacher-2026-11-19.md)
**Verdict: a GOOD idea, and the right shape for step 4 where a validated teacher exists.** It is model distillation /
MOS against a higher-resolution model. Its limits are below.

**A1. Is a 0.5-2 km teacher worth learning from, given it does not resolve a reef?**
- YES, for the part it resolves:
  - shelf-scale refraction, island and headland sheltering, and swell-window blocking at km scale;
  - that is most of the offshore→nearshore change in Hs between deep water and about 10-20 m depth.
- NO, for the last few hundred metres (reef/bar focusing, wave breaking). Keep OUR depth-limited breaking step
  (`estimate_surf_at`) for that.
- So: learn the teacher at its nearshore cell in about 10-20 m of water, PRE-breaking, and keep the one chain's
  breaking step after it.
- SWAN (NWPS) is phase-averaged and handles diffraction behind headlands poorly (from literature). Expect teacher errors
  in sheltered coves.
- **Condition:** the teacher must itself pass vs nearshore buoys where they exist (row 19a, the NWPS test vs CDIP). A
  coast where the teacher fails is not taught.

**A2. What fit survives few lit sectors?**
- Fit in ENERGY per swell train: Hs² is additive across partitions.
- Per spot, use a 4-5-parameter form: K²(θ, T) = a · W(θ; θc, σ) · S(T).
  - W is a wrapped-Gaussian (or cos^p) directional window centred on the spot's exposure θc.
  - S is monotone non-decreasing in period (shoaling and refraction grow with T), log-linear.
- Hierarchical shrinkage of (a, θc, σ, S-slope) toward:
  - (i) the region's prior;
  - (ii) the physics K we already have, from `surf_transform` / `resolve_surf_geometry`'s exposure.
- Unlit sectors fall back to the prior; they are never extrapolated.
- **Data:** NWPS keeps about 5 days on NOMADS, so a teacher ARCHIVE must start now (it is the gating cost: one season per
  spot for sector coverage).
- Serve a spot's fitted K only when the observed sectors cover ≥ X% of that spot's climatological swell energy
  (pre-register X, e.g. 70%). Otherwise use the prior.
- Validate the fit by holding out the most recent teacher weeks (time-blocked) and holding out sectors (does the prior
  predict an unseen sector?).

**A3. Copernicus regional wave products (Europe teachers): UNVERIFIED details.**
- Catalogue snippets read 2026-11-18:
  - MEDSEA_ANALYSISFORECAST_WAV_006_017: 0.042° (about 4.6 km), hourly, twice-daily runs;
  - NWSHELF_ANALYSISFORECAST_WAV_004_014: catalogue 0.013° × 0.03°, conflicting with a 1/20° statement;
  - IBI_ANALYSISFORECAST_WAV_005_005: resolution not found.
- CMEMS wave products commonly carry the partitions VHM0_SW1/SW2 and VHM0_WW with directions and periods, but this is
  UNVERIFIED per product. Read each product's variable list and horizon from its catalogue/STAC before planning.
- DWD EWAM: about 0.05° × 0.1°, to about +78 h, with wind-sea + total-swell partitions (folders VERIFIED on opendata).
- These are coarser than NWPS (km, not sub-km), so they are teachers for regional sheltering only.

**A4. Is Sentinel-2 surf-zone width usable for breaker height?**
- Only weakly. On a planar beach the surf-zone width X ≈ Hb / (γ tanβ). It depends on the slope (unknown, varies with
  the tide), the tide stage, foam persistence and cloud, at 10 m pixels with a 2-5 day revisit and one snapshot time.
- Usable as:
  - (i) breaking yes/no;
  - (ii) an ORDINAL size class where a slope estimate exists (S2 satellite-derived bathymetry / CUDEM);
  - (iii) a consistency check that a "lit" sector really produces breaking.
- NOT a metric height truth. Treat it as low-weight ordinal evidence in B3, never as the gate's primary truth.
- Sentinel-1 is better for period and direction (3b, and checking K's directional window).

**A5. Coverage: what share has no teacher?**
- Teachers exist for: the US (NWPS, 34 coastal offices; the Pacific region was empty when checked); Europe 30-66°N
  (EWAM, CMEMS regional).
- No public teacher identified for: Australia, NZ, Japan, Indonesia, Pacific islands, Latin America, Africa, the
  Indian Ocean.
  - Australia's BoM regional wave models: licence unverified, assume excluded.
- I cannot count shares without the catalogue. Ask the repair lead to run ONE aggregate SQL (counts only) of active
  spots by region box, like `fable-uncovered-spots-count-2026-11-18.md`.
- My expectation, unmeasured: a large share (plausibly 30-50%) has no teacher. Those spots get the physics K plus the
  step-5 regional correction. The teacher is an upgrade for the US and Europe, not the global method.

**Net plan:** step 4 = the physics K everywhere (prior), plus teacher-distilled K where a teacher passes vs buoys (US,
Europe), plus the step-5 truth-based pooled correction on top, with disjoint data roles (B4).

## Part D: reply to the repair lead's revision (2026-11-19): band as consensus unblocker, near-coast bias, shape from imagery

**D0. The USACE rule's reach (my record).**
- Context: on 11-15 I found that FRF (USACE Field Research Facility, Duck) data carries a non-commercial licence. David
  then said (22:15 EST) "Skip using USACE and innovate free ways…".
- The wording is broad, but its context was FRF. CDIP is run by Scripps (co-funded by USACE and California Parks), and
  the D-080 guardrail already scores 6 CDIP California stations.
- I do NOT know whether David meant CDIP. This is an owner question, so ask it directly, with that inconsistency stated.

**D1. The band as the consensus unblocker.**
- YES for the POINT/rating path. The +48/+72 h defect was tier MIXING (fine and coarse members in one blend). A band that
  holds all three members at 0.25° to their native horizons makes the members' resolution uniform.
- Conditions:
  - (a) Band rows carry their own tier label (e.g. `band_0p25`). G1a's decision classes must add it, or the ledger guard
    cannot judge band-built consensus rows.
  - (b) Add the arm: the equal 3-member mean from band values vs served GFS. Paired, MAE + ME, per lead × tier,
    replication halves, inside the band's pre-registration. This is the same question as the archive-read Read B,
    answered on band rows.
  - (c) One-chain consistency. If the map shows a consensus field anywhere, a band-built point consensus and a
    tile-built map consensus can disagree. Either the map stays per-model, or its consensus must use the same member
    sources. Pin it with a contract test.
  - (d) The EURO member in the band follows the band's three-arm EURO read (MFWAM vs ECMWF 0.25 vs 0.1), so the
    consensus inherits that choice.
- The regional TILES are NOT required for the blend's correctness. They are for the map.

**D2. Near-coast low bias: do not pick the reference cell a priori. Pre-register two arms.**
- Arm (i): the nearest wet band cell (today's rule).
- Arm (ii): the first band cell seaward with depth ≥ 50 m along the spot's swell window. This reuses
  `resolve_surf_geometry`'s exposure, not the straight-line nearest cell.
- Score both vs NDBC/CMEMS coastal buoys with MAE + ME. The −0.29/−0.34 m near-coast altimeter figure may be partly
  ALTIMETER coastal contamination, not model bias. So the buoy ME decides, not the altimeter.
- Also check: a seaward reference changes what `estimate_surf_at` must transform (more shoaling distance). The chain's
  K/shoaling must be consistent with the depth of the reference cell.

**D3. Shape from imagery: the hardest attack.**
- **What breaking intensity can identify.** A Sentinel-2 white-water measure at a fixed overpass time (~10-11 local)
  responds to
  offshore energy × K(θ, T) × tide (slope and depth) × wind (whitecaps) × foam persistence,
  and it saturates at both ends (below detection on small days, a fully white surf zone on big days).
- **Confounds and their remedies:**
  - (a) Direction-period collinearity: many coasts get long period from one sector only, so K(θ) and S(T) are not
    separable there. Remedy: fit the direction window only where ≥ 2 sectors each carry ≥ 20% of the spot's energy with
    overlapping period ranges. Otherwise report "not identifiable".
  - (b) Tide: include a tide term from our tide model (the FES/CMEMS series), or stratify by tide stage.
  - (c) Wind: drop scenes with local wind above a threshold or with onshore wind sea, or add a wind term. Whitecaps
    from wind sea are not surf.
  - (d) Cloud and revisit: about 30-70 usable scenes a year per spot. The 2017-2026 archive gives about 200-500 scenes,
    enough for 2-3 sectors, not a full table.
  - (e) Saturation: use a rank/ordinal (isotonic in offshore energy) model, not linear.
- **Inputs must be ANALYSES or hindcasts** of the offshore swell at the scene time, not forecasts, so that forecast
  error isn't learned as "shape".
- **Smallest pre-registered pilot. YES to about 30 spots, chosen BEFORE looking at imagery:**
  - Selection from geometry only: `resolve_surf_geometry` shows one clearly blocked sector (island or headland lee),
    AND ≥ 2 other sectors each carry ≥ 20% of the energy. Pins must be human-verified.
  - Primary outcome: the imagery-learned direction window places its minimum response (or its 50% edge) within ±30° of
    the geometric shelter direction.
    - Chance rate is about 60/360 = 1/6, so the expected count is 5 of 30.
    - PASS needs ≥ 12/30. P(X ≥ 12 | n = 30, p = 1/6) ≈ 0.002.
    - Null: circularly shift the swell directions per spot, which must give ≤ chance.
    - Positive control: plant a synthetic scene set with a known window, which must be recovered.
  - Secondary outcome: out-of-time prediction (hold out the last 12 months) of the white-water RANK. The
    direction-aware model must beat a direction-blind one (offshore energy + period + tide only) on Spearman ρ, with a
    paired block-bootstrap CI lower bound > 0. This is the test the adviser's Sentinel-2 work did NOT pass for the
    chain vs a one-line rule, so it is the honest bar.
  - If the primary passes and the secondary doesn't, imagery locates shelter but doesn't improve prediction. Use it only
    as a prior for K's window, not as the shape.
- **"Level from truth" is right.** Imagery has no absolute scale. The level comes from the teacher, CDIP (if allowed),
  near-shore altimeter passes (with a coastal-contamination check) or check-ins, via the step-5 b_site / b_region model.

## Part E: facts received 2026-11-19 (repair lead)
- **Teacher coverage**, one aggregate SQL on 1,769 active spots, by rectangular boxes (a domain count, not
  coastline-exact):
  - US NWPS domains: 488 (27.6%): Gulf + East 325, West 90, Hawaii 45, PR/USVI 28.
  - Europe EWAM box: 386.
  - Assumed IBI-only box (Canaries, Madeira, west of 10.5°W): 44, from the repair lead's ASSUMED IBI limits.
  - **No agency teacher: 851 (48.1%)**: Indonesia, the Pacific, Africa south of 30°N, Latin America, Australia.
  - So the teacher reaches at most about half the catalogue, and step 5's regional correction (B3) carries the rest.
- **USACE rule (director): "skip USACE FRF (non-commercial licence)", Duck only.** CDIP is NOT covered by it.
- **CDIP data-use page** (as read by the repair lead): "freely available for public use, provided that they are not
  altered in any way", with a link-back for web displays.
  - Research view: CDIP is clean as VALIDATION truth (scoring, unaltered, credited).
  - FITTING served values from CDIP (e.g. K from MOP coefficient tables, or b_site from CDIP buoys) produces derived
    values. Whether "not altered" bars serving derived numbers is UNCLEAR.
  - Recommendation: ask CDIP in writing before any served value is fitted on CDIP. Until then, CDIP is validation-only
    (a test arm, not a training source).
- **T1 crowd-truth supply (surf-truth lane, read-only counts, 2026-11-19 ~00:30Z):**
  - The blind form (`surf_observations`, blind_v1) has 0 rows; its anchors and media are 0 too.
  - Legacy (not blind): 189 condition_reports (Florida Space Coast only, 2-3 internal reporters, numeric size on 3
    rows), 9 check_ins, 4 surf_reports.
  - **Consequence for step 5: no crowd truth is usable today.** Step 5's first gate runs on EXTERNAL truth only:
    - NDBC / CMEMS in-situ for offshore inputs and the 3b period/wind;
    - CDIP as validation-only;
    - Sentinel-2 ordinal.
  - Crowd truth (blind_v1) joins later, as a consented stream, once its pre-registered volume minimum is met.

## Part F (2026-11-19): truth roles after the owner's CDIP words, and the CDIP audit
- **Owner words:** "Scripps is allowed"; and, on drafting a question to CDIP: "No lets not send a message, do another
  route, innovate".
- **Route (repair lead), adopted:** CDIP is the EXAM, never the textbook.
  - No served number is fitted on CDIP. CDIP buoys and MOP are scoring only, unaltered, with a link back.
  - Fitting uses: the NWPS teacher, the altimeter near-coast bias, the S2/S1 shape prior, our own check-ins, and
    NOAA-OWNED buoys only. The station list carries an owner column from NDBC's station table, because some
    NDBC-listed stations are Scripps-operated.
  - b_site in California is fitted on check-ins and the teacher, and scored on CDIP.
- **Audit (code on dev):**
  - `SURF_NEARSHORE_MOP` is ON in production (code default "1" since 2026-11-05; all lanes pass ''). It feeds CDIP
    MOP's nearshore sea into `estimate_surf_at` at covered California spots. That is CDIP data in the served chain,
    contrary to the route. ESCALATED to David via the director: (A) keep / (B) off / (C) keep interim and re-judge on
    non-CDIP truth. Research recommends (C).
  - `SHORE_NORMAL_MOP_CALIBRATED` = "0" (its data file is fitted on CDIP MOP). It must stay off under the route.
  - `SURF_SPECTRAL_K` (#706): dark, CDIP MOP ray K. Not under this route.
  - No ×1.27 or 0.873 constants were found in `services/weather_pipeline`.

## Part G (2026-11-19): the advisor's alignment audit, row 1. CONFIRMED, with a rule added
- **The finding:** step 5's b_region served at spots with NO truth is, in effect, a region-level debias. 11-02 DROPPED
  region-level Hs debias.
- **Research view:** the quantities differ.
  - 11-02 was an offshore-Hs regional debias, which did not help.
  - b_region is a breaking-height log-ratio fitted on nearshore truth.
  - But the risk is the same: a regional mean correction applied where it was never tested.
- **RULE ADDED:**
  - b_region is SERVED at no-truth spots ONLY if gate (d) (held-out sites, cold start) shows a significant improvement
    in that region, not merely "not worse".
  - Otherwise no-truth spots get NO step-5 correction, and only spots with their own truth (b_site) are corrected.
