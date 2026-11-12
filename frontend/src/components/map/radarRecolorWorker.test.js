/**
 * Radar recolor tiles (HRRR / DWD / lightning) off the main thread (2026-11-12): the worker's recolor job, the client call and
 * the kill switch through the real protocol handlers.
 * Kill: window.__RAW_DISABLE_RADAR_RECOLOR_WORKER__ = true -> the main-thread recolor + PNG encode, as before.
 */
import {
  recolorRadarImageData, recolorDwdImageData, whitenLightningImageData, extractLightningStrikes,
} from './radarRecolorCore';

const W = 32; const H = 32;
const HRRR_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi?bbox=0,0,1000,1000&f=15';
const LTG_URL = 'https://nowcoast.noaa.gov/geoserver/lightning_detection/ows?bbox=-9000000,3000000,-8000000,4000000';

// One IEM rain-ramp colour (#5ab769), one DWD cyan (#33ffff), one lightning red (255,0,0), on a transparent tile.
function sourcePixels() {
  const d = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, r, g, b) => { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  put(2, 2, 0x5a, 0xb7, 0x69); put(10, 10, 0x33, 0xff, 0xff); put(20, 20, 255, 0, 0);
  return d;
}

describe('radarAdvectWorker: the recolor job', () => {
  const saved = {};
  let posted; let fetches; let filterSupported;

  class FakeOffscreen {
    constructor(w, h) { this.width = w; this.height = h; this.pixels = null; this.filterUsed = null; }
    getContext() {
      const canvas = this;
      const ctx = {
        drawImage(src) { canvas.pixels = src.pixels; canvas.filterUsed = filterSupported && ctx.filter !== 'none' ? ctx.filter : null; },
        getImageData: () => ({ data: new Uint8ClampedArray(canvas.pixels) }),
        putImageData(img) { canvas.pixels = img.data; },
      };
      if (filterSupported) ctx.filter = 'none';
      return ctx;
    }
    transferToImageBitmap() { return { kind: 'out', pixels: this.pixels, filter: this.filterUsed }; }
  }

  function boot({ failFetch = false } = {}) {
    posted = []; fetches = []; filterSupported = true;
    global.OffscreenCanvas = FakeOffscreen;
    global.ImageData = function ImageData() {};
    global.fetch = jest.fn(async (url) => {
      fetches.push(url);
      if (failFetch) throw new Error('network');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });
    global.createImageBitmap = jest.fn(async () => ({ width: W, height: H, pixels: sourcePixels(), close() {} }));
    self.postMessage = (msg, transfer) => posted.push({ msg, transfer });
    jest.isolateModules(() => { require('./radarAdvectWorker'); });
    return self.onmessage;
  }
  const job = (over) => ({ data: { id: 1, kind: 'recolor', transform: 'hrrr', url: HRRR_URL, base: '', blurPx: 1.5, flags: {}, ...over } });

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

  it('hrrr: the bitmap carries the same pixels recolorRadarImageData produces, softened by the blur filter', async () => {
    const onmessage = boot();
    await onmessage(job());
    const { msg, transfer } = posted[0];
    const want = sourcePixels(); recolorRadarImageData(want);
    expect(Buffer.from(msg.bitmap.pixels).equals(Buffer.from(want))).toBe(true);
    expect(Buffer.from(want).equals(Buffer.from(sourcePixels()))).toBe(false);   // positive control: the recolor changed pixels
    expect(msg.bitmap.filter).toBe('blur(1.5px)');
    expect(transfer).toEqual([msg.bitmap]);
    expect(msg.cached).toBe(false);
    expect(msg.strikes).toBeNull();
  });

  it('dwd: the DWD transform, with its own blur radius; smoothOff serves the tile unblurred', async () => {
    const onmessage = boot();
    await onmessage(job({ transform: 'dwd', blurPx: 1.0 }));
    const want = sourcePixels(); recolorDwdImageData(want);
    expect(Buffer.from(posted[0].msg.bitmap.pixels).equals(Buffer.from(want))).toBe(true);
    expect(posted[0].msg.bitmap.filter).toBe('blur(1px)');
    await onmessage(job({ id: 2, transform: 'dwd', blurPx: 1.0, flags: { smoothOff: true } }));
    expect(posted[1].msg.bitmap.filter).toBeNull();
  });

  it('ltg: strike cores are read from the original palette, then the tile is whitened; no blur', async () => {
    const onmessage = boot();
    await onmessage(job({ transform: 'ltg', url: LTG_URL, blurPx: 0 }));
    const { msg } = posted[0];
    const wantStrikes = extractLightningStrikes(sourcePixels(), W, H, [-9000000, 3000000, -8000000, 4000000]);
    expect(wantStrikes.length).toBeGreaterThan(0);
    expect(msg.strikes).toEqual(wantStrikes);
    const want = sourcePixels(); whitenLightningImageData(want);
    expect(Buffer.from(msg.bitmap.pixels).equals(Buffer.from(want))).toBe(true);
    expect(msg.bitmap.filter).toBeNull();
  });

  it('a second ask is served from the kept source bytes (no fetch); cacheOff fetches again', async () => {
    const onmessage = boot();
    await onmessage(job());
    await onmessage(job({ id: 2 }));
    expect(fetches).toHaveLength(1);
    expect(posted[1].msg.cached).toBe(true);
    await onmessage(job({ id: 3, flags: { cacheOff: true } }));
    expect(fetches).toHaveLength(2);
    expect(posted[2].msg.cached).toBe(false);
  });

  it('a tile that cannot be fetched is handed back (tileError) for the main-thread path to serve', async () => {
    const onmessage = boot({ failFetch: true });
    await onmessage(job());
    expect(posted).toEqual([{ msg: { id: 1, tileError: true }, transfer: undefined }]);
  });

  it('no canvas blur filter in this worker: says so, instead of serving hard-edged tiles', async () => {
    const onmessage = boot();
    filterSupported = false;
    await onmessage(job());
    expect(posted).toEqual([{ msg: { id: 1, unsupported: 'recolor' }, transfer: undefined }]);
    await onmessage(job({ id: 2, transform: 'ltg', url: LTG_URL, blurPx: 0 }));   // a tile that needs no blur is still served
    expect(posted[1].msg.bitmap).toBeDefined();
  });

  it('a cancelled id is answered { cancelled } with no bitmap', async () => {
    const onmessage = boot();
    const p = onmessage(job({ id: 5 }));
    await onmessage({ data: { cancel: 5 } });
    await p;
    expect(posted).toEqual([{ msg: { id: 5, cancelled: true }, transfer: undefined }]);
  });
});

