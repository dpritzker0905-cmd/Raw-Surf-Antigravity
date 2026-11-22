# Gate: wind-long-range-v2
Stamp: 2026-11-22 14:00Z (written BEFORE any collection, fit or score for this gate; the result file must be a later commit)
Candidate: a calibrated, climatology-shrunk grand ensemble (NOAA AIGEFS 31 + NOAA GEFS 31 + ECMWF IFS ENS 51) as the 10 m wind (and gust) source for ICON 180-336 h and EURO 240-336 h. Replaces the failed #939 idea (raw IFS ENS mean); design in `log/2026-11-22-wind-long-range-v2-design.md`.
Metric: primary = speed MAE (m/s) and the rating's own wind-factor MAE (`wq*wg`, 0-1), at marine-exposed stations, per lead bin, paired against each comparator on identical rows. Full definitions in section 4.
Pass threshold: section 6 (G1-G6, all must hold). Every CI is a 95% moving-block bootstrap interval, with the lower/upper bound rule stated per gate.
Controls: section 7 (null, shuffled pairing, shifted-lead, +1 m/s plant, direction plants). Any control that misbehaves makes the run VOID, not failed.
Decision rule: section 8. A missing or unmeasured item is never a pass.
Unmeasured items: section 9.
Served change: none from this task. Shipping needs the pass below, then a separate PR (guarded flag with kill switch, SCOREBOARD row, history filter per D-065/D-080), the director's gated merge loop (BRAIN_RULES section 24) and the owner's typed word.

## 0. Status and standing constraints
- This registration is NEW. It does not re-run, re-score, extend or amend the #939 registration (run 44376282465 FAIL, stop rule in force: no re-run, no fourth collection, no re-scoring under a changed rule). #939 is closed.
- **Blinding (condition 2 of that registration).** No per-station, per-region or per-lead number from runs 44376282465, 43952101715 or 44107750669 is read, recorded or used here, and none of their files (run files, truth snapshot, station freeze, report) is used for any FIT or TEST row of this gate. The author of this gate has read only the log's verdict line. Step 3b's TEST was NOT scored at the time of writing. All data for this gate is collected afresh from public archives.
- D-082: agency sources only (NOAA, ECMWF open data, DWD, Copernicus). No Open-Meteo anywhere in the fit, the test or the serve path. Looping or cloning frames is not an arm that can ship.
- No dispatch (collection, fit or score) without David's typed word in the session that dispatches, after the advisor's GATE line names the head of this registration.

## 1. Question
Can a calibrated multi-system ensemble, shrunk toward climatology as skill decays, beat what the tails serve today (ICON loop for 180-336 h, GFS wind for EURO 240-336 h) AND beat plain climatology where skill exists, on the quantities the surf rating uses?

## 2. Arms (all scored on the identical row set)
**Systems (inputs).** Wind 10u/10v at 6-hourly valid times; gust where the system has it.
- `IFS`: ECMWF IFS ENS, cf + 50 pf (51), 0.25 deg open data (AWS `ecmwf-forecasts`, with the GCS `ecmwf-open-data` copy under the sameness check used before). 10fg available.
- `GEFS`: NOAA GEFS 31 members, 0.25 deg (`noaa-gefs-pds`, `gefs.YYYYMMDD/HH/atmos/pgrb2sp25`, 6-hourly past 240 h as published). Gust from `GUST`.
- `AIGEFS`: NOAA AIGEFS, 31 members (`mem000`-`mem030`), 10 m UGRD/VGRD, 6-hourly, f000-f384 (bucket `noaa-nws-graphcastgfs-pds`, prefix `EAGLE_ensemble/aigefs.YYYYMMDD/HH/`). No gust field: gust = max(speed x GF, speed), GF fitted on FIT (as the GEFS and AIFS arms did before).
- Climatology `CLIM`: seasonal climatology of 10 m u, v and speed by day of year (+-15 d window) and 6-hourly UTC hour, computed from ERA5 (Copernicus C3S) over 1991-2020, bilinear at the station. Reported beside it: `CLIM_STN` (station-record climatology, 2016-2025, >= 20 records per cell, as before).

