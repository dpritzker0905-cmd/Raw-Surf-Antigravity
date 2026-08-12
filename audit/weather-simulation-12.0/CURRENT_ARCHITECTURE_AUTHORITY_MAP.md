# CURRENT ARCHITECTURE AUTHORITY MAP

`dev` @ `3ec3fd13` · 2026-08-12

**Status vocabulary:** Single Verified Authority · Single Unverified Authority · Explicitly
Coordinated Authorities · Transitional Dual Path · Accidental Duplicate Authority · Bypass Present ·
Authority Unknown · Not Applicable

---

## 1. Data plane

| Responsibility | Intended authority | Current runtime authority | Legacy / alternative | Status |
|---|---|---|---|---|
| Data ingestion | Decoupled GitHub Actions runner | Same — verified green today (`forecast-ingest.yml` 17:14Z) | In-process scheduler (`tracked()` records success on a crashing job) | **Transitional Dual Path** — legacy is a broken fallback, not a live path |
| Model normalization (order, units, ±180 wrap, antimeridian mirror) | `WeatherNormalizer.normalize` | Same | none | **Single Verified Authority** |
| Grid orientation / direction conventions | `WeatherNormalizer` + `_fetch_common` | Same | none | **Single Verified Authority** |
| Spatial interpolation | `point_resolution` with `_selection_key (diff, resolution, area)` | Same | none | **Single Verified Authority** |
| **Product selection at z8/z9/z10** | deterministic ladder | **non-deterministic** — layer off→on ×3 at a fixed coordinate gave 0.64/6.8 → 0.44/3.1 → 0.64/6.8 | — | ⚠️ **Authority Unknown** (WS-CAN-0033) |
| **Model-run identity** | model cycle (`cycle_dt`) | **ingest wall clock** — proven live: `run_time 12:59:41Z` on an `18:00:00Z` product | `_pick_cycle` knows `cycle_dt` and discards it | ⚠️ **Bypass Present** (WS-CAN-0005) |
| **Resolution disclosure** | backend stamps `resolution` | **client derives it** from served grid bounds (`backendWeatherServiceClientDiag.js:203-210`, labelled `resolutionSource`) because the backend sends `null` | — | ⚠️ **Bypass Present** (WS-CAN-0014) |
| Storage / manifest | `ProductStore` + `manifest.json` + Postgres CAS pointer | Same | — | **Single Unverified Authority** — the anti-clobber guard fails open silently |
| Integrity verification | end-to-end checksum | **none exists** — 2 `hashlib` uses in the whole pipeline, neither an integrity check | — | **Not Applicable — absent** (WS-CAN-0017) |

## 2. Physics plane

| Responsibility | Authority | Status |
|---|---|---|
| Nearshore breaking height | `surf_point.resolve_surf_geometry` → `estimate_surf_at` | **Single Verified Authority** |
| Quality score 0–100 | `surf_rating.compute_surf_rating` | **Single Verified Authority** |
| `surf_height_m` write | `point_surf_augment.py:204` — **exactly one production write site** | **Single Verified Authority** |
| Sim physics | delegates both halves to production, in production order; AST-guarded | **Single Verified Authority** |
| Constants | `science_registry.py` + ratchet (`d12d363c`) | **Single Verified Authority** |
| JS rating mirror (infobox) | `surfRating.js` — hand-maintained | **Explicitly Coordinated Authorities** — `MIN_SWELL_ENERGY_SHARE = 0.50` ported (`:116`), parity-gated on 6 of 12 args |
| **Rating band vs spot glyph** | *should* answer one question | ⚠️ **Accidental Duplicate Authority** — band rates each cell with that cell's geometry + co-sampled wind; the glyph uses the SPOT's resolved geometry. Close zoom over-reads 2.3–2.7× (WS-CAN-0024) |
| **ICON > 168 h composition** | backend bake (`icon_marine_extension.py:85-124`) | ⚠️ **Transitional Dual Path** — `backendWeatherServiceClient.js:272` client blend is the unconditional per-hour path; which one a user sees depends on series-cache warmth (WS-CAN-0007) |

## 3. Client state plane

| Responsibility | Authority | Status |
|---|---|---|
| Forecast hour | `useWeatherState.timeOffsetHours`, with 6 one-way mirrors | **Single Unverified Authority** |
| **Hour zero** | — | ⚠️ **Accidental Duplicate Authority** — backend floors now-UTC; the frontend per-hour lane rounds then snaps; the label is raw client-clock local time. Three owners (WS-CAN-0016) |
| Model / layer selection | `useWeatherState` | **Single Verified Authority** |
| Marine fetch + commit | `useMarineOrchestrator` / `useMarineDataFetcherCore` — monotonic request ids, live-target identity, coalesce-hour resolution | **Single Verified Authority** |
| Commit arbitration | branch-heavy guard chain **live**; `arbiterDecide` (pure, 3000-fixture differential) **dark** behind `__RAW_MARINE_ARBITER__` | ⚠️ **Transitional Dual Path** (WS-CAN-0043) |
| Async cancellation | monotonic request ids + live-target guards | **Single Verified Authority** — 11.0 verified line-by-line; every race Codex hypothesized is guarded |
| Data cache | model-keyed frontend caches | **Single Verified Authority** |
| Service-worker cache | `update-sw-version.js` + `BUILD_VERSION` + stale-bundle self-check | **Single Verified Authority** |
| Worker lifecycle | `useGridWorker` — shared instance, `onerror`/`onmessageerror` set (`:42`), re-created on next use (`:68`) | **Single Verified Authority** |

