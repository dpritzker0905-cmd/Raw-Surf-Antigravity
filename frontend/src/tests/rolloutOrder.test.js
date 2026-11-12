/**
 * ROLLOUT ORDER (#782 / #783, owner 2026-11-12: "test pinning the rollout order").
 *
 * The server switch (WEATHER_TIER_CLAMP, accounts only) refuses any forecast read without a verified token. So the
 * client half has to be live FIRST, and has to be harmless on its own:
 *   1. server ON, client half wired: a signed-in PAYING user's map reads carry the token and get the paid window, never
 *      the empty signed-out answer (also across the flip, before the client has seen the switch);
 *   2. client half wired, server OFF: nothing changes for anyone (no header, no preflight, the same answers);
 *   3. the wiring itself: index.js installs the wrapper before the app runs. Remove it (or the token logic) and 1 fails.
 * The backend twin is test_weather_tier_clamp.py::test_a_paying_user_whose_token_does_not_reach_the_server_gets_an_empty_window.
 */
import fs from 'fs';
import path from 'path';
import { installWeatherAuthFetch } from '../lib/weatherAuthFetch';
import { _resetStaticFramesForTest, getPinnedIndex, setKeyFor } from '../components/map/staticFrames';
import { _resetFrameSignerForTest, FRAME_URLS_PATH } from '../components/map/staticFrameSigner';

const B = 'https://api.example.test';
const READ = `${B}/api/weather/grid_series?model=EURO&hours=0,240`;
const PREMIUM = 'premium-token';

/** A stand-in for the backend: the paid window for the premium token, accounts only while the switch is ON. */
function server({ clampOn }) {
  const seen = [];
  const fetch = (url, init) => {
    const h = (init && init.headers) || {};
    const auth = h.Authorization || h.authorization || null;
    seen.push({ url, auth });
    if (!clampOn) {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({}), json: async () => ({ window_h: 240 }) });
    }
    if (auth !== `Bearer ${PREMIUM}`) {
      return Promise.resolve({ ok: false, status: 401, headers: new Headers({ 'X-Raw-Tier-Clamp-On': '1', 'X-Raw-Tier-Clamp': 'account' }),
        json: async () => ({ detail: 'sign_in_required' }) });
    }
    return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'X-Raw-Tier-Clamp-On': '1' }), json: async () => ({ window_h: 240 }) });
  };
  return { fetch, seen };
}

function browser({ clampOn, token, capsKnown = true }) {
  const srv = server({ clampOn });
  const win = {
    fetch: srv.fetch,
    localStorage: { getItem: (k) => (k === 'raw-surf-user' && token ? JSON.stringify({ access_token: token }) : null) },
    __WEATHER_CAPABILITIES__: capsKnown ? [{ model: 'GFS', tier_clamp: clampOn }] : undefined,
    location: { pathname: '/map', search: '' },
    CustomEvent: function CE(type) { this.type = type; },
    dispatchEvent: () => true,
    __BACKEND_URL__: B,
  };
  return { win, srv };
}

beforeAll(() => { window.__BACKEND_URL__ = B; });

