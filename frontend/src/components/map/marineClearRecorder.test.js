import { installMarineClearRecorder, isSoakRecorderEnabled, SOAK_MAX_EVENTS } from './marineClearRecorder';

const mkWin = (over = {}) => {
  const store = {};
  return {
    location: { search: '', href: 'x' }, innerWidth: 1, innerHeight: 1, devicePixelRatio: 1,
    console: { log: jest.fn(), warn: jest.fn() },
    localStorage: { setItem: (k, v) => { store[k] = v; }, _s: store },
    setInterval: (f, ms) => setInterval(f, ms), clearInterval: (i) => clearInterval(i), ...over,
  };
};

describe('marineClearRecorder', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('no-op when off: wraps nothing, records nothing', () => {
    const w = mkWin(); const orig = w.console.log;
    const un = installMarineClearRecorder(w);
    expect(w.console.log).toBe(orig);
    w.__WEBGL_MARINE_CLEAR_COUNT__ = 5; jest.advanceTimersByTime(1000);
    expect(w.__SOAK_EVENTS__).toBeUndefined(); un();
  });

  test('enabled by ?diag=1 or the flag; kill switch wins', () => {
    expect(isSoakRecorderEnabled(mkWin({ location: { search: '?diag=1' } }))).toBe(true);
    expect(isSoakRecorderEnabled(mkWin({ __RAW_SOAK_RECORDER__: true }))).toBe(true);
    expect(isSoakRecorderEnabled(mkWin({ __RAW_SOAK_RECORDER__: true, __RAW_DISABLE_SOAK_RECORDER__: true }))).toBe(false);
  });

  test('clear increment triggers a snapshot with buffered lines and persists to localStorage', () => {
    const w = mkWin({ __RAW_SOAK_RECORDER__: true }); const seen = jest.fn();
    const un = installMarineClearRecorder(w, seen);
    w.console.log('[WebGLMarineEngine-Clear] Clearing resident'); w.console.log('unrelated');
    w.__WEBGL_MARINE_CLEAR_COUNT__ = 1; jest.advanceTimersByTime(300);
    expect(w.__SOAK_EVENTS__).toHaveLength(1);
    expect(w.__SOAK_EVENTS__[0].why).toBe('clear+1');
    expect(w.__SOAK_EVENTS__[0].buf).toHaveLength(1);
    expect(JSON.parse(w.localStorage._s.__RAW_SOAK_EVENTS__)).toHaveLength(1);
    expect(seen).toHaveBeenCalledTimes(1); un();
  });

  test('drawn going null triggers; cap keeps the newest 10; blocked storage does not throw', () => {
    const w = mkWin({ __RAW_SOAK_RECORDER__: true, __MARINE_DRAWN__: { a: 1 } });
    w.localStorage.setItem = () => { throw new Error('blocked'); };
    const un = installMarineClearRecorder(w);
    w.__MARINE_DRAWN__ = null; jest.advanceTimersByTime(300);
    expect(w.__SOAK_EVENTS__[0].why).toBe('drawn_null');
    for (let i = 1; i <= 14; i++) { w.__WEBGL_MARINE_CLEAR_COUNT__ = i; jest.advanceTimersByTime(300); }
    expect(w.__SOAK_EVENTS__).toHaveLength(SOAK_MAX_EVENTS); un();
  });
});
