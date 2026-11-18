# 2026-11-15 wind long-range lane (session `local_0d0d332f`, branch `claude/wind-long-range-fb64f9`)

Task from the director (`local_d6b521eb`): replace the looped ICON wind past its native horizon, and the EURO wind
GFS clones past 240 h, with real science. Owner words: "Looping is unacceptable. We need real science." (15:19 EST);
plan approved 16:14 EST: "Yes to all, hard hand-off". Source plan: senior research lead, PR #929,
`log/2026-11-15-senior-research-lead-sota-plan.md` §21:01Z, §21:17Z and the 21:33Z CORRECTION.

## 21:45Z PRE-REGISTERED GATE (committed before any code; changes after this commit are dated amendments below)

### What is being decided

Which wind source serves ICON 180->336 h and EURO 240->336 h, and whether it ships. The marine ICON/EURO extension
blends are LOCKED (BRAIN_RULES "14-Day Forecast Horizon") and are not touched. The scrubber is never capped.

### Adopted correction (21:33Z, measured by the senior lead)

The open-data `em` (ensemble-mean) stream has NO 10 m wind past 240 h. The "ENS mean" arm is therefore the mean we
compute from the 51 member fields (`cf` + 50 `pf`, stream `enfo`, type `ef` files, 0.25 deg):
- vector `(u_bar, v_bar)` = member mean of `(10u, 10v)`; direction from it;
- speed = mean of member speeds (no vector-mean shrinkage); served `(u, v)` = `(u_bar, v_bar)` rescaled to that speed;
- gust = per-cell member median of `10fg` (max in the 6 h ending at the step);
- spread = member standard deviation of speed (recorded; not served by this gate).
Steps past 144 h are 6-hourly. 3-hourly served steps are linear in `(u, v)` and speed between the SAME run's two
neighbouring steps (cross-hour, same model; never cross-model).

### Hindcast sample (offline; never the live box, never Render)

- Runs: ECMWF 00Z and 12Z, run dates 2025-09-15 .. 2025-11-14 inclusive (61 days, 122 runs), from the public AWS
  mirror `ecmwf-forecasts` (archive depth reported by the senior lead 21:33Z; confirmed by listing before the run;
  any missing run is listed, never filled).
- Split: runs on ODD day-of-month = FIT half (de-bias fitting only); EVEN day-of-month = TEST half. Every PASS line
  below is scored on the TEST half only (about 60 runs over about 30 days; if the test half has < 60 runs or < 30
  days after missing runs are dropped, the gate is VOID, not failed).
- Verification valid times: every 6 h (00/06/12/18Z). Leads 186..336 h by 6 h.
- Lead bins: B1 = 180-216 h, B2 = 216-264 h, B3 = 264-336 h (bin by lead, left-open: (180,216], (216,264], (264,336]).
- Stations (truth):
  - >= 30 coastal NDBC/C-MAN stations with WSPD and GST, >= 70% of hourly records present in the window,
    anemometer height known from NDBC metadata; adjusted to 10 m by the neutral log law with z0 = 2e-4 m.
  - >= 30 coastal ASOS stations (Iowa Environmental Mesonet archive; within 10 km of the coast; `sknt`, `gust`,
    `drct`), >= 70% hourly present. Treated as 10 m.
  - Hawaii stations are reported as their own stratum as well as pooled.
  - The station list is frozen in `wind_lr_stations.json` before any arm is scored; stations are chosen by these
    rules only, never by skill.
- Truth matching: wind = the station's 10-min/hourly mean nearest the valid time (within 30 min); gust = the max
  station GST/gust in (V-6 h, V], matching the 6 h window of ENS `10fg`.
- Model value at a station: bilinear from the 0.25 deg (GEFS 0.5 deg) grid; a station whose four cells are not all
  sea (for NDBC) is moved to the nearest all-sea cell and flagged.

### Arms (all scored on the identical station/valid-time/lead set)

1. **loop**: today's served method. ICON has no public archive, so the loop is rebuilt from the ECMWF HRES (`oper`)
   run's own native whole days with `extend_icon_wind_to_14d`'s rule (lead L > 180 h replays lead
   `L mod (whole-day native length)`). Declared a PROXY: the loop's skill comes from replaying a different valid
   day, not from the model's identity.
2. **gfs_standin**: GFS 0.25 deg deterministic (`noaa-gfs-bdp-pds`), same run time, same valid time. GFS gust = `GUST`.
3. **ens_mean_raw**: as above, from the 51 members.
4. **ens_mean_debias**: arm 3 with one multiplicative speed factor per lead bin `k_b = sum(obs*f)/sum(f*f)` fitted on
   the FIT half (wind stations pooled), applied to `(u, v)` (direction unchanged).
5. **ens_cf**: the control member only.
6. **gefs_mean**: GEFS `geavg` 0.5 deg 10 m U/V (`noaa-gefs-pds`). No gust record (helper ASK 3b), so gust =
   max(wind x GF, wind) with GF fitted on the FIT half.
7. **climatology**: per station, per calendar month and hour of day, mean speed and mean vector over 2016-2024 from
   the same station archive.
8. **persist180**: the HRES run's own 180 h field held constant for every lead > 180 h.

### Chosen arm (fixed now)

Primary = `ens_mean_raw`. It is replaced by `ens_mean_debias` only if, on the TEST half, debias minus raw pooled speed
MAE has a day-block CI upper < 0. If the ENS members cannot be ingested operationally, the fallback is `gefs_mean`,
and that arm must pass the same lines.

### Metrics (per arm, per bin, pooled and per stratum: NDBC, ASOS, Hawaii)

Speed MAE; speed signed bias (forecast minus obs); vector RMSE; direction MAE where obs speed >= 3 m/s (circular
difference); gust MAE and signed bias. n and station count printed beside every number.

### Statistics

Paired differences on the same (station, valid time, lead). Day-block bootstrap: blocks = valid-time UTC dates,
2000 resamples, seed 20261115, 95% percentile interval.

### PASS (all must hold for a ship)

