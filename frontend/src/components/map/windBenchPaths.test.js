/**
 * The wind bench's PATH mode (frontend/scripts/wind-bench/paths.js + ambiguity.js), on synthetic inputs with known answers:
 * the camera paths (deterministic, bounded, at rest at both ends), CIEDE2000 against Sharma et al.'s reference pairs, and
 * each metric with a positive and a null control.
 */
import { PATH_NAMES, pathFrames, sampleIndexes, Z_MIN, Z_MAX, BOX, perPx } from '../../../scripts/wind-bench/paths';
import { de00, binOf, labTable, labOf, warpDiff, hueFidelity, coastMetrics, frameMetrics, colourEdges, pops } from '../../../scripts/wind-bench/ambiguity';
import { mercY } from '../../../scripts/wind-bench/camera';

describe('camera paths', () => {
  it('every kind of hand movement is there', () => {
    expect(PATH_NAMES).toEqual(['pan', 'fling', 'zoomIn', 'zoomOut', 'pinch', 'jitter', 'erratic']);
  });
  it.each(PATH_NAMES)('%s: deterministic, at rest at both ends, zoom within the bench range', (name) => {
    const a = pathFrames(name, 2), b = pathFrames(name, 2);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
    expect(a[1]).toEqual(a[0]);                                       // held before
    expect(a[a.length - 1]).toEqual(a[a.length - 2]);                 // and after
    for (const f of a) { expect(f.z).toBeGreaterThanOrEqual(Z_MIN - 0.5); expect(f.z).toBeLessThanOrEqual(Z_MAX); }
  });
  it('zoomIn / zoomOut cross the close-zoom ramp (z6-7.5) in both directions; jitter covers its whole width', () => {
    const span = (n) => { const z = pathFrames(n).map((f) => f.z); return [Math.min(...z), Math.max(...z)]; };
    expect(span('zoomIn')).toEqual([5, 10.5]);
    expect(span('zoomOut')).toEqual([5, 11]);
    const [lo, hi] = span('jitter');
    expect(lo).toBeLessThan(6); expect(hi).toBeGreaterThan(7.5);
  });
  it('erratic: seeds differ, stay over the served grid, include one-frame jumps and reach both zoom extremes over seeds', () => {
    expect(pathFrames('erratic', 1)).not.toEqual(pathFrames('erratic', 2));
    let zLo = Infinity, zHi = -Infinity, jumps = 0;
    for (const seed of [1, 2, 3]) {
      const f = pathFrames('erratic', seed);
      for (let i = 1; i < f.length; i++) {
        expect(f[i].lng).toBeGreaterThanOrEqual(BOX.west - 1e-9); expect(f[i].lng).toBeLessThanOrEqual(BOX.east + 1e-9);
        const px = Math.hypot(((f[i].lng - f[i - 1].lng) / 360) / perPx(f[i].z), (mercY(f[i].lat) - mercY(f[i - 1].lat)) / perPx(f[i].z));
        if (px > 120) jumps++;
        zLo = Math.min(zLo, f[i].z); zHi = Math.max(zHi, f[i].z);
      }
    }
    expect(jumps).toBeGreaterThan(0);
    expect(zLo).toBeLessThan(5); expect(zHi).toBe(11);
  });
  it('pinch: the zoom never moves the point under the fingers; only their drift does (exactly)', () => {
    const f = pathFrames('pinch'), focal = (c) => ({ x: (c.lng + 180) / 360 + 224 * perPx(c.z), y: mercY(c.lat) - 183 * perPx(c.z) });
    let ex = 0, ey = 0;   // frames 20-139 are the gesture; 140 on are held
    for (let i = 21; i <= 139; i++) { ex += (-200 / 120) * perPx(f[i].z); ey += (90 / 120) * perPx(f[i].z); }
    const a = focal(f[20]), b = focal(f[140]);
    expect(Math.abs(b.x - a.x - ex) / perPx(f[140].z)).toBeLessThan(0.01);   // css px (frames carry z to 5 decimals)
    expect(Math.abs(b.y - a.y - ey) / perPx(f[140].z)).toBeLessThan(0.01);
    expect(f[140].z).toBeCloseTo(9.5, 6);
  });
  it('sampleIndexes: every n-th frame and the last', () => {
    expect(sampleIndexes(10, 4)).toEqual([0, 4, 8, 9]);
    expect(sampleIndexes(9, 4)).toEqual([0, 4, 8]);
  });
});

