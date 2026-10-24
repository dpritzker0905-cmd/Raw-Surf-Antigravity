/**
 * waveLakes.js (2026-10-23): a lake a wave model carries is cut out of the land, ONE object per lake set, only for a lake model
 * whose grid has valid nodes on it; the sheltered-water classifier releases it. A synthetic world: a square continent with a
 * square lake that holds a square island.
 */
import { _setWaveLakesForTest, activeWaveLakeAnchors, cutLakes, lakesCarried, releaseWaveLakes, withWaveLakes } from './waveLakes';

const ccw = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];            // counter-clockwise (positive area)
const LAND = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ccw(-100, 30, -60, 60)] } },
  { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ccw(0, 0, 10, 10)] } },
] };
const LAKE = { id: 'big', name: 'Big Lake', bbox: [-90, 40, -80, 50],
  g50: [ccw(-90, 40, -80, 50), ccw(-86, 44, -84, 46)], g10: [ccw(-90.1, 40, -80, 50.1), ccw(-86, 44, -84, 46)], anchors: [[-88, 42], [-82, 48]] };
const ASSET = { lakes: [LAKE] };

// A 2-deg grid over the lake region; `valid(lat, lng)` decides each node.
function grid(model, valid) {
  const vectors = [];
  for (let lat = 36; lat <= 54; lat += 2) for (let lng = -96; lng <= -74; lng += 2) vectors.push({ lat, lng, speed: 1, is_valid: valid(lat, lng) });
  return { __sourceModel: model, cols: 12, rows: 10, bounds: { west: -96, south: 36, east: -74, north: 54 }, vectors };
}
const onLake = (lat, lng) => lat >= 40 && lat <= 50 && lng >= -90 && lng <= -80;

// Nonzero winding number of (x, y) against every ring of a polygon: 0 = unfilled (white in the mask).
function winding(x, y, rings) {
  let wn = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length - 1; i++) {
      const [x1, y1] = r[i]; const [x2, y2] = r[i + 1];
      const left = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
      if (y1 <= y) { if (y2 > y && left > 0) wn += 1; } else if (y2 <= y && left < 0) wn -= 1;
    }
  }
  return wn;
}

beforeEach(() => { _setWaveLakesForTest(ASSET); delete window.__RAW_DISABLE_WAVE_LAKES__; delete window.__LAND_GEOJSON_HIRES_CACHE__; });
afterEach(() => { _setWaveLakesForTest(null); delete window.__RAW_DISABLE_WAVE_LAKES__; });

describe('which lakes a grid carries', () => {
  it('EURO with valid nodes on the lake carries it; GFS never does; EURO with the lake nodes invalid does not', () => {
    expect(lakesCarried(grid('EURO', () => true))).toEqual(['big']);
    expect(lakesCarried(grid('GFS', () => true))).toEqual([]);                     // GFS has no lake data: valid = coastal sea
    expect(lakesCarried(grid('ICON', () => true))).toEqual([]);
    expect(lakesCarried(grid('EURO', (lat, lng) => !onLake(lat, lng) && (lng < -92 || lng > -78)))).toEqual([]);   // only far nodes valid
  });
  it('a valid node on land whose cell touches the lake counts (the #497 nodes are often land-centred)', () => {
    // A 4-deg grid: the node (52, -78) is on land, its cell -80..-76 x 50..54 touches the lake's NE corner (-80, 50).
    const coarse = (valid) => ({ __sourceModel: 'EURO', cols: 7, rows: 6, bounds: { west: -98, south: 34, east: -74, north: 54 },
      vectors: [-98, -94, -90, -86, -82, -78, -74].flatMap((lng) => [34, 38, 42, 46, 50, 54].map((lat) => ({ lat, lng, speed: 1, is_valid: valid(lat, lng) }))) });
    expect(lakesCarried(coarse((lat, lng) => lat === 50 && lng === -78))).toEqual(['big']);
    expect(lakesCarried(coarse((lat, lng) => lat === 54 && lng === -74))).toEqual([]);                // its cell -76..-72 x 52..56: no
  });
});