P1. Chosen arm minus `loop` speed MAE: CI upper < 0 in EVERY bin.
P2. Chosen arm minus `gfs_standin` speed MAE: CI upper < 0 in EVERY bin.
P3. Chosen arm gust MAE minus `loop` gust MAE: CI upper < 0, pooled over bins.
P4. Seam (hard hand-off, no taper, no offset; owner 16:14 EST): at the station cells, the p95 over cell-runs of
    `|speed(chosen arm, first extension step) - speed(native, last native step)|` is <= the p95 of within-native
    3 h changes `|speed(L) - speed(L-3)|` over the last 24 native hours of the same runs and cells. EURO: native =
    HRES 240 h, arm at 243 h (interpolated within the ENS run). ICON: no archive, so P4-ICON is read forward on the
    first >= 10 live ICON runs from STORED products (bucket read, not the API), and the ship of the ICON half waits
    for it; P4-EURO is read in the hindcast.

### Reported, never hidden

- R1. Any bin where the chosen arm does not beat `climatology` (CI upper < 0) is labelled "low skill" in the log, the
  SCOREBOARD row and the PR body. It does not block (the owner chose real model wind over a climatology relaxation).
- R2. Every arm's numbers, including the ones that win.

### Controls

- C1 negative: the chosen arm with its valid time shifted +48 h (the forecast for V scored against obs at V+48 h)
  must have a HIGHER speed MAE than `climatology` in every bin (point estimate). If not, the instrument is VOID.
- C2 positive: the chosen arm with +1 m/s added to speed must show a signed-bias difference vs the unseeded arm whose
  CI contains +1.0 and excludes 0, in every bin. If not, VOID.

### Interim (item 6) under this gate

The GFS stand-in replaces the ICON loop now (owner yes 16:14 EST), ON with kill switch `ICON_WIND_GFS_STANDIN=0`,
label `gfs_wind_standin`. The hindcast's arm 1 vs arm 2 rows are its measured check; if `gfs_standin` is
significantly WORSE than `loop` on speed MAE in any bin (CI lower > 0), the interim is reported to the director and
the owner before it stays on.

### Independent scoring

The verifier (`local_ec32a6a8`) re-scores the result from the saved paired rows. Rows are saved per arm as CSV in the
Actions artifact (no secrets; public station data and public model data only).

## 22:40Z Interim built (item 6): ICON's wind loop replaced by a labelled GFS stand-in

- `euro_wind_extension.clone_gfs_wind_tail` is now shared: EURO keeps `gfs_wind_fallback` (labels unchanged, test
  pins them); ICON gets `extend_icon_wind_from_gfs`, basis `gfs_wind_standin`, native horizon from the run (~180 h).
- Ingest (`wind_ingestion.ingest_icon_wind_global_impl`, DWD-direct path): the tail is the GFS clone; the loop runs
  only when the kill switch is '0'. `scheduler/forecast.py` now runs GFS wind before ICON wind, so ICON clones THIS
  cycle's GFS (before, ICON ran first and would have cloned the previous cycle's).
- Dynamic path: `viewport_service` no longer loops ICON wind; past ICON's native times it raises
  `ICON_BEYOND_NATIVE`, and `grid_resolver` serves GFS relabelled ICON with basis `gfs_wind_standin` (the same
  fallback block EURO wind already used). Inside native, nothing changes.
