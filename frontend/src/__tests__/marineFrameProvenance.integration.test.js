import { renderHook } from '@testing-library/react';
import { mapNormalizedGridToWebGL } from '../components/map/backendWeatherServiceClientHelpers';
import { frameToMarineData } from '../components/map/marineSeriesFrame';
import { useMarineWindData } from '../components/map/useMarineWindData';
import { __resetForTests } from '../components/map/marineTransitionCoordinator';

const bounds = { west: -1, south: -1, east: 1, north: 1 };
const identity = {
  model_run_time: '2026-09-11T06:00:00Z', model_run_time_status: 'known',
  ingested_at: '2026-09-11T09:12:00Z', served_valid_time: '2026-09-11T12:00:00Z',
  frame_offset_hours: -3, frame_substituted: true,
  upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025',
};
const vectors = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([lng, lat], i) => ({
  lng, lat, speed: i + 1, height: i + 1, period: 8 + i, direction: 270, u: i + 1, v: 0,
  isOcean: true, waves: { speed: i + 1, height: i + 1, period: 8 + i, direction: 270, u: i + 1, v: 0, isOcean: true },
}));
function response(extra = identity) {
  return { ...extra, provider: 'open-meteo', model: 'GFS', layer: 'waves',
    valid_time: '2026-09-11T15:00:00Z', run_time: '2026-09-11T09:12:00Z', hour_offset: 3,
    product_id: 'gfs_waves_fixture', grid: { bounds, cols: 2, rows: 2, vectors },
    bounds, cols: 2, rows: 2, vectors };
}
const map = { getZoom: () => 9, getBounds: () => ({ getWest: () => -0.5, getEast: () => 0.5, getSouth: () => -0.5, getNorth: () => 0.5 }) };
const build = (lane, raw) => lane === 'grid'
  ? mapNormalizedGridToWebGL(raw, bounds, 3, 'waves', 'GFS') : frameToMarineData(raw, 'GFS', 'waves');
const conform = marineData => renderHook(() => useMarineWindData({ marineData,
  activeMarineLayer: 'waves', activeModel: 'GFS', timeOffsetHours: 12, mapInstance: map, viewState: { zoom: 9 } })).result.current;
beforeEach(() => { __resetForTests(); window.__MARINE_FETCH_PENDING__ = false; window.__MARINE_FETCH_DEBOUNCING__ = false; });

it.each(['grid', 'series'])('carries source identity through the %s adapter and actual render hook', lane => {
  const adapted = build(lane, response());
  expect(adapted.grid).toMatchObject(identity);
  const rendered = conform(adapted);
  expect(rendered).not.toBeNull();
  expect(rendered).toMatchObject(identity);
  expect(rendered.hourOffset).toBe(3); // committed frame, not slider position 12
  expect(rendered.valid_time).toBe('2026-09-11T15:00:00Z'); // requested time remains distinct
  expect(rendered.run_time).toBe('2026-09-11T09:12:00Z'); // legacy cache revision is unchanged
  expect(rendered.vectors.map(v => [v.lng, v.lat, v.height, v.period, v.direction]))
    .toEqual(vectors.map(v => [v.lng, v.lat, v.height, v.period, v.direction]));
});

it.each(['grid', 'series'])('does not invent a cycle or served time from the %s request/revision', lane => {
  const rendered = conform(build(lane, response({})));
  expect(rendered).not.toBeNull();
  expect(rendered.model_run_time).toBeNull();
  expect(rendered.served_valid_time).toBeNull();
  expect(rendered.upstream_provider).toBeNull();
  expect(rendered.source_dataset).toBeNull();
});

it('preserves explicit zero/false and the committed grid identity over a conflicting wrapper', () => {
  const adapted = build('grid', response({ ...identity, frame_offset_hours: 0, frame_substituted: false }));
  Object.assign(adapted, { ...identity, model_run_time: '2026-09-11T12:00:00Z' });
  const rendered = conform(adapted);
  expect(rendered.model_run_time).toBe(identity.model_run_time);
  expect(rendered.frame_offset_hours).toBe(0);
  expect(rendered.frame_substituted).toBe(false);
});
