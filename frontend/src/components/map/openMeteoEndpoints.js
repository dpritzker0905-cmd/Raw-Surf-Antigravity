// openMeteoEndpoints.js — the ONE place the Open-Meteo spatial (raster) host is named.
//
// F-13 (audit 14.0). Every forecast raster — precipitation, pressure, air temperature, water
// temperature, fog, satellite cloud — was blank because the configured host
// `map-tiles.open-meteo.com` is GONE. Measured 2026-09-20: DNS resolution fails and curl returns
// http=000, so every metadata and tile request failed before it reached the network. The provider
// now documents `https://openmeteo.s3.amazonaws.com/data_spatial`
// (https://github.com/open-meteo/weather-map-layer), which serves `completed: true` manifests —
// `ncep_gfs025` read 209 valid_times / 316 variables, last modified five minutes before the probe.
//
// ⭐ WHAT THIS IS *NOT*. The layer→model→variable routing was NOT at fault and was not changed.
// Verified against the live endpoint, every route already matches the real inventory:
//   precipitation / temperature_2m / cloud_cover -> PRECIP_MODEL_MAP (gfs013 | dwd_icon | ifs025) — all present
//   pressure_msl                                 -> OM_MODEL_MAP     (gfs025)                     — present
//   surface_temperature (water temp)             -> gfs013 | ifs025, with the documented
//                                                   dwd_icon cross-fall, because dwd_icon genuinely
//                                                   lacks it — the probe reproduces exactly that
//   visibility (fog)                             -> pinned omModel ncep_gfs025                    — present
// An earlier draft of F-13 claimed the routing was wrong. It was read off `OM_MODEL_MAP` without
// checking the per-domain maps, and it was wrong. The host was the whole defect.
//
// ⚠️ The host is referenced by the `om://` protocol guards as a STRING TEST, not just as a URL
// prefix, so a future move must change it here and nowhere else.

export const OPEN_METEO_SPATIAL_HOST = 'openmeteo.s3.amazonaws.com';
export const OPEN_METEO_SPATIAL_BASE_URL = `https://${OPEN_METEO_SPATIAL_HOST}/data_spatial`;

/** True when `url` is an Open-Meteo spatial URL, host-agnostic at the call sites. */
export function isOpenMeteoSpatialUrl(url) {
  return typeof url === 'string' && url.includes(OPEN_METEO_SPATIAL_HOST);
}
