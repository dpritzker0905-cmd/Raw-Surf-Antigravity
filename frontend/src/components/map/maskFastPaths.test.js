/**
 * maskFastPaths.js — every fast path must give the SAME answer as the code it replaces.
 * The replay bench (scripts/visual-lab/mask_split.js, docs/weather-program/log) checks whole canvases on real captured
 * paints; these tests pin each piece on its own, including the edge cases a capture may not contain.
 */
import {
  fastLandMaskOn, stampVerdict, sampleOpenWaterDamage, rectRowReader, captureNeRows, ringCopiesTouchRect, latRangeOf,
} from './maskFastPaths';
import { overlayBasemapWaterOnMask } from './WebGLMarineMaskRenderer';

// Deterministic PRNG so a failure reproduces.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// A blobby land/water grid: random discs of land on water (or the reverse), so channels, enclosed basins, passages and
// border-touching seas all occur.
function blobGrid(w, h, seed, discs, invert) {
  const r = rng(seed); const g = new Uint8Array(w * h).fill(invert ? 0 : 1);
  for (let k = 0; k < discs; k++) {
    const cx = r() * w, cy = r() * h, rad = 1 + r() * Math.max(2, Math.min(w, h) / 6);
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(h, cy + rad); y++)
      for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(w, cx + rad); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) g[y * w + x] = invert ? 1 : 0;
  }
  return g;
}

afterEach(() => { delete window.__RAW_DISABLE_FAST_LAND_MASK__; });

describe('stampVerdict draws only the opaque texels, at the same integer scale', () => {
  const ctx = () => ({ calls: [], drawImage(...a) { this.calls.push(a); } });
  test('integer scale: one sub-rect draw aligned to whole texels', () => {
    const c = ctx(); const flags = new Uint8Array(8 * 4); flags[1 * 8 + 2] = 1; flags[2 * 8 + 5] = 1;
    stampVerdict(c, 'ds', flags, 8, 4, 32, 16);
    expect(c.calls).toEqual([['ds', 2, 1, 4, 2, 8, 4, 16, 8]]);
  });
  test('nothing opaque: no draw (the full draw would be a no-op under source-over)', () => {
    const c = ctx(); stampVerdict(c, 'ds', new Uint8Array(16), 4, 4, 16, 16); expect(c.calls).toEqual([]);
  });
  test('non-integer scale and the kill switch both keep the original full draw', () => {
    const flags = new Uint8Array(16); flags[5] = 1;
    const c1 = ctx(); stampVerdict(c1, 'ds', flags, 4, 4, 10, 10); expect(c1.calls).toEqual([['ds', 0, 0, 10, 10]]);
    window.__RAW_DISABLE_FAST_LAND_MASK__ = true; expect(fastLandMaskOn()).toBe(false);
    const c2 = ctx(); stampVerdict(c2, 'ds', flags, 4, 4, 16, 16); expect(c2.calls).toEqual([['ds', 0, 0, 16, 16]]);
  });
});

describe('open-water plausibility: sampled rows give the original verdict', () => {
  // The original loop, verbatim, over whole-rect reads.
  function original(cur, ne, sw, sh) {
    const step = Math.max(4, Math.floor(Math.min(sw, sh) / 64)); const ring = Math.max(4, step);
    let neOpen = 0, falseLand = 0;
    for (let y = ring; y < sh - ring; y += step) for (let x = ring; x < sw - ring; x += step) {
      const i = (y * sw + x) * 4; if (ne[i] < 200) continue;
      const iN = ((y - ring) * sw + x) * 4, iS = ((y + ring) * sw + x) * 4, iW = (y * sw + (x - ring)) * 4, iE = (y * sw + (x + ring)) * 4;
      if (ne[iN] < 200 || ne[iS] < 200 || ne[iW] < 200 || ne[iE] < 200) continue;
      neOpen++; if (cur[i] < 30) falseLand++;
    }
    return { neOpen, falseLand };
  }
  const fakeCtx = (W, H, data) => ({ getImageData: (x, y, w, h) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) out.set(data.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
    return { data: out };
  } });
  test.each([[300, 200, 1], [97, 61, 2], [1000, 260, 3], [40, 40, 4]])('W=%i H=%i seed=%i', (W, H, seed) => {
    const r = rng(seed); const ne = new Uint8ClampedArray(W * H * 4), cur = new Uint8ClampedArray(W * H * 4);
    const g = blobGrid(W, H, seed, 30, false);
    for (let i = 0; i < W * H; i++) { ne[i * 4] = g[i] ? 255 : 0; cur[i * 4] = g[i] && r() < 0.8 ? 255 : (r() < 0.5 ? 0 : 64); }
    const sx = 3, sy = 2, sw = W - 7, sh = H - 5;
    const crop = (d) => { const o = new Uint8ClampedArray(sw * sh * 4); for (let y = 0; y < sh; y++) o.set(d.subarray(((sy + y) * W + sx) * 4, ((sy + y) * W + sx + sw) * 4), y * sw * 4); return o; };
    const want = original(crop(cur), crop(ne), sw, sh);
    const got = sampleOpenWaterDamage(sw, sh, rectRowReader(fakeCtx(W, H, cur), sx, sy, sw, sh, false), captureNeRows(fakeCtx(W, H, ne), sx, sy, sw, sh));
    const gotWhole = sampleOpenWaterDamage(sw, sh, rectRowReader(fakeCtx(W, H, cur), sx, sy, sw, sh, true), rectRowReader(fakeCtx(W, H, ne), sx, sy, sw, sh, true));
    expect(got).toEqual(want); expect(gotWhole).toEqual(want);
  });
});

