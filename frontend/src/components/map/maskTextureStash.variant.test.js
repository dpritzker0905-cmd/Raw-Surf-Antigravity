/**
 * The mask stash's VARIANT SLOT (2026-10-23, waveLakes.js). Zoomed in, an EURO <-> GFS toggle cycles three masks: the plain world
 * mask (GFS), EURO's world series page with lakes and EURO's viewport with lakes (offline z8 Lake Michigan). With the resident and
 * one stash slot, every toggle rebuilt one of them (setWaveData 250-375 ms). The second slot keeps all three: every toggle after
 * the first round is a reference swap. A session with no carried lake keeps the one-slot behaviour exactly.
 */
import { freeMaskStash, isStashedMaskTex, stashResidentMask, stashServesAny, takeMaskStash } from './maskTextureStash';
import { maskCanvasWidthForSpan } from './WebGLMarineMaskRenderer';

const WORLD = { west: -180, south: -80, east: 180, north: 84 };
const MICH = { west: -92, south: 42, east: -82, north: 48 };
const PLAIN = { type: 'FeatureCollection', features: [] };
const LAKES = { type: 'FeatureCollection', features: [], __waveLakes: ['michigan'], __base: PLAIN };
const dimsFor = (b) => { const w = maskCanvasWidthForSpan((b.east < b.west ? b.east + 360 : b.east) - b.west); return { w, h: w / 2 }; };

function fakeGL() { const deleted = []; return { deleted, deleteTexture: (t) => deleted.push(t) }; }

// One encoder REBUILD for (geo, bounds), as WebGLMarineTextureEncoder does it: take a stash entry that serves, stash the resident,
// install the taken entry or build a new texture. Returns 'swap' or 'build'.
function commit(gl, engine, geo, bounds, world = PLAIN) {
  if (engine._cachedMaskGeoJSON === geo && engine._cachedMaskBounds === bounds) return 'reuse';
  const taken = takeMaskStash(engine, geo, bounds);
  if (engine._cachedMaskTex && !stashResidentMask(gl, engine, world)) { gl.deleteTexture(engine._cachedMaskTex); engine._cachedMaskTex = null; }
  const entry = taken || { tex: { id: `${geo === LAKES ? 'L' : 'P'}@${bounds.west}` }, dims: dimsFor(bounds), bounds, geojson: geo, hasSDF: false };
  Object.assign(engine, { _cachedMaskTex: entry.tex, _cachedMaskTexDims: entry.dims, _cachedMaskBounds: bounds, _cachedMaskGeoJSON: geo });
  return taken ? 'swap' : 'build';
}

afterEach(() => { delete window.__RAW_DISABLE_MASK_STASH_VARIANT__; });

describe('the variant slot', () => {
  it('z8 toggles: after one round, every mask of the three-mask cycle is a reference swap', () => {
    const gl = fakeGL(); const e = {};
    const cycle = () => [commit(gl, e, LAKES, WORLD), commit(gl, e, LAKES, MICH), commit(gl, e, PLAIN, WORLD)];   // EURO page, EURO view, GFS
    commit(gl, e, PLAIN, WORLD);                                                                              // the map opens on GFS
    expect(cycle()).toEqual(['build', 'build', 'swap']);
    for (let i = 0; i < 3; i++) expect(cycle()).toEqual(['swap', 'swap', 'swap']);
    expect(gl.deleted).toEqual([]);                                                                           // nothing rebuilt, nothing freed
  });
  it('a rebuild served by slot 1 keeps slot 2 (the measured z8 order: GFS twice, then EURO page and view)', () => {
    const gl = fakeGL(); const e = {};
    commit(gl, e, PLAIN, WORLD); commit(gl, e, LAKES, WORLD); commit(gl, e, LAKES, MICH); commit(gl, e, PLAIN, WORLD);
    expect(e._maskStash).toMatchObject({ geojson: LAKES, bounds: MICH });
    expect(e._maskStash2).toMatchObject({ geojson: LAKES, bounds: WORLD });
    commit(gl, e, LAKES, MICH); commit(gl, e, PLAIN, WORLD);                 // EURO view, back to GFS: slot 1 swaps, slot 2 stays
    expect(e._maskStash2).toMatchObject({ geojson: LAKES, bounds: WORLD });
    expect([commit(gl, e, LAKES, WORLD), commit(gl, e, LAKES, MICH)]).toEqual(['swap', 'swap']);
    expect(gl.deleted).toEqual([]);
  });
  it('one slot (kill switch): the same cycle rebuilds on every round, as before', () => {
    window.__RAW_DISABLE_MASK_STASH_VARIANT__ = true;
    const gl = fakeGL(); const e = {};
    commit(gl, e, PLAIN, WORLD);
    commit(gl, e, LAKES, WORLD); commit(gl, e, LAKES, MICH); commit(gl, e, PLAIN, WORLD);
    const round = [commit(gl, e, LAKES, WORLD), commit(gl, e, LAKES, MICH), commit(gl, e, PLAIN, WORLD)];
    expect(round).toContain('build');
    expect(e._maskStash2).toBeUndefined();
  });
  it('no carried lake in play: the second slot is never filled (the stash holds exactly what it held before)', () => {
    const gl = fakeGL(); const e = {};
    commit(gl, e, PLAIN, WORLD); commit(gl, e, PLAIN, MICH); commit(gl, e, PLAIN, WORLD); commit(gl, e, PLAIN, { ...MICH, west: -90 });
    expect(e._maskStash2 == null).toBe(true);
  });
  it('the WORLD PIN still keeps the world mask; with lakes in play the refused regional mask goes to the variant slot', () => {
    const gl = fakeGL(); const e = {};
    commit(gl, e, PLAIN, WORLD); commit(gl, e, LAKES, MICH);                 // stash: plain world (pinned); resident: lakes at MICH
    commit(gl, e, LAKES, { ...MICH, west: -90 });                             // another box: the pin refuses MICH out of slot 1
    expect(e._maskStash.geojson).toBe(PLAIN);
    expect(e._maskStash2).toMatchObject({ geojson: LAKES, bounds: MICH });
    expect(stashServesAny(e, LAKES, MICH)).toBe(true);
  });
  it('both slots are owned (the engine never frees them) and teardown frees both', () => {
    const gl = fakeGL(); const e = {};
    commit(gl, e, PLAIN, WORLD); commit(gl, e, LAKES, WORLD); commit(gl, e, LAKES, MICH);
    expect(isStashedMaskTex(e, e._maskStash.tex)).toBe(true);
    expect(isStashedMaskTex(e, e._maskStash2.tex)).toBe(true);
    const two = [e._maskStash.tex, e._maskStash2.tex];
    freeMaskStash(gl, e);
    expect(gl.deleted).toEqual(expect.arrayContaining(two));
    expect(e._maskStash).toBeNull(); expect(e._maskStash2).toBeNull();
  });
});
