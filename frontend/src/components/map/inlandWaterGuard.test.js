/**
 * Inland-water guard (2026-07-06, the Salton Sea / Laguna Salada leak): basemap water may only
 * whiten within maxDistPx of Natural-Earth water — the basemap refines the coastline, it cannot
 * invent new seas. Mapbox Streets v8's `water` layer is class-less (per Mapbox docs: "a polygon
 * layer with no differentiating types or classes"), so the ocean/sea class filter passes every
 * lake; this guard is the backstop.
 */
import { classifyInlandWater, shouldRunInlandGuard } from './inlandWaterGuard';

// Build a w×h grid from rows of '.', 'N' (NE water), 'W' (painted water), 'B' (both).
function grid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const water = new Uint8Array(w * h);
  const neWater = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const i = y * w + x;
      if (c === 'W' || c === 'B') water[i] = 1;
      if (c === 'N' || c === 'B') neWater[i] = 1;
    });
  });
  return { water, neWater, w, h };
}

describe('classifyInlandWater', () => {
  it('re-blacks a painted water blob far from any NE water (the Salton class)', () => {
    const { water, neWater, w, h } = grid([
      'NN..............',
      'NN..............',
      '................',
      '..........WWW...',
      '..........WWW...',
      '................',
    ]);
    const { reblack, count } = classifyInlandWater(water, neWater, w, h, 3);
    expect(count).toBe(6); // the whole blob (Chebyshev dist ≥ 8 > 3)
    expect(reblack[3 * w + 10]).toBe(1);
  });

  it('keeps painted water adjacent to NE water (coastal correction class)', () => {
    const { water, neWater, w, h } = grid([
      'NNNN............',
      'NNNN............',
      '.WW.............',
      '.WW.............',
    ]);
    const { count } = classifyInlandWater(water, neWater, w, h, 3);
    expect(count).toBe(0); // within 3px of NE water — trusted refinement
  });

  it('never re-blacks pixels that are NE water themselves', () => {
    const { water, neWater, w, h } = grid([
      'BBBB............',
      'BBBB............',
    ]);
    const { count } = classifyInlandWater(water, neWater, w, h, 1);
    expect(count).toBe(0);
  });

  it('applies the distance threshold exactly (Chebyshev)', () => {
    const { water, neWater, w, h } = grid([
      'N.....W.........',
    ]);
    // W at x=6, N at x=0 → Chebyshev distance 6.
    expect(classifyInlandWater(water, neWater, w, h, 6).count).toBe(0);
    expect(classifyInlandWater(water, neWater, w, h, 5).count).toBe(1);
  });

  it('re-blacks ALL painted water when the grid has no NE water at all', () => {
    const { water, neWater, w, h } = grid([
      '....WWW.........',
      '....WWW.........',
    ]);
    expect(classifyInlandWater(water, neWater, w, h, 4).count).toBe(6);
  });
});

describe('shouldRunInlandGuard (small-canvas context gate)', () => {
  it('always runs when NE water is in frame', () => {
    expect(shouldRunInlandGuard(5, true, 10)).toBe(true);
  });

  it('skips a small canvas with no NE context (deep-zoom harbor window)', () => {
    expect(shouldRunInlandGuard(12, false, 10)).toBe(false);
  });

  it('runs on a wide canvas even without NE water (genuinely inland region)', () => {
    expect(shouldRunInlandGuard(150, false, 10)).toBe(true);
  });
});
