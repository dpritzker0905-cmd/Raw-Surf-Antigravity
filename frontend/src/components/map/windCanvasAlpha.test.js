/**
 * The wind leaves the map canvas's alpha as the map drew it (windCanvasAlpha.js, D-027).
 *
 * Found 2026-10-12: two of the wind's passes lowered the alpha of the map's own canvas, and the browser fills what a premultiplied
 * canvas leaves with the page behind it. MapPage.js lays that page black in dark and beach and near white in light, so light alone
 * showed the page's white through every streak, and the wind bench (which saved the bare canvas) had never drawn that picture.
 * This file pins the helper's blend, the facts the finding rests on (the page's colours and that nothing between the page and the
 * canvas has a colour of its own; the bench's own copy of the page) and the engine's two edited lines. What the engine DOES to
 * the canvas's alpha, on every path, is windCanvasAlphaTrace.test.js.
 */
import fs from 'fs';
import path from 'path';
import { WIND_OPAQUE_CANVAS_KILL, windKeepsCanvasOpaque, blendIntoMap } from './windCanvasAlpha';

const { APP_PAGE, pageOf, alphaOf, foldAlpha, alphaWarning } = require('../../../scripts/wind-bench/page-colour');

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

describe('the facts the finding rests on', () => {
  it('MapPage.js lays the page behind the map near white in light and black in dark AND beach', () => {
    const page = read(FRONTEND, 'src', 'components', 'MapPage.js');
    expect(page).toContain('const isLight = theme === \'light\';');
    expect(page).toContain('${isLight ? \'bg-gray-50\' : \'bg-black\'} z-[50]');
  });
  it('nothing between that page and the canvas has a colour of its own: the wrapper in MapPage.js, MapWebGL\'s root, the map\'s own style', () => {
    const page = read(FRONTEND, 'src', 'components', 'MapPage.js'), webgl = read(MAP, 'MapWebGL.js');
    expect(page).toMatch(/<div className="absolute inset-0 z-0" data-testid="map-container">\s*<MapWebGL/);
    expect(page.match(/<MapWebGL\b/g)).toHaveLength(1);                                             // one host of the map, so one page
    expect(webgl).toMatch(/return \(\s*<div style=\{\{ position: 'relative', width: '100%', height: '100%' \}\}>\s*<TruthOverlay/);
    const map = webgl.slice(webgl.search(/<Map\r?\n/));
    expect(map.slice(0, map.indexOf('>'))).toContain('style={{ width: \'100%\', height: \'100%\' }}');
    expect(map.slice(0, map.indexOf('>'))).not.toMatch(/background/i);
  });
});

describe('the wind bench lays every saved frame over the page the app lays (scripts/wind-bench/page-colour.js)', () => {
  it('carries MapPage.js\'s page colours: gray-50 behind light, black behind dark and beach', () => {
    expect(APP_PAGE).toEqual({ light: '#f9fafb', dark: '#000000', beach: '#000000' });   // Tailwind gray-50 is #f9fafb
    expect(Object.isFrozen(APP_PAGE)).toBe(true);
  });
  it('a theme takes the app\'s page unless another is asked for; an unknown theme takes black', () => {
    expect(pageOf('light')).toBe('#f9fafb'); expect(pageOf('dark')).toBe('#000000'); expect(pageOf('beach')).toBe('#000000');
    expect(pageOf('light', '#000000')).toBe('#000000'); expect(pageOf('dark', 'rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(pageOf('light', null)).toBe('#f9fafb'); expect(pageOf('light', '')).toBe('#f9fafb'); expect(pageOf('neon')).toBe('#000000');
  });
  it('reads a canvas\'s alpha from the ALPHA bytes: the least and the mean', () => {
    expect(alphaOf(Uint8Array.from([9, 9, 9, 255, 9, 9, 9, 255]))).toEqual({ min: 1, mean: 1 });
    expect(alphaOf(Uint8Array.from([255, 0, 0, 191, 0, 255, 0, 255]))).toEqual({ min: 0.749, mean: 0.875 });   // not the red, not the green
    expect(alphaOf(Uint8Array.from([0, 0, 0, 155]))).toEqual({ min: 0.608, mean: 0.608 });
    expect(alphaOf(new Uint8Array(0))).toEqual({ min: 1, mean: 1 });
  });
  it('a run\'s alpha is the LEAST of its frames\' minima and the mean of their means', () => {
    let a = foldAlpha(null, { min: 1, mean: 1 });
    a = foldAlpha(a, { min: 0.749, mean: 0.9 }); a = foldAlpha(a, { min: 0.8, mean: 0.8 });
    expect(a).toEqual({ min: 0.749, mean: 0.9, frames: 3 });
    expect(foldAlpha(a, null)).toBe(a); expect(foldAlpha(null, null)).toBeNull();
  });
  it('warns only when a scored read was taken on a see-through canvas, and names the page the app lays', () => {
    expect(alphaWarning({ min: 1, mean: 1 }, 'light', 'z6 now')).toBeNull();
    expect(alphaWarning(null, 'light', 'z6 now')).toBeNull();
    const w = alphaWarning({ min: 0.749, mean: 0.9 }, 'light', 'z6 kill');
    expect(w).toContain('WARNING z6 kill'); expect(w).toContain('0.749'); expect(w).toContain('#f9fafb'); expect(w).toContain('BLACK page');
  });
  it('the page uses it: every frame it saves is drawn onto a canvas already filled with the page, and every canvas read carries its alpha', () => {
    const entry = read(FRONTEND, 'scripts', 'wind-bench', 'page', 'map-entry.js').replace(/\r\n/g, '\n');
    expect(entry).toContain('const { pageOf, alphaOf, foldAlpha } = require(\'../page-colour\');');
    for (const fn of ['thumb', 'cropShot', 'smallShot']) {
      const from = entry.slice(entry.indexOf(`function ${fn}(`)), body = from.slice(0, from.indexOf('\n}\n'));
      expect(body).toContain('pageCanvas(');
      expect(body).not.toContain('document.createElement(\'canvas\')');
      expect(body.indexOf('pageCanvas(')).toBeLessThan(body.indexOf('drawImage('));   // filled first, then the map laid on it
    }
    const pc = entry.slice(entry.indexOf('function pageCanvas('));
    expect(pc.slice(0, pc.indexOf('\n}\n'))).toContain('x.fillStyle = state.page || pageOf(state.theme); x.fillRect(0, 0, w, h);');
    expect(entry).toContain('return { px, W, H, alpha: alphaOf(px) };');
    expect(entry.match(/alpha = foldAlpha\(alpha, compRaw\.alpha\);/g)).toHaveLength(2);        // the path run and the motion run: every sampled frame
    expect(entry).toContain('CSS.supports(\'color\', cfg.page)');                                // a page that is not a colour stops the run: a 2D canvas would fill black and say nothing
  });
  it('the runners use it: a cached motion run is this run only on the same page, and the scored runners warn', () => {
    const motion = read(FRONTEND, 'scripts', 'wind-bench', 'motion-run.js');
    expect(motion).toContain('results[run.name].page === pageOf(run.theme, run.behind || BEHIND)');
    expect(motion).toContain('page: run.behind || BEHIND });');
    for (const f of ['map-run.js', 'path-run.js']) expect(read(FRONTEND, 'scripts', 'wind-bench', f)).toMatch(/alphaWarning\((r|res)\.canvasAlpha, theme, /);
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