**Calibration form (the same for every calibrated arm).** For member-pooled mean vector `m` (and mean speed `s`) of the arm's systems, climatology vector `c` (and `c_s`), lead bin `b`, region `r`:
- vector: `f = c + alpha[b,r] * (m - c)`; speed: `f_s = c_s + beta[b,r] * (s - c_s) + gamma[b,r]`;
- served `(u, v)` = `f` rescaled to speed `f_s`; direction from `f`;
- gust = `max(f_s, f_s * GF[b,r])` where GF is fitted on FIT from the member median of the arm's gust (IFS, GEFS) or speed (AIGEFS);
- coefficients fitted per (bin x region) by ridge regression of station truth on the pooled arm, shrunk toward `(alpha, beta, gamma) = (1, 1, 0)`, with the ridge strength chosen by leave-block-out cross-validation INSIDE FIT only;
- `m` and `s` are plain equal-weight pools over all members of the arm's systems (system weights equal, fixed now, never fitted).
Regions r: US Pacific, US Atlantic + Gulf, Hawaii, Europe Atlantic, Mediterranean (the 3b region list). A region with too few FIT rows (rule in section 5) borrows the pooled coefficients, flagged.

**Gated arms (two, fixed now):**
- `GRAND_CAL`: IFS + GEFS + AIGEFS pooled, calibrated. PRIMARY.
- `AIGEFS_CAL`: AIGEFS alone, calibrated.