describe('CIEDE2000 (Sharma, Wu & Dalal 2005 reference pairs)', () => {
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ])('%j vs %j', (a, b, want) => { expect(de00(...a, ...b)).toBeCloseTo(want, 4); });
});

const lut = labTable();
const img = (w, h, f) => { const bins = new Uint32Array(w * h); for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) bins[r * w + x] = binOf(...f(x, r)); return { w, h, bins }; };
const texture = (dx, dy) => (x, r) => [((x + dx) * 37) % 256, ((r + dy) * 53) % 256, (((x + dx) * (r + dy)) % 7) * 30];

describe('warpDiff: the exact camera change, no optical flow', () => {
  const geom = { cssW: 200, cssH: 160, px: 2 }, w = 100, h = 80;
  it('a pan east by 10 image px warps back to zero (and a wrong shift does not)', () => {
    const z = 8, cam0 = { lng: -88, lat: 30, z }, cam1 = { lng: -88 + 20 * perPx(z) * 360, lat: 30, z };
    expect(warpDiff(img(w, h, texture(0, 0)), cam0, img(w, h, texture(10, 0)), cam1, geom, lut).mean).toBe(0);
    expect(warpDiff(img(w, h, texture(0, 0)), cam0, img(w, h, texture(13, 0)), cam1, geom, lut).mean).toBeGreaterThan(10);
  });
  it('a pan north: rows run bottom-up (readPixels), mercator y grows south', () => {
    const z = 8, cam0 = { lng: -88, lat: 30, z }, y1 = mercY(30) - 20 * perPx(z), lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y1))) * 180 / Math.PI;
    const r = warpDiff(img(w, h, texture(0, 0)), cam0, img(w, h, texture(0, 10)), { lng: -88, lat: lat1, z }, geom, lut);
    expect(r.mean).toBeLessThan(0.5);
  });
  it('a zoom-in by 1 about the centre: each pixel maps to half its offset in the previous frame', () => {
    const cam0 = { lng: -88, lat: 30, z: 8 }, cam1 = { lng: -88, lat: 30, z: 9 }, cx = w / 2, cy = h / 2;
    const scene = (x, r) => [Math.round(x) * 2 % 256, Math.round(r) * 3 % 256, 90];
    const prev = img(w, h, (x, r) => scene(x, r)), next = img(w, h, (x, r) => scene(Math.floor(cx + (x + 0.5 - cx) / 2), Math.floor(cy + (r + 0.5 - cy) / 2)));
    expect(warpDiff(prev, cam0, next, cam1, geom, lut).mean).toBeLessThan(0.5);
  });
});

describe('hueFidelity', () => {
  const legend = (v) => (v < 20 ? labOf(60, 180, 90) : labOf(230, 170, 30));   // green below 20 kn, gold above
  it('a gold field shown gold scores 0; the same field bent green by the ground scores 1 (positive control)', () => {
    const speeds = new Float32Array(400).fill(35), gold = img(20, 20, () => [230, 170, 30]), green = img(20, 20, () => [120, 180, 90]);
    expect(hueFidelity(gold, speeds, legend, lut).over30).toBe(0);
    expect(hueFidelity(green, speeds, legend, lut).over30).toBe(1);
  });
  it('greys (no hue to judge) and calm or unknown speeds are not scored', () => {
    const speeds = new Float32Array(400).fill(35);
    expect(hueFidelity(img(20, 20, () => [128, 128, 128]), speeds, legend, lut).n).toBe(0);
    expect(hueFidelity(img(20, 20, () => [120, 180, 90]), new Float32Array(400).fill(2), legend, lut).n).toBe(0);
    expect(hueFidelity(img(20, 20, () => [120, 180, 90]), new Float32Array(400).fill(NaN), legend, lut).n).toBe(0);
  });
});

