/**
 * The infobox badge shows the BACKEND's verdict (A15-05(b), 2026-09-26).
 *
 * MapForecastOverlay graded the badge in the browser with surfRating.js computeSurfRating, on the
 * Open-Meteo wind and without break depth, so it could disagree with the glyph beside it. It now
 * reads /api/weather/point-rating through usePointRating, with no browser-side fallback.
 */
import { renderHook, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import {
  POINT_RATING_URL, pointRatingKey, fetchPointRating, mapPointRatingResponse,
} from './pointRatingClient';
import { usePointRating, clearPointRatingCache } from './usePointRating';

jest.mock('./backendWeatherServiceClient', () => ({
  getSharedValidTime: (offset) => `2026-09-26T${String(18 + Number(offset || 0)).padStart(2, '0')}:00:00Z`,
}));

const RESPONSE = {
  model: 'GFS', valid_time: '2026-09-26T18:00:00Z', source: 'precomputed',
  served_valid_time: '2026-09-26T18:00:00Z',
  rating: { spot_id: 'pipeline', score: 55.5, level: 'fair', why: '6ft @ 14s', limiter: 'wind_period_blend' },
};

function deferredFetch() {
  const pending = [];
  global.fetch = jest.fn((url) => new Promise((resolve) => { pending.push({ url, resolve }); }));
  return {
    pending,
    answer: async (i, body, status = 200) => {
      await act(async () => { pending[i].resolve({ ok: status < 300, status, json: async () => body }); });
    },
  };
}

beforeEach(() => clearPointRatingCache());
afterEach(() => { delete global.fetch; });

describe('pointRatingClient', () => {
  it('keys one coordinate + model + hour at the backend rounding', () => {
    expect(pointRatingKey({ lat: 21.66501, lng: -158.05329, model: 'gfs', validTime: 'T' }))
      .toBe('GFS|T|21.6650|-158.0533');
    expect(pointRatingKey({ lat: 21.6, lng: -158, model: 'GFS', validTime: null })).toBeNull();
    expect(pointRatingKey({ lat: null, lng: -158, model: 'GFS', validTime: 'T' })).toBeNull();
  });

  it('asks the point-rating endpoint and throws on 503', async () => {
    const f = deferredFetch();
    const p = fetchPointRating({ lat: 21.66501, lng: -158.05329, model: 'euro', validTime: '2026-09-26T18:00:00Z' });
    expect(f.pending[0].url).toBe(
      `${POINT_RATING_URL}?lat=21.6650&lng=-158.0533&valid_time=2026-09-26T18%3A00%3A00Z&model=EURO`);
    f.pending[0].resolve({ ok: false, status: 503, json: async () => ({}) });
    await expect(p).rejects.toThrow('point-rating 503');
  });

  it('maps a verdict and refuses to invent one', () => {
    expect(mapPointRatingResponse(RESPONSE)).toEqual({
      score: 55.5, level: 'fair', source: 'precomputed', servedValidTime: '2026-09-26T18:00:00Z',
      why: '6ft @ 14s', limiter: 'wind_period_blend',
    });
    expect(mapPointRatingResponse({ ...RESPONSE, rating: null })).toBeNull();
    expect(mapPointRatingResponse({ ...RESPONSE, rating: { score: null, level: 'unknown' } })).toBeNull();
  });
});

describe('usePointRating', () => {
  const at = (timeOffsetHours, enabled = true) => ({
    enabled, lat: 21.665, lng: -158.0533, model: 'GFS', timeOffsetHours,
  });

  it('asks nothing while disabled', () => {
    global.fetch = jest.fn();
    const { result } = renderHook(() => usePointRating(at(0, false)));
    expect(result.current).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows the backend verdict, and never the previous hour\'s', async () => {
    const f = deferredFetch();
    const { result, rerender } = renderHook((props) => usePointRating(props), { initialProps: at(0) });
    expect(result.current).toBeNull();                       // pending: no card, no guess
    await f.answer(0, RESPONSE);
    expect(result.current).toMatchObject({ score: 55.5, level: 'fair' });
    rerender(at(1));                                         // a new hour
    expect(result.current).toBeNull();
    expect(f.pending[1].url).toContain('valid_time=2026-09-26T19%3A00%3A00Z');
    await f.answer(1, { ...RESPONSE, rating: { ...RESPONSE.rating, score: 72, level: 'good' } });
    expect(result.current).toMatchObject({ score: 72, level: 'good' });
    rerender(at(0));                                         // scrubbing back is instant
    expect(result.current).toMatchObject({ score: 55.5, level: 'fair' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('shows nothing on a failure and asks again next time', async () => {
    const f = deferredFetch();
    const first = renderHook(() => usePointRating(at(0)));
    await f.answer(0, {}, 503);
    expect(first.result.current).toBeNull();
    first.unmount();
    renderHook(() => usePointRating(at(0)));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('MapForecastOverlay grades nothing in the browser', () => {
  it('reads the badge from usePointRating and no longer calls computeSurfRating', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MapForecastOverlay.js'), 'utf8');
    expect(src).toMatch(/const surfRating = usePointRating\(/);
    expect(src).not.toMatch(/computeSurfRating\s*\(/);
  });
});
