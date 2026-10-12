/**
 * THE LAND MASK (windLandMask.js): dark's rules, rule 4. A mark picks its streak row by the ground under it (DECISIONS D-020).
 *
 * Light's and beach's sea is far darker than their land under the tint, so one streak colour per speed washes the sea. The marks read a
 * 2048 px Web Mercator mask of the app's own Natural Earth land and mix the marks table's land row and sea row by it (DRAW_FS; the
 * tables and that shader line are pinned in windDarkRules.test.js). This file pins the mask's own life:
 *   - until it is ready, and if it fails, every mark draws its LAND row (never an all-sea mask);
 *   - one load however many frames ask, a bounded retry after a failure, the page's parsed land reused;
 *   - it is uploaded north-up whatever unpack state the page left, through no state it does not put back;
 *   - it is bound through the engine's own bindTexture, whose record of the active unit must stay true;
 *   - a context that was lost and restored starts again.
 * A fake GL keeps one binding per texture unit, as a driver does. The GPU bench is the authority for the picture
 * (scripts/wind-bench/map-run.js: `mask 1`, and --no-land-file as the control).
 */
import fs from 'fs';
import path from 'path';
import { LAND_MASK_SIZE, mercatorY, rasterizeLand, bindLandMask, landMaskUrl } from './windLandMask';

