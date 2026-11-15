import {
  MOSAIC_STEP, coastMaskFromBuffer, coastalNode, composeMosaic, mosaicBoxes, mosaicLattice, onMosaicLattice, padNode,
  prefetchRatedNeighbours, tryRatedMosaic, _setCoastMaskForTest,
} from './staticRatedMosaic';

// A south-first row-major rated frame on the 0.25 lattice (staticFrameCodec.buildVectors' shape): score = f(lat, lng) on coastal
// nodes (phys_speed set), invalid elsewhere.
function frame(bounds, scoreFn) {
  const cols = Math.round((bounds.east - bounds.west) / MOSAIC_STEP) + 1;
  const rows = Math.round((bounds.north - bounds.south) / MOSAIC_STEP) + 1;
  const vectors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lat = bounds.south + r * MOSAIC_STEP; const lng = bounds.west + c * MOSAIC_STEP;
    const s = scoreFn(lat, lng);
    vectors.push(s == null ? { lat, lng, speed: 1.2, is_valid: false, phys_speed: 1.2 } : { lat, lng, speed: s / 10, is_valid: true, phys_speed: 1.5 });
  }
  return { grid: { bounds, cols, rows }, vectors };
}
const score = (lat, lng) => Math.round((50 + 10 * Math.sin(lat * 3) + 5 * Math.cos(lng * 2)) * 10) / 10;

// A coast mask with the given 0.25 nodes set coastal.
function maskWith(nodes) {
  const bits = new Uint8Array(Math.ceil((1440 * 721) / 8));
  for (const [lat, lng] of nodes) {
    const i = Math.round((lat + 90) / 0.25) * 1440 + Math.round((lng + 180) / 0.25);
    bits[i >> 3] |= 1 << (i & 7);
  }
  return bits;
}

afterEach(() => { delete window.__RAW_DISABLE_RATED_MOSAIC__; delete window.__RAW_DISABLE_RATED_PREFETCH__; _setCoastMaskForTest(null); });

describe('mosaicBoxes', () => {
  test('a Florida z8 view overhanging the box east edge overlaps florida_east_coast (the measured miss)', () => {
    const ids = mosaicBoxes({ model: 'GFS', layer: 'waves', bbox: { west: -82.6, south: 26.2, east: -78.3, north: 30.2 } }).map((b) => b.id);
    expect(ids).toEqual(['florida_east_coast']);
  });
  test('a view on the Florida/Georgia line overlaps both boxes', () => {
    const ids = mosaicBoxes({ model: 'GFS', layer: 'waves', bbox: { west: -82, south: 29, east: -79.5, north: 33 } }).map((b) => b.id).sort();
    expect(ids).toEqual(['florida_east_coast', 'us_southeast_midatlantic']);
  });
  test('rated keys, GFS only, wide views refused', () => {
    expect(mosaicBoxes({ model: 'GFS', layer: 'waves', bbox: { west: -82, south: 26, east: -78, north: 30 } })[0].key)
      .toMatch(/florida_east_coast_rated$/);
    expect(mosaicBoxes({ model: 'ICON', layer: 'waves', bbox: { west: -82, south: 26, east: -78, north: 30 } })).toEqual([]);
    expect(mosaicBoxes({ model: 'GFS', layer: 'waves', bbox: { west: -100, south: 20, east: -70, north: 40 } })).toEqual([]);
  });
});

describe('lattice', () => {
  test('snaps outward to 0.25 multiples', () => {
    expect(mosaicLattice({ west: -82.6, south: 26.2, east: -78.3, north: 30.2 }).bounds).toEqual({ west: -82.75, south: 26, east: -78.25, north: 30.25 });
  });
  test('onMosaicLattice accepts a 0.25 box frame and refuses 0.5 or offset grids', () => {
    expect(onMosaicLattice({ bounds: { west: -85, south: 24, east: -79, north: 31 }, cols: 25, rows: 29 })).toBe(true);
    expect(onMosaicLattice({ bounds: { west: -85, south: 24, east: -79, north: 31 }, cols: 13, rows: 15 })).toBe(false);
    expect(onMosaicLattice({ bounds: { west: -84.9, south: 24, east: -78.9, north: 31 }, cols: 25, rows: 29 })).toBe(false);
  });
});

