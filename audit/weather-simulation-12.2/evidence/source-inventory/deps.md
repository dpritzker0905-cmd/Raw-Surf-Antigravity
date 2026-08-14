# Audit 12.2 — EXTERNAL DEPENDENCY + PROVIDER RISK (spec §18)

Repo `C:\Users\dprit\Raw-Surf`, branch `dev`, HEAD `791fdf78`. Read-only pass.
**No credential VALUES appear in this file.** Where a secret exists it is named by `file:line` only.

---

## 0. METHOD, AND HOW EACH COUNT WAS OBTAINED

The register vocabulary was deliberately NOT used as the starting point. The starting point was
"what hostnames does this codebase actually contact".

| Step | Command (run from repo root, Git Bash) |
|---|---|
| Host census, backend | `grep -rhoE "https?://[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}" --include="*.py" backend/services/ \| sort \| uniq -c \| sort -rn` |
| Host census, weather pipeline only | same, scoped to `backend/services/weather_pipeline backend/routes/weather*` |
| Provider-name census | `git grep -rlniE "open-meteo\|nomads\|ncep\|noaa\|ecmwf\|dwd\|opendata\|copernicus\|ndbc\|stormglass\|openweather\|worldtides\|tidesandcurrents" -- backend/` |
| Frontend map/tile providers | `git grep -nE "maplibre\|mapbox\|carto\|maptiler\|protomaps" -- frontend/src` |
| Library pinning | `cat backend/requirements.txt backend/requirements-dev.txt`; `frontend/package.json` + `frontend/package-lock.json` |

⚠️ **Windows/worktree tax paid up front.** A plain `grep -rn` over the repo root reads
`.claude/worktrees/gracious-cannon-e4aed4/`, which is a DIFFERENT BRANCH. My first
`WEATHER_PROXY_URL` search returned 100% worktree paths. Every claim below was re-run with
`git grep`, which reads only the live tree.

⚠️ **`git grep` alternation needs `-E`.** A search for `om://|addProtocol` without `-E` returned
ZERO hits because BRE treats `|` as a literal. Caught by a positive control
(`git grep -c "omProtocol" -- frontend/src/components/map/openMeteoProtocol.js` → `6`). Every
absence claim in this file is paired with a positive control from the same file or directory.

---

## 1. UPSTREAM WEATHER / MARINE DATA PROVIDERS — full inventory

### 1.1 Open-Meteo — `api.open-meteo.com`, `marine-api.open-meteo.com`

| Field | Value |
|---|---|
| Purpose | Wind, pressure, precipitation, marine waves/swell — **grid and point**. Also the **terminal fallback for every other lane**. |
| Endpoint | `backend/services/weather_pipeline/providers/open_meteo_provider.py:185-186` (`MARINE_URL`, `FORECAST_URL`); mirrored in `frontend/netlify/functions/weather-proxy-helpers.js:13-17` (`API_URLS`) |
| Auth | **None.** No API key anywhere. Positive control: `git grep -c "open-meteo.com" -- backend/services/weather_pipeline/providers frontend/netlify/functions` → 3 files match; `git grep -niE "customer-api\.open-meteo\|apikey\|api_key"` over the same two dirs → **0 hits**. ⇒ this is the **free / non-commercial tier**. |
| Update cadence | Not declared in code. `capabilities.py` declares `update_frequency: "6h"` per model row, which is the MODEL cycle, not the API refresh. |
| Rate limit / quota | **UNDOCUMENTED IN THIS REPO.** Nothing states calls/day, calls/hour or calls/minute. Positive control: `429` appears 14× in `open_meteo_provider.py`, so the codebase clearly *experiences* the limit — it just never names it. |
| Timeout | grid `45.0 s` (`:434`, `:436`); point `15.0 s` (`:630`, `:632`) |
| Retry | `max_retries = 5` with `8·attempt` backoff (`:426-443`, `:624-638`) |
| Circuit breaker | **Yes** — shared class-level 429 breaker, `_rate_limited_until`, cooldown `OPEN_METEO_BREAKER_COOLDOWN_SEC` default `30 s`; kill `OPEN_METEO_BREAKER_DISABLED=1` (`:193-223`). Origin comment: a Render restart-under-load caused by 5 concurrent retry storms. |
| On outage | Grid: exception propagates in production (`:485-487`); serve falls back to the last stored product in Supabase/L1. Point: same. |
| Fallback | **NONE — it IS the fallback.** See §5. |
| Licensing | Open-Meteo free API is CC-BY-4.0 and non-commercial. **No attribution is rendered** (§4). The product carries Stripe subscriptions (`backend/requirements.txt: stripe==8.11.0`), i.e. it is commercial. |
| Cost | $0 today; a forced move to the paid tier is the exposure. |
| Schema change | **Rename → caught** (`response.raise_for_status()` at `:451`; Open-Meteo 400s an unknown variable). **Silent key drop with HTTP 200 → NOT caught**: `normalizer.py:290-355` reads every variable as `pt_hourly.get(key, [])`, so a missing key degrades to `is_valid=False` cells (`normalizer.py:379`), never a refusal. |

