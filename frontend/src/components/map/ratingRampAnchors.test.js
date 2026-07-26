/**
 * The band's smooth colour ramp must agree with the discrete legend (D3, 2026-07-26).
 *
 * `getRatingColorSmooth` in WebGLMarineShaders.js interpolates the 7 RATING_COLOR anchors so the
 * coastal band reads as a gradient — deliberate, and the discrete levels still drive the legend and
 * the per-spot glyphs. But the anchors used to sit on the `_BUCKETS` EDGES (14/28/42/56/70/84), which
 * shifted the entire gradient half a bucket:
 *
 *     score 41  -> level "poor_fair"  -> painted mix(poor_fair, fair, 13/14) = 93% fair-green
 *
 * so every level's upper edge rendered as the level ABOVE it, and the band disagreed with its own
 * legend (MapWeatherControls.js, which uses the discrete RATING_COLOR map) across most of the scale.
 *
 * This parses the ramp OUT OF THE ACTUAL GLSL SOURCE and evaluates it numerically, so it pins the
 * real shader rather than a JS re-implementation that could drift from it.
 */
import { HEATMAP_FS } from './WebGLMarineShaders';
import { RATING_COLOR, RATING_RAMP_ANCHORS, RATING_LEVELS, scoreToLevel } from './surfRating';

/** Pull the `if (s < X) return mix(cA, cB, (s - Y) / Z);` ladder out of the GLSL and evaluate it. */
function parseRamp(glsl) {
  const body = glsl.slice(glsl.indexOf('vec3 getRatingColorSmooth'));
  const end = body.indexOf('\n}');
  const src = body.slice(0, end);

  const colors = {};
  for (const m of src.matchAll(/vec3 (c\d) = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)) {
    colors[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  const mixSteps = [...src.matchAll(/if \(s <=? ([\d.]+)\) return mix\((c\d), (c\d), \(s - ([\d.]+)\) \/ ([\d.]+)\);/g)]
    .map((m) => ({ lt: Number(m[1]), a: m[2], b: m[3], off: Number(m[4]), span: Number(m[5]) }));
  const flatSteps = [...src.matchAll(/if \(s <=? ([\d.]+)\) return (c\d);/g)]
    .map((m) => ({ lt: Number(m[1]), flat: m[2] }));
  const tail = src.match(/return (c\d);\s*$/);

  return function evalRamp(s) {
    for (const f of flatSteps) if (s <= f.lt) return colors[f.flat];
    for (const st of mixSteps) {
      if (s < st.lt) {
        const t = Math.min(1, Math.max(0, (s - st.off) / st.span));
        return colors[st.a].map((v, i) => v + (colors[st.b][i] - v) * t);
      }
    }
    return colors[tail[1]];
  };
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('band colour ramp vs the discrete legend', () => {
  const ramp = parseRamp(HEATMAP_FS);
  const levels = RATING_LEVELS;

  test('the ramp is parsed out of the real GLSL (guard against a silent no-op test)', () => {
    expect(typeof ramp).toBe('function');
    expect(dist(ramp(0), hexToRgb(RATING_COLOR.very_poor))).toBeLessThan(0.02);
    expect(dist(ramp(100), hexToRgb(RATING_COLOR.epic))).toBeLessThan(0.02);
  });

  test('at each bucket CENTRE the band paints exactly that level colour', () => {
    RATING_RAMP_ANCHORS.forEach((centre, i) => {
      const level = levels[i];
      // the centre must actually belong to the level it anchors
      expect(scoreToLevel(centre)).toBe(level);
      expect(dist(ramp(centre), hexToRgb(RATING_COLOR[level]))).toBeLessThan(0.02);
    });
  });

  test('the ramp never paints a score closer to a NON-adjacent level than to its own', () => {
    for (let s = 0; s <= 100; s += 0.5) {
      const own = levels.indexOf(scoreToLevel(s));
      const c = ramp(s);
      const nearest = levels
        .map((lv, i) => ({ i, d: dist(c, hexToRgb(RATING_COLOR[lv])) }))
        .sort((a, b) => a.d - b.d)[0].i;
      expect(Math.abs(nearest - own)).toBeLessThanOrEqual(1);
    }
  });

  test('REGRESSION: 41 is poor_fair and must NOT paint as fair-green', () => {
    expect(scoreToLevel(41)).toBe('poor_fair');
    const c = ramp(41);
    const dPoorFair = dist(c, hexToRgb(RATING_COLOR.poor_fair));
    const dFair = dist(c, hexToRgb(RATING_COLOR.fair));
    // with the old EDGE anchors this was 93% of the way to fair -> dFair << dPoorFair
    expect(dPoorFair).toBeLessThan(dFair);
  });

  test('the shader anchors match RATING_RAMP_ANCHORS', () => {
    for (const a of RATING_RAMP_ANCHORS.slice(1, -1)) {
      expect(HEATMAP_FS).toContain(`s < ${a}.0`);
    }
  });
});
