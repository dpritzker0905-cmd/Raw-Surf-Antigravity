// Screen-bounded wave sets (2026-10-19, #397) and proportional sets (2026-10-20): at high zoom the crest envelope must not pulse the
// whole view in unison, AND the period cue must stay physical (spacing ∝ T^2, band speed ∝ T) at every zoom.
import { DRAW_VS } from './WebGLMarineParticleShaders';
import {
  viewWorldWidth, screenBoundedSetFreq, minSetsInView, proportionalSets, applyWaveSetUniforms, waveSetFreq, waveSetZoomFactor,
  waveSetBandSpeed, WAVE_SET_GLSL, WAVE_SET_MIN_IN_VIEW, WAVE_SET_T_MAX, WAVE_SET_F_FLOOR,
} from './waveSetScreenBound';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
// The shader's wave-train envelope at a point (alpha multiplier 0.25..1).
const envelope = (x, f, t, T) => { const train = fract(x * f - t / T); return 0.25 + 0.75 * (1 - smoothstep(0.08, 0.30, Math.abs(train - 0.5))); };
// Range over one period of the view-mean envelope: how much the whole screen pulses (the response of screen brightness to time).
function viewPulse(zoom, f, { css = 1280, T = 10, origin = 0.28 } = {}) {
  const w = viewWorldWidth(css, zoom);
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < T; t += T / 60) {
    let s = 0; const N = 400; for (let i = 0; i < N; i++) s += envelope(origin + (i / (N - 1)) * w, f, t, T);
    const m = s / N; lo = Math.min(lo, m); hi = Math.max(hi, m);
  }
  return hi - lo;
}
// The pre-#397 frequency (world-fixed, floor 3) and #397's (per-period max), straight from the formulas they shipped.
const legacyF = (T) => Math.min(Math.max(800 / Math.max(36, T * T), 3), 25);
const pr397 = (T, w) => screenBoundedSetFreq(legacyF(T), w);
const PERIODS = Array.from({ length: 15 }, (_, i) => 6 + i);            // 6..20 s
const ZOOMS = [1, 2, 3, 4, 8, 12, 15, 19];                               // 19 = the map's maxZoom
const WIDTHS = [1280, 390];                                              // desktop, phone (CSS px)

