/**
 * F-07 / T-01 (audit 14.1): the timeline readout must name the forecast instant actually displayed,
 * not browser-time + offset. Live repro 2026-09-23 03:31Z, wheel +1: readout "4 AM", anchor 05:00,
 * drawn 06:00.
 */
// Plain functions, NOT jest.fn: CRA's resetMocks strips jest.fn implementations between tests.
const state = { anchorMs: 0, selected: null, throws: false };
jest.mock('./backendWeatherServiceClient', () => ({
  getSeriesAnchorMs: () => state.anchorMs,
  getSharedValidTime: (h, layer, model, opts) => {
    if (state.throws) throw new Error('manifest boom');
    state.lastOpts = opts;
    return state.selected ? state.selected(h) : new Date(state.anchorMs + h * 3600000).toISOString();
  },
}));

import { displayedForecastTime, forecastReadout } from './forecastReadout';

const H = 3600000;
const A04 = Date.UTC(2026, 8, 23, 4, 0, 0);          // anchor 04:00Z (Wed)
const grid3 = (h) => new Date(Math.round((A04 + h * H) / (3 * H)) * 3 * H).toISOString();   // 3-hourly manifest

beforeEach(() => { state.anchorMs = A04; state.selected = null; state.throws = false; state.lastOpts = null; });

describe('forecastReadout — names the displayed instant (F-07)', () => {
  it('marine layer on a 3-hourly field: +1 h reads the 06:00 frame that is drawn, and says it snapped', () => {
    state.selected = grid3;
    const t = displayedForecastTime(1, 'waves', 'GFS');
    expect(new Date(t.ms).toISOString()).toBe('2026-09-23T06:00:00.000Z');
    expect(t.snapped).toBe(true);
    const r = forecastReadout(1, 'waves', 'GFS', { timeZone: 'UTC' });
    expect(r.text).toBe('Wed 6 AM');
    expect(r.srText).toBe('Showing the forecast for Wed 6 AM, the nearest model time step to Wed 5 AM.');
  });

  it('never asks the manifest to refresh (readOnly) — it runs on every scrubber render', () => {
    forecastReadout(2, 'swell_1', 'ICON', { timeZone: 'UTC' });
    expect(state.lastOpts).toEqual({ readOnly: true });
  });

  it('an exact frame is not reported as snapped', () => {
    state.selected = grid3;
    const r = forecastReadout(2, 'waves', 'GFS', { timeZone: 'UTC' });   // 06:00 exactly
    expect(r.text).toBe('Wed 6 AM');
    expect(r.srText).toBe('Showing the forecast for Wed 6 AM.');
  });

  it('non-manifest layers read the forecast ANCHOR + offset, not browser time', () => {
    state.selected = () => { throw new Error('must not be consulted'); };
    const t = displayedForecastTime(3, 'precipitation', 'GFS');
    expect(t.ms).toBe(A04 + 3 * H);
    expect(t.snapped).toBe(false);
  });

  it('hour 0 keeps the "Live" copy but still discloses the displayed step to screen readers', () => {
    state.selected = grid3;                                     // 04:00 anchor -> 03:00 frame
    const r = forecastReadout(0, 'waves', 'GFS', { timeZone: 'UTC' });
    expect(r.text).toBe('Live');
    expect(r.srText).toBe('Showing the forecast for Wed 3 AM, the nearest model time step to Wed 4 AM.');
  });

  it('a manifest failure degrades to the requested instant instead of throwing', () => {
    state.throws = true;
    expect(() => forecastReadout(4, 'waves', 'GFS')).not.toThrow();
    expect(displayedForecastTime(4, 'waves', 'GFS').ms).toBe(A04 + 4 * H);
  });
});

// Wiring (repo convention for MapWeatherControls: source-shape tests — the component is not rendered
// in unit tests). The ONE renderTimeline block serves all three layouts, so one wiring covers them.
describe('MapWeatherControls wires the readout through forecastReadout', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'MapWeatherControls.js'), 'utf8');

  it('the forecast readout is the displayed instant, not browser time + offset', () => {
    expect(src).toMatch(/forecastReadout\(sliderVal, activeLayer, activeModel\)\.text/);
    expect(src).not.toMatch(/d\.setHours\(d\.getHours\(\) \+ sliderVal\)/);
  });

  it('the snap is disclosed in words for screen readers', () => {
    expect(src).toMatch(/className="sr-only">\{forecastReadout\(sliderVal, activeLayer, activeModel\)\.srText\}/);
  });

  it('there is still exactly one timeline block, rendered by every layout', () => {
    expect((src.match(/const renderTimeline = /g) || []).length).toBe(1);
    expect((src.match(/renderTimeline\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
