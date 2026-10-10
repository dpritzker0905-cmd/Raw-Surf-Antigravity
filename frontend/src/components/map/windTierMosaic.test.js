/**
 * ONE PICTURE FROM TWO TIERS (2026-10-09): a coarser covering box no longer replaces the finer box it overlaps; the engine
 * files their mosaic on the finer lattice. The grids below are the tiers /grid serves over the Gulf (whole-degree boxes,
 * 1 / 0.5 / 0.25 deg), sampled from one analytic field so every expected value is known.
 */
import fs from 'fs';
import path from 'path';
import { tierMosaic, tierInner, tierOuter, tierSameAir, TIER_MOSAIC } from './windTierMosaic';

// A field that is NOT bilinear, so a coarse tier really differs from a fine one between nodes.
const field = (lng, lat) => [10 + 3 * Math.sin(lng * 1.7) + lat, 5 * Math.cos(lat * 2.3) - lng / 10];
const tier = (west, south, east, north, step, over = {}) => {
  const cols = Math.round((east - west) / step) + 1, rows = Math.round((north - south) / step) + 1, vectors = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng = west + i * step, lat = south + j * step, [u, v] = field(lng, lat);
      vectors.push({ lat, lng, u, v, speed: Math.hypot(u, v), is_valid: true });
    }
  }
  return {
    vectors, bounds: { west, south, east, north }, cols, rows, source: 'GFS', hourOffset: 0, valid_time: '2026-10-09T15:00:00Z',
    product_id: `box_${step}_${west}_${south}`, coverage_scope: 'viewport', truthTag: { model: 'GFS', layer: 'wind', cols, rows }, ...over,
  };
};
const at = (g, lng, lat) => {
  const dx = (g.bounds.east - g.bounds.west) / (g.cols - 1), dy = (g.bounds.north - g.bounds.south) / (g.rows - 1);
  return g.vectors[Math.round((lat - g.bounds.south) / dy) * g.cols + Math.round((lng - g.bounds.west) / dx)];
};
/** Bilinear u of a grid, as the shader samples it. */
const bilinU = (g, lng, lat) => {
  const dx = (g.bounds.east - g.bounds.west) / (g.cols - 1), dy = (g.bounds.north - g.bounds.south) / (g.rows - 1);
  const fx = (lng - g.bounds.west) / dx, fy = (lat - g.bounds.south) / dy, i = Math.min(g.cols - 2, Math.floor(fx)), j = Math.min(g.rows - 2, Math.floor(fy));
  const tx = fx - i, ty = fy - j, q = (a, b) => g.vectors[(j + b) * g.cols + i + a].u;
  return (q(0, 0) * (1 - tx) + q(1, 0) * tx) * (1 - ty) + (q(0, 1) * (1 - tx) + q(1, 1) * tx) * ty;
};

const FINE = tier(-89, 26, -86, 29, 0.25);          // the z9 box around the eye: 13x13
const BOX05 = tier(-91, 25, -84, 31, 0.5);          // the z7.5 box: 15x13
const BOX1 = tier(-95, 22, -80, 34, 1);             // the z6.5 box: 16x13
const WIN = () => ({});

describe('the zoom-out case: a 0.5-deg box arrives over the 0.25-deg box', () => {
  const m = tierMosaic(BOX05, FINE, WIN());

  it('spans the incoming box on the fine lattice and keeps the served product\'s identity', () => {
    expect(m.bounds).toEqual(BOX05.bounds);
    expect([m.cols, m.rows]).toEqual([29, 25]);
    expect(m.vectors).toHaveLength(29 * 25);
    expect(m.product_id).toBe(BOX05.product_id);
    expect(m.truthTag).toMatchObject({ model: 'GFS', cols: 29, rows: 25 });
    expect(tierOuter(m)).toBe(BOX05);
    expect(tierInner(m)).toBe(FINE);
    expect(m.__tierMosaic.kept).toEqual(FINE.bounds);
  });

  it('the eye keeps its own nodes: two cells in from the fine box\'s edge every node is the fine grid\'s, exactly', () => {
    let n = 0;
    for (let lat = 26.5; lat <= 28.5; lat += 0.25) {
      for (let lng = -88.5; lng <= -86.5; lng += 0.25) {
        expect(at(m, lng, lat).u).toBe(at(FINE, lng, lat).u);
        expect(at(m, lng, lat).v).toBe(at(FINE, lng, lat).v);
        n++;
      }
    }
    expect(n).toBe(81);
    // POSITIVE CONTROL: the coarser box alone would draw another value at a fine-only node.
    expect(Math.abs(bilinU(BOX05, -87.25, 27.75) - at(FINE, -87.25, 27.75).u)).toBeGreaterThan(0.05);
  });

  it('outside the fine box it draws the incoming box exactly as the shader would (bilinear between its nodes)', () => {
    for (const [lng, lat] of [[-90.75, 25.25], [-85.25, 30.75], [-90, 27.25], [-84.5, 25.5]]) {
      expect(at(m, lng, lat).u).toBeCloseTo(bilinU(BOX05, lng, lat), 9);
    }
    expect(at(m, -91, 25)).toMatchObject({ u: at(BOX05, -91, 25).u, v: at(BOX05, -91, 25).v });   // a shared node
  });

  it('the fine box\'s inner edges blend over two cells: the edge node is the incoming box, the next one half-way', () => {
    const edge = at(m, -89, 27.25), one = at(m, -88.75, 27.25);
    expect(edge.u).toBeCloseTo(bilinU(BOX05, -89, 27.25), 9);
    expect(one.u).toBeCloseTo((bilinU(BOX05, -88.75, 27.25) + at(FINE, -88.75, 27.25).u) / 2, 9);
    expect(one.speed).toBeCloseTo(Math.hypot(one.u, one.v), 12);
    expect(TIER_MOSAIC.featherCells).toBe(2);
  });
});

