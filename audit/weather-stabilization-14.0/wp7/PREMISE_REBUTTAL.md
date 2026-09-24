# WP-7 / F-09 — active raster sources, not retired satellite IR

**Read-only source investigation; no WP-7 application change.** The audit correctly identifies missing temperature capabilities and a contradictory satellite declaration. Its remove-or-disclose-discontinued remedy is not supported for the currently wired feature. `supports_grid=false` describes lack of a backend numerical grid endpoint; it does not mean a frontend visual raster is unavailable.

The actual `satellite` toggle combines two paths:

- [LayerRegistry](../../../frontend/src/components/map/LayerRegistry.js) line 68 registers Open-Meteo **forecast `cloud_cover`**. The raster hook uses the selected atmospheric family and publishes an `om://https://map-tiles.open-meteo.com/data_spatial/<model>/latest.json?...variable=cloud_cover` URL.
- [MapWebGL](../../../frontend/src/components/map/MapWebGL.js) lines 803–819 displays **ESRI World Imagery** while `satellite` is active. `useSatelliteBackgroundSync` makes the ordinary background transparent. This basemap is not timestamped weather satellite IR.
- [MapWeatherControls](../../../frontend/src/components/map/MapWeatherControls.js) calls the toggle “Satellite” but labels its weather legend “Cloud Cover (%)”. The present capability row instead declares upstream model/dataset `discontinued` and says “Satellite IR discontinued Jan 2026.” Its provider field is **Open-Meteo**, not RainViewer. RainViewer radar is a separate registered path.

The parent investigator reports browser D-5 transitioning GFS Satellite from LOADING to LOADED, with no unavailable notice. This packet does not independently certify those pixels or current CDN availability; its independent evidence is exact source plus controlled execution below. Either way, a retired IR notice would falsely describe the active cloud forecast. Do not remove imagery or add a blanket “discontinued” notice on that premise.

## Routing evidence

The [probe](probe_raster_routing.cjs) executes the **unaltered nested `resolveModel` function** extracted from `useOpenMeteoTileUrls.js`, using the actual registry entries, maps and horizon constants. All **45 controls pass**: three layers × three model selections × offsets 0, 168, 169, 228 and 229 hours. [Receipt](routing-results.json) records exact source hashes and the checked HEAD (`eb715a150ba59499aad3c675d50130fa3cfef6ad`). This is isolated function execution, not a hook/browser or decoder integration test. No network calls were made.

| Toggle | Weather variable | Default route and substitution |
|---|---|---|
| Satellite | `cloud_cover` | GFS `ncep_gfs013`; ICON `dwd_icon` through +168h then GFS; EURO `ecmwf_ifs025` through +228h then GFS |
| Air Temp | `temperature_2m` | Same atmospheric routing |
| Water Temp | `surface_temperature` | GFS `ncep_gfs013`; **ICON uses GFS at every hour**; EURO `ecmwf_ifs025` through +228h then GFS |

These offsets are the hook's requested-hour cutovers, not guarantees of actual provider availability. Its optional `__RAW_AXIS_FLOOR__` behavior is OFF by default; when explicitly enabled, live metadata can shorten a cutover. Real raster URLs require verified `sourceMetadata`. The nearest-time selection can select the final available frame beyond an axis; this investigation does not change that policy.

Water Temp uses the model **surface/skin temperature** variable, with land hidden by the OceanMask path. Do not describe it as direct measured ocean temperature. Registry/hook comments saying ICON gets transparent tiles are stale: the actual function explicitly substitutes GFS for ICON `surface_temperature`. Missing variable handling does not justify claiming the entire layer discontinued.

Existing [modelProvenance](../../../frontend/src/components/map/modelProvenance.js) reads the **displayed slot URL**, and [MapForecastOverlay](../../../frontend/src/components/map/MapForecastOverlay.js) calls it and displays model-substitution/stale-hour information. Thus it would be inaccurate to claim every substitution is undisclosed. This packet has not verified every notice in every browser/device state.

## Small compatible correction to prepare separately

1. Retain the working imagery/cloud paths. Correct the satellite capability to name forecast cloud cover and the separate ESRI basemap, and qualify the UI label/description if approved. Keep the existing `satellite` identifier for compatibility.
2. Add per-selection visual capability entries for Air Temp and Water Temp, including their actual variable and conditional source model. These are frontend visual rasters: retain `backend_owned=false`, `supports_grid=false`, `supports_point=false`; a frontend availability declaration must not claim a numerical backend endpoint exists. Model substitution is not a scientifically validated estimate.
3. Preserve **GFS 384h / ICON 336h / EURO 336h** exposed windows. `LayerAccessResolver.resolveForecastWindow` currently falls back to a model-wide maximum for missing temperature rows. Adding rows with only 168/228h as their maximum would silently shorten the scrubber. Declare native routing cutovers separately from the offered window and fallback sources. Do not assert that every requested frame is available.
4. Test actual hook/registry/capability agreement, the ICON Water Temp exception, boundary controls, unchanged forecast windows, and displayed source disclosure. Do not remove either imagery path without the owner's explicit decision.

Graph discovery was attempted first; stale/insufficient graph spans required exact source reads. Node 24.19.0 ran the probe. Its first attempt reached all assertions but could not spawn `git` from Node (`EPERM`); passing the shell-verified HEAD as an argument removed that harness dependency. Reproduce in PowerShell from the repository root: `$rasterAuditHead = git rev-parse HEAD`, then `node audit/weather-stabilization-14.0/wp7/probe_raster_routing.cjs $rasterAuditHead`.
