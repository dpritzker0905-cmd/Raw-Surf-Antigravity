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

## 2026-11-16 03:00Z AMENDMENT 1 (advisor red-team of #950; before any fit)

1. **Climatology reference.** G1 compares EMOS with the raw members, which are under-dispersive, so EMOS almost
   surely wins. Added **G5**: CRPS of EMOS minus CRPS of the station's seasonal climatology as a distribution (day of
   year +-15 d, UTC hour, 2016-2025, the empirical distribution of observed speeds), reported per bin with its CI.
   Also reported per cell: the fitted slope `b`.
   **How it is read:** where `b`'s CI contains 0, or G5's CI does not exclude 0, the calibration has converged to
   climatology. Those cells are labelled "climatology-equivalent". Serving them would be climatology under a
   forecast label, so they are NOT served as a calibrated forecast: the raw ENS mean keeps serving there with its
   "estimate" label, and the fact is shown in the report and to the director.
2. **Training window on RUN dates.** For a forecast run issued at T, the training pairs come from runs issued in
   [T - 59 d, T - 14 d]. Every training verification (lead <= 336 h = 14 d) is therefore at or before T.
   (Replaces "a rolling 45-day window ending 14 days before each forecast run".)
3. **C3 is a plumbing check, not a power test.** Leak = fit on the test pairs themselves. It requires a POINT-estimate
   CRPS improvement over the clean fit (no CI). A failure means the scoring code does not see the fit; it still voids.
4. **Scope.** The truth is US stations in four regions (US East+Gulf, US West, Hawaii, Alaska). A PASS licenses those
   regions only. Over water (surf spots), the NDBC/C-MAN network's parameters apply, never the coastal-airport
   (ASOS) ones. Outside the four regions nothing calibrated is served.
5. **Forward collection** is a new scheduled job reading every 00Z run's members. It needs the owner's word for the
   schedule and runs off the Actions queue's busiest hours. Not started until David says so.


## 2026-11-16 03:17Z AMENDMENT 2: historical backfill (David 22:04 EST via the director; BEFORE any data is collected or fitted)

David, typed in the director's session at 22:04 EST: "Start it, off-peak daily, but use historical data to help us
eliminate wait time for calibrations". No backfilled data exists yet and nothing has been fitted. These changes
replace the lines they name.

1. **Period.** ECMWF IFS ENS **00Z** runs from **2025-06-01 to 2026-10-31** (518 runs) from the AWS mirror. The
   endpoints were checked at 03:20Z: 2025-06-01, 2025-09-01, 2026-01-01, 2026-03-01 and 2026-06-01 all answer.
   12Z is left out to halve the cost. Rationale: 00Z vs 12Z mainly changes the diurnal phase at a fixed lead.
2. **Leads (cost).** Six leads, two per bin: **192 and 210 h** (B1), **228 and 252 h** (B2), **288 and 324 h** (B3).
   Fields: 10u, 10v, 10fg for the 51 members, by byte range. That is about 1.3 GB per run, read in monthly slices
   over several dispatches. Only the station values are kept (51 x stations x leads), never a field.
3. **Truth.**
   - NDBC: the 2025 annual stdmet files; the 2026 monthly files for Jan-Aug (published; checked for 41009); the
     realtime2 snapshot from 2026-10-02.
   - September 2026 NDBC is unpublished, so those rows lack NDBC truth (ASOS only). That is reported, not filled.
   - ASOS: IEM, the whole period.
   - Climatology for G5: 2016-2024 only, so no year overlaps the evaluated period.
4. **Windows (unchanged definition, made explicit).** Every evaluated run T is fitted on runs issued in
   [T - 59 d, T - 14 d] (amendment 1, issue dates). That is a rolling-origin, out-of-sample forecast by
   construction. **The evaluated (TEST) runs are those issued 2026-01-01 .. 2026-10-31** (304 days, >= 90). Runs from
   2025-06-01 to 2025-12-31 only train. Earlier test runs train only on earlier runs; no test observation reaches a
   fit.
5. **Held-out robustness line (reported, not gating).** One FIXED fit on all runs issued 2025-06-01 .. 2025-12-17,
   scored on the same 2026 TEST runs. Reported beside the rolling result. If it disagrees in sign with the rolling
   one in any bin, that bin is labelled UNSTABLE.
6. **Stations.** The same rules as the hindcast (NDBC/C-MAN within 50 km of GFS land with anemometer height known;
   ASOS within 10 km of GFS sea, at most 60). Coverage >= 70% hourly over 2026-01-01..2026-08-31 for NDBC and over the
   whole TEST period for ASOS. Frozen once, before any fit, and kept with the collection.
7. **Daily collection.** One job a day at **09:17 UTC** reads the newest complete 00Z run at the same six leads. 00Z
   ENS completes about 07:40 UTC. 09:17 avoids :00/:30 and the forecast-ingest, precompute and pilots cron minutes.
   Storage: the weather bucket under `calibration/emos/` (namespaced; no manifest or product writes). Actions only.
8. **The first read.** It reports coverage only (runs x stations x leads, missing runs, missing truth) to the director.
   The fit and the test verdict follow, once, as one dated read.

