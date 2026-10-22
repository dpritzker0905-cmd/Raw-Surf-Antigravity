/**
 * staticFrameCrop: the mid tier's clip window, mirrored (2026-10-22). The pinned windows are what the REAL backend served for
 * these boxes (serve_synthetic.py over the published run, /grid served_bbox and requested_bbox, 2026-10-22); the offline
 * scenario scn_static_crop_parity.mjs compares hundreds more node by node (382 crops, 206,860 nodes, 0 bad).
 */
import {
  clampAndNormalize, cropGridJson, cropSeriesFrame, cropVectors, gridBboxParam, midClipWindow, midCropFor, midCropRulesPass,
  MIN_CROP_SPAN, seriesBboxParam, wrapLongitude,
} from './staticFrameCrop';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const WORLD_GRID = { bounds: { west: -180, south: -80, east: 180, north: 84 }, cols: 181, rows: 83 };
const product = (region_id, coverage, layer = 'waves', model = 'GFS') => ({ model, domain: 'marine', layer, region_id, coverage,
  valid_time_start: '2026-10-22T00:00:00Z', valid_time_end: '2026-10-22T00:00:00Z' });
const MANIFEST = { products: [
  product('global_mid', { west: -180, south: -80, east: 180, north: 85 }),
  product('global_coarse', { west: -180, south: -80, east: 180, north: 85 }),
  product('florida_east_coast', { west: -85, south: 24, east: -79, north: 31 }),
  product('us_west_coast_socal', { west: -125, south: 30, east: -115, north: 38 }),
] };

beforeEach(() => { setCachedManifest(MANIFEST); });
afterEach(() => { setCachedManifest(null); delete window.__RAW_DISABLE_STATIC_MID_CROP__; delete window.__RAW_MARINE_GLOBAL_SPAN__; });

describe('midClipWindow: the server clip, exactly', () => {
  // [request as sent, cols, rows, served bounds, the padded window the server filtered by]
  const PINS = [
    ['-95,20,-65,35', 27, 20, [-106, 8, -54, 46], '-107.0000,8.0000,-53.0000,47.0000'],
    ['-91.37109375,20.6236,-67.63,36.02', 24, 20, [-102, 10, -56, 48], '-103.8705,8.1295,-55.1295,48.8705'],
    ['10.5,-70.25,48.75,-50.1', 32, 22, [-2, -80, 60, -38], '-2.0000,-80.0000,61.0000,-38.0000'],
    ['-180,-5,-152.5,25', 21, 27, [-180, -16, -140, 36], '-180.0000,-17.0000,-140.0000,37.0000'],
    ['150.3,60.2,180,79.9', 22, 19, [138, 48, 180, 84], '138.0000,48.0000,180.0000,85.0000'],
    ['-30.0001,0.0001,-10.0001,14.9999', 21, 18, [-40, -10, 0, 24], '-41.0000,-10.0000,0.0000,25.0000'],
  ];
  test.each(PINS)('%s', (req, cols, rows, [w, s, e, n], clip) => {
    const win = midClipWindow(req, WORLD_GRID, 'GFS');
    expect(win).not.toBeNull();
    expect([win.cols, win.rows]).toEqual([cols, rows]);
    expect(win.bounds).toEqual({ west: w, south: s, east: e, north: n });
    expect(win.clip).toBe(clip);
    // the window is the frame's own lattice: columns from -180, rows from -80, 2 deg apart
    expect([win.c0, win.r0]).toEqual([(w + 180) / 2, (s + 80) / 2]);
    expect([win.c1 - win.c0 + 1, win.r1 - win.r0 + 1]).toEqual([cols, rows]);
  });

  test('ICON / EURO snap to 2 deg (get_snapped_bbox), GFS to 1 deg', () => {
    expect(midClipWindow('-95.5,20.5,-65.5,35.5', WORLD_GRID, 'GFS').clip).toBe('-108.0000,8.0000,-53.0000,48.0000');
    expect(midClipWindow('-95.5,20.5,-65.5,35.5', WORLD_GRID, 'ICON').clip).toBe('-108.0000,8.0000,-52.0000,48.0000');
  });

  test('a lattice offset by 1 deg is still clipped on its OWN lattice (clip_lattice anchors at the data\'s first lat/lng)', () => {
    const win = midClipWindow('-95,20,-65,35', { bounds: { west: -179, south: -79, east: 181, north: 85 }, cols: 181, rows: 83 }, 'GFS');
    expect(win.bounds).toEqual({ west: -107, south: 9, east: -53, north: 47 });
    expect([win.c0, win.r0, win.cols, win.rows]).toEqual([36, 44, 28, 20]);
  });

  test('null when it cannot be mirrored: a crossing window, an anisotropic lattice, unreadable input', () => {
    expect(midClipWindow('170,0,-170,20', WORLD_GRID, 'GFS')).toBeNull();
    expect(midClipWindow('-95,20,-65,35', { bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 181, rows: 83 }, 'GFS')).toBeNull();
    expect(midClipWindow('-95,20,-65', WORLD_GRID, 'GFS')).toBeNull();
    expect(midClipWindow('a,b,c,d', WORLD_GRID, 'GFS')).toBeNull();
    expect(midClipWindow('-95,20,-65,35', null, 'GFS')).toBeNull();
  });

  test('route_helpers twins: wrap_longitude and clamp_and_normalize_bbox', () => {
    expect(wrapLongitude(-180)).toBe(-180);
    expect(wrapLongitude(180)).toBe(180);
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(-540)).toBe(-180);
    expect(clampAndNormalize(-200, 20, 170, -90)).toEqual([-180, -80, 180, 20]);
    expect(clampAndNormalize(-10, 90, 10, 80)).toEqual([-10, 80, 10, 85]);
  });
});

