# Audit 12.2 — Source Inventory: BACKEND WEATHER PIPELINE

**Area:** `backend/services/weather_pipeline/` (88 dir entries), `backend/routes/weather.py`,
`backend/routes/weather_ingest.py`, `backend/routes/surf_data/`, `backend/scheduler/`.
**Repo:** `C:\Users\dprit\Raw-Surf`, branch `dev`, HEAD `791fdf78`. Date 2026-08-13.
**Discipline:** inventory built INDEPENDENTLY from source first; compared to the 12.1 registers only
afterwards. Read-only — nothing outside this evidence directory was modified.

---

## 0. METHOD, AND THE TWO TIMES IT WAS WRONG BEFORE IT WAS RIGHT

An AST import-graph was built over all **1,157** `.py` modules under `backend/` (script:
scratchpad `impgraph.py`; walks `ast.Import` / `ast.ImportFrom` at **every** depth, so
function-local imports are captured). Reachability is a BFS closure from named entry points.

**The instrument was wrong twice and a positive control caught it both times. Recorded because the
conclusions below are only as good as the walker:**

1. **First run: 53 modules reachable from `server.py`.** Implausible. Cause: relative imports were
   resolved against the parent of a package rather than the package itself, so every
   `from .social import router` in `routes/__init__.py` resolved to nothing. Fixed by tracking
   `__init__.py` packages (PEP 328 semantics). → **372 reachable.**
2. **Second run: `science_registry` had `importers=0`.** Implausible against CLAUDE.md, which calls
   it the home of every science constant. Cause: for `from <pkg> import <submodule>` the walker
   stopped once the *package* resolved, hiding the submodule edge behind the package node. Fixed by
   always also attempting submodule resolution. → **374 reachable**, and `sim_rating` went from 10
   to 21 importers.
3. Five files initially failed to parse (`U+FEFF` BOM). That was the walker reading `utf-8` instead
   of `utf-8-sig`; CPython's own import machinery handles a BOM. **Not a repo defect.** → 0 failures.

**Positive controls run after the final fix** (all returned YES, so a `NO` below is a finding and
not a broken search): `routes`, `routes.weather`, `routes.surf_data`, `routes.surf_data.conditions`,
`scheduler`, `scheduler.forecast`, `wp.spot_ratings`, `wp.surf_rating`, `wp.surf_point`,
`wp.providers.open_meteo_provider`, `wp.scheduler`.

**Counting rule for this document.** The directory has **88 entries** = 84 top-level modules +
`__init__.py` + `__pycache__/` + `data/` + `providers/`. The classified population is **86 modules**
(84 top-level + 2 under `providers/`). Command:
`ls backend/services/weather_pipeline/ | wc -l` → 88.

### 0a. A METHOD LIMITATION THAT IS ALSO A FINDING

Lane closures are **not** discriminating as-is, because of a single function-local back-edge:

```
backend/services/weather_pipeline/point_resolution.py:75    import routes.weather
                                                     :76    return routes.weather.store
                                                     :82-83 import routes.weather -> .dynamic_index
```

A *service* module reaches into a *route* module to fetch two module-global singletons. That edge
chains `routes.weather -> routes.weather_ingest -> wp.scheduler -> (all ingestion modules)`.

**Control (remove only that one edge, change nothing else):**

| lane | wp modules in closure WITH the back-edge | WITHOUT it |
|---|---|---|
| SERVE (`server.py`) | 67 | 67 |
| INGEST (`scripts/ingest_forecast_ci.py`) | 65 | 53 |
| PRECOMP (`scripts/precompute_ci.py`) | 65 | **39** |
| SIM (`weather_sim_mcp.py`) | 75 | 45 |

**One import line pulls 26 extra modules into the precompute lane**, including the entire ingestion
subsystem (`wp.scheduler`, `wind_ingestion`, `pressure_ingestion`, `marine_mid_res_ingestion`,
`euro_marine_coarse_ingestion`, `viewport_*`, `mid_res_tier`, `far_edge_hold`, `lattice_fill`,
`coarse_gulf_fill`, `grid_resolver*`, `grid_series_helper`, `capabilities`, `pilot_regions`,
`providers.copernicus_provider`, `icon_marine_extension`, `euro_wind_extension`,
`wind_native_recovery`, `wind_mid_res_ingestion`, `wind_pilot_multi`, `wind_gates`,
`scheduler_helpers`, `viewport_upstream`, `marine`/`euro` ingest pair).

