/**
 * Radar advection off the main thread (2026-11-12): radarAdvectCore (the shared per-tile pipeline), radarAdvectWorker (the
 * message protocol), radarAdvectClient (fail-open + abort) and the kill switch through the real advect-rv protocol handler.
 * Kill: window.__RAW_DISABLE_RADAR_ADVECT_WORKER__ = true -> the main-thread warp + PNG encode, as before.
 */
import {
  estimateMotion, advectTile, advectTileWithNeighbors, advectTileSmoothField, SMOOTH_MOTION_OPTS,
} from './radarAdvection';
import { createAdvectPipeline, parseAdvectUrl, neighborTileUrl, pruneOldest, AdvectCancelled } from './radarAdvectCore';

const N = 64;
const tileUrl = (frame, x, y) => `https://tilecache.rainviewer.com/v2/radar/${frame}/256/5/${x}/${y}/7/1_0.png`;
const PREV = tileUrl('100', 9, 12);
const CURR = tileUrl('200', 9, 12);
const advectUrl = (lead) => `advect-rv://${lead}|${PREV}|${CURR}`;

// A solid echo block at (x0, y0), 20 px square, on an N x N transparent tile.
function blockTile(x0, y0) {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = y0; y < y0 + 20; y++) for (let x = x0; x < x0 + 20; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const i = (y * N + x) * 4;
    d[i] = 40; d[i + 1] = 200; d[i + 2] = 60; d[i + 3] = 255;
  }
  return d;
}

// The observed world: frame 100 has the block at x=12, frame 200 at x=20 (8 px east in one interval), in every tile.
function world({ missing = [] } = {}) {
  const calls = [];
  const getTile = async (url) => {
    calls.push(url);
    if (missing.some((m) => url.includes(m))) throw new Error('advect tile 404');
    return { data: blockTile(url.includes('/100/') ? 12 : 20, 22), w: N, h: N };
  };
  return { getTile, calls };
}

describe('radarAdvectCore: the URL and the caches', () => {
  it('parses advect-rv://<lead>|<prev>|<curr> and rejects malformed input', () => {
    expect(parseAdvectUrl(advectUrl(1.5))).toEqual({ leadFactor: 1.5, prevUrl: PREV, currUrl: CURR });
    expect(parseAdvectUrl('advect-rv://abc|' + PREV + '|' + CURR)).toBeNull();
    expect(parseAdvectUrl('advect-rv://1.5|' + PREV)).toBeNull();
    expect(parseAdvectUrl('advect-rv://nothing')).toBeNull();
    expect(parseAdvectUrl(undefined)).toBeNull();
  });

  it('pruneOldest drops the oldest entry only past the cap', () => {
    const m = new Map([['a', { ts: 3 }], ['b', { ts: 1 }], ['c', { ts: 2 }]]);
    pruneOldest(m, 3);
    expect(m.size).toBe(3);
    pruneOldest(m, 2);
    expect([...m.keys()]).toEqual(['a', 'c']);
  });
});

