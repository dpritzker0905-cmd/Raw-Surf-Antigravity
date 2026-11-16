# 2026-11-16 Long-range wind calibration (EMOS): pre-registration (session `local_0d0d332f`)

Step 4 of the long-range wind path, ordered by the director 2026-11-16 00:44Z on David's delegation (19:40 EST "lets
let the director help make the decision here"); David 21:42 EST: "Move forward on the best path toward SOTA here".
**Committed before any fit, any calibrated number, or any hindcast result.** Changes after this commit are dated
amendments below.

## What is being decided

Whether a statistically calibrated forecast of 10 m wind speed and gust at days 8-14 beats the raw ECMWF ENS member
distribution that #939 serves. A calibrated forecast is a full predictive distribution fitted to station truth.
Serving a calibrated forecast is a served-number change, so it needs this gate's PASS AND David's yes. The deliverable
here is only the gate. No served code.

## Why (the state of the art)

Raw ensembles are biased and under-dispersive near the surface. Ensemble model output statistics (EMOS) fits a
parametric predictive distribution by minimum CRPS. It is the standard calibration for wind speed:
- truncated normal for wind speed (Thorarinsdottir & Gneiting 2010);
- the gust analogues reviewed in Schulz & Lerch 2021 (cited in the senior lead's log, PR #929).
Operational multi-model blends (for example NOAA's NBM) rest on the same principle.

## Method (fixed now)

- **Forecast input:** the IFS ENS 51 members at the station (bilinear, as in `ens_wind_core`). Predictors are the member
  mean speed `m` and the member variance `s2` of speed. Gust predictors: the member median and p90 of 10fg.
- **Wind model:** speed ~ N0(mu, sigma2), normal truncated at 0. mu = a + b*m; sigma2 = c + d*s2, with c, d >= 0.
- **Gust model:** the same family on 10fg (median and spread). The window is the 6 h maximum, matched to the station's
  6 h maximum gust, as in the long-range hindcast.
- **Fit:** minimum mean CRPS (closed form for the truncated normal). One parameter set per (lead bin x network x
  region). Lead bins are 180-216, 216-264 and 264-336 h. Networks are NDBC/C-MAN and ASOS. Regions are US East+Gulf,
  US West, Hawaii and Alaska. A cell with fewer than 300 training pairs falls back to its network's pooled fit; the
  fallback is reported.
- **Training:** a rolling 45-day window ending 14 days before each forecast run, so no training observation postdates
  the forecast's issue time. The window and the lag are fixed now.

## Data (the matched record)

- **Source:** the long-range hindcast's paired rows (`rows.csv`, Sep-Oct 2026), plus a forward collection.
  - The forward collection takes the same station set (`evidence/wind-long-range-2026-11-15/`), the same truth
    (NDBC monthly / realtime snapshot, IEM ASOS), and the ENS members of every 00Z run.
  - It is collected offline in Actions, never on Render, and appended to a dated artifact.
- **Evaluation needs >= 90 test days** after the first 45-day training window. The earliest evaluation is therefore
  about 135 days after collection starts. **No calibrated number is read before then.** The hindcast rows give the
  first 45 days of training at most; they are not evaluated here.

## Gate (PASS = all; read on the test days only, day-block bootstrap with 1-day AND 5-day blocks as in amendment 4)

- G1: CRPS(EMOS) - CRPS(raw ENS as an empirical distribution) has CI upper < 0 in EVERY lead bin, pooled over
  stations.
- G2: the EMOS median speed's MAE is NOT worse than the raw member-mean speed's MAE (CI lower < 0 or contains 0) in
  every bin. Calibration must not cost the point forecast.
- G3: the windy tail. The bias on the top decile of observed speeds must shrink in magnitude vs raw (CI on
  |bias| difference upper < 0), pooled.
- G4: Hawaii is reported as its own stratum. A Hawaii bin where EMOS is significantly WORSE (CI lower > 0 on CRPS)
  blocks the Hawaii cells only (they keep raw).
- Reported, not gating: PIT histograms and coverage of the 80% central interval (target 80% +- 5), per bin and
  network; the sd ratio; FRAGILE labels per amendment 4.

## Controls (VOID if any fails)

- C1: station-shuffle, as in the hindcast's C3. EMOS scored on permuted observations must be worse (CI lower > 0).
- C2: seeded bias. Add +1 m/s to training observations only. The fitted intercept `a` must move by +1 +- 0.2 m/s in
  every cell with >= 300 pairs.
- C3: future leak. Refit with the training window ending AFTER the forecast's valid time. That leaked fit must score
  better than the clean one: if it does not, the CRPS comparison cannot detect leakage and the run is VOID.

## Not decided here

Serving: a PASS goes to the director and David with the numbers. Display: the confidence band is step 5 and uses the
raw spread until a calibrated one passes.
