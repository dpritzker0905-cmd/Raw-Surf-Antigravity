/**
 * THE ANTIMERIDIAN CLIFF (audit v7 §2a/§2b, 2026-08-03).
 *
 * Measured live against production, 48 frames, span held at 183°:
 *
 *     west = -180.0   ->   1,300,516 B    1.9 s   19x9     served bounds == request
 *     west = -180.5   ->  42,589,599 B   28.4 s   104x54   served bounds inflated + CROSSING
 *
 * 0.5° of longitude cost 33x the bytes and 24x the time, repeat-verified. The owner's console
 * emitted `bbox=-199.3617,-27.5277,-16.0320,53.3496` verbatim during a rapid zoom-out, because
 * MapLibre's getBounds() legitimately returns west < -180 on a wide low-zoom viewport and only the
 * CACHE KEY was being normalised -- the URL was not.
 *
 * These tests assert the EMITTED URL, not an internal helper: the URL is what cost 43 MB, and a
 * unit test of the helper would have passed all along while the call site kept sending raw bounds.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, _resetMarineSeriesForTest } from './marineGridSeries';
// The bbox geometry moved to its own module on 2026-08-04 (marineGridSeries crossed the 800-LOC
// ratchet). This suite follows it: it is the guard for exactly these functions, and a guard that
// stays pointed at the old home would test a re-export instead of the implementation.
import { normalizeRequestBbox, bboxContains, GLOBAL_REQUEST_BBOX } from './marineBboxGeometry';

// The owner's own viewport, taken from the console log of the reported gesture.
const CLIENT_WRAPPED = { west: -199.3617, south: -27.5277, east: -16.0320, north: 53.3496 };
const REGIONAL_FL = { west: -86.8623, south: 25.9723, east: -77.0946, north: 30.8398 };

function bboxOf(url) {
  const m = /[?&]bbox=([^&]+)/.exec(url);
  return m ? m[1].split(',').map(Number) : null;
}

function mockFetch(servedBounds) {
  const urls = [];
  global.fetch = jest.fn(async (url) => {
    urls.push(url);
    const mk = (h) => ({
      hour_offset: h, cols: 2, rows: 2, bounds: servedBounds,
      vectors: [{ lat: 0, lng: 0, u: 0, v: -1, speed: 1, direction: 0, period: 8 }],
    });
    return { ok: true, status: 200, json: async () => ({ frames: [mk(0), mk(3)] }) };
  });
  return urls;
}

beforeEach(() => {
  _resetMarineSeriesForTest();
  delete window.__RAW_DISABLE_BBOX_NORM__;
  window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__ = true;   // isolate: no background warm in these URLs
});

describe('the emitted request box', () => {
  test('NO emitted longitude is ever outside [-180,180] — the cliff itself', async () => {
    const urls = mockFetch(GLOBAL_REQUEST_BBOX);
    await ensureMarineSeries('GFS', 'waves', CLIENT_WRAPPED, 0, undefined, true);

    expect(urls.length).toBeGreaterThan(0);          // assert the setup: a fetch really happened
    for (const u of urls) {
      const [w, , e] = bboxOf(u);
      expect(Math.abs(w)).toBeLessThanOrEqual(180);
      expect(Math.abs(e)).toBeLessThanOrEqual(180);
    }
  });

  test('a WIDE viewport requests the canonical world box — the same thing viewportKey asserts', async () => {
    const urls = mockFetch(GLOBAL_REQUEST_BBOX);
    await ensureMarineSeries('GFS', 'waves', CLIENT_WRAPPED, 0, undefined, true);

    expect(bboxOf(urls[0])).toEqual([-180, -80, 180, 85]);
  });

  test('KNOWN-PRESENT CONTROL: a REGIONAL viewport keeps its own box and is NOT widened', async () => {
    const urls = mockFetch(REGIONAL_FL);
    await ensureMarineSeries('GFS', 'waves', REGIONAL_FL, 0, undefined, true);

    const [w, s, e, n] = bboxOf(urls[0]);
    expect(w).toBeCloseTo(REGIONAL_FL.west - 0.5, 3);    // the 0.5° regional pad, still applied
    expect(e).toBeCloseTo(REGIONAL_FL.east + 0.5, 3);
    expect(s).toBeCloseTo(REGIONAL_FL.south - 0.5, 3);
    expect(n).toBeCloseTo(REGIONAL_FL.north + 0.5, 3);
    expect([w, s, e, n]).not.toEqual([-180, -80, 180, 85]);
  });

  test('the kill switch restores the raw pre-v7 box exactly', async () => {
    window.__RAW_DISABLE_BBOX_NORM__ = true;
    const urls = mockFetch(GLOBAL_REQUEST_BBOX);
    await ensureMarineSeries('GFS', 'waves', CLIENT_WRAPPED, 0, undefined, true);

    expect(bboxOf(urls[0])[0]).toBeCloseTo(-199.3617, 3);   // the 43 MB request, on demand
  });
});

describe('normalizeRequestBbox', () => {
  test('a narrow viewport that genuinely crosses the antimeridian is NOT widened to the world', () => {
    // Fiji: 3° wide, straddling 180. Widening this to the whole planet would be a 60x resolution
    // loss for a regional zoom — the crossing must survive as a crossing.
    const fiji = { west: 178.5, south: -18.5, east: -178.5, north: -17.0 };
    const out = normalizeRequestBbox(fiji);
    expect(out.west).toBeCloseTo(178.5, 6);
    expect(out.east).toBeCloseTo(-178.5, 6);
    expect(out).not.toEqual(GLOBAL_REQUEST_BBOX);
  });

  test('a full-world span collapses to the canonical box rather than a degenerate one', () => {
    expect(normalizeRequestBbox({ west: -540, south: -80, east: 540, north: 85 }))
      .toEqual(GLOBAL_REQUEST_BBOX);
  });
});

describe('bboxContains and the antimeridian - why it repeated', () => {
  // The live geometry: the backend served the crossing tile [148 -> -4] while the client held a
  // viewport inside it. The old plain-rectangle test asked `148 <= -199.36`, answered false, and so
  // `coverageBroken` could NEVER clear -- the TTL dedup was bypassed on every gesture and the same
  // 43 MB page was re-fetched forever. That is the repeat observed in the owner's console log.
  const CROSSING = { west: 148, south: -40, east: -4, north: 66 };   // 208 deg wide, crosses 180

  test('a crossing tile CONTAINS a viewport inside its eastern arc', () => {
    // The discriminating case: the plain test asks `148 <= -100` and answers false. Longitude is
    // cyclic, and -100 is plainly inside the arc that runs 148 -> 180 -> -4.
    expect(bboxContains(CROSSING, { west: -100, south: -20, east: -50, north: 40 })).toBe(true);
  });

  test('a crossing tile CONTAINS a viewport inside its western arc', () => {
    expect(bboxContains(CROSSING, { west: 150, south: -20, east: 170, north: 40 })).toBe(true);
  });

  test('a crossing tile CONTAINS a viewport that itself crosses', () => {
    expect(bboxContains(CROSSING, { west: 178, south: -20, east: -178, north: 40 })).toBe(true);
  });

  test('NEGATIVE CONTROL: a longitude in the GAP is not contained', () => {
    // 0..50 lies in the 152 deg the tile does NOT cover. "Fixed" must not mean "always true".
    expect(bboxContains(CROSSING, { west: 0, south: -20, east: 50, north: 40 })).toBe(false);
  });

  test('NEGATIVE CONTROL: latitude still rejects, even when longitude is contained', () => {
    expect(bboxContains(CROSSING, { west: -100, south: -80, east: -50, north: 40 })).toBe(false);
  });

  test('NEGATIVE CONTROL: a non-crossing tile still rejects a viewport outside it', () => {
    const fl = { west: -87, south: 25, east: -77, north: 31 };
    expect(bboxContains(fl, { west: -12, south: 10, east: -4, north: 16 })).toBe(false);
    expect(bboxContains(fl, { west: -85, south: 26, east: -79, north: 30 })).toBe(true);
  });

  test('a world-width tile contains every viewport by construction', () => {
    expect(bboxContains(GLOBAL_REQUEST_BBOX, { west: 178, south: -18, east: -178, north: -17 }))
      .toBe(true);
  });
});

describe('the re-fetch loop this drove', () => {
  test('NEGATIVE CONTROL: a viewport that LEAVES the served tile still re-fetches', async () => {
    const urls = mockFetch(REGIONAL_FL);
    await ensureMarineSeries('GFS', 'waves', REGIONAL_FL, 0, undefined, true);
    const afterFirst = urls.length;
    expect(afterFirst).toBeGreaterThan(0);          // assert the setup: the first gesture fetched

    await ensureMarineSeries('GFS', 'waves',
      { west: -12.0, south: 10.0, east: -4.0, north: 16.0 }, 0, undefined, true);

    expect(urls.length).toBeGreaterThan(afterFirst);
  });
});
