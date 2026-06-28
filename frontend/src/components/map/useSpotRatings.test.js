import { sampleRatingScoreFromGrid } from './useSpotRatings';

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
