# Researcher note: how operational systems combine and post-process multi-model wave forecasts (2026-11-12)

Requested by the weather simulation audit session (director `local_d6b521eb`) to support move4 (`local_1b7a2ed1`) consensus work.
Scope: literature only. Docs only. No code, no backend calls, no served change.

## 0. Limits of this note (read first)

- **Abstracts, not full texts.** Every paper below was read through the Consensus or latest-science abstract. Claims are the abstracts' claims. None was opened in full.
- **NBM v5 wave text not verified.** The NWS notice `scn26-24NBM_V5(1).0_aaa.pdf` was fetched, but the tool returned compressed PDF bytes and no text. The only NBM wave statement I have is a search snippet (section 1.3).
- **No ECMWF or Météo-France wave-combination practice found.** The Météo-France search returned MFWAM facts only (section 1.4).
- **latest-science arXiv returned 0 results** for the wave multi-model query. The other latest-science call failed its schema check and was not retried.
- **No scite tool is available in this session.** The request named scite-style search. I used Consensus, latest-science and WebSearch instead.
- **Reflection second opinion not requested.** The Reflection tool is for when the user asks for it. David did not ask, so I did not call it. The director should ask David if it is wanted.
- **Expected gains below are from other systems, not ours.** None of them is a skill gain we should expect on our ledger. They say where to look, not what to expect.

## 1. Equal mean vs BMA vs EMOS for significant wave height

### 1.1 What the sources show

