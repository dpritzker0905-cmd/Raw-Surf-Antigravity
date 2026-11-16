# Researcher log, 2026-11-15: SOTA research passes 1 to 5

Lane: researcher (measurement and documentation only). This log records measurements. It changes no served number, merges nothing, and does not mark any PR ready.

Authorization on record: David's typed requests in this session to run research passes, to bounce each pass off SubQ, LongCat and Reflection, and to give the director a plan of action. The LongCat submission is held for David's approval of its payload hash (see Reviews).

## What was measured

Scripts and outputs: `docs/weather-program/evidence/2026-11-15-sota-passes/` (committed with this log; run order in its README). Public data only: NDBC realtime2 and historical stdmet and spectral files; Open-Meteo marine API, model `ncep_gfswave025`, analysis best-estimate fields. No lead-24 fields were used in this pass (see Not measured).

| Measurement | Definition | Result |
|---|---|---|
| H1 height, forward holdout (pass 4 / 5a) | fit 2024, test 2025; buoy >= 0.5 m and model >= 0.3 m; 14 stations | MAE 0.2379 to 0.1864 m, gain 0.0515 m, day-block 95% CI [0.047, 0.056]; station-bias r 0.915 |
| H2 height shape, forward (pass 5c) | model >= 0.5 m; fit 2024; test 2025 (105,839 h) | station constant gain 0.0503 [0.0459, 0.0546]; pooled constant 0.0305 [0.0271, 0.0338]; station x forecast bin 0.0531 [0.0484, 0.0572]; station linear 0.0532 [0.0485, 0.0575] |
| H2 contrasts (paired gains) | same test | station over pooled +0.0199 [0.0172, 0.0228]; bin over station constant +0.0028 [0.0009, 0.0044]; pooled slope over pooled constant -0.0001 [-0.0006, 0.0003] |
| H2 residual above 3 m | bias after correction | station constant -0.138 m; station x bin -0.044 m |
| H3 reverse holdout (pass 5d) | fit 2025 full year; test the 2024 hours the archive has (Jun 19 to Dec 31); 56,558 h | station constant gain 0.0410 [0.0334, 0.0486]; pooled 0.0201 [0.0139, 0.0266]; station x bin 0.0488 [0.0417, 0.0563]; bin over constant +0.0078 [0.0061, 0.0095]; station-bias r 0.917 |
| S1 swell direction, 24 h persistence, like-for-like (pass 5b) | NDBC realtime2 `.spec` SwD against model swell direction; 2026-10-01 to 2026-11-15; 14,561 shared hours; 17 buoys | model 37.5 deg, persistence 37.8 deg, gain +0.3 deg [-1.7, +2.5] |
| S1 total direction, same hours | NDBC MWD against model wave direction | model 25.0 deg, persistence 36.5 deg, gain +11.5 deg [8.9, 14.2] |
| S1 sensitivity, SwH and WVHT >= 1.0 m | same definitions, larger swell only; 11,694 shared hours | swell: model 36.5 deg, persistence 35.7 deg, gain -0.8 deg [-3.3, +1.7]; total: model 25.0 deg, persistence 33.7 deg, gain +8.7 deg [6.4, 10.9] |

## Corrections to earlier passes

- Earlier passes reported total-direction persistence of 30 to 37 deg and a partition-truth persistence of 27.9 deg. The partition-truth number (`docs/weather-program/log/2026-11-11-claude-partition-truth.md`) comes from a spectral watershed partition (Gerling 1992; Hanson and Phillips 2001). The NDBC `.spec` SwD is a different truth. Like-for-like on one window, swell partition direction is a tie at SwH >= 0.5 m (model 37.5 deg against persistence 37.8 deg, CI spanning zero) and leans toward persistence at SwH >= 1.0 m (36.5 deg against 35.7 deg, CI [-3.3, +1.7]). The sign at 1.0 m matches the spectral-watershed evidence, in which persistence also beat the model. Total direction favours the model by 8.7 to 11.5 deg at both thresholds. These are two different measurements, not a column error.
- The 2024 height fit in passes 4 and 5a used 2024-06-19 to 2024-12-31 only (F1). Pass 4's claim must be read with that scope.

