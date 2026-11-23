/**
 * Bug hunt 2026-11-22 item E: the map's "Now" (getSeriesAnchorMs) and the spot hub's "now"
 * (backend spot_hub_composition.current_valid_time) are ONE rule: UTC now rounded to the nearest
 * hour, a half hour rounding up. Both halves read the same fixture; the pytest half is
 * backend/tests/test_hub_now_anchor_parity.py. Change the rule in both places or neither.
 */
import fixture from './fixtures/now-anchor-parity.json';
import { getSeriesAnchorMs } from '../components/map/backendWeatherServiceClient';

describe('map Now anchor = hub now (shared fixture)', () => {
  afterEach(() => { delete window.__MOCK_DATE_NOW__; });

  it.each(fixture.cases.map((c) => [c.now, c.anchor]))('%s -> %s', (now, anchor) => {
    window.__MOCK_DATE_NOW__ = Date.parse(now);
    expect(new Date(getSeriesAnchorMs()).toISOString()).toBe(anchor);
  });
});
