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
3. **Verify the restore on Render.** The storage3 `.download()` read path is now **VERIFIED working**
   (2026-06-27 Render-shell test: manifest 2.5MB + a sample product both downloaded fine — it was the
   `.upload()` that had the storage3 bug, not `.download()`). Restore lives in
   `services/weather_pipeline/store_helpers.restore_from_supabase_helper` (manifest-only; product grids
   stay lazy via `load_product`'s on-demand L2 download). After the Action run, confirm fresh products
   appear: `curl <render>/api/weather/products` shows the `run_time`s the Action wrote.
4. **Cut over** once 2+3 are solid:
   - Uncomment the `schedule:` cron in the workflow (every 3h at :15).
   - Set `DISABLE_FORECAST_SCHEDULER=1` on the Render web box → it stops in-process ingestion (serve-only)
     AND auto-enables the periodic L2 restore (below), so the box keeps seeing the Action's fresh runs.
   - Kept reversible: unset the env var to instantly fall back to in-process ingestion; comment the cron.

## Periodic L2 restore — IMPLEMENTED (gated, default-off)
Render otherwise restores from L2 only on startup + a parse-failure fallback, so a serve-only box wouldn't
see new Action ingestions until a restart. `scheduler/__init__.py` now adds a **periodic
`restore_from_supabase` job** — but ONLY when `DISABLE_FORECAST_SCHEDULER` is set (serve-only), so it never
runs while the box ingests locally (which would clobber fresh local data with L2). It's a light
manifest-only ~2.5MB pull; interval tunable via `L2_RESTORE_INTERVAL_MIN` (default 30, floor 5). No Action
change needed. Default-off → zero effect until cutover.
