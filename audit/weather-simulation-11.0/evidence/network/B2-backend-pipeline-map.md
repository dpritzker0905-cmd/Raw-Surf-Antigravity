# B2 — BACKEND DATA PIPELINE AND FORECAST COMPOSITION

**Agent B / MASTER-AUDIT-11.0 · repo `C:/Users/dprit/Raw-Surf` · branch `dev` · HEAD `3d3ccdc2` (clean tree)**
**Read-only forensic audit. No file under `backend/`, `frontend/`, `scripts/`, `tests/` was modified.**

Method: `Grep`/`Read` over the tree for code facts; offline execution of the *bundled* physics
(`C:/Users/dprit/AppData/Local/Python/bin/python3.exe`, cwd `backend/`, **no network, no DB, no env
vars set**) for every number labelled MEASURED. Executed probes touched only
`surf_point`, `surf_transform`, `surf_rating`, `surf_height_convention`, `science_registry`
— all pure in-process compute over the bundled ETOPO/shore-normal assets.

**What I could NOT verify (BLOCKED, stated once here and referenced below):**
- The **Render environment variable set**. Every "default" below is the *code* default observed with
  the variable unset. If Render sets a flag, the live value differs and I have no read path.
- **Live upstream behaviour** (rate limits, actual GFS cycle currently served) — no network calls made.
- **Production DB / Supabase L2 blob contents** — not read (local `backend/.env` points at the phantom
  Supabase project per project memory; reading it would have been misleading).

---

## 0. END-TO-END DIAGRAM (text)

```
════════════════════════════ INGEST (batch: GH Actions runner + Render APScheduler) ══════════════════
                                                                     [flags: *_DIRECT, default "1"]
 NOAA AWS Open Data  ──► services/noaa_gfs_wave_fetcher.py     ─┐  (subprocess, GRIB2 byte-range)
 (noaa-gfs-bdp-pds)  ──► services/noaa_gfs_wind_fetcher.py     ─┤
                     ──► services/noaa_gfs_pressure_fetcher.py ─┤
 DWD opendata.dwd.de ──► services/dwd_gwam_fetcher.py          ─┤   each writes
                     ──► services/dwd_icon_wind_fetcher.py     ─┤   "Open-Meteo-shaped JSON"
                     ──► services/dwd_icon_pressure_fetcher.py ─┤   (list of point dicts,
 ECMWF open-data     ──► services/ecmwf_opendata_fetcher.py    ─┤    hourly arrays, __provider)
 CMEMS (copernicus-  ──► services/copernicus_global_fetcher.py ─┤
   marine, auth)     ──► services/copernicus_fetcher.py        ─┤
 Open-Meteo REST     ──► weather_pipeline/providers/           ─┘
   (marine + forecast)     open_meteo_provider.py .fetch_grid
                                                                │
                          services/*_service.py  (subprocess spawn + JSON read)
                                                                │
                                                                ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  weather_pipeline/scheduler_helpers.normalize_and_    │
                       │  save_loop  ──►  normalizer.WeatherNormalizer.        │
                       │  normalize()   (THE one normalizer)                   │  ← run_time PASSED here
                       └──────────────────────────────────────────────────────┘
                                                                │  NormalizedProduct (grid of GridVector)
                                                                ▼
                       weather_pipeline/store.ProductStore.save_products_batch
                          L1 = backend/uploads/weather_products/<filename>.json  (filename carries VALID_TIME)
                          L2 = Supabase Storage bucket + manifest.json
                                                                │
════════════════════════════ SERVE (Render, 1 CPU) ══════════════════════════════════════════════════
                                                                │
   ProductStore.load_product(filename)  ← L1 mem cache (300 s) ← disk ← L2 download (neg-cached 60 s)
                                                                │
        ┌───────────────────────────────────────────────────────┴────────────────────────────┐
        │                                                                                     │
  ┌─────▼───────────────────────────────┐                          ┌──────────────────────────▼─────┐
  │ POINT LANE                          │                          │ GRID LANE                      │
  │ point_resolution.resolve_point      │                          │ grid_resolver.resolve_grid     │
  │  1 dynamic index → 2 manifest       │                          │  (+ dynamic viewport fetch →   │
  │  → 3 direct upstream point fallback │                          │   viewport_upstream /          │
  │  selection key = (|Δt|, res, area)  │                          │   viewport_helper → normalize) │
  │        ⚠ run_time NOT in the key    │                          │  → coarse_gulf_fill            │
  │                                     │                          │  → grid_resolver_surf.apply_   │
  │  → wave_physics.stamp_point_validity│                          │      surf_overlay  (surf=1)    │
  │  → point_surf_augment.augment_with_ │                          │        │                       │
  │      surf   ★ SINGLE INJECTION      │                          │        ▼                       │
  │        resolve_surf_geometry        │                          │  surf_rating.rating_transform_ │
  │        estimate_surf_at             │                          │  grid  ──► surf_transform.     │
  │        → response.surf_height_m     │                          │            estimate_surf(bare) │
  └─────┬───────────────────────────────┘                          │  ⛔ NOT estimate_surf_at       │
        │                                                          └──────────┬─────────────────────┘
        │                                                                     │
  ┌─────▼──────────────┬──────────────────┬───────────────────┐               ▼
  │ spot_ratings.      │ spot_conditions. │ sim_rating.       │        /api/weather/grid
  │ rate_one_spot      │ resolve_spot_    │ calculate_surf_   │        /api/weather/grid_series
  │ (REFERENCE IMPL)   │ conditions_impl  │ rating            │        (score/10 in `speed`,
  │  compute_surf_     │  _breaking_ft →  │  estimate_surf_at │         offshore Hs in `phys_speed`)
  │  rating(...)       │  estimate_surf_at│  rating_score     │
  │                    │  compute_surf_   │                   │
  │                    │  rating          │                   │
  └────────┬───────────┴────────┬─────────┴─────────┬─────────┘
           │                    │                   │
  /api/weather/spot-ratings   /api/conditions/{id}  weather_sim_mcp tools
  (precomputed L2 blob        /api/conditions/batch (MCP; sim_forecast also
   → stale ladder → live)     /api/conditions/forecast/{id}   re-reads PROD /api/weather/point)
                              /api/alerts/check (notification body)

  SEPARATE, 4th lane:  /api/surf-conditions  →  services/surf_conditions.py
                       (own httpx call to marine-api.open-meteo.com; height IS delegated to
                        estimate_surf_at, but NO quality score and NO normalizer)
  SEPARATE, 5th lane:  POST /api/copernicus-marine → services/copernicus_marine_service.fetch_euro_marine
                       (raw CMEMS point dicts, NO normalizer, offshore Hs under `wave_height`)
```

---

## 1. UPSTREAM PROVIDERS — WHO FETCHES WHAT, AND WHAT IS LIVE AT HEAD

