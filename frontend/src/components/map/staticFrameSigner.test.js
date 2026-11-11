/**
 * O6 client half (staticFrameSigner.js): paid hours of a public index get signed objects from /api/weather/frame-urls, once
 * per index, before the index resolves; every failure leaves them unbuilt (-> /grid, as before). The end-to-end tests run the
 * REAL loaders: a per-frame world set (golden frame bytes) and a regional bundle set (the real RSWF frame, sha12-checked slice).
 */
import crypto from 'crypto';
import zlib from 'zlib';
import {
  FRAME_URLS_PATH, SIGNER_OFF_BACKOFF_MS, _resetFrameSignerForTest, applySignedFrames, paidUnbuilt, signPaidFrames,
} from './staticFrameSigner';
import { _resetStaticFramesForTest, getPinnedIndex, loadFrameVectors, setKeyFor } from './staticFrames';
import { _resetRegionalForTest, _setRegionalCodecForTest, normalizeBundleIndex, regionalFrameBytes } from './staticRegional';
import { goldenBuffer } from './staticFrameGolden.fixture';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';

const API = 'https://api.test';
const SIGNED = 'https://sb.test/storage/v1/object/sign/weather-frames-paid/';
const VT0 = '2026-10-20T00:00:00Z';
const VT1 = '2026-10-23T06:00:00Z';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

function publicIndex() {
  return {
    path: 'v1/gfs/marine/waves/global_mid/index/20261019T180000Z-abcdefabcdef.json', encoding_version: 1, transform_version: 1,
    frames: [
      { valid_time: VT0, is_estimated: false, path: `v1/f/a/${VT0}.bin` },
      { valid_time: VT1, is_estimated: false, paid: 'basic' },
    ],
  };
}
const SIGN_BODY = {
  tier: 'premium',
  frames: [{ valid_time: VT1, class: 'basic', object: `v1/f/a/${VT1}.bin`, url: `${SIGNED}v1/f/a/${VT1}.bin?token=T` }],
};

describe('applySignedFrames (pure)', () => {
  test('a per-frame item gives path (the cache key) and url; public entries are never touched', () => {
    const idx = publicIndex();
    expect(paidUnbuilt(idx)).toHaveLength(1);
    expect(applySignedFrames(idx, SIGN_BODY)).toBe(1);
    expect(idx.frames[1]).toMatchObject({ path: `v1/f/a/${VT1}.bin`, url: SIGN_BODY.frames[0].url, paid: 'basic' });
    expect(idx.frames[0]).toEqual(publicIndex().frames[0]);
    expect(paidUnbuilt(idx)).toHaveLength(0);
  });

  test('a bundle item becomes a slice record keyed by the class bundle; malformed or unmatched items are skipped', () => {
    const idx = { path: 'p', frames: [{ valid_time: VT0, paid: 'premium', offset: null }, { valid_time: VT1, paid: 'premium', offset: null }] };
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

describe('signPaidFrames', () => {
  beforeEach(() => { _resetFrameSignerForTest(); delete window.__RAW_DISABLE_FRAME_SIGNER__; });

  test('one authorized call per index; the answer is applied before the index resolves', async () => {
    const fetchImpl = jest.fn(async () => json(SIGN_BODY));
    const idx = await signPaidFrames(publicIndex(), { fetchImpl, token: 'tok', backendUrl: API });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${API}${FRAME_URLS_PATH}?index=${encodeURIComponent(publicIndex().path)}`);
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer tok' }, credentials: 'omit' });
    expect(idx.frames[1].url).toBe(SIGN_BODY.frames[0].url);
    expect(window.__RAW_FRAME_SIGNER__).toMatchObject({ calls: 1, applied: 1, errors: 0 });
  });

  test('no call: no paid entries, no token (guest), the kill switch; a guest/free answer stops calls for that token', async () => {
    const fetchImpl = jest.fn(async () => json({ tier: 'free', frames: [] }));
    const noPaid = { path: 'p', frames: [publicIndex().frames[0]] };
    await signPaidFrames(noPaid, { fetchImpl, token: 'tok', backendUrl: API });
    await signPaidFrames(publicIndex(), { fetchImpl, token: null, backendUrl: API });
    window.__RAW_DISABLE_FRAME_SIGNER__ = true;
    await signPaidFrames(publicIndex(), { fetchImpl, token: 'tok', backendUrl: API });
    delete window.__RAW_DISABLE_FRAME_SIGNER__;
    expect(fetchImpl).not.toHaveBeenCalled();
    const a = await signPaidFrames(publicIndex(), { fetchImpl, token: 'free-tok', backendUrl: API });
    await signPaidFrames(publicIndex(), { fetchImpl, token: 'free-tok', backendUrl: API });
    expect(fetchImpl).toHaveBeenCalledTimes(1);                                // free: one call per session
    expect(paidUnbuilt(a)).toHaveLength(1);                                    // still unbuilt -> /grid
    await signPaidFrames(publicIndex(), { fetchImpl, token: 'other-tok', backendUrl: API });
    expect(fetchImpl).toHaveBeenCalledTimes(2);                                // a different sign-in asks again
    expect(window.__RAW_FRAME_SIGNER__.skipped).toMatchObject({ no_token: 1, killed: 1, tier_has_none: 1 });
  });

  test('failures leave the hours unbuilt; a 404 (server held off) backs off, then asks again', async () => {
    let now = 1000;
    let answer = () => json({}, 404);
    const fetchImpl = jest.fn(async () => answer());
    const opts = { fetchImpl, token: 'tok', backendUrl: API, now: () => now };
    expect(paidUnbuilt(await signPaidFrames(publicIndex(), opts))).toHaveLength(1);
    await signPaidFrames(publicIndex(), opts);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += SIGNER_OFF_BACKOFF_MS + 1;
    answer = () => { throw new TypeError('Failed to fetch'); };
    expect(paidUnbuilt(await signPaidFrames(publicIndex(), opts))).toHaveLength(1);
    answer = () => json({}, 401);
    expect(paidUnbuilt(await signPaidFrames(publicIndex(), opts))).toHaveLength(1);
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

  test('a world set: the paid hour is fetched from its SIGNED url, never from the public bucket', async () => {
    const KEY = setKeyFor('GFS', 'waves');
    const idx = publicIndex();
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      if (url === `${BASE}v1/latest.json`) return json({ version: 1, sets: { [KEY]: { index: idx.path, run: 'r' } } });
      if (url === BASE + idx.path) return json(idx);
      if (url.includes(FRAME_URLS_PATH)) return json(SIGN_BODY);
      if (url === SIGN_BODY.frames[0].url) { const b = goldenBuffer(VT1); return { ok: true, status: 200, arrayBuffer: async () => b.slice(0) }; }
      return json({}, 400);
    });
    const pinned = await getPinnedIndex(KEY);
    expect(pinned.frames[1].url).toBe(SIGN_BODY.frames[0].url);
    expect(await loadFrameVectors(KEY, pinned.frames[1])).toBeTruthy();
    expect(calls).toContain(SIGN_BODY.frames[0].url);
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
      frames: [{ valid_time: VT1, paid: 'basic', offset: null, length: null, sha12: null }] });
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
