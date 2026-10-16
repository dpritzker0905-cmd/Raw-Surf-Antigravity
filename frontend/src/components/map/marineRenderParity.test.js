/**
 * marineRenderParity.test.js - the pure publisher behind window.__MARINE_RENDER_HOUR_PARITY__ / __MARINE_HEATMAP_STATUS__.
 * The same decision table is also driven through the real component in WebGLMarineLayer.parity.test.js; these tests pin the
 * function's own contract (inputs in, two globals out) so a mutation in either place is caught from two sides.
 */
import { publishRenderParity, republishRenderParityAfterUpload } from './marineRenderParity';
import {
  getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine, getMarineHourlyCache,
} from './marineController';
import { isInCooldown } from './marineControllerUtils';
import { getSharedValidTime } from './backendWeatherServiceClient';

jest.mock('./marineController', () => ({
  getMarineHourlyCache: jest.fn(), getBackendWeatherFlag: jest.fn(), getBackendCopernicusFlag: jest.fn(),
  getBackendIconMarineFlag: jest.fn(), getModelSafeMarine: jest.fn(),
}));
jest.mock('./marineControllerUtils', () => ({
  ...jest.requireActual('./marineControllerUtils'),
  isInCooldown: jest.fn(),
}));
jest.mock('./backendWeatherServiceClient', () => ({ getSharedValidTime: jest.fn() }));

const NOON = '2026-10-09T12:00:00.000Z';
const NEVER = '1970-01-01T00:00:00.000Z';

// lastUploadedGridRef.current after an upload of a hour-`hour` frame
const sig = (over = {}) => ({
  activeModel: 'GFS', activeMarineLayer: 'waves', componentLayer: 'waves', gridProvider: 'open-meteo',
  vectorsLength: 3, renderedDataHour: 0, renderedValidTime: NOON, ...over,
});
const emptySig = () => ({
  activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
  boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0, timestamp: 0, renderedDataHour: null,
});
const map = () => ({
  getBounds: () => ({ getWest: () => -10, getSouth: () => 20, getEast: () => 10, getNorth: () => 40 }),
});
const args = (over = {}) => ({
  requestedHour: 0, active: true, activeModel: 'GFS', mapInstance: map(), activeLayers: ['waves'], lastSig: sig(), ...over,
});
const parity = () => window.__MARINE_RENDER_HOUR_PARITY__;
const status = () => window.__MARINE_HEATMAP_STATUS__;

beforeEach(() => {
  delete window.__MARINE_RENDER_HOUR_PARITY__;
  delete window.__MARINE_HEATMAP_STATUS__;
  delete window.__RAW_DISABLE_HOUR_BY_INSTANT__;
  delete window.__RAW_DISABLE_PARITY_REPUBLISH__;
  getBackendWeatherFlag.mockImplementation(() => true);
  getBackendIconMarineFlag.mockImplementation(() => true);
  getBackendCopernicusFlag.mockImplementation(() => true);
  getModelSafeMarine.mockImplementation(() => ({ grid: {} }));
  getMarineHourlyCache.mockImplementation(() => null);
  isInCooldown.mockImplementation(() => false);
  getSharedValidTime.mockImplementation(() => NEVER);
});

