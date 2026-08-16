// Property + cross-authority tests for planMaskFamilyOrder, added by the Audit 4.0 independent
// verification lane (2026-08-15). Three concerns the fixture suite cannot carry:
//
//   1. FIXPOINT AS A PROPERTY, not a fixture: one application of the planner must reach zero
//      re-planned moves from ANY starting permutation (seeded PRNG — deterministic, replayable).
//   2. THE MARINE-RASTER-SLOT CEILING HOLE: OceanMask force-moves `{waves,swell_1,swell_2,
//      wind_waves}-slot-N-layer` into the family band (OceanMask.js syncLayers + its styledata
//      batch), but the ceiling scan's skip set named only water_temp slots and esri — a marine
//      slot resident mid-band was crowned CEILING, the planner demoted buffer/line beneath it,
//      the slot batch hoisted the slot back under buffer, and the two authorities alternated
//      forever (moved:2 every tick). The regression tests below pin the repaired behavior.
//   3. MIRRORED-LITERAL DRIFT: LANDUSE_CLASS mirrors OceanMask.js landuseKeywords by comment
//      only, and the 4096/340 dense-global pair exists in both computeWideOverlayMode and
//      resolveWashOverlayMode by admitted duplication. Both mirrors get an executable pin.
import { planMaskFamilyOrder, MASK_FAMILY_CHAIN, MARINE_FIELD_LAYER_ID } from './waterTempAnchor';
import { computeWideOverlayMode } from './WebGLMarineEngine';
import { resolveWashOverlayMode } from './marineCoverageContract';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- universe + resolver
const WATER = 'water';
const MARINE_SLOTS = ['waves', 'swell_1', 'swell_2', 'wind_waves']
  .flatMap((k) => [0, 1, 2].map((s) => `${k}-slot-${s}-layer`)); // exact ids from OceanMask.js:627
const LANDUSE_IDS = ['landuse', 'landcover-park', 'wood', 'national-forest'];
const NEUTRAL_IDS = ['background', 'waterway', 'road-minor', 'building', 'poi-label', 'admin-boundary'];
const TYPES = {
  [WATER]: { type: 'fill', sourceLayer: 'water' },
  'water-shadow': { type: 'fill', sourceLayer: 'water' },
  landuse: { type: 'fill' }, 'landcover-park': { type: 'fill' },
  wood: { type: 'fill' }, 'national-forest': { type: 'fill' },
  background: { type: 'background' }, waterway: { type: 'line' },
  'road-minor': { type: 'line' }, building: { type: 'fill-extrusion' },
  'poi-label': { type: 'symbol' }, 'admin-boundary': { type: 'line' },
  'esri-satellite-layer': { type: 'raster' },
  [MARINE_FIELD_LAYER_ID]: { type: 'custom' },
};
const getLayer = (id) =>
  TYPES[id] || (/-slot-\d+-layer$/.test(id) || /^water_temp-slot-/.test(id)
    ? { type: 'raster' } : { type: 'line' });

const applyMoves = (order, moves) => {
  const w = order.slice();
  for (const m of moves) { w.splice(w.indexOf(m.id), 1); w.splice(w.indexOf(m.before), 0, m.id); }
  return w;
};

// Deterministic PRNG (mulberry32) + Fisher-Yates — replayable failures, no test flake.
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (arr, rand) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const familySubsequence = (order) =>
  order.filter((id) => id === WATER || MASK_FAMILY_CHAIN.includes(id));

const assertFamilyInvariants = (order, plan) => {
  if (plan.ceiling === null) return; // planner made no claim (fail-open branch)
  const widx = order.indexOf(WATER);
  const present = MASK_FAMILY_CHAIN.filter((id) => order.indexOf(id) >= 0);
  // every member above the water floor, in chain order, below the ceiling
  let prev = widx;
  for (const id of present) {
    const idx = order.indexOf(id);
    expect(idx).toBeGreaterThan(prev);
    prev = idx;
  }
  expect(order.indexOf(plan.ceiling)).toBeGreaterThan(prev);
};

// ---------------------------------------------------------------- 1. fixpoint property
describe('planMaskFamilyOrder — fixpoint and invariants as a PROPERTY over permutations', () => {
  test('300 seeded permutations: one application reaches a zero-move fixpoint with family invariants', () => {
    const rand = rng(0xA4D17);
    let claims = 0; // trials where the planner made a claim (ceiling found) — non-vacuity control
    for (let trial = 0; trial < 300; trial++) {
      const universe = [WATER];
      if (rand() < 0.3) universe.push('water-shadow');
      for (const id of MASK_FAMILY_CHAIN) if (rand() < 0.9) universe.push(id);
      for (const id of MARINE_SLOTS) if (rand() < 0.25) universe.push(id);
      for (const id of LANDUSE_IDS) if (rand() < 0.5) universe.push(id);
      for (const id of NEUTRAL_IDS) if (rand() < 0.7) universe.push(id);
      if (rand() < 0.3) universe.push('esri-satellite-layer');
      if (rand() < 0.3) universe.push('water_temp-slot-0-layer');

      const order = shuffle(universe, rand);
      const plan = planMaskFamilyOrder(order, getLayer);
      const realized = applyMoves(order, plan.moves);
      const replan = planMaskFamilyOrder(realized, getLayer);
      // the mission-critical property: a second call on an already-legal order plans NOTHING
      expect({ trial, seed: '0xA4D17', moves: replan.moves }).toEqual({ trial, seed: '0xA4D17', moves: [] });
      assertFamilyInvariants(realized, plan);
      if (plan.ceiling !== null) claims++;
    }
    // A fixpoint proven mostly on fail-open refusals proves nothing — require real coverage.
    expect(claims).toBeGreaterThan(150);
  });

  test('mount-order equivalence: every permutation of one membership realizes the same family subsequence', () => {
    const rand = rng(0xBEEF5);
    // poi-label stays pinned on top: every real basemap style keeps symbol/label layers above
    // water, so "nothing above the water fill" (the planner's legitimate fail-open) is not a
    // reachable mount state and must not defeat the equivalence claim.
    const universe = [WATER, ...MASK_FAMILY_CHAIN, ...LANDUSE_IDS.slice(0, 2),
      ...NEUTRAL_IDS.filter((id) => id !== 'poi-label'), MARINE_SLOTS[0], 'esri-satellite-layer'];
    let reference = null;
    for (let trial = 0; trial < 60; trial++) {
      const order = [...shuffle(universe, rand), 'poi-label'];
      const plan = planMaskFamilyOrder(order, getLayer);
      const realized = applyMoves(order, plan.moves);
      const sub = familySubsequence(realized);
      if (reference === null) reference = sub;
      expect(sub).toEqual(reference); // water first, then the chain, identically every time
    }
    expect(reference).toEqual([WATER, ...MASK_FAMILY_CHAIN]);
  });
});

