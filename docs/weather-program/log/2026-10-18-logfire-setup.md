# Local Logfire backend setup

Started 2026-10-18 14:04Z (recorded after setup actions). Owner requested the
Logfire wizard, selected US and their project, renamed that project, then
requested `logfire[system-metrics]` installation and project selection. Owner
also explicitly approved one synthetic FastAPI request and about three seconds
of basic local host/process metric export. No served forecast number changes.

## Implemented locally

- Installed uv for the Windows user and created a gitignored Python 3.12.10
  `.venv` matching the backend runtime. Installed pinned Logfire 4.41.0 with
  FastAPI and system-metrics extras; existing FastAPI/httpx/Pydantic/psutil pins
  were retained. `backend/pyproject.toml` is pytest configuration only, so the
  durable dependency is in the existing `backend/requirements.txt`.
- Verified browser authentication with the Python SDK CLI, selected the owner's
  renamed project, and read back its identity using `whoami`. Project credentials
  are gitignored. Organization/project identifiers are omitted from this tracked
  log under the repository's credential/identifier rule.
- Added `services/logfire_setup.py`, wired immediately after FastAPI creation.
  `LOGFIRE_ENABLED=1` is required; default mode returns before importing Logfire.
  Configure precedes FastAPI and basic system-metrics instrumentation. Request
  headers and endpoint argument capture are disabled; SDK scrubbing remains on.
- Added a bounded smoke script and `docs/runbooks/LOGFIRE-SETUP.md`. The smoke
  app uses the same configuration seam without importing the complete backend,
  running migrations, starting schedulers, or reading backend `.env` files.

## Fresh verification

- Local-only smoke: HTTP 200 and flush complete with export explicitly off.
- Disabled-mode check: SDK is not imported. Syntax compilation and whitespace
  diff check pass. uv dependency check: 41 packages compatible.
- Owner-approved export: HTTP 200, run id
  `dd8b0f1d-cea8-45e0-a52c-214efa9a5db9`, service `raw-surf-api`.
- Queried the exact selected project: the matching marker arrived at
  2026-10-18T14:03:05.461354Z with a non-null parent span id. Queried metrics
  include system CPU/memory/swap/process count and process CPU utilization,
  plus HTTP duration/response size/active requests. Each of the basic system
  metrics returned four points; latest 2026-10-18T14:03:08.555602Z.
- No full backend startup, hosted CI, deployment, production telemetry enablement,
  weather loads, database mutations, merge, or push was performed.

## Windows failures and credential lifecycle

- Native CLI 0.1.14's Python launcher exits at its interactive prompt on this
  machine. Direct native invocation held the prompt, but OAuth storage failed
  because the credential exceeds Windows Credential Manager's size limit.
  The Python SDK CLI successfully authenticated through its supported file store.
- Python TLS needed Windows system roots via truststore; verification remained
  enabled. The sandbox also blocked Python's asyncio loopback socket; only the
  explicitly local-only check was rerun outside it before export approval.
- Automatic review rejected the initial remote smoke; no export occurred from
  that rejected command. Export was run only after the owner's explicit approval.
- SDK `read-tokens create --save` created one 30-day read token, then failed
  because Windows lacks `os.fchmod`; the local file was empty. This unused remote
  token remains until expiry or removal in project token settings. Verification
  instead used a separate in-memory read token with 15-minute expiry. Token
  values were never displayed or placed in tracked files.

## Closeout checks

Focused flake8 gate (`E9,F63,F7,F82`) passed for the changed backend files.
`action_ledger.py verify` passed with 1,402 entries; STATE's anchor was updated by
exact replacement. Docs-only memory audit: 0 FAIL, 21 WARN, 22 NOTE (existing
commitment warnings remain outside this setup). `git diff --check` passed.
Changes remain uncommitted and no hosted environment was modified.

## Real local backend startup (2026-10-18 14:14Z)

Owner: "Enable Logfire locally and verify full backend startup, traces, and system
metrics in raw-surf. Don't deploy anything yet."

Installed the backend's pinned dependencies into the private Python 3.12 venv;
only Linux event loop `uvloop` and unavailable Windows GRIB decoder `pygrib` were
omitted, with the runtime explicitly using asyncio. Added aiosqlite for local
SQLite. uv reports 159 compatible packages. Production requirement pins were not
relaxed. No global environment or application `.env` was changed.

Added `backend/scripts/run_local_logfire.py`: Logfire enabled in the child process,
loopback-only Uvicorn, isolated private SQLite, no inherited provider credentials
or dotenv loads. Existing TESTING=1 suppresses external scheduler/restore/prefetch
jobs. This is the real server app and lifespan, not the previous minimal smoke app.