describe('coastMetrics', () => {
  const w = 40, h = 10, wet = new Uint8Array(w * h).map((_, i) => ((i % w) < 20 ? 1 : 0));
  const orig = img(w, h, (x) => (x < 20 ? [168, 214, 222] : [236, 236, 232]));
  it('a tint that keeps land and water apart keeps the coast; one that paints both the same colour erases it', () => {
    const keep = coastMetrics(orig, orig, wet, lut), erase = coastMetrics(orig, img(w, h, () => [120, 180, 120]), wet, lut);
    expect(keep.n).toBe(h); expect(keep.coastKept).toBe(1); expect(keep.coastDE).toBeGreaterThan(10);
    expect(erase.coastDE).toBe(0); expect(erase.coastKept).toBe(0);
  });
});

describe('frameMetrics mimicry and windLike', () => {
  const w = 40, h = 20, wet = new Uint8Array(w * h).map((_, i) => ((i % w) < 20 ? 1 : 0));
  const water = [168, 214, 222], land = [236, 236, 232], park = [190, 225, 170];
  const off = img(w, h, (x, r) => (x < 20 ? water : (r < 4 ? park : land)));
  const legendBins = [binOf(150, 120, 230), binOf(230, 170, 30)];
  it('land tinted into the park colour reads as park (positive); land tinted violet reads as nothing on the map (null)', () => {
    const asPark = img(w, h, (x, r) => (x < 20 ? water : park)), asViolet = img(w, h, (x, r) => (x < 20 ? water : (r < 4 ? park : [200, 190, 235])));
    const p = frameMetrics({ off, comp: asPark, wet, legendBins, lut }), n = frameMetrics({ off, comp: asViolet, wet, legendBins, lut });
    expect(p.mapLike).toBe(1); expect(p.pairs[0].swap).toBe('land:grey>land:green');
    expect(n.mapLike).toBe(0); expect(n.cover).toBeGreaterThan(0);
  });
  it('windLike: a map colour inside the legend gamut counts; the same map without it does not', () => {
    const goldPark = img(w, h, (x, r) => (x < 20 ? water : (r < 10 ? [230, 170, 30] : land)));
    expect(frameMetrics({ off: goldPark, comp: goldPark, wet, legendBins, lut }).windLike).toBeCloseTo(0.25, 2);
    expect(frameMetrics({ off, comp: off, wet, legendBins, lut }).windLike).toBe(0);
  });
  it('style convention: tinted land landing on the style\'s wood green is a swap even with no wood on screen', () => {
    const wood = [150, 200, 120], stylePal = [{ k: binOf(...land), label: 'land' }, { k: binOf(...water), label: 'water' }, { k: binOf(...wood), label: 'landcover' }];
    const plain = img(w, h, (x) => (x < 20 ? water : land)), comp = img(w, h, (x) => (x < 20 ? water : wood));
    expect(frameMetrics({ off: plain, comp, orig: plain, wet, legendBins, stylePal, lut }).mapLikeConv).toBe(1);
  });
});

describe('colourEdges and pops', () => {
  it('a hue-only edge is kept by a lightness-keeping tint and lost when the ground is greyed', () => {
    const ref = img(20, 4, (x) => (x < 10 ? [190, 225, 170] : [236, 226, 236])), grey = img(20, 4, (x) => (x < 10 ? [218, 218, 218] : [231, 231, 231]));
    const r = colourEdges(ref, [ref, grey], lut);
    expect(r.edges).toBeGreaterThan(0);
    expect(r.kept).toEqual([1, 0]);
  });
  it('pops: a one-sample flash and a one-sample drop-out are found; a steady ramp is not', () => {
    expect(pops([10, 10, 30, 10, 10, 2, 10])).toEqual([2, 5]);
    expect(pops([10, 11, 12, 13, 14, 15])).toEqual([]);
  });
});
