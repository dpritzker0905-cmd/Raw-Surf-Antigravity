/**
 * NEAR-CALM AIR (windCalmAir.js, DECISIONS D-030): in light and beach a streak in air that barely moves is laid at a lower LIGHT
 * LEVEL, so it is nearly still and nearly clear, as dark's is. ON BY DEFAULT; kill window.__RAW_DISABLE_WIND_CALM_AIR__.
 *
 * The owner, 2026-10-12 21:51Z: "The almost still wind needs to be almost still and almost transparent on beach and light modes, as
 * that is how it looks on dark mode. Make sure you're not overlooking that part."
 *
 * What this file holds: the numbers; that only `true` is the kill; that it stands down wherever what it was solved on is not drawn
 * (so every older kill and hold still draws its old picture) and that dark never reads it; that with nothing to dim the shader's
 * factor is EXACTLY 1 (the bytes before it); the easing at close zoom (the level never goes where the marks go out); and the
 * arithmetic. The shader's own statement is RUN here, cut out of DRAW_FS, not only pinned as text (text pins alone let mutants
 * through: the veil's review). The measurement is the bench's (scripts/wind-bench/anatomy-run.js on a 0.4 to 9 kn ramp, beside dark).
 */
import fs from 'fs';
import path from 'path';
import { DRAW_FS } from './WebGLWindShaders';
import { GLSL_LAND_FS } from './windLandMask';
import { WIND_CALM_AIR, windCalmAirOn, windCalmAir, calmZoomShare, bindCalmAir, calmAirFactor } from './windCalmAir';
import { windTrailVeil } from './windTrailVeil';
import { DARK_RULES_HOLDS } from './WindColorRamp';

const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
const KILL = '__RAW_DISABLE_WIND_CALM_AIR__', LEVER = '__RAW_WIND_CALM_LEVEL__';
const OWN = [0.26, 0.29, 2.5, 5.5];   // the dims (1 - 0.74 over land, 1 - 0.71 over sea) and the window of speeds, to zoom 6
/** The window a default sync leaves for `theme`: the land drawn a step above the sea (windBasemapMute.js read-back). */
const synced = (theme, more = {}) => ({ __WIND_BASEMAP_MUTE__: { applied: true, theme, landL: theme === 'beach' ? 0.94 : 0.9, landStep: true }, ...more });
const near = (got, want) => { expect(got).toHaveLength(want.length); want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 12)); };

describe('the numbers, the switch and the kill', () => {
  it('one kill, one lever, one calm level a ground (the same in light and in beach), one window of speeds, one easing by zoom', () => {
    expect(WIND_CALM_AIR).toEqual({ kill: KILL, lever: LEVER, themes: ['light', 'beach'], level: { land: 0.74, sea: 0.71 }, from: 2.5, full: 5.5, zoom: { from: 6, to: 10, keep: 0.6 } });
    for (const o of [WIND_CALM_AIR, WIND_CALM_AIR.themes, WIND_CALM_AIR.level, WIND_CALM_AIR.zoom]) expect(Object.isFrozen(o)).toBe(true);
    for (const g of ['land', 'sea']) { expect(WIND_CALM_AIR.level[g]).toBeGreaterThan(0.7); expect(WIND_CALM_AIR.level[g]).toBeLessThan(1); }   // dimmed, never erased: under about 0.67 the sea's marks go out (the log)
    expect(WIND_CALM_AIR.level.sea).toBeLessThan(WIND_CALM_AIR.level.land);                // the sea's ground is the deeper: a white mark shows more on it
  });
  it('ON by default in light and beach on the map as a sync leaves it; the uniform is [dim over land, dim over sea, from, full]', () => {
    for (const theme of ['light', 'beach']) { expect(windCalmAirOn(theme, synced(theme))).toBe(true); near(windCalmAir(theme, synced(theme)), OWN); near(windCalmAir(theme, synced(theme), 6), OWN); }
  });
  it('THE KILL: set to true it is off in both themes; anything else is not the kill', () => {
    for (const theme of ['light', 'beach']) {
      expect(windCalmAirOn(theme, synced(theme, { [KILL]: true }))).toBe(false);
      expect(windCalmAir(theme, synced(theme, { [KILL]: true }), 6)).toEqual([0, 0, 0, 1]);
      for (const not of [1, 'true', {}, false, null, undefined]) expect(windCalmAirOn(theme, synced(theme, { [KILL]: not }))).toBe(true);
    }
  });
  it('dark never reads it, whatever the window says', () => {
    for (const w of [{}, synced('dark'), synced('light'), synced('dark', { [LEVER]: [0.5, 0.5, 2, 5] }), null]) { expect(windCalmAirOn('dark', w)).toBe(false); expect(windCalmAir('dark', w, 6)).toEqual([0, 0, 0, 1]); }
    expect(windCalmAir('sepia', synced('sepia'), 6)).toEqual([0, 0, 0, 1]);
  });
  it('the real window is read when none is passed (the engine\'s own call)', () => {
    try {
      window.__WIND_BASEMAP_MUTE__ = synced('light').__WIND_BASEMAP_MUTE__;
      near(windCalmAir('light'), OWN);
      window[KILL] = true;
      expect(windCalmAir('light')).toEqual([0, 0, 0, 1]);
    } finally { delete window.__WIND_BASEMAP_MUTE__; delete window[KILL]; }
    expect(windCalmAir('light')).toEqual([0, 0, 0, 1]);   // no read-back: no sync has drawn the land yet
  });
});

