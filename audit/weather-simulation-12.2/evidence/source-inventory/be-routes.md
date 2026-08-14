# AUDIT 12.2 — SOURCE INVENTORY: BACKEND API SURFACE (weather / marine / surf)

**Repo:** `C:\Users\dprit\Raw-Surf` · **branch** `dev` · **HEAD** `791fdf78`
**Author:** independent coverage auditor, area = *backend API surface the weather sim depends on*
**Mode:** READ-ONLY on all production source. Nothing outside this evidence directory was written.

---

## 0. METHOD — how this inventory was built, and how to reproduce it

The registers were read **after** the inventory, not before, so the vocabulary of 12.0/12.1 could
not shape what got looked for.

### 0.1 The route table is a RUNTIME dump, not a grep

A static grep of `@router.<verb>(` cannot tell a *registered* route from a defined-but-never-included
one — and this repo has exactly that trap: `backend/routes/weather_ingest.py` is **not** imported by
`backend/routes/__init__.py`. A grep of `routes/__init__.py` alone would have concluded it is dead.
It is not: `backend/routes/weather.py:778-779` does

```
from .weather_ingest import router as ingest_router
router.include_router(ingest_router)
```

so all 19 ingest endpoints are live under the `/weather` prefix. **Reachability had to be executed,
not read.**

The authoritative table was produced by importing `routes.api_router` and walking `APIRoute`s:

```
cd backend && ~/AppData/Local/Python/bin/python3.exe <scratchpad>/dump_routes.py
```

* Script: read-only enumerator; sets `TESTING=1`, imports `routes`, prints
  `path / methods / name / endpoint_module / response_model / dependency names / include_in_schema`.
* Result: **985 registered `APIRoute`s** on `/api` (stderr `TOTAL_APIROUTES: 985`).
* ⚠️ Format trap paid up front (§29): the process prints
  `WARNING: OneSignal credentials not configured` to **stdout** ahead of the JSON, so the first
  `json.load` failed. Fixed by slicing from the first `[`. Inspecting one instance of the output
  before parsing the set is what caught it.

Every "this endpoint exists / is public / has no response model" claim below is read off that dump,
not off a decorator.

### 0.2 Positive controls (ABSENCE IS A CLAIM)

Every negative claim in this file is paired with a positive control run **the same way, in the same
scope**:

| Negative claim | Search | Positive control (same command, same scope) |
|---|---|---|
| No weather route calls a rate limiter | `rate_limit_check` → 3 call sites, **all** `routes/auth_pkg/auth.py:108,363,545` | the symbol *is* found, in `core/rate_limiter.py` and in auth — so the grep works |
| No weather route sets a cache header | `Cache-Control\|max-age\|ETag` over `backend/**/*.py` | **found** at `routes/uploads/core.py:73-84,546` and `routes/gallery/gallery_purchases.py:440` — the grep works; zero hits inside any weather/conditions/health route |
| 5 forecast endpoints appear nowhere in the 12.0+12.1 corpora | `grep -rl <term> audit/weather-simulation-12.0 audit/weather-simulation-12.1` | `conditions/batch` → **12 files**, `client-diagnostics` → **2 files**. The corpora are searchable and these terms resolve. |
| ...and the five that return **0 files**: | `explore/spot-details` 0 · `spot_details` 0 · `surf-conditions` 0 · `copernicus-marine` 0 · `alerts/check` 0 | (controls above) |

### 0.3 Live telemetry used

`audit/weather-simulation-12.2/evidence/network/health-791fdf78-window.json` — a production
`/api/health` capture at this HEAD, containing `request_telemetry` (`routes_tracked: 51`,
`total.n: 3133`, `started_at: 1786661858.6`). Percentiles in that block are **bucket upper bounds**
(`services/request_telemetry.py:66-90`), so only `over_10000ms` counts and `max_ms` are unambiguous.
I quote those, not the percentiles, wherever a percentile lands in the overflow bucket.

### 0.4 Counting rules

* "Weather-serving" = the response body contains a forecast/marine/surf quantity, **or** the route
  ingests/administers one, **or** an instrument in this program reads it.
* Counts below were produced with `<scratchpad>/wx_set.py` over the runtime dump, filtering by
  `endpoint_module`, not by path text.

---

## 1. HEADLINE COUNTS (all from the runtime dump)

