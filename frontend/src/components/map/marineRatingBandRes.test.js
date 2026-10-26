import { resolveBandResolutionEdge, ratingBandHeldText, edgeUncoveredMs, _resetEdgeTimerForTest } from './marineRatingBandRes';
import { resolveRatingBandFade } from './marineEngineDecisions';

// The rating band must not paint a score from a grid coarser than the regional one, nor show a seam where a rating grid ends
// (owner manual test 2026-10-25: a 9x8 global_mid rating grid, 2-deg cells, painted beside the 0.25-deg regional one).
const W = {};

describe('resolution leg: the resident rating grid\'s lattice spacing', () => {
  it('0.25 (regional) and 0.5 (a decimated page) are a full band; 0.75 is half; 1.0 and the 2-deg global_mid grid are gone', () => {
    expect(resolveBandResolutionEdge(W, { cellDeg: 0.25 }).resFade).toBe(1);
    expect(resolveBandResolutionEdge(W, { cellDeg: 0.5 }).resFade).toBe(1);
    expect(resolveBandResolutionEdge(W, { cellDeg: 0.75 }).resFade).toBeCloseTo(0.5, 6);
    expect(resolveBandResolutionEdge(W, { cellDeg: 1.0 }).resFade).toBe(0);
    const g = resolveBandResolutionEdge(W, { cellDeg: 2.0 });
    expect(g.resFade).toBe(0);
    expect(g.fade).toBe(0);
    expect(g.heldBy).toBe('resolution');
  });
  it('a full band reports no hold', () => {
    expect(resolveBandResolutionEdge(W, { cellDeg: 0.25 }).heldBy).toBeNull();
  });
  it('unknown cell size fails open; the kill switch turns the leg off; the levers move it', () => {
    expect(resolveBandResolutionEdge(W, {}).fade).toBe(1);
    expect(resolveBandResolutionEdge(W, undefined).fade).toBe(1);
    expect(resolveBandResolutionEdge({ __RAW_DISABLE_BAND_RES_FADE__: true }, { cellDeg: 2 }).fade).toBe(1);
    expect(resolveBandResolutionEdge({ __RAW_BAND_RES_CELL_LO__: 0.1, __RAW_BAND_RES_CELL_HI__: 0.2 }, { cellDeg: 0.25 }).resFade).toBe(0);
  });
});

describe('edge leg: a rating grid that ends inside the view is a seam', () => {
  const at = (coverFrac, zoom = 7.8, uncoveredMs = 5000) => resolveBandResolutionEdge(W, { coverFrac, zoom, uncoveredMs });
  it('full at >= 0.98 coverage, half midway, gone at <= 0.85, above the zoom the coverage leg owns', () => {
    expect(at(1).edgeFade).toBe(1);
    expect(at(0.98).edgeFade).toBe(1);
    expect(at(0.915).edgeFade).toBeCloseTo(0.5, 6);
    expect(at(0.85).edgeFade).toBe(0);
    expect(at(0.4).heldBy).toBe('edge');
  });
  it('inert at or below the wide-view zoom boundary (the coverage leg owns it), with unknown inputs, or killed', () => {
    expect(at(0.4, 7.0).edgeFade).toBe(1);
    expect(at(0.4, 8, 1499).edgeFade).toBe(1);                       // a mid-pan dip (under the grace) never dims the band
    expect(at(0.4, 8, 1500).edgeFade).toBe(0);
    expect(resolveBandResolutionEdge(W, { coverFrac: 0.4, zoom: 8 }).edgeFade).toBe(1);   // no timer given: fail open
    expect(at(0.4, 5).edgeFade).toBe(1);
    expect(resolveBandResolutionEdge(W, { zoom: 8 }).edgeFade).toBe(1);
    expect(resolveBandResolutionEdge(W, { coverFrac: 0.4 }).edgeFade).toBe(1);
    expect(resolveBandResolutionEdge({ __RAW_DISABLE_BAND_EDGE_FADE__: true }, { coverFrac: 0.4, zoom: 8 }).edgeFade).toBe(1);
  });
  it('both legs: the smaller wins and names itself', () => {
    const r = resolveBandResolutionEdge(W, { cellDeg: 0.8, coverFrac: 0.5, zoom: 8, uncoveredMs: 9000 });
    expect(r.fade).toBe(Math.min(r.resFade, r.edgeFade));
    expect(r.heldBy).toBe('edge');
  });
});

