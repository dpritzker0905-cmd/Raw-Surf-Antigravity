# Gate: currents-skill-v1
Stamp: 2026-11-22 (written by the research lead; DRAFT until the advisor's line on the commit that freezes it. Nothing in TEST exists at writing time.)
Candidate: per-picker ocean-current sources as served (ECCC GIOPS under ICON, NOAA Global RTOFS under GFS, Copernicus GLO-PHY at native 1/12°), each against the default Copernicus GLO-PHY 0.25° set, scored against independent HF-radar and drifter truth.
Metric: M1 = vector RMSE (m/s) of the 25 h low-passed surface current against HF-radar totals, per region × lead day. M2 = 72 h Lagrangian separation (km) of virtual particles against drifters, per zone. Full definitions in section 4.
Pass threshold: section 6 (better = Holm-significant one-sided improvement over the default; comparable = a TOST equivalence test with a ±10% margin on the paired ratio, Holm per arm; "skill" = beating the arm's own persistence, defined in section 1).
Controls: section 7 (null, shuffled valid time, +0.05 m/s speed plants at 1× and 2×, +30° / +60° direction plants, Lagrangian velocity-scale plants ×0.7 / ×0.5). A control that misbehaves makes the run VOID.
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
| `PERSIST_<src>` | the arm's EARLIEST served step of the same init, held fixed for every later lead. For the 6-hourly sets this is the 6 h step: the served sets start at 6 h because P000 holds no currents (`frame_set_raster_giops.py` HOURS). It is low-passed and advected exactly like the arm | the G3 baseline for the word "skill" |
| `PERSIST_OBS` | the HF-radar 25 h mean ending at the init time, held fixed (M1 only) | reported only: a stricter baseline, never gating |
| `CMEMS_1H` | Copernicus `cmems_mod_glo_phy_anfc_0.083deg_PT1H-m` hourly means, truth regions only | reported only: measures how much the 6-hourly sampling costs (section 4) |
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
  - **Pairing is per arm.** An arm's lines use the inits where BOTH that arm and `CMEMS_025` have every step to 168 h. A missing step drops that init from that arm's lines only (listed by cause, never filled). An init with `CMEMS_025` incomplete is dropped for all arms.
  - **Missing-run rule (RTOFS and GIOPS alike, after the wind gate's).**
    - If a source stops publishing mid-TEST, its lines use the inits it has.
    - If it has fewer than 50 kept inits, that arm is VOID. The other arms are unaffected.
    - Pass 2 may recover a missed run only from the same source's own archive, and only within the pass-2 rule above. A missed run is never filled from another source or by persistence.
  - **Model change mid-TEST.**
    - Every source's version or release notes are listed in the result.
    - If a release inside TEST alters the system (judged from the release notes before any score is read), that arm's inits from the change onward are VOID. Its earlier inits stand only if they still meet the floors.
- **No FIT exists.** Nothing is fitted. The only tunables (the low-pass width, the particle integrator, the margins) are fixed here.

## 3. Truth
**T1, HF radar (Eulerian; primary for coasts).**
- HFRNet 6 km hourly RTV totals ("HFRNet v1r0"; NDBC THREDDS is the source of every mirror):

| Region | NDBC OPeNDAP (source of record) | ERDDAP mirror used to read it | Checked |
|---|---|---|---|
| US West Coast | `https://dods.ndbc.noaa.gov/thredds/dodsC/hfradar_uswc_6km` | CoastWatch `ucsdHfrW6` | metadata read 2026-11-22 (6 km, hourly, upper ~2.4 m, rolling window 2026-08-22 to now) |
| US East + Gulf | `.../dodsC/hfradar_usegc_6km` | CoastWatch `ucsdHfrE6` | listed in CoastWatch and upwell ERDDAP, 2026-11-22 search |
| Hawaii | `.../dodsC/hfradar_ushi_6km` | PacIOOS ERDDAP `hfradar_ushi_6km` | listed in NDBC and PacIOOS, 2026-11-22 search |
| Puerto Rico / USVI (reported) | `.../dodsC/hfradar_usprvi_6km` (name confirmed at freeze) | CoastWatch `ucsdHfrP6` | metadata listed 2026-11-22 |

- **Licence line (HF radar):** HFRNet totals are U.S. Government (NOAA / U.S. IOOS) data with no use restriction. The result copies verbatim each dataset's `license` and `acknowledgement` attributes as read at freeze. A dataset whose attribute restricts commercial use is reported, never gated.
- HFRNet's own 25 h-average RTV product (`HFR/<region>/6km/25hr/RTV` on hfrnet-tds.ucsd.edu) is REPORTED as a cross-check on our low-pass, never gated.
- **Snapshots:** the ERDDAP window is rolling, so the collector saves a weekly snapshot of every region (the scorer reads what was saved).
- **Cell use:** cells with `number_of_sites ≥ 2` and `hdop ≤ 1.25`. A cell enters a region's score only if ≥ 70% of TEST hours are present (checked at SCORE time and reported; no cell is chosen or removed by skill).
- **Europe:** HF radar totals from Copernicus `INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048` (radar totals subset). REPORTED, never gated: few sites, and the network's licences are per operator.

**T2, drifters (Lagrangian; primary for open ocean).**
- Near-real-time GDP drifter positions and raw velocities from Copernicus product `INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048`, dataset `cmems_obs-ins_glo_phy-cur_nrt_drifter_irr`, which carries the DBCP Global Drifter Program.
  - Source: the product user manual, issue 2.5.
  - The subset is the "latest" one, plus "monthly" for pass 2. The exact subset names and the product version are copied from the Copernicus Marine catalogue at freeze into the result's first line.
- **Licence line (drifters):** Copernicus Marine Service licence, free including commercial use, with the attribution "Generated using E.U. Copernicus Marine Service Information".
- Only positions with good QC flags.
- **Drogue status:** in NRT it is unreliable, so the drogue flag is reported, not used for selection. Every drifter row is scored once, labelled drogued / undrogued / unknown, and SMOC is reported beside (undrogued drifters feel windage and Stokes drift; QUID table 6).
- **Zones** (fixed now; QUID's spirit):
  - `COAST50`: within 50 km of the coast (ETOPO land mask);
  - `SHELF`: depth < 200 m, ETOPO 2022, not COAST50;
  - `WBC`: Gulf Stream box 30-45N 80-50W, Kuroshio box 25-40N 125E-160E;
  - `EQ`: |lat| < 5°;
  - `OPEN`: everything else.

## 4. Metrics
**Tides and inertial motion.**
- Copernicus uo/vo and GIOPS are tide-free. The Copernicus QUID adds tides only in the merged SMOC product.
- Whether operational Global RTOFS v2 carries tidal forcing is NOT documented in what we found (searched 2026-11-22). Its release notes list GFS surface forcing and HYCOM restarts, no tides; only the older Atlantic RTOFS listed tidal constituents.
- HF radar and drifters see tides and inertial oscillations.
- So **every arm, whether or not it carries tides, and every truth series is low-passed the same way**. The RTOFS question decides nothing; its answer is recorded at freeze.

M1 uses **25 h low-passed** values on both sides:
- truth: a centred 25 h running mean of hourly values, requiring ≥ 20 of 25 hours;
- forecast: the arm's steps are first interpolated linearly in time to hourly values (GIOPS's 3 h means count as values at their valid times). Then the SAME centred 25 h mean is taken over exactly the hours where the truth cell is valid (a shared hour mask). Filter and mask are identical on both sides (Reflection review, 2026-11-22).
- **Known limit, not fixable here:** the served 6-hourly instantaneous sets sample inertial oscillations (period about 17-24 h at mid-latitudes) too sparsely, and that motion aliases into the 25 h mean.
  - It is reported, not corrected.
  - A reported-only arm `CMEMS_1H` (Copernicus `cmems_mod_glo_phy_anfc_0.083deg_PT1H-m` hourly means, truth regions only) measures how much skill the 6-hourly sampling costs.
The **unfiltered** comparison at each served step is REPORTED (it is what a user sees), never gated.

Metric definitions:
- **M1 (HF radar):** vector RMSE `sqrt(mean(|u_f − u_o|²))`, m/s, over all (cell, valid day) rows of a region and lead day.
  - Lead days: D1 = valid centre 24 h, D3 = 72 h, D5 = 120 h, D7 = 168 h.
  - The forecast is bilinear from the arm's own grid to the HF-radar cell centre.
  - An arm cell that is land or missing drops that row for **all** arms (identical rows).
- **M2 (drifters):** 72 h separation, km, on **low-passed tracks**.
  - **Truth track:** each drifter's hourly positions, after the QC flags, are converted to a local east/north offset and smoothed with a centred 25 h running mean, requiring ≥ 20 of 25 good hours. Tidal and inertial loops average out; the residual drift stays.
  - **Seed and end:** the smoothed position at the init time and at init + 72 h. Both need the ≥ 20 h rule, else the drifter-init is not used.
  - **Forecast:** advect one particle from the smoothed init position through the arm's **25 h low-passed velocity field**. That is a centred running mean over the arm's steps, using the same window rule as M1, recomputed at each hour by linear interpolation in time. Integration is RK4 with a 1 h step, bilinear in space.
  - The particle's velocity at every step comes ONLY from the arm's field. No drifter velocity enters the forecast; the drifter supplies only the start and end positions (LongCat review, clarified).
  - Score the great-circle distance from the advected particle to the smoothed +72 h position.
  - Also reported: `STILL`, a particle that never moves (separation = the drifter's own smoothed 72 h displacement). This is the floor any field must beat.
  - The unsmoothed separation (raw track, raw field) is REPORTED, never gated.
  - **Beaching is scored, not dropped.**
    - A particle that enters a land cell of the ARM's own grid stops at its last wet position. Its separation is measured from there.
    - Dropping beached rows would hide the coastal error of coarser land masks, which is exactly what `CMEMS_025` vs `CMEMS_083` tests (Reflection review).
    - Beaching counts per arm and zone are reported.
    - A drifter-init is dropped for all arms only when the OBSERVED smoothed track lacks the ≥ 20 h rule.
  - Also reported: separation at 24 h, and the M2 normalised by the drifter's own path length (the Liu-Weisberg skill score).
- **Reported, not gated:** speed ME (m/s); signed and circular direction error (rows with observed speed ≥ 0.1 m/s); complex correlation; the per-region D0 (analysis) RMSE.

## 5. Statistics, families, floors
- **Bootstrap:** paired moving-block bootstrap over VALID DATES, **5-day blocks**, B = 10,000, seed 20261122, 95% percentile intervals.
  - Whole dates are resampled, with every cell and drifter of a date kept together, so spatial correlation among radar cells is carried inside the block.
  - Current errors persist longer than weather errors (mesoscale), which is why the blocks are 5 days (Reflection review). The verdict uses 5 days; 3-day and 10-day blocks are REPORTED as a sensitivity check and never change a label.
  - A one-sided line is significant if its Holm-adjusted p < 0.025.
  - **Row coverage:** M1 rows are identical across arms (a radar cell-day missing in any arm's grid is dropped for all). Each arm's own count of dropped rows is reported beside its label, so a patchy arm is visible.
- **Lines:**
  - F-M1: gated arm in {GIOPS_025, RTOFS_025, CMEMS_083} × region in {US West, US East + Gulf, Hawaii} × lead day {D1, D3, D5, D7}, each "arm minus `CMEMS_025`". One Holm family per arm (so an absent RTOFS does not change the others' power).
  - F-M2: gated arm × zone {COAST50, SHELF, WBC, EQ, OPEN}, "arm minus `CMEMS_025`" on M2. One Holm family per arm.
- **Floors (VOID if not met, never failed):**
  - ≥ 50 kept TEST inits;
  - ≥ 50 distinct valid days per lead day;
  - ≥ 10 five-day blocks, counted over the ordered list of kept valid dates (gaps are skipped, not padded), so 50 days is the minimum that can yield them (LongCat review).
  - Per region (M1): ≥ 100 qualifying HF-radar cells. Per zone (M2): ≥ 200 drifter-inits.
  - A region or zone below its floor is "insufficient" (NOT SHOWN for every arm there); it never fails a source.
  - More than 15% of the 60 inits dropped after pass 2 VOIDS the whole run.

## 6. Labels (per arm × region-or-zone × lead day; each cell decided on its own)
- **BETTER:** the Holm-adjusted one-sided line holds (arm minus `CMEMS_025` < 0), AND the same sign with at least half the pooled effect in both halves of TEST (first 30 / last 30 inits; descriptive).
- **COMPARABLE: an equivalence test (TOST), fixed now.**
  - For the cell, let `r = metric(arm) / metric(CMEMS_025) − 1`, from the paired rows. Each bootstrap replicate recomputes both metrics on the same resampled blocks.
  - Two one-sided tests:
    - H0a: `r ≤ −0.10`;
    - H0b: `r ≥ +0.10`.
  - Each one-sided p-value is the bootstrap proportion of replicates on the null side of its margin. The TOST p-value is the larger of the two.
  - **COMPARABLE** if the cell is not BETTER and its TOST p, Holm-adjusted across that arm's equivalence family, is < 0.05.
  - The equivalence family is every cell of the arm on that metric: F-M1-EQ and F-M2-EQ, each one Holm family per arm.
  - The ±10% margin is the only margin; it is not changed after data.
- **WORSE:** the reverse one-sided line holds after Holm. The worse-direction lines form their own family per arm and metric (F-M1-W, F-M2-W).
- **Units:** every label is reported beside the absolute difference in physical units (m/s for M1, km for M2) and its CI, so a COMPARABLE on a ratio can be read against the size of the errors (Reflection review). The ratio margin stays the rule.
- **Persistence is per arm by design.** "Skill" means "better than holding its own first field". Every arm's first served step has the same valid time (6 h), so no arm's baseline is ahead of another's.
- **NOT SHOWN:** everything else, including insufficient cells.
- **G3, the word "forecast skill" at a lead:**
  - A source may be described as having skill at lead day Dn in a region (or zone) only if it beats its own `PERSIST_<src>` there. `PERSIST_<src>` is defined in section 1: the earliest served step of the same init, held, then low-passed and advected the same way.
  - The test is the same one-sided bootstrap, with its own Holm family per arm and metric.
  - It applies to BOTH metrics:
    - M1: the held field, low-passed like the arm;
    - M2: particles advected through the held field.
  - For M2 the lead is fixed at 72 h, so the M2 skill claim reads "skilful at 3 days" per zone.
  - Without that, the credit may compare sources but must not say "skilful at day n".
  - `PERSIST_OBS` lines are reported beside it and never decide the wording.
- **What may ship from this gate:** the credit text per picker, e.g. "NOAA RTOFS: comparable to Copernicus on US West Coast, days 1-3". The wording is an owner decision after the verdict.
  - The default does not change from this gate.
  - A source that is WORSE in a region keeps its label, and that cell's measured result is shown on request.
  - Changing which source a picker serves is a NEW owner decision.
- **`CMEMS_083`:** if it is BETTER than `CMEMS_025` on COAST50 or on any HF-radar region at D1-D3, that is evidence for the native-resolution coastal set (routed by the director 2026-11-22). It is a builder decision, not a serve flip from this gate.

## 7. Controls (VOID if any misbehaves)
- **Null:** `CMEMS_025` vs itself gives exactly 0 on every line.
- **Shuffled valid time:** pair each arm's D1 forecast with truth 7 days later. Its advantage over `PERSIST_<src>` must vanish (CI includes 0 or is positive) in every region with a floor. If it still wins, the pairing leaks: VOID.
- **Speed plants:** +0.05 m/s (1×) and +0.10 m/s (2×) added along the forecast vector of `GIOPS_025` on all rows. The speed-ME test must catch 2× (CI excludes 0 and contains the planted value); 1× is reported.
- **Direction plants:** the forecast (u, v) vectors themselves are rotated +30° (1×) and +60° (2×), before the low-pass, on the same random 15% of rows (seed 20261122).
  - The signed direction-error test must catch 2×.
  - M1 vector RMSE must also rise at 2× (CI of the difference excludes 0). Both conditions are required, else VOID.
- **Lagrangian plants:** `CMEMS_025`'s velocity scaled by 0.7 (1×) and by 0.5 (2×).
  - M2 must be significantly worse than unscaled at 2× in OPEN and WBC; 1× is reported.
  - A one-cell (0.25°) eastward shift is REPORTED only. In smooth open-ocean flow it may barely change a 72 h track, so making it a VOID condition could void a sound run (SubQ ranking, 2026-11-22).
- **Leak / freeze:** the collector hashes match the committed manifest; no TEST valid time precedes the freeze commit.

## 8. One look, stop rule, reader
- TEST is scored once, after pass 2 and after the last weekly HF-radar snapshot.
- No re-scoring, no new arm, no changed rule; a change is a new registration on later data.
- The first reader is the advisor (or a reader they name in writing in the log). The report artifact stays unopened by everyone else until the verdict line is in the log.

## 9. Open before freeze
- At freeze, read and record in the result's first line:
  - the four HFRNet datasets' `license` / `acknowledgement` attributes and their live time ranges (the IDs are named in section 3);
  - the drifter subset names, the product version and the NRT latency (data.marine.copernicus.eu/product/INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048).
  - A dataset that is not live at freeze makes its region "insufficient".
- Record whether Global RTOFS carries tidal forcing (asked of the RTOFS documentation or the NCEP PMB contact). Scoring does not depend on the answer: every arm is low-passed (section 4).
- RTOFS lane: whether its set publishes ≥ 7 daily runs before freeze (else ABSENT).
- Collector build PR (Actions job + evidence artifact + scorer) goes to the advisor before any dispatch; fetches and dispatches need David's word.
- Storage: native 1/12° subsets for the three US radar regions only (not global) to keep artifacts small.
