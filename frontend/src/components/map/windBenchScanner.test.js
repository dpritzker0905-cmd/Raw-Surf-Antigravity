/**
 * The wind bench's artifact scanner (frontend/scripts/wind-bench/), tested on block grids whose
 * answer is known. It lives here, not beside the scanner, because CRA's Jest only discovers tests
 * under src/ and CI must run it. The scanner is a dev tool: nothing in the app imports it.
 */
import {
  DEFAULTS, mulberry32, upperMedian, blockStats, ringResiduals, findClusters, nullMaxSizes, quantileOf, scanBlocks,
} from '../../../scripts/wind-bench/scanner';
import { POSITIVE_CONTROL, VIEWS, buildMatrix, controlConfigs, evaluateControl } from '../../../scripts/wind-bench/matrix';
import { identicalVariantPairs } from '../../../scripts/wind-bench/report';
import { sameShape, recurringShapes, mergeSeeds, controlAcrossSeeds } from '../../../scripts/wind-bench/replicates';

const grid = (bw, bh, fn) => Float64Array.from({ length: bw * bh }, (_, i) => fn(i % bw, Math.floor(i / bw)));
const at = (bw, x, y) => y * bw + x;

describe('upperMedian and quantileOf', () => {
  test('upper median of an even list takes the higher middle value', () => {
    expect(upperMedian([3, 1, 2])).toBe(2);
    expect(upperMedian([4, 1, 3, 2])).toBe(3);
  });
  test('the 95th percentile of 30 null maxima is the 29th smallest', () => {
    expect(quantileOf([...Array(30).keys()], 0.95)).toBe(28);
    expect(quantileOf([], 0.95)).toBe(0);
  });
  test('the RNG is seeded: same seed, same stream', () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect(c()).not.toBe(sa[0]);
    sa.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
  });
});

describe('blockStats: trail pixels to 32 css px blocks', () => {
  // 64 x 64 css px at DPR 2 = 128 x 128 device px = 2 x 2 blocks. readPixels rows run bottom-up.
  const devW = 128, devH = 128;
  const pixels = new Uint8Array(devW * devH * 4);
  const paint = (x, yFromTop, rgb) => { pixels.set(rgb, ((devH - 1 - yFromTop) * devW + x) * 4); };
  for (let y = 0; y < devH; y++) for (let x = 0; x < devW; x++) paint(x, y, [10, 10, 10]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) paint(x, y, [0, 250, 0]); // top-left block, green only
  const s = blockStats(pixels, devW, devH, 64, 64, 2);

  test('the top-left block ON SCREEN is the bright one (rows are flipped) and ink is max(R,G,B)', () => {
    expect([s.bw, s.bh]).toEqual([2, 2]);
    expect(s.ink[at(2, 0, 0)]).toBe(250);
    expect([s.ink[at(2, 1, 0)], s.ink[at(2, 0, 1)], s.ink[at(2, 1, 1)]]).toEqual([10, 10, 10]);
  });
  test('saturation is the share of sampled pixels above 200, lit counts only pixels above 32', () => {
    expect(s.saturatedFrac).toBeCloseTo(0.25, 10);
    expect(s.litN[at(2, 0, 0)]).toBe(32 * 32); // stride 2 over 64 x 64 device px
    expect(s.litN[at(2, 1, 1)]).toBe(0);
    expect(s.litSum[at(2, 0, 0)] / s.litN[at(2, 0, 0)]).toBe(250);
  });
});

describe('ringResiduals: ink over the median of the blocks 2-4 away', () => {
  test('a smooth field reads 1 and one dim block reads its ratio, without disturbing its neighbours', () => {
    const ink = grid(12, 12, (x, y) => (x === 6 && y === 6 ? 50 : 100));
    const res = ringResiduals(ink, 12, 12);
    expect(res[at(12, 6, 6)]).toBe(0.5);
    expect(res[at(12, 7, 6)]).toBe(1);
    expect(res[at(12, 0, 0)]).toBe(1); // a corner still has 21 reference blocks
  });
  test('fewer than 20 reference blocks gives no residual', () => {
    const res = ringResiduals(grid(5, 5, () => 100), 5, 5); // the centre sees only the 16 border blocks
    expect(res[at(5, 2, 2)]).toBeNaN();
  });
  test('invalid blocks get no residual and are nobody\'s reference', () => {
    const ink = grid(12, 12, (x, y) => (x < 3 || y < 3 ? 0 : 100)); // no grid over an L of 3 rows + 3 columns: ink 0
    const valid = Uint8Array.from(ink, (v) => (v > 0 ? 1 : 0));
    const res = ringResiduals(ink, 12, 12, valid);
    expect(res[at(12, 1, 5)]).toBeNaN();
    expect(res[at(12, 4, 4)]).toBe(1); // 45 of its 72 ring blocks have no data: unmasked, its reference would be 0
  });
  test('a zero reference median gives no residual', () => {
    expect(ringResiduals(grid(12, 12, () => 0), 12, 12)[at(12, 6, 6)]).toBeNaN();
  });
});

