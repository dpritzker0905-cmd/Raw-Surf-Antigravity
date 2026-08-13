import { findOccludingWaterFill, planAnchorMoves } from './waterTempAnchor';

/**
 * The fixture is the REAL measured stack from `dev--rawsurf.netlify.app/map`, z2, model GFS held
 * fixed, 2026-08-13 (WS-CAN-0061 / LV-11). Indices and layer identities are as observed, not
 * invented: `queryRenderedFeatures` at an ocean pixel returned exactly `water` (11) and
 * `water-shadow` (17), both opaque `fill` layers above `ocean-mask-fill` (6).
 */
const LIVE_ORDER = [
  'background',                 // 0
  'land',                       // 1
  'landcover',                  // 2
  'water_temp-slot-0-layer',    // 3   ← where the re-assert put them
  'water_temp-slot-1-layer',    // 4
  'water_temp-slot-2-layer',    // 5
  'ocean-mask-fill',            // 6   ← the anchor
  'ocean-mask-line',            // 7
  'landuse',                    // 8
  'national-park',              // 9
  'hillshade',                  // 10
  'water',                      // 11  ← OCCLUDER (measured)
  'waterway',                   // 12  must NOT match: no separator after "water"
  'water-point-label',          // 13  not a fill
  'building',                   // 14
  'road',                       // 15
  'admin',                      // 16
  'water-shadow',               // 17  ← OCCLUDER (measured)
  'poi-label',                  // 18
];

const TYPES = {
  water: { type: 'fill', sourceLayer: 'water' },
  'water-shadow': { type: 'fill', sourceLayer: 'water' },
  waterway: { type: 'line', sourceLayer: 'waterway' },
  'water-point-label': { type: 'symbol', sourceLayer: 'water' },
  'ocean-mask-fill': { type: 'fill' },
  'ocean-mask-line': { type: 'line' },
  'ocean-mask-inland-water': { type: 'fill', sourceLayer: 'water' },
  background: { type: 'background' },
  land: { type: 'fill' },
  landcover: { type: 'fill' },
  landuse: { type: 'fill' },
  'national-park': { type: 'fill' },
  hillshade: { type: 'fill' },
  building: { type: 'fill' },
  road: { type: 'line' },
  admin: { type: 'line' },
  'poi-label': { type: 'symbol' },
};
const getLayer = (id) => TYPES[id] || (/^water_temp-slot-/.test(id) ? { type: 'raster' } : null);
const idxOf = (id) => LIVE_ORDER.indexOf(id);

describe('waterTempAnchor — the post-condition 0dcfc4ee never had', () => {
  test('REPRODUCES THE DEFECT: the live stack is refused, naming the measured occluder', () => {
    const plan = planAnchorMoves(LIVE_ORDER, idxOf('ocean-mask-fill'), getLayer);
    expect(plan.refuse).toBe(true);
    expect(plan.occluder).toBe('water-shadow'); // highest-indexed of the two measured occluders
    expect(plan.moves).toEqual([]);             // and it does NOT bury the field
  });

  test('a safe stack still performs the 0dcfc4ee move — the guard must not disable the fix', () => {
    // ocean-mask-fill raised ABOVE both water fills (fix option 1), slots mounted above it
    const safe = [
      'background', 'land', 'water', 'water-shadow', 'ocean-mask-fill',
      'water_temp-slot-0-layer', 'water_temp-slot-1-layer', 'water_temp-slot-2-layer', 'poi-label',
    ];
    const plan = planAnchorMoves(safe, safe.indexOf('ocean-mask-fill'), getLayer);
    expect(plan.refuse).toBe(false);
    expect(plan.occluder).toBeNull();
    expect(plan.moves.map((m) => m.id)).toEqual([
      'water_temp-slot-0-layer', 'water_temp-slot-1-layer', 'water_temp-slot-2-layer',
    ]);
  });

  test('slots already below the anchor are a no-op (loop-safety, preserved from 0dcfc4ee)', () => {
    const safe = [
      'background', 'water', 'water_temp-slot-0-layer', 'ocean-mask-fill', 'poi-label',
    ];
    // `water` is BELOW the fill here, so it is not an occluder
    const plan = planAnchorMoves(safe, safe.indexOf('ocean-mask-fill'), getLayer);
    expect(plan.refuse).toBe(false);
    expect(plan.moves).toEqual([]);
  });

  test('`waterway` does not count — a line layer, and no separator after "water"', () => {
    const order = ['ocean-mask-fill', 'waterway'];
    expect(findOccludingWaterFill(order, 0, getLayer)).toBeNull();
  });

  test('`water-point-label` does not count — matches the name but is not a fill', () => {
    const order = ['ocean-mask-fill', 'water-point-label'];
    expect(findOccludingWaterFill(order, 0, getLayer)).toBeNull();
  });

  test('ocean-mask-* is excluded, or the guard would refuse forever and restore the land bleed', () => {
    const order = ['ocean-mask-fill', 'ocean-mask-inland-water', 'water_temp-slot-0-layer'];
    expect(findOccludingWaterFill(order, 0, getLayer)).toBeNull();
    expect(planAnchorMoves(order, 0, getLayer).refuse).toBe(false);
  });

  test('the field itself is never treated as its own occluder', () => {
    const order = ['ocean-mask-fill', 'water_temp-slot-0-layer'];
    expect(findOccludingWaterFill(order, 0, getLayer)).toBeNull();
  });

  test('sourceLayer alone is sufficient — an occluder that is not name-matched still counts', () => {
    const order = ['ocean-mask-fill', 'hydrography'];
    const gl = (id) => (id === 'hydrography' ? { type: 'fill', sourceLayer: 'water' } : null);
    expect(findOccludingWaterFill(order, 0, gl)).toBe('hydrography');
  });

  test('the kill switch restores the pre-fix behaviour exactly', () => {
    const plan = planAnchorMoves(LIVE_ORDER, idxOf('ocean-mask-fill'), getLayer, { guardDisabled: true });
    expect(plan.refuse).toBe(false);
    expect(plan.moves.map((m) => m.id)).toEqual([]); // slots are already below in the live stack
  });

  test('degenerate inputs never throw and never move anything', () => {
    expect(findOccludingWaterFill(null, 0, getLayer)).toBeNull();
    expect(findOccludingWaterFill(LIVE_ORDER, -1, getLayer)).toBeNull();
    expect(planAnchorMoves(null, -1, getLayer)).toEqual({ refuse: false, occluder: null, moves: [] });
    const throwing = () => { throw new Error('style mid-load'); };
    expect(findOccludingWaterFill(LIVE_ORDER, 6, throwing)).toBeNull();
  });
});
