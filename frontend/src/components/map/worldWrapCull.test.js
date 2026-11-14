/**
 * worldWrapCull: how many world copies the marine heatmap and particles draw. A low-zoom view that reaches no world edge now
 * draws one copy, not three (2026-11-13). The 2026-07-23 antimeridian cases are pinned here so the rule cannot lose them again.
 * Timings and the zero-pixel proof: docs/weather-program/log/2026-11-13-fable-world-wrap-cull.md.
 */
import fs from 'fs';
import path from 'path';
import { EDGE_MARGIN_DEG, WIDE_VIEW_DEG, worldWrapDecision } from './worldWrapCull';

const bounds = (west, east) => [west, -40, east, 60];
const wrap = (west, east, zoom) => worldWrapDecision(bounds(west, east), zoom);

beforeEach(() => { delete window.__RAW_DISABLE_WRAP_CULL__; delete window.__RAW_DISABLE_WRAP_CULL_LOWZOOM__; });

describe('a view that reaches no world edge draws one copy, at any zoom', () => {
  test.each([
    ['the measured world view: centre 55W, zoom 3.2, about 83 degrees wide', -96, -14, 3.2],
    ['mid-Pacific east of the date line, zoom 3', -165, -80, 3],
    ['Indian Ocean, zoom 2.5', 20, 150, 2.5],
    ['a view just inside both margins', -169.9, 129.9, 1.6],
    ['close zoom mid-globe (as before)', -10, 5, 9],
  ])('%s', (_name, west, east, zoom) => {
    expect(wrap(west, east, zoom)).toMatchObject({ needWrap: false, why: null, boundsKnown: true, vbWest: west, vbEast: east });
  });
});

describe('REGRESSION 2026-07-23: a view on the antimeridian draws all three copies ("half the heatmap clears")', () => {
  test('bounds are an ARRAY [west, south, east, north]; reading them as .west / .east was the bug', () => {
    const d = worldWrapDecision([165, -30, 195, 10], 6);                         // straddles +180 in unwrapped form, zoom >= 4
    expect(d).toMatchObject({ needWrap: true, why: 'near-edge', vbWest: 165, vbEast: 195, boundsKnown: true });
    expect(worldWrapDecision({ west: 165, south: -30, east: 195, north: 10 }, 6).needWrap).toBe(true);   // object form still read
  });

  test.each([
    ['straddling +180, unwrapped (east runs past 180)', 160, 200, 5, 'near-edge'],
    ['straddling -180, unwrapped (west runs past -180)', -200, -160, 5, 'near-edge'],
    ['straddling, in wrapped form (east < west)', 170, -170, 7, 'crosses'],
    ['Fiji at zoom 4: the edge is on screen', 150, 208, 4, 'near-edge'],
    ['just past the east margin', 120, 170.5, 8, 'near-edge'],
    ['just past the west margin', -170.5, -120, 8, 'near-edge'],
    ['the same views below zoom 4', 150, 208, 3, 'near-edge'],
  ])('%s', (_name, west, east, zoom, why) => {
    expect(wrap(west, east, zoom)).toMatchObject({ needWrap: true, why });
  });

  test('the margin is 10 degrees inside the world edge on both sides', () => {
    expect(EDGE_MARGIN_DEG).toBe(170);
    expect(wrap(-170, 0, 5).needWrap).toBe(false); expect(wrap(-170.01, 0, 5).needWrap).toBe(true);
    expect(wrap(0, 170, 5).needWrap).toBe(false); expect(wrap(0, 170.01, 5).needWrap).toBe(true);
  });
});

describe('a view as wide as a world, or one the rule cannot read, draws all three', () => {
  test('zoom below 1.5 on a desktop map shows more than a world: the bounds run past both edges', () => {
    expect(wrap(-250, 250, 1)).toMatchObject({ needWrap: true, why: 'near-edge' });
    expect(wrap(-190, 190, 1.4)).toMatchObject({ needWrap: true });
  });

  test('a view at least 300 degrees wide wraps even if a bounds source clamped it inside the margins', () => {
    expect(WIDE_VIEW_DEG).toBe(300);
    expect(wrap(-150, 150, 1.2)).toMatchObject({ needWrap: true, why: 'wide' });
    expect(wrap(-149, 150, 1.2).needWrap).toBe(false);
  });

  test.each([
    ['no bounds', null, 3], ['an empty array', [], 3], ['NaN in the bounds', [NaN, 0, 10, 5], 3], ['a string', ['-10', 0, '10', 5], 3],
  ])('%s: wrap (safe)', (_name, vb, zoom) => {
    expect(worldWrapDecision(vb, zoom)).toMatchObject({ needWrap: true, why: 'bounds-unknown', boundsKnown: false });
  });

  test('an unknown zoom wraps', () => {
    expect(worldWrapDecision(bounds(-96, -14), undefined)).toMatchObject({ needWrap: true, why: 'zoom-unknown' });
    expect(worldWrapDecision(bounds(-96, -14), NaN).needWrap).toBe(true);
  });
});

describe('the kills', () => {
  test('OFF PATH: __RAW_DISABLE_WRAP_CULL_LOWZOOM__ wraps every view below zoom 4, as before, and leaves zoom 4 and up alone', () => {
    window.__RAW_DISABLE_WRAP_CULL_LOWZOOM__ = true;
    expect(wrap(-96, -14, 3.2)).toMatchObject({ needWrap: true, why: 'lowzoom-kill' });
    expect(wrap(-96, -14, 3.99).needWrap).toBe(true);
    expect(wrap(-96, -14, 4).needWrap).toBe(false);
    expect(wrap(160, 200, 3)).toMatchObject({ needWrap: true, why: 'near-edge' });   // the edge clauses still decide first
  });

  test('__RAW_DISABLE_WRAP_CULL__ still wraps always', () => {
    window.__RAW_DISABLE_WRAP_CULL__ = true;
    expect(wrap(-10, 5, 9)).toMatchObject({ needWrap: true, why: 'kill' });
  });
});

describe('the engine', () => {
  const eng = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');

  test('takes the decision from this module, once, and both passes read the same flag', () => {
    expect(eng).toMatch(/const _wrap = worldWrapDecision\(viewportBounds, zoom\); const _needWrap = _wrap\.needWrap;/);
    expect(eng.match(/worldWrapDecision\(/g)).toHaveLength(1);
    expect(eng).toMatch(/const worldOffsets = _needWrap \? \[0\.0, -360\.0, 360\.0\] : \[0\.0\];/);   // heatmap, degrees
    expect(eng).toMatch(/const worldOffsets = _needWrap \? \[0\.0, -1\.0, 1\.0\] : \[0\.0\];/);       // particles, mercator units
    expect(eng).not.toMatch(/zoom < 4;/);
  });

  test('the bounds it is given are the map\'s own, read every frame, as an array', () => {
    const layer = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');
    expect(layer).toMatch(/const mb = map\.getBounds\(\);\s*const ew = mb\.getWest\(\), ee = mb\.getEast\(\), es = mb\.getSouth\(\), en = mb\.getNorth\(\);\s*viewportBounds = \[ew, es, ee, en\];/);
  });
});
