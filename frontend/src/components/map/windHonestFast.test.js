// Wind honest + fast (2026-10-19): the wind drawn-frame record, its words, the coverage helper, and the abort rule for the
// shared in-flight wind request. Pins for marineDrawnFrame.publishWindDrawn, WindTimeStatus.windReadout, windCoverage and
// windController's "abort is a rejection".
jest.mock('./backendWindServiceClient', () => ({ fetchBackendWindGrid: jest.fn() }));
// getBackendWindFlag() defaults true (no REACT_APP_USE_BACKEND_WEATHER, no localStorage override).

import { publishWindDrawn, getWindDrawn, clearWindDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';
import { windReadout } from './WindTimeStatus';
import { windGridCovers } from './windCoverage';
import { reconcileStaleBadge } from './drawnFrameReadout';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { fetchBackendWindGrid } from './backendWindServiceClient';
import { fetchWindData, _resetWindCachesForTest } from './windController';

const instantOf = (hour, model = 'GFS') => Date.parse(getSharedValidTime(hour, 'wind', model, { readOnly: true }));
const iso = (ms) => new Date(ms).toISOString();

beforeEach(() => {
  _resetMarineDrawnForTest();
  delete window.__RAW_DISABLE_WIND_DRAWN_READOUT__;
  delete window.__RAW_DISABLE_WIND_ABORT_REJECTS__;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('publishWindDrawn', () => {
  test('a series frame carries its data instant; a bare grid without served_valid_time does not claim one', () => {
    publishWindDrawn({ hourOffset: 6, model: 'ICON', __fromSeries: true, valid_time: '2026-10-19T12:00:00Z' });
    expect(getWindDrawn()).toMatchObject({ layer: 'wind', hour: 6, model: 'ICON', dataMs: Date.parse('2026-10-19T12:00:00Z') });
    expect(window.__WIND_DRAWN__.hour).toBe(6);
    publishWindDrawn({ hourOffset: 7, source: 'GFS', valid_time: '2026-10-19T12:00:00Z' });
    expect(getWindDrawn()).toMatchObject({ hour: 7, model: 'GFS', dataMs: null });
  });
});

test('clearWindDrawn: a cleared wind layer describes nothing', () => {
  publishWindDrawn({ hourOffset: 6, model: 'GFS' });
  clearWindDrawn();
  expect(getWindDrawn()).toBeNull();
  expect(window.__WIND_DRAWN__).toBeNull();
});

describe('windReadout', () => {
  test('silent when the drawn wind frame is the selected instant', () => {
    expect(windReadout({ model: 'GFS', hour: 6 }, { model: 'GFS', layer: 'wind', hour: 6, dataMs: instantOf(6) })).toBeNull();
  });
  test('names the nearest stored frame when the selected hour is off the lattice', () => {
    const r = windReadout({ model: 'ICON', hour: 7 }, { model: 'ICON', layer: 'wind', hour: 6, dataMs: instantOf(6, 'ICON') });
    expect(r.state).toBe('nearest');
    expect(r.text).toMatch(/nearest stored forecast/);
  });
  test('3 h off on the 3-hourly wind lattice is a fetch still owed, not the nearest stored frame', () => {
    expect(windReadout({ model: 'GFS', hour: 3 }, { model: 'GFS', layer: 'wind', hour: 0, dataMs: instantOf(0) }).state).toBe('pending');
    expect(windReadout({ model: 'EURO', hour: 153 }, { model: 'EURO', layer: 'wind', hour: 150, dataMs: instantOf(150, 'EURO') }).state).toBe('nearest');
  });
  test('a far-away drawn hour is pending, in words', () => {
    const r = windReadout({ model: 'GFS', hour: 26 }, { model: 'GFS', layer: 'wind', hour: 0, dataMs: instantOf(0) });
    expect(r.state).toBe('pending');
    expect(r.text).toMatch(/^Loading /);
  });
  test('HRRR drawn under a GFS selection is the wind lane (D-017), not a pending switch', () => {
    expect(windReadout({ model: 'GFS', hour: 3 }, { model: 'HRRR', layer: 'wind', hour: 3, dataMs: instantOf(3) })).toBeNull();
  });
  test('another model drawn is pending', () => {
    const r = windReadout({ model: 'GFS', hour: 3 }, { model: 'ICON', layer: 'wind', hour: 3, dataMs: instantOf(3) });
    expect(r.state).toBe('pending');
    expect(r.text).toMatch(/still showing ICON Wind/);
  });
  test('kill switch silences it', () => {
    window.__RAW_DISABLE_WIND_DRAWN_READOUT__ = true;
    expect(windReadout({ model: 'GFS', hour: 26 }, { model: 'GFS', layer: 'wind', hour: 0, dataMs: instantOf(0) })).toBeNull();
  });
  test('the point card stale badge stays marine-only', () => {
    expect(reconcileStaleBadge('x', { model: 'GFS', layer: 'wind', hour: 26 }, { model: 'GFS', layer: 'wind', hour: 0 })).toBe('x');
  });
});

describe('windGridCovers', () => {
  const vp = { west: -10, east: 10, south: -5, north: 5 };
  test('world grids cover everything, regional grids only what they contain', () => {
    expect(windGridCovers({ west: -180, east: 180, south: -80, north: 85 }, vp)).toBe(true);
    expect(windGridCovers({ west: 170, east: 165, south: -80, north: 85 }, vp)).toBe(true);   // antimeridian-wrapped world
    expect(windGridCovers({ west: -20, east: 20, south: -10, north: 10 }, vp)).toBe(true);
    expect(windGridCovers({ west: -5, east: 20, south: -10, north: 10 }, vp)).toBe(false);
    expect(windGridCovers(null, vp)).toBe(false);
  });
});

describe('abort is a rejection for the shared wind request', () => {
  const bounds = { west: -10, east: 10, south: -5, north: 5 };
  const abortErr = () => Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' });
  beforeEach(() => { _resetWindCachesForTest(); fetchBackendWindGrid.mockReset(); });

  test('the aborted owner rejects, and a caller that joined it starts its own attempt instead of taking a safe-zero grid', async () => {
    const good = { renderable: true, vectors: [{ lat: 0, lng: 0, u: 1, v: 1, speed: 1, direction: 0 }], bounds, cols: 1, rows: 1 };
    let rejectFirst;
    fetchBackendWindGrid
      .mockImplementationOnce(() => new Promise((_, rej) => { rejectFirst = rej; }))
      .mockImplementationOnce(() => Promise.resolve(good));
    const ctrl = new AbortController();
    const owner = fetchWindData(bounds, ctrl.signal, 6, true, 3, 'GFS');
    await Promise.resolve();
    const joiner = fetchWindData(bounds, null, 6, false, 3, 'GFS');
    ctrl.abort(); rejectFirst(abortErr());
    await expect(owner).rejects.toMatchObject({ name: 'AbortError' });
    await expect(joiner).resolves.toBe(good);
    expect(fetchBackendWindGrid).toHaveBeenCalledTimes(2);
  });

  test("another caller's abort reaching a live caller (url-level join) gets one fresh attempt, not a rejection or a safe-zero grid", async () => {
    const good = { renderable: true, vectors: [{ lat: 0, lng: 0, u: 1, v: 1, speed: 1, direction: 0 }], bounds, cols: 1, rows: 1 };
    fetchBackendWindGrid.mockImplementationOnce(() => Promise.reject(abortErr())).mockImplementationOnce(() => Promise.resolve(good));
    await expect(fetchWindData(bounds, null, 6, true, 3, 'GFS')).resolves.toBe(good);
    expect(fetchBackendWindGrid).toHaveBeenCalledTimes(2);
  });

  test('kill switch restores the old safe-zero resolution', async () => {
    window.__RAW_DISABLE_WIND_ABORT_REJECTS__ = true;
    fetchBackendWindGrid.mockImplementationOnce(() => Promise.reject(abortErr()));
    const ctrl = new AbortController(); ctrl.abort();
    const r = await fetchWindData(bounds, ctrl.signal, 6, true, 3, 'GFS');
    expect(r.renderable).toBe(false);
  });
});
