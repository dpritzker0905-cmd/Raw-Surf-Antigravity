# Gate: currents-skill-v1
Stamp: 2026-11-22 (written by the research lead; DRAFT until the advisor's line on the commit that freezes it. Nothing in TEST exists at writing time.)
Candidate: per-picker ocean-current sources as served (ECCC GIOPS under ICON, NOAA Global RTOFS under GFS, Copernicus GLO-PHY at native 1/12°), each against the default Copernicus GLO-PHY 0.25° set, scored against independent HF-radar and drifter truth.
Metric: M1 = vector RMSE (m/s) of the 25 h low-passed surface current against HF-radar totals, per region × lead day. M2 = 72 h Lagrangian separation (km) of virtual particles against drifters, per zone. Full definitions in section 4.
Pass threshold: section 6 (better = Holm-significant one-sided improvement over the default; comparable = 90% CI inside ±10% of the default's own metric).
Controls: section 7 (null, shuffled valid time, +0.05 m/s speed plants at 1× and 2×, +30° / +60° direction plants, 1-cell field shift). A control that misbehaves makes the run VOID.
Decision rule: per (source, region, lead day) cell, a label of BETTER / COMPARABLE / NOT SHOWN is allowed in the picker credit only where section 6 holds. Every cell that is not measured, or misses a floor, is NOT SHOWN.
Unmeasured items: surf-zone currents (rips, longshore flow; no source resolves them); regions without HF radar or drifter floors; leads past day 7; the open-ocean SMOC product (reported only).
Served change: none from this gate. Any skill wording in the credit is an owner decision, taken after the verdict.

## 0. Why, and what this cannot claim
- Research note `research/q3-surface-current-source-skill-2026-11-22.md` (PR #1141): no published study ranks RTOFS, GIOPS and GLO-PHY on the same truth by region. The best intercomparison found the systems statistically similar (Aijaz et al. 2023).
- Today the pickers serve each named model as a LABEL. This gate is the only route to a SKILL claim.
- **Independence of truth (checked at freeze, recorded in the result's first line).** None of the three systems is known to assimilate drifter velocities or HF-radar currents:
  - GLO12 assimilates SLA, SST, in-situ T/S and sea ice (QUID 001-024 §II);
  - RTOFS and GIOPS assimilate SSH, SST and T/S.
  - If a release note shows velocity assimilation for any source, that source's rows from that truth type are reported, never gated.
- D-082 agency sources only, licence-clean: Copernicus Marine (free, attribution); NOAA RTOFS, HFRNet and GDP (US public domain); ECCC GIOPS (Open Government Licence – Canada plus the ECCC End-use Licence, attribution).

## 1. Arms
Each arm is what the map serves (the frame-set publisher's output), unless marked.

| Arm | What | Role |
|---|---|---|
| `CMEMS_025` | `cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i`, uo/vo at 0.494 m, instantaneous, 3 × 3 vector mean onto 0.25°, 6-hourly | **the default; every comparison is against it** |
| `GIOPS_025` | ECCC GIOPS 0.2° lat-lon, 0.5 m, 3 h mean, bilinear onto 0.25° (`frame_set_raster_giops.py`) | gated |
| `RTOFS_025` | NOAA Global RTOFS surface u/v as published by its frame set (lane in build) | gated **only if** its set has published ≥ 7 consecutive daily runs before the freeze commit. Otherwise ABSENT, stated, not failed |
| `CMEMS_083` | the same Copernicus source at native 1/12°, no block mean (collected beside the served set) | gated (it answers "does the 0.25° down-sampling cost skill near coasts?") |
| `PERSIST_<src>` | each source's own lead-0 field held fixed for all leads | reported; used in G3 |
| `SMOC` | `cmems_mod_glo_phy_anfc_merged-uv_PT1H-i` (utotal incl. tides + Stokes) | reported only, drifters only |

## 2. Window and collection (forward only)
- **Why forward:** no source keeps an archive of past forecasts at the served form, and the GDP hourly QC file ends 2022-10-31 (AOML ERDDAP `drifter_hourly_qc`, read 2026-11-22). A hindcast cannot be scored.
- **TEST inits:** 00Z daily for 60 days, starting with the first 00Z init at or after the freeze commit's committer timestamp. Leads 0-168 h at the served 6-hourly steps.
- **Collector:**
  - A GitHub Actions job, NOT the Render box (CLAUDE.md, never load the live backend).
  - After each init it copies the published frame set of every arm, plus the native 1/12° CMEMS subset for the truth regions only, into an evidence artifact, with a sha256 per file.
  - Copernicus access uses the existing environment variables `COPERNICUSMARINE_SERVICE_USERNAME` / `COPERNICUSMARINE_SERVICE_PASSWORD` (by NAME only).
- **Collection passes:**
  - Pass 1: daily.
  - Pass 2 (ONE, pre-declared): re-fetches only the inits missing because of source throttling or outage, logged by cause.
  - A TEST init is KEPT only if every gated arm present at freeze has all its steps to 168 h. A missing step drops the init for every arm (listed, never filled).
- **No FIT exists.** Nothing is fitted. The only tunables (the low-pass width, the particle integrator, the margins) are fixed here.

## 3. Truth
**T1, HF radar (Eulerian; primary for coasts).**
- HFRNet 6 km hourly RTV totals:
  - US West Coast via NDBC THREDDS `hfradar_uswc_6km` (CoastWatch ERDDAP `ucsdHfrW6`, verified 2026-11-22: 6 km, hourly, upper ~2.4 m, rolling ~90-day window);
  - US East + Gulf `hfradar_usegc_6km` and Hawaii `hfradar_ushi_6km` (dataset names confirmed at freeze; a region without a live dataset is "insufficient");
  - Puerto Rico / USVI `ucsdHfrP6` (reported).
- **Snapshots:** the ERDDAP window is rolling, so the collector saves a weekly snapshot of every region (the scorer reads what was saved).
- **Cell use:** cells with `number_of_sites ≥ 2` and `hdop ≤ 1.25`. A cell enters a region's score only if ≥ 70% of TEST hours are present (checked at SCORE time and reported; no cell is chosen or removed by skill).
- **Europe:** HF radar totals from Copernicus `INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048` (radar totals subset). REPORTED, never gated: few sites, and the network's licences are per operator.

**T2, drifters (Lagrangian; primary for open ocean).**
- Near-real-time GDP drifter positions and raw velocities from Copernicus `INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048` (drifter subset, "latest"/"monthly"), which carries the DBCP Global Drifter Program.
- Only positions with good QC flags.
- **Drogue status:** in NRT it is unreliable, so the drogue flag is reported, not used for selection. Every drifter row is scored once, labelled drogued / undrogued / unknown, and SMOC is reported beside (undrogued drifters feel windage and Stokes drift; QUID table 6).
- **Zones** (fixed now; QUID's spirit):
  - `COAST50`: within 50 km of the coast (ETOPO land mask);
  - `SHELF`: depth < 200 m, ETOPO 2022, not COAST50;
  - `WBC`: Gulf Stream box 30-45N 80-50W, Kuroshio box 25-40N 125E-160E;
  - `EQ`: |lat| < 5°;
  - `OPEN`: everything else.

## 4. Metrics
**Tides and inertial motion.** None of the gated sources carries tides (GLO12 and GIOPS are tide-free; RTOFS is tide-free). HF radar and drifters see tides and inertial oscillations. So the primary scores use **25 h low-passed** values on both sides:
- truth: a centred 25 h running mean of hourly values, requiring ≥ 20 of 25 hours;
- forecast: the mean of the source's steps inside the same 25 h window, using every step present (6-hourly sets: 4 or 5 steps; GIOPS's 3 h means count as steps at their valid times).
The **unfiltered** comparison at each served step is REPORTED (it is what a user sees), never gated.

Metric definitions:
- **M1 (HF radar):** vector RMSE `sqrt(mean(|u_f − u_o|²))`, m/s, over all (cell, valid day) rows of a region and lead day.
  - Lead days: D1 = valid centre 24 h, D3 = 72 h, D5 = 120 h, D7 = 168 h.
  - The forecast is bilinear from the arm's own grid to the HF-radar cell centre.
  - An arm cell that is land or missing drops that row for **all** arms (identical rows).
- **M2 (drifters):** 72 h separation, km.
  - For each drifter with a good position within ±1 h of an init (00Z) and a good position at init + 72 h (±1 h), seed one particle at the init position.
  - Advect it through the arm's field: RK4, 1 h step, linear interpolation in time between steps, bilinear in space.
  - Score the great-circle distance to the observed +72 h position.
  - A particle that reaches land drops the row for all arms.
  - Also reported: separation at 24 h, and the M2 normalised by the drifter's own path length (the Liu-Weisberg skill score).
- **Reported, not gated:** speed ME (m/s); signed and circular direction error (rows with observed speed ≥ 0.1 m/s); complex correlation; the per-region D0 (analysis) RMSE.

## 5. Statistics, families, floors
- **Bootstrap:** paired moving-block bootstrap over VALID DATES, 3-day blocks, B = 10,000, seed 20261122, 95% percentile intervals. A one-sided line is significant if its Holm-adjusted p < 0.025.
- **Lines:**
  - F-M1: gated arm in {GIOPS_025, RTOFS_025, CMEMS_083} × region in {US West, US East + Gulf, Hawaii} × lead day {D1, D3, D5, D7}, each "arm minus `CMEMS_025`". One Holm family per arm (so an absent RTOFS does not change the others' power).
  - F-M2: gated arm × zone {COAST50, SHELF, WBC, EQ, OPEN}, "arm minus `CMEMS_025`" on M2. One Holm family per arm.
- **Floors (VOID if not met, never failed):**
  - ≥ 50 kept TEST inits;
  - ≥ 45 distinct valid days per lead day;
  - ≥ 12 three-day blocks.
  - Per region (M1): ≥ 100 qualifying HF-radar cells. Per zone (M2): ≥ 200 drifter-inits.
  - A region or zone below its floor is "insufficient" (NOT SHOWN for every arm there); it never fails a source.
  - More than 15% of the 60 inits dropped after pass 2 VOIDS the whole run.

## 6. Labels (per arm × region-or-zone × lead day; each cell decided on its own)
- **BETTER:** the Holm-adjusted one-sided line holds (arm minus `CMEMS_025` < 0), AND the same sign with at least half the pooled effect in both halves of TEST (first 30 / last 30 inits; descriptive).
- **COMPARABLE:** not BETTER, and the 90% CI of (arm − `CMEMS_025`) / `CMEMS_025`'s metric lies inside [−10%, +10%].
- **WORSE:** the reverse one-sided line holds after Holm (reported in the same family).
- **NOT SHOWN:** everything else, including insufficient cells.
- **G3, the word "forecast skill" at a lead:** a source may be described as having skill at lead day Dn in a region only if it is BETTER than its own `PERSIST_<src>` there (same test, its own Holm family per arm). Without that, the credit may compare sources but must not say "skilful at day n".
- **What may ship from this gate:** the credit text per picker, e.g. "NOAA RTOFS: comparable to Copernicus on US West Coast, days 1-3". The wording is an owner decision after the verdict.
  - The default does not change from this gate.
  - A source that is WORSE in a region keeps its label, and that cell's measured result is shown on request.
  - Changing which source a picker serves is a NEW owner decision.
- **`CMEMS_083`:** if it is BETTER than `CMEMS_025` on COAST50 or on any HF-radar region at D1-D3, that is evidence for the native-resolution coastal set (routed by the director 2026-11-22). It is a builder decision, not a serve flip from this gate.

## 7. Controls (VOID if any misbehaves)
- **Null:** `CMEMS_025` vs itself gives exactly 0 on every line.
- **Shuffled valid time:** pair each arm's D1 forecast with truth 7 days later. Its advantage over `PERSIST_<src>` must vanish (CI includes 0 or is positive) in every region with a floor. If it still wins, the pairing leaks: VOID.
- **Speed plants:** +0.05 m/s (1×) and +0.10 m/s (2×) added along the forecast vector of `GIOPS_025` on all rows. The speed-ME test must catch 2× (CI excludes 0 and contains the planted value); 1× is reported.
- **Direction plants:** forecast vectors rotated +30° (1×) and +60° (2×) on the same random 15% of rows (seed 20261122). The signed direction-error test must catch 2×.
- **Lagrangian plant:** `CMEMS_025`'s field shifted by one grid cell east. M2 must be significantly worse than unshifted in OPEN and WBC.
- **Leak / freeze:** the collector hashes match the committed manifest; no TEST valid time precedes the freeze commit.

## 8. One look, stop rule, reader
- TEST is scored once, after pass 2 and after the last weekly HF-radar snapshot.
- No re-scoring, no new arm, no changed rule; a change is a new registration on later data.
- The first reader is the advisor (or a reader they name in writing in the log). The report artifact stays unopened by everyone else until the verdict line is in the log.

## 9. Open before freeze
- Confirm the HFRNet East + Gulf and Hawaii dataset names, and the Copernicus in-situ drifter subset ID and its NRT latency (product page: data.marine.copernicus.eu/product/INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048).
- Confirm from each source's documentation that its served surface current is tide-free (section 4 assumes it). A source with tides is scored on the same 25 h low-pass, and the fact is stated.
- RTOFS lane: whether its set publishes ≥ 7 daily runs before freeze (else ABSENT).
- Collector build PR (Actions job + evidence artifact + scorer) goes to the advisor before any dispatch; fetches and dispatches need David's word.
- Storage: native 1/12° subsets for the three US radar regions only (not global) to keep artifacts small.