describe('publishRenderParity: the reason table', () => {
  test('layer_inactive wins even when the drawn hour matches', () => {
    publishRenderParity(args({ active: false }));
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: false, reason: 'layer_inactive' });
  });

  test('an empty record reads as nothing drawn, whatever hour it still carries', () => {
    publishRenderParity(args({ lastSig: { ...emptySig(), renderedDataHour: 7 } }));
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: null, parity: false, reason: 'no_data_rendered' });
  });

  test('a record with vectors but no hour reads as nothing drawn', () => {
    publishRenderParity(args({ lastSig: sig({ renderedDataHour: null }) }));
    expect(parity().reason).toBe('no_data_rendered');
  });

  test('hour 0 drawn for hour 0 is a match (0 is a real hour, not "no data")', () => {
    publishRenderParity(args());
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: true, reason: 'parity_match' });
  });

  test('an older hour drawn is retained_previous', () => {
    publishRenderParity(args({ requestedHour: 72, lastSig: sig({ renderedDataHour: 0 }) }));
    expect(parity()).toEqual({ requestedHour: 72, renderedDataHour: 0, parity: false, reason: 'retained_previous' });
  });

  test('coverageMissing is judged before the cooldown', () => {
    getModelSafeMarine.mockImplementation(() => null);
    isInCooldown.mockImplementation(() => true);
    publishRenderParity(args({ requestedHour: 72 }));
    expect(parity().reason).toBe('coverageMissing');
  });

  test('cooldownActive when coverage is there and the marine domain is cooling down', () => {
    isInCooldown.mockImplementation((d) => d === 'marine');
    publishRenderParity(args({ requestedHour: 72 }));
    expect(parity().reason).toBe('cooldownActive');
  });

  test('a label that differs from the selected hour but is the same instant is a match', () => {
    getSharedValidTime.mockImplementation((h) => (h === 16 ? NOON : NEVER));
    publishRenderParity(args({ requestedHour: 16, lastSig: sig({ renderedDataHour: 15 }) }));
    expect(parity()).toEqual({ requestedHour: 16, renderedDataHour: 15, parity: true, reason: 'parity_match' });
  });

  test('the instant test asks for the selected model, not the frame model', () => {
    getSharedValidTime.mockImplementation((h, l, m) => (m === 'EURO' ? NOON : NEVER));
    publishRenderParity(args({ requestedHour: 16, activeModel: 'EURO', lastSig: sig({ renderedDataHour: 15, activeModel: 'EURO' }) }));
    expect(parity().parity).toBe(true);
    expect(getSharedValidTime).toHaveBeenCalledWith(16, 'waves', 'EURO', { readOnly: true });
  });
});

describe('publishRenderParity: the heat-map status', () => {
  test('retained_previous_hour carries model, layer, hours and the retained flag', () => {
    publishRenderParity(args({ requestedHour: 72, activeLayers: ['swell_2'], lastSig: sig({ renderedDataHour: 0, componentLayer: 'swell_2', activeMarineLayer: 'swell_2' }) }));
    expect(status()).toEqual({
      status: 'retained_previous_hour', model: 'GFS', layer: 'swell_2', hour: 72, renderedHour: 0, retainedPrevious: true,
    });
  });

  test('cooldownActive is rate_limited_cached', () => {
    isInCooldown.mockImplementation(() => true);
    publishRenderParity(args({ requestedHour: 72 }));
    expect(status().status).toBe('rate_limited_cached');
  });

  test.each([
    ['GFS', 'no_backend_coverage'], ['ICON', 'no_backend_coverage'], ['EURO', 'no_copernicus_coverage'],
  ])('coverageMissing on %s is %s', (model, expected) => {
    getModelSafeMarine.mockImplementation(() => null);
    publishRenderParity(args({ requestedHour: 72, activeModel: model, lastSig: sig({ activeModel: model }) }));
    expect(status().status).toBe(expected);
  });

  test('no data drawn still publishes a retained_previous_hour status for an active layer', () => {
    publishRenderParity(args({ lastSig: emptySig() }));
    expect(status()).toEqual({
      status: 'retained_previous_hour', model: 'GFS', layer: 'waves', hour: 0, renderedHour: null, retainedPrevious: true,
    });
  });

  test('an inactive layer never writes a status', () => {
    const before = { status: 'retained_previous_hour' };
    window.__MARINE_HEATMAP_STATUS__ = before;
    publishRenderParity(args({ active: false, requestedHour: 72 }));
    expect(status()).toBe(before);
  });

  test.each(['retained_previous_hour', 'no_copernicus_coverage', 'no_backend_coverage'])('parity clears %s', (s) => {
    window.__MARINE_HEATMAP_STATUS__ = { status: s };
    publishRenderParity(args());
    expect(status()).toBeNull();
  });

  test.each(['rate_limited_cached', 'other'])('parity leaves %s alone', (s) => {
    const before = { status: s };
    window.__MARINE_HEATMAP_STATUS__ = before;
    publishRenderParity(args());
    expect(status()).toBe(before);
  });

  test('parity with no status set does not invent one', () => {
    publishRenderParity(args());
    expect(status()).toBeUndefined();
  });
});

