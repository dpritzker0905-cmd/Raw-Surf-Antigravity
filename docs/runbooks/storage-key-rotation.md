# Runbook: the storage key is rejected (rotate, probe, re-run, verify, close)

When: a `storage-auth` issue is open ("Storage credential rejected (HTTP 401/403)"), or Supabase says a key was
disabled or rotated. Cause on record: 2026-11-19/20, HTTP 401 "Legacy API keys are disabled". Ingest, precompute and
the flag guardrail were down 21-25 h before anyone looked.

**NAMES ONLY. This repository is public.** Never paste a key, token or connection string into an issue, a commit, a
PR, a log you commit, or this file. If a value is ever committed, treat it as compromised and rotate it at the provider
(`docs/runbooks/SECURITY-2026-09-19-committed-credentials.md`). Nothing here is automated: no workflow rotates or
writes a secret.

## 1. Update the secret (a person, at each provider)

1. In Supabase (project settings, API keys), create or copy a **secret** key (`sb_secret_...` format). Legacy JWT keys
   (`eyJ...`) are disabled.
2. GitHub: repository settings, Environments, **`supabase-service`**, secret **`SUPABASE_SERVICE_ROLE_KEY`**. Every data
   lane reads it there: forecast-ingest, the pilots, precompute and the flag guardrail.
3. Render: service **`raw-surf-backend`**, environment variable **`SUPABASE_SERVICE_ROLE_KEY`** (the code reads it
   first, then `SUPABASE_KEY`; update whichever the service has). A Render env change takes effect only when the
   process restarts. Verify with `/api/health`'s `uptime`, not with the dashboard's read-back.
4. Local machines: the gitignored `backend/.env`, if it holds the key.

## 2. Probe (read-only)

Actions, **Storage auth probe (read-only)** (`.github/workflows/storage-auth-probe.yml`), Run workflow on `dev`.
- **Green**, with the line `storage credential accepted (HTTP 200, control/flags.json; mode block)`: the key works.
- **Red**, with `Storage credential rejected`: the key is still wrong. Go back to step 1.
- **Inconclusive** (5xx or network): run it again.

It reads one object and changes nothing: no issue, no comment, no write.

## 3. Re-run the lanes

Dispatch, on `dev`: **Forecast Ingestion (decoupled)**, then **Forecast Ingestion Pilots (regional tiles)**, then
**Precompute Spot Ratings (decoupled)**, which also starts after the pilots finish. The **Flag guardrail** runs on its
own about every 12 h; dispatching it needs the owner's word.

## 4. Verify

- Each lane's first step logs `storage credential accepted (HTTP 200, control/flags.json; mode ...)`.
- The Data Health Monitor's next run reads healthy; its `stale-data` issue closes after two healthy runs.
- `/api/health/data` shows the lanes' ages falling.

## 5. Close

The first accepted data-lane run closes the `storage-auth` issue itself, with a "Recovered" comment. If it is still
open after step 4, close it by hand and link the green runs. Add one line to the session log of whoever rotated it.
