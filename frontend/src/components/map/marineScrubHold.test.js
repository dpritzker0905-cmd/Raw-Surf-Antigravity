/**
 * marineScrubHold.test.js — the pure "don't downgrade the heatmap mid-scrub" decision.
 * The fix for "heatmap CLEARS when I scrub" (coarse↔regional grid flip). Holds ONLY a
 * coarse-over-regional downgrade over a viewport-covering resident, same target, while scrubbing.
 */
import { boundsWidth, coversViewport, isCoarseGrid, shouldHoldScrubDowngrade } from './marineScrubHold';

// A regional grid that comfortably covers the viewport, and a global/coarse incoming grid.
const RESIDENT_REGIONAL = { west: -80, south: 36, east: -74, north: 40 };   // 6° wide
const VIEWPORT = { west: -79, south: 37, east: -75, north: 39 };            // inside the resident
const GLOBAL = { west: -180, south: -85, east: 180, north: 85 };            // 360° → coarse
const FINER_REGIONAL = { west: -79, south: 37, east: -75, north: 39 };      // 4° wide → not coarse

const base = {
  scrubbing: true, disabled: false, sameTarget: true,
  incomingBounds: GLOBAL, incomingScope: undefined,
  residentBounds: RESIDENT_REGIONAL, viewportBounds: VIEWPORT,
};

describe('marineScrubHold — geometry helpers', () => {
  it('boundsWidth handles normal and antimeridian-wrapping bounds', () => {
    expect(boundsWidth({ west: -80, east: -74, south: 0, north: 1 })).toBeCloseTo(6, 5);
    expect(boundsWidth({ west: 170, east: -170, south: 0, north: 1 })).toBeCloseTo(20, 5); // wraps +360
    expect(boundsWidth(null)).toBe(0);
  });

  it('coversViewport is true only when the grid fully contains the viewport', () => {
    expect(coversViewport(RESIDENT_REGIONAL, VIEWPORT)).toBe(true);
    expect(coversViewport(VIEWPORT, RESIDENT_REGIONAL)).toBe(false);      // smaller can't cover larger
    expect(coversViewport(RESIDENT_REGIONAL, null)).toBe(false);
  });

  it('isCoarseGrid flags a global span OR a global coverage_scope', () => {
    expect(isCoarseGrid(GLOBAL, undefined)).toBe(true);
    expect(isCoarseGrid(FINER_REGIONAL, 'global_coarse')).toBe(true);      // scope wins even if span small
    expect(isCoarseGrid(FINER_REGIONAL, undefined)).toBe(false);
  });
});

describe('marineScrubHold — shouldHoldScrubDowngrade', () => {
  it('HOLDS a coarse-over-regional downgrade during scrub (the flip that clears the heatmap)', () => {
    expect(shouldHoldScrubDowngrade(base)).toBe(true);
    // Coarse by coverage_scope tag too (a clipped grid whose span isn't 360 but is a global product).
    expect(shouldHoldScrubDowngrade({ ...base, incomingBounds: FINER_REGIONAL, incomingScope: 'global' })).toBe(true);
  });

  it('does NOT hold a same/finer incoming grid — the heatmap keeps tracking the scrubber', () => {
    expect(shouldHoldScrubDowngrade({ ...base, incomingBounds: FINER_REGIONAL, incomingScope: undefined })).toBe(false);
  });

  it('does NOT hold when the resident is already global (coarse is the correct product there)', () => {
    expect(shouldHoldScrubDowngrade({ ...base, residentBounds: GLOBAL })).toBe(false);
  });

  it('does NOT hold when the resident does not cover the viewport (holding would show a partial rectangle)', () => {
    const elsewhere = { west: 10, south: 40, east: 16, north: 44 }; // resident regional over Europe, viewport over US
    expect(shouldHoldScrubDowngrade({ ...base, residentBounds: elsewhere })).toBe(false);
  });

  it('does NOT hold across a model/layer change, when not scrubbing, when disabled, or with no viewport', () => {
    expect(shouldHoldScrubDowngrade({ ...base, sameTarget: false })).toBe(false);
    expect(shouldHoldScrubDowngrade({ ...base, scrubbing: false })).toBe(false);
    expect(shouldHoldScrubDowngrade({ ...base, disabled: true })).toBe(false);
    expect(shouldHoldScrubDowngrade({ ...base, viewportBounds: null })).toBe(false);
    expect(shouldHoldScrubDowngrade({ ...base, residentBounds: null })).toBe(false);
  });
});
