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

## 04:07 EST 2026-11-16 (`date`) - run 43810952503: timed out downloading, no gate number
- The pinned host key matched and AVISO accepted the credentials. The SFTP download ran ~160 KB/s on one connection
  (17-18 min per ~160 MB constituent). 8 of 16 files (M2 S2 N2 K2 K1 O1 P1 Q1) had arrived when the 150-min job limit
  cancelled the run. `actions/cache` saves only at a normal job end, so nothing carried over. **No gate number was
  computed or read.**
- Changes:
  - 4 parallel SFTP connections, each checking the pinned key before auth, with a 128 MB SSH window.
  - Files land as `.part` and are renamed only when complete.
  - The download runs as its own step (`--download-only`, 280 min).
  - The caches are restored from the newest run and saved `if: always()` under a per-run key, so progress survives
    a timeout. Superseded keys are pruned (`actions: write`) to protect the shared 10 GB cache limit.
  - The gate step runs only after a complete download.
- Tests: 6 passed; flake8 clean.

## 06:22 EST 2026-11-16 (`date`) - run 43836918731: verdict **VOID** (positive control failed)
Run 43836918731 at bd8aa9a55: all 16 FES2022b files downloaded (parallel SFTP), and the gate ran on the frozen window
2026-10-15 00Z .. 10-28 23Z. Artifact `tide-fes-gate`, JSON `fes_gate.json`.
- **Verdict VOID.** The positive control failed: our synthesis of NOAA's own constants vs NOAA's predictions had a
  median RMSE of **0.083 m** (rule <= 0.01). Negative 1 behaved (label swap 0.489 m > 0.3). Negative 2 behaved (+6 h
  shift: no extremum matched).
- **Arm B (EOT20) did not run, a harness bug.** The SEANOE archive nests `ocean_tides.zip`/`load_tides.zip`; the
  extractor looked for top-level `.nc` files and found none. Fixed in the next commit (pinned by a test). B has no number.
- **Arm A numbers (INFORMATIVE ONLY - a VOID run passes nothing):**
  - Median RMSE 0.0831 m vs arm C 0.1478 (item 1 fails narrowly: <= 0.08).
  - No station worse than C (item 2 holds).
  - High/Low 8.5 min (item 3 holds).
  - |MLLW err| 0.0135 m (item 4 holds).
  - Arm D median 0.2218 m.
  - Strata, A / C: Hawaii 0.046 / 0.073; Pacific 0.054 / 0.131; Atlantic 0.135 / 0.202; Gulf 0.138 / 0.162;
    PR 0.071 / 0.081.
  - Observed water (T2): A 0.29, C 0.37, D 0.18.
- **Diagnosis - a datum offset, not a shape error.** The positive control's de-meaned median is **0.0089 m** (max
  0.020) and its range ratio is 0.976..1.004, so the synthesis shape is right. Its raw error is a constant per-station
  offset of 0.02..0.15 m, largest on the Atlantic and Gulf. NOAA's MSL-datum predictions carry a mean-level constant
  that a zero-mean synthesis of the published constants lacks (plausibly sea-level change since the 1983-2001 datum
  epoch). Arm A carries the same offset: its de-meaned median is 0.026 m.
- This is what the positive control exists to catch, so VOID stands. The rules are NOT changed after seeing numbers,
  and this window is now SEEN: any re-run needs a new pre-registration on an unseen window. That proposal is for the
  director / research lead; nothing proposed here is adopted yet.

## 06:26 EST 2026-11-16 (`date`) - G2 PRE-REGISTRATION (written before any G2 code or number)
Director 06:25 EST: "yes to G2 as proposed", under David's overnight authorization and the earlier FES approval.
**M1 is recorded as VOID** (the positive control failed: 0.083 m against a rule of <= 0.01). Its numbers are above,
and the SEEN window 2026-10-15 .. 10-28 gets no tuning.

G2 differs from the reconciled M1 rules (22:25 EST and 22:41 EST) in EXACTLY two things:
1. **Window:** a new frozen, already-observed window, **2026-10-29 00Z .. 2026-11-11 23Z**, hourly. No arm has been
   computed on it.
