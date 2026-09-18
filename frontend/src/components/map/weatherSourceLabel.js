// Dataset names identify models, not the service that supplied their bytes.
// `provider` / __gridProvider remain legacy dispatch keys, never source evidence.
export function weatherSourceLabel(grid) {
  const upstream = grid?.__upstreamProvider || grid?.upstream_provider;
  const names = {
    noaa: 'NOAA direct',
    ecmwf: 'ECMWF direct',
    dwd: 'DWD direct',
    copernicus: 'Copernicus',
    'open-meteo': 'Open-Meteo',
    gfs_estimated_fallback: 'GFS estimated fallback',
    gfs_fallback: 'GFS fallback',
    estimated: 'Estimated',
    'test-fixture': 'Test fixture',
  };
  return names[String(upstream || '').toLowerCase()] || 'Source unverified';
}
