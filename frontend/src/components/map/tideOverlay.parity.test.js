/**
 * Tide overlay gate (pre-registered 2026-11-15, docs/weather-program/log/2026-11-15-claude-tide-overlay.md):
 *  G1 parity: at every pinned forecast hour, the map tide marker and the infobox TideReadout show the SAME height,
 *     trend word and next high/low height (same payload, same tideAt, same forecastSelectionMs instant).
 *  G2 scrub cost: changing the forecast hour issues ZERO further /point-tide requests (overlay and infobox together).
 *  Plus: kill switch, add-on toggle ARIA in all three MapWeatherControls layouts, three themes.
 */
import React from 'react';
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react';

jest.mock('./ContentMarker', () => ({ ContentMarker: ({ children }) => <div data-testid="marker">{children}</div> }));
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));

import TideReadout from './TideReadout';
import TideOverlayLayer, { TideMarkerBody, tideMarkerClasses } from './TideOverlayLayer';
import TideOverlayToggle from './TideOverlayToggle';
import { clearPointTideCache } from './usePointTide';
import { forecastSelectionMs } from './forecastReadout';
import { selectTideCells, tideMarkerModel, formatTimeUntil, TIDE_OVERLAY_STORAGE_KEY, getTideOverlayFlag } from './tideOverlayModel';
import { canUseAddOn } from './LayerAccessResolver';
import { SETTLE_MS } from './useTideOverlay';
import { tideAt, formatTideHeight } from './tideReadoutFormat';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const series = Array.from({ length: 49 }, (_, i) => {
  const t = new Date(NOW + (i - 6) * 3600e3).toISOString().replace('.000Z', 'Z');
  return { t, h: Math.round(Math.sin(((i - 6) / 12.42) * 2 * Math.PI) * 800) / 1000 };
});
// Extremes as the backend's tide_extrema would report them for the sine (quarter-period peaks).
const events = [];
for (let k = 0; k < 4; k++) {
  events.push({ type: 'High', time: new Date(NOW + (12.42 / 4 + k * 12.42) * 3600e3).toISOString(), height_m: 0.8 });
  events.push({ type: 'Low', time: new Date(NOW + (12.42 * 3 / 4 + k * 12.42) * 3600e3).toISOString(), height_m: -0.8 });
}
const payload = {
  available: true, now: '2026-11-15T12:00:00Z', series, events, timezone: 'UTC', datum: 'MSL', source: 'model-msl', cell_km: 11,
  coverage: [{ start: series[0].t, end: series[series.length - 1].t }],
};
const LAT = 21.665; const LNG = -158.05;
const spot = { id: 's1', name: 'Pipeline', latitude: LAT, longitude: LNG, isCluster: false };
const HOURS = [0, 2, 5, 9, 17, 29, 43];   // the series ends at +42 h, so 43 is past it: both must say "no tide"

let fetchMock;
beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  jest.setSystemTime(NOW);   // Jest 27 ignores useFakeTimers({ now }); without this the fake clock starts at the REAL time and the fixture expired 2026-11-17
  clearPointTideCache();
  window.localStorage.clear();
  delete window.__RAW_DISABLE_TIDE_OVERLAY__;
  mockTheme = 'dark';
  fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
  global.fetch = fetchMock;
});
afterEach(() => { jest.useRealTimers(); });

const pointTideCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/point-tide')).length;

function Both({ hour, unit }) {
  window.localStorage.setItem('__RAW_HEIGHT_UNIT__', unit);
  return (
    <>
      <div data-testid="infobox"><TideReadout lat={LAT} lng={LNG} heightUnit={unit} isLight={false} isBeach={false} atTime={forecastSelectionMs(hour)} /></div>
      <div data-testid="overlay"><TideOverlayLayer spotClusters={[spot]} timeOffsetHours={hour} userTier="guest" /></div>
    </>
  );
}

