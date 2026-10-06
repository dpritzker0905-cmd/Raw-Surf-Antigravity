import { MarineSeriesCache, estimateSeriesEntryBytes } from './marineSeriesCache';

const entry = (n = 1, vectors = Array(n).fill(null)) => ({ ts: Date.now(),
  frames: new Map([[0, { grid: { vectors } }]]), hours: [0] });
describe('series cache ownership and freshness bounds', () => {
  let oldFlag;
  beforeEach(() => {
    oldFlag = process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS;
    process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = 'true'; jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    if (oldFlag === undefined) delete process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS;
    else process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = oldFlag;
  });
  it('evicts until both entry and estimated-byte bounds hold', () => {
    const c = new MarineSeriesCache({ maxEntries: 4, maxBytes: 4000 });
    for (let n = 0; n < 64; n++) c.set(n, entry());
    expect(c.size).toBe(2); expect(c.estimatedBytes).toBe(3072);
    expect(c.get(63)).toBeDefined(); expect(c.get(0)).toBeUndefined();
  });
  it('replacement refreshes recency and releases old ownership weight', () => {
    const c = new MarineSeriesCache({ maxEntries: 2 });
    c.set('a', entry(4)); c.set('b', entry()); c.set('a', entry()); c.set('c', entry());
    expect(c.get('b')).toBeUndefined(); expect(c.estimatedBytes).toBe(3072);
  });
  it('a hot frame survives cold insertion without refreshing its TTL', () => {
    const c = new MarineSeriesCache({ maxEntries: 2, ttl: 100 });
    c.set('a', entry()); c.set('b', entry());
    const a = c.get('a'); c.set('c', entry());
    expect(c.get('a')).toBe(a); expect(c.get('b')).toBeUndefined();
    jest.advanceTimersByTime(100);
    expect(c.get('a')).toBeUndefined(); expect(c.size).toBe(0); expect(c.estimatedBytes).toBe(0);
  });
  it('containment-selected frame is touched after the iteration', () => {
    const c = new MarineSeriesCache({ maxEntries: 2 }); const a = entry();
    c.set('a', a); c.set('b', entry());
    expect(Array.from(c.values())).toHaveLength(2);
    c.touchFrame(a.frames.get(0)); c.set('c', entry());
    expect(c.get('a')).toBe(a); expect(c.get('b')).toBeUndefined();
  });
  it('an oversized candidate preserves the already useful page', () => {
    const c = new MarineSeriesCache({ maxBytes: 2000 }); const a = entry(); c.set('a', a);
    c.set('huge', entry(100)); expect(c.get('a')).toBe(a);
    expect(c.get('huge')).toBeUndefined(); expect(c.estimatedBytes).toBe(1536);
  });
  it('expired and invalid timestamps are reclaimed on every write and scan', () => {
    const c = new MarineSeriesCache({ ttl: 10 }); c.set('a', entry());
    jest.advanceTimersByTime(10); c.set('b', { ...entry(), ts: NaN });
    expect(Array.from(c.values())).toHaveLength(0); expect(c.estimatedBytes).toBe(0);
  });
  it('counts shared vector ownership once within a page and accounts typed byteLength', () => {
    const vectors = new Float32Array(16); const a = entry(0, vectors);
    a.frames.set(3, { grid: { vectors } });
    expect(estimateSeriesEntryBytes(a)).toBe(256 + 2048 + 64);
  });
  it('placeholder churn remains capped and clearing releases weight', () => {
    const c = new MarineSeriesCache({ maxEntries: 2 });
    for (let n = 0; n < 64; n++) c.set(n, { ts: Date.now(), frames: new Map() });
    expect(c.size).toBe(2); expect(c.estimatedBytes).toBe(512);
    c.clear(); expect(c.size).toBe(0); expect(c.estimatedBytes).toBe(0);
  });
  it('activation reconciles legacy excess without a partial one-entry eviction', () => {
    const c = new MarineSeriesCache({ maxEntries: 2 });
    process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = 'false';
    for (let n = 0; n < 64; n++) c.set(n, entry());
    process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS = 'true';
    expect(c.get(63)).toBeDefined(); expect(c.size).toBe(2); expect(c.estimatedBytes).toBe(3072);
  });
});