| Measure | Value | How counted |
|---|---|---|
| Registered `APIRoute`s on `/api` | **985** | runtime dump |
| Routes in the 10 weather-bearing modules + 2 admin system paths | **65** | `wx_set.py`, filter on `endpoint_module` |
| Of those, **admin-gated** (`get_current_admin`) | **27** | dependency names from `route.dependant` |
| Of those, with **any** auth dependency at all | **28** | `deps != {} and deps != {get_db}` |
| Of those, **fully public / unauthenticated** | **37** | complement of the above |
| Of those, with a **declared `response_model`** | **3** | `/api/weather/grid`, `/api/weather/point`, `/api/weather/spot-ratings` |
| `weather_ingest` endpoints (all admin) | **19** | `endpoint_module == routes.weather_ingest` |
| Weather routes carrying a **`Cache-Control`** header | **0** | §0.2 control |
| Weather routes carrying a **rate limit** | **0** | §0.2 control |

**The single most compressible fact:** of the 65 weather-bearing routes, **3** declare a response
schema. The other 62 return hand-built dicts whose shape is defined only by the return statement.

---

## 2. THE EXHAUSTIVE ENDPOINT INVENTORY

Legend — **Auth**: `public` = no dependency; `db` = `get_db` only (not auth); `admin` =
`get_current_admin`. **Err** = what a caller receives when the thing behind the endpoint fails.

### 2.1 `routes/weather.py` — `APIRouter(prefix="/weather")`, mounted at `/api` (`routes/__init__.py:119`)

| # | Method + path | Auth | Response schema source | Error contract | Cache hdr | Rate limit | Frontend / consumer |
|---|---|---|---|---|---|---|---|
| 1 | `GET /api/weather/products` | public | ad-hoc dict (`weather.py:67-72`) | **none** — no try/except; an exception reaches the global handler → `500 {"detail":"Internal server error"}` (`server.py:514-523`) | none | none | **NO frontend caller.** `backend/scripts/product_run_age_census.py:179`, `pilot_pass_census.py:87`, `timeline_slot_census.py:103`, repo-root `weather_audit.py:15` |
| 2 | `GET /api/weather/grid_series` | public | ad-hoc dict (`grid_series_helper.py:704-714`) | `400` on unparseable `hours` (`grid_series_helper.py:466-469`); **`200` with `frames: [], frame_count: 0, "_error": "<ExcType>: <msg>"` on total build failure** (`:653-657`); **individual failed hours silently dropped** (`:628-632` → `(h, None)` → `:665 continue`) | none | none | `map/marineGridSeries.js:402,560`; `map/windGridSeries.js:175` |
| 3 | `GET /api/weather/grid` | public | **`NormalizedProduct`** (`schemas.py`) | `404` JSONResponse `make_no_coverage_grid_response` on ANY unhandled exception (`weather.py:156-168`); `200` `status:"unsupported"` for ICON `swell_2` (`route_helpers.py:426-468`) | none | none | `map/backendWeatherServiceClient.js:25`, `marineControllerCache.js:221`, `backendWeatherServiceClientDiag.js:18` |
| 4 | `GET /api/weather/point` | public | **`NormalizedPointResponse`** — but **6 escape hatches return a bare `JSONResponse` that bypasses the model**: `point_resolution.py:234,262,281,547,574,678` | `404` (`make_no_coverage_point_response`, 3 sites); **`200`** with `status:"no_coverage"` / `"out_of_bounds/no_coverage"` (`make_grid_miss_point_response`, 3 sites); **`200`** `status:"unsupported"` | none | none | `map/backendWeatherServiceClient.js:26`, `backendPressureServiceClient.js:12`, `backendPrecipitationServiceClient.js:13`, `hooks/useOpenMeteoForecast.js:163,308`, `index.js:103`; **backend** `sim_forecast.py:238` |
| 5 | `GET /api/weather/spot-ratings` | db | **`SpotRatingsResponse`** (`weather.py:420-434`) | `400` bad bbox (`:476`); `503` live-path load shed (`:532`); L2 precompute read failure is **swallowed** → silently falls to the live lane, disclosed only via `source` (`:502-504`) | none | none | `map/spotRatingsClient.js:3,10`, `map/useSpotRatings.js:202`; **backend** `sim_observed.py:98` |
| 6 | `GET /api/weather/buoy-calibration` | public | ad-hoc `{available, ...report}` | returns `{"available": false, "summary": null, "spots": []}` when the L2 blob is unreadable **or** was never written — the two are indistinguishable | none | none | **`backend/scripts/forecast_accuracy_monitor.py:416`** — the WS-OBJ-005 accuracy gate's only live input |
| 7 | `GET /api/weather/report-calibration` | public | ad-hoc `{available, ...}` | same shape as #6 | none | none | **no caller found** in `frontend/` or `backend/scripts/` |
| 8 | `GET /api/weather/status` | public | ad-hoc dict | refuses honestly: `provider_status: not_instrumented`, `stale_products_count: null`, `last_errors: null` + a pointer note (`:683-702`) — **WS-CAN-0010, closed** | none | none | `map/backendWeatherServiceClient.js:24`, `backendWeatherServiceClientDiag.js:17` |
| 9 | `GET /api/weather/capabilities` | public | `capabilities.get_weather_capabilities()` | **none** — no try/except | none | none | `map/LayerAccessResolver.js:41` |
| 10 | `POST /api/weather/client-diagnostics` | **public** | `ClientDiagnosticReport` (input); output `{status, message}` | `500` with `f"Failed to save diagnostic: {str(e)}"` (`:755`) | none | **none** | `map/TruthOverlay.js:147` — the **only** client→server transport in the system |
| 11 | `GET /api/weather/diagnostics-log` | **admin** | ad-hoc | `200` `{"status":"error","message": str(e)}` (`:775`) and `200` `{"status":"error", ...}` for a missing file (`:767`) | none | none | no frontend caller found |