describe('midCropRulesPass: only where the resolver answers from global_mid', () => {
  const pass = (b) => midCropRulesPass({ model: 'GFS', layer: 'waves', bboxStr: gridBboxParam(b) });

  test('the span band: over 12 deg and at most the request ceiling (40, or __RAW_MARINE_GLOBAL_SPAN__)', () => {
    expect(MIN_CROP_SPAN).toBe(12);
    expect(pass({ west: -40, south: 0, east: -28, north: 6 })).toBe(false);           // 12: a sharpened fine product can win
    expect(pass({ west: -40, south: 0, east: -27.9, north: 6 })).toBe(true);
    expect(pass({ west: -40, south: 0, east: 0, north: 20 })).toBe(true);             // 40: /grid still asks the viewport
    expect(pass({ west: -40, south: 0, east: 0.1, north: 20 })).toBe(false);          // past it /grid asks the world box
    window.__RAW_MARINE_GLOBAL_SPAN__ = 60;
    expect(pass({ west: -40, south: 0, east: 10, north: 20 })).toBe(true);
  });

  test('no antimeridian crossing, nothing past +-180, a real box', () => {
    expect(pass({ west: 170, south: 0, east: -170, north: 20 })).toBe(false);
    expect(pass({ west: -190, south: 0, east: -160, north: 20 })).toBe(false);
    expect(pass({ west: 160, south: 0, east: 190, north: 20 })).toBe(false);
    expect(pass({ west: -40, south: 20, east: -10, north: 0 })).toBe(false);
  });

  test('a regional tile the request is not wider than (and overlaps) refuses; wider, or elsewhere, crops', () => {
    expect(pass({ west: -90, south: 20, east: -77.9, north: 32 })).toBe(true);         // over the FL tile, 12.1 vs 6 x 7: wider
    expect(midCropRulesPass({ model: 'GFS', layer: 'waves', bboxStr: '-84.9,24.1,-79.1,30.9' })).toBe(false); // span < 12 anyway
    setCachedManifest({ products: [...MANIFEST.products, product('big_pilot', { west: -100, south: 10, east: -70, north: 35 })] });
    expect(pass({ west: -95, south: 20, east: -75, north: 30 })).toBe(false);          // inside the 30 x 25 tile, not wider
    expect(pass({ west: -110, south: 20, east: -75, north: 30 })).toBe(true);          // 35 deg wide: wider than it
    expect(pass({ west: 10, south: 20, east: 30, north: 30 })).toBe(true);             // elsewhere
    expect(pass({ west: -95, south: 20, east: -75, north: 30 })).toBe(false);
    // the tile of ANOTHER layer or model does not count (the server selects per model/layer)
    setCachedManifest({ products: [...MANIFEST.products, product('big_pilot', { west: -100, south: 10, east: -70, north: 35 }, 'swell_1')] });
    expect(pass({ west: -95, south: 20, east: -75, north: 30 })).toBe(true);
  });

  test('the server yields to a tile while the request is at most tile + 0.05 deg on BOTH axes: refused there, cropped past it', () => {
    setCachedManifest({ products: [...MANIFEST.products, product('wide_pilot', { west: -100, south: 10, east: -80, north: 25 })] });   // 20 x 15
    expect(pass({ west: -100.015, south: 9.985, east: -79.985, north: 25.015 })).toBe(false);   // 20.03 x 15.03: inside the slack
    expect(pass({ west: -100.02, south: 10, east: -79.98, north: 25 })).toBe(false);             // 20.04 x 15
    expect(pass({ west: -100.04, south: 10, east: -79.96, north: 25 })).toBe(true);              // 20.08 wide: wider, the mid clip
    expect(pass({ west: -100, south: 9.96, east: -80, north: 25.04 })).toBe(true);               // 15.08 tall: wider, the mid clip
  });

  test('another model refuses on ANY overlapping regional tile (an estimated item wins whatever the width; ICON/EURO have them)', () => {
    const icon = (b) => midCropRulesPass({ model: 'ICON', layer: 'waves', bboxStr: gridBboxParam(b) });
    setCachedManifest({ products: [...MANIFEST.products.map((p) => ({ ...p, model: 'ICON' }))] });
    expect(icon({ west: -90, south: 20, east: -60, north: 35 })).toBe(false);          // over the FL tile, though 30 deg wider than it
    expect(icon({ west: 10, south: 20, east: 30, north: 30 })).toBe(true);             // no tile there
    expect(pass({ west: -90, south: 20, east: -60, north: 35 })).toBe(false);          // GFS: the manifest has no GFS product now
    setCachedManifest(MANIFEST);
    expect(pass({ west: -90, south: 20, east: -60, north: 35 })).toBe(true);           // GFS: wider than the tile is enough
  });

  test('fails closed: no manifest, an unreadable tile, the kill switch', () => {
    const box = { west: -60, south: 0, east: -30, north: 20 };
    expect(pass(box)).toBe(true);
    setCachedManifest(null);
    expect(pass(box)).toBe(false);
    setCachedManifest({ products: [...MANIFEST.products, product('broken', { west: null, south: 0, east: 1, north: 1 })] });
    expect(pass(box)).toBe(false);
    setCachedManifest(MANIFEST);
    window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
    expect(pass(box)).toBe(false);
    expect(midCropFor({ model: 'GFS', layer: 'waves', bboxStr: gridBboxParam(box), grid: WORLD_GRID })).toBeNull();
  });

  test('the seams print their URLs differently and the window follows the string sent', () => {
    const b = { west: -91.37109375, south: 20.62361, east: -67.63, north: 36.02 };
    expect(gridBboxParam(b)).toBe('-91.37109375,20.62361,-67.63,36.02');
    expect(seriesBboxParam(b)).toBe('-91.3711,20.6236,-67.6300,36.0200');
    // span 23.7411 -> pad 11.87055 -> -103.87055000000001 -> '-103.8706' (Python's f'{x:.4f}' prints the same for that double).
    // NOTE the server's clip CACHE (mid_res_tier._CLIP_CACHE) is keyed by the SNAPPED box, so after a request with the same
    // snapped box but another span it serves that request's window ('-103.8705...' here, offline 2026-10-22): the window can
    // move by a sub-cell amount with request history. Same lattice here; at worst one edge row or column, same node values.
    const win = midCropFor({ model: 'GFS', layer: 'waves', bboxStr: seriesBboxParam(b), grid: WORLD_GRID });
    expect(win.clip).toBe('-103.8706,8.1294,-55.1294,48.8706');
    expect(win.bounds).toEqual(midCropFor({ model: 'GFS', layer: 'waves', bboxStr: gridBboxParam(b), grid: WORLD_GRID }).bounds);
  });
});