| Upstream | Host | Fetcher module | Wrapper service | Consumed by | Live at HEAD? |
|---|---|---|---|---|---|
| **NOAA GFS-Wave 0.25°** | `noaa-gfs-bdp-pds.s3.amazonaws.com` (`noaa_gfs_wave_fetcher.py:41`) | `services/noaa_gfs_wave_fetcher.py` | `noaa_marine_service.py` | `scheduler.py:156,228,318`, `marine_mid_res_ingestion.py:139` | **ACTIVE** (`GFS_MARINE_NOAA_DIRECT` default `"1"`, `scheduler.py:95`, `marine_mid_res_ingestion.py:68,134`) |
| **NOAA GFS atmos wind** | same S3 (`noaa_gfs_wind_fetcher.py:30`) | `noaa_gfs_wind_fetcher.py` | `noaa_wind_service.py` | `wind_ingestion.py:91,164`, `wind_mid_res_ingestion.py:53` | **ACTIVE** (`GFS_WIND_NOAA_DIRECT` default `"1"`) |
| **NOAA GFS MSL pressure** | same S3 (`noaa_gfs_pressure_fetcher.py:26`) | `noaa_gfs_pressure_fetcher.py` | `noaa_pressure_service.py` | `pressure_ingestion.py:125` | **ACTIVE** (`GFS_PRESSURE_NOAA_DIRECT` default `"1"`, `pressure_ingestion.py:120`) |
| **DWD GWAM (ICON wave)** | `opendata.dwd.de` (`dwd_gwam_fetcher.py:9,38`) | `dwd_gwam_fetcher.py` | `dwd_marine_service.py` | `scheduler.py:434`, `marine_mid_res_ingestion.py:180,348,376` | **ACTIVE** (`ICON_MARINE_DWD_DIRECT` default `"1"`) |
| **DWD ICON wind (icosahedral)** | `opendata.dwd.de` (`dwd_icon_wind_fetcher.py:35`) | `dwd_icon_wind_fetcher.py` | `dwd_wind_service.py` | `wind_ingestion.py:424,634` | **ACTIVE** (`ICON_WIND_DWD_DIRECT` default `"1"`) |
| **DWD ICON pressure** | `opendata.dwd.de` (`dwd_icon_pressure_fetcher.py:43`) | `dwd_icon_pressure_fetcher.py` | `dwd_pressure_service.py` | `pressure_ingestion.py:184` | **ACTIVE** (`ICON_PRESSURE_DWD_DIRECT` default `"1"`) |
| **ECMWF open-data IFS (wind/pressure/wave)** | `ecmwf-opendata` client (ecmwf/aws/azure, `ECMWF_OPENDATA_SOURCE`) | `ecmwf_opendata_fetcher.py` | `ecmwf_wind_service.py`, `ecmwf_pressure_service.py`, `ecmwf_wave_service.py` | `wind_ingestion.py:278,710`, `pressure_ingestion.py:300`, `marine_mid_res_ingestion.py:248,436,460`, `euro_marine_coarse_ingestion.py:147` | **ACTIVE** (`EURO_WIND_ECMWF_DIRECT`, `EURO_PRESSURE_ECMWF_DIRECT`, `EURO_MARINE_MID_ECMWF` all default `"1"`) |
| **Copernicus CMEMS global wave (zarr subset)** | `copernicusmarine` python client (auth) | `copernicus_global_fetcher.py` (thin lat-band), `copernicus_fetcher.py` (subset) | `copernicus_marine_service.py` | `euro_marine_coarse_ingestion.py:107`, `marine_mid_res_ingestion.py:271`, **serve-path point lane** `point_resolution.py:464` | **ACTIVE** — note it is the *point-lane* EURO source even when the *grid* lane is ECMWF |
| **Open-Meteo Marine** | `marine-api.open-meteo.com/v1/marine` (`open_meteo_provider.py:185`) | `providers/open_meteo_provider.py` | — | every ingest fallback + `fetch_point` on the serve path | **ACTIVE** (universal fallback) |
| **Open-Meteo Forecast** | `api.open-meteo.com/v1/forecast` (`open_meteo_provider.py:186`) | same | — | wind/pressure/precip fallback | **ACTIVE** |
| **Netlify weather-proxy** | `dev--rawsurf.netlify.app/.netlify/functions/weather-proxy` (`open_meteo_provider.py:171`) | same | — | gated `USE_WEATHER_PROXY` default `"true"` | **ACTIVE** |
| **Open-Meteo tide (`sea_level_height_msl`)** | `marine-api.open-meteo.com` (`tide.py:20`) | `weather_pipeline/tide.py` | — | `routes/surf_data/conditions.py:249` (`/api/tides/{id}`), `spot_ratings` (gated `RATING_TIDE=0`) | **ACTIVE for `/api/tides`**, dark for the rating |
| **NOAA CO-OPS tides** | `api.tidesandcurrents.noaa.gov` | inline in `routes/surf_data/conditions.py:280` and `services/surf_conditions.py:14` | — | `/api/tides/{id}` legacy branch (`TIDES_GLOBAL_SOURCE=0`) + `/api/surf-conditions` | **legacy branch DARK** (`TIDES_GLOBAL_SOURCE` default `"1"`); **still live inside `/api/surf-conditions`** |
| **NDBC buoys** | `www.ndbc.noaa.gov` (`buoy_calibration.py:12,24,264`) | `weather_pipeline/buoy_calibration.py` | — | cron calibration report → `/api/weather/buoy-calibration` | ACTIVE (diagnostic only, gated `BUOY_CALIBRATION`) |
| **Open-Meteo (forecast-skill probe)** | `marine-api.open-meteo.com` (`forecast_skill.py:47`) | `weather_pipeline/forecast_skill.py` | — | skill ledger | ACTIVE (`FORECAST_SKILL` default `"1"`) |
| **Production Raw-Surf API** | `raw-surf-antigravity.onrender.com` (`sim_forecast.py:54`, `sim_observed.py:46`) | sim lane | — | MCP sim live forecast + catalogue | ACTIVE (`SIM_LIVE_FORECAST`/`SIM_LIVE_CATALOG` default `"1"`) |
| **ERA5 / Copernicus CDS** | — | **no backend fetcher**; only `backend/scripts/era5_deepen_climatology.py` | — | offline campaign | **NOT in the serving path** |
| gribstream | — | — | — | — | **ABSENT** — grep over the whole repo returns nothing |

### 1b. Dead / near-dead upstream code

**`services/weather_worker.py` — DEAD.** It declares its own `marine-api.open-meteo.com` /
`api.open-meteo.com` constants (`:21-22`). `grep -rn "weather_worker" --include=*.py backend/`
returns **zero importers**. CONFIRMED.

**`services/forecast_ingester.py` — LIVE BUT ITS OUTPUT IS UNREACHABLE.** It runs twice every
scheduler cycle (`scheduler/forecast.py:24` wind, `:32` marine, registered as
`ingest_marine_forecast_task`), makes 2 Open-Meteo calls with `models=best_match`
(`forecast_ingester.py:52`) and atomically writes `uploads/forecast_cache/{wind,marine}_global.json`
(`:90`).
- `marine_global.json` has **no reader** anywhere in the repo (grep).
- `wind_global.json` has exactly three readers — the last-resort fallbacks at
  `wind_ingestion.py:190` (GFS), `:304` (EURO), `:501` (ICON) — and each guards with
  `if len(cached_data) < 100: ... Skipping this cycle` (`wind_ingestion.py:196-198`).
- **MEASURED**: the ingester's grid is `for lat in range(50,9,-10)` × `for lon in range(-130,-50,10)`
  = 5 × 8 = **40 points** (executed). 40 < 100, so the guard rejects it **every time**.
⇒ Two upstream calls per cycle whose product cannot be consumed. Also worth noting: were the guard
ever satisfied, the fallback stamps `estimate_basis.source_model = "gfs_seamless"`
(`wind_ingestion.py:241`) on data actually fetched with `models=best_match` — and the *same* file is
recycled into the GFS, EURO **and** ICON lanes.

---

## 2. SURF HEIGHT / QUALITY COMPOSITION

### 2a. The mandated chain

```
surf_point.resolve_surf_geometry(lat,lng)            surf_point.py:65
    bathymetry.shelf_depth_at / is_coastal / shelf_width_km / shore_normal_at      :70-76
    shore_normal_asset.shore_normal_at + match_km_at  (SHORE_NORMAL_ASSET=1)       :92-107
    surf_magnets.shore_normal_override_at             (SURF_V3_NORMAL_OVERRIDES=1) :118-123
    surf_magnets.magnet_factor_at                                                  :131-133
    shore_normal_asset.break_depth_at                                              :141-142
    coastal promotion by bearing / land-bit                                        :184-211
        └─► SurfGeometry
surf_point.estimate_surf_at(...)                     surf_point.py:223
    surf_transform.estimate_surf_partitioned(...)  when partitions supplied        :240-248
    surf_transform.estimate_surf(...)              otherwise                       :258-267
surf_rating.compute_surf_rating(...)                 surf_rating.py:662
    → surf_rating.rating_score  :551 → surf_rating.rating_factors :574   (ONE product of 9 factors)
    → surf_rating.score_to_level :644
```

### 2b. EVERY call site of `estimate_surf_at` (production code, tests/scripts excluded)

| # | File:line | Caller | Notes |
|---|---|---|---|
| 1 | `weather_pipeline/point_surf_augment.py:195` | `augment_with_surf` | **THE single injection point** for `surf_height_m` (module docstring `:8`). Feeds the point lane → glyphs, hub, sim. |
| 2 | `weather_pipeline/spot_conditions.py:64` | `_breaking_ft` | spot hub `current` + `forecast[]` + `hourly_breaking_forecast` |
| 3 | `weather_pipeline/sim_rating.py:239` | `calculate_surf_rating` | the weather sim |
| 4 | `services/surf_conditions.py:92` | `_breaking_ft` | `/api/surf-conditions` |

Scripts (not served): `science_shadow_ab.py:119,150`, `partitions_rating_ab.py:162,177`,
`era5_deepen_climatology.py:203`, `directional_exposure_probe.py:103`,
`build_spot_size_climatology.py:138`, `artifact_interpreter_parity.py:98`.

### 2c. EVERY call site of `compute_surf_rating` / `rating_score` (production code)

| # | File:line | Function | Surface |
|---|---|---|---|
| 1 | `weather_pipeline/spot_ratings.py:171` | `rate_one_spot` | **REFERENCE IMPL** — `/api/weather/spot-ratings` live + cron precompute |
| 2 | `weather_pipeline/spot_conditions.py:397` | `resolve_spot_conditions_impl` | spot hub / `/api/conditions/{id}` / alerts |
| 3 | `weather_pipeline/sim_rating.py:293` | `calculate_surf_rating` (via `rating_score`) | weather sim MCP |
| 4 | `weather_pipeline/surf_rating.py:768` | `rating_transform_grid` | **map RATING BAND** — see finding B2-01 |
| 5 | `weather_pipeline/local_size_preview.py:241` | admin size-reference preview | admin-only, not a served forecast |

Post-`rating_score` steps (invisible to the AST parity guard, per its own note): observation gate at
`spot_ratings` (via `routes/weather.py:599` live path / precompute), `spot_conditions.py:431`,
`sim_rating.py:326`, and the band's `gate_fn` (`surf_rating.py:772-777`).

### 2d. SURFACE INVENTORY — does each go through the chain?