describe('screen-bounded wave sets', () => {
  afterEach(() => { delete window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__; delete window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__; });

  test('at least 3 sets of the LONGEST period across the view at every zoom 2-19 (so every shorter period shows more)', () => {
    for (const css of WIDTHS) for (let z = 2; z <= 19; z += 0.25) {
      const w = viewWorldWidth(css, z);
      for (const T of [...PERIODS, 4, 5.5, 25]) expect(waveSetFreq(T, w) * w).toBeGreaterThanOrEqual(WAVE_SET_MIN_IN_VIEW - 1e-9);
      expect(waveSetFreq(WAVE_SET_T_MAX, w) * w).toBeCloseTo(WAVE_SET_MIN_IN_VIEW, 9);   // the bound is tight, not loose
    }
  });

  test('band speed relative to a 10 s swell is monotone increasing in T (6..20 s) and equals the deep-water T/10, at z1 z3 z4 z8 max', () => {
    for (const css of WIDTHS) for (const z of [1, 3, 4, 8, 19]) {
      const w = viewWorldWidth(css, z); const ref = waveSetBandSpeed(10, w);
      const ratios = PERIODS.map((T) => waveSetBandSpeed(T, w) / ref);
      for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
      PERIODS.forEach((T, i) => expect(ratios[i]).toBeCloseTo(T / 10, 9));
      // and spacing ∝ T^2: the 20 s set is (20/6)^2 = 11.1x the 6 s set in every view
      expect(waveSetFreq(6, w) / waveSetFreq(20, w)).toBeCloseTo((20 / 6) ** 2, 9);
    }
  });

  test('the GPU period quanta (byte / 255 * 20 s) stay strictly ordered too, up to the 20 s encoding ceiling', () => {
    const w = viewWorldWidth(1280, 14);
    let prev = 0;
    for (let b = Math.ceil(6 / 20 * 255); b <= 255; b++) { const s = waveSetBandSpeed((b / 255) * 20, w); expect(s).toBeGreaterThan(prev); prev = s; }
  });

  test('#397 inverted this from z4 (the defect, pinned so a revert to the per-period max is caught)', () => {
    const w = viewWorldWidth(1280, 5); const sp = (T) => 1 / (T * pr397(T, w));   // from z 4.2 every period 6-20 s is on the bound
    expect(sp(20) / sp(10)).toBeCloseTo(0.5, 9);                          // groundswell at half the speed of a 10 s swell
    expect(sp(6) / sp(10)).toBeCloseTo(10 / 6, 9);
  });

  test('byte-identical where k = 1 (a view >= 1.5 worlds): every period up to 16.3 s, with and without the screen bound', () => {
    for (const [css, z] of [[4096, 1], [3072, 1], [8192, 2]]) {
      const w = viewWorldWidth(css, z); expect(waveSetZoomFactor(w)).toBe(1);
      for (let T = 2; T <= 16.32; T += 0.05) {
        expect(waveSetFreq(T, w)).toBe(legacyF(T));
        expect(waveSetFreq(T, w)).toBe(pr397(T, w));
        expect(waveSetFreq(T, w, { minSets: 0 })).toBe(legacyF(T));
      }
    }
    // 16.3-20 s change by design: the old floor 3 gave them all one spacing even at world zoom
    expect(waveSetFreq(20, viewWorldWidth(4096, 1))).toBe(WAVE_SET_F_FLOOR);
  });

  test('the whole-view pulse at z 12-15 collapses for every period (the #397 fix holds)', () => {
    for (const z of [12, 13, 14, 15]) for (const T of [6, 10, 14, 20]) {
      const w = viewWorldWidth(1280, z);
      const before = viewPulse(z, legacyF(T), { T }), after = viewPulse(z, waveSetFreq(T, w), { T });
      expect(before).toBeGreaterThan(0.5);          // ~0.75: every crest between 0.25 and 1.0 together
      // #397 put exactly 3 whole sets in view (residual ~0); here shorter periods show a non-integer count (e.g. 33.3 sets of a 6 s
      // swell), so a sliver of one set is uncovered: bounded by 1/(sets in view), at most ~4% of the original whole-screen pulse.
      expect(after).toBeLessThan(0.03);
    }
  });

  test('kill __RAW_DISABLE_PROPORTIONAL_WAVE_SETS__ restores #397 exactly; the #397 kill keeps its meaning (no screen bound)', () => {
    window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__ = true;
    expect(proportionalSets()).toBe(false);
    for (const z of ZOOMS) for (const T of PERIODS) {
      const w = viewWorldWidth(1280, z);
      expect(waveSetFreq(T, w, { proportional: proportionalSets() })).toBe(pr397(T, w));
    }
    window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ = true;                // both: pre-#397, world-fixed sets
    expect(minSetsInView()).toBe(0);
    expect(waveSetFreq(10, viewWorldWidth(1280, 14), { minSets: minSetsInView(), proportional: proportionalSets() })).toBe(8);
    delete window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__;                  // screen bound off, proportional on: k = 1, still ordered
    expect(waveSetFreq(20, viewWorldWidth(1280, 14), { minSets: minSetsInView() })).toBe(WAVE_SET_F_FLOOR);
  });

  test('the engine sets both uniforms from the kill switches', () => {
    const set = {}; const gl = { getUniformLocation: (p, n) => n, uniform1f: (n, v) => { set[n] = v; } };
    applyWaveSetUniforms(gl, {}); expect(set).toEqual({ u_minSetsInView: 3, u_proportionalSets: 1 });
    window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__ = true; window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ = true;
    applyWaveSetUniforms(gl, {}); expect(set).toEqual({ u_minSetsInView: 0, u_proportionalSets: 0 });
  });

  test('the GLSL function computes the same frequency as the JS mirror (run on its own text)', () => {
    const body = WAVE_SET_GLSL.slice(WAVE_SET_GLSL.indexOf('{') + 1, WAVE_SET_GLSL.lastIndexOf('}'))
      .replace(/\bfloat\s+/g, 'let ').replace(/(^|[^.\w])max\(/g, '$1Math.max(');
    const glsl = new Function('T', 'viewWorldWidth', 'u_minSetsInView', 'u_proportionalSets', 'clamp', body);
    const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
    for (const css of WIDTHS) for (const z of ZOOMS) for (const T of [...PERIODS, 3, 5.5, 24]) for (const m of [0, 3]) for (const p of [0, 1]) {
      const w = viewWorldWidth(css, z);
      expect(glsl(T, w, m, p, clamp)).toBeCloseTo(waveSetFreq(T, w, { minSets: m, proportional: p === 1 }), 6);
    }
  });

  test('the draw shader uses it for the envelope phase and the orbital pitch, with the same view width', () => {
    expect(DRAW_VS).toContain(WAVE_SET_GLSL);
    const calls = DRAW_VS.match(/waveSetFreq\((periodVal|pv), \(u_viewport\.x \/ dpr\) \/ \(512\.0 \* exp2\(u_zoom\)\)\)/g) || [];
    expect(calls.length).toBe(2);
    expect(DRAW_VS).not.toMatch(/screenBoundedSetFreq\(/);
  });
});
