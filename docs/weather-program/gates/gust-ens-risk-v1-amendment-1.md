# Amendment 1 to gust-ens-risk-v1 (director's SOTA directive and the advisor's order)
Stamp: 2026-11-23 03:38Z. Written before any score, count or verdict exists. Where this file and `gust-ens-risk-v1.md` differ, this file holds; every other rule is unchanged. Source: the director (`local_d6b521eb`) messages of 2026-11-23 to this session (advisor order, SOTA directive, the round-2 rule).

## Authorization and disclosure (what has happened before this text)
- **Download word.** David's words were relayed by the director: "Yes, run both", typed in the director session around 03:01Z
  2026-11-23, confirming "Yes, run the 62 GB gust hindcast" in the advisor session. The scope is the gate's section 10:
  public AWS ECMWF byte-range reads, reduced at once to station values, no GRIB kept, never Render or Supabase. The
  daily publisher (~6 GB a day) is NOT covered.
- **Order, as it happened.**
  - 03:10-03:12Z: the station list was frozen and the truth snapshot taken (below).
  - ~03:17Z: collection started. That is after David's 03:01Z word, but before this session had read the director's GO
    or the advisor's order (#1195 merged first).
  - The collection keeps model values only: 50 members x 450 stations, per step.
- **Looked at so far:** one run file's format (shapes; the max member value at +24 h; five HRES and five member-mean
  values at five stations), to check that the reducer works. No observation was paired with any model value. No event
  count, row count or score exists.
- **Every NDBC candidate's realtime2 file was read during the freeze**, to count hourly coverage
  (`wind_lr_obs.select_stations`). This happened before any #1199 LOCKED list existed, so those reads may include
  buoys that #1199 will lock. They are counted reads, not scored reads, and are logged here.

## A1 · Bootstrap reps
10,000 for every CI (was 2000). Seeds unchanged (20261122; null 20261123).

## A2 · ONE primary metric per cell; the rest is reported
- **Primary P1 (per threshold x lead bin):** the Brier-score difference BS(ENS) - BS(CLIM), with the reliability
  condition inside the same line.
- **P1 passes** when ALL of these hold:
  - its 95% CI upper bound is < 0 under BOTH:
    - the day-block bootstrap (1-day blocks), and
    - the station-cluster bootstrap (whole stations resampled);
  - G3 holds: REL < RES, and mean(p) / event frequency is within [0.5, 2.0].
- **Reported, never deciding:**
  - G2 (vs HRES 0/1);
  - G4 (AUC);
  - 5-day blocks (the FRAGILE label);
  - ENS_MED / ENS_P90;
  - the by-network split;
  - C5;
  - the October monthly sensitivity (A6).
- **Cell verdicts:** UNDERPOWERED / FAIL / PASS on P1. The product-scope rule (gate section 8) reads P1 only.

## A3 · n fixed in advance
- Before any score, a **count-only pass** prints per cell, from the truth coverage rule and the finiteness of the member
  values only:
  - rows, stations and days;
  - no event, no observed value, no probability.
- That table is committed as `evidence/gust-ens-risk-2026-11-23/n_table.json` before the score is run.
- The score must use exactly those rows; a different row count voids the run.
- A cell with fewer than 1,000 rows is UNDERPOWERED, in addition to the gate's event rule (>= 30 events on >= 10 days).

## A4 · Stations that may decide (round-2 rule)
- **LOCKED buoys are never read in scoring.** These are the buoys of #1199's frozen LOCKED final holdout (its list and
  SHA-256 committed at its freeze). The scorer drops them before any row is built, and logs the drop.
- **Scoring waits for #1199's frozen list.** If that list is not committed when this gate is otherwise ready to score,
  the score waits.
- **Fit-used stations never decide.** These are stations tagged `fit_used` in #1199's frozen list, or present in the
  frozen station list of an EMOS calibration (#951 wind EMOS collector; the gust EMOS session `local_33efeb42`) at
  scoring time. They are reported in a separate table and never enter P1.
- This gate fits nothing itself. CLIM is leave-one-day-out, not a fitted model.

## A5 · Frozen inputs, committed on this PR before any score
- `evidence/gust-ens-risk-2026-11-23/gust_ens_risk_stations.json`, sha256 `f6cc0720…bb636`:
  - frozen 2026-11-23 by `wind_lr_obs.select_stations` over 10-10..11-21;
  - 390 NDBC/C-MAN and 60 coastal ASOS.
- `evidence/gust-ens-risk-2026-11-23/gust_ens_risk_truth.json`:
  - the truth snapshot's own sha256 is `19cbc5064d66722e8e61abb759582d85195eb3fc828640a675ff036125a5e505`, over 768
    files (NDBC realtime2 + METAR routine/special CSVs, path-ordered);
  - taken at 03:12Z; truth_end 2026-11-23 02:42Z;
  - NDBC realtime2 reaches back to 2026-10-09 00Z (station 46026), so the 10-10 runs are covered.
- **The raw truth (401 MB of text)** is not in git. It is kept as a tarball in the director group's shared notes folder
  (`gust-ens-risk-truth-2026-11-23.tar.gz`); its sha256 is in the session log. A score re-hashes the files first, and a
  mismatch voids the run.

## A6 · October monthly stdmet (QC'd), named; a sensitivity only
- NDBC publishes 2026 monthly files as `https://www.ndbc.noaa.gov/data/stdmet/Oct/<STATION>.txt` (directory listing
  read 2026-11-23 03:35Z; e.g. `46026.txt`, `41002.txt`). November is not published yet.
- They are read at scoring time for the 390 NDBC stations (minus LOCKED), hashed, and used ONLY for a reported
  sensitivity rerun of P1 on October valid times. The primary truth stays the hashed realtime2 snapshot.

## A7 · No skill claim before the EMOS score
- The result file records the verdicts, labelled **"recorded, not a claim"**.
- No exceedance-skill claim is made, and no client or served number follows from it, until the gust EMOS score after
  the 2026-12-09 re-score and the director's word.

## A8 · Run discipline
- **Serialized:** one collection at a time, and never alongside any wave replay.
- **Egress is measured, not estimated:** the sum of the index `_length` of every member and HRES message read, plus the
  index files, from the indices of the collected runs. It is reported in the result and the log.
- The reducer is unit-tested on a tiny synthetic fixture (tests on #1202). The tests are run twice before the score.
