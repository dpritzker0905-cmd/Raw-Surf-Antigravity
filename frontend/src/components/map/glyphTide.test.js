/**
 * ONE TIDE PER GLYPH (SOTA-GAP inspection 2026-11-23, finding 9; glyphTide.js). DARK: REACT_APP_GLYPH_TIDE_OWN=true.
 * With the flag, a rated spot glyph's tide (its accessible name and hover card) is the Tide overlay marker's under it: the same
 * /point-tide payload, tideAt, height format and SCRUBBED instant. It never fetches Open-Meteo and never shows the baked
 * rating.tide. Off (the default build), the old line reads as before.
 */
import React from 'react';
jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });
import { render, screen, fireEvent, act } from '@testing-library/react';
import MapMarkerLayers, { sameMarkerProps } from './MapMarkerLayers';
import { clearPointTideCache, loadPointTide } from './usePointTide';
import { tideCellKey } from './tideClient';
import { tideMarkerModel } from './tideOverlayModel';
import { forecastSelectionMs } from './forecastReadout';
import { glyphTideLine, glyphTideOwnEnabled } from './glyphTide';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const series = Array.from({ length: 49 }, (_, i) => ({
  t: new Date(NOW + (i - 6) * 3600e3).toISOString().replace('.000Z', 'Z'),
  h: Math.round(Math.sin(((i - 6) / 12.42) * 2 * Math.PI) * 800) / 1000,
}));
const payload = {
  available: true, now: '2026-11-23T12:00:00Z', series, events: [], timezone: 'UTC', datum: 'MSL', source: 'model-msl', cell_km: 11,
  coverage: [{ start: series[0].t, end: series[series.length - 1].t }],
};
const LAT = 27.86; const LNG = -80.45;
// The BAKED tide (rating frame's time, nearest sample): deliberately unlike the payload, so a leak of it is visible.
const RATING = { score: 55, level: 'fair', color: '#eab308', label: 'Fair', surfHeightM: 1.0, periodS: 12, tide: { height_m: 2.5, trend: 'rising' } };
const SPOT = { id: 's1', latitude: LAT, longitude: LNG, name: 'Sebastian Inlet', isCluster: false, is_within_geofence: true,
  active_photographers_count: 0, spot: { id: 's1', name: 'Sebastian Inlet' } };
const props = (hour, over = {}) => ({
  spotClusters: [SPOT], livePhotographers: [], effectiveLocation: null, activeDispatch: null, friendsOnMap: [], filter: 'all',
  pulsingMarkers: new Set(), onSpotClick: jest.fn(), onPhotographerClick: jest.fn(), mapRef: { current: { flyTo: jest.fn() } },
  surfMode: true, spotRatings: { s1: RATING }, clusterRatings: null, timeOffsetHours: hour, ...over,
});
const glyph = () => screen.getByRole('button', { name: /Sebastian Inlet/ });

let fetchMock;
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  jest.setSystemTime(NOW);
  clearPointTideCache();
  window.localStorage.clear();
  delete window.__RAW_DISABLE_GLYPH_TIDE_OWN__;
  delete process.env.REACT_APP_GLYPH_TIDE_OWN;
  fetchMock = jest.fn((u) => Promise.resolve(String(u).includes('/point-tide')
    ? { ok: true, json: () => Promise.resolve(payload) }
    : { ok: true, json: () => Promise.resolve({ hourly: { time: [], sea_level_height_msl: [] } }) }));
  global.fetch = fetchMock;
});
afterEach(() => { jest.useRealTimers(); delete process.env.REACT_APP_GLYPH_TIDE_OWN; });
const openMeteoCalls = () => fetchMock.mock.calls.filter(([u]) => /open-meteo/.test(String(u))).length;

describe('flag on: the glyph reads the marker', () => {
  beforeEach(() => { process.env.REACT_APP_GLYPH_TIDE_OWN = 'true'; });

  it.each([0, 3, 7, 18, 30])('hour %i: the glyph tide == the overlay marker at the scrubbed instant, never the baked tide', async (hour) => {
    await act(async () => { await loadPointTide(tideCellKey(LAT, LNG)); });
    render(<MapMarkerLayers {...props(hour)} />);
    const marker = tideMarkerModel(payload, forecastSelectionMs(hour), 'ft', 'Sebastian Inlet');
    expect(marker.available).toBe(true);
    const line = glyphTideLine(marker);
    expect(line).toBe(`${marker.heightText} ${marker.trendWord.toLowerCase()}`);
    expect(glyph().getAttribute('aria-label')).toContain(`tide ${line}`);
    expect(glyph().getAttribute('aria-label')).not.toMatch(/8\.2 ft/);   // the baked 2.5 m
    fireEvent.focus(glyph());
    expect(screen.getByText(`Tide ${line}`, { exact: false })).toBeTruthy();
  });

  it('two hours give two tides (the line follows the wheel, not the wall clock)', async () => {
    await act(async () => { await loadPointTide(tideCellKey(LAT, LNG)); });
    const { rerender } = render(<MapMarkerLayers {...props(0)} />);
    const a = glyph().getAttribute('aria-label');
    rerender(<MapMarkerLayers {...props(4)} />);
    expect(glyph().getAttribute('aria-label')).not.toBe(a);
    expect(glyph().getAttribute('aria-label')).toContain(glyphTideLine(tideMarkerModel(payload, forecastSelectionMs(4), 'ft', 'x')));
  });

  it('hover asks /point-tide through the shared loader, never Open-Meteo; past coverage there is no tide line', async () => {
    render(<MapMarkerLayers {...props(60)} />);   // the series ends at +42 h
    await act(async () => { fireEvent.mouseEnter(glyph()); await Promise.resolve(); await Promise.resolve(); });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/point-tide'))).toBe(true);
    expect(openMeteoCalls()).toBe(0);
    expect(glyph().getAttribute('aria-label')).not.toMatch(/tide/);
  });

  it('the kill switch (runtime, can only disable) brings the old line back', async () => {
    window.__RAW_DISABLE_GLYPH_TIDE_OWN__ = true;
    expect(glyphTideOwnEnabled()).toBe(false);
    render(<MapMarkerLayers {...props(3)} />);
    // the baked rating.tide, as before; #1149's formatTideLine names the datum ("above local MSL" off-US)
    expect(glyph().getAttribute('aria-label')).toMatch(/tide 8\.2 ft above local MSL rising/);
  });
});

describe('flag off (the default build): unchanged', () => {
  it('the baked rating.tide is the line, and the flag reads off', () => {
    expect(glyphTideOwnEnabled()).toBe(false);
    render(<MapMarkerLayers {...props(3)} />);
    expect(glyph().getAttribute('aria-label')).toMatch(/tide 8\.2 ft above local MSL rising/);
  });
});

describe('the memo: the hour re-renders the markers only in Surf Rating mode', () => {
  it('ignores a new hour outside rating mode, follows it inside', () => {
    const base = props(1, { surfMode: false });
    expect(sameMarkerProps(base, { ...base, timeOffsetHours: 2 })).toBe(true);
    const rated = props(1);
    expect(sameMarkerProps(rated, { ...rated, timeOffsetHours: 2 })).toBe(false);
    expect(sameMarkerProps(base, { ...base, spotClusters: [] })).toBe(false);
  });
});
