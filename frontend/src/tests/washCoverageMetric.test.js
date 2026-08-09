/**
 * The wash-coverage metric's calibration, pinned (2026-08-09).
 *
 * User report: "activated a marine layer at default zoom, zoomed out rapidly, animations cleared
 * the heatmap at mid zoom-out, then it returned further out." No instrument in the estate could
 * see that: the structural detector wants a resident grid that fails to COVER, and `findSeams`
 * wants a ruler-straight EDGE between washed and bare ocean. A viewport where the wash simply is
 * not drawn has neither — no coverage failure, no edge.
 *
 * `washFraction` closes that gap by measuring CHROMA, because the wash is a saturated ramp over a
 * near-neutral ocean. The threshold is MEASURED from a layer-off/layer-on control pair, and it sits
 * on a cliff — the basemap collapses from 0.931 to 0.003 between chroma 30 and 50:
 *
 *     chroma >=      28 (first guess)     50       90      150     190
 *     basemap only        0.931         0.003    0.003   0.002   0.002
 *     wash drawn          0.995         0.933    0.932   0.880   0.000
 *     separation          1.07x          306x     329x    364x       0
 *
 * The first guess of 28 was on the WRONG SIDE of that cliff: it measured "the map has colour" and
 * separated the two states by 7%. Its own control caught it and refused rather than reporting a
 * number. These tests pin the plateau so a future edit cannot slide the constant back onto a cliff
 * without going red.
 */
const { washFraction, WASH_CHROMA, CROP } = require('../../scripts/probe_wind_zoomburst');

// Build a fake decoded PNG (RGBA) whose crop region is a single flat colour.
function flat(r, g, b) {
  const w = 1280, h = 800, ch = 4;
  const data = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w * ch + x * ch;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { w, h, ch, data };
}
// chroma == max-min; brightness floor is mx > 40
const chromaOf = (c) => flat(20 + c, 20, 20);

describe('wash-coverage metric calibration', () => {
  it('reads ~0 on a neutral (unwashed) crop and ~1 on a saturated one', () => {
    expect(washFraction(flat(30, 30, 30))).toBe(0);
    expect(washFraction(flat(240, 40, 40))).toBe(1);
  });

  it('sits inside the measured plateau, clear of BOTH cliffs', () => {
    // basemap side: the real basemap collapses below chroma 50, so the constant must be above it
    expect(WASH_CHROMA).toBeGreaterThanOrEqual(50);
    // wash side: real wash coverage starts eroding past ~130 and is gone by 190
    expect(WASH_CHROMA).toBeLessThanOrEqual(130);
  });

  it('⛔ rejects the first guess: chroma 28 does not discriminate', () => {
    // A basemap-like pixel at chroma ~35 must NOT count as wash. This is the exact failure that
    // made the metric report 0.931 for a map with no marine layer at all.
    expect(washFraction(chromaOf(35))).toBe(0);
  });

  it('counts a genuinely saturated wash pixel', () => {
    expect(washFraction(chromaOf(140))).toBe(1);
  });

  it('excludes near-black pixels regardless of hue (unstable chroma at low brightness)', () => {
    // max channel 35 < the brightness floor of 40, even though chroma is large
    expect(washFraction(flat(35, 0, 0))).toBe(0);
  });

  it('the crop stays inside a 1280x800 viewport', () => {
    expect(CROP.x1).toBeLessThanOrEqual(1280);
    expect(CROP.y1).toBeLessThanOrEqual(800);
    expect(CROP.x0).toBeLessThan(CROP.x1);
    expect(CROP.y0).toBeLessThan(CROP.y1);
  });
});
