# Open-Meteo Marine API Reference

> Verified live: 2026-05-24T14:42:00Z

## Base URL

```
https://marine-api.open-meteo.com/v1/marine
```

## Core Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `latitude` | float | Spot latitude (e.g. `26.35` for Deerfield Beach) |
| `longitude` | float | Spot longitude (e.g. `-80.08`) |
| `hourly` | string[] | Comma-separated marine variables |
| `forecast_days` | int | 1–16 days of forecast data |
| `past_days` | int | 0–92 days of historical data |
| `timezone` | string | `auto`, `America/New_York`, etc. |
| `length_unit` | string | `metric` (default) or `imperial` |

## Available Hourly Variables

### Combined Wave
- `wave_height` — Significant wave height (m)
- `wave_period` — Wave period (s)
- `wave_direction` — Wave direction (°)
- `wave_peak_period` — Peak wave period (s)

### Swell (Primary)
- `swell_wave_height` — Primary swell height (m)
- `swell_wave_period` — Primary swell period (s)
- `swell_wave_direction` — Primary swell direction (°)
- `swell_wave_peak_period` — Primary swell peak period (s)

### Secondary Swell
- `secondary_swell_wave_height` — Secondary swell height (m)
- `secondary_swell_wave_period` — Secondary swell period (s)
- `secondary_swell_wave_direction` — Secondary swell direction (°)

### Wind Waves
- `wind_wave_height` — Wind wave height (m)
- `wind_wave_period` — Wind wave period (s)
- `wind_wave_direction` — Wind wave direction (°)
- `wind_wave_peak_period` — Wind wave peak period (s)

### Ocean Conditions
- `ocean_current_velocity` — Current speed (m/s)
- `ocean_current_direction` — Current direction (°)
- `sea_surface_temperature` — SST (°C / °F)

## Tile Server (Raster Map Overlays)

```
https://map-tiles.open-meteo.com/data_spatial/{model}/latest.json
```

### Marine Tile Models

| Model Key | Source | Coverage | Variables |
|-----------|--------|----------|-----------|
| `ncep_gfswave025` | GFS Wave | Global 0.25° | Full: wave, swell, wind_wave, secondary/tertiary swell |
| `dwd_gwam` | DWD GWAM | Global 0.25° | wave, swell, wind_wave (no secondary) |
| `ecmwf_wam025` | ECMWF WAM | Global 0.25° | Limited: wave_height, wave_period, wave_peak_period, wave_direction only |

### Tile URL Format (om:// protocol)
```
om://https://map-tiles.open-meteo.com/data_spatial/{model}/latest.json?time_step=valid_times_{N}&variable={var}&dark=true&contours=true
```

## Live Validation (2026-05-24)

**Request**: Deerfield Beach, FL — 1 day forecast
```
GET /v1/marine?latitude=26.35&longitude=-80.08&hourly=wave_height,wave_period,wave_direction&forecast_days=1
```

**Response** (sampled):
```json
{
  "latitude": 26.375,
  "longitude": -79.875,
  "hourly_units": {
    "wave_height": "m",
    "wave_period": "s",
    "wave_direction": "°"
  },
  "hourly": {
    "wave_height": [0.92, 0.96, 1.00, 1.04, ...],
    "wave_period": [4.35, 4.35, 4.35, 4.45, ...],
    "wave_direction": [115, 114, 113, 112, ...]
  }
}
```

✅ All three core variables confirmed live and returning valid data.
