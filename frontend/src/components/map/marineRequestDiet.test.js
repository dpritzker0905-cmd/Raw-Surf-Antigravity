/**
 * marineRequestDiet.test.js — the client request diet (2026-10-20, marineRequestDiet.js): each amplifier is pinned with its kill
 * switch as the control arm, so a test that passes under the kill would prove nothing about the fix.
 */
import { renderHook } from '@testing-library/react';
import {
  MANIFEST_BACKGROUND_REFRESH_MIN_MS, REQUEST_DIET_OPT_IN, REQUEST_DIET_PARTS, keepSwrRetryCount, planManifestFetch, requestDietOn,
} from './marineRequestDiet';
import { _resetProductsManifestFetchForTest, fetchProductsManifest, getSharedValidTime, setCachedManifest } from './backendWeatherServiceClient';
import { _cacheMarineResult, aliasMarineHourByInstant, getPerModelHourCache, isContainedInMarineCache } from './marineControllerCache';
import { engineHoldsExactOf, planExactUpgrade } from './marineExactUpgrade';
import { useMarineRevalidation } from '../../hooks/useMarineRevalidation';

const KILLS = ['__RAW_DISABLE_REQUEST_DIET__', '__RAW_STEP_PAGE__', ...REQUEST_DIET_PARTS.map((p) => `__RAW_DISABLE_${p}__`)];
const clearKills = () => KILLS.forEach((k) => { delete window[k]; });
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const T0 = Date.parse('2026-10-20T12:00:00Z');
const iso = (h) => new Date(T0 + h * 3600000).toISOString();

afterEach(() => {
  clearKills();
  delete window.__MARINE_REQUEST_DIET__;
  delete window.__MOCK_DATE_NOW__;
  delete window.__SURF_MODE__;
  setCachedManifest(null);
  _resetProductsManifestFetchForTest();
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('kill switches', () => {
  test('every part but the opt-in ones is on by default and goes off with its own switch or the umbrella', () => {
    for (const p of REQUEST_DIET_PARTS) expect(requestDietOn(p)).toBe(!REQUEST_DIET_OPT_IN.includes(p));
    expect(REQUEST_DIET_OPT_IN).toEqual(['STEP_PAGE']);          // measured no gain offline: ships off (marineRequestDiet.js)
    window.__RAW_DISABLE_PRODUCTS_SHARE__ = true;
    expect(requestDietOn('PRODUCTS_SHARE')).toBe(false);
    expect(requestDietOn('GRID_INSTANT_KEY')).toBe(true);
    window.__RAW_DISABLE_REQUEST_DIET__ = true;
    for (const p of REQUEST_DIET_PARTS) expect(requestDietOn(p)).toBe(false);
  });

  test('an opt-in part turns on with window.__RAW_<NAME>__, and its kill and the umbrella still win', () => {
    window.__RAW_STEP_PAGE__ = true;
    expect(requestDietOn('STEP_PAGE')).toBe(true);
    window.__RAW_DISABLE_STEP_PAGE__ = true;
    expect(requestDietOn('STEP_PAGE')).toBe(false);
    delete window.__RAW_DISABLE_STEP_PAGE__;
    window.__RAW_DISABLE_REQUEST_DIET__ = true;
    expect(requestDietOn('STEP_PAGE')).toBe(false);
  });
});

describe('PRODUCTS_SHARE: one /products download at a time', () => {
  test('planManifestFetch: share, skip inside the background spacing, else start; the kill restores the old rule', () => {
    const now = 1e9;
    expect(planManifestFetch({ inFlight: true, force: true, background: true, lastBackgroundStartMs: null, nowMs: now })).toBe('share');
    expect(planManifestFetch({ inFlight: false, force: true, background: true, lastBackgroundStartMs: now - 1000, nowMs: now })).toBe('skip');
    expect(planManifestFetch({ inFlight: false, force: true, background: true,
      lastBackgroundStartMs: now - MANIFEST_BACKGROUND_REFRESH_MIN_MS, nowMs: now })).toBe('start');
    expect(planManifestFetch({ inFlight: false, force: false, background: false, lastBackgroundStartMs: now - 1, nowMs: now })).toBe('start');
    window.__RAW_DISABLE_PRODUCTS_SHARE__ = true;
    expect(planManifestFetch({ inFlight: true, force: true, background: true, lastBackgroundStartMs: null, nowMs: now })).toBe('start');
    expect(planManifestFetch({ inFlight: true, force: false, background: false, lastBackgroundStartMs: null, nowMs: now })).toBe('share');
  });

  const productsCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/products')).length;
  const pendingFetch = () => {
    const resolvers = [];
    global.fetch = jest.fn(() => new Promise((res) => resolvers.push(res)));
    return resolvers;
  };

  test('five valid-time lookups before the manifest lands start ONE download (five under the kill)', async () => {
    pendingFetch();
    for (let h = 0; h < 5; h++) getSharedValidTime(h, 'waves', 'GFS');
    expect(productsCalls()).toBe(1);
    expect(window.__MARINE_REQUEST_DIET__.counts.products_shared).toBe(4);

    _resetProductsManifestFetchForTest();
    window.__RAW_DISABLE_PRODUCTS_SHARE__ = true;
    pendingFetch();
    for (let h = 0; h < 5; h++) getSharedValidTime(h, 'waves', 'GFS');
    expect(productsCalls()).toBe(5);
  });

  test('an EMPTY manifest is re-asked for in the background at most once per spacing window; an awaited caller still retries', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ products: [] }) }));
    getSharedValidTime(0, 'waves', 'GFS');                 // first background refresh: starts
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await fetchProductsManifest(true, { background: true }).catch(() => null);
    expect(productsCalls()).toBe(1);
    for (let h = 1; h < 6; h++) getSharedValidTime(h, 'waves', 'GFS');   // the manifest is empty: each would have refetched
    expect(productsCalls()).toBe(1);
    expect(window.__MARINE_REQUEST_DIET__.counts.products_refresh_spaced).toBeGreaterThanOrEqual(5);
    await fetchProductsManifest();                         // a grid fetch's awaited call: not a background refresh, still retries
    expect(productsCalls()).toBe(2);
    const later = Date.now() + MANIFEST_BACKGROUND_REFRESH_MIN_MS + 1;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    getSharedValidTime(7, 'waves', 'GFS');
    expect(productsCalls()).toBe(3);
  });
});