describe('the land mask (rule 4): the mark picks its row by the ground under it', () => {
  const GEO = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, 85.051129], [0, 0], [180, -85.051129], [-180, 85.051129]]] } },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [90, 0], [90, 45], [0, 0]]], [[[10, 10], [20, 10], [20, 20], [10, 10]], [[12, 11], [14, 11], [14, 12], [12, 11]]]] } },
    { type: 'Feature', geometry: null }, { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ] };
  const fakeCanvas = (size, paint) => {
    const calls = [], ctx = { calls, fillRect: (...a) => calls.push(['fillRect', ...a]), beginPath: () => calls.push(['beginPath']), moveTo: (x, y) => calls.push(['moveTo', x, y]), lineTo: (x, y) => calls.push(['lineTo', x, y]),
      closePath: () => calls.push(['closePath']), fill: (rule) => calls.push(['fill', rule]), getImageData: (x, y, w, h) => ({ data: paint ? paint(w, h) : new Uint8ClampedArray(w * h * 4) }) };
    return { ctx, width: size, height: size, getContext: (kind) => (kind === '2d' ? ctx : null) };
  };
  const made = [];   // every canvas the module asked the page for
  const maskGl = () => {
    const gl = { calls: [], uniforms: {}, textures: [], dead: new Set(), lost: false, isTextureCalls: 0, active: 100, units: { 100: 'the-maps-own-texture' },
      TEXTURE_2D: 'T2D', TEXTURE0: 100, TEXTURE_BINDING_2D: 'TB', UNPACK_ALIGNMENT: 'UA', UNPACK_FLIP_Y_WEBGL: 'FY', MAX_TEXTURE_SIZE: 'MTS', LUMINANCE: 'LUM', UNSIGNED_BYTE: 'UB',
      TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG', REPEAT: 'REPEAT', CLAMP_TO_EDGE: 'CLAMP', LINEAR: 'LINEAR',
      state: { UA: 4, FY: true, MTS: 8192 } };
    gl.getParameter = (p) => (p === 'TB' ? gl.units[gl.active] : gl.state[p]);
    gl.pixelStorei = (p, v) => { gl.state[p] = v; };
    gl.createTexture = () => { const t = { id: gl.textures.length }; gl.textures.push(t); return t; };
    gl.bindTexture = (target, t) => { gl.units[gl.active] = t; };
    gl.texParameteri = (target, k, v) => { gl.calls.push(['texParameteri', gl.units[gl.active], k, v]); };
    gl.texImage2D = (...a) => { gl.calls.push(['texImage2D', { tex: gl.units[gl.active], format: a[2], w: a[3], h: a[4], bytes: a[8], flipY: gl.state.FY, align: gl.state.UA }]); };
    gl.activeTexture = (u) => { gl.active = u; };
    gl.getUniformLocation = (prog, name) => name;
    gl.uniform1i = (loc, v) => { gl.uniforms[loc] = v; };
    gl.uniform1f = (loc, v) => { gl.uniforms[loc] = v; };
    gl.uniform2f = (loc, x, y) => { gl.uniforms[loc] = [x, y]; };
    gl.isContextLost = () => gl.lost;
    gl.isTexture = (t) => { gl.isTextureCalls++; return !gl.dead.has(t); };
    gl.uploads = () => gl.calls.filter((c) => c[0] === 'texImage2D').map((c) => c[1]);
    return gl;
  };
  const page = (response) => ({ location: { origin: 'https://example.test' }, requestIdleCallback: (fn) => fn(),
    fetch: jest.fn(() => (response === undefined ? Promise.resolve({ ok: true, json: () => Promise.resolve(GEO) }) : response())) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  let createElement;
  beforeEach(() => {
    const real = document.createElement.bind(document);
    made.length = 0;
    createElement = jest.spyOn(document, 'createElement').mockImplementation((tag) => { if (tag !== 'canvas') return real(tag); const c = fakeCanvas(0); made.push(c); return c; });
  });
  afterEach(() => { createElement.mockRestore(); jest.restoreAllMocks(); });

  it('Web Mercator y: the equator at a half, north at 0, clamped at the map\'s edge (DRAW_VS\'s own projection)', () => {
    expect(mercatorY(0)).toBeCloseTo(0.5, 12);
    expect(mercatorY(85.051129)).toBeCloseTo(0, 6);
    expect(mercatorY(-85.051129)).toBeCloseTo(1, 6);
    expect(mercatorY(90)).toBe(mercatorY(85.051129));
    expect(mercatorY(-90)).toBe(mercatorY(-85.051129));
    expect(mercatorY(30.45)).toBeCloseTo(0.5 - Math.log(Math.tan(Math.PI / 4 + (30.45 * Math.PI) / 360)) / (2 * Math.PI), 12);
  });
  it('draws every Polygon and MultiPolygon ring into the mercator square, holes cut by the even-odd rule, and reads one byte a texel', () => {
    const size = 8, canvas = fakeCanvas(size, (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = i % 251; d[i * 4 + 1] = 7; d[i * 4 + 3] = 255; } return d; });
    const out = rasterizeLand(GEO, size, () => canvas), c = canvas.ctx.calls;
    expect(c[0]).toEqual(['fillRect', 0, 0, size, size]);                                    // sea first
    expect(c.filter((x) => x[0] === 'fill')).toEqual([['fill', 'evenodd'], ['fill', 'evenodd'], ['fill', 'evenodd']]);   // one fill a polygon (1 + 2), nothing for the null or the line
    expect(c.filter((x) => x[0] === 'beginPath')).toHaveLength(3);
    expect(c.filter((x) => x[0] === 'closePath')).toHaveLength(4);                           // four rings: the last polygon carries a hole
    const pts = c.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo');
    expect(pts[0][0]).toBe('moveTo'); expect(pts[0][1]).toBeCloseTo(0, 9); expect(pts[0][2]).toBeCloseTo(0, 4);            // -180, north edge -> the top-left corner
    expect(pts[1][0]).toBe('lineTo'); expect(pts[1][1]).toBeCloseTo(4, 9); expect(pts[1][2]).toBeCloseTo(4, 9);            // 0, 0 -> the centre
    expect(pts[2][1]).toBeCloseTo(8, 9); expect(pts[2][2]).toBeCloseTo(8, 4);                                              // 180, south edge -> the bottom-right corner
    expect(out).toBeInstanceOf(Uint8Array); expect(out).toHaveLength(size * size);
    out.forEach((v, i) => expect(v).toBe(i % 251));                                           // the red channel, nothing else
    expect(rasterizeLand(null, 2, () => fakeCanvas(2))).toEqual(new Uint8Array(4));           // no land at all: all sea, no throw
  });
  it('fetches the app\'s own land file, from the page\'s origin', () => {
    expect(landMaskUrl({ location: { origin: 'https://rawsurf.example' } })).toBe('https://rawsurf.example/ne_50m_land.json');
    expect(fs.existsSync(path.join(__dirname, '..', '..', '..', 'public', 'ne_50m_land.json'))).toBe(true);
    expect(LAND_MASK_SIZE).toBe(2048);
  });
  it('off: nothing is fetched, a one-texel land stand-in is bound and the shader is told there is no mask', () => {
    const gl = maskGl(), win = page();
    for (let f = 0; f < 3; f++) bindLandMask(gl, 'prog', 5, false, win);
    expect(win.fetch).not.toHaveBeenCalled();
    expect(gl.uniforms).toEqual({ u_land_mask: 5, u_land_on: 0, u_white: [1, 1] });
    expect(gl.uploads()).toHaveLength(1);
    expect(gl.uploads()[0]).toMatchObject({ w: 1, h: 1, format: 'LUM' });
    expect(Array.from(gl.uploads()[0].bytes)).toEqual([255]);                                 // land: with no mask every mark draws its land row
    expect(gl.units[105]).toBe(gl.uploads()[0].tex);
  });
  it('on: ONE fetch however many frames ask; land rows until the mask is ready, then the mask on its unit', async () => {
    const gl = maskGl(), win = page();
    for (let f = 0; f < 4; f++) bindLandMask(gl, 'prog', 5, true, win);
    expect(win.fetch).toHaveBeenCalledTimes(1);
    expect(win.fetch).toHaveBeenCalledWith('https://example.test/ne_50m_land.json');
    expect(gl.uniforms.u_land_on).toBe(0);
    await settle();
    bindLandMask(gl, 'prog', 5, true, win);
    expect(gl.uniforms).toEqual({ u_land_mask: 5, u_land_on: 1, u_white: [1, 1] });
    const big = gl.uploads().filter((u) => u.w === LAND_MASK_SIZE);
    expect(big).toHaveLength(1);
    expect(big[0]).toMatchObject({ h: LAND_MASK_SIZE, format: 'LUM', align: 1 });
    expect(big[0].bytes).toHaveLength(LAND_MASK_SIZE * LAND_MASK_SIZE);
    expect(gl.units[105]).toBe(big[0].tex);
    expect(gl.calls).toContainEqual(['texParameteri', big[0].tex, 'WS', 'REPEAT']);           // the world wraps east-west
    expect(gl.calls).toContainEqual(['texParameteri', big[0].tex, 'WT', 'CLAMP']);
    bindLandMask(gl, 'prog', 5, false, win);                                                   // the theme turned dark: the stand-in again, the mask kept
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(gl.units[105]).toBe(gl.uploads()[0].tex);
    expect(win.fetch).toHaveBeenCalledTimes(1);
  });
  it('the white\'s strength over land and over sea reaches the shader as LIGHT LEVELS, their square roots; none passed is full on both (dark\'s white, D-022)', () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog', 5, true, win, { land: 1, sea: 0.55 });                         // the screen pass lays a trail at its level squared
    expect(gl.uniforms.u_white[0]).toBe(1); expect(gl.uniforms.u_white[1]).toBeCloseTo(Math.sqrt(0.55), 12);
    bindLandMask(gl, 'prog', 5, true, win);                                                  // a caller with nothing to say: as before the uniform existed
    expect(gl.uniforms.u_white).toEqual([1, 1]);
    bindLandMask(gl, 'prog', 5, false, win, { land: 1, sea: 0.25 });                        // bound whatever the mask\'s state: with no mask every mark reads as land, so x is what draws
    expect(gl.uniforms.u_land_on).toBe(0); expect(gl.uniforms.u_white).toEqual([1, 0.5]);
  });
  it('uploads north-up whatever unpack state the page left, and leaves that state and the map\'s binding as it found them', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog', 5, true, win);
    await settle();
    for (const u of gl.uploads()) expect(u.flipY).toBe(false);                                 // a flipped mask would put the Arctic's land rows on the Southern Ocean
    expect(gl.state).toEqual({ UA: 4, FY: true, MTS: 8192 });
    expect(gl.units[100]).toBe('the-maps-own-texture');                                        // the map's binding on the unit it was on
  });
  it('keeps the engine\'s own record of the active unit true (WebGLWindUtils.bindTexture\'s shadow): the next bind lands on the unit it names', () => {
    const gl = maskGl();
    gl.active = 102; gl.units[102] = 'the-colour-ramp'; gl.__activeTextureUnit = 102; gl.__boundTextures2D = [];   // as inside the engine's render, after the colour ramp went to unit 2
    bindLandMask(gl, 'prog', 5, false, page());
    expect(gl.__activeTextureUnit).toBe(gl.active);
    expect(gl.__boundTextures2D[5]).toBe(gl.units[105]);
    expect(gl.units[102]).toBe('the-colour-ramp');                                             // unit 2 holds what it held (the stand-in was made there and put back)
    expect(gl.units[100]).toBe('the-maps-own-texture');                                        // and nothing landed on unit 0
  });
  it('a failed, missing or empty file leaves every mark on its land row, quietly, and is not fetched again on the next frames', async () => {
    const json = (body) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    // an empty or malformed collection would be an ALL-SEA mask (sea rows on every continent): it is a failure, not a mask
    for (const response of [() => Promise.resolve({ ok: false, status: 404 }), () => Promise.reject(new Error('offline')), json({ features: 'nope' }), json({ type: 'FeatureCollection', features: [] }), json(null),
      () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('not json')) })]) {
      const gl = maskGl(), win = page(response);
      bindLandMask(gl, 'prog', 5, true, win);
      await settle();
      for (let f = 0; f < 3; f++) bindLandMask(gl, 'prog', 5, true, win);
      expect(win.fetch).toHaveBeenCalledTimes(1);
      expect(gl.uniforms.u_land_on).toBe(0);
      expect(gl.uploads().filter((u) => u.w === LAND_MASK_SIZE)).toHaveLength(0);
      expect(gl.units[105]).toBe(gl.uploads()[0].tex);
      expect(win.__WIND_LAND_MASK__.status).toBe('failed');
    }
    const gl = maskGl();
    expect(() => bindLandMask(gl, 'prog', 5, true, { location: { origin: '' } })).not.toThrow();   // no fetch at all (an old webview)
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(() => bindLandMask(null, 'prog', 5, true)).not.toThrow();
  });
  it('a failed load is tried again, a few times and not at once: one bad fetch on a weak signal does not cost the sea its rows until reload', async () => {
    let now = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const answers = [() => Promise.reject(new Error('offline')), () => Promise.resolve({ ok: false, status: 503 }), () => Promise.resolve({ ok: true, json: () => Promise.resolve(GEO) })];
    const gl = maskGl(), win = page(() => answers[Math.min(win.fetch.mock.calls.length - 1, answers.length - 1)]());
    bindLandMask(gl, 'prog', 5, true, win); await settle();
    expect(win.__WIND_LAND_MASK__.status).toBe('failed');
    now += 5000; bindLandMask(gl, 'prog', 5, true, win); await settle();
    expect(win.fetch).toHaveBeenCalledTimes(1);                                                // not yet: the wait grows with each failure
    now += 20000; bindLandMask(gl, 'prog', 5, true, win); await settle();
    expect(win.fetch).toHaveBeenCalledTimes(2);
    expect(gl.uniforms.u_land_on).toBe(0);
    now += 60000; bindLandMask(gl, 'prog', 5, true, win); await settle();
    expect(win.fetch).toHaveBeenCalledTimes(3);
    bindLandMask(gl, 'prog', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);                                                     // the third answer was the file
    expect(win.__WIND_LAND_MASK__).toMatchObject({ status: 'ready', tries: 3 });
  });
  it('gives up after three tries: a file that is not there is not asked for forever', async () => {
    let now = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const gl = maskGl(), win = page(() => Promise.resolve({ ok: false, status: 404 }));
    for (let i = 0; i < 8; i++) { bindLandMask(gl, 'prog', 5, true, win); await settle(); now += 600000; }
    expect(win.fetch).toHaveBeenCalledTimes(3);
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(win.__WIND_LAND_MASK__).toMatchObject({ status: 'failed', tries: 3 });
  });
  it('uses the land the page has already parsed (mapUtils getSharedLandGeoJSON) instead of fetching the 2.8 MB file a second time', async () => {
    const gl = maskGl(), win = page();
    win.__LAND_GEOJSON_CACHE__ = GEO;
    bindLandMask(gl, 'prog', 5, true, win); await settle();
    expect(win.fetch).not.toHaveBeenCalled();
    bindLandMask(gl, 'prog', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
  });
  it('lets go of its 2048 px canvas once the mask is uploaded, and says how long the build held the main thread', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog', 5, true, win); await settle();
    expect(made).toHaveLength(1);
    expect([made[0].width, made[0].height]).toEqual([0, 0]);
    expect(win.__WIND_LAND_MASK__.status).toBe('ready');
    expect(typeof win.__WIND_LAND_MASK__.ms).toBe('number');
    expect(win.__WIND_LAND_MASK__.ms).toBeGreaterThanOrEqual(0);
  });
  it('a device that cannot hold a 2048 px texture keeps the land rows and says why', async () => {
    const gl = maskGl(), win = page();
    gl.state.MTS = 1024;
    bindLandMask(gl, 'prog', 5, true, win); await settle();
    bindLandMask(gl, 'prog', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(gl.uploads().filter((u) => u.w === LAND_MASK_SIZE)).toHaveLength(0);
    expect(String(win.__WIND_LAND_MASK__.reason)).toMatch(/texture/);
  });
  it('a context that was lost and restored starts again: dead textures are never bound, the mask is loaded anew', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog-A', 5, true, win);
    await settle();
    bindLandMask(gl, 'prog-A', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
    expect(gl.isTextureCalls).toBe(0);                                                        // the same program: no driver round trip a frame
    gl.dead = new Set(gl.textures);                                                           // the context came back: every texture made before is gone
    bindLandMask(gl, 'prog-B', 5, true, win);                                                 // the engine rebuilt its programs
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(gl.dead.has(gl.units[105])).toBe(false);
    expect(win.fetch).toHaveBeenCalledTimes(2);
    await settle();
    bindLandMask(gl, 'prog-B', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
    expect(gl.dead.has(gl.units[105])).toBe(false);
  });
  it('a rebuilt engine on a live context keeps the mask it has (no second fetch)', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog-A', 5, true, win);
    await settle();
    bindLandMask(gl, 'prog-B', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
    expect(win.fetch).toHaveBeenCalledTimes(1);
    expect(gl.isTextureCalls).toBe(1);                                                        // asked once, when the program changed
  });
  it('a load that was still in flight when the context came back never uploads into the new one', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog-A', 5, true, win);                                                 // in flight
    gl.dead = new Set(gl.textures);
    bindLandMask(gl, 'prog-B', 5, true, win);                                                 // restored: a second load
    await settle();
    expect(gl.uploads().filter((u) => u.w === LAND_MASK_SIZE)).toHaveLength(1);
  });
  it('publishes its state for the read-back (window.__WIND_LAND_MASK__)', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog', 5, true, win);
    expect(win.__WIND_LAND_MASK__).toMatchObject({ status: 'loading' });
    await settle();
    expect(win.__WIND_LAND_MASK__).toMatchObject({ status: 'ready', size: LAND_MASK_SIZE });
    const bad = page(() => Promise.resolve({ ok: false, status: 404 }));
    bindLandMask(maskGl(), 'prog', 5, true, bad);
    await settle();
    expect(bad.__WIND_LAND_MASK__).toMatchObject({ status: 'failed' });
    expect(String(bad.__WIND_LAND_MASK__.reason)).toContain('404');
  });
});
