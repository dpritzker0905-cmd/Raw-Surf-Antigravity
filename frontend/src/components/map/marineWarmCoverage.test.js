/**
 * #10 MARINE WARM-COMMIT COVERAGE GUARD (2026-07-21) — enumerated predicate tests.
 *
 * marineWarmCommitCovers is the coverage half of regionalValidInPlace: a width-regional grid may
 * only warm-commit when it COVERS the current viewport, at ANY zoom. These tests pin every branch
 * (global short-circuit, geometric containment, epsilon sliver, antimeridian, fail-open, kill
 * switch) so the scrub-cache / cooldown / series call sites can trust the answer.
 */
import { marineWarmCommitCovers } from './marineWarmCoverage';

const VP = { west: -84, south: 25, east: -80, north: 29 }; // a 4x4 zoomed-in viewport over Florida

describe('marineWarmCommitCovers (#10 warm-commit coverage guard)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MARINE_WARM_COVERAGE__; });

  it('a regional grid that fully CONTAINS the viewport covers', () => {
    const grid = { bounds: { west: -90, south: 20, east: -74, north: 34 } }; // contains VP
    expect(marineWarmCommitCovers(grid, VP)).toBe(true);
  });

  it('a regional grid PANNED AWAY (no overlap) does NOT cover — the floating rectangle', () => {
    const grid = { bounds: { west: -70, south: 25, east: -60, north: 35 } }; // entirely east of VP
    expect(marineWarmCommitCovers(grid, VP)).toBe(false);
  });

  it('a regional grid that only PARTIALLY overlaps does NOT cover', () => {
    const grid = { bounds: { west: -82, south: 25, east: -75, north: 29 } }; // covers east half of VP only
    expect(marineWarmCommitCovers(grid, VP)).toBe(false);
  });

  it('a regional grid short on the NORTH edge does NOT cover', () => {
    const grid = { bounds: { west: -90, south: 20, east: -74, north: 28 } }; // north 28 < VP north 29
    expect(marineWarmCommitCovers(grid, VP)).toBe(false);
  });

  it('a regional grid short on the SOUTH edge does NOT cover', () => {
    const grid = { bounds: { west: -90, south: 26, east: -74, north: 34 } }; // south 26 > VP south 25
    expect(marineWarmCommitCovers(grid, VP)).toBe(false);
  });

  it('a GLOBAL-width grid (>=340 span) covers any viewport', () => {
    expect(marineWarmCommitCovers({ bounds: { west: -180, south: -80, east: 180, north: 85 } }, VP)).toBe(true);
  });

  it('a grid flagged global scope covers even with a small stored bbox', () => {
    expect(marineWarmCommitCovers({ bounds: { west: -84, south: 25, east: -80, north: 29 }, coverage_scope: 'global' }, VP)).toBe(true);
    expect(marineWarmCommitCovers({ bounds: { west: -84, south: 25, east: -80, north: 29 }, coverageMode: 'global_coarse' }, VP)).toBe(true);
  });

  it('reads bounds from grid.grid.bounds (the committed marineData shape)', () => {
    expect(marineWarmCommitCovers({ grid: { bounds: { west: -90, south: 20, east: -74, north: 34 } } }, VP)).toBe(true);
    expect(marineWarmCommitCovers({ grid: { bounds: { west: -70, south: 25, east: -60, north: 35 } } }, VP)).toBe(false);
  });

  it('a thin pan-edge sliver (within the 0.05deg epsilon) still covers — no refetch churn', () => {
    const grid = { bounds: { west: -83.97, south: 25.03, east: -80.03, north: 28.97 } }; // ~0.03deg short each side
    expect(marineWarmCommitCovers(grid, VP)).toBe(true);
  });

  it('just BEYOND the epsilon (0.1deg short) does not cover', () => {
    const grid = { bounds: { west: -83.9, south: 25.1, east: -80.1, north: 28.9 } }; // 0.1deg short each side
    expect(marineWarmCommitCovers(grid, VP)).toBe(false);
  });

  it('antimeridian: a grid wrapping 170..-170 covers a viewport at 175..178', () => {
    const vp = { west: 175, south: -5, east: 178, north: 5 };
    const grid = { bounds: { west: 170, south: -10, east: -170, north: 10 } }; // ge<gw -> unwrap to 190
    expect(marineWarmCommitCovers(grid, vp)).toBe(true);
  });

  it('antimeridian: a viewport crossing the seam is covered by a grid that spans it', () => {
    const vp = { west: 178, south: -5, east: -178, north: 5 }; // ve<vw -> unwrap to 182
    const grid = { bounds: { west: 170, south: -10, east: -170, north: 10 } }; // gw=170..ge=190
    expect(marineWarmCommitCovers(grid, vp)).toBe(true);
  });

  it('FAIL-OPEN: null viewport, missing bounds, malformed numbers, or no grid never suppress', () => {
    expect(marineWarmCommitCovers({ bounds: { west: -70, south: 25, east: -60, north: 35 } }, null)).toBe(true);
    expect(marineWarmCommitCovers({ vectors: [] }, VP)).toBe(true); // no bounds
    expect(marineWarmCommitCovers({ bounds: { west: NaN, south: 25, east: -60, north: 35 } }, VP)).toBe(true);
    expect(marineWarmCommitCovers({ bounds: { west: -90, south: 20, east: -74, north: 34 } }, { west: -84, south: 25, east: NaN, north: 29 })).toBe(true);
    expect(marineWarmCommitCovers(null, VP)).toBe(true); // nothing to judge
  });

  it('kill switch forces legacy always-covers (clean A/B)', () => {
    window.__RAW_DISABLE_MARINE_WARM_COVERAGE__ = true;
    const nonCovering = { bounds: { west: -70, south: 25, east: -60, north: 35 } };
    expect(marineWarmCommitCovers(nonCovering, VP)).toBe(true);
    // also honours an explicit win override
    expect(marineWarmCommitCovers(nonCovering, VP, { __RAW_DISABLE_MARINE_WARM_COVERAGE__: true })).toBe(true);
  });
});