2. **Per-station mean-level offset:** for each station, OFFSET = the mean of CO-OPS hourly predictions (MSL datum)
   over the 365 days before the window, **2025-10-29 00Z .. 2026-10-28 23Z**. It is ADDED to every value of arms A
   (FES2022b), B (EOT20) and P (positive control) before any metric. Truth (T1, T2) is unchanged. Arms C and D are
   unchanged, since they carry their own de-means.
   - It does not touch item 3 (timing) or item 4 (MSL - MLLW is mean-free).
   - It is part of what the positive control now tests: P (published constants + OFFSET) must still match NOAA's
     predictions within 0.01 m median RMSE.
   - A station whose 365-day prediction mean cannot be computed (under 330 days of hours) gets no offset; that is
     recorded, and its A/B/P rows are scored raw.

Everything else stands exactly as registered:
- stations: the 26
- truths: T1 gates, T2 informative
- items 1-4: RMSE <= 0.08 m AND below C; no station worse than C by > 0.05 m; High/Low <= 20 min; |MLLW err| <= 0.05 m
- the computation choices of 22:41 EST
- the arm-choice rule
- the three controls, and VOID if any misbehaves
- EOT20's harness fix (nested `ocean_tides.zip`, commit on `claude/tide-m1-eot20-fix`) changes how the files are
  READ, not any rule

Sequence (director): this registration is committed and pushed ALONE. The advisor and the research lead review it,
and the advisor's OK comes before any G2 code is pushed or dispatched.
Product consequence, noted for after G2: near US stations, the served tide carries the station offset to agree with
NOAA's MSL / MLLW.

## 06:41 EST 2026-11-16 (`date`) - G2 as registered at af9e5e44b is WITHDRAWN (never run); the M1 diagnosis was wrong
Director, advisor and research lead (06:31-06:34 EST) asked for a check that uses no test-window data: one year of
CO-OPS MSL predictions minus our synthesis, as a monthly mean. Run on **calendar 2025** at Boston 8443970, Galveston
8771510, La Jolla 9410230 and Honolulu 1612340; the positive-control recipe (P) only. Script and output are in the notes
folder `tide-overlay-2026-11-15/sa-ssa-check-2025-*`.
- **A yearly wave, not a constant.** The monthly mean of (CO-OPS - P) swings +-0.06 (Boston), +-0.09 (Galveston),
  +-0.10 (La Jolla) and +-0.06 m (Honolulu), and its YEAR mean is 0.000 at all four. So the M1 offset idea was wrong:
  a 365-day mean would have left it in.
- **Cause: the SA/SSA phase convention.** SA/SSA were in P, but pyTMD's argument for SA is Doodson's h - p1 (the solar
  perigee p1 ~ 283 deg, about 77 days), while NOAA publishes SA/SSA phases for the arguments h / 2h (Schureman).
- **Confirmed by the fix:** P with SA = A cos(h - G) and SSA = A cos(2h - G) (h = the sun's mean longitude,
  Schureman; f = 1, u = 0), and pyTMD for everything else, gives a monthly-mean residual of 0.000 at all four stations.
  Raw RMSE over 2025 is 0.0112 / 0.0097 / 0.0143 / 0.0063 m, with **no offset**.
- **Consequence for M1 (VOID stands):** the M1 control failed on our harmonic code, not on a datum. FES2022b's
  M1 raw error carries the same seasonal term at the gauges (the meteorological/steric seasonal cycle is in NOAA's
  SA/SSA, mostly not in an ocean-tide atlas), so no level correction is derived from M1.

## G2 PRE-REGISTRATION (replaces the withdrawn one; written before any G2 code is pushed or any G2 number exists)
**Window:** **2026-09-29 00Z .. 2026-10-12 23Z**, hourly, frozen and already observed. It is clear of every date
below.