### 2.2 `routes/weather_ingest.py` — 19 endpoints, included into the `/weather` prefix at `weather.py:779`

All 19 are `POST`, all `Depends(get_current_admin)`.

`/api/weather/ingest`, then `ingest_{gfs,icon,euro}_pressure_direct`, `ingest_euro_wind_direct`,
`ingest_euro_estimates_direct`, `ingest_icon_wind_direct`, `ingest_gfs_wind_global_direct`,
`ingest_gfs_wind_global_mid_direct`, `ingest_icon_wind_global_mid_direct`,
`ingest_euro_wind_global_mid_direct`, `ingest_euro_wind_global_direct`,
`ingest_icon_wind_global_direct`, `ingest_euro_marine_global_direct`,
`ingest_icon_marine_global_direct`, `ingest_gfs_pressure_global_direct`,
`ingest_icon_pressure_global_direct`, `ingest_euro_pressure_global_direct`, `ingest_copernicus`.

* **Response schema source:** none declared; `_run_ingest` returns `{"status": "success"|"failed"}`.
* **Error contract:** `weather_ingest.py:113` — `return {"status": "error", "detail": str(e)}` at
  **HTTP 200**, a raw exception string, shared by 18 of the 19. `/api/weather/ingest` itself
  fire-and-forgets a background task and returns `{"status":"ingestion_triggered"}` immediately;
  its inner failure is logged only (`:99-100`) and is **never** observable by the caller.
* **Cache / rate limit:** none.
* **Consumer:** none in `frontend/`. Manual/admin only.

### 2.3 `routes/surf_data/conditions.py` — the WS-CAN-0009 / WS-CAN-0064 file

| Method + path | Auth | Schema | Error contract |
|---|---|---|---|
| `GET /api/conditions/batch` | db | ad-hoc `{conditions:{...}}` | per-spot `200` `{"error": str(e)}` (`:94`) |
| `GET /api/conditions/{spot_id}` | db | ad-hoc | `404` if spot missing (`:117`); else `200` `{"error": "Unable to fetch conditions"}` (`:172`) and `200` `{"error": str(e)}` (`:176`) |
| `GET /api/conditions/forecast/{spot_id}` | db | ad-hoc | `404` (`:195`); `200` `{"error": ...}` (`:212`); `200` `{"error": str(e)}` (`:216`) |
| `GET /api/tides/{spot_id}` | db | ad-hoc | `404` (`:224`); `200` `{"error": ...}` (`:270,:274,:327`); `200` `{"error": str(e)}` (`:331`) |

**Re-verified unchanged at HEAD:** exactly the nine 200-with-error sites the 12.1 register names
(`94, 172, 176, 212, 216, 270, 274, 327, 331`), four of them raw `str(e)` (`94, 176, 216, 331`).
**Not re-reported as new** — WS-CAN-0009 owns them.

**Live latency at HEAD** (`health-791fdf78-window.json`):
`GET /api/conditions/batch` — `n=11`, `over_10000ms=11`, `avg_ms 19,496.7`, `max_ms 36,025.8`,
`p50_ge_ms 10000`. **11 of 11 sampled calls exceeded 10 s.** This is the **third** consecutive audit
window with 100% breach (12.0 RV-01 n=9; 12.1 LV-01 n=8; 12.2 n=11 → pooled **28 of 28**).
Defensible statement: *every sampled call in three windows exceeded 10 s; max observed 58.7 s (12.1),
36.0 s (12.2)*. Confirms WS-CAN-0064; adds nothing new to it.

