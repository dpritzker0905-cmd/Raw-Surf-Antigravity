import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TideReadout from './TideReadout';
import { clearPointTideCache } from './usePointTide';
import {
  formatTideTime, formatTideEvent, formatTideRate, tideAriaLabel, tideCurve, trendWord, trendGlyph,
} from './tideReadoutFormat';

const NOW = '2026-11-07T12:00:00Z';
const series = Array.from({ length: 37 }, (_, i) => {
  const t = new Date(Date.parse(NOW) + (i - 6) * 3600e3).toISOString();
  return { t, h: Math.round(Math.sin(((i - 6) / 12.42) * 2 * Math.PI) * 600) / 1000 };
});
const payload = {
  available: true, height_m: 0.6, trend: 'rising', rate_m_per_h: 0.12, now: NOW, tz_offset_h: 0, tz_approx: true,
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
    render(<TideReadout lat={21.6} lng={-158} heightUnit="m" isLight={false} isBeach={false} />);
    expect(await screen.findByTestId('tide-readout')).toBeTruthy();
    expect(screen.getByText('Rising')).toBeTruthy();
    expect(screen.getByTestId('tide-curve').getAttribute('aria-label')).toMatch(/^Tide rising, 0\.6 m now/);
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