**Dates and stations already scored by any arm (so "unseen" is checkable):**
- At the 26 stations:
  - M1: 2026-10-15 .. 10-28 (arms A, C, D, P vs predictions and observed).
  - #926 `tide_datum_vs_coops.py`: 2026-11-08 .. 11-22 (vs predictions).
  - #926 P1-P3: 2026-11-08 .. 11-15 (vs observed).
  - #926 owner gate (a)-(d): 2026-11-01 .. 11-15 (vs predictions and observed).
  - #926 and #931 held-out: 7 days from each of 2025-12-15, 2026-03-15, 2026-06-15 and 2026-09-15 (103
    station-weeks, vs observed).
  - #931 harmonic gates and dry runs: the 14 days around 2026-11-15.
- At four stations (8443970, 8771510, 9410230, 1612340): calendar 2025, the P recipe only (the check above).
- Also used: Open-Meteo's 365-day mean before each window (arm D), and the archive from 2022-12-01 (climAll). Those
  are an arm's inputs, not truth comparisons.

**Rules, as registered at 22:25 / 22:41 EST, with exactly these changes:**
1. **No offset of any kind.** Arms A, B, C, D and P are scored as computed against unchanged truth.
2. **P's SA and SSA use NOAA's convention:** cos(h - G) and cos(2h - G), with h the sun's mean longitude per
   Schureman. All other constituents are as before (pyTMD, GOT nodal corrections, no inferred minors). The control's
   line is unchanged: **median raw RMSE <= 0.01 m, with no de-meaning**. On 2025 the four stations gave 0.006-0.014 m,
   so the control may well fail. If it does, G2 is VOID again, and that is the answer.
3. The model arms keep their own long-period conventions (PyFES for FES2022b; pyTMD for EOT20, whose atlas is
   distributed for it), unchanged.

Unchanged: the 26 stations; T1 gating and T2 informative; items 1-4 (RMSE <= 0.08 m AND below C; no station worse
than C by > 0.05 m; High/Low <= 20 min; |MLLW err| <= 0.05 m); thresholds; the arm choice; the label-swap and +6 h
controls; VOID on any misbehaving control.

**What a G2 PASS certifies:** the tide (level, timing, range) AT THE 26 GAUGES against NOAA's predictions, which
include NOAA's seasonal cycle. It does NOT certify the level at a surf spot away from a gauge; that needs its own gate.
If an arm fails item 1 on the seasonal term, the fix is a separately gated seasonal component, not a re-tune here.

