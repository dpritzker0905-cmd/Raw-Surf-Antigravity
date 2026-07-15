import { shouldRejectResolutionDowngrade, shouldBridgeToCoarseGlobal, __resetRatingGraceForTests } from './WebGLMarineEngine';

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

  it('ALLOWS a CROSS-MODEL commit regardless of resolution (2026-07-06 live: GFS 9×9 resident rejected EURO 37×17 mid — the map kept DISPLAYING GFS under the EURO selection, permanently)', () => {
    // A model switch is a deliberate replacement: EURO's mid grid is its close-zoom CEILING
    // (no fine tiles), so a resolution comparison against the old model's regional is
    // meaningless and holding the old grid mislabels the data.
    expect(shouldRejectResolutionDowngrade(
      regional({ __sourceModel: 'GFS' }), coarseGlobal({ __sourceModel: 'EURO' }), 11.4, coveredVp, false
    )).toBe(false);
    // Same-model downgrades stay blocked (unchanged behavior; default model is GFS on both sides).
    expect(shouldRejectResolutionDowngrade(
      regional({ __sourceModel: 'EURO' }), coarseGlobal({ __sourceModel: 'EURO' }), 9, coveredVp, false
    )).toBe(true);
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

  // RATED-RESIDENT RELEASE (2026-07-12 round-8, live-proven: toggling ratings OFF left a rated
  // 9×9 resident held against the honest global for 75+ s — its score channel rendered through
  // the honest colormap as the "clamped garbage heatmap"). Once the Surf flag is OFF, an honest
  // incoming is a TRUTH UPGRADE over a rated resident — never held. Flag ON keeps cdd90c7e's
  // protection (unrated cold-cycle replacements still rejected).
  describe('rated-resident release on surf-flag OFF', () => {
    afterEach(() => { delete window.__SURF_MODE__; window.localStorage.removeItem('__SURF_MODE__'); });

    it('RELEASES a rated resident to ANY honest incoming when the flag is OFF (even the coarse global)', () => {
      window.__SURF_MODE__ = false;
      expect(shouldRejectResolutionDowngrade(
        regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 9, coveredVp, false
      )).toBe(false);
    });

    it('flag OFF via localStorage-undefined path also releases', () => {
      // __SURF_MODE__ undefined + localStorage unset = flag off.
      expect(shouldRejectResolutionDowngrade(
        regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 9, coveredVp, false
      )).toBe(false);
    });

    it('flag ON keeps protecting the rated resident (cdd90c7e unchanged)', () => {
      window.__SURF_MODE__ = true;
      expect(shouldRejectResolutionDowngrade(
        regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 9, coveredVp, false
      )).toBe(true);
    });

    it('honest resident vs honest incoming is untouched by the release path (coarse still blocked)', () => {
      window.__SURF_MODE__ = false;
      expect(shouldRejectResolutionDowngrade(regional(), coarseGlobal(), 9, coveredVp, false)).toBe(true);
    });
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

// ZOOM-OUT BRIDGE (2026-07-15, user "heatmap clears for a quick second midway zooming out" +
// "green grid around FL"): promote a held coarse-global grid over a regional resident the moment
// the regional stops covering a wide viewport — the coverage COMPLEMENT of the no-downgrade guard
// (guard keeps the regional while it covers; bridge takes over the instant it doesn't), so the
// two never fight and there is neither a blank flash nor a floating regional rectangle.
describe('shouldBridgeToCoarseGlobal — zoom-out bridge (coverage complement of the guard)', () => {
  const coveredVp = [-81.5, 27.5, -79.5, 28.5]; // regional (-82..-79 × 27..29) fully covers
  it('does NOT bridge while the regional still covers the viewport (guard keeps it)', () => {
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 9, coveredVp, {})).toBe(false);
  });
  it('BRIDGES once the viewport outgrows the tile at a wide zoom (the fast-flick held rectangle + the settle blank)', () => {
    const wideVp = [-100, 10, -60, 40]; // 40°×30° — the 3° tile covers ~0.7%
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 3, wideVp, {})).toBe(true);
  });
  it('BRIDGES on a wide-by-span viewport even at a mid zoom number (>15° axis)', () => {
    const wideSpanVp = [-95, 22, -75, 34]; // 20°×12° — width >15° → wideView, tile covers ~4%
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 6, wideSpanVp, {})).toBe(true);
  });
  it('does NOT bridge at a tight zoom with a small viewport (never downgrades a covering zoomed-in view)', () => {
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 9, coveredVp, {})).toBe(false);
  });
  it('does NOT bridge without a held coarse-global grid, or when the resident is already global', () => {
    const wideVp = [-100, 10, -60, 40];
    expect(shouldBridgeToCoarseGlobal(regional(), null, 3, wideVp, {})).toBe(false);
    expect(shouldBridgeToCoarseGlobal(regional(), regional(), 3, wideVp, {})).toBe(false); // incoming not coarse-global
    expect(shouldBridgeToCoarseGlobal(coarseGlobal(), coarseGlobal(), 3, wideVp, {})).toBe(false); // resident already global
  });
  it('respects the kill switch', () => {
    const wideVp = [-100, 10, -60, 40];
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 3, wideVp, { __RAW_DISABLE_ZOOMOUT_BRIDGE__: true })).toBe(false);
  });
  it('the cover-fraction lever tunes the threshold', () => {
    // A viewport the tile covers ~50%: default (0.6) bridges; raising the floor below 0.5 keeps it.
    const halfVp = [-80.5, 27.5, -77.5, 28.5]; // 1.5/3 = 0.5 covered, width 3° (not wide-by-span)
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 6, halfVp, {})).toBe(true);        // z6 ≤ zoomed-out max → wideView
    expect(shouldBridgeToCoarseGlobal(regional(), coarseGlobal(), 6, halfVp, { __RAW_DOWNGRADE_COVER_FRAC__: 0.4 })).toBe(false);
  });
});

