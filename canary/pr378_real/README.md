# PR378 separate real-grid replay

This branch deploys only the owner's isolated diagnostic canary. Do not merge it
into dev/main or point it at application services, storage or credentials.
No change is made to shared forecast numbers or scientific acceptance.

Provider attribution: DWD GWAM open data; NOAA GFS-Wave Open Data;
ECMWF Open Data wave stream; Copernicus Marine
GLOBAL_ANALYSISFORECAST_WAV_001_027, DOI10.48670/moi-00017. These remain distinct
physical products and transport sources in the evidence.

The archived Python modules are unmodified source from PR378 merge
`6fbf439ac2bb2da5337f9a45864ffd3af8be8423`; the adapter, source archive and real
data bundle each have separate identities. No full server, database, storage SDK
connection, scheduler or provider request runs in the reader.

Capture is a separately named secret-free Linux workflow. It uses the actual
GRIB decoder/regridder with an explicitly sparse acquisition schedule, and actual
normalizer, estimator and ProductStore save/load functions. CMEMS uses six real
point samples from public ARCO chunks plus independently retained producer-listing
evidence; it does not claim production spatial block means. The bounded Pacific
region is -124..-122 longitude, 36..37 latitude, at1degree sampling. True coastal
missing values are retained. All three ICON native layers and four CMEMS layers
are included, plus direct ECMWF total waves and every active GFS contributor.
Different-cycle controls select real earlier GFS anchors; no timestamps are forged.

The deployed process requires these explicit non-secret variables:

```text
PYTHON_VERSION=3.12.8
PYTHONDONTWRITEBYTECODE=1
ESTIMATE_COHERENT_TRENDS=0
L2_WRITER=0
L2_WRITER_GATE=1
DISABLE_FORECAST_SCHEDULER=1
NODE_ENV=development
TESTING=0
LOCAL_TEST_FIXTURE=false
REPLAY_BUNDLE_SHA256=<bundle-pin.json sha256>
```

Create only a fresh Free/Oregon service with no project environment, environment
group, secret file, disk, database, worker or cron; auto-deploy Off. Build from
repository root with:

```sh
python canary/pr378_real/bootstrap.py && pip install -r canary/pr378_real/requirements.txt
```

Start:

```sh
python -m uvicorn canary.pr378_real.app:app --host 0.0.0.0 --port $PORT
```

Use `/healthz` for platform readiness; `/identity` exposes pins/isolation,
`/evidence` exposes the complete capture receipt, and `/products/<filename>` loads
through the actual ProductStore and returns the captured JSON bytes for independent
hashing. `/replay/grid?case=...&valid_time=...` returns only an exact sampled frame;
missing hours return404. `/evidence/cycles?case=...` runs the actual cycle-health
helper at the explicitly declared capture clock. `/api/health/data` executes the
original health handler with actual storage and the current clock; a regional-only
inventory correctly returns503 because operational global lanes are absent.

Application socket/DNS denial includes a positive control. It is not an OS
firewall. These are test-only replay endpoints, not the full application's weather
routes. No global-tier, continuous ingestion, L2 upload/restore, full app/browser,
guard-enabled, day14 availability or forecast-accuracy acceptance is implied.

Run the independent verifier with the local trusted bundle present:

```sh
python canary/pr378_real/verify_http.py https://rawsurf-pr378-real-grid-6fbf439ac.onrender.com --expected-adapter-commit <reviewed-full-adapter-SHA> --output /private/receipt.json
```

The verifier hashes every product body itself and cross-checks every estimate's
recorded contributor identity, cycle, valid time and hash. Synthetic corruption
and startup-refusal controls are separate local checks, never published as real
forecast data. Keep the existing fixture-only canary intact.
