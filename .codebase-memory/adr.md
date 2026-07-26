## PURPOSE
Weather simulation / forecast pipeline. Serves marine (waves/swell_1/swell_2/wind_waves), wind, and
pressure forecast grids out to ~14 days for GFS / ICON / EURO, consumed by the frontend WebGL
marine+wind heatmap engines and the timeline scrubber. (This ADR is scoped to the weather subsystem —
the most decision-dense part of the repo.)

## STACK
- Backend: FastAPI on Render **1-CPU / 512MB** (the dominant constraint behind nearly every weather decision). APScheduler runs ingestion.
- Upstream: Open-Meteo, fetched through a **Netlify function proxy** (`WEATHER_PROXY_URL` = dev--rawsurf.netlify.app/.netlify/functions/weather-proxy) with a short (~10-26s) function timeout + retries. EURO **marine** = Copernicus (separate provider/path). EURO wind model = ecmwf_ifs, GFS = ncep_gfs, ICON = dwd_icon.
- Storage: `ProductStore` (per-timestep JSON product files) + `DynamicProductIndex` + `manifest.json`.
- Frontend: React + MapLibre + custom WebGL marine/wind engines; per-model-hour client cache + grid_series scrubber.

## ARCHITECTURE
- INGESTION (scheduled): `scheduler/forecast.py::ingest_marine_forecast_task` → `WeatherPipelineScheduler` jobs (ICON/GFS/EURO wind global, GFS/EURO/ICON marine, GFS/ICON/EURO pressure) → `open_meteo_provider.fetch_grid` (point-batched via proxy) → `scheduler_helpers.normalize_and_save_loop` (saves **3-hourly** per-timestep products, `step=3`) → ProductStore + manifest.
- SERVE: `GET /api/weather/grid` → `grid_resolver.resolve_grid` → find stored product → else `viewport_service.fetch_viewport_grid_upstream` (on-demand dynamic fetch) → else EURO→GFS fallback / manifest overlap → else graceful no-coverage. `/grid_series` reuses `get_grid` per hour for the scrubber.

## PATTERNS  (★ = forecast-startup-critical)
- ★ **Scheduler runs on STARTUP, not only every 3h** (`scheduler/__init__.py`): `IntervalTrigger(hours=3)` first-fires at now+3h, so on a frequently-deployed/restarted box the forecast cycle NEVER fires and ALL forecast data goes stale (observed: wind 14h-341h stale, ICON marine 92h, pressure 56h). FIX = `next_run_time = now+120s` (env `FORECAST_STARTUP_DELAY_SEC`; <=0 = interval-only) → ingestion runs ~2min after EVERY boot → fresh data after each deploy. CONSEQUENCE: every deploy triggers a full ingestion ~2min post-boot.
- ★ **Wind global horizon vs the proxy/CPU budget**: GFS/EURO wind global fetch the FULL 14 days but in SMALL point-batches (`WIND_GLOBAL_BATCH_SIZE`=200, `WIND_GLOBAL_FORECAST_DAYS`=14) — open-meteo's per-call cost scales with points×days, and 500pts×14d times out where marine 500pts×8d×12vars succeeds. ICON wind global = 5d (DWD native horizon), loop-extrapolated to 14d only in the dynamic fetch (`viewport_helper.extend_icon_wind_to_14d`). `om_provider.fetch_grid` clamps wind by model (EURO 15 / GFS 16 / ICON 5).
- **Never a CORS-less 500**: `routes/weather.get_grid` wraps `resolve_grid` — preserve HTTPExceptions, convert any unhandled exception to a graceful 404 (`make_no_coverage_grid_response`). A bare 500 carries no Access-Control-Allow-Origin → browser shows a misleading "CORS error" and the wind client clears.
- **EURO → GFS fallback** (marine via Copernicus-fail, AND wind): relabel as EURO (`provider=gfs_fallback`). The Step 6/7 no-coverage block runs unconditionally, so its empty-fallback return + 503 raise MUST be guarded with `if not product:` or they discard a fallback-set product.
- **Upstream timeout → graceful**: `fetch_viewport_grid_upstream` wraps every provider fetch in `asyncio.wait_for` (`VIEWPORT_UPSTREAM_TIMEOUT_SEC` 20 Render/30; EURO wind 6s via `EURO_WIND_UPSTREAM_TIMEOUT_SEC`) so a slow ecmwf fetch fails over fast instead of hanging the 1-CPU worker ~90-100s.
- **Global wind texture seam**: `WebGLWindUtils.encodeWindTexture` REPEAT-wraps global grids, and the dead +180° column must be copied from -180° (`repairGlobalWindSeamInPlace`) or a Pacific seam (east of NZ) appears.

