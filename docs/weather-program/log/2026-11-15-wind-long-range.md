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