### 1.2 Open-Meteo tile CDN — `map-tiles.open-meteo.com` (a SEPARATE surface)

| Field | Value |
|---|---|
| Purpose | The `om://` binary raster tiles behind **every maplibre-rendered weather layer**: rain, satellite/cloud, pressure, temperature, water_temp, fog. |
| Endpoint | `frontend/src/components/map/openMeteoProtocol.js:696` — `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?...`; also `frontend/netlify/functions/weather-proxy.js:452` for the `type=tiles` catalog. |
| Reachability | **Direct browser → Open-Meteo.** The `om://` protocol handler is registered from `@openmeteo/weather-map-layer` (`openMeteoProtocol.js:513`); the library performs the fetch. The `weather-proxy` `tiles` branch only proxies `latest.json`, not the `.om` tiles. |
| Auth | None. The rate-limit subject is **the end user's IP**. |
| Rate limit / quota | **UNDOCUMENTED.** |
| Timeout / retry | Owned by `@openmeteo/weather-map-layer` `0.0.19`; not configurable from this repo. |
| On outage | Tiles fail → transparent raster. `omUrlTrace.js` records `blockedDetail`, which is the WS-CAN-0061 instrument. |
| Fallback | **NONE.** `LayerRegistry.js:52-124` — rain / radar / satellite / pressure / temperature / water_temp / fog are all `renderMode: "maplibre"` off `om*` sources. `backendPrecipitationServiceClient.js:121,225` and `backendPressureServiceClient.js:99,187` state explicitly: *"raster visuals not supported from backend grids (contours stay legacy om://)"* — the backend lane covers contours only. |
| Licensing | Same CC-BY-4.0 obligation. Not met. |

### 1.3 NOAA GFS / GFS-Wave — `noaa-gfs-bdp-pds.s3.amazonaws.com` (AWS Open Data)

| Field | Value |
|---|---|
| Purpose | **PRIMARY** for GFS marine waves, GFS wind, GFS pressure (byte-range GRIB2 off `.idx`). |
| Endpoint | `backend/services/noaa_gfs_wave_fetcher.py:41` `S3_BASE`; same host in `noaa_gfs_wind_fetcher.py`, `noaa_gfs_pressure_fetcher.py` |
| Reachability | Active-reachable, default ON — `GFS_MARINE_NOAA_DIRECT` / `GFS_WIND_NOAA_DIRECT` / `GFS_PRESSURE_NOAA_DIRECT` all default `"1"` (`scheduler.py:95,313`, `wind_ingestion.py:91`, `pressure_ingestion.py:120`) |
| Auth | None (AWS Open Data, public). |
| Cadence | GFS 00/06/12/18Z; waves land ~3.5-5 h after cycle (`noaa_gfs_wave_fetcher.py:198-200`). `_pick_cycle` walks back **7 cycles / ~36 h**. |
| Quota | Not documented; AWS Open Data has no published per-caller quota. |
| Timeout | `HTTP_TIMEOUT = 60` (`:43`), applied to every `.head`/`.get`. |
| Retry | **No urllib3 `Retry`/`HTTPAdapter` is mounted anywhere** (`git grep "HTTPAdapter\|max_retries\|backoff_factor" -- backend/services` → only the Open-Meteo counters). Mitigated instead by: cycle walk-back, per-step `try/except` with `steps_failed` accounting, a soft deadline (`NOAA_FETCH_BUDGET_S` default `2400`), a minimum-hours floor (`NOAA_FETCH_MIN_HOURS` default `120`), and `backend/tests/test_noaa_coverage_floor_fires_on_failures.py`. |
| Connection pooling | `_fetch_common.http_session()` (`backend/services/_fetch_common.py:63-116`), measured 480.6 → 134.1 ms/call. Kill `FETCH_HTTP_SESSION=0`. Enforced by `backend/tests/test_fetcher_http_pooling.py`. |
| On outage | Falls through to Open-Meteo (`wind_ingestion.py:122-131`, `scheduler.py`, `pressure_ingestion.py`). |
| Licensing | US Federal — public domain. No obligation. |
| Cost | $0. |
| Schema change | **DETECTED AND REFUSED.** `noaa_gfs_wave_fetcher.py:372-373` — `if len(selected) != len(OM_ORDER): raise RuntimeError("idx missing wave messages ...")`, plus a decode-count check at `:379-381`. A renamed `.idx` token fails the step rather than yielding a short product. This is the strongest schema guard in the estate. |
| Integrity | ⚠️ `_fetch_message_bytes` (`:248-253`) accepts 200/206 and returns `r.content` with **no Content-Length / byte-count check**. This is WS-CAN-0017 / WS-OBJ-304 / SOTA B14 — already registered. |

