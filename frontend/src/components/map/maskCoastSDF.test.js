import { computeCoastSDFBytes } from './maskCoastSDF';

// Best-in-class coastal mask (2026-07-21): the signed distance-to-coast packed into the mask's free
// `.b` channel must encode 128 at the coastline, >128 offshore (water), <128 inland (land), and be
// monotonic away from the coast — so a LINEAR-interpolated GPU sample reconstructs the coast isoline
// sub-texel-crisply and a threshold offset erodes/dilates the coast.
describe('computeCoastSDFBytes — signed distance-to-coast encoding', () => {
  it('encodes ~128 at the coast, >128 offshore, <128 inland, and is monotonic across a vertical coast', () => {
    const w = 16, h = 1;
    const water = new Uint8Array(w);
    for (let x = 0; x < w; x++) water[x] = x >= 8 ? 1 : 0; // left 8 = land, right 8 = water
    const out = new Uint8Array(w);
    computeCoastSDFBytes(water, w, h, 40, out);
    expect(out[7]).toBeLessThan(128);            // last land pixel
    expect(out[8]).toBeGreaterThanOrEqual(128);  // first water pixel
    for (let x = 1; x < w; x++) expect(out[x]).toBeGreaterThanOrEqual(out[x - 1]); // monotonic land→water
    expect(out[0]).toBeLessThan(out[7]);         // deep inland < near-coast land
    expect(out[w - 1]).toBeGreaterThan(out[8]);  // deep offshore > near-coast water
  });

  it('saturates to 255 for an all-water field (no coast → infinite offshore distance)', () => {
    const w = 8, h = 8, N = w * h;
    const water = new Uint8Array(N).fill(1);
    const out = new Uint8Array(N);
    computeCoastSDFBytes(water, w, h, 40, out);
    for (let i = 0; i < N; i++) expect(out[i]).toBe(255);
  });

  it('saturates to 0 for an all-land field (no coast → fully inland)', () => {
    const w = 8, h = 8, N = w * h;
    const water = new Uint8Array(N); // all 0 = land
    const out = new Uint8Array(N);
    computeCoastSDFBytes(water, w, h, 40, out);
    for (let i = 0; i < N; i++) expect(out[i]).toBe(0);
  });

  it('a larger rangeTexels gives a gentler gradient (smaller offset per texel)', () => {
    const w = 16, h = 1;
    const water = new Uint8Array(w);
    for (let x = 0; x < w; x++) water[x] = x >= 8 ? 1 : 0;
    const near = new Uint8Array(w), far = new Uint8Array(w);
    computeCoastSDFBytes(water, w, h, 10, near);   // steep
    computeCoastSDFBytes(water, w, h, 80, far);    // gentle
    // deep-offshore byte is closer to 128 with the gentler (larger-range) encoding
    expect(far[w - 1] - 128).toBeLessThan(near[w - 1] - 128);
  });

  it('is 2D-aware: distance to a corner-only water region radiates diagonally', () => {
    const w = 5, h = 5, N = w * h;
    const water = new Uint8Array(N); // all land except one water pixel at (0,0)
    water[0] = 1;
    const out = new Uint8Array(N);
    computeCoastSDFBytes(water, w, h, 40, out);
    expect(out[0]).toBeGreaterThanOrEqual(128);        // the water seed
    // farthest land corner (4,4) is more inland (smaller byte) than an edge-adjacent land pixel (1,0)
    expect(out[4 * w + 4]).toBeLessThan(out[1]);
  });
});