### 2.4 `routes/surf_spots/conditions.py`

| Method + path | Auth | Schema | Error contract | Consumer |
|---|---|---|---|---|
| `GET /api/surf-conditions` | public | ad-hoc, built in `services/surf_conditions.get_full_conditions` (`:442-500`) | `400` when no coords resolvable (`:71`); upstream failures return a dict with keys **omitted** (`result = {k:v for k,v in result.items() if v is not None}`, `:496`) — an absent key is the only failure signal | `hooks/useCreatePostActions.js:182`, `components/CreatePostModal.js:96` |
| `GET /api/surf-conditions/known-spots` | public | ad-hoc | none | `useCreatePostActions.js:64`, `CreatePostModal.js:65` |
| `GET /api/surf-spots/{spot_id}/live-shooting-pulse` | db | ad-hoc | `404` | not forecast-bearing |

`/api/surf-conditions` runs its **own** upstream fetch — `httpx` direct to
`https://marine-api.open-meteo.com/v1/marine` (`services/surf_conditions.py:13,255-305`) — with its
own 29-entry hardcoded `SPOT_COORDINATES` table and its own NOAA CO-OPS tide client. It does call
`estimate_surf_at` for the breaking height (`surf_conditions.py:91-92`), so the **height** half of
the mandate is satisfied; it emits **no quality/rating at all** (grep for `rating` in that file:
zero hits outside the imports). See §4.1.

### 2.5 `routes/explore_discover/` — the SPOT HUB lane

| Method + path | Auth | Schema | Error contract | Consumer |
|---|---|---|---|---|
| `GET /api/explore/spot-details/{spot_id}` | db | ad-hoc | **`200` `{"error": "Spot not found"}`** for a missing spot (`spot_details.py:53`) — not a 404; a conditions failure is caught and logged, leaving `current_conditions: null` (`:96-97`) | `hooks/useSpotHubActions.js:93` (SpotHub) |
| `GET /api/explore/surf-spots` | db | ad-hoc | per-spot conditions failures swallowed → `current_conditions: null` (`explore.py:116-118`, `:477 return_exceptions=True`) | `hooks/useExploreConditions.js:302,368` |
| `GET /api/explore/search` | db | ad-hoc | — | `useExploreData.js:161`, `GlobalSearchBar.js:92` |
| `GET /api/explore/trending` | db+optional user | ad-hoc | — | `useExploreData.js:55` |

Both forecast-bearing explore routes go through `point_resolution_service.resolve_spot_conditions`,
i.e. the mandated chain — with a **module-local in-process TTL cache** of their own
(`explore.py:39,66-87`, cap 500 entries), a third caching authority alongside `weather.py`'s
`_LIVE_RATINGS_CACHE` and the L1/L2 product store.

### 2.6 `routes/copernicus_marine.py`

| Method + path | Auth | Schema | Error contract | Consumer |
|---|---|---|---|---|
| `POST /api/copernicus-marine` | **public** | `CopernicusMarineRequest` in; raw CMEMS point dicts out, **verbatim, bypassing `WeatherNormalizer`** (`:99-112`) | `400` on shape/bbox/count violations; `503` `detail=str(e)` on missing credentials (`:117`); `502` `detail=f"...{str(e)}"` (`:126`) | `frontend/netlify/functions/weather-proxy-helpers.js:248` (Netlify edge function, with its own in-memory stale cache) |

Unauthenticated, unrate-limited, and it spawns the CMEMS subprocess path
(`services/copernicus_marine_service.py`, 2400 s timeout per project memory).

### 2.7 `routes/surf_data/alerts.py` — the notification lane

| Method + path | Auth | Error contract |
|---|---|---|
| `POST /api/alerts/check` | **public (no auth at all)** | per-alert exceptions caught and logged (`:389`); always `200 {"triggered_count", "triggered"}` |

Iterates **every active `SurfAlert`**, resolves conditions per alert via
`point_resolution_service.resolve_spot_conditions` (`:321`), writes `Notification` rows and
`db.commit()`s (`:391`). Also reachable on a 15-minute schedule (`scheduler/__init__.py:43-45`,
`scheduler/surf_alerts.py:21`) — **two triggers, one of them anonymous**. Body correctly carries
`rating`/`rating_level` from the chain (`:356-360`).

### 2.8 `routes/health.py`