// CELL-SIZE downgrade branch (2026-07-05, "z7.38->7.54 grid shapes behind the Channel Islands"):
// zooming IN across the tile-fit boundary makes the 30%-padded request bbox poke past the 6-deg
// socal fine tile, the resolver hands the 2-deg/cell global_mid clip, and the coarse-GLOBAL-only
// gate waved it through — displacing a still-covering 0.25-deg resident (dark smeared island
// shadow + visible 2-deg lattice, stuck until a pan). Any >=2x cell-size downgrade is now blocked
// under the same safety predicate; upgrades and <2x replacements pass untouched.
const midClip = (over = {}) => ({
  bounds: { west: -131, east: -115, south: 26, north: 42 },
  cols: 9, rows: 9, __componentLayer: 'waves', hourOffset: 0,
  vectors: new Array(81), __renderable: true, coverage_scope: 'regional', ...over,
});
const fineSocal = (over = {}) => ({
  bounds: { west: -123, east: -117, south: 31, north: 36 },
  cols: 25, rows: 21, __componentLayer: 'waves', hourOffset: 0,
  vectors: new Array(525), __renderable: true, coverage_scope: 'regional', ...over,
});
const socalVp = [-122.1, 32.4, -117.6, 35.0]; // z7.5 Channel Islands viewport, inside the fine tile

describe('shouldRejectResolutionDowngrade — cell-size branch (mid over fine)', () => {
  it('BLOCKS the 2-deg mid clip overwriting a covering 0.25-deg fine tile (the z7.38->7.54 lattice)', () => {
    expect(shouldRejectResolutionDowngrade(fineSocal(), midClip(), 7.54, socalVp, false)).toBe(true);
  });

  it('ALLOWS the mid->fine SHARPEN (upgrades are never blocked)', () => {
    expect(shouldRejectResolutionDowngrade(midClip(), fineSocal(), 7.54, socalVp, false)).toBe(false);
  });

  it('ALLOWS a near-equal-resolution replacement (<2x cell growth is a refresh, not a downgrade)', () => {
    const slightlyCoarser = fineSocal({ cols: 15, rows: 13, vectors: new Array(195) }); // 6/14 ~= 0.43 deg < 2x 0.25
    expect(shouldRejectResolutionDowngrade(fineSocal(), slightlyCoarser, 7.54, socalVp, false)).toBe(false);
  });

  it('ALLOWS mid once the fine tile no longer covers the viewport (pan off the tile)', () => {
    const bajaVp = [-116.5, 27.0, -112.0, 30.0]; // fully outside the socal fine tile
    expect(shouldRejectResolutionDowngrade(fineSocal(), midClip(), 7.5, bajaVp, false)).toBe(false);
  });

  it('ALLOWS mid for a DIFFERENT hour (scrub must never freeze on a stale fine frame)', () => {
    expect(shouldRejectResolutionDowngrade(fineSocal({ hourOffset: 0 }), midClip({ hourOffset: 24 }), 7.5, socalVp, false)).toBe(false);
  });

  it('respects the kill switch', () => {
    expect(shouldRejectResolutionDowngrade(fineSocal(), midClip(), 7.54, socalVp, true)).toBe(false);
  });
});

