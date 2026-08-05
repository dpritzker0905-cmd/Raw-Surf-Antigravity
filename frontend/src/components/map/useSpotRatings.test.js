import { sampleRatingScoreFromGrid, computeSpotRatings, summarizeSpotRatings, writeSpotRatingsDiag, aggregateLeafRatings, computeClusterRatings } from './useSpotRatings';

// Build a cols×rows rating grid over [west..east]×[south..north]; cell (x,y) value -> vectors[y*cols+x].speed.
function makeGrid({ cols, rows, west, south, east, north, cells }) {
  const vectors = Array.from({ length: cols * rows }, () => ({ speed: 0 }));
  for (const [x, y, speed] of cells) vectors[y * cols + x].speed = speed;
  return { cols, rows, bounds: { west, south, east, north }, vectors };
}

describe('sampleRatingScoreFromGrid', () => {
  // 5×5 grid, 1° cells: lng==x, lat==y. A rated cell (speed 8 -> score 80) at the NE corner (4,4).
  const grid = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4, cells: [[4, 4, 8.0]] });

  it('decodes score = speed * 10 at a rated cell', () => {
    expect(sampleRatingScoreFromGrid(grid, 4, 4)).toBe(80);
  });

  it('finds the rated cell within the small neighbourhood search', () => {
    // (lat 3,lng 3) -> cell (3,3); the ±2 search reaches (4,4).
    expect(sampleRatingScoreFromGrid(grid, 3, 3)).toBe(80);
  });

  it('returns null when no rated cell is near the spot', () => {
    // (0,0) -> cell (0,0); ±2 search covers x,y in [0..2] only — never reaches (4,4).
    expect(sampleRatingScoreFromGrid(grid, 0, 0)).toBeNull();
  });

  it('returns null outside the grid bounds', () => {
    expect(sampleRatingScoreFromGrid(grid, 10, 10)).toBeNull();
    expect(sampleRatingScoreFromGrid(grid, -5, 2)).toBeNull();
  });

  // ── ⛔ NEAREST RATED CELL, NOT THE BEST ONE IN THE WINDOW (2026-08-05) ────────────────────────
  // The reducer was `if (sp > best) best = sp` — a pure MAX over the whole +-2 box. Measured live
  // at zoom 9 over Florida the marine grid is 0.25 deg cells, so that box is 1.0 x 1.0 degrees =
  // 111.3 km x 98.3 km: off Cocoa Beach it reaches past Daytona, and the glyph showed the best
  // break in it. The +-2 SEARCH is right (its documented job is to find the adjacent rated cell
  // when a coastal spot's own cell is land-masked); the REDUCER was answering a question nobody
  // asked.
  // ⚠️ NOT A RARE PATH: beyond the precompute bound the endpoint is deliberately skipped and every
  //    glyph falls back to this sampler — observed live, gridFallbackCount 2 of 2 eligible spots.
  // ★ ALL 22 PRE-EXISTING TESTS PASSED BOTH BEFORE AND AFTER THE FIX. Not one of them placed two
  //   rated cells at different distances, so none could tell MAX from NEAREST. These can.
  it('takes the NEAREST rated cell, not the highest one in the window', () => {
    // cell (2,2) is the spot. A poor cell adjacent at (3,2); an epic cell two away at (4,2).
    // MAX would return 95; NEAREST must return 30.
    const g = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4,
                         cells: [[3, 2, 3.0], [4, 2, 9.5]] });
    expect(sampleRatingScoreFromGrid(g, 2, 2)).toBe(30);
  });

  it('still reaches a distant rated cell when nothing nearer is rated', () => {
    // The land-mask case the +-2 search exists for: only (4,2) is rated, two cells away.
    const g = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4,
                         cells: [[4, 2, 9.5]] });
    expect(sampleRatingScoreFromGrid(g, 2, 2)).toBe(95);
  });

  it('prefers a diagonal neighbour over a farther orthogonal one', () => {
    // (3,3) is diagonal at d2=2; (4,2) is orthogonal-ish at d2=4. Nearest wins on true distance,
    // not on scan order — a max-based or first-found reducer would disagree.
    const g = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4,
                         cells: [[3, 3, 4.0], [4, 2, 9.0]] });
    expect(sampleRatingScoreFromGrid(g, 2, 2)).toBe(40);
  });

  it('clamps the score to 100', () => {
    const hot = makeGrid({ cols: 3, rows: 3, west: 0, south: 0, east: 2, north: 2, cells: [[1, 1, 15.0]] });
    expect(sampleRatingScoreFromGrid(hot, 1, 1)).toBe(100);
  });

  it('returns null for missing / empty / malformed grids', () => {
    expect(sampleRatingScoreFromGrid(null, 1, 1)).toBeNull();
    expect(sampleRatingScoreFromGrid({ cols: 0, rows: 0, bounds: {}, vectors: [] }, 1, 1)).toBeNull();
    expect(sampleRatingScoreFromGrid(grid, null, null)).toBeNull();
  });
});