describe('ladders', () => {
  it('a second step out (the 1-deg box) keeps the ORIGINAL 0.25-deg nodes, not a resample of a resample', () => {
    const m1 = tierMosaic(BOX05, FINE, WIN()), m2 = tierMosaic(BOX1, m1, WIN());
    expect(tierInner(m2)).toBe(FINE);
    expect(tierOuter(m2)).toBe(BOX1);
    expect(m2.bounds).toEqual(BOX1.bounds);
    expect([m2.cols, m2.rows]).toEqual([61, 49]);
    expect(at(m2, -87.25, 27.75).u).toBe(at(FINE, -87.25, 27.75).u);
    expect(at(m2, -93.25, 30.5).u).toBeCloseTo(bilinU(BOX1, -93.25, 30.5), 9);
  });

  it('zooming back in over a mosaic: the 0.5-deg box becomes the surround again, the fine nodes stay', () => {
    const wide = tierMosaic(BOX1, FINE, WIN()), back = tierMosaic(BOX05, wide, WIN());
    expect(back.bounds).toEqual(BOX05.bounds);
    expect(at(back, -87.25, 27.75).u).toBe(at(FINE, -87.25, 27.75).u);
    expect(at(back, -90.25, 30.25).u).toBeCloseTo(bilinU(BOX05, -90.25, 30.25), 9);
  });

  it('a fine box that hangs over the incoming box is cut at its rim, where no blend is applied', () => {
    const shifted = tier(-88, 27, -82, 33, 0.5);                       // the fine box's west and south parts lie outside
    const m = tierMosaic(shifted, FINE, WIN());
    expect(m.bounds).toEqual(shifted.bounds);
    expect(m.__tierMosaic.kept).toEqual({ west: -88, south: 27, east: -86, north: 29 });
    expect(at(m, -88, 27).u).toBe(at(FINE, -88, 27).u);                // on the mosaic's rim: fine, unblended
    expect(at(m, -86, 28).u).toBeCloseTo(bilinU(shifted, -86, 28), 9); // the fine box's east edge is inside: blended
  });
});