Sequence (director): this registration is pushed ALONE. The advisor reads it before anything is dispatched. The code
(EOT20 nested-zip fix, P's SA/SSA, the window) is committed after it and pushed only after the advisor's read.

## 07:54 EST 2026-11-16 (`date`) - G2 ADDENDUM: control calibrated, reported tidal-band score, EOT20 convention (before any G2 number)
The advisor's read of 2a1434b83 (11:46Z / 11:50Z): acceptable on integrity, but not to dispatch until (1) the control
is calibrated so it isn't expected to fail, (2) a reported tidal-band score is registered, and (3) EOT20's seasonal
convention is checked. The director (06:49 EST) and the research lead agreed. None of this touches the G2 window.
Evidence is in the notes folder `tide-overlay-2026-11-15/` (`g2-control-calibration-2025-26stations.txt`,
`cal_*.py`, `noaa_m1m3.py`, `eot20-convention-2025-4gauges.json`).

**(1) Control calibration** (calendar 2025, P only - NOAA's constants against NOAA's own predictions, no arm, all 26
stations; iterated freely, as instrument calibration). After the SA/SSA fix, P read median 0.0096 m, max 0.021 m,
with 12 stations over 0.01. A least-squares fit of the residual on NOAA's constituent speeds put almost all of it in
**M1** (up to 0.027 m, West Coast) and **M3** (up to 0.027 m, East Coast), then S1. pyTMD defines all three
differently from NOAA's predictor. These five terms are now computed in NOAA's convention, from Schureman (SP 98)
and with nothing fitted to the data:
- V0 at 00:00 UTC Jan 1; f and u at mid-year.
- M1: V + u = T - s + h - 90 + xi - nu + Q, f = f(O1)/Ra. My first form also added p, which Q already accounts for;
  the standard variants were compared on four gauges and the textbook form was best.
- M3: 3(T - s + h), u = 3(xi - nu), f = cos^6(I/2)/0.8840.
- S1: V = T.
- SA / SSA: h / 2h.

Result through the gate's own code (`arms.harcon_eval` + `metrics.noaa_terms`), by station (m):
1611400 0.0022, 1612340 0.0022, 1615680 0.0026, 1617760 0.0025, 8443970 0.0092, 8452660 0.0025, 8531680 0.0033,
8534720 0.0031, 8651370 0.0025, 8658163 0.0031, 8665530 0.0055, 8720030 0.0066, 8722670 0.0019, 8723214 0.0017,
8726724 0.0030, 8729840 0.0025, 8771510 0.0030, 9410230 0.0052, 9410660 0.0053, 9413450 0.0055, 9415020 0.0057,
9419750 0.0062, 9435380 0.0072, 9443090 0.0075, 9751639 0.0013, 9755371 0.0016.
**Median 0.0030, max 0.0092 (Boston: L2/LAM2 left), 0 stations over 0.01.** The control's line stays at <= 0.01 m
median raw RMSE with no de-meaning, unchanged. Note: M1's node factor is 1.81 in 2025 and 1.065 in 2026; it is
computed per year.

**(2) REPORTED, NOT GATING: the tidal-band score.** Beside item 1, each arm (A and B) is also scored against CO-OPS
predictions MINUS NOAA's own SA + SSA (NOAA convention) at each hour. The arms are not altered. The JSON carries
`rmse_tidal_band` per station and `median_rmse_tidal_band_reported` per arm; the summary prints it beside the gating
score. Reading: if item 1 fails but the tidal band is well below 0.08 m, the failure is the seasonal cycle, not the
tidal model. The next registration (a seasonal component, e.g. NOAA monthly MSL or a CMEMS / AVISO altimetry
climatology) starts from that number. It changes no rule.

**(3) Seasonal conventions of the arms.**
- **B (EOT20 through pyTMD), measured** on calendar 2025 at the four check gauges. Run 43867649888 on branch
  `claude/tide-m1-eot20-check`, which cannot start the gate; public data, no credentials.
  - **Convention matches.** EOT20's SA as pyTMD evaluates it, refit as A cos(h - G), sits **+15 deg (Galveston) and
    +14 deg (Honolulu)** from NOAA's SA phase, not the ~-77 deg a convention mismatch would show. pyTMD's h - p1
    default is the convention EOT20's phases assume.
  - **The seasonal amplitude is short:** EOT20 SA 0.044 vs NOAA 0.077 m (Galveston) and 0.014 vs 0.048 m
    (Honolulu). So CO-OPS - B carries a yearly wave (+-0.10 m Galveston, +-0.035 m Honolulu; RMSE 0.072 / 0.040 m).
    The tidal-band score above is what separates it.
  - **Boston 8443970 and La Jolla 9410230: EOT20 is UNDEFINED** within the registered 10 km extrapolation cutoff (NaN
    at the gauge). Under item 2, arm B counts every such station as worse than C. B may therefore fail G2 on coverage
    alone. That is recorded here BEFORE the run as a known limit of the registered cutoff; the cutoff is not changed.
  - Arm B on calendar 2025 at these four gauges joins the seen list.
- **A (FES2022b through PyFES), by documentation only.** PyFES's Darwin engine uses Darwin/Schureman notation with
  Schureman's nodal corrections (the PyFES docs, "Darwin versus Doodson notation"), the convention NOAA uses for SA
  (h). An empirical check needs the licensed FES files, which live only in the Actions cache, and running it there
  would start the gate. G2's tidal-band line will show A's seasonal shortfall either way.

Nothing else changes. Order: this addendum is pushed ALONE; the code follows (45c360654 EOT20 extraction,
96736a72e window, a5580b290 calibration + tidal band), pushed only after the advisor's read. The G2 dispatch itself
waits for the owner's word typed in this session (director 06:49 EST: relayed authority withdrawn for the credentialed
run).

## 08:08 EST 2026-11-16 (`date`) - G2 ADDENDUM 2: one-shot start, reported seasonal constants (before any G2 number)
The advisor read 19195e449 (13:00Z): "That is the registration I would want." It set ONE condition before the code is
pushed and asked for ONE reported addition.