Observed: Uvicorn reported Application startup complete; SQLite schema initialization
and local mock-profile seeding completed; 1,002 routes loaded. GET `/`,
`/api/health`, and `/openapi.json` returned 200; the database was connected with
141 tables and OpenAPI documented 914 paths. The health payload was DEGRADED,
not healthy: scheduler deliberately stopped by TESTING=1. Weather readiness has
zero products and no durable-store connection. No full external-job or hosted
acceptance is claimed.

Live read-back for service instance
`local-logfire-92ec5126-afba-4c03-8be4-e16e262fd7d7` confirmed the startup marker at
2026-10-18T14:12:54.557581Z and four request traces (root, health, OpenAPI, second
health request). Each basic system/process metric returned 15 points at query
time, latest 2026-10-18T14:14:06.751473Z. HTTP request metrics also arrived. One
15-minute in-memory read token performed these queries; no token was persisted
or displayed. Local ignored receipt and filtered telemetry JSON retain evidence.

The backend remains running on loopback port 8765 with local Logfire enabled.
Lint, syntax, diff checks and the 159-package compatibility check passed.
No deploy, push, merge, production flags, shared database, or forecast loads.

## Local scheduler and real bounded forecasts (2026-10-18 14:22Z)

Owner: "Enable and verify the scheduler and forecast jobs locally so we can
complete backend health verification. Keep data isolated, verify telemetry in
raw-surf, and don't deploy anything."

Restarted the session-owned backend with `--enable-jobs`. The private SQLite DB
is retained; all default ProductStore instances and legacy forecast caches are
redirected under `.logfire/`. Application dotenv loads and inherited provider
credentials remain excluded. After real startup completes, TESTING changes to 0
before starting the actual scheduler: no upstream-failure mock substitution is
permitted. The native large multi-model forecast aggregate is explicitly paused.

Two bounded one-shot jobs invoke the real legacy wind/marine ingestion functions
through APScheduler and the existing tracked wrapper. These fetch live public
provider data, validate a true success return and populated hourly arrays, and
emit parent job spans plus outcome markers. Both completed once, with local
ScheduledJobStatus success_count=1 and failure_count=0. Wind: 40 points, 48 hours,
1,920 non-null speeds. Marine: 40 points, 48 hours, 1,152 non-null wave heights.
Payload timestamps span 2026-10-18T00:00 through 2026-10-19T23:00. No fixture flags.

Health now returns healthy: database PASS and scheduler PASS, 20 native jobs
registered. This is specifically the health endpoint's two checks. The conformed
ProductStore remains empty and its durable store disconnected. The full native
multi-model GRIB/Copernicus forecast cycle remains paused and UNVERIFIED; bounded
legacy ingestion success is not full forecast/scientific acceptance.

For exact instance `local-logfire-a7977f27-9a11-4da2-88e7-7ea0be581233`, queried
Logfire job success markers at 2026-10-18T14:19:32.021151Z (wind) and
2026-10-18T14:19:37.032678Z (marine), each with its verified parent job span.
Fresh system/process metrics had 30 points each at the final query, latest
2026-10-18T14:21:57.476656Z. Startup marker and health-request traces also arrived.
The first verification query had an overly broad startup-marker assertion;
corrected it to filter the actual startup span and reran successfully. Read
credentials stayed in memory with 15-minute expiry; no values were displayed.

Launcher/helper syntax and focused lint pass. The backend remains running locally
on port 8765 with scheduler active, native forecast aggregate paused, and telemetry
enabled. No deployment or shared data changes were performed.

## Full-cycle execution started; Gateway added (2026-10-18 14:41Z)

Owner requested the full multi-model native cycle, isolated conformed products,
telemetry readback, and no deployment. The pinned pygrib has no PyPI Windows
wheel, so a private micromamba/conda-forge runtime was installed under `.logfire/`:
Python 3.12.15, pygrib 2.1.8, ecCodes 2.50.0, and the pinned backend stack.
Its dependency check reports 164 compatible packages. No system Python, shell
profile, production requirements or hosted configuration was changed.

Restarted the session-owned backend in that runtime with `--full-forecast-cycle`.
MARINE_INGEST_ALL=1 and INGEST_PILOTS=include; default model horizons retained.
The actual native aggregate runs through scheduler tracking; observers record
each conformed job's return/error and emit per-job spans without replacing fetch,
normalization or model math. False returns count as failures even though the
native aggregate catches them. A complete return still requires product validation.
Subprocess dotenv loads are disabled, TLS verification uses system roots, temporary
GRIB/output data are private, L2 writes and workflow dispatch stay disabled.