## Forensics

F1. Archive gap, not land. Open-Meteo `ncep_gfswave025` returns null `wave_height` and null `wave_period` at every probed cell (46086, 41043, 51003) from 2024-01-01 to about 2024-06-18. The 2025 control has no gap. The pass-2 land rule (zero or null height and period = land) therefore flags 46.5 percent of 2024 hours at all 15 stations that have a 2024 file. A station-level test at the pass-2 threshold (25 percent) would have excluded every station. Consequence: the pass 4 and 5a 2024 fits are half-year fits. H3 (fit on 2025, test on the 2024 hours that exist) is the check that does not depend on the gap.

F2. Null does not mean sea. A probe at Denver (inland) returns null for every hour of January 2025. Null marks land and the gap alike, so a land test must not rely on null alone.

F3. Column positions. The realtime2 `.spec` names row is `YY MM DD hh mm WVHT SwH SwP WWH WWP SwD WWD STEEPNESS APD MWD`, so SwD is column 10, not 11. The first two runs of the swell test stopped on a header guard before writing any output; the final run takes columns from the names row. Raw check, 46025 at 2026-11-15 18:40 UTC: WVHT 1.8, SwH 1.8, SwD WSW, MWD 240, consistent.

F4. Reproduction. The cache built once in pass 5c (`d6_shape.py`, `d6_rows.json`) reproduces pass 4 exactly: 56,806 fit hours, 106,715 test hours at 14 stations, MAE 0.2379 to 0.1864, gain 0.0515, r 0.915, and the same bin residuals. The cache shares its parsers with pass 2, so the blind replication below is the independent check of the parsers.

F5. Station coverage. 2024 buoy records are uneven. 51002 has 1,604 hours, all in Oct to Dec. 46025 has no kept hours in Aug to Oct. 44008 has none in Nov to Dec. 44011 has no 2024 hours at all. 46002 has no 2024 stdmet file (404). 46042 and 46005 have no stdmet archive. 44014 reports MM for SwH and SwD in every `.spec` row (2,152 rows), so the swell test has 17 buoys.

## Reviews (David's request: bounce each pass off SubQ, Reflection and LongCat)

- SubQ (`subq-snap-1.1`, three structured questions on the pass text): the weakest link was judged to be analysis-only fields (p 0.99). Evidence level was judged moderate, two split directions with analysis fields only (p 0.95). Its "claims exceed evidence" answer was low (0.02), which disagrees with Reflection on the swell claim. Treat as a weak signal.
- Reflection (Beam-1.0, high effort): a per-station constant does not follow from analysis-only holdouts, and should ship at most as a monitored, kill-switched experiment. The swell result is "not well supported": a CI that spans zero shows no detectable skill, not proof of no skill, and total-direction skill on the same hours points to a definition problem in the swell partition. Test that would most change the decision: a pre-registered lead-24 forecast holdout across a year and several seasons.
- LongCat: preview only (offline). Payload sha256 `e81c9a69aa793fc0384211f2b0decbd8bcd8420c909279d556f52fee0e6d2b41`, 3,718 bytes. Submission sends the excerpt off this machine and needs David's approval of this hash. Not submitted.

## Blind replication

An independent replicator rebuilt the measurements from Appendix A, blind to these scripts and numbers (stdlib, 126 requests, 4 documented 404s, cache-only final run).

