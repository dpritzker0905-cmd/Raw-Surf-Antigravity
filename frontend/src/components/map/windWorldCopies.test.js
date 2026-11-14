/**
 * windWorldCopies: the world copies the wind heatmap and particles draw come from the frame's own bounds, not from a centre
 * + estimated span + 180 degrees of padding (2026-11-13). Timings, lit pixels and the fast-pan check:
 * docs/weather-program/log/2026-11-13-fable-wind-world-copies.md.
 */
import fs from 'fs';
import path from 'path';
import { MARGIN_DEG, MAX_COPIES, offsetsForBounds, windCopyCullOn, windWorldOffsets } from './windWorldCopies';

const vb = (west, east) => [west, -40, east, 60];
// The layer's old rule, as it stands in WebGLWindLayer.js (canvas.width in device pixels, 256-pixel tiles, the padding).
const legacy = (centerLng, canvasWidth, zoom) => {
  const span = (canvasWidth * 360.0) / (256.0 * Math.pow(2.0, zoom)); const padding = zoom < 3.5 ? 180.0 : 10.0;
  const west = centerLng - span / 2 - padding; const east = centerLng + span / 2 + padding; const out = [];
  for (let o = Math.floor((west + 180) / 360) * 360; o <= Math.ceil((east - 180) / 360) * 360; o += 360) out.push(o);
  return out;
};

beforeEach(() => { delete window.__RAW_DISABLE_WIND_COPY_CULL__; delete window.__RAW_GPU__; });

describe('a view that touches no world edge draws the main copy only', () => {
  test.each([
    ['Atlantic, zoom 3.2 (1080 px map: 83 degrees wide)', -96.3, -13.7],
    ['Indian Ocean, zoom 2.8', 25.5, 134.5],
    ['the widest view that stays inside both margins', -169.9, 169.9],
    ['a close view mid-globe', -10, 5],
  ])('%s', (_name, west, east) => {
    expect(offsetsForBounds(vb(west, east))).toEqual([0]);
  });

  test('where the old rule drew three (below zoom 3.5) or two (the over-wide span)', () => {
    expect(legacy(-55, 1080, 3.2)).toEqual([-360, 0, 360]);                      // 180 degrees of padding
    expect(legacy(150, 1170, 5)).toEqual([0, 360]);                              // phone, dpr 3: span 51 deg where the view is 8.6
    expect(offsetsForBounds(vb(145.7, 154.3))).toEqual([0]);
  });
});

describe('a view that reaches a world edge draws that side too, and only that side', () => {
  test.each([
    ['east edge in view (Fiji, zoom 4)', 155.3, 202.7, [0, 360]],
    ['west edge in view (Bering, zoom 5)', -189.9, -166.1, [-360, 0]],
    ['within the margin of the east edge, not past it', 120, 170.5, [0, 360]],
    ['within the margin of the west edge', -170.5, -120, [-360, 0]],
    ['just outside the margin', -169.99, 169.99, [0]],
    ['more than a world on screen', -281.2, 281.3, [-360, 0, 360]],
    ['a wide window centred at 150E', -131.3, 431.2, [0, 360]],
    ['a view wholly in the next world east (unwrapped centre)', 250, 330, [360]],
    ['across the edge between the next two worlds east', 500, 700, [360, 720]], ['wholly two worlds east', 560, 700, [720]],
  ])('%s', (_name, west, east, want) => {
    expect(offsetsForBounds(vb(west, east))).toEqual(want);
  });

  test('every longitude in the view, and the margin beside it, lies inside a drawn copy', () => {
    expect(MARGIN_DEG).toBe(10);
    for (let west = -400; west <= 400; west += 7.3) {
      for (const width of [8, 83, 190, 330, 562]) {
        const east = west + width; const offs = offsetsForBounds(vb(west, east));
        for (const lng of [west - MARGIN_DEG + 0.01, west, (west + east) / 2, east, east + MARGIN_DEG - 0.01]) {
          expect(offs.some((o) => lng >= o - 180 && lng <= o + 180)).toBe(true);
        }
        // and no copy is drawn that the widened view does not touch
        for (const o of offs) expect(o - 180 < east + MARGIN_DEG && o + 180 > west - MARGIN_DEG).toBe(true);
      }
    }
  });
});

describe('bounds that cannot be read fall back to the layer\'s old offsets', () => {
  test.each([
    ['none', null], ['an object', { west: 0, east: 10 }], ['NaN', [NaN, 0, 10, 5]], ['strings', ['0', 0, '10', 5]],
    ['east before west', [170, 0, -170, 5]], ['absurdly wide', [-2000, 0, 2000, 5]],
  ])('%s', (_name, bounds) => {
    expect(offsetsForBounds(bounds)).toBeNull();
    window.__RAW_GPU__ = {};
    expect(windWorldOffsets([-360, 0, 360], bounds)).toEqual([-360, 0, 360]);
    expect(window.__RAW_GPU__.windCopies.by).toBe('legacy-no-bounds');
  });

  test('the guard is five copies', () => {
    expect(MAX_COPIES).toBe(5);
    expect(offsetsForBounds(vb(-700, 700))).toEqual([-720, -360, 0, 360, 720]);
    expect(offsetsForBounds(vb(-900, 900))).toBeNull();
  });
});

describe('the switch and the wiring', () => {
  test('ON: the offsets come from the bounds and the telemetry keeps what the old rule would have drawn', () => {
    window.__RAW_GPU__ = {};
    expect(windWorldOffsets([-360, 0, 360], vb(-96.3, -13.7))).toEqual([0]);
    expect(window.__RAW_GPU__.windCopies).toEqual({ offsets: [0], legacy: [-360, 0, 360], by: 'bounds' });
  });

  test('OFF PATH: the kill gives the layer\'s old offsets, as before', () => {
    window.__RAW_DISABLE_WIND_COPY_CULL__ = true; window.__RAW_GPU__ = {};
    expect(windCopyCullOn()).toBe(false);
    const old = [-360, 0, 360];
    expect(windWorldOffsets(old, vb(-96.3, -13.7))).toBe(old);
    expect(window.__RAW_GPU__.windCopies.by).toBe('kill');
  });

  test('the layer computes its old offsets, reads the frame\'s bounds, then asks this module, before it renders', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindLayer.js'), 'utf8');
    const iOld = src.indexOf('const padding = zoom < 3.5 ? 180.0 : 10.0;'); const iBounds = src.indexOf('const mapBounds = map.getBounds();');
    const iNew = src.indexOf('worldOffsets = windWorldOffsets(worldOffsets, viewportBounds);');
    const iRender = src.indexOf('engine.render(_gl, _matrix, canvas.width, canvas.height, zoom, themeRef.current, worldOffsets, viewportBounds);');
    expect(iOld).toBeGreaterThan(0);
    expect(iBounds).toBeGreaterThan(iOld); expect(iNew).toBeGreaterThan(iBounds); expect(iRender).toBeGreaterThan(iNew);
    expect(src.match(/windWorldOffsets\(/g)).toHaveLength(1);
  });

  test('the engine draws exactly the offsets it is given, for the heatmap and for the particles', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(eng).toMatch(/var heatOffsets = worldOffsets \|\| \(z < 3\.5 \? \[0\.0, -360\.0, 360\.0\] : \[0\.0\]\);/);
    expect(eng).toMatch(/var actualWorldOffsets = worldOffsets \|\| \(z < 3\.5 \? \[0\.0, -360\.0, 360\.0\] : \[0\.0\]\);/);
  });
});
