/**
 * dataOrigin.js: which organisation a forecast came from, named ONE way everywhere.
 *
 * `basicSourceName` was an inline helper in TruthOverlay (the HUD's "Provider:" row). W-34
 * (2026-09-30) needs the same answer for the spot hub's source line, so it lives here and both import
 * it (LESSONS L-S11: two answers share one definition). Moved verbatim; behaviour unchanged.
 */

// Map the data's source_dataset to its basic origin name so a surface shows where the data ACTUALLY
// came from (NOAA / DWD / Copernicus / ECMWF) instead of the 'open-meteo' capabilities-contract key.
export function basicSourceName(sd) {
  if (!sd) return null;
  const s = String(sd).toLowerCase();
  if (s.includes('gfs') || s.startsWith('ncep')) return 'NOAA';
  if (s.includes('gwam') || s.includes('dwd')) return 'DWD';
  if (s.includes('copernicus') || s.includes('cmems')) return 'Copernicus';
  if (s.includes('ecmwf')) return 'ECMWF';
  if (s.includes('open') && s.includes('meteo')) return 'Open-Meteo';
  return null;
}

// The backend's `upstream_provider` ids (schemas.ProductEntry) that no dataset name spells out.
const UPSTREAM_NAMES = { noaa: 'NOAA', dwd: 'DWD', ecmwf: 'ECMWF', copernicus: 'Copernicus' };

/** The origin of a `data_source` record (backend spot_conditions): dataset first, then upstream id. */
export function originOf(dataSource) {
  if (!dataSource || typeof dataSource !== 'object') return null;
  return basicSourceName(dataSource.dataset)
    || basicSourceName(dataSource.upstream)
    || UPSTREAM_NAMES[String(dataSource.upstream || '').toLowerCase()]
    || null;
}
