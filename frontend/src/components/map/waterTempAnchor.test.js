import { findOccludingWaterFill, planAnchorMoves, findMaskInsertionPoint, planMaskFamilyOrder, MASK_FAMILY_CHAIN } from './waterTempAnchor';

/**
 * Mapbox Streets ordering, the shape that produced the live defect: `landcover` precedes `water`,
 * so the pre-fix rule (first structural layer anywhere) anchored the mask BELOW the basemap ocean.
 * Measured live in beach theme: ocean-mask-fill 6, water 11 (WS-CAN-0061 / LV-11).
 */
const STREETS = [
  { id: 'background', type: 'background' },
  { id: 'landcover', type: 'fill' },          // ← the pre-fix anchor, BELOW water
  { id: 'national-park', type: 'fill' },
  { id: 'landuse', type: 'fill' },
  { id: 'waterway', type: 'line', 'source-layer': 'waterway' },
  { id: 'water', type: 'fill', 'source-layer': 'water' },        // basemap ocean
  { id: 'water-shadow', type: 'fill', 'source-layer': 'water' }, // highest water fill
  { id: 'hillshade', type: 'fill' },
  { id: 'building', type: 'fill' },           // ← the correct anchor: first structural ABOVE water
  { id: 'road', type: 'line' },
  { id: 'poi-label', type: 'symbol' },
];