describe('THE LEVEL EASES AT CLOSE ZOOM: it is never set where the marks would go out (the standing rule: no change takes the animation away)', () => {
  it('the dim is whole to zoom 6, eases by a tenth a zoom, and holds 0.6 of itself from zoom 10 in', () => {
    for (const [z, k] of [[2, 1], [4, 1], [6, 1], [7, 0.9], [8, 0.8], [9, 0.7], [10, 0.6], [12, 0.6], [22, 0.6]]) expect(calmZoomShare(z)).toBeCloseTo(k, 12);
    for (const none of [undefined, null, NaN, '8', Infinity]) expect(calmZoomShare(none)).toBe(1);   // no zoom given: the far-zoom level
  });
  it('so the level laid is 0.74 / 0.79 / 0.84 over land and 0.71 / 0.77 / 0.83 over sea at zooms 6 / 8 / 10, in both themes', () => {
    for (const theme of ['light', 'beach']) {
      near(windCalmAir(theme, synced(theme), 8), [0.208, 0.232, 2.5, 5.5]);
      near(windCalmAir(theme, synced(theme), 10), [0.156, 0.174, 2.5, 5.5]);
      near(windCalmAir(theme, synced(theme), 3), OWN);
      let last = 1;
      for (let z = 2; z <= 14; z += 0.25) { const u = windCalmAir(theme, synced(theme), z); expect(u[0]).toBeLessThanOrEqual(last); expect(u[0]).toBeGreaterThan(0.15); last = u[0]; }   // it only eases, and never to nothing
    }
  });
  it('the speeds\' window does not move with the zoom, and where it does not draw the zoom changes nothing', () => {
    for (const z of [2, 6, 8, 10, 14]) { expect(windCalmAir('light', synced('light'), z).slice(2)).toEqual([2.5, 5.5]); expect(windCalmAir('dark', synced('dark'), z)).toEqual([0, 0, 0, 1]); expect(windCalmAir('light', synced('light', { [KILL]: true }), z)).toEqual([0, 0, 0, 1]); }
  });
});

