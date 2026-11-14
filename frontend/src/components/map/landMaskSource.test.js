/**
 * landMaskSource: the ocean mask's GeoJSON source is given the land file's URL (the worker fetches and parses it) instead of
 * the parsed 2.7 MB object (2026-11-13). The timings are in the log; these pin when the URL is used and what happens if it fails.
 */
import fs from 'fs';
import path from 'path';
import {
  armLandSourceFallback, landSourceData, landSourceUrlOn, landWorkerLoaderOn, resetLandWorkerLoaderForTest, startLandWorkerLoader, tagLandMaskUrl,
} from './landMaskSource';
import { getSharedLandGeoJSON, getSharedLandGeoJSONHiRes, getSharedLandGeoJSONHiResUrl, getSharedLandGeoJSONUrl } from './mapUtils';

const poly = () => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: {} });
const land = (n) => ({ type: 'FeatureCollection', features: Array.from({ length: n }, poly) });
// A map that records its listeners and lets a test fire them.
const fakeMap = (src) => {
  const on = { error: new Set(), sourcedata: new Set() };
  return {
    on: (t, f) => on[t].add(f), off: (t, f) => on[t].delete(f), getSource: () => src,
    fire: (t, e) => [...on[t]].forEach((f) => f(e)), count: () => on.error.size + on.sourcedata.size,
  };
};

beforeEach(() => {
  delete window.__RAW_DISABLE_LAND_SOURCE_URL__; delete window.__RAW_LAND_SOURCE__;
  delete window.__RAW_DISABLE_LAND_WORKER_LOADER__; resetLandWorkerLoaderForTest();
  delete window.__LAND_GEOJSON_URL__; delete window.__LAND_GEOJSON_CACHE__; delete window.__LAND_GEOJSON_PROMISE__;
  delete window.__LAND_GEOJSON_HIRES_URL__; delete window.__LAND_GEOJSON_HIRES_CACHE__; delete window.__LAND_GEOJSON_HIRES_PROMISE__;
});

describe('the source data is the land file when the mask is that file', () => {
  test('a mask that kept every feature of the file is given as the file URL', () => {
    const mask = tagLandMaskUrl(land(3), land(3), '/ne_50m_land.json');
    expect(landSourceData(mask)).toBe('/ne_50m_land.json');
    expect(window.__RAW_LAND_SOURCE__).toMatchObject({ byUrl: 1, byObject: 0, lastUrl: '/ne_50m_land.json' });
  });

  test('a mask that dropped a feature, or has no known URL, stays the object', () => {
    const dropped = tagLandMaskUrl(land(2), land(3), '/ne_50m_land.json');
    expect(landSourceData(dropped)).toBe(dropped);
    const noUrl = tagLandMaskUrl(land(3), land(3), null);
    expect(landSourceData(noUrl)).toBe(noUrl);
    const untagged = land(3);
    expect(landSourceData(untagged)).toBe(untagged);
    expect(window.__RAW_LAND_SOURCE__).toMatchObject({ byUrl: 0, byObject: 3 });
  });

  test('OFF PATH: the kill gives the object, as before', () => {
    const mask = tagLandMaskUrl(land(3), land(3), '/ne_50m_land.json');
    window.__RAW_DISABLE_LAND_SOURCE_URL__ = true;
    expect(landSourceUrlOn()).toBe(false);
    expect(landSourceData(mask)).toBe(mask);
    expect(window.__RAW_LAND_SOURCE__).toMatchObject({ byUrl: 0, byObject: 1 });
  });
});