### 1.4 DWD — `opendata.dwd.de`

| Field | Value |
|---|---|
| Purpose | GWAM (global wave) → ICON marine; ICON wind; ICON pressure. |
| Endpoint | `backend/services/dwd_gwam_fetcher.py:38` `BASE = https://opendata.dwd.de/weather/maritime/wave_models/gwam/grib`; `dwd_icon_wind_fetcher.py`, `dwd_icon_pressure_fetcher.py` |
| Reachability | Active-reachable, default ON — `ICON_MARINE_DWD_DIRECT` default `"1"` (`marine_mid_res_ingestion.py:175,339`; `scheduler.py:429`), `ICON_PRESSURE_DWD_DIRECT` default `"1"` (`pressure_ingestion.py:180`) |
| Auth | None. |
| Timeout | GWAM `HTTP_TIMEOUT = 60` (`:39`); ICON wind/pressure `HTTP_TIMEOUT = 120` (`dwd_icon_wind_fetcher.py:38`, `dwd_icon_pressure_fetcher.py:48`) |
| Retry | None mounted; same mitigation shape as NOAA. |
| On outage | Falls through to Open-Meteo. |
| Licensing | **DWD open data requires attribution** ("Datenbasis: Deutscher Wetterdienst", GeoNutzV). Not rendered anywhere (§4). |
| Schema change | A renamed variable changes the URL path → HTTP non-200 → `raise RuntimeError` at `dwd_gwam_fetcher.py:173`. Per-variable file layout means schema drift surfaces as a 404, i.e. detected. |

### 1.5 ECMWF Open Data — via the `ecmwf-opendata` client

| Field | Value |
|---|---|
| Purpose | EURO wind + pressure (IFS 0.25° `10u`/`10v`/`msl`), and the EURO wave ensemble. |
| Endpoint | Not a literal in this repo — `Client(source=os.environ.get("ECMWF_OPENDATA_SOURCE", "ecmwf"))`, `backend/services/ecmwf_opendata_fetcher.py:313`. The client resolves `data.ecmwf.int`. **A host we never name is a host we cannot grep for in an incident.** |
| Reachability | Active-reachable; `EURO_PRESSURE_ECMWF_DIRECT` default `"1"` (`pressure_ingestion.py:295`) |
| Auth | None (open data). |
| Timeout / retry | Owned entirely by `ecmwf-opendata==0.3.34`; not configurable here. One hand-rolled degrade: full retrieve fails → retry ≤144 h (`:327-328`). |
| Ensemble cost | `ECMWF_WAVE_ENSEMBLE` default **ON** (`:152`); members `ECMWF_WAVE_ENSEMBLE_MEMBERS` default `5`, max `50` (`:142-165`). A member count raise multiplies the ingest download linearly. |
| Flag-gated | `ECMWF_PERIOD_BANDS` default `'0'` — gates the FETCH, not just the emit (`.github/workflows/forecast-ingest.yml:79`). |
| Licensing | ECMWF open data is **CC-BY-4.0 — attribution required**. Not rendered (§4). |

### 1.6 Copernicus Marine (CMEMS)

| Field | Value |
|---|---|
| Purpose | **EURO marine waves** — the only lane where Copernicus is primary. `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` (`capabilities.py:197`). |
| Endpoint | Not a literal — the `copernicusmarine` SDK (`copernicus_fetcher.py:28,36`; `copernicus_global_fetcher.py:113,137`). |
| Auth | **Credentialed.** `COPERNICUSMARINE_SERVICE_USERNAME` / `COPERNICUSMARINE_SERVICE_PASSWORD` (`copernicus_global_fetcher.py:240-241`); credential dir override at `copernicus_marine_service.py:298,523`. Values not read or reproduced. |
| Timeout / retry | Owned by `copernicusmarine==2.4.1`. |
| On outage | **Declared fallback** — the only rows in `capabilities.py` with non-empty `fallback_sources` (`:212,243,274,305`), and the contract validator *enforces* that only EURO marine may declare one (`:620-635`). |
| Licensing | CMEMS licence requires attribution + citation. Not rendered (§4). |
| Cost | Free with registration; account suspension is the risk, not a bill. |