describe('shouldRejectResolutionDowngrade — coverage threshold 0.6 (2026-07-11 Sebastian band)', () => {
  // z~7.8 off the FL east coast: the viewport pokes past the florida_east_coast tile edge, the
  // fine 61x41 covers ~67%, and the old 0.8 threshold released it — every lane then served
  // covering-but-coarse ~0.24deg viewport grids (the whole-screen blocky "clamping" report).
  // The uncovered ring shows the coarse blend wash either way; keep the fine tile down to 60%.
  const flTile = () => ({
    bounds: { west: -82.5844, east: -79.8435, south: 27.1255, north: 31.1267 },
    cols: 61, rows: 41, __componentLayer: 'waves', hourOffset: 0,
    vectors: new Array(2501), __renderable: true, coverage_scope: 'regional',
  });
  const coarse = () => ({
    bounds: { west: -180, east: 180, south: -80, north: 85 },
    cols: 37, rows: 17, __componentLayer: 'waves', hourOffset: 0,
    vectors: new Array(629), __renderable: true, coverage_scope: 'global_coarse',
  });

  it('KEEPS the fine tile at ~67% coverage (was released at the 0.8 threshold)', () => {
    const vp67 = [-81.88, 27.0, -79.0, 29.15]; // intersection 2.04x2.02 over 2.88x2.15 = 0.666
    expect(shouldRejectResolutionDowngrade(flTile(), coarse(), 7.9, vp67, false)).toBe(true);
  });

  it('still RELEASES at ~52% coverage (the exact z7.76 live view — blend-both-aware retention is the banked follow-up)', () => {
    const vp52 = [-81.88, 26.54, -78.82, 29.15]; // live-captured viewport, frac ~= 0.516
    expect(shouldRejectResolutionDowngrade(flTile(), coarse(), 7.76, vp52, false)).toBe(false);
  });
});

describe('shouldRejectResolutionDowngrade — RATING downgrade hold (2026-07-12 EURO/ICON band flicker)', () => {
  beforeEach(() => { window.__SURF_MODE__ = true; });
  afterEach(() => { delete window.__SURF_MODE__; });

  it('BLOCKS an UNRATED same-resolution grid replacing a RATED resident (cold-SWR coarse cycle)', () => {
    // EURO/ICON have no warm pilot tiles: every cold cycle served the unrated coarse preview,
    // displacing the rated dynamic grid — "the band activated, then cleared".
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), regional({ ratingMode: false }), 9, coveredVp, false
    )).toBe(true);
  });

  it('ALLOWS a RATED replacement (never blocks rated→rated)', () => {
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), regional({ ratingMode: true, cols: 9, rows: 9 }), 9, coveredVp, false
    )).toBe(false);
  });

  it('RELEASES the rated resident when it no longer covers — after the BOUNDED grace (2026-07-14 §4f)', () => {
    // Pre-grace this released INSTANTLY, blinking the band off for the unrated interlude until
    // the wider rating clip landed. Now: hold through the grace window (the rated refetch usually
    // lands first → rated→rated swap), then release (truth wins — stranding stays impossible by
    // the BOUND, not by coverage).
    __resetRatingGraceForTests();
    const wideVp = [-84, 25, -76, 32];
    const t0 = 1_000_000;
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, t0
    )).toBe(true);                                     // held at grace start
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, t0 + 3999
    )).toBe(true);                                     // still held just inside the window
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, t0 + 4001
    )).toBe(false);                                    // expired → unrated commits (bounded)
  });

  it('grace: a RATED wider incoming lands during the hold → rated→rated swap allowed immediately', () => {
    __resetRatingGraceForTests();
    const wideVp = [-84, 25, -76, 32];
    const t0 = 2_000_000;
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, t0
    )).toBe(true);                                     // unrated held...
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: true }), 5, wideVp, false, t0 + 500
    )).toBe(false);                                    // ...but the RATED incoming passes at once
  });

  it('grace: kill switch __RAW_DISABLE_RATING_GRACE__ restores the instant release', () => {
    __resetRatingGraceForTests();
    window.__RAW_DISABLE_RATING_GRACE__ = true;
    try {
      const wideVp = [-84, 25, -76, 32];
      expect(shouldRejectResolutionDowngrade(
        regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, 3_000_000
      )).toBe(false);
    } finally {
      delete window.__RAW_DISABLE_RATING_GRACE__;
    }
  });

  it('grace: an hour scrub is never held (sameHour predicate applies to the grace too)', () => {
    __resetRatingGraceForTests();
    const wideVp = [-84, 25, -76, 32];
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true, hourOffset: 0 }), coarseGlobal({ ratingMode: false, hourOffset: 24 }),
      5, wideVp, false, 4_000_000
    )).toBe(false);
  });

  it('grace: a NEW situation (different resident tile) restarts the window', () => {
    __resetRatingGraceForTests();
    const wideVp = [-84, 25, -76, 32];
    const t0 = 5_000_000;
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, t0
    )).toBe(true);
    // grace expires for tile A...
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), coarseGlobal({ ratingMode: false }), 5, wideVp, false, t0 + 5000
    )).toBe(false);
    // ...a different rated tile (new key) gets its own fresh window
    const other = regional({ ratingMode: true, bounds: { west: -120, east: -117, south: 32, north: 35 } });
    expect(shouldRejectResolutionDowngrade(
      other, coarseGlobal({ ratingMode: false }), 5, [-124, 30, -114, 38], false, t0 + 5001
    )).toBe(true);
  });

  it('inactive surf mode: unrated replacements flow normally', () => {
    window.__SURF_MODE__ = false;
    expect(shouldRejectResolutionDowngrade(
      regional({ ratingMode: true }), regional({ ratingMode: false }), 9, coveredVp, false
    )).toBe(false);
  });
});