| Surface / endpoint | Height source | Quality source | Verdict |
|---|---|---|---|
| `GET /api/weather/point` | `point_surf_augment.py:195` → `estimate_surf_at` | n/a (frontend badge composes) | **THROUGH THE CHAIN** |
| `GET /api/weather/spot-ratings` (live) | `marine.surf_height_m` (`spot_ratings.py:107`) | `compute_surf_rating` `:171` | **THROUGH THE CHAIN** |
| `GET /api/weather/spot-ratings` (precomputed L2) | same producer, run on the cron runner | same | **THROUGH THE CHAIN** (frame may be up to 6 h stale — `SPOT_RATINGS_STALE_TOLERANCE_S=21600`) |
| `GET /api/conditions/{spot_id}` `current` | `spot_conditions._breaking_ft` `:64` | `compute_surf_rating` `:397` | **THROUGH THE CHAIN** |
| `GET /api/conditions/{spot_id}` `forecast[]` | `hourly_breaking_forecast` → `_breaking_ft` (`routes/surf_data/conditions.py:140`) | none | **THROUGH THE CHAIN** for the height |
| `GET /api/conditions/forecast/{spot_id}` (daily) | `spot_conditions.py:497` `_breaking_ft` | none | **THROUGH THE CHAIN** for the height |
| `GET /api/conditions/batch` | same producer, whitelisted keys (`routes/surf_data/conditions.py:85-90`) | **rating dropped by the whitelist** | height OK; quality never reaches the client |
| `POST /api/alerts/check` (push body) | `current["wave_height_ft"]` from the producer (`routes/surf_data/alerts.py:328`) | `current["rating"]` `:356` | **THROUGH THE CHAIN** |
| `GET /api/surf-conditions` | `services/surf_conditions.py:92` `estimate_surf_at` | **NONE** | height OK; **no quality** (CLAUDE.md "a size without a quality is also incomplete") |
| **`GET /api/weather/grid?surf=1`** (map band) | `surf_rating.rating_transform_grid` → **bare `estimate_surf`** (`surf_rating.py:703,738`) | `compute_surf_rating` `:768` computed **on that height** | ⛔ **SECOND HEIGHT PATH — finding B2-01** |
| **`GET /api/weather/grid_series?surf=1`** | same (`routes/weather.py:103` reuses `get_grid`) | same | ⛔ same |
| `GET /api/weather/grid?surf=1` with `SURF_RATING=0` | `surf_transform.surf_transform_grid` → bare `estimate_surf` (`surf_transform.py:790`), written straight into `vec.speed` | none | ⛔ same, and the raw number is the rendered channel |
| `POST /api/copernicus-marine` | raw CMEMS point dicts, verbatim (`routes/copernicus_marine.py:99-112`) | none | offshore Hs, **correctly named** `wave_height`; bypasses the normalizer entirely |
| `GET /api/weather/grid?surf=0` | offshore Hs in `speed` | none | correct — this is the declared "swell" field |
| weather-sim MCP tools | `sim_rating.py:239` | `sim_rating.py:293` | **THROUGH THE CHAIN** (see §3) |

**No surface at HEAD publishes `point.speed` under a surf-height field name.** The two historical
offenders are both closed and I re-verified them: `spot_conditions.py` (`_breaking_ft` at `:53-71`,
with the offshore value retained beside it under `offshore_height_ft` at `:365`) and
`services/surf_conditions.py` (`:92`, offshore kept as `swell_height_ft` at `:323`).

---

### ⛔ FINDING B2-01 — the map surf/rating band re-derives the breaking height outside `estimate_surf_at`
**CONFIRMED (code + measured). Severity: High.**

`surf_rating.rating_transform_grid` imports `estimate_surf` directly
(`backend/services/weather_pipeline/surf_rating.py:703`) and calls it as:

```python
surf, regime = estimate_surf(sp, period, depth, coastal=True, shelf_width_km=width)   # :738
```

Compare `surf_point.estimate_surf_at` (`surf_point.py:258-267`), which passes **five further
arguments** resolved by `resolve_surf_geometry`: `swell_from_deg`, `shore_normal_deg`,
`magnet_factor`, `break_depth_m`, `water_level_m`. The band therefore omits, for the HEIGHT:

* the directional exposure factor `_height_exposure_factor` (`surf_transform.py:360,505`) —
  it needs *both* `swell_from_deg` and `shore_normal_deg` and returns `1.0` if either is `None`
  (`:366-367`);
* the sub-grid magnet factor (`surf_transform.py:516`);
* the ETOPO nearshore **break depth**, so the depth-limited cap falls back to the ~139 km shelf
  median (`surf_transform.py:479-481`) — the depth that "bound on 0 of 395 live spots"
  (`surf_transform.py:474-476`).

The band *does* sample a shore normal (`surf_rating.py:749-754`) but uses it **only** for the quality
half; the omission of `break_depth_m` from `compute_surf_rating` is separately deliberate and
documented (`surf_rating.py:763-767`). The height omission is not documented anywhere.

`surf_transform.surf_transform_grid` (`surf_transform.py:790`) — the band served when
`SURF_RATING=0` — has the identical shape and writes the result straight into `vec.speed` (`:794`).

**MEASURED at HEAD** (env unset; `resolve_surf_geometry` for the real coordinate, then
`estimate_surf_at(...)` vs the band's bare `estimate_surf(sp, Tp, g.depth_m, coastal=True,
shelf_width_km=g.shelf_width_km)`; wind/normal held identical so only the height half varies):

*Directional term, Hs 2 m / Tp 14 s:*

| spot | Δθ from shore normal | glyph height (m) | band height (m) | band / glyph |
|---|---|---|---|---|
| Pipeline | 0° | 3.1004 | 3.1004 | **1.000** (control) |
| Pipeline | 75° | 2.1698 | 3.1004 | **1.429** |
| Trestles | 75° | 2.1698 | 3.1004 | 1.429 |
| Cocoa Beach | 75° | 1.6884 | 2.4126 | 1.429 |
| Jeffreys Bay | 75° | 2.0873 | 2.9826 | 1.429 |
| Mavericks | 75° | 2.1052 | 3.0081 | 1.429 |

*Depth-cap term, head-on, Tp 16 s:*

| spot | Hs (m) | glyph (m) / regime | band (m) / regime | band / glyph |
|---|---|---|---|---|
| Pipeline (break depth 11.1 m) | 12.0 | 8.9910 `breaking` | 13.7133 `shelf` | **1.525** |
| Cocoa Beach (break depth 5.9 m) | 8.0 | 4.7790 `breaking` | 7.3438 `shelf` | **1.537** |
| Cocoa Beach | 12.0 | 4.7790 `breaking` | 10.1576 `shelf` | **2.125** |
| Mavericks (break depth 22.1 m) | ≤12.0 | equal | equal | 1.000 (control) |

**Consequence, measured, on the SCORE** (same wind 3 m/s, same shore normal, same period; the only
difference is which height reaches `compute_surf_rating`):

| spot | Hs / Δθ | score from glyph height | score from band height | level glyph → level band |
|---|---|---|---|---|
| Pipeline | 12 m / 0° | 56.5 | 26.6 | `fair_good` → **`poor`** |
| Pipeline | 8 m / 0° | 46.0 | 61.9 | `fair` → **`fair_good`** |
| Cocoa Beach | 8 m / 0° | 64.5 | 79.8 | `fair_good` → **`good`** |
| Trestles | 12 m / 0° | 56.5 | 26.6 | `fair_good` → **`poor`** |

Signed **both ways**, so no constant reconciles it — the same argument CLAUDE.md makes about the hub.
At Δθ = 75° both scores collapse to 26.6 because `swell_exposure` floors first, so the height
divergence is *masked in the score* there and visible only in the height channel.

**Scope / honesty caveats.** (a) The band is a per-**cell** heatmap; the rendered colour channel is
the score, not the height. (b) In the live band the cell's `swell_from` and `shore_normal` come from
the cell (`surf_rating.py:749-756`) rather than the spot's asset bearing — the per-cell composition
already recorded in memory as "the band and the glyph are two populations". My measurement isolates
**only the height half** by holding those fixed, so it is a lower bound on total band↔glyph
divergence, not the whole of it. (c) I did not measure this against live production data.

**Falsification attempted and failed to disprove:** head-on cases and Mavericks-at-every-Hs reproduce
`ratio = 1.000` exactly, which is the positive control that the harness can see "no difference" when
there is none.

---

### FINDING B2-02 — `phys_speed`, documented as "the HONEST wave height on surf=1 grids", carries the OFFSHORE Hs
**CONFIRMED (code fact). Severity: Low/Info — consequence bounded.**

`schemas.py:26-31` describes `GridVector.phys_speed` as *"the HONEST wave height on surf=1 grids, set
by `rating_transform_grid` before it overwrites `speed`"*. In `rating_transform_grid`,
`sp = getattr(vec,"speed",0)` is captured **before** the transform (`surf_rating.py:707`), the
breaking height is computed into `surf` (`:738`) — and then `vec.phys_speed = sp` (`:723-724` masked
branch, `:786-787` rated branch). The breaking height is **discarded**; `phys_speed` is the offshore
significant height.

Consumers (frontend, read-only check): `WebGLMarineTextureEncoder.js:200-206`,
`backendWeatherServiceClientHelpers.js:248`, `useMarineWindData.js:119`,
`backendCopernicusServiceClient.js:56` — all feed a texture channel used for crest animation, not a
displayed number. So the served *number* is not wrong; the *field name and its docstring* are.
Handed to Agent A to confirm no display path exists.

---

## 3. DOES THE SIM DELEGATE? — YES, both halves

**CONFIRMED.**

```python
# backend/services/weather_pipeline/sim_rating.py:30
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
# :37-41
from services.weather_pipeline import surf_rating as SR
from services.weather_pipeline.surf_rating import (
    offshoreness, oversize_gate, oversize_thresholds, rating_score, score_to_level,)
