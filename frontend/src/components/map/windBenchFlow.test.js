/**
 * Wind bench, FLOW mode (scripts/wind-bench/flow.js + path-run.js --flow): the instrument behind windTrailAnchor.js.
 * It asks one thing of a picture: do the wind's streaks run along the served wind? These tests give it pictures whose
 * answer is known, and pin the three checks the runner gates on.
 */
const { flowAlignment, motionOf, turned, FLOW_DEFAULTS } = require('../../../scripts/wind-bench/flow');
const { PATH_NAMES, FLOW_PATH_NAMES, pathFrames } = require('../../../scripts/wind-bench/paths');
const { sampleWind, sampleSpeed, buildGrid } = require('../../../scripts/wind-bench/field');
const { summarizeFlow, flowVerdict, FLOW_GATE } = require('../../../scripts/wind-bench/path-run');

const W = 200, H = 200;
const image = (fn) => { const L = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) L[y * W + x] = fn(x, y); return { w: W, h: H, L }; };
const FLAT = image(() => 50);
const ALONG_X = image((x, y) => 50 + 10 * Math.sin(y * 0.9));    // streaks along x: the picture changes only across y

describe('flowAlignment', () => {
  test('1 when the streaks run along the wind, 0 across it, a half at 45 degrees', () => {
    expect(flowAlignment(ALONG_X, FLAT, () => [10, 0]).flow).toBeCloseTo(1, 6);
    expect(flowAlignment(ALONG_X, FLAT, () => [-10, 0]).flow).toBeCloseTo(1, 6);     // a streak has no sign
    expect(flowAlignment(ALONG_X, FLAT, () => [0, 10]).flow).toBeCloseTo(0, 6);
    expect(flowAlignment(ALONG_X, FLAT, () => [7, 7]).flow).toBeCloseTo(0.5, 6);
  });

  test('a half for ink with no direction', () => {
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    expect(flowAlignment(image(() => 50 + 20 * rnd()), FLAT, () => [3, 9]).flow).toBeCloseTo(0.5, 1);
  });

  test('follows a wind that changes across the screen', () => {
    // wind east on the left half, north on the right; streaks drawn to match each half
    const pic = image((x, y) => 50 + 10 * Math.sin((x < W / 2 ? y : x) * 0.9));
    const wind = (x) => (x < W / 2 ? [10, 0] : [0, 10]);
    expect(flowAlignment(pic, FLAT, wind).flow).toBeGreaterThan(0.97);
    expect(flowAlignment(pic, FLAT, (x) => (x < W / 2 ? [0, 10] : [10, 0])).flow).toBeLessThan(0.03);
  });

  test('scores the ink only: the map under it is subtracted, and blocks with map line work are left out', () => {
    const road = image((x) => (x % 40 < 2 ? 20 : 50));
    const all = flowAlignment(ALONG_X, FLAT, () => [10, 0]);
    const overRoads = flowAlignment(image((x, y) => road.L[y * W + x] + 10 * Math.sin(y * 0.9)), road, () => [10, 0]);
    expect(overRoads.blocks).toBeGreaterThan(0);
    expect(overRoads.blocks).toBeLessThan(all.blocks);
    expect(overRoads.flow).toBeCloseTo(1, 6);
    // a smooth map gradient (a tinted sea) is not line work
    const sea = image((x) => 40 + x * 0.05);
    expect(flowAlignment(image((x, y) => sea.L[y * W + x] + 10 * Math.sin(y * 0.9)), sea, () => [10, 0]).blocks).toBe(all.blocks);
  });

  test('leaves out light air, places with no served wind, and blocks with almost no ink', () => {
    expect(flowAlignment(ALONG_X, FLAT, () => [FLOW_DEFAULTS.minSpeed - 0.1, 0])).toEqual({ flow: null, blocks: 0, ink: 0 });
    expect(flowAlignment(ALONG_X, FLAT, () => null).blocks).toBe(0);
    expect(flowAlignment(image((x, y) => 50 + 0.2 * Math.sin(y * 0.9)), FLAT, () => [10, 0]).blocks).toBe(0);
  });
});