describe('G1 parity: overlay marker == infobox readout at the same hour', () => {
  test.each(HOURS)('hour %p', async (hour) => {
    const { rerender } = render(<Both hour={hour} unit="m" />);
    await waitFor(() => expect(screen.getByTestId('overlay').querySelector('[data-testid="tide-marker"]')).not.toBeNull());
    rerender(<Both hour={hour} unit="m" />);
    const marker = screen.getByTestId('tide-marker');
    const infobox = screen.getByTestId('infobox');
    const atMs = forecastSelectionMs(hour);
    const truth = tideAt(payload, atMs);
    if (!truth) {
      expect(within(infobox).getByTestId('tide-readout-unavailable')).toBeTruthy();
      expect(marker.textContent).toBe('No tide for this time');
      return;
    }
    const readout = within(infobox).getByTestId('tide-readout');
    const h = formatTideHeight(truth.height_m, 'm');
    expect(readout.textContent).toContain(h);
    expect(marker.textContent).toContain(h);
    const word = { rising: 'Rising', falling: 'Falling', slack: 'Slack' }[truth.trend];
    expect(readout.textContent).toContain(word);
    expect(marker.textContent).toContain(word);
    expect(marker.getAttribute('aria-label')).toContain(word.toLowerCase());
    const model = tideMarkerModel(payload, atMs, 'm', 'Pipeline');
    const turn = model.next.kind === 'High' ? truth.next_high : truth.next_low;
    expect(model.next).toEqual({ kind: model.next.kind, ...turn });
    expect(readout.textContent).toContain(formatTideHeight(turn.height_m, 'm'));
  });
});

test('G2: scrubbing through every hour issues zero further /point-tide requests', async () => {
  const { rerender } = render(<Both hour={0} unit="m" />);
  await waitFor(() => expect(screen.queryByTestId('tide-marker')).not.toBeNull());
  const before = pointTideCalls();
  expect(before).toBe(1);   // infobox and overlay share ONE cached request for the cell
  for (let hour = 1; hour <= 72; hour++) rerender(<Both hour={hour} unit="m" />);
  await act(async () => { await Promise.resolve(); });
  expect(pointTideCalls()).toBe(before);
});

test('kill switch: no marker, no toggle, no fetch', async () => {
  window.__RAW_DISABLE_TIDE_OVERLAY__ = true;
  render(<><TideOverlayLayer spotClusters={[spot]} timeOffsetHours={0} userTier="guest" /><TideOverlayToggle userTier="guest" /></>);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId('tide-marker')).toBeNull();
  expect(screen.queryByTestId('tide-overlay-toggle')).toBeNull();
  expect(pointTideCalls()).toBe(0);
});

test('ships ON; the toggle is a real button with aria-pressed and a text state, synced across copies', async () => {
  expect(getTideOverlayFlag()).toBe(true);
  render(<><TideOverlayToggle userTier="guest" /><TideOverlayToggle userTier="guest" size="lg" /></>);
  const [a, b] = screen.getAllByRole('button');
  expect(a.getAttribute('aria-pressed')).toBe('true');
  expect(a.textContent).toBe('Tides: ON');
  fireEvent.click(a);
  expect(a.getAttribute('aria-pressed')).toBe('false');
  expect(b.getAttribute('aria-pressed')).toBe('false');
  expect(b.textContent).toBe('Tides: OFF');
  expect(window.localStorage.getItem(TIDE_OVERLAY_STORAGE_KEY)).toBe('false');
});

test('toggled OFF: overlay draws and fetches nothing', async () => {
  window.localStorage.setItem(TIDE_OVERLAY_STORAGE_KEY, 'false');
  render(<TideOverlayLayer spotClusters={[spot]} timeOffsetHours={0} userTier="guest" />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId('tide-marker')).toBeNull();
  expect(pointTideCalls()).toBe(0);
});

test('tier gate lives in LayerAccessResolver: every tier, unknown add-on denied', () => {
  ['guest', 'tier_1', 'tier_2', 'tier_3', null].forEach((t) => expect(canUseAddOn(t, 'tide')).toBe(true));
  expect(canUseAddOn('premium', 'nope')).toBe(false);
});

