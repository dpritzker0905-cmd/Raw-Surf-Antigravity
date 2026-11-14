/**
 * staticRasterSets.js: the RASTER weather sets in STATIC_SETS (2026-11-14; moved out of staticFrames.js, which sits at the 800-line
 * cap, as staticEuroSwellSets.js). Read only by ownRasterFrames.js (the own-raster layers): not waves sets, so the marine frame
 * store never takes them. A set the publisher has not published yet is a miss ('no_index' / 'set_not_published') and the layer
 * stays on the .om path. Spread into STATIC_SETS at the same place, in the same order, as the lines it replaces.
 */
export const RASTER_SET_KEYS = Object.freeze([
  // GFS mean-sea-level pressure (2026-10-23, the raster layers' own frames from free NOAA GRIB).
  'GFS/weather/pressure/global_0p5',
  // Per-model pressure (2026-10-24): EURO from ECMWF open data, ICON from DWD (frame_set_raster_sources).
  'EURO/weather/pressure/global_0p5', 'ICON/weather/pressure/global_0p5',
  'GFS/weather/temperature/global_0p5',   // GFS 2 m air temperature (2026-10-24, #515's set)
  'GFS/weather/cloud_cover/global_0p25',   // GFS total cloud cover (2026-10-24, the 'satellite' layer; #515's set)
  'GFS/weather/precipitation/global_0p25', 'EURO/weather/precipitation/global_0p25',   // 2026-11-12: mm/h, the 'rain' layer
  // 2026-11-14 (the fog / air temp / water temp instant lane, #888's sets): per-model air temperature, GFS surface visibility
  // (fog) and model skin temperature (water temp).
  'EURO/weather/temperature/global_0p25', 'ICON/weather/temperature/global_0p5',
  'GFS/weather/fog/global_0p25',
  'GFS/weather/water_temp/global_0p25', 'EURO/weather/water_temp/global_0p25',
]);