- S1 swell, like-for-like (set I, n = 14,806 station-hours): replicator model 37.29 deg, persistence 37.65 deg, gain +0.36 deg [-1.68, +2.53]. Ours: 37.48 / 37.80, gain +0.32 [-1.73, +2.49]. Agreement.
- S1 total (same hours): replicator model 24.86 deg, persistence 35.71 deg, gain +10.85 deg [8.26, 13.56]. Ours: 25.04 / 36.53, gain +11.49 [8.94, 14.15]. Agreement in sign and size. The gap is inside the replicator's own sensitivity: chronological record order gives +11.40 deg; a strict 20-minute test gives +10.88 deg.
- H1/H2 height, fit 2024, test 2025: replicator gain 0.0476 m [0.0435, 0.0515] over 16 stations (65,164 fit hours, 115,322 test hours). Ours: 0.0515 m [0.047, 0.056] over 14 stations. The difference is not a parser disagreement; it is a station-set and hour-set difference, explained below. Headline to quote: 0.048 to 0.052 m until the rerun in F6.
- Data probe (replicator, independent): the 2024 null block is identical at all 18 stations, contiguous from 2024-01-01 00:00 to 2024-06-19 05:00 UTC, with 4,086 null hours and no zeros; 2025 has no nulls. Agrees with F1.
- Replicator sensitivity, one change at a time: persistence limited to the window (identical); shared RNG (total CI moves to [8.16, 13.64]); the literal reading that keeps invalid records gives only 26 usable set-I hours, so it was not used.

F6. Hour and station selection in our height runs (found by the replication). Our stdmet parser dropped any hour where DPD or MWD was missing, even when WVHT was valid. Station 44011 has WVHT for most of 2024 but no usable MWD or DPD, so our cache recorded zero 2024 hours for it and it was silently excluded from the offset fit. Our parser also skipped 46005 for 2024 because it shared a skip flag with 2025 (its 2025 file is 404; its 2024 file exists). Height analyses in passes 2 to 5 therefore use a different hour and station set from a WVHT-only definition. Not yet fixed. Owed: rerun the pass 4 and 5 height holdouts on a WVHT-only parse and report both sets side by side. Direction analyses correctly need MWD and are not affected.

F6 RESOLVED: WVHT-only rerun (d9_rerun_wvht.py, evidence folder). Hour rule as spec B1 (nearest whole hour, exact 30 minutes rounds down, first valid record per hour). Stations with a 2024 offset: 16 (all except 46042 and 46002, which have no 2024 stdmet file). The set includes 44011 and 46005. Fit: 65,164 energetic 2024 hours. Test: 115,322 energetic 2025 hours. Gain of the corrected analysis field over the raw analysis field: MAE 0.2396 to 0.1920 m, gain 0.0476 m, day-block 95% CI [0.0435, 0.0515]. This matches the replicator (0.0476 m, 65,164 and 115,322 hours). Supersedes the 0.0515 m (14 stations, DPD/MWD-filtered parse) in the pass 4 and 5a text, which was a parse artifact.

Definition of the gain (what the 0.048 m is):
- Gain of WHAT over WHAT: the mean-offset-corrected analysis field (per-station mean of model minus buoy over 2024 energetic hours) over the raw analysis field, both measured on 2025 energetic hours (buoy wave height at least 0.5 m and model at least 0.3 m).
- Lead time: 0 (analysis best estimate, not a forecast). It is NOT a forecast-lead gain and must not be compared with the +0.031 m at 24 h from the OCF readout (a forecast post-process gain with a different baseline).
- In-sample or held out: held out. The offset is fitted on 2024 (June 19 to December 31 only, see F1) and tested on 2025. Test hours never enter the fit.

Controls (d9_summary.json):
- POSITIVE control (seeded shift of +0.100 m added to the model in both 2024 and 2025): recovered shift is 0.1000 m at all 16 stations; corrected MAE unchanged at 0.1920 m. PASS.
- NULL arm (each station-year model series circularly shifted by a seeded 30 to 200 days, so model and buoy pairing is destroyed): gain -0.0965 m, CI [-0.1092, -0.0829]. FAIL: the lead's expectation is 0, and this is not 0. Working explanation, NOT verified: the offset targets the mean error, while the gain is a mean absolute error, and under unrelated pairs with skewed errors (raw MAE 0.78 m on the shifted series) subtracting the mean raises MAE. So the gain statistic is not calibrated to 0 under the null. The real-pairing gain (+0.048 m) lies well above this null, but the null must be re-designed (for example, a median-offset arm, or a shuffled-pairing arm within matched height bins) before this statistic is used as a significance test. Owed.

