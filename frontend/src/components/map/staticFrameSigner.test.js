/**
 * O6 client half (staticFrameSigner.js), ACCOUNTS ONLY: the hours of a public (path-free) index get signed objects from
 * /api/weather/frame-urls, once per index, before the index resolves, for ANY signed-in account (free included); signed out
 * makes no call; every failure leaves them unbuilt (-> /grid, as before); a refused token raises the sign-in prompt. The end-to-end tests run the
 * REAL loaders: a per-frame world set (golden frame bytes) and a regional bundle set (the real RSWF frame, sha12-checked slice).
 */
import crypto from 'crypto';
import zlib from 'zlib';
import {
  FRAME_URLS_PATH, SIGNER_OFF_BACKOFF_MS, _resetFrameSignerForTest, applySignedFrames, unsignedEntries, signEntitledFrames,
} from './staticFrameSigner';
import { _resetStaticFramesForTest, getPinnedIndex, loadFrameVectors, setKeyFor } from './staticFrames';
import { _resetRegionalForTest, _setRegionalCodecForTest, normalizeBundleIndex, regionalFrameBytes } from './staticRegional';
import { goldenBuffer } from './staticFrameGolden.fixture';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';

const API = 'https://api.test';
const SIGNED = 'https://sb.test/storage/v1/object/sign/weather-frames-private/';
const VT0 = '2026-10-20T00:00:00Z';
const VT1 = '2026-10-23T06:00:00Z';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

function publicIndex() {
  return {
    path: 'v1/gfs/marine/waves/global_mid/index/20261019T180000Z-abcdefabcdef.json', encoding_version: 1, transform_version: 1,
    frames: [
      { valid_time: VT0, is_estimated: false, entitlement: 'free' },
      { valid_time: VT1, is_estimated: false, entitlement: 'basic' },
    ],
  };
}
const SIGN_BODY = {
  tier: 'premium',
  frames: [
    { valid_time: VT0, class: 'free', object: `v1/f/a/${VT0}.bin`, url: `${SIGNED}v1/f/a/${VT0}.bin?token=T` },
    { valid_time: VT1, class: 'basic', object: `v1/f/a/${VT1}.bin`, url: `${SIGNED}v1/f/a/${VT1}.bin?token=T` },
  ],
};

describe('applySignedFrames (pure)', () => {
  test('a per-frame item gives path (the cache key) and url, for EVERY class, free included', () => {
    const idx = publicIndex();
    expect(unsignedEntries(idx)).toHaveLength(2);
    expect(applySignedFrames(idx, SIGN_BODY)).toBe(2);
    expect(idx.frames[0]).toMatchObject({ path: `v1/f/a/${VT0}.bin`, url: SIGN_BODY.frames[0].url, entitlement: 'free' });
    expect(idx.frames[1]).toMatchObject({ path: `v1/f/a/${VT1}.bin`, url: SIGN_BODY.frames[1].url, entitlement: 'basic' });
    expect(unsignedEntries(idx)).toHaveLength(0);
  });

  test('a free account gets only its class; the other hours stay unbuilt (-> /grid, clamped to free)', () => {
    const idx = publicIndex();
    expect(applySignedFrames(idx, { tier: 'free', frames: [SIGN_BODY.frames[0]] })).toBe(1);
    expect(unsignedEntries(idx).map((f) => f.entitlement)).toEqual(['basic']);
  });

  test('a bundle item becomes a slice record keyed by the class bundle; malformed or unmatched items are skipped', () => {
    const idx = { path: 'p', frames: [{ valid_time: VT0, entitlement: 'premium', offset: null }, { valid_time: VT1, entitlement: 'premium', offset: null }] };
    const n = applySignedFrames(idx, { frames: [
      { valid_time: VT0, object: 'b/bundle-premium-x.bin', url: 'https://s/b?t', bundle_bytes: 99, offset: 10, length: 5, sha12: 'aaaaaaaaaaaa' },
      { valid_time: VT1, object: 'b/bundle-premium-x.bin', url: 'https://s/b?t', offset: 'x', length: 5, sha12: 'a' },   // bad offset
      { valid_time: '2030-01-01T00:00:00Z', object: 'o', url: 'u' },                                                  // no such hour
    ] });
    expect(n).toBe(1);
    expect(idx.frames[0]).toMatchObject({ path: 'b/bundle-premium-x.bin#10',
      bundle: { path: 'b/bundle-premium-x.bin', url: 'https://s/b?t', bytes: 99, offset: 10, length: 5, sha12: 'aaaaaaaaaaaa' } });
    expect(idx.frames[1].path).toBeUndefined();
  });
});