describe('computeSpotRatings — Option-A ratingMode gate', () => {
  // 5×5 rating grid with a rated cell (score 80) at the NE corner; a spot sits right on it.
  const ratedCells = [[4, 4, 8.0]];
  const ratingGrid = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4, cells: ratedCells });
  ratingGrid.ratingMode = true;
  const spots = [{ id: 's1', latitude: 4, longitude: 4, isCluster: false }];

  it('rates the spot when the grid is a genuine rating grid (ratingMode true)', () => {
    const out = computeSpotRatings(spots, ratingGrid, true);
    expect(out.s1).toBeDefined();
    expect(out.s1.score).toBe(80);
    expect(out.s1.level).toBeTruthy();
  });

  it('suppresses glyphs on a raw-height frame (ratingMode false) even with identical data', () => {
    // Same numbers, but the backend did NOT run the surf transform → speed is raw HEIGHT, not score/10.
    const rawGrid = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4, cells: ratedCells });
    rawGrid.ratingMode = false;
    expect(computeSpotRatings(spots, rawGrid, true)).toEqual({});
  });

  it('treats a missing ratingMode flag as not-a-rating-grid (no fake glyphs)', () => {
    const noFlag = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4, cells: ratedCells });
    expect(computeSpotRatings(spots, noFlag, true)).toEqual({});
  });

  it('returns empty when surf mode is off', () => {
    expect(computeSpotRatings(spots, ratingGrid, false)).toEqual({});
  });

  it('skips cluster entries', () => {
    const clustered = [{ id: 'c1', latitude: 4, longitude: 4, isCluster: true }];
    expect(computeSpotRatings(clustered, ratingGrid, true)).toEqual({});
  });

  it('returns ONE stable frozen empty ref on every gated path (scrub-churn fix `63765848`)', () => {
    // A fresh {} per call re-rendered gridRatings->merged->clusterRatings->MapMarkerLayers on EVERY
    // scrub step with the overlay off (spotRatings drove 47/95 renders). All gated paths must share
    // the SAME reference so the memoized markers bail. Frozen so a caller can never mutate the shared empty.
    const noFlag = makeGrid({ cols: 5, rows: 5, west: 0, south: 0, east: 4, north: 4, cells: ratedCells });
    const surfOff = computeSpotRatings(spots, ratingGrid, false);   // surf mode off
    const rawFrame = computeSpotRatings(spots, noFlag, true);        // ratingMode missing
    expect(surfOff).toEqual({});
    expect(surfOff).toBe(rawFrame);              // identical reference across distinct gated calls
    expect(computeSpotRatings(spots, ratingGrid, false)).toBe(surfOff);  // stable across repeated calls
    expect(Object.isFrozen(surfOff)).toBe(true);
  });
});

describe('summarizeSpotRatings — diagnostics', () => {
  it('counts, samples ids, and tallies levels', () => {
    const map = {
      a: { level: 'very_poor' }, b: { level: 'very_poor' }, c: { level: 'good' },
      d: { level: 'very_poor' }, e: { level: 'fair' }, f: { level: 'very_poor' },
    };
    const s = summarizeSpotRatings(map);
    expect(s.count).toBe(6);
    expect(s.sampleIds).toEqual(['a', 'b', 'c', 'd', 'e']); // capped at 5
    expect(s.levels).toEqual({ very_poor: 4, good: 1, fair: 1 });
  });

  it('handles empty / null maps', () => {
    expect(summarizeSpotRatings({})).toEqual({ count: 0, sampleIds: [], levels: {} });
    expect(summarizeSpotRatings(null)).toEqual({ count: 0, sampleIds: [], levels: {} });
  });

  it('defaults a missing level to unknown in the tally', () => {
    expect(summarizeSpotRatings({ a: {}, b: { level: 'poor' } }).levels).toEqual({ unknown: 1, poor: 1 });
  });
});

