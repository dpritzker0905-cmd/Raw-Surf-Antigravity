import { classifySheltered } from './marineMaskShelter';

/**
 * CANONICAL MASK GEOMETRIES — the safety net the ocean-mask path does not have.
 *
 * Gate 2 (audit 11.2) lists *pixel-wise OceanMask registration* as UNTESTED, and the profiling on
 * 2026-08-12 established that this classifier is what causes the large startup stalls
 * (GATE6_getImageData_IS_STARTUP_NOT_STEADY_STATE.md). Optimising it without a behavioural pin
 * would be the highest-risk change available: `marineMaskShelter.js` carries several hard-won
 * live-defect fixes in its comments — the Canal Grande mottle, Pellestrina reading as water, the
 * z16 mottled-block report — and none of them has a test.
 *
 * ★ Real coastlines cannot settle this. A plausible-looking suppression looks plausible when it is
 *   wrong, exactly as a mirrored swell field does. Only a geometry whose correct answer is known in
 *   advance can. Same argument as WebGLMarineTextureEncoder.canonicalFields.test.js.
 *
 * The algorithm under test (classifySheltered):
 *   1. `dist`  = Chebyshev distance-to-LAND for every water pixel
 *   2. flood the ERODED CORE (`dist > nPx`) by BFS from every border core pixel
 *   3. `dist2` = distance-to-flooded-core; water with `dist2 > nPx` is enclosed
 *   4. MIN-AREA FILTER: connected sheltered components smaller than `16·nPx²` are released back to
 *      open water (added 2026-07-04 for "breaks in the heatmap between islands")
 *
 * ⚠️ Assertions below are labelled PREDICTED (derived from the algorithm before running) or PINNED
 *    (characterisation of current behaviour, recorded so a change is visible). They are not the
 *    same kind of claim and must not be read as if they were.
 */

// ASCII fixtures: '~' water, '#' land. Legible geometry beats an index-arithmetic builder.
function grid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const water = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) water[y * w + x] = row[x] === '~' ? 1 : 0;
  });
  return { water, w, h };
}

// Count sheltered pixels inside an inclusive box — lets a case assert WHERE, not just how many.
function shelteredIn(sheltered, w, x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (sheltered[y * w + x]) n++;
  return n;
}

const NPX = 1;   // erosion radius; min-area filter is 16·nPx² = 16 px

// A basin (cols 10-16, rows 4-10 = 49 px) joined to the open sea (cols 0-4) by a channel whose
// WIDTH is the only thing that differs between the two fixtures below.
const NARROW = [
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',   // 1-px channel: every pixel touches land, so it has NO eroded core
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############'
];

const WIDE = [
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~#####~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',   // 5-px channel: its centre reaches dist 3 > nPx, so the core connects
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############'
];

