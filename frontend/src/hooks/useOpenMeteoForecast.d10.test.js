/**
 * D10 (the lead's offline erratic fuzzer, 2026-10-27): with a point selected, scrubbing a NON-marine layer sent 1-3 /point asks
 * per wheel hour with no settle (~70 x 3 in 2 s), logged an error per superseded step, and paired the user's location with the
 * VIEW's grid_bbox (a Hawaii box with a Mexico point). Replayed against the real hook with fetch stubbed; kill switches print the
 * live readings.
 */
import { renderHook, act } from '@testing-library/react';
import { useOpenMeteoForecast, FORECAST_HOUR_SETTLE_MS } from './useOpenMeteoForecast';
import { bboxContains } from '../components/map/pointProductHint';

const H = 3600000;
let asks;
let errors;
function stub({ delayMs = 0 } = {}) {
  asks = [];
  global.fetch = jest.fn((url, opts = {}) => {
    if (!/\/point\?/.test(String(url))) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    asks.push(Object.fromEntries(new URL(url, 'http://x').searchParams));
    return new Promise((resolve, reject) => {
      const done = () => resolve({ ok: true, status: 200, json: async () => ({ model: 'GFS', point: { speed: 5, direction: 90 } }) });
      if (!delayMs) return done();
      const t = setTimeout(done, delayMs);
      if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
  });
}
/** The fuzzer's scrub: 70 wheel hours, one every `gapMs`, with a pin selected on a non-marine layer. */
async function scrub({ lat, lng, gapMs = 60, steps = 70, layer = 'temperature' }) {
  const { rerender } = renderHook((p) => useOpenMeteoForecast(p),
    { initialProps: { latitude: lat, longitude: lng, isExplicit: true, timeOffsetHours: 0, activeLayer: layer } });
  await act(async () => { jest.advanceTimersByTime(100); });   // the first ask
  const first = asks.length;
  for (let h = 1; h <= steps; h++) {
    rerender({ latitude: lat, longitude: lng, isExplicit: true, timeOffsetHours: h, activeLayer: layer });
    await act(async () => { jest.advanceTimersByTime(gapMs); });
  }
  await act(async () => { jest.advanceTimersByTime(3000); });
  return { duringScrub: asks.length - first, hours: [...new Set(asks.slice(first).map((a) => a.valid_time))] };
}

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(Date.parse('2026-10-28T12:00:00Z'));
  window.__MAP_BOOTSTRAPPED__ = true;
  errors = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  errors.mockRestore();
  delete global.fetch;
  delete window.map;
  delete window.__MAP_BOOTSTRAPPED__;
  delete window.__RAW_DISABLE_FORECAST_POINT_SETTLE__;
  delete window.__RAW_DISABLE_POINT_BBOX_CONTAINS__;
});

test('the settle is longer than the 50 ms switch debounce it replaces for hour steps', () => {
  expect(FORECAST_HOUR_SETTLE_MS).toBeGreaterThan(50);
});

test('a 70-hour scrub asks once, for the hour the wheel stopped on (kill switch: 3 asks per step, the live reading)', async () => {
  stub();
  const fixed = await scrub({ lat: 19.4, lng: -99.1 });
  expect(fixed.duringScrub).toBe(3);                                       // wind, pressure, rain for the last hour only
  expect(fixed.hours).toEqual([new Date(Date.parse('2026-10-28T12:00:00Z') + 70 * H).toISOString()]);
  window.__RAW_DISABLE_FORECAST_POINT_SETTLE__ = true;
  stub();
  const live = await scrub({ lat: 19.5, lng: -99.1 });
  expect(live.duringScrub).toBe(70 * 3);
});

test('a superseded step is not logged as an error', async () => {
  window.__RAW_DISABLE_FORECAST_POINT_SETTLE__ = true;                     // force every step to ask, each aborting the last
  stub({ delayMs: 200 });
  await scrub({ lat: 19.6, lng: -99.1, steps: 10 });
  const failed = errors.mock.calls.filter((c) => /Backend point API fetch failed/.test(String(c[1] && c[1].message)));
  expect(failed).toEqual([]);
});

test('the view\'s box goes only with a point inside it (a Hawaii view, a Mexico point)', async () => {
  const view = (w, s, e, n) => ({ getBounds: () => ({ getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n }) });
  stub();
  window.map = view(-161, 18, -154, 23);                                   // Hawaii
  renderHook(() => useOpenMeteoForecast({ latitude: 19.43, longitude: -99.13, isExplicit: true, activeLayer: 'wind' }));
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(asks[0].grid_bbox).toBeUndefined();
  window.map = view(-105, 15, -95, 25);                                    // a view holding Mexico City
  renderHook(() => useOpenMeteoForecast({ latitude: 19.44, longitude: -99.13, isExplicit: true, activeLayer: 'wind' }));
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(asks[1].grid_bbox).toBe('-105.0000,15.0000,-95.0000,25.0000');
  window.__RAW_DISABLE_POINT_BBOX_CONTAINS__ = true;
  window.map = view(-161, 18, -154, 23);
  renderHook(() => useOpenMeteoForecast({ latitude: 19.45, longitude: -99.13, isExplicit: true, activeLayer: 'wind' }));
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(asks[2].grid_bbox).toBe('-161.0000,18.0000,-154.0000,23.0000');   // the live pairing
});

test('bboxContains: plain boxes, the antimeridian, and nonsense', () => {
  expect(bboxContains('-105,15,-95,25', 19.4, -99.1)).toBe(true);
  expect(bboxContains('-161,18,-154,23', 19.4, -99.1)).toBe(false);
  expect(bboxContains('170,-30,-170,-10', -20, 179)).toBe(true);           // crosses 180
  expect(bboxContains('170,-30,-170,-10', -20, 0)).toBe(false);
  expect(bboxContains('-180,-90,180,90', 0, 0)).toBe(true);
  expect(bboxContains('nope', 0, 0)).toBe(false);
});