describe('cropping a frame', () => {
  const grid = { bounds: { west: 0, south: 0, east: 6, north: 4 }, cols: 4, rows: 3 };
  const vectors = Array.from({ length: 12 }, (_, i) => ({ lat: Math.floor(i / 4) * 2, lng: (i % 4) * 2, speed: i, is_valid: true }));
  const win = { c0: 1, c1: 2, r0: 1, r1: 2, cols: 2, rows: 2, bounds: { west: 2, south: 2, east: 4, north: 4 }, clip: '1.0000,1.0000,5.0000,5.0000' };

  test('cropVectors keeps the clip order: south row first, west to east, the same node objects', () => {
    const out = cropVectors(vectors, grid.cols, win);
    expect(out.map((v) => v.speed)).toEqual([5, 6, 9, 10]);
    expect(out[0]).toBe(vectors[5]);
  });

  test('cropGridJson sets the clip geometry filter_grid_to_bbox sets, and keeps identity and times', () => {
    const json = { product_id: 'p', valid_time: 't', served_valid_time: 's', coverage: { west: -180 }, requested_bbox: 'x', served_bbox: 'y',
      static_frame: { path: 'f' }, grid: { bounds: grid.bounds, cols: 4, rows: 3, vectors, diagnostics: { a: 1, vectorCount: 12 } } };
    const out = cropGridJson(json, win, cropVectors(vectors, grid.cols, win));
    expect(out.product_id).toBe('p');
    expect(out.served_valid_time).toBe('s');
    expect(out.requested_bbox).toBe(win.clip);
    expect(out.served_bbox).toBe('2.0000,2.0000,4.0000,4.0000');
    expect(out.coverage).toEqual(win.bounds);
    expect(out.grid.bounds).toEqual(win.bounds);
    expect([out.grid.cols, out.grid.rows, out.grid.vectors.length]).toEqual([2, 2, 4]);
    expect(out.grid.diagnostics).toMatchObject({ a: 1, mid_res_tier: true, cols: 2, rows: 2, vectorCount: 4, renderable: true });
    expect(out.static_frame).toEqual({ path: 'f', crop: win.clip });
    expect(json.grid.cols).toBe(4);                       // the world JSON is not mutated
  });

  test('cropSeriesFrame', () => {
    const f = { hour_offset: 3, cols: 4, rows: 3, bounds: grid.bounds, vectors, product_id: 'p', static_frame: 'f' };
    const out = cropSeriesFrame(f, win, cropVectors(vectors, grid.cols, win));
    expect([out.cols, out.rows, out.vectors.length, out.hour_offset, out.product_id]).toEqual([2, 2, 4, 3, 'p']);
    expect(out.bounds).toEqual(win.bounds);
    expect(out.static_crop).toBe(win.clip);
  });
});
