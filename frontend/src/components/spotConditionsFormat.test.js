import { hubSourceLabel, formatWaveDirection } from './spotConditionsFormat';
import { basicSourceName, originOf } from './map/dataOrigin';

describe('W-34: the spot hub says where its sea came from', () => {
  test('a stored NOAA product is named NOAA, not Open-Meteo (Spanish House, 2026-09-29)', () => {
    const ds = { kind: 'stored_product', model: 'GFS', product_id: 'gfs_marine_waves_florida_east_coast_20260930T000000Z.json',
      upstream: 'noaa', dataset: 'ncep_gfswave025' };
    expect(hubSourceLabel(ds)).toBe('Data from NOAA GFS forecast');
  });

  test('the cache-miss lane says it was an Open-Meteo point query', () => {
    expect(hubSourceLabel({ kind: 'point_query', model: 'ICON', upstream: 'open-meteo' }))
      .toBe('Data from Open-Meteo ICON (point query)');
  });

  test('each stored origin is named by its dataset or its upstream id', () => {
    expect(hubSourceLabel({ kind: 'stored_product', model: 'ICON', upstream: 'dwd', dataset: 'dwd_gwam' })).toBe('Data from DWD ICON forecast');
    expect(hubSourceLabel({ kind: 'stored_product', model: 'EURO', upstream: 'copernicus', dataset: 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i' }))
      .toBe('Data from Copernicus EURO forecast');
    expect(hubSourceLabel({ kind: 'stored_product', model: 'EURO', upstream: 'ecmwf', dataset: null })).toBe('Data from ECMWF EURO forecast');
  });

  test('absent or unknown provenance claims nothing (never the old hard-coded "Open-Meteo")', () => {
    expect(hubSourceLabel(undefined)).toBe('Data source not reported');
    expect(hubSourceLabel(null)).toBe('Data source not reported');
    expect(hubSourceLabel({ kind: 'something_new' })).toBe('Data source not reported');
    expect(hubSourceLabel({ kind: 'stored_product' })).toBe('Data from a stored forecast');
  });
});

describe('W-34: the direction reads as degrees and a compass point', () => {
  test('the measured "65.61-" becomes "66° ENE"', () => {
    expect(formatWaveDirection(65.61)).toBe('66° ENE');
  });
  test('due north is a direction, not N/A (the old truthiness check dropped 0)', () => {
    expect(formatWaveDirection(0)).toBe('0° N');
  });
  test('wraps and rounds', () => {
    expect(formatWaveDirection(359.6)).toBe('0° N');
    expect(formatWaveDirection(-90)).toBe('270° W');
    expect(formatWaveDirection(292.5)).toBe('293° WNW');
  });
  test('missing or non-numeric is null (the caller shows N/A)', () => {
    expect(formatWaveDirection(null)).toBeNull();
    expect(formatWaveDirection(undefined)).toBeNull();
    expect(formatWaveDirection('abc')).toBeNull();
  });
});

describe('dataOrigin: one definition shared by the HUD and the hub', () => {
  test('basicSourceName keeps the HUD\'s behaviour (moved verbatim from TruthOverlay)', () => {
    expect(basicSourceName('ncep_gfswave025')).toBe('NOAA');
    expect(basicSourceName('gfs_seamless')).toBe('NOAA');
    expect(basicSourceName('dwd_gwam')).toBe('DWD');
    expect(basicSourceName('cmems_mod_glo_wav_anfc_0.083deg_PT3H-i')).toBe('Copernicus');
    expect(basicSourceName('ecmwf_ifs')).toBe('ECMWF');
    expect(basicSourceName('open-meteo')).toBe('Open-Meteo');
    expect(basicSourceName('')).toBeNull();
    expect(basicSourceName('mystery')).toBeNull();
  });
  test('originOf prefers the dataset, then the upstream id', () => {
    expect(originOf({ dataset: 'ncep_gfswave025', upstream: 'dwd' })).toBe('NOAA');
    expect(originOf({ upstream: 'noaa' })).toBe('NOAA');
    expect(originOf({})).toBeNull();
    expect(originOf(null)).toBeNull();
  });
});
