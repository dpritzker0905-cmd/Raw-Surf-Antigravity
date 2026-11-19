# 2026-11-18 — Gust verification: a running, multi-week check of the live GFS / EURO / ICON gust sets (session gust-verify, Opus)

Asked by the director (local_d6b521eb), relaying David's accepted SOTA path for the Gusts layer (switched on 2026-11-18, pilots run
44325777889): verify gusts against buoy observations over weeks and at every lead, beat simple baselines, and only then correct a
per-model bias or weight a consensus by measured skill. Currents vs HF radar is the next step and not this session's job.
Prior one-off check: `2026-11-15-opus-gusts-currents.md` §6b (method) and §7c (results: 552 stations, ~3 days, leads <= 80 h EURO
and <= 26 h ICON; overall bias GFS +0.02, EURO +1.80, ICON +1.09 m/s; equal MAE within 0.03 m/s on 4,242 same pairs).

## 1. PRE-REGISTERED METHOD (written 2026-11-18, before the collector existed and before any pair below was computed)

Nothing in this section is edited after results exist; changes are appended as dated amendments.

**What is scored.** Each model's gust field exactly as the map's frame sets build it: the collector calls the publisher's own
source classes (`frame_set_raster.SPECS["gust"|"gust_euro"|"gust_icon"]` through `make_source`), so the GFS and EURO values are the
GRIB points of the 0.25-degree lattice and the ICON value is the nearest native cell to the lattice node (the publisher's
`IconGridSource` pick). The frames equal these to 0.005 kn (prior log §5 / §7a). Each station is scored at the lattice node
nearest it (row = round((lat + 90) / 0.25), column = round(((lon + 180) mod 360) / 0.25)), as before.

**Cycles and steps.** The 00Z cycle of each model, once a day. Every 3 h: GFS f000..f240, EURO f003..f144 and f150..f240 every
6 h (its open-data steps), ICON f003..f180. EURO's message window is checked, not assumed: the step must carry the stepRange
`(f - w)-f` with w = 1 h to f090, 3 h to f144, 6 h after (decoded 2026-11-15); ICON's VMAX_10M window is 1 h to f078 and 3 h
after (its output interval). A step whose message is missing or carries another window is dropped and listed, never filled.
Also stored per step: each model's own 10 m wind speed at the same node and step (GFS UGRD/VGRD 10 m, EURO 10u/10v, ICON
U_10M/V_10M, the same pick), for baseline (a).

**Observations.** NDBC standard meteorological `GST` (the peak 5 or 8 s gust in the station's sampling period) and `WSPD`, from
every station in NDBC `latest_obs.txt` reporting a numeric GST between 60S and 65N on the day the list is frozen (no
hand-picking; the list and each station's metadata are stored). Collected daily from the 5-day files (`data/5day2/<id>_5day.txt`;
the 45-day `realtime2` files for a backfill). Hourly observation at hour H = the report nearest H within +-10 min.

**Matching** (the §6b rule, unchanged): GFS (instantaneous) at valid hour V pairs with the hourly observation at V. EURO and ICON
(window maxima over w hours ending at V) pair with the MAX of the hourly observations at V-w+1 .. V, all w present.
Secondary (sensitivity, reported, never used for a decision): the DENSE window maximum, the max of every report in (V-w, V] at
stations reporting at least 5 per hour, which samples ~5/6 of each hour instead of one ~8-min period per hour. Its gap to the
primary bounds how much of a window model's positive bias is the observation's sparse sampling rather than the model.

**Anemometer height: scored both ways, the gap reported.** RAW = the observation as reported (~3.8-5 m on buoys, up to ~30 m
on C-MAN and coastal stations). ADJUSTED = the observation scaled to 10 m by the neutral log law
`U10 = Uz * ln(10 / z0) / ln(z / z0)`, z0 = 0.0002 m (open sea), z = site elevation + anemometer height from NDBC
`metadata/stationmetadata.xml` (the current history entry). The same factor is applied to GST and WSPD. Stations without
metadata are scored RAW only and counted. Stated caveat: over a land-sea coast z0 is larger, so coastal stations are adjusted
too little; the land / sea flag below separates them.

**Lead bins:** 0-23, 24-47, 48-71, 72-119, 120-240 h (EURO to 240, ICON to 180, GFS to 240).

**Metrics per model x lead bin, RAW and ADJUSTED:** n, bias (forecast - observed), MAE, RMSE; for gusts >= 15 m/s the hit rate
(POD = hits / (hits + misses)) and false-alarm ratio (FAR = false alarms / (hits + false alarms)). **Same pairs:** the three
models scored on the station-valid-hours all three cover in the same lead bin (each against its own observation definition).
**Uncertainty:** 95% interval of the bias by a cycle bootstrap (resample whole cycles with replacement, 1,000 draws, seed 0);
pairs inside a cycle are autocorrelated, cycles far less so. **Split:** land vs sea node (GFS `LAND` at f000 on the day the list
is frozen), reported beside the pooled rows.

**Baselines, scored on the same pairs (a model must beat both on MAE in a bin to claim skill there):**
- (a) GUST FACTOR: forecast 10 m wind speed (the same model, node and step) x **1.40**, fixed now.
- (b) PERSISTENCE: the latest observed gust at the cycle's analysis time t0, by the same observation definition (GFS: the hourly
  observation at t0; EURO / ICON: the max of the w hourly observations ending at t0). Lenient on purpose: an observation at t0
  is not in hand when the run is issued.

