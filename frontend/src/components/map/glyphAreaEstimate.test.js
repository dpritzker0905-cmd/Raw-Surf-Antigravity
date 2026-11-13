/**
 * O4 / CLI-3 (Fable audit 2026-11-10): the grid-sample glyph fallback is the nearest rated GRID cell (+/-2 cells,
 * ~55 km), not rate_one_spot at the spot, and beyond the precompute bound every glyph comes from it. ONE FORECAST
 * COMPOSITION: it must say so. These pin the label (spoken by the aria-label), the data flag the glyph draws its
 * dashed ring from, the equality fix that lets an endpoint rating replace an estimate, and the kill switch's off path.
 */
import { computeSpotRatings, ratingsShallowEqual, glyphEstimateLabelEnabled } from './useSpotRatings';
import { spotGlyphAriaLabel } from './MapMarkerLayers';

function ratingGrid() {
  const cols = 5; const rows = 5;
  const vectors = Array.from({ length: cols * rows }, () => ({ speed: 0 }));
  vectors[4 * cols + 4].speed = 8.0;                 // score 80 at the NE corner
  return { cols, rows, bounds: { west: 0, south: 0, east: 4, north: 4 }, vectors, ratingMode: true };
}
const spots = [{ id: 's1', name: 'Test Point', latitude: 4, longitude: 4, isCluster: false }];

afterEach(() => { delete window.__RAW_DISABLE_GLYPH_ESTIMATE_LABEL__; });

describe('grid-sample glyphs are labelled area estimates (CLI-3)', () => {
  it('marks the fallback as an estimate and says so in the label', () => {
    const r = computeSpotRatings(spots, ratingGrid(), true).s1;
    expect(r.estimate).toBe(true);
    expect(r.score).toBe(80);
    expect(r.label).toMatch(/\(area estimate\)$/);
  });

  it('the screen-reader label speaks the estimate (information never by shape alone)', () => {
    const r = computeSpotRatings(spots, ratingGrid(), true).s1;
    expect(spotGlyphAriaLabel(spots[0], r, null, 'ft')).toMatch(/^Test Point: .+ \(area estimate\)$/);
  });

  it('an endpoint rating with the same score and level still replaces the estimate (memo equality)', () => {
    const est = computeSpotRatings(spots, ratingGrid(), true);
    const endpoint = { s1: { ...est.s1, estimate: undefined, label: 'Good' } };
    expect(ratingsShallowEqual(est, endpoint)).toBe(false);
    expect(ratingsShallowEqual(est, computeSpotRatings(spots, ratingGrid(), true))).toBe(true);
  });

  it('kill switch: the pre-O4 unlabelled fallback', () => {
    window.__RAW_DISABLE_GLYPH_ESTIMATE_LABEL__ = true;
    expect(glyphEstimateLabelEnabled()).toBe(false);
    const r = computeSpotRatings(spots, ratingGrid(), true).s1;
    expect(r.estimate).toBeUndefined();
    expect(r.label).not.toMatch(/estimate/);
  });
});
