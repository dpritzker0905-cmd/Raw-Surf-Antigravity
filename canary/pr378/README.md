# Isolated #378 diagnostic canary

Owner authorized an isolated deployment on 2026-10-18 with the guard disabled.
Backend source is unchanged from `6fbf439ac2bb2da5337f9a45864ffd3af8be8423`.
This adapter and its immutable control fixtures are additional code, identified separately.
This branch is a diagnostic deployment artifact; do not merge it into dev or main.

Build from repository root:

```sh
python canary/pr378/verify_source.py && pip install -r canary/pr378/requirements.txt
```

Start from repository root:

```sh
python -m uvicorn canary.pr378.app:app --host 0.0.0.0 --port $PORT
```

Create a fresh web service, Free compute plan, auto-deploy disabled, no project environment,
environment group, secret file, disk, database, cron or worker. Do not clone or reconfigure
an existing service. Required explicit non-secret environment values:

```text
PYTHON_VERSION=3.12.8
PYTHONDONTWRITEBYTECODE=1
ESTIMATE_COHERENT_TRENDS=0
TESTING=1
NODE_ENV=test
L2_WRITER=0
L2_WRITER_GATE=1
DISABLE_FORECAST_SCHEDULER=1
```

HTTP health check: `/healthz` (process/fixture integrity, not weather freshness).
`/identity` reports the #378 base, adapter deploy commit and hash, source and fixture hashes,
effective guard, fixture time, integrity, and application network tripwire results.
`/api/health/data` reuses the actual #378 HTTP handler with an in-memory ProductStore seam,
and the unmodified health computation and provenance validation modules. The full server,
database, real ProductStore and scheduler never start. Ratings remain intentionally
unconfigured under the real helper's TESTING/no-Supabase branch.

The public weather metadata capture has 11,339 records and is replayed at its fixed
`2026-10-18T13:30:00+00:00` time. Its expected aggregate HTTP status is **503**;
real warnings remain visible. The captured byte SHA-256 is
`3aa2f06c0d5a42a5196116a6a7aacfe5703414fb86b599e64e12cee291fa1932`.
No production users, database records, credentials, or private storage objects are included.

Use `?case=ICON-valid` or the EURO equivalent, replacing `valid` with `conflict`,
`missing_provider`, `utc_underflow`, `utc_overflow`, or `stale_gfs`. These fixtures were
generated offline using the actual estimator and manifest serialization helpers at the pin.
Valid cases return lane `ok`/HTTP 200; malformed metadata warns/HTTP 200; stale GFS
donors remain critical/HTTP 503. Source, capture, and control hashes are checked at startup.

An application-level outbound socket/DNS tripwire blocks connection attempts and has a
positive control. This is not an OS firewall or a claim of Render network-policy isolation.
The primary data boundary is no credentials, connections, full routes or jobs. This canary
does not qualify full-server deployment, live ingestion, browser E2E, guard-enabled behavior,
numerical forecast accuracy, or production readiness. Delete only this new service when
the diagnostic environment is no longer needed. Never roll back or promote the shared API.
