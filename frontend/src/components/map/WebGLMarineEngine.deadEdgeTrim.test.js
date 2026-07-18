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