test('cells: one per tide cell, clusters skipped, nearest first, capped', () => {
  const near = { id: 'a', name: 'A', latitude: 21.66, longitude: -158.05 };
  const sameCell = { id: 'b', name: 'B', latitude: 21.68, longitude: -158.06 };
  const far = { id: 'c', name: 'C', latitude: 22.2, longitude: -159.5 };
  const cluster = { id: 'k', isCluster: true, latitude: 21.0, longitude: -157.0 };
  const cells = selectTideCells([far, cluster, near, sameCell], [-158.05, 21.66]);
  expect(cells.map((c) => c.name)).toEqual(['A', 'C']);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i, latitude: 20 + i * 0.3, longitude: -150 }));
  expect(selectTideCells(many, null)).toHaveLength(12);
});

test('a turn under a minute away reads "High now", never "High in now" (LongCat finding 5)', () => {
  const t0 = Date.parse('2026-11-15T00:00:00Z');
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const ser = [0, 0.4, 0.8].map((h, i) => ({ t: iso(t0 + i * 3600e3), h }));
  const rising = { series: ser, coverage: [{ start: ser[0].t, end: ser[2].t }],
    events: [{ type: 'High', time: iso(t0 + 3600e3 + 30e3), height_m: 0.8 }] };
  const m = tideMarkerModel(rising, t0 + 3600e3 + 10e3, 'm', 'Pipeline');
  expect(m.nextText).toBe('High now');
  expect(m.ariaLabel).toMatch(/high 0\.8 m now$/);
});

test('time-until formatting', () => {
  expect(formatTimeUntil(130 * 60e3)).toBe('2h 10m');
  expect(formatTimeUntil(45 * 60e3)).toBe('45m');
  expect(formatTimeUntil(120 * 60e3)).toBe('2h');
  expect(formatTimeUntil(10e3)).toBe('now');
  expect(formatTimeUntil(-1)).toBeNull();
});

test.each(['light', 'dark', 'beach'])('theme %s: marker has its own palette and text trend', (theme) => {
  const model = tideMarkerModel(payload, NOW + 2 * 3600e3, 'ft', 'Pipeline');
  render(<TideMarkerBody model={model} theme={theme} />);
  const el = screen.getByTestId('tide-marker');
  tideMarkerClasses(theme).box.split(' ').forEach((cls) => expect(el.className).toContain(cls));
  expect(el.textContent).toMatch(/Rising|Falling|Slack/);
  expect(el.textContent).toMatch(/ft/);
});

describe('load safety: one request per cell, shared with the infobox (no upstream quota since PR B #1132)', () => {
  test('the overlay and the infobox share ONE /point-tide request for a cell; no overlay-only path remains', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideOverlayLayer spotClusters={[spot]} timeOffsetHours={0} userTier="guest" />);
    await act(async () => { jest.advanceTimersByTime(700); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByTestId('tide-marker')).not.toBeNull());
    render(<TideReadout lat={LAT} lng={LNG} heightUnit="m" isLight={false} isBeach={false} atTime={forecastSelectionMs(2)} />);
    await waitFor(() => expect(screen.getByTestId('tide-readout')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);                       // the infobox answered from the shared cache
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('purpose='))).toBe(true);
  });

  test('a view that keeps moving asks nothing until it rests SETTLE_MS', async () => {
    const other = { ...spot, id: 's2', latitude: 21.9, longitude: -159.4 };
    const { rerender } = render(<TideOverlayLayer spotClusters={[spot]} timeOffsetHours={0} userTier="guest" />);
    for (let i = 0; i < 5; i++) {
      await act(async () => { jest.advanceTimersByTime(SETTLE_MS - 100); });
      rerender(<TideOverlayLayer spotClusters={i % 2 ? [spot] : [other]} timeOffsetHours={0} userTier="guest" />);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(SETTLE_MS + 10); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
