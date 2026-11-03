# 2026-11-02 · claude · Evaluation harness v0 (offline, dark, no served change)

Session: a delegated subagent of the lead. Branch `claude/eval-harness-v0`, cut from `origin/dev` at `12fdcd228`.
Owner decision being executed (2026-11-02 19:32 EST, relayed by the lead): "TRUTH / REFERENCE DATA AND EVALUATION
INFRASTRUCTURE FIRST … establish provenance and served-rating/input linkage, compare against simple baselines,
quantify uncertainty and require measured improvement before any rating-changing activation." Nothing merged,
nothing flipped, no workflow dispatched, no env/Render/Netlify/main change, no call to the app or `*.onrender.com`.
**This PR changes no served number** (no served code path imports the new modules; SCOREBOARD row: none owed).

## Design

| Piece | File | What it does |
|---|---|---|
| Reference registry | `services/weather_pipeline/eval_reference.py` | station list loader; NDBC realtime2 stdmet / data_spec / swdir / swr1, CDIP THREDDS ascii + `.das`, CO-OPS water level; parsers keep every QC flag |
| Provenance | `eval_provenance.py` | cache outside the repo (refuses a path inside the worktree), sidecar per raw file, manifest per panel, GET-only allowlist of public hosts, app hosts refused by name |
| GFS-Wave archive | `eval_gfswave.py`, `eval_grib2.py` | `.idx` -> ONE byte range per (cycle, fh) (UGRD, VGRD, HTSGW, PERPW, DIRPW) on `noaa-gfs-bdp-pds`; pygrib when it imports, else a built-in 3.0 / 5.0 / 5.40 decoder (refuses anything else); crops -> production `NormalizedProduct` |
| Replay | `eval_replay.py` | served env parsed from `precompute.yml` at run time; production `PointSampler` -> `point_surf_augment` -> `spot_ratings.rate_one_spot`; `nearshore_validation.model_hs_at_station` at the buoy; every spot-hour row keeps run id, cycle, fh, lead, valid hour, inputs, outputs, decoder, wind source, GRIB sha256 |
| Scoring | `eval_scoring.py` | truth joins (±30 min, flag 1), persistence, climatology (station x week holdout), the frozen `hb_proxy` operator, twCRPS above p90, station-cluster bootstrap, station x week folds, the four controls |
| Gate | `eval_gate.py` | gates v2 (`gate_v2.compare` / `verdict`) + the harness rules, Holm across arms, scorecard and markdown |
| CLI | `scripts/eval_harness.py run` | truth -> forecast crops -> replay per arm -> scorecard; exit 0 only when every arm PASSES with production parity |
| Stations | `scripts/eval_harness_stations.json` | CDIP 103p1, 142p1, 153p1, 262p1 (anchor = nearest spot in `data/nearshore_validation_pairs.json`) + NDBC 46025, 46086 |
| Workflow | `.github/workflows/eval-harness.yml` | manual dispatch only, pygrib + pgrb2 wind; NOT dispatched |
| Contract | `docs/weather-program/evaluation-harness.md` | how a future flip must pass this gate |

Quantities: **`hs_station` (primary)**, the served chain's components at the buoy depth vs CDIP Hs; `hb_proxy`
(advisory), served `surf_height_m` vs Komar-Gaughan 1972 on the deshoaled buoy Hs (a FROZEN operator, independent of
the served code, so a candidate cannot move its own truth; read differences, not its bias); `hs_offshore`
(advisory), served offshore Hs vs NDBC WVHT.

## Provenance format

