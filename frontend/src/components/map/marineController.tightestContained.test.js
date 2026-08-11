/**
 * marineController.tightestContained.test.js
 *
 * T-2′ step 3 — the served EXTENT must not depend on cache insertion order (audit 11.2).
 *
 * DEFECT: `getModelSafeMarine`'s containment fallback used `break` on the FIRST containing entry.
 * `_perModelHourCache` is a Map, so iteration is INSERTION order. When two cached entries both
 * contain the viewport and both satisfy every predicate (prefix, TTL, non-stale, vectors > 0,
 * DEBT-CACHE-03 world-skip, containment, and the full signature check), the one cached EARLIER
 * won — making the served extent a function of interaction history rather than of the request.
 *
 * Measured live at `e015d90b`: a byte-identical productId served at 289 then 15,023 vectors,
 * band value 0.5152 → 0.5954 m (+15.6%).
 *
 * FIX: choose the TIGHTEST containing entry (finest data for the viewport), ties broken on key.
 * Kill-switch `__RAW_DISABLE_TIGHTEST_CONTAINED__` restores first-wins for A/B.
 *
 * ⭐ Both entries below are deliberately BELOW the 340° world-skip threshold, so DEBT-CACHE-03
 *   does not mask the ordering question — this isolates the scan's own determinism.
 */

import { getModelSafeMarine } from './marineController';
import { getPerModelHourCache } from './marineControllerCache';

const HOUR = 0;
const MODEL = 'GFS';
const LAYER = 'waves';

// A 1° viewport, contained by BOTH entries below.
const VIEWPORT = { west: -80.5, east: -79.5, south: 27.5, north: 28.5 };

function makeEntry({ west, east, south, north, cols, rows, n, provider = 'open-meteo' }) {
  const vectors = Array.from({ length: n }, (_, i) => ({ lat: south, lng: west, height: 1, speed: 1, period: 8, direction: 90, _i: i }));
  const grid = { bounds: { west, east, south, north }, cols, rows, vectors, __gridProvider: provider };
  const boundsStr = `${west.toFixed(2)}:${south.toFixed(2)}:${east.toFixed(2)}:${north.toFixed(2)}`;
  return {
    data: { grid },
    timestamp: Date.now(),
    model: MODEL,
    signature: {
      model: MODEL, layer: LAYER, provider, hourOffset: HOUR,
      boundsStr, cols, rows, vectorsLength: vectors.length
    }
  };
}

// WIDE: 20° across, coarse.   TIGHT: 4° across, fine. Both contain VIEWPORT.
const WIDE  = { west: -90, east: -70, south: 20, north: 35, cols: 5,  rows: 4,  n: 20 };
const TIGHT = { west: -82, east: -78, south: 26, north: 30, cols: 17, rows: 17, n: 289 };

function seed(order) {
  const cache = getPerModelHourCache();
  cache.clear?.();
  for (const which of order) {
    const spec = which === 'wide' ? WIDE : TIGHT;
    // Tile ids that will NOT collide with clampViewportBbox's selectedTileId, forcing the
    // exact-key lookup to miss so the containment fallback is the path under test.
    cache.set(`${MODEL}_${LAYER}_auditTile-${which}_${HOUR}`, makeEntry(spec));
  }
}

function servedVectorCount(result) {
  return result?.grid?.vectors?.length ?? result?.data?.grid?.vectors?.length ?? null;
}

beforeEach(() => {
  delete window.__RAW_DISABLE_TIGHTEST_CONTAINED__;
  delete window.__MARINE_CONTAINED_PICK__;
});

describe('containment fallback picks the tightest grid, not the first-inserted', () => {
  test('REGRESSION: WIDE inserted first must NOT win over a tighter containing grid', () => {
    seed(['wide', 'tight']);                       // the order that reproduced the defect
    const out = getModelSafeMarine(MODEL, HOUR, LAYER, VIEWPORT);

    expect(servedVectorCount(out)).toBe(289);      // TIGHT, not the 20-vector WIDE
    expect(window.__MARINE_CONTAINED_PICK__.candidates).toBe(2);
    expect(window.__MARINE_CONTAINED_PICK__.chosenWidthDeg).toBe(4);
    expect(window.__MARINE_CONTAINED_PICK__.mode).toBe('tightest');
  });

  test('INVARIANT: the reverse insertion order yields the IDENTICAL result', () => {
    seed(['tight', 'wide']);
    const out = getModelSafeMarine(MODEL, HOUR, LAYER, VIEWPORT);

    expect(servedVectorCount(out)).toBe(289);
    expect(window.__MARINE_CONTAINED_PICK__.chosenWidthDeg).toBe(4);
    // ⭐ This is the whole invariant: extent is independent of insertion order.
  });

  test('the kill-switch restores legacy first-wins (so the A/B legs are real)', () => {
    window.__RAW_DISABLE_TIGHTEST_CONTAINED__ = true;
    seed(['wide', 'tight']);
    const out = getModelSafeMarine(MODEL, HOUR, LAYER, VIEWPORT);

    expect(servedVectorCount(out)).toBe(20);       // the old, order-dependent answer
  });

  test('MIRROR: selection is by AREA, not width (marineGridSeries.js:753 is the reference)', () => {
    // Anisotropic pair where the two rules DISAGREE, so this test fails if width creeps back in:
    //   SHORT_WIDE  6° x 2°  -> area 12, width 6
    //   TALL_NARROW 4° x 10° -> area 40, width 4
    // By width TALL_NARROW wins; by area SHORT_WIDE wins. The series cache picks smallest AREA.
    const cache = getPerModelHourCache();
    cache.clear?.();
    cache.set(`${MODEL}_${LAYER}_auditTile-tallNarrow_${HOUR}`,
      makeEntry({ west: -82, east: -78, south: 22, north: 32, cols: 3, rows: 3, n: 9 }));
    cache.set(`${MODEL}_${LAYER}_auditTile-shortWide_${HOUR}`,
      makeEntry({ west: -83, east: -77, south: 27, north: 29, cols: 7, rows: 7, n: 49 }));

    const out = getModelSafeMarine(MODEL, HOUR, LAYER, VIEWPORT);

    expect(window.__MARINE_CONTAINED_PICK__.candidates).toBe(2);
    expect(servedVectorCount(out)).toBe(49);                        // SHORT_WIDE — the smaller AREA
    expect(window.__MARINE_CONTAINED_PICK__.chosenWidthDeg).toBe(6); // NOT the narrower 4°
  });

  test('a single candidate is unaffected', () => {
    seed(['tight']);
    const out = getModelSafeMarine(MODEL, HOUR, LAYER, VIEWPORT);
    expect(servedVectorCount(out)).toBe(289);
    expect(window.__MARINE_CONTAINED_PICK__.candidates).toBe(1);
  });
});
