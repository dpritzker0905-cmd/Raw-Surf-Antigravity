/**
 * The wind bench's LADDER mode (frontend/scripts/wind-bench/ladder.js and the helpers it adds to eye.js): the zoom stops
 * it replays must be the grids the app and the server really exchange, so each mirrored rule is pinned to its source
 * here. Lives under src/ because CRA's Jest only discovers tests there; nothing in the app imports the bench.
 */
import fs from 'fs';
import path from 'path';
import { requestBox, serverStep, clipWindow, plan } from '../../../scripts/wind-bench/ladder';
import { makeCamera } from '../../../scripts/wind-bench/camera';
import { gridFromFixture, sampleUV, truthField, latticeGrid, meanGrid, binDiff, eyeSummary, nodeAt } from '../../../scripts/wind-bench/eye';
import { clampViewportBbox } from './backendWeatherServiceClientCoverage';
import { chooseAdaptiveResolution } from './windFineContainment';

const REF = { lng: -87.6, lat: 27.8 }, PANE = { w: 897, h: 914 };
const ZOOMS = [5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
const viewAt = (z, c = REF) => makeCamera(c.lng, c.lat, z, PANE.w, PANE.h).viewBounds;
const arr = (b) => [b.west, b.south, b.east, b.north];

describe('the mirrored rules', () => {
  test('requestBox is the app\'s own wind request box, at every stop and off-centre', () => {
    let n = 0;
    for (const c of [REF, { lng: -64.3, lat: 18.4 }, { lng: 142.2, lat: 21.7 }, { lng: -157.9, lat: -17.6 }]) {
      for (const z of [3, 4, 5, ...ZOOMS, 10, 11]) {
        const [west, south, east, north] = viewAt(z, c);
        const mine = requestBox([west, south, east, north]);
        if (!mine) { expect(west < -180 || east > 180).toBe(true); continue; }   // the dateline is not modelled
        const app = clampViewportBbox({ west, south, east, north }, 'wind', 'GFS', 'wind');
        expect(arr(mine)).toEqual(arr(app.clampedBbox));
        expect(app.selectedTileId).toBe(`wind_viewport_fine_${arr(mine).join('_')}`);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(48);
  });

  test('the Gulf ladder: the boxes and tiers of the eight stops', () => {
    const got = ZOOMS.map((z) => { const b = requestBox(viewAt(z)); return [z, ...arr(b), serverStep(b)]; });
    expect(got).toEqual([
      [5.5, -96, 20, -79, 35, 1], [6, -94, 22, -81, 34, 1], [6.5, -93, 23, -83, 32, 0.5], [7, -92, 24, -84, 31, 0.5],
      [7.5, -91, 25, -84, 31, 0.5], [8, -90, 25, -85, 30, 0.25], [8.5, -90, 26, -85, 30, 0.25], [9, -90, 26, -85, 30, 0.25],
    ]);
  });

  test('serverStep is choose_adaptive_resolution at 400 points (the app\'s mirror and the backend source)', () => {
    for (const [w, h] of [[5, 5], [5, 4], [5.1, 5], [10, 9], [10, 10], [13, 12], [17, 15], [20, 20], [21, 20], [40, 40]]) {
      expect(serverStep({ west: 0, south: 0, east: w, north: h })).toBe(chooseAdaptiveResolution(w, h));
    }
    expect([[5, 5], [10, 10], [20, 20], [40, 40]].map(([w, h]) => serverStep({ west: 0, south: 0, east: w, north: h }))).toEqual([0.25, 0.5, 1, 2]);
    const py = fs.readFileSync(path.join(__dirname, '../../../../backend/services/weather_pipeline/route_helpers.py'), 'utf8');
    expect(py).toContain('def choose_adaptive_resolution(span_lng: float, span_lat: float, target_points: float = 400.0) -> float:');
    expect(py).toContain('est_res = math.sqrt((span_lng * span_lat) / target_points)');
  });

  test('clipWindow is the mid tier\'s pad: half the larger span, 2 to 12 deg a side', () => {
    expect(clipWindow({ west: -96, south: 20, east: -79, north: 35 })).toEqual({ west: -104.5, south: 11.5, east: -70.5, north: 43.5 });
    expect(clipWindow({ west: -90, south: 26, east: -88, north: 28 })).toEqual({ west: -92, south: 24, east: -86, north: 30 });
    expect(clipWindow({ west: -120, south: 0, east: -80, north: 30 }).west).toBe(-132);
    const py = fs.readFileSync(path.join(__dirname, '../../../../backend/services/weather_pipeline/mid_res_tier.py'), 'utf8');
    expect(py).toContain('_frac = float(os.environ.get("MARINE_MID_CLIP_PAD_FRAC", "0.5"))');
    expect(py).toContain('_cap = float(os.environ.get("MARINE_MID_CLIP_PAD_MAX", "12.0"))');
    expect(py).toContain('_pad = min(_cap, max(2.0, _frac * span))');
  });
});

describe('plan: what reaches the engine at each stop', () => {
  const PATH = [...ZOOMS, ...ZOOMS.slice(0, -1).reverse()];
  const kinds = (stops) => stops.map((s) => s.served.map((d) => `${d.kind}@${d.step}`).join('+'));

  test('with the client cache: three boxes go to the server, each answered by the 2-deg clip first', () => {
    const stops = plan(PATH, REF, PANE);
    expect(kinds(stops)).toEqual([
      'clip@2+box@1', 'cache@1', 'clip@2+box@0.5', 'cache@0.5', 'cache@0.5', 'clip@2+box@0.25', 'cache@0.25', 'cache@0.25',
      'cache@0.25', 'cache@0.25', 'cache@0.5', 'cache@0.5', 'cache@0.5', 'cache@1', 'cache@1',
    ]);
    // The first cached box that contains the view wins, by insertion order: on the way out z7.5 is handed the z6.5 box
    // (0.5 deg) although the z8 box (0.25 deg) also contains it (windController.fetchWindData).
    const out75 = stops[10];
    expect(out75.z).toBe(7.5);
    expect(arr(out75.served[0].box)).toEqual([-93, 23, -83, 32]);
    expect(out75.view[0]).toBeGreaterThan(-90);
    expect(out75.view[2]).toBeLessThan(-85);
  });

  test('a cached box coarser than 1.1x the stop\'s tier is not reused', () => {
    const stops = plan([5.5, 8], REF, PANE);
    expect(kinds(stops)).toEqual(['clip@2+box@1', 'clip@2+box@0.25']);
    const src = fs.readFileSync(path.join(__dirname, 'windFineContainment.js'), 'utf8');
    expect(src).toContain('return cell <= tierCell * FINE_ENOUGH_SLACK;');
    expect(src).toMatch(/const FINE_ENOUGH_SLACK = 1\.1;/);
  });

  test('without reuse every new box goes to the server; an exact box is still a cache hit', () => {
    const stops = plan(PATH, REF, PANE, { reuse: false });
    expect(kinds(stops).slice(0, 8)).toEqual(['clip@2+box@1', 'clip@2+box@1', 'clip@2+box@0.5', 'clip@2+box@0.5', 'clip@2+box@0.5', 'clip@2+box@0.25', 'clip@2+box@0.25', 'cache@0.25']);
    expect(kinds(stops).slice(8).every((k) => k.startsWith('cache@'))).toBe(true);
  });
});

describe('one field, every tier', () => {
  const fx = (west, south, cols, rows, step, fn) => {
    const u = [], v = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const [a, b] = fn(west + i * step, south + j * step); u.push(a); v.push(b); }
    return { product_id: 't', valid_time: '2026-10-09T15:00:00Z', bounds: { west, south, east: west + (cols - 1) * step, north: south + (rows - 1) * step }, cols, rows, u, v };
  };
  const storm = (lng, lat) => { const dx = lng + 87.5, dy = lat - 27.5, r = Math.hypot(dx, dy), s = 60 * r * Math.exp(1 - r) / 1; return [-dy / (r || 1) * s, dx / (r || 1) * s]; };
  const tile = gridFromFixture(fx(-92, 25, 53, 29, 0.25, storm), 'tile');
  const wide = gridFromFixture(fx(-120, 10, 31, 21, 2, storm), 'wide');
  const truth = truthField(tile, wide);

  test('sampleUV is bilinear, exact at nodes, null outside', () => {
    expect(sampleUV(tile, -88, 27)).toEqual(storm(-88, 27).map((x) => expect.closeTo(x, 9)));
    const mid = sampleUV(tile, -88.125, 27), a = storm(-88.25, 27), b = storm(-88, 27);
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2, 9);
    expect(sampleUV(tile, -93, 27)).toBeNull();
  });

  test('truthField: the tile inside, the wide grid beyond, a 1-deg taper between; tiers sampled from it nest', () => {
    expect(truth(-87.25, 27.75)[0]).toBeCloseTo(storm(-87.25, 27.75)[0], 9);          // deep inside: the tile's node
    expect(truth(-100, 20)).toEqual(sampleUV(wide, -100, 20));                         // outside: the wide grid
    const edge = truth(-91.5, 28), near = sampleUV(tile, -91.5, 28), far = sampleUV(wide, -91.5, 28);
    expect(edge[0]).toBeCloseTo((near[0] + far[0]) / 2, 9);                            // half-way through the taper
    const box = { west: -90, south: 25, east: -85, north: 30 };
    const fine = latticeGrid(truth, box, 0.25), half = latticeGrid(truth, box, 0.5), one = latticeGrid(truth, box, 1);
    expect([fine.cols, half.cols, one.cols]).toEqual([21, 11, 6]);
    for (const q of one.vectors) {
      expect(nodeAt(half, q.lng, q.lat)).toMatchObject({ u: q.u, v: q.v });
      expect(nodeAt(fine, q.lng, q.lat)).toMatchObject({ u: q.u, v: q.v });
    }
  });

  test('meanGrid is the cell mean: equal to the point sample on a linear field, weaker than it on the storm', () => {
    const linear = (lng, lat) => [2 * lng + lat, lng - 3 * lat], box = { west: -90, south: 25, east: -86, north: 29 };
    const m = meanGrid(linear, box, 1, 0.25), p = latticeGrid(linear, box, 1);
    m.vectors.forEach((q, k) => { expect(q.u).toBeCloseTo(p.vectors[k].u, 9); expect(q.v).toBeCloseTo(p.vectors[k].v, 9); });
    const ms = meanGrid(truth, box, 1, 0.25), ps = latticeGrid(truth, box, 1);
    expect(Math.max(...ms.vectors.map((q) => q.speed))).toBeLessThan(Math.max(...ps.vectors.map((q) => q.speed)));
    expect(ms.vectors.every((q) => Math.abs(q.speed - Math.hypot(q.u, q.v)) < 1e-9)).toBe(true);
  });

  test('binDiff: mean difference in knots and the share two bins or more apart', () => {
    expect(binDiff([0, 1, 2, 3], [0, 1, 2, 3], 5)).toEqual({ meanKn: 0, bigShare: 0 });
    expect(binDiff([0, 1, 2, 3], [0, 2, 4, 0], 5)).toEqual({ meanKn: 7.5, bigShare: 0.5 });
    expect(() => binDiff([0], [0, 1], 5)).toThrow('bin maps differ in size');
  });
});

describe('eyeSummary, nested: a closed pocket elsewhere is not the eye grown', () => {
  const eye = (lng, lat, rKm) => ({ lng, lat, rKm, areaKm2: Math.round(Math.PI * rKm * rKm), aspect: 1 });
  // The 0.25-deg lane tile at z7 (ladder bench, 2026-10-09): the eye opens at 40 kn; a 9-km pocket 100 km north closes there.
  const eyes = { 34: eye(-87.67, 27.59, 23.8), 36: eye(-87.67, 27.57, 26.7), 38: eye(-87.67, 27.55, 30.1), 40: eye(-87.89, 28.51, 9.1), 42: null };
  const Ts = [34, 36, 38, 40, 42];

  test('the default summary follows the pocket; nested stops where the eye opens', () => {
    expect(eyeSummary(eyes, Ts)).toMatchObject({ firstT: 34, closeT: 40 });
    expect(eyeSummary(eyes, Ts, { nested: true })).toMatchObject({ firstT: 34, closeT: 38, at: { rKm: 30.1 } });
  });
  test('a contour that grows around the same centre is kept; one that shrinks or jumps is not', () => {
    expect(eyeSummary({ 34: eye(-87.6, 27.6, 20), 36: eye(-87.62, 27.58, 24) }, [34, 36], { nested: true }).closeT).toBe(36);
    expect(eyeSummary({ 34: eye(-87.6, 27.6, 20), 36: eye(-87.6, 27.6, 12) }, [34, 36], { nested: true }).closeT).toBe(34);
    expect(eyeSummary({ 34: eye(-87.6, 27.6, 20), 36: eye(-86.9, 27.6, 30) }, [34, 36], { nested: true }).closeT).toBe(34);
  });
});
