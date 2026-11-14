/**
 * #815: the too-many-requests notice (owner 2026-11-12 11:45 EST). Only the limiter's MARKED 429 shows it, with N from
 * Retry-After; it clears when the wait passes; no request leaves the tab during the wait; the kill switch silences it.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider } from '../contexts/ThemeContext';
import RateLimitNotice, { noticePalette } from '../components/RateLimitNotice';
import { installWeatherAuthFetch } from '../lib/weatherAuthFetch';
import { isRateLimited, retryAfterSeconds, laneOf, WEATHER_RATE_LIMITED } from '../lib/weatherRateLimit';

const limited = (s = '7') => ({ ok: false, status: 429,
  headers: new Headers({ 'X-Raw-Tier-Clamp': 'rate_limited', 'Retry-After': s, 'X-Raw-Tier-Clamp-On': '1' }) });
const ok = () => ({ ok: true, status: 200, headers: new Headers({ 'X-Raw-Tier-Clamp-On': '1' }) });

function tab(responses) {
  const seen = [];
  const queue = [...responses];
  const events = [];
  const win = {
    fetch: (url, init) => { seen.push(url); return Promise.resolve(queue.length ? queue.shift() : ok()); },
    localStorage: { getItem: () => JSON.stringify({ access_token: 'tok' }) },
    __WEATHER_CAPABILITIES__: [{ tier_clamp: true }],
    location: { pathname: '/map', search: '' },
    CustomEvent: function CE(type, init) { this.type = type; this.detail = init && init.detail; },
    dispatchEvent: (e) => { events.push(e); return true; },
  };
  installWeatherAuthFetch(win);
  return { win, seen, events };
}

afterEach(() => { jest.useRealTimers(); window.localStorage.clear(); delete window.__RAW_DISABLE_RATE_LIMIT_NOTICE__; });

describe('the limiter 429 (pure)', () => {
  test('only the marked 429 counts; the wait comes from Retry-After, bounded', () => {
    expect(isRateLimited(limited())).toBe(true);
    expect(isRateLimited({ status: 429, headers: new Headers({}) })).toBe(false);                 // somebody else's 429
    expect(isRateLimited({ status: 503, headers: new Headers({ 'X-Raw-Tier-Clamp': 'rate_limited' }) })).toBe(false);
    expect([retryAfterSeconds(limited('12')), retryAfterSeconds(limited('junk')), retryAfterSeconds(limited('99999'))])
      .toEqual([12, 5, 600]);
    expect([laneOf('/api/weather/frame-urls?index=x'), laneOf('/api/weather/grid?x=1')]).toEqual(['frame-urls', 'reads']);
  });
});

describe('the hold: no retry storm', () => {
  test('a marked 429 holds the lane: no request is issued during the wait, then requests resume', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T12:00:00Z'));
    const { win, seen, events } = tab([limited('7')]);
    expect((await win.fetch('/api/weather/grid?a=1')).status).toBe(429);
    expect(events.map((e) => e.type)).toEqual([WEATHER_RATE_LIMITED]);
    const held = await win.fetch('/api/weather/grid?a=2');
    expect(held.status).toBe(429);
    expect(held.headers.get('X-Raw-Held')).toBe('1');
    expect(seen).toEqual(['/api/weather/grid?a=1']);                    // the held read never left the tab
    expect((await win.fetch('/api/weather/frame-urls?index=i')).status).toBe(200);   // the other lane is not held
    jest.setSystemTime(new Date('2026-11-12T12:00:08Z'));
    expect((await win.fetch('/api/weather/grid?a=3')).status).toBe(200);
    expect(seen).toEqual(['/api/weather/grid?a=1', '/api/weather/frame-urls?index=i', '/api/weather/grid?a=3']);
  });

  test('an unmarked 429 or a 5xx holds nothing and raises nothing', async () => {
    const { win, seen, events } = tab([{ ok: false, status: 429, headers: new Headers({}) },
      { ok: false, status: 503, headers: new Headers({}) }]);
    await win.fetch('/api/weather/grid?a=1');
    await win.fetch('/api/weather/grid?a=2');
    await win.fetch('/api/weather/grid?a=3');
    expect(seen).toHaveLength(3);
    expect(events).toEqual([]);
  });

  test('the kill switch: no hold, no event, no notice (the previous behaviour)', async () => {
    const { win, seen, events } = tab([limited('7')]);
    win.__RAW_DISABLE_RATE_LIMIT_NOTICE__ = true;
    await win.fetch('/api/weather/grid?a=1');
    await win.fetch('/api/weather/grid?a=2');
    expect(seen).toHaveLength(2);
    expect(events).toEqual([]);
  });
});

describe('RateLimitNotice', () => {
  const raise = (untilMs) => act(() => {
    window.dispatchEvent(new CustomEvent(WEATHER_RATE_LIMITED, { detail: { until: untilMs, lane: 'reads' } }));
  });
  function renderIn(theme) {
    window.localStorage.setItem('raw-surf-theme', theme);
    return render(<ThemeProvider><RateLimitNotice /></ThemeProvider>);
  }

  test('a marked 429 shows a polite status with the right N, counts down and clears after the wait', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T12:00:00Z'));
    renderIn('dark');
    expect(screen.queryByRole('status')).toBeNull();
    raise(Date.now() + 7000);
    const s = screen.getByRole('status');
    expect(s).toHaveAttribute('aria-live', 'polite');
    expect(s).toHaveTextContent('Too many requests — try again in 7 s');
    expect(screen.queryByRole('alertdialog')).toBeNull();             // non-modal
    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.getByRole('status')).toHaveTextContent('try again in 4 s');
    act(() => { jest.advanceTimersByTime(4500); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('the kill switch silences the notice', () => {
    renderIn('dark');
    window.__RAW_DISABLE_RATE_LIMIT_NOTICE__ = true;
    raise(Date.now() + 7000);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test.each(['light', 'dark', 'beach'])('%s theme: its own palette', (theme) => {
    renderIn(theme);
    raise(Date.now() + 5000);
    for (const cls of noticePalette(theme).split(' ')) expect(screen.getByRole('status')).toHaveClass(cls);
  });
});
