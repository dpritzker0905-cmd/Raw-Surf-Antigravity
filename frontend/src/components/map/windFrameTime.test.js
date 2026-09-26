/**
 * A15-18 (audit 15.0): the wind field must look the same per SECOND at 30, 60, 120 and 144 Hz.
 *
 * The step (u_speed_scale), trail fade (u_fade) and respawn (the advect shader's drop test) were
 * applied once per frame, so a 120 Hz display ran particles twice as fast with half-length trails.
 */
import { frameTimeScale, perFrameFade, REFERENCE_FRAME_MS, FRAME_SCALE_MIN, FRAME_SCALE_MAX } from './WebGLWindUtils';
import { ADVECT_FS } from './WebGLWindShaders';

const runFor = (hz, seconds) => {
  const engine = {};
  const dt = 1000 / hz;
  const scales = [];
  for (let t = 0; t <= seconds * 1000 + 1e-9; t += dt) scales.push(frameTimeScale(engine, t));
  return scales.slice(1);           // the first frame has no predecessor
};

test('the first frame is one reference frame; a clock that does not advance is too', () => {
  const e = {};
  expect(frameTimeScale(e, 1000)).toBe(1);
  expect(frameTimeScale(e, 1000)).toBe(1);
});

test.each([30, 60, 120, 144])('distance travelled per second is the 60 Hz distance at %i Hz', (hz) => {
  const perStepAtScale1 = 1;          // stands for u_speed_scale's per-reference-frame step
  const distance = runFor(hz, 1).reduce((sum, s) => sum + perStepAtScale1 * s, 0);
  expect(distance).toBeCloseTo(60, 6);
});

test.each([30, 60, 120, 144])('trail brightness left after one second is the 60 Hz value at %i Hz', (hz) => {
  const fade = 0.965;
  const left = runFor(hz, 1).reduce((b, s) => b * perFrameFade(fade, s), 1);
  expect(left).toBeCloseTo(Math.pow(fade, 60), 9);
});

test.each([30, 60, 120, 144])('the chance a particle survives one second is the 60 Hz value at %i Hz', (hz) => {
  // mirrors the shader: drop when rand > pow(1 - dropRate, u_dt_scale)
  const dropRate = 0.002;
  const survive = runFor(hz, 1).reduce((p, s) => p * Math.pow(1 - dropRate, s), 1);
  expect(survive).toBeCloseTo(Math.pow(1 - dropRate, 60), 9);
});

test('a long pause (hidden tab) is clamped, never a flung field', () => {
  const e = {};
  frameTimeScale(e, 0);
  expect(frameTimeScale(e, 5000)).toBe(FRAME_SCALE_MAX);
  expect(frameTimeScale(e, 5000 + REFERENCE_FRAME_MS / 100)).toBe(FRAME_SCALE_MIN);
});

test('the advect shader draws its respawn over the elapsed frames, with an unset uniform meaning 1', () => {
  expect(ADVECT_FS).toMatch(/uniform float u_dt_scale;/);
  expect(ADVECT_FS).toContain('float drop = step(pow(1.0 - dropRate, u_dt_scale > 0.0 ? u_dt_scale : 1.0), rand(seed));');
});

test('the engine feeds all three per-frame processes the same elapsed-time scale', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
  expect(src).toMatch(/\* \(this\._dtScale = frameTimeScale\(this\)\)/);
  expect(src).toContain("'u_dt_scale'), this._dtScale || 1)");
  expect(src).toContain("'u_fade'), perFrameFade(this.fadeOpacity, this._dtScale || 1))");
});