from services.weather_pipeline.surf_transform import komar_breaker_height
```

* Height: `sim_rating.py:239-242` → `estimate_surf_at(lat, lng, swell_h, swell_p,
  swell_from_deg=swell_dir, geometry=geo, partitions=partitions)`, with `geo` from
  `spot_geometry(spot)` (memoised in `_GEOMETRY_CACHE`, `:50`).
* Quality: `sim_rating.py:293-304` → `rating_score(...)` with **every optional factor passed by
  keyword** (`reference_size_m`, `partitions`, `break_depth_m`).
* No private copy exists. The only local physics is the *fallback* `komar_breaker_height` at
  `:249`, reached **only** when `geo is None` (kill switch / missing coords), and that branch
  deliberately drops `partitions` (`:258`) so the rating grades the same sea the height ran on.

Two caveats worth carrying forward, both code facts:
- `sim_rating.py:326` applies the observation gate **unconditionally** (not under `RATING_OBS_GATE`)
  — deliberate, documented `:315-322`, mirrored at `spot_conditions.py:412-423`.
- `sim_spots.DB_PATH = os.path.join(ROOT_DIR, "dev.db")` (`sim_spots.py:56`, and again at
  `weather_sim_mcp.py:79`) is still the local SQLite fallback when `SIM_LIVE_CATALOG=0`
  (`sim_forecast.py:181`). `MOCK_SPOTS = sim_spots.CATALOG_DEFAULTS` (`weather_sim_mcp.py:69`) —
  the "3-spot mock" note is stale, but the `dev.db` coordinate-drift landmine is not.

---

## 4. NORMALIZATION CONTRACT

### 4a. Is there ONE normalizer? — Yes for GRID products; the POINT lane has its own inline copy

`WeatherNormalizer.normalize` (`normalizer.py:92`) has exactly **five production call sites**:

| Call site | run_time passed? |
|---|---|
| `scheduler_helpers.py:372` (`normalize_and_save_loop` — the batch ingest path) | **YES** (`:346`) |
| `viewport_upstream.py:142` (dynamic viewport fetch) | **NO** |
| `viewport_helper.py:390` (viewport revalidation) | **NO** |
| `grid_series_helper.py:168` and `:261` (EURO series fast path) | **NO** |

### 4b. Who BYPASSES it

1. **The direct-point fallback in `point_resolution.py:577-659`** re-implements the unit/vector
   conversion inline (`rad`, `u = -speed*sin(rad)`, `v = -speed*cos(rad)` at `:577-579`) rather than
   calling the normalizer. Same for `point_direct_fallbacks.build_wind_direct_point_response` and
   `build_scalar_direct_point_response`.
2. **`POST /api/copernicus-marine`** (`routes/copernicus_marine.py:99-112`) returns
   `fetch_euro_marine(...)` output **verbatim** — provider-shaped JSON, no `NormalizedProduct`,
   no masking, no snapping.
3. **`GET /api/surf-conditions`** (`services/surf_conditions.py`) calls Open-Meteo Marine with its
   own `httpx` client (`:13`) and parses the response by hand.
4. **`services/forecast_ingester.py`** writes raw Open-Meteo JSON to disk (`:90`) — never normalized
   (and, per §1b, never read).

### 4c. Conventions and where each is converted

| Quantity | Convention | Where established / converted |
|---|---|---|
| **Grid orientation** | lats ascending south→north; lons ascending west→east | `normalizer.py:212-228` builds `unique_lats`/`unique_lons` by `sorted(set(...))`; `cols = len(unique_lons)`, `rows = len(unique_lats)` |
| **Longitude** | **request and emit in −180..180**; a **monotonic 0..360+ space is used internally only when the bbox crosses the antimeridian** | monotonic lift `normalizer.py:207-210` (`east_monotonic = east + 360`) and `:249-250` (`raw_lng_monotonic += 360`); wrapped back at emit `:485-487` (`lng - 360 if lng > 180 else lng + 360 if lng < -180`) |
| **Full-wrap duplicate column** | endpoint-exclusive: `+180` duplicates `−180`, mirrored/dropped | `normalizer.py:459-470` |
| **Direction** | **meteorological "coming-FROM" degrees**, everywhere, for wind AND waves | stored raw in `GridVector.direction`; the "going-to" cartesian is derived as `u = −speed·sin(θ)`, `v = −speed·cos(θ)` at `normalizer.py:412-414` — mirrored verbatim at `point_resolution.py:577-579` and in `point_direct_fallbacks` |
| **Wind speed** | **knots** on the wire (`GridVector.speed`) | provider requests `wind_speed_unit=kn` (`open_meteo_provider.py:357,568`); non-knot units converted at `normalizer.py:386-404`, using `SR.MS_TO_KT` **read as an attribute** for the m/s row (`:397-398`) so the ingest→`rating_score` round trip is exact. km/h (`0.539957`) and mph (`0.868976`) are **bare literals** on the same branch. Consumers convert back with `SR.KT_TO_MS` (`spot_ratings.py:131`, `spot_conditions.py:383`, `sim_rating.py:296`). |
| **Wave height** | **metres** (`GridVector.speed` for marine layers) | never converted in the pipeline; feet only at presentation (`M_TO_FT` in `spot_conditions.py:46`, `surf_conditions.meters_to_feet`) |
| **Pressure** | hPa | `ecmwf_opendata_fetcher.py` divides Pa/100 at the fetcher |

### 4d. Provider-specific assumptions that LEAK out of the fetchers

| Leak | Evidence |
|---|---|
| **`model` is a DISPATCH KEY, not a data source.** `EURO` selects `ecmwf_wam025` on the grid lane (`open_meteo_provider.py:233`) but `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` on the point lane (`point_resolution.py:600`) — two different upstreams under one label. Read `upstream_provider`/`upstream_model`, never `model`. | `open_meteo_provider.py:230-240`; `point_resolution.py:595-602`, `:636`, `:654` |
| **EURO has no swell partitions**, so the grid request is narrowed to total-sea variables for *every* layer | `open_meteo_provider.py:306-309` — the `model.upper()=="EURO"` branch precedes the per-layer branches, so `layer=swell_1` silently receives `wave_height,wave_direction,wave_period` |
| **ICON/GWAM has no secondary swell**, special-cased twice | `open_meteo_provider.py:315-317` (`swell_2` → primary swell) and `:323-329` (`all_marine`) |
| **ICON `swell_2` is served as `swell_1` on the point lane too** | `point_resolution.py:528-529` |
| **Forecast-day clamps are model-specific and applied at the provider**, not declared in the schema | `open_meteo_provider.py:258-270` (marine ICON/EURO ≤ 7 d, GFS ≤ 16 d; wind ICON ≤ 5 d, EURO ≤ 15 d) |
| **Ratio-fabricated partitions**, off by default | `normalizer.py:311-336`, `MARINE_PARTITION_RATIO_FALLBACK` default `"0"` (`:313`). Downstream consumers explicitly reject the artefact by checking `estimate_basis.method == "wave_component_ratio_estimation"` (`spot_conditions.py:151-153`) |
| **`is_test_environment()` can be forced true in a running uvicorn** by `LOCAL_TEST_FIXTURE=true`, which then serves `generate_mock_open_meteo_response` — synthetic physics — even when `NODE_ENV=production` | `open_meteo_provider.py:34-38`. Guarded by `is_test_fixture` rejection at save time (`scheduler_helpers.py:376-378`) but the *point* lane has no equivalent reject. |

---

## 5. TIME: RUN / INIT / FORECAST HOUR / VALID TIME

### 5a. Representation

| Field | Meaning as implemented | Where |
|---|---|---|
| `valid_time` | the hour the value describes | parsed from the client (`parse_valid_time`), used for product selection and echoed |
| `valid_time_start` (manifest) | the product's own hour | `manifest_view.products_for` / `find_cached_grid_product` |
| `run_time` | **the wall-clock at ingest / fetch — never the model cycle** | see 5b |
| `freshness_sec` | hardcoded `1800` on every direct-point response | `point_resolution.py:649`, `point_direct_fallbacks.py:76,148` |
| forecast hour | never carried as a number; recovered as `valid_time − run_time`, which is meaningless given 5b | — |

### ⛔ FINDING B2-03 — `run_time` is nowhere the model's initialization time
**CONFIRMED (code fact). Severity: Medium (provenance).**

Every producer stamps `datetime.now(timezone.utc)`:

* ingest: `scheduler.py:84,293,410,517`; `marine_mid_res_ingestion.py:125,170,237,337,428`;
  `wind_ingestion.py:82,149,262,409` — all `run_time = datetime.now(timezone.utc)`;
* normalizer default when the caller omits it: `normalizer.py:143-144`
  `if not run_time: run_time = datetime.now(timezone.utc)` — which is the case for **three of the
  four** grid call sites (§4a), i.e. every dynamic-viewport product;
* direct-point fallbacks: `point_resolution.py:639`, `point_direct_fallbacks.py:67,139`.

Meanwhile the native fetchers **do** resolve the true cycle and then throw it away:
`noaa_gfs_wave_fetcher._pick_cycle` returns `cycle_dt` (`:315`) and uses it to build the `times`
array (`:527,538`), but the emitted point dict carries only `__provider: "noaa"` (`:624-631`).
The file's own docstring names the symptom (`:267`: *"a `run_time` stamped at request time"*).

Consequence traced: `spot_ratings.rate_one_spot` reads `_iso_z(marine.run_time)` (`:106`) and
`_iso_z(wind.run_time)` (`:130`) and publishes them as `SpotRatingItem.run_time` /
`wind_run_time` (`routes/weather.py:353-354`) — fields whose declared purpose is *"WHICH MODEL RUN
produced this score"* (`routes/weather.py:344`). They report ingest time, not model cycle. Not
measured against production (BLOCKED: no network).

### 5b. Where two model RUNS can mix inside one response

**CONFIRMED, three independent mechanisms:**

1. **Selection ignores the run.** `_selection_key` = `(time_diff, resolution, area)`
   (`point_resolution.py:36-50`) — `run_time` is **not a term**. A stale-run product whose
   `valid_time` is closer wins over a fresher-run product. The 3 h acceptance window
   (`:348`, `:713`) makes this reachable.
2. **Each domain/layer resolves independently.** `rate_one_spot` issues one `resolve_point` for
   `marine/waves` (`:94`) and a separate one for `wind/wind` (`:124`); its own comment records that
   marine and wind *"shared a run at 0 of 4 spots measured 2026-07-31"* (`:127-129`).
   `spot_conditions.resolve_spot_conditions_impl` is worse: it resolves `waves` (`:235`), `swell_1`
   (`:252`) and `wind` (`:380`) separately, **for each of 11 target hours**, with no run consistency
   check anywhere.
3. **Region tiles ingest on independent cadences.** `spot_ratings.py:99-105` records Pipeline's
   marine run at 14:08Z while Sebastian Inlet's was 21:40Z the previous day — 17 h apart at one
   `valid_time`.

### 5c. Cache keys that omit the run

* Provider grid cache: `f"{MODEL}_{domain}_{layer}_{coords_key}_{resolution}_{forecast_days}"`
  (`open_meteo_provider.py:284`) — **no run**, 300 s TTL.
* Provider point cache: same shape (`:573` region) — **no run**.
* Dynamic viewport product: `viewport_{model}_{domain}_{layer}_{valid_time}_{bbox}`
  (`route_helpers.py:147-154`) — **no run**.
* Product filenames: valid_time-keyed, explicitly *"immutable-per-filename"* (`store.py:350`) — so a
  **new run overwrites the same filename**, and `ProductStore._product_cache` (keyed by filename,
  300 s TTL, `store.py:282-284`) can serve the superseded run for up to the TTL. Partially mitigated
  by explicit invalidation at `store_helpers.py:212-213,322-329`.
* `/api/weather/spot-ratings` live cache key: `f"{bbox}|{valid_time}|{model}|{limit}"`
  (`routes/weather.py:504`) — **no run**, 600 s TTL.
* Sim forecast cache: keyed `(lat, lng, valid_time)` (`sim_forecast.py:127`) — **no run**; the
  comment at `:104-109` names exactly this hazard and is why the 3600 s TTL exists.

---

## 6. CACHES

| # | Cache | Location | Key composition | TTL | Eviction | Bounded? | Key has model+run+hour? |
|---|---|---|---|---|---|---|---|
| 1 | `OpenMeteoProvider._GRID_CACHE` | `open_meteo_provider.py:189` | `MODEL_domain_layer_{n}_coords_{lat0}_{lon0}_{latN}_{lonN}_{res}_{days}` (`:283-284`) | 300 s (`:191`) | FIFO at 50 (`:471-473`) | yes | model ✓ · run ✗ · hour ✗ (whole series) |
| 2 | `OpenMeteoProvider._POINT_CACHE` | `:190` | same shape, lat/lng (`:573`) | 300 s | FIFO at 200 (`:647-649`) | yes | model ✓ · run ✗ · hour ✗ |
| 3 | `OpenMeteoProvider._rate_limited_until` | `:209` | global scalar | `OPEN_METEO_BREAKER_COOLDOWN_SEC` 30 s (`:223`) | n/a | yes | n/a — **shared 429 circuit breaker** |
| 4 | `ProductStore._product_cache` | `store.py:282` | product **filename** | 300 s (`:284`) | FIFO to `PRODUCT_CACHE_LIMIT`=128 **and** `PRODUCT_CACHE_VECTOR_BUDGET`=120000 vectors (`:748-755`) | yes | via filename: model+layer+hour ✓ · run ✗ (overwritten) |
| 5 | `ProductStore._l2_negative_cache` | `store.py:274` | filename | 60 s (`:276`) | **none — entries never removed** (`:707` writes; no `pop`) | ⚠ **unbounded** | n/a |
| 6 | `ProductStore._download_locks` | `store.py:272` | filename | none | **none** (`:681-684`) | ⚠ **unbounded** | n/a |
| 7 | `ProductStore._cached_manifest` | `store.py:277-278` | single slot, mtime-validated (`:471`) | mtime | replace | yes | n/a |
| 8 | `ViewportService.NEGATIVE_CACHE` | `viewport_service.py:60` | `viewport_{model}_{domain}_{layer}_{valid_time}_{bbox}` | 60 s / 120 s on 429 (`:537-538`) | **none — expired keys are read-through but never deleted** (`:170-172`) | ⚠ **unbounded** | model ✓ hour ✓ run ✗ |
| 9 | `_LIVE_RATINGS_CACHE` | `routes/weather.py:440` | `{bbox}|{valid_time}|{model}|{limit}` (`:504`) | 600 s (`:441`) | full `clear()` at 400 (`:606-607`) | yes | model ✓ hour ✓ run ✗ |
| 10 | `spot_ratings` L2 blob cache | `spot_ratings.load_spot_ratings_l2_cached` | single object `spot_ratings/latest.json` (`:33`) | 300 s | replace | yes | frames carry model+valid_time |
| 11 | `grid_size_climatology` L2 cache | `grid_size_climatology.py` | single object | 600 s | replace | yes | n/a |
| 12 | `spot_size_climatology._ref_map_memo` / `_coord_index_memo` | `:159`, `:217` | `{"cell": (blob_id, map)}` | none — invalidated by blob identity | replace | yes | n/a |
| 13 | `tide._TIDE_CACHE` | `tide.py:22` | `(round(lat), round(lng))` | 3 h (`:21`) | cap 2000 (`:23`) | yes | n/a |
| 14 | `sim_forecast._FORECAST_CACHE` | `sim_forecast.py:127` | `(lat, lng, valid_time)` | **per-entry**: 3600 s success / 60 s failure (`:135-141`) | FIFO at 256 (`:140-141`) | yes | hour ✓ · run ✗ |
| 15 | `sim_forecast._CATALOG_CACHE` | `:172` | single key `"spots"` | **none — process lifetime** (`:183-184`) | none | 1 entry | n/a |
| 16 | `sim_observed._cache` | `sim_observed.py:54` | bbox/time | 900 s (`:49`) | cap 256 (`:48`) | yes | — |
| 17 | `sim_rating._GEOMETRY_CACHE` | `sim_rating.py:50` | spot key | none | none | grows with catalogue (bounded by spot count) | n/a |
| 18 | `shore_normal_asset._nearest` | `:361` | `lru_cache(maxsize=20_000)` on (lat,lng) | none | LRU | yes | n/a |
| 19 | `copernicus_marine_service._point_cache` | `:173` | batched point key | 600 s (`:174`) | `_point_cache_cap` | yes | — |
| 20 | `buoy_calibration._STATION_COORDS_CACHE` | `:265` | station id | none | none | small, static | n/a |
| 21 | `buoy_calibration._cal_cache` / `report_calibration._report_cache` | `:664` / `:217` | single slot | TTL'd | replace | yes | n/a |
| 22 | `manifest_view._cached` | `:36` | products-list identity | identity | replace | yes | n/a |
| 23 | `uploads/forecast_cache/*.json` (disk) | `forecast_ingester.py:90` | fixed filename | none | overwrite per cycle | yes | **see §1b — unreadable by its consumer** |
| 24 | L1 disk product store | `backend/uploads/weather_products/` | filename | none | pruning via `prune_superseded_products` | — | run ✗ in the name |

**Unbounded caches (3): #5, #6, #8.** #8 is the one that grows fastest — its key space is
model × domain × layer × hour × snapped-bbox, and every upstream failure adds a permanent entry.

---

## 7. FAILURE PATHS

| Failure | Behaviour | Evidence |
|---|---|---|
| Open-Meteo 429 | shared class-level circuit breaker; first 429 opens it for `OPEN_METEO_BREAKER_COOLDOWN_SEC` (30 s), concurrent requests short-circuit with `RuntimeError` | `open_meteo_provider.py:209-227`, `:429-439`, `:627-634`. Kill: `OPEN_METEO_BREAKER_DISABLED=1` |
| Viewport upstream failure | negative-cache the key 60 s (120 s on 429), then **serve a stale product** rather than 404; optionally spawn native wind recovery | `viewport_service.py:170-190`, `:535-541` |
| `/api/weather/grid` unhandled exception | converted to a **CORS-safe no-coverage 404 grid** so the browser doesn't misreport it as CORS | `routes/weather.py:142-154` |
| Marine point: grid miss | ladder `dynamic index → manifest (≤3 h) → direct upstream point → stashed coarse sample → structured 404` | `point_resolution.py:304-679` |
| Marine point: upstream returns `null` at the hour | **refuses**, falls to coarse or 404 — never coerces 0.0 | `point_resolution.py:543-548` |
| Marine point: upstream returns `Hs=0 AND Tp=0` | treated as a **mask signature, not a sea state** → coarse or 404. Kill: `MARINE_ZERO_IS_NO_COVERAGE=0` | `point_resolution.py:568-575` |
| Physically impossible (H, T) pair | point marked estimated, `is_forecast_authoritative` dropped, warning appended — **point lane only, no grid-lane equivalent** | `wave_physics.py:52`, applied at `point_resolution.py:216` |
| EURO/CMEMS native point fails or is fully masked | falls back to `EURO` (waves) or `GFS` provider point, stamped `is_estimated` + `estimate_basis` | `point_resolution.py:500-509`, `:614-629` |
| L2 download failure | negative-cached 60 s (vs 300 s positive) | `store.py:276`, `:704-707` |
| Surf transform raises | **fails open** — the point keeps its offshore values, `surf_height_m` simply absent; the broad `except` is documented as also hiding coding errors | `point_surf_augment.py:245-252` |
| Shore-normal asset / override read fails | falls back to the coarser bearing, **now with a WARNING** (R11-07/R11-13 fix) | `surf_point.py:108-114`, `:124-128` |
| Rating fails inside the hub | swallowed — conditions still served without `rating` | `spot_conditions.py:481-483` |
| Live ratings pileup | 503 load shed beyond `SPOT_RATINGS_LIVE_MAX_CONCURRENT` (default 2) | `routes/weather.py:516-518` |
| Precomputed frame stale | ladder fresh(±2 h) → stale(±`SPOT_RATINGS_STALE_TOLERANCE_S`, 6 h, `source="precomputed_stale"`) → live | `routes/weather.py:466-500` |

### ✅ The `77f66211` negative-caching fix is STILL IN PLACE at HEAD
**CONFIRMED.** `sim_forecast.py`:

```python
NEGATIVE_CACHE_TTL_S = float(os.environ.get("SIM_FORECAST_NEG_TTL_S", str(DOWN_COOLDOWN_S)))   # :126
def _is_negative(out):  return isinstance(out, tuple) and len(out) == 2 and out[0] is None      # :130-132
def _remember(key, out):
    ttl = NEGATIVE_CACHE_TTL_S if _is_negative(out) else _FORECAST_CACHE_TTL_S                  # :137
    _FORECAST_CACHE[key] = (time.monotonic(), out, ttl)                                          # :138
def _recall(key):
    stamped_at, out, ttl = hit                                                                   # :154
    if time.monotonic() - stamped_at > ttl: del _FORECAST_CACHE[key]; return None                # :155-157
```
The TTL is stored **per entry**, so raising `SIM_FORECAST_NEG_TTL_S` mid-incident cannot retroactively
extend already-banked absences (`:148-150`). Positive TTL 3600 s, negative 60 s.
`git show 77f66211` confirms this is the same shape the commit shipped.

---

## 8. `science_registry.py` — CONSTANTS, RATCHET, AND WHAT BYPASSES IT

**What it holds (14 constants, MEASURED by executing `science_registry.all_constants()`):**

| Name | Value | Module | Status |
|---|---|---|---|
| `W_WIND` / `W_PERIOD` | 0.60 / 0.40 | `surf_rating` | `DERIVED` (no published range) |
| `SHELF_KF_FLOOR` | 0.316 | `surf_transform` | `IN_RANGE` (0.265–1.0) |
| `GAMMA` | 0.78 | `surf_transform` | `IN_RANGE` (0.73–0.83) |
| `GAMMA_MIN` | 0.63 | `surf_transform` | `IN_RANGE` (0.63–0.71) |
| `GAMMA_MAX` | 0.81 | `surf_transform` | `IN_RANGE` (0.73–0.81) |
| `GAMMA_MAX_STEEP` | 0.81 | `surf_transform` | `IN_RANGE` (0.73–0.81) |
| `WEGGEL_SLOPE_VALIDITY_HI` | 0.07 | `surf_transform` | `IN_RANGE` |
| `BATTJES_STIVE_GAMMA_MAX` | 0.90 | `surf_transform` | `UNVALIDATED` — *documented as the γ our cap actually is, and not the one we use* |
| `REFRACTION_KR` | 0.797 | `surf_transform` | `IN_RANGE` (0.75–1.30) |
| `H110_OVER_HS` | 1.27 | `surf_height_convention` | `IN_RANGE` (1.25–1.30) |
| `SWELL_SPREAD_EXPONENT_S` | 10.0 | `scripts.directional_exposure_science` | `UNVALIDATED` — **not wired into the served chain** |
| `IRIBARREN_SPILLING_PLUNGING` | 0.5 | `surf_transform` | `IN_RANGE`, flagged CONTESTED |
| `IRIBARREN_PLUNGING_SURGING` | 3.3 | `surf_transform` | `IN_RANGE` |

`out_of_range_names()` is currently **empty** (no `OUT_OF_RANGE` entries).

**MEASURED at HEAD** — live values match the registry (`GAMMA_MAX_STEEP 0.81`, `GAMMA_MAX 0.81`,
`GAMMA_MIN 0.63`, `REFRACTION_KR 0.797`, executed against `surf_transform`).

**Is the ratchet enforced?** Two ratchets, both real:
- `tests/test_science_registry.py` — registry value must equal the live module value, and must sit
  inside `published_range`.
- `tests/test_science_registry_coverage.py` — an AST scan over 6 declared `CHAIN_MODULES`
  (`:70-77`) with a shrink-only `GRANDFATHERED` set frozen at **42 unregistered vs 11 registered**.

### FINDING B2-04 — bare literal constants that bypass the registry
**CONFIRMED (measured by re-running the scan's own AST logic at HEAD).**

Re-running the scan's exact predicate (module-level `UPPER_CASE = <numeric literal>` over the six
`CHAIN_MODULES`) at HEAD gives **48 constants, 39 unregistered, 14 registered**. Named:

*`surf_transform.py` (7):* `DEEP_RATIO` 0.5 `:85` · `SHELF_CF` 0.65 `:239` · `SHELF_FRICTION_CF` 0.4
`:282` · `_CELL_KM` 27.75 `:283` · `_MIN_CAP_DEPTH_M` 0.3 `:376` · `PARTITION_MIN_QUAD_FRAC` 0.5
`:663` · `PARTITION_MAX_TP_RATIO` 1.1 `:685`

*`surf_rating.py` (22 — the most of any module, and **zero** registered physics):* `MS_TO_KT`
1.943844 `:39` · `_HMIN_RIDEABLE_M` 0.2 `:69` · `_DEFAULT_REF_SIZE_M` 1.2 `:72` · `_REF_ANCHOR_SCORE`
0.6 `:81` · `_REF_SAT_MULT` 2.5 `:82` · `WIND_GATE_START_KT` 14.0 `:200` · `WIND_GATE_ZERO_KT` 40.0
`:201` · `_WIND_GATE_MIN_ONSHORE` 0.25 `:202` · `OVERSIZE_START_MULT` 3.5 `:298` ·
`OVERSIZE_FLOOR_MULT` 6.0 `:299` · `OVERSIZE_ABS_START_M` 8.0 `:300` · `OVERSIZE_ABS_FLOOR_M` 14.0
`:301` · `OVERSIZE_FLOOR` 0.3 `:302` · `OVERSIZE_GAMMA` 0.78 `:305` · `OVERSIZE_CAPACITY_MULT` 0.8
`:306` · `OVERSIZE_MAX_BREAK_DEPTH_M` 30.0 `:307` · `OVERSIZE_MIN_START_M` 4.0 `:309` ·
`PERIOD_GATE_FULL_S` 7.0 `:366` · `PERIOD_GATE_FLOOR_S` 3.0 `:367` · `PERIOD_GATE_FLOOR` 0.25 `:368`
· `SEA_CLEAN_K` 0.5 `:405` · `SEA_CLEAN_FLOOR` 0.6 `:406`

*`spot_size_climatology.py` (9):* `SCHEMA_VERSION` `:33` · `BIN_WIDTH_M` 0.2 `:36` · `N_BINS` 25
`:37` · `_HMIN_RIDEABLE_M` 0.2 `:38` (a **duplicate** of `surf_rating`'s, kept in sync by comment) ·
`REF_PERCENTILE` **0.5** `:58` · `MIN_SAMPLES` 12 `:59` · `REF_CLAMP_MIN_M` 0.4 `:60` ·
`REF_CLAMP_MAX_M` 4.0 `:61` · `_MERGED_BATCH_IDS_KEEP` 200 `:358`

*`wave_physics.py` (1):* `DIRECTIONAL_CONFLICT_MIN` 1.5 `:115`

**⚠ The scan's blind spot is bigger than its debt list.** `CHAIN_MODULES` is six files. I ran the
same predicate over nine further modules that the *served* chain reaches and found **27 more**
module-level numeric constants the scan can never see, including:

* `rating_confirmation.py`: `GOOD_T` `:34`, `EPIC_T` `:35`, `AGREE_MODELS` `:38`,
  `CONFIRM_TIME_TOLERANCE_H` `:43`, `REPORT_FRESH_H` `:44`, `REPORT_CONFIRM_GOOD_STARS` `:45`,
  `REPORT_CONFIRM_EPIC_STARS` `:46`, `REPORT_NUDGE_K` `:47`, `REPORT_NUDGE_MAX` `:48`,
  `AGREEMENT_TIGHT_MAX` `:182`, `AGREEMENT_MODERATE_MAX` `:183` — **these are the thresholds that
  CAP the served score** at every glyph surface and at the hub.
* `shore_normal_asset.py`: `MATCH_RADIUS_KM` `:108`, `BEARING_RADIUS_KM` `:113`,
  `LAND_PRESENT_MAX_KM` `:125` — the geometry radii of the repo's own #1 Jacobian variable.
* `bathymetry.py`: `SHELF_BREAK_DEPTH_M` `:20`, `_SLOPE_SCALE` `:32`.
* `forecast_spread.py`: `_HIGH_CONFIDENCE_MAX` `:42`, `_LOW_CONFIDENCE_MIN` `:43`.
* `period_bands.py`: `BAND_MIN_H_M` `:61`, `RESIDUAL_MIN_H_M` `:65`.
* `tide.py`: `_MIN_EXTREMA_SEPARATION_H` `:62`. `grid_size_climatology.py`: `LATTICE_DEG` `:60`.

Plus the scan's own documented gap: **function-local constants are out of scope**
(`test_science_registry_coverage.py:52-54`) — e.g. `normalizer.py:388,402` km/h and mph conversion
factors, `surf_transform.py:369` exposure floor `0.10` / slope `0.90` / `:371` `0.55 + 0.45`.

---

## 9. FEATURE FLAGS IN THE WEATHER PATH

**214 distinct environment-variable NAMES** are read via a string-literal `os.environ.get("NAME"...)`
across `services/weather_pipeline/` (incl. `providers/`), `routes/weather.py` and
`services/surf_conditions.py` (counted by shell over the tree; 219 distinct `(name, default)` pairs,
i.e. a handful of names are read with two different defaults — e.g. `VIEWPORT_UPSTREAM_TIMEOUT_SEC`
at `20.0` and `40.0`). This count EXCLUDES indirect reads such as `surf_transform._v3(flag)`.
The nine flags the task names, plus every other flag whose default I could establish, follow.
"CLAIMED" is what the operator-facing registry `_RATING_FLAGS`
(`backend/routes/admin/surf_forecast.py`, **40 entries** — AST-extracted at HEAD) or a nearby
comment states. That registry is served by `GET /api/admin/surf-forecast/status`
(`surf_forecast.py:229-237`) and is, per its own comments, *"the ONLY instrument that can read
Render"*.

### 9a. The nine named flags

| Flag | CODE DEFAULT (verified) | CLAIMED | ACTUAL live effect |
|---|---|---|---|
| **`SURF_HEIGHT_H110`** | **`"1"` = ON** — `surf_height_convention.py:74` `os.environ.get("SURF_HEIGHT_H110","1")=="1"`; **MEASURED with env unset: `enabled() → True`** | ⛔ **`_RATING_FLAGS` says default `"0"`** (`routes/admin/surf_forecast.py:160`); the module docstring says `⛔ DEFAULT OFF` (`surf_height_convention.py:42`); `surf_transform.py:527` says *"Default OFF, byte-identical"* | Multiplies every `shelf`/`shoaling` regime height by `H110_OVER_HS = 1.27` (`surf_height_convention.py:83-91`). Recorded reach: **+27.0%** on 7 of 8 anchor cases. See **FINDING B2-05**. |
| **`SURF_REFRACTION_KR`** | `REFRACTION_KR = 0.797` (`surf_transform.py:84`, read `:511`) | `"0.797"` (`surf_forecast.py:219`) | ✅ agrees. Multiplies the **transformed** height before the cap (`:514-515`). Partner of H110 — `1.0` here with H110 on reinstates +25.5%. |
| **`GAMMA` / `GAMMA_MAX_STEEP`** | **not env-switchable individually.** `GAMMA=0.78`, `GAMMA_MIN=0.63`, `GAMMA_MAX=0.81`, `GAMMA_MAX_STEEP=0.81` (`surf_transform.py:46,65,66,67`); MEASURED live | `SURF_GAMMA_FIELD_CEILING` `"1"` (`surf_forecast.py:214`) | The single switch `SURF_GAMMA_FIELD_CEILING` (default `"1"`, `surf_transform.py:116`) reverts to the legacy laboratory ceilings `_GAMMA_MIN_LEGACY 0.62 / _GAMMA_MAX_LEGACY 1.05 / _GAMMA_MAX_STEEP_LEGACY 1.25` (`:68`). ✅ registry agrees. |
| **`SURF_TIDE_DEPTH`** | `"0"` = OFF (`surf_transform.py:488`, `point_surf_augment.py:187`) | `"0"` (`surf_forecast.py:96`) — but its comment at `:94-95` says *"NO SERVING CALLER SUPPLIES A WATER LEVEL YET — turning this on alone changes nothing; it gates the term, it does not feed it"* | ✅ default agrees. ⛔ **the claim is STALE — see FINDING B2-09.** The fetch AND the wire both exist at `point_surf_augment.py:186-197`, so flipping this alone now *does* move the served point-lane height. Effect today: none, because the flag gates the fetch too (`_eta = 0.0`). |
| **`RATING_LOCAL_SIZE`** | `"0"` = OFF in code, at all **6 served read sites**: `grid_resolver_surf.py:95` (band) · `point_surf_augment.py:96` (point lane) · `sim_rating.py:148` (sim) · `spot_conditions.py:337` (hub) · `spot_ratings.py:628` (precompute) · `routes/weather.py:552` (live glyphs) | `"0"` + *"Render env AND forecast-ingest.yml AND precompute.yml"* (`surf_forecast.py:184`) | ✅ registry agrees on the default, **but both ingest lanes set it to `'1'`** (`forecast-ingest.yml:85`, `precompute.yml:93`, `sim-parity-monitor.yml:129`). So the **precomputed frames — which are authoritative for the glyphs — run with the local curve**. Whether Render's live lane matches is BLOCKED. |
| **`SURF_PARTITIONS`** | `"0"` = OFF (`spot_conditions.py:138`, `point_resolution` partitions gate) | `"0"` (`surf_forecast.py:197`) | ✅ agrees, and declared at default in `forecast-ingest.yml:78` / `precompute.yml:79` / `sim-parity-monitor.yml:127`. Recorded cost: 4× marine point resolutions; level moves on ~50% of spot-hours. ⛔ JS mirror still required before any flip. |
| **`MARINE_PHYSICS_VALIDITY`** | `"1"` = ON (`wave_physics.py:52`) | not in `_RATING_FLAGS` | Marks a point `is_estimated`, drops `is_forecast_authoritative`, appends a `physics_impossible_height_period_pair` warning when steepness exceeds `1/7` (`wave_physics.py:47`). **Point lane only** (`point_resolution.py:216`) — the grid/band lane has no validity stamp. **Undeclared in the operator registry.** |
| **`SPOT_HUB_SURF_TRANSFORM`** | `"1"` (`spot_conditions.py:306`) | `"1"` (`surf_forecast.py:107`) | ✅ agrees. The registry correctly flags that `SURF_TRANSFORM=0` does **not** stop the hub. |
| **`SURF_TRANSFORM`** | `"1"` (`grid_resolver_surf.py:30`, `point_surf_augment.py:46`) | `"1"` (`surf_forecast.py:100`) | ✅ agrees. |

### ⛔ FINDING B2-05 — the operator's only view of Render reports `SURF_HEIGHT_H110` inverted
**CONFIRMED (code + measured). Severity: High (instrument).**

`GET /api/admin/surf-forecast/status` builds each row as
`{"value": os.environ.get(name, default), "default": default, "active": os.environ.get(name, default) != "0"}`
(`routes/admin/surf_forecast.py:233-237`), with `default = "0"` for `SURF_HEIGHT_H110` (`:160`).

The code default is `"1"` (`surf_height_convention.py:74`) — **MEASURED**: with `SURF_HEIGHT_H110`
unset, `surf_height_convention.enabled()` returns `True`.

⇒ If Render does **not** set the variable (BLOCKED — I cannot read Render), the panel reports
`value: "0", active: false` for a flag that is multiplying every non-breaking displayed height by
1.27. If Render *does* set it, the `default` column is still wrong and misleads anyone reasoning
about the unset case. This is the flag whose own registry entry says *"the one to read twice"*
(`surf_forecast.py:157`).

**Why no test catches it:** `tests/test_flag_lane_parity.py` checks only that a registry default is a
non-empty, bool-or-numeric string (`:146-169`) and that a **workflow** overriding a default declares
its lane (`:173-188`). **No test compares the registry default to the code default.** And
`SURF_HEIGHT_H110` is set in **no** workflow (`grep` over `.github/workflows/*.yml` returns nothing
for it), so the lane guard has nothing to fire on.

⚠ Corollary: the ingest and precompute runners also run with the code default, i.e. **H110 ON**, so
the precomputed spot-rating frames are H1/10 heights. That is self-consistent with Render only if
Render is also unset-or-`1`.

### ⛔ FINDING B2-09 — "flipping `SURF_TIDE_DEPTH` changes nothing" is stale in BOTH places that say it
**CONFIRMED (code fact). Severity: Medium.**

Two documents assert that the tide term is physics-only and unreachable:

* `surf_point.py:253-257` — *"⚠️ NO SERVING-PATH CALLER SUPPLIES IT YET: this is the physics half
  only, and the wiring (feeding `tide.tide_state_at`'s `height_m` from `rate_one_spot` /
  `spot_conditions`) is a separate, separately-priced step."*
* the operator registry, `routes/admin/surf_forecast.py:94-95` — *"NO SERVING CALLER SUPPLIES A WATER
  LEVEL YET — turning this on alone changes nothing; it gates the term, it does not feed it."*

The caller exists. It is not in `rate_one_spot`/`spot_conditions` — it is one level deeper, at the
single injection point:

```python
# backend/services/weather_pipeline/point_surf_augment.py:186-197
_eta = 0.0
if os.environ.get("SURF_TIDE_DEPTH", "0") != "0":
    from services.weather_pipeline.tide import tide_norm_at
    _ts = await tide_norm_at(lat, lng, valid_time_str)
    if _ts and _ts.get("height_m") is not None:
        _eta = float(_ts["height_m"])
surf, regime = estimate_surf_at(..., water_level_m=_eta)
```

`estimate_surf_at` forwards it (`surf_point.py:247`, `:266`) and `estimate_surf` consumes it at
`surf_transform.py:488-489`. So `SURF_TIDE_DEPTH=1` alone now **does** change served heights on the
point lane (and therefore the glyphs, the hub via its own lane, and the sim's live lane). The
registry is the operator's only view of Render, and it currently tells them this switch is a no-op.
Recorded reach for the term (not re-measured here): 1.694% of served spot-hours, median 45.6% height
change.

### 9b. Every other flag in the weather path, with its code default

*(`os.environ.get` literal defaults; a blank default means the read has none and the branch treats
absence as off/unset. `_v3(flag)` reads default `"1"` — `surf_transform.py:347-348`.)*

**Physics / height** — `SURF_V3_KOMAR` 1 · `SURF_V3_SHELF_RECAL` 1 · `SURF_V3_EXPOSURE` 1 ·
`SURF_V3_MAGNETS` 1 · `SURF_V3_SLOPE_GAMMA` 1 · `SURF_V3_NORMAL_OVERRIDES` 1 · `SURF_V3_JACK_MAX` 2.0
· `SURF_SHELF_CF_SCALE` 0.25 · `SURF_SHELF_KF_FLOOR` 1 · `SURF_BREAK_DEPTH` 1 ·
`SURF_COASTAL_FROM_SHORE_NORMAL` 1 · `SURF_COASTAL_FROM_LAND_BIT` 1 · `SURF_EXPOSURE_RECONCILED` **0**
(`surf_transform.py:370` — the dual-floor reconciliation, dark) · `SURF_WAVE_WRAPPING` **0** ·
`SHORE_NORMAL_ASSET` 1 · `SHORE_NORMAL_OVERLAY` 1 · `SHORE_NORMAL_OVERLAY_PATH` (unset) ·
`SHORE_NORMAL_BEARING_RADIUS_KM` (unset → 3.0)

**Rating** — `SURF_RATING` 1 · `RATING_WIND_GATE` 1 · `RATING_OVERSIZE` 1 · `RATING_PERIOD_GATE` 1 ·
`RATING_LIMITER` 1 · `RATING_DIRECTIONAL_CONFLICT` 1 · `RATING_OBS_GATE` **0** · `RATING_TIDE` **0** ·
`RATING_BREAKER_TYPE` **0** · `RATING_LOCAL_SIZE` **0** · `RATING_SIZE_CLIMATOLOGY` 1 ·
`RATING_GRID_SIZE_CLIMATOLOGY` (unset) · `RATING_MIN_SWELL_ENERGY_SHARE` 0.50

**Ingest source selection** — `GFS_MARINE_NOAA_DIRECT` 1 · `GFS_WIND_NOAA_DIRECT` 1 ·
`GFS_PRESSURE_NOAA_DIRECT` 1 · `ICON_MARINE_DWD_DIRECT` 1 · `ICON_WIND_DWD_DIRECT` 1 ·
`ICON_PRESSURE_DWD_DIRECT` 1 · `EURO_WIND_ECMWF_DIRECT` 1 · `EURO_PRESSURE_ECMWF_DIRECT` 1 ·
`EURO_MARINE_MID_ECMWF` 1 · `EURO_WIND_EXTEND` 1 · `MARINE_PARTITION_RATIO_FALLBACK` **0** ·
`MARINE_ZERO_IS_NO_COVERAGE` 1 · `MARINE_COARSE_GULF_FILL` 1 · `MARINE_MID_RES_RATING` 1 ·
`WIND_MID_RES_TIER` 1 · `WIND_NATIVE_VIEWPORT_FALLBACK` 1 · `WIND_GLOBAL_PARITY_10DEG` 1 ·
`MARINE_INGEST_ALL` (unset)

**Serving / capacity** — `SPOT_RATINGS_V2` 1 · `SPOT_RATINGS_CONCURRENCY` 6 ·
`SPOT_RATINGS_LIVE_MAX_CONCURRENT` 2 · `SPOT_RATINGS_STALE_TOLERANCE_S` 21600 ·
`SPOT_RATINGS_INPUTS_SAMPLE_PCT` 5 · `SPOT_RATINGS_MIN_COVERAGE` 0.05 ·
`SPOT_RATINGS_PRECOMPUTE_MODELS` GFS · `PRODUCT_CACHE_LIMIT` 128 · `PRODUCT_CACHE_VECTOR_BUDGET`
120000 · `POINT_RES_TIEBREAK` 1 · `POINT_SKIP_NATIVE_COPERNICUS` (unset) · `POINT_BATCH_DEGRADED`
(unset) · `PREFETCH_*` · `VIEWPORT_UPSTREAM_TIMEOUT_SEC` 20.0/40.0 · `SERIES_VECTOR_BUDGET` (unset) ·
`USE_WEATHER_PROXY` true · `WEATHER_PROXY_URL` (unset → the Netlify default) ·
`OPEN_METEO_BREAKER_DISABLED` (unset) · `OPEN_METEO_BREAKER_COOLDOWN_SEC` 30

**Sim** — `SIM_LIVE_FORECAST` 1 · `SIM_LIVE_CATALOG` 1 · `SIM_SPOT_CATALOG` 1 · `SIM_OBSERVED` 1 ·
`SIM_EXPLAIN` 1 · `SIM_EAGER_WARMUP` 1 · `SIM_WINDOW_DAYLIGHT` 1 · `SIM_MCP_FORCE_STANDIN` 0 ·
`SIM_FORECAST_MODEL` GFS · `SIM_FORECAST_CACHE_TTL_S` 3600 · `SIM_FORECAST_NEG_TTL_S` (unset → 60) ·
`SIM_FORECAST_COOLDOWN_S` 60 · `SIM_FORECAST_TIMEOUT_S` 8 · `RAW_SURF_BASE_URL`
`https://raw-surf-antigravity.onrender.com`

**Other** — `TIDES_GLOBAL_SOURCE` 1 (`routes/surf_data/conditions.py:245`) · `FORECAST_SKILL` 1 ·
`BUOY_WIND_RESIDUAL` 1 · `WORLDWIDE_COASTAL` 1 · `PILOT_REGION_STALE_FIRST` 1 ·
`WAVES_ANIM_DOMINANT_SWELL` **0**

### 9c. Flags read by the serving chain but ABSENT from the operator registry `_RATING_FLAGS`

⚠ **Self-correction.** My first pass listed `SURF_TIDE_DEPTH`, `SURF_COASTAL_FROM_LAND_BIT`,
`SURF_COASTAL_FROM_SHORE_NORMAL` and `SURF_EXPOSURE_RECONCILED` as undeclared. They are **declared** —
they live in `routes/admin/surf_forecast.py:55-100`, which I had not read. AST-extracting the dict at
HEAD gives **40 entries**. Absence is a claim; this is the corrected version.

Genuinely absent, and read by code the SERVING chain executes:

| Flag | Read at | Why the guard cannot see it |
|---|---|---|
| `MARINE_PHYSICS_VALIDITY` | `wave_physics.py:52`, reached from `point_resolution.py:216` | file not in `_RATING_SURFACES` (`test_flag_lane_parity.py:348-370`) **and** `MARINE_` is not in `_SCIENCE_PREFIXES` (`:376`) |
| `MARINE_ZERO_IS_NO_COVERAGE` | `point_resolution.py:569` | same, twice over |
| `MARINE_PARTITION_RATIO_FALLBACK` | `normalizer.py:313` | same |
| `MARINE_COARSE_GULF_FILL` | `coarse_gulf_fill.py:80` | same |
| `POINT_RES_TIEBREAK` | `point_resolution.py:48` — **decides which product answers a point** | prefix `POINT_` unmatched, file unlisted |
| `TIDES_GLOBAL_SOURCE` | `routes/surf_data/conditions.py:245` | prefix + file |
| `SPOT_RATINGS_STALE_TOLERANCE_S` | `spot_ratings` stale ladder | operational, arguably out of the science registry's contract |

Correctly absent / correctly exempted: `SURF_SHELF_CF_SCALE`, `SURF_V3_JACK_MAX`,
`SHORE_NORMAL_OVERLAY_PATH` (named exemptions with reasons, `test_flag_lane_parity.py:404-415`);
`SURF_WAVE_WRAPPING` (its module declares *"Nothing in production calls this module"*,
`wave_wrapping.py:4`, and it is not a rating surface).

I did **not** execute `test_flag_lane_parity.py`, so whether it is currently green is UNVERIFIED —
the finding is that the registry lacks these entries and that the guard is structurally unable to
notice.

---

## 10. FINDINGS SUMMARY

| id | title | class | severity |
|---|---|---|---|
| B2-01 | Map surf/rating band derives the breaking height with bare `estimate_surf`, outside `resolve_surf_geometry` + `estimate_surf_at` — measured 1.429× (75° off-normal) and up to 2.125× (depth cap), score/level moves up to 30 points signed both ways | CONFIRMED | High |
| B2-05 | `_RATING_FLAGS` declares `SURF_HEIGHT_H110` default `"0"`; code default is `"1"` (measured ON) — the admin status endpoint reports the ×1.27 height convention as inactive; no test compares registry default to code default | CONFIRMED | High |
| B2-03 | `run_time` is always ingest/fetch wall-clock, never the model cycle — including the normalizer's own fallback and all three direct-point builders; the real GFS cycle is computed and discarded | CONFIRMED | Medium |
| B2-06 | Product selection key `(|Δt|, resolution, area)` omits `run_time`; marine/swell/wind resolve independently per hour ⇒ two model runs can compose one payload | CONFIRMED | Medium |
| B2-04 | 39 of 48 module-level physics constants in the declared chain are unregistered; 27 more in served modules the coverage scan cannot see at all (incl. every observation-gate threshold and the shore-normal radii) | CONFIRMED | Medium |
| B2-07 | Three unbounded in-process caches: `ViewportService.NEGATIVE_CACHE`, `ProductStore._l2_negative_cache`, `ProductStore._download_locks` | CONFIRMED | Medium |
| B2-08 | `services/forecast_ingester.py` makes 2 upstream calls per scheduler cycle; its marine output has no reader and its wind output is rejected by its only consumer's `len < 100` guard (measured: 40 points) | CONFIRMED | Low |
| B2-02 | `GridVector.phys_speed`, documented as "the HONEST wave height on surf=1 grids", carries the OFFSHORE Hs, not the breaking height | CONFIRMED (code) / consequence bounded to animation | Low |
| B2-09 | Two places — `surf_point.py:253-257` and the **operator registry** `routes/admin/surf_forecast.py` (`SURF_TIDE_DEPTH` block) — still state that no serving caller supplies a water level and that flipping the flag "changes nothing". `point_surf_augment.py:186-197` is that caller: it fetches `tide_norm_at` and threads `water_level_m` into `estimate_surf_at`. Flipping `SURF_TIDE_DEPTH=1` alone WOULD now move served point-lane heights (recorded reach: 1.694% of served spot-hours, median 45.6% height change) | CONFIRMED (stale doc in the operator instrument) | Medium |
| B2-10 | `services/weather_worker.py` is dead code (zero importers) | CONFIRMED | Info |
| B2-11 | `/api/surf-conditions` serves a breaking height with **no quality score**; `/api/conditions/batch` computes the rating and then drops it at a hand-written response whitelist (`routes/surf_data/conditions.py:84-91`) | CONFIRMED | Low |