**Reported-only arms (no gate, no effect on the verdict):** `IFS_RAW` (the #939 arm, as a reference: raw mean of member speeds), `IFS_CAL`, `GEFS_CAL`, `GRAND_RAW` (uncalibrated pool), `CLIM`, `CLIM_STN`, `LAG24` (previous-cycle pooled mean at L+24).

**Comparators (served today, scored where each is served):**
- `LOOP_PROXY` for the ICON tail, leads 180-336 h: rebuilt from the ECMWF HRES run's own native whole days with the `extend_icon_wind_to_14d` rule (lead L replays lead `L mod 168`). Declared a PROXY: ICON has no public archive; its skill comes from replaying a different valid day, not from the model's identity.
- `GFS` for the EURO tail, leads 240-336 h: the GFS deterministic wind of the same run time, same valid time (the cloned tail serves exactly this field).

## 3. Windows and runs (nothing here chosen after seeing data)
- **FIT.** Inits 2025-12-17 00Z to 2026-09-30 00Z, every 4th calendar day, 00Z only (about 69 runs). Start = the day NOAA made AIGEFS operational (2025-12-17; earlier archive is the experimental EAGLE ensemble and is NOT used). End 2026-09-30 so no FIT truth reaches the 3b TEST window (valid 2026-10-16 to 11-15). Model-version changes inside FIT (IFS cycle, GEFS, AIGEFS release notes) are listed in the result and the FIT is also scored in two halves for stability.
- **TEST (the only gating window; forward).** Inits 2026-12-01 00Z to 2027-01-14 12Z, 00Z and 12Z, 90 runs. Valid times 2026-12-08 to 2027-01-28 (6-hourly, leads 180-336 h). It cannot touch the 3b TEST window (valid <= 2026-11-15) or any October window. Nothing in TEST exists at registration time.
- **No embargo or tuning on TEST.** Coefficient files for `GRAND_CAL`, `AIGEFS_CAL` and every reported arm, the ERA5 climatology, the station list and the pairing table are frozen and committed, with sha256, BEFORE the first TEST init (2026-12-01 00Z). A scorer that finds a hash mismatch refuses to run.
- **Season.** TEST covers December-January only. Winter-hemisphere regimes are tested; the summer and sea-breeze regimes are not. Stated plainly in any ship text; the live guardrail must watch through summer 2027.
- **Collection passes.** Pass 1: all TEST runs, after each run's 336 h exists. Pass 2 (ONE, pre-declared): the runs still incomplete because of source throttling (HTTP 503/429 or timeouts, logged by cause), decided on counts alone, from the second mirror for ECMWF. There is no third pass, no re-scoring, no change of rule.
- A TEST run is KEPT only if every step of IFS, GEFS, AIGEFS and the comparators exists (any missing step: the run is dropped and listed, never filled). The hindcast instrument (`backend/scripts/wind_lr_*.py`, on `dev`) is extended, not rewritten; changes to it are a build PR sent to the advisor before any dispatch.

## 4. Truth, population, metrics
- **Truth.** NDBC buoys and C-MAN (hourly WSPD/WDIR/GST; log profile to 10 m at each station's own anemometer height from NDBC metadata, z0 = 0.0002 m) and ASOS coastal stations (already 10 m, no adjustment), all licence-clean US public data. Station lists frozen from the catalogues as of 2026-11-22 by the rules of the old registration (>= 70% hourly records present over the window is checked at SCORE time and reported; no station is chosen or removed by skill). CMEMS In Situ Europe buoys are added by env-var NAME only if the credentials exist at freeze, with attribution; otherwise Europe is "insufficient". A truth snapshot (NDBC realtime2 keeps ~45 days) is taken weekly and kept as an artifact so the scorer reads what was seen.
- **Primary population: MARINE-EXPOSED stations**, by the 3b Amendment 3 rule (ETOPO 2022 15 s mask; buoy, or within 1 km of the open-ocean shoreline with the paired spot's onshore sector +-60 deg water for >= 5 km). ASOS and anything else failing the rule is a REPORTED stratum, as is Hawaii alone.
- **Station-to-spot pairing** (for `wq*wg`): catalogue spots within 25 km great-circle whose straight segment from the station does not cross land in the ETOPO mask; nearest wins, ties by lowest spot id. No manual judgement. Stations with no paired spot score speed, gust and direction only.
- **M1 speed MAE** (m/s), **M2 wind-factor MAE:** the mean absolute difference of `wq*wg` computed from forecast wind versus from station wind, using `surf_rating.wind_quality` and `surf_rating.wind_gate` and the paired spot's shore-normal, IMPORTED, not re-coded. The scorer pins the import by the `dev` commit hash recorded in the first line of the result. If step 3b's constants refactor of those anchors has merged by then, the pin is that commit; the anchors are the 3.0 / 12.0 kt values in the file.
- **Reported:** class hit rate (offshoreness >= +0.5 offshore, <= -0.5 onshore, else cross; strength bands < 3, 3-12, >= 12 kt; vetoed flag) with the offshore<->onshore confusion listed separately; speed ME; circular direction MAE (obs speed >= 3 m/s) and signed direction ME; vector RMSE; gust MAE and bias; Brier score for gust >= 15 m/s (UNDERPOWERED below 30 observed events, never blocking); CRPS of the pooled members for the raw arms; spread-skill; reliability of the +-1 SD band.
- Lead bins (left-open): B1 (180, 216], B2 (216, 264], B3 (264, 336] h, as before so the populations match the earlier work.

## 5. Statistics and floors
- Paired differences on identical (station, valid time, lead) rows.
- Moving-block bootstrap over VALID DATES: blocks of 5 days, B = 10,000, seed 20261122, 95% percentile interval. TEST valid span ~52 days gives about 10 blocks; the result states this is FRAGILE (few independent synoptic regimes at 8-14 d) and a FAIL means "not shown", not "shown no skill".
- Holm families: F-main = {M1, M2} x 3 bins x 2 gated arms. F-region = regions x {M1} inside each bin. Holm is applied inside each family.
- **Floors (VOID if not met, never failed):** >= 80 kept TEST runs, >= 45 distinct valid days, >= 9 five-day blocks, >= 10 marine-exposed stations with >= 70% hourly records in each of >= 3 regions (US Pacific, US Atlantic + Gulf, Hawaii are the expected three; a region below its minimum is "insufficient" for G6, never a verdict). More than 10% of the 90 TEST runs dropped after pass 2 also VOIDS. FIT floor: >= 60 kept FIT runs and >= 100 station-days per (bin x region) cell, else that cell borrows pooled coefficients, flagged.

## 6. Pass rules (ALL must hold for an arm to be shipped; each arm tested separately; Holm-adjusted)
- **G1 speed.** Arm minus comparator, M1: CI upper < 0 in EVERY bin, versus `LOOP_PROXY` (leads 180-336) and versus `GFS` (only rows with lead > 240 h are compared against `GFS`, so that line covers the part of B2 above 240 h and all of B3; a bin with no such rows is skipped for that comparator).
- **G2 wind factor.** The same lines for M2.
- **G3 versus climatology.** Arm minus `CLIM`, M1: CI upper < 0 in B1 AND B2. In B3 the arm must NOT be significantly worse (CI lower <= 0); B3 is labelled "low skill" if the arm does not beat `CLIM` there. (The shrinkage form tends to `CLIM` as skill decays, so this is expected to be a draw in B3, not a hidden fallback.)
- **G4 seam.** Hard hand-off, no taper (owner, 2026-11-15). At the station cells, the p95 over cell-runs of the absolute speed difference between the arm's first extension step and the native model's last native step is <= the p95 of within-native 3 h changes over the last 24 native hours of the same runs and cells (EURO: HRES at 240 h; ICON: no archive, so ICON's seam is read forward on >= 10 live ICON runs from STORED products before the ICON half ships). If G4 fails, the arm does not ship as registered; a taper is a NEW decision for the owner, not an amendment.
- **G5 replication.** The same sign and a point estimate at least half the pooled size in BOTH halves of TEST (split by init date at 2026-12-23).
- **G6 regions.** No region with sufficient data is Holm-significantly worse than the comparator on M1 in any bin (the 3b report-by-region habit: opposite signs by coast have happened before).
- **Choosing what ships.** If both gated arms pass, `GRAND_CAL` ships (it is the primary; `AIGEFS_CAL` ships only if `GRAND_CAL` fails and `AIGEFS_CAL` passes alone). Per tail: the ICON half and the EURO half are decided on their own comparator lines; either can pass alone. No arm outside the two gated ones can ship from this registration, whatever the reported-only lines show.

## 7. Controls (VOID if any misbehaves)
- **Null.** An arm identical to the comparator gives exactly zero difference with a zero-width CI.
- **Shuffled pairing.** The arm's forecast for init `t` paired with truth of the matching valid hour at init `t + k days` (k fixed at 7, within TEST): the gain over `CLIM` must disappear (95% CI of arm minus `CLIM` includes 0 or is positive) in B1 and B2. If a shuffled pairing still beats `CLIM` with an excluded-zero CI, the instrument leaks and the run is VOID. (This replaces the old "+48 h shift must lose to climatology", which a shrunk arm that sits at `CLIM` in B3 cannot satisfy by construction.)
- **Shifted valid time.** The arm scored against truth at V + 48 h must have a HIGHER M1 than the unshifted arm in B1 and B2 (point estimate). Else VOID.
- **Plant, speed.** +1 m/s added to the arm: signed-bias difference vs the unseeded arm has a CI containing +1.0 and excluding 0, in every bin. Else VOID.
- **Plants, direction.** Wind direction rotated +30 deg (1x) and +60 deg (2x) on the same random 15% of TEST rows (seed 20261122): the signed-direction ME test in the PLANT family catches the 2x plant; the 1x plant is reported. If the 2x plant is not caught, VOID.
- **Calibration-leak control.** The coefficient files' sha256 equals the committed value, and the FIT run list shares no (init date, station) with TEST. Else VOID.

## 8. Verdicts
- **PASS** (per arm, per tail): G1-G6 hold, no control misbehaved, floors met.
- **FAIL:** floors met, controls fine, any gate fails. No ship from this registration.
- **VOID:** a floor is missed, a control misbehaves, or a stop condition below fires. VOID is not failure and not a pass, and TEST data is not re-scored under another rule.
- **One scored look.** TEST is scored once, on all kept runs, after the pass-2 collection. Any change afterwards is a new registration on later data.
- **Stop rule.** No third collection pass, no re-run, no re-scoring under a changed rule, no new arm in this registration. The designated first reader is the advisor (or a reader the advisor delegates in writing in the log); if step 3b's TEST is still unscored when this gate is scored, the reader reports the verdict line only until it is. The report artifact stays unopened by everyone else until the reader has read the verdict record from the log.
- **No amendment after a result is read.** An amendment made before any result is dated, signed by who made it, and sent to the advisor before dispatch.

## 9. Unmeasured items (named now, so a gap cannot read as a pass)
- AIGEFS skill itself is not documented here; this gate is the measurement. Its releases may change in FIT or TEST (version list required in the result; a model change mid-TEST is reported and, if it falls inside TEST, VOIDS the AIGEFS-containing arms from that init forward only if it alters the system, judged by the release notes, before any score is read).
- ERA5 10 m climatology access (Copernicus CDS via `CDS_API_KEY`, by NAME) is not yet exercised; if unavailable, `CLIM` falls to the GEFSv12 reforecast (NOAA `noaa-gefs-retrospective`, `ugrd_hgt`/`vgrd_hgt` includes 10 m, listing checked 2026-11-22) and this gate is AMENDED, before any collection, to say so. Climatology is not station-fitted in either case.
- Gust in the AIGEFS arm is derived (no native field); gust results are reported, not gated.
- Hawaii/Europe/Mediterranean station sufficiency is unknown until the freeze count; below floor means "insufficient", never a pass or fail.
- The served-path cost (the reduced-field producer, bucket size, Render untouched) is measured in the build PR, not here.
- The `LOOP_PROXY` is a proxy; G1 versus it is proxy-dependent and says so.
- Not used or decided here: the member-wise rating-factor serving idea (median of `wq*wg` over members) and extended-range/week-2 products. They need their own registration.
- Whether climatology should be served, labelled, if nothing beats it in B1-B2 is an OWNER decision, not made here.