describe('findClusters: 4-connected, same sign, strict thresholds', () => {
  const res = grid(8, 8, () => 1);
  res[at(8, 1, 1)] = 0.5; res[at(8, 2, 1)] = 0.6;   // horizontal pair of lows: one HOLE
  res[at(8, 5, 5)] = 0.5; res[at(8, 6, 6)] = 0.5;   // diagonal only: two clusters
  res[at(8, 3, 1)] = 1.6;                           // a high touching the low pair: its own BLOB
  res[at(8, 0, 7)] = DEFAULTS.lo; res[at(8, 7, 0)] = DEFAULTS.hi; res[at(8, 7, 7)] = NaN; // never flagged
  const clusters = findClusters(res, 8, 8);

  test('the clusters and their signs', () => {
    expect(clusters.map((c) => [c.low, c.cells])).toEqual([
      [true, [at(8, 1, 1), at(8, 2, 1)]],
      [false, [at(8, 3, 1)]],
      [true, [at(8, 5, 5)]],
      [true, [at(8, 6, 6)]],
    ]);
    expect(clusters[0].meanRes).toBeCloseTo(0.55, 10);
  });
});

describe('the permutation null and scanBlocks on a known storm', () => {
  // 28 x 28 blocks (the bench's 897 x 914 px screen). Smooth ink with +-6% texture, a 5 x 5 HOLE
  // under 44 kn air and a 4 x 4 BLOB under 34 kn air: the casing-pole defect, drawn by hand.
  const bw = 28, bh = 28;
  const texture = mulberry32(99);
  const base = grid(bw, bh, () => 120 * (1 + 0.12 * (texture() - 0.5)));
  const inHole = (x, y) => x >= 4 && x < 9 && y >= 5 && y < 10;
  const inBlob = (x, y) => x >= 17 && x < 21 && y >= 16 && y < 20;
  const ink = grid(bw, bh, (x, y) => (inHole(x, y) ? 50 : inBlob(x, y) ? 210 : base[at(bw, x, y)]));
  const speed = Array.from({ length: bw * bh }, (_, i) => {
    const x = i % bw, y = Math.floor(i / bw);
    return inHole(x, y) ? 44 : inBlob(x, y) ? 34 : 20;
  });

  test('the null scatters the shapes: chance clusters are far smaller than the real ones', () => {
    const maxima = nullMaxSizes(ink, bw, bh, null);
    expect(maxima).toHaveLength(DEFAULTS.shuffles);
    expect(maxima).toEqual([...maxima].sort((a, b) => a - b));
    expect(quantileOf(maxima, 0.95)).toBeLessThan(16);
    expect(nullMaxSizes(ink, bw, bh, null)).toEqual(maxima); // seeded: the same grid, the same null
  });

  test('both shapes are significant artifacts at the right speeds and places', () => {
    const scan = scanBlocks({ bw, bh, ink, speed });
    expect(scan.artifacts).toBe(2);
    const hole = scan.significant.find((c) => c.kind === 'HOLE');
    const blob = scan.significant.find((c) => c.kind === 'BLOB');
    expect(hole).toMatchObject({ blocks: 25, kn: 44, calm: false, at: [6.5 * 32, 7.5 * 32] });
    expect(blob).toMatchObject({ blocks: 16, kn: 34, calm: false, at: [19 * 32, 18 * 32] });
    expect(hole.res).toBeLessThan(DEFAULTS.lo);
    expect(blob.res).toBeGreaterThan(DEFAULTS.hi);
    scan.significant.forEach((c) => expect(c.blocks).toBeGreaterThan(scan.chanceBlocks));
  });

  test('the same hole in calm air is significant but NOT an artifact', () => {
    const calm = speed.map((s) => (s === 44 ? 3 : s));
    const scan = scanBlocks({ bw, bh, ink, speed: calm });
    expect(scan.significant.find((c) => c.kind === 'HOLE')).toMatchObject({ calm: true, kn: 3 });
    expect(scan.artifacts).toBe(1);
  });

  test('a cluster exactly as big as chance makes is NOT significant', () => {
    // One dim block in a flat field: wherever a shuffle puts it, it is a cluster of 1, so chance is 1.
    const lone = grid(bw, bh, (x, y) => (x === 10 && y === 10 ? 40 : 100));
    const scan = scanBlocks({ bw, bh, ink: lone, speed: speed.map(() => 20) });
    expect(scan.nullMaxima.every((m) => m === 1)).toBe(true);
    expect(scan.chanceBlocks).toBe(1);
    expect(scan.clusters).toBe(1);
    expect(scan.significant).toEqual([]);
  });

  test('a texture-only field has no artifacts, and only clusters bigger than chance survive', () => {
    const scan = scanBlocks({ bw, bh, ink: base, speed: speed.map(() => 20) });
    expect(scan.artifacts).toBe(0);
    const rough = grid(bw, bh, () => 120 * (0.5 + texture()));  // +-50%: many flagged singletons
    const roughScan = scanBlocks({ bw, bh, ink: rough, speed: speed.map(() => 20) });
    expect(roughScan.clusters).toBeGreaterThan(roughScan.significant.length);
    expect(roughScan.chanceBlocks).toBeGreaterThanOrEqual(1);
  });

  test('lit brightness per band and the fast/slow ratio', () => {
    const litN = new Uint32Array(bw * bh).fill(10);
    const litSum = Float64Array.from(speed, (s) => (s === 44 ? 900 : 1500)); // lit means: 44 kn 90, others 150
    const scan = scanBlocks({ bw, bh, ink, speed, litSum, litN });
    expect(scan.stormSlowKn).toEqual([40, 20]);
    expect(scan.stormSlow).toBe(0.6);
    expect(scan.bands.find((b) => b.kn === 40)).toMatchObject({ blocks: 25, lit: 90 });
  });
});

