import { trimDeadEdges } from './WebGLMarineEngine';

// DEAD-EDGE TRIM goldens (2026-07-18 "hard vertical line of no animations"): the NOAA ingest
// fencepost baked a 100%-invalid east column (+ north row) into regional tiles (FL -79.0 column
// 21/21 invalid, live-proven). The trim shaves such EDGE columns/rows (bounds+dims shrink) so
// ring-fill paints the strip; interior invalid cells (real land masks) are never touched.

const KILLED = { __RAW_DISABLE_DEAD_EDGE_TRIM__: true };

// 6x5 grid, west -84..-79 step 1, south 25..29 step 1
function makeGrid({ deadEastCol = false, deadNorthRow = false, deadInteriorCol = false } = {}) {
  const vectors = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const lng = -84 + c, lat = 25 + r;
      let valid = true;
      if (deadEastCol && c === 5) valid = false;
      if (deadNorthRow && r === 4) valid = false;
      if (deadInteriorCol && c === 3) valid = false;
      vectors.push({ lat, lng, speed: valid ? 1.2 : 0, u: 0.1, v: 0.1, is_valid: valid, value: null });
    }
  }
  return { vectors, cols: 6, rows: 5, bounds: { west: -84, east: -79, south: 25, north: 29 } };
}

describe('trimDeadEdges', () => {
  it('shaves a 100%-invalid EAST column: bounds/cols shrink, its vectors drop', () => {
    const g = trimDeadEdges(makeGrid({ deadEastCol: true }), {});
    expect(g.cols).toBe(5);
    expect(g.bounds.east).toBe(-80);
    expect(g.vectors.every((v) => v.lng <= -80 + 0.26)).toBe(true);
    expect(g.rows).toBe(5);
  });

  it('shaves a 100%-invalid NORTH row too (the same fencepost hits both edges)', () => {
    const g = trimDeadEdges(makeGrid({ deadEastCol: true, deadNorthRow: true }), {});
    expect(g.cols).toBe(5);
    expect(g.rows).toBe(4);
    expect(g.bounds.north).toBe(28);
  });

  it('NEVER trims an interior dead column (real land/mask data stays intact)', () => {
    const src = makeGrid({ deadInteriorCol: true });
    const g = trimDeadEdges(src, {});
    expect(g).toBe(src);   // untouched, same reference
  });

  it('no-op on a fully-valid grid returns the SAME object (no re-alloc churn)', () => {
    const src = makeGrid();
    expect(trimDeadEdges(src, {})).toBe(src);
  });

  it('kill switch returns the grid untouched', () => {
    const src = makeGrid({ deadEastCol: true });
    expect(trimDeadEdges(src, KILLED)).toBe(src);
  });

  it('degenerate/small grids pass through', () => {
    const tiny = { vectors: [{ lat: 25, lng: -84, speed: 1, is_valid: true }], cols: 2, rows: 2,
      bounds: { west: -84, east: -83, south: 25, north: 26 } };
    expect(trimDeadEdges(tiny, {})).toBe(tiny);
    expect(trimDeadEdges(null, {})).toBe(null);
  });

  it('trim is bounded to 2 per side (a mostly-dead grid is a data problem, not a trim problem)', () => {
    const src = makeGrid();
    for (const v of src.vectors) { if (v.lng >= -81) { v.is_valid = false; v.speed = 0; } }  // 3 dead east cols
    const g = trimDeadEdges(src, {});
    expect(g.cols).toBe(4);   // only 2 shaved
  });
});

