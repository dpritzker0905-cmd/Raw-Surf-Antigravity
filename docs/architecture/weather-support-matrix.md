# Weather & Marine Layers Support Matrix

This document provides a consolidated support matrix for all weather, marine, and observation layers in the **Raw Surf Weather Engine**. It maps out current data source routing, backend-owned capabilities, visualization types, and future migration steps.

---

## Consolidated Support Matrix

| Layer | Current Source | Backend Owned | Provider | Model Support | Type | Forecast Window / Cadence | Grid | Point | Visualization Type | Fallback Behavior | Migration Status | Recommended Next Step |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GFS Waves** | Staging API | Yes | Open-Meteo | GFS | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **GFS Swell 1** | Staging API | Yes | Open-Meteo | GFS | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **GFS Swell 2** | Staging API | Yes | Open-Meteo | GFS | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **GFS Wind Waves** | Staging API | Yes | Open-Meteo | GFS | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **ICON Waves** | Staging API | Yes | Open-Meteo | ICON | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **ICON Swell 1** | Staging API | Yes | Open-Meteo | ICON | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **ICON Swell 2** | Staging API | No | None | None | Unsupported | N/A | No | No | None | Returns Unsupported | Completed | Maintain "No Data" response safely |
| **ICON Wind Waves** | Staging API | Yes | Open-Meteo | ICON | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **EURO Waves** | Staging API | Yes | Copernicus | EURO | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **EURO Swell 1** | Staging API | Yes | Copernicus | EURO | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **EURO Swell 2** | Staging API | Yes | Copernicus | EURO | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **EURO Wind Waves** | Staging API | Yes | Copernicus | EURO | Forecast | 48h / 3h | Yes | Yes | Heatmap/Vector | Legacy Proxy | Completed | Sunset legacy rollback paths in Phase 6B |
| **GFS Wind** | Staging API | Yes | Open-Meteo | GFS | Forecast | 48h / 3h | Yes | Yes | Flow Particles | Legacy Scraper | Completed | Sunset legacy rollback paths in Phase 6B |
| **ICON Wind** | Staging API | Yes | Open-Meteo | ICON | Forecast | 48h / 3h | Yes | Yes | Flow Particles | Legacy Scraper | Completed | Sunset legacy rollback paths in Phase 6B |
| **EURO Wind** | Staging API | Yes | Open-Meteo | EURO | Forecast | 48h / 3h | Yes | Yes | Flow Particles | Legacy Scraper | Completed | Sunset legacy rollback paths in Phase 6B |
| **Sea Pressure** | Staging API / Netlify | Yes (Pilot) | Open-Meteo | GFS/ICON/EURO| Forecast | 48h / 3h (Backend) / 1h (Visual) | Yes | Yes | Heatmap Contour | Legacy Proxy | Pilot/Hybrid | Default-on rollout in Stage 6G |
| **Precipitation**| Netlify Proxy | No | Open-Meteo | GFS/ICON/EURO| Forecast | 7-10d / 1h | Yes | Yes | Heatmap (Rain) | Legacy Proxy | Legacy | Migrate to Backend Grid/Point in Phase 6D |
| **Weather Radar** | Direct CDN | No | RainViewer | Mosaic Tiles | Observation| Real-time / 10m| Yes | No | Overlay Tile Map| Direct Scraper | Legacy | Backend timeline sync and token proxying |
| **Satellite** | Direct CDN | No | NOAA/NASA | Satellite Tiles| Observation| Real-time / 30m| Yes | No | Overlay Tile Map| Direct Scraper | Legacy | Backend timeline sync and token proxying |
| **Air Temp** | Netlify Proxy | No | Open-Meteo | GFS/ICON/EURO| Forecast | 7-10d / 1h | No | Yes | Text inspector | Direct Scraper | Legacy | Migrate to Backend Point in Phase 6E |
| **Water Temp** | Netlify Proxy | No | NOAA/CMEMS | Global SST | Observation| Daily | No | Yes | Text inspector | Direct Scraper | Legacy | Migrate to Backend Point in Phase 6E |

---

## Visualizations Wording Lock-In
- **Wind Flow Layer**: Visually displayed on the frontend map utilizing GPU Flow Particles and a text inspector infobox. There is **no backend-owned wind raster heatmap** in the weather system.
- **Wave Height Heatmaps**: Visually rendered on the client using WebGL textures mapped from conformed backend grids.
- **Sea Pressure Layer**: Hybrid visual/numeric pipeline. The visual contours and heatmap are rendered on the map using existing hourly `om://` raster tiles. The backend weather data service provides conformed scalar point/infobox values under the feature flag `rawsurf_backend_pressure_enabled` / `__USE_BACKEND_PRESSURE_SERVICE__` (default state: off pending Stage 6G). Parity between the visual tiles and backend values is snapping/tolerance parity (within 3 hours) rather than exact timestamp matching. Backend pressure point truth is represented as a scalar `value` in hPa, rather than vector components (speed/direction).
