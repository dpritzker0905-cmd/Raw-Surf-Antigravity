/**
 * A15-09 (audit 15.0, measured live 2026-09-25): the committed series frame must carry the STORED
 * product it came from, and the diagnostics every consumer reads must name what is on screen.
 *
 * Measured: `__MARINE_PROJECTION_DIAG__` kept `activeModel: GFS / gfs_marine_waves_florida_east_coast`
 * for 30 s after a switch to EURO, and stayed `not_initialized` forever in the fallback lane, while
 * the infobox took its /point product id from it.
 */
import { frameToMarineData } from './marineSeriesFrame';
import { publishMarineTimelineFrame } from './marineTimelineCoverage';

const FRAME = {
  hour_offset: 3, valid_time: '2026-09-25T21:00:00Z', served_valid_time: '2026-09-25T21:00:00Z',
  cols: 2, rows: 1, bounds: { west: -82, south: 26, east: -79, north: 30 },
  vectors: [{ lat: 27, lng: -80, speed: 1.7, direction: 55, u: 0, v: 0, period: 12, is_valid: true }],
  provider: 'open-meteo', upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025',
  model_run_time: '2026-09-25T12:00:00Z', model_run_time_status: 'known',
  product_id: 'gfs_marine_waves_florida_east_coast_20260925T210000Z.json', region_id: 'florida_east_coast',
};

beforeEach(() => {
  delete window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  delete window.__MARINE_PROJECTION_DIAG__;
});

test('a series frame carries the stored product id beside the stable lineage id', () => {
  const data = frameToMarineData(FRAME, 'GFS', 'waves');
  expect(data.grid.__servedProductId).toBe(FRAME.product_id);
  expect(data.grid.__regionId).toBe('florida_east_coast');
  expect(data.served_product_id).toBe(FRAME.product_id);
  // The truth tracker keys chains on this; it must not move.
  expect(data.product_id).toBe('series_GFS_waves_h3');
});

test('a live-fetched frame has no stored id, and none is invented', () => {
  const data = frameToMarineData({ ...FRAME, product_id: undefined, region_id: undefined }, 'GFS', 'waves');
  expect(data.grid.__servedProductId).toBeNull();
  expect(data.served_product_id).toBeNull();
});

test('a series commit brings the projection diag identity current and keeps its geometry', () => {
  window.__MARINE_PROJECTION_DIAG__ = {
    activeModel: 'GFS', activeLayer: 'waves', productId: 'gfs_old.json', status: 'not_initialized',
    renderDecision: 'unsupported', servedCols: 17, backendRequestBbox: '-84,25,-77,30', resolution: 0.25,
  };
  const data = frameToMarineData({ ...FRAME, upstream_provider: 'ecmwf',
    product_id: 'euro_marine_waves_florida_east_coast_20260925T210000Z.json' }, 'EURO', 'waves');
  publishMarineTimelineFrame({ data, model: 'EURO', layer: 'waves', hour: 3,
    requestedValidTime: '2026-09-25T21:00:00.000Z' });

  const p = window.__MARINE_PROJECTION_DIAG__;
  expect(p.activeModel).toBe('EURO');
  expect(p.productId).toBe('euro_marine_waves_florida_east_coast_20260925T210000Z.json');
  expect(p.validTime).toBe('2026-09-25T21:00:00Z');
  expect(p.status).toBe('active');
  expect(p.renderDecision).toBe('render');
  expect(p.provider).toBe('open-meteo');            // the dispatch key keeps its meaning
  expect(p.upstreamProvider).toBe('ecmwf');         // the origin sits beside it
  expect(p.identitySource).toBe('series_commit');
  expect(p.servedCols).toBe(17);                     // /grid-lane geometry untouched
  expect(p.backendRequestBbox).toBe('-84,25,-77,30');
  expect(p.resolution).toBe(0.25);

  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.servedProductId)
    .toBe('euro_marine_waves_florida_east_coast_20260925T210000Z.json');
});

test('an empty series frame is not reported as rendering', () => {
  const data = frameToMarineData({ ...FRAME, vectors: [] }, 'ICON', 'swell_2');
  publishMarineTimelineFrame({ data, model: 'ICON', layer: 'swell_2', hour: 0, requestedValidTime: null });
  expect(window.__MARINE_PROJECTION_DIAG__.renderable).toBe(false);
  expect(window.__MARINE_PROJECTION_DIAG__.renderDecision).toBe('unsupported');
});

test('a /grid-lane commit leaves the projection diag to the /grid lane', () => {
  window.__MARINE_PROJECTION_DIAG__ = { activeModel: 'GFS', productId: 'gfs_grid_lane.json', identitySource: undefined };
  const data = { grid: { vectors: [{}], productId: 'gfs_grid_lane.json' }, product_id: 'gfs_grid_lane.json' };
  publishMarineTimelineFrame({ data, model: 'GFS', layer: 'waves', hour: 0, requestedValidTime: null });
  expect(window.__MARINE_PROJECTION_DIAG__.identitySource).toBeUndefined();
  expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_grid_lane.json');
});

test('the infobox sends the stored id of the committed frame', () => {
  // useExactPointFetch builds its /point request from the committed grid. Pin the read at the
  // source: a series grid has neither productId nor product_id, only __servedProductId.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../hooks/useExactPointFetch.js'), 'utf8');
  expect(src).toMatch(/grid\?\.productId \|\| grid\?\.product_id \|\| grid\?\.__servedProductId/);
});
