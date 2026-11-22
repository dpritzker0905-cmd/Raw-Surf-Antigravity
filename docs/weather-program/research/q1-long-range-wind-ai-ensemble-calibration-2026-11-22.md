# Q1: Is a calibrated AIGEFS + GEFS + IFS ENS grand ensemble the SOTA past day 8? (research lead, 2026-11-22)

**Asked by:** the director, for long-range wind v2 (#1133, frozen; build PR #1139).
**Scope:** literature and agency statements only. Nothing here amends the #1133 registration. Findings feed the build PR.
**Read for this note:** the #1133 gate file (`gates/wind-long-range-v2.md` on `claude/wind-long-range-v2-prereg`), sections 2-7.
**Second opinions (advisory, selected context only, no repo contents sent):** SubQ (subq-savant-1.4) and Reflection (Beam-1.0). Their points are folded in below and marked.

## Answer
**Yes, with one correction of wording.** A multi-system ensemble, statistically post-processed and damped toward climatology as skill decays, is current agency practice for days 8-16 [3][4][5]. The #1133 design is in that class.

But #1133's calibration is a **regression on the pooled ensemble MEAN** (MOS with ridge shrinkage). It is not EMOS/NGR in the distributional sense [1], because it fits no spread term.
- That is the right choice for its MAE metric.
- Call it "shrunk-mean MOS" in the build PR, not EMOS. Then nobody expects calibrated spread from it.

## What the evidence says
**1. Ensembles beyond day 8.**
- **GenCast (Google DeepMind)** beat ECMWF ENS on 97.2% of 1,320 targets to 15 days, including 10 m wind CRPS [6]. It is not on any free open-data feed. Its operational form, WeatherNext, runs under Google's commercial terms, so it is not an arm we can use.
- **AIFS-ENS / AIFS-CRPS** (operational at ECMWF since July 2025):
  - better than IFS ENS on most upper-air scores;
  - over-dispersive in the extratropics and under-dispersive in the tropics [7].
- **ECMWF's own scorecards** keep IFS ENS ahead for 10 m wind against SYNOP observations (ECMWF AIFS-ENS release material, read earlier in this programme). An independent 2026 evaluation finds raw IFS 10 m wind better than AIFS at all horizons (arXiv 2606.02508, read earlier in this programme).
- **NOAA AIGEFS** (GraphCast-derived, 31 members, 16 days): NOAA's own statements put it about one day better than GEFS. The hybrid HGEFS beats both but only runs to 10 days.
  - We found no peer-reviewed independent 10 m wind verification of AIGEFS.
  - **#1133's TEST is the measurement**, as its section 9 already says.
- **Implication:** the grand pool mixes an AI system (biased dispersion, sharper means) with physics systems (better 10 m wind).
  - Equal system weights are a defensible prior on about 69 FIT runs. Fitted multi-model weights give small gains that overfit easily [8][9].
  - What matters is that `GRAND_RAW`, `IFS_CAL` and `AIGEFS_CAL` are reported beside `GRAND_CAL`, and they are (#1133 §2).

**2. Lead dependence of the coefficients.**
- Fitting post-processing as a smooth function of lead beats fitting each lead separately when data are small [2].
- #1133 already does this: coefficients sit at the bin centres and are interpolated linearly in lead, and the edges are checked by G4. **No change needed.**

**3. Convergence to climatology.**
- Multi-model post-processing gains persist to about day 15, then converge to climatology [4][5].
- #1133 G3 expects a draw with `CLIM` in B3 (264-336 h). That matches the literature.

**4. Temporal coherence.**
- Calibrating each lead separately breaks the members' joint structure. Ensemble copula coupling (ECC) [10] restores it.
- That matters only if members or spread are served. #1133 serves one point field, so ECC is not needed for the ship. It is needed for any later probabilistic product.

## Red flags for the build PR (#1139): checks, not amendments
1. **Loss mismatch.**
   - The ridge fits squared error. The gate scores MAE.
   - For skewed wind speed, the mean-optimal and median-optimal forecasts differ. The gap is largest in strong-wind tails.
   - **Check:** report, on FIT only, the in-sample MAE of the ridge fit vs a median (L1) fit of the same form. If L1 is clearly better on FIT, that is a NEW registration, not an amendment.
2. **Season mismatch (Reflection).**
   - FIT runs from 2025-12-17 to 2026-09-30, so most rows are not winter. TEST is December-January only.
   - **Check:** report FIT-winter-only (Dec-Feb) coefficients next to the full-FIT ones, descriptively. A large gap explains a fail; it does not change the verdict.
3. **AI-member dispersion.**
   - AIFS-family dispersion errors flip sign with latitude [7], and AIGEFS's are unknown.
   - #1133 weights SYSTEMS equally (its explicit choice), so AIGEFS carries 1/3 of the mean.
     - Under member weights the shares would instead be IFS 51/113, GEFS 31/113 and AIGEFS 31/113 (corrected 2026-11-22, director).
     - Either way, this is not a flaw for the served mean, but the reported spread-skill and ±1 SD reliability will mix two dispersion regimes.
   - **Check:** report spread-skill per system before pooling.
4. **Only the speed is rescaled.**
   - Pooling vectors shrinks speed (the vector-mean speed is below the mean speed). #1133 rescales `f` to `f_s`, which is correct.
   - **Check:** the direction plant (§7) is the only test of the direction path. Confirm the build computes direction from the calibrated vector `f`, not from the raw pooled mean.
5. **A simple baseline (SubQ).**
   - At days 8-16 most of the gain of any careful calibration over a plain damped blend is small.
   - Already covered: `GRAND_RAW` and `CLIM` are reported.
   - **Add, descriptively:** `GRAND_RAW` damped by one constant alpha per bin (no region split). This shows how much the region × bin coefficient set buys, and it is a cheap guard against over-parameterisation.
6. **Licence.** The AIGEFS/GraphCast commercial-use read (#1133 §9) blocks shipping any AIGEFS arm. It is unchanged and still owed by the legal lane.

## Bottom line for the director
- The design is SOTA-class and already follows the newer lead-continuous practice.
- Rename the method "shrunk-mean MOS".
- Add the four descriptive checks (L1 vs L2 on FIT, winter-only coefficients, per-system spread-skill, a one-alpha baseline) to the build PR. None touches the frozen gate.

## References
Not re-fetched this session unless marked VERIFIED. Earlier reads are in `log/2026-11-15-senior-research-lead-sota-plan.md`.
1. Gneiting, Raftery, Westveld, Goldman (2005). Calibrated probabilistic forecasting using ensemble model output statistics and minimum CRPS estimation. *Monthly Weather Review* 133, 1098-1118. doi:10.1175/MWR2904.1
2. Wessel, Ferro, Evans, Kwasniok (2024). Lead-time-continuous statistical postprocessing of ensemble weather forecasts. *Quarterly Journal of the Royal Meteorological Society* (found via Consensus earlier in this programme).
3. Roberts et al. (2023). IMPROVER: the new probabilistic postprocessing system at the Met Office. *Bulletin of the American Meteorological Society* 104(3), E680-E697. doi:10.1175/BAMS-D-21-0273.1
4. Li et al. (2021): multi-model EMOS of extended-range forecasts (Consensus, earlier read). Gains persist to long leads and converge to climatology near day 16.
5. Lindas et al. (2026): multi-model post-processing at sub-seasonal leads (Consensus, earlier read). Same convergence finding.
6. Price et al. (2025). Probabilistic weather forecasting with machine learning (GenCast). *Nature* 637, 84-90. doi:10.1038/s41586-024-08252-9
7. Lang et al. (2024). AIFS-CRPS: ensemble forecasting using a model trained with a loss function based on the continuous ranked probability score. arXiv:2412.15832
8. Sop Nkuiate et al. (2026): AIFS-CRPS in an EMOS blend with fixed weights; slight gains (Consensus, earlier read).
9. Trotta et al. (2025): IMPROVER piecewise-linear lead weights, smoothed against overfitting; small gains to day 9 (Consensus, earlier read).
10. Schefzik, Thorarinsdottir, Gneiting (2013). Uncertainty quantification in complex simulation models using ensemble copula coupling. *Statistical Science* 28(4), 616-640. doi:10.1214/13-STS443
