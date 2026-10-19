# Logfire backend setup

The backend uses `requirements.txt`; `backend/pyproject.toml` contains pytest
settings only. Install `logfire[fastapi,system-metrics]==4.41.0` using the existing
requirements workflow. For a standalone local environment, from the repo root:

```powershell
python -m uv --system-certs venv --python 3.12 .venv
python -m uv --system-certs pip install --python .venv/Scripts/python.exe --constraint backend/requirements.txt 'logfire[fastapi,system-metrics]==4.41.0' 'fastapi==0.110.1' 'httpx==0.27.2' truststore
```

This minimal environment is for the setup check; it does not install the entire
application. `truststore` is a local check tool for Windows system certificates,
not a backend runtime dependency. Do not disable TLS verification.

Authenticate the Python SDK CLI and select the intended project before running
with export enabled. It stores account credentials outside the repository and
project credentials under the gitignored root `.logfire/`. Never display or commit
either credential. The native CLI's Windows OAuth storage can fail when its
credential exceeds Windows Credential Manager's size limit; the Python SDK CLI
is the alternative used for this setup.

## Enablement

`services.logfire_setup.configure_logfire(app)` runs once when the FastAPI app is
created. It configures Logfire before installing FastAPI instrumentation and
basic system metrics. Set `LOGFIRE_ENABLED=1` explicitly to enable it; otherwise
it returns before importing the SDK and performs no export. Remove that variable
and restart to disable it.

- Service name: `raw-surf-api`.
- Environment: `LOGFIRE_ENVIRONMENT`, default `local`; set explicitly for hosting.
- Version: `RENDER_GIT_COMMIT` when present.
- Credentials: local root `.logfire/`, or `LOGFIRE_TOKEN` through the host's secret
  manager. Production needs its own credential; never deploy a developer credential.
- Capture: request headers and endpoint argument capture are disabled; SDK
  scrubbing stays on. Standard request traces still contain URL/route and error
  information. Review their privacy implications before enabling on private routes.
- Metrics: basic SDK host/process metrics. No AI payload capture, frontend SDK,
  coding-agent exporter, database instrumentor, or global logging bridge is added.

No deployment or hosted environment change is part of local setup.

## Local verification

```powershell
.venv/Scripts/python.exe backend/scripts/check_logfire_setup.py --local-only
```

The check sends a synthetic request through a minimal FastAPI app using the same
setup function as the backend. It checks disabled mode, enabled mode, HTTP 200,
and flush completion, with network export explicitly disabled. It never imports
`server.py`, runs database migrations, starts schedulers, or reads application
`.env` files. Passing it proves local integration only.

After approval to export a synthetic request and basic system metrics, omit
`--local-only` for a bounded ingestion check. Then query fresh data in the exact
selected project, matching the printed `setup_run_id`, service name, and metrics.
Flush completion alone does not prove ingestion. Full backend startup and hosted
delivery require separate verification in an approved environment.

On Windows, SDK 4.41.0's `read-tokens create --save` can create the remote token
and then fail locally because `os.fchmod` is unavailable. Do not repeatedly mint
tokens. This session left one unused read token with the CLI's 30-day expiry;
remove that unused token in the project's token settings when convenient. A
separate 15-minute read token held only in memory verified the approved smoke
run. No token value was printed or written to tracked files.

## Run the real backend locally

```powershell
.venv/Scripts/python.exe -u backend/scripts/run_local_logfire.py
```

The launcher enables `LOGFIRE_ENABLED=1` for that process and binds only to
`http://127.0.0.1:8765` (override with `--port`). It loads all real routes and runs
the real application lifespan, including SQLite table initialization and local
mock-user seeding. It uses the private `.logfire/local-backend.sqlite3` database,
clears inherited provider credentials, and suppresses application dotenv loads.
Its generated JWT signing secret exists only for that process. Restarting the
launcher changes that secret and invalidates its previous local JWTs.

`TESTING=1` deliberately suppresses external schedulers, forecast restoration,
prefetch, and ingestion. The health endpoint therefore returns HTTP 200 with
`status=degraded` and a failed scheduler check, despite the local database check
passing. This mode verifies real app startup and telemetry, not external-provider
functionality or production readiness. No forecast data is loaded.

For this Windows check, the existing backend requirements were installed into
`.venv` with only `uvloop` and `pygrib` omitted; the event loop uses asyncio and
GRIB decoding is outside this validation. `aiosqlite` and local certificate-tool
`truststore` are also required. A generated Windows requirement list is under
the ignored `.logfire/` directory; production requirements are not relaxed.

The startup receipt is `.logfire/local-backend-receipt.json`; it records the URL,
PID, route count, run ID, and exact telemetry service instance. Stop the process
with Ctrl+C in its owning terminal. Closing it ends local telemetry; no global
environment or hosted configuration is changed by the launcher.

Verified on 2026-10-18: actual lifespan completed, 1,002 routes loaded; `/`,
`/api/health`, and `/openapi.json` returned 200; database connected with 141 tables;
OpenAPI exposed 914 paths. Fresh startup marker, request traces, and system/process
metrics were queried for that exact backend instance in the selected project.
The degraded health result above remains an explicit local-mode limitation.

## Scheduler and bounded live forecasts

```powershell
.venv/Scripts/python.exe -u backend/scripts/run_local_logfire.py --enable-jobs
```

Stop the previous instance before reusing its port. This mode starts the real
application scheduler after the isolated lifespan has finished, then sets
`TESTING=0` before forecast execution so failed upstream calls cannot become mock
data. Default ProductStore instances and legacy forecast cache writes are directed
under the private `.logfire/` directory. Provider credentials and application
dotenv files remain excluded; shared Storage writes and workflow dispatch stay off.

