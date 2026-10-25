// Owner A/B clip B (windTimeBlend.js): the labelled wind blend between two 3-hourly frames. Opt-in; these pin its arithmetic and
// its refusals, so the clip shows exactly what the PR says.
import { arc, blendBracket, blendVectors, blendWindJson, uvSign, windTimeBlendOn, WIND_BLEND_MAX_GAP_MS } from './windTimeBlend';

const T0 = Date.parse('2026-10-25T00:00:00Z');
const H = 3600000;
const frames = [
  { valid_time: '2026-10-25T00:00:00Z', path: 'a.bin' },
  { valid_time: '2026-10-25T03:00:00Z', path: 'b.bin' },
  { valid_time: '2026-10-25T06:00:00Z', path: null, unbuilt: 'not_local' },
  { valid_time: '2026-10-25T09:00:00Z', path: 'd.bin' },
];
// The codec's convention (staticFrameCodec.buildWindVectors, uv sign -1 = "from" direction): u = -s sin(d), v = -s cos(d).
const vec = (speed, direction) => ({ lat: 0, lng: 0, speed, direction, u: -speed * Math.sin(direction * Math.PI / 180) + 0,
  v: -speed * Math.cos(direction * Math.PI / 180) + 0, is_valid: true });

describe('wind time blend (clip B)', () => {
  afterEach(() => { delete window.__RAW_WIND_TIME_BLEND__; });

  test('opt-in only', () => {
    expect(windTimeBlendOn()).toBe(false);
    window.__RAW_WIND_TIME_BLEND__ = true;
    expect(windTimeBlendOn()).toBe(true);
  });

  test('the bracket: two built neighbours and the weight; none on a frame, outside, across an unbuilt frame', () => {
    expect(blendBracket(frames, T0 + 1 * H)).toMatchObject({ t0: T0, t1: T0 + 3 * H, weight: 1 / 3 });
    expect(blendBracket(frames, T0 + 2 * H).weight).toBeCloseTo(2 / 3, 12);
    expect(blendBracket(frames, T0)).toBeNull();                    // exactly on a frame
    expect(blendBracket(frames, T0 - H)).toBeNull();                // before the first
    expect(blendBracket(frames, T0 + 4 * H)).toBeNull();            // the next frame (06Z) is unbuilt: never bridge it
    expect(blendBracket(frames, T0 + 7 * H)).toBeNull();
    expect(WIND_BLEND_MAX_GAP_MS).toBe(6 * H);
  });

  test('direction takes the SHORTER arc, across north', () => {
    expect(arc(350, 10)).toBe(20);
    expect(arc(10, 350)).toBe(-20);
    expect(arc(90, 270)).toBe(-180);
    const [m] = blendVectors([vec(10, 350)], [vec(10, 10)], 0.5);
    expect(m.direction).toBe(0);
  });

  test('speed is linear in time, so a turning wind keeps its speed (a u/v average would drop it)', () => {
    const [m] = blendVectors([vec(20, 0)], [vec(20, 90)], 0.5);
    expect(m.speed).toBe(20);
    expect(m.direction).toBe(45);
    const uvAvg = Math.hypot((vec(20, 0).u + vec(20, 90).u) / 2, (vec(20, 0).v + vec(20, 90).v) / 2);
    expect(uvAvg).toBeCloseTo(14.14, 2);                             // what this blend avoids
    const [q] = blendVectors([vec(10, 0)], [vec(20, 0)], 1 / 3);
    expect(q.speed).toBeCloseTo(13.33, 2);
  });

  test('u/v are rebuilt in the frames\' own sign convention', () => {
    expect(uvSign([vec(10, 30)])).toBe(-1);
    const [m] = blendVectors([vec(10, 30)], [vec(10, 30)], 0.5);
    expect(m.u).toBeCloseTo(vec(10, 30).u, 3);
    expect(m.v).toBeCloseTo(vec(10, 30).v, 3);
  });

  test('a missing side keeps the frame that has it; shapes must match; weight strictly inside (0, 1)', () => {
    const bad = { lat: 0, lng: 0, speed: 0, direction: 0, u: 0, v: 0, is_valid: false };
    expect(blendVectors([bad], [vec(7, 40)], 0.5)[0].speed).toBe(7);
    expect(blendVectors([vec(1, 0)], [vec(1, 0), vec(1, 0)], 0.5)).toBeNull();
    expect(blendVectors([vec(1, 0)], [vec(1, 0)], 0)).toBeNull();
    expect(blendVectors([vec(1, 0)], [vec(1, 0)], 1)).toBeNull();
  });

  test('the blended JSON is labelled: valid at the selected instant, an estimate, both sources named, never a stored product id', () => {
    const j = (pid, v) => ({ product_id: pid, model: 'GFS', grid: { cols: 1, rows: 1, vectors: [v] }, valid_time: 'x' });
    const br = blendBracket(frames, T0 + H);
    const out = blendWindJson(j('gfs_wind_wind_global_mid_20261025T000000Z.json', vec(10, 0)),
      j('gfs_wind_wind_global_mid_20261025T030000Z.json', vec(16, 30)), br, T0 + H);
    expect(out.valid_time).toBe('2026-10-25T01:00:00Z');
    expect(out.served_valid_time).toBe('2026-10-25T01:00:00Z');
    expect(out.is_estimated).toBe(true);
    expect(out.time_blend).toMatchObject({ from: '2026-10-25T00:00:00Z', to: '2026-10-25T03:00:00Z', weight: 0.333,
      from_product: 'gfs_wind_wind_global_mid_20261025T000000Z.json', to_product: 'gfs_wind_wind_global_mid_20261025T030000Z.json' });
    expect(out.product_id).not.toMatch(/_\d{8}T\d{6}Z\.json$/);   // no stored-product id: nothing reads it as a frame
    expect(out.grid.vectors[0].speed).toBe(12);
    expect(out.grid.vectors[0].direction).toBe(10);
  });
});