**Condition - a branch push never starts the gate.** Until now `tide-fes-gate.yml` ran on any push to `claude/tide-m1`
touching `backend/scripts/tide_fes/**` or the workflow. So pushing the code WAS the run, and so would be any later
fix, re-running the credentialed gate on the same window and letting the result be read twice.
- The advisor asked for workflow_dispatch only. That cannot work here: GitHub dispatches only workflows that exist on
  the default branch (`dev`), and this one does not.
- So the trigger is now **only a push of the tag `tide-gate-G2`** (plus workflow_dispatch, inert until the file
  reaches `dev`). That is one named run, pushed on the owner's word typed in this session.
- No branch push and no schedule can start it. A second run needs that tag deleted and pushed again, on purpose.
- Pinned by `test_the_credentialed_gate_starts_only_from_its_one_shot_tag`; adding a branch trigger back fails it.
- The code is pushed with this trigger already in place, so the push starts nothing (GitHub reads the trigger from
  the workflow file at the pushed commit).

**Addition - REPORTED, NOT GATING: each arm's seasonal constants at every gauge.** A 14-day window cannot show a
seasonal phase error; the constants can.
- Inside the gated run, each arm's own SA and SSA are isolated at every gauge over calendar 2025 (not a test
  window): FES2022b as the full PyFES series minus the series without that file; EOT20 as pyTMD restricted to
  that constituent, without inferred minors.
- Each is refit as A cos(k h - G) in NOAA's convention and printed beside NOAA's published SA / SSA (A, G), with
  `{arm}_SA_phase_minus_NOAA_deg` and its median.
- Reading: near 0 (EOT20 measured +14 / +15 deg) means the convention is right and any shortfall is amplitude.
  About -77 deg means the evaluator. This is the first EMPIRICAL check of FES2022b's convention; until now it came
  from documentation.
- It changes no rule.

**For the PR text (advisor; not conditions):**
- The control is now partly a hand-built emulator of NOAA's predictor, calibrated on 2025 and tested on the 2026
  window, where M1's node factor is 1.065 against 2025's 1.81. That difference is what makes it a real control.
- Arm B is expected to fail item 2 on coverage at Boston 8443970 and La Jolla 9410230 (EOT20 undefined within
  10 km). A B fail there says nothing about EOT20 where it is defined.

Order: this addendum is pushed ALONE; then the code (dfe35107f, e6670491f, 0322983b5, 7d53ae2ff) in one push, which
starts nothing. The run is the `tide-gate-G2` tag, pushed only on the owner's word typed in this session.

## 08:49 EST 2026-11-16 (`date`) - G2 STARTED on the owner's word (recorded before any output is opened)
- **Owner, typed in this session, 08:46 EST: "Yes, start G2".** Advisor (13:13Z): acceptable to dispatch as designed at
  7f20c12c9. That was design advice; the start is the owner's word.
- Tag **`tide-gate-G2`** -> commit **7f20c12c99b3455a612a9fd7ca6558d51aa6bb3c**. The tag was absent on the remote
  before the push and was pushed at 13:47:22Z.
- Run **43879148124** (workflow "Tide M1 gate", ref tide-gate-G2, head 7f20c12c99b3), created 13:47:17Z.
- Reading order (advisor 13:13Z):
  - Controls first. If any of the positive, label-swap or +6 h controls misbehaves, the run is VOID and nothing else
    is quoted.
  - If the arms fail item 1, the tidal-band line and the per-arm SA/SSA constants are reported first, before any
    interpretation.
  - The advisor reads the output before it goes to the owner as a result.

## 09:14 EST 2026-11-16 (`date`) - G2 run 43879148124: FAILED IN THE DOWNLOAD, the gate never ran, no G2 number exists
- The "Run the gate" step was **skipped**; no artifact. **No arm was computed on the G2 window**, so it remains unseen.
- **Fault 1, cache scope.** GitHub caches are scoped to the ref that saved them. A run on the tag
  `refs/tags/tide-gate-G2` sees only that tag's caches and the default branch's, so the full FES cache saved by branch
  run 43836918731 was invisible and every file was downloaded again.
