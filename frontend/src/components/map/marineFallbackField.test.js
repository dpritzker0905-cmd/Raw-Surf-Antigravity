/**
 * marineFallbackField: the wave-height picture drawn from our own grid when the marine engine has failed (exit row 12).
 * Pins the geometry (Mercator rows, cell-edge corners, the 85-degree clip, the antimeridian, north-first rows), the colours
 * (the picture IS the theme's table at the grid's own heights; land is transparent), the kill, and that the dark colours
 * the fallback draws are the shader's own (one test, both sources).
 */
import fs from 'fs';
import path from 'path';
import {
  MERCATOR_MAX_LAT, fallbackFieldExtent, fallbackFieldSize, rowLatitude, colLongitude, fieldHeightAt, renderFallbackField,
  fallbackHeightColor, heightLut, lutIndex, ownMarineFallbackKilled, fallbackOpacityExpression, FALLBACK_OPACITY_STOPS,
  nodeHeight, whyNoFallbackField,
} from './marineFallbackField';
import { getThemedWaveColorJS } from './colorScales';

const THEMES = ['light', 'dark', 'beach'];
/** A grid whose rows run south to north, as the app's marine grids do. `at(lat, lng)` -> { speed, isOcean }. */
function makeGrid({ west, south, east, north, cols, rows }, at) {
  const span = east > west ? east - west : east + 360 - west;
  const vectors = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lat = south + (y / (rows - 1)) * (north - south); const lng = west + (x / (cols - 1)) * span;
      const p = at(lat, lng);
      vectors.push({ u: 0, v: 0, speed: p.speed, isOcean: p.isOcean !== false });
    }
  }
  return { bounds: { west, south, east, north }, cols, rows, vectors };
}
const WORLD = { west: -180, south: -80, east: 180, north: 84, cols: 181, rows: 83 };
const px = (f, i, j) => { const o = (j * f.width + i) * 4; return [f.data[o], f.data[o + 1], f.data[o + 2], f.data[o + 3]]; };

describe('where the picture sits (fallbackFieldExtent)', () => {
  test('the corners are the outer cell EDGES, half a cell beyond the outer nodes, in MapLibre order', () => {
    const e = fallbackFieldExtent(makeGrid({ west: -10, south: 30, east: 10, north: 50, cols: 11, rows: 11 }, () => ({ speed: 1 })));
    expect(e.dLng).toBeCloseTo(2); expect(e.dLat).toBeCloseTo(2);
    expect(e.coordinates).toEqual([[-11, 51], [11, 51], [11, 29], [-11, 29]]);
    expect(e.clippedNorth).toBe(false); expect(e.clippedSouth).toBe(false);
  });
  test('a grid that runs past Mercator is clipped at its limit, and says so', () => {
    const e = fallbackFieldExtent(makeGrid({ west: -180, south: -90, east: 180, north: 90, cols: 181, rows: 91 }, () => ({ speed: 1 })));
    expect(e.edgeNorth).toBeCloseTo(MERCATOR_MAX_LAT, 6); expect(e.edgeSouth).toBeCloseTo(-MERCATOR_MAX_LAT, 6);
    expect(e.clippedNorth).toBe(true); expect(e.clippedSouth).toBe(true);
  });
  test('a box across the antimeridian keeps its west edge and runs its east edge past 180', () => {
    const e = fallbackFieldExtent(makeGrid({ west: 170, south: -10, east: -170, north: 10, cols: 11, rows: 11 }, () => ({ speed: 1 })));
    expect(e.dLng).toBeCloseTo(2);
    expect(e.edgeWest).toBeCloseTo(169); expect(e.edgeEast).toBeCloseTo(191);
  });
  test('the world grid: one picture from -181 to 181', () => {
    const e = fallbackFieldExtent(makeGrid(WORLD, () => ({ speed: 1 })));
    expect(e.edgeWest).toBeCloseTo(-181); expect(e.edgeEast).toBeCloseTo(181);
  });
  test('no grid, a malformed grid or bad bounds: null (nothing of ours to draw)', () => {
    expect(fallbackFieldExtent(null)).toBeNull();
    expect(fallbackFieldExtent({})).toBeNull();
    expect(fallbackFieldExtent({ bounds: { west: 0, south: 0, east: 1, north: 1 }, cols: 2, rows: 2, vectors: [1, 2, 3] })).toBeNull();
    expect(fallbackFieldExtent({ bounds: { west: 0, south: 5, east: 1, north: 5 }, cols: 2, rows: 2, vectors: [1, 2, 3, 4] })).toBeNull();
    expect(fallbackFieldExtent({ bounds: { west: 0, south: 0, east: 1, north: NaN }, cols: 2, rows: 2, vectors: [1, 2, 3, 4] })).toBeNull();
  });
});