describe('findMaskInsertionPoint — the mask must sit above the basemap ocean', () => {
  test('REPRODUCES THE FIX: anchors above the highest water fill, not at landcover', () => {
    expect(findMaskInsertionPoint(STREETS)).toBe('building');
    // and the anchor is genuinely above BOTH water fills
    const ids = STREETS.map((l) => l.id);
    expect(ids.indexOf('building')).toBeGreaterThan(ids.indexOf('water'));
    expect(ids.indexOf('building')).toBeGreaterThan(ids.indexOf('water-shadow'));
  });

  test('a symbol layer qualifies when no structural fill sits above the water', () => {
    const s = STREETS.filter((l) => !['hillshade', 'building', 'road'].includes(l.id));
    expect(findMaskInsertionPoint(s)).toBe('poi-label');
  });

  test('FALLS BACK to the pre-fix anchor when nothing structural is above the water', () => {
    const s = [
      { id: 'background', type: 'background' },
      { id: 'landcover', type: 'fill' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
    ];
    expect(findMaskInsertionPoint(s)).toBe('landcover');   // exactly the old behaviour
  });

  test('the mask family never counts as the water fill it must sit above', () => {
    const s = [
      { id: 'background', type: 'background' },
      { id: 'ocean-mask-inland-water', type: 'fill', 'source-layer': 'water' },
      { id: 'landcover', type: 'fill' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      { id: 'building', type: 'fill' },
    ];
    expect(findMaskInsertionPoint(s)).toBe('building');
  });

  test('`waterway` is a line and must not raise the anchor past it', () => {
    const s = [
      { id: 'background', type: 'background' },
      { id: 'waterway', type: 'line', 'source-layer': 'waterway' },
      { id: 'landuse', type: 'fill' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      { id: 'poi-label', type: 'symbol' },
    ];
    expect(findMaskInsertionPoint(s)).toBe('poi-label');   // above `water`, not at `landuse`
  });

  test('camelCase sourceLayer is accepted as well as the kebab wire key', () => {
    const s = [
      { id: 'landcover', type: 'fill' },
      { id: 'hydro', type: 'fill', sourceLayer: 'water' },
      { id: 'building', type: 'fill' },
    ];
    expect(findMaskInsertionPoint(s)).toBe('building');
  });

  test('degenerate inputs never throw', () => {
    expect(findMaskInsertionPoint(null)).toBeNull();
    expect(findMaskInsertionPoint([])).toBeNull();
    expect(findMaskInsertionPoint([{ id: 'background', type: 'background' }])).toBeNull();
  });

  test('AND THE TWO FIXES COMPOSE: once the mask is above the water, the re-assert stops refusing', () => {
    // the post-Option-1 stack: mask raised, slots mounted below it
    const fixed = [
      'background', 'landcover', 'water', 'water-shadow',
      'water_temp-slot-0-layer', 'water_temp-slot-1-layer', 'water_temp-slot-2-layer',
      'ocean-mask-fill', 'building', 'poi-label',
    ];
    const types = { water: { type: 'fill', sourceLayer: 'water' },
      'water-shadow': { type: 'fill', sourceLayer: 'water' }, building: { type: 'fill' },
      'poi-label': { type: 'symbol' }, landcover: { type: 'fill' }, background: { type: 'background' },
      'ocean-mask-fill': { type: 'fill' } };
    const gl = (id) => types[id] || (/^water_temp-slot-/.test(id) ? { type: 'raster' } : null);
    const plan = planAnchorMoves(fixed, fixed.indexOf('ocean-mask-fill'), gl);
    expect(plan.refuse).toBe(false);          // no occluder above the fill any more
    expect(plan.moves).toEqual([]);           // slots already below it
  });
});

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

// ── planMaskFamilyOrder (2026-08-15) ────────────────────────────────────────────────────────────
// Owner-reported "rivers/lakes/parks covered + coastal halo". The fixture is the MEASURED live
// permutation (map.style._order, Cocoa z12.5, Waves active): inland repaints BELOW the field, the
// land fill floated ABOVE the buffer, lakes/parks/wide rivers under the opaque fill. The planner
// must restore  water < fill < (landuse) < inland-water < inland-waterway < field < buffer < line
// with pairwise moves only, and be a FIXPOINT on a canonical stack.
const FAMILY_TYPE = {
  water: { type: 'fill', sourceLayer: 'water' },
  'ocean-mask-inland-water': { type: 'fill', sourceLayer: 'water' },
  'ocean-mask-fill': { type: 'fill' },
  landuse: { type: 'fill' },
  'national-park': { type: 'fill' },
  building: { type: 'fill' },
  'webgl-marine-particles': { type: 'custom' },
};
const resolveType = (id) => FAMILY_TYPE[id] || { type: id.includes('label') ? 'symbol' : 'line' };

// MapLibre moveLayer semantics: remove, then insert before the target.
const applyMoves = (order, moves) => {
  const w = order.slice();
  for (const m of moves) {
    w.splice(w.indexOf(m.id), 1);
    w.splice(w.indexOf(m.before), 0, m.id);
  }
  return w;
};

const LIVE_BROKEN = [
  'background', 'landcover', 'national-park', 'water',
  'ocean-mask-inland-water', 'ocean-mask-inland-waterway', 'webgl-marine-particles',
  'ocean-mask-buffer', 'pitch-outline', 'waterway', 'esri-satellite-layer',
  'water_temp-slot-0-layer', 'water_temp-slot-1-layer', 'water_temp-slot-2-layer',
  'ocean-mask-fill', 'landuse', 'ocean-mask-line', 'building', 'road', 'poi-label',
];

describe('planMaskFamilyOrder — one idempotent authority for the mask-family stack', () => {
  test('REPAIRS THE MEASURED LIVE PERMUTATION: family canonical, above water, below detail', () => {
    const { moves, ceiling } = planMaskFamilyOrder(LIVE_BROKEN, resolveType);
    expect(moves.length).toBeGreaterThan(0);
    const fixed = applyMoves(LIVE_BROKEN, moves);
    const i = (id) => fixed.indexOf(id);
    expect(i('water')).toBeLessThan(i('ocean-mask-fill'));
    expect(i('ocean-mask-fill')).toBeLessThan(i('ocean-mask-inland-water'));
    expect(i('ocean-mask-inland-water')).toBeLessThan(i('ocean-mask-inland-waterway'));
    expect(i('ocean-mask-inland-waterway')).toBeLessThan(i('webgl-marine-particles'));
    expect(i('webgl-marine-particles')).toBeLessThan(i('ocean-mask-buffer'));
    expect(i('ocean-mask-buffer')).toBeLessThan(i('ocean-mask-line'));
    expect(i('ocean-mask-line')).toBeLessThan(i(ceiling));
    for (const detail of ['waterway', 'building', 'road', 'poi-label']) {
      expect(i('ocean-mask-line')).toBeLessThan(i(detail));
    }
  });

  test('FIXPOINT: re-planning the repaired stack yields zero moves (no styledata churn loop)', () => {
    const { moves } = planMaskFamilyOrder(LIVE_BROKEN, resolveType);
    const fixed = applyMoves(LIVE_BROKEN, moves);
    expect(planMaskFamilyOrder(fixed, resolveType).moves).toEqual([]);
  });

  test('PRESERVES the repositionLanduse interleave: landuse between fill and inland-water is legal', () => {
    const base = planMaskFamilyOrder(LIVE_BROKEN, resolveType);
    const fixed = applyMoves(LIVE_BROKEN, base.moves);
    const w = fixed.slice();
    w.splice(w.indexOf('landuse'), 1);
    w.splice(w.indexOf('ocean-mask-inland-water'), 0, 'landuse');
    expect(planMaskFamilyOrder(w, resolveType).moves).toEqual([]);   // no fight, stable fixpoint
  });

  test('missing field layer (marine not mounted yet): plans the styled members only', () => {
    const noField = LIVE_BROKEN.filter((id) => id !== 'webgl-marine-particles');
    const { moves } = planMaskFamilyOrder(noField, resolveType);
    const fixed = applyMoves(noField, moves);
    const i = (id) => fixed.indexOf(id);
    expect(i('ocean-mask-fill')).toBeLessThan(i('ocean-mask-inland-water'));
    expect(i('ocean-mask-buffer')).toBeLessThan(i('ocean-mask-line'));
    expect(moves.some((m) => m.id === 'webgl-marine-particles')).toBe(false);
  });

  test('no basemap water fill: fails open with zero moves', () => {
    const s = ['background', 'landcover', 'ocean-mask-fill', 'road'];
    expect(planMaskFamilyOrder(s, resolveType).moves).toEqual([]);
  });

  test('a family member stranded BELOW the water floor is hoisted above it', () => {
    const s = ['background', 'ocean-mask-fill', 'water', 'landuse', 'building'];
    const { moves } = planMaskFamilyOrder(s, resolveType);
    const fixed = applyMoves(s, moves);
    expect(fixed.indexOf('ocean-mask-fill')).toBeGreaterThan(fixed.indexOf('water'));
    expect(fixed.indexOf('ocean-mask-fill')).toBeLessThan(fixed.indexOf('landuse'));
  });

  test('exports the chain in canonical bottom-first order', () => {
    expect(MASK_FAMILY_CHAIN[0]).toBe('ocean-mask-fill');
    expect(MASK_FAMILY_CHAIN[MASK_FAMILY_CHAIN.length - 1]).toBe('ocean-mask-line');
  });
});
