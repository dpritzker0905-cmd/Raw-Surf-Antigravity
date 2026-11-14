import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import TideReadout, { TIDE_TICK_MS } from './TideReadout';
import { clearPointTideCache } from './usePointTide';
import {
  formatTideTime, formatTideEvent, formatTideHeight, tideAt, tideCovers, formatTideRate, tideAriaLabel, tideCurve, trendWord, trendGlyph,
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
    expect(formatTideEvent('high', payload.next_high, 'm', 'UTC', 0)).toMatch(/UTC · 1\.2 m$/);
    expect(formatTideHeight(4, 'ft')).toBe('13 ft');
    expect(formatTideHeight(-4, 'ft')).toBe('-13 ft');
    expect(formatTideHeight(-0.03, 'm')).toBe('0.0 m');
    expect(formatTideHeight(-0.01, 'ft')).toBe('0.0 ft');
    expect(formatTideHeight(-0.06, 'm')).toBe('-0.1 m');
    expect(formatTideHeight(-0.02, 'ft')).toBe('-0.1 ft');
  });
  test('rate hides when slack/unknown', () => {
    expect(formatTideRate(0.12, 'm')).toBe('0.1 m/h');
    expect(formatTideRate(0.001, 'm')).toBeNull();
    expect(formatTideRate(null, 'm')).toBeNull();
    expect(formatTideRate(0.015, 'm', 'slack')).toBeNull();
    expect(formatTideRate(0.02, 'ft', 'slack')).toBeNull();
  });
  test('aria summary', () => {
    expect(tideAriaLabel(payload, 'm', 0)).toMatch(/^Tide rising, 0\.6 m at selected time, high 1\.2 m at .*:32/);
    expect(tideAriaLabel({ ...payload, trend: 'falling' }, 'm', 0)).toMatch(/low -0\.4 m/);
    expect(tideAriaLabel({...payload,tz_offset_h:'UTC'},'m',0)).toMatch(/UTC$/);
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
  afterEach(() => { delete global.fetch; jest.useRealTimers(); });

  test('loading announces progress without showing a stale reading', () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<TideReadout lat={21.6} lng={-158} heightUnit="m" atTime={Date.parse(NOW)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading modeled sea level');
    expect(screen.queryByTestId('tide-readout')).toBeNull();
  });

  test('renders height, word, curve aria and honest footer', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideReadout lat={21.6} lng={-158} heightUnit="m" isLight={false} isBeach={false} atTime={Date.parse(NOW)} />);
    expect(await screen.findByTestId('tide-readout')).toBeTruthy();
    expect(screen.getByText('Rising')).toBeTruthy();
    expect(screen.getByTestId('tide-curve').getAttribute('aria-label')).toMatch(/^Tide rising, 0\.0 m at selected time/);
    expect(screen.getByText('Modeled sea level · MSL')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'About tide data' })).toBeNull();
    expect(screen.queryByText(/Open-Meteo|not an official tide table/)).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('themes render without throwing', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    const { rerender } = render(<TideReadout lat={21.6} lng={-158} heightUnit="ft" isLight isBeach={false} atTime={Date.parse(NOW)} />);
    await screen.findByTestId('tide-readout');
    rerender(<TideReadout lat={21.6} lng={-158} heightUnit="ft" isLight={false} isBeach atTime={Date.parse(NOW)} />);
    expect(screen.getByTestId('tide-readout')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);   // theme/unit changes never refetch
    // A fixed acquired series must not expire when this appearance test runs later.
    const laterWallClock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW) + 1000 * 3600e3);
    try {
      rerender(<TideReadout lat={21.6} lng={-158} heightUnit="ft" isLight={false} isBeach atTime={Date.parse(NOW)} />);
      expect(screen.getByTestId('tide-readout')).toBeTruthy();
    } finally { laterWallClock.mockRestore(); }
  });

  test('fallback when unavailable', async () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(Date.parse(NOW));
    let finishRetry;
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ available: false }) })
      .mockImplementation(() => new Promise(resolve => { finishRetry = resolve; }));
    const show = () => render(<TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW)} />);
    let view = show();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('tide-readout-unavailable')).toBeTruthy();
    view.unmount();
    jest.setSystemTime(Date.parse(NOW) + 29999);
    view = show();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('tide-readout-unavailable')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    view.unmount();
    jest.setSystemTime(Date.parse(NOW) + 30000);
    show();
    show(); // Two mounted consumers share the retry while its response is pending.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishRetry({ ok: true, json: () => Promise.resolve(payload) });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(screen.getAllByTestId('tide-readout')).toHaveLength(2);
  });

  test('fallback on network failure', async () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(Date.parse(NOW));
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
    const props = { lat: 3, lng: 4, heightUnit: 'm' };
    const { rerender } = render(<TideReadout {...props} atTime={Date.parse(NOW)} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('tide-readout-unavailable')).toBeTruthy();
    jest.setSystemTime(Date.parse(NOW) + 29999);
    rerender(<TideReadout {...props} atTime={Date.parse(NOW) + 100 * 3600e3} />);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.parse(NOW) + 30000);
    rerender(<TideReadout {...props} atTime={Date.parse(NOW)} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tide-readout')).toBeTruthy();
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

  test('timer recomputes now/next and refreshes expired wall-clock cache', async () => {
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
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('selected readout uses labeled UTC rather than approximate solar time', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...payload, tz_offset_h: 15 }) }));
    render(<TideReadout lat={7} lng={8} heightUnit="m" atTime={Date.parse(NOW)} />);
    await screen.findByTestId('tide-readout');
    expect(screen.queryByTestId('tide-solar-note')).toBeNull();
    expect(screen.getByText(/Next high/)).toHaveTextContent('UTC');
  });

  test('no caveat when the browser zone agrees', async () => {
    const off = -new Date(Date.parse(NOW)).getTimezoneOffset() / 60;
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...payload, tz_offset_h: off }) }));
    render(<TideReadout lat={9} lng={10} heightUnit="m" atTime={Date.parse(NOW)} />);
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
    const unavailableMetadata = {...payload, available: false, selected_time_available: false, tz_offset_h: 5, tz_approx: true};
    expect(tideAt(unavailableMetadata, Date.parse(NOW))).toMatchObject({available: true, selected_time_available: true, tz_offset_h: 'UTC', tz_approx: false});
    expect(unavailableMetadata.available).toBe(false);
    expect(formatTideHeight(null, 'm')).toBe('—');
    expect(formatTideHeight(undefined, 'ft')).toBe('—');
    expect(tideAt(payload, later).trend).toBe('falling');
    expect(tideAt(payload, later).next_high).toBeNull();
    expect(tideAt(payload, Date.parse(NOW) + 99 * 3600e3)).toBeNull();
    expect(tideCovers(payload, Date.parse(NOW))).toBe(true);
    expect(tideCovers(payload, Date.parse(NOW) + 28 * 3600e3)).toBe(false);
  });

  test('uncovered selected dates do not refetch while cache is fresh', async () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(Date.parse(NOW));
    // Series availability is independent of coverage at the server's request-time instant.
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
      ...payload, selected_time_available: false, height_m: null,
    }) }));
    const props = { lat: 11, lng: 12, heightUnit: 'm' };
    const { rerender } = render(<TideReadout {...props} atTime={Date.parse(NOW)} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    jest.setSystemTime(Date.parse(NOW) + 299999);
    for (const hour of [100, 101, 102]) {
      rerender(<TideReadout {...props} atTime={Date.parse(NOW) + hour * 3600e3} />);
    }
    expect(screen.getByTestId('tide-readout-unavailable')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const cachedConsumer = render(<TideReadout {...props} atTime={Date.parse(NOW)} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tide-readout')).toBeTruthy();
    cachedConsumer.unmount();
    jest.setSystemTime(Date.parse(NOW) + 300000);
    rerender(<TideReadout {...props} atTime={Date.parse(NOW)} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tide-readout')).toBeTruthy();
  });

  test('latest point and selected time survive rapid scrubbing and a late old response', async () => {
    let finishOld;
    global.fetch = jest.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
    const { rerender } = render(<>
      <TideReadout lat={11} lng={12} heightUnit="m" atTime={Date.parse(NOW)} />
      <TideReadout lat={11} lng={12} heightUnit="m" atTime={Date.parse(NOW) + 3600e3} />
    </>);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const nextPoint = { lat: 13, lng: 14, heightUnit: 'm' };
    rerender(<TideReadout {...nextPoint} atTime={Date.parse(NOW) + 3 * 3600e3} />);
    expect((await screen.findByTestId('tide-curve')).getAttribute('aria-label')).toMatch(/Tide falling/);
    await act(async () => {
      finishOld({ ok: true, json: () => Promise.resolve({ ...payload,
        series: payload.series.map(sample => ({ ...sample, h: 9 })) }) });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    for (const hour of [0, 1, 2, 3, 0, 3]) {
      rerender(<TideReadout {...nextPoint} atTime={Date.parse(NOW) + hour * 3600e3} />);
    }
    expect(screen.getByTestId('tide-curve').getAttribute('aria-label')).toMatch(/Tide falling/);
    expect(screen.queryByText('9.0 m')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('point tide request/cache cell identity', () => {
  beforeEach(() => { clearPointTideCache(); delete window.__RAW_DISABLE_INFOBOX_TIDE__; });
  afterEach(() => { delete global.fetch; });

  test.each([
    // Expected cells are Python round(value, 1), the backend contract.
    [34.05, -80.55, '34', '-80.5'],
    [21.65, -80.45, '21.6', '-80.5'],
  ])('requests the same canonical cell that is cached for %s,%s', async (lat, lng, expectedLat, expectedLng) => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideReadout lat={lat} lng={lng} heightUnit="m" atTime={Date.parse(NOW)} />);
    await screen.findByTestId('tide-readout');
    const query = new URL(global.fetch.mock.calls[0][0]).searchParams;
    expect(query.get('lat')).toBe(expectedLat);
    expect(query.get('lng')).toBe(expectedLng);
  });

  test('a boundary caller cannot cache a neighbouring cell series for later callers', async () => {
    // Distinct synthetic server cells make a wrongly addressed request observable in the readout.
    global.fetch = jest.fn(url => {
      const height = new URL(url).searchParams.get('lat') === '34' ? 2 : 9;
      const response = { ...payload, series: series.map(point => ({ ...point, h: height })) };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
    });
    const view = render(<TideReadout lat={34.05} lng={-80.55} heightUnit="m" atTime={Date.parse(NOW)} />);
    expect(await screen.findByTestId('tide-readout')).toHaveTextContent('2.0 m');
    view.rerender(<TideReadout lat={34.049} lng={-80.51} heightUnit="m" atTime={Date.parse(NOW)} />);
    await waitFor(() => expect(screen.getByTestId('tide-readout')).toHaveTextContent('2.0 m'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('point tide expiry while the selected forecast stays mounted', () => {
  beforeEach(() => {
    clearPointTideCache(); delete window.__RAW_DISABLE_INFOBOX_TIDE__;
    jest.useFakeTimers('modern'); jest.setSystemTime(Date.parse(NOW));
  });
  afterEach(() => { delete global.fetch; jest.useRealTimers(); });
  const answer = height => ({ ok: true, json: () => Promise.resolve({
    ...payload, series: series.map(point => ({ ...point, h: height })),
  }) });
  const advance = async ms => act(async () => {
    jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  test('an unavailable fixed selection retries at 30 seconds without an external render', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ available: false }) })
      .mockResolvedValue(answer(2));
    render(<TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW)} />);
    await advance(0); expect(screen.getByTestId('tide-readout-unavailable')).toBeInTheDocument();
    await advance(29999); expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(1); expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tide-readout')).toHaveTextContent('2.0 m');
  });

  test('acquired data refreshes at five minutes and scrubbing does not postpone expiry', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(answer(2)).mockResolvedValue(answer(3));
    const view = render(<TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW)} />);
    await advance(0); expect(screen.getByTestId('tide-readout')).toHaveTextContent('2.0 m');
    await advance(20000);
    view.rerender(<TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW) + 3600e3} />);
    await advance(279999); expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(1); expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tide-readout')).toHaveTextContent('3.0 m');
  });

  test('mounted consumers dedupe an expiry retry and unmount cancels later refreshes', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ available: false }) })
      .mockResolvedValue(answer(2));
    const view = render(<><TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW)} />
      <TideReadout lat={1.01} lng={2.01} heightUnit="m" atTime={Date.parse(NOW)} /></>);
    await advance(0); expect(screen.getAllByTestId('tide-readout-unavailable')).toHaveLength(2);
    await advance(30000); expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('tide-readout')).toHaveLength(2);
    view.unmount(); await advance(300000); expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('changing points cancels the old cell deadline and keeps the new cell deadline', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ available: false }) });
    const view = render(<TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW)} />);
    await advance(0); await advance(10000);
    view.rerender(<TideReadout lat={3} lng={4} heightUnit="m" atTime={Date.parse(NOW)} />);
    await advance(0); expect(global.fetch).toHaveBeenCalledTimes(2);
    await advance(20000); expect(global.fetch).toHaveBeenCalledTimes(2);
    await advance(10000); expect(global.fetch).toHaveBeenCalledTimes(3);
    view.unmount(); await advance(30000); expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('expired successful tide data on refresh failure', () => {
  beforeEach(() => {clearPointTideCache();jest.useFakeTimers('modern');jest.setSystemTime(Date.parse(NOW));});
  afterEach(() => {delete global.fetch;jest.useRealTimers();});
  test('fails closed at the 300-second deadline and retries at 30 seconds', async () => {
    const answer = height => ({ok: true, json: () => Promise.resolve({...payload, series: series.map(p => ({...p, h: height}))})});
    const advance = ms => act(async () => {jest.advanceTimersByTime(ms);for(let i=0;i<8;i++)await Promise.resolve();});
    global.fetch=jest.fn().mockResolvedValueOnce(answer(2)).mockResolvedValueOnce({ok:false,status:503}).mockResolvedValue(answer(3));
    render(<TideReadout lat={1} lng={2} heightUnit="m" atTime={Date.parse(NOW)}/>);
    await advance(0);expect(screen.getByTestId('tide-readout')).toHaveTextContent('2.0 m');
    await advance(299999);expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(1);expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tide-readout-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('tide-readout')).not.toBeInTheDocument();
    await advance(29999);expect(global.fetch).toHaveBeenCalledTimes(2);
    await advance(1);expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('tide-readout')).toHaveTextContent('3.0 m');
  });
});
