import {
  withWeatherAuth, isBackendWeatherUrl, storedAccessToken, installWeatherAuthFetch, tierClampOn,
} from '../lib/weatherAuthFetch';

const B = 'https://api.example.test';

function res(headers = {}) {
  return { ok: true, headers: new Headers(headers) };
}

function makeWin({ caps, responses = [] } = {}) {
  const seen = [];
  const queue = [...responses];
  const win = {
    fetch: (input, init) => { seen.push([input, init]); return Promise.resolve(queue.length ? queue.shift() : res()); },
    localStorage: { getItem: () => JSON.stringify({ access_token: 'tok' }) },
    __WEATHER_CAPABILITIES__: caps,
  };
  installWeatherAuthFetch(win);
  return { win, seen };
}

const auth = (init) => (init && init.headers && init.headers.Authorization) || null;

describe('weatherAuthFetch (O5 client half, one switch with the server clamp)', () => {
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
    const h = withWeatherAuth(`${B}/api/weather/grid`, { headers: new Headers({ a: 'b' }) }, { backendUrl: B, token: 't' });
    expect(h.headers.get('authorization')).toBe('Bearer t');
    const arr = withWeatherAuth(`${B}/api/weather/grid`, { headers: [['a', 'b']] }, { backendUrl: B, token: 't' });
    expect(arr.headers).toEqual([['a', 'b'], ['Authorization', 'Bearer t']]);
    const own = { headers: { authorization: 'Bearer mine' } };
    expect(withWeatherAuth(`${B}/api/weather/grid`, own, { backendUrl: B, token: 't' })).toBe(own);
  });

  test('reads the same stored session the apiClient uses, tolerating junk', () => {
    const mk = (v) => ({ getItem: () => v });
    expect(storedAccessToken(mk(JSON.stringify({ access_token: 'abc' })))).toBe('abc');
    expect(storedAccessToken(mk('{bad'))).toBe(null);
    expect(storedAccessToken(mk(null))).toBe(null);
  });

  test('CLAMP OFF: no Authorization and no added header of any kind (so no CORS preflight)', async () => {
    const init = { signal: 'S' };
    const { win, seen } = makeWin({ caps: [{ model: 'GFS', tier_clamp: false }] });
    await win.fetch('/api/weather/grid_series?model=GFS&hours=0', init);
    expect(seen[0][1]).toBe(init);                       // the caller's init object, untouched
    const { win: w2, seen: s2 } = makeWin({ caps: undefined });   // capabilities not loaded yet: OFF
    await w2.fetch('/api/weather/grid?x=1');
    expect(s2[0][1]).toBeUndefined();
  });

  test('CLAMP ON (capabilities): the token is sent; non-weather URLs are never touched', async () => {
    const { win, seen } = makeWin({ caps: [{ model: 'GFS', tier_clamp: true }] });
    await win.fetch('/api/weather/spot-ratings?x=1');
    await win.fetch('/api/health');
    expect(auth(seen[0][1])).toBe('Bearer tok');
    expect(seen[1][1]).toBeUndefined();
  });

  test('a manifest flip is followed from the response header, both ways', async () => {
    const { win, seen } = makeWin({
      caps: [{ tier_clamp: false }],
      responses: [res({ 'X-Raw-Tier-Clamp-On': '1' }), res({}), res({})],
    });
    await win.fetch('/api/weather/grid?a=1');           // OFF by capabilities: no token; learns ON
    expect(tierClampOn(win)).toBe(true);
    await win.fetch('/api/weather/grid?a=2');           // now sent; this answer has no ON header -> back OFF
    await win.fetch('/api/weather/grid?a=3');
    expect([auth(seen[0][1]), auth(seen[1][1]), auth(seen[2][1])]).toEqual([null, 'Bearer tok', null]);
  });

  test('self-heal: an answer clamped before we knew is re-requested once with the token', async () => {
    const { win, seen } = makeWin({
      caps: [{ tier_clamp: false }],
      responses: [res({ 'X-Raw-Tier-Clamp-On': '1', 'X-Raw-Tier-Clamp': 'model' }), res({ 'X-Raw-Tier-Clamp-On': '1' })],
    });
    const out = await win.fetch('/api/weather/grid_series?model=EURO&hours=0');
    expect(seen.length).toBe(2);
    expect(auth(seen[0][1])).toBe(null);
    expect(auth(seen[1][1])).toBe('Bearer tok');
    expect(out.headers.get('x-raw-tier-clamp')).toBe(null);   // the caller gets the un-clamped answer
  });

  test('kill switch: never a token, never a retry', async () => {
    const { win, seen } = makeWin({
      caps: [{ tier_clamp: true }],
      responses: [res({ 'X-Raw-Tier-Clamp-On': '1', 'X-Raw-Tier-Clamp': 'model' })],
    });
    win.__RAW_DISABLE_WEATHER_AUTH__ = true;
    await win.fetch('/api/weather/grid?x=1');
    expect(seen.length).toBe(1);
    expect(seen[0][1]).toBeUndefined();
  });

  // ── accounts only (#782, owner 2026-11-12) ────────────────────────────────────────────────────────────────────
  const refused = () => ({ ok: false, status: 401, headers: new Headers({ 'X-Raw-Tier-Clamp-On': '1', 'X-Raw-Tier-Clamp': 'account' }) });
  function withEvents(win) {
    const events = [];
    win.location = { pathname: '/map', search: '' };
    win.CustomEvent = function CE(type) { this.type = type; };
    win.dispatchEvent = (e) => { events.push(e.type); return true; };
    return events;
  }

  test('accounts only: a signed-in read refused before we knew the switch is re-asked with the token, no prompt', async () => {
    const { win, seen } = makeWin({ caps: [{ tier_clamp: false }], responses: [refused(), res({ 'X-Raw-Tier-Clamp-On': '1' })] });
    const events = withEvents(win);
    const out = await win.fetch('/api/weather/point?lat=1&lng=2');
    expect([auth(seen[0][1]), auth(seen[1][1])]).toEqual([null, 'Bearer tok']);
    expect(out.status).toBeUndefined();                  // the caller gets the account's answer, not the 401
    expect(events).toEqual([]);
  });

  test('accounts only: a read refused WITH our token is an expired session and raises the sign-in prompt', async () => {
    const { win, seen } = makeWin({ caps: [{ tier_clamp: true }], responses: [refused()] });
    const events = withEvents(win);
    const out = await win.fetch('/api/weather/grid_series?model=GFS&hours=0');
    expect(seen.length).toBe(1);                         // no retry: the token WAS sent
    expect(out.status).toBe(401);
    expect(events).toEqual(['raw:weather-session-expired']);
  });

  test('accounts only: the retry with the token refused too is an expired session', async () => {
    const { win, seen } = makeWin({ caps: [{ tier_clamp: false }], responses: [refused(), refused()] });
    const events = withEvents(win);
    await win.fetch('/api/weather/point?lat=1&lng=2');
    expect(seen.length).toBe(2);
    expect(events).toEqual(['raw:weather-session-expired']);
  });

  test('accounts only: signed out, a refusal is served as is (no retry, no prompt)', async () => {
    const { win, seen } = makeWin({ caps: [{ tier_clamp: true }], responses: [refused()] });
    win.localStorage = { getItem: () => null };
    const events = withEvents(win);
    const out = await win.fetch('/api/weather/grid?x=1');
    expect(seen.length).toBe(1);
    expect(seen[0][1]).toBeUndefined();
    expect(out.status).toBe(401);
    expect(events).toEqual([]);
  });

  test('a 401 that is not the accounts-only refusal never raises the prompt', async () => {
    const other = { ok: false, status: 401, headers: new Headers({ 'X-Raw-Tier-Clamp-On': '1' }) };
    const { win } = makeWin({ caps: [{ tier_clamp: true }], responses: [other] });
    const events = withEvents(win);
    await win.fetch('/api/weather/grid?x=1');
    expect(events).toEqual([]);
  });

  test('install wraps fetch only once', () => {
    const win = { fetch: () => Promise.resolve(res()), localStorage: { getItem: () => null } };
    expect(installWeatherAuthFetch(win)).toBe(true);
    expect(installWeatherAuthFetch(win)).toBe(false);
  });
});
