import { shouldRejectResolutionDowngrade } from './WebGLMarineEngine';

// Grid factories matching the live repro (2026-07-01, Cocoa z9): a resident 13×13 regional waves tile
// (series_GFS_waves_h0) being overwritten by the 37×17 gfs_marine_waves_global_coarse fallback.
const coarseGlobal = (over = {}) => ({
  bounds: { west: -180, east: 180, south: -80, north: 85 },
  cols: 37, rows: 17, __componentLayer: 'waves', hourOffset: 0,
  vectors: new Array(629), __renderable: true, coverage_scope: 'global_coarse', ...over,
});
const regional = (over = {}) => ({
  bounds: { west: -82, east: -79, south: 27, north: 29 },
  cols: 13, rows: 13, __componentLayer: 'waves', hourOffset: 0,
  vectors: new Array(169), __renderable: true, coverage_scope: 'regional', ...over,
});
// Viewport [west, south, east, north] that the regional tile fully covers (the Cocoa view).
const coveredVp = [-81.5, 27.5, -79.5, 28.5];

describe('shouldRejectResolutionDowngrade — coarse⇄regional ping-pong guard', () => {
  it('BLOCKS a global-coarse frame overwriting a resident regional grid (same layer+hour, zoomed in, covered)', () => {
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 9, coveredVp, false)).toBe(true);
  });

  it('ALLOWS the coarse→regional SHARPEN (incoming regional is an upgrade, never blocked)', () => {
    expect(shouldRejectResolutionDowngrade(coarseGlobal(), regional(), 9, coveredVp, false)).toBe(false);
  });

  it('ALLOWS coarse when zoomed OUT (z<=6.5 — coarse legitimately fills the view)', () => {
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 5, coveredVp, false)).toBe(false);
  });

  it('ALLOWS coarse for a DIFFERENT hour (scrub) — never freezes a new hour on a stale regional', () => {
    expect(shouldRejectResolutionDowngrade(regional({ hourOffset: 0 }), coarseGlobal({ hourOffset: 24 }), 9, coveredVp, false)).toBe(false);
  });

  it('ALLOWS coarse when the resident regional no longer COVERS the viewport (stale after a pan)', () => {
    const farVp = [-100, 10, -60, 40]; // regional tile (-82..-79) cannot cover this
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 9, farVp, false)).toBe(false);
  });

  it('ALLOWS coarse when there is NO resident, or the resident is itself coarse-global', () => {
    expect(shouldRejectResolutionDowngrade(null, coarseGlobal(), 9, coveredVp, false)).toBe(false);
    expect(shouldRejectResolutionDowngrade(coarseGlobal(), coarseGlobal(), 9, coveredVp, false)).toBe(false);
  });

  it('ALLOWS coarse for a DIFFERENT component layer (never cross-contaminates layers)', () => {
    expect(shouldRejectResolutionDowngrade(regional({ __componentLayer: 'swell_1' }), coarseGlobal(), 9, coveredVp, false)).toBe(false);
  });

  it('does nothing to a non-renderable resident (a blank regional must not pin out the coarse)', () => {
    expect(shouldRejectResolutionDowngrade(regional({ __renderable: false }), coarseGlobal(), 9, coveredVp, false)).toBe(false);
    expect(shouldRejectResolutionDowngrade(regional({ vectors: [] }), coarseGlobal(), 9, coveredVp, false)).toBe(false);
  });

  it('is fully disabled by the kill switch', () => {
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 9, coveredVp, true)).toBe(false);
  });

  it('treats undefined viewport/zoom conservatively but still requires same hour + regional resident', () => {
    // No viewport → coverage assumed true; undefined zoom → treated as zoomed-in. Still blocks the same-hour downgrade.
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), undefined, undefined, false)).toBe(true);
  });
});