// ANTIMERIDIAN WRAP MIRROR (2026-07-18, fencepost head #3's client twin): a FULL-WRAP grid with a
// dead ±180 edge column keeps its 360° span — the dead seam column is REPLACED by a mirrored copy
// of the live seam column (same physical meridian) instead of being trimmed. Trimming world grids
// to ~350° silently reclassified them as "regional" across every span≥359 predicate
// (isCoarseGlobalGrid → cold veil + crest suppression + no-truth guard, the mask renderer's and
// encoder's global branches) — these goldens lock the span invariant.
describe('trimDeadEdges — antimeridian wrap mirror (full-wrap grids)', () => {
  // 37x5 world grid: west -180..east +180 step 10
  function makeWorldGrid({ deadEastCol = false, deadWestCol = false, deadNorthRow = false } = {}) {
    const vectors = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 37; c++) {
        const lng = -180 + c * 10, lat = 25 + r;
        let valid = true;
        if (deadEastCol && c === 36) valid = false;
        if (deadWestCol && c === 0) valid = false;
        if (deadNorthRow && r === 4) valid = false;
        vectors.push({ lat, lng, speed: valid ? 1.2 + c * 0.01 : 0, u: 0.1, v: 0.1, is_valid: valid, value: null });
      }
    }
    return { vectors, cols: 37, rows: 5, bounds: { west: -180, east: 180, south: 25, north: 29 } };
  }

  it('MIRRORS a dead +180 column from the -180 column: span/cols/rows unchanged, seam data real', () => {
    const g = trimDeadEdges(makeWorldGrid({ deadEastCol: true }), {});
    expect(g.cols).toBe(37);
    expect(g.bounds.east).toBe(180);                    // span stays 360 — classifiers stay global
    expect(g.rows).toBe(5);
    const eastCol = g.vectors.filter((v) => v.lng === 180);
    const westCol = g.vectors.filter((v) => v.lng === -180);
    expect(eastCol.length).toBe(5);
    expect(eastCol.every((v) => v.is_valid === true)).toBe(true);
    expect(eastCol.map((v) => v.speed)).toEqual(westCol.map((v) => v.speed));  // the mirror
    expect(eastCol[0]).not.toBe(westCol[0]);            // distinct objects (emission mutates lng in place)
  });

  it('mirrors the other direction too (dead -180, live +180)', () => {
    const g = trimDeadEdges(makeWorldGrid({ deadWestCol: true }), {});
    expect(g.cols).toBe(37);
    expect(g.bounds.west).toBe(-180);
    const westCol = g.vectors.filter((v) => v.lng === -180);
    expect(westCol.length).toBe(5);
    expect(westCol.every((v) => v.is_valid === true)).toBe(true);
  });

  it('mirror composes with a NORTH row trim (rows shrink, columns stay full-wrap)', () => {
    const g = trimDeadEdges(makeWorldGrid({ deadEastCol: true, deadNorthRow: true }), {});
    expect(g.cols).toBe(37);
    expect(g.bounds.east).toBe(180);
    expect(g.rows).toBe(4);
    expect(g.bounds.north).toBe(28);
    expect(g.vectors.filter((v) => v.lng === 180).every((v) => v.is_valid === true)).toBe(true);
  });

  it('fully-valid world grid is a true no-op (same reference)', () => {
    const src = makeWorldGrid();
    expect(trimDeadEdges(src, {})).toBe(src);
  });

  it('__RAW_DISABLE_WRAP_MIRROR__ restores the legacy trim for world grids (A/B lever)', () => {
    const g = trimDeadEdges(makeWorldGrid({ deadEastCol: true }), { __RAW_DISABLE_WRAP_MIRROR__: true });
    expect(g.cols).toBe(36);          // trimmed, span shrinks — the pre-mirror behavior
    expect(g.bounds.east).toBe(170);
  });

  it('a REGIONAL dead east column still TRIMS (the FL stripe defense is untouched)', () => {
    const regional = trimDeadEdges((() => {
      const vectors = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 6; c++) {
          const valid = c !== 5;
          vectors.push({ lat: 25 + r, lng: -84 + c, speed: valid ? 1 : 0, is_valid: valid, value: null });
        }
      }
      return { vectors, cols: 6, rows: 5, bounds: { west: -84, east: -79, south: 25, north: 29 } };
    })(), {});
    expect(regional.cols).toBe(5);
    expect(regional.bounds.east).toBe(-80);
  });
});
