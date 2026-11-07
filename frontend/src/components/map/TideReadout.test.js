import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import TideReadout, { TIDE_TICK_MS } from './TideReadout';
import { clearPointTideCache } from './usePointTide';
import {
  formatTideTime, formatTideEvent, tideAt, tideCovers, formatTideRate, tideAriaLabel, tideCurve, trendWord, trendGlyph,
} from './tideReadoutFormat';

const NOW = '2026-11-07T12:00:00Z';
const series = Array.from({ length: 37 }, (_, i) => {
  const t = new Date(Date.parse(NOW) + (i - 6) * 3600e3).toISOString();
  return { t, h: Math.round(Math.sin(((i - 6) / 12.42) * 2 * Math.PI) * 600) / 1000 };
});
const payload = {
  available: true, height_m: 0.6, trend: 'rising', rate_m_per_h: 0.12, now: NOW, tz_offset_h: 0, tz_approx: true,
  events: [{ type: 'High', time: '2026-11-07T14:32:00Z', height_m: 1.2 }, { type: 'Low', time: '2026-11-07T20:45:00Z', height_m: -0.4 }],
  next_high: { time: '2026-11-07T14:32:00Z', height_m: 1.2 }, next_low: { time: '2026-11-07T20:45:00Z', height_m: -0.4 },
  series, source: 'model-msl', cell_km: 11,
};

describe('tide formatting', () => {
  test('words and arrows', () => {
    expect(trendWord('rising')).toBe('Rising');
    expect(trendWord('falling')).toBe('Falling');
    expect(trendWord(undefined)).toBe('Slack');
    expect(trendGlyph('rising')).toBe('\u2191');
    expect(trendGlyph('falling')).toBe('\u2193');
  });
  test('time uses the point offset when the browser zone differs', () => {
    expect(formatTideTime('2026-11-07T14:32:00Z', 10, -5)).toMatch(/12:32\s?AM/);
    expect(formatTideTime('2026-11-07T14:32:00Z', 0, 0)).toMatch(/\d{1,2}:32/);
  });
  test('event line honours ft/m', () => {
    expect(formatTideEvent('high', payload.next_high, 'm', 0, 0)).toMatch(/^Next high .*:32.* \u00b7 1\.2 m$/);
    expect(formatTideEvent('high', payload.next_high, 'ft', 0, 0)).toMatch(/3\.9 ft$/);
    expect(formatTideEvent('low', null, 'm')).toBeNull();
  });
  test('rate hides when slack/unknown', () => {
    expect(formatTideRate(0.12, 'm')).toBe('0.1 m/h');
    expect(formatTideRate(0.001, 'm')).toBeNull();
    expect(formatTideRate(null, 'm')).toBeNull();
  });
  test('aria summary', () => {
    expect(tideAriaLabel(payload, 'm', 0)).toMatch(/^Tide rising, 0\.6 m now, high 1\.2 m at .*:32/);
    expect(tideAriaLabel({ ...payload, trend: 'falling' }, 'm', 0)).toMatch(/low -0\.4 m/);
  });
  test('curve needs points and places now', () => {
    expect(tideCurve([], NOW)).toBeNull();
    const c = tideCurve(series, NOW);
    expect(c.path.startsWith('M')).toBe(true);
    expect(c.nowX).toBeGreaterThan(4);
    expect(c.nowX).toBeLessThan(172);
  });
});