Cycle id `d4697b1b-1bcf-4073-b6ae-72e4c9ba73c5`, native start
2026-10-18T14:31:19.451580Z. At this entry it is RUNNING: ICON and GFS global wind
returned true, EURO wind still fetching. The private manifest has 225 products
(112 ICON wind, 113 GFS wind). HRRR's GitHub-only lane reported skipped, not passed.
Owner authorized saved local Copernicus credentials if available; neither default
client credential directory nor User-level credential variables were found.
Copernicus-native acceptance remains unverified; fallback provenance must be explicit.

During the cycle the owner additionally requested application Gateway setup,
their provided US endpoint and OpenAI transport, one gpt-6-luna test, and wiring
existing LLM calls. The downloaded credential was found by path metadata only.
The shell confirmed backend/.env ignored, untracked and not a symlink before
creating a protected user-only file and appending the key assignment without
printing it or overwriting existing content. No secret value entered tracked files.

One synthetic request returned HTTP 200: "Raw Surf Gateway test OK." Model
gpt-6-luna, 25 tokens, reported estimate USD 0.0000061. Querying the exact project
confirmed service PAIG `chat gpt-6-luna` at 2026-10-18T14:36:20.633Z.
Image analysis and review moderation now select Gateway when configured, keeping
their existing guarded models, durable spending reservations and no retries.
The requested test model was not silently added to the spending allowlist.
Gemini-native transport is unchanged. Local launcher offers --enable-gateway
to load only Gateway variables, but the running forecast process was not restarted.

Offline verification: 88 passed, 1 PostgreSQL-specific skip; existing credential,
vision and spending tests plus five local transport checks. Test runner disabled
dotenv loading and used generated fixture credentials; no extra paid request.
Gateway-focused lint and diff checks pass. See docs/runbooks/PYDANTIC-AI-GATEWAY.md.
Full forecast verification remains in progress; this entry does not close it.

### ECMWF mirror diagnosis and local Gateway activation (2026-10-18 14:51Z)

EURO wind's fetcher stack showed multiurl retry sleeping in the ECMWF client's
latest-cycle HEAD probe. Initial manual probes used incorrect URLs and returned
404; these were not treated as provider evidence. Exact URLs generated by the
pinned client returned HTTP 429 on the primary portal and 200 on its official
AWS mirror. Changed only the private full-cycle launcher's supported
ECMWF_OPENDATA_SOURCE setting to aws. Preserved the first report as a private
primary-429 attempt artifact, stopped the session-owned parent/child, and read back
that both old PIDs were absent. Existing conformed products were retained.

Restarted the actual full cycle at 2026-10-18T14:49:02Z under cycle id
`e57b0948-1786-4ff4-b5a1-7e5d1a14b6b6`, with --enable-gateway as authorized by the
owner's Gateway request. Local AI health returned 200, key_configured true and
transport pydantic_gateway, without another paid request. Forecast subprocess
bootstrap explicitly removes the unused Gateway secret from its environment.
The new native cycle is still running; its exact results require later readback.

### Same-cycle AWS index failure; official Google mirror (2026-10-18 15:08Z)

The AWS attempt passed cycle discovery but remained in native get_parts/retrieve.
Bounded metadata GETs found the selected 06Z index returned 503 on AWS while the
00Z index returned 200. The official Google mirror returned 200 for the exact same
06Z index; no older-cycle substitution was accepted. Preserved the AWS attempt's
private report and restarted with the supported ECMWF_OPENDATA_SOURCE=google.
All model/horizon and normalization code remain unchanged; completed wind stages
are rerun rather than accepted merely from retained files.

Current cycle `91f0627d-0da4-4810-9a63-3a8f627decd1` started at
2026-10-18T15:07:55Z. Both Gateway and full native forecast mode are enabled locally.
The previous AWS attempt's completed ICON/GFS outcomes and fresh instance metrics
were queried in Logfire (163 samples per basic system/process metric through
2026-10-18T15:02:54.896780Z); no cycle error spans appeared at that interim query.
That telemetry is attempt-scoped and does not qualify the current cycle or the
still-unexecuted marine/pressure/pilot jobs.

### Current-cycle interim telemetry and Gateway closeout (2026-10-18 15:29Z)

Read-only Logfire queries for cycle 91f0627d-0da4-4810-9a63-3a8f627decd1 confirmed
the returned ICON/GFS/EURO global wind outcomes under trace
01a14f8e1ac3c024b8c047445bf45ea4. Six basic system/process metric series each had
249 samples through 2026-10-18T15:29:03.743951Z for the current service instance.
No cycle-scoped error records appeared at this interim query. GFS global marine
was still running, with an active isolated child process; marine, pressure and
pilot acceptance remains pending. This is not a complete-cycle pass.