- **BMA (Raftery et al. 2005).** A weighted mixture of bias-corrected member PDFs, with weights from training-period skill. Tested on 48-h surface temperature (MM5 ensemble), not waves. BMA point forecasts had RMSE 7% lower than the best member and 8% lower than the ensemble mean. [Using Bayesian Model Averaging to Calibrate Forecast Ensembles](https://consensus.app/papers/details/w:e64bdc3e-963d-42e1-81cb-79fd66cfd182/?utm_source=claude_code) (Raftery et al., 2005, MWR).
- **EMOS (Gneiting et al. 2005).** Mean is a bias-corrected weighted average of members, with coefficients fitted by minimum CRPS. Applied to 48-h sea level pressure and temperature. Deterministic-style EMOS had RMSE 9% lower than the bias-corrected ensemble for pressure. [Calibrated Probabilistic Forecasting Using Ensemble Model Output Statistics and Minimum CRPS Estimation](https://consensus.app/papers/details/w:3452c96e-c2a9-4d47-a83e-86b3c96b4cc6/?utm_source=claude_code) (Gneiting et al., 2005, MWR).
- **Multi-model super-ensemble for waves (Lenartz et al. 2010).** Four wave systems in the Adriatic (DART06), Hs at six stations plus altimeter tracks. A Kalman-filter super-ensemble reduced bias in hindcast and forecast, with correlation similar to the best single model. Spatial extrapolation was not solved. [Super-ensemble techniques applied to wave forecast: performance and limitations](https://consensus.app/papers/details/w:9cf2e89f-aeee-40dc-a766-7183a7671314/?utm_source=claude_code) (Lenartz et al., 2010, Ocean Science).
- **Linear-regression super-ensemble (Majumder et al. 2018).** Three wave models for the Indian Ocean. A modified Krishnamurti regression beat the standard one during cyclones, with 24-h lead times. [Modification of a linear regression-based multi-model super-ensemble technique...](https://consensus.app/papers/details/w:e79f4d41-edce-4427-8772-2d18321145d1/?utm_source=claude_code) (Majumder et al., 2018, J. Operational Oceanography).
- **Local BMA for sea state (Kokina et al. 2023).** Aran Islands, public forecasts with ensembleBMA. Reported 1–8% improvement and 6–48% error reduction, depending on the case. [Improving the sea state forecasts by using local wave observations and the ensembleBMA software](https://consensus.app/papers/details/w:e05346a4-f300-456c-bd2e-2491330d39b5/?utm_source=claude_code) (Kokina et al., 2023, Environmental Data Science).
- **Calibration, one provider (Murphy et al. 2025).** Linear and non-homogeneous Gaussian regression for Hs, wind and Tm, horizons 0–168 h, North Sea. Calibration brought Hs bias to near zero. Covariates: deterministic forecast and ensemble mean, plus a cross-variable term. [Calibration of medium-range metocean forecasts for the North Sea](https://consensus.app/papers/details/w:60064abe-38c8-4551-916f-c71446ed58b2/?utm_source=claude_code) (Murphy et al., 2025, Applied Ocean Research).
- **Wave probabilities from ECMWF EPS (Roulston et al. 2005; Sætra et al. 2004).** Roulston: post-processing gave better-calibrated Hs ensembles, better at predicting expected error. Sætra: spread-class error bounds track deterministic skill; the wave EPS showed a small overconfidence above 6–8 m. [Forecasting wave height probabilities with numerical weather prediction models](https://consensus.app/papers/details/w:a63d9edc-42c7-4035-a548-363e8ae5477d/?utm_source=claude_code) (Roulston et al., 2005, Ocean Engineering); [Potential Benefits of Using Probabilistic Forecasts for Waves and Marine Winds Based on the ECMWF Ensemble Prediction System](https://consensus.app/papers/details/w:ade5f75f-1b63-4443-9e33-cd3c21db0b90/?utm_source=claude_code) (Sætra et al., 2004, Weather and Forecasting).

### 1.2 NCEP practice

- **GEFS-Wave.** WAVEWATCH III in a 30-member perturbed ensemble plus control. Products: ensemble mean, spread, exceedance probabilities at 0.25°. Operators note the spread is too narrow, which signals overconfidence. A proposed multi-model wave ensemble would add the Canadian CMCE and ECMWF members, described as experimental. [NCEP wave ensemble products](https://polar.ncep.noaa.gov/waves/nfcens) and [GWES probabilistic wave height guidance](https://ocean.weather.gov/gwes_explain.php) (search snippets, not opened). Source for the 30-member count: product inventory snippet.
- **Gap.** I did not confirm the current operational version of GEFS-Wave.

### 1.3 NBM wave guidance

- The NBM v5.0 notice (April 2026) says Hs forecasts now represent the mean of the quantile-mapped distribution, for CONUS, Alaska, Hawaii, Puerto Rico, Guam and Oceanic. The MDL documentation says v5.0 uses quantile mapping and dressing (QMD) for probabilistic wave guidance. Marine 10th/50th/90th percentile Hs was added in v4.1. [NBM v5 notice, search snippet](https://www.weather.gov/media/notification/pdf_2026/scn26-24NBM_V5(1).0_aaa.pdf); [NBM documentation](https://blend.mdl.nws.noaa.gov/nbm-documentation). Not verified against the PDF text.
- **Implication for us:** NBM does not do equal means. It maps quantiles, then combines. Its wave inputs (WW3 global ensemble and regional runs) are a mix, so its combination is not a pure multi-model average. The exact dressing steps are unverified.

### 1.4 ECMWF and Météo-France

- **ECMWF.** Only the EPS wave spread and calibration papers above. No source on how ECMWF combines wave models with other models.
- **Météo-France.** MFWAM is forced by ECMWF IFS winds. Copernicus publishes 3-hourly Hs, period, direction and partitions. No PEARP wave ensemble or multi-model combination was found. [Copernicus Global Ocean Waves Analysis and Forecast](https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027) (product page snippet).

### 1.5 Expected skill gain over equal mean (from other systems; not ours)

| Method | Source of gain | Gain reported | Data needed | Caveat |
|---|---|---|---|---|
| Equal mean (baseline) | none | none | members at each lead | the reference |
| Bias-corrected mean | removes systematic bias | Murphy 2025: bias near zero | 1 season of paired forecasts and obs | likely the largest single gain for us |
| Linear regression on mean | bias and scale | Murphy 2025 | as above | regression on the mean only |
| Super-ensemble (Kalman or LR) | per-model weights | Lenartz 2010: bias down, correlation similar to best model | hindcast of each member, obs | weights from a few stations |
| BMA | member weights and spread | Raftery 2005: 8% RMSE vs mean (temperature) | training window of member and obs pairs | not tested on waves in these sources |
| EMOS | bias and spread, CRPS fit | Gneiting 2005: 9% RMSE vs bias-corrected mean (pressure) | as BMA | needs a spread term |

### 1.6 Smallest pre-registered test (on our ledger rows)

- **Question:** does a bias-corrected mean beat the equal mean of the available members on Hs at 24 h, on Hawaii buoys?
- **Design:** paired by buoy and forecast hour. Bias correction fitted on a rolling 30-day window, then applied to the next day. Compare MAE and bias against the equal mean.
- **Primary metric:** Hs MAE at 24 h. Secondary: bias.
- **Uncertainty:** buoy-cluster bootstrap, 2,000 reps. Supported only if the 95% interval of the difference lies entirely below zero.
- **Stop rule:** if fewer than five buoy clusters have data, record and do not conclude. This matches the Hawaii note (section 3 of the log from this morning).
- **Power caveat:** the Hawaii set is about six buoys. A significant result would be surprising at that size.
- **Not done:** I did not open our ledger rows' schema to confirm which rows carry the unknown tier. The test is written from the design log's method, not from the rows themselves.

## 2. Missing member (the 'unknown' tier)

- **Sources.** Fraley et al. (2009) extend BMA to missing members and exchangeable members. The BMA postprocessed combined ensemble beat each individual ensemble. [Calibrating Multimodel Forecast Ensembles with Exchangeable and Missing Members Using Bayesian Model Averaging](https://consensus.app/papers/details/w:d6aa27b2-09e5-4fa3-a31b-983504d98b35/?utm_source=claude_code) (Fraley et al., 2009, MWR). The abstract says exchangeable members share weights and component parameters. It does not say how a missing member is handled in the mixture; that is in the full paper (not read).
- **Practical rule (my inference, not from a source):** when a member is missing, take the weighted mean over the available members and renormalise the weights. Never impute a zero. Keep the member count in the tier label, as the design log already does.
- **Smallest test:** compare the renormalised mean with the mean of the full set on dates where all members are present, then drop one member at random. A paired difference on Hs MAE tells us the cost of a missing member.

## 3. Direction and period consensus

- **Direction.** Arithmetic means of directions are wrong near 0/360°. Le Bao et al. (2009) use von Mises components for a BMA over wind direction, with circular–circular bias correction. [Bias Correction and Bayesian Model Averaging for Ensemble Forecasts of Surface Wind Direction](https://consensus.app/papers/details/w:94dda786-4208-433b-ba34-787dde03351c/?utm_source=claude_code) (Bao et al., 2009, MWR). This is wind, not waves; it supports the method for direction.
- **Practical rule (my inference):** average directions as unit vectors, weighted by Hs, then take the angle of the resultant. Report the resultant length as a spread measure. Our circular MAE is the right metric.
- **Partitions.** I found no source on combining partitions across models. My inference: match partitions across members by peak period and direction before averaging, so that swell from one model is not averaged with wind-sea from another. Partition matching is a separate step from the mean.
- **Period.** Averaging periods is linear and safe only where the partitions match. The partitioning papers in the design log (Portilla-Yandún et al. 2008; Wyatt et al. 2022) are the starting point, abstracts only.
- **Smallest test:** Hs-weighted circular mean vs arithmetic mean of directions on the Hawaii buoys, at 24 h. Paired, same bootstrap as section 1.6.

## 4. Top recommendation

Keep the equal mean of available members as the baseline, with the member count in the tier. Test a bias-corrected mean (section 1.6) before any BMA or EMOS. For direction, switch to an Hs-weighted circular mean (section 3) only after the test. Do not add a second consensus path to the served chain.

## 5. Not verified

- Full texts of every paper above.
- NBM v5 wave QMD details and effective date (PDF unreadable).
- ECMWF and Météo-France wave combination practice (none found).
- GEFS-Wave current operational version.
- Our ledger rows' tier schema.
- Any gain on our data. Every number above is from another system.

## 6. Second opinion (Reflection, 2026-11-12, requested by David)

Reflection (Beam-1.0) reviewed section 4 and the rules in sections 2 and 3. Its points, recorded as its view, not as evidence:

- **Ordering is defensible, but power is low.** About six buoys and a 30-day window can miss real gains, and the BMA/EMOS gains come from temperature, pressure, Adriatic and North Sea settings, not surf Hs. Treat them as hypotheses.
- **Missing members.** Renormalising beats zero-imputing, but missingness may not be random: a member dropped in high seas or in one regime would shift the effective weights. Add a missingness diagnostic by regime before adopting the rule.
- **Direction weighting.** Hs is not energy; energy scales roughly with Hs². Add an energy-weighted sensitivity run. In bimodal seas one resultant direction can mislead, so report the resultant length alongside it.
- **Partition matching.** Thresholds on peak period and direction are arbitrary, and partition labels can flip for small differences, causing discontinuities. Add threshold sensitivity before adopting it.
- **Overall:** proceed only as hypotheses, with energy-weighting, missingness and threshold sensitivity runs added to the test plan in section 1.6 and section 3.

## Sources

- [Using Bayesian Model Averaging to Calibrate Forecast Ensembles](https://consensus.app/papers/details/w:e64bdc3e-963d-42e1-81cb-79fd66cfd182/?utm_source=claude_code) (Raftery et al., 2005)
- [Calibrated Probabilistic Forecasting Using Ensemble Model Output Statistics and Minimum CRPS Estimation](https://consensus.app/papers/details/w:3452c96e-c2a9-4d47-a83e-86b3c96b4cc6/?utm_source=claude_code) (Gneiting et al., 2005)
- [Super-ensemble techniques applied to wave forecast: performance and limitations](https://consensus.app/papers/details/w:9cf2e89f-aeee-40dc-a766-7183a7671314/?utm_source=claude_code) (Lenartz et al., 2010)
- [Modification of a linear regression-based multi-model super-ensemble technique...](https://consensus.app/papers/details/w:e79f4d41-edce-4427-8772-2d18321145d1/?utm_source=claude_code) (Majumder et al., 2018)
- [Improving the sea state forecasts by using local wave observations and the ensembleBMA software](https://consensus.app/papers/details/w:e05346a4-f300-456c-bd2e-2491330d39b5/?utm_source=claude_code) (Kokina et al., 2023)
- [Calibration of medium-range metocean forecasts for the North Sea](https://consensus.app/papers/details/w:60064abe-38c8-4551-916f-c71446ed58b2/?utm_source=claude_code) (Murphy et al., 2025)
- [Forecasting wave height probabilities with numerical weather prediction models](https://consensus.app/papers/details/w:a63d9edc-42c7-4035-a548-363e8ae5477d/?utm_source=claude_code) (Roulston et al., 2005)
- [Potential Benefits of Using Probabilistic Forecasts for Waves and Marine Winds Based on the ECMWF Ensemble Prediction System](https://consensus.app/papers/details/w:ade5f75f-1b63-4443-9e33-cd3c21db0b90/?utm_source=claude_code) (Sætra et al., 2004)
- [Calibrating Multimodel Forecast Ensembles with Exchangeable and Missing Members Using Bayesian Model Averaging](https://consensus.app/papers/details/w:d6aa27b2-09e5-4fa3-a31b-983504d98b35/?utm_source=claude_code) (Fraley et al., 2009)
- [Bias Correction and Bayesian Model Averaging for Ensemble Forecasts of Surface Wind Direction](https://consensus.app/papers/details/w:94dda786-4208-433b-ba34-787dde03351c/?utm_source=claude_code) (Bao et al., 2009)
- [Spectral Partitioning and Identification of Wind Sea and Swell](https://consensus.app/papers/details/w:e8d4d806-4e00-42b9-a558-31780bfb01b4/?utm_source=claude_code) (Portilla-Yandún et al., 2008) (abstract, earlier Consensus search)
- [Swell and wind-sea partitioning of HF radar directional spectra](https://consensus.app/papers/details/w:7fe0612e-d7f0-40f6-ba6c-9d58ed36ae97/?utm_source=claude_code) (Wyatt et al., 2022) (abstract, earlier Consensus search)
- [NBM v5 notice](https://www.weather.gov/media/notification/pdf_2026/scn26-24NBM_V5(1).0_aaa.pdf) (search snippet only; PDF unreadable)
- [NBM documentation](https://blend.mdl.nws.noaa.gov/nbm-documentation) (search snippet)
- [NCEP wave ensemble products](https://polar.ncep.noaa.gov/waves/nfcens) (search snippet)
- [GWES probabilistic wave height guidance](https://ocean.weather.gov/gwes_explain.php) (search snippet)
- [Copernicus Global Ocean Waves Analysis and Forecast](https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027) (search snippet)
- Hawaii note this session: `docs/weather-program/log/2026-11-12-researcher-hawaii-island-shadowing.md` (section 3, the buoy test)
- Design log: `docs/weather-program/log/2026-11-12-researcher-moves-4-5-design.md`