describe('rollout order: client half first, then the server switch', () => {
  test('1. server ON: a signed-in paying user gets the paid window, with the token on the request', async () => {
    const { win, srv } = browser({ clampOn: true, token: PREMIUM });
    installWeatherAuthFetch(win);
    const res = await win.fetch(READ.replace(B, ''));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ window_h: 240 });
    expect(srv.seen.map((s) => s.auth)).toEqual([`Bearer ${PREMIUM}`]);
  });

  test('1b. at the flip (the client has not seen the switch yet): one refused read, re-asked with the token, paid window', async () => {
    const { win, srv } = browser({ clampOn: true, token: PREMIUM, capsKnown: false });
    installWeatherAuthFetch(win);
    const res = await win.fetch(READ.replace(B, ''));
    expect(res.status).toBe(200);
    expect(srv.seen.map((s) => s.auth)).toEqual([null, `Bearer ${PREMIUM}`]);
  });

  test('1c. WITHOUT the client half, the same paying user gets the empty signed-out answer (why the order matters)', async () => {
    const { win } = browser({ clampOn: true, token: PREMIUM });
    const res = await win.fetch(READ.replace(B, ''));                    // no wrapper installed
    expect(res.status).toBe(401);
  });

  test('2. client half alone, server OFF: nothing changes for anyone', async () => {
    for (const token of [PREMIUM, null]) {
      const bare = browser({ clampOn: false, token });
      const wired = browser({ clampOn: false, token });
      installWeatherAuthFetch(wired.win);
      const init = { signal: 'S' };
      const a = await bare.win.fetch(READ.replace(B, ''), init);
      const b = await wired.win.fetch(READ.replace(B, ''), init);
      expect([b.status, await b.json()]).toEqual([a.status, await a.json()]);
      expect(wired.srv.seen).toEqual(bare.srv.seen);                   // no Authorization header, so no CORS preflight
      expect(wired.srv.seen[0].auth).toBe(null);
    }
  });

  test('3. the wiring: index.js installs the wrapper at module load, before the app renders', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');      // comments do not count
    expect(src).toMatch(/import\s*\{\s*installWeatherAuthFetch\s*\}\s*from\s*'\.\/lib\/weatherAuthFetch'/);
    const call = src.search(/^\s*installWeatherAuthFetch\(\s*\)\s*;/m);
    const render = src.search(/\.render\(|createRoot\(/);
    expect(call).toBeGreaterThan(-1);
    expect(render === -1 || call < render).toBe(true);
  });
});


describe('rollout order, static frames (#783): the signer is wired into the real index loader', () => {
  const realFetch = global.fetch;
  const BASE = 'https://cdn.test/weather-frames/';
  const VT = '2026-10-23T06:00:00Z';
  const KEY = setKeyFor('GFS', 'waves');
  const INDEX = { path: 'v1/gfs/marine/waves/global_mid/index/20261019T180000Z-abcdefabcdef.json', encoding_version: 1,
    transform_version: 1, frames: [{ valid_time: VT, is_estimated: false, entitlement: 'free' }] };   // path-free (public copy)
  const SIGNED = `https://sb.test/storage/v1/object/sign/weather-frames-private/v1/f/${VT}.bin?token=T`;
  const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });
  let calls;
  beforeEach(() => {
    _resetStaticFramesForTest(); _resetFrameSignerForTest();
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url, auth: init && init.headers && init.headers.Authorization });
      if (url === `${BASE}v1/latest.json`) return ok({ version: 1, sets: { [KEY]: { index: INDEX.path, run: 'r' } } });
      if (url === BASE + INDEX.path) return ok(INDEX);
      if (url.includes(FRAME_URLS_PATH)) {
        return init && init.headers && init.headers.Authorization === 'Bearer free-tok'
          ? ok({ tier: 'free', frames: [{ valid_time: VT, class: 'free', object: `v1/f/${VT}.bin`, url: SIGNED }] })
          : { ok: false, status: 401, headers: new Headers({ 'X-Raw-Tier-Clamp': 'account' }), json: async () => ({}) };
      }
      return { ok: false, status: 400, json: async () => ({}) };
    });
  });
  afterEach(() => {
    delete window.__RAW_STATIC_FRAMES_BASE__;
    window.localStorage.removeItem('raw-surf-user');
    global.fetch = realFetch;
  });

  test('4. switch ON: a signed-in FREE account pins an index whose free hours carry signed URLs', async () => {
    window.localStorage.setItem('raw-surf-user', JSON.stringify({ access_token: 'free-tok' }));
    const pinned = await getPinnedIndex(KEY);
    expect(pinned.frames[0]).toMatchObject({ path: `v1/f/${VT}.bin`, url: SIGNED });
    expect(calls.filter((c) => c.url.includes(FRAME_URLS_PATH)).map((c) => c.auth)).toEqual(['Bearer free-tok']);
  });

  test('4b. signed out: no signing call, every hour stays unbuilt (served nothing)', async () => {
    const pinned = await getPinnedIndex(KEY);
    expect(pinned.frames[0].path).toBeUndefined();
    expect(calls.some((c) => c.url.includes(FRAME_URLS_PATH))).toBe(false);
  });
});
