/**
 * WIND DATELINE (2026-10-08 live test, owner: "a solid line in the pacific running vertical down the seam").
 *
 * map.getBounds() reports UNWRAPPED longitudes across +-180 (live: west -257.25, east -99.58 at z2 over the
 * Pacific). clampViewportBbox's wind tier only treated `west > east` as dateline-crossing, so that view read as
 * a plain 158-deg box: it requested a wide-band "fine" grid and clamped the bbox at -180, and the backend clip
 * (-180..-84) filed as the fine overlay with its edge exactly on the dateline, mid-screen: the line.
 * Fix: normalise first. A view wholly beyond +-180 shifts by 360 and keeps its fine box; a view that genuinely
 * straddles the dateline keeps the global product (the tier's own documented rule).
 */
import { windDatelineNormalize } from './windFineContainment';
import { clampViewportBbox } from './backendWeatherServiceClient';

describe('windDatelineNormalize', () => {
  it.each([
    ['plain view untouched', -95, -84, -95, -84],
    ['already-wrapped crossing untouched', 170, -170, 170, -170],
    ['straddles -180 (the live z2 Pacific case) -> wrapped form', -257.25, -99.58, 102.75, -99.58],
    ['straddles +180 -> wrapped form', 175, 185, 175, -175],
    ['wholly west of -180 -> shifted into range', -200, -190, 160, 170],
    ['wholly east of +180 -> shifted into range', 190, 200, -170, -160],
  ])('%s', (_label, w, e, ew, ee) => {
    const r = windDatelineNormalize(w, e);
    expect(r.west).toBeCloseTo(ew, 9);
    expect(r.east).toBeCloseTo(ee, 9);
  });
  it('a view wider than the world is the world', () => {
    expect(windDatelineNormalize(-400, 100)).toEqual({ west: -180, east: 180 });
  });
});

describe('clampViewportBbox wind tier across the dateline', () => {
  const tile = (w, s, e, n) => clampViewportBbox({ west: w, south: s, east: e, north: n }, 'wind', 'GFS', 'wind');
  it('the live z2 Pacific view keeps the GLOBAL product (no fine box clamped at -180)', () => {
    const r = tile(-257.25, -75.87, -99.58, 37.91);
    expect(r.selectedTileId).toBe('global_wind');
    expect(r.clampedBbox).toEqual({ west: -180, south: -80, east: 180, north: 85 });
  });
  it('a small view straddling +180 (Fiji) keeps the global product rather than a half box', () => {
    expect(tile(176, -20, 184, -14).selectedTileId).toBe('global_wind');
  });
  it('a view wholly beyond -180 still gets its fine box, shifted into range', () => {
    const r = tile(-200, -20, -192, -12);
    expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
    expect(r.clampedBbox.west).toBeGreaterThanOrEqual(158);
    expect(r.clampedBbox.east).toBeLessThanOrEqual(170);
  });
  it('an ordinary Gulf view is unchanged', () => {
    const r = tile(-95, 18, -84, 30);
    expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
    expect(r.clampedBbox.west).toBeLessThanOrEqual(-95);
  });
});