describe('publishRenderParity: the coverage lookups', () => {
  test('GFS (or a missing model) asks the backend cache with the viewport bounds and the active marine layer', () => {
    publishRenderParity(args({ requestedHour: 5, activeModel: null, activeLayers: ['rating', 'swell_1'] }));
    expect(getModelSafeMarine).toHaveBeenCalledWith(null, 5, 'swell_1', { west: -10, south: 20, east: 10, north: 40 });
  });

  test('a backend flag only counts for its own model', () => {
    getBackendWeatherFlag.mockImplementation(() => true);
    getBackendIconMarineFlag.mockImplementation(() => false);
    getBackendCopernicusFlag.mockImplementation(() => false);
    publishRenderParity(args({ requestedHour: 5, activeModel: 'EURO' }));
    expect(getModelSafeMarine).not.toHaveBeenCalled();
    expect(parity().reason).toBe('coverageMissing'); // legacy cache is empty
  });

  test('a missing map instance asks with null bounds and does not throw', () => {
    expect(() => publishRenderParity(args({ requestedHour: 5, mapInstance: null }))).not.toThrow();
    expect(getModelSafeMarine).toHaveBeenCalledWith('GFS', 5, 'waves', null);
  });

  test('a map whose getBounds throws asks with null bounds', () => {
    const bad = { getBounds: () => { throw new Error('mid style load'); } };
    publishRenderParity(args({ requestedHour: 5, mapInstance: bad }));
    expect(getModelSafeMarine).toHaveBeenCalledWith('GFS', 5, 'waves', null);
  });

  test('the legacy cache: within 3 h retains, beyond 3 h is missing', () => {
    getBackendWeatherFlag.mockImplementation(() => false);
    const hour = Math.floor(Date.now() / 3600000) * 3600000;
    const times = (startH) => Array.from({ length: 24 }, (_, i) => new Date(hour + (startH + i) * 3600000).toISOString());
    getMarineHourlyCache.mockImplementation(() => ({ results: [{ hourly: { time: times(-12) } }] }));
    publishRenderParity(args({ requestedHour: 5 }));
    expect(parity().reason).toBe('retained_previous');
    getMarineHourlyCache.mockImplementation(() => ({ results: [{ hourly: { time: times(-200) } }] }));
    publishRenderParity(args({ requestedHour: 5 }));
    expect(parity().reason).toBe('coverageMissing');
  });
});

