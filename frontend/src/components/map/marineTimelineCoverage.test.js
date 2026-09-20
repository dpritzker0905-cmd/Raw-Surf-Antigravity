import { updateProjectionDiag } from './backendWeatherServiceClientDiag';
import { evaluateMarineTimelineCoverage, publishMarineTimelineFrame, publishMarineTimelineRequest,
  readMarineTimelineRenderEvidence, reconcileMarineTimelineCoverage } from './marineTimelineCoverage';

const NOW = '2026-09-20T21:00:00Z';
const FUTURE = '2026-09-21T15:00:00Z';
const BOX = { west: -82, south: 26, east: -79, north: 30 };
const publish = extra => updateProjectionDiag('marine', {
  activeModel: 'GFS', activeLayer: 'waves', timeOffsetHours: 0,
  requestedValidTime: NOW, validTime: NOW, productId: 'current-product',
  requestedViewportBounds: BOX, clampedBbox: BOX, responseGridBounds: BOX,
  renderable: true, cols: 13, rows: 17, vectorCount: 221, ...extra,
});

beforeEach(() => {
  delete window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  delete window.__MARINE_RENDER_HOUR_PARITY__;
  delete window.__MARINE_ENGINE__;
});

test('a spatially covering future response cannot claim current temporal coverage', () => {
  publish({ validTime: FUTURE });
  const diag = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  expect(diag.coverage_status).toBe('stale_time_mismatch');
  expect(diag.spatialCoverageStatus).toBe('full_coverage');
  expect(diag.temporalStatus).toBe('response_time_mismatch');
});

test('unverified retained-render telemetry is disclosed without claiming a verified render failure', () => {
  window.__MARINE_RENDER_HOUR_PARITY__ = { requestedHour: 0, renderedDataHour: 18, parity: false };
  publish();
  const diag = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  expect(diag.coverage_status).toBe('temporal_coverage_unverified');
  expect(diag.temporalStatus).toBe('render_time_unverified');
  expect(diag.renderTimeMismatch).toBe(false);
  expect(diag.reportedRenderTimeMismatch).toBe(true);
});

test('verified render evidence can establish the actual mismatch', () => {
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { __sourceModel: 'GFS',
    __componentLayer: 'waves', hourOffset: 18, served_valid_time: FUTURE } } };
  publish();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.temporalStatus).toBe('render_time_mismatch');
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status).toBe('stale_time_mismatch');
});

test('accepted engine time takes precedence over a stale legacy parity effect', () => {
  window.__MARINE_RENDER_HOUR_PARITY__ = { requestedHour: 0, renderedDataHour: 18, parity: false };
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { __sourceModel: 'GFS',
    __componentLayer: 'waves', hourOffset: 0, served_valid_time: NOW } } };
  publish();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
    temporalStatus: 'aligned', renderVerified: true, coverage_status: 'full_coverage',
  });
});

test('healthy equal instants and coverage survive different ISO string formatting', () => {
  publish({ validTime: '2026-09-20T21:00:00.000Z' });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status).toBe('full_coverage');
});

test('a correct subsequent response clears a prior response mismatch', () => {
  publish({ validTime: FUTURE });
  publish();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status).toBe('full_coverage');
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.temporalStatus).toBe('aligned');
});

test.each([
  { __sourceModel: 'EURO', __componentLayer: 'waves', valid_time: NOW },
  { __sourceModel: 'GFS', __componentLayer: 'swell', valid_time: NOW },
  { __sourceModel: 'GFS', __componentLayer: 'waves' },
  { __sourceModel: 'GFS', __componentLayer: 'waves', valid_time: 'invalid' },
])('unrelated or unidentified engine data cannot verify coverage: %j', grid => {
  window.__MARINE_RENDER_HOUR_PARITY__ = { renderedDataHour: 18, verified: true };
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: grid } };
  publish();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
    coverage_status: 'temporal_coverage_unverified', renderVerified: false,
    renderEvidenceSource: 'legacy_hour_parity',
  });
});

test('cadence aliases are compared by accepted valid time, not relative hour labels', () => {
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { __sourceModel: 'GFS',
    __componentLayer: 'waves', hourOffset: 0, valid_time: NOW } } };
  publish({ timeOffsetHours: 1 });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
    temporalStatus: 'aligned', renderTimeMismatch: false, renderVerified: true,
  });
});

test('missing frame metadata cannot inherit the prior product or borrow requested identity', () => {
  publish();
  publishMarineTimelineFrame({ data: { grid: {} }, model: 'GFS', layer: 'waves', hour: 0,
    requestedValidTime: NOW });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
    selectedValidTime: null, gridProductId: null, model_run_time: null,
    model_run_time_status: 'missing', temporalStatus: 'unknown',
  });
});

test('actual served identity wins over requested-looking validity metadata', () => {
  publishMarineTimelineFrame({ data: { served_valid_time: FUTURE, valid_time: NOW,
    grid: { productId: 'served-product', model_run_time: '2026-09-20T06:00:00Z' } },
  model: 'GFS', layer: 'waves', hour: 0, requestedValidTime: NOW });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
    selectedValidTime: FUTURE, gridProductId: 'served-product', temporalStatus: 'response_time_mismatch',
  });
});

test('request metadata preserves a provided pre-snap time and clears unknown prior request provenance', () => {
  publishMarineTimelineRequest({ model: 'GFS', layer: 'waves', hour: 1, requestedValidTime: NOW,
    requestedValidTimeOriginal: '2026-09-20T22:00:00Z' });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.requestedValidTimeOriginal).toBe('2026-09-20T22:00:00Z');
  publishMarineTimelineRequest({ model: 'GFS', layer: 'waves', hour: 0, requestedValidTime: NOW });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.requestedValidTimeOriginal).toBeNull();
});

test('empty/other-domain diagnostics and absent globals are safe', () => {
  expect(readMarineTimelineRenderEvidence('GFS', 'waves', null)).toBeNull();
  expect(reconcileMarineTimelineCoverage(null)).toBeNull();
  expect(reconcileMarineTimelineCoverage({ __FORECAST_TIMELINE_COVERAGE_DIAG__: { domain: 'wind' } })).toBeNull();
  expect(publishMarineTimelineFrame({ data: {} })).toBeNull();
  expect(publishMarineTimelineRequest({}, null)).toBeNull();
  expect(evaluateMarineTimelineCoverage()).toMatchObject({ temporalStatus: 'unknown', requestedHour: null });
});

test('a stale identity can recover without changing the current requested time', () => {
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { __sourceModel: 'GFS',
    __componentLayer: 'waves', validTime: FUTURE } } };
  publish();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status).toBe('stale_time_mismatch');
  window.__MARINE_ENGINE__._waveData.waveGrid.validTime = NOW;
  reconcileMarineTimelineCoverage();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status).toBe('full_coverage');
});