Gateway implementation and the one paid setup request are complete as recorded
in docs/runbooks/PYDANTIC-AI-GATEWAY.md. Rechecked backend/.env by metadata and git
only: regular non-link file, ignored and untracked. No credential contents were
printed. No additional paid model request, deployment, push or hosted change was
performed. Store-validator counts now say non-estimated rather than native:
the product flag alone is not independent provider-provenance evidence.

### Owner-requested continuation and stricter readback (2026-10-18)

Continued the existing private cycle without restart, horizon caps or deployment.
GFS marine completed 113 native forecast steps with zero failed steps. EURO marine
could not authenticate Copernicus; its existing Open-Meteo fallback wrote 56
estimated wave frames, while the separate GFS component fetch hit the Open-Meteo
429 circuit breaker. Its true job return therefore does not establish complete
marine components or native EURO provenance. ICON marine continued downloading
from DWD; pressure/extension/pilot stages were not yet run at this readback.

The interim store contained 832 schema-valid current-cycle products. Loopback
readback verified five present core grids, exact served-frame identity and healthy
database/scheduler checks before and after. Missing groups were explicitly
reported, not fetched on demand. Strengthened the standalone store validator to
check duplicate names, confined paths, complete core/component groups, timestamps,
all finite valid-cell fields, source/model-cycle provenance, per-region counts,
three-hour interior gaps, stable manifest and content hashes. One live-product
positive control and six altered private-copy negative controls passed. These
verification-only changes alter no forecast math or served numbers. Full-cycle
completion and final store/telemetry acceptance remain pending.

### Regional native-step failure observed during continuation (2026-10-18)

The GFS Marine Pilot's 16-region NOAA pass reported 64 successful steps and one
failed step: f180, index missing all 12 required wave messages. Direct private-file
readback found affected regional waves frames at 2026-10-26T00:00:00Z with zero
valid vectors, while the same-time global-coarse waves frame retained 538 valid
vectors. The enclosing job continued; no repair, deletion or substitution was
made. This provider failure must remain visible even if the job returns true.

Changed only the standalone verifier to collect every invalid manifest product
and fail the gate after writing the full report, rather than abort at the first
bad file. Nine private controls passed, including all-invalid frames and two
simultaneous invalid entries; live forecast data was not modified. Final native
failure counts, invalid-product counts and terminal telemetry remain pending.

### Terminal local cycle and independent failed acceptance (2026-10-18 17:08Z)

The cycle finished at 17:03:19Z after 23 true conformed-job returns and manifest
pruning. Independent full-store validation checked 10,899 entries: 10,802 passed
usable-data checks; 97 contained no valid vectors. Of these, 64 align with the
16-region GFS f180 failure and 33 are other GFS swell frames whose cause remains
unestablished. EURO swell_1/swell_2/wind_waves remain absent. No old-cycle products
were found and the manifest stayed stable during the scan. The strict gate exited
1; native true returns do not supersede that failure.

Nine sample HTTP grids and before/after database/scheduler health passed. Logfire
readback confirmed the ended parent span, all 23 job outcomes, request traces and
finite host/process samples through 17:07:19Z. Exported a separate validation audit
and read it back as ERROR/incomplete with matching 10,899/97 counts and structured
provider failures. Frozen credential-free private reports and console evidence
under completed-forecasts. The local backend/scheduler remains running; no hosted
or shared forecast state changed. Detailed scope, all findings, provenance limits
and verification controls are in
`docs/runbooks/LOCAL-FORECAST-VERIFICATION-2026-10-18.md`. No forecast math or served
number was changed; this work adds verification and records failures.

### Owner-authorized local forecast repairs (2026-10-18)

Owner authorized fixing the local failures, recovering EURO components and empty
GFS frames, rerunning store/telemetry verification, and no deployment. Added
default-off EURO_MARINE_FALLBACK_CACHE_REUSE, MARINE_EMPTY_FRAME_FALLBACK and
NOAA_WAVE_INDEX_RETRY controls, registered for local ingestion only until a future
owner-approved hosted rollout. Three failing-before recovery regressions now pass;
the expanded suite has 76 passing checks, including normalizer, horizon, flag-lane,
retry/refusal and fallback-source controls.

The EURO fallback now can reuse the already-populated NOAA coarse cache instead
of another rate-limited GFS request. Empty regional GFS frames can use only a
same-valid-time real GFS parent, with estimated labels, actual coarser resolution,
source product/run identity and disclosed cell-support margin. No missing
partition is synthesized from total waves. The native index retry is bounded and
does not immediately repeat refused/rate-limited responses.