describe('signEntitledFrames', () => {
  beforeEach(() => { _resetFrameSignerForTest(); delete window.__RAW_DISABLE_FRAME_SIGNER__; });

  test('one authorized call per index; the answer is applied before the index resolves', async () => {
    const fetchImpl = jest.fn(async () => json(SIGN_BODY));
    const idx = await signEntitledFrames(publicIndex(), { fetchImpl, token: 'tok', backendUrl: API });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${API}${FRAME_URLS_PATH}?index=${encodeURIComponent(publicIndex().path)}`);
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer tok' }, credentials: 'omit' });
    expect(idx.frames[1].url).toBe(SIGN_BODY.frames[1].url);
    expect(window.__RAW_FRAME_SIGNER__).toMatchObject({ calls: 1, applied: 2, errors: 0 });
  });

  test('no call: nothing to sign, SIGNED OUT (no token: nothing served), the kill switch', async () => {
    const fetchImpl = jest.fn(async () => json(SIGN_BODY));
    const nothing = { path: 'p', frames: [{ valid_time: VT0, path: 'already/signed.bin', entitlement: 'free' }] };
    await signEntitledFrames(nothing, { fetchImpl, token: 'tok', backendUrl: API });
    const out = await signEntitledFrames(publicIndex(), { fetchImpl, token: null, backendUrl: API });
    expect(unsignedEntries(out)).toHaveLength(2);                               // signed out: every hour stays unbuilt
    window.__RAW_DISABLE_FRAME_SIGNER__ = true;
    await signEntitledFrames(publicIndex(), { fetchImpl, token: 'tok', backendUrl: API });
    delete window.__RAW_DISABLE_FRAME_SIGNER__;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(window.__RAW_FRAME_SIGNER__.skipped).toMatchObject({ no_token: 1, killed: 1 });
  });

  test('a FREE account asks for every index (it has a class now); only a guest answer stops calls for that token', async () => {
    const fetchImpl = jest.fn(async () => json({ tier: 'free', frames: [SIGN_BODY.frames[0]] }));
    const a = await signEntitledFrames(publicIndex(), { fetchImpl, token: 'free-tok', backendUrl: API });
    await signEntitledFrames(publicIndex(), { fetchImpl, token: 'free-tok', backendUrl: API });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(a.frames[0].url).toBe(SIGN_BODY.frames[0].url);
    const guest = jest.fn(async () => json({ tier: 'guest', frames: [] }));
    await signEntitledFrames(publicIndex(), { fetchImpl: guest, token: 'odd-tok', backendUrl: API });
    await signEntitledFrames(publicIndex(), { fetchImpl: guest, token: 'odd-tok', backendUrl: API });
    expect(guest).toHaveBeenCalledTimes(1);
    expect(window.__RAW_FRAME_SIGNER__.skipped).toMatchObject({ tier_has_none: 1 });
  });

  test('a refusal of OUR token (expired session) raises the sign-in prompt; any other 401 does not', async () => {
    const events = [];
    const win = { location: { pathname: '/map' }, CustomEvent: function CE(type) { this.type = type; },
      dispatchEvent: (e) => { events.push(e.type); return true; } };
    const refused = { ok: false, status: 401, headers: new Headers({ 'X-Raw-Tier-Clamp': 'account' }), json: async () => ({}) };
    const out = await signEntitledFrames(publicIndex(), { fetchImpl: async () => refused, token: 'old', backendUrl: API, win });
    expect(events).toEqual(['raw:weather-session-expired']);
    expect(unsignedEntries(out)).toHaveLength(2);
    await signEntitledFrames(publicIndex(), { fetchImpl: async () => json({}, 401), token: 'old', backendUrl: API, win });
    expect(events).toHaveLength(1);
  });

  test('failures leave the hours unbuilt; a 404 (server held off) backs off, then asks again', async () => {
    let now = 1000;
    let answer = () => json({}, 404);
    const fetchImpl = jest.fn(async () => answer());
    const opts = { fetchImpl, token: 'tok', backendUrl: API, now: () => now };
    expect(unsignedEntries(await signEntitledFrames(publicIndex(), opts))).toHaveLength(2);
    await signEntitledFrames(publicIndex(), opts);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += SIGNER_OFF_BACKOFF_MS + 1;
    answer = () => { throw new TypeError('Failed to fetch'); };
    expect(unsignedEntries(await signEntitledFrames(publicIndex(), opts))).toHaveLength(2);
    answer = () => json({}, 401);
    expect(unsignedEntries(await signEntitledFrames(publicIndex(), opts))).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(window.__RAW_FRAME_SIGNER__.errors).toBe(3);
  });
});

describe('end to end through the real loaders', () => {
  const realFetch = global.fetch;
  const BASE = 'https://cdn.test/weather-frames/';
  beforeEach(() => {
    _resetStaticFramesForTest(); _resetRegionalForTest(); _resetFrameSignerForTest();
    window.__RAW_STATIC_FRAMES_BASE__ = BASE;
    window.__BACKEND_URL__ = API;
    window.localStorage.setItem('raw-surf-user', JSON.stringify({ access_token: 'tok' }));
  });
  afterEach(() => {
    delete window.__RAW_STATIC_FRAMES_BASE__; delete window.__BACKEND_URL__;
    window.localStorage.removeItem('raw-surf-user');
    global.fetch = realFetch;
    _setRegionalCodecForTest();
  });

  test('a world set: the hour is fetched from its SIGNED url, never from the public bucket', async () => {
    const KEY = setKeyFor('GFS', 'waves');
    const idx = publicIndex();
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      if (url === `${BASE}v1/latest.json`) return json({ version: 1, sets: { [KEY]: { index: idx.path, run: 'r' } } });
      if (url === BASE + idx.path) return json(idx);
      if (url.includes(FRAME_URLS_PATH)) return json(SIGN_BODY);
      if (url === SIGN_BODY.frames[1].url) { const b = goldenBuffer(VT1); return { ok: true, status: 200, arrayBuffer: async () => b.slice(0) }; }
      return json({}, 400);
    });
    const pinned = await getPinnedIndex(KEY);
    expect(pinned.frames[1].url).toBe(SIGN_BODY.frames[1].url);
    expect(await loadFrameVectors(KEY, pinned.frames[1])).toBeTruthy();
    expect(calls).toContain(SIGN_BODY.frames[1].url);
    expect(calls.some((u) => u === `${BASE}v1/f/a/${VT1}.bin`)).toBe(false);
    expect(calls.filter((u) => u.includes(FRAME_URLS_PATH))).toHaveLength(1);
  });

  test('a regional bundle: the slice is read from the signed CLASS bundle and still sha12-checked', async () => {
    const GZ = Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64');
    const sha12 = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex').slice(0, 12);
    _setRegionalCodecForTest({ sha12: async (b) => sha12(b), gunzip: async (b) => Uint8Array.from(zlib.gunzipSync(Buffer.from(b))).buffer });
    const bundleObj = 'v1/gfs/marine/waves/test_big/20261019T180000Z/bundle-basic-0123456789ab.bin';
    const signedUrl = `${SIGNED}${bundleObj}?token=T`;
    const idx = normalizeBundleIndex({ path: 'v1/gfs/marine/waves/test_big/index/r-abc.json', bundle: null,
      frames: [{ valid_time: VT1, entitlement: 'basic', offset: null, length: null, sha12: null }] });
    applySignedFrames(idx, { frames: [{ valid_time: VT1, object: bundleObj, url: signedUrl, bundle_bytes: GZ.length, offset: 0,
      length: GZ.length, sha12: sha12(GZ) }] });
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      if (url === signedUrl) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(GZ).buffer };
      return json({}, 400);
    });
    const got = await regionalFrameBytes(BASE, idx.frames[0]);
    expect(Buffer.from(got.buffer).equals(zlib.gunzipSync(GZ))).toBe(true);
    expect(calls).toEqual([signedUrl]);
    const bad = await regionalFrameBytes(BASE, { ...idx.frames[0], bundle: { ...idx.frames[0].bundle, sha12: '000000000000' } });
    expect(bad).toMatchObject({ error: 'sha12_mismatch', status: 'integrity' });   // a wrong signed object is never decoded
  });
});