describe('GRID_INSTANT_KEY: one exact /grid per requested instant', () => {
  // 3-hourly products at 12, 15 and 18Z: offsets 2 and 3 both snap to 15Z (getSharedValidTime), offset 1 to 12Z.
  const manifest = { products: [0, 3, 6].map((h) => ({ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: iso(h) })) };
  const vectors = Array.from({ length: 12 }, (_, i) => ({ lat: 20 + i, lng: -80, speed: 1.5, height: 1.5, period: 9, direction: 90 }));
  const exactGrid = (hour, extra = {}) => ({
    hourOffset: hour, tile_id: 'global_mid', region_id: 'global_mid', valid_time: iso(3), served_valid_time: iso(3),
    grid: { vectors, bounds: WORLD, cols: 181, rows: 83, hourOffset: hour, __gridProvider: 'open-meteo', provider: 'open-meteo',
      renderable: true, valid_time: iso(3), served_valid_time: iso(3) },
    ...extra,
  });
  beforeEach(() => {
    window.__MOCK_DATE_NOW__ = T0;
    setCachedManifest(manifest);
    getPerModelHourCache().clear();
  });

  test('the snapped request instant is the premise: offsets 2 and 3 ask for the same valid_time, offset 1 does not', () => {
    expect(getSharedValidTime(2, 'waves', 'GFS', { readOnly: true })).toBe(getSharedValidTime(3, 'waves', 'GFS', { readOnly: true }));
    expect(getSharedValidTime(1, 'waves', 'GFS', { readOnly: true })).not.toBe(getSharedValidTime(3, 'waves', 'GFS', { readOnly: true }));
  });

  test('a cached exact grid for +3h serves +2h, relabelled as a fresh reply would be, without touching the original', () => {
    const data = exactGrid(3);
    _cacheMarineResult('GFS', 3, data, 'waves', false, 'global_coarse');
    expect(isContainedInMarineCache(WORLD, 'GFS', 2, 'waves')).toBe(true);
    const alias = getPerModelHourCache().get('GFS_waves_global_coarse_2');
    expect(alias.data.hourOffset).toBe(2);
    expect(alias.data.grid.hourOffset).toBe(2);
    expect(alias.data.grid.vectors).toBe(vectors);              // same data, no copy
    expect(alias.signature.hourOffset).toBe(2);
    expect(data.hourOffset).toBe(3);                            // the original entry is untouched
    expect(data.grid.hourOffset).toBe(3);
    expect(window.__MARINE_REQUEST_DIET__.counts.grid_instant_alias).toBe(1);
  });

  test('the kill switch restores the hour-keyed miss', () => {
    window.__RAW_DISABLE_GRID_INSTANT_KEY__ = true;
    _cacheMarineResult('GFS', 3, exactGrid(3), 'waves', false, 'global_coarse');
    expect(isContainedInMarineCache(WORLD, 'GFS', 2, 'waves')).toBe(false);
    expect(getPerModelHourCache().has('GFS_waves_global_coarse_2')).toBe(false);
  });

  test('a different instant, a series frame, a stale grid or the client-built ICON swell_2 blend never alias', () => {
    _cacheMarineResult('GFS', 3, exactGrid(3), 'waves', false, 'global_coarse');
    expect(aliasMarineHourByInstant('GFS', 'waves', 'global_coarse', 1)).toBe(false);          // 12Z, not 15Z
    getPerModelHourCache().clear();
    _cacheMarineResult('GFS', 3, exactGrid(3, { __fromSeries: true }), 'waves', false, 'global_coarse');
    expect(aliasMarineHourByInstant('GFS', 'waves', 'global_coarse', 2)).toBe(false);
    getPerModelHourCache().clear();
    const stale = exactGrid(3); stale.grid.stale = true;
    getPerModelHourCache().set('GFS_waves_global_coarse_3', { data: stale, timestamp: Date.now(), model: 'GFS', signature: {} });
    expect(aliasMarineHourByInstant('GFS', 'waves', 'global_coarse', 2)).toBe(false);
    expect(aliasMarineHourByInstant('ICON', 'swell_2', 'global_coarse', 2)).toBe(false);
  });

  test('an empty cache resolves no valid time at all', () => {
    const spy = jest.spyOn(require('./backendWeatherServiceClient'), 'getSharedValidTime');
    expect(aliasMarineHourByInstant('GFS', 'waves', 'global_coarse', 2)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('EXACT_UPGRADE_SKIP: no world /grid for what the engine already draws', () => {
  const thin = { bounds: WORLD, cols: 46, rows: 21, vectors: [1], __decimatedStride: 4, hourOffset: 3, valid_time: iso(3), run_time: iso(-6) };
  const exact = { bounds: WORLD, cols: 181, rows: 83, vectors: [1], valid_time: iso(2), served_valid_time: iso(3), run_time: iso(-6) };
  const ctx = (engineGrid) => ({ marineData: { grid: thin, hourOffset: 3 }, currentHour: 3, scrubbing: false, wideView: true,
    fetchPendingForHour: false, attempts: null, nowMs: Date.now(), disabled: false, engineGrid });

  test('the engine holding the exact frame of the same served instant and run skips the fetch', () => {
    expect(engineHoldsExactOf(exact, thin)).toBe(true);
    expect(planExactUpgrade(ctx(exact))).toEqual({ upgrade: false, reason: 'engine_has_exact' });
  });

  test('anything else keeps the upgrade: another instant, another run, a thin or coarse engine grid, no engine grid, the kill', () => {
    expect(engineHoldsExactOf({ ...exact, served_valid_time: iso(6) }, thin)).toBe(false);
    expect(engineHoldsExactOf({ ...exact, run_time: iso(0) }, thin)).toBe(false);
    expect(engineHoldsExactOf({ ...thin, __decimatedStride: undefined }, thin)).toBe(false);   // the engine's own thin copy
    expect(engineHoldsExactOf({ ...exact, cols: 37 }, thin)).toBe(false);                     // the 10-degree coarse tier
    expect(planExactUpgrade(ctx(null)).upgrade).toBe(true);
    window.__RAW_DISABLE_EXACT_UPGRADE_SKIP__ = true;
    expect(planExactUpgrade(ctx(exact)).upgrade).toBe(true);
  });
});

describe('SWR_RETRY_CAP: a stale backend is re-asked 3 times, not forever', () => {
  const STALE = { stale: true, grid: { stale: true, cols: 5, rows: 5 } };
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  // The fetcher's shape (useMarineDataFetcherCore.updateMarineGrid): reset at the top of the run, commit, scheduleSWRRevalidation.
  function redrivesOver(ms) {
    const { result } = renderHook(() => useMarineRevalidation());
    let redrives = 0;
    const run = (source) => {
      if (source === 'swr_revalidation') redrives++;
      if (!keepSwrRetryCount(source)) result.current.resetRetryCounts();
      result.current.scheduleSWRRevalidation(STALE, run);
    };
    run('moveend');
    jest.advanceTimersByTime(ms);
    return redrives;
  }

  test('only its own re-drive keeps the count', () => {
    expect(keepSwrRetryCount('swr_revalidation')).toBe(true);
    expect(keepSwrRetryCount('moveend')).toBe(false);
    expect(keepSwrRetryCount('timeline_scrub')).toBe(false);
  });

  test('the cap of 3 applies with the fix; under the kill the 1.5 s re-poll never stops', () => {
    expect(redrivesOver(60000)).toBe(3);
    window.__RAW_DISABLE_SWR_RETRY_CAP__ = true;
    expect(redrivesOver(60000)).toBe(40);
  });
});