describe('radarAdvectCore: the warp is the same arithmetic as before the move', () => {
  it('smooth field (default): equals advectTileSmoothField over the 3x3 neighbourhood', async () => {
    const { getTile } = world();
    const out = await createAdvectPipeline({ getTile }).warp(parseAdvectUrl(advectUrl(2)));
    const tiles = {}; const motions = {};
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
      tiles[`${gx},${gy}`] = blockTile(20, 22);
      motions[`${gx},${gy}`] = estimateMotion(blockTile(12, 22), blockTile(20, 22), N, N, SMOOTH_MOTION_OPTS);
    }
    const want = advectTileSmoothField(tiles, motions, N, N, 2);
    expect(out.w).toBe(N);
    expect(Buffer.from(out.data).equals(Buffer.from(want))).toBe(true);
    // positive control: the echo really moved (the warp is not the identity)
    expect(Buffer.from(out.data).equals(Buffer.from(blockTile(20, 22)))).toBe(false);
  });

  it('smoothOff: equals the neighbour-aware rigid warp', async () => {
    const { getTile } = world();
    const out = await createAdvectPipeline({ getTile }).warp(parseAdvectUrl(advectUrl(2)), { smoothOff: true });
    const m = estimateMotion(blockTile(12, 22), blockTile(20, 22), N, N);
    expect(Math.abs(m.dx * 2)).toBeGreaterThanOrEqual(1);
    const tiles = { '0,0': blockTile(20, 22) };
    const gxs = m.dx > 0 ? [-1, 0] : [0, 1];
    const gys = m.dy > 0 ? [-1, 0] : m.dy < 0 ? [0, 1] : [0];
    for (const gy of gys) for (const gx of gxs) if (gx || gy) tiles[`${gx},${gy}`] = blockTile(20, 22);
    const want = advectTileWithNeighbors(tiles, N, N, m.dx * 2, m.dy * 2);
    expect(Buffer.from(out.data).equals(Buffer.from(want))).toBe(true);
  });

  it('neighborOff: equals the isolated rigid warp and asks for no neighbour tile', async () => {
    const { getTile, calls } = world();
    const out = await createAdvectPipeline({ getTile }).warp(parseAdvectUrl(advectUrl(2)), { neighborOff: true });
    const m = estimateMotion(blockTile(12, 22), blockTile(20, 22), N, N);
    expect(Buffer.from(out.data).equals(Buffer.from(advectTile(blockTile(20, 22), N, N, m.dx * 2, m.dy * 2)))).toBe(true);
    expect(calls.sort()).toEqual([PREV, CURR].sort());
  });

  it('motion is estimated once per observed pair and reused across leads', async () => {
    const { getTile, calls } = world();
    const p = createAdvectPipeline({ getTile });
    await p.warp(parseAdvectUrl(advectUrl(1)), { neighborOff: true });
    const prevAsks = calls.filter((u) => u === PREV).length;
    await p.warp(parseAdvectUrl(advectUrl(2)), { neighborOff: true });
    await p.warp(parseAdvectUrl(advectUrl(3)), { neighborOff: true });
    expect(calls.filter((u) => u === PREV).length).toBe(prevAsks);     // the previous frame was never read again
    expect(p.motionCache.size).toBe(1);
  });

  it('a missing neighbour still yields a tile; a missing centre tile rejects (the caller serves transparent)', async () => {
    const west = neighborTileUrl(CURR, -1, 0);
    const ok = await createAdvectPipeline({ getTile: world({ missing: [west.slice(-22)] }).getTile }).warp(parseAdvectUrl(advectUrl(2)));
    expect(ok.data.length).toBe(N * N * 4);
    await expect(createAdvectPipeline({ getTile: world({ missing: ['/200/256/5/9/12/'] }).getTile })
      .warp(parseAdvectUrl(advectUrl(2)))).rejects.toThrow('404');
  });

  it('a cancelled request stops with AdvectCancelled', async () => {
    const { getTile } = world();
    await expect(createAdvectPipeline({ getTile }).warp(parseAdvectUrl(advectUrl(2)), {}, () => true))
      .rejects.toBeInstanceOf(AdvectCancelled);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The worker's message protocol, driven through self.onmessage with the browser pieces stubbed.
// ---------------------------------------------------------------------------------------------------------------------------
describe('radarAdvectWorker: the message protocol', () => {
  const saved = {};
  let posted; let fetches;

  class FakeImageData {
    constructor(a, b, c) {
      if (typeof a === 'number') { this.data = new Uint8ClampedArray(a * b * 4); this.width = a; this.height = b; }
      else { this.data = a; this.width = b; this.height = c; }
    }
  }
  class FakeOffscreen {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      let drawn = null;
      return { drawImage: (b) => { drawn = b; }, getImageData: () => ({ data: drawn.pixels }) };
    }
  }

  function boot({ status = () => 200 } = {}) {
    posted = []; fetches = [];
    global.OffscreenCanvas = FakeOffscreen;
    global.ImageData = FakeImageData;
    global.fetch = jest.fn(async (url) => {
      fetches.push(url);
      const s = status(url);
      return { ok: s === 200, status: s, blob: async () => ({ tileUrl: url }) };
    });
    global.createImageBitmap = jest.fn(async (src) => (src instanceof FakeImageData
      ? { kind: 'out', img: src }
      : { kind: 'decoded', width: N, height: N, pixels: blockTile(src.tileUrl.includes('/100/') ? 12 : 20, 22), close() {} }));
    self.postMessage = (msg, transfer) => posted.push({ msg, transfer });
    jest.isolateModules(() => { require('./radarAdvectWorker'); });
    return self.onmessage;
  }

  beforeEach(() => {
    for (const k of ['OffscreenCanvas', 'ImageData', 'fetch', 'createImageBitmap']) saved[k] = global[k];
    saved.postMessage = self.postMessage; saved.onmessage = self.onmessage;
  });
  afterEach(() => {
    for (const k of ['OffscreenCanvas', 'ImageData', 'fetch', 'createImageBitmap']) {
      if (saved[k] === undefined) delete global[k]; else global[k] = saved[k];
    }
    self.postMessage = saved.postMessage; self.onmessage = saved.onmessage;
  });

  it('answers with a transferred bitmap built from the same RGBA the core produces, and no PNG encode', async () => {
    const onmessage = boot();
    await onmessage({ data: { id: 1, url: advectUrl(2), base: 'https://app.test/map', flags: {} } });
    expect(posted).toHaveLength(1);
    const { msg, transfer } = posted[0];
    expect(msg.id).toBe(1);
    expect(msg.blank).toBe(false);
    expect(msg.cached).toBe(false);
    expect(transfer).toEqual([msg.bitmap]);
    const want = await createAdvectPipeline({ getTile: world().getTile }).warp(parseAdvectUrl(advectUrl(2)));
    expect(Buffer.from(msg.bitmap.img.data).equals(Buffer.from(want.data))).toBe(true);
    expect(FakeOffscreen.prototype.convertToBlob).toBeUndefined();   // nothing here can encode a PNG
  });

  it('a second ask for the same tile is served from the worker cache with no new fetch', async () => {
    const onmessage = boot();
    await onmessage({ data: { id: 1, url: advectUrl(2), base: '', flags: {} } });
    const n = fetches.length;
    await onmessage({ data: { id: 2, url: advectUrl(2), base: '', flags: {} } });
    expect(fetches.length).toBe(n);
    expect(posted[1].msg.cached).toBe(true);
    // a different lead reuses the decoded tiles and the motion: still no fetch
    await onmessage({ data: { id: 3, url: advectUrl(3), base: '', flags: {} } });
    expect(fetches.length).toBe(n);
    expect(posted[2].msg.cached).toBe(false);
  });

  it('resolves a proxied /rv/ tile path against the page it was given', async () => {
    const onmessage = boot();
    const rel = 'advect-rv://2|/rv/v2/radar/100/256/5/9/12/7/1_0.png|/rv/v2/radar/200/256/5/9/12/7/1_0.png';
    await onmessage({ data: { id: 1, url: rel, base: 'https://app.test/map?x=1', flags: { neighborOff: true } } });
    expect(fetches.sort()).toEqual([
      'https://app.test/rv/v2/radar/100/256/5/9/12/7/1_0.png',
      'https://app.test/rv/v2/radar/200/256/5/9/12/7/1_0.png',
    ]);
  });

  it('an expired observed tile gives a TRANSPARENT tile (blank), never an error or a frozen echo', async () => {
    const onmessage = boot({ status: () => 404 });
    await onmessage({ data: { id: 7, url: advectUrl(2), base: '', flags: {} } });
    const { msg } = posted[0];
    expect(msg.blank).toBe(true);
    expect(msg.error).toBeUndefined();
    expect(msg.bitmap.img.width).toBe(256);
    expect(msg.bitmap.img.data.every((v) => v === 0)).toBe(true);
  });

  it('a cancelled id is answered { cancelled } and builds no bitmap', async () => {
    const onmessage = boot();
    const p = onmessage({ data: { id: 4, url: advectUrl(2), base: '', flags: {} } });
    await onmessage({ data: { cancel: 4 } });
    await p;
    expect(posted).toEqual([{ msg: { id: 4, cancelled: true }, transfer: undefined }]);
    expect(global.createImageBitmap.mock.calls.every(([src]) => !(src instanceof FakeImageData))).toBe(true);
  });

  it('a worker without OffscreenCanvas says so (error), so the client falls back instead of drawing blanks', async () => {
    const onmessage = boot();
    delete global.OffscreenCanvas;
    await onmessage({ data: { id: 9, url: advectUrl(2), base: '', flags: {} } });
    expect(posted).toEqual([{ msg: { id: 9, error: 'unsupported' }, transfer: undefined }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The client and the kill switch, through the real advect-rv protocol handler.
// ---------------------------------------------------------------------------------------------------------------------------
describe('radarAdvectClient + the advect-rv handler: worker by default, main thread under the kill', () => {
  const saved = {};
  let workers;

  class FakeWorker {
    constructor() { this.posted = []; workers.push(this); }
    postMessage(m) { this.posted.push(m); }
    reply(data) { this.onmessage({ data }); }
  }
  // Enough canvas for the main-thread path's transparent fail-open tile (jsdom has no canvas): an 8-byte "PNG".
  class MainCanvas {
    getContext() { return { putImageData() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }; }
    async convertToBlob() { return { arrayBuffer: async () => new ArrayBuffer(8) }; }
  }

  function load({ worker = true } = {}) {
    workers = [];
    global.OffscreenCanvas = MainCanvas; global.createImageBitmap = async () => ({});
    if (worker) global.Worker = FakeWorker;
    let mods;
    jest.isolateModules(() => {
      jest.doMock('./radarAdvectWorkerFactory', () => ({ createRadarAdvectWorker: () => new FakeWorker() }));
      jest.doMock('maplibre-gl', () => ({ __esModule: true, default: { addProtocol: jest.fn() } }));
      const client = require('./radarAdvectClient');
      const recolor = require('./radarTileRecolor');
      const maplibregl = require('maplibre-gl').default;
      recolor.registerRadarRecolorProtocol();
      const handler = maplibregl.addProtocol.mock.calls.find(([name]) => name === 'advect-rv')[1];
      mods = { client, handler };
    });
    return mods;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    for (const k of ['Worker', 'OffscreenCanvas', 'createImageBitmap', 'fetch']) saved[k] = global[k];
    delete window.__RAW_DISABLE_RADAR_ADVECT_WORKER__;
    delete window.__RAW_RADAR_ADVECT_WORKER__;
  });
  afterEach(() => {
    for (const k of ['Worker', 'OffscreenCanvas', 'createImageBitmap', 'fetch']) {
      if (saved[k] === undefined) delete global[k]; else global[k] = saved[k];
    }
    delete window.__RAW_DISABLE_RADAR_ADVECT_WORKER__;
    delete window.__RAW_RADAR_ADVECT_WORKER__;
    delete window.__RAW_RADAR_ADVECT_SMOOTH_DISABLED__;
    jest.dontMock('./radarAdvectWorkerFactory');
    jest.dontMock('maplibre-gl');
  });

  it('default: the handler posts the tile to the worker and returns its bitmap; the main thread fetches nothing', async () => {
    const { handler } = load();
    global.fetch = jest.fn();
    window.__RAW_RADAR_ADVECT_SMOOTH_DISABLED__ = true;
    const p = handler({ url: advectUrl(2) }, new AbortController());
    await flush();
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toEqual([{ id: 1, url: advectUrl(2), base: window.location.href, flags: { smoothOff: true, neighborOff: false } }]);
    const bitmap = { tag: 'bitmap' };
    workers[0].reply({ id: 1, bitmap, ms: 12, cached: false, blank: false });
    expect(await p).toEqual({ data: bitmap });
    expect((await p).data).toBe(bitmap);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.__RAW_RADAR_ADVECT_WORKER__).toMatchObject({ state: 'module', tiles: 1, fallback: 0, ms: [12] });
  });

  it('KILL: __RAW_DISABLE_RADAR_ADVECT_WORKER__ = true creates no worker and runs the main-thread path', async () => {
    window.__RAW_DISABLE_RADAR_ADVECT_WORKER__ = true;
    const { handler } = load();
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
    const out = await handler({ url: advectUrl(2) }, new AbortController());
    expect(workers).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalled();                 // the observed tile was asked for on the main thread, as before
    expect(global.fetch.mock.calls[0][0]).toBe(CURR);
    expect(out.data instanceof ArrayBuffer).toBe(true);      // the legacy answer is encoded bytes (here the transparent tile)
    expect(out.data.byteLength).toBe(8);
    expect(window.__RAW_RADAR_ADVECT_WORKER__).toBeUndefined();
  });

  it('no Worker in this browser: falls back to the main-thread path and says so', async () => {
    delete global.Worker;
    const { handler } = load({ worker: false });
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
    await handler({ url: advectUrl(2) }, new AbortController());
    expect(global.fetch).toHaveBeenCalled();
    expect(window.__RAW_RADAR_ADVECT_WORKER__).toMatchObject({ state: 'none', fallback: 1, tiles: 0 });
  });

  it('a worker that cannot do the job is dropped for good: this tile and the next run on the main thread', async () => {
    const { handler } = load();
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
    const p = handler({ url: advectUrl(2) }, new AbortController());
    await flush();
    workers[0].reply({ id: 1, error: 'unsupported' });
    await p;
    expect(window.__RAW_RADAR_ADVECT_WORKER__).toMatchObject({ state: 'failed', fallback: 1 });
    await handler({ url: advectUrl(3) }, new AbortController());
    expect(workers[0].posted).toHaveLength(1);               // never asked again
    expect(window.__RAW_RADAR_ADVECT_WORKER__.fallback).toBe(2);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('a worker script error releases every waiting tile to the main-thread path', async () => {
    const { client } = load();
    const a = client.advectTileOffThread(advectUrl(1), {}, new AbortController());
    const b = client.advectTileOffThread(advectUrl(2), {}, new AbortController());
    await flush();
    workers[0].onerror(new Error('script failed'));
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect(window.__RAW_RADAR_ADVECT_WORKER__.state).toBe('failed');
  });

  it('an aborted request tells the worker to stop and rejects with an AbortError (no main-thread fallback)', async () => {
    const { handler } = load();
    global.fetch = jest.fn();
    const ac = new AbortController();
    const p = handler({ url: advectUrl(2) }, ac);
    await flush();
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].posted[1]).toEqual({ cancel: 1 });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.__RAW_RADAR_ADVECT_WORKER__.cancelled).toBe(1);
    workers[0].reply({ id: 1, cancelled: true });            // the late answer is ignored
  });
});