describe('republishRenderParityAfterUpload: the post-upload call, from the layer refs', () => {
  const refs = (over = {}) => ({
    timeOffsetHoursRef: { current: 0 },
    activeRef: { current: true },
    activeModelRef: { current: 'GFS' },
    mapRef: { current: map() },
    activeLayersRef: { current: ['waves'] },
    lastUploadedGridRef: { current: sig() },
    ...over,
  });
  const STALE = { requestedHour: 0, renderedDataHour: 72, parity: false, reason: 'retained_previous' };

  test('an upload whose frame serves the requested hour flips a stale record from false to true', () => {
    window.__MARINE_RENDER_HOUR_PARITY__ = STALE;
    republishRenderParityAfterUpload(refs());
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: true, reason: 'parity_match' });
  });

  test('it clears a stale retained_previous_hour status', () => {
    window.__MARINE_HEATMAP_STATUS__ = { status: 'retained_previous_hour' };
    republishRenderParityAfterUpload(refs());
    expect(status()).toBeNull();
  });

  test('an upload of an older hour leaves parity false with reason retained_previous', () => {
    republishRenderParityAfterUpload(refs({ timeOffsetHoursRef: { current: 72 } }));
    expect(parity()).toEqual({ requestedHour: 72, renderedDataHour: 0, parity: false, reason: 'retained_previous' });
    expect(status().hour).toBe(72);
  });

  test('the requested hour, model, layer and map are read from the refs when it is called', () => {
    const r = refs();
    r.timeOffsetHoursRef.current = 5;
    r.activeModelRef.current = 'EURO';
    r.activeLayersRef.current = ['swell_1'];
    republishRenderParityAfterUpload(r);
    expect(parity().requestedHour).toBe(5);
    expect(getModelSafeMarine).toHaveBeenCalledWith('EURO', 5, 'swell_1', { west: -10, south: 20, east: 10, north: 40 });
    expect(status().model).toBe('EURO');
  });

  test('an inactive layer stays layer_inactive and writes no status', () => {
    const before = { status: 'retained_previous_hour' };
    window.__MARINE_HEATMAP_STATUS__ = before;
    republishRenderParityAfterUpload(refs({ activeRef: { current: false } }));
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: false, reason: 'layer_inactive' });
    expect(status()).toBe(before);
  });

  test('a missing map instance does not throw and the record is still published', () => {
    expect(() => republishRenderParityAfterUpload(refs({ mapRef: { current: null }, timeOffsetHoursRef: { current: 5 } }))).not.toThrow();
    expect(getModelSafeMarine).toHaveBeenCalledWith('GFS', 5, 'waves', null);
    expect(parity().reason).toBe('retained_previous');
  });

  test('it never throws into the upload path, whatever the cache does', () => {
    getModelSafeMarine.mockImplementation(() => { throw new Error('cache exploded'); });
    expect(() => republishRenderParityAfterUpload(refs({ timeOffsetHoursRef: { current: 5 } }))).not.toThrow();
  });

  test('it never throws on refs that are not there yet', () => {
    expect(() => republishRenderParityAfterUpload(refs({ lastUploadedGridRef: { current: null } }))).not.toThrow();
    expect(() => republishRenderParityAfterUpload(undefined)).not.toThrow();
    expect(() => republishRenderParityAfterUpload({})).not.toThrow();
  });

  test('the kill switch __RAW_DISABLE_PARITY_REPUBLISH__ === true leaves the record exactly as it was', () => {
    window.__RAW_DISABLE_PARITY_REPUBLISH__ = true;
    window.__MARINE_RENDER_HOUR_PARITY__ = STALE;
    const stale = { status: 'retained_previous_hour' };
    window.__MARINE_HEATMAP_STATUS__ = stale;
    republishRenderParityAfterUpload(refs());
    expect(parity()).toBe(STALE);
    expect(status()).toBe(stale);
  });

  test.each(['true', 1, false, undefined])('only strict true disables it (%p does not)', (v) => {
    window.__RAW_DISABLE_PARITY_REPUBLISH__ = v;
    window.__MARINE_RENDER_HOUR_PARITY__ = STALE;
    republishRenderParityAfterUpload(refs());
    expect(parity().parity).toBe(true);
  });

  test('the kill switch does not touch publishRenderParity itself (the effect keeps its old behaviour)', () => {
    window.__RAW_DISABLE_PARITY_REPUBLISH__ = true;
    publishRenderParity(args());
    expect(parity().parity).toBe(true);
  });
});