describe('IT STANDS DOWN wherever what it was solved on is not drawn: every older kill still draws its old picture', () => {
  it('no veil under the trails (its kill, its steer off, and everything the veil stands down for), no calm level', () => {
    const OLDER = ['__RAW_DISABLE_WIND_TRAIL_VEIL__', '__RAW_DISABLE_WIND_DARK_WHITE__', '__RAW_DISABLE_WIND_LAND_DEPTH__', '__RAW_DISABLE_WIND_OPAQUE_CANVAS__',
      '__RAW_DISABLE_WIND_WHITE_STREAK__', '__RAW_DISABLE_WIND_DARK_RULES__', ...DARK_RULES_HOLDS];
    expect(OLDER.length).toBeGreaterThan(12);
    for (const theme of ['light', 'beach']) {
      for (const k of OLDER) {
        const w = synced(theme, { [k]: true });
        expect(windTrailVeil(theme, w)).toBe(0);                                         // the control: each of these does stand the veil down
        expect(windCalmAir(theme, w, 6)).toEqual([0, 0, 0, 1]);
      }
      expect(windCalmAir(theme, synced(theme, { __RAW_WIND_TRAIL_VEIL__: false }), 6)).toEqual([0, 0, 0, 1]);
      near(windCalmAir(theme, synced(theme, { __RAW_WIND_TRAIL_VEIL__: 0.5 }), 6), OWN);   // a steered veil is still a veil
    }
  });
  it('a land the last sync did not draw a step above the sea, no calm level: read from the READ-BACK, never the flag (LESSONS L-V82)', () => {
    const r = (o) => ({ __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 0.9, landStep: true, ...o } });
    for (const w of [{}, r({ landStep: false }), r({ landStep: 1 }), r({ applied: false }), r({ theme: 'beach' }), r({ landL: 1 }), r({ landL: 0.81, landStep: false })]) expect(windCalmAir('light', w, 6)).toEqual([0, 0, 0, 1]);
    // The step's kill typed in the console has drawn nothing yet: the land is still the lighter one, and the calm level stays with it.
    near(windCalmAir('light', r({}), 6), OWN);
    near(windCalmAir('light', { ...r({}), __RAW_DISABLE_WIND_LAND_STEP__: true }, 6), OWN);
    // And once a sync has drawn the deeper land under that kill, it stands down.
    expect(windCalmAir('light', { ...r({ landL: 0.81, landStep: false }), __RAW_DISABLE_WIND_LAND_STEP__: true }, 6)).toEqual([0, 0, 0, 1]);
  });
});

describe('the lever: [land level, sea level, from kn, full kn], closed at both ends, laid as given at every zoom, and nothing where it does not draw', () => {
  it('a valid lever sets all four; an invalid one is not a lever', () => {
    near(windCalmAir('light', synced('light', { [LEVER]: [0.8, 0.6, 1, 4] }), 6), [0.2, 0.4, 1, 4]);
    near(windCalmAir('beach', synced('beach', { [LEVER]: [1, 0.2, 0, 15] }), 6), [0, 0.8, 0, 15]);
    for (const bad of [[0.8, 0.6, 1], [0.8, 0.6, 1, 4, 5], [0.19, 0.6, 1, 4], [0.8, 1.01, 1, 4], [0.8, 0.6, 4, 4], [0.8, 0.6, 5, 4], [0.8, 0.6, -1, 4], [0.8, 0.6, 1, 15.1], ['0.8', 0.6, 1, 4], [0.8, NaN, 1, 4], [0.8, 0.6, 1, Infinity], 0.7, null, 'x', {}]) {
      near(windCalmAir('light', synced('light', { [LEVER]: bad }), 6), OWN);
    }
  });
  it('the lever is a bench\'s: its numbers are laid as given at every zoom (no easing)', () => {
    for (const z of [2, 6, 8, 10, 14]) near(windCalmAir('light', synced('light', { [LEVER]: [0.8, 0.6, 1, 4] }), z), [0.2, 0.4, 1, 4]);
  });
  it('a lever does not bring it back under the kill, in dark, or where it stands down', () => {
    const lev = { [LEVER]: [0.5, 0.5, 2, 5] };
    expect(windCalmAir('light', synced('light', { ...lev, [KILL]: true }), 6)).toEqual([0, 0, 0, 1]);
    expect(windCalmAir('dark', synced('dark', lev), 6)).toEqual([0, 0, 0, 1]);
    expect(windCalmAir('light', lev, 6)).toEqual([0, 0, 0, 1]);
    expect(windCalmAir('light', synced('light', { ...lev, __RAW_DISABLE_WIND_TRAIL_VEIL__: true }), 6)).toEqual([0, 0, 0, 1]);
  });
});

