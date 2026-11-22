# Gate: nearshore-moplite-v1
Stamp: 2026-11-22 (research lead; DRAFT for the advisor's read before any build. No coefficient, archive or TEST row exists.)
Candidate: `LITE`, per-spot, partition-resolved linear spectral transfer coefficients computed offline by backward ray tracing over public bathymetry ("MOP-lite"). Inside `surf_transform.estimate_surf_partitioned` they replace ONLY the global refraction constant `REFRACTION_KR` and the cosine exposure factor `_height_exposure_factor`. Shoaling to break depth, the depth-limited cap (γ 0.63-0.81) and the rating chain are unchanged (ONE FORECAST COMPOSITION).
Metric: M1 = Hs RMSE (m) at directional wave buoys in 10-40 m of water, per region. M2 = the same, per incoming-direction bin relative to the shore normal. Reported beside: Hs ME, Tp and mean-direction errors.
Pass threshold: section 6. `LITE` beats `CHAIN` (Holm one-sided) pooled and in the sheltered subset, is not worse in any region, and replicates in both halves of TEST. In California, `LITE` vs `MOP` is a TOST at ±10% (reported, not gating).
Controls: section 7 (null; +10% / +20% Hs plants; +20° / +40° direction-rotation plants that sheltered sites must feel; a bathymetry-swap control).
Decision rule: a pass allows `LITE` to ship ON for the covered spots under D-065 / D-080, with a kill switch and a SCOREBOARD row. Uncovered spots keep `CHAIN`. California EURO keeps MOP (D-069) unless a later gate says otherwise.
Unmeasured items: breaking height itself (buoys stand outside the surf zone; end-to-end needs spot observations); wave-current and wave-tide interaction; diffraction behind sharp obstacles (linear refraction only); spots without bathymetry finer than GEBCO.
Served change: none from this gate.

## 0. Why (research note `research/q8-nearshore-transform-sota-2026-11-22.md`, PR #1146)
- Outside California the chain has no spot-specific refraction or sheltering.
- MOP, an operational linear spectral refraction model [O'Reilly et al. 2016], beat the chain in the pre-registered nearshore judge (D-069). HyWaves-style per-partition downscaling reproduced Hs, Tp and direction at Pacific island sites [Ricondo et al. 2023].

## 1. Bathymetry: sources, licences, risk
| Priority | Source | Resolution | Licence (attribution in the result and in any served credit) |
|---|---|---|---|
| 1 (US) | NOAA NCEI Continuously Updated DEM (CUDEM) | 1/9 arc-second (~3 m) where available | U.S. Government work, public domain (NOAA NCEI) |
| 2 (US) | NOAA NCEI Coastal Relief Model (CRM, incl. the Southern California and Hawaii volumes) | 1-3 arc-seconds | public domain (NOAA NCEI) |
| 3 (Europe) | EMODnet Bathymetry DTM | 1/16 arc-minute (~115 m) | CC BY 4.0, "EMODnet Bathymetry Consortium (year): EMODnet Digital Bathymetry (DTM)" |
| 4 (global) | GEBCO_2024 Grid | 15 arc-seconds (~450 m) | public domain; attribution "GEBCO Compilation Group (2024) GEBCO 2024 Grid" |
| (check) | NOAA ETOPO 2022 | 15 arc-seconds | public domain (already used by the wind gate) |

- **Rule:** the finest source covering the whole ray domain of a target is used for that target. A target that needs GEBCO anywhere within 5 km of itself is tagged `COARSE`.
- **Risk, stated plainly:**
  - Linear refraction is only as good as the depth gradients it sees. At 450 m resolution, reefs, shoals and narrow headlands that focus or shadow swell are smoothed or missing.
  - Nearshore depths in global grids are often interpolated or satellite-derived, with errors of metres in water under 20 m.
  - MOP's advantage comes from survey-grade bathymetry plus full spectral propagation (Reflection review, 2026-11-22). `LITE` may not reproduce it outside surveyed coasts.
  - Hence: the California reproduction check (section 6), a separate `COARSE` stratum, and the bathymetry-swap control (section 7).
- Every downloaded tile is frozen with its sha256 before the coefficients are computed.

## 1a. Vertical datum: every depth is converted to MSL before ray tracing (advisor limit, 2026-11-22)
| Source | Native vertical reference (as documented) | Conversion to MSL |
|---|---|---|
| CUDEM | NAVD 88, metres (NCEI metadata, read 2026-11-22) | NOAA VDatum, NAVD 88 → LMSL, per tile; the VDatum grid version is recorded |
| Coastal Relief Model | EGM2008 or mean sea level for the newer volumes. The pre-2013 volumes kept each source's datum (bathymetry at MLLW or MLW; some shorelines at MHW), and NCEI states the vertical uncertainty is > 1 m, larger than the datum differences (NCEI CRM FAQ, read 2026-11-22) | per volume, from its metadata: MLLW, MLW or MHW → MSL with NOAA VDatum, or the nearest NOAA CO-OPS station's published datums where VDatum has no grid. EGM2008 is treated as MSL. A volume whose datum cannot be established is tagged `DATUM_1M` and reported as its own stratum |
| EMODnet DTM | Lowest Astronomical Tide (LAT; tile metadata, read 2026-11-22); an MSL variant is published | the MSL variant is downloaded. If it is unavailable for a tile: MSL depth = LAT depth + (MSL − LAT) from the EMODnet tide model, recorded |
| GEBCO_2024 | nominally mean sea level (NOT verified in this session) | treated as MSL; these targets are `COARSE` already |

- **Seam check at source joins (advisor, 2026-11-22; BEFORE the coefficients are frozen):**
  - **Per target**, at EVERY join between two sources inside that target's ray domain, both depths are first converted to MSL by the table above. The joins include:
    - a FINE source (CUDEM, CRM or EMODnet) meeting GEBCO, where the `COARSE` rule lets GEBCO in;
    - CUDEM ↔ CRM tile joins;
    - CRM volume ↔ CRM volume and EMODnet ↔ GEBCO joins.
  - **Measure:** the median and p95 of the absolute depth difference between the two converted sources, over their overlap on a common grid. Where the sources do not overlap, it is taken across the join, between the nearest cells on each side within 2 cells of the finer source.
  - Only water shallower than 30 m counts toward the trigger. Both statistics are reported for every join of every target.
  - **Trigger:** p95 > 1.0 m in water under 30 m tags the target `SEAM`. `SEAM` is its own reported stratum, like `DATUM_1M`; a target can carry both tags.
    - The coefficients of a `SEAM` target are still computed as registered; the tag only stratifies the report.
  - The per-target seam table (target, join, sources, n cells, median, p95, tag) is committed with its sha256 beside the coefficient hashes.
  - **No coefficient is frozen before the datum conversion and the seam table are both committed.**
- **Why it matters:** in water under about 10 m, a 0.5-1 m datum error is a 5-20% depth error. That moves the shoaling and the breaking-limited heights, and bends the shallowest rays.
- **Water level during TEST:** rays are traced on the MSL surface, as the stationary linear method assumes.
  - The tide (FES η about MSL) is NOT added to the ray depth in `LITE`.
  - A reported arm `LITE_ETA` adds the hourly η to the target depth for shoaling only.
  - The breaking cap in serving already takes η (PR B), in the same MSL frame.
- **MLLW** (chart datum) is display-only and never enters this computation.

## 2. The coefficients (computed once, before TEST; nothing fitted to buoys)
- **Target:**
  - each truth buoy's position and charted depth (for the test);
  - later, each covered spot's transfer point, the 15 m contour along the spot's shore normal (for serving).
- **Offshore boundary:** the wave-model grid point the chain already reads for that target, unchanged.
- **Method:** backward ray tracing, linear, stationary, no currents (the O'Reilly and Guza linear spectral refraction approach as used by MOP).
  - Frequencies: 0.04-0.25 Hz in 0.01 Hz steps.
  - Directions: every 2°.
  - Ray step: ≤ 1/10 of the local wavelength.
  - A ray that reaches land, or leaves the domain on the shore side, carries zero energy (sheltering).
- **Transfer:** `K²(f, θ)` = the ratio of target to boundary energy density along the ray, by conservation of wave action, including shoaling to the target depth.
- **Applied per partition:**
  - Each served partition (Hs, Tp, mean direction) is expanded to a frozen parametric spectrum: JONSWAP with γ = 3.3 for swell and 1.0 for wind sea, and cos^2s spreading with s = 20 for swell (Tp ≥ 10 s) and s = 4 for wind sea.
  - It is multiplied by `K²`, integrated, and summed over partitions → `Hs`, `Tp` and mean direction at the target.
  - **Spectral-shape sensitivity (reported, never gating):**
    - `LITE_S10` and `LITE_S40` use swell spreading s = 10 and s = 40.
    - `LITE_G1` uses JONSWAP γ = 1.0 for swell.
    - SubQ ranked the fixed parametric shape as the most likely failure mode (model confidence 0.53 in that ranking), and judged fixed spreading acceptable for a first test (model confidence 0.80). These are a model's confidence in its own ranking, NOT statistics. These arms show how much the verdict depends on the choice.
- **Frozen artifacts:** a coefficient file per target (f × θ table plus its sha256), committed before the first TEST init. A scorer that finds a hash mismatch refuses to run.
- **Serving form (after a pass):**
  - `LITE` gives Hs at the transfer point.
  - The chain then shoals from the transfer depth to break depth and applies the cap as today.
  - `REFRACTION_KR` and the exposure factor are NOT applied to `LITE` output (that would double-count direction, as the module warns).

## 3. Arms
| Arm | What | Role |
|---|---|---|
| `CHAIN` | today's `estimate_surf_partitioned` at the buoy depth WITHOUT the breaking cap: shoaling × `REFRACTION_KR` × exposure, with the same served partitions | comparator |
| `LITE` | section 2 at the buoy | gated |
| `MOP` | CDIP MOP **forecast** (ECMWF-driven, as served under D-069) at the MOP point nearest the buoy (≤ 3 km), California only. NOT the MOP hindcast, which is initialised from CDIP buoys and would leak the truth | California benchmark |
| `LITE_EC` | `LITE` driven by the ECMWF (EURO) partitions, California only, so the `MOP` comparison has the SAME offshore forcing (Reflection review) | the TOST arm against `MOP` |
| `OFFSHORE` | the boundary partitions summed, no transformation | floor, reported |

## 4. Truth
- Directional wave buoys moored in 10-40 m of water, outside the surf zone. Hourly Hs, Tp and mean direction.
  - **NDBC-owned stations:** licence-clean (U.S. public domain).
  - **CDIP stations: EXAM ONLY** (programme rule). Valid here because `LITE` fits nothing to any buoy. CDIP data never feed a coefficient, a constant or a choice.
  - **Copernicus Marine In Situ** coastal wave buoys in Europe: free with attribution, "Generated using E.U. Copernicus Marine Service Information".
- **Exclusions, fixed now:**
  - USACE FRF Duck (non-commercial);
  - any buoy whose own data assimilate into the driving wave model's boundary at that point (checked at freeze);
  - any buoy within 1 km of a harbour structure that the bathymetry does not resolve.
- **Station list:** frozen from the catalogues at freeze by these rules only, with ≥ 70% of TEST hours present (checked at score time). Nothing is chosen by skill.
- **Regions:** US West, US East + Gulf, Hawaii and Pacific islands, Europe Atlantic, Mediterranean, California (its own region, for the MOP check), `COARSE` (any region; a stratum).
- **Sheltered subset (fixed now from the frozen bathymetry):** buoys whose open-ocean angular window, the arc of directions from which a straight 50 km line stays in water deeper than 50 m, is < 90°.
  - It is computed from station geometry and bathymetry ONLY: no observed or forecast direction enters it.
  - It is frozen with the station list.
- **Bathymetry strata:** `FINE` (the whole ray domain from CUDEM, CRM or EMODnet) and `COARSE` (GEBCO used within 5 km). Each target is in exactly one, fixed at freeze.

## 5. Window and inputs
- **Forward only.** The served offshore partitions (the same model member the chain uses, per region) are archived per 00Z init with sha256, by a GitHub Actions job (never the Render box).
- 90 daily inits (Reflection: 60 understates synoptic persistence), starting no later than 2027-01-15 so northern winter and spring are both inside. The halves of section 6 are the first and last 45 inits.
- Leads 0-72 h. The test isolates the transfer, so short leads keep offshore forecast error small. The boundary-partition error is reported by lead.
- **Missing-run rule:** an init missing any partition step to 72 h is dropped for all arms. `MOP` lines use only the inits where `MOP` is complete.

## 6. Statistics and pass rules
- **Bootstrap:** paired moving-block bootstrap over valid dates, **7-day blocks**, B = 10,000, seed 20261122. Whole dates are resampled with all buoys together. 5-day and 14-day blocks are reported only.
- **Families:**
  - F1: `LITE − CHAIN` on M1 per region (excluding California) + pooled + sheltered + `FINE` + `COARSE`. One Holm family, one-sided "better".
  - F2: `LITE − CHAIN` on M2 per direction bin (|incoming − shore normal| in 0-30°, 30-60°, 60-90°, > 90°). One Holm family.
  - The worse-direction lines of F1 form their own family.
- **Pass (all):**
  - pooled F1 better;
  - `FINE` F1 better (the physics must win where the bathymetry is good: Reflection review);
  - sheltered F1 better;
  - no region Holm-worse;
  - same sign with at least half the pooled effect in both halves of TEST.
  - **`COARSE`:** `LITE` ships on `COARSE` targets only if the `COARSE` line is also better. If it is merely not worse, those targets keep `CHAIN`.
- **California reproduction:** a TOST on `r = RMSE(LITE_EC)/RMSE(MOP) − 1`, margins ±0.10, at California buoys. Same ECMWF forcing on both sides.
  - Equivalent → the public-bathymetry method reproduces MOP where it can be checked.
  - Not equivalent and worse → report it as the bathymetry risk realised. `LITE` may still pass elsewhere on F1, but the result says so.
  - It never overrides D-069 in California.
- **Floors (VOID if unmet; a region below its floor is insufficient):**
  - ≥ 75 kept inits and ≥ 10 seven-day blocks;
  - ≥ 25 buoys total, ≥ 4 per gated region, ≥ 6 in the sheltered subset;
  - ≥ 3 California buoys with MOP points for the TOST (else that check is "not run").

## 7. Controls (VOID if any misbehaves)
- **Null:** `CHAIN − CHAIN` = 0.
- **Height plants:** `LITE` × 1.10 (1×) and × 1.20 (2×). The ME test must catch 2×.
- **Direction plants:** every incoming partition direction rotated +20° (1×) and +40° (2×) before `LITE` is applied. In the sheltered subset, `LITE`'s RMSE must rise significantly at 2×. If it does not, the coefficients are direction-blind where direction matters most: VOID.
- **Bathymetry swap:** `LITE` recomputed with GEBCO everywhere, for the US targets that have CUDEM/CRM. Reported, not gating. It measures how much skill the finer bathymetry buys, which is the stated risk.
- **Leak:** coefficient and archive hashes match; no TEST valid time precedes the freeze; no CDIP value touched a coefficient (the code path reads no buoy data before scoring).

## 8. One look, stop rule, reader
- Scored once, after the last init plus 72 h.
- No re-scoring, no new arm, no changed constant (JONSWAP γ, spreading s, frequency and direction grids, the sheltered rule).
- The first reader is the advisor.

## 9. Open before freeze
- The ray tracer: an open-source implementation, or our own. A build PR to the advisor, with unit tests against analytic refraction over a plane beach (Snell's law) and a shoal (a known caustic).
- CUDEM / CRM / EMODnet / GEBCO tile list per target, and download sizes. These are offline fetches; dispatch needs David's word.
- The NDBC and Copernicus coastal buoy list at 10-40 m, with depths. CDIP list (EXAM).
- MOP forecast point availability and horizon for the California check (D-069's open item).
- Compute budget: CI only, offline, once per target. Nothing runs on the Render box.

## 10. How the evidence behind this gate was read (advisor limit, 2026-11-22)
- The literature motivating this gate is in `research/q8-nearshore-transform-sota-2026-11-22.md`.
- Its references are **Consensus search records (abstract level)** unless marked below.
- **O'Reilly, Olfe, Thomas, Seymour and Guza (2016)**, Coastal Engineering 116, 118-132, doi:10.1016/j.coastaleng.2016.06.005:
  - full-text re-read ATTEMPTED 2026-11-22 and NOT reached (no open copy);
  - the bibliographic record and the abstract-level claims (a buoy-driven linear spectral refraction model to ~20 m depth; skilful at most sites; large errors for individual events; low skill in the Santa Barbara Channel and southern Monterey Bay) were confirmed from the paper's record and CDIP's model documentation page.
  - Abstract-level.
- **Ricondo, Cagigal, Rueda, Hoeke, Storlazzi and Menéndez (2023)**, Ocean Modelling 184, 102210, doi:10.1016/j.ocemod.2023.102210:
  - full text NOT reached;
  - the bibliographic record confirmed via the USGS publications page (70244145), which lists an open-access version at the publisher.
  - Abstract-level: per-partition hybrid downscaling validated at Samoa, American Samoa, Majuro and Kwajalein; one summary notes Tp skill weaker than Hs.
- **Datum facts** in section 1a: from NCEI metadata (CUDEM), the NCEI CRM FAQ, and EMODnet tile metadata, as read via search on 2026-11-22. The GEBCO datum is not verified.
- **SubQ and Reflection outputs** are advisory model opinions. A SubQ number is a model's confidence in its own ranking, NOT a statistic.