Read-only feasibility found real parents for all 97 empty products. Stopped only
the idle session-owned local backend to prevent concurrent manifest writers.
Recovery is preserving failed originals, restoring frames, refetching the affected
native regional batch, and refreshing the NOAA cache/EURO fallback and extensions.
All credentials except the selected Logfire account are excluded, dotenv disabled,
L2_WRITER=0 and workflow dispatch disabled. Final recovery counts and verification
remain pending. A sandbox-only asyncio socket-creation stall in the first dry run
was stopped and rerun successfully with loopback access; it was not a product fault.

### Recovery corrections and restart readback (2026-10-18)

Corrected the cached NOAA fallback stride: the source is already three-hourly,
so the EURO component save step must be one. An initial recovery process had
already imported the earlier stride; a subsequent isolated backfill restored all
339 component frames. A new regression checks that source cadence. Moved fixture
rejection before recovery replacement and added a laundering refusal control.

Restart revealed a separate producer/validator mismatch: 16 bounded EURO
interpolation frames were quarantined because the validator did not recognize
the real lattice basis and the producer omitted nonzeroCount metadata. Preserved
the quarantine originals, added default-off EURO_MARINE_LATTICE_VALIDATION with
strict native bracket, time, weight, geometry and cycle checks, regenerated the
16 frames, and restarted. No products were quarantined. The validator regression
failed before the fix with the actual source-dataset rejection, then passed;
wrong weights, wide brackets and missing parents remain refused.

Current local suite: 159 passed; nine independent store-verifier controls passed.
Twelve HTTP grid samples and backend health passed. All 97 original failed slots
have usable replacements: 63 native 0.25-degree, 28 estimated 2-degree and six
estimated 10-degree. No prior future logical slots lost. Native Copernicus
credentials remain absent, so the EURO components are explicitly GFS fallback.
Ledger 1417 records this action; final whole-store/telemetry acceptance follows.

### Referenced-object tail repair (2026-10-18)

The next stable whole-store scan found three missing EURO tail files while all
other 11,495 products validated. No core/component group or cadence gap remained.
Tracing pruning identified old and new registrations sharing filenames. Enabled
the existing default-off INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS guard only in
the isolated recovery launcher, restored the fallback component products from
real GFS parents, and restarted. No products quarantined; bounded scheduler jobs
succeeded. Expanded suite including existing shared-object pruning tests:
186 passed. Ledger 1418 records this action. Intermediate failing evidence remains
private, and final store and telemetry readback is pending below.

### Final recovery acceptance (2026-10-18 18:29Z)

Strict whole-store gate passed at 18:28:19Z: 11,498 checked/validated, zero invalid,
missing required groups, older-cycle products or interior coarse/mid wind/marine
cadence gaps; manifest stable. All 97 original slots usable, no lost future slots;
63 native and 34 coarser estimated as recorded above. Final restarted backend is
healthy, and all 12 HTTP samples passed including all three repaired EURO tail
frames at 2026-11-01T12:00Z. Original full-cycle and intermediate failures remain
preserved; this is targeted recovery, not a second full aggregate run.

Logfire readback confirmed the completed recovery span, all eight successful
recovery outcomes, final validation status passed with 11,498 checked/zero invalid,
15 backend request traces and fresh finite system/process CPU and memory metrics.
An immediate first query preceded validation-record arrival; a second readback
of the same export passed. No extra model request was made. Final suite 186 passed;
local environment is not CI. Copernicus native partition access remains unavailable;
GFS fallback labels and coarser-resolution limitations remain explicit. All data
stayed isolated, no deployment/push/merge/shared forecast writes. Local backend
remains running with aggregate forecast paused. Recovery report and AFTER scoreboard
row record the measured result.

### Fresh full-cycle rerun started (2026-10-18 18:32Z)

Owner requested a fresh full multi-model cycle with the repairs, isolated store
and telemetry verification, failure reporting and no deployment. Prior repaired
backend stopped while idle; its dataset and all earlier evidence remain intact.
A private copy of the existing launcher points to a new empty ignored cycle
directory (separate SQLite, products, caches and temporary files). All existing
local recovery controls and referenced-object prune protection are armed only in
that process. All models and pilots enabled; no mock fallback. An observer pauses
the aggregate scheduler after one terminal cycle. No Gateway credential is loaded
for this forecast-only rerun. Legacy wind and marine fetches completed; conformed
jobs and independent verification pending. Ledger 1420 records the authorization.

### Fresh-cycle interim cadence finding (2026-10-18)

After all mid-tier jobs returned, the independent manifest check found 16 missing
interior three-hour slots in each EURO global_mid lane (marine/waves and wind/wind),
first missing time 2026-10-24T03:00Z. Each has 65 native frames. The full-cycle
scheduler runs the lattice job among core jobs, before mid-tier ingestion, and
has no second lattice pass after pilots. This is a fresh-store orchestration gap;
the prior targeted recovery filled those lanes separately. No new source repair
or backfill was applied during this verification run. Regional ingestion continues,
and the terminal gate will recheck the finding. Ledger 1421 records the evidence.

