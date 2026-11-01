/**
 * Time-windowed SETTLED_STEP (2026-10-19, owner): the same brightness change must give the same verdict whether the capture
 * machine samples a frame every 0.27 s (a desktop) or every 1.25 s (the CI runner the threshold was calibrated on).
 */
const { analyzeTrace } = require('../../scripts/zoomlab-verdict');

// A settled zoom with luminance ramping from L0 by `rate` per second, sampled every `gapMs`.
function ramp(gapMs, rate, { L0 = 100, seconds = 6, z = 13 } = {}) {
  const frames = [];
  for (let t = 0; t <= seconds * 1000; t += gapMs) frames.push({ t, z, L: L0 + rate * (t / 1000), anim: [] });
  return { frames };
}
const steps = (v) => v.findings.filter((f) => f.type === 'SETTLED_STEP').length;

describe('zoomlab-verdict time-windowed settled step', () => {
  test('a fast ramp fails at both sampling rates (it would pass per frame on the fast machine)', () => {
    // 20 L/s: per frame 25 at 1.25 s (fails), 5.4 at 0.27 s (passed under the per-frame rule)
    expect(steps(analyzeTrace(ramp(1250, 20)))).toBeGreaterThan(0);
    expect(steps(analyzeTrace(ramp(270, 20)))).toBeGreaterThan(0);
    expect(steps(analyzeTrace(ramp(270, 20), { settledWindowMs: 0 }))).toBe(0);
  });
  test('a slow ramp passes at both sampling rates', () => {
    expect(steps(analyzeTrace(ramp(1250, 8)))).toBe(0);    // 10 per CI frame
    expect(steps(analyzeTrace(ramp(270, 8)))).toBe(0);
  });
  test('the CI calibration is unchanged at the reference interval', () => {
    const t = ramp(1250, 14);                               // 17.5 per frame: a step under both rules
    expect(steps(analyzeTrace(t))).toBe(steps(analyzeTrace(t, { settledWindowMs: 0 })));
  });
  test('per-frame shimmer on a 60 fps capture is not amplified', () => {
    const frames = [];
    for (let i = 0; i < 300; i++) frames.push({ t: i * 16, z: 13, L: 100 + (i % 2 ? 3 : 0), anim: [] });   // +-3 jitter
    expect(steps(analyzeTrace({ frames }))).toBe(0);
  });
  test('a one-frame pop is caught at both rates', () => {
    const pop = (gap) => ({ frames: Array.from({ length: 12 }, (_, i) => ({ t: i * gap, z: 13, L: i < 6 ? 100 : 130, anim: [] })) });
    expect(steps(analyzeTrace(pop(1250)))).toBe(1);
    expect(steps(analyzeTrace(pop(270)))).toBe(1);
  });
  test('findings carry the step and the window it was measured over', () => {
    const f = analyzeTrace(ramp(270, 20)).findings.find((x) => x.type === 'SETTLED_STEP');
    expect(f.windowMs).toBeGreaterThanOrEqual(1000);
    expect(Math.abs(f.dL)).toBeGreaterThan(16);
  });
  test('a zoom change restarts the window (no comparison across zooms)', () => {
    const frames = [{ t: 0, z: 12, L: 100 }, { t: 600, z: 13, L: 160 }, { t: 1700, z: 13, L: 162 }];
    expect(steps(analyzeTrace({ frames }))).toBe(0);
  });
  test('traces without frame times keep the per-frame rule', () => {
    const frames = [{ z: 13, L: 100 }, { z: 13, L: 110 }];
    expect(steps(analyzeTrace({ frames }))).toBe(0);
  });
});
