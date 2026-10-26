// The wind f120+ tail blend (windTimeBlend.js): PCHIP on u/v between two 3-hourly frames, labelled, opt-in. The method won the
// hold-out (SCOREBOARD S23, 2026-10-25); these pin its arithmetic against the hold-out's own formulas, its no-overshoot property,
// its f120 gate and its refusals, so the clip shows exactly what the PR says.
import { blendBracket, blendVectors, blendWindJson, fcSlope, hermite, indexRunMs, pchip, uvSign, windTimeBlendOn,
  WIND_BLEND_MAX_GAP_MS, WIND_BLEND_METHOD, WIND_BLEND_MIN_LEAD_MS } from './windTimeBlend';

const H = 3600000;
const T0 = Date.parse('2026-10-30T00:00:00Z');
const RUN = T0 - 120 * H;                                   // T0 is f120 of RUN
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const fr = (h, path = `f${h}.bin`) => ({ valid_time: iso(T0 + h * H), path });
const frames = [fr(-6), fr(-3), fr(0), fr(3), fr(6), { ...fr(9), path: null, unbuilt: 'not_local' }, fr(12)];
// The codec's convention (staticFrameCodec.buildWindVectors, uv sign -1 = "from" direction): u = -s sin(d), v = -s cos(d).
const vec = (speed, direction) => ({ lat: 0, lng: 0, speed, direction, u: -speed * Math.sin(direction * Math.PI / 180) + 0,
  v: -speed * Math.cos(direction * Math.PI / 180) + 0, is_valid: true });
const uv = (u, v) => ({ lat: 0, lng: 0, u, v, speed: Math.hypot(u, v), direction: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360,
  is_valid: true });