| Method + path | Auth | Schema | Error contract | Consumer |
|---|---|---|---|---|
| `GET /api/health` | db | ad-hoc | never non-200 by design; `database` and `scheduler` failures flip `status` to `unhealthy`/`degraded` (`:250,:275`); **a weather-store failure does not** (`:101-103`) | `apiClient.js:46`, `WeatherDiagnostics.tsx:20,221`, `GoLiveModal.js:155`, `backend/scripts/uptime_probe.py`, keep-warm cron |
| `GET /api/health/simple` | public | `{status, timestamp}` | none needed | load balancers |
| `GET /api/health/data` | public | `compute_data_health()` report | **`503`** on `status == critical`, and `503 {"status":"critical","error": str(e)}` if the computation throws (`:315`) — the one weather endpoint that maps failure to a real status code | `WeatherDiagnostics.tsx:27` |

`/api/health` also carries the `request_telemetry` block (`:183-187`) that WS-OBJ-302 and this audit
read for latency.

### 2.9 `routes/admin/system.py` + `routes/admin/surf_forecast.py`

| Method + path | Auth | Error contract | Consumer |
|---|---|---|---|
| `GET /api/admin/system/health` | admin | storage-metric failure → zeroed dict (`:200-206`); `error_rate` is `None`-safe and emits `status:"not_instrumented"` (`:294-297`) — **WS-CAN-0010, closed** | admin console |
| `GET /api/admin/system/api-metrics` | admin | `n<=0` → `status:"not_instrumented"`, all numeric fields `null` (`:522-531`) — **WS-CAN-0010, closed** | admin console |
| `GET /api/admin/system/storage` · `/jobs` · `PUT /jobs/{name}/toggle` · `/alerts` (+2 POST) | admin | ad-hoc | admin console |
| `GET /api/admin/surf-forecast/status` | admin | per-blob `{"error": str(e)}` inside a `200` (`:251,260,269`) | `AdminSurfForecastPanel.js:36` |
| `POST /api/admin/surf-forecast/size-reference` | admin | `400` bad payload; `503` `detail=f"climatology unavailable: {e}"` (`:308`), `503` blob absent (`:310`) | **no frontend caller** — built for external tooling |
| `GET /api/admin/surf-forecast/local-size-preview` | admin | `503` ×2 (`:356,:360`) | **no frontend caller** |
| `GET /api/admin/surf-forecast/reports` · `DELETE /reports/{id}` | admin | `404` on delete miss | `AdminSurfForecastPanel.js:43,61` |

### 2.10 The MCP / sim surface (`backend/weather_sim_mcp.py` + `services/weather_pipeline/sim_*.py`)

**Not HTTP.** `FastMCP("WeatherSimulationSystem")` over stdio: 6 `@mcp.tool`s
(`get_surf_spots`, `get_weather_forecast`, `simulate_weather_change`, `find_best_window`,
`find_best_spot`, `clear_simulation_overrides`), 1 `@mcp.resource`, 1 `@mcp.prompt`
(`weather_sim_mcp.py:177,240,318,622,663,733,773,779`).

It is an **HTTP client of this same surface**, over the public internet:

* `sim_forecast.py:53-54` — `BASE_URL = os.environ.get("SIM_FORECAST_BASE_URL",
  "https://raw-surf-antigravity.onrender.com")`; `:238` `GET {BASE}/api/weather/point`;
  `:188` `GET {BASE}/api/surf-spots`.
* `sim_observed.py:98` — `GET {APP_BASE}/api/weather/spot-ratings`.

⇒ **The sim reads production over the network by default, unauthenticated, with a `TIMEOUT_S`
budget** — so every latency and error-contract fact in §2.1 applies to it directly. It inherits the
`/api/weather/point` 200-with-`status` no-coverage contract with no schema to validate against.

---

## 3. CROSS-CHECK AGAINST THE NAMED REGISTER ROWS

### WS-CAN-0009 (HTTP status honesty on `/conditions/*`)
**Unchanged at HEAD.** Nine 200-with-error sites, four raw `str(e)`, at the exact lines the register
records. Nothing to re-report. **But the file list is not the defect list** — the same shape is live
at 4 further weather sites the task does not name (§4.4).

### WS-CAN-0064 (`/api/conditions/batch` latency)
**Confirmed a third time**, n=11, 11/11 over 10 s at HEAD. The register's caveat about bucket bounds
is correct and I have kept to it. Nothing new.

### WS-OBJ-302 (bounded latency and capacity)
Its acceptance criterion is *"No route sits above 10 s at the median."* At HEAD, in the same window:

