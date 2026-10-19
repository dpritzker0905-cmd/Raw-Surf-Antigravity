// Screen-bounded wave sets (2026-10-19): at high zoom the crest envelope must not pulse the whole view in unison.
import { DRAW_VS } from './WebGLMarineParticleShaders';
import { viewWorldWidth, screenBoundedSetFreq, minSetsInView, WAVE_SET_MIN_IN_VIEW } from './waveSetScreenBound';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
// The shader's wave-train envelope at a point (alpha multiplier 0.25..1).
const envelope = (x, f, t, T) => { const train = fract(x * f - t / T); return 0.25 + 0.75 * (1 - smoothstep(0.08, 0.30, Math.abs(train - 0.5))); };
// Range over one period of the view-mean envelope: how much the whole screen pulses (the response of screen brightness to time).
function viewPulse(zoom, f0, minSets, { css = 1280, T = 10, origin = 0.28 } = {}) {
  const w = viewWorldWidth(css, zoom); const f = screenBoundedSetFreq(f0, w, minSets);
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < T; t += T / 60) {
    let s = 0; const N = 200; for (let i = 0; i < N; i++) s += envelope(origin + (i / (N - 1)) * w, f, t, T);
    const m = s / N; lo = Math.min(lo, m); hi = Math.max(hi, m);
  }
  return hi - lo;
}

describe('screen-bounded wave sets', () => {
  afterEach(() => { delete window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__; });

  test('at least 3 sets across a 1280 px view at every zoom 4-18, for the whole period range', () => {
    for (const f0 of [3, 10, 25]) for (let z = 4; z <= 18; z += 0.5) {
      const w = viewWorldWidth(1280, z);
      expect(screenBoundedSetFreq(f0, w) * w).toBeGreaterThanOrEqual(WAVE_SET_MIN_IN_VIEW - 1e-9);
    }
  });
  test('zoomed out the frequency is unchanged (byte-identical look where >= 3 sets already show)', () => {
    expect(screenBoundedSetFreq(10, viewWorldWidth(1280, 2))).toBe(10);   // 6.25 sets in view
    expect(screenBoundedSetFreq(25, viewWorldWidth(1280, 3))).toBe(25);
  });
  test('the whole-view pulse at z 12-15 collapses (before: the screen fades in unison; after: a fraction of it)', () => {
    for (const z of [12, 13, 14, 15]) {
      const before = viewPulse(z, 10, 0), after = viewPulse(z, 10, WAVE_SET_MIN_IN_VIEW);
      expect(before).toBeGreaterThan(0.5);          // ~0.75: every crest between 0.25 and 1.0 together
      expect(after).toBeLessThan(before * 0.1);
    }
  });
  test('kill switch restores the world-fixed sets', () => {
    window.__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__ = true;
    expect(minSetsInView()).toBe(0);
    expect(screenBoundedSetFreq(10, viewWorldWidth(1280, 14), minSetsInView())).toBe(10);
  });
  test('the draw shader applies it to the envelope phase and the orbital pitch, with the same view width', () => {
    expect(DRAW_VS).toContain('uniform float u_minSetsInView');
    const calls = DRAW_VS.match(/screenBoundedSetFreq\(clamp\([^;]*\(u_viewport\.x \/ dpr\) \/ \(512\.0 \* exp2\(u_zoom\)\)\)/g) || [];
    expect(calls.length).toBe(2);
  });
});