### Fresh full-cycle terminal verification (2026-10-18)

The new empty-store cycle ran 18:32:26Z to 20:02:15Z (89m49s). All 23 conformed
jobs returned true; pruning completed and aggregate scheduling automatically
paused. Whole-manifest gate checked and validated all 11,236 products, with zero
invalid/fixture/stale-cycle products or missing required core/component groups,
and a stable manifest. Global-coarse wind/marine cadence is complete within the
available horizons. The strict gate nevertheless exited 1: 16 missing slots each
in EURO mid-tier waves and wind (32 total). An additional regional audit checked
169 lanes and found eight missing slots each in 14 EURO wind lanes (112 total).
Regional lanes are excluded from the existing lattice sweep, so moving its pass
after mid-tier ingestion alone would not fix all 144 slots.

759 EURO marine contract checks and 30 GFS recovery provenance checks passed;
the latter all disclose 10-degree real exact-time parents. All 20 native fetch
summaries report zero failed steps, including GFS marine 113/65/113-step passes.
Native Copernicus access still failed for absent credentials; all three EURO
component lanes automatically saved 113 estimated GFS fallback frames each.
Healthy backend and 12 exact-time HTTP grid samples passed, including all three
EURO component tails. No post-cycle backfill was performed.

Terminal raw-surf readback passed: completed cycle span, all 23 matching job
outcomes, backend request traces, finite system/process CPU and memory samples,
and the exact incomplete validation audit (112 regional gaps, zero EURO contract
failures and provider status degraded). The 16 recorded backend file hashes did
not change. New report LOCAL-FORECAST-FRESH-CYCLE-2026-10-18.md holds final evidence,
limits and causes. Prior repaired dataset remains separate. Ledger 1422 records
terminal verification; SCOREBOARD and STATE distinguish warm recovery from this
fresh cold run. No deployment, push, merge or shared forecast writes.

### Owner-authorized lattice repairs and new empty-store rerun (2026-10-18)

Fixed the fresh-cycle orchestration and regional wind scope behind two new
default-off controls. LATTICE_FILL_AFTER_PILOTS moves exactly one lattice pass
after all selected producers for include/skip/only pilot modes. The default-off
path preserves the prior order. LATTICE_REGIONAL_WIND_FILL adds existing regional
wind lanes; it requires non-fixture, non-estimated, authoritative native parents,
a shared verified timezone-qualified model cycle, matching geometry/cell positions
and no wider than six-hour brackets. Estimated labels, source references, model
cycle, region/tile identity and actual resolution are retained. Marine regional
scope and interpolation math remain unchanged. Only the isolated launcher arms
these controls; no hosted flags changed.

Three intended failing-before tests reproduced early/missing lattice execution
and missing regional fills. Integrated suite: 205 passed, including pilot modes,
default-off controls, fixture/estimated/unknown/conflicting-cycle/shifted-cell/wide
bracket refusals and prior recovery regressions. The local interpreter still
reports two absent declared packages; no CI qualification claimed.

A read-only overlay replay against the failed cycle wrote 144 estimated products
to a separate private output store, checked provenance/contracts, and closed all
interior wind/marine gaps across tiers. Original manifest remained byte-identical.
This is replay evidence, not a fresh provider cycle. Prior session-owned backend
stopped idle. Another new empty private store/SQLite/cache/temp directory is now
running the full native cycle with both controls plus the earlier recovery guards.
1,449 backend source file hashes recorded. No prior forecast products copied;
aggregate will pause after one terminal cycle. Ledger 1423 records authorization,
repairs, replay result and the pending fresh-cycle qualification.

### Repaired fresh cycle terminal result (2026-10-18)

The full empty-store cycle ran 20:24:30Z to 21:49:12Z (84m42s). All 22 producer
methods completed before exactly one lattice pass, which ran 23rd and saved 160
estimates, including 32 mid-tier and 112 regional wind estimates. Pruning finished
and aggregate scheduling paused. All 1,449 recorded backend source hashes stayed
unchanged. There was no post-cycle backfill.

Whole-store strict gate exited 0 at 21:52Z: 11,376 checked/validated; zero invalid,
fixture, pre-cycle or missing required-group products; stable manifest. No interior
coarse/mid wind-marine gaps. Regional audit checked 169 lanes and found zero gaps.
All 144 exact timestamps missing in the previous failed cycle are now present.
144 finer-tier interpolation products passed real native parent/time/weight/cycle/
resolution checks. 775 EURO marine contracts and 30 GFS coarser-recovery provenance
checks passed; those GFS recoveries all disclose 10-degree parents. All 20 native
fetch summaries reported zero failed steps. Three EURO components automatically
saved 113 GFS fallback frames each; native Copernicus credentials remain absent.

