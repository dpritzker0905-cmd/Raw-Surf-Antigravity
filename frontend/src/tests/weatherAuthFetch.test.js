import { withWeatherAuth, isBackendWeatherUrl, storedAccessToken, installWeatherAuthFetch } from '../lib/weatherAuthFetch';

const B = 'https://api.example.test';

describe('weatherAuthFetch (O5 client half)', () => {
  test('adds the token only to this backend weather reads', () => {
    expect(isBackendWeatherUrl(`${B}/api/weather/grid_series?model=GFS`, B)).toBe(true);
    expect(isBackendWeatherUrl('/api/weather/point?lat=1', B)).toBe(true);
    expect(isBackendWeatherUrl(`${B}/api/auth/me`, B)).toBe(false);
    expect(isBackendWeatherUrl('https://cdn.example.test/weather-frames/x.bin', B)).toBe(false);
    expect(isBackendWeatherUrl('https://evil.test/api/weather/grid', B)).toBe(false);
  });

  test('merges into plain, Headers and array headers without clobbering', () => {
    const plain = withWeatherAuth(`${B}/api/weather/grid`, { signal: 'S', headers: { X: '1' } }, { backendUrl: B, token: 't' });
    expect(plain).toEqual({ signal: 'S', headers: { X: '1', Authorization: 'Bearer t' } });
    const none = withWeatherAuth(`${B}/api/weather/grid`, undefined, { backendUrl: B, token: 't' });
    expect(none.headers.Authorization).toBe('Bearer t');
    const h = withWeatherAuth(`${B}/api/weather/grid`, { headers: new Headers({ a: 'b' }) }, { backendUrl: B, token: 't' });
    expect(h.headers.get('authorization')).toBe('Bearer t');
    expect(h.headers.get('a')).toBe('b');
    const arr = withWeatherAuth(`${B}/api/weather/grid`, { headers: [['a', 'b']] }, { backendUrl: B, token: 't' });
    expect(arr.headers).toEqual([['a', 'b'], ['Authorization', 'Bearer t']]);
  });

  test('never overrides an explicit Authorization, never sends without a token, honours the kill switch', () => {
    const init = { headers: { authorization: 'Bearer mine' } };
    expect(withWeatherAuth(`${B}/api/weather/grid`, init, { backendUrl: B, token: 't' })).toBe(init);
    expect(withWeatherAuth(`${B}/api/weather/grid`, init, { backendUrl: B, token: null })).toBe(init);
    const i2 = { signal: 1 };
    expect(withWeatherAuth(`${B}/api/weather/grid`, i2, { backendUrl: B, token: 't', disabled: true })).toBe(i2);
  });

  test('reads the same stored session the apiClient uses, tolerating junk', () => {
    const mk = (v) => ({ getItem: () => v });
    expect(storedAccessToken(mk(JSON.stringify({ access_token: 'abc' })))).toBe('abc');
    expect(storedAccessToken(mk('{bad'))).toBe(null);
    expect(storedAccessToken(mk(null))).toBe(null);
  });

  test('install wraps fetch once and passes the authorised init through', async () => {
    const seen = [];
    const win = {
      fetch: (input, init) => { seen.push([input, init]); return Promise.resolve('ok'); },
      localStorage: { getItem: () => JSON.stringify({ access_token: 'tok' }) },
    };
    expect(installWeatherAuthFetch(win)).toBe(true);
    expect(installWeatherAuthFetch(win)).toBe(false);
    await win.fetch('/api/weather/spot-ratings?x=1');
    await win.fetch('/api/health');
    expect(seen[0][1].headers.Authorization).toBe('Bearer tok');
    expect(seen[1][1]).toBeUndefined();
    win.__RAW_DISABLE_WEATHER_AUTH__ = true;
    await win.fetch('/api/weather/grid');
    expect(seen[2][1]).toBeUndefined();
  });
});
