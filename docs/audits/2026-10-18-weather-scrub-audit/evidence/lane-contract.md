# Lane: data contract — layer / model / time matrix (audit-only)

Baseline: worktree `audit-scrub-2026-10-18` = origin/dev `f3ef50fb2e1b371c4f529a5d45affbfa18f2628c` (clean, untouched).
Live metadata (the permitted GETs only): `/api/health` 0.63 s before, `/api/weather/capabilities` 0.28 s (25.8 KB, 24 rows,
identical to code), `/api/weather/products` 2.19 s (**10.8 MB, 11,416 products**, `last_manifest_update`
2026-10-19T01:37:50Z), `/api/health` 0.40 s after. Deployed build `62d94f5f` (the later dev commits are docs/tests only).
No /grid or /grid_series calls. Raw responses: `scratchpad/audit/live/`. Live "now" ≈ 2026-10-19 01:40Z; hours below are now-relative.

## 1. How each heatmap is produced (there are three engines, not one)

| Engine | Layers | Where pixels come from | Time selection | Interpolation |
|---|---|---|---|---|
| A. Backend numeric grid -> client WebGL | waves, swell_1, swell_2, wind_waves (WebGLMarineEngine/Shaders); wind (particles + speed field) | `/api/weather/grid` (per hour) and `/grid_series` (3-hourly pages, <=48 frames); vectors `{lat,lng,speed,direction,u,v,period}` | client snaps the wheel hour to the nearest manifest product within 3 h (`getSharedValidTime`, backendWeatherServiceClient.js:216-277); server snaps within ±3 h and stamps `served_valid_time`/`frame_substituted` (grid_resolver.py:40, 676) | **none in time** (nearest frame; no shader time mix). Space: bilinear in the shader over `u_dataBounds` (WebGLMarineShaders.js:26-28) |
| B. Client decode of Open-Meteo `.om` files (om:// protocol) | rain, pressure, temperature, water_temp, fog, "satellite" (and marine only if WebGL fails) | `https://openmeteo.s3.amazonaws.com/data_spatial/{model}/latest.json?time_step=valid_times_N` (openMeteoEndpoints.js, useOpenMeteoTileUrls.js:441-451). **The backend is not involved** | nearest index to `Date.now()+h` (`closestAxisIndex`, modelHorizons.js:51-61); **saturates past the axis end** | none (nearest index); 3-slot ring preloads idx±1 |
| C. Raster tile feeds | radar | RainViewer PNG (past ~2 h, via /rv proxy) + advected RainViewer (CONUS) + IEM HRRR simulated reflectivity WMS (CONUS, +4 h) + DWD WN radar-prediction WMS (EU, +2 h) | its own frame list, not wheel hours (`radarFrames`, useWeatherState.js:141-146) | opacity crossfade between frames |

## 2. Matrix (code + live manifest)

"Adv." = what the scrubber can reach (`resolveForecastWindow` = min(tier days, floor(max_forecast_hours/24)) x 24 h from the
rounded *now*). "Real" = what is actually stored now (live `/products`, global_coarse unless noted). Step = stored lattice.

| Layer | UI label | Real upstream (stored lane / live dynamic lane) | Run identity | Stored step | Adv. (premium) | Real natives -> estimated (now-rel.) | Spatial | Estimated / extension frames | Path / renderer | Legend / sampling notes |
|---|---|---|---|---|---|---|---|---|---|---|
| waves | GFS | NOAA GFS-Wave 0.25 GRIB (S3 `noaa-gfs-bdp-pds`) / Open-Meteo `ncep_gfswave025` | coarse **18Z**, mid **12Z** (C-13) | 3 h | 0-336 h | -8 -> +328 h (mid +322) | coarse 10°, mid 2°, pilots 0.25°, dynamic viewport | far_edge_hold past +328 h (C-01) | A | m stored, ft display |
| swell_1 / swell_2 / wind_waves | GFS | same as waves | same | 3 h | 0-336 | -8 -> +328 | same | far_edge_hold | A | |
| waves | ICON | DWD GWAM GRIB (opendata.dwd.de, f000-f174/3 h) / Open-Meteo `gwam` | 12Z; EST coarse model_run_time_status **conflicting** 58/58 | 3 h (caps says 1, C-02) | 0-336 | -14 -> +154 native; +157 -> +328 EST | same tiers | `icon_persistence_gfs_blend` server; client `icon_trend_extrapolation` 168-240 h and GFS/EURO blend >240 h (backendWeatherServiceClientHelpers.js:347-470) | A | |
| swell_1 / wind_waves | ICON | DWD GWAM | as above | 3 h | 0-336 | as above | | as above | A | |
| swell_2 | ICON | **none** (GWAM has no secondary swell) -> client 60 % GFS + 40 % EURO blend (intended, owner decision) | n/a | follows inputs | 0-336 (row max 0 => no cap) | no ICON products | | always an estimate (capabilities `estimated_product`) | A (client blend, backendWeatherServiceClient.js:310-430) | |
| waves | EURO | **ECMWF WAM** (`ecmwf_wam025`, upstream `ecmwf`) | 12Z | 3 h to 144, **6 h** to 240 | 0-336 | -14 -> +226 native; +133 -> +328 EST incl. 16 `native_time_interpolation` 3 h fills | coarse, mid | `native_time_interpolation`, `gfs_estimated_fallback`, `euro_persistence_gfs_blend` | A | caps scalar fields still name CMEMS for waves (C-05) |
| swell_1 / swell_2 / wind_waves | EURO | **Copernicus CMEMS `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`** (Météo-France MFWAM, IFS-forced) — a different wave model from EURO waves (C-05) | 12Z native; EST 25/38 conflicting | 3 h | 0-336 | -5 -> +214 native; +217 -> +328 EST | coarse 10° (copernicus 0.5° regional) | `gfs_estimated_fallback`, `euro_persistence_gfs_blend` | A | |
| wind | GFS | NOAA GFS 0.25 pgrb2 byte-range (u/v 10 m) / Open-Meteo `gfs_seamless`; **HRRR lane** blended at serve time in CONUS to ~48 h (wind_lane, D-017) | 18Z coarse, 12Z mid | 3 h (HRRR hourly) | 0-336 | -8 -> +328 | coarse, mid, pilots | none stored; no far-edge hold for wind | A (particles) | `WindLaneStatus` shows HRRR/GFS |
| wind | ICON | DWD ICON GRIB to run+180 / Open-Meteo `dwd_icon` | 12Z | 3 h | 0-336 | -14 -> +166 native; +169 -> +319 EST | coarse, mid | `icon_loop_extrapolation` (diurnal-cycle loop = repeated days) | A | caps native 120 (C-03) |
| wind | EURO | ECMWF IFS open data / Open-Meteo `ecmwf_ifs` | 12Z native; EST 18Z | 3 h -> 6 h | 0-336 | -14 -> +226 native; +133 -> +328 EST | coarse, mid | `native_time_interpolation`, `gfs_wind_fallback` (GFS data under the EURO label, flagged estimated) | A | |
| pressure (heatmap) | GFS/ICON/EURO | **Open-Meteo `.om` `pressure_msl`** on `ncep_gfs025` / `dwd_icon` / `ecmwf_ifs025` (OM_MODEL_MAP); ICON >168 h and EURO >228 h -> GFS | OM `latest.json` reference_time (fetched once per session, C-17) | OM axis (hourly/3 h/6 h by model) | GFS 336, ICON 336, EURO 336 (caps) | backend products exist (GFS +376, ICON +166 no EST, EURO +226 no EST) but the heatmap does not use them (C-06, C-04) | OM native grid | silent GFS cross-fall (C-09) | B | infobox reads backend point (`getBackendPressureFlag` default true) — a different source from the pixels |
| rain ("Precip") | GFS/ICON/EURO | OM `precipitation` on `ncep_gfs013` / `dwd_icon` / `ecmwf_ifs025` | OM run | OM axis | 336 for all (name `rain` ≠ row `precipitation`, alias flag OFF, C-08/C-19) | OM axis; ICON row says 168 h | OM grid | ICON >168, EURO >228 -> GFS; past-axis = last frame repeated | B | backend `precipitation` rows are point-only |
| temperature ("Air Temp") | all | OM `temperature_2m` (same routing as rain) | OM run | OM axis | 336 (no capability row) | OM axis | | same cross-falls | B | |
| water_temp | all | OM `surface_temperature` (model skin temperature) on gfs013 / ifs025; **ICON -> GFS at every hour** | OM run | OM axis | 336 (no row) | OM axis | rendered under the land mask | always GFS on ICON (C-09); science caveat C-18 | B | |
| fog | all | OM `visibility` **pinned to `ncep_gfs025` for every model** | OM run | OM axis | 336 | OM axis | | GFS under EURO/ICON at every hour (C-09) | B | caps row is GFS-only, visual-only |
| "satellite" | all | **model `cloud_cover` forecast** (gfs013 / dwd_icon / ifs025), not imagery (C-07) | OM run | OM axis | 336 | OM axis | | ICON >168 / EURO >228 -> GFS | B | caps row: "Satellite IR discontinued Jan 2026" |
| radar | (model chip ignored except feed choice) | past: RainViewer observed; future: advected RainViewer + IEM HRRR refl (CONUS, GFS **and** ICON), DWD WN (EU, EURO); elsewhere none | HRRR run discovered by WMS probe, 5 min TTL | 5-10 min observed; 15/30/60 min future | frames, not wheel hours | ~2 h observed + up to +2/+4 h forecast | tile | no observed/forecast marker in the readout (C-14) | C | caps row: `nowcast_discontinued`, max 2 h, GFS only |
| CONSENSUS | not a UI model | equal GFS/EURO/ICON mean, regional shadow products (D-009) | 06Z/12Z | 3 h | n/a | regional +5 d (florida +14 d) | regional | n/a | point / judge only | not in scrubber |

## 3. Committed display identity vs what the API carries

Identity a frame must carry to be unambiguous: layer, model (as painted), model cycle, valid time served, whether
estimated (+basis), interpolation endpoints/weight, grid extent (node extent), resolution/stride.

| Field | /grid (`NormalizedProduct`, schemas.py:62-137) | /grid_series frame (grid_series_helper.py:530-551, grid_series_viewport.py:28-53) | OM raster lane | Gap |
|---|---|---|---|---|
| layer / model | yes (requested) | yes | URL names the model actually decoded | the painted model on rasters is only known from the slot URL (modelProvenance) |
| model cycle | `run_time` = ingest wall clock (normalizer.py:143-145); `model_run_time` + status | `run_time`, `model_run_time`, status | manifest `reference_time` | live EST products: status `conflicting` (ICON marine 58/58, EURO marine 25/38); dynamic Open-Meteo viewports carry no cycle (HYPOTHESIS: Open-Meteo API returns no run) |
| valid time | `valid_time` **echoes the ask**; truth in `served_valid_time`, `frame_offset_hours`, `frame_substituted` | same three fields | `valid_times[N]` | readout for rasters ignores it (C-10) |
| estimated | `is_estimated`, `estimate_basis` | `is_estimated`, `estimate_basis` | none | not surfaced on map/scrubber (C-11) |
| interpolation | n/a — no temporal interpolation exists; server-side `native_time_interpolation` products are stored frames flagged estimated | n/a | n/a | fine, but wheel advertises 1 h detents over 3 h data (C-20) |
| extent | `coverage` and `grid.bounds` = **requested bbox**, not the node extent (normalizer.py:150-155, 203-235) | `bounds`; thinned frames keep pre-thinning bounds unless `SERIES_THIN_NODE_BOUNDS=1` (series_vector_budget.py:254-257, default OFF in code, env-flipped on Render 10-16 per memory) | n/a | C-12 |
| resolution / stride | `resolution`, `diagnostics.load_stride` | `decimated_stride` (only on frames the build strided) | n/a | |

## 4. Contract defects

### CONFIRMED

**C-01 — Advertised far hours have no stored product (now-relative wheel vs run-relative data).**
The wheel max is `days*24` from the rounded now (LayerAccessResolver.js:163-171; MapWeatherControls.js:282-283), while
ingest stores 14 days from the run (scheduler.py:307 `GFS_GLOBAL_FORECAST_DAYS=14`; marine_mid_res_ingestion.py:50).
Live: GFS marine/wind last product +328 h (mid +322), ICON marine EST +328/+322, EURO +328, ICON wind EST +319. The
last 8-17 h of a 336 h wheel are uncovered and widen with run age. Marine covers this with `far_edge_hold`
(far_edge_hold.py: the last frame repeated, relabelled estimated, up to 24 h); wind has no hold, so wide requests take the
503/no-coverage path (grid_resolver.py:615-663). far_edge_hold.py's own header states the class.

**C-02 — `cadence_hours` misstates the native step.** capabilities.py has ICON marine = 1, every wind row = 1, every pressure
row = 1. Every stored fetcher ingests `range(0, max_f+1, 3)` (noaa_gfs_wave_fetcher.py:374, dwd_gwam_fetcher.py:219,
noaa_gfs_wind_fetcher.py:172, dwd_icon_wind_fetcher.py:134, both pressure fetchers), and ECMWF is 3 h then 6 h
(ecmwf_opendata_fetcher.py:105-108). The live manifest steps are {3} and {3,6}. No frontend consumer reads it (grep), so the
error is latent, but the endpoint that is supposed to be the source of truth is wrong.

**C-03 — The ICON native horizon has three disagreeing values.** capabilities: wind native 120 / est 216, pressure 168 / 168.
DWD-direct ingest reaches run+180 (dwd_icon_wind_fetcher.py:128, dwd_icon_pressure_fetcher.py:117; store_helpers.py:16-18
defaults to 180). wind_ingestion.py:550 basis says 120, and pressure_ingestion.py:255/268 says "native <=120h, estimated >120h".
Client `ICON_WIND_CUTOVER_H=120` (modelHorizons.js:31). Live: ICON wind and pressure natives run to +166 h (= 12Z+180).

**C-04 — EURO pressure/precip and ICON pressure advertise hours that do not exist.** The EURO pressure and precipitation rows say
native 336 / max 336, but ECMWF open data ends at 240 h. Audit #9 fixed only the wind row (capabilities.py EURO wind note).
Live: EURO pressure natives end at +226 with **no** estimated products. The ICON pressure row says max 336 / est 168. Live: natives
to +166 and **no** ICON pressure estimates in global_coarse.

**C-05 — The "EURO" marine label covers two different wave models.** EURO waves = ECMWF WAM (`ecmwf_wam025`, upstream `ecmwf`,
6-hourly after 144 h). EURO swell_1/swell_2/wind_waves = CMEMS `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` (Météo-France MFWAM,
IFS-forced, 3-hourly). Both the live manifest and capabilities.py:567-590 (`native_grid_sources`) confirm this. Switching Waves to
Swell under "EURO" changes the model family, run, step and horizon (+226 vs +214 native), and the UI says nothing.
capabilities' legacy scalar `upstream_model` names CMEMS even for waves.

**C-06 — Six of the heatmap layers bypass the backend and capabilities entirely.** rain, pressure, temperature, water_temp, fog
and "satellite" are decoded client-side from Open-Meteo `.om` files (LayerRegistry.js:51-125; useOpenMeteoTileUrls.js:441-516).
capabilities.py has no row for temperature, water_temp or cloud cover. Its pressure and precipitation rows describe backend
products the heatmap never draws (the backend pressure grid feeds only the infobox: backendPressureServiceClient.js
`getBackendPressureFlag` defaults true). The infobox value and the painted colour therefore come from different sources, and
for pressure from different models' runs. This breaks the "capabilities.py is the ONLY source of horizons" contract for
these layers.

**C-07 — "Satellite" is mislabelled.** It renders model `cloud_cover` forecasts (LayerRegistry.js:68-76 `ICON_CLOUD_COVER`,
category "imagery"; MapWeatherControls.js:161 label "Satellite") with a 14-day forecast scrub. Capabilities says satellite
was discontinued in Jan 2026.

**C-08 — The raster lane has no past-the-end refusal.** `closestAxisIndex` saturates, so the last frame is painted under a later
hour (modelHorizons.js:39-61). Both protections are default OFF: `__RAW_AXIS_FLOOR__` (useOpenMeteoTileUrls.js:479-485) and
`__RAW_LAYER_CAP_ALIAS__` (LayerAccessResolver.js:131-148). Because `rain` ≠ `precipitation`, ICON rain is offered 14 d against
its 168 h row. The stale-hour disclosure renders only inside the point infobox (MapForecastOverlay.js:238-248, 739).

**C-09 — Silent cross-model substitution on rasters.** Fog = GFS on every model at every hour. Water Temp on ICON = GFS at every
hour. ICON atmospheric past 168 h -> GFS; EURO past 228 h -> GFS (useOpenMeteoTileUrls.js:487-534). This is disclosed only in
the infobox (modelProvenance.js header documents it).

**C-10 — The readout does not name the painted frame for rasters.** `forecastReadout` snaps only `MANIFEST_LAYERS`
(marine + wind; forecastReadout.js:14, 27-32). Raster layers print anchor+h while the tile lane paints the nearest index on
3-hourly or 6-hourly axes (EURO ifs025, GFS past 120 h, ICON past 78 h). The label can be off by up to 1.5 h (3 h axis) or 3 h
(6 h axis), and the screen-reader text says "Showing the forecast for X" without a snap note.

**C-11 — Estimated and extension frames are not labelled where the user scrubs.** Estimated frames: ICON marine +157..+328
(persistence + GFS blend; client trend 168-240 h), ICON wind +169..+319 (`icon_loop_extrapolation`, a diurnal loop),
EURO marine/wind past ~+214/+226 (`gfs_estimated_fallback` / `gfs_wind_fallback` = GFS values under the EURO name;
`euro_persistence_gfs_blend`), EURO 3 h `native_time_interpolation` fills, and far_edge_hold. ForecastWheel draws no
native/estimated boundary. A grep for a user-facing "Estimated" chip on the map finds none; only the point card reads
`is_estimated` (forecastCardCompiler.js:135).

**C-12 — The committed identity is incomplete on the wire.** `valid_time` echoes the ask (schemas.py:129-137). `run_time` is the
ingest wall clock (normalizer.py:143-145). Live estimated products carry `model_run_time_status: conflicting`. `grid.bounds`
and `coverage` are the REQUESTED bbox, not the node extent (normalizer.py:150-155, 203-235). The texture is stretched whenever
the extent is not a multiple of the resolution, and series-thinned frames carry pre-thinning bounds unless
`SERIES_THIN_NODE_BOUNDS=1` (default OFF in code). The client conform path drops `model_run_time` (marineStaleHour.js:52).

**C-13 — A zoom-tier change can switch model runs (live).** At the same instant, GFS global_coarse = 18Z and global_mid = 12Z for
marine and wind. For ICON marine EST, mid shows "known 12Z" while coarse shows "conflicting". A zoom step changes the run
with no disclosure.

**C-14 — Radar mixes observation and forecast with no marker.** Past frames are RainViewer observations. Future frames are
advected RainViewer or IEM HRRR simulated reflectivity (CONUS, used for GFS **and** ICON) or DWD WN (EU, EURO); outside CONUS and
EU there is no future (radarForecastSources.js:1-25, 169-200; useWeatherState.js:141-146). The readout is only a clock time
(MapWeatherControls.js:333-339) and the aria text is "frame N". Nothing tells the user that a frame is forecast, or that
"ICON" radar is NOAA HRRR. The capabilities radar row (`nowcast_discontinued`, max 2 h, GFS only) does not describe this.
Past "now" the system is honest in one way: out-of-footprint tiles are transparent, not fabricated.

**C-15 — Provenance strings are inconsistent.** GFS wind/pressure rows and products say `upstream_provider: noaa` but
`upstream_model/source_dataset: gfs_seamless`, which is Open-Meteo's GFS+HRRR blend name; the stored data is NOAA GFS 0.25 direct.
EURO wind estimates are `provider gfs_fallback / upstream noaa / gfs_seamless`.

**C-16 — The products manifest is 10.8 MB and never refreshed.** The client downloads the whole `/products` (11,416 entries,
2.19 s live) once per page load and refreshes only when it is missing (backendWeatherServiceClient.js:39-62, 266). Snap targets
and horizon ends come from a manifest that ages through every 6 h ingest.

**C-19 — The tier window is resolved by layer NAME using activeLayers[0].** `rain`, `temperature`, `water_temp`, `fog` and
`satellite` match no row, so they fall back to the model-wide max of 14 d. GFS radar (row max 2 h) gives 0 days, which clamps the
offset to 0; this is benign because radar uses frames (LayerAccessResolver.js:131-171; useWeatherState.js:169-183).

**C-20 — The wheel advertises hourly precision over 3-hourly data, and no time interpolation exists anywhere.** Marine series
pages are 3-hourly (marineGridSeries.js:154-164), the server and client snap within ±3 h, and the shaders have no time mix. Two
of every three detents repeat a frame. Marine and wind readouts snap honestly; raster readouts do not (C-10).

### HYPOTHESIS

**C-17** — Open-Meteo raster metadata is fetched once per session (`LIVE_FETCHED_MODELS` is never cleared outside tests; the
protocol interceptor serves the cached manifest, openMeteoProtocol.js:441-451). The raster run therefore never advances in a long
session, and the "now" index slides toward the end of an old run. The axis stays self-consistent.

**C-18** — "Water Temp" is the atmospheric models' skin temperature. Over ocean, GFS holds its analysed SST nearly constant
through the forecast, so a 14-day scrub implies SST forecast evolution that the source does not model. This needs a science
check against the OM fields.

**C-21** — Dynamic Open-Meteo viewport products (the live lane outside the stored tiles) carry `model_run_time_status: missing`
because the Open-Meteo forecast API exposes no cycle. Adjacent hours, or a pan, can then mix NOAA-direct stored frames with
Open-Meteo frames of an unknown run. Not probed live (no /grid allowed).

**C-22** — Wind past its estimated tail (ICON wind +320..+336, GFS/EURO +329..+336) may hit 503/no-coverage on wide views, because
far_edge_hold is marine-only. The client then retains the previous frame under the new label. Behaviour depends on
`viewport_service.is_viewport_enabled` for far hours, which was not exercised.

## 5. Notes that are NOT defects (checked)

- ICON Swell 2 = the client GFS/EURO 60/40 blend. It is intended (owner) and documented in capabilities `estimated_product`.
- ICON far-hour `gfs_trend` frames are admitted by the whitelist while `__RAW_DISABLE_ICON_FAR_HOUR_RENDER__` is unset
  (marineGridValidation.js:9-12; iconEstimateDelivery.js:2-4), so the memory note "dropped by the whitelist" does not hold at
  this baseline unless that kill switch is set.
- Marine/wind readouts name the snapped manifest instant (F-07 fix), and the series anchor mismatch (client rounds, server floors)
  is reconciled by `base_time` (grid_series_helper.py:199-236).
- Honest-unavailable exists for ICON swell_2 server-side (`make_unsupported_icon_swell2_grid_response`) and for marine
  variables a model lacks in the raster fallback (transparent tile).
