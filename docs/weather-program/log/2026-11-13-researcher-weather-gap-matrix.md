# 2026-11-13 · researcher · Weather layer gap matrix (12 layers x GFS / EURO / ICON), from origin/dev

**Director brief (23:35 EST, David):** "improve the fog, air temp, and water temp along with the others, so that all lanes are
upgrades and instant... Make sure we're not missing any weather lanes." Build a gap matrix first; the build lanes split from it.

**Basis.** Code on `origin/dev` at `376977357`, read with `git show` and `git grep`. Not run. No live backend call. Docs only.
**Verified** = read in code on dev. **Inferred** = from a file header or a capability row, not run. **Unknown** = not found.

## 0. Layer ids

The 12 layers in `MapWeatherControls.js:125-135` are: radar, satellite, wind, waves, swell_1, swell_2, wind_waves, fog,
pressure, temperature (Air Temp), water_temp. The 12th is **rain**, which is registered in `LayerRegistry.js:52` but is
not in the controls list. So the list in the brief has 11 ids in the controls and rain comes from the registry. The
backend calls rain `precipitation` (`capabilities.py`). `LayerAccessResolver.js:131` maps `rain` to `precipitation` only
behind `__RAW_LAYER_CAP_ALIAS__` (owner-gated, default off).

## 1. Matrix

Legend: **OWN-ON** = own static frame set, default on. **OWN-DARK** = own set, behind a lever. **.om** = Open-Meteo tile
path (`useOpenMeteoTileUrls`, MapLibre raster). **/grid** = backend `/api/weather/grid` per step. **CAP** = row present
in `backend/services/weather_pipeline/capabilities.py`.