- **Fault 2, cache prune.** The `if: always()` prune then deleted that branch cache.
- **Fault 3, login refused.** After K1 (159 MB, 22 min), AVISO refused one of the 4 parallel logins
  (`paramiko AuthenticationException`). The pinned host key had matched; no credential appears in the log.
- **Fix (plumbing only, no rule changed):**
  - Each AVISO login retries with backoff (5 tries, 60/120/... s), still checking the host key before every attempt.
  - 3 connections instead of 4.
  - Pruning runs only after a complete download.
  - A re-run on the same tag restores this tag's cache (K1 so far) and resumes.
- **A re-run needs the tag deleted and pushed again on the fixed commit, which is the owner's call.** The
  "start G2" word was used for this run; it produced no number.

## 09:21 EST 2026-11-16 (`date`) - login load cut to 2 connections, at most 3 tries each
The advisor (14:21Z) asked for the retry load against a licensed service to be stated in the log. I cannot confirm
AVISO's terms on concurrent sessions or lockout, so I took the conservative option: **2 parallel connections**, each
at most **3 login attempts** (waits 90 s, then 180 s). The worst case is 6 attempts in about 5 minutes. The previous
setting was 3 x 5, and the first G2 run used 4 connections. A download that still fails stops; it does not keep
retrying. The advisor's acceptance of the design carries to this commit, since no rule, arm, metric or window file
changed.

## 10:02 EST 2026-11-16 (`date`) - G2 RE-RUN started on the owner's word (recorded before any output is opened)
- **Owner, typed in this session, 09:59 EST: "Yes, re-run G2".** This is a second start on purpose.
- **The first run produced nothing:** run 43879148124 (tag on 7f20c12c9) failed in the download step, the gate step
  was skipped and there was no artifact. The advisor checked this itself (14:21Z), so no G2 number existed before
  this run.
- **The tag was moved on purpose:** `tide-gate-G2` was deleted on the remote, re-created on
  **bd41572d821b108578a8d62dd294ee2389dc01ab**, and pushed at 15:00:36Z.
  - The commits since 7f20c12c9 are plumbing only (advisor 14:21Z: "the same test with working plumbing"): AVISO login
    retry with 2 connections, at most 3 tries each; prune only after a complete download.
  - The workflow at bd41572d8 triggers only on that tag (checked before the push).
- Run **43891805830** (ref tide-gate-G2, head bd41572d8), created 15:00:36Z. It restores the tag's own cache
  `fes2022b-v2-43879148124` (K1, 159 MB) and downloads the other 15 files.
- Reading order is unchanged: controls first; VOID means nothing else is quoted; then item 1, the tidal-band line and
  the per-arm SA/SSA constants. The advisor reads the output before it goes to the owner.

## 14:53 EST 2026-11-16 (`date`) - G2 re-run 43891805830: the runner DIED in the gate step, no G2 number exists
- Download: 15:10:50Z -> 18:50:53Z, success (2 AVISO connections; no login refused). Both caches were saved under
  the tag ref (`fes2022b-v2-43891805830`, `eot20-ocean-v2-43891805830`).
- Gate step: started 18:51:26Z, never completed. GitHub's annotation: "The hosted runner lost communication with the
  server. Anything in your workflow that terminates the runner process, starves it for CPU/Memory, or blocks its
  network access can cause this error." The job ended 19:44:30Z.
- **No artifact, and the incomplete step left no log lines at all** (0 lines retrievable). No score was seen, so the
  G2 window remains unseen.
- **Likely cause, the new part since M1:** M1's gate ran to completion in minutes, but its arm B errored at once
  (the nested-zip bug), so this run was the first where arm B actually evaluated. `pyTMD.compute.tide_elevations`
  re-opens and loads all 17 global EOT20 grids on every call (`chunks=None` reads them eagerly). The gate called it
  per 200k-time chunk, per station (19-year synthesis and seasonal refits included): hundreds of full-atlas loads.
- **Fix (plumbing; same computation):** `arms.eot20_eval` now follows pyTMD's own steps (open, crop, interp,
  predict, infer), but opens the atlas ONCE per process and interpolates ONCE per point; prediction stays in chunks.
  Its equality with pyTMD's one-call path and its memory are being proved on calendar 2025, public data only, on the
  check branch (run 43943815300), before any further G2 start.