**Controls (both required; a failed control voids the run's table until explained):**
- NULL: each model's forecasts shuffled in time within each station (a seeded permutation across that station's valid hours in
  the lead bin) must score clearly worse: pooled MAE per model at least **10% higher** than the real pooled MAE.
- POSITIVE: the observations scored against themselves plus Gaussian noise (sigma 1.0 m/s, seed 1, no clamping) must give
  bias within +-0.05, MAE within 0.798 +- 0.03 (sigma x sqrt(2/pi)) and RMSE within 1.00 +- 0.03 m/s (n >= 1,000).

**Decision rule for a correction (proposal only; built only after the multi-week data supports it).** A per-model, per-lead-bin
additive gust correction is proposed only if ALL hold for that model x bin: (1) at least 14 distinct cycles; (2) the ADJUSTED
bias's 95% cycle-bootstrap interval excludes 0 and |bias| >= 0.5 m/s; (3) the RAW bias has the same sign; (4) STEADY: the bias
has the same sign and is >= 0.25 m/s in magnitude in each half of the period (cycles split by date); (5) out of sample: the
first half's bias, subtracted from the second half's forecasts, lowers the second half's MAE. A bias that the DENSE sensitivity
erases is a sampling artefact and gets no correction. Anything from fewer than 14 cycles (the first scoring included) is recorded,
not acted on (n ~ 1 period). If built: ON by default with a kill switch (a frame-publisher repo variable, since it changes the
served gust frames), a `SCOREBOARD.md` row, and the default-on filter (D-065) before merge.

**Re-score:** the collector runs daily from merge; the re-score at >= 14 cycles per model is a ledger commitment (§3).

**Deviation from the brief, stated:** the brief asked for a stdlib-only collector. The scorer and the only code holding the
bucket key (`gust_bucket_io.py`, run as `python3 -I -S`) are standard-library only. The collector is not: EURO 10fg and ICON
VMAX_10M are CCSDS-packed (GRIB2 data representation template 5.42, measured 2026-11-18 on the 00Z f024 messages; GFS GUST is
5.3), which needs ecCodes, and reading through the publisher's own source classes is what makes the scored value the served
value. It runs with no credential, as `sst_collect.py` and `wind_emos_collect.py` do.

**Amendment 1 (2026-11-18, written before any pair was scored; §1 above is not edited).** A smoke read of the live NDBC files
(532 stations report GST in the band today, 489 have a metadata height) found heights from 0.0 m (a missing anemometer height
written as 0) to 587.7 m (a hill-top land site). The log law is a surface-layer profile over water and says nothing at either
end, so the ADJUSTED scoring uses only stations with 1 m <= z <= 50 m; the others are scored RAW only and counted with the
stations that have no metadata.

## 2. Build (PR #1063)

- `backend/scripts/gust_verify_collect.py` (stations / daily / backfill), `gust_verify_score.py` (stdlib), `gust_bucket_io.py`
  (stdlib, `python3 -I -S`, create-only under `calibration/gust_verify/`), `.github/workflows/gust-verify.yml` (daily 11:17 UTC,
  ON, kill `GUST_VERIFY_COLLECT=0`; a PR touching these files runs a keyless dry run). 21 tests (estate lane).
- Dry run 44392035963 (2026-11-18 20:37Z): daily took GFS 15 s, EURO 32 s, ICON 37 s for every step of 00Z 11-18 (81 / 64 / 60,
  none dropped); 533 stations frozen (532 at the smoke read); the 8-day backfill took ~17 s per run. Two faults found and fixed:
  (1) the scorer read only `stations.json`, a first run has `stations.json.new` (crash; fixed, test added); (2) ECMWF's AWS mirror
  answered 503 under load and 4..37 EURO steps per backfilled run were dropped (130 of them as "index has no 10fg": the source
  reads a throttled .index error page as an index; the collector now retries each step after 5 / 15 / 45 s, test added). The
  drops were recorded, never filled, so the EURO rows below cover each lead unevenly.