// REVIEW FINDING (2026-10-16): at a clear the republish judged an ACTIVE layer with an emptied engine and wrote
// __MARINE_HEATMAP_STATUS__ = retained_previous_hour (renderedHour null). computeHeatmapStatus turns that into the user-visible
// "retained stale" badge, MapForecastOverlay memoizes it before the layer's effects run, and the republish that nulls the global
// after the next good frame never recomputes the memo: the badge stuck. Nothing was retained either. The republish therefore must
// not WRITE a status when there is nothing drawn; it still writes the parity record (the stale-true fix) and still CLEARS a stale one.
describe('the status is not written when nothing is drawn (writeStatusWhenNoData)', () => {
  const refs = (over = {}) => ({
    timeOffsetHoursRef: { current: 0 },
    activeRef: { current: true },
    activeModelRef: { current: 'GFS' },
    mapRef: { current: map() },
    activeLayersRef: { current: ['waves'] },
    lastUploadedGridRef: { current: emptySig() },
    ...over,
  });
  const NOTHING_DRAWN = { requestedHour: 0, renderedDataHour: null, parity: false, reason: 'no_data_rendered' };

  test('the republish of an emptied engine leaves a null status null and still publishes no_data_rendered', () => {
    window.__MARINE_HEATMAP_STATUS__ = null;
    republishRenderParityAfterUpload(refs());
    expect(parity()).toEqual(NOTHING_DRAWN);
    expect(status()).toBeNull();
  });

  test('it leaves an unset status unset', () => {
    republishRenderParityAfterUpload(refs());
    expect(parity()).toEqual(NOTHING_DRAWN);
    expect(status()).toBeUndefined();
  });

  test('it leaves an orchestrator-written status object untouched (same reference, same fields)', () => {
    const orchestrator = { status: 'no_backend_coverage', requestedHour: 72, renderedHour: 0, coverageRejected: true, retainedPrevious: true, blockedReason: 'cache_coverage_exceeded' };
    window.__MARINE_HEATMAP_STATUS__ = orchestrator;
    republishRenderParityAfterUpload(refs());
    expect(status()).toBe(orchestrator);
    expect(orchestrator).toEqual({ status: 'no_backend_coverage', requestedHour: 72, renderedHour: 0, coverageRejected: true, retainedPrevious: true, blockedReason: 'cache_coverage_exceeded' });
  });

  test('a record with vectorsLength 0 counts as nothing drawn even if it still carries an hour', () => {
    republishRenderParityAfterUpload(refs({ lastUploadedGridRef: { current: sig({ vectorsLength: 0, renderedDataHour: 7 }) } }));
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: null, parity: false, reason: 'no_data_rendered' });
    expect(status()).toBeUndefined();
  });

  test('publishRenderParity itself honours the option: false suppresses the write when nothing is drawn', () => {
    publishRenderParity(args({ lastSig: emptySig(), writeStatusWhenNoData: false }));
    expect(parity()).toEqual(NOTHING_DRAWN);
    expect(status()).toBeUndefined();
  });

  test('the effect path keeps its first-activation write: the default is to write', () => {
    publishRenderParity(args({ lastSig: emptySig() }));
    expect(status()).toEqual({ status: 'retained_previous_hour', model: 'GFS', layer: 'waves', hour: 0, renderedHour: null, retainedPrevious: true });
  });

  test('writeStatusWhenNoData: true writes it explicitly', () => {
    publishRenderParity(args({ lastSig: emptySig(), writeStatusWhenNoData: true }));
    expect(status().status).toBe('retained_previous_hour');
  });

  test('the option only concerns nothing-drawn: an older hour drawn still writes retained_previous_hour with its hours', () => {
    publishRenderParity(args({ requestedHour: 72, writeStatusWhenNoData: false }));
    expect(status()).toEqual({ status: 'retained_previous_hour', model: 'GFS', layer: 'waves', hour: 72, renderedHour: 0, retainedPrevious: true });
    window.__MARINE_HEATMAP_STATUS__ = undefined;
    republishRenderParityAfterUpload(refs({ timeOffsetHoursRef: { current: 72 }, lastUploadedGridRef: { current: sig() } }));
    expect(status().renderedHour).toBe(0);
  });

  test('an inactive layer with nothing drawn still reads layer_inactive and writes no status', () => {
    republishRenderParityAfterUpload(refs({ activeRef: { current: false } }));
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: null, parity: false, reason: 'layer_inactive' });
    expect(status()).toBeUndefined();
  });

  test.each(['retained_previous_hour', 'no_backend_coverage', 'no_copernicus_coverage'])(
    'a good upload (parity true) still clears a stale %s status', (stale) => {
      window.__MARINE_HEATMAP_STATUS__ = { status: stale };
      republishRenderParityAfterUpload(refs({ lastUploadedGridRef: { current: sig() } }));
      expect(parity().parity).toBe(true);
      expect(status()).toBeNull();
    });

  test.each(['rate_limited_cached', 'response_too_large_prevented'])('a good upload leaves a %s status alone', (other) => {
    const before = { status: other };
    window.__MARINE_HEATMAP_STATUS__ = before;
    republishRenderParityAfterUpload(refs({ lastUploadedGridRef: { current: sig() } }));
    expect(status()).toBe(before);
  });
});