describe('TideReadout', () => {
  beforeEach(() => { clearPointTideCache(); delete window.__RAW_DISABLE_INFOBOX_TIDE__; });
  afterEach(() => { delete global.fetch; });

  test('renders height, word, curve aria and honest footer', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideReadout lat={21.6} lng={-158} heightUnit="m" isLight={false} isBeach={false} atTime={Date.parse(NOW)} />);
    expect(await screen.findByTestId('tide-readout')).toBeTruthy();
    expect(screen.getByText('Rising')).toBeTruthy();
    expect(screen.getByTestId('tide-curve').getAttribute('aria-label')).toMatch(/^Tide rising, 0\.0 m now/);
    expect(screen.getByText(/not an official tide table/)).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('themes render without throwing', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    const { rerender } = render(<TideReadout lat={21.6} lng={-158} heightUnit="ft" isLight isBeach={false} />);
    await screen.findByTestId('tide-readout');
    rerender(<TideReadout lat={21.6} lng={-158} heightUnit="ft" isLight={false} isBeach />);
    expect(screen.getByTestId('tide-readout')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);   // theme/unit changes never refetch
  });

  test('fallback when unavailable', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ available: false }) }));
    render(<TideReadout lat={1} lng={2} heightUnit="m" />);
    await waitFor(() => expect(screen.getByText('Tide unavailable here')).toBeTruthy());
  });

  test('fallback on network failure', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<TideReadout lat={3} lng={4} heightUnit="m" />);
    await waitFor(() => expect(screen.getByText('Tide unavailable here')).toBeTruthy());
  });

  test('kill switch renders nothing and never fetches', () => {
    window.__RAW_DISABLE_INFOBOX_TIDE__ = true;
    global.fetch = jest.fn();
    const { container } = render(<TideReadout lat={21.6} lng={-158} heightUnit="m" />);
    expect(container.firstChild).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('time-aware readout', () => {
  beforeEach(() => { clearPointTideCache(); delete window.__RAW_DISABLE_INFOBOX_TIDE__; });
  afterEach(() => { delete global.fetch; jest.useRealTimers(); });

  test('timer recomputes now/next from the cache with no extra fetch', async () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(Date.parse(NOW));
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideReadout lat={5} lng={6} heightUnit="m" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('tide-curve').getAttribute('aria-label')).toMatch(/Tide rising/);
    expect(screen.getByText(/Next high/)).toBeTruthy();
    // 3 h later the 14:32 high is past: the card must now say falling, and the next high is gone.
    await act(async () => { jest.setSystemTime(Date.parse(NOW) + 3 * 3600e3); jest.advanceTimersByTime(TIDE_TICK_MS); });
    expect(screen.getByTestId('tide-curve').getAttribute('aria-label')).toMatch(/Tide falling/);
    expect(screen.queryByText(/Next high/)).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('tz_approx caveat renders only when the solar offset is used', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...payload, tz_offset_h: 15 }) }));
    render(<TideReadout lat={7} lng={8} heightUnit="m" />);
    expect(await screen.findByTestId('tide-solar-note')).toBeTruthy();
    expect(screen.getByText('times approx. (local solar time)')).toBeTruthy();
  });

  test('no caveat when the browser zone agrees', async () => {
    const off = -new Date(Date.parse(NOW)).getTimezoneOffset() / 60;
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...payload, tz_offset_h: off }) }));
    render(<TideReadout lat={9} lng={10} heightUnit="m" />);
    await screen.findByTestId('tide-readout');
    expect(screen.queryByTestId('tide-solar-note')).toBeNull();
  });

  test('an event on another day carries its day label', () => {
    const ref = Date.parse(NOW);
    expect(formatTideTime('2026-11-08T14:32:00Z', 0, 0, ref)).toMatch(/^Sun .*:32/);
    expect(formatTideTime('2026-11-07T14:32:00Z', 0, 0, ref)).toMatch(/^\d{1,2}:32/);
    expect(formatTideEvent('high', { time: '2026-11-08T14:32:00Z', height_m: 1.2 }, 'm', 0, 0, ref)).toMatch(/^Next high Sun /);
  });

  test('atTime overrides now', () => {
    const later = Date.parse(NOW) + 3 * 3600e3;
    expect(tideAt(payload, Date.parse(NOW)).trend).toBe('rising');
    expect(tideAt(payload, later).trend).toBe('falling');
    expect(tideAt(payload, later).next_high).toBeNull();
    expect(tideAt(payload, Date.parse(NOW) + 99 * 3600e3)).toBeNull();
    expect(tideCovers(payload, Date.parse(NOW))).toBe(true);
    expect(tideCovers(payload, Date.parse(NOW) + 28 * 3600e3)).toBe(false);
  });

  test('atTime prop drives the component', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideReadout lat={11} lng={12} heightUnit="m" atTime={Date.parse(NOW) + 3 * 3600e3} />);
    const svg = await screen.findByTestId('tide-curve');
    expect(svg.getAttribute('aria-label')).toMatch(/Tide falling/);
  });
});