- The advisor's HOLD on #1063 (2026-11-19, one workflow change): a key-reading workflow must declare
  `environment: supabase-service` and must not run on pull_request (#1043's guard, not yet on dev when CI went green). The
  `record` job now declares the environment and `gust-verify.yml` runs on schedule and dispatch only. The keyless dry run moved
  to its own file, `gust-verify-dry-run.yml`, which names no credential. #1043's `test_workflow_key_environment.py`, run
  locally against this branch, lists neither gust workflow. The test pins both rules.
- The advisor's reminders, recorded: the 9-run reading in §3a is not a finding. The registered read is the 14-run re-score.
  Merging starts a daily create-only write to the production bucket, which needs David's word; the director relays it.

## 3. Results

### 3a. First scoring (2026-11-18; the dry run's collection, scored offline by the committed scorer; method unchanged)

533 stations (429 with a usable height, amendment 1); 00Z runs 2026-11-10 .. 11-18: GFS 9, EURO 9 (with the drops above), ICON 1.
m/s; adj = observation scaled to 10 m; the two baseline columns are on the same pairs as the model.

| model | lead h | n | bias raw (95% CI) | bias adj | MAE raw / adj | RMSE adj | POD / FAR adj | MAE wind x 1.40 | MAE model / persistence (n) | dense: bias vs primary / vs dense (n) |
|---|---|---|---|---|---|---|---|---|---|---|
| GFS | 0-23 | 34739 | +0.25 (+0.04, +0.48) | -0.02 | 2.58 / 2.66 | 3.62 | 0.50 / 0.46 | 2.49 | 2.66 / 2.40 (29383) | - |
| GFS | 24-47 | 30925 | +0.21 (-0.01, +0.46) | -0.05 | 2.74 / 2.83 | 3.83 | 0.46 / 0.49 | 2.68 | 2.83 / 3.70 (26006) | - |
| GFS | 48-71 | 27079 | +0.11 (-0.13, +0.41) | -0.17 | 2.92 / 3.01 | 4.04 | 0.37 / 0.52 | 2.87 | 3.00 / 4.23 (22661) | - |
| GFS | 72-119 | 42518 | -0.04 (-0.29, +0.29) | -0.34 | 3.21 / 3.33 | 4.46 | 0.32 / 0.55 | 3.18 | 3.33 / 4.34 (35361) | - |
| GFS | 120-240 | 38113 | -0.46 (-0.87, +0.21) | -0.65 | 3.71 / 3.82 | 5.20 | 0.26 / 0.64 | 3.66 | 3.80 / 4.31 (31176) | - |
| EURO | 0-23 | 10837 | +1.81 (+1.64, +1.92) | +1.62 | 2.65 / 2.63 | 3.54 | 0.71 / 0.53 | 2.38 | 2.63 / 2.82 (9089) | +1.66 / +0.55 (8498) |
| EURO | 24-47 | 11925 | +1.75 (+1.58, +1.85) | +1.55 | 2.72 / 2.70 | 3.60 | 0.66 / 0.56 | 2.49 | 2.70 / 3.66 (9940) | +1.60 / +0.50 (9267) |
| EURO | 48-71 | 17761 | +1.80 (+1.69, +1.92) | +1.63 | 2.89 / 2.94 | 3.87 | 0.58 / 0.60 | 2.71 | 2.94 / 4.21 (14843) | +1.68 / +0.54 (13977) |
| EURO | 72-119 | 28945 | +1.47 (+1.25, +1.73) | +1.30 | 2.99 / 3.12 | 4.17 | 0.48 / 0.59 | 3.02 | 3.11 / 4.26 (24014) | +1.37 / +0.27 (22635) |
| EURO | 120-240 | 20627 | +0.83 (+0.59, +1.08) | +0.72 | 3.17 / 3.29 | 4.47 | 0.48 / 0.52 | 3.45 | 3.26 / 4.49 (16769) | +0.83 / -0.19 (15906) |
| ICON | 0-23 | 3103 | +1.38 (one run: no CI) | +1.20 | 2.63 / 2.61 | 3.71 | 0.81 / 0.50 | 2.27 | 2.61 / 2.77 (2522) | +1.26 / +0.14 (2346) |

Same pairs, 0-23 h (3,103 station-hours, RAW, each model against its own observation definition): GFS +1.08 / MAE 2.84, EURO
+1.92 / 2.70, ICON +1.38 / 2.63. Controls: null GFS x1.37, EURO x1.41, ICON x1.20 (all PASS, >= 1.10); positive bias +0.002,
MAE 0.799, RMSE 1.001 (PASS). Every decision row: "fewer than 14 cycles: recorded, not acted on".

Reading (n ~ 1 period; recorded, not acted on):
- The window models' high bias is mostly the observation. On the stations that report >= 5 times an hour, EURO's bias against a
  densely sampled window maximum is +0.55 / +0.50 / +0.54 m/s at 0-71 h (vs +1.66..+1.68 against the one-report-an-hour
  primary on the same pairs), ICON's +0.14 (vs +1.26). A -1.8 m/s EURO correction would have made it under-forecast. If the
  re-score holds this, the correction candidate is ~+0.5 m/s for EURO at 0-71 h, and only if the dense rows pass the rule too.
- Wind x 1.40 beats every model on MAE in every bin except EURO 120-240 h (by 0.10-0.34 m/s), and persistence beats GFS at 0-23 h.
  The served gust products do not yet beat the simplest baseline on MAE. That points at a calibration that blends gust and wind
  (or a gust-factor model per regime) rather than a bias offset; it is a question for the re-score, not a change now.
- GFS is unbiased at short range (adj -0.02) and drifts low with lead (-0.65 at 120-240 h); its POD at >= 15 m/s falls from 0.50
  to 0.26 over the same leads. The same-pair GFS bias (+1.08) is far from its pooled one (+0.25): the 3,103 pairs are the ICON
  stations' hours of ONE run, a different and much smaller sample.
