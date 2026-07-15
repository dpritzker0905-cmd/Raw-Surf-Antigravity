import { classifyMarineGrid, analyzeSharpenTimeline, SHARPEN_CLASS } from './marineSharpenTrace';

describe('classifyMarineGrid — resolution class mirrors the engine predicates', () => {
  test('coarse-global 37×17 world grid (span 360, ~9.7°/cell)', () => {
    expect(classifyMarineGrid({ dims: '37x17', spanLng: 360 }).klass).toBe(SHARPEN_CLASS.COARSE);
  });

  test('fine 0.25° native tile (40×40, span 10 → 0.25°/cell)', () => {
    const c = classifyMarineGrid({ dims: '40x40', spanLng: 10 });
    expect(c.klass).toBe(SHARPEN_CLASS.FINE);
    expect(c.cellDeg).toBeCloseTo(0.25, 3);
  });

  test('regional near-native tile (17×17, span 8 → ~0.47°/cell)', () => {
    expect(classifyMarineGrid({ dims: '17x17', spanLng: 8 }).klass).toBe(SHARPEN_CLASS.REGIONAL);
  });

  test('mid tier by cell size (5×5, span 8 → 1.6°/cell)', () => {
    expect(classifyMarineGrid({ dims: '5x5', spanLng: 8 }).klass).toBe(SHARPEN_CLASS.MID);
  });

  test('product id overrides cell heuristic: padded global_mid still reads MID', () => {
    // A padded/clipped global_mid can read >1°/cell but is the MID tier, not a regional tile.
    expect(classifyMarineGrid({ dims: '6x5', spanLng: 12, product: 'gfs_marine_waves_global_mid_2026' }).klass)
      .toBe(SHARPEN_CLASS.MID);
  });

  test('product id global_coarse forces COARSE', () => {
    expect(classifyMarineGrid({ dims: '17x17', spanLng: 8, product: 'gfs_marine_waves_global_coarse_x' }).klass)
      .toBe(SHARPEN_CLASS.COARSE);
  });

  test('unknown when span/cols missing', () => {
    expect(classifyMarineGrid({ dims: '0x0' }).klass).toBe(SHARPEN_CLASS.UNKNOWN);
  });
});

describe('analyzeSharpenTimeline — zoom-out sharpen cadence over the forensic ring', () => {
  const T = 100000;   // base epoch for readable deltas

  test('normal cadence: coarse preview @end → mid @+300 → fine @+2200 = sharpen 2200ms', () => {
    const events = [
      { t: T - 50, type: 'commit', dims: '37x17', spanLng: 360 },              // resident@end = coarse
      { t: T, type: 'zoom_end', from: 8.5, to: 6.3, dir: 'out', spanDeg: 12, bridgeDelta: 1, coarseActiveAtEnd: true },
      { t: T + 300, type: 'commit', dims: '5x5', spanLng: 8, product: 'x_global_mid_y' },   // mid
      { t: T + 2200, type: 'commit', dims: '40x40', spanLng: 10 },             // fine
    ];
    const [g] = analyzeSharpenTimeline(events, { dir: 'out' });
    expect(g.residentAtEnd).toBe(SHARPEN_CLASS.COARSE);
    expect(g.firstCommitMs).toBe(300);
    expect(g.sharpenMs).toBe(2200);
    expect(g.ladder).toHaveLength(2);
    expect(g.bridgeDelta).toBe(1);
    expect(g.coarseActiveAtEnd).toBe(true);
  });

  test('STUCK: only a mid commit after zoom-out → sharpenMs null (the bug signature)', () => {
    const events = [
      { t: T, type: 'zoom_end', from: 9, to: 6, dir: 'out', spanDeg: 14, bridgeDelta: 0 },
      { t: T + 400, type: 'commit', dims: '5x5', spanLng: 8, product: 'a_global_mid_b' },
    ];
    const [g] = analyzeSharpenTimeline(events, { dir: 'out' });
    expect(g.firstCommitMs).toBe(400);
    expect(g.sharpenMs).toBeNull();
  });

  test('fine commit beyond the horizon does not count as sharpened', () => {
    const events = [
      { t: T, type: 'zoom_end', from: 9, to: 6, dir: 'out', spanDeg: 14 },
      { t: T + 12000, type: 'commit', dims: '40x40', spanLng: 10 },   // past default 9000ms horizon
    ];
    const [g] = analyzeSharpenTimeline(events, { dir: 'out' });
    expect(g.sharpenMs).toBeNull();
    expect(g.firstCommitMs).toBeNull();
  });

  test('a new zoom_start closes the watch window early', () => {
    const events = [
      { t: T, type: 'zoom_end', from: 9, to: 6, dir: 'out', spanDeg: 14 },
      { t: T + 500, type: 'zoom_start', from: 6 },                    // next gesture begins
      { t: T + 1500, type: 'commit', dims: '40x40', spanLng: 10 },    // belongs to the NEXT gesture
    ];
    const [g] = analyzeSharpenTimeline(events, { dir: 'out' });
    expect(g.sharpenMs).toBeNull();
    expect(g.ladder).toHaveLength(0);
  });

  test('dir filter ignores zoom-IN gestures when asking for out', () => {
    const events = [
      { t: T, type: 'zoom_end', from: 6, to: 9, dir: 'in', spanDeg: 3 },
      { t: T + 300, type: 'commit', dims: '40x40', spanLng: 10 },
    ];
    expect(analyzeSharpenTimeline(events, { dir: 'out' })).toHaveLength(0);
    expect(analyzeSharpenTimeline(events, { dir: 'in' })).toHaveLength(1);
  });

  test('engine_clear after zoom_end is captured as the "quick clearing" signal', () => {
    const events = [
      { t: T, type: 'zoom_end', from: 9, to: 6, dir: 'out', spanDeg: 14 },
      { t: T + 250, type: 'engine_clear' },
      { t: T + 1800, type: 'commit', dims: '40x40', spanLng: 10 },
    ];
    const [g] = analyzeSharpenTimeline(events, { dir: 'out' });
    expect(g.clearedMs).toBe(250);
    expect(g.sharpenMs).toBe(1800);
  });
});