Each raw file: `<cache>/<key>` plus `<key>.prov.json` = `{source, url, range, retrieved_utc, sha256 (raw bytes),
bytes, cache_file, parser, time_standard, qc_policy, station_meta_version, http_status, remote_version (ETag,
Last-Modified, x-amz-version-id), notes, cache_hit}`. A cache hit re-hashes the file and refetches on mismatch.
Station metadata versions: CDIP `cdip:<cdip_deployment_id>:<dataset id>` (e.g. `cdip:153p1_d07:CDIP_153p1_20250812-
20261103`); NDBC `ndbc-deployment:<start>:<hull>` from `stationmetadata.xml`. Every panel (`truth.json`,
`forecast_crops.json`, `replay_<arm>.json`, `scorecard.json`) has a manifest beside it; `scorecard.manifest.json`
adds the code commit, the served-env sha256 and digest, the config (seed, reps, floors), the arms and the sha256 of
every panel.

## How to run

```bash
cd backend
python scripts/eval_harness.py run --start 2026-10-20T00:00Z --end 2026-10-29T18:00Z \
  --cache-dir C:/t/eh0-cache --out C:/t/eh0-demo --arm SURF_TIDE_DEPTH=1
# re-score from the cache with no network: add --offline
```

## The demo run (real public data; downloads 2026-11-03 ~01:25-01:35Z, offline re-scores to ~01:50Z)

Window: 40 target hours every 6 h, 2026-10-20T00Z .. 10-29T18Z; leads 24/48/72; 120 GFS-Wave files (382 MB cached,
0 failed); 264 raw files in the manifest (files digest `bcfd12d51ef7…`); served env `precompute.yml` sha256
`f2242d070963…`. Decoder builtin, wind from the wave file (no pygrib on Windows): **`production_parity: false`**, so
these numbers are scoped to that substitution. 4 CDIP + 2 NDBC stations; 1,200 replayed spot-hours per arm.

| quantity | arm | n | bias | MAE (=CRPS) | RMSE | SI | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| hs_station | served | 480 | -0.229 | 0.230 | 0.268 | 0.148 | 0.025 | -0.444 |
| hs_station | persistence | 480 | +0.015 | 0.216 | 0.282 | 0.301 | 0.043 | -0.236 |
| hs_station | climatology | 480 | +0.021 | 0.158 | 0.201 | 0.213 | 0.027 | -0.271 |
| hb_proxy | served | 480 | -0.148 | 0.196 | 0.252 | 0.126 | 0.026 | -0.370 |
| hb_proxy | persistence | 480 | +0.027 | 0.277 | 0.352 | 0.218 | 0.047 | -0.235 |
| hb_proxy | climatology | 480 | +0.044 | 0.208 | 0.267 | 0.164 | 0.029 | -0.338 |
| hs_offshore | served | 123 | -0.244 | 0.244 | 0.281 | 0.129 | 0.019 | -0.402 |

Served vs baselines (positive = served better; CRPS gain in m, 95% moving-block bootstrap CI, one-sided DM p):
- hs_station: vs persistence -0.0136 [-0.057, +0.044] p 0.69; vs climatology **-0.072 [-0.113, -0.019]** p 0.997.
  Above the p90 (twCRPS) served beats both: +0.0175 [+0.003, +0.035] and +0.0018 [+0.0001, +0.0032].
- hb_proxy: vs persistence **+0.081 [+0.035, +0.142]** p 0.002; vs climatology +0.012 [-0.036, +0.073] p 0.35.
- hs_offshore (n 123): vs persistence +0.021 [-0.054, +0.095]; vs climatology -0.021 [-0.085, +0.026].

FINDING (diagnostic, not a flip): at these four California nearshore buoys the served chain at buoy depth reads LOW
(bias -0.229 m, the same sign the nearshore lane recorded on 2026-09-27) and loses to a station climatology on MAE,
although its scatter index is the lowest of the three (0.148): the error is mostly bias. n = 1 window, 4 stations,
substituted inputs: recorded, not acted on.