describe('sampleWind', () => {
  const grid = buildGrid(-96, -80, 20, 34, 0.25);

  test('returns the served vector at a node, its speed agrees with sampleSpeed, null outside', () => {
    const node = grid.vectors[10 * grid.cols + 7];
    expect(sampleWind(grid, node.lng, node.lat)).toEqual([expect.closeTo(node.u, 9), expect.closeTo(node.v, 9)]);
    const uv = sampleWind(grid, -88.13, 27.41);
    expect(sampleSpeed(grid, -88.13, 27.41)).toBeCloseTo(Math.hypot(uv[0], uv[1]), 12);
    expect(sampleWind(grid, -120, 27)).toBe(null);
    expect(sampleSpeed(grid, -120, 27)).toBe(null);
  });
});

describe('motionOf', () => {
  const cam = (lng, z = 8) => ({ lng, lat: 30, z });

  test('a sample is moving when its camera differs from the frame before, settling for a while after, else at rest', () => {
    const frames = [cam(0), cam(0), cam(1), cam(2), cam(2), cam(2), cam(2), cam(2, 8.5)];
    expect(motionOf(frames, [0, 1, 2, 3, 4, 5, 6, 7], 2)).toEqual(['rest', 'rest', 'move', 'move', 'settle', 'settle', 'rest', 'move']);
  });

  test('the default settling time covers the trails of a camera that has just stopped (about a second)', () => {
    const frames = [cam(0), cam(1), ...Array.from({ length: 80 }, () => cam(1))];
    const kinds = motionOf(frames, frames.map((_, i) => i));
    expect(kinds[1]).toBe('move');
    expect(kinds[61]).toBe('settle');
    expect(kinds[62]).toBe('rest');
  });
});

describe('a turned map', () => {
  const near = (a, b) => { expect(a[0]).toBeCloseTo(b[0], 12); expect(a[1]).toBeCloseTo(b[1], 12); };

  test('north-up is the identity; at bearing 90 east is up the screen and north is to the left', () => {
    near(turned(0).toScreen(3, 4), [3, 4]);
    near(turned(0).toGround(3, 4), [3, 4]);
    near(turned(90).toScreen(1, 0), [0, 1]);
    near(turned(90).toScreen(0, 1), [-1, 0]);
    near(turned(90).toGround(0, 1), [1, 0]);      // up the screen is east on the ground
  });

  test('toGround undoes toScreen at any bearing, and lengths are kept', () => {
    for (const b of [17, 70, 133, 251]) {
      const t = turned(b), s = t.toScreen(5, -2);
      near(t.toGround(s[0], s[1]), [5, -2]);
      expect(Math.hypot(s[0], s[1])).toBeCloseTo(Math.hypot(5, -2), 12);
    }
  });

  test('the turn path: flow mode only, deterministic, north-up and at rest at both ends, 70 degrees at its widest', () => {
    expect(FLOW_PATH_NAMES).toEqual(['turn', 'dateline']);
    expect(PATH_NAMES).not.toContain('turn');
    const f = pathFrames('turn');
    expect(pathFrames('turn')).toEqual(f);
    expect(f[1]).toEqual(f[0]);
    expect(f[f.length - 1]).toEqual(f[f.length - 2]);
    expect(f[0].bearing).toBeUndefined();
    expect(f[f.length - 1].bearing).toBeUndefined();
    expect(Math.max(...f.map((x) => x.bearing || 0))).toBe(70);
    const kinds = motionOf(f, f.map((_, i) => i));
    expect(kinds.filter((k) => k === 'move').length).toBe(120);
  });
});