describe('rows are even in Mercator y, north first', () => {
  const e = fallbackFieldExtent(makeGrid(WORLD, () => ({ speed: 1 })));
  const { height } = fallbackFieldSize(e);
  test('row 0 is the north edge and latitude falls with every row', () => {
    expect(rowLatitude(0, height, e)).toBeLessThan(e.edgeNorth);
    expect(rowLatitude(0, height, e)).toBeGreaterThan(e.edgeNorth - 2);
    for (let j = 1; j < height; j++) expect(rowLatitude(j, height, e)).toBeLessThan(rowLatitude(j - 1, height, e));
    expect(rowLatitude(height - 1, height, e)).toBeGreaterThan(e.edgeSouth);
  });
  test('the rows are NOT even in latitude: a row laid out evenly in latitude would miss by more than a cell at 70 N', () => {
    // the row a plain raster layer shows at 70 N is the one whose Mercator y is 70 N's; an even-latitude layout puts 70 N elsewhere
    let j70 = 0; for (let j = 0; j < height; j++) if (Math.abs(rowLatitude(j, height, e) - 70) < Math.abs(rowLatitude(j70, height, e) - 70)) j70 = j;
    const evenLat = e.edgeNorth - ((j70 + 0.5) / height) * (e.edgeNorth - e.edgeSouth);
    expect(Math.abs(rowLatitude(j70, height, e) - 70)).toBeLessThan(e.dLat / 2);
    expect(Math.abs(evenLat - 70)).toBeGreaterThan(e.dLat);
  });
  test('columns are even in longitude across the whole picture', () => {
    const { width } = fallbackFieldSize(e);
    expect(colLongitude(0, width, e)).toBeGreaterThan(e.edgeWest);
    expect(colLongitude(width - 1, width, e)).toBeLessThan(e.edgeEast);
    expect(colLongitude(1, width, e) - colLongitude(0, width, e)).toBeCloseTo((e.edgeEast - e.edgeWest) / width, 9);
  });
  test('the bitmap stays inside its caps and grows with the grid', () => {
    const big = fallbackFieldSize(fallbackFieldExtent(makeGrid({ west: -180, south: -80, east: 180, north: 84, cols: 721, rows: 329 }, () => ({ speed: 1 }))));
    expect(big.width).toBe(1024); expect(big.height).toBeLessThanOrEqual(512);
    const small = fallbackFieldSize(fallbackFieldExtent(makeGrid({ west: 0, south: 0, east: 2, north: 2, cols: 3, rows: 3 }, () => ({ speed: 1 }))));
    expect(small.width).toBe(12); expect(small.height).toBeGreaterThanOrEqual(2);
  });
});

describe('the height read from the grid (fieldHeightAt)', () => {
  const g = makeGrid({ west: 0, south: 0, east: 10, north: 10, cols: 11, rows: 11 }, (lat, lng) => ({ speed: lat + lng / 10 }));
  const e = fallbackFieldExtent(g);
  test('on a node it is the node, between nodes it is bilinear', () => {
    expect(fieldHeightAt(g, e, 3, 4)).toBeCloseTo(4.3, 9);
    expect(fieldHeightAt(g, e, 3.5, 4.5)).toBeCloseTo(4.85, 9);
  });
  test('grid row 0 is the SOUTH row', () => {
    expect(fieldHeightAt(g, e, 0, 0)).toBeCloseTo(0, 9);
    expect(fieldHeightAt(g, e, 0, 10)).toBeCloseTo(10, 9);
  });
  test('outside the outer nodes it holds the edge value (the half cell of border)', () => {
    expect(fieldHeightAt(g, e, -0.4, 4)).toBeCloseTo(4, 9);
  });
  test('land or no-data carries no height: -1 where ocean nodes hold under half the weight; ocean neighbours are not diluted', () => {
    const land = makeGrid({ west: 0, south: 0, east: 10, north: 10, cols: 11, rows: 11 }, (lat, lng) => ({ speed: 2, isOcean: lng >= 5 }));
    const le = fallbackFieldExtent(land);
    expect(fieldHeightAt(land, le, 2, 5)).toBe(-1);
    expect(fieldHeightAt(land, le, 4.4, 5)).toBe(-1);         // 40% ocean weight
    expect(fieldHeightAt(land, le, 4.6, 5)).toBeCloseTo(2, 9); // 60%: the ocean value, not 60% of it
    const nan = makeGrid({ west: 0, south: 0, east: 2, north: 2, cols: 3, rows: 3 }, () => ({ speed: NaN }));
    expect(fieldHeightAt(nan, fallbackFieldExtent(nan), 1, 1)).toBe(-1);
  });
});