describe('a file the worker cannot load never leaves the land unmasked', () => {
  test('an error from this source hands it the object, once', () => {
    const src = { setData: jest.fn() }; const map = fakeMap(src); const mask = land(2);
    armLandSourceFallback(map, 'ocean-mask-source', mask, '/ne_50m_land.json');
    map.fire('error', { sourceId: 'some-other-source' });
    expect(src.setData).not.toHaveBeenCalled();
    map.fire('error', { sourceId: 'ocean-mask-source' });
    expect(src.setData).toHaveBeenCalledTimes(1);
    expect(src.setData).toHaveBeenCalledWith(mask);
    expect(map.count()).toBe(0);                                   // both listeners removed
    expect(window.__RAW_LAND_SOURCE__.fellBack).toBe(1);
  });

  test('once the source has loaded, a later error is not ours to answer', () => {
    const src = { setData: jest.fn() }; const map = fakeMap(src);
    armLandSourceFallback(map, 'ocean-mask-source', land(2), '/ne_50m_land.json');
    map.fire('sourcedata', { sourceId: 'ocean-mask-source', sourceDataType: 'content' });
    expect(map.count()).toBe(2);                                   // tiles are not "loaded"
    map.fire('sourcedata', { sourceId: 'ocean-mask-source', sourceDataType: 'metadata' });
    expect(map.count()).toBe(0);
    map.fire('error', { sourceId: 'ocean-mask-source' });
    expect(src.setData).not.toHaveBeenCalled();
  });

  test('nothing is armed when the data was the object', () => {
    const map = fakeMap({ setData: jest.fn() }); const mask = land(2);
    armLandSourceFallback(map, 'ocean-mask-source', mask, mask);
    expect(map.count()).toBe(0);
  });
});

describe('the shared land loader says which file it loaded', () => {
  const respond = (ok, body) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
  afterEach(() => { delete global.fetch; });

  test('the 50 m file', async () => {
    global.fetch = jest.fn(() => respond(true, land(2)));
    expect(getSharedLandGeoJSONUrl()).toBeNull();
    await getSharedLandGeoJSON();
    expect(getSharedLandGeoJSONUrl()).toBe('/ne_50m_land.json');
  });

  test('the 110 m fallback, when the 50 m file is not served', async () => {
    global.fetch = jest.fn((u) => (u === '/ne_50m_land.json' ? respond(false, null) : respond(true, land(1))));
    await getSharedLandGeoJSON();
    expect(getSharedLandGeoJSONUrl()).toBe('/ne_110m_land.json');
  });

  test('the 10 m file: a local copy when the deploy ships one', async () => {
    global.fetch = jest.fn(() => respond(true, land(2)));
    expect(getSharedLandGeoJSONHiResUrl()).toBeNull();
    await getSharedLandGeoJSONHiRes();
    expect(getSharedLandGeoJSONHiResUrl()).toBe('/ne_10m_land.json');
  });

  test('the 10 m file: the CDN it was actually read from otherwise', async () => {
    global.fetch = jest.fn((u) => (u === '/ne_10m_land.json' ? respond(false, null) : respond(true, land(2))));
    await getSharedLandGeoJSONHiRes();
    expect(getSharedLandGeoJSONHiResUrl()).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/.*ne_10m_land\.json$/);
    expect(global.fetch).toHaveBeenLastCalledWith(getSharedLandGeoJSONHiResUrl());
  });
});

