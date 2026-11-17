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

## 15:35 EST 2026-11-16 (`date`) - G2 THIRD START on the owner's word (recorded before any output is opened)
- **Owner, typed in this session, 15:30 EST: "Yes, start G2".** Advisor (20:19Z): acceptable to start at 8b5149149.
- **Previous starts produced nothing:**
  - 43879148124: the download failed.
  - 43891805830: the runner died in the gate step. No artifact and no log lines, so no score was seen.
- `tide-gate-G2` was deleted on the remote and re-created on **8b5149149c0a6cd39475fbd1c6c81b89ef2a4033** (pushed
  20:32:27Z). That commit's trigger is the tag only (checked).
- Run **43950822962** (ref tide-gate-G2, head 8b5149149), created 20:32:25Z.
- Reading order, as recorded at 15:19 EST: controls first (VOID means nothing else is quoted); item 1; the tidal-band
  line; the per-arm SA/SSA constants; arm B twice; then the advisor, before the owner.

## 15:43 EST 2026-11-16 (`date`) - G2 RESULT, run 43950822962 at 8b5149149: **FAIL** (controls behaved; a valid result)
Read in the registered order. Job 20:33-20:39Z; peak RSS 2806 MB. Artifact `tide-fes-gate`; copy in notes
`tide-overlay-2026-11-15/g2-result-run-43950822962.json`. Window 2026-09-29 00Z .. 10-12 23Z; 16 FES constituents.
**Pending the advisor's read before it goes to the owner as a result.**

**1. Controls - all behaved, so NOT VOID:**
- Positive (NOAA's constants, our synthesis): **0.0025 m** (<= 0.01).
- Label swap: **0.547 m** (> 0.3).
- +6 h shift: no extremum matched (fails timing, as it must).

**2. Items (rules as registered):**

| arm | 1 RMSE (<= 0.08 and < C 0.154) | 2 no gauge worse than C | 3 High/Low | 4 MLLW | pass |
|---|---|---|---|---|---|
| A FES2022b | 0.0893 FAIL | pass | 7.7 min | 0.0135 m | no |
| B EOT20 | 0.0878 FAIL | FAIL (coverage: 1615680 9410230 9410660 8452660 8720030; Boston has no C) | 9.4 min | 0.0161 m | no |

Arm choice (none passes): B's median is within 0.01 m of A's, so A by the tie rule. **Verdict FAIL.**

**3. Tidal band (REPORTED, not gating; truth minus NOAA's SA/SSA):** **A 0.024 m, B 0.046 m.** Both are well under the
0.08 m line once NOAA's seasonal cycle is removed. As registered, item 1's failure is attributed to the seasonal
component, not the tidal model.

**4. Seasonal constants (REPORTED):**
- **A (FES2022b): SA amplitude ~0.0003 m at every gauge, vs NOAA's 0.046-0.122 m** (median ratio 0.00). FES2022b
  carries essentially NO seasonal cycle, so its "-25 deg" median phase is the phase of a near-zero term and means
  nothing. This is the empirical answer the documentation could not give: the convention question is moot for A,
  because there is nothing there.
- **B (EOT20): SA at median 0.37 of NOAA's amplitude, phase +17 deg (median).** The convention matches; the amplitude
  is short.

**5. Arm B twice (as set at 15:19 EST):**
- As registered: FAIL on items 1 and 2 (item 2 on coverage).
- On its 20 defined gauges (reported only): items 2, 3 and 4 pass; item 1 0.0878 vs C 0.1542, FAIL. On the same 20
  gauges arm A reads 0.1077, so **B beats A by 0.020 m there**.

**6. Per-gauge notes (reported):**
- A's tidal-band error stays large where the gauge sits in an estuary, river mouth or bay: Fernandina 0.202 (St Marys
  River), Pensacola 0.102, South Beach 0.101 (Yaquina), Duck 0.098, Sandy Hook 0.093, Virginia Key 0.092.
- B is poor at Neah Bay (0.248, tidal band 0.233).
- Strata medians A / B / C: Hawaii 0.051 / 0.038 / 0.082; Pacific 0.066 / 0.046 / 0.141; Atlantic 0.138 / 0.109 /
  0.205; Gulf 0.142 / 0.106 / 0.154; PR 0.075 / 0.055 / 0.084.
- Arm D median 0.165. Observed water (T2, informative): A 0.31, B 0.28, C 0.35, D 0.19.

**Nothing served changes.** #926 and #931 stay held (their hold was conditioned on G2 passing).

## 15:56 EST 2026-11-16 (`date`) - advisor read G2 at 20:55Z; result released to the owner
- The advisor checked the run itself: tag at 8b5149149, gate step succeeded, one artifact, public log stage/memory
  only. It **recomputed every median from the 26 per-gauge rows** (A 0.0893, B 0.0878 n=20, C 0.154, D 0.1645,
  P 0.0025; tidal band A 0.0244, B 0.0455; T2 A 0.3123, B 0.2848, C 0.3467, D 0.1856), all matching. Note: notes
  `advisor-tide-g2-read-2026-11-16.md`.
- **Verdict as registered: FAIL, not VOID.** The attribution to the missing seasonal sea level stands.
- Stressed for the owner:
  1. Six estuary / bay / inlet gauges stay above 0.08 m even in the tidal band. A seasonal term does not fix them.
  2. Against OBSERVED water a pure astronomical tide is no better than today's served value (A 0.31 vs C 0.35) and
     worse than the held #926 datum (D 0.19). M1 needs a free primary source for the non-tidal level (surge,
     sea-level anomaly), or it is a step back from #926 against real water.
  3. B edges A only through its partial seasonal term; its tide is the poorer, so the tie rule naming A is right.
- **Next (registered; nothing re-tuned on this now-seen window):** a separately gated seasonal component AND a
  non-tidal level, on a new unseen window, each pre-registered first.

## 15:59 EST 2026-11-16 (`date`) - G3 PRE-REGISTRATION DRAFT: seasonal + non-tidal water level (written before any G3 code or data)
Owner, typed in this session 15:58 EST: "Yes, register it." This is a DRAFT for the advisor's and the research lead's
review. Thresholds and sources are proposed, not final, until their reads are recorded here. Nothing is built or run
before that, and any G3 run is the owner's word in this session.

