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

  it('BLOCKS coarse below the z7.0 threshold while the regional still COVERS the viewport (the z7.0-7.74 direction/color flip, 2026-07-04)', () => {
    // Coverage, not zoom, is the predicate: crossing z7.0 used to swap the display to the world
    // grid whose 10° cells flip direction + height color at coasts, then the sharpen "corrected"
    // it — the live glitch cycle. While the finer grid covers the view, keep it at any zoom.
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 6.9, coveredVp, false)).toBe(true);
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 5, coveredVp, false)).toBe(true);
  });

  it('ALLOWS coarse at zoom-out once the viewport outgrows the regional tile (the real-world zoom-out)', () => {
    const wideVp = [-84, 25, -76, 32]; // z~5.5 viewport — the 3° tile covers only ~11%
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 5, wideVp, false)).toBe(false);
  });

  it('FRACTIONAL coverage: a small pan past the tile edge (~89% covered) keeps the regional; ~50% releases', () => {
    // Exact containment released the regional the moment the viewport crept one texel past the
    // tile edge — a small pan at z7.2 flipped the whole field to the world grid. ≥80% coverage
    // keeps the finer grid (the blend base wash fills the ring); well below it, coarse takes over.
    const edgeVp = [-81.5, 27.5, -78.7, 28.5]; // 2.5/2.8 ≈ 0.89 of the viewport covered
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 7.2, edgeVp, false)).toBe(true);
    const halfVp = [-80.5, 27.5, -77.5, 28.5]; // 1.5/3 = 0.5 covered
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 7.2, halfVp, false)).toBe(false);
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

  it('FAILS OPEN on unknown zoom — a wrong reject is permanent, a wrong accept self-heals (2026-07-03)', () => {
    // _lastZoom is only written by the render loop; a commit racing a zoom change (or arriving before
    // the first frame / while rAF is paused) reads undefined. Treating that as "zoomed in" rejected the
    // coarse while the commit dedup recorded it — every retry then dup-skipped and the band displayed a
    // stranded 3° regional rectangle until an hour scrub (live 3Hz×40min loop). Unknown zoom must allow.
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), undefined, undefined, false)).toBe(false);
    // A KNOWN zoomed-in zoom with an unknown viewport still blocks (coverage assumed true).
    expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 9, undefined, false)).toBe(true);
  });
});