describe('classifySheltered — canonical geometries', () => {
  it('PREDICTED: all water is all open (the border flood reaches everything)', () => {
    const { water, w, h } = grid(Array(10).fill('~~~~~~~~~~~~~~~~~~~~'));
    expect(classifySheltered(water, w, h, NPX).count).toBe(0);
  });

  it('PREDICTED: all land shelters nothing (there is no water to enclose)', () => {
    const { water, w, h } = grid(Array(10).fill('####################'));
    expect(classifySheltered(water, w, h, NPX).count).toBe(0);
  });

  it('PREDICTED: a basin behind a NARROW entrance is sheltered', () => {
    const { water, w, h } = grid(NARROW);
    const { sheltered, count } = classifySheltered(water, w, h, NPX);
    expect(count).toBeGreaterThan(0);
    // and it is the BASIN that is sheltered, not the open sea on the left
    expect(shelteredIn(sheltered, w, 10, 4, 16, 10)).toBeGreaterThan(0);
    expect(shelteredIn(sheltered, w, 0, 0, 4, 13)).toBe(0);
  });

  it('PREDICTED: the SAME basin behind a WIDE entrance is open', () => {
    const { water, w, h } = grid(WIDE);
    expect(shelteredIn(classifySheltered(water, w, h, NPX).sheltered, w, 10, 4, 16, 10)).toBe(0);
  });

  it('★ THE DISCRIMINATION: entrance width alone flips the verdict', () => {
    const n = grid(NARROW), d = grid(WIDE);
    const narrow = classifySheltered(n.water, n.w, n.h, NPX).count;
    const wide = classifySheltered(d.water, d.w, d.h, NPX).count;
    // A classifier that cannot tell these apart proves nothing about any real coastline.
    expect(narrow).toBeGreaterThan(wide);
    expect(wide).toBe(0);
  });

  it('PREDICTED: the open sea is never suppressed in either fixture', () => {
    for (const rows of [NARROW, WIDE]) {
      const { water, w, h } = grid(rows);
      expect(shelteredIn(classifySheltered(water, w, h, NPX).sheltered, w, 0, 0, 4, 13)).toBe(0);
    }
  });

  it('PREDICTED: a fully enclosed lake (no entrance at all) is sheltered', () => {
    const { water, w, h } = grid([
      '~~~~~###############',
      '~~~~~###############',
      '~~~~~###############',
      '~~~~~###############',
      '~~~~~#####~~~~~~~###',
      '~~~~~#####~~~~~~~###',
      '~~~~~#####~~~~~~~###',
      '~~~~~#####~~~~~~~###',
      '~~~~~#####~~~~~~~###',
      '~~~~~#####~~~~~~~###',
      '~~~~~#####~~~~~~~###',
      '~~~~~###############',
      '~~~~~###############',
      '~~~~~###############'
    ]);
    expect(shelteredIn(classifySheltered(water, w, h, NPX).sheltered, w, 10, 4, 16, 10)).toBeGreaterThan(0);
  });

  // ⛔ I PREDICTED THIS ONE WRONG, AND THE CODE WAS RIGHT. My first version asserted that ANY
  // component under 16·nPx² is released, and expected 0. It returned 9. The release condition is
  // `ct < minArea && near > ct * 0.5` — small AND *mostly hugging the open core*. Being small is
  // not sufficient, and that is the whole point of the rule: a dead-end urban canal (Canal Grande,
  // live z16 catch) touches the core only at its mouth and must stay suppressed however small it is.
  // ★ Reading half a condition and predicting from it is how a test ends up pinning a bug as
  //   correct. Here it ran the other way — the test caught the reader.
  it('a SMALL ENCLOSED pocket stays suppressed — small is not sufficient to release', () => {
    // 3x3 = 9 px, well under the 16 px floor, but fully enclosed: near = 0.
    const { water, w, h } = grid([
      '~~~~~###############',
      '~~~~~###############',
      '~~~~~####~~~########',
      '~~~~~####~~~########',
      '~~~~~####~~~########',
      '~~~~~###############',
      '~~~~~###############'
    ]);
    expect(classifySheltered(water, w, h, NPX).count).toBe(9);
  });

  it('★ PASSAGE vs CANAL: a small strip that hugs open water on BOTH sides is released', () => {
    // The "breaks in the heatmap between islands" case (2026-07-04): an inter-island fairway is
    // narrow enough to fail the erode-flood test, but it is open water, not a basin. Both its ends
    // sit against the open core, so `near` covers the whole component and it is released.
    const { water, w, h } = grid([
      '~~~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~~~',
      '~~~~##~~~~~~~~~~',
      '~~~~##~~~~~~~~~~',
      '~~~~~~~~~~~~~~~~',   // the 2-px strip at cols 4-5, land above and below
      '~~~~##~~~~~~~~~~',
      '~~~~##~~~~~~~~~~',
      '~~~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~~~'
    ]);
    expect(classifySheltered(water, w, h, NPX).count).toBe(0);
  });

  it('PINNED: nPx=0 disables the erosion, so nothing is ever enclosed', () => {
    const { water, w, h } = grid(NARROW);
    // Characterisation, not a design claim: with no erosion the core is all water and the border
    // flood reaches the basin through the 1-px channel.
    expect(classifySheltered(water, w, h, 0).count).toBe(0);
  });

  it('PINNED: the returned sheltered mask only ever marks WATER pixels', () => {
    const { water, w, h } = grid(NARROW);
    const { sheltered } = classifySheltered(water, w, h, NPX);
    for (let i = 0; i < w * h; i++) if (sheltered[i]) expect(water[i]).toBe(1);
  });
});