**03:18Z correction to amendment 2 item 7:** the daily job runs at **10:07 UTC**, not 09:17. A job already runs at 09:20 (cron `20 3,9,15,21`). Nothing else is scheduled between 08:15 and 12:15 except :20 and :40 minutes; 00Z ENS is complete by about 07:40 UTC.

## 2026-11-16 03:48Z AMENDMENT 3: limits stated before any data (advisor review of #950 at 66d520bfe)

(a) **IFS cycle changes.** ECMWF may change the IFS cycle inside 2025-06..2026-10, which shifts ensemble bias and
    spread. The rolling window adapts within about 45 days; the fixed-split line does not. An UNSTABLE label may
    therefore be a cycle change, not a method failure. The report lists every IFS cycle implementation date in the
    period beside the fixed-split line, read from ECMWF's published change log.
(b) **September 2026 has no NDBC truth** (monthly file unpublished), so the water network is missing for one test
    month. The report counts the NDBC cells (bin x region) whose training window fell under the 300-pair floor because
    of it, and the TEST rows lost.
(c) **Cost and throttling.** The backfill reads about 670 GB by byte range from the public mirror. It runs in monthly
    slices, 4 shards at most per slice, off-peak, with the backoff and per-shard retry counts learned in the
    long-range hindcast (S3 503 SlowDown).
(d) The collector and fitter run with NO credential. The bucket is touched only by a standard-library storage step
    (`emos_bucket_io.py`, `python3 -I -S`), create-only (advisor condition on #951).


## 2026-11-16 18:17Z AMENDMENT 4 (EMOS): the ENS control member left the open-data `ef` files on 2026-05-13 (BEFORE any result)

**What happened.** Hindcast run 43920372184 dropped every run. The fetcher required 51 members (`cf` + 50 `pf`), and
the 2026 `ef` files carry only the 50 perturbed members. The run was cancelled; no report was opened, and the score had
no rows. This is an instrument bug, not a data gap: my smoke test had used a 2025 file, which still carried the control.
**Nothing from that run is read into #939** (director 2026-11-16).

**Measured** on the AWS mirror, `-300h-enfo-ef.index`, 00Z runs, by bisection:
- the control is present (`10u` type `cf` x 1, `pf` 1..50) through **2026-05-12 00Z** (8007-8211 records per file);
- it is absent (`pf` 1..50 only, 8500 records per file) from **2026-05-13 00Z** on;
- also checked: 2025-06-01, 2025-10-15, 2026-01-15, 2026-03-31 and 2026-05-08 have the control; 2026-05-14, 05-17,
  05-27, 06-15, 08-01 and 09-01 do not;
- the 2026-05-12 12Z run was not probed; it is treated by what its own index says.
No `-enfo-cf` file exists beside the `ef` file after the switch (2026-09-13 +180 h: 404).

**Rules (both the hindcast and the EMOS backfill):**
1. **Member set = whatever the run's own index carries:** `pf` 1..50 are REQUIRED (any missing -> the run is dropped,
   never filled); `cf` is included when present. Before 2026-05-13 that is 51 members, from 2026-05-13 on 50. The count
   is recorded per run.
2. **The scored arm is the mean over the run's members** (51 or 50). The hindcast window (runs 2026-09-01..10-31) is
   entirely 50-member, so its primary arm, `ens_mean_raw`, is the 50-perturbed-member mean. A mean over 50 vs 51
   exchangeable members differs by sampling only: the control is unperturbed, not a better member.
3. **`ens_cf` (control only) is UNAVAILABLE after 2026-05-13.** In the hindcast it is reported as unavailable (no rows)
   and drops out of every comparison. It was never a PASS line.
4. **EMOS:** the predictors (member mean, member variance of speed, member gust quantiles) are computed over the run's
   members (51 before the switch, 50 after). The training windows straddle the switch for TEST runs from 2026-05-13 to
   about 2026-07-11. The fitted variance term absorbs the small change in sampling variance. The report adds one line
   per bin: CRPS(EMOS) - CRPS(raw), for TEST runs before vs after 2026-05-13 (reported, not gating).
5. The served extension (#939) uses the same rule (`pf` 1..50 required, `cf` if present). The label stays "ECMWF
   ensemble mean (estimate)"; `members` in the basis carries 50 or 51.

## 2026-11-17 15:29Z How a skipped EMOS day is noticed (advisor read of #1002)

- The daily job (#1002, merged e51622b96) exits cleanly with "no run today" when neither data.ecmwf.int nor the AWS
  mirror answers. That day is not lost: re-dispatching `wind-emos-collect.yml` backfill over a date range collects only
  the runs not already stored (it skips stored runs), so a range re-dispatch fills the gaps.
- Gaps are visible: `wind_emos_fit.py coverage` lists `runs_missing` (every expected 00Z run in 2025-06-01..2026-10-31
  absent from `calibration/emos/runs/`). I run that coverage read after each backfill month and weekly once the
  backfill is complete, and report any gap of more than 2 consecutive days to the director.
- So a run of throttled mornings cannot quietly thin the calibration set.