describe('coast mask', () => {
  test('reads the baked header and bits', () => {
    const bits = maskWith([[28, -78.75]]);
    const buf = new Uint8Array(16 + bits.length);
    buf.set([82, 83, 67, 78]); new DataView(buf.buffer).setUint16(4, 1, true);
    new DataView(buf.buffer).setUint16(6, 1440, true); new DataView(buf.buffer).setUint16(8, 721, true);
    buf.set(bits, 16);
    const m = coastMaskFromBuffer(buf.buffer);
    expect(coastalNode(m, 28, -78.75)).toBe(true);
    expect(coastalNode(m, 28, -78.5)).toBe(false);
    expect(coastalNode(null, 28, -78.5)).toBe(null);
    expect(coastMaskFromBuffer(new Uint8Array(20).buffer)).toBe(null);
  });
});

describe('composeMosaic', () => {
  const box = { id: 'florida_east_coast' };
  const fl = { box, ...frame({ west: -83, south: 26, east: -79, north: 31 }, score) };
  const view = { west: -81, south: 27, east: -78.5, north: 29 };

  test('ZOOM INVARIANCE: every node a box holds is that box frame node, unchanged (same value at every zoom)', () => {
    const m = composeMosaic(view, [fl], null, maskWith([]));
    expect(m.miss).toBeUndefined();
    for (const v of m.vectors) {
      if (v.lng <= -79 + 1e-9) {
        expect(v.speed).toBe(score(v.lat, v.lng) / 10);
        expect(v.is_valid).toBe(true);
      }
    }
    // a wider (zoomed-out) view reads the same nodes: identical scores where both views hold a node
    const wide = composeMosaic({ west: -82.5, south: 26.5, east: -78.5, north: 30 }, [fl], null, maskWith([]));
    const at = (vs) => new Map(vs.map((v) => [`${v.lat},${v.lng}`, v.speed]));
    const a = at(m.vectors); const b = at(wide.vectors);
    let shared = 0;
    for (const [k, s] of a) if (b.has(k)) { shared += 1; expect(b.get(k)).toBe(s); }
    expect(shared).toBeGreaterThan(50);
  });

  test('nodes past the box are padded invalid where the coast mask says not coastal', () => {
    const m = composeMosaic(view, [fl], null, maskWith([]));
    const pads = m.vectors.filter((v) => v.lng > -79 + 1e-9);
    expect(pads.length).toBe(m.padded);
    expect(pads.every((v) => v.is_valid === false)).toBe(true);
  });

  test('a COASTAL node past the box refuses the mosaic (only the server rates it)', () => {
    expect(composeMosaic(view, [fl], null, maskWith([[28, -78.75]])).miss).toBe('mosaic_uncovered_coast');
  });

  test('no mask: refused (never guess)', () => {
    expect(composeMosaic(view, [fl], null, null).miss).toBe('mosaic_no_coast_mask');
  });

  test('two boxes: each node from the box that holds it', () => {
    const north = { box: { id: 'us_southeast_midatlantic' }, ...frame({ west: -82, south: 31, east: -74.5, north: 37.5 }, (la, ln) => 70) };
    const m = composeMosaic({ west: -81, south: 30, east: -79.5, north: 32 }, [fl, north], null, maskWith([]));
    expect(m.miss).toBeUndefined();
    const v32 = m.vectors.find((v) => v.lat === 32 && v.lng === -80);
    expect(v32.speed).toBe(7);
    const v30 = m.vectors.find((v) => v.lat === 30 && v.lng === -80);
    expect(v30.speed).toBe(score(30, -80) / 10);
  });

  test('padNode carries the world node honest sea, invalid', () => {
    const world = { grid: { bounds: { west: -180, south: -80, east: 180, north: 84 }, cols: 181, rows: 83 }, vectors: [] };
    world.vectors[(Math.round((28 + 80) / 2)) * 181 + Math.round((-78 + 180) / 2)] = { speed: 2.1, phys_speed: 2.1, is_valid: false, u: 1, v: 1 };
    const p = padNode(world, 28, -78.25);
    expect(p).toMatchObject({ lat: 28, lng: -78.25, speed: 2.1, is_valid: false });
    expect(padNode(null, 28, -78.25)).toMatchObject({ speed: 0, is_valid: false });
  });
});