Healthy backend and 12 core/component HTTP samples passed. Azores and Hawaii
regional wind at 2026-10-24T15:00Z served exact interpolated estimates, without
substitution. Two extended mid-tier HTTP probes FAILED: both waves and wind returned
12:00Z native for 15:00Z, marked frame_substituted=true and is_estimated=false,
despite valid exact-time estimates on disk. mid_res_tier.pick_mid_item prioritizes
the authoritative class before estimates. This remains a serving selection failure,
distinct from the fixed stored coverage; no selector source change was applied.

Terminal raw-surf readback verified the completed cycle, all 23 outcomes, last/once
lattice, passed product store, zero regional gaps, 32/112 finer-tier estimates,
two API failures, provider status degraded, request traces and 18 finite system/
process metric samples. Overall audit intentionally remains incomplete. The first
immediate query preceded audit indexing; bounded readback of the same export then
passed, with no duplicate export. New repair report, AFTER scoreboard row and
STATE record scope and remaining failures; ledger 1424. All data stayed isolated;
no deployment, push, merge, shared forecast writes or hosted flag changes.


## 2026-10-18 22:17Z - Mid-tier exact-time selection repair and local qualification

Owner authorized the mid-tier selection fix, both APIs and raw-surf telemetry,
with isolated data and no deployment. Two intended unit regressions failed before;
70 focused tests passed after. Default-off MID_RES_EXACT_TIME_ESTIMATE reuses the
shared time policy, armed only by the local recovery launcher. Targeted fatal lint
passed through uv because flake8 is absent from the venv. Two declared packages
remain absent from that test interpreter, so hosted CI parity is not claimed.

Stopped the idle original instance and restarted the same private lattice dataset
with all scheduler processing paused and Gateway disabled. No new ingestion cycle.
Archived original failed evidence; preserved native-phase source snapshot and
recorded a distinct post-repair snapshot (four changed backend files including
the regression test), unchanged during serving verification. Wind and marine grid
and grid_series each served exact 15Z estimates and native12Z controls: eight frame
checks with zero substitutions. Four finer-tier and twelve core/component probes
also passed. The first series probe supplied an out-of-window future base_time;
the API disclosed rejection correctly. A documented current anchor plus forecast
offsets passed; both probe records preserved.

Fresh whole-store check22:16:29Z passed11376/11376, zero invalid/pre-cycle/missing
groups or coarse/mid gaps; fresh169regional-lane audit zero gaps. Manifest and
ordered product-content hashes exactly match original native-cycle qualification.
Raw-surf audit22:16:47Z passed with provider degraded and zero API failures;
remote readback confirmed eight selection checks, both route traces,18finite
system/process metric samples on the new instance and all23original cycle jobs.
First audit query preceded indexing; retry verified the same export, no duplicate.

Native Copernicus credentials remain unavailable; three EURO components retain
113labelled GFS fallback frames each. Availability/provenance is not science
accuracy. New repair report and scoreboard row; STATE updated. Ledger1425repair/
restart,1426terminal qualification. No push, merge, deployment, hosted flags,
shared database or shared forecast storage changes. Backend remains local with
all scheduler processing paused.


## 2026-10-18 23:01Z - Copernicus Marine authentication and native component recovery

Owner requested Chrome Marine sign-in, local backend authentication, native EURO
component and raw-surf verification, isolated data and no deployment. Later asked
that native data come through Actions/runs and be free. Chrome sign-in confirmed;
Toolbox token and user-info both200. One incorrect-password attempt failed without
saving credentials. Initial PowerShell helper blocked by script policy; direct
Python prompt succeeded with hidden password entry and unchanged execution policy.
Credential file only in user-restricted gitignored local folder, regular/untracked;
no values printed, tracked, used in subprocess arguments or sent to Logfire.

Copied the existing4.48GiB store independently; physical file identities differ.
Full original11376-product hash readback preserved original manifest/content
hashes. Targeted real thin-band fetch32:57-56:09Z took23m12s:17/17bands,612points,
75native times18Oct18Z-28Oct00Z. Production normalizer/save produced75native
swell_1,swell_2,wind_waves frames each;225validated. Corresponding estimated
manifest entries replaced;11376products retained,38estimates percomponent remain
(two earlier baseline times,36after published native horizon). No new fullcycle.

