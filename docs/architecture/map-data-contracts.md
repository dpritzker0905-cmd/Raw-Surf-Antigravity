# Map Data Contracts

> Canonical reference for all data ingestion formats, coordinate logic, and tile rendering pipelines.  
> Eliminates AI guesswork about data shapes.

---

## 1. Data Ingestion Pipeline

### Source: Open-Meteo (Primary)

We do **NOT** pull raw `.grb2` files from NOAA. All data flows through Open-Meteo's API layer.

| Data Type | Endpoint | Format | Usage |
|-----------|----------|--------|-------|
| Marine forecast (per-spot) | `https://marine-api.open-meteo.com/v1/marine` | JSON | Infobox, spot forecast UI |
| Atmospheric forecast | `https://api.open-meteo.com/v1/forecast` | JSON | Wind data for particle engine |
| Raster map tiles | `https://map-tiles.open-meteo.com/data_spatial/{model}/latest.json` | Binary `.om` via `om://` protocol | Colored map overlays |

### Tile Map Service (TMS) Pattern

Tiles are **NOT** served as PNG. They use the `@openmeteo/weather-map-layer` npm package which:
1. Registers an `om://` custom protocol with MapLibre GL JS
2. Fetches binary `.om` files (Open-Meteo's proprietary compressed format)
3. Decodes + renders tiles client-side using WebWorkers + custom color scales
4. Returns `ImageBitmap` to MapLibre for raster layer display

```
om://https://map-tiles.open-meteo.com/data_spatial/{model}/latest.json
  ?time_step=valid_times_{N}
  &variable={var}
  &dark=true
  &contours=true
  /{z}/{x}/{y}
```

### Model Grid Specifications

| Model | Key | Resolution | CRS | Grid Type |
|-------|-----|-----------|-----|-----------|
| GFS Wave | `ncep_gfswave025` | 0.25° | WGS 84 (EPSG:4326) | Regular lat/lon |
| DWD GWAM | `dwd_gwam` | 0.25° | WGS 84 (EPSG:4326) | Regular lat/lon |
| ECMWF WAM | `ecmwf_wam025` | 0.25° | WGS 84 (EPSG:4326) | Regular lat/lon |
| GFS Atmo | `ncep_gfs025` | 0.25° | WGS 84 (EPSG:4326) | Regular lat/lon |
| ICON | `dwd_icon` | 0.125° | WGS 84 (EPSG:4326) | Regular lat/lon |
| ECMWF IFS | `ecmwf_ifs025` | 0.25° | WGS 84 (EPSG:4326) | Regular lat/lon |

> **No re-projection needed.** All Open-Meteo tile data is pre-projected to WGS 84.  
> The `@openmeteo/weather-map-layer` package handles CRS → Web Mercator (EPSG:3857) mapping internally when rendering to MapLibre's canvas.

---

## 2. Coordinate Bounds Logic

### Spot Coordinate Mapping

```javascript
// Surf spot → forecast: direct lat/lng pass-through
const forecastUrl = `https://marine-api.open-meteo.com/v1/marine`
  + `?latitude=${spot.lat}&longitude=${spot.lng}`
  + `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction`;
```

### Grid Point Interpolation

Open-Meteo's API handles bilinear interpolation server-side. The response `latitude`/`longitude` fields return the nearest grid point (snapped to 0.25° resolution):

```
Request:  latitude=26.35, longitude=-80.08
Response: latitude=26.375, longitude=-79.875   ← snapped to grid
```

For the raster tile pipeline, interpolation is handled by the `@openmeteo/weather-map-layer` package's `GridFactory` which supports:
- Regular grids (all our models)
- Gaussian grids
- Projected grids (LCC, Stereographic, LAEA, Rotated LatLon)

### Marine Grid Data (Particle Engine)

The `useMarineOrchestrator` fetches a structured grid for the visible viewport:

```javascript
// POST body shape for marine grid fetch
{
  latitude: [latMin, latMax],
  longitude: [lngMin, lngMax],
  hourly: ["wave_height", "wave_direction", "wave_period", ...],
  forecast_hours: 1,
  cell_selection: "nearest"
}
```

Response is decoded into a flat vector grid (`cols × rows` cells) with per-cell marine metrics.

---

## 3. Directional Transformation Contract

### Meteorological → Canvas Vector Conversion

Open-Meteo delivers directions in **meteorological convention** (degrees FROM which the wave/wind originates, 0° = from North, clockwise):

```
North wind (blowing FROM north): 0°
East wind (blowing FROM east): 90°
South swell (arriving FROM south): 180°
```

### Conversion for map rendering (arrow points TOWARD direction of travel):

```javascript
// Meteorological → Canvas rotation (point toward travel direction)
const canvasAngle = (meteoDirection + 180) % 360;

// For MapLibre icon rotation (bearing, CW from north):
const iconRotation = meteoDirection; // MapLibre icons point in bearing direction

// For canvas arrow drawing (radians, CCW from east):
const canvasRadians = ((90 - canvasAngle) * Math.PI) / 180;
```

### Wind Vector Decomposition (u/v components)

The weather engine receives `wind_u_component_10m` (eastward) and `wind_v_component_10m` (northward):

```javascript
const speed = Math.sqrt(u * u + v * v);
const direction = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360; // meteorological
```

---

## 4. Color Scale Contract

All color scales use **RGBA with 0–1 alpha** (NOT 0–255). This matches the `@openmeteo/weather-map-layer` `BreakpointColorScale` type:

```typescript
interface BreakpointColorScale {
  type: 'breakpoint';
  unit: string;
  breakpoints: number[];     // ascending value thresholds
  colors: RGBA[];            // [R, G, B, A] where R,G,B ∈ [0,255], A ∈ [0,1]
}
```

Custom scales are registered in `mapUtils.js` → `CUSTOM_COLOR_SCALES` and merged with the library's `COLOR_SCALES_WITH_ALIASES` at protocol init time.