## TRADEOFFS
- The 1-CPU/512MB box is THE constraint: ingestion is paced (30s stagger + gc per job); heavy long-horizon fetches must be small-batched; first uncached far-future on-demand fetches are ~100s (rely on the pre-ingested product, not the dynamic path, for fast far-hours). Product cadence is 3-hourly to bound count/memory.

## PHILOSOPHY
Forecast data must stay FRESH (startup-run + 3h interval) and degrade GRACEFULLY at every layer
(provider timeouts → EURO→GFS fallback → no-coverage 404; frontend retains the last good frame, never
a bare 500, never a hung worker, never a permanently-blank heatmap).

## Protected Grom media delivery (2026-07-25)

### Decision
Grom uploads use a JWT-bound route and stream directly to private `grom_media`. Database rows retain only `supabase://grom_media/<grom-id>/<uuid>` references. Delivery signs a post/story-owned reference only after checking Grom ownership, verified guardian relationship, guardian approval, and approved public/follower visibility.

### Guardrails
- No arbitrary bucket/object-key signer.
- Upload actor must equal the Grom path id.
- `grom_media` remains private, has a 100 MiB limit, and allows only the configured image/video MIME types.
- Guardian ceilings remain authoritative; delivery never broadens visibility.
- Grom post thumbnails and carousel thumbnails must be protected references too; previews cannot bypass the media policy.

### Evidence
- Production bucket verified private with 100 MiB and the configured allow-list.
- Dynamic mocked streaming primitive and source authorization contracts passed.

### Residual debt
- Frontend not yet migrated to protected upload/delivery endpoints.
- Legacy public Grom URLs intentionally return 409 from the resolver, not a signed URL.
- Content signature validation/malware moderation remain ingestion work.
- Follow relationships have no acceptance state; follower-only means an existing Follow row.
- Full endpoint tests remain blocked by broken host Python and absent bundled pytest/FastAPI dependencies.


## Feed durability and protected composer cutover (2026-07-25)

### Decision
Public social-feed uploads must persist to the public `feed` bucket before the API returns a usable media URL. A storage failure is a 503, never a fallback to Render-local `/api/uploads`. Grom composer uploads use the protected Grom endpoint; rows retain private references and guardian policy determines eventual audience.

### Evidence
- Production contained 21 video posts with Render-local feed paths that now 404, and six more with missing `feed` objects.
- The public storage allow-list omitted `feed`, causing every attempted durable feed write through this helper to fail and triggering the ephemeral fallback.
- Production `/api/posts` and single-post probes returned 500 independently of the media-object failures. Schema checks ruled out the recently added post/privacy fields; the exact runtime exception still requires Render application logs.

### Residual debt
- Historical unavailable videos require owner replacement or an explicit archive action; do not delete them automatically.
- Complete render-side protected Grom media resolution for every post/modal/story surface and add the audience selector to the Grom composer.
- Obtain production application logs and resolve the list-feed 500 before treating the frontend migration as complete.


### Remediation applied (2026-07-25)
- After direct HTTP checks, the 21 posts referencing `/api/uploads/feed/test-video.mp4` were deleted from production. The Render asset returned 404 and no matching object existed in Supabase Storage, so recovery was not possible.
- Re-query after deletion: 14 video posts remain; all 14 reference durable public-storage URLs. No healthy remote videos were deleted.

## ORM mapper outage remediation (2026-07-25)

### Root cause and decision
The newly expanded `Story` model has three foreign keys to `profiles` (`author_id`, `guardian_approved_by`, and `guardian_override_by`). `Story.author` did not name its foreign key, so SQLAlchemy could not configure the Story mapper. Mapper configuration is global: an unrelated query that initialized any ORM mapper then failed, taking down feed, profiles, dispatch, and surf-spot surfaces with HTTP 500.

`Story.author` now explicitly uses `foreign_keys=[author_id]`. Guardian fields remain audit references and are not author candidates.

### Evidence
- Render application traceback identified `InvalidRequestError` on `Story.author` exactly.
- Commit `8bec0230` deployed successfully.
- Post-deploy direct checks returned HTTP 200 for `/api/posts`, `/api/profiles/84843d7f-8b32-45e4-8d39-5e7fa3de8a41`, and `/api/explore/surf-spots`.

### Residual debt
- Add a dependency-backed mapper-configuration regression test that imports all ORM models and calls `configure_mappers()` in CI. The local bundled Python lacks SQLAlchemy/FastAPI test dependencies, so this test was not executable in this desktop runtime.
