/**
 * The wind leaves the map's canvas opaque (windCanvasAlpha.js, D-027).
 *
 * Found 2026-10-12: two of the wind's passes lowered the alpha of the map's own canvas, and the browser fills what a premultiplied
 * canvas leaves with the page behind it. MapPage.js lays that page black in dark and beach and near white in light, so light alone
 * showed the page's white through every streak, and the wind bench (which reads the canvas over black) had never drawn that picture.
 * This file pins the blend, the law, the two facts the finding rests on (the page's colours, the bench's own copy of them) and the
 * engine's use of the helper.
 */
import fs from 'fs';
import path from 'path';
import { WIND_OPAQUE_CANVAS_KILL, windKeepsCanvasOpaque, blendIntoMap, canvasAlphaAfter, shownOverPage } from './windCanvasAlpha';

const MAP = __dirname, FRONTEND = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const fakeGl = () => ({ ZERO: 0, ONE: 1, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, blendFunc: jest.fn(), blendFuncSeparate: jest.fn() });

describe('the switch', () => {
  it('is on by default, with no window at all, and off only under its own kill set to true', () => {
    expect(WIND_OPAQUE_CANVAS_KILL).toBe('__RAW_DISABLE_WIND_OPAQUE_CANVAS__');
    expect(windKeepsCanvasOpaque({})).toBe(true);
    expect(windKeepsCanvasOpaque(null)).toBe(true);
    expect(windKeepsCanvasOpaque({ __RAW_DISABLE_WIND_OPAQUE_CANVAS__: true })).toBe(false);
    for (const v of ['true', 1, 'yes', false, undefined]) expect(windKeepsCanvasOpaque({ __RAW_DISABLE_WIND_OPAQUE_CANVAS__: v })).toBe(true);
  });
  it('reads the real window when none is handed in (the engine\'s own call passes none)', () => {
    try {
      window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__ = true;
      expect(windKeepsCanvasOpaque()).toBe(false);
      const gl = fakeGl(); blendIntoMap(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      expect(gl.blendFunc).toHaveBeenCalledWith(770, 771); expect(gl.blendFuncSeparate).not.toHaveBeenCalled();
    } finally { delete window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__; }
    expect(windKeepsCanvasOpaque()).toBe(true);
  });
});

describe('the blend of a pass drawn into the map\'s own framebuffer', () => {
  it('by default blends the colour by the factors asked for and leaves the canvas\'s alpha as the map drew it', () => {
    const gl = fakeGl();
    blendIntoMap(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, {});
    expect(gl.blendFuncSeparate).toHaveBeenCalledTimes(1);
    expect(gl.blendFuncSeparate).toHaveBeenCalledWith(770, 771, 0, 1);   // alpha: source x ZERO + destination x ONE
    expect(gl.blendFunc).not.toHaveBeenCalled();
  });
  it('under the kill is the blend dev drew with, call for call', () => {
    const gl = fakeGl(), w = { __RAW_DISABLE_WIND_OPAQUE_CANVAS__: true };
    blendIntoMap(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, w); blendIntoMap(gl, gl.ONE, gl.ONE_MINUS_SRC_ALPHA, w);
    expect(gl.blendFunc.mock.calls).toEqual([[770, 771], [1, 771]]);
    expect(gl.blendFuncSeparate).not.toHaveBeenCalled();
  });
});

describe('the law: what a pass leaves in the canvas\'s alpha, and what the screen then shows', () => {
  it('SRC_ALPHA / ONE_MINUS_SRC_ALPHA over an opaque map leaves 1 - a + a x a: three quarters at a = 0.5, and never 1 between 0 and 1', () => {
    expect(canvasAlphaAfter(0.5, false)).toBeCloseTo(0.75, 10);
    expect(canvasAlphaAfter(0.25, false)).toBeCloseTo(0.8125, 10);
    for (const a of [0.05, 0.2, 0.48, 0.8, 0.95]) expect(canvasAlphaAfter(a, false)).toBeLessThan(1);
    expect(canvasAlphaAfter(0, false)).toBe(1); expect(canvasAlphaAfter(1, false)).toBe(1);
  });
  it('kept, the canvas stays at 1 whatever the pass\'s alpha', () => {
    for (const a of [0, 0.05, 0.5, 0.95, 1]) expect(canvasAlphaAfter(a, true)).toBe(1);
  });
  it('over a BLACK page the screen shows the colour as drawn at any alpha: dark and beach do not change', () => {
    const rgb = [0.21, 0.45, 0.42];
    for (const a of [0.61, 0.75, 0.87, 1]) expect(shownOverPage(rgb, a, [0, 0, 0])).toEqual(rgb);
  });
  it('over light\'s page a canvas at 0.75 shows a quarter of the page: the white the streaks carried', () => {
    const page = [249 / 255, 250 / 255, 251 / 255], rgb = [0.23, 0.49, 0.44];
    const leaked = shownOverPage(rgb, 0.75, page), kept = shownOverPage(rgb, 1, page);
    expect(kept).toEqual(rgb);
    leaked.forEach((c, i) => expect(c - rgb[i]).toBeCloseTo(0.25 * page[i], 10));
    expect(leaked[0] - rgb[0]).toBeGreaterThan(0.24);
  });
});

describe('the facts the finding rests on', () => {
  it('MapPage.js lays the page behind the map near white in light and black in dark AND beach', () => {
    const page = read(FRONTEND, 'src', 'components', 'MapPage.js');
    expect(page).toContain('const isLight = theme === \'light\';');
    expect(page).toContain('${isLight ? \'bg-gray-50\' : \'bg-black\'} z-[50]');
    expect(page).toMatch(/<div className="absolute inset-0 z-0" data-testid="map-container">\s*<MapWebGL/);   // nothing with a colour of its own between that page and the map
  });
  it('the wind bench carries the same page colours, and every frame it saves is laid over the page first', () => {
    const entry = read(FRONTEND, 'scripts', 'wind-bench', 'page', 'map-entry.js');
    expect(entry).toContain('const APP_PAGE = { light: \'#f9fafb\', dark: \'#000000\', beach: \'#000000\' };');   // Tailwind gray-50 is #f9fafb
    for (const fn of ['thumb', 'cropShot', 'smallShot']) {
      const body = entry.slice(entry.indexOf(`function ${fn}(`)); const end = body.indexOf('\n}\n');
      expect(body.slice(0, end)).toContain('pageCanvas(');
      expect(body.slice(0, end)).not.toContain('document.createElement(\'canvas\')');
    }
    const pc = entry.slice(entry.indexOf('function pageCanvas('));
    expect(pc.slice(0, pc.indexOf('\n}\n'))).toMatch(/fillRect\(0, 0, w, h\)/);
  });
});

describe('the engine draws into the map through the helper', () => {
  const engine = read(MAP, 'WebGLWindEngine.js');
  it('imports it, and both passes bound to the map\'s framebuffer set their blend with it', () => {
    expect(engine).toContain('import { blendIntoMap } from \'./windCanvasAlpha\';');
    expect(engine.match(/blendIntoMap\(gl, /g)).toHaveLength(2);
    expect(engine).toContain('else blendIntoMap(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // field tint: multiply');
    expect(engine).toContain('blendIntoMap(gl, _premul ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(gl.getUniformLocation(this.screenProgram, \'u_premul\')');
    for (const call of engine.split('blendIntoMap(gl, ').slice(0, 2)) expect(call.lastIndexOf('gl.bindFramebuffer(gl.FRAMEBUFFER, webglState.prevFBO);')).toBeGreaterThan(call.lastIndexOf('gl.bindFramebuffer(gl.FRAMEBUFFER, this.'));
  });
  it('no pass is left that blends the map\'s alpha by the colour\'s factors', () => {
    expect(engine).not.toContain('gl.blendFunc(gl.SRC_ALPHA');
    expect(engine).not.toContain('gl.blendFunc(_premul');
    // what remains: the trail buffer's own pass (not the map), and the multiply paths, which already kept the alpha
    expect(engine.match(/gl\.blendFunc\(/g)).toHaveLength(1);
    expect(engine).toContain('gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);');
    expect(engine.match(/gl\.blendFuncSeparate\(gl\.DST_COLOR, gl\.ZERO, gl\.ZERO, gl\.ONE\)/g)).toHaveLength(2);
  });
  it('the engine file did not grow (it is over the line ratchet\'s limit)', () => {
    expect(engine.split('\n').length).toBeLessThanOrEqual(1075);
  });
});