describe('the land variant', () => {
  it('is the SAME object for every hour of one lake set, another for another set, the land itself for none', () => {
    const a = withWaveLakes(LAND, grid('EURO', () => true));
    const b = withWaveLakes(LAND, grid('EURO', () => true));                         // the next hour: a new grid object
    expect(a).not.toBe(LAND);
    expect(b).toBe(a);
    expect(withWaveLakes(LAND, grid('GFS', () => true))).toBe(LAND);
    window.__LAND_GEOJSON_HIRES_CACHE__ = LAND;                                    // the 10 m base -> the g10 outline, its own object
    const hi = withWaveLakes(LAND, grid('EURO', () => true));
    expect(hi).not.toBe(a);
    expect(hi.features[0].geometry.coordinates[1].some(([x]) => x === -90.1)).toBe(true);   // g10's outline (its -90.1 edge)
  });
  it('cuts only lakes the mask bounds touch (a mask without one keeps the plain land: a model switch there rebuilds nothing)', () => {
    const euro = grid('EURO', () => true);
    expect(withWaveLakes(LAND, euro, { west: -10, south: 0, east: 20, north: 15 })).toBe(LAND);          // far from the lake
    expect(withWaveLakes(LAND, euro, { west: -84, south: 46, east: -70, north: 56 })).not.toBe(LAND);    // overlaps its NE corner
    expect(withWaveLakes(LAND, euro, { west: -180, south: -80, east: 180, north: 84 })).not.toBe(LAND);  // world
    expect(withWaveLakes(LAND, euro, { west: 170, south: 0, east: -170, north: 20 })).not.toBe(LAND);    // wrapped: treated as world
  });
  it('withdraws the "retain the resident mask" shortcut when the resident lake set differs from this commit\'s', () => {
    const euro = grid('EURO', () => true);
    const plainResident = { _cachedMaskGeoJSON: LAND, _maskRetainPatchedOk: true };
    const v = withWaveLakes(LAND, euro, undefined, plainResident);
    expect(plainResident._maskRetainPatchedOk).toBe(false);                                // GFS's mask must not stay for EURO
    const lakeResident = { _cachedMaskGeoJSON: v, _maskRetainPatchedOk: true };
    withWaveLakes(LAND, euro, undefined, lakeResident);
    expect(lakeResident._maskRetainPatchedOk).toBe(true);                                  // same lake set: retain stays allowed
    withWaveLakes(LAND, grid('GFS', () => true), undefined, lakeResident);
    expect(lakeResident._maskRetainPatchedOk).toBe(false);                                 // EURO's lakes must not stay for GFS
  });
  it('kill switch and an unloaded asset return the land unchanged', () => {
    window.__RAW_DISABLE_WAVE_LAKES__ = true;
    expect(withWaveLakes(LAND, grid('EURO', () => true))).toBe(LAND);
    delete window.__RAW_DISABLE_WAVE_LAKES__;
    _setWaveLakesForTest(null);
    expect(withWaveLakes(LAND, grid('EURO', () => true))).toBe(LAND);
  });
  it('cuts the lake as a hole (nonzero: white) and keeps its island land; the base land is never mutated', () => {
    const before = JSON.stringify(LAND);
    const v = cutLakes(LAND, [LAKE], 50);
    const rings = v.features[0].geometry.coordinates;
    expect(rings).toHaveLength(3);
    expect(winding(-88, 42, rings)).toBe(0);                                         // open lake water: not filled
    expect(winding(-85, 45, rings)).not.toBe(0);                                     // the island: land
    expect(winding(-95, 35, rings)).not.toBe(0);                                     // the continent: land
    expect(v.features[1]).toBe(LAND.features[1]);                                    // untouched features are shared
    expect(JSON.stringify(LAND)).toBe(before);
    expect(v.__waveLakesCut).toBe(1);
  });
});

describe('the sheltered-water exemption', () => {
  it('releases the sheltered component holding a carried lake anchor, on a copy; other components stay sheltered', () => {
    withWaveLakes(LAND, grid('EURO', () => true));
    expect(activeWaveLakeAnchors()).toEqual(LAKE.anchors);
    const w = 10; const h = 10;
    const sheltered = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) sheltered[y * w + x] = 1;   // the lake blob
    for (let y = 7; y <= 8; y++) for (let x = 7; x <= 8; x++) sheltered[y * w + x] = 1;   // a harbour basin
    const project = (lng, lat) => (lng === -88 ? [3.5, 3.5] : [-1, -1]);
    const r = releaseWaveLakes(sheltered, w, h, 13, project);
    expect(r.released).toBe(9);
    expect(r.count).toBe(4);
    expect(r.sheltered[3 * w + 3]).toBe(0);
    expect(r.sheltered[7 * w + 7]).toBe(1);
    expect(sheltered[3 * w + 3]).toBe(1);                                            // the (possibly cached) input is untouched
    withWaveLakes(LAND, grid('GFS', () => true));
    expect(releaseWaveLakes(sheltered, w, h, 13, project).released).toBe(0);         // no carried lake: nothing released
  });
});
