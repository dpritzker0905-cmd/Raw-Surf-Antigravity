/**
 * WIND MOTION FLOOR (2026-10-08). User: "for winds in the hurricane in the gulf, the animations for
 * winds around 44kts or higher, the speed of the animations is that of slow wind, where it almost
 * looks like it isn't moving at all and in the shape of a diamond."
 *
 * ROOT CAUSE. ADVECT_FS respawns a particle with dropRate = u_drop_rate + speed * u_drop_rate_bump,
 * `speed` in KNOTS. The v3.8 port (0105a9d7) took webgl-wind's defaults (0.003 / 0.01), but upstream
 * multiplies the bump by speed NORMALISED to [0, 1]; this shader multiplies raw knots. At 47 kn the
 * drop chance is 0.378 a frame — a mean life of 2.6 frames (44 ms), too short for motion to be seen —
 * and the distance a particle travels before it dies is ~6-9 css px at EVERY speed above ~5 kn, so a
 * hurricane streak is barely longer than a breeze's. The owner's recording shows exactly that: 1-3
 * isolated ring stamps that reshuffle every 0.1 s in the hurricane band, against 5-10-stamp gliding
 * streaks in the slower air of the same frame.
 *
 * FIX. A lifetime floor: no particle's per-frame drop chance exceeds 1 / minLifeFrames (default 6 =
 * 100 ms at 60 Hz, about the shortest exposure at which speed reads). It engages above ~20.6 kn
 * only, so every value at and below that is bit-identical; above it the life is constant and the
 * streak grows linearly with speed. Lever: window.__RAW_WIND_MIN_LIFE_FRAMES__ (2..60).
 * Kill: window.__RAW_DISABLE_WIND_MOTION_FLOOR__ = true (cap 1.0 = the uncapped rule).
 */
import fs from 'fs';
import path from 'path';
import { ADVECT_FS } from './WebGLWindShaders';
import { resolveWindMotionFloor } from './WebGLWindUtils';

const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const DROP = 0.002, BUMP = 0.008, I0 = 130;          // engine defaults; I0 = inkFlatDrop's divisor
const legacyDrop = (s) => DROP + s * BUMP;
// Mirror of ADVECT_FS's mark size, ink budget and calm floor (same mirror as windParticleDensity.test.js).
const sizeCss = (s) => Math.max(s < 0.5 ? 0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, s),
  (s >= 1.0 && s < 10.0) ? 3.073 : ((s >= 0.3 && s < 1.0) ? 2.2 : 0));
const elong = (s) => smoothstep(10.0, 0.5, s) * (2.6 - 1.8) + 1.8;
const uncappedDrop = (s) => {
  let d = Math.max(legacyDrop(s), (sizeCss(s) ** 2) / elong(s) / I0);
  if (s < 4.75) d = Math.max(legacyDrop(s), Math.min(d, 0.04));
  return Math.max(d, 0.002);
};
const cappedDrop = (cap) => (s) => Math.min(uncappedDrop(s), cap);
// Engine step: speedFactor 0.55 * 0.5^z * 0.00025 Mercator units per kn per frame; the world is
// 512 * 2^z css px wide, so the on-screen step is zoom-invariant.
const PX_PER_KN = 0.55 * 0.00025 * 512;
const streakPx = (drop) => (s) => PX_PER_KN * s / drop(s);   // travel over one mean life
const SPEEDS = Array.from({ length: 261 }, (_, i) => i * 0.5);  // 0..130 kn
// Real GFS speeds from windParticleDensity.test.js plus tropical-storm..major-hurricane speeds.
const REAL = [0.28, 2, 3.85, 6.52, 11.08, 16.87, 22.71, 38.79];
const HURRICANE = [34, 44, 47, 64, 83, 100];

const withWindow = (props, fn) => {
  const saved = {};
  for (const k of Object.keys(props)) { saved[k] = window[k]; window[k] = props[k]; }
  try { return fn(); } finally { for (const k of Object.keys(props)) { if (saved[k] === undefined) delete window[k]; else window[k] = saved[k]; } }
};

