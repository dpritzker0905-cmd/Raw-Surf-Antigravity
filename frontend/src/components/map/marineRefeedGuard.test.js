/**
 * #11 RE-FEED COVERAGE GUARD (2026-07-21). The reactivate_refeed + initial_onAdd sites re-feed the
 * RETAINED frame into the engine on layer add / toggle-on. Without a bbox check, a regional grid
 * from a PANNED-AWAY viewport paints a floating rectangle at the old location (the render's regional
 * cull only fires when zoomed OUT). marineRefeedCovers gates the re-feed: only a covering — or
 * global — grid may re-feed. Enumerated here (assert every branch, never sample).
 */
import { marineRefeedCovers, marineViewportBounds } from './WebGLMarineCustomLayer';

const VP = { west: -84, south: 25, east: -80, north: 29 }; // a 4°x4° zoomed-in viewport

describe('marineRefeedCovers (#11 re-feed coverage guard)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__; });

  it('a regional grid that COVERS the viewport re-feeds', () => {
    const grid = { bounds: { west: -90, south: 20, east: -74, north: 34 } }; // contains VP
    expect(marineRefeedCovers(grid, VP)).toBe(true);
  });

  it('a regional grid that does NOT cover (panned away) is SUPPRESSED — the floating rectangle', () => {
    const grid = { bounds: { west: -70, south: 25, east: -60, north: 35 } }; // east of VP, no overlap
    expect(marineRefeedCovers(grid, VP)).toBe(false);
  });

  it('a regional grid that only PARTIALLY overlaps is suppressed (the partial floating rectangle)', () => {
    const grid = { bounds: { west: -82, south: 25, east: -75, north: 29 } }; // covers east half of VP only
    expect(marineRefeedCovers(grid, VP)).toBe(false);
  });

  it('a GLOBAL grid always re-feeds (covers everything) regardless of viewport', () => {
    expect(marineRefeedCovers({ bounds: { west: -180, south: -80, east: 180, north: 85 } }, VP)).toBe(true);
    expect(marineRefeedCovers({ bounds: { west: -84, south: 25, east: -80, north: 29 }, coverage_scope: 'global' }, VP)).toBe(true);
    expect(marineRefeedCovers({ bounds: { west: -84, south: 25, east: -80, north: 29 }, coverage_scope: 'global_coarse' }, VP)).toBe(true);
  });

  it('reads bounds from grid.grid.bounds when present (the committed marineData shape)', () => {
    expect(marineRefeedCovers({ grid: { bounds: { west: -90, south: 20, east: -74, north: 34 } } }, VP)).toBe(true);
    expect(marineRefeedCovers({ grid: { bounds: { west: -70, south: 25, east: -60, north: 35 } } }, VP)).toBe(false);
  });

  it('a thin pan-edge sliver (within the 0.05° epsilon) still COVERS — no refetch churn', () => {
    const grid = { bounds: { west: -84.03, south: 24.97, east: -79.97, north: 29.03 } }; // ~0.03° short each side
    expect(marineRefeedCovers(grid, VP)).toBe(true);
  });

  it('FAIL-OPEN: a null viewport or missing bounds never suppresses a feed', () => {
    expect(marineRefeedCovers({ bounds: { west: -70, south: 25, east: -60, north: 35 } }, null)).toBe(true);
    expect(marineRefeedCovers({ vectors: [] }, VP)).toBe(true); // no bounds
    expect(marineRefeedCovers(null, VP)).toBe(false); // no grid at all -> nothing to feed
  });

  it('kill switch forces legacy always-feed', () => {
    window.__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__ = true;
    const nonCovering = { bounds: { west: -70, south: 25, east: -60, north: 35 } };
    expect(marineRefeedCovers(nonCovering, VP)).toBe(true);
  });

  it('marineViewportBounds extracts {west,south,east,north} from a maplibre map, null-safe', () => {
    const map = { getBounds: () => ({ getWest: () => -84, getSouth: () => 25, getEast: () => -80, getNorth: () => 29 }) };
    expect(marineViewportBounds(map)).toEqual(VP);
    expect(marineViewportBounds(null)).toBeNull();
    expect(marineViewportBounds({ getBounds: () => { throw new Error('gl lost'); } })).toBeNull();
  });
});