Total direction, by kind (d10_summary.json, same definitions, persistence = the same kind's buoy direction 24 h earlier):
- Pooled total direction (NDBC MWD, all partitions together, as in the earlier S1 total): model 24.5 deg, persistence 38.3 deg, gain +13.8 deg [11.1, 16.6], n 17,361. Pooled, so kinds are mixed here.
- Wind-sea alone (NDBC WWH and WWD, NDBC's own split; model wind_wave_direction): model 16.4 deg, persistence 31.5 deg, gain +15.1 deg [12.2, 18.5], n 6,428.
- Swell alone (NDBC SwH and SwD; model swell_wave_direction): model 36.8 deg, persistence 37.5 deg, gain +0.6 deg [-1.3, +2.9], n 14,710. In this parse the swell gain is +0.64, not +0.36 (earlier parse rule); both have CIs spanning zero.
- Intersection of all three kinds (n 5,360): swell -5.7 deg [-9.2, -2.5] (model worse than persistence on this subset), wind-sea +11.0 [8.5, 13.5], total +11.9 [8.0, 16.2]. The swell sign depends on which hours are included.
- So the +10.85 total gain (pass 5 replicator) is pooled across kinds, and most of it comes from wind-sea hours. The swell kind alone shows no gain.

PRE-REGISTERED NULL (station-label swap), written before the run, per the senior research lead's ruling. Statistic: the same WVHT-only gain (d9 fit and test rows, 16 stations), with each station's offset replaced by the offset of a different station. Draws: 1,000 random derangements of the 16 stations (no station keeps its own offset), seed 2026. Expected under the null: gain at or below 0. Pass criterion for the per-station offset being informative: the true gain (+0.0476 m) exceeds the 95th percentile of the null draws. Reported: null mean, null 95th percentile, and the fraction of draws at or above the true gain. A time-shift null is NOT used for this claim: it keeps each station's mean bias, so it measures mean-bias removal (the lead's point, and the earlier -0.097 m result).

RESULT of the pre-registered null (d11_station_swap.py, d11_summary.json): true gain 0.0476 m, 115,322 test hours, 16 stations. 1,000 derangements at seed 2026. Null mean -0.0039 m, null 95th percentile +0.0178 m, null range [-0.0399, +0.0330] m. No null draw reached the true gain (fraction at or above true: 0.000). Pass criterion met: the true gain exceeds the null 95th percentile. The "at or below 0" expectation is met on average, not per draw: 627 of 1000 draws are at or below 0, and 373 are positive (max +0.033 m). So the per-station offset is informative, at a gain of about 0.05 m, and the swap null is not zero-calibrated per draw. Scope: this supports only "the per-station offset carries information at these 16 offshore buoys" (lead-0, analysis field).

PRE-REGISTERED (leave-one-out spatial offset, per the senior research lead's optional request). Question: do per-station offsets travel to a nearby place that has no buoy? Procedure, fixed before running: (1) same WVHT-only fit and test rows as the d9 rerun (16 stations; 2024 energetic fit, 2025 energetic test). (2) Coast groups fixed in advance: Atlantic = 44008, 44011, 44014, 41043; Pacific = all other stations (CA, PNW, HI). (3) For each held-out station h, its predicted offset is the inverse-distance-squared weighted mean of the OTHER stations' fitted offsets in the same coast group (great-circle distance, h excluded). Every group member has at least three neighbours, so no station is skipped. (4) Statistic: the gain at the held-out station, |e| minus |e minus predicted offset|, summed over all 2025 test rows and divided by all test rows (same metric as the 0.0476 m). Day-block CI (UTC date, 1,000 draws, seed 17). (5) Null: the same swap null, applied to the predicted offsets: 1,000 random derangements of stations, seed 2026. (6) Pass criterion for "offsets travel": the leave-one-out gain is above the null 95th percentile AND its CI excludes 0. If near 0, the offset stays buoy-only. Reported also: the leave-one-out gain as a fraction of the true per-station gain (0.0476 m).

RESULT of the pre-registered leave-one-out spatial offset (d12_loo_spatial.py, d12_summary.json): leave-one-out gain 0.0362 m, day-block CI [0.0319, 0.0403], which is 76 percent of the true per-station gain (0.0476 m). Null (1,000 derangements of predictions, seed 2026): mean -0.0038 m, 95th percentile +0.0198 m; fraction of null draws at or above the leave-one-out gain 0.001. Pass criterion met (gain above the null 95th percentile and the CI excludes 0). Reading, with limits: an offset fitted at the other buoys in the same coast group predicts a held-out buoy's offset well enough to keep most of the gain. This is evidence that offsets are spatially coherent at buoy spacing (hundreds of km). It is NOT yet evidence for surf spots, which sit km from the nearest buoy, and the coast groups are coarse (Pacific mixes CA, PNW and HI). A distance-decay test (gain as a function of distance to the nearest buoy) is the next step before any surf-spot claim. Owed.

F7. Other data facts from the replication: 46086's `.spec` covers only 2026-10-08 onward (379 usable swell hours in set I); 46042's `.spec` has SwH = MM in about half its records; 44011 and 44008 have many SwD = MM records. 44014 has SwH and SwD = MM in every record, so it contributes no swell hours.

## Plan of action for the director

1. Height correction: no default ship. Experiment behind a kill switch (default off) only after a lead-24 holdout passes. Pre-register: gain of at least 0.02 m at +24 h, a CI above zero in every season covered, and the same sign in both split directions. Station x forecast bin is worth its complexity only if it adds at least 0.005 m out of sample; the current evidence is +0.003 m (forward) and +0.008 m (reverse).
2. Lead-24 data: the repo's scored ledger (`scored-*.json` objects in Storage, from October 2026) joins served forecasts to buoy reports. Reading it needs the owner's word to dispatch the one-off read job (STATE commitment 1335). That word is requested.
3. Swell direction: no swell-direction claim. At SwH and WVHT >= 1.0 m the point estimate leans toward persistence (-0.8 deg, CI [-3.3, +1.7]), so the model's swell partition is not shown to beat the simplest baseline. Any swell-direction use must be validated over several seasons with the NDBC `swden` and `swdir` archives (2025 files confirmed present), not one 45-day window.
4. Land: the relocation lane should use a static land mask. Treat null as missing. A gap signature is null at many distant cells at the same hours; flag it as an archive gap, not land.
5. Scope every pass 4 and 5a claim as "2024 H2 fit".

## Not measured in this pass

- The north-star comparison against the public blend on the same buoy hours (not run).
- Forecast-lead skill for any height or direction result (not run; no lead-24 archive access here).
- Served numbers (no served probe).
- Rating accuracy beyond the MOP proxy from pass 4.

## Appendix A: specification given to the blind replicator

Measurement A (swell and total direction, 24 h persistence, like-for-like): NDBC realtime2 `.spec` (SwD by name, compass to degrees, rounding to the nearest UTC hour with exact half-hours rounding down) and `.txt` (MWD by name, nearest record within 20 minutes); Open-Meteo `swell_wave_direction` and `wave_direction`; SWELL rows need buoy SwH >= 0.5 m and model swell height >= 0.3 m; TOTAL rows need buoy WVHT >= 0.5 m and model height >= 0.3 m; persistence is the buoy direction 24 h earlier under the same height filter; like-for-like set = hours with both; day-block bootstrap, 1000 draws, seed 17.

Measurement B (height, fit 2024, test 2025): NDBC historical stdmet WVHT by name; exclude an hour where (height null or 0) and (period null or 0), and where height is null; energy filter buoy >= 0.5 m and model >= 0.3 m; per-station mean error from 2024; corrected MAE on 2025 with day-block CI; plus a null-versus-zero count probe for 46086, 41043, 51003 and 46025.

CORRECTION 2026-11-15 20:14 EST (append-only; line 51 is not edited): the headline "Headline to quote: 0.048 to 0.052 m until the rerun in F6" is superseded. The height headline is 0.0476 m [0.0435, 0.0515], lead-0 analysis only, held out (fit 2024 June 19 to December 31, test 2025), 16 stations; see F6 RESOLVED. Not a forecast gain. Quote it with that scope only.