describe('resolveRatingBandFade takes the new legs with the existing ones (min), the wash rises as the band goes', () => {
  const FINE = { coverFrac: 1, zoom: 8.5, cellDeg: 0.25 };
  it('a fine, covering regional grid at a 4-deg view is untouched', () => {
    const r = resolveRatingBandFade(4, true, true, W, FINE);
    expect(r.fade).toBe(1);
    expect(r.bandMult).toBe(1);
    expect(r.heldBy).toBeNull();
  });
  it('the owner\'s z7.8 case, a 2-deg global_mid rating grid under a regional view: the band is held off and the honest wash takes over', () => {
    const r = resolveRatingBandFade(4, true, true, W, { coverFrac: 1, zoom: 7.8, cellDeg: 2.0 });
    expect(r.fade).toBe(0);
    expect(r.bandMult).toBe(0);
    expect(r.washStrength).toBe(1);
    expect(r.heldBy).toBe('resolution');
  });
  it('with no wash engaged the existing 0.3 floor still stops a blank map', () => {
    expect(resolveRatingBandFade(4, true, false, W, { coverFrac: 1, zoom: 7.8, cellDeg: 2.0 }).bandMult).toBe(0.3);
  });
  it('a grid that ends in view at z8: held with the edge named; the kill restores the old behaviour exactly', () => {
    const cov = { coverFrac: 0.6, zoom: 8, cellDeg: 0.25, uncoveredMs: 3000 };
    expect(resolveRatingBandFade(4, true, true, W, cov).heldBy).toBe('edge');
    const old = resolveRatingBandFade(4, true, true, { __RAW_DISABLE_BAND_RES_FADE__: true, __RAW_DISABLE_BAND_EDGE_FADE__: true }, cov);
    expect(old.fade).toBe(1);
    expect(old.heldBy).toBeNull();
  });
  it('not painting a rating band, or no cell size / coverage known: identity (fail open)', () => {
    expect(resolveRatingBandFade(4, false, true, W, { coverFrac: 0.1, zoom: 8, cellDeg: 5 }).fade).toBe(1);
    expect(resolveRatingBandFade(4, true, true, W, undefined).fade).toBe(1);
  });
});

describe('the words', () => {
  it('say what is held and why; nothing when nothing is held', () => {
    expect(ratingBandHeldText('resolution')).toMatch(/detailed rating grid.*still loading/);
    expect(ratingBandHeldText('edge')).toMatch(/does not cover this whole view/);
    expect(ratingBandHeldText(null)).toBeNull();
  });
});

describe('edgeUncoveredMs: how long the view has stayed uncovered', () => {
  beforeEach(_resetEdgeTimerForTest);
  it('0 while covered; counts from the first uncovered frame; resets the moment the grid covers again', () => {
    expect(edgeUncoveredMs(1, 1000)).toBe(0);
    expect(edgeUncoveredMs(0.9, 2000)).toBe(0);
    expect(edgeUncoveredMs(0.7, 3200)).toBe(1200);
    expect(edgeUncoveredMs(0.97, 4000)).toBe(2000);
    expect(edgeUncoveredMs(0.99, 4100)).toBe(0);
    expect(edgeUncoveredMs(0.9, 4200)).toBe(0);
    expect(edgeUncoveredMs(undefined, 4300)).toBe(0);           // unknown coverage (a world resident): not counted
  });
});
