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

## v0.1 revision (2026-11-03; owner: "If we need it, put it on" (GRIB reader), "I agree with you" (climatology rule))

Still a DRAFT; nothing merged, flipped or dispatched; no env / Render / Netlify / main change; no call to the app.
**No served number changes** (no served code path imports the eval modules).

### 1. Security finding fixed: redirects bypassed the network guard (P2, Codex bounded review, bound to head `6c570ade`)

`eval_provenance.http_get` checked only the first URL, then used the default `urlopen`, whose `HTTPRedirectHandler`
follows Location/URI with no host check: an allowed data URL that redirected could have reached an app host, an
unknown host or plain http (static finding plus documented library behaviour; nothing observed live). Fixed in this
revision's head: a PRIVATE opener per request (`build_opener`, never `install_opener`) with `GuardedRedirectHandler`,
whose `redirect_request` runs `check_url` on the resolved absolute target BEFORE the hop is contacted, refuses a
method change or a dropped Range header, and caps the chain at 3 hops (`NetworkRefused`). GET only, the byte cap and
the 206 check are kept. Every sidecar and manifest now records `final_url` and the `redirects` chain.
`tests/test_eval_harness_redirects.py` (11, offline stub transports, the real opener and handler): allowed->allowed
followed and recorded with the Range kept; allowed->app host, ->unknown host, ->supabase, https->http refused with
the target never contacted; a chain ending at an app host refused; 4 hops refused, 3 allowed; nothing installed
globally. Mutation: with the hop check removed, 5 of the 11 fail.

### 2. GRIB backends: pygrib, else eccodes, else built-in

`eval_grib2.select_backend`: pygrib when it imports (CI, production), else ECMWF `eccodes` (2.50.0, official win_amd64
wheel with the library bundled; `backend/requirements-eval-harness.txt`, OPTIONAL, not in requirements.txt, not
installed by CI or Render), else the built-in 3.0 / 5.0 / 5.40 decoder. An explicit backend that does not import
raises (never a silent swap); eccodes failing to load its library counts as absent. `decode_eccodes` reads regular
lat/lon of any data template ecCodes reads, including the pgrb2 atmosphere file's 5.3. `eval_gfswave.resolve`: the
wind is the pgrb2.0p25 10 m UGRD/VGRD (what served ratings read) whenever the backend reads 5.3; pgrb2 with the
built-in decoder is refused. The wave span is UGRD..DIRPW whichever wind is used (same bytes, one cache). `crop` now
refuses a field whose grid origin or step differs, not only its shape. The backend and its library version go into
every row, the `forecast_crops` and `scorecard` manifests, and each GRIB sidecar's parser/notes.
`input_parity.production_parity` = every field decoded by an ecCodes backend (pygrib or eccodes) AND the pgrb2 wind.
It covers the decoder and wind only; the grid, repo-variable and tide-by-date substitutions apply to every run, CI
included. Tests `tests/test_eval_harness_grib_backends.py` (12): backend order with mocked imports (4 cases), explicit
backend refusal, eccodes RuntimeError = absent, a committed synthetic fixture
`tests/fixtures/eval_harness/synthetic_3x4_three_packings.grib2` (759 bytes, one 3x4 field packed 5.0 / 5.3 / 5.40,
regenerated by `tests/_make_eval_grib_fixture.py`): the built-in decoder reads 5.0 and 5.40 and refuses 5.3; eccodes
reads all three (skipped with a reason where eccodes is absent, i.e. in CI); pygrib reads all three (skipped locally,
runs in CI); the pgrb2 wind is read and recorded through an ecCodes backend; the built-in path falls back to the wave
file's wind; a shifted grid is refused.

### 3. Climatology: out-of-sample, and a ratchet, not a wall

**Out-of-sample.** v0's climatology LEAKED. It was "the station mean over the truth panel excluding the target's
ISO week", and the panel ran from 30 days before the window to its end, so a target in W43 (Oct 19-25) averaged in
W44's scored hours (Oct 26-29) and vice versa: in-sample, and partly from after the issue time. Now
`eval_scoring.climatology` reads only observations OUTSIDE an embargo starting at the first issue time (first target -
max lead) and open-ended (weeks before the window, or other years); `build_items` refuses to run without the embargo;
`check_out_of_sample` raises `LeakedClimatology` if the climatology read an embargoed hour, lacks the marker, or a
scored valid hour or issue time falls outside the embargo; the ratchet refuses items without the marker. Truth now
reaches back `--clim-days` (30) before the embargo. Mutation: with `check_out_of_sample` disabled, 2 tests fail.

