// 2026-11-12 (layer animation lane): one-way crests. The orbital pitch default is 0, so no marine dash moves against its swell;
// the kill restores the 2.5 px sway; reduced motion damps the wave-train band with the drift. Built on the diagnosis in
// marineMotionDirection.test.js (section 4 characterises the sway this default removes).
import fs from 'fs';
import path from 'path';
import { NATURAL_ANIM_DEFAULTS, resolveAnimValue } from './marineEngineDecisions';
import { ORBITAL_SWAY_PX, REDUCED_MOTION_SCALE, resolveOrbitalPitch, oneWayCrestsOn, bandMotionScale, prefersReducedMotion,
  reducedMotionBandOn, _resetOneWayCrestsForTest } from './oneWayCrests';
import { createCrestPhaseState, stepCrestPhase } from './crestLocalPhase';
import { DRAW_VS } from './WebGLMarineParticleShaders';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const KEYS = ['__RAW_ORBITAL_PITCH__', '__RAW_ANIM_LEGACY__', '__RAW_DISABLE_ONE_WAY_CRESTS__', '__RAW_DISABLE_REDUCED_MOTION_BAND__', '__RAW_REDUCED_MOTION__'];
const realMatchMedia = window.matchMedia;
afterEach(() => { for (const k of KEYS) delete window[k]; window.matchMedia = realMatchMedia; _resetOneWayCrestsForTest(); });

/** Share of the band cycle in which a dash's along-swell velocity (drift + sway) is negative. */
const backwardShare = (driftPxS, swayPeakPxS) => {
  let back = 0; const N = 1000;
  for (let i = 0; i < N; i++) if (driftPxS - swayPeakPxS * Math.cos(2 * Math.PI * (i / N)) < 0) back++;
  return back / N;
};
// drift and (2.5 px) sway peak in CSS px/s at the diagnosis table's rows (marineMotionDirection.test.js, MOTION_TABLE=1)
const ROWS = [{ z: 3, drift: 0.027, sway: 0.74 }, { z: 6, drift: 0.352, sway: 1.22 }, { z: 9, drift: 0.377, sway: 1.31 }];

describe('the default: no sway, so no dash moves against its swell', () => {
  test('the baked default and the engine resolution are 0', () => {
    expect(NATURAL_ANIM_DEFAULTS.__RAW_ORBITAL_PITCH__).toBe(0);
    expect(oneWayCrestsOn()).toBe(true);
    expect(resolveOrbitalPitch()).toBe(0);
  });

  test('at pitch 0 the shader skips the sway (the text is unchanged: the branch is gated on the uniform)', () => {
    expect(DRAW_VS).toContain('if (u_orbitalPitch > 0.0001) {');
    expect(DRAW_VS).toContain('pixel0 += waveDir * sin(orbPhase) * u_orbitalPitch * dpr;');
  });

  test.each(ROWS)('z $z: the backward share of the cycle is 0 (it was 0.41-0.49 with the sway)', ({ drift, sway }) => {
    const scale = resolveOrbitalPitch() / ORBITAL_SWAY_PX;        // the sway speed is linear in the pitch
    expect(backwardShare(drift, sway * scale)).toBe(0);
    expect(backwardShare(drift, sway)).toBeGreaterThan(0.35);     // positive control: the old default did run backwards
  });

  test('the engine reads the pitch through this module', () => {
    const src = read('WebGLMarineEngine.js');
    expect(src).toContain('const _orbitalPitch = resolveOrbitalPitch();');
    expect(src).not.toContain("resolveAnimValue('__RAW_ORBITAL_PITCH__')");
  });
});