describe('tryRatedMosaic', () => {
  const VT = '2026-11-15T18:00:00Z';
  const fl = frame({ west: -83, south: 26, east: -79, north: 31 }, score);
  function deps(over = {}) {
    const misses = [];
    const indexFor = (key) => ({ frames: [{ valid_time: VT, path: `${key}/f.bin`, grid: fl.grid }], common_meta: { model: 'GFS', layer: 'waves' } });
    return {
      misses,
      d: {
        getPinnedIndex: async (key) => (key.includes('florida') ? indexFor(key) : null),
        loadFrameVectors: async () => fl.vectors,
        setEnabled: (key) => key.includes('florida'),
        askOffsetServed: () => true,
        worldKey: 'GFS/marine/waves/global_mid_rated',
        noteMiss: (r) => { misses.push(r); return null; },
        ...over,
      },
    };
  }
  const view = { west: -81, south: 27, east: -78.5, north: 29 };

  test('serves an overhanging view from the box bundle, stamped as a mosaic', async () => {
    _setCoastMaskForTest(maskWith([]));
    const { d, misses } = deps();
    const json = await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: view }, d);
    expect(misses).toEqual([]);
    expect(json.coverage_mode).toBe('regional_mosaic');
    // OVERSCAN: one view on every side, on the 0.25 lattice (the pad is open ocean in this mask)
    expect(json.grid.bounds).toEqual({ west: -83.5, south: 25, east: -76, north: 31 });
    expect(json.grid.vectors.length).toBe(json.grid.cols * json.grid.rows);
    expect(json.grid.diagnostics.mosaic).toMatchObject({ boxes: ['florida_east_coast'] });
    expect(json.grid.diagnostics.surf_transform.rated).toBeGreaterThan(0);
    // RATED on the wire: the mapper reads value_kind (a bare-counts tag shipped the mosaic as unrated, caught offline)
    expect(json.grid.diagnostics.surf_transform.value_kind).toBe('surf_rating');
  });

  test('kill switch: null, nothing asked', async () => {
    window.__RAW_DISABLE_RATED_MOSAIC__ = true;
    const { d } = deps({ getPinnedIndex: jest.fn() });
    expect(await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: view }, d)).toBe(null);
    expect(d.getPinnedIndex).not.toHaveBeenCalled();
  });

  test('an unbuilt frame or an ask outside the offsets misses (the caller asks /grid)', async () => {
    _setCoastMaskForTest(maskWith([]));
    let t = deps({ askOffsetServed: () => false });
    expect(await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: view }, t.d)).toBe(null);
    expect(t.misses).toEqual(['mosaic_ask_offset']);
    t = deps({ getPinnedIndex: async () => ({ frames: [{ valid_time: VT, path: null }] }) });
    expect(await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: view }, t.d)).toBe(null);
    expect(t.misses).toEqual(['mosaic_unbuilt_frame']);
  });

  test('a coastal node outside every box misses', async () => {
    _setCoastMaskForTest(maskWith([[28, -78.75]]));
    const { d, misses } = deps();
    expect(await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: view }, d)).toBe(null);
    expect(misses).toEqual(['mosaic_uncovered_coast']);
  });
});