**Ratchet** (`eval_ratchet.py`, documented in `evaluation-harness.md`). Per lead: never widen the gap to climatology
(days 0-9: FAIL where the per-lead CI of served loss - candidate loss lies wholly below 0; climatology cancels on
common pairs, so this is a per-lead, un-Holmed "significantly worse than served"); LOCKED leads make "not worse than
climatology" a hard point-estimate rule; days 0-3 served losing to climatology = top-priority ALARM at the head of the
scorecard, never a block; days 10-14 only "not significantly worse than climatology", no lock. A locked lead the run
does not score or cannot test = REFUSED. Locks live in `backend/scripts/eval_harness_ratchet.json` (committed, empty),
written only by `--update-ratchet` from an ELIGIBLE run (controls pass + production parity); `save_baseline` refuses
any write that drops or changes a lock and writes atomically. Tests `tests/test_eval_harness_ratchet.py` (16).

### Reflection (Beam, high, two calls; the first was cut off at item 3) and what changed

Adopted: (a) **locks were too easy to earn by noise** (one window, unadjusted 95% CI per lead): a lead now needs the
CI above 0 AND the DM p-value below 0.05 after Holm across the quantity's leads, and becomes PENDING; a second
eligible run on a NON-OVERLAPPING window must qualify again to LOCK it (both windows' evidence kept in the lock).
(b) **The point-estimate rule at a locked lead could block a repair**: when served itself is below the floor in the
window and the candidate improves on served, it is a top-priority alarm, not a FAIL. (c) **Atomic lock writes** (temp
file + fsync + replace). (d) The embargo check now covers every issue time, not only valid hours. Declined, with
reasons: "make climatology a standing floor at every lead" (that is the wall the owner rejected: an improving
candidate that still loses to climatology must pass); "per-lead embargo" (the run-wide embargo at first target - max
lead is earlier than every per-lead cutoff, so stricter); "a 336 h embargo on every run" (no issue time in a run is
earlier than first target - its own max lead, so nothing later than that is known to any forecast scored); "expire
locks automatically" (the owner's rule is that the floor only rises; removal stays a DECISIONS entry). Already as
asked: an unscored or untestable locked lead is REFUSED; days 0-3 never block; days 10-14 skip the never-widen rule.

### The re-run demo (public data only; never the Raw Surf backend)

Same window (40 targets every 6 h, 2026-10-20T00Z .. 10-29T18Z, leads 24/48/72), same 4 CDIP + 2 NDBC stations, same
arm `SURF_TIDE_DEPTH=1`. Backend auto -> **eccodes 2.50.0 (ecCodes 2.50.0), wind pgrb2**: 120 GFS-Wave spans (cache
hits, same bytes as v0) + 120 new pgrb2.0p25 `.idx` + UGRD/VGRD 10 m spans (~1.9 MB each), 0 failed.
**`production_parity: true`.** Still substituted (as in CI): the native 0.25 deg crop instead of the stored served
product, `${{ vars.X || 'd' }}` -> d, the tide fetched by date. Decoder check on every crop of the 120 files: eccodes
vs the v0 built-in decoder, max |diff| 9e-16 m (HTSGW), 4e-15 s (PERPW), 6e-14 deg (DIRPW): the two decoders agree.
Wind: pgrb2 minus the wave file's forcing wind, speed p05/p50/p95 -0.11 / +0.00 / +0.14 m/s where both are valid; but
the served wind also covers land cells the wave file masks, so 305 of 1,200 replayed spot-hours changed rating level
(mean score +3.1, mean |change| 4.0, max 36.3) versus v0: the v0 substitution moved RATINGS, not heights (0 changed).

| hs_station (n 480) | bias | CRPS (=MAE) |
|---|---|---|
| served | **-0.2295 m, 95% block-bootstrap CI [-0.263, -0.200]** | 0.230 |
| persistence | +0.015 | 0.216 |
| climatology (out-of-sample, Sep 17 - Oct 16; 142p1 from Oct 2) | +0.026 | 0.154 |

Served vs persistence: CRPS gain -0.0136 m [-0.057, +0.044], DM p 0.69 (no difference). Served vs out-of-sample
climatology: **-0.0758 m [-0.1175, -0.0215], p 0.998** (served loses). v0's leaked climatology gave -0.072 [-0.113,
-0.019]: the leak did not flatter climatology here; the honest one is slightly better (MAE 0.154 vs 0.158).
Per lead (served vs climatology): 24 h -0.073 [-0.117, -0.016]; 48 h -0.070 [-0.112, -0.015]; 72 h -0.084 [-0.126,
-0.034]. Per-lead bias: -0.227 / -0.223 / -0.238 m. **The -0.23 m low bias is unchanged with the real inputs**
(hs_station does not read the wind, and the decoders agree to 1e-15). Ratchet state: eligible to lock (controls pass,
parity true) but **no lead qualifies (served loses at all three) -> no lock, no pending; the baseline stays empty**;
**4 top-priority alarms**: hs_station 24 / 48 / 72 h, and hs_offshore 72 h (-0.041 [-0.102, -0.002]; advisory
quantity, n 41 per lead). Controls: hs_station pass, hb_proxy pass, hs_offshore underpowered. `SURF_TIDE_DEPTH=1`:
read (tide lookups 1,200 -> 2,400), 0 of 1,200 spot-hours changed -> REFUSED (unchanged from v0).