describe('wind motion floor — resolver', () => {
  it('defaults to a 6-frame (100 ms) floor', () => {
    const { minLifeFrames, dropCap } = resolveWindMotionFloor({});
    expect(minLifeFrames).toBe(6);
    expect(dropCap).toBeCloseTo(1 / 6, 12);
  });

  it('honours the lever, clamped to 2..60 frames, and ignores junk', () => {
    expect(resolveWindMotionFloor({ __RAW_WIND_MIN_LIFE_FRAMES__: 8 }).dropCap).toBeCloseTo(0.125, 12);
    expect(resolveWindMotionFloor({ __RAW_WIND_MIN_LIFE_FRAMES__: 0.5 }).minLifeFrames).toBe(2);
    expect(resolveWindMotionFloor({ __RAW_WIND_MIN_LIFE_FRAMES__: 500 }).minLifeFrames).toBe(60);
    expect(resolveWindMotionFloor({ __RAW_WIND_MIN_LIFE_FRAMES__: NaN }).minLifeFrames).toBe(6);
    expect(resolveWindMotionFloor({ __RAW_WIND_MIN_LIFE_FRAMES__: '9' }).minLifeFrames).toBe(6);
  });

  it('the kill switch restores the uncapped rule (cap 1.0)', () => {
    expect(resolveWindMotionFloor({ __RAW_DISABLE_WIND_MOTION_FLOOR__: true }).dropCap).toBe(1);
  });

  it('reads the live window when none is passed', () => {
    withWindow({ __RAW_WIND_MIN_LIFE_FRAMES__: 10 }, () => {
      expect(resolveWindMotionFloor().dropCap).toBeCloseTo(0.1, 12);
    });
  });
});

describe('wind motion floor — what the eye gets', () => {
  const shipped = uncappedDrop;
  const fixed = cappedDrop(resolveWindMotionFloor({}).dropCap);

  it('POSITIVE CONTROL: the uncapped rule reproduces the report (hurricane life < 3 frames)', () => {
    expect(1 / shipped(44)).toBeLessThan(3);
    expect(1 / shipped(47)).toBeLessThan(3);
    // and a 47 kn streak is barely longer than a 10 kn one — "the speed of slow wind"
    expect(streakPx(shipped)(47) / streakPx(shipped)(10)).toBeLessThan(1.35);
  });

  it('every particle lives at least the floor, at every speed up to 130 kn', () => {
    for (const s of SPEEDS) expect(1 / fixed(s)).toBeGreaterThanOrEqual(6 - 1e-9);
  });

  it('is bit-identical at and below 20 kn — the tuned light/moderate regime is untouched', () => {
    for (const s of SPEEDS.filter((x) => x <= 20)) expect(fixed(s)).toBe(shipped(s));
  });

  it('faster wind draws a longer streak: strictly increasing above the knee, 47 kn >= 2x 10 kn', () => {
    const above = SPEEDS.filter((x) => x >= 21);
    for (let i = 1; i < above.length; i++) {
      expect(streakPx(fixed)(above[i])).toBeGreaterThan(streakPx(fixed)(above[i - 1]));
    }
    // 2.31x in this gamma-free mirror (19.9 vs 8.6 css px); the uncapped rule gives 1.27x
    expect(streakPx(fixed)(47) / streakPx(fixed)(10)).toBeGreaterThanOrEqual(2.0);
  });

  it('keeps the density gate: ink ratio < 3.0 across real AND hurricane speeds (uncapped: ~7.5x)', () => {
    const ink = (drop) => (s) => (sizeCss(s) ** 2) / elong(s) / drop(s);
    const ratio = (drop) => {
      const v = [...REAL, ...HURRICANE].map(ink(drop)).filter((x) => x > 0);
      return Math.max(...v) / Math.min(...v);
    };
    expect(ratio(shipped)).toBeGreaterThan(3.0);
    expect(ratio(fixed)).toBeLessThan(3.0);
  });

  it('keeps the drop chance a probability (<= 1) even past 125 kn, kill path included', () => {
    // 1 - dropRate < 0 made the shader's pow(1 - dropRate, u_dt_scale) undefined above 124.75 kn.
    const killed = cappedDrop(resolveWindMotionFloor({ __RAW_DISABLE_WIND_MOTION_FLOOR__: true }).dropCap);
    for (const s of [125, 150, 200]) {
      expect(fixed(s)).toBeLessThanOrEqual(1);
      expect(killed(s)).toBeLessThanOrEqual(1);
    }
  });
});

describe('wind motion floor — wiring', () => {
  it('the advect shader caps the final drop rate (after the vortex lever, before the drop test)', () => {
    expect(ADVECT_FS).toMatch(/uniform float u_drop_cap;/);
    const vortex = ADVECT_FS.indexOf('dropRate = max(dropRate * mix(1.0, 0.35, vortexGate), 0.002);');
    const cap = ADVECT_FS.indexOf('dropRate = min(dropRate, u_drop_cap > 0.0 ? u_drop_cap : 1.0);');
    const dropTest = ADVECT_FS.indexOf('float drop = step(pow(1.0 - dropRate');
    expect(vortex).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(vortex);
    expect(dropTest).toBeGreaterThan(cap);
  });

  it('the engine binds the resolved cap to the advect program every frame', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(src).toContain("'u_drop_cap'), resolveWindMotionFloor(typeof window !== 'undefined' ? window : null).dropCap)");
  });
});