### 1.7 NDBC buoys — `www.ndbc.noaa.gov`

| Field | Value |
|---|---|
| Purpose | Ground truth for buoy calibration and the forecast-skill ledger. |
| Endpoint | `backend/services/weather_pipeline/buoy_calibration.py:24` `NDBC_REALTIME_URL`, `:264` `NDBC_LATEST_OBS_URL` |
| Auth | None (`:12` — "no key"). |
| Format | Fixed-column `.txt`, `MM` = missing (`:29`). Two distinct layouts, two parsers (`:68`, `:103`, `:166`). |
| Schema change | A column reorder in `realtime2` would be **silently mis-parsed** — the parser is positional against a hard-coded column order at `:29`. There is no header assertion. This is the weakest schema seam of any provider here, but it feeds calibration/scoring, not the served forecast. |
| Licensing | Public domain. |

### 1.8 NOAA CO-OPS tides — `api.tidesandcurrents.noaa.gov`

- `backend/routes/surf_data/conditions.py:32` `NOAA_TIDES_URL`; `backend/services/surf_conditions.py:14` `NOAA_TIDES_API`. Station IDs hard-coded from `:17`.
- **Two literals for one endpoint** — a duplicated base URL, not a shared constant.
- No auth, no documented quota. US-only station coverage.
- The pipeline's own tide module (`weather_pipeline/tide.py:20`) uses **Open-Meteo marine**, not CO-OPS — so tide has two independent upstreams depending on which surface asks.

### 1.9 ERA5 / Copernicus CDS — `cds.climate.copernicus.eu`

