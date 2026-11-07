# 2026-11-05 · claude · Alert accuracy: measured wind skill, measured replay, pre-registered levers (FAIL, flag stays off)

Session: delegated by the lead. Branch `claude/alert-accuracy`, cut from `origin/dev` `df71341` (2026-11-04 23:3xZ).
Brief: measure the wind lead-time error the #718 replay assumed, replace the assumption, try pre-registered
precision levers, and flip `ALERTS_FORECAST_WINDOWS` only if the bar is met. DRAFT PR only. Nothing merged, flipped,
deployed, sent or read from user rows; the live backend was not called. **Outcome: FAIL. The flag default stays
'0'.** With the flag off and every new lever default off, no served number changes; the SCOREBOARD row records the
measurement and the verdict.

## Data I could reach, and what I could not

This sandbox's network policy blocks NDBC (`www.ndbc.noaa.gov`, `sdf.`, `dods.`), CO-OPS, CDIP, Open-Meteo, IEM and
ECMWF's own host. AWS Open Data and Google Cloud Storage are reachable. So:

- **Wind truth: the real C-MAN pier anemometers**, from NOAA ISD global-hourly on S3 (`noaa-global-hourly-pds`),
  which carries their FM-13 reports quality-coded: TRDF1, LJPC1, DUKN7 (the replay's own three), LKWF1, JMPN7,
  MROS1, PTAT2. Santa Monica Pier and Montauk were tried and dropped: their ISD wind is all missing.
- **Forecasts: archived 10 m wind**, byte-range reads of the U/V messages only: GFS 0.25 pgrb2 (S3), ECMWF IFS 0.25
  open data (the Google Cloud mirror; the AWS copy answered 503 SlowDown at ~1 request/s), HRRR CONUS (S3).
- **#718's input dir (`C:/t/flip-alertdata`, NDBC realtime2 + CO-OPS) is not reachable here**, so the replay runs
  on an ARCHIVED window built by `scripts/alert_replay_inputs.py`: 2024-09-19 .. 2024-11-06 (#718's calendar window
  one year earlier). Wind truth = the real anemometers; sea truth = GFS-Wave 0.25 ANALYSIS hours at the three buoys
  (a model, not the buoys: 1,152 of 1,176 hours, 24 archive files missing); tide = a SYNTHETIC astronomical series
  (true constituent speeds, coast-typical amplitudes, zero phase), shared by truth and forecast so it only decides
  which hours are mid/high. Every arm below runs on this same data, so the comparisons are paired; the absolute
  numbers are not #718's numbers. Re-running on #718's dir needs only `--data` (the replay reads either).

## Which lane rates alerts (read from the code)

`alert_horizon.py` rates every `SPOT_RATINGS_PRECOMPUTE_MODELS` lane (`GFS,EURO,ICON`); the alert decision reads
the served default, the first one, **GFS**. Its wind is NOAA GFS 0.25 10 m (`rate_one_spot` -> `resolve_point`
on the stored GFS wind product). **HRRR does not rate**: `wind_lane.py` blends it into served map wind tiles only
("spot points, ratings and glyphs ... see no change"). HRRR is measured below for comparison; it does not drive the
error model.

## 1. Measured wind skill (`scripts/wind_lead_skill.py`, evidence `wind_skill.json`)

Windows: 2024-04-08..05-05, 07-08..08-04, 09-19..11-03, 12-02..12-29. GFS: 00/12Z cycles (00/06/12/18Z in autumn),
leads 0-72 h every 3 h, 8,800 files, 0 errors, 59,403 pairs. ECMWF: 00/12Z autumn + 00Z other windows, 4,399 files,
29,719 pairs. HRRR: 00/12Z autumn, 0-48 h, 1,564 files, 10,693 pairs. HRRR's grid-relative wind is rotated to earth
(checked: its mean direction error matches GFS's at every station within 6 deg; a wrong sign shifts LJPC1 by ~25).

| lead h | GFS n | GFS bias m/s | GFS RMSE | GFS dir MAE | GFS class flip light / clean / offshore | ECMWF RMSE | ECMWF dir MAE | HRRR RMSE | HRRR dir MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2374 | +0.02 | 1.74 | 20 | 0.18 / 0.19 / 0.13 | 1.76 | 17.5 | 1.73 | 12.9 |
| 3 | 2406 | -0.02 | 1.66 | 19 | 0.17 / 0.17 / 0.12 | 1.62 | 17.1 | 2.03 | 19.5 |
| 6 | 2393 | +0.12 | 1.78 | 21 | 0.19 / 0.17 / 0.12 | 1.64 | 18.9 | 2.05 | 20.2 |
| 12 | 2368 | +0.17 | 1.87 | 22 | 0.20 / 0.19 / 0.14 | 1.75 | 21.1 | 2.22 | 21.9 |
| 24 | 2361 | +0.17 | 1.94 | 24 | 0.21 / 0.20 / 0.15 | 1.94 | 20.7 | 2.32 | 24.0 |
| 36 | 2361 | +0.17 | 1.99 | 25 | 0.21 / 0.20 / 0.15 | 1.85 | 22.5 | 2.32 | 23.7 |
| 48 | 2361 | +0.17 | 2.07 | 27 | 0.22 / 0.20 / 0.15 | 2.04 | 21.9 | 2.47 | 27.5 |
| 60 | 2353 | +0.19 | 2.11 | 28 | 0.23 / 0.22 / 0.17 | 2.00 | 25.1 | - | - |
| 72 | 2346 | +0.20 | 2.17 | 29 | 0.23 / 0.21 / 0.16 | 2.10 | 23.6 | - | - |

"Class flip" = the share of hours whose alert wind class (`surf_alert_windows.wind_classes` thresholds: light-wind
< 10 kt; clean < 5 kt or offshore <= 20 kt; offshore = offshoreness > 0.34 against the served chain's shore normal)
differs between forecast and pier. Direction is scored only when the pier reads >= 2 m/s.

GFS by regime (12-24 h bucket; full tables for every bucket in `wind_skill.json`):

| regime | n | bias m/s | RMSE | dir MAE | flip light / clean / offshore |
|---|---|---|---|---|---|
| calm (< 5 kt) | 1851 | +1.33 | 1.95 | 43.8 | 0.07 / 0.50 / 0.22 |
| light (5-10 kt) | 4205 | +0.48 | 1.59 | 25.9 | 0.26 / 0.21 / 0.17 |
| moderate (10-20 kt) | 3005 | -0.70 | 1.83 | 15.4 | 0.22 / 0.09 / 0.08 |
| strong (>= 20 kt) | 468 | -2.19 | 3.01 | 13.6 | 0.01 / 0.03 / 0.04 |
| day (09-18 local) | 3539 | +0.01 | 1.77 | 22.7 | 0.20 / 0.16 / 0.09 |
| night | 5990 | +0.22 | 1.87 | 22.6 | 0.20 / 0.19 / 0.16 |
| FL Atlantic | 2721 | +0.50 | 2.25 | 19.1 | 0.27 / 0.14 / 0.10 |
| Mid-Atlantic | 4079 | -0.21 | 1.74 | 21.4 | 0.21 / 0.22 / 0.18 |
| SoCal | 1361 | +0.56 | 1.33 | 37.3 | 0.03 / 0.22 / 0.11 |
| Gulf | 1368 | +0.07 | 1.60 | 25.2 | 0.20 / 0.11 / 0.07 |
| winter / spring / summer / autumn RMSE | | +0.41 / +0.06 / -0.07 / +0.14 | 2.03 / 1.79 / 1.96 / 1.74 | | |

What the measurement says, against what #712/#718 assumed (speed sd 1.8 m/s + 0.4/day, dir 25 deg + 10/day, AR(1)
rho 0.95/h, FRESH per 4-hourly issue):

1. **The error is mostly there at lead 0.** RMSE 1.74 m/s at the analysis, 2.17 m/s at 72 h; 18% / 19% / 13% of
   hours already flip the light-wind / clean / offshore class at lead 0, and 72 h adds 3-5 points. The grid cell does
   not see the pier's wind. No lead-dependent lever can remove a lead-0 error.
2. **It persists across runs.** One valid time's standardized error correlates **0.92** between GFS runs 6 h apart,
   0.86 at 12 h, 0.80 at 24 h (direction 0.80 / 0.75 / 0.66). #718 drew a fresh error every 4 h, which is why its
   two-cycle hysteresis looked effective (0.79-0.83).
3. **The second model shares it.** GFS and ECMWF errors at the same station, cycle and valid time correlate **0.83**
   in speed and 0.56 in direction (pooled over leads).
4. **It is biased by regime and station**: calm hours over-forecast by 1.1-1.5 m/s, moderate under by 0.7-0.8,
   strong under by 2-2.8; GFS over-forecasts Trident Pier by 1.4-2.2 m/s in every class below 20 kt.
5. Within one run the error decorrelates faster than assumed: hourly rho 0.82 (lag 3 h 0.51, 6 h 0.33).
6. **HRRR is no better than GFS at these piers** past 3 h (RMSE 2.0-2.5 vs 1.7-2.1). Its lead-0 direction is best.

Hs persistence (GFS-Wave forecast vs GFS-Wave analysis at the three buoys, autumn, 2,340 files): hourly rho 0.886,
runs 6 h apart 0.82, 12 h 0.70. A proxy (the analysis is not the buoy); the replay keeps #718's measured Hs MAE by
lead (SCOREBOARD 2026-09-29/30) for the size and takes only the persistence from here.

## 2. The replay on the measured model (`--error-model measured`, the new default)

`scripts/alert_window_replay.py`: per station x observed-speed class, speed bias and sd and direction sd linear in
lead (`fit_error_model`); each error = sqrt(c) x a valid-time-shared AR(1) + sqrt(1 - c) x a fresh per-issue AR(1),
c = the measured 6 h cross-cycle correlation; a EURO peer lane drawn with the ECMWF fit at the measured GFS-ECMWF
correlation; Hs as above, the peer's Hs at rho_hs (0.8 pre-registered, 1.0 sensitivity). Model file:
`evidence/2026-11-04-alert-accuracy/measured_error_model.json`. #718's assumed model is kept (`--error-model
assumed`). Same 3 spots x 3 classes x seeds 0-4, hourly frames, issues every 4 h, notify lead 24 h, premium tier.

Paired BEFORE (#718's shipped defaults, `baseline`) and AFTER (each lever), sigma 1, measured model, rho_hs 0.8
[1.0 in brackets for L1 configurations]. Precision / recall; every row has max 2 per user-day and 0 outside the tier
window (the kill-switch arm reaches 5 and 3 per day without the cap, as in #718):

| config | size only 2-6 ft | morning+afternoon offshore light | dawn clean mid/high tide | verdict |
|---|---|---|---|---|
| baseline (#718) | 0.720 / 0.702 | 0.575 / 0.600 | 0.802 / 0.742 | fail |
| L1 agree | 0.762 / 0.638 [0.730 / 0.660] | 0.766 / 0.538 [0.750 / 0.554] | 0.846 / 0.642 [0.854 / 0.683] | fail |
| L2 lead margins | 0.758 / 0.675 | 0.615 / 0.554 | 0.809 / 0.742 | fail |
| L2b (double) | 0.767 / 0.645 | 0.656 / 0.554 | 0.796 / 0.708 | fail |
| L3 lead hysteresis | 0.743 / 0.642 | 0.607 / 0.538 | 0.800 / 0.700 | fail |
| L1+L2 | 0.793 / 0.589 [0.765 / 0.634] | 0.805 / 0.477 [0.818 / 0.508] | 0.864 / 0.633 [0.872 / 0.683] | fail |
| L1+L3 | 0.778 / 0.555 [0.748 / 0.596] | 0.825 / 0.492 [0.810 / 0.492] | 0.859 / 0.608 [0.867 / 0.650] | fail |
| L1+L2+L3 | 0.801 / 0.536 [0.772 / 0.585] | 0.838 / 0.446 [0.846 / 0.462] | 0.880 / 0.608 [0.886 / 0.650] | fail |

- sigma 0 control: precision 1.000 in every arm; baseline recall 0.981 / 1.000 / 1.000.
- sigma 2 (stress, baseline): 0.542 / 0.555, 0.360 / 0.385, 0.544 / 0.617.
- Today's current-height alerts on the same data (sigma 1): precision 0.150 / 0.019 / 0.026.
- Realised windows: 53 (size), 13 (offshore), 24 (dawn) over 3 spots and ~45 days. ⚠️ Offshore's recall moves in
  steps of 1/13 = 0.077; treat its rows as coarse.
- For continuity, #718's ASSUMED model on this same data (`--error-model assumed`, baseline): precision 0.586 /
  0.449 / 0.472 at recall 0.917 / 0.954 / 0.983, and #718's replay-only two-cycle hysteresis 0.793 / 0.701 / 0.646 at
  0.909 / 0.938 / 0.967. On this data the assumed model also fails, on precision.

**Why recall falls under the measured model.** A biased, persistent error misses the same real window in every
cycle; a fresh error eventually catches it. Precision rises for the same reason in reverse (fewer invented
windows from noise), but the bias and the lead-0 floor stay.

**Verdict (pre-registered rule, `scripts/alert_lever_verdict.py`): FAIL.** No configuration meets precision >=
0.80 and recall >= 0.85 for all three classes; recall misses in every configuration and class, including the
#718 baseline. The closest on precision (L1+L2+L3) is 0.801 / 0.838 / 0.880 at recall 0.536 / 0.446 / 0.608. The
bar was not moved, the flag stays '0', and nothing was added to GUARDED (`ALERTS_FORECAST_WINDOWS` is already there
with default '0').

## 3. Exploratory, NOT pre-registered: what a per-spot bias correction could buy

Run after the verdict, labelled exploratory, never adoptable: `--exploratory-debias` drops the measured wind bias
term (a perfect per-station, per-class bias correction: an upper bound the product does not have), sigma 1, rho_hs
0.8, same seeds.

| config | size only | offshore light | dawn clean |
|---|---|---|---|
| baseline, debiased | 0.695 / 0.849 | 0.602 / 0.723 | 0.688 / 0.883 |
| L1, debiased | 0.757 / 0.800 | 0.763 / 0.646 | 0.706 / 0.800 |
| L2, debiased | 0.731 / 0.808 | 0.654 / 0.723 | 0.700 / 0.875 |
| L3, debiased | 0.736 / 0.792 | 0.649 / 0.677 | 0.729 / 0.850 |
| L1+L2+L3, debiased | 0.792 / 0.691 | 0.854 / 0.585 | 0.760 / 0.767 |

Removing the bias gives back most of the recall (size 0.70 -> 0.85, dawn 0.74 -> 0.88) and costs precision (the
bias was also suppressing invented windows). No debiased configuration meets both halves for any class either.
The remaining error is the unbiased lead-0 floor (RMSE ~1.5 m/s at the pier), which makes a wind-conditioned
window a coin with ~20% wrong faces per hour. A bias correction is necessary for recall; it is not sufficient.

## What changed in the code (all inert by default)

| Piece | Where | Default |
|---|---|---|
| L1 peer agreement | `surf_alert_windows.peer_agrees`, `ALERTS_PEER_AGREEMENT` | '0' |
| L2 lead margins | `size_ok` / `wind_classes` / `conditions_ok` margin, `ALERTS_LEAD_MARGIN` (0-4) | 0 |
| L3 lead hysteresis | `seen_in_prior`, `decide(prior=...)`, `ALERTS_LEAD_HYSTERESIS` | '0' (the scheduler passes no prior: it would need a store of previous horizons) |
| Wind skill instrument | `scripts/wind_lead_skill.py`, `weather_pipeline/wind_lead_skill.py` (pure) | offline |
| Archived replay inputs | `scripts/alert_replay_inputs.py` | offline |
| Measured replay | `scripts/alert_window_replay.py --error-model measured` (default), `--rho-hs`, `--exploratory-debias` | offline |
| Verdict rule | `scripts/alert_lever_verdict.py` | offline |

With every lever off, `decide` is unchanged (the 103 existing alert tests pass untouched).

## Tests and gates

- +76 tests in three new guards-lane files: `test_surf_alert_windows_levers.py` (39), `test_wind_lead_skill.py`
  (32), `test_surf_alert_windows_replay_errors.py` (5).
- Mutants (`scratchpad/mut/mutate.py`, 33 single edits across the three levers, the scorer, the ISD parser, the
  grid sampler, the rotation, the correlation fits and the replay generator): 31/33 killed at first; the two
  survivors (a numpy-equivalent longitude wrap, a cross-cycle separation) each got a test; **33/33 killed**.
- Floors: `rederive_floor.py --lane guards --add 76 --add-files 3`.
- flake8 `E9,F63,F7,F82` clean; the 4 style warnings left in `alert_window_replay.py` pre-date this branch.

## Next levers (not done here)

1. **A nearer wind truth for ratings, then a per-spot bias correction.** The binding error is the lead-0
   representativeness floor (FL Atlantic light-wind flips 0.27 of hours at 12-24 h) plus a station bias; the
   exploratory rows show the bias correction restores recall but cannot fix precision alone. Both need to move the
   lead-0 error before any lead lever matters.
2. **A per-class bar or a narrower product.** Size-only windows are the closest (precision 0.72-0.80); wind-
   conditioned classes are capped by item 1. Whether to ship size-only alerts first is the owner's call, not this
   session's, and the bar was not moved.
3. Re-run on #718's NDBC + CO-OPS dir from a machine that reaches NDBC, for absolute numbers on real buoy sea state
   and real tides: `--data C:/t/flip-alertdata` (the measured model file is committed).