| route | n | over_10000ms | max_ms | passes the median test? |
|---|---|---|---|---|
| `GET /api/conditions/batch` | 11 | **11** | 36,025.8 | **NO** (p50 in overflow) |
| `GET /api/weather/grid_series` | 22 | **4** (18.2%) | 17,883.3 | **yes** — p50 5,000 ms |
| `GET /api/weather/products` | 74 | 0 | 9,656.2 | yes — p50 5,000 ms |
| `GET /api/health` | 143 | 1 | 17,173.1 | yes |

So a median-only criterion **passes** the map's primary field endpoint while 18% of its calls exceed
10 s. SOTA row **B3** is the stricter contract ("per-route p50/**p99**… with a stated envelope") and
covers this; WS-OBJ-302's own closure criterion is narrower than the contract it serves. Recorded as
a coverage observation, not a new defect (§5).

### WS-CAN-0010 / WS-OBJ-506 (measure-or-refuse)
`routes/weather.py:683-702`, `routes/admin/system.py:294-297`, `:522-531` all refuse correctly at
HEAD. **The census stopped at the admin surfaces and at `/weather/status`** — `/api/health`, which
the external probe and the keep-warm cron actually read, was not in it. See §4.2.

---

## 4. WHAT SURVIVED THE ATTEMPT TO KILL IT

Each item below was first checked against all 40 WS-OBJ rows, all 65 WS-CAN rows, the
FINISH_LINE_GAP_MATRIX, and A1–A18 / B1–B15 / C1–C8, **and** grepped across the whole
`audit/weather-simulation-12.0` + `12.1` corpora (positive controls in §0.2).

### 4.1 Five forecast-serving endpoints are absent from the entire 12.0 + 12.1 corpora

`grep -rl` over both audit directories:

```
explore/spot-details   -> 0 files      conditions/batch    -> 12 files   (control)
spot_details           -> 0 files      client-diagnostics  ->  2 files   (control)
surf-conditions        -> 0 files
copernicus-marine      -> 0 files
alerts/check           -> 0 files
```

All five are **live and reachable**:

* `GET /api/explore/spot-details/{spot_id}` — the **SpotHub** (`useSpotHubActions.js:93`). CLAUDE.md
  names "spot hubs" first in the ONE FORECAST COMPOSITION mandate. Serves `current_conditions` +
  `forecast`. Returns **200 `{"error":"Spot not found"}`** instead of 404.
* `GET /api/explore/surf-spots` — batch conditions for the explore list (`useExploreConditions.js`).
* `GET /api/surf-conditions` — a **separate upstream fetch lane** (§2.4) whose value auto-fills the
  post composer's session data and is then stored as the surfer's own report.
* `POST /api/copernicus-marine` — public, unauthenticated, bypasses `WeatherNormalizer`.
* `POST /api/alerts/check` — public, unauthenticated, writes notifications.

11.0's own evidence file `audit/weather-simulation-11.0/evidence/network/B2-backend-pipeline-map.md`
had already mapped four of them, and recorded finding **B2-11** verbatim:
*"`/api/surf-conditions` serves a breaking height with **no quality score**"* — CONFIRMED, Low. It
carried an evidence-file id, never a WS-CAN id, and did not survive into the 12.0 register. This is
precisely the orphan class **WS-OBJ-701** exists to close, applied to endpoints rather than to
findings.

### 4.2 `/api/health` reports `status: "healthy"` when the weather product store is unreadable — and the external probe answers OK

`routes/health.py:85-103`:

```
try:  ... store.get_manifest() ... weather_readiness = {product_count: N, ...}
except Exception as e:
      weather_readiness = {"error": str(e)}
```

`health_data["status"]` is initialised `"healthy"` at `:190` and is only ever changed by the
**database** check (`:250`) and the **scheduler** check (`:275`). The weather branch touches
neither, and appends no entry to `checks`.

Downstream, `backend/scripts/uptime_probe.py:120-131`:

```
n_products = wr.get("product_count")
if isinstance(n_products, int):  ...  if n_products <= 0: code = RED
else:  lines.append("::warning::weather_readiness.product_count absent -- cannot confirm ...")
```

`code` stays **OK**. The probe's own header says *"exit 3 = REFUSED, the probe is BLIND — never
green-when-blind"* (`:31`) and its WS-CAN-0025 receipt says *"GRADES THE BODY… zero products with
HTTP 200 is a total outage a naive check reports as healthy."* Zero products is caught. **Unreadable
products is not** — it downgrades to a warning on a green run.