| Layer | Model | Backend source (dev) | Own frames published | CAP row | Render path | Time interpolation |
|---|---|---|---|---|---|---|
| **rain** | GFS | `GFS/weather/precipitation/global_0p25` (`frame_set_raster.py:150`) | OWN-DARK (lever `__RAW_RASTER_OWN_FRAMES__='rain'`; `ownRasterFrames.js:55-63`) | yes, `precipitation` | own: `ownRasterLayer.js` (MapLibre shared GL); else .om | Unknown: rebinds resident texture per step (header) |
| | EURO | `EURO/weather/precipitation/global_0p25` (`frame_set_raster.py:163`, ECMWF stream) | Target defined in `frame_set_raster.py:163`; publish step not verified; client set is in **PR #855** (DARK) | yes (inferred) | .om until #855 | Unknown |
| | ICON | Registry says `ICON_PRECIPITATION` (`LayerRegistry.js:52-57`); no own set | none | not checked | .om | n/a |
| **radar** | (all) | RainViewer reflectivity (`LayerRegistry.js:61`), client tile | none (observational, not a model) | `radar`: frontend visual-only (`capabilities.py:532-549`) | MapLibre raster (RainViewer) | Unknown |
| **satellite** (cloud cover) | GFS | `GFS/weather/cloud_cover/global_0p25` (`ownRasterFrames.js:49`) | **OWN-ON** (D-052, `DEFAULT_ON_LAYERS`) | `satellite`: "discontinued frontend visual-only" (`capabilities.py:555-572`) | own (MapLibre) | Unknown |
| | EURO | none in `OWN_RASTER_SETS` | none | none | .om (`LayerRegistry.js:69`, `ICON_CLOUD_COVER` source) | n/a |
| | ICON | none | none | none | .om (source name says ICON) | n/a |
| **wind** | GFS | `GFS/wind/global_mid` (`frame_set_wind.py:44`); CAP `open-meteo gfs_seamless` (`capabilities.py:~318`) | static frames published (`frame_set_wind.py`, PILOTS lane) | yes | WebGL wind engine (`WebGLWindLayer.js`, `WebGLWindEngine.js`); frames from CDN | Inferred: frames per hour (`frame_set_wind.py:4-8`); crossfade not verified |
| | EURO | not in `frame_set_wind` (GFS only) | none | not verified | /grid | Unknown |
| | ICON | not in `frame_set_wind` | none | not verified | /grid | Unknown |
| **waves** | GFS | GFS Wave 0.25 (`capabilities.py:8-25`); regional bundles `frame_set_bundle.py:51` | CDN marine sets (regional bundles) | yes | WebGL marine engine (`WebGLMarineEngine.js`); data via `marineGridSeries.js` `/grid_series` pages | Unknown; header says 48-frame pages |
| | EURO | `ecmwf` via Copernicus MFWAM 1/12 (`capabilities.py:225-242`) | not verified | yes | same engine | Unknown |
| | ICON | DWD ICON gwam (`capabilities.py:101-118`) | not verified | yes | same engine | Unknown |
| **swell_1** | GFS / EURO / ICON | as waves, layer `swell_1` (`capabilities.py:31, 124, 225`) | not verified | yes | same engine | Unknown |
| **swell_2** | GFS | `capabilities.py:54` | not verified | yes | same engine | Unknown |
| | EURO | Copernicus MFWAM (`capabilities.py:256`); no real swell partition, per the note | not verified | yes | same engine | Unknown |
| | ICON | not a native partition; "B" published blend set is in Move 3 work (director's record, 19:54 EST) | not verified | yes, row at `capabilities.py:147` | same engine | n/a |
| **wind_waves** | GFS / EURO / ICON | `capabilities.py:77, 170, 287` | not verified | yes | same engine | Unknown |
| **fog** | GFS only | Open-Meteo `visibility` on `ncep_gfs025` (`LayerRegistry.js:116-128`) | none | **no capability row for fog** (`capabilities.py:578` is "frontend visual-only", 6 h update) | .om raster (`MapWebGL.js:886` sets fog opacity) | n/a |
| | EURO / ICON | none | none | none | none | none |
| **pressure** | GFS / EURO / ICON | `OWN_RASTER_SETS.pressure` (`ownRasterFrames.js:36-39`); `frame_set_raster.py:123, 136` | **OWN-ON** (per model, since 2026-11-12) | yes (`capabilities.py:391-508`) | own (`ownRasterLayer.js`) | Unknown |
| **temperature** (Air Temp) | GFS | `GFS/weather/temperature/global_0p5` (`ownRasterFrames.js:43-46`) | **OWN-DARK** (lever) | **no row** (LayerAccessResolver.js:138: "no capability row at all") | own when lever on; else .om | Unknown |
| | EURO | none (`fallback: null`, `ownRasterFrames.js:40-42`) | none; .om `temperature_2m` on ECMWF route | none | .om | n/a |
| | ICON | none; .om `temperature_2m` on DWD route | none | none | .om | n/a |
| **water_temp** | GFS | .om `surface_temperature`, `ncep_gfs013` + `ecmwf_ifs025` (`LayerRegistry.js:106-112`) | none | **no row** (`LayerAccessResolver.js:138`) | .om; masked below the land fill (`MapWebGL.js:170`) | n/a |
| | EURO | .om `ecmwf_ifs025` | none | none | .om | n/a |
| | ICON | **not served** (`LayerRegistry.js:99-104`: transparent tiles by design) | none | none | none | none |

## 2. Caveats the matrix depends on

- **Open-Meteo's `surface_temperature` is a model skin temperature** over ocean. The registry says so (`LayerRegistry.js:99-104`).
  It is not a measured SST. Compare with the buoy truth before calling it "water temp".
- **The CAP "alias" for rain** is default off, because turning it on reduces reach from 14 to 7 days (owner-gated,
  `LayerAccessResolver.js:121-137`). A product decision, not a bug.
- **Fog is "frontend visual-only"** in capabilities (`capabilities.py:594`). No backend product, no frames, no CAP row.
- **Frame counts** for own sets are from headers: pressure f000-f336 every 3 h (`ownRasterFrames.js:11`); precip hourly to
  f120 (`ownRasterFrames.js:57`); wind 3-hourly, hourly with a flag (`frame_set_wind.py:4-8`).
- **Time interpolation** is the biggest unknown. The headers describe a rebind per scrub step, not a blend between frames.
  The brief asks "crossfade or interpolate", and the answer for every raster layer is not verified in this pass.

## 3. Palette and legend (Windy / Ventusky)

**Not verified this pass.** These are known conventions, and the comparison needs a live check of each app:
- Windy and Ventusky use per-layer colour ramps with a legend and the unit on the scale. Wind is a speed ramp. Temperature
  is a diverging ramp centred on 0 °C. Precipitation is a log-like ramp with a clear zero.
- The repo has palette code: `WindColorRamp.js`, `CUSTOM_COLOR_SCALES` in `ownRasterLayer.js`, tile-library scales in
  `LayerRegistry.js:88`. A proper quality check needs side-by-side screenshots, which this pass did not do.

## 4. Open PRs touching these layers (checked by title, 23:45 EST)

| PR | Title (short) | Layers | Status note |
|---|---|---|---|
| #855 | rain can use the EURO precipitation set (client, DARK) | rain | Touches frontend map, held by Codex window |
| #882 | wind world copies from frame bounds (ON, kill switch) | wind | Touches frontend map |
| #759 | model/layer switch at a regional view asks viewport (ON) | all | Touches frontend map |
| #420 | wave-height wash reads R16F float height | waves | Touches frontend map |
| #711 / #728 | RATING_WIND_HRRR (dark) and HRRR rework (fails gate) | wind (rating, not map) | Backend |
| #884 | offline wind-forcing test (VOID by its control) | wind (rating) | Doc |

No open PR for water_temp, fog or temperature (as own frames) was found by title. A closer search of PR bodies is still to do.

## 5. Gap ranking for "instant + upgraded" (by user impact)

1. **water_temp, ICON missing** and **no own frames at all** for any model. ICON shows transparent tiles. Every model is on the
   .om path, so scrubbing is network-bound. High.
2. **temperature (Air Temp), own set GFS only and DARK.** EURO and ICON stay on .om. No CAP row. High, because the
   frame set exists and only the lever keeps it off.
3. **rain, own set GFS only and DARK.** EURO set is in #855 (dark). ICON has no set. High; the most-used lane after waves.
4. **fog, GFS only, no frames, no CAP row, 6 h update.** High for "instant" (visibility is a fog signal users read at a point).
5. **wind, EURO and ICON have no static frames** (the frame set is GFS only). Medium-high: wind is the lane with the most
   scrubbing.
6. **satellite (cloud cover), GFS only.** EURO and ICON on .om. Medium.
7. **radar.** Client tiles from RainViewer; not a model, so "upgraded" means smoothness of the tile fade, not a new source.
   Medium-low.
8. **pressure.** Own per-model sets are ON for all three models (since 2026-11-12). Already done; low gap.
9. **waves, swell_1, swell_2, wind_waves.** Most mature (CDN marine sets and the WebGL engine), and the swell_2 ICON gap is
   Move 3's job. Low to medium.

## 6. Open questions for the build lanes

- Is there a CAP row for `temperature` and `water_temp`? No (`LayerAccessResolver.js:138`). Adding one is a product decision (reach).
- Does the .om path crossfade between hours? Not verified. If not, every .om layer fails "instant" by construction.
- For EURO and ICON temperature and wind, is an own set planned? Not in code on dev.
- Does the rain registry's `ICON_PRECIPITATION` mean ICON precipitation is served? Verify before the build lane relies on it.

## 7. Limits

- Not run. No live call, no screenshot, no timing.
- EURO and ICON marine publish steps were not enumerated.
- Palette comparison is from convention, not measured.
- Open PRs were checked by title only.
