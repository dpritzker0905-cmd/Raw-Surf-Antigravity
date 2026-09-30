/**
 * spotConditionsFormat.js: the spot hub's source line and wave direction (W-34, 2026-09-30).
 *
 * Measured 2026-09-29 at Spanish House: the hub printed "Data from Open-Meteo Marine API" on every
 * spot while `/conditions/{id}` sampled the stored NOAA product, and printed the direction as
 * `${wave_direction}-` ("65.61-": a lost degree sign, two decimals, no compass point). The backend
 * now reports `current.data_source` (a stored product, or the point query on a cache miss).
 */
import { originOf } from './map/dataOrigin';
import { degToCompass } from './map/forecastHelpers';

/** "Data from NOAA GFS forecast" / "Data from Open-Meteo GFS (point query)"; never a guess. */
export function hubSourceLabel(dataSource) {
  if (!dataSource || typeof dataSource !== 'object') return 'Data source not reported';
  const origin = originOf(dataSource);
  const model = dataSource.model ? ` ${dataSource.model}` : '';
  if (dataSource.kind === 'point_query') return `Data from ${origin || 'a direct point query'}${model} (point query)`;
  if (dataSource.kind === 'stored_product') return `Data from ${origin || 'a stored'}${model} forecast`;
  return 'Data source not reported';
}

/** 65.61 -> "66° ENE"; null/NaN -> null (the caller shows N/A). */
export function formatWaveDirection(deg) {
  const d = Number(deg);
  if (deg == null || !Number.isFinite(d)) return null;
  const norm = ((Math.round(d) % 360) + 360) % 360;
  return `${norm}° ${degToCompass(norm)}`;
}
