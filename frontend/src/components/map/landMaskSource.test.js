/**
 * landMaskSource: the ocean mask's GeoJSON source is given the land file's URL (the worker fetches and parses it) instead of
 * the parsed 2.7 MB object (2026-11-13). The timings are in the log; these pin when the URL is used and what happens if it fails.
 */
import fs from 'fs';
import path from 'path';
import { armLandSourceFallback, landSourceData, landSourceUrlOn, tagLandMaskUrl } from './landMaskSource';
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