describe('the picture (renderFallbackField)', () => {
  test.each(THEMES)('%s: every drawn pixel is the theme colour at the height its own coordinate interpolates to (within 1 of 255)', (theme) => {
    const g = makeGrid(WORLD, (lat, lng) => ({ speed: 4 + 3.9 * Math.sin((lat * Math.PI) / 60) * Math.cos((lng * Math.PI) / 45) }));
    const f = renderFallbackField(g, theme);
    expect(f.drawn).toBe(f.width * f.height);
    let worst = 0;
    for (let j = 0; j < f.height; j += 7) {
      for (let i = 0; i < f.width; i += 11) {
        const h = fieldHeightAt(g, f.extent, colLongitude(i, f.width, f.extent), rowLatitude(j, f.height, f.extent));
        const want = fallbackHeightColor(h, theme); const got = px(f, i, j);
        expect(got[3]).toBe(255);
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got[c] - want[c]));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
  test('CONTROL: with the heights shuffled among nodes, most pixels no longer match the unshuffled field', () => {
    const at = (lat, lng) => ({ speed: 4 + 3.9 * Math.sin((lat * Math.PI) / 60) * Math.cos((lng * Math.PI) / 45) });
    const g = makeGrid(WORLD, at);
    const shuffled = { ...g, vectors: g.vectors.map((p, k) => ({ ...p, speed: g.vectors[(k * 7919 + 13) % g.vectors.length].speed })) };
    const f = renderFallbackField(shuffled, 'light');
    let inside = 0; let n = 0;
    for (let j = 0; j < f.height; j += 7) {
      for (let i = 0; i < f.width; i += 11) {
        const want = fallbackHeightColor(fieldHeightAt(g, f.extent, colLongitude(i, f.width, f.extent), rowLatitude(j, f.height, f.extent)), 'light');
        const got = px(f, i, j); n += 1;
        if (Math.max(...[0, 1, 2].map((c) => Math.abs(got[c] - want[c]))) <= 1) inside += 1;
      }
    }
    expect(inside / n).toBeLessThan(0.2);
  });
  test.each([[0, 20], [40, -30], [70, 100], [84, -150]])('a single hot node at %d N, %d E peaks on its own coordinate (within one cell)', (lat0, lng0) => {
    const g = makeGrid(WORLD, (lat, lng) => ({ speed: Math.abs(lat - lat0) < 0.01 && Math.abs(lng - lng0) < 0.01 ? 12 : 0.5 }));
    const f = renderFallbackField(g, 'dark', { sample: (h) => { const v = Math.round((Math.min(12, h) / 12) * 255); return [v, v, v]; } });
    let best = -1; let bi = 0; let bj = 0;
    for (let j = 0; j < f.height; j++) for (let i = 0; i < f.width; i++) { const v = f.data[(j * f.width + i) * 4]; if (v > best) { best = v; bi = i; bj = j; } }
    expect(Math.abs(colLongitude(bi, f.width, f.extent) - lng0)).toBeLessThanOrEqual(f.extent.dLng);
    expect(Math.abs(rowLatitude(bj, f.height, f.extent) - lat0)).toBeLessThanOrEqual(f.extent.dLat);
  });
  test('a hot node in a box across the antimeridian peaks on its own coordinate, east of 180', () => {
    const box = { west: 170, south: -10, east: -170, north: 10, cols: 21, rows: 21 };
    const g = makeGrid(box, (lat, lng) => ({ speed: Math.abs(lat - 2) < 0.01 && Math.abs(lng - 184) < 0.01 ? 12 : 0.5 }));
    const f = renderFallbackField(g, 'dark', { sample: (h) => { const v = Math.round((Math.min(12, h) / 12) * 255); return [v, v, v]; } });
    let best = -1; let bi = 0; let bj = 0;
    for (let j = 0; j < f.height; j++) for (let i = 0; i < f.width; i++) { const v = f.data[(j * f.width + i) * 4]; if (v > best) { best = v; bi = i; bj = j; } }
    expect(Math.abs(colLongitude(bi, f.width, f.extent) - 184)).toBeLessThanOrEqual(f.extent.dLng);
    expect(Math.abs(rowLatitude(bj, f.height, f.extent) - 2)).toBeLessThanOrEqual(f.extent.dLat);
  });
  test('north first: a grid that is high only in its northern rows is bright only at the top of the bitmap', () => {
    const g = makeGrid({ west: 0, south: 0, east: 20, north: 20, cols: 11, rows: 11 }, (lat) => ({ speed: lat > 15 ? 10 : 0 }));
    const f = renderFallbackField(g, 'dark', { sample: (h) => { const v = Math.round((Math.min(10, h) / 10) * 255); return [v, v, v]; } });
    expect(px(f, 5, 0)[0]).toBeGreaterThan(200);
    expect(px(f, 5, f.height - 1)[0]).toBeLessThan(20);
  });
  test('land and no-data are transparent (alpha 0, every such pixel) and ocean is opaque', () => {
    const g = makeGrid({ west: 0, south: 0, east: 20, north: 20, cols: 21, rows: 21 }, (lat, lng) => ({ speed: 2, isOcean: lng > 10 }));
    const f = renderFallbackField(g, 'beach');
    for (let j = 0; j < f.height; j++) {
      for (let i = 0; i < f.width; i++) {
        const lng = colLongitude(i, f.width, f.extent);
        if (lng < 9.4) expect(px(f, i, j)[3]).toBe(0);
        if (lng > 10.6) expect(px(f, i, j)[3]).toBe(255);
      }
    }
  });
  test('nothing of ours to draw: null for no grid, a malformed grid and an all-land grid', () => {
    expect(renderFallbackField(null, 'light')).toBeNull();
    expect(renderFallbackField({ bounds: { west: 0, south: 0, east: 1, north: 1 }, cols: 2, rows: 2, vectors: [] }, 'light')).toBeNull();
    expect(renderFallbackField(makeGrid({ west: 0, south: 0, east: 2, north: 2, cols: 3, rows: 3 }, () => ({ speed: 1, isOcean: false })), 'light')).toBeNull();
  });
  test('THE KILL draws nothing, and is read per draw', () => {
    const g = makeGrid({ west: 0, south: 0, east: 2, north: 2, cols: 3, rows: 3 }, () => ({ speed: 1 }));
    const win = {};
    expect(ownMarineFallbackKilled(win)).toBe(false);
    expect(renderFallbackField(g, 'light', { win })).not.toBeNull();
    win.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = true;
    expect(ownMarineFallbackKilled(win)).toBe(true);
    expect(renderFallbackField(g, 'light', { win })).toBeNull();
    win.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = 'true';   // only the boolean kills
    expect(renderFallbackField(g, 'light', { win })).not.toBeNull();
  });
  test('the world grid redraws inside its budget on this machine (a smoke bound, not the gate\'s F7)', () => {
    const g = makeGrid(WORLD, (lat, lng) => ({ speed: 2 + Math.sin(lat / 9) + Math.cos(lng / 17) }));
    renderFallbackField(g, 'light');
    const t0 = Date.now(); for (let k = 0; k < 5; k++) renderFallbackField(g, 'light');
    expect((Date.now() - t0) / 5).toBeLessThan(250);
  });
});

describe('what counts as a height, and why there may be nothing to draw', () => {
  test('a node\'s height is `height`, else `speed`, as the marine engine reads it; land, invalid and non-numbers carry none', () => {
    expect(nodeHeight({ isOcean: true, height: 2.5, speed: 9 })).toBe(2.5);
    expect(nodeHeight({ isOcean: true, speed: 1.5 })).toBe(1.5);
    expect(nodeHeight({ isOcean: false, speed: 1.5 })).toBe(-1);
    expect(nodeHeight({ isOcean: true, is_valid: false, speed: 1.5 })).toBe(-1);
    expect(nodeHeight({ isOcean: true, speed: NaN })).toBe(-1);
    expect(nodeHeight({ isOcean: true, speed: -1 })).toBe(-1);
    expect(nodeHeight(null)).toBe(-1);
  });
  test('a cell the layer marks invalid (is_valid false) is transparent in the picture', () => {
    const g = makeGrid({ west: 0, south: 0, east: 20, north: 20, cols: 21, rows: 21 }, () => ({ speed: 2 }));
    g.vectors.forEach((p) => { if (p && g.vectors.indexOf(p) % 21 < 8) p.is_valid = false; });
    const f = renderFallbackField(g, 'light');
    expect(px(f, 2, Math.floor(f.height / 2))[3]).toBe(0);
    expect(px(f, f.width - 3, Math.floor(f.height / 2))[3]).toBe(255);
  });
  test('A SURF-RATING GRID IS NEVER DRAWN AS HEIGHT: its height field carries scores', () => {
    const g = makeGrid({ west: 0, south: 0, east: 2, north: 2, cols: 3, rows: 3 }, () => ({ speed: 77 }));
    g.ratingMode = true;
    expect(whyNoFallbackField(g, {})).toBe('rating_grid');
    expect(renderFallbackField(g, 'light', { win: {} })).toBeNull();
  });
  test('the reasons: killed before anything else, then a rating grid, then no grid; null when there is a field to draw', () => {
    const g = makeGrid({ west: 0, south: 0, east: 2, north: 2, cols: 3, rows: 3 }, () => ({ speed: 1 }));
    expect(whyNoFallbackField(g, {})).toBeNull();
    expect(whyNoFallbackField(null, {})).toBe('no_grid');
    expect(whyNoFallbackField({ ...g, vectors: [] }, {})).toBe('no_grid');
    expect(whyNoFallbackField({ ...g, ratingMode: true }, { __RAW_DISABLE_OWN_MARINE_FALLBACK__: true })).toBe('killed');
  });
});

describe('the colours', () => {
  test.each(THEMES)('%s: the lookup table is within 1 of 255 of the colour function at every height from 0 to 16 m', (theme) => {
    const lut = heightLut(theme); let worst = 0;
    for (let h = 0; h <= 16; h += 0.0137) {
      const want = fallbackHeightColor(h, theme); const k = lutIndex(h) * 3;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(lut[k + c] - want[c]));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
  test('heights past the table take its last entry; negative and non-numeric heights take the first', () => {
    expect(lutIndex(999)).toBe(lutIndex(20)); expect(lutIndex(-3)).toBe(0);
    expect(fallbackHeightColor('x', 'dark')).toEqual(fallbackHeightColor(0, 'dark'));
  });
  test('the three themes draw three different pictures of the same sea', () => {
    const at2m = THEMES.map((t) => fallbackHeightColor(2, t).join(','));
    expect(new Set(at2m).size).toBe(3);
  });
  test('ONE TEST, BOTH SOURCES: dark\'s fallback colours are the shader\'s own dark wash at its anchor heights', () => {
    // The anchors are READ from the shader's source text, not copied here, so the JS mirror and the GLSL cannot drift apart.
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineShaders.js'), 'utf8');
    const fn = src.slice(src.indexOf('vec3 getThemedWaveColor('));
    const dark = fn.slice(fn.indexOf('// Dark Mode:'), fn.indexOf('// v5 (2026-07-04): non-surf low-band HUE rotation'));
    const vec = (text, name) => { const m = text.match(new RegExp(`\\b${name} = vec3\\(([^)]+)\\)`)); if (!m) throw new Error(`no ${name}`); return m[1].split(',').map((x) => Math.round(parseFloat(x) * 255)); };
    const anchors = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].map((n) => vec(dark, n));
    // the non-surf overrides for dark: the last c1 and c0 assignments inside the `surfMode < 0.5` block's dark branch
    const nonSurf = fn.slice(fn.indexOf('if (surfMode < 0.5) {'), fn.indexOf('// Interpolation band splits'));
    const darkBranch = nonSurf.slice(nonSurf.lastIndexOf('} else {'));
    anchors[1] = vec(darkBranch, 'c1'); anchors[0] = vec(darkBranch, 'c0');
    const heights = [0, 0.6, 1.2, 2.4, 5, 10];   // getNonlinearT's anchor heights (t = 0, 0.20, 0.46, 0.72, 0.94, 1)
    heights.forEach((h, k) => {
      const js = fallbackHeightColor(h, 'dark');
      for (let c = 0; c < 3; c++) expect(Math.abs(js[c] - anchors[k][c])).toBeLessThanOrEqual(1);
    });
    // and between anchors the JS is the straight blend the shader's mix() draws
    const mid = fallbackHeightColor(0.9, 'dark');
    for (let c = 0; c < 3; c++) expect(Math.abs(mid[c] - (anchors[1][c] + anchors[2][c]) / 2)).toBeLessThanOrEqual(1);
    expect(getThemedWaveColorJS(1.2, 'dark', false).map(Math.round)).toEqual(fallbackHeightColor(1.2, 'dark'));
  });
  test('the opacity is the zoom ramp the tile fallback\'s marine slots used', () => {
    expect(FALLBACK_OPACITY_STOPS).toEqual([[2, 0.22], [5, 0.28], [8, 0.35], [12, 0.40]]);
    expect(fallbackOpacityExpression()).toEqual(['interpolate', ['linear'], ['zoom'], 2, 0.22, 5, 0.28, 8, 0.35, 12, 0.40]);
  });
});