Two one-shot jobs invoke the real `ingest_global_model('wind')` and
`ingest_global_model('marine')` functions through APScheduler and the existing
`tracked()` wrapper. They fetch live public-provider data, require a successful
return and populated hourly arrays, and record a Logfire span and success/failure
marker. Failure raises into tracking; no test-data fallback is used.

Verified on 2026-10-18: each job completed once with zero failures in the local
`scheduled_job_statuses` table. Wind stored 40 points / 1,920 non-null wind-speed
values; marine stored 40 points / 1,152 non-null wave-height values. Both payloads
contain 48 hourly timestamps and no `is_test_fixture` flag. Health returned
`healthy`, database and scheduler checks passed, and 20 native jobs were registered.
Both job success markers, their parent forecast spans, API traces and fresh
system/process metrics were queried in the selected Logfire project.

**Scope limit:** the native `ingest_marine_forecast` aggregate remains paused.
This bounded validation covers the legacy forecast ingestion functions, not a
complete GFS/EURO/ICON/Copernicus cycle. The conformed ProductStore still has zero
products and no durable-store connection; the health endpoint's two passing checks
do not certify that broader weather readiness. Do not present this as full forecast
pipeline acceptance or scientific validation. The one-shot jobs do not recur;
restarting this explicit mode runs them again. Other native scheduler jobs remain
registered against the isolated local database.

## Full native multi-model cycle

The full mode requires a GRIB-capable runtime. The private Windows runtime at
`.logfire/grib-runtime` contains Python 3.12, conda-forge pygrib 2.1.8/ecCodes,
and the pinned backend dependencies (uvloop is Linux-only). Its micromamba root,
package cache and bootstrap are also private under `.logfire/`; no shell profile
or system Python was changed.

```powershell
.logfire/runtime-bootstrap/Library/bin/micromamba.exe --no-rc --root-prefix .logfire/mamba-root run --prefix .logfire/grib-runtime python -u backend/scripts/run_local_logfire.py --full-forecast-cycle --enable-gateway
```

This enables the actual native aggregate rather than the bounded legacy adapters.
It selects all marine models and includes regional pilots, retaining default model
horizons. It does not enable experimental flags, shared Storage writes, or the
GitHub-only HRRR publisher. Copernicus-native jobs need their own credentials;
none were found in the default local client store during this setup. Existing
provider fallbacks must retain their provenance and do not prove Copernicus-native
acceptance.

The private launcher selects the supported official Google ECMWF mirror. During
this run the primary portal returned 429, and AWS returned 503 for the selected
06Z index while the same index returned 200 on Google. Mirror choice changes
transport only; no model date/time, native horizon, normalizer or forecast math
is replaced. Interrupted attempt reports and products are preserved privately;
retained products cannot by themselves qualify a new attempt.

Fetcher subprocesses use system certificate trust, a private temp directory,
disabled dotenv loading, and no inherited Gateway API key. The full-cycle probe
records conformed job return values/errors and emits nested Logfire spans. It
marks false returns as failures even though the native aggregate logs completion.
A normal return is still subject to independent product validation.

Read `.logfire/full-forecast-cycle.json` for the current attempt, and
`.logfire/local-backend-receipt.json` for its exact instance/PID. After the cycle
settles, require both complete core coverage and fresh products:

```powershell
.venv/Scripts/python.exe backend/scripts/check_local_forecast_store.py --require-complete --require-current-cycle
```

This checks every referenced local file against the schema, grid dimensions,
finite valid-cell values, and non-fixture status; reports non-estimated/estimated counts
and time ranges; and requires GFS/EURO/ICON wind, marine waves and pressure groups.
It also requires swell_1/wind_waves for all three models and swell_2 for GFS/EURO
(ICON swell_2 is unsupported). It records region counts, model-cycle provenance,
manifest/product-content hashes and missing interior three-hour coarse frames.
Complete validation requires the manifest to remain stable during the scan.
Invalid products are collected in the report and fail the gate after the scan;
an all-masked frame is not counted as a valid populated forecast. Provider step
failures and partial fallback results must be reconciled separately from true
job returns, which do not establish completeness.
It refuses retained products from an earlier attempt when freshness is required.
It does not prove forecast accuracy or qualify deployed performance. Final
telemetry must be queried for this exact attempt rather than a previous run.


## Authenticated local Marine runs

`backend/scripts/run_local_logfire.py --enable-copernicus` opts into the saved
Toolbox file at `.logfire/copernicus-auth/.copernicusmarine-credentials`.
The loader refuses a missing, tracked, nonignored or symlink credential path.
It reads only Marine credentials; unrelated application dotenv values stay out.
The opt-in replaces Marine subprocess argument payloads with stdin transport,
while executing the original fetcher source and retaining its timeout and return
handling. This keeps credential values out of OS command lines and timeout text.
It does not alter forecast calculations or hosted configuration. Five transport
regressions cover both fetchers, timeout privacy, idempotence, unrelated provider
passthrough and rejection of unexpected target paths. No credential values belong
in this document or in committed output.

Full local qualification combines `--full-forecast-cycle`,
`--enable-forecast-recovery` and `--enable-copernicus`; use a fresh private data
folder/launcher and pause the scheduler after the single requested cycle. The
session's ignored launchers supply this isolation and one-cycle pause guard.
Native data availability, conformed-store checks, exact-time APIs and remote
telemetry require separate terminal verification after jobs return. A green
scheduler result alone does not qualify data or scientific accuracy.