## 4. Render plane

| Responsibility | Authority | Status |
|---|---|---|
| Projection | exact per-vertex Web Mercator, clamp `85.051129`, world-copy offsets `[0, −360, +360]` | **Single Verified Authority** — certified by 11.2 incl. a self-refuted false positive |
| MapLibre repaint | `MapWebGL` custom layers | **Single Verified Authority** |
| GPU texture / buffer lifecycle | `disposeEngine` + `safeDeleteTexture` + `WebGLStateIsolation` (units 0–6) | **Single Unverified Authority** — the (c) encoder error-rollback was never independently re-verified |
| Ocean mask | `marineMaskShelter` + a bounded LRU verdict cache (~2 MB) | **Single Verified Authority** — RV-04 confirms the cache is guarded |
| **Animation scheduling** | one RAF owner per surface | ⚠️ **Accidental Duplicate Authority** — `WeatherTelemetry.js:397,399` starts a RAF loop at module import with **zero** `cancelAnimationFrame` in the file (WS-CAN-0022) |
| Particle integration | per-frame forward Euler, **no `dt` term**, in both WebGL engines; both Canvas2D fallbacks *are* dt-normalized | **Explicitly Coordinated, knowingly divergent** (WS-CAN-0011, deferred) |
| Cursor sampling / infobox values | point lane, parity-checked against the heatmap | **Single Verified Authority** — the parity check now REFUSES on unsampled |
| Legends | ramp-derived for wind; hand-maintained elsewhere | ⚠️ **Transitional Dual Path** — 2 of 7 readout-truth items shipped (WS-CAN-0015) |

## 5. Observability plane

| Responsibility | Authority | Status |
|---|---|---|
| Backend request metrics | `services/request_telemetry` — live, 47 routes tracked, surfaced on `/api/health` | **Single Verified Authority** |
| Backend status endpoints | `/api/weather/status` refuses with a pointer; admin `api-metrics` reads `request_telemetry` | ⚠️ **Bypass Present** — `routes/admin/system.py:208` `error_rate = 0.5  # Placeholder` is still live and consumed at `:272-273` (WS-CAN-0010) |
| Frontend truth lineage | `weatherTruthTracker` — 12 stages + `chainCancelled`, FNV hashes, `build` stamp | **Single Verified Authority** |
| Frontend↔backend parity | `forecastDiagnostics` — three-state `parityStatus` with `unsampledReasons` | **Single Verified Authority** |
| **Client→server transport** | — | ⚠️ **Not Applicable — absent.** `TruthOverlay.js:141` is the only transport in the system (WS-CAN-0020) |
| Release identity | health SHA · SW `BUILD_VERSION` · `__RAW_GPU__.build` · truth/telemetry payload stamps | **Single Verified Authority** |
| Accuracy validation | `forecast_accuracy_monitor.py` + skill ledger | ⚠️ **Single Authority grading the wrong quantity** (WS-CAN-0026) |

## 6. Release plane

| Responsibility | Authority | Status |
|---|---|---|
| Backend deploy | Render, auto-deploys `dev` on push | **Single Verified Authority** — live `…-69865877` |
| Dev frontend | Netlify `dev--rawsurf.netlify.app` | **Single Verified Authority** — `BUILD_VERSION 3ec3fd13` = HEAD exactly |
| **Production frontend** | Netlify `rawsurf.netlify.app` | ⛔ **Frozen at `3bd38a83` (2026-05-20) — 84 days behind HEAD.** Owner-gated (WS-CAN-0039) |
| CI gating | GitHub Actions — all workflows green today | **Single Verified Authority** |

---

## 7. The five ownership questions to close, in order

1. **Product selection at z8/z9/z10** (Authority Unknown) — blocks any finer nearshore model, because
   a finer model cannot be validated while a fixed coordinate's value depends on interaction history.
2. **ICON > 168 h composition** (Dual Path) — the project's own binding mandate, one subsystem over.
3. **`run_time` semantics** (Bypass) — every lead-time computation downstream inherits the error.
4. **The `WeatherTelemetry` RAF loop** (Duplicate) — the one true RAF-invariant violation, and it
   runs on every screen of the app.
5. **The accuracy criterion** (grading the wrong quantity) — **the authorized mission.**