- A third start needs the owner's word again.
- **Equivalence proved (run 43943815300, calendar 2025, public data, check branch `da3937d1d`):**
  - New `eot20_eval` vs pyTMD's one-call `tide_elevations`, 8760 hours: max |diff| **0.0 m** at Galveston and
    Honolulu, for the full arm and for SA alone. Boston is undefined on both paths.
  - Memory: peak RSS **4526 MB**, flat after the first (single) atlas load.
  - A 19-year 10-min synthesis (999,360 times) takes **5.1 s**. The old path took ~2.4 s and a full atlas load per call.

## 15:12 EST 2026-11-16 (`date`) - arm B identity at all 26 gauges; gate hardened (before a third start)
- **Correction (advisor 20:01Z).** The earlier line "plumbing only, no arm touched" was wrong for 43a710922. Accurate:
  **arm B's evaluation path was rewritten and shown numerically identical to pyTMD's one-call path.**
- **Identity at ALL 26 gauges** (advisor's condition). Run 43945722463, check branch `5dbe3d38d`, calendar 2025,
  public data. Raw JSON: notes `tide-overlay-2026-11-15/eot20-equivalence-26-gauges-2025.json`.
  - Definedness agrees at every gauge: 20 defined on both paths, 6 undefined on both. None is defined on one path only.
  - Max |diff| over 8760 hours, full arm and SA alone: **0.0 m** at 18 of the 20 defined gauges; 2.2e-16 m (Atlantic
    City) and 8.3e-17 m (Charlotte Amalie) are floating-point rounding.
  - **EOT20 is UNDEFINED within 10 km at 6 gauges:** Kahului 1615680, La Jolla 9410230, Los Angeles 9410660, Boston
    8443970, Newport 8452660, Fernandina Beach 8720030. Under item 2 those count against arm B, so **arm B is expected
    to fail item 2 on coverage**. Recorded before the run; the 10 km cutoff is unchanged.
  - **Seen-list addition:** arm B (EOT20) on calendar 2025 at all 26 gauges. Evaluator identity only; no truth scored.
- **Memory.**
  - The check process peaked at 7757 MB, but it also ran pyTMD's one-call reference path 52 times.
  - Arm B alone (the gate's path) sat flat at 4526 MB.
  - In the gate, FES2022b is subset (one global grid at a time, written as small per-station boxes) BEFORE EOT20 is
    opened, and PyFES then reads only those small boxes, so the arms' peaks do not stack.
  - The hosted runner for a public repository has 16 GB.
  - The gate now prints peak RSS at each stage, so the combined figure will be measured, not inferred.
- **Evidence if it dies.** One flushed line per stage and per gauge, showing the stage name and peak RSS ONLY
  (`stage station <id> arm A|B`, `stage station <id> done`, the subset and download stages). The per-station
  score line is gone: scores reach only the final summary and the artifact. Pinned by
  `test_the_gate_logs_stages_and_memory_never_scores`.
- **Versions pinned:** pyfes 2026.5.2, pyTMD 3.1.0, **timescale 0.1.3** (new), so the identity cannot break silently on
  a version bump; the test checks the pins.
- A third start needs the owner's word.

## 15:19 EST 2026-11-16 (`date`) - advisor accepts G2 at 8b5149149; one reporting rule added BEFORE any run
- **Advisor (20:19Z):** "G2 is acceptable to start from me, as designed, at 8b5149149". That is design advice; the
  start is the owner's word typed in this session.
- **Reported, not gating - arm B is reported twice:**
  1. As registered: likely an item-2 fail on coverage, since six gauges are outside EOT20's 10 km reach.
  2. On the 20 gauges where EOT20 is defined: items 1-4 recomputed on that subset, for information only.

  That way a coverage fail is not read as a statement about the atlas. This changes no rule and no verdict; it is a
  reading added before the run.
- **Reading order:**
  1. Log the tagged commit and run id first.
  2. Controls first; VOID means nothing else is quoted.
  3. Then item 1, the tidal-band line and the per-arm SA/SSA constants.
  4. Then B twice.
  5. The output goes to the advisor before the owner.
