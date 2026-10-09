/**
 * The wind lane in the client (windLane.js, WindLaneStatus.js; backend wind_lane.py, D-017).
 *
 * The backend draws HRRR near the US to its ~48 h horizon and GFS elsewhere and after, and stamps each GFS wind grid
 * with `wind_lane`. These pin the client half:
 *   - the stamp survives both wind mappers (one /grid, one /grid_series frame), or the label could never see it;
 *   - the model change at the horizon is LABELLED in words in the controls (never colour alone), in all three themes;
 *   - the kill switch sends wind_lane=gfs on both request kinds and keeps their cache entries apart.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describeWindLane, windLaneParam, windLaneTag, windLaneOnScreen, windLaneDisabled } from './windLane';
import WindLaneStatus from './WindLaneStatus';
import { mapNormalizedWindGridToWebGL } from './backendWindServiceClient';

const LANE = {
  lane: 'hrrr+gfs', hrrr_cycle: '2026-10-09T12:00:00Z', hrrr_horizon: '2026-10-11T12:00:00Z', time_weight: 1,
  hrrr_cells: 1200, feather_km: 200, taper_hours: 3,
};

afterEach(() => {
  delete window.__RAW_DISABLE_WIND_HRRR_LANE__;
  delete window.__WIND_ENGINE__;
});

describe('describeWindLane', () => {
  it('says HRRR + GFS inside the horizon, with the horizon in words', () => {
    const d = describeWindLane(LANE, { timeZone: 'UTC' });
    expect(d.short).toBe('Wind: HRRR + GFS');
    expect(d.text).toMatch(/HRRR, NOAA's 3 km model, near the US until Sun.*12 PM.*GFS elsewhere/);
  });
  it('names the hand-off during the taper', () => {
    expect(describeWindLane({ ...LANE, time_weight: 0.5 }).short).toBe('Wind: HRRR → GFS');
  });
  it('says GFS, and why, past the horizon', () => {
    const d = describeWindLane({ lane: 'gfs', reason: 'beyond_hrrr_horizon', hrrr_horizon: LANE.hrrr_horizon });
    expect(d.short).toBe('Wind: GFS (HRRR ended)');
    expect(d.text).toMatch(/past HRRR's last forecast hour/);
  });
  it('says GFS outside the US', () => {
    expect(describeWindLane({ lane: 'gfs', reason: 'outside_hrrr_domain' }).text).toMatch(/United States only/);
  });
  it('adds nothing when there is no stamp (lane off, or not GFS wind)', () => {
    expect(describeWindLane(null)).toBeNull();
    expect(describeWindLane(undefined)).toBeNull();
  });
});

describe('the stamp reaches the engine', () => {
  it('survives the /grid mapper', () => {
    const json = { model: 'GFS', wind_lane: LANE, grid: { bounds: { west: -92, south: 25, east: -79, north: 32 }, cols: 1, rows: 1,
      vectors: [{ lat: 27.75, lng: -87.5, speed: 30, direction: 90, u: -30, v: 0 }] } };
    expect(mapNormalizedWindGridToWebGL(json, json.grid.bounds, 0).wind_lane).toEqual(LANE);
  });
  it('survives the /grid_series frame mapper', async () => {
    jest.resetModules();
    window.__WIND_SERIES__ = true;
    const bounds = { west: -81.2, south: 27.5, east: -79.7, north: 28.2 };
    const frame = { hour_offset: 0, valid_time: '2026-10-09T15:00:00Z', cols: 1, rows: 1, bounds,
      vectors: [{ lat: 27.75, lng: -80.5, speed: 30, direction: 90, u: -30, v: 0 }], wind_lane: LANE };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ model: 'GFS', frames: [frame], bounds, cols: 1, rows: 1 }) }));
    const mod = require('./windGridSeries');
    await mod.ensureWindSeries('GFS', bounds, 0);
    const got = mod.getWindSeriesFrame('GFS', bounds, 0);
    expect(got && got.wind_lane).toEqual(LANE);
    delete window.__WIND_SERIES__;
    jest.resetModules();
  });
  it('is read from the fine overlay first, then the base', () => {
    window.__WIND_ENGINE__ = { _windData: { windGrid: { wind_lane: { lane: 'gfs' } } }, _windFine: { windGrid: { wind_lane: LANE } } };
    expect(windLaneOnScreen()).toBe(LANE);
    window.__WIND_ENGINE__ = { _windData: { windGrid: { wind_lane: { lane: 'gfs', reason: 'x' } } }, _windFine: null };
    expect(windLaneOnScreen().lane).toBe('gfs');
  });
});

describe('the kill switch', () => {
  it('is off by default and adds nothing', () => {
    expect(windLaneDisabled()).toBe(false);
    expect(windLaneParam()).toBe('');
    expect(windLaneTag()).toBe('');
  });
  it('asks for the GFS-only map and keeps a separate cache key', () => {
    window.__RAW_DISABLE_WIND_HRRR_LANE__ = true;
    expect(windLaneParam()).toBe('&wind_lane=gfs');
    expect(windLaneTag()).toBe('_gfslane');
  });
  it('reaches the wind series request', async () => {
    jest.resetModules();
    window.__RAW_DISABLE_WIND_HRRR_LANE__ = true;
    window.__WIND_SERIES__ = true;
    const fetchSpy = jest.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ model: 'GFS', frames: [] }) }));
    global.fetch = fetchSpy;
    const mod = require('./windGridSeries');
    await mod.ensureWindSeries('GFS', { west: -81.2, south: 27.5, east: -79.7, north: 28.2 }, 0);
    const urls = fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/weather/grid_series'));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.includes('&wind_lane=gfs'))).toBe(true);
    delete window.__WIND_SERIES__;
    jest.resetModules();
  });
});

describe('WindLaneStatus', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(['dark', 'light', 'beach'])('labels the drawn model in words (%s)', (theme) => {
    window.__WIND_ENGINE__ = { _windFine: { windGrid: { wind_lane: LANE } } };
    render(<WindLaneStatus theme={theme} active />);
    const el = screen.getByRole('status');
    expect(el.textContent).toContain('Wind: HRRR + GFS');
    expect(el.querySelector('.sr-only').textContent).toMatch(/NOAA's 3 km model/);
  });
  it('follows the engine when the hour crosses the horizon', () => {
    window.__WIND_ENGINE__ = { _windFine: { windGrid: { wind_lane: LANE } } };
    render(<WindLaneStatus theme="dark" active />);
    expect(screen.getByRole('status').textContent).toContain('HRRR + GFS');
    window.__WIND_ENGINE__ = { _windFine: { windGrid: { wind_lane: { lane: 'gfs', reason: 'beyond_hrrr_horizon',
      hrrr_horizon: LANE.hrrr_horizon } } } };
    act(() => { jest.advanceTimersByTime(600); });
    expect(screen.getByRole('status').textContent).toContain('GFS (HRRR ended)');
  });
  it('renders nothing when the wind layer is off or there is no stamp', () => {
    window.__WIND_ENGINE__ = { _windFine: { windGrid: { wind_lane: LANE } } };
    const { container, rerender } = render(<WindLaneStatus theme="dark" active={false} />);
    expect(container.textContent).toBe('');
    window.__WIND_ENGINE__ = { _windData: { windGrid: {} } };
    rerender(<WindLaneStatus theme="dark" active />);
    expect(container.textContent).toBe('');
  });
});