describe('THE SHADER\'S OWN STATEMENT, cut out of DRAW_FS and run', () => {
  // gl_FragColor = vec4(rgb * alpha * (<white>) * (<calm>), alpha);
  const m = /gl_FragColor = vec4\(rgb \* alpha \* \((u_white\.y \+ \(u_white\.x - u_white\.y\) \* land)\) \* (\(1\.0 - .*\)), alpha\);/.exec(DRAW_FS);
  const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const calm = m && new Function('u_calm_air', 'land', 'v_speed', 'smoothstep', `return ${m[2]};`);   // eslint-disable-line no-new-func
  const run = (u, land, kn) => calm({ x: u[0], y: u[1], z: u[2], w: u[3] }, land, kn, smoothstep);
  it('the mark\'s last line multiplies its LIGHT by the white\'s level and the calm factor, and leaves its cover (alpha) alone', () => {
    expect(m).not.toBeNull();
    expect(m[2]).toBe('(1.0 - (u_calm_air.y + (u_calm_air.x - u_calm_air.y) * land) * (1.0 - smoothstep(u_calm_air.z, u_calm_air.w, v_speed)))');
    expect(DRAW_FS.match(/gl_FragColor = /g)).toHaveLength(2);                           // two ways out of the mark's shader: this line,
    expect(DRAW_FS).toContain('gl_FragColor = v_debug_color;');                          // and the debug colour (a bench's, never a served mark)
    expect(DRAW_FS.replace(/\/\/.*$/gm, '').match(/u_calm_air/g)).toHaveLength(6);       // comments apart: declared once (windLandMask.js's uniform line) and read in that one statement, nowhere else
    expect(GLSL_LAND_FS).toMatch(/uniform vec4 u_calm_air;/);
    expect(DRAW_FS).toContain(GLSL_LAND_FS);
  });
  it('with nothing to dim (dark, the kill, every stand-down) the factor is EXACTLY 1 at every speed over every ground: the bytes before it', () => {
    for (const kn of [0, 0.3, 0.99, 1, 2, 3.7, 5.5, 9, 30, 80]) for (const land of [0, 0.25, 0.5, 1]) {
      expect(run([0, 0, 0, 1], land, kn)).toBe(1);
      expect(calmAirFactor([0, 0, 0, 1], land, kn)).toBe(1);
    }
  });
  it('below `from` a mark is laid at the calm level of the ground under it; from `full` up at exactly the level it always had; between, it only rises', () => {
    for (const z of [6, 8, 10]) {
      const u = windCalmAir('light', synced('light'), z), land = 1 - u[0], sea = 1 - u[1];
      for (const kn of [0, 0.5, 1, 2, 2.5]) { expect(run(u, 1, kn)).toBeCloseTo(land, 12); expect(run(u, 0, kn)).toBeCloseTo(sea, 12); }
      for (const kn of [5.5, 6, 10, 30, 75]) for (const g of [0, 0.4, 1]) expect(run(u, g, kn)).toBe(1);   // above the window nothing moves, to the bit
      let last = -1;
      for (let kn = 0; kn <= 6; kn += 0.05) { const f = run(u, 1, kn); expect(f).toBeGreaterThanOrEqual(last); expect(f).toBeLessThanOrEqual(1); last = f; }
      expect(run(u, 1, 4)).toBeCloseTo(land + (1 - land) * 0.5, 12);                     // the smoothstep's midpoint is the middle of the window
      expect(run(u, 0.5, 1)).toBeCloseTo((land + sea) / 2, 12);                          // a coast texel half land: halfway between the two
    }
    expect(run(windCalmAir('beach', synced('beach'), 6), 1, 1)).toBeCloseTo(0.74, 12); expect(run(windCalmAir('beach', synced('beach'), 6), 0, 1)).toBeCloseTo(0.71, 12);
  });
  it('calmAirFactor is that statement in plain JS (the bench and the checker read it)', () => {
    const us = [windCalmAir('light', synced('light'), 6), windCalmAir('beach', synced('beach'), 9), [0.2, 0.4, 1, 4], [0, 0.8, 0, 15], [0, 0, 0, 1]];
    for (const u of us) for (let kn = 0; kn <= 16; kn += 0.37) for (const land of [0, 0.3, 1]) expect(calmAirFactor(u, land, kn)).toBeCloseTo(run(u, land, kn), 12);
  });
});