describe('the shipped land files and the mask module', () => {
  test.each(['ne_50m_land.json', 'ne_110m_land.json'])('%s holds polygons only, so the mask drops nothing', (name) => {
    const g = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public', name), 'utf8'));
    expect(g.features.length).toBeGreaterThan(100);
    expect(g.features.every((f) => f.geometry && /^(Multi)?Polygon$/.test(f.geometry.type))).toBe(true);
  });

  test('OceanMask adds its source through the helper, and no mask layer reads a feature property of that source', () => {
    const src = fs.readFileSync(path.join(__dirname, 'OceanMask.js'), 'utf8');
    expect(src).toMatch(/const data = landSourceData\(maskData\);/);
    expect(src).toMatch(/addSource\(MASK_SOURCE, \{ type: 'geojson', data, tolerance: 0\.375 \}\);/);
    expect(src).toMatch(/armLandSourceFallback\(mapInstance, MASK_SOURCE, maskData, data\);/);
    expect(src).toMatch(/tagLandMaskUrl\(buildLandMask\(geojson\), geojson, getSharedLandGeoJSONUrl\(\)\)/);
    // the 10 m upgrade swaps the data the same way
    expect(src).toMatch(/tagLandMaskUrl\(buildLandMask\(geojson\), geojson, getSharedLandGeoJSONHiResUrl\(\)\)/);
    expect(src).toMatch(/const data = landSourceData\(mask\); src\.setData\(data\); armLandSourceFallback\(mapInstance, MASK_SOURCE, mask, data\);/);
    expect(src).not.toMatch(/src\.setData\(mask\)/);
    // the three layers on the land source: a property read ('get' / a filter) would make the file's properties matter
    const blocks = src.split('mapInstance.addLayer({').slice(1).map((b) => b.split('}, ')[0]).filter((b) => /source: MASK_SOURCE/.test(b));
    expect(blocks).toHaveLength(3);
    for (const b of blocks) expect(b).not.toMatch(/filter:|\['get'/);
  });
});
// ── The worker loader (2026-11-13): the worker's reply to the page carries no land geometry ────────────────────────────────
// Bare page, system Chrome, HTTP cache on, CPU 4x, 10 m file: worst frame 58-102 ms against 628-713 ms with the plain URL
// (docs/weather-program/log/2026-11-13-fable-land-worker-loader.md).
const libThat = (result) => ({ importScriptInWorkers: jest.fn(() => result) });
const ABS = (u) => new URL(u, window.location.href).href;

describe('the land source goes through the worker loader once its script is in the workers', () => {
  test('before the script has loaded the plain URL is used; after, rawland:// with the absolute file URL encoded', async () => {
    const mask = tagLandMaskUrl(land(3), land(3), '/ne_50m_land.json');
    let done; const lib = libThat(new Promise((r) => { done = r; }));
    const started = startLandWorkerLoader(lib);
    expect(lib.importScriptInWorkers).toHaveBeenCalledWith(ABS('/land-worker-loader.js'));
    expect(landSourceData(mask)).toBe('/ne_50m_land.json');
    expect(window.__RAW_LAND_SOURCE__).toMatchObject({ byUrl: 1, byWorker: 0, loader: 'loading' });
    done([]);
    expect(await started).toBe('ready');
    const data = landSourceData(mask);
    expect(data).toBe('rawland://' + encodeURIComponent(ABS('/ne_50m_land.json')));
    expect(data.slice('rawland://'.length)).not.toMatch(/[/:]/);                 // nothing the page's URL resolver can rewrite
    expect(window.__RAW_LAND_SOURCE__).toMatchObject({ byUrl: 1, byWorker: 1, byObject: 0, loader: 'ready', lastUrl: data });
  });

  test('the script is asked for once per page, and a CDN file keeps its own origin', async () => {
    const lib = libThat(Promise.resolve([]));
    await startLandWorkerLoader(lib); await startLandWorkerLoader(lib);
    expect(lib.importScriptInWorkers).toHaveBeenCalledTimes(1);
    const cdn = 'https://cdn.jsdelivr.net/gh/x/y@master/10m/physical/ne_10m_land.json';
    expect(decodeURIComponent(landSourceData(tagLandMaskUrl(land(2), land(2), cdn)).slice('rawland://'.length))).toBe(cdn);
  });

  test('a script that fails to load, or a library without the call, leaves the plain URL', async () => {
    const mask = tagLandMaskUrl(land(3), land(3), '/ne_50m_land.json');
    expect(await startLandWorkerLoader(libThat(Promise.reject(new Error('blocked'))))).toBe('failed');
    expect(landSourceData(mask)).toBe('/ne_50m_land.json');
    resetLandWorkerLoaderForTest();
    expect(await startLandWorkerLoader({})).toBe('off');
    expect(await startLandWorkerLoader({ importScriptInWorkers: () => { throw new Error('no workers'); } })).toBe('failed');
    expect(landSourceData(mask)).toBe('/ne_50m_land.json');
  });

  test('OFF PATH: the kill never loads the script and gives the plain URL, as before', async () => {
    const mask = tagLandMaskUrl(land(3), land(3), '/ne_50m_land.json');
    window.__RAW_DISABLE_LAND_WORKER_LOADER__ = true;
    expect(landWorkerLoaderOn()).toBe(false);
    const lib = libThat(Promise.resolve([]));
    expect(await startLandWorkerLoader(lib)).toBe('off');
    expect(lib.importScriptInWorkers).not.toHaveBeenCalled();
    expect(landSourceData(mask)).toBe('/ne_50m_land.json');
    // flipped after the script loaded: still the plain URL
    delete window.__RAW_DISABLE_LAND_WORKER_LOADER__;
    await startLandWorkerLoader(lib);
    window.__RAW_DISABLE_LAND_WORKER_LOADER__ = true;
    expect(landSourceData(mask)).toBe('/ne_50m_land.json');
    // and the older kill still gives the object, loader or not
    delete window.__RAW_DISABLE_LAND_WORKER_LOADER__; window.__RAW_DISABLE_LAND_SOURCE_URL__ = true;
    expect(landSourceData(mask)).toBe(mask);
  });

  test('a worker-side failure is a source error, answered with the object like any other', async () => {
    await startLandWorkerLoader(libThat(Promise.resolve([])));
    const mask = tagLandMaskUrl(land(2), land(2), '/ne_50m_land.json'); const data = landSourceData(mask);
    const src = { setData: jest.fn() }; const map = fakeMap(src);
    armLandSourceFallback(map, 'ocean-mask-source', mask, data);
    map.fire('error', { sourceId: 'ocean-mask-source' });
    expect(src.setData).toHaveBeenCalledWith(mask);
  });

  test('the land file fetch is what starts it (mapUtils), AFTER the app has set its own worker file', () => {
    const src = fs.readFileSync(path.join(__dirname, 'mapUtils.js'), 'utf8');
    // The library builds its worker pool on the first message. Started before setWorkerUrl, that pool was the bundled default
    // worker and every tile of every source failed: no basemap, no land mask (offline app run, 2026-11-13).
    expect(src).toMatch(/try \{ ensureMapLibreInit\(\); startLandWorkerLoader\(maplibregl\); \}[^\n]*\n\s*window\.__LAND_GEOJSON_PROMISE__ = fetch\('\/ne_50m_land\.json'\)/);
    expect(src.match(/startLandWorkerLoader\(/g)).toHaveLength(1);
    expect(src).toMatch(/export function ensureMapLibreInit\(\) \{\s*if \(_mapLibreWorkerSet\) return;\s*maplibregl\.setWorkerUrl\('\/maplibre-gl-worker\.js'\);/);
  });
});

describe('public/land-worker-loader.js, as the worker runs it', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../../public/land-worker-loader.js'), 'utf8');
  const load = (fetchImpl) => {
    const protocols = {}; const self = { addProtocol: (name, fn) => { protocols[name] = fn; } };
    // eslint-disable-next-line no-new-func
    new Function('self', 'fetch', code)(self, fetchImpl);
    return protocols;
  };
  const answer = (ok, body, status = 200) => jest.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) }));

  test('it fetches the decoded file URL and hands the tiler features the reply cannot see', async () => {
    const file = land(4); const fetchImpl = answer(true, file); const signal = {};
    const { rawland } = load(fetchImpl);
    const url = 'https://rawsurf.example/ne_50m_land.json';
    const { data } = await rawland({ url: 'rawland://' + encodeURIComponent(url) + '/' }, { signal });   // a resolver may add a slash
    expect(fetchImpl).toHaveBeenCalledWith(url, { signal });
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toBe(file.features);                                  // what the tiler reads: all of it, untouched
    const walked = []; for (const key in data) walked.push(key);                // what the library's reply serialiser walks
    expect(walked).toEqual(['type']);
    expect(Object.keys(data)).toEqual(['type']);
    expect(JSON.parse(JSON.stringify(data))).toEqual({ type: 'FeatureCollection' });
  });

  test('anything that is not a feature collection passes through as it is', async () => {
    const geom = { type: 'Polygon', coordinates: [] };
    expect((await load(answer(true, geom)).rawland({ url: 'rawland://x' }, null)).data).toBe(geom);
  });

  test('a file that is not served is an error, so the page falls back to the object', async () => {
    await expect(load(answer(false, null, 404)).rawland({ url: 'rawland://x' }, null)).rejects.toThrow('land file 404');
  });

  test('where there is no worker protocol registry it does nothing', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function('self', 'fetch', code)({}, null)).not.toThrow();
  });

  test('the two library behaviours it relies on are still in the installed map library', () => {
    const lib = path.join(__dirname, '../../../node_modules');
    const transfer = fs.readFileSync(path.join(lib, 'maplibre-gl/src/util/web_worker_transfer.ts'), 'utf8');
    expect(transfer).toMatch(/for \(const key in input\)/);                      // the reply walks enumerable keys only
    const worker = fs.readFileSync(path.join(lib, 'maplibre-gl/src/source/worker.ts'), 'utf8');
    expect(worker).toMatch(/this\.self\.addProtocol = addProtocol;/);            // workers have their own protocol registry
    const convert = fs.readFileSync(path.join(lib, '@maplibre/geojson-vt/src/convert.ts'), 'utf8');
    expect(convert).toMatch(/data\.features\[i\]/);                              // the tiler reads .features directly
  });
});
