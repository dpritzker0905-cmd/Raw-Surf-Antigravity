/**
 * CALM WASH HOLD: BLEND BOTH's regional height alpha for dark only (an owner A/B candidate).
 *
 * PR #425 measured the light/beach wash under BLEND BOTH: a 0.5 m sea drawn at alpha 0.34 at z 10 (zoom opacity 0.77),
 * because the regional pass fades below 1.4 m onto a coarse base that light/beach damp to 35% above z 9.5. The candidate
 * keeps light/beach calm regional cells at the zoom opacity. These tests pin the three promises the PR makes:
 *   1. dark is byte-identical (the uniform is exactly today's in every state, kill or not);
 *   2. the kill restores today's uniform in every theme;
 *   3. only the honest height wash in light/beach changes (rating-band frames keep the fade).
 */
import fs from 'fs';
import path from 'path';
import { blendHeightAlpha, CALM_WASH_HOLD_KILL } from './marineCalmWashHold';

const today = (blendEngaged) => (blendEngaged ? 1.0 : 0.0);   // dev 448deb35c: blendEngaged ? 1.0 : 0.0
const THEMES = { dark: 0.0, light: 1.0, beach: 2.0 };
const STATES = [];
for (const [theme, themeVal] of Object.entries(THEMES)) {
  for (const blend of [false, true]) for (const surf of [0.0, 1.0]) STATES.push({ theme, themeVal, blend, surf });
}

describe('blendHeightAlpha: the regional pass u_heightAlphaEnabled', () => {
  it('dark is today in every state, with or without the kill', () => {
    for (const s of STATES.filter((x) => x.theme === 'dark')) {
      expect(blendHeightAlpha(s.blend, s.themeVal, s.surf, {})).toBe(today(s.blend));
      expect(blendHeightAlpha(s.blend, s.themeVal, s.surf, { [CALM_WASH_HOLD_KILL]: true })).toBe(today(s.blend));
    }
  });

  it('the kill returns today\'s uniform in every theme and state', () => {
    for (const s of STATES) {
      expect(blendHeightAlpha(s.blend, s.themeVal, s.surf, { [CALM_WASH_HOLD_KILL]: true })).toBe(today(s.blend));
    }
  });

  it('light and beach: the honest wash holds calm cells at the zoom opacity (fade off) while the blend engages', () => {
    for (const themeVal of [THEMES.light, THEMES.beach]) {
      expect(blendHeightAlpha(true, themeVal, 0.0, {})).toBe(0.0);    // the candidate: no height fade
      expect(blendHeightAlpha(false, themeVal, 0.0, {})).toBe(0.0);   // no blend: off, as today
    }
  });

  it('rating-band frames keep today\'s fade in every theme (their height channel is a score)', () => {
    for (const themeVal of Object.values(THEMES)) {
      expect(blendHeightAlpha(true, themeVal, 1.0, {})).toBe(1.0);
      expect(blendHeightAlpha(false, themeVal, 1.0, {})).toBe(0.0);
    }
  });

  it('only a strict true kills (a truthy string or 1 does not)', () => {
    expect(blendHeightAlpha(true, THEMES.light, 0.0, { [CALM_WASH_HOLD_KILL]: 'true' })).toBe(0.0);
    expect(blendHeightAlpha(true, THEMES.light, 0.0, { [CALM_WASH_HOLD_KILL]: 1 })).toBe(0.0);
  });

  it('the diff from today is exactly the light/beach honest blend frames', () => {
    const changed = STATES.filter((s) => blendHeightAlpha(s.blend, s.themeVal, s.surf, {}) !== today(s.blend))
      .map((s) => s.theme).sort();
    expect(changed).toEqual(['beach', 'light']);
    expect(STATES.filter((s) => s.blend && s.surf === 0.0 && s.theme !== 'dark').length).toBe(2);
  });
});

describe('telemetry', () => {
  it('never creates window.__RAW_GPU__ (the engine builds it only when absent; a bare {} breaks its render)', () => {
    const w = {};
    blendHeightAlpha(true, THEMES.light, 0.0, w);
    expect(w.__RAW_GPU__).toBeUndefined();
  });

  it('reports on/held when the engine has built __RAW_GPU__', () => {
    const w = { __RAW_GPU__: { frameTimeHistogram: [] } };
    blendHeightAlpha(true, THEMES.beach, 0.0, w);
    expect(w.__RAW_GPU__.calmWashHold).toEqual({ on: true, held: true });
    blendHeightAlpha(true, THEMES.dark, 0.0, w);
    expect(w.__RAW_GPU__.calmWashHold).toEqual({ on: true, held: false });
    w[CALM_WASH_HOLD_KILL] = true;
    blendHeightAlpha(true, THEMES.beach, 0.0, w);
    expect(w.__RAW_GPU__.calmWashHold).toEqual({ on: false, held: false });
    expect(w.__RAW_GPU__.frameTimeHistogram).toEqual([]);
  });
});

describe('engine wiring (source pins)', () => {
  const engine = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
  const shaders = fs.readFileSync(path.join(__dirname, 'WebGLMarineShaders.js'), 'utf8');
  const sets = engine.split('\n').filter((l) => l.includes("'u_heightAlphaEnabled'"));

  it('the regional pass takes its height alpha from blendHeightAlpha with the frame\'s theme and surf mode', () => {
    expect(engine).toContain("import { blendHeightAlpha } from './marineCalmWashHold'");
    expect(sets.filter((l) => l.includes('blendHeightAlpha(blendEngaged, themeVal, surfModeVal)')).length).toBe(1);
  });

  it('the coarse base pass still draws with the height alpha off, and no other site sets it', () => {
    expect(sets.length).toBe(2);
    expect(sets.filter((l) => /'u_heightAlphaEnabled'\), 0\.0\);/.test(l)).length).toBe(1);
  });

  it('the shader fade itself is unchanged: smoothstep(lo, hi, displayHeight) when enabled', () => {
    expect(shaders).toContain('if (u_heightAlphaEnabled > 0.5) {\n    alpha *= smoothstep(u_heightAlphaLo, u_heightAlphaHi, displayHeight);');
  });
});