- Kill switch `ICON_WIND_GFS_STANDIN` (GUARDED, code default '1', registered in `_RATING_FLAGS`).
- Client words: `drawnFrameReadout` reads `gfs_wind_standin` as "GFS stand-in beyond ICON's native range" and
  `gfs_wind_fallback` as "GFS stand-in beyond EURO's range" (EURO's had no words of its own before).
- Not changed: ICON PRESSURE still loops (`pressure_ingestion.py`, `icon_loop_extrapolation`); out of this brief,
  listed as a follow-up. Gusts past the horizon: the gusts lane owns them (interface proposed to `local_7f199b18`).
- Tests: `test_icon_wind_gfs_standin.py` (4) + the loop test pinned to the kill path; 69 passed locally in the
  wind/ingest/flag-parity files. Local Jest cannot collect from a `.claude` worktree path, so the frontend suites are
  read on hosted CI.

## 23:30Z AMENDMENT to the pre-registration (before any station is frozen or any arm scored)

Implementation details the 21:45Z text left open, fixed now; none is chosen by skill:
1. **NDBC "coastal"** = within 50 km of a GFS 0.25 deg LAND cell (f000 of 2025-10-15 00Z). ASOS within 10 km of a
   GFS sea cell. **ASOS cap**: if more than 60 qualify, keep 60 nearest the sea (ties by id), to bound the IEM
   archive load. NDBC has no cap.
2. **NDBC gust** is adjusted to 10 m by the same log-law factor as the wind.
3. **ASOS gust window**: a METAR carries a gust group only while gusting, so a record without one counts its
   sustained speed in the 6 h maximum. A window needs >= 1 record per 2 h.
4. **Within-native 3 h changes for P4-EURO**: open-data HRES is 6-hourly past 144 h, and the served 3-hourly EURO
   frame between two 6-hourly ones is their linear mean (`native_time_interpolation`), so a served within-native
   3 h change = |speed(L) - speed(L-6)| / 2 for L in 222..240. The seam = |ENS arm at 243 h (interpolated 240..246
   within the ENS run, de-bias factor of B2 when the chosen arm is de-biased) - HRES 240 h|.
5. **Loop arm** at lead L uses HRES lead L mod 168 (`extend_icon_wind_to_14d` keeps 168 whole hours of a ~180 h
   native). At L = 336 that is step 0, which has no 10fg: the loop gust is missing there (the row drops from gust
   lines only), never filled.
6. **Climatology**: NDBC 2016-2024 annual files; ASOS one IEM request per station for 2016-01-01..2024-12-31;
   a (month, hour) cell needs >= 20 records.
7. **Shards**: the 122 runs are collected in 24 Actions shards; a missing run (no 336 h index) is listed in a
   `.missing.json`, never filled.
8. Instrument: `backend/scripts/wind_lr_hindcast.py` (+ `wind_lr_obs.py`, `wind_lr_score.py`), workflow
   `.github/workflows/wind-lr-hindcast.yml`. Scorer unit tests include both controls on synthetic rows.

## 23:55Z Main (item 1) built: the ENS member-mean hand-off; hindcast running

- **Hindcast** (instrument committed after the 23:30Z amendment): Actions run 43773419409 on
  `claude/wind-ens-extension` (stations freeze -> 24 collect shards over the 122 runs -> score). Smoke-read
  locally before the push: one ENS step (51 members x 10u/10v/10fg, 2025-10-15 00Z +300 h, eccodes 2.50, template
  5.42; Waimea 8.3 m/s mean of member speeds, gust 12.9, spread 2.1), and one step each of HRES oper, GFS 0.25,
  GEFS geavg 0.5, NDBC 46026 2025 (100% hourly in the window, anemometer 4.1 m). Archive: AWS mirror answers for
  2025-09-15 and 2025-11-14 (the window's ends).
- **Operational producer** `scripts/ens_wind_extension_ci.py` in its OWN workflow `wind-ens-extension.yml`
  (08:30 and 20:30 UTC, after 00Z/12Z ENS completes; not the pilots job): newest complete run from data.ecmwf.int,
  steps 144..360, member mean on a 1-degree subsample, one file pair `ens_wind/latest.npz` + `.json` in the bucket
  (~8 GB of byte ranges read per run on the runner; nothing on Render; no manifest or product writes).
- **Ingest** `ens_wind_extension.extend_wind_tail`: ICON past its native max and EURO past 240 h read that file,
  sample the coarse points, interpolate 6 h -> 3 h inside the ENS run, clip gust >= wind, and save with basis
  `ens_mean_extension` (label "Days 8-14: ECMWF ensemble mean (estimate)", `ens_run`, 51 members). A stale ENS run
  (> 36 h older than the deterministic run) or one that does not cover the WHOLE tail is not served at all: the GFS
  stand-in serves instead. Hard hand-off, no taper, no offset.
- **De-bias**: applied only if the gate chooses `ens_mean_debias`; its k per bin then goes into
  `SPEED_FACTOR_BY_BIN` in the PR that records the result. Empty now (raw member mean, the pre-registered primary).
- **Kill switches**: `ENS_WIND_EXTENSION=0` (GUARDED; the producer writes nothing and ingest uses the GFS stand-in),
  then `ICON_WIND_GFS_STANDIN=0` (ICON back to the loop). ENS ships ON in code, and **the PR must not merge before
  the gate PASSES** (a served-number flip needs the met gate as well as the owner's word).
- **Gusts lane** (`local_7f199b18`): the interface was proposed at 21:50Z by message; the reduced file carries
  `gust` (member median of 10fg, 6 h window max) and `spread` per step, and the saved points carry
  `wind_gusts_10m` (clipped >= wind) and `ens_speed_spread`. No reply yet at writing.
- Tests: `test_ens_wind_extension.py` (7: label, lattice, within-run interpolation, gust clip, stale/short never
  partial, de-bias by bin, fallback order ENS -> GFS -> loop). 45 passed locally in the wind/ingest/flag files.

## 2026-11-16 00:45Z Reviews, two scorer fixes, and the first hindcast run lost to S3 throttling

**Scorer fixes (found reading the code before the LongCat review; both made the scorer disagree with the 21:45Z
pre-registration, neither changes a PASS line):**
1. P4-EURO always multiplied the ENS speed at 243 h by the B2 de-bias factor, even when the raw mean is the chosen
   arm. Now the seam is the CHOSEN arm's.
2. C1 always scored the raw mean. Now it scores the chosen arm.
Plus `tests/test_wind_lr_score_e2e.py`: `main_score` end to end on a synthetic cache (8 arms, report + rows).

**LongCat** (LongCat-2.5, scorer test loop + bootstrap + builder excerpt, payload sha256 4ac85ded...): 5 findings,
checked against the full code: (1) C1 reads raw for the de-biased arm: VOID, `_arm_fields` already scales it;
(2) C2 missing: VOID, it lives in `verdict`, outside the excerpt; (3) NaN pools in the seam p95: handled by
`nanpercentile`, and the two pools are different quantities by design; (4) ratio estimator in the day-block
bootstrap: the standard pooled-mean cluster bootstrap, kept; (5) builder partial-tail guard off by one: VOID, step
360 is archived. It found no fit/test leakage and a consistent direction convention. No code change from it.

**SubQ** (snap-1.1): HRES-rebuilt loop is a fair proxy 0.98; C2 informative 0.95; **C1 sound 0.12**.
**Reflection** (Beam, medium): label the loop arm an HRES PROXY and treat its margin as proxy-dependent; C2 passes by
construction, add a noisy seeded control as a reported-only diagnostic. Done: `D_C2_noisy_<bin>` (+1 m/s plus
N(0, 2) per row) is reported, not a PASS line. **Risk recorded before any result:** at 8-14 days the ENS mean sits
near climatology, so C1 (+48 h shift must lose to climatology in every bin) may fail and VOID the run. The
pre-registered rule is not changed; if it voids, that is the result.

**Run 43773419409**: stations froze (354 NDBC/C-MAN, 60 ASOS; committed under `evidence/`), then 4 of 24 collect
shards died on one S3 `503` each (`ecmwf-forecasts`, 20250919 00Z +180 h, 24 shards in parallel). Fix: backoff with
jitter up to ~6 min per request, a failing run is recorded and retried once at the end (never filled), max 12
shards in parallel, shard artifacts uploaded even on failure, and the stations job reuses the committed frozen
list. Pushed; the push supersedes the run (same concurrency group).

## 2026-11-16 00:10Z AMENDMENT 2 (director + senior lead, 23:59-00:01Z; BEFORE any result was read)

No hindcast result exists: run 43773419409 was force-cancelled after S3 503s, and run 43776801544 was cancelled at
collection (no run file was scored). These changes come from the director's correction and the senior lead's
00:01Z message. Each replaces the line it names.

1. **Window**: ECMWF runs **2026-09-01 00Z .. 2026-10-31 12Z** (61 days, 122 runs), on the current model cycle and
   station set. The last run's 336 h lead verifies on 2026-11-14, which has been observed. (Replaces 2025-09-15..11-14.)
2. **Fit/test split**: contiguous blocks, not odd/even days. Adjacent days are correlated, so odd/even leaks test
   errors into the fit. **FIT = runs started in September; TEST = runs started in October** (62 runs over 31 days,
   meeting the >= 60 runs / >= 30 days floor).
3. **Missing steps**: a run with ANY missing step is dropped and logged, never filled. **VOID if more than 10% of the
   122 runs are dropped.**
4. **Climatology**: seasonal by day of year: the station's records within +-15 days of the valid day of year, same
   UTC hour, over 2016-2025. A cell needs >= 20 records. (Replaces the flat calendar-month mean.)
5. **New arm `aifs_ens_mean`**: ECMWF AIFS-ENS (`aifs-ens`, enfo `cf` + `pf`, 51 members, 10u/10v), reduced the
   same way as the IFS ENS arm. It has NO 10fg in open data (index read 2026-11-16 00:05Z), so its gust is
   max(speed x GF, speed), with GF fitted on the FIT half (as for the GEFS mean). Reported; it is not the chosen arm.
6. **Gust p90**: every ENS reduction also yields the member p90 of 10fg (the risk cue). The gust label is "max gust
   in the 6 h to this time".
7. **New PASS line P5, gust peak**: event = observed gust >= 15 m/s in the 6 h window. Brier score of the chosen
   arm, probability = fraction of IFS members with 10fg >= 15. The deterministic arms (`loop`, `gfs_standin`) score
   0/1. **P5 PASSES if the Brier difference vs `loop` AND vs `gfs_standin` has a day-block CI upper < 0**, pooled
   over bins. CSI is reported for every arm (event forecast = served gust >= 15). **If the TEST half has fewer than
   30 observed events, P5 is reported UNDERPOWERED and does not block.**
8. **Truth, NDBC**: NDBC has not yet published September 2026 monthly files (August exists; September's directory
   is empty), and `realtime2` keeps 45 days (2026-10-02 onward at writing). NDBC truth = the September 2026 monthly
   file if it exists, else nothing, plus a `realtime2` snapshot taken by the stations job and kept as its artifact.
   The TEST half (valid 10-08..11-14) is fully covered. The FIT half has ASOS truth throughout but NDBC only from
   10-02. **Station coverage (>= 70% hourly) is measured over 2026-10-02..11-14.** The 2025-window station list is
   kept as `wind_lr_stations-2025-window-superseded.json`; the stations job freezes a new list by the same rules.
9. **De-bias arm**: remains an extra, non-primary arm (the senior lead's correction): the member-mean speed does
   not shrink. The chosen-arm rule stays as registered (de-bias only if its TEST CI vs raw is < 0). Its k is fitted
   on the September block.
Unchanged: lead bins, the 8 original arms, P1-P4, R1, C1, C2, day-block bootstrap, the hard seam. The C1 risk noted
at 00:45Z stands.

## 2026-11-16 00:40Z Amendment 2 implemented; hindcast relaunched on the 2026 window

- `wind_lr_hindcast.py`: window 2026-09-01..10-31; the AIFS-ENS arm is collected from `aifs-ens` `cf` + `pf`
  (10u/10v, 51 members; a missing AIFS step is logged and the run kept, because AIFS is a reported arm). A run with
  ANY missing IFS ENS step is dropped.
- `wind_lr_obs.py`: `ndbc_window` = the September 2026 monthly file if published, plus a `realtime2` snapshot. The
  stations job keeps both as artifact `wind-lr-truth-snapshot` (90 days), so the score reads the records seen at
  freeze time. Seasonal climatology `SeasonalClim` (day of year +-15 d, UTC hour, 2016-2025, >= 20 records).
  Coverage is measured over 10-02..11-14.
- `wind_lr_score.py`: September FIT / October TEST; VOID if > 10% of the 122 runs are dropped; P5 = Brier for gust
  >= 15 m/s vs `loop` and `gfs_standin` (UNDERPOWERED under 30 events, not blocking); CSI per arm; the AIFS gust
  factor is fitted on September.
- Served side: the reduced file and the saved points carry `gust_p90` (`wind_gusts_p90_10m`), and the basis carries
  `gust_label` "max gust in the 6 h to this time".
- Tests: 26 instrument tests (P5 pass, fail and underpowered; CSI counts; seasonal climatology; end to end on the 2026
  layout with AIFS) + 15 served-side tests, all passing locally.

## 2026-11-16 01:00Z Two reported-only additions (senior lead), before any result; hindcast relaunched again

- **De-bias per network**: the September FIT has no NDBC truth (realtime2 starts 10-02, outside the fit window), so
  the non-primary de-bias factor is fitted on ASOS (land and coastal airports) and tested on ASOS + NDBC (water). A
  land-fitted factor can look worse on water for a reason unrelated to the method. The report now carries
  `debias_by_network` (de-biased minus raw speed MAE, ASOS-only and NDBC-only, per bin). The primary member mean
  needs no fit and is unaffected. Gate unchanged.
- **Throttling trace**: every HTTP retry is counted by cause (503 / 429 / exception) and written per shard
  (`shard_<i>_of_24.retries.json`, in the shard artifact), and the report carries `retries_by_shard`. A VOID from
  dropped runs can then be traced to throttling, not to missing data.
- Served side: `ens_wind_extension.sample_step` is the vectorised one-step sampler that the gusts lane's raster
  frames use (the same bilinear, de-bias factor and gust clip as `build_points`, plus a `clipped` mask). A test pins
  it equal to `build_points` at an archived step and checks the longitude wrap.
- Run 43779656382 had not started collection (stations job queued); it is cancelled and superseded by this push.

## 2026-11-16 00:35Z OWNER DECISION: the ICON GFS stand-in is withdrawn

David 19:27 EST (relayed by the director): "I dont want icon wind past 7.5 days switched to gfs, we need a scientific
estimation." This supersedes item 6 (interim) of the 16:14 plan.
- #935 is a DRAFT titled WITHDRAWN, with a comment quoting the decision. Never merged; nothing served.
- #939 no longer carries the stand-in:
  - the files are back to dev: `euro_wind_extension.py`, the dynamic path (`viewport_service.py`,
    `grid_resolver.py`) and `scheduler/forecast.py`;
  - the `ICON_WIND_GFS_STANDIN` flag is gone (GUARDED, `_RATING_FLAGS`, guardrail coverage) and so is its test file.
- ICON past ~180 h = the ENS member mean when a fresh reduced field covers the whole tail. With NO such field, today's
  legacy tail serves unchanged, so production is unchanged until #939 passes its gate. ICON NEVER falls to GFS. EURO
  past 240 h without ENS keeps today's GFS clones (also unchanged).
- Client: `drawnFrameReadout` gains `ens_mean_extension` -> "Days 8-14: ECMWF ensemble mean (estimate)".
- **Open for the director:** when the ENS field is missing or stale (> 36 h), ICON's tail falls to the legacy loop,
  which the owner called unacceptable. The alternatives are to serve no ICON tail at all, or to serve an older ENS run
  with a stale-run label. Neither is chosen here; today's behaviour is kept until the director or the owner rules.
- The interim's 22:40Z SCOREBOARD row is superseded by the withdrawal row below it (append-only).
- The hindcast is unaffected: its arms still include `gfs_standin` as a COMPARATOR. P2 (beat the GFS stand-in) stands
  as pre-registered.


## 2026-11-16 00:50Z AMENDMENT 3 (director's ruling; David 19:40 EST "lets let the director help make the decision here"; BEFORE any result)

Director 00:44Z: (a) lagged ensemble for ICON; (b) the grand ensemble as a reported-only arm; (c) order after #939:
uncertainty display, then EMOS calibration, then serving the grand ensemble (only on a win and David's yes).
Run 43780240793 was cancelled before collecting anything (its stations job was still queued); no result exists.

**Hindcast, new REPORTED-ONLY arms** (no PASS line, no effect on the chosen arm):
1. `grand_ifs_gefs`: speed = the mean of the two systems' speeds (IFS member-mean speed, GEFS |mean vector|).
   Direction from the mean of their two mean vectors. Gust = the IFS member median (GEFS has none).
2. `grand_ifs_gefs_aifs`: the same over three systems (AIFS member-mean speed added; gust still from IFS).
3. `ens_lag24` / `ens_lag48`: the IFS member mean of the run 24 h / 48 h EARLIER, at lead L+24 / L+48 (only where
   that is <= 360 h). These score the lagged fallback (a). IFS ENS steps are now collected to 360 h (were 336).
The weights are equal and fixed now; none is fitted on any data. Each arm is reported against `loop`,
`gfs_standin`, `ens_mean_raw` and `climatology` per bin, with the same day-block CI.

**Served (#939), the lagged fallback (a):**
- The ENS tail uses the newest reduced run if it is <= 48 h older than the deterministic run.
- A run more than 24 h older carries `older_run: true` and the label "Days 8-14: ECMWF ensemble mean (estimate,
  older run, N h)".
- An older run covers valid times only up to its own +360 h. Hours past that get NO ICON tail, never filled.
- With no usable run, no new ICON tail is written. The last ENS generation keeps serving until its hours pass,
  because estimates are superseded only by a newer estimated generation. After that there is no ICON tail.
- **Never the loop, never GFS.** The loop runs only under the kill switch `ENS_WIND_EXTENSION=0`, which restores
  today's behaviour. While the flag is on, the on-demand dynamic path no longer loops ICON wind.
- EURO without ENS keeps today's GFS clones (unchanged).

**EMOS record (c-4):** the hindcast's `rows.csv` (paired forecast/observation rows per arm) starts the matched-data
record. Its own gate will be pre-registered before any fit.

## 2026-11-16 01:20Z Amendment 3 implemented; hindcast relaunched

- Hindcast: IFS ENS steps collected to 360 h; reported arms `grand_ifs_gefs`, `grand_ifs_gefs_aifs`, `ens_lag24`,
  `ens_lag48` (equal weights, nothing fitted); `reported_arms` in the report carries each vs loop / GFS stand-in /
  member mean / climatology per bin. End-to-end test covers all four.
- Served (#939): ENS runs up to 48 h old serve (label "older run, N h" past 24 h, basis `older_run`, `ens_run_age_h`),
  truncated at the run's own +360 h. With ENS on and no usable run, ICON writes NO tail and the dynamic path no longer
  loops; the loop survives only under `ENS_WIND_EXTENSION=0`. Tests pin the lagged truncation, the label, the
  over-48 h refusal and "no loop when ENS is on but absent". 86 passed locally.


## 2026-11-16 02:15Z AMENDMENT 4 (advisor red-team of #946, `redteam-946-wind-long-range-instrument-2026-11-16.md`; BEFORE any result)

No hindcast result exists. Runs 43773419409, 43776801544, 43779656382, 43780240793 and 43783764841 were all
cancelled before scoring; the last never left the queue. No report was opened. These changes come from the advisor's
verdict (PASS WITH LIMITS, one open condition: this amendment).

**Why changing a VOID rule is legitimate now:** no result has been read. A void rule changed AFTER a result is seen
would be a forking path. Changed before, it is a design correction, and it is recorded here with its reason.

1. **Fit block shortened.** September runs verify up to mid-October, October runs from 9 October, so the two halves
   share observations. The de-bias k and the GEFS/AIFS gust factors are now fitted on runs started **2026-09-01 ..
   09-24** only. This touches non-primary arms only; the chosen primary (raw member mean) has no fit. The TEST block
   stays October.
2. **C1 demoted to REPORTED.** "+48 h shifted must lose to climatology" tests whether a near-climatological field
   loses to climatology. At these leads that turns on station bias, not on the instrument. It can void a sound run or
   pass a broken one (SubQ 0.12 sound; the advisor agrees). **New VOID controls:**
   - **C3, stations shuffled:** within each (run, lead) the observations are permuted across stations (seeded). The
     chosen arm's speed MAE against the shuffled observations minus against the true ones must have a day-block
     CI **lower bound > 0 in every bin**. Otherwise VOID: the instrument cannot tell a station's own wind from
     another's.
   - **C4, time shift:** the chosen arm scored against observations at V+48 h minus the same arm scored at V, on
     the rows where both exist, must **NOT** have a CI upper bound < 0 in any bin. Otherwise VOID: a forecast that
     verifies better two days late signals a time-alignment bug.
   - C2 (seeded +1 m/s) stays a VOID control; the noisy C2 stays reported.
3. **Wider intervals reported.** Day-8-14 errors persist for days, and the TEST half has about 37 valid days.
   Every PASS line is ALSO computed with **5-day blocks** (blocks of consecutive valid dates). The verdict uses the
   pre-registered 1-day blocks. Any line that passes at 1-day blocks and fails at 5-day blocks is labelled
   **FRAGILE** in the report, the SCOREBOARD row and the PR. A FRAGILE pass is still a pass, and it is said so.
4. **One row set for P1 and P2.** Both lines are computed on the rows where the chosen arm, `loop` AND
   `gfs_standin` all have a speed. n is printed on every line, and the scorer asserts that P1 and P2 share it.
   (The 21:45Z text promised "the identical set"; `paired()` had dropped rows per comparison.)
5. **What the PASS lines do not show.** P1/P2 are easy for any smooth field: a member mean beats one deterministic
   run and a replayed wrong day on MAE almost by construction. **R1 (vs climatology) is the skill line**, and it is
   reported first. Also reported per arm and bin: the ratio of the forecast speed's sd to the observed speed's sd,
   and the signed bias on the TOP THIRD of observed speeds. A mean reads light on windy days, which is what a surf
   rating cares about.
6. **Truth caveat:** NDBC `realtime2` is not quality-controlled (the published monthly files are). The TEST half's
   NDBC truth is realtime2 throughout; ASOS (IEM) is the archived METAR record.
7. **Housekeeping:** the scorer header said odd/even (fixed). `wind-lr-hindcast.yml` becomes **dispatch-only** once
   #946 merges, because each push queued up to 24 shards and the Actions queue was backed up. The hindcast is
   dispatched once from `dev` after the merge.
8. The loop rebuilt from HRES stays a declared proxy (advisor: fine).

## 2026-11-16 02:40Z Amendment 4 implemented (on #946)

- `wind_lr_score.py`: fit block 09-01..09-24; R1 reported first; P1/P2 on ONE row set (asserted, n on every line);
  every PASS line with 1-day (deciding) and 5-day blocks, `fragile` flag and `verdict_label` "PASS (FRAGILE: ...)";
  C1 -> `R_C1_*` reported; VOID controls C2, C3 (stations permuted within each (run, lead), seed 20261118, CI lower
  > 0) and C4 (+48 h shifted minus unshifted, per row, must not have CI upper < 0); `sd_ratio` and
  `bias_top_third_obs` per arm and bin. Header fixed (it said odd/even).
- `wind-lr-hindcast.yml`: dispatch-only. The hindcast is dispatched once from dev after #946 merges.
- Tests: 31 instrument tests (C3 pass/void, C4 pass/void, C1 reported, shared P1/P2 rows, FRAGILE under
  persistent errors, sd ratio and top-third bias on a smoothed field).

## 2026-11-16 02:55Z Amendment 4, director addendum (BEFORE any result)

Director 21:22 EST asks for the top DECILE of observed wind as well. Added: `bias_top_decile_obs` (forecast minus
observed speed on rows whose observed speed is in the top 10%, per arm and bin), reported beside the top-third
bias and the sd ratio. Labelled in the report as how light each arm reads on windy days. Reported only; no PASS line.
Items (1) and (2) of the same message were already in amendment 4 (C1 replaced by C3/C4; 5-day blocks + FRAGILE).

## 2026-11-16 09:37Z Merge authority for #946, #951 and #950 (director request)

All three were merged by this lane on David's words typed in THIS session (`local_0d0d332f`) at 2026-11-15 20:32 EST:
"push and merge what logically can be". Each was merged under the standing rules the director relayed at 20:33 EST:
own PR, non-draft, every check green, the advisor passed, not held, `--squash --match-head-commit`.
- #946: squash 2db995629.
- #951: squash e28cec79a.
- #950: squash ae4fe47e1.
Their pr_merge lines: #946 and #951 in `ledger.d/claude--wind-emos-prereg.jsonl` (landed with #950); #950 in
`ledger.d/claude--wind-merge-ledger.jsonl` (this docs-only PR). #939 (served) stays HELD on its hindcast gate.


## 2026-11-16 18:17Z AMENDMENT 5: the ENS control member left the open-data `ef` files on 2026-05-13 (BEFORE any result)

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

## 2026-11-16 18:28Z CORRECTION to amendment 5 (advisor read of #982)

1. **Corrected:** amendment 5 said of run 43920372184: "The run was cancelled; no report was opened, and the score had
   no rows." That is wrong. Its score job (133492806819) ran to completion, 17:49-18:24Z, and printed the
   registered verdict in its public log:
   `{"verdict": "VOID", "chosen": "ens_mean_raw", "void_reasons": ["test half 0 runs over 0 days", "122 of 122 runs dropped (> 10%)"]}`.
   A `wind-lr-report` artifact (3.4 KB) exists. My cancel landed after that. The true record: the instrument returned
   VOID by its own rule, as designed, with zero scored rows, so nothing about any arm's skill was in it. The
   dropped-run VOID rule worked. I have not downloaded the artifact.
2. **Dispatch authority for 43920372184:** David, 2026-11-15 23:04 EST, typed in the director's session and relayed
   verbatim: "Yes", to running the back-test once the Actions queue was quiet. Ledger:
   `ledger.d/claude--wind-merge-ledger-2.jsonl:1` (PR #979).
3. **Rule 2's reason, restated (advisor):** the control is NOT exchangeable with a perturbed member. It starts from the
   unperturbed analysis and is usually a little more skilful than any single perturbed member. What makes 50 vs 51
   immaterial is arithmetic: the control's weight in the mean is 1/51, so dropping it moves the mean by about 2% of
   the control's distance from the mean. And the hindcast window is 50-member throughout, which is exactly what
   #939 would serve today, so the tested population matches the product.
4. Amending the member rule is still "before any result" in the sense that matters: a VOID with zero rows says
   nothing about any arm. The docs commit (8ff2cdfc5, 18:18Z) precedes the code (29c1f2282, 18:22Z).
5. The rerun is a NEW dispatch and needs the owner's word, in the session that dispatches it, for one run.

## 2026-11-16 19:58Z Two records (director)

- The exact words authorizing run 43920372184, typed by David in the director's session at 2026-11-15 23:04 EST: "Yes on
  first bullet" (the first bullet was the ~700 GB long-range wind hindcast). They replace the shortened "Yes" in §18:28Z item 2.
- The rerun's authority, typed by David in THIS session (`local_0d0d332f`) at 2026-11-16 13:30 EST, answering "Rerun the
  long-range wind hindcast for #939, once, from dev, after the 50/51-member fix (#982) merges and the Actions queue is
  quiet?": "Yes, rerun once".

## 2026-11-17 09:57Z Hindcast rerun 43952101715: VOID by its own size rules (advisor read first); the fill plan, recorded before any dispatch

**Outcome (the advisor read the score job's log; neither the advisor nor I opened the report artifact or the run
page's summary table):** VOID, not a result. Nothing goes into #939. The verdict record: chosen `ens_mean_debias`;
400 NDBC and 60 ASOS stations; 48 test runs. Void reasons, both size rules registered before any run:
1. "test half 48 runs over 29 days" (needs >= 60 runs and >= 30 days);
2. "24 of 122 runs dropped (> 10%)".
**Cause:** the public ECMWF open-data bucket throttled the fetch. Every shard logged hundreds of HTTP 503 answers
(27-465 each, about 8,400 in all), and 11 shards gave up on 24 runs after retries. The data exists; the fetch lost it.
Twenty-four concurrent shards on one public bucket is what got throttled.
**The per-line numbers in that run's report and summary table were computed on the 98 surviving runs. They are void,
and they stay unread.**

**Designed counts, from the design alone (no data):** a complete collection gives TEST = runs issued in October 2026
= 62 runs over 31 days, against the rule (>= 60 runs and >= 30 days). That is a THIN margin:
- losing 3 test runs voids it;
- losing both runs of any 2 days voids it;
- the dropped-run rule allows at most 12 of 122.
**The thresholds are not moved.**

**The fill (the next run, only on David's word typed in this session):**
- Collect ONLY the 24 missing runs. Reuse the cached run files, the frozen station list and the truth snapshot of run
  43952101715 (its artifacts are kept until 2027-02-14).
- 6 shards, at most 3 at a time (was 24, 12 at a time). Fetch retries raised from 8 to 12, with the back-off cap raised
  from 60 s to 180 s.
- Then score ONCE on the complete set. Split, arms and thresholds are unchanged.
- A run still missing after the fill stays dropped and is never filled. If the sizes are then still short, the gate is
  VOID again and is reported as such.

## 2026-11-17 17:51 -0500 L1 instrument written OFFLINE for the advisor's read (no fetch, no score)

The fill run 44107750669 finished (conclusion: success). Its verdict has NOT been opened here: the advisor reads it
first. Meanwhile, the L1 registration (senior-research-lead log, FIXED 2026-11-17 00:33) said "the code goes to the
advisor before any fetch". Branch `claude/l1-wave-emos`:

- `backend/scripts/wave_emos_core.py`: log-normal laws with closed-form CRPS in METRES (Baran & Lerch 2015). E2 is
  NGR on log Hs; R2 is EMOS on log R1 (with the "proxy, ICON absent" label). The rolling fit uses 90 days, refits
  weekly, takes only rows published and valid before the refit, starts 2025-10-01, and restarts at an upgrade date.
  The frozen fit and climatology arm C are also here.
- `backend/scripts/wave_l1_score.py`: gate lines G1-G4 on 10-day valid-date blocks (3-day blocks for FRAGILE). It has
  the cell-exclusion VOID, plus the null, derangement and halved-spread VOID controls. Reported: E1, R1, C, per-buoy
  CRPSS, the per-model arms, the shuffled spread, the spread term, the shipped form, and the week-2 Brier score.
- `backend/tests/test_wave_l1.py`, 8 tests. On synthetic data, an informative ensemble passes and an uninformative
  one does not.

**Three points for the advisor before any fetch:**
1. **Derangement reference.** The instrument scores deranged E2 against arm C at the true buoy, and requires
   CRPSS < 0. The draft's line "the CRPS skill must collapse below 0" does not name a reference.
2. **Shipped-form rule.** The two spread reports can disagree. On synthetic data the spread term was real
   (CRPSS +0.021, CI [0.017, 0.024]), yet the shuffled-spread E2 kept 83% of the gain over R2, because the gain was
   mostly a mean correction. The code ships constant spread if EITHER report says so, and labels a PASS
   "mean correction only". "Survives the shuffle" is read as keeping at least half the gain (the draft's
   negative-control wording).
3. **E2 spread law.** It is read literally: "the SD is linear in the pooled ensemble SD" gives
   sigma = |c| + |d| * SD(pooled log members). The wind EMOS uses a variance-linear law instead.

Still owed before any fetch:
- the collector (GEFS-Wave and `waef` byte-range reads, the nearest wet cell, the R1 proxy);
- the measured publication delays;
- the version list for GEFS-Wave and IFS/wave in 2025-10..2026-06.

## 2026-11-17 18:16 -0500 Fill run 44107750669: VOID (second row); missing runs are throttling, not absence

**Verdict record** (the advisor read the score job's public log at 22:18Z; nobody here has opened the report):
- VOID, `test half 53 runs over 31 days`. The rule needs >= 60 runs AND >= 30 days.
- This is the SECOND VOID row; the first was 48 runs over 29 days. No threshold moves.
- This session has NOT opened the report artifact or the run-page summary. Only the collect jobs' public logs were
  read, for the run lists below.

**Which runs are missing, from the collect logs:**
- The test half is October 00Z/12Z: 62 scheduled runs.
- 48 came from the reused run and 5 were collected by this fill, giving 53.
- The 9 still missing:
  - 10-01 00Z;
  - 10-11 12Z;
  - 10-13 00Z;
  - 10-14 12Z;
  - 10-17 12Z;
  - 10-19 00Z;
  - 10-23 12Z;
  - 10-25 00Z;
  - 10-31 00Z.
- Each failed both attempts with HTTP 503 from the `ecmwf-forecasts` S3 mirror (SlowDown throttling), mostly on the
  336 h `.index`.
- None is absent at the source (S3 returns 403/404 for a missing key, not 503), and none was outside the fill's list.
- This fill tried 14 test-half runs and recovered 5. The fit half still lacks 09-03, 09-15 and 09-21, all 503s.

**What the registration allows:** the 09:57Z fill plan says a run still missing after the fill "stays dropped and is
never filled". A third collection of these 9 runs is therefore not a completion under the current registration. It
would need a registered amendment made WITHOUT any result read, and David's word to dispatch.

**The honest options, for the advisor:**
1. **A new month** (e.g. November 2026, once it has its 14-day truth), under the same registration.
2. **A transport amendment** before any read: ECMWF open data is also mirrored outside AWS. Fetch only the 9 named runs
   from a second mirror, serially, at off-peak hours.
   - Cost: about 9 runs x ~20 min ≈ 3 h collect plus ~1.5 h score.
   - Expected recovery: most of the 9, if the second mirror does not throttle. 7 are needed.
   - At this fill's 5-of-14 rate on the same mirror, a repeat would recover about 3 and stay VOID.
3. **A split amendment** before any read: the 12 already-collected runs of 09-25..09-30 sit between the fit half (day
   <= 24) and October.
   - Moving them into the test half gives 65 runs.
   - But it shortens the fit/test separation that the gap may exist to keep. The advisor's call.

## 2026-11-18 02:27 -0500 AMENDMENT (no result read): a one-time second-mirror collection of 12 named runs (option b)

This section replaces an earlier nine-run draft (19:07 EST) that existed only on this unmerged branch. The draft
collected the nine test-half runs and left the three fit-half runs dropped. It was changed at the advisor's condition 2,
before any result was read. A 20:51 addendum on the same branch is folded in here.

Owner, 18:31 EST, verbatim: "Go with option b, fetch the 9 from the second mirror". After being told the revised cost
(12 runs, about 5.5 h), the owner wrote: "Yes, dispatch then". Advisor conditions, 2026-11-18 00:00Z; this text was
approved with two edits at 01:30Z.

**Why the "never filled" rule changes, and why that is a real amendment.** The 09:57Z rule "a run still missing after
the fill stays dropped and is never filled" was a stop against open-ended retries. It is lifted ONCE, for one reason
only. The missing set was decided by S3 SlowDown throttling (HTTP 503 on every one), which does not depend on what the
forecasts said. Recovering those runs cannot favour an answer, and the decision to continue is taken knowing only a
count (53 test runs), never a per-line number.

**Precondition (1):** written confirmation from the director that no session has opened the report artifact of
43952101715 or 44107750669, or seen the scored numbers in any form. This session has not. If anyone has, this
amendment is void and the route is (a), November.

**Runs (2):** exactly these twelve, no others, one attempt series:
- test half (9): 2026-10-01 00Z, 10-11 12Z, 10-13 00Z, 10-14 12Z, 10-17 12Z, 10-19 00Z, 10-23 12Z, 10-25 00Z, 10-31 00Z;
- fit half (3): 2026-09-03 00Z, 09-15 00Z, 09-21 00Z.

**Mirror listing (3)** (HEAD requests only, no data read, 18:35 and 19:22 EST):
- ECMWF's Google Cloud copy (storage.googleapis.com/ecmwf-open-data) holds all twelve runs. Checked: ens `ef` at
  180, 336 and 360 h, HRES `oper` at 240 h, and AIFS-ENS `pf` at 336 h.
- The Azure copy refuses access (409). data.ecmwf.int no longer keeps these months.

**Sameness control (4):**
- Measured at 20:10 EST: the 336 h `ef` `.index` of 2026-10-02 00Z (held from S3, not one of the twelve) is
  byte-identical on both mirrors. Both copies are 2,012,998 bytes, with sha256
  `42b52eaf9a58d3e4c66432b07faddd85f913a58624da984913a7fc399d90d34`.
- Before any collection, the workflow's `mirror_check` job (`wind_lr_mirror_check.py`) repeats and widens this. It
  compares sha256 of:
  - the `ef` indexes at 180 and 336 h;
  - the HRES and AIFS-ENS indexes;
  - the GRIB bytes of the first 10u message at 336 h.
- Any difference stops the dispatch: no collection, no score.
- A failed or throttled fetch from either mirror is NOT a pass: the job stops and is retried later. The collection
  never starts without a completed comparison. In the code, any exception, non-200 or short read exits non-zero.

**Final stop (5):** after this collection, the gate is scored ONCE on whatever exists.
- At least 60 test runs (and at least 30 days): the verdict stands as scored.
- Under 60: October is VOID for good, and the route is (a), November under this registration, once its 14-day truth
  exists.
- There is no fourth collection.

**Scoring (6):** recomputed from the full set of run files (43952101715 + 44107750669 + this run), not patched onto
an earlier scoring. The report stays unopened until the advisor has read the verdict record from the log.

**Unchanged:** the split (fit runs are September day <= 24, test runs are October; the 09-25..09-30 embargo stays),
the arms, the thresholds and the VOID rules.

**Cost:** about 12 runs x ~20 min serially, so about 4 h collect plus about 1.5 h score: about 5.5 h.

**Dispatch** (from dev, after the GATE line and the merge):
- `reuse_run_id=43952101715`
- `reuse_run_id_2=44107750669`
- `ens_mirror=gcs`
- `runs=2026090300,2026091500,2026092100,2026100100,2026101112,2026101300,2026101412,2026101712,2026101900,2026102312,2026102500,2026103100`
