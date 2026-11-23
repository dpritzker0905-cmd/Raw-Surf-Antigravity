# Q12: Skill-weighted multi-model wave consensus with correlated members

Research only. No served change, no dispatch, no collection. Every claim is cited to a Consensus or OpenAlex record or to our own repo. **UNVERIFIED** marks any number or claim I could not read in the paper.

Status of the sources: Consensus returned abstracts (three per search, free tier). OpenAlex returned metadata only (titles, dates, no abstracts). Most wave-specific papers were read from metadata or abstracts only, so no wave-specific gain figure below is verified from full text.

## 0. Context

- GFS-Wave, EURO and ICON are the three wave members we serve. The request says they share ancestry and initial conditions. **Shared ancestry and shared initial conditions are UNVERIFIED for these three**: they come from different centres and different wave models, and I have not checked the input sources of each in the repo. The consensus design must measure member error correlation directly rather than assume it.
- The buoy point archive is PR #1168, `docs/gate-served-wave-verify-v1`. It is a design and pre-registration only, not built. Its scorer uses fixed lead bins, NDBC QC, ±30 min collocation, and a minimum n of 100 per cell, 3 buoys and 10 runs, else "insufficient". It samples every newly published GFS, EURO and ICON wave run, with each member as its own record (`gates/served-wave-verify-v1.md`, lines 3 and 28, on branch `docs/gate-served-wave-verify-v1`; §2a lists the sets per model and tier). Nuances: the publisher runs three times a day, so runs it skipped are counted as gaps, not invented; EURO swell sets (`swell_1`, `swell_2`, `wind_waves`) are sampled only while `FRAME_EURO_SWELL_SETS=1` (its default); ICON `swell_2` is a client-side blend, not a frame; regional Tier B bundles keep only the current and previous index, so a bundle pruned before sampling is recorded as `sampler_fail` with cause `pruned`.
- Our own Q9 result (#1166) gives n = 0 for the 24–48 h bin on the current archive. The #1168 design targets n ≥ 100 by day 14 for that bin.

## 1. Methods

### 1.1 Equal weights (EW)

- A Management Science study on survey forecasts finds equal weights (EW) are hard to beat. EW minimises estimation variance but ignores the bias from under-sensitivity to training data. Source: [Blanc et al. 2020, Management Science](https://consensus.app/papers/details/w:0ed8db3b-c6fa-4c81-b490-851933151e5a/?utm_source=claude_code) (Consensus record; abstract read).
- The review of forecast combinations confirms EW as the usual benchmark and lists correlations among components and time-varying weights as active areas. Source: [Wang et al. 2022, IJF review](https://consensus.app/papers/details/w:45f13451-ef45-4623-9400-5a05d9dadb9d/?utm_source=claude_code) (abstract read).

### 1.2 Inverse-MSE and skill-based weighting (SW)

- Casanova et al. (2009) compared equal weighting (EW), skill-based weighting (SW) and Bayesian model averaging (BMA) on short-range and seasonal multimodel ensembles. Two findings bear on us: the value of combining over one model rises as member error correlation falls, and a larger spread in member performance makes SW or BMA more useful than EW. Source: [Casanova et al. 2009, MWR](https://consensus.app/papers/details/w:afdb89ab-da99-415d-9823-5273078d6705/?utm_source=claude_code) (abstract read). **Their numbers are for temperature and sea-level-type fields, not waves.**

### 1.3 Bayesian model averaging (BMA)

- Raftery et al. (2005) apply BMA to 48 h surface temperature from an MM5 ensemble: RMSE of the BMA point forecast was 7% lower than the best member and 8% lower than the ensemble mean. Source: [Raftery et al. 2005, MWR](https://consensus.app/papers/details/w:e64bdc3e-963d-42e1-81cb-79fd66cfd182/?utm_source=claude_code) (abstract read). **Temperature, not waves; the 7% and 8% are their numbers.**
- Casanova et al. (2009) conclude BMA adds value over SW only when the best member beats EW. Source: as above.

### 1.4 EMOS and NGR (regression with spread)

- Gneiting et al. (2005) introduce EMOS: a bias-corrected weighted mean of members, with a variance that is linear in the ensemble variance. Their 48 h sea-level-pressure RMSE was 9% below the bias-corrected ensemble. Source: [Gneiting et al. 2005, MWR](https://consensus.app/papers/details/w:3452c96e-c2a9-4d47-a83e-86b3c96b4cc6/?utm_source=claude_code) (abstract read). **Pressure, not waves.**
- Murphy et al. (2025) calibrate medium-range North Sea forecasts for significant wave height Hs, wind and mean period, from 0 to 168 h. Linear regression (LR) and non-homogeneous Gaussian regression (NHGR) both remove most bias. NHGR is somewhat better for the spread. Ensemble standard deviation predicts Hs error standard deviation well. The calibration uses a single commercial forecast and one location. Source: [Murphy et al. 2025, Applied Ocean Research](https://consensus.app/papers/details/w:60064abe-38c8-4551-916f-c71446ed58b2/?utm_source=claude_code) (abstract read). **The abstract gives no percentage gains; those are UNVERIFIED.**
- Jewson et al. (2026) show that the objective Bayesian (right Haar prior) version of heteroscedastic regression, which is NGR, is the most accurate and most reliable of the EMOS variants tested on eight Northern Hemisphere locations. Source: [Jewson et al. 2026, QJRMS](https://consensus.app/papers/details/w:604af337-4b8d-495b-9d42-ebb7225502cb/?utm_source=claude_code) (abstract read). **Not waves.**

### 1.5 Shrinkage toward equal weights

- Blanc et al. (2020) derive the shrinkage factor between EW and optimal weights (OW) that minimises expected error, using the bias–variance decomposition. They report gains over EW and OW when the error assumptions hold, and note that the assumptions often fail in practice without standardising the training data. Source: [Blanc et al. 2020](https://consensus.app/papers/details/w:0ed8db3b-c6fa-4c81-b490-851933151e5a/?utm_source=claude_code) (abstract read).
- Liu et al. (2023) shrink weights towards equal weights and towards zero, and report outperformance of equal weights on macroeconomic and return forecasts. Source: [Liu et al. 2023, OBES](https://consensus.app/papers/details/w:b27ee4d8-f20c-49c9-8f9e-9dfb337b6af2/?utm_source=claude_code) (abstract read). **Economics, not waves.**

### 1.6 Correlated members

- Casanova et al. (2009): the gain from a multimodel ensemble increases with decreasing error correlation, and the relation depends only on the number of models. Source: as 1.2.
- **Practical reading for us:** with three members, the usable gain is bounded by how decorrelated GFS, EURO and ICON errors are at each buoy and lead. That is a measurement, not an assumption. The design below measures it first.
- Correlation-aware weighting (cluster or down-weight members that share errors) is discussed in the forecast-combination review (Wang et al. 2022). **Specific wave methods for this are UNVERIFIED.**

### 1.7 Wave-specific evidence (thin)

- O'Donncha et al. (2019) aggregate ensemble members of a lightweight wave model with learned weights from historical accuracy, at Monterey Bay, and compare against a state-of-the-art baseline. Source: [O'Donncha et al. 2019, J. Marine Systems](https://consensus.app/papers/details/w:397de08d-aed0-4df6-8f3b-17c3d48437bf/?utm_source=claude_code) (abstract read). **The abstract gives no gain figure; the gain is UNVERIFIED.** Monterey is also a site of our buoy 46042.
- Lenartz et al. (2010) test super-ensemble techniques on wave forecasts and report performance and limitations. Source: OpenAlex record W2102858520, Ocean Science 6, 595 (metadata only; abstract not read). **Gains UNVERIFIED.**
- Huang et al. (2025) use reinforcement learning to weight multimodel ensembles for ocean waves. Source: OpenAlex record W4407934305, Frontiers in Marine Science (metadata only). **Gains UNVERIFIED.**

**Net:** published evidence supports (a) EW as a strong baseline, (b) skill weighting helps when member performance spread is large, (c) NGR/EMOS-type calibration gives bias and spread gains for Hs, and (d) shrinkage toward EW is the standard fix for estimation noise. No source quoted here gives a verified wave gain over the best single member with three correlated members at a 100-buoy scale.

## 2. Sample size: how many pairs before a weight is stable

- **Unit of independence is the run, and the day.** Forecast errors are serially correlated across leads within a run and across adjacent runs. Gilleland (2020) shows that the standard bootstrap is invalid for comparative verification of dependent continuous series, and gives a paired-difference-of-means procedure. Source: [Gilleland 2020, JTECH](https://consensus.app/papers/details/w:76b70dab-287b-4378-8861-b35aa82ac92b/?utm_source=claude_code) (abstract read).
- **Block bootstrap by day.** Resample whole days (all runs and leads for that day, for all buoys in a region together, to keep cross-buoy correlation). Pohle et al. (2026) give simultaneous confidence bands for skill scores across horizons and locations, which avoids inflated Type I error from testing many lead×region cells one at a time. Source: [Pohle et al. 2026, arXiv record](https://consensus.app/papers/details/w:5d5e7fb1-16d4-403b-9b3c-b022c9ff5f8a/?utm_source=claude_code) (abstract read; preprint).
- **Minimum sample, proposed (not from a source):** a weight is reported only if the region-lead cell has at least **30 independent days** (not runs, not buoy-hours) and at least the #1168 floor of n ≥ 100 pairs. 30 days is a judgement; the bootstrap width at 30 days must be shown on a null (EW vs EW) before use.
- **Why day, not run:** four runs per day (00/06/12/18) are strongly correlated; counting them as independent inflates n by roughly four.

## 3. Per-lead and per-region weights, and overfitting with about 100 buoys

- **Lead bins:** fix three bins, 0–24, 24–72 and 72–120 h (the lead bins already in #1168's scorer). Do not fit weights per hour.
- **Regions:** pool buoys into about six regions (for example US Pacific, Gulf and Atlantic coasts, Hawaii, Alaska, Caribbean, Europe-Atlantic). Per-buoy weights are not supported by about 100 buoys: each buoy has too few independent days.
- **Shrinkage:** shrink each region-lead weight toward EW with a factor chosen by a pre-registered rule (Blanc et al. 2020, §1.5). Report the shrinkage factor.
- **Overfitting guard:** calibrate on the first 60% of days, test on the later 40% (rolling origin), and hold out a fixed set of buoys (the #1168 frozen list) from both fits and scores. **The 60/40 split is a design choice, not a sourced number.**
- **Parameter count:** at most one weight per member per cell (two free weights for three members, with the sum-to-one constraint), plus one shrinkage factor. That keeps the fitted parameters far below the number of independent days.

## 4. Q11 closure (STOFS zeta datum): evidence summary (test result moved to Q11)

- The NetCDF `zeta` metadata says "water surface elevation above geoid" (`sea_surface_height_above_geoid`). The bucket README says the NetCDF station output is referenced to MSL, and the SHEF output to MLLW. Source: [STOFS bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html); header read in this session.
- NOMADS says STOFS-2D-Global water level guidance is referenced to Local Mean Sea Level (LMSL) for gridded and station output. Source: [NOAA NOMADS STOFS text](https://nomads.ncep.noaa.gov/txt_descriptions/STOFS_Global_txt.html) (search-reported, not fetched in full). LMSL is not the same as the geoid.
- A third-party GitHub issue reports that retrieving STOFS 2D GLO water levels fails for `output_datum="MSL"` but works for `"MLLW"`. Source: [seanode issue 14](https://github.com/oceanmodeling/seanode/issues/14) (search-reported; third-party, not NOAA).
- The NOS/CSDL portal says v3.1 includes a gridded bias correction tied to CO-OPS water levels. Source: [NOS STOFS portal](https://polar.ncep.noaa.gov/estofs/glo.htm) (search-reported; not checked in full).
- **Empirical test: moved to the Q11 note** (`docs/weather-program/research/Q11-twl-stage2-sources-2026-11-23.md`, datum update 2026-11-23). Result at SDBC1 (−0.897 m) and BATN6 (−0.783 m): `zeta` is MSL-referenced; the "above geoid" metadata is misleading.

## 5. Recommended pre-registered design: `wave-consensus-v1`

**Purpose:** decide whether a skill-weighted consensus of GFS-Wave, EURO and ICON beats equal weights and the best single member on Hs, at each lead bin and region, using the #1168 archive. Tier B (spot-scale) reads the same archive at the spots.

**Prerequisites (must be true before scoring):**
1. EURO and ICON served wave frames are archived under the same design as #1168: #1168 already samples every newly published GFS, EURO and ICON wave run, each member as its own record (`gates/served-wave-verify-v1.md`, lines 3 and 28; §2a). **Met, with the nuances above.** The remaining check is that the census shows the expected EURO and ICON counts per run, and that EURO swell sets are either present or recorded as disabled.
2. The member error correlation matrix is measured per region and lead bin before any weights are fitted. Report it.

**Arms (all fitted on the calibration window only, scored on the test window):**
- A0: best single member, chosen on the calibration window, per region and lead bin.
- A1: equal weights (EW).
- A2: inverse-MSE weights from the calibration window.
- A3: shrunk-to-EW weights (Blanc et al. 2020), shrinkage factor from a pre-registered rule.
- A4: NGR-style Hs regression: bias-corrected linear combination of members with an intercept, shrunk to EW (Murphy et al. 2025; Jewson et al. 2026 for the RHP variant as a stretch arm).

**Controls (must behave as stated or the gate is void):**
- C1, negative: shuffle buoy identity within region; A3 must not beat A1 by more than the bootstrap width.
- C2, positive: plant +0.20 m bias on one member in the archive; A3 or A4 must reduce its weight or bias correct it, and the planted member's weight must fall.
- C3, correlation: duplicate one member's frames as a fourth member; the consensus must not double its weight (A2 and A3 must give the duplicate the same weight as the original, within tolerance).
- C4, golden fixture: #1168's planted +0.20 m bias fixture, unchanged.

**Bars (pass/fail, fixed before scoring):**
- B1: for each region and lead bin with ≥ 30 independent test days, A3 RMSE is lower than A1 RMSE with a day-block bootstrap 95% CI for the difference excluding zero.
- B2: A3 RMSE is lower than A0 RMSE in the same cells, same bootstrap rule.
- B3: no region worse than A1 by more than 0.01 m RMSE at any lead bin.
- B4: no lead bin where A3's bias exceeds A1's by more than 0.02 m.
- B5: all controls behave as stated.
- B6: hold-out buoys are never used in fitting or in the bars. Any buoy with fewer than 30 independent days is reported as insufficient, not counted.

**Failure rules:** if B1 or B2 fails in a cell, the consensus is not served in that cell. If C1, C2 or C3 fails, the gate is void, not a fail, and the design is fixed before rerun.

**Served status:** consensus weighting is a served change. Under D-080 it would ship ON with a kill switch and a kill-switch test, after this gate passes and David gives the word to merge. This design does not merge or serve anything.

**Sample plan:** report n in every cell. Report "insufficient" where n < 100 pairs or < 30 independent days. Use #1168's scorer for the pairs. Expected coverage: the Q9 24–48 h bin is n = 0 today; #1168 targets n ≥ 100 by day 14, so the lead 24–48 h cell is first testable at about day 14 after collection.

## 6. Open items and what would change this

- The datum result (§4) is pending. It changes only the Q11 closure, not the design.
- Member correlation may be low enough that consensus gains are small. If so, the design still answers the question and EW stays the served default.
- Any gain number from Murphy 2025, O'Donncha 2019, Lenartz 2010 or Huang 2025 needs full-text reading before it is cited as a result.
- Sources to read in full before the gate is registered: Murphy et al. 2025 (wave NGR numbers); Jewson et al. 2026; Gilleland 2020 (the paired bootstrap procedure); Pohle et al. 2026 (simultaneous bands).

## Sources

- Blanc et al. 2020, Management Science, https://consensus.app/papers/details/w:0ed8db3b-c6fa-4c81-b490-851933151e5a/?utm_source=claude_code
- Wang et al. 2022, IJF, https://consensus.app/papers/details/w:45f13451-ef45-4623-9400-5a05d9dadb9d/?utm_source=claude_code
- Liu et al. 2023, OBES, https://consensus.app/papers/details/w:b27ee4d8-f20c-49c9-8f9e-9dfb337b6af2/?utm_source=claude_code
- Casanova et al. 2009, MWR, https://consensus.app/papers/details/w:afdb89ab-da99-415d-9823-5273078d6705/?utm_source=claude_code
- Raftery et al. 2005, MWR, https://consensus.app/papers/details/w:e64bdc3e-963d-42e1-81cb-79fd66cfd182/?utm_source=claude_code
- Gneiting et al. 2005, MWR, https://consensus.app/papers/details/w:3452c96e-c2a9-4d47-a83e-86b3c96b4cc6/?utm_source=claude_code
- Murphy et al. 2025, Applied Ocean Research, https://consensus.app/papers/details/w:60064abe-38c8-4551-916f-c71446ed58b2/?utm_source=claude_code
- Jewson et al. 2026, QJRMS, https://consensus.app/papers/details/w:604af337-4b8d-495b-9d42-ebb7225502cb/?utm_source=claude_code
- O'Donncha et al. 2019, J. Marine Systems, https://consensus.app/papers/details/w:397de08d-aed0-4df6-8f3b-17c3d48437bf/?utm_source=claude_code
- Gilleland 2020, JTECH, https://consensus.app/papers/details/w:76b70dab-287b-4378-8861-b35aa82ac92b/?utm_source=claude_code
- Pohle et al. 2026, arXiv, https://consensus.app/papers/details/w:5d5e7fb1-16d4-403b-9b3c-b022c9ff5f8a/?utm_source=claude_code
- Lenartz et al. 2010, Ocean Science, OpenAlex W2102858520 (metadata only)
- Huang et al. 2025, Frontiers in Marine Science, OpenAlex W4407934305 (metadata only)
- Repo: PR #1168 `docs/gate-served-wave-verify-v1`; PR #1166 Q9 note; STOFS README and header (Q11, PR #1169).
