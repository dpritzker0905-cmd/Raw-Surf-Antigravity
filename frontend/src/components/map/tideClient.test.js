import {
  tideCellKey, tideStateFromSeries, getCachedTideState, ensureTideState, _resetTideClientForTest,
  formatTideLine, trendArrow,
} from './tideClient';

// A clean half-day curve: high at 04:00 (1.0 m), low at 10:00 (-0.6 m) — the backend test fixture.
const TIMES = Array.from({ length: 13 }, (_, h) => `2026-06-29T${String(h).padStart(2, '0')}:00`);
const LEVELS = [0.0, 0.3, 0.6, 0.9, 1.0, 0.9, 0.6, 0.3, 0.0, -0.3, -0.6, -0.3, 0.0];
const atHour = (h) => Date.parse(`2026-06-29T${String(h).padStart(2, '0')}:00:00Z`);

describe('tideCellKey', () => {
  it('rounds to ~0.1° so nearby spots share a fetch (backend cache parity)', () => {
    expect(tideCellKey(28.41, -80.59)).toBe(tideCellKey(28.4, -80.6));
    expect(tideCellKey(28.4, -80.6)).not.toBe(tideCellKey(21.66, -158.05));
  });
});

describe('tideStateFromSeries', () => {
  it('reads height at the nearest sample with the trend from the next delta', () => {
    expect(tideStateFromSeries(TIMES, LEVELS, atHour(2))).toEqual({ height_m: 0.6, trend: 'rising' });
    expect(tideStateFromSeries(TIMES, LEVELS, atHour(6))).toEqual({ height_m: 0.6, trend: 'falling' });
  });

  it('reports slack inside the ±0.02 m band and at a flat tail', () => {
    expect(tideStateFromSeries(['2026-06-29T00:00', '2026-06-29T01:00'], [0.5, 0.51], atHour(0)).trend).toBe('slack');
  });

  it('skips null samples and rejects unusable series', () => {
    expect(tideStateFromSeries(TIMES, LEVELS.map(() => null), atHour(2))).toBeNull();
    expect(tideStateFromSeries([], [], atHour(2))).toBeNull();
    expect(tideStateFromSeries(TIMES, LEVELS.slice(1), atHour(2))).toBeNull();   // length mismatch
    expect(tideStateFromSeries(null, null, atHour(2))).toBeNull();
  });
});

describe('ensureTideState / getCachedTideState', () => {
  afterEach(() => {
    _resetTideClientForTest();
    delete global.fetch;
  });

  it('fetches once per cell, caches, and dedupes concurrent callers', async () => {
    let calls = 0;
    global.fetch = jest.fn(() => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ hourly: { time: TIMES, sea_level_height_msl: LEVELS } }),
      });
    });
    const [a, b] = await Promise.all([ensureTideState(28.4, -80.6), ensureTideState(28.41, -80.59)]);
    expect(calls).toBe(1);                                    // same ~0.1° cell → one request
    expect(a).toEqual(b);
    expect(a.height_m).not.toBeNull();
    expect(getCachedTideState(28.4, -80.6)).toEqual(a);       // render path reads it synchronously
    await ensureTideState(28.4, -80.6);
    expect(calls).toBe(1);                                    // cache-fresh → no refetch
  });

  it('never rejects — a failed fetch caches null and the render path shows nothing', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    await expect(ensureTideState(28.4, -80.6)).resolves.toBeNull();
    expect(getCachedTideState(28.4, -80.6)).toBeNull();       // null (fetched, unusable), not undefined
  });

  it('requests the rounded cell coords (byte-parity with the backend fetch)', async () => {
    let seenUrl = null;
    global.fetch = jest.fn((url) => {
      seenUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    await ensureTideState(28.44, -80.56);
    expect(seenUrl).toContain('latitude=28.4');
    expect(seenUrl).toContain('longitude=-80.6');
    expect(seenUrl).toContain('sea_level_height_msl');
  });
});

describe('formatTideLine', () => {
  it('formats in ft/m with the trend as a word (screen-reader safe)', () => {
    expect(formatTideLine({ height_m: -0.06, trend: 'falling' }, 'ft')).toBe('-0.2 ft falling');
    expect(formatTideLine({ height_m: 0.62, trend: 'rising' }, 'm')).toBe('0.6 m rising');
  });

  it('omits an unknown trend but keeps the height', () => {
    expect(formatTideLine({ height_m: 0.5, trend: 'weird' }, 'ft')).toBe('1.6 ft');
    expect(formatTideLine({ height_m: 0.5 }, 'ft')).toBe('1.6 ft');
  });

  it('returns null for unusable payloads', () => {
    expect(formatTideLine(null, 'ft')).toBeNull();
    expect(formatTideLine({}, 'ft')).toBeNull();
    expect(formatTideLine({ height_m: null, trend: 'rising' }, 'ft')).toBeNull();
    expect(formatTideLine({ height_m: 'x' }, 'ft')).toBeNull();
  });
});

describe('trendArrow', () => {
  it('maps trends to decorative arrows, empty for unknown', () => {
    expect(trendArrow('rising')).toBe('↑');
    expect(trendArrow('falling')).toBe('↓');
    expect(trendArrow('slack')).toBe('→');
    expect(trendArrow('nope')).toBe('');
    expect(trendArrow(undefined)).toBe('');
  });
});