describe('prefetchRatedNeighbours', () => {
  test('warms the bundles of boxes within one viewport, low priority, CDN only', async () => {
    _setCoastMaskForTest(maskWith([]));
    const loads = [];
    const d = {
      getPinnedIndex: async (key) => ({ frames: [{ valid_time: '2026-11-15T18:00:00Z', path: `${key}/f` }] }),
      loadFrameVectors: async (key, f, s, o) => { loads.push([key, o.priority]); return []; },
      setEnabled: () => true,
    };
    const keys = prefetchRatedNeighbours({ model: 'GFS', layer: 'waves', validTimeStr: '2026-11-15T18:00:00Z', bbox: { west: -81, south: 29, east: -79, north: 31 } }, d);
    expect(keys.some((k) => k.includes('florida_east_coast'))).toBe(true);
    expect(keys.some((k) => k.includes('us_southeast_midatlantic'))).toBe(true);
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    expect(loads.length).toBe(keys.length);
    expect(loads.every(([, p]) => p === 'low')).toBe(true);
  });
  test('kill switch', () => {
    window.__RAW_DISABLE_RATED_PREFETCH__ = true;
    expect(prefetchRatedNeighbours({ model: 'GFS', layer: 'waves', validTimeStr: 'x', bbox: { west: -81, south: 29, east: -79, north: 31 } }, { setEnabled: () => true })).toEqual([]);
  });
});

describe('overscanBox', () => {
  const { overscanBox } = require('./staticRatedMosaic');
  test('one view on every side', () => {
    expect(overscanBox({ west: -81, south: 29, east: -79, north: 30 })).toEqual({ west: -83, south: 28, east: -77, north: 31 });
  });
  test('capped so the mosaic stays regional', () => {
    const o = overscanBox({ west: -90, south: 20, east: -78, north: 30 });
    expect(o.east - o.west).toBeCloseTo(15.0);   // pick_surf_regional_override's 15 deg exactly
  });
});

describe('overscan falls back to the exact view', () => {
  const { tryRatedMosaic, _setCoastMaskForTest: setMask, MOSAIC_STEP: S } = require('./staticRatedMosaic');
  test('a coast in the margin only: the exact view is served', async () => {
    const bits = new Uint8Array(Math.ceil((1440 * 721) / 8));
    const i = Math.round((28 + 90) / 0.25) * 1440 + Math.round((-77.5 + 180) / 0.25);
    bits[i >> 3] |= 1 << (i & 7);
    setMask(bits);
    const b = { west: -83, south: 26, east: -79, north: 31 };
    const cols = (b.east - b.west) / S + 1; const rows = (b.north - b.south) / S + 1;
    const vectors = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) vectors.push({ lat: b.south + r * S, lng: b.west + c * S, speed: 5, is_valid: true, phys_speed: 1 });
    const VT = '2026-11-15T18:00:00Z';
    const d = {
      getPinnedIndex: async (key) => (key.includes('florida') ? { frames: [{ valid_time: VT, path: 'x', grid: { bounds: b, cols, rows } }] } : null),
      loadFrameVectors: async () => vectors, setEnabled: (k) => k.includes('florida'), askOffsetServed: () => true,
      worldKey: 'w', noteMiss: () => null,
    };
    const json = await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: { west: -81, south: 27, east: -78.5, north: 29 } }, d);
    expect(json.grid.bounds).toEqual({ west: -81, south: 27, east: -78.5, north: 29 });
    setMask(null);
  });
});

