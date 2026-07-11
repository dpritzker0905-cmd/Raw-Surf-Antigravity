/**
 * decodedOmSampler (2026-07-11, temp-pair infobox v2): sampling the client-decoded om grids.
 * Load-bearing facts under test: row 0 = SOUTH (probed live on gfs013 + ifs025 — a row-north
 * read mirrors into the opposite hemisphere), display-consistency via the active slot's
 * model+timeIndex, and NaN (ocean-fill land interior) → null.
 */
import { sampleDecodedOmValue, resolveDisplayedSlot } from './decodedOmSampler';

const GRID_URL = (model, ti) => `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${ti}&variable=surface_temperature&contours=true`;

function makeMap({ model = 'ncep_gfs013', ti = 7, activeSlot = 1 } = {}) {
  return {
    getSource: (id) => {
      const m = id.match(/water_temp-slot-(\d)-source/);
      if (!m) return null;
      const s = +m[1];
      if (s === 0) return { url: 'om://transparent-tile' };
      return { url: GRID_URL(model, s === activeSlot ? ti : ti + 1) };
    },
    getPaintProperty: (id) => {
      const m = id.match(/water_temp-slot-(\d)-layer/);
      if (!m) return 0;
      return +m[1] === activeSlot ? ['interpolate', ['linear'], ['zoom'], 2, 0.45] : 0;
    },
  };
}

// 4×3 grid, bounds [w=0, s=0, e=4, n=3], row 0 = SOUTH: values encode row*10+col.
function makeTile(over = {}) {
  const nx = 4, ny = 3;
  const values = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) values[y * nx + x] = y * 10 + x;
  return { variable: 'surface_temperature', model: 'ncep_gfs013', timeIndex: 7, timestamp: 1000, bounds: [0, 0, 4, 3], nx, ny, values, ...over };
}

const tilesOf = (...ts) => new Map(ts.map((t, i) => [`k${i}`, t]));

describe('resolveDisplayedSlot', () => {
  it('returns the ACTIVE slot (paint expression) model + timeIndex', () => {
    expect(resolveDisplayedSlot(makeMap({ ti: 7, activeSlot: 1 }), 'water_temp')).toEqual({ model: 'ncep_gfs013', timeIndex: 7 });
  });
  it('falls back to any real slot when no active paint expression is found', () => {
    const map = makeMap({ ti: 4, activeSlot: 9 }); // no slot matches "active"
    expect(resolveDisplayedSlot(map, 'water_temp')).toEqual({ model: 'ncep_gfs013', timeIndex: 5 });
  });
});

describe('sampleDecodedOmValue', () => {
  it('samples row-SOUTH: the northernmost row is the LAST rows of the array', () => {
    // lat near n=3 → fy≈1 → iy = ny-1 = 2 → values 20..23; lng near w=0 → ix 0
    const v = sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: 2.9, lng: 0.1 },
      { map: makeMap(), tiles: tilesOf(makeTile()) });
    expect(v).toBe(20);
  });

  it('samples the tile matching the DISPLAYED timeIndex, not the newest', () => {
    const displayed = makeTile({ timeIndex: 7, timestamp: 1000 });
    displayed.values[0] = 99; // s-w corner marker
    const newer = makeTile({ timeIndex: 8, timestamp: 2000 });
    const v = sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: 0.01, lng: 0.01 },
      { map: makeMap({ ti: 7 }), tiles: tilesOf(newer, displayed) });
    expect(v).toBe(99);
  });

  it('NaN (ocean-fill land interior) → null', () => {
    const t = makeTile();
    t.values[2 * 4 + 0] = NaN;
    const v = sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: 2.9, lng: 0.1 },
      { map: makeMap(), tiles: tilesOf(t) });
    expect(v).toBeNull();
  });

  it('out-of-bounds lat/lng → null', () => {
    const v = sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: 50, lng: 50 },
      { map: makeMap(), tiles: tilesOf(makeTile()) });
    expect(v).toBeNull();
  });

  it('no decodes → null (graceful before the first render)', () => {
    expect(sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: 1, lng: 1 },
      { map: makeMap(), tiles: new Map() })).toBeNull();
  });
});
