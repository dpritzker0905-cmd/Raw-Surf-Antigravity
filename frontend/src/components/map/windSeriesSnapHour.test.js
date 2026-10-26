// windSeriesSnapHour (2026-10-25, hourly GFS wind f000-f120 behind FRAME_WIND_GFS_HOURLY): the wind series page asks the
// hour of the nearest STORED product (the manifest), not a fixed 3 h snap, so an hourly manifest is asked hour by hour and a
// 3-hourly manifest asks exactly what it asked before. Kill: window.__RAW_DISABLE_WIND_SERIES_MANIFEST_SNAP__ = true.
jest.mock('./backendWeatherServiceClient', () => ({
  getSharedValidTime: jest.fn(),
  getSeriesAnchorMs: jest.fn(),
  getSurfModeFlag: () => false,
}));

const client = require('./backendWeatherServiceClient');
const { windSeriesSnapHour } = require('./windGridSeries');

const ANCHOR = Date.UTC(2026, 9, 25, 0, 0, 0);
const iso = (h) => new Date(ANCHOR + h * 3600000).toISOString();

// The manifest's nearest stored hour for a selection, for a set of stored hours.
const manifest = (stored) => (hourOffset) => {
  let best = stored[0];
  for (const s of stored) if (Math.abs(s - hourOffset) < Math.abs(best - hourOffset)) best = s;
  return iso(best);
};

describe('windSeriesSnapHour', () => {
  beforeEach(() => {
    client.getSeriesAnchorMs.mockReturnValue(ANCHOR);
    delete window.__RAW_DISABLE_WIND_SERIES_MANIFEST_SNAP__;
  });
  afterAll(() => { delete window.__RAW_DISABLE_WIND_SERIES_MANIFEST_SNAP__; });

  test('a 3-hourly manifest asks the same hour as the fixed 3 h snap (no change today)', () => {
    const stored = Array.from({ length: 113 }, (_, i) => i * 3);
    client.getSharedValidTime.mockImplementation(manifest(stored));
    for (let h = 0; h <= 200; h++) {
      expect(windSeriesSnapHour('GFS', h)).toBe(Math.round(h / 3) * 3);
    }
  });

  test('an hourly manifest (f000-f120) asks the exact hour, 3-hourly beyond', () => {
    const stored = [...Array.from({ length: 121 }, (_, i) => i), ...Array.from({ length: 72 }, (_, i) => 123 + i * 3)];
    client.getSharedValidTime.mockImplementation(manifest(stored));
    expect(windSeriesSnapHour('GFS', 1)).toBe(1);
    expect(windSeriesSnapHour('GFS', 77)).toBe(77);
    expect(windSeriesSnapHour('GFS', 120)).toBe(120);
    expect(windSeriesSnapHour('GFS', 124)).toBe(123);
    expect(windSeriesSnapHour('GFS', 125)).toBe(126);
  });

  test('the kill switch restores the fixed 3 h snap', () => {
    client.getSharedValidTime.mockImplementation(manifest(Array.from({ length: 121 }, (_, i) => i)));
    window.__RAW_DISABLE_WIND_SERIES_MANIFEST_SNAP__ = true;
    expect(windSeriesSnapHour('GFS', 77)).toBe(78);
    expect(windSeriesSnapHour('GFS', 1)).toBe(0);
  });

  test('no manifest answer, or one farther than 3 h from the selection, falls back to the fixed snap', () => {
    client.getSharedValidTime.mockImplementation(() => { throw new Error('no manifest'); });
    expect(windSeriesSnapHour('GFS', 77)).toBe(78);
    client.getSharedValidTime.mockImplementation(() => iso(90));
    expect(windSeriesSnapHour('GFS', 77)).toBe(78);
    client.getSharedValidTime.mockImplementation(() => 'not a time');
    expect(windSeriesSnapHour('GFS', 4)).toBe(3);
  });
});
