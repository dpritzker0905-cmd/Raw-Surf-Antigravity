/**
 * §7i TILE≥VIEWPORT CLAMP goldens (2026-07-13): the camera-centered particle tile must never
 * be narrower than the viewport — its edge is a hard crest cliff (user live report: vertical
 * division bisecting the Pacific at ~z3.1, coverage following pans as the tile re-anchors).
 * Root: TILE_BACKOFF 2 (db363a14) puts the tile at 1/2^(floor(z)-2) of the world, which in the
 * low fraction of each integer zoom undercuts a wide monitor's viewport.
 */
import { clampTileToViewport } from './WebGLMarineEngine';

describe('clampTileToViewport (§7i)', () => {
  it('REGRESSION z3.13 wide monitor: half-world tile widens to full world', () => {
    // backoff 2 at z3.13 → tileZoom 1, tile 0.5 world; ~1500px viewport ≈ 0.67 world wide
    const r = clampTileToViewport(1, 0.5, 0.67, 0.35);
    expect(r.tileWidth).toBe(1.0);
    expect(r.tileZoom).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it('no-op when the tile already covers the viewport with margin (density sizing preserved)', () => {
    // z5.9 → tileZoom 3, tile 0.125; viewport ≈ 0.098 world → 0.098*1.1 = 0.108 < 0.125
    const r = clampTileToViewport(3, 0.125, 0.098, 0.05);
    expect(r.tileWidth).toBe(0.125);
    expect(r.tileZoom).toBe(3);
    expect(r.clamped).toBe(false);
  });

  it('widens by exactly one power-of-two step when the viewport barely pokes out (z4 band)', () => {
    // z4.1 → tileZoom 2, tile 0.25; 1500px viewport at z4.1 ≈ 0.34 world
    const r = clampTileToViewport(2, 0.25, 0.34, 0.2);
    expect(r.tileWidth).toBe(0.5);
    expect(r.tileZoom).toBe(1);
  });

  it('the TALLER axis drives the clamp too (the tile is square in mercator)', () => {
    const r = clampTileToViewport(1, 0.5, 0.3, 0.53);
    expect(r.tileWidth).toBe(1.0); // 0.53*1.1 = 0.583 > 0.5 → widen
  });

  it('margin: a viewport at 96% of the tile still widens (edge must sit OFF-screen)', () => {
    const r = clampTileToViewport(1, 0.5, 0.48, 0.2); // 0.48*1.1 = 0.528 > 0.5
    expect(r.tileWidth).toBe(1.0);
  });

  it('never exceeds the full world (tileZoom floors at 0)', () => {
    const r = clampTileToViewport(0, 1.0, 0.95, 0.9);
    expect(r.tileWidth).toBe(1.0);
    expect(r.tileZoom).toBe(0);
    expect(r.clamped).toBe(false);
  });

  it('degenerate/missing viewport dims are a no-op', () => {
    const r = clampTileToViewport(2, 0.25, 0, undefined);
    expect(r.tileWidth).toBe(0.25);
    expect(r.clamped).toBe(false);
  });
});
