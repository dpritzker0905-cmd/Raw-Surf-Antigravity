/**
 * T-01 (audit 14.1, measured live 2026-09-23 on dev b75ed960): with the anchor at 01:00Z the marine
 * series requested offsets 0,3,6 → frames at 01/04/07Z, instants no stored product has. At wheel
 * "+4 hours" (05:00) the map drew 04:00 while the coverage lane selected 06:00 — three clocks on one
 * handle. Series offsets must land on the model's 00/03/06.. UTC grid, the same instants
 * getSharedValidTime picks from the 3-hourly manifest.
 */
import { ensureMarineSeries, _resetMarineSeriesForTest } from './marineGridSeries';
import { alignToCadenceGrid, seriesGridPhase } from './seriesAnchor';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };
const H = 3600000;
const at = (hh, mm = 10) => Date.UTC(2026, 8, 23, hh, mm, 0);

const hoursOf = (url) => (url.match(/[?&]hours=([^&]+)/) || [])[1].split(',').map(Number);
const flush = () => new Promise((r) => setTimeout(r, 0));
const baseOf = (url) => Date.parse(decodeURIComponent((url.match(/[?&]base_time=([^&]+)/) || [])[1]));

describe('marine series offsets sit on the UTC product grid (T-01)', () => {
  beforeEach(() => {
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    global.fetch = jest.fn(() => new Promise(() => {}));   // capture URLs only
  });
  afterEach(() => { delete window.__MOCK_DATE_NOW__; delete window.__MARINE_SERIES__; });

  it.each([
    [1, 1, [-1, 2, 5]],   // anchor 01:00 → 00, 03, 06 Z   (the live repro)
    [2, 2, [-2, 1, 4]],   // anchor 02:00 → 00, 03, 06 Z
    [3, 0, [0, 3, 6]],    // anchor 03:00 → unchanged historic lattice
  ])('anchor hour %i → phase %i → page opens %j', async (hour, phase, head) => {
    window.__MOCK_DATE_NOW__ = at(hour);
    expect(seriesGridPhase(3)).toBe(phase);
    ensureMarineSeries('GFS', 'waves', bounds, 0);   // fetch never settles: capture URLs only
    await flush();
    const urls = global.fetch.mock.calls.map((c) => c[0]);
    const page = urls.map(hoursOf).find((hs) => hs.length > 1);
    expect(page.slice(0, 3)).toEqual(head);
    // Every requested frame is a real 3-hourly UTC instant.
    for (const u of urls) {
      const base = baseOf(u);
      for (const h of hoursOf(u)) expect(((base + h * H) / H) % 3).toBe(0);
    }
  });

  it('the hour-0 mini request asks for the product nearest the wheel, not anchor+3k', async () => {
    window.__MOCK_DATE_NOW__ = at(1);                     // anchor 01:00
    ensureMarineSeries('GFS', 'waves', bounds, 4);  // wheel "+4 hours" = 05:00
    await flush();
    const mini = global.fetch.mock.calls.map((c) => c[0]).map(hoursOf).find((hs) => hs.length === 1);
    expect(mini).toEqual([5]);                            // 06:00 — what the coverage lane selects
  });

  it('alignment is the nearest grid instant for every wheel hour, with no ties', () => {
    for (const phase of [0, 1, 2]) {
      for (let h = 0; h <= 48; h += 1) {
        const a = alignToCadenceGrid(h, 3, phase);
        expect((((a + phase) % 3) + 3) % 3).toBe(0);
        expect(Math.abs(a - h)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('an unresolvable anchor degrades to the historic lattice instead of throwing', () => {
    window.__MOCK_DATE_NOW__ = 'not-a-time';
    expect(() => seriesGridPhase(3)).not.toThrow();
    expect(seriesGridPhase(3)).toBe(0);
  });
});