This is the identical shape WS-CAN-0010 fixed at `system.py:294-297` (*"`None` is the refusal, and it
must NOT collapse into a health verdict"*), on the surface the program's only external monitor
actually reads. Not covered: WS-OBJ-506's two named sites are `routes/admin/system.py:208` and
`TruthOverlay.js:126`, both closed; WS-CAN-0025's remaining work is *schedule it off GitHub*.

### 4.3 WS-OBJ-504 plans to scale a transport whose sink is an unbounded, unauthenticated file

`POST /api/weather/client-diagnostics` (`routes/weather.py:715-755`):

* **no auth dependency** (runtime dump: `deps = []`),
* **no rate limit** (`rate_limit_check` has 3 call sites, all in `auth_pkg/auth.py` — §0.2),
* appends one line per request to `backend/diagnostics.log` (`:742-750`) with **no rotation, no size
  cap, no retention** — grep for `diagnostics.log` across `backend/**/*.py` returns 4 hits, all
  read/write, none a prune. Positive control that retention *is* a concept here:
  `services/weather_pipeline/buoy_residual_retention.py` and `store_helpers.py` retention paths exist.
* `GET /api/weather/diagnostics-log` (admin) then returns **the whole file** in one response
  (`:769-773`), so the file's growth is also the admin endpoint's response size.

WS-CAN-0020's remaining work reads *"Build it; the server-side aggregation pattern already exists"*
and its only recorded blocker (WS-CAN-0063) is now closed — so the next authorised action on
WS-OBJ-504 is to **increase traffic into this sink**. Neither the objective, the task, nor SOTA B5
mentions authentication, rate limiting, or retention on the ingress.

### 4.4 The 200-with-error-body class is live at 4 weather sites outside WS-CAN-0009's named file

WS-CAN-0009's `Current Files / Symbols` is exactly `backend/routes/surf_data/conditions.py:94,172,
176,212,216,270,274,327,331`. The same shape, at HEAD, outside that file:

| site | status | body |
|---|---|---|
| `grid_series_helper.py:653-657` | **200** | `{... frames: [], "_error": "<ExcType>: <msg>"}` — raw exception text, on the map's primary field route, **read by no client** (`_error` appears nowhere in `frontend/src` outside a comment) |
| `weather_ingest.py:113` | **200** | `{"status":"error","detail": str(e)}` — shared by 18 of 19 ingest endpoints |
| `weather.py:775` (and `:767`) | **200** | `{"status":"error","message": str(e)}` |
| `explore_discover/spot_details.py:53` | **200** | `{"error": "Spot not found"}` where 404 is the contract |

Closing WS-CAN-0009 as scoped leaves all four. Its stated outcome — *"A failure is a failure on the
wire"* — is not achieved by fixing one file.

### 4.5 `err_5xx` is structurally blind to the failures WS-CAN-0009 describes

`services/request_telemetry.py:53-54` — `if status >= 500: entry["err"] += 1`. Every site in §4.4 and
every site in WS-CAN-0009 returns **200**. At HEAD the live block reads `total.err_5xx: 0` across
`n=3133`, and **zero** of the 51 tracked routes has a non-zero `err_5xx`.

WS-OBJ-003's Notes field records *"err_5xx 0 across 1904 requests two audits running"* as a
reassuring datum. It is not evidence of reliability on the weather surface; it is a consequence of
the error contract. Nothing in the registers connects the two.

### 4.6 `grid_series` drops failed hours with no requested-vs-served disclosure

`grid_series_helper.py:628-632` returns `(h, None)` for a timed-out or failed hour; `:665` skips it;
the response reports `frame_count: len(frames)` (`:713`) with **no field naming the hours that were
asked for**. A client receiving 5 frames cannot distinguish "5 hours requested" from "8 requested,
3 dropped", and `marineGridSeries.js:465-468` does not diff: it only iterates the frames returned and
treats `json.frames.length === 0` as the fallback trigger (`:444`). Control on the read: `json.frames`
and `json.warming` are both found in that client; `json._error` / `["_error"]` are found nowhere in
`frontend/src` — so the leaked exception string in §4.4 has no reader either.

SOTA **B11** names *"partial data"* explicitly and is marked ⚠️ partial — but its only mapped task
(WS-CAN-0008) is the **worker** crash path in the browser. No objective or task owns the server-side
partial-series disclosure. Note the contrast with the same file's own honesty elsewhere: it *does*
stamp `served_valid_time`, `frame_offset_hours`, `frame_substituted` and `decimated_stride`
per frame (`:681-687`) — the discipline exists, it just stops at the frame that never arrived.

### 4.7 `run_time = datetime.now()` is hardcoded at three point/grid response builders WS-CAN-0005 does not name

`route_helpers.py:432`, `:476`, `:551` each emit
`"run_time": datetime.now(timezone.utc).isoformat()` on a `JSONResponse` point/grid payload, plus a
literal `"freshness_sec": 1800` (`:459, :501, :582`) — WS-CAN-0029's constant.

WS-CAN-0005's named symbols are `store_helpers.py:81-86`, `normalizer.py:142-144`, `scheduler.py
_pick_cycle`. Threading `cycle_dt` through those three leaves these three emitting the wall clock,
on the no-coverage responses where a plausible-looking `run_time` is least justifiable. Low
severity — these are no-data payloads — but it is a scope-completeness fact for an open Repair task.

---

## 5. KILLED — candidates that an existing row already covers

| Apparent concern | Killed by | Why |
|---|---|---|
| `/api/weather/buoy-calibration` returns `{"available": false}` for both "blob unreadable" and "never generated" | WS-CAN-0026 / WS-OBJ-501 | `forecast_accuracy_monitor.py:129-132` **REFUSES** on `available is not True` with an explicit "this is refusal, NOT health" message. The consumer already treats the ambiguity as blindness. Correct as built. |
| `/api/weather/point` `truthTag` / `gridPointParity` computed only for GFS-marine-waves and wind (`weather.py:196-198`) — absent on ICON/EURO marine | WS-CAN-0035 + client-side parity | The marine client computes parity itself (`forecastDeprecationDiag.js:66-80`) with the three-state refusal; only `backendWindServiceClient.js:317` reads the backend field, and wind always qualifies. No user-visible surface loses parity. |
| `/api/weather/grid_series` p90 ≥ 10 s, 4 of 22 over 10 s | SOTA **B3** + WS-OBJ-302 | B3 already requires per-route **p99** with a stated envelope; 12.0 named grid_series (p99 31.1 s) in prose. It passes WS-OBJ-302's median-only criterion, so this is an objective-criterion narrowness observation, not an uncovered route. |
| `/api/weather/spot-ratings` swallows an L2 read failure and falls to the live lane | — (correct as built) | `source` discloses the lane (`precomputed` / `precomputed_stale` / `live` / `disabled`), and `served_valid_time` + `frame_offset_hours` disclose the frame. This is the disclosure discipline WS-OBJ-002 asks for. |
| `/api/weather/products` p50 5,000 ms with no frontend caller | WS-CAN-0064's own LV-07 table | 12.1 LV-07 already measured it (`n=51, p50 5,000, p99 10,669`); at HEAD `n=74, over_10000ms=0`. Below the 10 s median bound. Named, measured, under budget. |
| `/api/weather/status` reports `not_instrumented` rather than numbers | WS-CAN-0010 | This is the fix, not the defect. |
| `weather_ingest.py` not imported by `routes/__init__.py` ⇒ "dead" | — (refuted by execution) | Included at `weather.py:778-779`; all 19 appear in the runtime dump. Recorded so no later pass repeats the mistake. |

---

## 6. RESIDUAL UNCERTAINTY — what this inventory does NOT establish

1. **One telemetry window.** The `health-791fdf78-window.json` capture is cumulative since one
   process start (`routes_tracked: 51`, `n=3133`). Route counts are small for the weather lanes
   (`conditions/batch` n=11, `grid_series` n=22). The 10 s breaches are unambiguous (bucket counts,
   not percentiles); the percentiles are upper bounds and I have not quoted them as measurements.
2. **No route was invoked by me.** Every error contract above is read from source, not from a live
   failure injection. WS-CAN-0036's remaining work — replay the 11.2 failure injection at HEAD —
   would convert §4.2, §4.4 and §4.6 from source claims into observed ones.
3. **The Netlify edge tier is out of area.** `frontend/netlify/functions/weather-proxy.js` fronts
   part of this surface with its own in-memory cache and stale-serving; its interaction with the
   backend error contracts (e.g. whether a 200-with-error body gets cached as a success) was not
   examined.
4. **Response schemas were read, not diffed against a served payload.** The claim "3 of 65 declare a
   response model" is from the runtime dump and is exact; the claim that the 6 `JSONResponse` paths
   on `/api/weather/point` bypass `NormalizedPointResponse` is FastAPI semantics (a returned
   `Response` is not validated), verified by reading the call sites, not by a live request.
5. **`/api/weather/report-calibration` has no located consumer.** Absence of a caller in
   `frontend/` and `backend/scripts/` does not prove none exists — an external tool or a manual
   workflow could read it.
