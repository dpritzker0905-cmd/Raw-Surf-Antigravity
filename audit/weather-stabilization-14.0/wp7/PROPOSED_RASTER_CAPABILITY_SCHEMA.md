# Proposed next packet — not implemented or an API response

Keep stable layer IDs and preserve every existing imagery/raster renderer. Replace the obsolete GFS/satellite declaration and add ICON/EURO satellite plus three-model temperature and water_temp declarations: **9 affected rows, net +8, 32 total capability rows**. Do this only as a separately reviewed WP-7 patch after the corrected premise is accepted.

Each proposed row carries the usual contract fields plus the additive visual routing fields below. `provider` and `upstream_provider` are `open-meteo`; `upstream_model` names the initial **actual tile model**, including GFS for ICON Water Temp. `source_dataset` is `<tile-model>/<variable>`, explicitly a visual raster dataset identifier, not a backend normalized product. All nine have `domain=weather`, `backend_owned=false`, `frontend_visual_tile_only=true`, `supports_grid=false`, `supports_point=false`, `supports_viewport_dynamic=false`, `supports_global=true`, `unsupported_reason=null`, and the existing contract's `fallback_sources=[]`. Do not repurpose that legacy fallback array: its validator reserves nonempty entries for EURO marine.

| Model selection | layer | upstream_model at hour 0 | raster_variable | max_forecast_hours | selected-family routing window |
|---|---|---|---|---:|---:|
| GFS | satellite | ncep_gfs013 | cloud_cover | 384 | 384 |
| ICON | satellite | dwd_icon | cloud_cover | 336 | 168 |
| EURO | satellite | ecmwf_ifs025 | cloud_cover | 336 | 228 |
| GFS | temperature | ncep_gfs013 | temperature_2m | 384 | 384 |
| ICON | temperature | dwd_icon | temperature_2m | 336 | 168 |
| EURO | temperature | ecmwf_ifs025 | temperature_2m | 336 | 228 |
| GFS | water_temp | ncep_gfs013 | surface_temperature | 384 | 384 |
| ICON | water_temp | ncep_gfs013 | surface_temperature | 336 | 0 (no ICON tile variable) |
| EURO | water_temp | ecmwf_ifs025 | surface_temperature | 336 | 228 |

The routing windows are **static selection policies**, not measured available forecast horizons. The offered maxima must remain 384/336/336 even when a provider axis is shorter. A concrete additive routing object for ICON Water Temp is:

```json
{
  "raster_variable": "surface_temperature",
  "frontend_visual_routing": {
    "default_source": {"provider": "open-meteo", "model": "ncep_gfs013"},
    "selected_model_native_cutover_hours": 0,
    "substitutions": [
      {"model": "ncep_gfs013", "condition": "all_hours", "reason": "selected_model_lacks_variable"}
    ],
    "availability": "verified_provider_metadata_and_variable",
    "effective_source": "displayed_slot_url",
    "time_axis": "provider_metadata",
    "time_selection": "nearest_available_with_existing_stale_hour_disclosure"
  },
  "physical_quantity": "model_surface_skin_temperature_over_ocean"
}
```

For ICON cloud/air, the default model is `dwd_icon` with a GFS substitution condition `requested_offset_hours_gt_168`; EURO uses `ecmwf_ifs025` and `requested_offset_hours_gt_228`. GFS has no model substitution. State separately that the existing opt-in live-axis floor can move those cutovers earlier. These declarations describe existing routing; they must not introduce a second resolver.

Satellite rows also carry `physical_quantity=forecast_cloud_cover_percent` and `visual_basemap={provider: esri, dataset: World_Imagery, weather_observation: false}`. Water Temp must describe skin temperature, not promise measured SST. Air Temp is `model_air_temperature_2m`.

Legacy numeric horizon/cadence fields need explicit final semantics before implementing this schema. Recommended horizon interpretation: `native_horizon_hours` equals the selected-family routing window above; `estimated_horizon_hours=0` because the tail is a raw alternative model, not an estimator. Therefore native+estimated need not equal the offered maximum for these visual rows. Pin that interpretation in tests and explanatory `source_docs_note`; if a consumer assumes that sum, adapt the additive design before release rather than misclassifying GFS substitution as an estimate. Confirm cadence against provider metadata and retain an explicit metadata-driven cadence policy; do not invent a fixed cadence or encode unknown availability as “discontinued.”

Required controls: all three selected models/layers have exactly one row; no live renderer or layer ID removed; capability source declarations match real hook routing (including 168/169 and 228/229 boundaries); ICON Water Temp is GFS at hour zero; model-access/tier forecast windows remain unchanged after adding rows; visual-only backend flags remain false; active-slot substitution disclosure is preserved; and a missing metadata/variable case never claims a decoded frame. The current 45-control probe establishes only the routing baseline, not these future integration tests.