### Floors

Chain lane, re-derived with `rederive_floor.py --lane chain --add 94 --add-files 6` (v0's 55 + this revision's 39
passing; 40 collected, one skipped wherever eccodes or pygrib is absent: CI has pygrib, not eccodes): set from 3266,
floor 3260, 194 files. Projection for hosted CI: chain "collected 3267 tests across 194 files -> 3266 passed, 1
skipped".

### Ledger (v0.1)

`ledger.d/claude--eval-harness-v0.jsonl:4` (the redirect finding, bound to `6c570ade`, fixed), `:5` (the v0.1
revision). The commitment `:2` (first production-parity run of `eval-harness.yml`, owner's word) stays owed: the
local eccodes run reached parity but is not the CI workflow run it names.

## v0.2: the flip-PR scorecard automation (2026-11-03, same draft #695)

Scope: `docs/audits/RAW-SURF-COORDINATION.md` 2026-11-03T03:30Z (owner: "we need a testing automation to help guage a
flip each time, right?" ... "IF we need it, put it on."). Still DRAFT; nothing merged, flipped, dispatched or
deployed; no env change. **No served number changes.** Built after v0.1's hand-off check: head `a897361b1`, CI green
(chain "collected 3267 tests across 194 files -> 3266 passed, 1 skipped" = the projection; guards 3351; estate 3408).

- `eval-harness.yml` gains a `pull_request` trigger (opened / labeled / synchronize / reopened) and the job
  `flip-scorecard`: same-repo PRs with the `flip-candidate` label only; `contents: read`, `pull-requests: write`;
  60 min; merge base vs head; `actions/cache` keyed by the declaration's window; one PR comment edited in place; a
  14-day artifact. The manual `harness` job is now `workflow_dispatch`-only. No secret is referenced.
- `backend/scripts/flip_scorecard.py`: trigger parsing (forks, other labels, other actions do nothing), the
  declaration `docs/weather-program/flip-candidates/<slug>.json` (schema, slug, replayable flags, a 7-14 day window
  pinned >= 3 days in the past on 00/06/12/18Z, leads, primary; the plan's range downloads checked against 400 BEFORE
  any download), the head env = base env or base env + flags (else INVALID), served-code drift = REFUSED, the
  outcome mapping (PASS / FAIL / REFUSED: no change, underpowered, substitutions, drift, budget / INVALID: input,
  broken controls, error), and the comment.
- The harness gains `--served-env-root` (the merge base's precompute.yml) and download budgets
  (`--max-range-downloads`, `--max-bytes`; `pv.BudgetExceeded`, never swallowed as a per-file gap).
- Tests `backend/tests/test_flip_scorecard.py` (41, chain lane): trigger (10), declaration (16), drift, env, outcomes
  (7), the run mapping incl. budget and error, prepare with no declaration / a fork, the comment, the cache budget,
  and the workflow's own limits (trigger, same-repo, permissions, 60 min, 14 days, one comment, no secrets, no merge /
  dispatch / push / ratchet write).
- Local end-to-end (cached public data, no network): a declaration `SURF_REFRACTION_KR=1.0` (the Kr kill value) over
  the v0.1 window -> **PASS** on hs_station (+0.083 m [+0.075, +0.092], n 480), 0 range downloads (all cache hits),
  4 alarms in the comment. A demo of the automation, NOT a flip recommendation (one window, 4 stations; Kr=1.0 raises
  heights, which offsets the -0.23 m low bias at these buoys; breaking height and rating are not measured).
- Floor: chain re-derived `--add 135 --add-files 7` -> set from 3307, floor 3301, 195 files.
- Owed: the first hosted run on a labelled PR (none exists yet; the trigger is live only on this branch until #695
  merges, which needs the owner's exact-head word).

Ledger: `ledger.d/claude--eval-harness-v0.jsonl:6`.