describe('wind f120+ tail blend (PCHIP u/v)', () => {
  afterEach(() => { delete window.__RAW_WIND_TIME_BLEND__; });

  test('opt-in only', () => {
    expect(windTimeBlendOn()).toBe(false);
    window.__RAW_WIND_TIME_BLEND__ = true;
    expect(windTimeBlendOn()).toBe(true);
  });

  test('the bracket: two built frames, the weight and the built outer neighbours; refusals on a frame, outside, across a gap', () => {
    const br = blendBracket(frames, T0 + 1 * H, RUN);
    expect(br).toMatchObject({ t0: T0, t1: T0 + 3 * H, weight: 1 / 3 });
    expect(br.fm.valid_time).toBe(iso(T0 - 3 * H));
    expect(br.fp.valid_time).toBe(iso(T0 + 6 * H));
    expect(blendBracket(frames, T0 + 2 * H, RUN).weight).toBeCloseTo(2 / 3, 12);
    expect(blendBracket(frames, T0 + 4 * H, RUN).fp).toBeNull();     // the frame after (09Z) is unbuilt: an edge, not a bridge
    expect(blendBracket(frames, T0, RUN)).toBeNull();                 // exactly on a frame
    expect(blendBracket(frames, T0 + 13 * H, RUN)).toBeNull();        // after the last
    expect(blendBracket(frames, T0 + 7 * H, RUN)).toBeNull();         // 06Z -> 12Z across the unbuilt 09Z: never bridged
    expect(WIND_BLEND_MAX_GAP_MS).toBe(6 * H);
  });

  test('the tail only: no blend before f120 of the run, and none with no run known', () => {
    expect(WIND_BLEND_MIN_LEAD_MS).toBe(120 * H);
    expect(blendBracket(frames, T0 - 2 * H, RUN)).toBeNull();         // f117-f120: hourly real data covers it (#580)
    expect(blendBracket(frames, T0 + 1 * H, RUN)).not.toBeNull();     // f120-f123
    expect(blendBracket(frames, T0 + 1 * H, NaN)).toBeNull();         // unknown run: fail closed to the nearest frame
    expect(indexRunMs({ run: iso(RUN) })).toBe(RUN);
    expect(indexRunMs({ run_time: iso(RUN), run: 'r' })).toBe(RUN);
    expect(indexRunMs(null)).toBeNaN();
  });

  test('the slopes and the Hermite are the hold-out\'s (evaluate.py pchip_slope / hermite), case by case', () => {
    expect(fcSlope(0, 1, 3)).toBeCloseTo((2 * 1 * 2) / 3, 12);        // harmonic mean of agreeing secants
    expect(fcSlope(2, 1, 3)).toBe(0);                                  // a local extremum stays flat
    expect(fcSlope(1, 1, 3)).toBe(0);                                  // a flat secant
    expect(hermite(1, 2, 1, 1, 1 / 3)).toBeCloseTo(4 / 3, 12);         // a straight line is reproduced
    expect(pchip(0, 1, 2, 3, 1 / 3)).toBeCloseTo(4 / 3, 12);
    expect(pchip(null, 1, 2, null, 1 / 3)).toBeCloseTo(4 / 3, 12);     // edges: one-sided = the bracket's own secant
    expect(pchip(0, 0, 10, 10, 1 / 3)).toBeCloseTo(10 * (3 / 9 - 2 / 27), 12);   // flat ends: a smooth step
  });

  test('no overshoot between frames: a dip stays at its floor where Catmull-Rom would undershoot', () => {
    const catrom = hermite(0, 0, (0 - 10) / 2, (10 - 0) / 2, 0.5);
    expect(catrom).toBeCloseTo(-1.25, 12);                             // what Catmull-Rom draws
    expect(pchip(10, 0, 0, 10, 0.5)).toBe(0);                          // what PCHIP draws
    for (const a of [0.1, 1 / 3, 0.5, 2 / 3, 0.9]) {
      const y = pchip(3, 5, 9, 9.5, a);
      expect(y).toBeGreaterThanOrEqual(5); expect(y).toBeLessThanOrEqual(9);
    }
  });

  test('vectors: u and v each by PCHIP, speed and direction rebuilt from them in the frames\' own sign convention', () => {
    expect(uvSign([vec(10, 30)])).toBe(-1);
    const [m] = blendVectors([uv(1, -2)], [uv(2, -4)], 1 / 3, [uv(0, 0.5)], [uv(3, -5)]);
    const u = pchip(0, 1, 2, 3, 1 / 3); const v = pchip(0.5, -2, -4, -5, 1 / 3);
    expect(m.u).toBeCloseTo(u, 4); expect(m.v).toBeCloseTo(v, 4);
    expect(m.speed).toBeCloseTo(Math.hypot(u, v), 2);
    const back = vec(m.speed, m.direction);                            // the direction re-encodes to the same u/v
    expect(back.u).toBeCloseTo(m.u, 1); expect(back.v).toBeCloseTo(m.v, 1);
    const [same] = blendVectors([vec(10, 30)], [vec(10, 30)], 0.5);    // a steady wind stays put
    expect(same.speed).toBe(10); expect(same.direction).toBe(30);
  });

  test('neighbours are optional: missing or invalid at a node is an edge there, wrong shape is ignored', () => {
    const A = [uv(1, 0)]; const B = [uv(2, 0)];
    const edge = blendVectors(A, B, 0.5)[0].u;
    expect(edge).toBeCloseTo(1.5, 4);
    expect(blendVectors(A, B, 0.5, [{ ...uv(0, 0), is_valid: false }], null)[0].u).toBeCloseTo(edge, 4);
    expect(blendVectors(A, B, 0.5, [uv(0, 0), uv(0, 0)], null)[0].u).toBeCloseTo(edge, 4);
  });

  test('a missing side keeps the frame that has it; shapes must match; weight strictly inside (0, 1)', () => {
    const bad = { lat: 0, lng: 0, speed: 0, direction: 0, u: 0, v: 0, is_valid: false };
    expect(blendVectors([bad], [vec(7, 40)], 0.5)[0].speed).toBe(7);
    expect(blendVectors([vec(1, 0)], [vec(1, 0), vec(1, 0)], 0.5)).toBeNull();
    expect(blendVectors([vec(1, 0)], [vec(1, 0)], 0)).toBeNull();
    expect(blendVectors([vec(1, 0)], [vec(1, 0)], 1)).toBeNull();
  });

  test('the blended JSON is labelled: valid at the selected instant, an estimate, the method and both sources named', () => {
    const j = (pid, v) => ({ product_id: pid, model: 'GFS', grid: { cols: 1, rows: 1, vectors: [v] }, valid_time: 'x' });
    const br = blendBracket(frames, T0 + H, RUN);
    const out = blendWindJson(j('gfs_wind_wind_global_mid_20261030T000000Z.json', vec(10, 0)),
      j('gfs_wind_wind_global_mid_20261030T030000Z.json', vec(16, 30)), br, T0 + H, j('m', vec(8, 350)), null);
    expect(out.valid_time).toBe('2026-10-30T01:00:00Z');
    expect(out.served_valid_time).toBe('2026-10-30T01:00:00Z');
    expect(out.is_estimated).toBe(true);
    expect(out.time_blend).toMatchObject({ from: '2026-10-30T00:00:00Z', to: '2026-10-30T03:00:00Z', weight: 0.333,
      method: WIND_BLEND_METHOD, neighbours: { before: true, after: false },
      from_product: 'gfs_wind_wind_global_mid_20261030T000000Z.json', to_product: 'gfs_wind_wind_global_mid_20261030T030000Z.json' });
    expect(out.product_id).not.toMatch(/_\d{8}T\d{6}Z\.json$/);   // no stored-product id: nothing reads it as a frame
  });
});