// ---------------------------------------------------------------- 2. slot-ceiling regression
describe('planMaskFamilyOrder — marine raster slots must never be crowned ceiling (oscillation hole)', () => {
  // The exact by-construction counterexample: canonical family with one raster fallback slot
  // resident mid-band, exactly where OceanMask's batch parks it (below MASK_BUFFER).
  const SLOT = 'waves-slot-0-layer';
  const CANONICAL_WITH_SLOT = [
    'background', WATER, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway',
    MARINE_FIELD_LAYER_ID, SLOT, 'ocean-mask-buffer', 'ocean-mask-line', 'waterway', 'building',
  ];

  test('a slot resident mid-band is ceiling-skipped: zero moves, ceiling stays the real basemap layer', () => {
    const plan = planMaskFamilyOrder(CANONICAL_WITH_SLOT, getLayer);
    expect(plan.ceiling).toBe('waterway');
    expect(plan.moves).toEqual([]);
  });

  test('planner then slot-batch then planner reaches a steady state (no cross-authority oscillation)', () => {
    // tick 1: planner on a broken permutation that also contains a slot
    const broken = [
      'background', WATER, 'ocean-mask-inland-water', 'ocean-mask-inland-waterway',
      MARINE_FIELD_LAYER_ID, 'ocean-mask-buffer', SLOT, 'ocean-mask-fill', 'ocean-mask-line',
      'waterway', 'building',
    ];
    const plan1 = planMaskFamilyOrder(broken, getLayer);
    let order = applyMoves(broken, plan1.moves);
    // tick 2: OceanMask's marine-slot batch re-parks the slot directly below MASK_BUFFER
    order = order.filter((id) => id !== SLOT);
    order.splice(order.indexOf('ocean-mask-buffer'), 0, SLOT);
    // tick 3: the planner must now plan NOTHING — the two authorities agree
    const plan2 = planMaskFamilyOrder(order, getLayer);
    expect(plan2.moves).toEqual([]);
    assertFamilyInvariants(order, plan2);
  });
});

// ---------------------------------------------------------------- 3. mirrored-literal pins
describe('mirrored literals — executable pins on the admitted duplications', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

  test('LANDUSE_CLASS (waterTempAnchor.js) and landuseKeywords (OceanMask.js) carry identical term sets', () => {
    const anchorSrc = read('waterTempAnchor.js');
    const maskSrc = read('OceanMask.js');
    const classMatch = anchorSrc.match(/const LANDUSE_CLASS = \/([^/]+)\/i;/);
    const kwMatch = maskSrc.match(/const landuseKeywords = \[([^\]]+)\];/);
    expect(classMatch).not.toBeNull();
    expect(kwMatch).not.toBeNull();
    const classTerms = classMatch[1].split('|').sort();
    const kwTerms = kwMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
    expect(classTerms).toEqual(kwTerms); // "the two lists move together" — now enforced, not hoped
  });

  test('dense-global thresholds flip at identical boundaries in computeWideOverlayMode and resolveWashOverlayMode', () => {
    const engineDense = (w, span) => computeWideOverlayMode({
      gwSpan: 360, mbCov: true, covReplaceOff: false,
      baseTexIsCached: true, cachedSpan: span, cachedTexWidth: w, killed: false,
    }).baseGlobalDense;
    const washDense = (w, span) => resolveWashOverlayMode({
      __maskCanvasDims: { w },
      bounds: { west: -span / 2, east: span / 2, south: -80, north: 80 },
    }, {}).baseGlobalDense;
    // width boundary: 4095 → not dense, 4096 → dense, in BOTH files
    expect([engineDense(4095, 360), washDense(4095, 360)]).toEqual([false, false]);
    expect([engineDense(4096, 360), washDense(4096, 360)]).toEqual([true, true]);
    // span boundary: 339.9 → not dense, 340 → dense, in BOTH files
    expect([engineDense(4096, 339.9), washDense(4096, 339.9)]).toEqual([false, false]);
    expect([engineDense(4096, 340), washDense(4096, 340)]).toEqual([true, true]);
  });
});