describe('the positive control verdict', () => {
  const sig = (kind, kn, calm = false) => ({ kind, kn, blocks: 30, res: kind === 'HOLE' ? 0.57 : 1.8, calm });
  const shipped = { significant: [sig('HOLE', 44.1), sig('BLOB', 34.4)] };

  test('PASS: the scanner sees both halves of the defect in shipped and neither in the candidate', () => {
    expect(evaluateControl(shipped, { significant: [] }).status).toBe('PASS');
    expect(evaluateControl(shipped, { significant: [sig('HOLE', 44, true), sig('HOLE', 51)] }).status).toBe('PASS');
  });
  test('FAIL: the candidate still has part of it', () => {
    expect(evaluateControl(shipped, { significant: [sig('BLOB', 36)] }).status).toBe('FAIL');
  });
  test('BLIND: shipped does not show all of it, so the run proves nothing', () => {
    expect(evaluateControl({ significant: [sig('HOLE', 44)] }, { significant: [] }).status).toBe('BLIND');
    expect(evaluateControl({ significant: [sig('HOLE', 44), sig('BLOB', 25)] }, { significant: [] }).status).toBe('BLIND');
  });
});

describe('the matrix', () => {
  test('13 views x 3 themes x 2 variants, variant pairs back to back', () => {
    const m = buildMatrix();
    expect(VIEWS).toHaveLength(13);
    expect(m).toHaveLength(78);
    expect(m.slice(0, 2).map((c) => [c.view, c.theme, c.variant])).toEqual([['world-z2', 'dark', 'shipped'], ['world-z2', 'dark', 'candidate']]);
  });
  test('the control runs dark z8 on the 0.25 deg grid, blind variant first', () => {
    expect(controlConfigs().map((c) => [c.view, c.z, c.grid, c.theme, c.variant]))
      .toEqual([[POSITIVE_CONTROL.view, 8, 'fine', 'dark', 'shipped'], [POSITIVE_CONTROL.view, 8, 'fine', 'dark', 'candidate']]);
  });
  test('an unknown id throws instead of running a smaller matrix', () => {
    expect(() => buildMatrix({ views: ['fine-z12'] })).toThrow(/unknown view/);
    expect(() => buildMatrix({ variants: ['nope'] })).toThrow(/unknown variant/);
  });
  test('--seeds replicates every configuration, variant pairs still back to back', () => {
    const m = buildMatrix({ seeds: 3, seed: 5 });
    expect(m).toHaveLength(78 * 3);
    expect(m.slice(0, 4).map((c) => [c.view, c.theme, c.seed, c.variant]))
      .toEqual([['world-z2', 'dark', 5, 'shipped'], ['world-z2', 'dark', 5, 'candidate'], ['world-z2', 'dark', 6, 'shipped'], ['world-z2', 'dark', 6, 'candidate']]);
  });
  test('variants that rendered identically everywhere are reported (an ignored lever)', () => {
    const r = (variant, ink) => ({ view: 'fine-z8', theme: 'dark', variant, ink, saturated: 0.2, stormSlow: 0.65, artifactBlocks: 0, clusters: 3 });
    expect(identicalVariantPairs([r('shipped', 133), r('candidate', 133)])).toEqual([['shipped', 'candidate']]);
    expect(identicalVariantPairs([r('shipped', 133), r('candidate', 159)])).toEqual([]);
  });
});

