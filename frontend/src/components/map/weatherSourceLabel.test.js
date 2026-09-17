import { weatherSourceLabel } from './weatherSourceLabel';
import { frameToMarineData } from './marineSeriesFrame';

jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

test.each(['ncep_gfswave025', 'ecmwf_wam025', 'cmems_mod_glo_wav_anfc'])('dataset %s cannot conceal the supplier', dataset => {
  const grid = { __sourceDataset: dataset, provider: 'open-meteo' };
  expect(weatherSourceLabel(grid)).toBe('Source unverified');
  expect(weatherSourceLabel({ ...grid, __upstreamProvider: 'open-meteo' })).toBe('Open-Meteo');
  expect(weatherSourceLabel({ ...grid, __upstreamProvider: 'noaa' })).toBe('NOAA direct');
  expect(weatherSourceLabel({ ...grid, __upstreamProvider: 'ecmwf' })).toBe('ECMWF direct');
});

test.each(['GFS', 'ICON', 'EURO'])('a %s frame without provenance remains unknown', model => {
  const result = frameToMarineData({ hour_offset: 3, vectors: [] }, model, 'waves');
  expect(result.grid.__sourceDataset).toBeNull();
  expect(result.grid.__upstreamProvider).toBeNull();
  expect(weatherSourceLabel(result.grid)).toBe('Source unverified');
});

test('series preserves supplied dataset and provider without changing vectors', () => {
  const vectors = [{ speed: 1.5, direction: 270 }];
  const frame = { hour_offset: 3, vectors, source_dataset: 'ecmwf_wam025', upstream_provider: 'ecmwf', provider: 'open-meteo' };
  const result = frameToMarineData(frame, 'EURO', 'waves');
  expect(result.grid.__sourceDataset).toBe('ecmwf_wam025');
  expect(result.grid.provider).toBe('open-meteo');
  expect(result.grid.vectors).toBe(vectors);
  expect(weatherSourceLabel(result.grid)).toBe('ECMWF direct');
});