describe('aggregateLeafRatings — cluster tint', () => {
  const leaf = (spotId) => ({ properties: { spotId } });
  const ratings = {
    a: { score: 20, level: 'poor', color: '#f59e2c', label: 'Poor' },
    b: { score: 75, level: 'good', color: '#7c3aed', label: 'Good' },
    c: { score: 40, level: 'poor_fair', color: '#f7d038', label: 'Poor to Fair' },
  };

  it('picks the highest-scoring rated leaf and counts the rated ones', () => {
    const out = aggregateLeafRatings([leaf('a'), leaf('b'), leaf('c'), leaf('z')], ratings);
    expect(out.level).toBe('good');      // b has the top score (75)
    expect(out.color).toBe('#7c3aed');
    expect(out.count).toBe(3);            // a,b,c rated; z (unrated) ignored
  });

  it('returns null when no leaf is rated', () => {
    expect(aggregateLeafRatings([leaf('x'), leaf('y')], ratings)).toBeNull();
  });

  it('tolerates malformed leaves / missing ratings', () => {
    expect(aggregateLeafRatings(null, ratings)).toBeNull();
    expect(aggregateLeafRatings([leaf('a')], null)).toBeNull();
    expect(aggregateLeafRatings([{}, { properties: {} }, leaf('a')], ratings).level).toBe('poor');
  });
});

describe('computeClusterRatings — wiring + cap', () => {
  const ratings = { a: { score: 20, level: 'poor', color: '#1', label: 'Poor' }, b: { score: 90, level: 'epic', color: '#2', label: 'Epic' } };
  // Fake supercluster: clusterId 1 -> [a,b], clusterId 2 -> [unrated].
  const supercluster = {
    getLeaves: (id) => (id === 1 ? [{ properties: { spotId: 'a' } }, { properties: { spotId: 'b' } }]
      : [{ properties: { spotId: 'z' } }]),
  };
  const clusters = [
    { id: 'cluster-1', isCluster: true, clusterId: 1 },
    { id: 'cluster-2', isCluster: true, clusterId: 2 },
    { id: 'a', isCluster: false },             // individual spot — skipped
  ];

  it('keys aggregated ratings by cluster.id and skips clusters with no rated leaves', () => {
    const out = computeClusterRatings(clusters, ratings, supercluster);
    expect(out['cluster-1'].level).toBe('epic');  // best of a,b
    expect(out['cluster-2']).toBeUndefined();      // only an unrated leaf
    expect(out['a']).toBeUndefined();              // non-cluster
  });

  it('returns {} with no ratings / no supercluster', () => {
    expect(computeClusterRatings(clusters, {}, supercluster)).toEqual({});
    expect(computeClusterRatings(clusters, ratings, null)).toEqual({});
  });

  it('passes the leaf cap through to getLeaves', () => {
    const spy = { getLeaves: jest.fn(() => [{ properties: { spotId: 'b' } }]) };
    computeClusterRatings([{ id: 'cluster-1', isCluster: true, clusterId: 1 }], ratings, spy, 50);
    expect(spy.getLeaves).toHaveBeenCalledWith(1, 50);
  });
});

describe('writeSpotRatingsDiag — window telemetry', () => {
  afterEach(() => { try { delete window.__SPOT_RATINGS_DIAG__; } catch (e) { /* noop */ } });

  it('merges patches into window.__SPOT_RATINGS_DIAG__ and stamps ts', () => {
    writeSpotRatingsDiag({ status: 'fetching', lastBbox: '0,0,1,1' });
    writeSpotRatingsDiag({ status: 'ok', fetched: 3 });
    const d = window.__SPOT_RATINGS_DIAG__;
    expect(d.status).toBe('ok');         // later patch wins
    expect(d.lastBbox).toBe('0,0,1,1');  // earlier field retained
    expect(d.fetched).toBe(3);
    expect(typeof d.ts).toBe('number');
  });
});