describe('the recolor protocol handlers: worker by default, main thread under the kill', () => {
  const saved = {};
  let workers;

  class FakeWorker {
    constructor() { this.posted = []; workers.push(this); }
    postMessage(m) { this.posted.push(m); }
    reply(data) { this.onmessage({ data }); }
  }
  class MainCanvas {
    getContext() { return { putImageData() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }; }
    async convertToBlob() { return { arrayBuffer: async () => new ArrayBuffer(8) }; }
  }

  function load() {
    workers = [];
    global.OffscreenCanvas = MainCanvas; global.createImageBitmap = async () => ({ width: 1, height: 1 }); global.Worker = FakeWorker;
    let mods;
    jest.isolateModules(() => {
      jest.doMock('./radarAdvectWorkerFactory', () => ({ createRadarAdvectWorker: () => new FakeWorker() }));
      jest.doMock('maplibre-gl', () => ({ __esModule: true, default: { addProtocol: jest.fn() } }));
      const recolor = require('./radarTileRecolor');
      const maplibregl = require('maplibre-gl').default;
      recolor.registerRadarRecolorProtocol();
      const handler = (name) => maplibregl.addProtocol.mock.calls.find(([n]) => n === name)[1];
      mods = { recolor, handler };
    });
    return mods;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const mainFetch = () => jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));

  beforeEach(() => {
    for (const k of ['Worker', 'OffscreenCanvas', 'createImageBitmap', 'fetch']) saved[k] = global[k];
    for (const k of ['__RAW_DISABLE_RADAR_RECOLOR_WORKER__', '__RAW_RADAR_ADVECT_WORKER__', '__RAW_RADAR_TILE_CACHE__']) delete window[k];
  });
  afterEach(() => {
    for (const k of ['Worker', 'OffscreenCanvas', 'createImageBitmap', 'fetch']) {
      if (saved[k] === undefined) delete global[k]; else global[k] = saved[k];
    }
    for (const k of ['__RAW_DISABLE_RADAR_RECOLOR_WORKER__', '__RAW_RADAR_ADVECT_WORKER__', '__RAW_RADAR_TILE_CACHE__']) delete window[k];
    jest.dontMock('./radarAdvectWorkerFactory');
    jest.dontMock('maplibre-gl');
  });

  it('default: hrrr-rv posts the tile to the worker and returns its bitmap; the main thread fetches nothing', async () => {
    const { handler } = load();
    global.fetch = jest.fn();
    const p = handler('hrrr-rv')({ url: 'hrrr-rv://' + HRRR_URL }, new AbortController());
    await flush();
    expect(workers[0].posted).toEqual([{
      id: 1, kind: 'recolor', transform: 'hrrr', url: HRRR_URL, base: window.location.href, blurPx: 1.5,
      flags: { smoothOff: false, cacheOff: false },
    }]);
    const bitmap = { tag: 'bitmap' };
    workers[0].reply({ id: 1, bitmap, ms: 9, cached: false, strikes: null });
    expect((await p).data).toBe(bitmap);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.__RAW_RADAR_TILE_CACHE__).toEqual({ hits: 0, misses: 1 });
    expect(window.__RAW_RADAR_ADVECT_WORKER__.recolor).toMatchObject({ tiles: 1, fallback: 0, ms: [9] });
  });

  it('dwd-rv and ltg-flash name their own transform and blur; lightning strikes from the worker reach the registry', async () => {
    const { handler, recolor } = load();
    global.fetch = jest.fn();
    const a = handler('dwd-rv')({ url: 'dwd-rv://https://maps.dwd.de/geoserver/dwd/wms?bbox=1,2,3,4' }, new AbortController());
    await flush();
    expect(workers[0].posted[0]).toMatchObject({ transform: 'dwd', blurPx: 1.0 });
    workers[0].reply({ id: 1, bitmap: {}, ms: 1, cached: true, strikes: null });
    await a;
    expect(window.__RAW_RADAR_TILE_CACHE__).toEqual({ hits: 1, misses: 0 });
    const b = handler('ltg-flash')({ url: 'ltg-flash://' + LTG_URL }, new AbortController());
    await flush();
    expect(workers[0].posted[1]).toMatchObject({ transform: 'ltg', blurPx: 0, url: LTG_URL });
    workers[0].reply({ id: 2, bitmap: {}, ms: 1, cached: false, strikes: [{ lng: -80, lat: 28, intensity: 0.8 }] });
    await b;
    expect(recolor.getLightningStrikePoints()).toEqual([{ lng: -80, lat: 28, intensity: 0.8 }]);
  });

  it('KILL: __RAW_DISABLE_RADAR_RECOLOR_WORKER__ = true creates no worker; the main thread fetches and answers with bytes', async () => {
    window.__RAW_DISABLE_RADAR_RECOLOR_WORKER__ = true;
    const { handler } = load();
    global.fetch = mainFetch();
    const out = await handler('hrrr-rv')({ url: 'hrrr-rv://' + HRRR_URL }, new AbortController());
    expect(workers).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledWith(HRRR_URL);
    expect(out.data instanceof ArrayBuffer).toBe(true);
    expect(out.data.byteLength).toBe(8);                         // the main-thread path's encoded tile
    expect(window.__RAW_RADAR_ADVECT_WORKER__).toBeUndefined();
  });

  it('a tile the worker could not fetch is served by the main-thread path; the worker keeps the next tile', async () => {
    const { handler } = load();
    global.fetch = mainFetch();
    const p = handler('hrrr-rv')({ url: 'hrrr-rv://' + HRRR_URL }, new AbortController());
    await flush();
    workers[0].reply({ id: 1, tileError: true });
    const out = await p;
    expect(out.data instanceof ArrayBuffer).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const q = handler('hrrr-rv')({ url: 'hrrr-rv://' + HRRR_URL + '&x=2' }, new AbortController());
    await flush();
    expect(workers[0].posted).toHaveLength(2);                   // still asked
    workers[0].reply({ id: 2, bitmap: { ok: 1 }, ms: 1, cached: false, strikes: null });
    expect((await q).data).toEqual({ ok: 1 });
    expect(window.__RAW_RADAR_ADVECT_WORKER__.state).toBe('module');
  });

  it('a worker with no blur filter is not asked for recolor tiles again', async () => {
    const { handler } = load();
    global.fetch = mainFetch();
    const p = handler('hrrr-rv')({ url: 'hrrr-rv://' + HRRR_URL }, new AbortController());
    await flush();
    workers[0].reply({ id: 1, unsupported: 'recolor' });
    await p;
    await handler('dwd-rv')({ url: 'dwd-rv://https://maps.dwd.de/x?bbox=1,2,3,4' }, new AbortController());
    expect(workers[0].posted).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(window.__RAW_RADAR_ADVECT_WORKER__.state).toBe('module');   // the nowcast keeps using the worker
  });

  it('an aborted tile tells the worker to stop and rejects with an AbortError', async () => {
    const { handler } = load();
    global.fetch = jest.fn();
    const ac = new AbortController();
    const p = handler('hrrr-rv')({ url: 'hrrr-rv://' + HRRR_URL }, ac);
    await flush();
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].posted[1]).toEqual({ cancel: 1 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