describe('kill switch: window.__RAW_DISABLE_ONE_WAY_CRESTS__ restores the old resolution order', () => {
  test('killed: the 2.5 px Natural sway', () => {
    window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true;
    expect(oneWayCrestsOn()).toBe(false);
    expect(resolveOrbitalPitch()).toBe(ORBITAL_SWAY_PX);
    expect(ORBITAL_SWAY_PX).toBe(2.5);
  });

  test('an explicit number wins either way (the tuner slider, the console), 0 included', () => {
    window.__RAW_ORBITAL_PITCH__ = 1.25;
    expect(resolveOrbitalPitch()).toBe(1.25);
    window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true;
    expect(resolveOrbitalPitch()).toBe(1.25);
    window.__RAW_ORBITAL_PITCH__ = 0;
    expect(resolveOrbitalPitch()).toBe(0);
  });

  test('the legacy flat look still reads 0, killed or not', () => {
    window.__RAW_ANIM_LEGACY__ = true;
    expect(resolveOrbitalPitch()).toBe(0);
    window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true;
    expect(resolveOrbitalPitch()).toBe(0);
  });

  test('the other Natural values are untouched by either switch', () => {
    window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true;
    expect([resolveAnimValue('__RAW_TROCHOIDAL__'), resolveAnimValue('__RAW_SHOAL_FOAM__'), resolveAnimValue('__RAW_CREST_DIR_JITTER__')]).toEqual([0.7, 1.5, 0.26]);
  });
});

describe('reduced motion damps the wave-train band with the drift', () => {
  const mm = (matches) => { window.matchMedia = jest.fn(() => ({ matches })); _resetOneWayCrestsForTest(); };

  test('no preference: the band keeps the engine motion scale', () => {
    mm(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(bandMotionScale(0.8)).toBe(0.8);
  });

  test('prefers-reduced-motion: the band steps at 0.15x, the drift factor', () => {
    mm(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(REDUCED_MOTION_SCALE).toBe(0.15);
    expect(bandMotionScale(0.8)).toBeCloseTo(0.12, 12);
    expect(read('WebGLMarineEngine.js')).toContain('const _rmScale = _reducedMotion ? 0.15 : 1.0;');   // the drift's factor, same value
  });

  test('the override the drift damp reads wins over the media query, both ways', () => {
    mm(true); window.__RAW_REDUCED_MOTION__ = false;
    expect(bandMotionScale(1)).toBe(1);
    mm(false); window.__RAW_REDUCED_MOTION__ = true;
    expect(bandMotionScale(1)).toBe(REDUCED_MOTION_SCALE);
  });

  test('the setting is read live: one MediaQueryList, its .matches followed', () => {
    const list = { matches: false };
    window.matchMedia = jest.fn(() => list); _resetOneWayCrestsForTest();
    expect(bandMotionScale(1)).toBe(1);
    list.matches = true;
    expect(bandMotionScale(1)).toBe(REDUCED_MOTION_SCALE);
    expect(window.matchMedia).toHaveBeenCalledTimes(1);
  });

  test('the band phase really advances 0.15x as far (crestLocalPhase.stepCrestPhase, 8 frames at 60 fps)', () => {
    window.__RAW_REDUCED_MOTION__ = true;
    const run = (scale) => {
      const s = createCrestPhaseState();
      for (let i = 0; i <= 8; i++) stepCrestPhase(s, i / 60, scale, [0.5, 0.5]);
      return s.theta[0];
    };
    const full = run(1), damped = run(bandMotionScale(1));
    expect(full).toBeGreaterThan(0);
    expect(damped / full).toBeCloseTo(REDUCED_MOTION_SCALE, 9);
  });

  test('kill: window.__RAW_DISABLE_REDUCED_MOTION_BAND__ leaves the band at full speed, as before', () => {
    mm(true); window.__RAW_DISABLE_REDUCED_MOTION_BAND__ = true;
    expect(reducedMotionBandOn()).toBe(false);
    expect(bandMotionScale(0.8)).toBe(0.8);
  });

  test('the engine passes the damped scale to the band only', () => {
    expect(read('WebGLMarineEngine.js')).toContain('motionScale: bandMotionScale(motionScale)');
  });
});

describe('the dev tuner cannot put the old sway back', () => {
  const tuner = read('MarineAnimTuner.js');
  test('its default and Natural preset are 0, and a stored 2.5 is dropped once', () => {
    expect(tuner).toMatch(/key: '__RAW_ORBITAL_PITCH__'[^\n]*def: 0,/);
    expect(tuner).toMatch(/PRESET_NATURAL = \{[^}]*__RAW_ORBITAL_PITCH__: 0,/);
    expect(tuner).toContain("saved['__RAW_ORBITAL_PITCH__'] === 2.5 && saved.__oneWayCrestsMigrated !== 1");
    expect(tuner).toContain('base.__oneWayCrestsMigrated = 1;');
  });
});
