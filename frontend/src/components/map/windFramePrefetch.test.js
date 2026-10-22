/**
 * The wind run's idle prefetch (2026-10-22): which frames, in which order, and on which devices (windFramePrefetch.js).
 */
import { fillBlocker, planWind } from './windFramePrefetch';
import { WIND_SET_KEY } from './windStaticFrames';

const LANE = { key: 'wind_lane/hrrr-2026102218.json', cycle: '2026-10-22T18:00:00Z', horizon: '2026-10-24T18:00:00Z', feather_km: 200, taper_hours: 3, source: 's' };
const vt = (h) => new Date(Date.parse('2026-10-22T12:00:00Z') + h * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const INDEX = {
  wind_lane: LANE,
  frames: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27].map((h) => ({ valid_time: vt(h), is_estimated: false, path: `v1/f/${h}.bin`,
    meta: { wind_lane: { lane: h < 6 ? 'gfs' : 'hrrr+gfs', valid_time: vt(h) } } })).concat([
    { valid_time: vt(30), is_estimated: false, path: null, unbuilt: 'not_local' }]),
};
const NOW = Date.parse('2026-10-22T22:00:00Z');
const settled = { ...LANE, written_at: '2026-10-22T19:00:00Z' };

describe('the wind prefetch plan', () => {
  test('nearest the cursor first, every built frame of the run, never an unbuilt one', () => {
    const plan = planWind(INDEX, settled, Date.parse(vt(12)), Infinity, NOW);
    expect(plan[0]).toEqual({ key: WIND_SET_KEY, validTime: vt(12), path: 'v1/f/12.bin' });
    expect(plan.slice(1, 3).map((p) => p.validTime).sort()).toEqual([vt(9), vt(15)].sort());
    expect(plan).toHaveLength(10);
    expect(plan.some((p) => p.path === null)).toBe(false);
  });

  test('a radius keeps the window; a lane the box does not hold drops the frames the lane check refuses', () => {
    expect(planWind(INDEX, settled, Date.parse(vt(12)), 1, NOW)).toHaveLength(3);
    const other = { ...LANE, key: 'wind_lane/hrrr-2026102300.json', cycle: '2026-10-23T00:00:00Z', horizon: '2026-10-25T00:00:00Z', written_at: '2026-10-22T19:00:00Z' };
    const plan = planWind(INDEX, other, Date.parse(vt(12)), Infinity, NOW);
    expect(plan.every((p) => Date.parse(p.validTime) < Date.parse(LANE.cycle))).toBe(true);   // before both lanes: GFS on both sides
    expect(planWind(INDEX, null, Date.parse(vt(12)), Infinity, NOW)).toEqual([]);           // no pointer: nothing is served, nothing fetched
  });

  test('the device policy: a desktop fills, Save-Data and 2g do not; a desktop reading 3g still fills (D-048)', () => {
    const mm = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    expect(fillBlocker({ connection: { effectiveType: '4g' } })).toBe(null);
    expect(fillBlocker({ connection: { effectiveType: '3g' } })).toBe(null);
    expect(fillBlocker({ connection: { saveData: true } })).not.toBe(null);
    expect(fillBlocker({ connection: { effectiveType: '2g' } })).not.toBe(null);
    window.matchMedia = () => ({ matches: true });                                          // a coarse pointer (a phone)
    expect(fillBlocker({ connection: { effectiveType: '4g' } })).toBe('coarse_pointer');
    window.matchMedia = mm;
  });
});
