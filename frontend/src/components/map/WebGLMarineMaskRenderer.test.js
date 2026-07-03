/**
 * Per-polygon culling for the mercator land mask (2026-07-03) — THE all-black regional mask root.
 * The 10m land GeoJSON has ~10 CONTINENT-scale MultiPolygon features, so the feature-level bbox
 * test passes for nearly all of them on any regional target; their far-side member polygons then
 * project through wrapLngRelative with ±360° x-jumps near the anti-center meridian and their fill
 * sweeps the ENTIRE canvas black. An all-black ocean mask makes ADVECT drop every particle and
 * masks out the regional heatmap — the "crests dead at close zoom until any bounds-changing
 * commit" state (live repro at (-79.9, 28.3) z9; isolated replica: FL tile drew 9/10 features →
 * 0% ocean; global control 63.8% ocean).
 */
import { getPolygonBbox, polygonOverlapsTarget } from './WebGLMarineMaskRenderer';

// A rectangular polygon-coordinates array (outer ring only).
const rect = (west, south, east, north) => [[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]];

// The FL regional target: bounds -82..-79 / 27..30, center -80.5.
const target = { wrappedWest: -82, wrappedEast: -79, south: 27, north: 30, center: -80.5 };
const overlaps = (poly) => polygonOverlapsTarget(
  getPolygonBbox(poly), target.wrappedWest, target.wrappedEast, target.south, target.north, target.center
);

describe('per-polygon mask culling (all-black regional mask fix)', () => {
  it('culls a far-side polygon (Eurasia-like) that crosses the anti-center meridian', () => {
    // lng 30..170 spans the anti-center meridian (99.5°E for center -80.5) — the exact geometry
    // whose wrapped projection smeared the whole canvas black.
    expect(overlaps(rect(30, 10, 170, 70))).toBe(false);
  });

  it('culls a same-hemisphere polygon far outside the box (South America)', () => {
    expect(overlaps(rect(-80, -55, -35, 10))).toBe(false);
  });

  it('keeps a polygon overlapping the target box (Florida/NA mainland)', () => {
    expect(overlaps(rect(-168, 7, -52, 83))).toBe(true);   // North America mainland
    expect(overlaps(rect(-81, 24, -79.8, 30.7))).toBe(true); // Florida peninsula
  });

  it('keeps nearby islands within the 1° pad', () => {
    expect(overlaps(rect(-78.9, 26.5, -77.0, 27.2))).toBe(true); // Bahamas at the east edge + pad
  });

  it('culls by latitude even when longitudes overlap (Antarctica-like)', () => {
    expect(overlaps(rect(-180, -90, 180, -60))).toBe(false);
  });

  it('caches the polygon bbox on the coordinates array', () => {
    const poly = rect(-81, 24, -79.8, 30.7);
    const b1 = getPolygonBbox(poly);
    const b2 = getPolygonBbox(poly);
    expect(b2).toBe(b1);
    expect(b1).toEqual({ west: -81, east: -79.8, south: 24, north: 30.7 });
  });
});