describe('kill switches (inventory)', () => {
  const { tryRatedMosaic, _setCoastMaskForTest: setMask, MOSAIC_STEP: S } = require('./staticRatedMosaic');
  const { staticRatedReadySync } = require('./staticFrames');
  afterEach(() => { delete window.__RAW_DISABLE_RATED_OVERSCAN__; delete window.__RAW_DISABLE_RATED_READY_FAST__; setMask(null); });
  test('__RAW_DISABLE_RATED_OVERSCAN__: the mosaic serves the exact view', async () => {
    window.__RAW_DISABLE_RATED_OVERSCAN__ = true;
    setMask(new Uint8Array(Math.ceil((1440 * 721) / 8)));
    const b = { west: -83, south: 26, east: -79, north: 31 };
    const cols = (b.east - b.west) / S + 1; const rows = (b.north - b.south) / S + 1;
    const vectors = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) vectors.push({ lat: b.south + r * S, lng: b.west + c * S, speed: 5, is_valid: true, phys_speed: 1 });
    const VT = '2026-11-15T18:00:00Z';
    const d = { getPinnedIndex: async (k) => (k.includes('florida') ? { frames: [{ valid_time: VT, path: 'x', grid: { bounds: b, cols, rows } }] } : null),
      loadFrameVectors: async () => vectors, setEnabled: (k) => k.includes('florida'), askOffsetServed: () => true, worldKey: 'w', noteMiss: () => null };
    const json = await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: { west: -81, south: 27, east: -78.5, north: 29 } }, d);
    expect(json.grid.bounds).toEqual({ west: -81, south: 27, east: -78.5, north: 29 });
  });
  test('__RAW_DISABLE_RATED_READY_FAST__: never the fast lane; and cold (no coast mask) is never ready', () => {
    const vt = () => '2026-11-15T18:00:00Z';
    const view = { west: -81, south: 29, east: -79, north: 30 };
    expect(staticRatedReadySync(view, 'GFS', 0, 'waves', vt)).toBe(false);          // cold: no mask, no pins
    setMask(new Uint8Array(Math.ceil((1440 * 721) / 8)));
    window.__RAW_DISABLE_RATED_READY_FAST__ = true;
    expect(staticRatedReadySync(view, 'GFS', 0, 'waves', vt)).toBe(false);
  });
});
describe('review fixes 2026-11-15', () => {
  const { tryRatedMosaic, pickBoxFrame, _setCoastMaskForTest: setMask, MOSAIC_STEP: S } = require('./staticRatedMosaic');
  afterEach(() => setMask(null));
  const VT = '2026-11-15T18:00:00Z';
  const fl = { west: -83, south: 26, east: -79, north: 31 };
  const cols = (fl.east - fl.west) / S + 1; const rows = (fl.north - fl.south) / S + 1;
  const vectors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) vectors.push({ lat: fl.south + r * S, lng: fl.west + c * S, speed: 5, is_valid: true, phys_speed: 1 });
  const idx = (run) => ({ run, frames: [{ valid_time: VT, path: `p-${run}`, grid: { bounds: fl, cols, rows } }] });
  test('a box that only reaches the overscan margin and fails drops the margin, not the ask', async () => {
    setMask(new Uint8Array(Math.ceil((1440 * 721) / 8)));
    const misses = [];
    const d = { getPinnedIndex: async (k) => (k.includes('florida') ? idx('06Z') : null),   // us_southeast (margin only) has no index
      loadFrameVectors: async () => vectors, setEnabled: () => true, askOffsetServed: () => true, worldKey: 'w', noteMiss: (r) => { misses.push(r); return null; } };
    const json = await tryRatedMosaic({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: { west: -81, south: 29.5, east: -79.5, north: 30.5 } }, d);   // overscan reaches 31.5: us_southeast's margin
    expect(misses).toEqual([]);
    expect(json.grid.bounds).toEqual({ west: -81, south: 29.5, east: -79.5, north: 30.5 });
  });
  test('two boxes on different runs: refused (one run per mosaic)', async () => {
    const first = { box: { id: 'a' }, index: idx('06Z'), frame: idx('06Z').frames[0] };
    const d = { getPinnedIndex: async () => idx('00Z'), askOffsetServed: () => true };
    expect(await pickBoxFrame({ id: 'b', key: 'k' }, Date.parse(VT), d, first)).toBe('mosaic_mixed_run');
    expect(typeof await pickBoxFrame({ id: 'b', key: 'k' }, Date.parse(VT), { ...d, getPinnedIndex: async () => idx('06Z') }, first)).toBe('object');
  });
});