**Why:** G2 FAILED with the controls behaving. The astronomical tide is right in shape (timing 7.7 min, MLLW 0.014 m,
tidal band 0.024 m) but it has (a) no seasonal sea level (FES2022b SA ~0.0003 m vs NOAA's 0.05-0.12) and (b) no
non-tidal water. Against OBSERVED water it reads 0.31 m vs today's served 0.35 and the held #926 datum's 0.19. The
owner's rule (22:01 EST): the served system must come from free GRIB / CMEMS-type sources, not Open-Meteo.

**What G3 measures:** served water level = FES2022b tide (arm A of G2, unchanged) + a SEASONAL term + a NON-TIDAL term,
each from a free, non-Open-Meteo source, scored first against OBSERVED water (what a surfer stands in).

**Candidate sources** (availability for the window and the license to be confirmed BEFORE code; a source that cannot
be confirmed is dropped from G3 before any run, and the drop is recorded here):
- **N1 - CMEMS global analysis-forecast sea surface height** (`zos`, GLOBAL_ANALYSISFORECAST_PHY_001_024, 1/12 deg,
  hourly, 10 days). Free with the project's Copernicus Marine account; Copernicus is already in the ingest. It
  carries steric/seasonal and mesoscale level; whether it also carries tides must be checked. If it does, the tidal
  part is removed or not double-counted.
- **N2 - NOAA STOFS-2D-Global non-tidal water level** (surge, from the free operational ADCIRC runs on NOMADS/AWS,
  ~7 days).
- **S1 - seasonal climatology** from satellite altimetry (CMEMS/AVISO gridded SLA, a monthly or day-of-year mean over
  a multi-year base), at the gauge's cell. Used only where N1 does not already carry the seasonal level.

**Arms:**
- A (tide only, G2's arm A).
- A+S1.
- A+N1.
- A+S1+N2.
- Reference arms, TEST-ONLY and never served: C (Open-Meteo de-meaned 72 h) and D (the held #926 datum).
- Arm B (EOT20) is not carried forward: it failed on coverage, and its tide was the poorer of the two.

**Forecast, not hindcast:** each served value is a FORECAST, so every non-tidal arm is scored at the leads served, from
the run issued before the valid hour. Strata are reported at lead 0-24, 24-48 and 48-72 h; the gate reads 0-72 h pooled.

**Window:** a new, frozen, already-observed 14-day window, clear of every seen date (listed at 06:41 EST, plus G2's
2026-09-29 .. 10-12, plus calendar 2025 for P and arm B). Proposed: **2026-08-25 00Z .. 2026-09-07 23Z** (clear of the
held-out week from 2026-09-15). It is confirmed once the sources are confirmed to hold that window at the needed leads.

**Truth:** T2 CO-OPS OBSERVED water (MSL, on the hour) GATES. T1 CO-OPS predictions are reported (the seasonal check).

**PROPOSED pass lines (for the chosen non-tidal arm, all must hold):**
1. Median RMSE vs OBSERVED water below D's by >= 0.02 m, AND below C's.
2. No gauge worse than D by more than 0.05 m.
3. On surge hours (|observed non-tidal| > 0.15 m, 25 h low-pass of observed - predicted): median RMSE below A's
   (the non-tidal term must earn its place where it matters).
4. The tide's shape items stay as in G2: High/Low time <= 20 min, |MLLW err| <= 0.05 m.
5. Seasonal check (reported, and it decides whether S1 is kept): A+S1 vs CO-OPS PREDICTIONS has median RMSE <= 0.08 m.

**Controls (any misbehaving makes the run VOID):**
- Positive, as in G2: NOAA's constants against NOAA's predictions, <= 0.01 m.
- An ORACLE yardstick: CO-OPS predictions + the observed non-tidal residual held from the previous day (the best a
  station-bound method can do). Reported, and it bounds what "good" means.
- Negative 1: label swap (200 derangements); the median must be > 0.3 m vs observed.
- Negative 2: the non-tidal term shifted +24 h must LOSE item 3 to the unshifted term (if it does not, the term is
  not carrying information).

**Reported, not gating:**
- The six estuary / bay / inlet gauges where the tide itself is off (Fernandina, Pensacola, South Beach, Duck, Sandy
  Hook, Virginia Key), stratified. The non-tidal terms are not expected to fix them.
- Strata by region and by lead.

**Scope:** a PASS certifies the water level at the 26 GAUGES against observed water. It does not certify the level at
a surf spot away from a gauge, which needs its own gate.

**Sequence:**
1. This draft is pushed alone.
2. The advisor and the research lead read it.
3. Sources are confirmed (availability, license, whether N1 carries tides), and the final registration is recorded
   with any changes.
4. Code.
5. The owner's word for the run.

#926 and #931 stay held.

## 16:25 EST 2026-11-16 (`date`) - G3 PRE-REGISTRATION, FINAL (supersedes the 15:59 draft; written before any G3 code or number)
The advisor read the draft at 21:05Z and asked for eight changes, all adopted below. The research lead's read, if it
arrives before the code, is recorded as an addendum. Any G3 run is the owner's word typed in this session.

### Source confirmations (done 16:08-16:25 EST; nothing scored)
- **N2 - NOAA STOFS-2D-Global, CONFIRMED as issued.** Bucket `noaa-gestofs-pds`, cycles `stofs_2d_glo.YYYYMMDD/` for
  every day 2026-08-20 .. 09-11 (listed). Each cycle carries POINT output (`points.swl.nc` surge, `points.htp.nc`
  STOFS's own tide, `points.cwl.nc` total = tide + surge + a sea-level anomaly term, plus `cwl.noanomaly`): 1,687
  points, 6-min steps, a -6 h nowcast plus a +180 h forecast. **All 26 gate gauges are among the points** (checked
  in the 2026-08-25 00Z file). Forced by GFS wind and pressure, so it includes inverse barometer and wind setup.
  Free and public.
- **N1 - CMEMS GLO12 (`GLOBAL_ANALYSISFORECAST_PHY_001_024`), CONFIRMED as ANALYSIS ONLY for a past window.** The
  product is a sliding two-year best-estimate series; forecasts as issued are not kept. Its user manual (Issue 2.4,
  07/2026): `zos` = "Sea surface height computed without tides and surface pressure force", i.e. wind-driven, steric
  and mesoscale level, with NO tide and NO inverse barometer. A separate `merged-sl_PT1H-i` dataset gives
  `invert_barometer` and `ocean_tide`. Access is the project's existing Copernicus Marine account
  (`COPERNICUSMARINE_SERVICE_*`, already used for waves).
- **S1 - altimetry seasonal climatology:** CMEMS gridded sea level anomaly (`SEALEVEL_GLO_PHY_L4_MY_008_047`, daily,
  relative to the 1993-2012 mean), same account. **Not confirmed from here without the credentials.** Rule: an
  automated PREFLIGHT step in the run confirms access BEFORE any truth is fetched. If it fails, S1 is dropped, the
  primary arm falls back as written in "Choice", and the drop is logged in the run's output.
- **C and D on equal footing, CONFIRMED.** Open-Meteo's marine API serves previous runs
  (`sea_level_height_msl_previous_day1..3`, checked for 2026-08-25). C and D are therefore scored as forecasts at
  the same leads as the arms (lead 24-48 h = previous_day1, etc.), not as a hindcast. They remain TEST-ONLY.

### What is measured
Served water level = FES2022b tide (G2's arm A, unchanged) + seasonal + non-tidal, against OBSERVED water at the 26
gauges, scored as forecasts at the served leads.

**Arms:**
- **PRIMARY (named in advance): P1 = A + S1 + N2_swl.** FES tide + altimetry seasonal + STOFS surge, all forecasts
  as issued (S1 is a climatology, so it has no lead).
- Reported, not chosen:
  - A (tide only).
  - A + S1.
  - **N3 = STOFS `cwl`** (NOAA's own operational total water level: its tide + surge + anomaly), a full alternative
    product.
  - **A + N1 (`zos` + `invert_barometer`), ANALYSIS - UPPER BOUND ONLY**: labelled as such, never gating, never
    chosen.
- A + N1 + N2 is NOT an arm: zos already carries wind-driven level, so adding STOFS surge would double-count the wind
  setup.
- TEST-ONLY references C (Open-Meteo, 72 h de-mean) and D (#926 datum), at the same leads.

**Forecasts as issued.** Each value at valid hour t and lead L comes from the latest cycle issued at or before
t - L. Leads are 0-24, 24-48 and 48-72 h, reported separately; the gate reads them pooled. An arm or reference with no
as-issued value at a lead is not scored there and cannot fill from a later run.

**Datum rule (fixed before any number; it is the PRODUCT's rule too):**
- FES2022b is zero-mean by construction.
- S1 = the day-of-year mean of the altimetry SLA over a fixed base 2016-01-01 .. 2025-12-31, at the gauge's cell. It
  carries the seasonal cycle AND the present mean level against the 1993-2012 reference.
- N2_swl and N3 are each referenced to their OWN mean over the 30 days before the window (2026-07-26 .. 08-24, from
  the 00Z nowcasts), so a model's mean offset is not mistaken for skill. N1 likewise over the 365 days before the
  window (analysis).
- Observed water is CO-OPS `water_level` on the station MSL (1983-2001 epoch).
- **Both the raw score and the mean-removed score are printed for every arm and gauge.** The RAW score gates, because
  the level a surfer stands in includes the mean.

**Window:** **2026-08-25 00Z .. 2026-09-07 23Z**, hourly, frozen and already observed. It is clear of every seen date
(06:41 EST list; G2 2026-09-29 .. 10-12; calendar 2025 for P and arm B). STOFS cycles exist from 2026-08-20, so the
72 h leads are covered. It falls in hurricane season (see item 3).

**Truth:** T2 CO-OPS OBSERVED water gates. T1 predictions are reported.
The non-tidal residual is the 25 h low-pass of (observed - CO-OPS predictions).

### Pass lines (P1, all must hold)
Statistics:
- Every comparison is a PAIRED per-gauge difference (arm minus reference), with a 95% interval from a block
  bootstrap: 2000 draws, seed 20260825, resampling gauges and 2-day blocks.
- **A line is met only by the interval's END, not the point.**

Items:
1. **Level:**
   - Median paired RMSE difference vs observed: P1 - D has its interval's UPPER end <= -0.02 m.
   - AND P1 - C has its interval's upper end < 0.
2. **No gauge much worse:** at every gauge, P1 - D <= +0.05 m (point, per gauge).
3. **Surge hours** (|observed non-tidal| > 0.15 m):
   - The P1 - A paired difference has its interval's upper end < 0, resampled BY EVENT.
   - **RUNNABLE only with >= 3 separate events (>= 12 h each, at least 24 h apart) in >= 2 regions.** Below that,
     item 3 is NOT RUNNABLE and G3 is INCONCLUSIVE (it cannot PASS); a new unseen window follows.
   - In hurricane season one event can dominate, so the per-event results are printed.
4. **Calm hours** (|observed non-tidal| < 0.05 m): the P1 - A paired difference has its interval's upper end
   <= +0.01 m. A noisy field fails here, and that is what a surfer sees most days.
5. **Tide shape** (unchanged from G2): median High/Low time error <= 20 min; median |MLLW err| <= 0.05 m.

**Choice:** P1 is the only arm that can PASS. No multiple-arm correction is needed, since only one arm is tested. If
the S1 preflight fails, the primary becomes **P1' = A + N2_swl** by this rule, written now; nothing else moves.

**Controls (any misbehaving means VOID):**
- **Positive:** NOAA's constants vs NOAA's predictions <= 0.01 m (G2's).
- **Negative 1:** label swap (200 derangements); median vs observed > 0.3 m.
- **Negative 2 (constant):** the non-tidal term replaced by its own pre-window mean must LOSE item 1 to the real term
  (the interval of constant - real has its lower end > 0).
- **Negative 3 (shift):** the non-tidal term shifted +24 h must LOSE item 3 (the interval of shifted - real has its
  lower end > 0). If item 3 is not runnable, this control is reported as not runnable and does not VOID.
- **Oracle yardstick (reported):** CO-OPS predictions + the observed non-tidal residual held from the day before.
  It uses only NOAA's own free data. **Within the gauge radius it is a candidate for serving in its own right**, to
  be registered separately. G3's field arms matter away from gauges.

### Reported, not gating
- **Second score on the 20 open-coast-like gauges**: the 26 minus Fernandina 8720030, Pensacola 8729840, South Beach
  9435380, Duck 8651370, Sandy Hook 8531680 and Virginia Key 8723214, the estuary / bay / inlet gauges where the tide
  itself is off (G2).
- Strata by region and by lead; per-event surge table; raw and mean-removed scores.

### Scope and disclosures
- **Scope:** a PASS certifies the water level at the 26 GAUGES against observed water. The gauges sit in harbours
  and bays, where a 1/12-degree ocean model and a global surge model are weakest and where surf is not. So a PASS
  says little about the open coast, and a FAIL may be about harbours. Level at surf spots away from gauges needs its
  own gate.
- **Disclosure:** these thresholds were written AFTER seeing G2's observed-water numbers (A 0.31, C 0.35, D 0.19 on
  2026-09-29 .. 10-12). They reference D and C measured anew on the G3 window, not those numbers.

Sequence:
1. This registration is pushed alone.
2. The advisor reads it (and the research lead, if before code).
3. Code, with the S1 preflight.
4. The owner's word for the run, through the same one-shot tag mechanism under a new tag `tide-gate-G3`.

#926 and #931 stay held.

## 16:54 EST 2026-11-16 (`date`) - G3 ADDENDUM: the research lead's read; a truth-only surge count (before any arm)
The research lead read the 15:59 draft (its points 1-2 of (b) and the bootstrap were already in the FINAL). Added now,
BEFORE any arm is computed:

- **STOFS-3D-Atlantic, a REPORTED regional arm (Atlantic/Gulf strata only).** SCHISM, with rivers and estuaries; the
  free model most likely to help the estuary gauges. Confirmed kept as issued: `noaa-nos-stofs3d-pds`,
  `STOFS-3D-Atl/stofs_3d_atl.YYYYMMDD/`, a daily 12Z cycle with `fcast.station.profile.nc` and conus.east `cwl` GRIB2
  (2026-08-25 listed). Not chosen; US-only.
- **N2 non-tidal, both forms:** P1 uses `swl` (as registered). `cwl - htp` (which includes STOFS's anomaly term) is
  reported as N2'.
- **S1 at the nearest valid OFFSHORE cell** (altimetry degrades in the last ~10 km): the nearest cell >= 10 km from
  the coast with a complete daily record over the 2016-2025 base.
- **Every score also split into mean bias and standard deviation** (reported), so a datum offset cannot pass for
  surge skill.
- **D is not in-sample:** D's datum is the Open-Meteo mean over the 365 days before each window, and #926's held-out
  weeks (from 2025-12-15, 2026-03-15, 06-15, 09-15) do not touch 2026-08-25 .. 09-07.
- **+24 h shift control:** read on the surge-hour subset (as item 3), not pooled.

**Item 3: surge hours are defined on the de-meaned residual.** Truth-only check (research lead), recorded before any
arm. Observed minus CO-OPS predictions, 25 h low-pass, at the 26 gauges over the window (notes
`g3-truth-surge-count-*.json`, script `g3_surge_count.py`):
- **As drafted** (|residual| > 0.15 m): 2242 surge hours at 15 gauges. But La Jolla and Los Angeles counted 329 and
  336 of 336 hours. That is a PERSISTENT MEAN OFFSET of observed over the 1983-2001-epoch predictions, not surge: the
  residual's mean over the 30 days before the window is **+0.05 .. +0.20 m** at nearly every gauge (largest on the
  Atlantic). As drafted, item 3 would test mean level, not surge.
- **Registered now (before any arm):** a surge hour is |residual - its own mean over the 30 days BEFORE the window
  (2026-07-26 .. 08-24)| > 0.15 m. Event = >= 12 consecutive surge hours.
- **Counts under that definition:** **439 surge hours at 9 gauges; 11 events of >= 12 h in 2 regions (Atlantic 9,
  Pacific 2); 5 gauges with >= 48 h.**
- **Minimums (both required, else item 3 is NOT RUNNABLE and G3 is INCONCLUSIVE):** the advisor's (>= 3 events in >= 2
  regions) AND the research lead's (>= 48 surge hours on >= 5 gauges). **The window meets both, so it is kept.**
- The pre-window mean offset itself is the datum term the registration already requires S1 to carry (the present
  mean level against the 1993-2012 altimetry reference); the bias/SD split will show whether it does.

Also: the G2 result is recorded on dev in its own docs-only PR #987 (director).

## 16:57 EST 2026-11-16 (`date`) - advisor accepts the G3 FINAL (21:30Z); three clarifications (no rule changes)
**Advisor (21:30Z):** "the G3 FINAL registration at dabe5b7d7 is acceptable from me as the test design".

Added before code:
1. **Named outcome for the datum.** Observed water sits on the gauge's 1983-2001 mean, S1 on altimetry's 1993-2012
   mean, and gauges move with the land (Gulf subsidence: millimetres a year). A **raw FAIL beside a mean-removed
   PASS** is called **"a datum finding: the level needs a per-place reference"**. It is NOT read as the non-tidal
   term failing, and the verdict stays the raw one (raw gates).
2. **If N3 (STOFS total water level) beats P1:** nothing changes in this run. N3 is a reported line, and switching
   the primary to it would be a NEW registration on a NEW unseen window.
3. **Item 2 is deliberately strict:** a point value at each of 26 gauges, so one noisy gauge can fail the gate.
   That strictness is intended.

**Before the owner's word is used:** the code head (the new workflow with the one-shot `tide-gate-G3` tag) goes to the
advisor first. Its checklist:
- the trigger is that tag only;
- the Copernicus and AVISO credentials are set only on the steps that fetch, and are never echoed;
- the log shows stages and memory, never a score;
- versions are pinned;
- the S1 preflight runs before any truth fetch;
- every lead L at valid hour t is built only from cycles issued at or before t - L.

## 17:03 EST 2026-11-16 (`date`) - advisor accepts the G3 addendum (21:58Z); storms, not gauge-events; what was seen
1. **Events are grouped into storms (registered now; no new data, counted from the file already fetched).** Gauge-events
   in the same region that overlap in time, or start within 48 h of each other (single-linkage), are ONE storm.
   Item 3 and its +24 h shift control resample BY STORM. **Storm count: 3 storms in 2 regions:**
   - Atlantic 2026-08-28T13 -> 08-29T10: one gauge (8658163), one gauge-event.
   - Atlantic 2026-09-02T02 -> 09-08T00: 6 gauges (8534720 8651370 8658163 8665530 8722670 8723214), 8 gauge-events.
   - Pacific 2026-09-02T04 -> 09-06T23: 2 gauges (9435380 9443090), 2 gauge-events.

   That meets the >= 3 storms in >= 2 regions minimum exactly, so item 3 is RUNNABLE. With 3 storm units its interval
   will be wide, which is honest. The window, the 48 h rule and the thresholds do NOT move after this count. Had it
   come out short, item 3 would have been NOT RUNNABLE, and items 1, 2, 4 and 5 still report.
2. **What was seen (this line is carried into the result):** the window's OBSERVED water and CO-OPS predictions were
   read for a truth-only count (no arm scored). Item 3's surge-hour definition was changed after that look (to the
   pre-window-demeaned residual), and the window was kept because the counts met the minimums. That truth was fetched
   BEFORE the S1 preflight; the P1 / P1' choice stays mechanical, by S1 availability only. **No further truth-only
   looks at this window before the run.**

## 17:06 EST 2026-11-16 (`date`) - G3 registration closed (advisor 22:07Z: no open point at beab9f76c)
- **Label carried, not a condition:** with 3 storm units, the bootstrap has only 27 possible resamples, and one storm is
  a single gauge for 21 h. Whatever item 3 returns is reported as **"on 3 storms, low power"**, in the result and in
  the scoreboard row, and is never cited alone as evidence about surge skill.
- Remaining before the owner's word: build the code (the owner's call), then send its head to the advisor with the
  21:30Z checklist.

## 20:58 EST 2026-11-16 (`date`) - G3 code built (owner, 18:23 EST: "Yes, build it"); nothing run on the window
- **Code:** `backend/scripts/tide_g3/`
  - `g3_metrics.py`: the pure rules (surge/calm hours on the pre-window-demeaned residual, storm grouping, paired
    block bootstrap on precomputed sums, items, controls, verdict, the datum label, the low-power label).
  - `g3_sources.py`: STOFS-2D and STOFS-3D as issued by lead; altimetry S1 with its preflight; GLO12 analysis;
    Open-Meteo previous runs.
  - `g3_gate.py`: runs the registered order (S1 preflight -> sources -> truth -> score) and reuses `tide_fes` for
    FES, CO-OPS and the NOAA-constants control.
- **Workflow:** `.github/workflows/tide-g3-gate.yml`.
  - The one-shot tag `tide-gate-G3` is the only start.
  - AVISO credentials are on the FES download step only; Copernicus credentials on the gate step only.
  - Pins: pyfes 2026.5.2, pyTMD 3.1.0, timescale 0.1.3, copernicusmarine 2.4.1.
  - FES caches are saved even on failure and pruned only after success.
  - The log carries stages and memory only.
- **Tests:** `tests/test_tide_g3_rules.py` (9; 19 with the G2 file), pinning:
  - storm linking;
  - the minimums;
  - bootstrap direction and identity;
  - verdict precedence;
  - the datum label;
  - the 24 h shift;
  - "a value at t for lead L never comes from a cycle issued after t - L";
  - the one-shot trigger, credential scoping and pins;
  - preflight before truth;
  - no score in the log;
  - the served backend never imports `tide_g3`.

  flake8 clean, sizes within cap.
- **Smoke tests: public data or credentials only, dates OUTSIDE the window, no truth, nothing scored:**
  - STOFS-2D swl as issued at 2 gauges for 2026-11-10: 13 of 13 cycles, all lead bins filled.
  - STOFS-3D-Atl: 4 of 4 Atlantic/Gulf test gauges matched within 3 km.
  - Open-Meteo previous runs: 72 h per lead bin at Honolulu. Boston's served 0.1 deg cell is land, as in G2.
  - Copernicus (run 43985791566 on the check branch, one gauge, Honolulu):
    - S1 preflight ok;
    - altimetry climatology from an offshore cell 14 km away, 366 day-of-year values;
    - GLO12 zos + inverse barometer analysis, 48 h read.
  - `score()` on SYNTHETIC data: runs end to end (its VOID there is an artefact of identical synthetic tides).
- **Known before any run:** the constant-non-tidal control (VOID if a constant non-tidal term ties the real one on the
  item-1 median) is strict. If STOFS's surge adds skill at only a few gauges, the run can come out VOID on it. That is
  the registered rule; it is written here so it is not a surprise.
- **Not done:** no run of the gate. The advisor reads the code head first; then the owner's word.

## 21:31 EST 2026-11-16 (`date`) - advisor read the G3 code (02:22Z): ACCEPTABLE against the registration; B done, A open
**Advisor:** "THE SIX CHECKLIST ITEMS HOLD ... ACCEPTABLE AGAINST THE REGISTRATION" at 7b454153c. Review only; nothing run.

**B - the armed smoke workflow (done).**
- Run 43985791566 (`tide-g3-cm-smoke.yml`, Copernicus credentials, ONE gauge, dates outside the window, no truth) was
  started by MY push to `claude/tide-m1-eot20-check` at 00:12Z, as part of building, under the owner's "Yes, build it"
  (18:23 EST). There was no separate word for that credentialed run. Recorded as such.
- Both check-branch workflows (`tide-g3-cm-smoke.yml`, `tide-eot20-convention.yml`) were then DELETED from that branch
  in a commit that starts nothing; the listing shows 0, and no new run started. No stray push can run them again.

**Labels for the result (added to the code; no rule changed):**
- The lead table carries: leads are by CYCLE time, not publication time, so the "0-24 h" bin includes forecasts 0-6 h
  old that a live product could not yet have had.
- `pip freeze --all` goes into the artifact (numpy, scipy, xarray, pandas and netCDF4 are unpinned).
- The result prints the gauges where S1 failed and how many count against P1 in item 2.
- The summary and artifact are public the moment the run ends: I read the verdict line first and tell the owner in
  this session; the advisor reads the log and the JSON before anything goes into a decision.

**A - two controls that can VOID for lack of power (OPEN; the owner's / director's decision, written BEFORE the run):**
- "Constant non-tidal loses item 1" reads the MEDIAN-gauge difference. With surge at about 9 of 26 gauges, the median
  can tie.
- "+24 h shift loses item 3" needs a lower bound above 0 from a bootstrap over 3 storms (27 resamples).
- **Option 1 - amend** (comes after the truth-only look; stated as such):
  - the constant control is read on POOLED squared error over all gauge-hours (gauge x 2-day blocks);
  - a failed shift control makes ITEM 3 inconclusive, not the run VOID;
  - the positive and label-swap controls stay VOID controls.
- **Option 2 - run as registered:** a VOID from either control is recorded as "no measurable effect of the non-tidal
  term on this window", with no re-run on it.

## 21:38 EST 2026-11-16 (`date`) - G3 AMENDMENT A: the two low-power controls (owner: "Amend them", 21:37 EST)
**This amendment comes AFTER the truth-only look at the window** (the surge-hour count, 16:2x-16:5x EST). It comes BEFORE
any arm has been computed on the window; no G3 gate run exists. It changes no threshold and no arm.
1. **"Constant non-tidal loses item 1"** is read on POOLED squared error over ALL gauge-hours (the arm minus its
   non-tidal term vs the real arm). Bootstrap units are gauge x 2-day blocks; 2000 draws, seed 20260825. It must lose:
   the interval of (constant - real) has its LOWER end > 0. A VOID from it still means the instrument shows no
   information in the non-tidal term. Before this amendment it read the median-gauge difference, which surge at only
   ~9 of 26 gauges could tie.
2. **"+24 h shift loses item 3"** is no longer a VOID control. If it fails (lower end not > 0, by storm), **ITEM 3 is
   INCONCLUSIVE**, treated exactly as "item 3 not runnable": G3 cannot PASS, and its verdict is INCONCLUSIVE. Items 1,
   2, 4 and 5 still report.
3. The positive control (NOAA's constants <= 0.01 m) and the label swap (> 0.3 m) STAY VOID controls, unchanged.

Advisor (02:22Z) found either choice acceptable "provided it says it comes after the truth-only look". The code follows
this entry, then goes to the advisor; then the owner's word for the run.

## 22:00 EST 2026-11-16 (`date`) - advisor: G3 ACCEPTABLE TO START at c26af8597 (02:56Z); no open point
- Possible results, fixed now: PASS, FAIL, INCONCLUSIVE (item 3 not runnable, or its shift check failed; the other
  items still report) or VOID (positive control, label swap, or the pooled constant control). Whatever it is stays
  recorded, and the window is spent either way.
- After the run: the verdict line goes first to the owner in this session. The advisor then reads the job log and the
  JSON and recomputes the medians from the per-gauge rows before any decision.
- The start is the owner's word typed in this session (tag `tide-gate-G3` on c26af8597).

## 22:16 EST 2026-11-16 (`date`) - G3 fix BEFORE any run: STOFS changed file format inside the pre-window
- **Found** (by reading only the first 4 bytes of each file, while checking the archive for G3b): STOFS-2D point files
  are **HDF5 / netCDF-4 through 2026-08-15** and **netCDF-3 from 2026-08-16** (all four cycles each side checked).
- **Effect on the code accepted at c26af8597:** its reader was netCDF-3 only. It would have silently dropped every
  pre-window cycle from 07-26 to 08-15 and built the registered 30-day swl reference from 9 days (08-16..08-24). That
  still clears the 60-hour minimum, so it would not have failed loudly.
- **Fix (plumbing; no rule, arm or threshold changed):** `g3_sources._nc_points` reads through the `netCDF4` library
  (already installed in the workflow), which reads both formats. Checked: a 2025-06-01 HDF5 file and a 2026-08-25
  netCDF-3 file each give all 5 test gauges, 1860 values each; the STOFS-3D file gives 3 of 3 gauges matched by
  lat/lon.
- **Reported (not gating):** the swl reference before and after 2026-08-16, per gauge, because a format change may
  mark a model upgrade. The registered reference stays the full 30 days.
- Tests: 20 pass; synthetic `score()` runs end to end.

## 22:24 EST 2026-11-16 (`date`) - G3b PRE-REGISTRATION DRAFT: the POWERED gate that decides serving (before G3's result exists)
Owner, 21:58 EST (relayed by the research lead and the director; to be confirmed in this session): "as long as its the
SOTA path". G3 runs as a PILOT only: 3 storms is low power, and its surge result does not decide serving. **G3b is
registered BEFORE G3 has run**, so no G3 number can shape it. It is a draft for the advisor's and the research lead's
read. Nothing is built or run before that, and the run is the owner's word typed in this session.

### Archive checks (done 22:0x EST; nothing scored, no truth fetched)
- **STOFS-2D point files** (\`points.swl/htp/cwl.nc\`) are present on every day checked: 2025-06-01, 09-01, 12-01 and
  2026-03-01.
  - **Format: HDF5 / netCDF-4 through 2026-08-15, netCDF-3 from 2026-08-16.** The G3 reader now handles both
    (32788fa95).
  - A 2025-06-01 file holds all 5 test gauges; all 26 are to be confirmed by the code's first stage.
- **Open-Meteo previous runs** (\`sea_level_height_msl_previous_day1/2\`) **begin 2025-11-19** (none on 2025-11-18, by
  bisection). The references C and D cannot be scored as forecasts before that date, which bounds the window's start.
- **CMEMS GLO12** keeps a sliding two-year analysis, so N1 stays an ANALYSIS upper bound, as in G3.

### Window (the director's frame 2025-06..2026-03, adjusted for the archives and the seen dates)
**2026-01-01 00Z .. 2026-07-24 23Z, hourly, MINUS 2026-03-15 .. 03-21 and 2026-06-15 .. 06-21.**
- **Start 2026-01-01, not 2025-06-01:**
  - C and D need Open-Meteo previous runs, which begin 2025-11-19.
  - Calendar 2025 is excluded as SEEN (P against CO-OPS predictions at all 26 gauges; arm B's evaluator identity at
    all 26).
  - Nov 19 .. Dec 31 2025 is also excluded with it, to keep the rule simple. That costs ~6 weeks.
- **End 2026-07-24:**
  - 2026-07-25 .. 09-08 is SEEN: G3's truth-only count read observed water from 07-25.
  - G3's window is 08-25 .. 09-07.
  - Later dates (G2, M1, #926's November windows) are seen too.
- **Holes:** the #926/#931 held-out weeks (7 days from 2026-03-15 and from 2026-06-15) are removed. The 2025-12-15 week
  is already outside the window.
- **Length:** about 7 months (~190 days after the holes), across winter and spring storm seasons on all coasts.

### Same as G3 (unchanged)
- Arms and leads as issued: P1 = A + S1 + N2_swl (primary; P1' = A + N2 by the S1 preflight); the same reported arms.
- **Cycles:** 00Z and 12Z only (halves a ~64 GB download), still "the latest cycle at or before t - L".
- **References:** C and D from Open-Meteo previous runs at the same leads.
- **Truth:** T2 OBSERVED water gates; T1 is reported.
- **Datum rule:**
  - S1 base 2016-01-01 .. 2025-12-31 (it ends before the window);
  - N2 / N3 referenced to their own mean over the 30 days before the window (2025-12-02 .. 12-31, from the 00Z
    nowcasts; HDF5 files);
  - N1 over the 365 days before;
  - D's mean over the 365 days before the window.
- Raw gates; mean-removed and bias/SD are reported; the datum label as in G3.
- **Pass lines (THRESHOLDS UNCHANGED from G3):**
  1. P1 - D upper end <= -0.02 m AND P1 - C upper end < 0 (paired per gauge).
  2. No gauge worse than D by > 0.05 m (point; a gauge P1 cannot score counts against it).
  3. Surge hours: P1 - A upper end < 0, resampled by STORM.
  4. Calm hours: P1 - A upper end <= +0.01 m.
  5. Tide shape: median High/Low time <= 20 min, median |MLLW err| <= 0.05 m.

### What differs from G3 (power, and the ORIGINAL strict controls)
- **Surge hours on a ROLLING reference.** Over 7 months a single pre-window mean would drift with the season and
  register seasonal level as surge. A surge hour is |residual - its own mean over the 30 days ending 24 h before that
  hour| > 0.15 m (residual = 25 h low-pass of observed - CO-OPS predictions). Calm hours: < 0.05 m on the same basis.
  Event = >= 12 consecutive hours; storm = same-region events that overlap or start within 48 h (single-linkage).
- **Minimum for item 3: >= 20 storms in >= 3 regions** (director and research lead), AND >= 48 surge hours on >= 5
  gauges. Below it, item 3 is NOT RUNNABLE and G3b is INCONCLUSIVE (it cannot PASS). **No truth-only count is taken
  before the run** (unlike G3), so the minimum is tested blind.
- **Bootstrap:** item 1 and the per-gauge CI vs D use gauge x 2-day blocks; items 3 and the shift control use a
  storm-block bootstrap (resampling storms). 2000 draws, seed 20260101.
- **Controls: the ORIGINAL strict set, all VOID-capable:**
  - positive (NOAA's constants <= 0.01 m);
  - label swap (> 0.3 m);
  - constant non-tidal must lose item 1 on the MEDIAN-gauge paired difference (lower end > 0);
  - +24 h shift must lose item 3 (lower end > 0, by storm).

  With ~7 months and >= 20 storms these have power; a VOID here means the instrument shows nothing.

### What a G3b PASS decides
The served tide for M1 (FES + S1 + STOFS surge, or P1' by availability) goes **DARK behind a kill switch** with a
SCOREBOARD row, and ships only on the owner's word. A FAIL or INCONCLUSIVE keeps today's tide. VOID is recorded; no
re-run on the window.

### Order relative to G3
1. This draft is pushed alone, BEFORE the G3 tag. G3's result cannot change it.
2. The advisor and the research lead read it.
3. G3 runs as a pilot (owner's word).
4. G3b code (G3 code parameterised by window, rolling surge reference, original controls), then the advisor, then the
   owner's word.

## 22:36 EST 2026-11-16 (`date`) - G3 PILOT STARTED on the owner's word (recorded before any output is opened)
- **Owner, typed in this session, 22:33 EST: "Yes, start G3".** G3 is a PILOT: 3 storms is low power, and serving is
  decided by G3b (registered as a draft at 9f01ca7eb BEFORE this start).
- Tag **`tide-gate-G3`** -> **9f01ca7eba3f26a21f7912131be05dbc1414fe53** (absent before; pushed 03:34:23Z). Its trigger
  is the tag only (checked). It carries the code of 32788fa95; only docs changed after it.
- Run **44011150843**, created 03:34:21Z.
- **Pending at start:** the advisor accepted c26af8597 (02:56Z); its re-check of the reader fix 32788fa95 (STOFS
  HDF5/netCDF-3) had not arrived. The owner chose to start; the fix is plumbing only, verified on real files of both
  formats.
- Reading order: verdict line first, to the owner in this session; then the run id, log and JSON to the advisor
  before any decision. Possible results: PASS / FAIL / INCONCLUSIVE / VOID, as fixed at 22:00 EST.

## 22:40 EST 2026-11-16 (`date`) - advisor (03:36Z) accepts 32788fa95; clearance carries; one outcome named (run in progress, NO output opened)
- **Advisor:** "ACCEPTABLE; my 02:56Z clearance to start on David's word CARRIES to this code". The tag sits on
  9f01ca7eb, whose `backend/scripts/tide_g3` and workflow are identical to 32788fa95 (checked before the push: no
  code diff). The messages crossed: run 44011150843 started at 03:34Z, two minutes before this read.
- **Named before any output is opened:** a large difference between the swl reference before and after 2026-08-16 (the
  reported per-gauge line) is called **"a datum finding on the surge reference: the STOFS format switch may mark a
  model change, so the registered 30-day reference straddles two models"**. It belongs to the same family as the named
  raw-FAIL-beside-mean-removed-PASS outcome and is NOT read as a failure of the non-tidal term. The reference is NOT
  switched after seeing it.
- **Cycle count:** the running code's stage line `stofs2d <kind>: N cycles` prints the total cycles read per kind
  (window + pre-window; ~70 window cycles + ~30 pre-window 00Z cycles expected, about 100). A count near 70 would mean
  the pre-window was not read. An explicit pre-window count per kind is added to G3b's code (it cannot go into a run
  already started).

## 22:42 EST 2026-11-16 (`date`) - G3b DRAFT addendum: the research lead's five edits (before any G3b code; G3 output not opened)
1. **What a G3b PASS decides (owner rule, 22:09 EST, relayed verbatim by the research lead and recorded as relayed:**
   "It needs to ship on, not off. With kill switch. I get confused and forget to turn things on once they are merged.
   Make special tests to test and kill switch it."; this matches D-065, "fixes ship ON, with guardrails"). A PASS means
   **the owner's word to MERGE, and the change ships ON by default with a kill switch**, plus kill-switch contract
   tests:
   - (a) switch OFF is byte-identical to the current tide path;
   - (b) switch ON changes only the tide fields;
   - (c) a runtime-manifest kill (`control/flags.json`) works with no deploy;
   - (d) the flag guardrail can auto-disable it;
   - (e) registry parity (`_RATING_FLAGS` / `test_flag_lane_parity`).

   This replaces "dark + kill switch".
2. **ONE primary arm, named now:** P1 = A + S1 + N2_swl (FES tide + altimetry seasonal + STOFS-2D surge). The fallback
   P1' = A + N2_swl applies ONLY by S1 preflight availability, decided before any truth is fetched. Every other arm is
   reported. No best-of-arms choice after scoring.
3. **The surge reference is CAUSAL:**
   - For each valid hour t, the reference is the mean of the residual over the trailing 30 days ending at t - 24 h,
     never centred and never containing t.
   - The residual is the 25 h low-pass of (CO-OPS observed - CO-OPS predictions) AT THE GAUGE.
   - No arm sees it: it is used only to classify surge and calm hours for items 3 and 4.
4. **Coverage assertion (so a silent reader failure cannot recur):**
   - Per gauge and per arm, the result prints hours read vs hours expected over the window, and for STOFS the
     pre-window cycles read per kind.
   - A gauge below **95%** coverage on P1, D or observed water is EXCLUDED from scoring and counted in the result.
   - **If more than 20% of gauges are excluded, the run is VOID.**
5. **Item 3 bootstrap is STRATIFIED BY REGION:** storms are resampled within each region (the region counts are kept),
   so one large Atlantic event cannot dominate. Shift control likewise. The 48 h single-linkage storm rule is
   unchanged.

Unchanged: the window (2026-01-01 .. 07-24 minus the held-out weeks), thresholds, the original strict controls,
>= 20 storms in >= 3 regions tested blind, and Open-Meteo previous runs for C and D. The draft goes to the advisor
with these edits; then code; then the owner's word.

## 22:52 EST 2026-11-16 (`date`) - G3b DRAFT addendum 2: the advisor's seven changes (03:46Z); #987 already merged
**#987** passed by the advisor (03:46Z, no open condition). It was already MERGED at 00:57Z (merge commit `ee0041370`)
by the director's sweep, so there was nothing for this lane to merge.

**G3b changes (before any G3b code; G3's output not opened):**
1. **Score only what could have been served.**
   - A cycle is AVAILABLE at the `LastModified` time of its `points.swl.nc` in the archive.
   - Measured on 10 cycles across the window (2026-01-10, 02-15, 04-01, 05-20, 07-10; 00Z and 12Z): published
     **6 h 29 m - 6 h 32 m** after the nominal cycle time, every time.
   - The value at valid hour t, lead L, comes from the latest cycle AVAILABLE at or before t - L; a missing timestamp
     falls back to a fixed 7 h delay.
   - C and D: Open-Meteo's previous_dayN runs have no archive timestamp, so they are scored with the same leads,
     reading previous_day1 as at least 24 h old; that this treats the references generously is stated.
   - The real age (hours since availability) of every value is printed per lead bin. With 00Z / 12Z cycles only, the
     bins are 12 h wide.
2. **What a PASS decides (restated under the owner's ship-ON rule; relayed via the research lead, 22:09 EST, and the
   director, 22:23 EST; CONFIRMED in this session below):**
   - A PASS means the owner's word to MERGE.
   - The change ships **ON by default** with a kill switch, plus CI tests that the kill restores the old behaviour
     byte for byte, plus the contract tests of addendum 1.
   - **Automatic trip:** if the newest STOFS cycle is missing or older than 18 h, the served level falls back to the
     tide alone (FES + S1) and the screen says so.
3. **Scope:**
   - A PASS licenses the water level on **US coasts as tested** (26 CO-OPS gauges).
   - Everywhere else it is UNVERIFIED and labelled so in the product until its own gate passes. Non-US
     fast-delivery gauges (UHSLC) are the planned rows of that later gate (with the spot-level gate).
4. **Storms cannot chain:**
   - Regions are the strata already used: Hawaii, Pacific, Atlantic, Gulf, PR, by station id.
   - A storm ENDS at the first 24 h with no surge hour at any gauge in the region, even when the 48 h single-linkage
     would link further.
5. **Constant control:** stays POOLED (gauge x 2-day blocks) as the VOID control; the median-gauge reading is
   REPORTED. This replaces the draft's "original" median-gauge control: "does the instrument see the non-tidal term at
   all" is a pooled question, and "does it help the typical gauge" is item 1's.
6. **N2's reference is ROLLING and causal:**
   - Primary: the mean of STOFS swl nowcasts over the 30 days ending at the cycle used (needs no truth; it is what a
     served product can compute).
   - The fixed 2025-12-02 .. 12-31 reference is reported.
7. **What the pilot may change:** G3b may be amended after G3, each amendment labelled **POST-PILOT** with the G3 fact
   that prompted it, and only before any G3b data (truth or arm) is fetched. **The thresholds and the primary arm do
   not move.**

**Smaller points:**
- D may be in-sample on parts of this window if #926 was tuned on observed water there; that only makes the gate
  harder, and it is stated.
- Truth is fetched last, as in G3.
- Real lead ages are printed.

## 22:58 EST 2026-11-16 (`date`) - OWNER CONFIRMS the ship-ON rule for a G3b PASS, in this session
- **Owner, typed in this session, 22:57 EST: "Yes, ship ON"**, answering: "if G3b passes, the new tide ships ON by default
  with a kill switch once you approve the merge?"
- **G3b addendum 2, item 2, is confirmed (no longer only relayed):** a PASS means the owner's word to MERGE, and the
  change ships ON by default with a kill switch, CI kill-switch contract tests, and the automatic fall-back to the tide
  alone when STOFS is missing or stale.

## 23:13 EST 2026-11-16 (`date`) - the TRUE ORDER around the G3 start (advisor 04:13Z); G3b draft has no open point from the advisor
**What happened, in order (UTC):**
- ~03:31Z: I asked the advisor to read the reader fix (32788fa95) "before the G3 start".
- 03:33Z (22:33 EST): the owner said "Yes, start G3".
- 03:34:23Z: I pushed the tag; run 44011150843 was created at 03:34:21Z.
- 03:36Z: the advisor accepted the fix; its clearance carries.

**So the start came two minutes BEFORE the read it was waiting for.** The code is byte-identical to the accepted code
(the advisor verified it), and the advisor's earlier clearance (c26af8597) predated the fix. The log line "advisor
accepts the reader fix (clearance carries)" (37763ad0e) sits AFTER the start.

**Consequences:**
- **The pre-window-cycles stage line is not in the running code.** The count is taken instead from the result's own
  fields: `stofs2d <kind>: N cycles` in the stage log (~100 expected per kind; ~70 would mean the pre-window was not
  read), and the before/after-08-16 reference line (a missing "before" value means those cycles were not read).
- **The naming of the swl before/after difference** (37763ad0e, 03:40Z) came AFTER the start but BEFORE any execution:
  the advisor saw the run still QUEUED at 04:13Z (Actions backlog). It therefore stands as written "before any result".

**G3b DRAFT (64772904a + owner confirmation 316e3e8e7):** the advisor reports NO OPEN POINT. It becomes FINAL with the
research lead's read, and then the code goes to the advisor before any G3b data is fetched. One addition for the final
text: the **18 h trip is intended as "one missed cycle"**. With a 6.5 h publication delay and 6-hourly cycles, the
normal age tops out near 12.5 h. The CI test covers the trip itself (stale STOFS input gives the tide-only level and
the on-screen words), not only the manual kill.

**#987** merged at 00:57Z (director's sweep), ~3 h BEFORE the advisor's pass at 03:46Z. The pass found nothing wrong;
the advisor is raising the merge-before-verdict with the director.

## 03:33 EST 2026-11-17 (`date`) - G3 pilot run 44011150843: CRASHED in the gate step - NO verdict, window still unseen
- **Job 06:10-08:29Z.** The FES download succeeded (2 h 16 m) and its cache is saved under the tag.
- **The gate step aborted at 08:29:06Z** with exit 134 and **"double free or corruption (out)"**. Last stage lines:
  "s1 preflight ok -> primary P1", "fes subset", "arm A". The crash came in the STOFS fetch that follows.
- The artifact holds an EMPTY `g3_gate.json` and `pip_freeze.txt`. **No score and no truth were fetched** (truth is
  fetched last), so the window is NOT seen. The S1 preflight passed (primary P1), and that choice is mechanical.
- **Cause:** my reader fix (32788fa95) moved STOFS reads to netCDF4/HDF5, which is not thread-safe in the Linux wheel.
  The fetch reads files in 6 threads, and the pre-window cycles are HDF5. Windows did not reproduce it (12/12 HDF5
  cycles read in 6 threads), because thread safety is build-dependent.
- **Fix (plumbing; no rule, arm, threshold or trigger changed):**
  - every station-file read now holds one lock (`g3_sources._NC_LOCK`); downloads stay parallel;
  - the S1 and N1 Copernicus loops, which also open netCDF through xarray, now run serially (1 worker);
  - test `test_netcdf_reads_are_serialised_across_fetch_threads`; 21 pass.
- A re-run needs the tag moved (deleted and pushed again) on the owner's word. The tag's FES cache makes the download
  step quick.

## 03:38 EST 2026-11-17 (`date`) - run 44011150843 recorded as NO VERDICT; advisor's clearance carries to the fix (08:39Z); time check
- **Name: NO VERDICT (not VOID).** Run 44011150843 is never counted as a look. The advisor read the job log through
  the API, and so did I (nothing downloaded beyond the empty artifact).
  - **The stage lines read by both:** "stage start" (42 MB); "s1 preflight ok -> primary P1" (318 MB); "fes subset"
    (382 MB); "arm A" (564 MB); then "double free or corruption (out)", exit 134.
  - No STOFS, reference, truth or "scored" stage. No score-shaped text; only the two masked credential env lines.
  - **No truth and no reference was fetched: the window is unseen.**
- **Advisor (08:39Z):** "YES, MY CLEARANCE CARRIES" to 323b3b36f (one lock around every station-file read, the two
  Copernicus loops serial, one test, the floor; no rule, arm, threshold or trigger changed).
- **(a) Lock coverage, checked in the code:**
  - The STOFS-2D fetch (6 threads) and the STOFS-3D fetch (4 threads) both read through `g3_sources._nc_points`,
    which holds `_NC_LOCK`.
  - The only other netCDF opens in the gate are `xr.open_dataset` in S1 and N1, now serial (1 worker).
  - The one other thread pool is the FES AVISO SFTP download (`tide_fes.sources.download_fes`), which opens no netCDF.
  - FES subsetting is serial.
- **(b) The FES cache:** saved under the tag's ref (`fes2022b-g3-44011150843`). A moved tag keeps the same ref name,
  so the restore should hit and the download step should be quick. If the restore misses, the step downloads again
  (~2 h 16 m), which is not a reason to stop.
- **Time check (advisor):** measured on the Honolulu smoke run (43985791566): S1 ~10 s/gauge (two altimetry subsets,
  ~3-4 s each, plus overhead); N1 ~10 s over 2 days, allowing 10-30 s for G3's full year.
  - S1 + N1 serial x 26 gauges ~ 10-20 min.
  - STOFS ~300 files of ~25 MB with locked reads ~ 10 min.
  - STOFS-3D, references and truth (with retries) ~ 10 min.
  - Bootstraps a few minutes.
  - **Estimate ~45 min.** The gate step's timeout is raised from 120 to **180 min** in the same commit (plumbing; the
    trigger block is untouched). A cache miss (2 h 16 m) + 180 min still fits the 355 min job limit.

## 08:43 EST 2026-11-17 (`date`) - G3 PILOT RE-RUN on the owner's word (recorded before any output is opened)
- **Owner, typed in this session, 08:36 EST: "Yes, re-run G3".** Advisor (08:41Z): clearance carries to 4815f4eee.
- **The previous run produced nothing:** 44011150843 was NO VERDICT (aborted before any STOFS, reference or truth
  stage; the window is unseen).
- `tide-gate-G3` was deleted on the remote and re-created on **4815f4eee4472818c207c90537f21d93e3746f7f** (pushed
  13:39:55Z). Checked before the push: the branch head IS that commit, its trigger is the tag only, and the gate step
  has 180 min.
- Run **44094955892**, created 13:39:43Z.
- Reading order as fixed: verdict line to the owner first, then the run id to the advisor, who reads the log and the
  JSON and recomputes before any decision. If it aborts before the truth stage, it is NO VERDICT again, with the stage
  lines.

## 09:33 EST 2026-11-17 (`date`) - G3 PILOT RESULT, run 44094955892 at 4815f4eee: **VOID** (the pooled constant-non-tidal control)
Job 13:39-14:26Z; gate step 45 min; peak RSS 7907 MB; the FES cache restored. The artifact copy is in notes
`tide-overlay-2026-11-15/g3-result-run-44094955892.json`. Primary P1 (the S1 preflight passed).
**Read in the fixed order: controls first. VOID means nothing else in the output is quoted.**
- Positive control (NOAA's constants): **0.0015 m**, behaved.
- Label swap: **0.540 m**, behaved.
- **Pooled constant-non-tidal control: FAILED.**
  - Constant minus real = **-0.0369 m** (95% interval -0.0481 .. -0.0258).
  - The arm with the STOFS non-tidal term REPLACED by its pre-window mean (zero) was BETTER pooled over all gauge-hours
    than P1 with the term. The control needs the real term to win (lower end > 0); the interval lies wholly the other
    way.
- Item 3 status: "inconclusive: shift check failed". The shift-minus-real interval spans zero (-0.0257 .. +0.0089).
  4 storms.

**The record:**
- G3 (pilot) is VOID.
- On this window, the STOFS-2D swl term, as the registration defines and references it, degraded P1 against observed
  water instead of adding information.
- Not interpreted further before the advisor's read; the window is spent.
- Any G3b change it prompts is a POST-PILOT amendment, labelled with this fact, made before any G3b data, with
  thresholds and the primary unmoved.

## 09:48 EST 2026-11-17 (`date`) - G3 pilot: advisor read (14:44Z); a DATUM FINDING ON THE SURGE REFERENCE, confirmed by NOAA's own notice
- **Advisor (14:44Z) read and recomputed** from my JSON copy:
  - median of the 24 per-gauge P1 - D differences = -0.0756 m;
  - one gauge over the item-2 limit (8722670, +0.070 m);
  - "VERDICT AS REGISTERED: VOID".
- **Named outcome (written before the run executed, 37763ad0e): "a datum finding on the surge reference".**
  - The STOFS swl reference stepped at 2026-08-16: median -0.03 m before, +0.16 m after (median step +0.21 m, range
    -0.12 .. +0.36).
  - The window lies wholly after the step; the 30-day reference lies mostly before it.
  - The primary's median bias is +0.080 m, against -0.013 m for tide + seasonal alone.
  - The level-free variant (cwl - htp) has bias -0.003 m and the lowest error of any model arm (0.090 vs 0.104 for
    A+S1 and 0.114 for P1).
  - Not shown: that surge adds skill in time (median error SD 0.064 m with and without it).
- **NOAA's own record** (SCN 26-51 Updated, issued 2026-07-08):
  - "Upgrade of the Surge and Tide Operational Forecast System (STOFS) to Version 3.1 Effective Aug 11, 2026",
    beginning with the 12Z cycle. The archive's format switch on 2026-08-16 is the deployment.
  - For STOFS-2D-Global: "Station netCDF output will now be referenced to local mean sea level (LMSL) (no longer
    NAVD88)". The point files the gate reads CHANGED VERTICAL DATUM, which accounts for the step.
  - Also: "a gridded bias correction" that extends the existing station bias correction, which "removes the bias
    between the observed water levels at NOS/CO-OPS stations and most recent 5 days of" model nowcast. So STOFS
    station output is partly corrected with the same gauges we score against. Its skill at gauges likely overstates
    its skill away from them.
- **Discrepancy 1, storm count (4 in the result vs 3 in the truth-only count):**
  - Both run the same rule (overlap OR start within 48 h). The truth series differed slightly between the two fetches.
  - At 8723214 the count saw two events (09-02T02 26 h, 09-03T11 20 h) and the gate one run (66 surge hours).
  - The count's second start was 47 h before the next Atlantic event (linked); the gate's single start was 80 h before
    it (not linked).
  - Start-to-start linking is fragile when events merge. G3b's added rule (a storm ends at the first 24 h with no
    surge hour in the region) removes the sensitivity.
- **Discrepancy 2, 24 paired gauges, not 26:**
  - Boston 8443970: its served 0.1 deg Open-Meteo cell is land, so D and C are undefined (as in G2).
  - Galveston 8771510: its cell HAS data (checked 2026-09-01: 24 values), so it dropped through the run's Open-Meteo
    timeouts (8 logged).
  - Neither counted against P1 in item 2, since D was undefined at both.
- **G3b - an open decision for the research lead, the director and the owner (no G3b data fetched):**
  - G3b's window (2026-01-01 .. 07-24) is entirely STOFS **v2.1**, so there is no step inside it (path (a) is safe in
    that narrow sense).
  - But the product that would be SERVED runs **v3.1** (new station datum, gridded bias correction). A G3b PASS would
    certify a retired version.
  - Unseen v3.1 dates are fragments of ~2 weeks (since 08-16, outside the seen list), far below >= 20 storms.
  - Options:
    - (i) G3b on v2.1 as registered, plus a v3.1 confirmation later;
    - (ii) a PROSPECTIVE G3b on v3.1 from now on (truly unseen, live as issued, months for storms);
    - (iii) re-register the primary level-free (cwl - htp), the advisor's path (b).

## 10:01 EST 2026-11-17 (`date`) - OWNER DECISION: G3b becomes a PROSPECTIVE test on STOFS v3.1 (DRAFT amendment, no data fetched)
**Owner, typed in this session at 09:59 EST: "Prospective v3.1 test".** This supersedes the 2026-11-16 G3b window
(2026-01-01 .. 07-24, STOFS v2.1). The reason is in the entry above: serving would run v3.1, and a pass on v2.1 would
certify a retired version. The thresholds, pass lines and controls of the G3b draft are unchanged except as listed here.
This is a DRAFT for the research lead's and the advisor's read; it becomes FINAL only on their read, and the run is the
owner's word typed in this session.

### What changes
- **Window: prospective.** It starts at the first 00Z cycle at least 24 h after the commit that makes this FINAL. It ends at
  **2027-03-31 23Z**, which covers the US winter storm season on every coast. No forecast or truth inside the window is read
  before the end, except under the truth-only counting rule below.
  - The STOFS point files stay on noaa-gestofs-pds, so "as issued" is fetched after the end from the archive. Each cycle is
    used at the availability time it had (S3 LastModified, ~6.5 h after the cycle), not at the cycle time.
- **Primary: level-free (stated plainly as post-pilot).** P1 = A + S1 + N2' with N2' = (cwl - htp), the STOFS non-tidal
  part. Its own level is removed causally: the mean over the 30 days ending 24 h before the forecast's availability time.
  - N2 (swl, the v3.1 LMSL level) is REPORTED and never gates. P1' = A + N2' if the S1 preflight fails.
  - The constant non-tidal control, the label swap, the positive control and the +24 h shift control keep the G3b form.
- **Version guard:** the window is defined by STOFS-2D-Global v3.1. Any later NOAA notice (SCN) that changes STOFS-2D
  station output, its datum or its bias correction ENDS the window at that change's first cycle. If the storm minimum is
  then unmet, the result is INCONCLUSIVE; a new window needs a new registration.
- **Truth-only storm count (allowed, with limits).** At most once a month, observed water and CO-OPS predictions alone may
  be fetched to count storms, under the G3b rules: rolling reference, events >= 12 h, storms ending at the first 24 h with
  no surge hour in the region.
  - No arm, forecast or reference value is fetched or scored in a count, and the count is logged.
  - **It cannot end the window early**: the end date is fixed.
  - If >= 20 storms in >= 3 regions are not met by 2027-03-31, the gate is INCONCLUSIVE, and an extension needs a
    registered amendment written before any arm data.
- **Independence caveat (reported, not gated):** STOFS bias-corrects against observed CO-OPS water over the last 5 days
  (station correction, plus the v3.1 gridded correction on the open boundaries). That is the same network we score
  against, so the gate measures skill AT gauges.
  - The spot-level gate (UHSLC and other non-CO-OPS gauges) is the independent check before any claim away from gauges.
  - Leads are counted from availability time, so the correction uses only data a live product would have had.
- **References C and D** (Open-Meteo previous runs, test only) as in G3b, at the same availability-based leads.
- **Seen list:** every date up to the FINAL commit is seen, so the window is wholly unseen by construction.

### Retrospective v2.1 run (Jan .. Jul 2026): supporting evidence only
It may run under the G3b draft as registered. It is labelled "v2.1 retrospective", it cannot PASS or FAIL serving, and it
is not a look at the prospective window. The research lead to say whether it is worth its ~64 GB of downloads.

### What a PASS decides (unchanged from the owner's "Yes, ship ON")
- On the owner's word to merge, the served tide ships ON by default behind a kill switch, with a SCOREBOARD row.
- Contract tests come with it, plus an auto-trip when STOFS is more than 18 h old.
- FAIL or INCONCLUSIVE keeps today's tide. VOID is recorded, with no re-run on the window.

### Meanwhile (no gate data)
- The code (G3 parameterised: availability leads, a causal rolling reference, the version guard, the 18 h auto-trip test)
  can be built and reviewed now.
- The served path can be built DARK, behind its flag, so a PASS turns into a merge without new code.

## 10:20 EST 2026-11-17 (`date`) - Advisor read of the prospective draft (15:16Z): the level-free primary is WITHDRAWN; an independence question; a proposed SPLIT
- **Option (b), the level-free primary, is WITHDRAWN by the advisor, and the 10:01 draft's primary is therefore NOT
  proposed for FINAL.**
  - Reason: STOFS station output is bias-corrected against OBSERVED CO-OPS water over the last 5 nowcast days, so at a
    CO-OPS gauge the combined level partly contains the truth.
  - cwl - htp would carry that correction. Its pilot result (bias -0.003 m, lowest error) is what truth leaking in looks
    like, close in kind to the "yesterday's residual" yardstick (0.039 m). It is not evidence of surge skill.
  - The station correction already existed in v2.1, so the same doubt applies to the pilot and to any v2.1 retrospective.
- **Independence.** A surge gate scored at CO-OPS gauges, on output corrected with CO-OPS gauges, measures skill at
  CORRECTED STATIONS. The served value is at surf spots, away from gauges.
  - Before any surge gate is registered again, settle from documents (no data) which products carry the correction and
    which stations feed it.
  - Then take truth from gauges OUTSIDE that set (other agencies, island networks such as UHSLC), or score the gridded
    field and say plainly what the gate cannot certify.
- **Documentary check, done now (no data):** the NCEP STOFS-2D-Global portal (polar.ncep.noaa.gov/estofs/glo.htm) says:
  - The station correction "corrects the station water level forecast guidance biases by removing the bias between the
    observed water levels at NOS/CO-OPS stations and most recent 5 days of nowcast water levels".
  - In v3.1 it is "propagated across the entire global grid using a graph diffusion approach. The result is that both
    station and gridded output is bias corrected." Feeding stations named: NOS/CO-OPS only.
  - **Operational date: the 12 UTC cycle on 2026-08-17** (the notice planned Aug 11; the archive's file format switched
    08-16).
  - NOT stated anywhere found: WHICH variable carries the correction (swl, cwl or both; htp is harmonic prediction only),
    and whether any non-CO-OPS gauge feeds it.
  - The noaa-gestofs-pds README defines cwl = tides + surge, htp = harmonic tides, swl = surge only. Point/GRIB2 water
    levels are in "m, MSL" and SHEF files in MLLW, with no word on bias correction.
  - Consequence: since v3.1, the GRIDDED field is corrected too, so scoring the grid near a CO-OPS gauge is not
    independent either. Independence needs gauges far from (or outside) the CO-OPS network.
- **The advisor's proposal, for the research lead, the director and the owner:** SPLIT THE QUESTION.
  1. **Tide + seasonal (A + S1), NO surge, its own RETROSPECTIVE gate now** on the untouched 2026-01-01 .. 07-24 window
     (minus the held-out weeks).
     - It is a new registration with A + S1 as primary, chosen after the pilot and saying so; the datum and per-gauge
       rules are carried over.
     - It needs no surge archive and depends on nothing NOAA can re-version. In the pilot it halved the error and beat
       both references.
     - A PASS ships ON under D-080 in weeks.
  2. **Surge: its own PROSPECTIVE gate on v3.1**, registered before any truth, with the independence question settled
     first (truth gauges outside the CO-OPS set, or the gridded field with its limits stated).
     - Archiving as-issued cycles now (no truth, no scoring) is collection, not a look.
     - Note: noaa-gestofs-pds held files back to at least 2025-06-01 on checks, so the archive may already persist. A
       mirror is insurance, not a need.
  - Using Jan .. Jul 2026 for gate 1 spends that window for surge, which is fine if surge goes prospective.
- **The advisor accepts both discrepancy answers** (storm count; Boston and Galveston).
- **Standing:** no G3b data, truth or arm, is fetched until this is decided and written. The decision belongs to the
  research lead, the director and David.

## 10:25 EST 2026-11-17 (`date`) - Advisor read (15:25Z) of 79ef6f014 + 95c2c5409: the surge draft is NOT ready for FINAL; conditions for its replacement
- The advisor confirms both entries are accurate. The owner's 09:59 choice was typed in this session and recorded here (the
  advisor did not witness it).
- **The 10:01 draft does not go FINAL:** its primary is withdrawn, and the truth set is undecided.
- **Conditions for whichever surge registration replaces it:**
  1. **Monthly truth-only storm count: acceptable**, with four limits:
     - it prints a storm count per region and nothing else, and its script is committed with its hash before the first
       count;
     - no rule (thresholds, storm definition, minimum, gauge list) changes after ANY count; a change is a new registration;
     - the session that runs a count fetches no forecast, arm or reference, and says so in the log;
     - an extension past 2027-03-31 is decided from the count alone and registered before any arm data.
  2. **S3 LastModified as the lead clock: sound only if recorded AS IT HAPPENS.** A re-upload would move LastModified and may
     change the content.
     - Fix: a scheduled job that only LISTS the bucket (no file read, no truth) and logs, per cycle's point files, the first
       time seen, LastModified, size and ETag.
     - At the end, a cycle whose ETag or size changed is excluded and counted.
     - This is collection, not a look. It needs a scheduled workflow, so it needs the owner's word.
  3. **Truth set:** with the grid corrected too, a CO-OPS gauge is never independent truth for a v3.1 surge arm. Either:
     - the GATING truth is non-CO-OPS gauges, with CO-OPS reported only; or
     - the PASS line says in words that it certifies skill at corrected stations only and licenses nothing away from them.
  4. A version-guard trip is decided from a NOAA notice's date, never from looking at data.
  5. Open-Meteo references have no issue timestamps; keep that stated.
  6. **Correction to my 10:01 entry:** under D-080 nothing MERGES dark. The served path is built on a branch and merged only
     after a PASS.
- **The advisor's proposed order** (for the research lead, the director and the owner):
  1. register the tide + seasonal gate first, which needs none of this;
  2. start the listing job;
  3. settle the surge truth set from documents;
  4. register the surge gate.

  Nothing in Jan .. Jul 2026 is fetched until the first registration is FINAL.

## 10:34 EST 2026-11-17 (`date`) - Research lead's read (10:40 EST log on #985): independent truth exists on surf beaches
- **The research lead verified SCN 26-51 from its PDF:** effective 2026-08-11 12Z; the bias correction uses observed water at
  NOS/CO-OPS stations over the last 5 days, so CO-OPS scoring is contaminated.
  - Their extraction did not surface the LMSL sentence; they rely on this log and the advisor for it.
  - The NCEP portal gives the operational date as 2026-08-17 12Z. Both dates are recorded; the window logic does not depend
    on which is right.
- **New finding: about 60 non-CO-OPS water-level gauges on erddap.sensors.ioos.us, mostly Hohonu, ON SURF BEACHES.**
  - NC: Duck, Surf City, Topsail, Emerald Isle, Ocean Isle, Holden, Bald Head.
  - SC: Kiawah, Isle of Palms, Folly, Edisto, Hilton Head.
  - FL: Fernandina, Sanibel, Captiva, John's Pass, Mexico Beach, Dania.
  - IOC/UHSLC island gauges are the wrong population; these are the right one.
- **The research lead's recommended path (the decision is the director's and David's):**
  1. Close G3 as VOID.
  2. Run G3b on v2.1 as registered, as supporting evidence only.
  3. Register a prospective G3c on v3.1 now:
     - level-free primary (A + S1 + cwl - htp);
     - PRIMARY truth = the independent IOOS beach gauges, de-meaned over a pre-window period, with QC and coverage rules
       (watch for decommissioned ones);
     - CO-OPS gauges as a near-gauge upper bound, by distance and lead;
     - the window starts strictly after registration and runs >= 12 months for bulk skill;
     - storm claims rest on a pre-registered, event-based power calculation, with G3b errors as the surrogate;
     - FIRST confirm that the STOFS correction uses only CO-OPS stations.
  4. The persistence blend is a separate gate: e-foldings fitted on TRAIN at independent gauges, freshness defined by
     latency. Real-time Hohonu data makes an at-spot nowcast possible.
- **Reconciling this with the advisor (my reading, for them to confirm):**
  - The advisor withdrew the level-free primary because CO-OPS TRUTH leaks into it, not because the arm is invalid.
  - Scored on gauges that do NOT feed the correction, cwl - htp is a fair as-issued arm: the CO-OPS-based correction is
    information a live product would have, so it is skill, not leakage. The withdrawal and the research lead's primary are
    compatible once the truth set is independent.
  - The remaining difference is how to use Jan .. Jul 2026:
    - the advisor proposes a tide + seasonal gate (no STOFS) that can ship in weeks;
    - the research lead proposes G3b v2.1 as supporting evidence.
  - A G3b v2.1 scored at CO-OPS gauges carries the same station-correction doubt, so its value as evidence for surge is
    small.
  - The tide + seasonal gate can be scored at CO-OPS gauges: no surge arm, so no leakage. It can also be scored at the
    beach gauges where they have pre-window data.
  - Both uses can't take the same unseen window cleanly; the choice is the owner's.

## 10:41 EST 2026-11-17 (`date`) - Research lead AGREES with the advisor's split: the reviewers converge (owner's word pending)
The research lead's later message supersedes their earlier path (it now drops the G3b v2.1 run):
1. **Tide + seasonal (A + S1): a RETROSPECTIVE gate now** on the untouched 2026-01-01 .. 07-24 window (minus the held-out
   weeks), labelled "chosen post-pilot". It ships ON under D-080 if it passes.
2. **Surge: PROSPECTIVE on v3.1, after independence is settled.**
   - Truth: the ~60 non-CO-OPS IOOS beach gauges (mostly Hohonu). Because v3.1 diffuses the correction across the grid, the
     gauges are STRATIFIED by distance to the nearest CO-OPS station, and the FAR stratum is primary.
   - Each gauge is de-meaned on a pre-window period, with QC and coverage rules (several are decommissioned).
   - The end is >= 12 months from the start, not 2027-03-31. Storm claims need pooled-event power; otherwise INCONCLUSIVE.
3. **The G3b v2.1 retrospective (~64 GB): SKIP.** CO-OPS scoring is contaminated, and v2.1 is not what would be served.
4. **The level-free primary stays withdrawn**, as the advisor said; the surge primary will be re-chosen when the surge gate is
   registered. My 10:34 reconciliation (cwl - htp fair at non-feeding gauges) stands as a question for that registration,
   not as a choice.

**Status:**
- The advisor and the research lead both recommend the split; the owner's word is pending.
- Order (the advisor's):
  1. tide + seasonal registration DRAFT, then both reads, then FINAL;
  2. the bucket-listing job (owner's word: a scheduled workflow);
  3. confirm from documents that only CO-OPS feeds the correction, and draw up the surge truth set;
  4. surge registration.
- No data has been fetched.
