# Decoupling forecast ingestion off the Render web box (GitHub Action → Supabase L2)

**Why.** Two months of forecast UX bugs (scrub lag, model-switch stale, heatmap-blank, OOM) trace back to
one root the memory keeps re-deriving: **heavy GRIB-decode ingestion runs on the same 1-CPU/2 GB Render
box that serves the API + frontend.** Decoding 2.9M-cell icosahedral ICON GRIBs (and the GFS/EURO grids)
contends with request latency. The fix is to move ingestion **off** the serving box.

**Shape.** The same ingestion (`scheduler.forecast.ingest_marine_forecast_task` — NOAA/DWD/Copernicus
direct + open-meteo fallback) runs in a **GitHub Action** on an ephemeral runner, writes the normalized
products + `manifest.json` to **Supabase Storage L2** (`ProductStore._upload_to_supabase`), and the Render
box **restores from L2** (`restore_from_supabase`) and only serves. Ingestion compute never again competes
with serving.

```
GitHub Action runner ──ingest──▶ Supabase L2 (manifest.json + product JSON) ──restore──▶ Render (serve-only)
```

## Files
- `.github/workflows/forecast-ingest.yml` — the workflow (phase-1: manual `workflow_dispatch` only).
- `backend/scripts/ingest_forecast_ci.py` — entrypoint; reuses the production task, then prints L2
  persistence diagnostics so a run **self-verifies** the Supabase round-trip. Exits non-zero if no upload.
- `backend/scheduler/__init__.py` — `DISABLE_FORECAST_SCHEDULER` switch (default OFF). Set to `1` on
  Render to make it serve-only. **This is the only cutover toggle.**

## Required Action secrets (Repo → Settings → Secrets → Actions)
| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | L2 target (REQUIRED) |
| `SUPABASE_SERVICE_ROLE_KEY` | L2 write auth (REQUIRED) |
| `COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD` | EURO marine; **use the SAME names/values your Render env uses** |
| `WEATHER_PROXY_URL` | open-meteo fallback proxy (optional) |

## Verify → cutover sequence (do NOT skip the verify)
The decoupling's correctness depends on the **L2 round-trip**, and `restore_from_supabase` is marked
untested in memory ([[l2-supabase-upload-unbound-response-2026-06-26]] — only the *upload* side was fixed).
So prove the round-trip before flipping anything:

1. **Add the secrets** above.
2. **Run the Action manually** (Actions tab → "Forecast Ingestion (decoupled)" → Run workflow). It must
   end green and print `L2 DIAGNOSTICS: {... last_upload_time: <recent>, last_upload_errors: [] ...}`.
   A non-zero exit ⇒ Supabase creds wrong or upload failing — fix before continuing.
3. **Verify the restore on Render** (the still-unproven half): restart the Render service (or hit the
   restore path) and confirm fresh products appear — `curl <render>/api/weather/products` shows the
   `run_time`s the Action just wrote, and `get_persistence_diagnostics` shows `restored_count > 0`.
   If restore is broken, that's the one bug to fix here (it lives in
   `services/weather_pipeline/store_helpers.restore_from_supabase_helper`) — do NOT cut over until it works.
4. **Cut over** once 2+3 are solid:
   - Uncomment the `schedule:` cron in the workflow (every 3h at :15).
   - Set `DISABLE_FORECAST_SCHEDULER=1` on the Render web box → it stops in-process ingestion (serve-only).
   - Kept reversible: unset the env var to instantly fall back to in-process ingestion; comment the cron.

## Known open item (needed for CONTINUOUS decoupling, not for phase-1 verify)
Render currently restores from L2 **on startup only**. After cutover, fresh Action ingestions won't appear
until Render restarts. For continuous serve-only operation, add ONE of:
- a periodic `restore_from_supabase` (e.g. an APScheduler job every ~30 min, gated to run only when
  `DISABLE_FORECAST_SCHEDULER=1`), **or**
- a lightweight authenticated `POST /api/weather/restore` endpoint the Action pings as its last step.

The periodic-restore job is the simpler, no-new-surface option. Implement it as the immediate follow-up to
cutover (it's intentionally NOT bundled here so phase-1 stays a pure, reversible, additive change).