describe('ringCopiesTouchRect bounds the projected ring exactly', () => {
  const rawXY = (lng, lat) => [(lng + 180) * 10, (90 - lat) * 10];   // separable, monotone
  const rect = { x0: 1000, y0: 500, x1: 1100, y1: 600 };
  test('inside, outside, within the margin, and a copy offset that lands inside', () => {
    expect(ringCopiesTouchRect(rawXY, -78, -77, 35, 36, [0], rect, 2)).toBe(true);
    expect(ringCopiesTouchRect(rawXY, -60, -59, 35, 36, [0], rect, 2)).toBe(false);
    expect(ringCopiesTouchRect(rawXY, -69.85, -69.7, 35, 36, [0], rect, 2)).toBe(true);    // x0 = 1101.5 <= 1102
    expect(ringCopiesTouchRect(rawXY, -78, -77, 35, 36, [-360, 0], rect, 2)).toBe(true);
    expect(ringCopiesTouchRect(rawXY, 282, 283, 35, 36, [-360], rect, 2)).toBe(true);
  });
  test('a ring that cannot be bounded is never culled', () => {
    expect(ringCopiesTouchRect(rawXY, NaN, -77, 35, 36, [0], rect, 2)).toBe(true);
    expect(latRangeOf([[[0, 1], [0, 3]], [[0, -2]]])).toEqual([-2, 3]);
  });
});

describe('overlayBasemapWaterOnMask: fill-only traces drop closePath, the stroked wetland trace keeps it', () => {
  function recCanvas(W, H) {
    const log = { closePath: 0, fill: 0, stroke: 0 };
    const ctx = {
      log, canvas: null, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, moveTo() {}, lineTo() {},
      closePath() { log.closePath++; }, fill() { log.fill++; }, stroke() { log.stroke++; },
      drawImage() {}, putImageData() {}, getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    };
    const canvas = { width: W, height: H, getContext: () => ctx };
    ctx.canvas = canvas; return { canvas, log };
  }
  const square = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const map = (wetlands) => ({
    getBounds: () => ({ getWest: () => -80, getSouth: () => 25, getEast: () => -79, getNorth: () => 26 }),
    querySourceFeatures: (src, o) => (o && o.sourceLayer === 'landuse_overlay' ? wetlands : []),
  });
  // One water polygon with 3 island holes inside the view (-80..-79, 25..26); three wetlands: one in the view, one on the
  // canvas but outside the view clip (culled), and one with no copy in the window at all, right after the culled one. The
  // original re-strokes "the current path" for that last one (the culled wetland's): invisible, so the fast path skips it.
  const water = { waterSource: 'composite', usedSourceFallback: false, feats: [{ properties: {}, geometry: { type: 'Polygon', coordinates: [
    square(-81, 24, -78, 27), square(-79.9, 25.1, -79.8, 25.2), square(-79.5, 25.5, -79.4, 25.6), square(-79.2, 25.2, -79.1, 25.3)] } }] };
  const wet = [
    { properties: { class: 'wetland' }, geometry: { type: 'Polygon', coordinates: [square(-79.6, 25.4, -79.55, 25.45)] } },
    { properties: { class: 'wetland' }, geometry: { type: 'Polygon', coordinates: [square(-81.6, 27.4, -81.5, 27.5)] } },
    { properties: { class: 'wetland' }, geometry: { type: 'Polygon', coordinates: [square(-70, 40, -69.9, 40.1)] } },
  ];
  const bounds = { west: -82, south: 24, east: -78, north: 28 };
  test('fast path: no closePath on the water fills; only the in-view wetland is traced and stroked', () => {
    const { canvas, log } = recCanvas(64, 64);
    expect(overlayBasemapWaterOnMask(canvas, bounds, map(wet), water)).toBeTruthy();
    expect(log.closePath).toBe(1);
    expect(log.stroke).toBe(1);
  });
  test('kill switch: every ring closed, both on-window wetlands traced, three strokes (incl. the re-stroke), as before', () => {
    window.__RAW_DISABLE_FAST_LAND_MASK__ = true;
    const { canvas, log } = recCanvas(64, 64);
    expect(overlayBasemapWaterOnMask(canvas, bounds, map(wet), water)).toBeTruthy();
    expect(log.closePath).toBe(4 + 3 + 2);   // water polygon rings + 3 hole passes + 2 wetlands with a copy
    expect(log.stroke).toBe(3);
  });
});
