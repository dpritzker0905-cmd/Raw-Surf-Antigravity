# 2026-11-15 - M1 tide: FES2022b (PyFES, offline) + EOT20 + NOAA CO-OPS; no Open-Meteo. Session tide-overlay-cf8266

Director, 2026-11-15 21:23 EST, under the owner's rules ("nothing depending on open-meteo", 20:14 EST; "move forward
on the best path toward state of the art", 21:09 EST): HOLD #926 and #931 (both serve Open-Meteo sea level; commented
on both PRs) and build M1 from the research lead's plan (PR #929 log, "01:52Z FES2022 confirmed usable").

## Design
- **Offline only (GPL):** PyFES (GPL) runs ONLY in a GitHub Actions job (`backend/scripts/tide_fes/`). The served
  backend never imports it (a guard test asserts no `pyfes` import under `services/` or `routes/`); it serves PyFES's
  OUTPUT (precomputed per-spot hourly tide and high/low events in the weather-products bucket).
- **FES2022b, extrapolated, ocean tide (not load):** what a tide gauge sees. Constituents: M2 S2 N2 K2 K1 O1 P1 Q1 2N2
  M4 MS4 MN4 Mf Mm Sa Ssa (16 of 34; Sa/Ssa because NOAA's predictions carry the seasonal cycle). Downloaded over
  AVISO's authenticated SFTP/FTPS with the `AVISO_USERNAME` / `AVISO_PASSWORD` Actions secrets (never echoed), cached
  compressed between runs. PyFES loads only a small bbox around each prediction point (a global 1/30 deg atlas of 16
  constituents does not fit a runner's memory).
- **EOT20 (DGFI-TUM, CC BY 4.0):** the gate arm and the fallback where FES has no value.
- **NOAA CO-OPS harmonic predictions** near US stations (PR #931's door: 10 km, shape guard, staleness) on top.
- **Order at serve time:** CO-OPS station -> FES2022b -> EOT20 -> unavailable. No model sea level anywhere.
- **Datums:** the prediction is zero-mean about MSL by construction; MLLW / LAT computed offline from the constituents
  (US display MLLW, elsewhere LAT; labelled). eta for the breaking cap stays relative to MSL.
- **Credits** (LayerDataCredit + /point-tide): DGFI-TUM EOT20 (CC BY 4.0); "The FES2022 Tide product was funded by
  CNES, produced by LEGOS, NOVELTIS and CLS and made freely available by AVISO", DOI 10.24400/527896/A01-2024.004;
  NOAA CO-OPS.
- **Later (M1b):** a non-tidal residual (Copernicus sea level or CO-OPS observations).

## PRE-REGISTERED gate (written before any FES run)
Job `.github/workflows/tide-fes-gate.yml` -> `backend/scripts/tide_fes/fes_gate.py`. The same 25 CO-OPS stations as
the #926 checks (the IDS of `tide_datum_vs_coops.py`; Boston/Galveston reported if they fail to load). Each arm is
evaluated at the station's own coordinate, hourly, over the 14 UTC days before the run day.
- **G-M1a parity:** RMSE of FES2022b (tide + long-period, m) vs CO-OPS harmonic PREDICTIONS (MSL). PASS when the median
  over stations is **below 0.117 m** (#926's best figure against the same truth) - and reported beside it the median
  for EOT20 once that arm runs.
- **G-M1b timing:** FES High/Low times vs CO-OPS hilo: median absolute error <= 20 min; reported per station.
- **G-M1c observed water (informative, defined now):** RMSE vs CO-OPS OBSERVED water (MSL, on the hour) for FES and
  for CO-OPS's own predictions; FES within 0.05 m of CO-OPS predictions at the median. Both are astronomical, so both
  miss surge; this checks that FES adds no error of its own beyond NOAA's.
- **Shadow then cutover:** served beside today's values (a shadow field) first; cutover behind a kill switch with a
  SCOREBOARD row. No served number moves in the gate PR.

## 21:39 EST (`date`) - the gate job, written (not yet run)
- `backend/scripts/tide_fes/fes_gate.py` + `.github/workflows/tide-fes-gate.yml` (runs on push to `claude/tide-m1`
  and on dispatch). PyFES pinned `2026.5.2` (the newest release with a cp312 manylinux wheel; 2026.10.0 is sdist-only).
  AVISO over SFTP (paramiko, port 2221) with the secrets read from the environment; the PUBLIC host key fingerprint
  is logged on the first run so a later run can pin it (first run does not verify it: recorded gap).
- Memory: each global grid is decompressed one at a time, a 0.5 deg box around each station is cut out, the global
  file deleted; PyFES then loads only the boxes.
- **Note on the baseline:** #926's 0.117 m is the model DE-MEANED over the served 72 h window. FES is gated on its RAW
  RMSE (no de-mean) against the same truth, the stricter reading; the de-meaned figure is reported beside it.
- Guard: `tests/test_tide_fes_offline_guard.py` - no `pyfes` / `tide_fes` import under `server.py`, `services/`,
  `routes/`, and no pyfes in `requirements.txt`.
- Not yet: EOT20 arm, the per-spot precompute + bucket write, the serving reader, MLLW/LAT. Those follow the gate.

## 21:52 EST (`date`) - security review: credentials only to a pinned host
- The automated commit review flagged the first version (MEDIUM): it authenticated before checking the SSH host key.
  Valid. The push-triggered run 43793891985 was cancelled while still queued (no step ran, so no credential was sent).
- Fixed: AVISO's two PUBLIC host keys (ed25519, ecdsa-nistp256; `ssh-keyscan -p 2221` at 21:48 EST from this machine,
  off the runner network) are pinned in `fes_gate.py`; the job compares the presented key BEFORE `auth_password` and
  stops otherwise. Remote file names must fully match `[a-z0-9]+_fes2022.nc.xz` (no path parts, no trailing newline;
  `re.match` with `$` would have let `"...xz\n"` through - the test caught it). Guard tests: 3 passed locally.

## 22:25 EST (`date`) - RECONCILED pre-registration (supersedes the gate above; written before any result exists)
Director 22:22 EST: David at 22:01 EST, "We can use open-meteo for testing against our system, but our system must put
out NOAA, EURO, ICON from free grib and cmem etc"; #926/#931 stay held. The research lead pre-registered M1 in the
shared notes (`research-lead-briefs-2026-11-16.md` section 1); reconcile with mine, the stricter rule wins.
No gate run has produced a number: run 43793891985 was cancelled while queued, and run 43795079865 (93262a190) was
cancelled while queued at 22:24 EST. Nothing was read.

Taken item by item (S = stricter, adopted):
- **Window:** the lead's FROZEN, already-observed window 2026-10-15 00Z .. 2026-10-28 23Z, hourly (S: fixed before any
  arm is computed, and it holds a full spring-neap cycle). My rolling "14 days before the run" is dropped.
- **Stations:** the same 26 CO-OPS IDs. Strata reported: Hawaii, Pacific, Atlantic, Gulf, Alaska/PR.
- **Arms:** A FES2022b (PyFES, offline). B EOT20 (pyTMD, offline). C Open-Meteo `sea_level_height_msl` de-meaned over
  its 72 h window. D Open-Meteo minus its own 365-day mean. C and D are TEST-ONLY references (owner 22:01 EST) and are
  never served.
- **Truth:** T1 CO-OPS harmonic predictions (MSL) gates. T2 CO-OPS observed water (MSL) is reported for M1b only.
- **PASS for the chosen arm (A or B), all four:**
  1. median RMSE vs T1 <= **0.08 m** AND below arm C's median, computed in the SAME run on the SAME window. A and B
     are scored raw, with no de-mean. (S: the lead's 0.08 is stricter than my 0.117.)
  2. no station worse than arm C by more than 0.05 m (lead's; new).
  3. median |High/Low time error| <= 20 min, extrema matched within +/-3 h (same in both).
  4. median |MSL-to-MLLW offset error| <= 0.05 m against the CO-OPS datum sheet. The arm's MLLW comes from its own
     19-year synthesis over the 1983-2001 NTDE: the mean of each tidal day's lower low (lead's; new).
- **Choice:** if both A and B pass, the lower median RMSE wins; within 0.01 m, A wins.
- **Controls (the result is VOID, not PASS, if any control misbehaves):**
  - Positive: our CO-OPS-constituent synthesis vs CO-OPS predictions, RMSE <= 0.01 m.
  - Negative 1: station-label swap over >= 200 derangements; the median RMSE must be > 0.3 m.
  - Negative 2: the chosen arm shifted +6 h must FAIL item 3.
- **Reported, not gating:** range ratio, de-meaned RMSE, T2 RMSE for each arm and for CO-OPS predictions.
- **Served change:** none in the gate PR. After PASS the change ships ON (D-065) with a kill switch and a SCOREBOARD row.

## 22:41 EST (`date`) - how the reconciled rules are computed (written before any run; ties go to the stricter reading)
Code: `backend/scripts/tide_fes/{metrics,sources,arms,fes_gate}.py`. The rules are pure functions in `metrics.py`, pinned
by `tests/test_tide_fes_offline_guard.py` (written during the 22:00-00:30 quiet window: NOT run locally yet).
- **Medians are across stations:** item 1 is the median of the per-station RMSEs; item 3 is the median of the
  per-station medians of |time error|; item 4 is the median of per-station |MLLW error|.
- **Unmatched extremum:** a CO-OPS High/Low with no same-type extremum of the arm within +/-3 h counts as +infinity
  (not dropped).
- **Item 2:** a station that arm C scores but the arm cannot (undefined or failed) counts as "worse than C".
- **Arm C:** each hour minus the mean of the 72 h window from 00Z of its day (as `tide_datum_vs_coops.py` did), at
  the served 0.1 deg cell. **Arm D:** minus the mean over 2025-10-15 .. 2026-10-14, only with >= 330 days of hours.
- **MLLW:** the arm synthesised every 10 min over 1983-01-01 .. 2001-12-31. MSL is the series mean; MLLW is the mean
  of the minimum of each full 24.8412 h tidal day. Compared with the CO-OPS datum sheet's MSL - MLLW.
- **Positive control:** CO-OPS's published constants (`harcon.json`) synthesised by pyTMD with the GOT nodal
  corrections and no inferred minors (pyTMD's Compare-NOAA-Tides recipe). PASS needs median RMSE <= 0.01 m.
- **Negative 1:** the chosen arm at station i scored against the truth of station perm(i), 200 deterministic
  derangements (seed 20261015). The median over derangements of the median over stations must exceed 0.3 m.
- **Negative 2:** the chosen arm's extrema shifted +6 h, scored by item 3's rule, must give a median > 20 min.
- **Chosen arm:** of the arms that pass, the lower median RMSE, with A winning within 0.01 m. If none passes, the
  same rule runs over all scored arms, for the controls and the report only.
- **Arm B (EOT20):** pyTMD 3.1.0 database model "EOT20", extrapolation cutoff 10 km. The archive is SEANOE
  doi:10.17882/79489; only `*_ocean_eot20.nc` members are taken, by plain file name.
- **Push timing:** the commit waits for the end of the quiet window (00:30 EST), since a push to this branch starts
  the gate job.

## 00:32 EST 2026-11-16 (`date`) - tests run after the quiet window; push
- First local run of the 6 tests: 5 passed, 1 failed. The failing check was `eot20_member_ok("/abs/...")`: on Windows,
  `Path("/abs/x")` is not absolute, so the check let it through. It was not exploitable, since extraction writes by
  bare file name only. Fixed with `PurePosixPath` (zip names are POSIX on every OS) and a backslash refusal. Now 6
  passed; flake8 clean. Pushed; the gate job runs on the push.