Controls (served pairs): hs_station null_identical gain 0.0000 [0, 0] REFUSED (ok); null_swap -0.028 [-0.057,
+0.002] covers 0 (ok, advisory); positive +0.046 [+0.040, +0.053] PASS (ok); negative -0.058 [-0.066, -0.050] FAIL
(ok). hb_proxy: all four ok. hs_offshore: **underpowered** (top-decile band n 12 < 30): its verdicts are REFUSED.

Candidate demo `SURF_TIDE_DEPTH=1` (a demo only, not a flip recommendation): the flag was READ (tide lookups 1,200 ->
2,400) but changed **0 of 1,200** replayed spot-hours (regime `shoaling` on 1,182, `shelf` on 18; the depth-limited
cap never bound) -> **REFUSED** on all three quantities ("the two lanes give the same loss at every hour").

## Named gaps (counters in every scorecard; never silent stubs)

`size_reference` (RATING_LOCAL_SIZE=1 climatology lives in storage: global curve used, 1,200), `obs_gate`
(RATING_OBS_GATE=1 is applied after rating in the precompute merge: scores are pre-gate, 1,200), `best_tide` (DB
prior unknown, 1,200), `primary_swell` (display only, 1,200), `tide_missing` 0. Substitutions: native 0.25 deg crop vs
served tiles; wave-file wind when pygrib is absent; `${{ vars.X || 'd' }}` -> d (3 listed); tide by date.

## Reflection (Beam, high) and what changed

Asked to attack the gate rules and the provenance. Adopted: (1) **input parity** is now a scorecard field and a
warning on every verdict; the CLI exits 1 on a substituted run unless `--allow-substitutions`; the workflow pins
`--decoder pygrib --wind-source pgrb2`. (2) **Remote object versions** (ETag / Last-Modified / x-amz-version-id) are
kept in every sidecar and manifest; the scorecard manifest now carries the code commit, served-env digest, config
and every panel's sha256. (3) **Candidate vs truth-only baselines** per arm, with a warning when a candidate is
significantly worse than climatology (the demo's served chain is). (4) The **station-cluster CI becomes binding** at
>= 10 stations. (5) **Obs age** (truth match |dt|, persistence age) in the join QC. Declined, with reasons: making the
served breaking height the primary (no instrument measures it; hb_proxy stays advisory); making climatology
non-inferiority a hard rule (the served chain fails it today, so it would block every flip: an owner decision, listed
below); calling twCRPS non-standard (for a point forecast, CRPS of the chained max(x, t) is exactly Allen et al.
2023's twCRPS); "tide not cached" (it is, with a sidecar). Null-swap stays advisory: an exchangeable null misses 0 in
~5% of windows by construction.

## Follow-ups (not built)

1. Served-rating snapshot written into user reports (DB schema change; owner product decision).
2. Fix `calibration/prediction_archive.json` (capped ~3.8 days, GFS h+0 only, one-table matcher).
3. EURO / ICON replays (EURO needs Copernicus credentials only CI holds); then CONSENSUS_SERVE arms.
4. Per-spot truth expansion (more CDIP stations, Duck FRF, CO-OPS-anchored tide checks) so hs_offshore and the
   station-cluster CI stop being underpowered; a long-record climatology from CDIP archives.
5. A rating-truth module once labels exist (n = 0 today).
6. Archive the swell partitions so SURF_PARTITIONS / RATING_DOMINANT_FLUX arms become replayable.
7. Owner question: should "not significantly worse than climatology" become a hard rule once the chain's bias is
   fixed?
8. gates v2 edge: a band can be `testable` while its cell is suppressed when `min_n_decide < min_cell_print`
   (KeyError `worsen`); unreachable at the defaults (30 > 10), hit only by a test config. Guard the invariant.
9. First production-parity run of `eval-harness.yml` (owner's word to dispatch) to replace the substituted demo.

## Ledger

`ledger.d/claude--eval-harness-v0.jsonl:1` (the build), `:2` (commitment: the first production-parity run of
`eval-harness.yml`, owner's word to dispatch, due 2026-11-16), `:3` (the draft PR).
