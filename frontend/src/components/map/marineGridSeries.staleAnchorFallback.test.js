/**
 * Bug hunt 2026-11-22 (PLAUSIBLE, reproduced here): the containment fallback in getMarineSeriesFrame scanned EVERY
 * warm cache entry without checking the anchor its hour offsets are measured from. Pages are keyed by anchor (F-01),
 * but the fallback reads values, not keys, so for up to SERIES_TTL_MS (5 min) after the anchor rolls over at :30 a
 * page warmed under the OLD anchor still answered. Its offsets are one hour shifted, so the nearest-offset snap can
 * land a whole 3-hourly product away: anchor 10Z -> 11Z, wheel "+0" (11Z, nearest product 12Z) was answered with
 * the old page's offset -1 = 09Z. The guard: an entry answers only under the anchor it was fetched with.
 * Kill switch: window.__RAW_DISABLE_SERIES_ANCHOR_GUARD__ = true.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));
// The anchor rule is getSeriesAnchorMs's (nearest hour of __MOCK_DATE_NOW__), restated so the module graph stays small.
jest.mock('./backendWeatherServiceClient', () => {
  const ms = () => Math.round((globalThis.__MOCK_DATE_NOW__ || Date.now()) / 3600000) * 3600000;
  return { getSurfModeFlag: () => false, getSeriesAnchorMs: ms, getSeriesAnchorIso: () => new Date(ms()).toISOString() };
});

import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';

const H = 3600000;
const BOX = { west: -82, south: 26, east: -79, north: 29 };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// A server that answers every requested offset with the product at base_time + offset, its height = that UTC hour.
function server() {
  return jest.fn(async (url) => {
    const u = new URL(url, 'https://fixture.invalid');
    const base = Date.parse(u.searchParams.get('base_time'));
    const hours = (u.searchParams.get('hours') || '').split(',').filter(Boolean).map(Number);
    return { ok: true, status: 200, json: async () => ({ model: 'GFS', layer: 'waves', frames: hours.map((h) => ({
      hour_offset: h, bounds: BOX, cols: 2, rows: 2, source_dataset: 'fixture',
      vectors: [{ lat: 27, lon: -80, height: new Date(base + h * H).getUTCHours(), period: 10 }],
      valid_time: new Date(base + h * H).toISOString().replace('.000Z', 'Z'),
    })) }) };
  });
}

describe('series fallback never answers from a page of another anchor', () => {
  beforeEach(() => {
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    global.fetch = server();
  });
  afterEach(() => {
    _resetMarineSeriesForTest();
    delete global.fetch; delete window.__MARINE_SERIES__; delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete window.__MOCK_DATE_NOW__; delete window.__RAW_DISABLE_SERIES_ANCHOR_GUARD__;
  });

  async function warmAt10ThenRollTo11() {
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 10, 22, 10, 20);   // anchor 10Z
    await ensureMarineSeries('GFS', 'waves', BOX, 0);
    await flush();
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, 2)).not.toBeNull();   // warm under 10Z: +2 = 12Z
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 10, 22, 10, 31);   // anchor 11Z, one minute later (inside the TTL)
  }

  it('after the :30 rollover, every hour it answers is the product nearest the wheel', async () => {
    await warmAt10ThenRollTo11();
    const anchor = Date.UTC(2026, 10, 22, 11);
    for (let h = 0; h <= 9; h++) {
      const f = getMarineSeriesFrame('GFS', 'waves', BOX, h);
      if (f === null) continue;                                   // a miss is honest: the caller fetches
      const off = Math.abs(Date.parse(f.valid_time) - (anchor + h * H)) / H;
      expect(off).toBeLessThanOrEqual(1.5);
    }
  });

  it('the reported case: wheel +0 at 10:31Z is not answered with 09Z', async () => {
    await warmAt10ThenRollTo11();
    const f = getMarineSeriesFrame('GFS', 'waves', BOX, 0);
    expect(f === null ? null : f.valid_time).not.toBe('2026-11-22T09:00:00Z');
  });

  it('a page fetched under the current anchor still answers (no regression)', async () => {
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 10, 22, 10, 31);   // anchor 11Z throughout
    await ensureMarineSeries('GFS', 'waves', BOX, 0);
    await flush();
    const f = getMarineSeriesFrame('GFS', 'waves', { west: -81.5, south: 26.5, east: -80, north: 28 }, 1);
    expect(f && f.valid_time).toBe('2026-11-22T12:00:00Z');       // containment fallback, same anchor
  });

  it('kill switch restores the old scan', async () => {
    window.__RAW_DISABLE_SERIES_ANCHOR_GUARD__ = true;
    await warmAt10ThenRollTo11();
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, 0).valid_time).toBe('2026-11-22T09:00:00Z');
  });
});