Authenticated backend8766healthy with private SQLite/cache/store, Gateway off,
all scheduler processing paused. Superseded765server stopped, original data kept.
15component grid/series/tail controls and12core samples passed;775EUROcontracts
and169regional lanes passed zero gaps. Whole-store scan23:00:13Z passed11376,
zero invalid/prebaseline/missinggroups or coarse/mid gaps; stable manifest.
Recovery source hashes unchanged. Final raw-surf audit23:00:47Z passed,225native,
zeroerrors and isolationtrue; readback confirmed recovery/17band/3component spans,
both HTTP routes and18finite system/process metrics samples from EACH process.

Read-only GitHub: PUBLIC repo, published scheduled ubuntu-latest core ingestion
with Marine secrets references and both secret names present. Completed
39165080775 at dev2466e71 independently reports17bands,zero failures and75native+
12extension frames percomponent. Newer run already active; no dispatch, interruption,
settings/credential writes or source publication. Marine data and standard public
runner usage free per official docs; separate storage/hosting/telemetry quotas
not a zero-total-bill guarantee. No paid-service activation or LLM requests.

New report, scoreboard row and STATE close previous missing-native limitation.
Ledger1427auth/recovery-start,1428terminal qualification. No app source change this
phase, push, merge, deployment, hosted flag or shared forecast/database write.
Scientific accuracy and native availability beyond provider horizon not claimed.

Timing clarification for the preceding entry: the native fetch/recovery ran 2026-10-18 22:32:57Z through22:56:09Z; the abbreviated minute/second range above refers to that same UTC hour.

### 2026-10-19 02:43Z — concurrent-audit communication boundary

Created a separate private handoff beside the existing Claude audit handoff, at the owner's request. Scoped Git readback confirms the new communication file is untracked, not ignored; appended a correction to the initial wording without changing Claude's index, ignore rules, source, existing findings or session. The supported tools expose no direct Claude session transport, and the owner does not know an inbox command. Direct notification remains unavailable; final results will be appended to the separate handoff and a paste-ready message supplied. Ledger seq 1430.

Fresh authenticated empty-store cycle remains running. Partial raw-surf readback verified completed global wind job outcomes and finite system/process metrics; an initial indexing-race check failed for the just-completed EURO wind result and a later readback passed. This is progress evidence only, not terminal cycle qualification.

### 2026-10-19 05:34Z - Fresh authenticated full-cycle terminal qualification

Fresh empty-store cycle ran02:31:50-05:22:55Z (171.1min), all23jobs complete with no false/exception results; lattice once last saved176estimates. Entire scheduler paused. All1453backend source hashes unchanged through qualification. Provider summaries report no failure; Marine17/17bands,612points,74native times percomponent (222total). Published component window18Oct21Z-28Oct00Z; later values labelled estimated.

All11285products schema-valid, finite/usable, nofixtures, no pre-cycle processing times or missing required groups.676EUROcontracts and31stored-coarser GFS recoveries (10degree parents) pass;169existing regional lanes have zero interior gaps; no mid-tier gaps.32mid+112regional interpolation provenance checks pass.12core,15native/component/tail,8mid-selection frame and4lattice API controls pass (39populated-slot checks). Exact API/local manifest filenames match; scheduler database records one success and zero failures; local health passes.

FULL COVERAGE FAILS:94missing EURO post-native slots remain after lattice fill:22waves,24each swell_1/swell_2/wind_waves. NativeGFS parents exist at those times with valid vectors. The primary native path reuses three-hourly NOAA cache but normalizes its tail with index stride3, yielding nine-hour spacing; the six-hour lattice cap correctly refuses those holes. Baseline HEAD contains the same stride. This confirms the intermediate finding1432; no semantic repair was applied during this frozen cycle.

Raw-surf terminal span,23same-trace job outcomes, grid/series traces,18finite host/process samples, exact manifest/content digests and incomplete94-slot audit verified. Initial readback rejected a boolean attribute scrubbed for the substring auth; the scrubber stayed enabled and a non-sensitive native-fetch proof name was used for the final export. The earlier scrubbed audit remains visible; final unique validation record matches local evidence.

Postqualification publication-only change removes one trailing blank line in the extracted NOAA helper, guarded by old source hash and identical AST.95affected regressions rerun and passed5.25s. Local interpreter lacks two declared packages; no hosted-CI or production-parity claim. Prior295focused tests and fatal lint/route/size gates passed. Source changes and the old-base ledger require reconciliation before adoption.

Separate authorized Claude communication handoff received the native milestone and94-slot finding; final results/publication pointer will be appended. Existing Claude source, audit findings, index, branch and session were not changed. Direct session transport is unavailable. Superseded8766PID/listener no longer exists; fresh8767healthy and paused, data retained. Feature-branch publication will use skip markers for Netlify and Render; no PR, hosted setting change, shared data write or deployment.