- Dev-only / operator lane. `cdsapi==0.7.7` is in `backend/requirements-dev.txt:77` and **deliberately excluded from `requirements.txt`** (documented `:60-76`: the 1-CPU/2 GiB serve box has been OOM-killed at 1,579 MB).
- Credential `~/.cdsapirc`, explicitly a DIFFERENT service from `COPERNICUSMARINE_*` (`requirements-dev.txt:69-72`).
- Consumers: `backend/scripts/era5_deepen_climatology.py`, `directional_exposure_probe.py`.
- Classification: **Dev-only**. Not on the served path. Not a production availability risk; it IS a calibration-continuity risk (the campaign replaces a spot's sample population).

### 1.10 RainViewer — `api.rainviewer.com`, `tilecache.rainviewer.com`

| Field | Value |
|---|---|
| Purpose | The `radar` layer (`LayerRegistry.js:61-65`, `source: "RAINVIEWER_REFLECTIVITY"`). Declared in `capabilities.py:533-549`. |
| Reachability | Active-reachable via a **same-origin Netlify edge proxy** — `frontend/netlify/edge-functions/rvproxy.js`, `config = { path: '/rv/*' }`. Resolver: `frontend/src/components/map/radarForecastSources.js`. |
| Auth | None. |
| Rate limit | Free CDN, per-IP. The proxy exists *because* direct fetching burst past it (429 → no ACAO → CORS block → blank tiles). |
| Mitigation quality | **Best in the estate.** Durable Netlify CDN cache (`max-age=172800, durable`), errors explicitly `no-store` so a fresh frame self-heals, path regex scoped to radar tiles only (no open proxy / SSRF). |
| On outage | 502 passthrough, uncached. |
| Licensing | RainViewer free tier requires a visible credit. Not rendered (§4). |
| Note | RainViewer's nowcast is **discontinued** (`frontend/src/__tests__/radarForecastSources.test.js:13`); the app advects locally instead. |

### 1.11 Providers grepped for and NOT present (absence claims, each with a control)

`stormglass`, `openweather`, `worldtides`, `nomads.ncep.noaa.gov` (as a live host — it appears only in
the `_fetch_common.py:68` measurement comment; the live host is the AWS S3 mirror).
Search: `git grep -rlniE "stormglass|openweather|worldtides|nomads" -- backend/ frontend/src` → no
production hits. **Positive control from the same command family**: the identical regex with `ndbc`
returns `buoy_calibration.py` + `map_spots_to_ndbc_buoys.py` + `validate_period_vs_ndbc.py`.

---

## 2. MAP / TILE / BASEMAP PROVIDER

### 2.1 Mapbox — `api.mapbox.com`

| Field | Value |
|---|---|
| Purpose | **The entire basemap** for the weather map, all four looks. |
| Endpoint | `frontend/src/components/map/mapUtils.js:170-175` `MAPBOX_VECTOR_STYLES` (dark/light/beach/satellite), returned by `getMapStyle` (`:213-219`). Raster twins at `:158-163`. Preconnect at `frontend/public/index.html:54`. |
| Consumer | `MapWebGL.js:982` `mapStyle={currentMapStyle}`, `:983` `transformRequest={mapboxTransformRequest}`. |
| Auth | `REACT_APP_MAPBOX_TOKEN` interpolated into the URL query string (`mapUtils.js:153`). Client-exposed by design (publishable token), so it is public in the built bundle. |
| Quota | **UNDOCUMENTED.** Mapbox bills per map-load / per tile request. Nothing in this repo records a budget, a ceiling, or an alert. |
| Timeout / retry | MapLibre defaults; nothing configured. |
| On outage / bad token | `MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN \|\| ''` → style URL ends `?access_token=` → 401 → MapLibre style load fails. `MapWebGL.js:700-705` handles `'error'` by **logging and calling `WeatherTelemetry.trackMapError`** — there is no fallback style, no user-visible refusal, and no degraded basemap. The weather rasters are inserted INTO that style, so a style failure takes the weather layers with it. |
| Fallback | **NONE.** `getMapStyle` (`:213-219`) can only ever return a `MAPBOX_VECTOR_STYLES` entry. The one non-Mapbox basemap in the repo, `basemaps.cartocdn.com` (`AdminSpotsPanel.js:179`), is an admin Leaflet panel, not the weather map. |
| Licensing | Two obligations, both unmet: (a) Mapbox requires attribution; `MapWebGL.js:986` sets `attributionControl={false}` and `mapUtils.js:257` sets `attributionControl: false`. (b) Mapbox's ToS restricts Maps/Styles/Tiles APIs to Mapbox's own rendering SDKs; this repo consumes them from **MapLibre GL JS 5.24.0** (`frontend/package.json`, lock `:15547-15551`) via a hand-written `mapbox://` → HTTPS translator (`mapUtils.js:182-205`). |
| Cost | The single largest uncapped third-party cost surface in the product. |

### 2.2 Attribution — the absence claim, with controls

- `git grep -nF "©" -- frontend/src` → **only binary PNG assets match** (`assets/hair/*.png`). Zero text files.
- `git grep -rn "OpenStreetMap\|© Mapbox\|maplibre-ctrl-attrib" -- frontend/src` → the only map-related hit is `mapUtils.js:240`, inside `TILE_LAYER_CONFIG`, which is the **legacy Leaflet raster config**. `git grep -n "TILE_LAYER_CONFIG" -- frontend/src` returns exactly two hits, both inside `mapUtils.js` — its own definition (`:228`) and a comment naming it (`:156`). **It has no importer.** The only remaining Leaflet import in `frontend/src` is `utils/leafletLoader.js:12`.
- Positive control for search technique: `git grep -ci "open-meteo" -- frontend/src` matches 8+ files, so the tooling does find provider names in this tree.
- ⇒ **No attribution is rendered for any of: Mapbox, OpenStreetMap, Open-Meteo, DWD, ECMWF, Copernicus Marine, RainViewer.** There is no `LICENSE` file and no third-party notices document (`ls LICENSE*` → nothing).

### 2.3 Nominatim — `nominatim.openstreetmap.org`

Direct browser calls, five sites: `LocationPicker.js:173`, `PreSessionConfigModal.js:30,58`,
`SurfLog.js:184`, `BookingPricingModal.js:382`, `useOnDemandLocation.js:45,50`.
No `User-Agent` / `Referer` identification is set at any of them — Nominatim's usage policy requires
an identifying UA and caps at 1 req/s. **Not on the weather path** (`useOnDemandLocation` is consumed
only by `useOnDemandBooking.js:12,109`), so this is recorded for completeness and routed out of §18.

---

## 3. HOSTING / CDN / STORAGE / TRANSPORT

### 3.1 Netlify `weather-proxy` function — a data-plane dependency, not just hosting

| Field | Value |
|---|---|
| Purpose | Fronts **all** Open-Meteo grid+point traffic from the backend, plus a Copernicus forward. Caches 30 min in function memory. |
| Default target | `DEFAULT_WEATHER_PROXY_URL = "https://dev--rawsurf.netlify.app/.netlify/functions/weather-proxy"` — `open_meteo_provider.py:171`. That is the **`dev` branch deploy**, not the production site. |
| Resolution | `os.environ.get("WEATHER_PROXY_URL") or DEFAULT_...` (`:177`) — the `or` is deliberate; an empty CI secret must not shadow the default. Guarded by `backend/tests/test_open_meteo_proxy_url.py` including a source assertion that `.get("WEATHER_PROXY_URL",` never returns. |
| Gate | `use_proxy = os.environ.get("USE_WEATHER_PROXY", "true" if os.environ.get("RENDER") == "true" else "false")` — `:372`, `:594`. ⇒ **ON BY DEFAULT ON THE PRODUCTION RENDER BOX.** Bypassed only for grids > 100 points (`:374-375`) and during pre-population (`server.py:286-288`). |
| Whether `WEATHER_PROXY_URL` is set in production | **UNKNOWN — owner-gated.** `render.yaml` is documentation only; its own header states the Blueprint is NOT applied to the live service (verified three ways, 2026-08-10) and the file does not list `WEATHER_PROXY_URL` at all. Reading the live env screen is **WS-CAN-0040**. |
| Timeout mismatch | Backend waits `45.0 s` (grid, `:434`) / `15.0 s` (point, `:630`). `netlify.toml` declares no `[functions]` block ⇒ default synchronous limit is 10 s. `netlify.toml:29-32` and `.codebase-memory/adr.md:9` both record the ~10-26 s window and warn against re-adding a function hop for `/api/weather/*`. |
| Circuit breaker | Per-key, in `weather-proxy-helpers.js:70-80` (`getCircuitKey` = provider+type+model+grid/exact+layerFamily+bucket). Only applies when `pointCount == 1` (`:78`). |
| Stale-serve | `weather-proxy.js:189`, `:345` — serves stale cache on upstream failure and on open circuit. Good behaviour; note the served payload's own freshness field is a separate (registered) concern. |
| Size guard | `RESPONSE_SIZE_LIMIT = 6.5 MB` → HTTP 413 with `X-Failure-Phase` (`weather-proxy-helpers.js:11,29-49`). |

### 3.2 Netlify site / CDN

- `netlify.toml`: `/api/*` → `https://raw-surf-antigravity.onrender.com/api/:splat` (status 200 proxy). `/api/weather-proxy` → the function.
- `[build.environment] REACT_APP_BACKEND_URL = https://raw-surf-antigravity.onrender.com`.
- Production context has `ignore = "git diff --quiet ... -- frontend/src frontend/public netlify.toml"`.
- Production frontend is frozen at `3bd38a83` — **WS-CAN-0039 / WS-OBJ-104**, already registered.

### 3.3 Render (backend host)

- `raw-surf-antigravity.onrender.com` (`core/security.py`, `netlify.toml`, `forecast_accuracy_monitor.py:385`).
- `render.yaml` is **not applied** (header, verified three ways). Python 3.12 confirmed by measurement via `/api/health`, not by reading the Blueprint.
- 1-CPU / 2 GiB, OOM-killed at 1,579 MB historically (`requirements-dev.txt:61`); cgroup 2048 MB per WS-OBJ-303.

### 3.4 Supabase Storage — the L2 product store

- `backend/services/weather_pipeline/store.py:222-248` — `create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY|SUPABASE_KEY)`, private bucket `WEATHER_BUCKET`, `create_bucket(..., public=False)`.
- Manifest served from `{SUPABASE_URL}/storage/v1/object/{bucket}/manifest.json?cb=<ms>` (`:39-44`).
- Upload concurrency: `ThreadPoolExecutor(max_workers=4)` for objects, `1` for the manifest (`:50-51`).
- `create_bucket` failure is logged and **not retried this process** (`:246`).
- Quota: `routes/admin/system.py:208` is the only place a Supabase limit is written down — "free tier: 1 GB database + 1 GB storage" — and it is in an admin panel, not in the pipeline that writes GRIB-derived products.
- ⚠️ Two Supabase projects exist in this environment (a phantom local one and the production one). Getting production truth from a local DB read returns `None`.

### 3.5 GitHub Actions — the ingest scheduler

- `forecast-ingest.yml` `cron: '15 */4 * * *'` (6 runs/day), `precompute.yml`, `forecast-ingest-pilots.yml`, `marine-nightly.yml` `30 6 * * *`, `data-health-monitor.yml` `*/30 * * * *`, `forecast-accuracy-monitor.yml` `5 1,7,13,19 * * *`, `keep-warm.yml` `*/5 * * * *`.
- `keep-warm.yml:11` records in-line that **GitHub cron is best-effort**. A green cron history is not proof of cadence.
- ⇒ Actions is a **cadence** dependency for the whole forecast product, and it is the least-instrumented of them.

### 3.6 Non-weather third parties (inventoried, then routed out of §18)

`api.openai.com`, `generativelanguage.googleapis.com` (Gemini), `api.onesignal.com`, `api.sendgrid.com`,
Resend, `stream.mux.com` / `image.mux.com`, `res.cloudinary.com`, Stripe, LiveKit,
`api-inference.huggingface.co`, `images.unsplash.com`, commerce affiliate hosts
(`bhphotovideo.com`, `adorama.com`). None is imported by weather code.

---

## 4. LIBRARY DEPENDENCIES ON THE WEATHER PATH

### 4.1 Backend — `backend/requirements.txt`

**Every weather-path dependency is pinned to an exact version.** The file carries a 20-line comment
recording that the seven forecast-path lines were the only `>=` lines in it, that
`xarray>=2024.1.0` was resolving to `2026.7.0`, and that it moved `2026.4.0 → 2026.7.0` between two
installs hours apart. Pinned 2026-08-06 to what was already installing.

| Package | Pin | Weather role |
|---|---|---|
| `copernicusmarine` | `2.4.1` | CMEMS SDK — EURO marine |
| `xarray` | `2026.7.0` | NetCDF decode |
| `netCDF4` | `1.7.4` | " |
| `h5netcdf` | `1.8.1` | " |
| `pygrib` | `2.1.8` | GRIB2 decode (bundles ecCodes) |
| `ecmwf-opendata` | `0.3.34` | ECMWF client |
| `requests` | `2.31.0` | every GRIB fetcher |
| `httpx` | `0.27.2` | `tide.py`, async point fetch |
| `shapely` | `2.0.4` | geometry |
| `supabase` | `2.4.6` | L2 store |

⚠️ **`numpy` and `zarr` are NOT pinned, deliberately.** The requirements comment records why: CI run
31103393912 showed 3.11 installing numpy 2.4.6 / zarr 3.1.6 and 3.12 installing numpy 2.5.1 /
zarr 3.3.0. The serve box runs 3.12; **forecast-ingest, forecast-ingest-pilots, precompute,
l2-orphan-sweep and forecast-calibration-census are still on 3.11**. Producer and consumer of the
forecast artifacts therefore disagree on two numeric libraries, and pinning one side would freeze the
disagreement. This is documented and reasoned, not an oversight — but it is an open supply-chain fact
and it lives only in a comment.

### 4.2 Frontend — `frontend/package.json`, lock present

| Package | Range | Lock | Weather role |
|---|---|---|---|
| `maplibre-gl` | `^5.24.0` | `5.24.0`, BSD-3-Clause | the map |
| `react-map-gl` | `^8.1.1` | `8.1.1`, MIT | React binding |
| `@openmeteo/weather-map-layer` | `^0.0.19` | `0.0.19` | **the `om://` protocol** |
| `@sakitam-gis/maplibre-wind` | `^2.0.3` | — | wind |
| `supercluster` | `^8.0.1` | — | spot clustering |
| `spectorjs` | `^0.9.30` | — | WebGL debug |
| `leaflet` | `^1.9.4` | — | legacy; only `utils/leafletLoader.js` |

- `@openmeteo/weather-map-layer` is **`0.0.19`** — a pre-1.0, 0.0.x package that decodes every raster
  weather tile. npm caret on `0.0.x` pins exactly, and `package-lock.json:3626-3630` carries an
  integrity hash, so the *build* is reproducible. The risk is not drift; it is that a 0.0.x package
  with no stability contract owns the fetch, decode and cache of every weather raster, and its
  timeout/retry behaviour is not configurable from this repo.
- Netlify build command is `npm install --legacy-peer-deps` (`netlify.toml`), not `npm ci`.
  `npm install` may rewrite the lockfile; `npm ci` would not.

---

## 5. THE FALLBACK TOPOLOGY — the single most important structural fact

Traced from the ingestion sites, not from documentation:

```
GFS marine  ── NOAA S3 (primary, default ON) ──┐
GFS wind    ── NOAA S3 (primary, default ON) ──┤
GFS press.  ── NOAA S3 (primary, default ON) ──┤
ICON marine ── DWD opendata (primary, ON)   ───┤
ICON press. ── DWD opendata (primary, ON)   ───┼──► OPEN-METEO  (terminal fallback)
EURO wind   ── ECMWF opendata (primary, ON) ───┤        │
EURO press. ── ECMWF opendata (primary, ON) ───┤        │  reached (on Render, by default)
EURO marine ── Copernicus CMEMS (primary)   ───┘        │  through the NETLIFY dev-branch
                                                        │  weather-proxy
frontend rasters ── map-tiles.open-meteo.com ───────────┘  (direct, unproxied, user IP)
```

Call sites for the fallback edge: `wind_ingestion.py:122-131`; `pressure_ingestion.py:119-120,179-180,294-295`;
`scheduler.py:94-95,312-313,428-429`; `marine_mid_res_ingestion.py:68,134,175,339`.

**Four independent primaries converge on one fallback, and that fallback is also the sole provider of
every frontend raster layer.** Open-Meteo is therefore not a fallback in the resilience sense — it is
a shared single point of failure sitting *behind* the diversity, plus a shared single point of failure
sitting *in front of it* on the tile side.

---

## 6. WHAT THE PROGRAM REGISTERS ALREADY COVER

| Item | Register row | Verdict |
|---|---|---|
| Byte-count / truncation validation on range GETs | **WS-CAN-0017**, **WS-OBJ-304**, SOTA **B14** | Covered. Named files `_fetch_message_bytes / store.py` are exactly the sites I found. Do not re-report. |
| Committed credentials | **WS-CAN-0021**, **WS-OBJ-703** | Covered *for `BRAIN_RULES.md`*. Scope is credential-in-git, not provider risk. |
| Production frontend frozen (Netlify) | **WS-CAN-0039**, **WS-OBJ-104** | Covered. |
| Reading the live Render env screen | **WS-CAN-0040** | Covered — and it is the blocker on confirming `WEATHER_PROXY_URL`. |
| Vercel app removal | **WS-CAN-0041** | Covered. |
| Uptime probe on own health endpoint | **WS-CAN-0025** | Covered — but it probes *us*, never an upstream. |
| Model default GFS vs EURO | **WS-CAN-0057**, **WS-OBJ-603** | Covered. |
| 0.25° tile coverage expansion | **WS-CAN-0058**, SOTA **C1** | Covered. |
| Layer paints or refuses | **WS-CAN-0060/0061**, **WS-OBJ-101**, SOTA **A7** | Covered (both closed). |
| Provider identity on a served payload | SOTA **A1** | Covered and MET — `normalizer.py:684-688` overrides `upstream_provider` from each fetcher's `__provider` stamp. The stale `"open-meteo"` in `capabilities.py` is informational only (`normalizer.py:678`: "branched on nowhere, backend or frontend"), the per-response field is what consumers read (`marineGridSeries.js:250-254`, `backendWeatherServiceClientHelpers.js:173,284`), and `TruthOverlay.js:294-304` maps `source_dataset` → NOAA/DWD/Copernicus/ECMWF for display. **Killed as a candidate.** |
| `fallback_sources: []` on non-EURO rows | `capabilities.py:384` + validator `:620-635` | A deliberate, enforced contract restriction, not an omission. **Killed as a candidate.** |
| No retry adapter on the GRIB fetchers | — | Mitigated by cycle walk-back, per-step accounting, soft deadline, minimum-hours floor and `test_noaa_coverage_floor_fires_on_failures.py`. **Killed as a candidate.** |

**No row in either register addresses upstream provider availability, quota, cost, licensing, or the
consequences of a provider outage.**

How the register sizes were counted (not read off a heading):
```
~/AppData/Local/Python/bin/python3.exe -c "import csv; \
  print(len(list(csv.reader(open(P,encoding='utf-8'))))-1)"
  PROGRAM_OBJECTIVE_REGISTER.csv              -> 40
  CURRENT_CANONICAL_TASK_REGISTER_12.1.csv    -> 65
```
SOTA contract rows counted by hand from `STATE_OF_THE_ART_TARGET_CONTRACT.md`: A1-A18, B1-B15, C1-C8.

The coverage claim was tested with
`grep -iE "provider|upstream|vendor|quota|rate.?limit|outage|attribution|licen|mapbox|tile|supabase|netlify|render|cdn|noaa|ndbc|copernicus|cost|cron"`
over both CSVs. Every hit was an internal-provenance, hosting-hygiene or model-selection row, and each
is listed in the table above. The regex demonstrably works on these files — it is what surfaced
WS-CAN-0021, WS-CAN-0039, WS-CAN-0040, WS-CAN-0057 and WS-OBJ-304.

---

## 7. SURVIVING GAPS

See the structured return. In short: (1) Mapbox is an unattributed, uncapped, unfallbacked commercial
basemap consumed through a rendering library its ToS does not contemplate; (2) Open-Meteo is the
terminal fallback for every lane *and* the direct source of every frontend raster, with no documented
quota on either surface; (3) the production backend's default Open-Meteo path runs through a Netlify
**branch-deploy** URL; (4) six providers carry attribution obligations and none is rendered; (5) a
silent upstream key-drop on the Open-Meteo JSON lane degrades to `is_valid=false` cells that
`data_health` cannot distinguish from a normally-absent variable.