describe('the engine sets it every frame, on the draw program, beside the land mask\'s bind', () => {
  it('the engine\'s frame calls bindCalmAir with the theme it is drawing and the zoom it is drawing at', () => {
    expect(ENGINE).toContain("import { bindLandMask } from './windLandMask'; import { bindCalmAir } from './windCalmAir';");
    expect(ENGINE).toContain('windWhiteStrength(effectiveTheme), effectiveTheme); bindCalmAir(gl, this.drawProgram, effectiveTheme, z);');
    expect(ENGINE.match(/bindCalmAir\(/g)).toHaveLength(1);
    expect(ENGINE).toContain("gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z);");   // the same `z` the draw pass's own zoom rules read
  });
  const fakeGl = () => { const gl = { sent: [], getUniformLocation: (prog, name) => `${prog}:${name}`, uniform4f: (loc, ...v) => gl.sent.push([loc, ...v]) }; return gl; };
  it('bindCalmAir sends the four numbers to u_calm_air at the zoom given, and [0, 0, 0, 1] where it does not draw', () => {
    const gl = fakeGl();
    bindCalmAir(gl, 'draw', 'beach', 6, synced('beach'));
    expect(gl.sent[0][0]).toBe('draw:u_calm_air'); near(gl.sent[0].slice(1), OWN);
    bindCalmAir(gl, 'draw', 'beach', 8, synced('beach'));
    near(gl.sent[1].slice(1), [0.208, 0.232, 2.5, 5.5]);
    bindCalmAir(gl, 'draw', 'dark', 6, synced('dark'));
    expect(gl.sent[2]).toEqual(['draw:u_calm_air', 0, 0, 0, 1]);
    bindCalmAir(gl, 'draw', 'beach', 6, synced('beach', { [KILL]: true }));
    expect(gl.sent[3]).toEqual(['draw:u_calm_air', 0, 0, 0, 1]);
    expect(() => bindCalmAir(null, 'draw', 'light', 6)).not.toThrow(); expect(() => bindCalmAir(gl, null, 'light', 6)).not.toThrow();
    expect(gl.sent).toHaveLength(4);
  });
  it('the read-back says the levels as laid to zoom 6, when they change: not per frame, and not per step of a zoom gesture', () => {
    const gl = fakeGl(), w = synced('light');
    bindCalmAir(gl, 'draw', 'light', 6, w);
    expect(w.__WIND_CALM_AIR__).toMatchObject({ on: true, theme: 'light', land: 0.74, sea: 0.71, from: 2.5, full: 5.5 });
    const first = w.__WIND_CALM_AIR__;
    for (const z of [6, 6.2, 7, 8.5, 10, 12, 6]) bindCalmAir(gl, 'draw', 'light', z, w);
    expect(w.__WIND_CALM_AIR__).toBe(first);                                             // the same object: nothing was written on those frames
    w[KILL] = true; bindCalmAir(gl, 'draw', 'light', 6, w);
    expect(w.__WIND_CALM_AIR__).toMatchObject({ on: false, theme: 'light', land: 1, sea: 1 });
    expect(w.__WIND_CALM_AIR__).not.toBe(first);
    expect(gl.sent).toHaveLength(9);                                                     // the uniform itself IS sent every frame
  });
});