describe('it returns null (the engine then files the incoming box as before)', () => {
  it('POSITIVE CONTROL: the kill switch', () => {
    expect(tierMosaic(BOX05, FINE, { __RAW_DISABLE_WIND_TIER_MOSAIC__: true })).toBeNull();
  });
  it('an incoming grid that is not a coarser tier', () => {
    expect(tierMosaic(tier(-90, 25, -85, 30, 0.25), FINE, WIN())).toBeNull();
    expect(tierMosaic(FINE, BOX05, WIN())).toBeNull();
  });
  it('another model, hour, valid time or model run; stale data inside a fresh box', () => {
    expect(tierMosaic(tier(-91, 25, -84, 31, 0.5, { source: 'ICON' }), FINE, WIN())).toBeNull();
    expect(tierMosaic(tier(-91, 25, -84, 31, 0.5, { hourOffset: 3 }), FINE, WIN())).toBeNull();
    expect(tierMosaic(tier(-91, 25, -84, 31, 0.5, { valid_time: '2026-10-09T18:00:00Z' }), FINE, WIN())).toBeNull();
    expect(tierMosaic(tier(-91, 25, -84, 31, 0.5, { valid_time: undefined }), FINE, WIN())).toBeNull();
    expect(tierMosaic(tier(-91, 25, -84, 31, 0.5, { run_time: '2026-10-09T12:00:00Z' }), { ...FINE, run_time: '2026-10-09T06:00:00Z' }, WIN())).toBeNull();
    expect(tierMosaic(BOX05, { ...FINE, stale: true }, WIN())).toBeNull();
    expect(tierSameAir({ ...BOX05, stale: true }, FINE)).toBe(true);     // a fresh fine box inside a stale surround is fine
    expect(tierSameAir(BOX05, { ...FINE, run_time: '2026-10-09T12:00:00Z' })).toBe(true); // only one side names its run
  });
  it('a fine box that has left the incoming box (under four cells of overlap either way)', () => {
    expect(TIER_MOSAIC.minInnerCells).toBe(4);
    expect(tierMosaic(tier(-86.5, 20, -80, 29, 0.5), FINE, WIN())).toBeNull();    // 0.5 deg of longitude left: 2 cells
    expect(tierMosaic(tier(-87, 20, -80, 26.5, 0.5), FINE, WIN())).toBeNull();    // 0.5 deg of latitude left
    expect(tierMosaic(tier(-80, 10, -70, 20, 1), FINE, WIN())).toBeNull();        // no overlap at all
    expect(tierMosaic(tier(-87, 20, -80, 27, 0.5), FINE, WIN())).not.toBeNull();  // 1 x 1 deg left: 4 cells, kept
  });
  it('an antimeridian box, a malformed grid, a non-finite vector, or a lattice above the node cap', () => {
    expect(tierMosaic({ ...BOX05, bounds: { west: 175, south: 25, east: -175, north: 31 } }, FINE, WIN())).toBeNull();
    expect(tierMosaic({ ...BOX05, vectors: BOX05.vectors.slice(1) }, FINE, WIN())).toBeNull();
    expect(tierMosaic(null, FINE, WIN())).toBeNull();
    expect(tierMosaic(BOX05, null, WIN())).toBeNull();
    const holed = { ...FINE, vectors: FINE.vectors.map((q, k) => (k === 84 ? { ...q, u: NaN } : q)) };
    expect(tierMosaic(BOX05, holed, WIN())).toBeNull();
    expect(tierMosaic(tier(-140, 0, -40, 60, 1), FINE, WIN())).toBeNull();   // 401 x 241 nodes at 0.25 deg
    expect(401 * 241).toBeGreaterThan(TIER_MOSAIC.maxNodes);
  });
});

describe('bookkeeping and wiring', () => {
  it('counts what it built on the window, for the console', () => {
    const win = {};
    tierMosaic(BOX05, FINE, win);
    tierMosaic(BOX1, FINE, win);
    expect(win.__WIND_TIER_MOSAIC__.built).toBe(2);
    expect(win.__WIND_TIER_MOSAIC__.last).toMatchObject({ outer: '16x13 @ 1 deg', inner: '13x13 @ 0.25 deg', cols: 61, rows: 49 });
  });
  it('plain grids are their own inner and outer', () => {
    expect(tierInner(FINE)).toBe(FINE);
    expect(tierOuter(FINE)).toBe(FINE);
    expect(tierInner(null)).toBeNull();
  });
  it('the engine asks after the two keep rules, judges "inside the fine box" on the truly fine box, and no-ops a re-delivery of the served box', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(eng).toContain("import { tierMosaic, tierInner, tierOuter } from './windTierMosaic';");
    const clip = eng.indexOf("return 'noop_base_clip';"), mosaic = eng.indexOf('windGrid = tierMosaic(windGrid, this._windFine.windGrid) || windGrid;');
    expect(clip).toBeGreaterThan(0);
    expect(mosaic).toBeGreaterThan(clip);
    expect(mosaic).toBeLessThan(eng.indexOf('this._windFine = encodeWindTexture(gl, windGrid);'));
    expect(eng).toContain("if (windBoundsContain(tierInner(this._windFine.windGrid).bounds, windGrid.bounds)) return 'noop_coarser_than_fine';");
    expect(eng).toContain('residentSameSlot = tierOuter(this._windFine.windGrid);');
  });
  it('the overlay read-back the commit gate consults reports the lattice of the SERVED box, mosaic or not', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(eng).toContain('? { active: true, bounds: fine.bounds, cols: tierOuter(fine.windGrid)?.cols, rows: tierOuter(fine.windGrid)?.rows,');
    // keepResidentFine (WeatherEngine's gate) then sees the cell the server sent: a mosaic of a 1-deg box reads 1 deg.
    const m = tierMosaic(BOX1, FINE, WIN());
    expect((m.bounds.east - m.bounds.west) / (tierOuter(m).cols - 1)).toBe(1);
  });
});