describe('the date line path', () => {
  test('flow mode only; at rest at both ends; crosses lng 180 once, and its frames carry the WRAPPED longitude', () => {
    expect(PATH_NAMES).not.toContain('dateline');
    const f = pathFrames('dateline');
    expect(pathFrames('dateline')).toEqual(f);
    expect(f[1]).toEqual(f[0]);
    expect(f[f.length - 1]).toEqual(f[f.length - 2]);
    for (const x of f) { expect(x.lng).toBeGreaterThanOrEqual(-180); expect(x.lng).toBeLessThan(180); expect(x.z).toBe(5); }
    const flips = f.filter((x, i) => i > 0 && Math.abs(x.lng - f[i - 1].lng) > 180);
    expect(flips.length).toBe(1);                                    // one wrap: the frame after lng 180 reads about -180
    expect(f[0].lng).toBeGreaterThan(170);
    expect(f[f.length - 1].lng).toBeLessThan(-160);
    expect(motionOf(f, f.map((_, i) => i)).filter((k) => k === 'move').length).toBe(90);
  });
});

describe('the runner', () => {
  const rows = (flows) => flows.map((flow, i) => ({ i, flow, blocks: 100, tiles: i !== 2 }));

  test('summarizeFlow takes medians by kind and counts samples over a half-loaded map', () => {
    const s = summarizeFlow(rows([0.8, 0.82, 0.6, 0.62, 0.64, null, 0.7]), ['rest', 'rest', 'move', 'move', 'move', 'move', 'settle']);
    expect([s.rest, s.move, s.settle, s.nRest, s.nMove, s.miss]).toEqual([0.82, 0.62, 0.7, 2, 3, 1]);
    expect(s.move10).toBe(0.6);
  });

  test('flowVerdict on a pan: the screen arm must smear, the same ink at rest, the anchored arm must hold and win', () => {
    const screen = { rest: 0.80, move: 0.62 }, anchored = { rest: 0.80, move: 0.78 };
    expect(flowVerdict('pan', anchored, screen, 7, 7)).toEqual({ null0: true, kept: true, better: true, seen: true, held: true });
    expect(flowVerdict('pan', anchored, { rest: 0.80, move: 0.80 - FLOW_GATE.smear + 0.01 }, 7, 7).seen).toBe(false);   // a blind instrument
    expect(flowVerdict('pan', anchored, screen, 6, 7).null0).toBe(false);                                               // one still buffer differs
    expect(flowVerdict('pan', anchored, screen, 0, 0).null0).toBe(false);                                               // no still sample is not a pass
    expect(flowVerdict('pan', { rest: 0.80, move: 0.80 - FLOW_GATE.hold - 0.01 }, screen, 7, 7).held).toBe(false);      // the anchor lost the flow
    expect(flowVerdict('pan', { rest: 0.8, move: null }, screen, 7, 7)).toMatchObject({ better: false, held: false });   // no moving sample is not a pass
  });

  test('flowVerdict elsewhere: anchored must beat screen while moving (no worse on jitter); nothing hangs on a zoom path rest reading', () => {
    const screen = { rest: 0.85, move: 0.60 };
    expect(flowVerdict('zoomOut', { rest: 0.85, move: 0.70 }, screen, 7, 7)).toEqual({ null0: true, kept: true, better: true });
    // one cleared frame hardly moves a median (the date line: 0.713 against 0.715), so the clear itself is gated
    expect(flowVerdict('dateline', { rest: 0.72, move: 0.713 }, { rest: 0.72, move: 0.526 }, 7, 7, 1)).toEqual({ null0: true, kept: false, better: true });
    expect(flowVerdict('fling', { rest: 0.85, move: 0.60 + FLOW_GATE.gain - 0.01 }, screen, 7, 7).better).toBe(false);
    expect(flowVerdict('jitter', { rest: 0.85, move: 0.60 }, screen, 7, 7).better).toBe(true);
    expect(flowVerdict('jitter', { rest: 0.85, move: 0.60 + FLOW_GATE.jitter - 0.01 }, screen, 7, 7).better).toBe(false);
  });
});