Because of this, the per-module lane column in §1 is reported as the WITH-back-edge closure and
should be read as **"can be imported by"**, not "is exercised by".

---

## 1. MODULE-BY-MODULE CLASSIFICATION (all 86)

Full machine-generated table: **`be-pipeline-module-table.md`** (sibling file, 86 rows,
columns: module / lanes / #direct test importers / named in a 12.1 register).

Summary of that table:

* **Reachable in at least one runtime lane: 84 of 86.**
* **Reachable in NO lane at all: 2** — `science_registry`, `wave_wrapping`.
* **Named anywhere in the 12.1 registers + SOTA contract: 21 of 86.** The other 65 are not named.
  *(Not-named is NOT by itself a gap — the registers are outcome-based, not module-based. It is
  used below only to test whether a specific behaviour has an owner.)*

### 1a. Reachability classes (justified by a call site / import edge, never by filename)

**Active-reachable — serve path** (`routes/weather.py` → resolver → store):
`point_resolution`, `sampler`, `grid_resolver`, `grid_resolver_selection`, `grid_resolver_surf`,
`grid_series_helper`, `product_selection`, `mid_res_tier`, `store`, `store_helpers`, `normalizer`,
`schemas`, `route_helpers`, `viewport_service`, `viewport_helper`, `dynamic_index`,
`manifest_pointer`, `manifest_view`, `series_vector_budget`, `capabilities`, `prefetcher`,
`spot_ratings`, `spot_conditions`, `surf_point`, `surf_rating`, `surf_transform`,
`spot_size_climatology`, `grid_size_climatology`, `shore_normal_asset`, `spot_geometry_readiness`,
`rating_confirmation`, `tide`, `bathymetry`, `wave_physics`, `estimator`, `period_bands`,
`surf_height_convention`, `surf_magnets`, `point_surf_augment`, `local_size_preview`,
`buoy_calibration`, `buoy_residual_retention`, `report_calibration`, `forecast_skill`,
`forecast_spread`, `data_health`, `copernicus_validator`, `providers/open_meteo_provider`,
`providers/copernicus_provider`.

**Active-reachable — ingestion path** (`scheduler/forecast.py` → `wp.scheduler`, 28 ingest jobs):
`scheduler`, `scheduler_helpers`, `wind_ingestion`, `wind_mid_res_ingestion`, `wind_pilot_multi`,
`wind_native_recovery`, `wind_gates`, `pressure_ingestion`, `marine_mid_res_ingestion`,
`euro_marine_coarse_ingestion`, `euro_wind_extension`, `icon_marine_extension`, `pilot_regions`,
`viewport_upstream`.

**Flag-gated, default ON (serve-time synthesis/fill ladder)** — each reads its own kill switch:
| module | flag | default | line |
|---|---|---|---|
| `coarse_gulf_fill` | `MARINE_COARSE_GULF_FILL` | `"1"` | :80 |
| `lattice_fill` | `LATTICE_INBAND_FILL` | `"1"` | :215 |
| `far_edge_hold` | `FAR_EDGE_HOLD` | `"1"` | :35 |
| `mid_res_tier` | `MARINE_MID_RES_TIER` / `WIND_MID_RES_TIER` | `"1"` / `"1"` | :111 / :152 |
| `grid_resolver_selection` | `SURF_REGIONAL_PREFER` | `"1"` | :168 |

**Fallback-only:** `point_direct_fallbacks` (the resolver's "PATH 2c" direct upstream point-API
builders; per its own docstring, reached only after the tiered product ladder misses),
`wind_native_recovery` (cooldown-gated re-fetch, `WIND_NATIVE_RECOVERY_*`).

**Sim-process-only (NOT reachable from `server.py`)** — 11 modules whose only non-test importer is
`backend/weather_sim_mcp.py`, a separate MCP server process:
`sim_boot`, `sim_briefing`, `sim_compare`, `sim_daylight`, `sim_explain`, `sim_forecast`,
`sim_mcp_shim`, `sim_observed`, `sim_rating`, `sim_spots`, `sim_window`.
**The weather sim is a separate process, not a FastAPI route.** No `routes/*` module imports any
`sim_*` module (verified: zero non-test, non-`weather_sim_mcp` importers in `rev.json`).

**Operator-tool-only (no scheduled workflow):** `height_quantile_map` (`scripts/fit_quantile_map.py`),
`resolve_spot_geometry` + `spot_geometry_db` (`scripts/resolve_new_spot_geometry.py`,
`scripts/seed_geometry_columns.py`, `scripts/backfill_geometry_reject_reasons.py`).
Verified none of those three scripts appears in `.github/workflows/` — positive control:
`ingest_forecast_ci` and `build_shore_normals` both return their workflows.

**Spot-discovery lane only** (`discover-spot-candidates.yml` → `scripts/filter_spot_candidates.py`):
`swell_fetch`, `ocean_access`, `shore_normal_fit`.

**Test-and-documentation-only:** `science_registry` — see §5.
**Experimental, dark by design:** `wave_wrapping` — see §6.

---

## 2. PROVIDER ADAPTERS — AND THE SUBPROCESS BOUNDARY

`backend/services/weather_pipeline/providers/` contains **only two** adapters
(`open_meteo_provider.py`, `copernicus_provider.py`). **The real upstream fleet lives one directory
up, in `backend/services/`,** in two layers:

**Layer A — in-process service wrappers (import-visible, all in every lane):**
`noaa_marine_service`, `noaa_wind_service`, `noaa_pressure_service`, `dwd_marine_service`,
`dwd_wind_service`, `dwd_pressure_service`, `ecmwf_wave_service`, `ecmwf_wind_service`,
`ecmwf_pressure_service`, `copernicus_marine_service`, `copernicus_point_batching`.

**Layer B — GRIB2 byte-range fetchers, spawned as SUBPROCESSES, named by STRING:**
`noaa_gfs_wave_fetcher`, `noaa_gfs_wind_fetcher`, `noaa_gfs_pressure_fetcher`, `dwd_gwam_fetcher`,
`dwd_icon_wind_fetcher`, `dwd_icon_pressure_fetcher`, `ecmwf_opendata_fetcher`,
`copernicus_global_fetcher`, `copernicus_fetcher`.

Mechanism (`backend/services/_fetch_common.py:676`):
```python
async def run_fetcher_subprocess(script_name: str, ...):
    ...
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), script_name)
```
and directly at `backend/services/noaa_marine_service.py:79`:
```python
script = os.path.join(os.path.dirname(__file__), "noaa_gfs_wave_fetcher.py")
```

**Consequence:** all nine fetchers report **zero production importers and no lane** in any
import-graph walk, while being the *primary production ingestion path* — the very
"Range-streamed GRIB2 ingestion off `.idx`" the SOTA contract lists as already state-of-the-art.
They are **Active-reachable via subprocess spawn**, invisible to import analysis.

**~40 environment variables are read ONLY inside those subprocesses** (measured by grepping
`os.environ.get`/`os.getenv` in each fetcher):
`NOAA_FETCH_BUDGET_S`, `NOAA_FETCH_MIN_HOURS`, `NOAA_FETCHER_DAYS`, `NOAA_FETCHER_QUICK`,
`NOAA_MULTI_RES`, `NOAA_COARSE_DIR_BLOCKMEAN`, `NOAA_COARSE_DIR_CONFIDENCE`,
`NOAA_COARSE_DIR_TOTAL_FIELD`, `NOAA_COARSE_SCALAR_BLOCKMEAN`, `NOAA_PARTITION_DIR_CONFIDENCE`,
`FETCH_VECTOR_BLOCKMEAN`, `NOAA_WIND_FETCHER_*`, `NOAA_PRESSURE_FETCHER_*`, `DWD_GWAM_*`,
`DWD_ICON_WIND_FETCHER_*`, `DWD_ICON_PRESSURE_FETCHER_*`, `ECMWF_OPENDATA_FETCHER_*`,
`ECMWF_OPENDATA_SOURCE`, `ECMWF_PERIOD_BANDS`, `ECMWF_WAVE_ENSEMBLE`, `ECMWF_WAVE_ENSEMBLE_MEMBERS`,
`ECMWF_WAVE_SCALAR_BLOCKMEAN`, `COPERNICUS_FETCHER_*`, `COPERNICUS_DIR_*`, `COPERNICUS_SCALAR_BLOCKMEAN`.

`subprocess.run` is called without `env=`, so the child inherits the parent environment and the
flags **do** reach the fetchers. The boundary is a problem for *reasoning*, not for delivery — see
§7 (candidate CG-3, disposition Verify, and the reason the obvious version of this was killed).

---

## 3. INGESTION JOBS, SCHEDULED LANES AND CADENCES

### 3a. In-process APScheduler (`backend/scheduler/__init__.py`, started from `server.py:29`)
17 jobs registered. **Only three are weather-related:**

| job id | trigger | line |
|---|---|---|
| `check_surf_alerts` | `IntervalTrigger(minutes=15)` | :42 |
| `ingest_marine_forecast` | `IntervalTrigger(hours=4)` + `FORECAST_STARTUP_DELAY_SEC` (default 120 s) | :217 |
| `periodic_l2_restore` | `IntervalTrigger(minutes=L2_RESTORE_INTERVAL_MIN)` default 30, floor 5 | :195 |

`ingest_marine_forecast` and `periodic_l2_restore` are **mutually exclusive**, selected by
`DISABLE_FORECAST_SCHEDULER` (`:172`). Which branch production runs is **not knowable from git** —
that is the already-open owner task WS-CAN-0040 (read the Render env screen).

Minor, recorded not filed: the completion log at `:243-247` enumerates 15 job names and **omits
both** `ingest_marine_forecast` and `periodic_l2_restore` — the two most operationally important
ones. A cosmetic status-surface drift, far below the bar of WS-OBJ-506.

### 3b. Pipeline ingest jobs (`wp/scheduler.py`, class `WeatherPipelineScheduler`) — **28**
`ingest_gfs_marine_pilot`, `ingest_gfs_wind_pilot`, `ingest_gfs_wind_global`,
`ingest_gfs_wind_global_mid`, `ingest_icon_wind_global_mid`, `ingest_euro_wind_global_mid`,
`ingest_gfs_marine_global`, `ingest_gfs_marine_global_mid`, `ingest_euro_marine_global`,
`ingest_euro_wind_global`, `ingest_icon_wind_global`, `ingest_gfs_pressure_pilot`,
`ingest_icon_pressure_pilot`, `ingest_euro_pressure_pilot`, `ingest_icon_marine_global`,
`ingest_icon_marine_global_mid`, `ingest_euro_marine_global_mid`, `ingest_euro_marine_pilot`,
`ingest_gfs_pressure_global`, `ingest_icon_pressure_global`, `ingest_euro_pressure_global`,
`ingest_copernicus_regional`, `ingest_icon_marine_pilot`, `ingest_icon_wind_pilot`,
`ingest_euro_wind_pilot`, `ingest_euro_marine_extended_estimates`,
`ingest_icon_marine_extended_estimates`, `ingest_lattice_inband_fill`.
Command: `grep -nE "    async def ingest" backend/services/weather_pipeline/scheduler.py | wc -l` → 28.
All 28 are also exposed as admin-gated POST endpoints in `routes/weather_ingest.py` (19 routes).

### 3c. GitHub Actions lanes (the decoupled ingestion + the instruments)

| workflow | cron (UTC) | entry point |
|---|---|---|
| `forecast-ingest.yml` | `15 */4 * * *` | `scripts/ingest_forecast_ci.py`, `WORLDWIDE_REGIONS_PER_CYCLE=3` |
| `forecast-ingest-pilots.yml` | `45 3,11,19 * * *` | same script, `ECMWF_PERIOD_BANDS=0`, `WORLDWIDE_REGIONS_PER_CYCLE=3` |
| `precompute.yml` | `45 3-23/4 * * *` | `scripts/precompute_ci.py`, `RATING_LOCAL_SIZE=1` |
| `forecast-accuracy-monitor.yml` | `5 1,7,13,19 * * *` | `scripts/forecast_accuracy_monitor.py` |
| `forecast-calibration-census.yml` | `35 2,8,14,20 * * *` | `local_size_gonogo` + `climatology_drift_census` + `served_freshness_census` + `verify_point_spot_reference` |
| `sim-parity-monitor.yml` | `20 5,11,17,23 * * *` | `scripts/sim_health_probe.py` |
| `data-health-monitor.yml` | `*/30 * * * *` | `scripts/product_run_age_census.py` (stdlib HTTP only — imports no pipeline module) |
| `marine-nightly.yml` | `30 6 * * *` | node contract + zoomlab |
| `keep-warm.yml` | `*/5 * * * *` | HTTP ping |
| `l2-orphan-sweep.yml` | manual | `scripts/sweep_orphaned_l2.py` |

`scripts/ingest_forecast_ci.py:71-72` calls `scheduler.forecast.ingest_marine_forecast_task()` —
i.e. **the decoupled lane runs the exact same in-process job**, including its legacy first stage
(§4).

---

## 4. CACHE TIERS — AND A DEAD ONE

Four tiers exist. Three are the documented `ProductStore` ladder; the fourth is undocumented in the
audit program.

| tier | location | owner | notes |
|---|---|---|---|
| **memory** | `ProductStore._PRODUCT_CACHE` | `store.py:300-314` | TTL 300 s; `PRODUCT_CACHE_LIMIT` default 128; `PRODUCT_CACHE_VECTOR_BUDGET` default 120000; `_L2_NEGATIVE_CACHE_TTL` 60 s |
| **L1 disk** | `backend/uploads/weather_products/` + manifest | `store.py:321` | ephemeral on Render |
| **L2 durable** | Supabase Storage | `store.py:17-120` | designated-writer gated: `L2_WRITER=1`, kill `L2_WRITER_GATE=0` |
| **legacy `forecast_cache`** | `backend/uploads/forecast_cache/{wind,marine}_global.json` | `services/forecast_ingester.py:10` | **git-tracked**; see below |

### 4a. `services/forecast_ingester.py` — the legacy stage, and a fallback that cannot fire

`scheduler/forecast.py:23-36` runs, **before** the conformed pipeline, on **every** cycle in
**both** lanes:
```
await ingest_global_model('wind')      # "Starting legacy wind ingestion..."
await ingest_global_model('marine')    # "Starting legacy marine ingestion..."
```

`ingest_global_model` (`forecast_ingester.py:33-97`) builds its grid as:
```python
for lat in range(50, 9, -10):
    for lon in range(-130, -50, 10):
```
Executed: **40 points**, lats `[10,20,30,40,50]`, lons `[-130..-60]` — a **USA-only** grid, written
to files named `*_global.json`, with `forecast_days=2`.

Its only consumer is `wind_ingestion.py`, at **three** sites (GFS `:190`, EURO `:304`, ICON `:502`),
each guarded identically at `:196`, `:310`, `:508`:
```python
if len(cached_data) < 100:
    logger.warning("... too small for global. Skipping this cycle ...")
```

**40 < 100 unconditionally. All three wind-model forecast_cache fallbacks are structurally
unreachable.** The producer's output size can never satisfy the consumer's floor.

Measured artifacts:
* `git show HEAD:backend/uploads/forecast_cache/wind_global.json` → **40 points**, time range
  **2026-06-22T00:00 → 2026-06-23T23:00** (52 days stale at HEAD).
* working tree → 40 points, `2026-08-13T00:00 → 2026-08-14T23:00` (locally regenerated, still 40).
* `marine_global.json` — **no reader anywhere.** `grep -rn "marine_global" --include=*.py backend/`
  returns only `ingest_*_marine_global()` *method-name* substring collisions in
  `routes/weather_ingest.py`, never the file. Positive control in the same command:
  `wind_global.json` returns its three real readers.
* No CI persistence: `grep -rn "forecast_cache" backend/scripts/ .github/workflows/` → **0 hits**.
  Positive controls over the **same two paths**, needles known to exist there: `uploads` → 9 files,
  `ProductStore` → 10 files, `L2_WRITER` → 5 files. The search technique works; the absence is real.
  So the artifact the CI runner writes is discarded with the ephemeral runner filesystem, and the
  serve box's copy is whatever git checked out.
* Test coverage: `services/forecast_ingester.py` has **zero** test files importing it, and zero
  mentioning it by name.

So the legacy stage spends two upstream Open-Meteo calls per ingestion cycle (plus a 2 s sleep) to
produce one artifact nothing reads and one artifact its only readers are guaranteed to reject.

**Register check:** `forecast_ingester`, `ingest_global_model`, `forecast_cache` and "legacy ingest"
appear in **no** 12.1/12.0 register row, no objective, and no SOTA line. The only hit is
`CURRENT_BASELINE_MANIFEST.md:13`, which lists the two JSON files as pre-existing *working-tree
modifications* "not touched by" audit 12.1 — i.e. the program has seen the files as VCS noise, never
as a subsystem. Positive controls in the same files: `grid_series_helper` 2 hits, `store_helpers`
2 hits, `pilot_regions` 1 hit.

---

## 5. `science_registry.py` IS TEST-ONLY

`grep -rn "science_registry" --include=*.py backend/ | grep -v "^backend/tests/"` returns **two
hits, both prose** — `surf_transform.py:159` and `:301`, inside a docstring and a comment. Its only
importers are `tests/test_science_registry.py` and `tests/test_science_registry_coverage.py`.
Positive control in the same command shape: `surf_rating` returns 5+ production files.

This is **not** a defect — the module's own docstring (`:14-29`) states the design: constants live in
the physics modules, the registry declares their *published range and provenance*, and the test
"walks the registry OUTWARD to its modules". But it does mean the CLAIM in `CLAUDE.md`
("constants live in `science_registry.py` + ratchet — ADD THERE, never a bare literal") describes a
**test-time** ratchet, not a runtime source of truth: a new bare literal in a physics module reaches
production and is only caught if the ratchet test runs. Covered in substance by WS-CAN-0042
(registry ratchet, `d12d363c`), so **not filed as a gap** — recorded so a future session does not
re-derive it.

---

## 6. `wave_wrapping.py` — BUILT, TESTED, DARK, AND UNOWNED

29 KB / 500+ LOC. **No lane, no production importer** — `grep -rn "wave_wrapping" --include=*.py
backend/` outside its own file and `tests/test_wave_wrapping.py` returns **nothing**; positive
control in the same loop returned real hits for `science_registry`, `height_quantile_map`,
`resolve_spot_geometry`, `spot_geometry_db`, `swell_fetch`.

Self-disclosing at `:1-7`: *"DEFAULT OFF. Nothing in production calls this module."* Gate
`SURF_WAVE_WRAPPING` default `"0"` (`:417 is_enabled`). Public surface includes
`refraction_kr_sq`, `lit_energy_fraction`, `diffraction_coefficient`, `wrap_energy_factor`,
`wrap_height_factor`, `resolve_headland_rotation`, `wrap_energy_factor_at`, with Gauss-Legendre
nodes and named constants (`SPREAD_SIGMA_DEG=9.3`, `CELERITY_RATIO_DEFAULT=0.2912`,
`HEADLAND_ROTATION_MAX_DEG=90.0`).

Its docstring states the defect it targets and quotes the measurement: the cosine exposure term
pins at a flat floor (0.100 energy / 0.595 height) past `dtheta = 90°`, and **"Measured 2026-08-09:
18.9% of all served spot-hours (n=13,166) sit on that floor"** — the same dual-floor quantity
carried in project memory as *ONE QUANTITY, TWO FLOORS*.

**Register check:** `wave_wrapping`, `SURF_WAVE_WRAPPING` and "wrapping" appear **zero** times
across `audit/weather-simulation-12.1/**` and `audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv`.
Positive control, same files: `SURF_TIDE_DEPTH` 1 hit (WS-CAN-0053), `SURF_PARTITIONS` 2 hits
(WS-CAN-0052). **Its two sibling dark science flags each have a canonical ID; this one has none.**

---

## 7. CANDIDATES KILLED BEFORE FILING (first-class results)

* **`coarse_gulf_fill` has no provenance.** *Killed.* My first grep used the wrong needle
  (`is_estimated`/`estimate_basis`, both 0). The module stamps a **dedicated** field:
  `product.coarse_fill = {"donor_model": "GFS", "layer": ...}` at `:168`, guarded by an explicit
  **"PROVENANCE LOST"** error branch at `:173-176` for the un-stampable case, and asserts the field
  reaches the wire via `"coarse_fill" in model_dump_json()` (`:161`). Exemplary disclosure.
* **The `stale_cache_recycled` wind fallback serves recycled data as live.** *Killed.*
  `wind_ingestion.py:238-241` sets
  `_cache_basis = {"type": "stale_cache_recycled", "method": "time_shifted_forecast_cache", ...}`
  and threads it through `normalize_and_save_loop`; `grid_series_helper.py:58-63` serializes
  `estimate_basis` (already receipted under WS-CAN-0004). Disclosed. *(It is also unreachable — §4a.)*
* **`test_flag_lane_parity.py` justifies its `ECMWF_PERIOD_BANDS` exception with a false premise.**
  *Mostly killed.* The comment at `:123-127` **already names the subprocess boundary** ("I declared
  it there first, reasoning 'the wave service spawns the fetcher as a subprocess'... True of the
  SERVICE, false of the LANE"), and its load-bearing justification is *"precompute cannot fetch a
  period band whatever this flag says"* — which stands, because precompute reads stored products. Only
  the secondary premise ("`precompute_ci.py` imports no ecmwf module, 57 files walked") is falsified
  by §0a. Downgraded to a Verify, not a defect.
* **Orphaned `.pyc` test artifacts.** *Killed.* `test_viewport_upstream_timeout` and
  `test_gfs_wind_pilot_multi_bbox` matched only in `__pycache__`; both `.py` sources exist. Stale
  bytecode from an older revision, nothing more.
* **`product_selection` / `mid_res_tier` / `grid_resolver*` tier ladder is unowned.** *Killed.*
  WS-OBJ-205 "Deterministic product selection" names the *"marine fetch ladder z8/z9/z10"* as its
  architecture owner and carries WS-CAN-0033. Covered.
* **`sim_*` modules unowned.** *Killed.* WS-CAN-0006 (simulator model contract) and WS-OBJ-002 cover
  the sim's disclosure; `sim_forecast` and `sim_observed` are named in the register directly.

---

## 8. RUNTIME-REACHABLE WITH NO OBJECTIVE, NO TASK **AND** NO TEST

Nine modules have **zero test files importing them directly**. Verified twice — by import graph, and
by `grep -rl <name> backend/tests/` (which also caught the two `.pyc`-only matches above).

| module | lanes | in register | second-technique check |
|---|---|---|---|
| `point_direct_fallbacks` | serve fallback (PATH 2c) | no | 0 test files mention it |
| `pressure_ingestion` | ingestion | no | 0 test files mention it |
| `wind_gates` | ingestion | no | 0 test files mention it |
| `wind_mid_res_ingestion` | ingestion | no | 0 test files mention it |
| `euro_marine_coarse_ingestion` | ingestion | no | mentioned only by `test_flag_lane_parity.py` (a YAML-parity test, does not import it) |
| `viewport_upstream` | serve | no | `.pyc` only |
| `wind_pilot_multi` | ingestion | no | `.pyc` only; exercised **indirectly** via `test_gfs_wind_pilot_multi_bbox.py`, which imports `wp.scheduler` |
| `sim_boot` | sim process | no | mentioned by `test_sim_every_surface_reads_the_served_curve.py` |
| `sim_briefing` | sim process | no | same |

Plus, outside `weather_pipeline/`: **`services/forecast_ingester.py`** — 97 LOC, runs first on every
ingestion cycle in both lanes, **0 tests, 0 register rows** (§4a).

Honest scope note: several of the nine are exercised *transitively* by tests that import
`wp.scheduler` (19 test files) or `wp.store` (38). "No direct test importer" is the measured claim;
"untested behaviour" is not.

---

## 9. ROUTE SURFACES IN SCOPE

`routes/weather.py` — 11 endpoints: `/products`, `/grid_series`, `/grid`, `/point`, `/spot-ratings`,
`/buoy-calibration`, `/report-calibration`, `/status`, `/capabilities`, `POST /client-diagnostics`,
`/diagnostics-log`.
`routes/weather_ingest.py` — 19 admin-gated ingest endpoints.
`routes/surf_data/` — `alerts.py` 13, `surfboards.py` 8, `waves.py` 7, `surf_log.py` 6,
`conditions.py` 4, `checkins.py` 3, `surf_reports.py` 3 = **44** endpoints.
`conditions.py` already carries WS-CAN-0009 (nine 200-with-error sites) and WS-CAN-0064
(p50 ~52-59 s) — both open, both correctly scoped to one file; not re-reported here.

---

## 10. FILES WRITTEN BY THIS INVENTORY

* `audit/weather-simulation-12.2/evidence/source-inventory/be-pipeline.md` (this file)
* `audit/weather-simulation-12.2/evidence/source-inventory/be-pipeline-module-table.md` (86 rows)

No production source, test, config, lockfile or env file was read-modified. No git operations were
performed. No credential values appear in this document.