describe('replicates: an artifact counts only when it recurs', () => {
  const shape = (kind, blocks, kn, at, calm = false) => ({ kind, blocks, kn, at, res: kind === 'HOLE' ? 0.6 : 1.6, calm });
  const run = (seed, significant, extra = {}) => ({ view: 'fine-z7', theme: 'dark', variant: 'candidate', seed, significant, ink: 150, saturated: 0.2, stormSlow: 0.9, msPerFrame: 16.7, artifacts: significant.filter((c) => !c.calm).length, ...extra });

  test('the same kind near the same place is the same shape; size widens the reach', () => {
    expect(sameShape(shape('BLOB', 4, 17, [600, 300]), shape('BLOB', 3, 16, [640, 330]))).toBe(true);   // 50 px apart
    expect(sameShape(shape('BLOB', 4, 17, [600, 300]), shape('HOLE', 4, 17, [600, 300]))).toBe(false);
    expect(sameShape(shape('BLOB', 4, 17, [600, 300]), shape('BLOB', 4, 17, [700, 300]))).toBe(false);  // 100 px: too far for 4 blocks
    expect(sameShape(shape('HOLE', 64, 47, [400, 400]), shape('HOLE', 60, 47, [500, 400]))).toBe(true);  // 100 px: within reach of 64 blocks
  });

  test('a shape seen in 3 of 3 seeds is stable, one seen in 1 of 3 is flicker, calm ones are ignored', () => {
    const runs = [
      run(0, [shape('BLOB', 4, 16.9, [600, 300]), shape('HOLE', 2, 41, [100, 800])]),
      run(1, [shape('BLOB', 4, 16.9, [610, 290]), shape('HOLE', 9, 3, [50, 50], true)]),
      run(2, [shape('BLOB', 3, 15.9, [590, 300])]),
    ];
    const shapes = recurringShapes(runs);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ kind: 'BLOB', seen: 3, of: 3, stable: true, blocks: 4 });
    expect(shapes[1]).toMatchObject({ kind: 'HOLE', seen: 1, of: 3, stable: false });
    const [row] = mergeSeeds(runs);
    expect(row).toMatchObject({ seeds: 3, artifacts: 1, artifactBlocks: 4, flicker: 1, ink: 150 });
    expect(row.significant.map((c) => c.kind)).toEqual(['BLOB']);
  });

  test('two seeds of three is a majority; one seed is passed through untouched', () => {
    const two = mergeSeeds([run(0, [shape('HOLE', 5, 8, [200, 200])]), run(1, [shape('HOLE', 6, 8, [210, 200])]), run(2, [])]);
    expect(two[0]).toMatchObject({ artifacts: 1, flicker: 0 });
    const one = mergeSeeds([run(0, [shape('HOLE', 1, 40, [200, 200])])]);
    expect(one[0]).toMatchObject({ seeds: 1, artifacts: 1, flicker: 0 });
  });

  test('the control must hold in every seed: one BLIND seed makes the run BLIND', () => {
    const r = (variant, seed, significant) => ({ view: 'fine-z8', theme: 'dark', variant, seed, significant });
    const both = [shape('HOLE', 40, 44, [400, 400]), shape('BLOB', 38, 34, [300, 300])];
    const pass = [r('shipped', 0, both), r('candidate', 0, []), r('shipped', 1, both), r('candidate', 1, [])];
    expect(controlAcrossSeeds(pass)).toMatchObject({ status: 'PASS', seeds: ['0:PASS', '1:PASS'] });
    const blind = [r('shipped', 0, both), r('candidate', 0, []), r('shipped', 1, both.slice(0, 1)), r('candidate', 1, [])];
    expect(controlAcrossSeeds(blind)).toMatchObject({ status: 'BLIND', seed: 1 });
    expect(controlAcrossSeeds([r('candidate', 0, [])])).toBeNull();
  });
});
