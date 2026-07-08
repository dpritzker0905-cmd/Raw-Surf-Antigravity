/**
 * radarForecastSources.advect.test.js — GLOBAL advection frame emission + advect-rv:// URL (backlog #2).
 * Pure logic (no DOM/network) — the protocol HANDLER's tile warping is verified separately (unit tests
 * for the core in radarAdvection.test.js) + a LIVE CONUS-storm visual check. Here we lock:
 *   - ON by default, GLOBAL (emits with NO regional model — the "radar only over the USA" fix)
 *   - regional models (HRRR/DWD) supplement the leads BEYOND the advect cap; timeline stays ordered
 *   - the kill switch, the guards (too-few/too-far past frames), advect-only when no HRRR run
 *   - the advect-rv:// URL shape the protocol handler parses
 */
import { radarFutureFramesForModel, radarForecastTileUrl } from './radarForecastSources';

const NOW = 1_800_000_000_000;          // fixed wall clock (ms)
const NOW_S = Math.floor(NOW / 1000);
const RUN = NOW - 60 * 60000;           // HRRR run 1h ago → valid
// Two observed RainViewer past frames, 10 min apart (the real cadence).
const PAST = [
  { time: NOW_S - 1200, path: '/v2/radar/PREV' }, // 20 min ago
  { time: NOW_S - 600, path: '/v2/radar/CURR' },  // 10 min ago  → obs interval 600s
];
const advectOf = (frames) => frames.filter(f => f.source === 'advect');

describe('radar advection — GLOBAL frame emission (ON by default)', () => {
  it('ON by default: advect frames at 15/30/45/60 (cap 60), correct leadFactor + observed paths', () => {
    const advect = advectOf(radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST));
    expect(advect.map(f => f.minutes)).toEqual([15, 30, 45, 60]);
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 600); // 1.5 observed-intervals
    expect(advect[3].leadFactor).toBeCloseTo((60 * 60) / 600); // 6.0
    expect(advect[0].prevPath).toBe('/v2/radar/PREV');
    expect(advect[0].currPath).toBe('/v2/radar/CURR');
    expect(advect[0].future).toBe(true);
  });

  it('GLOBAL: emits with NO regional model (region NONE → advect-only) — the "USA-only" fix', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'NONE', RUN, PAST);
    expect(frames.length).toBe(4);
    expect(frames.every(f => f.source === 'advect')).toBe(true);
  });

  it('CONUS: advect owns the near term, HRRR supplements beyond the cap; list is time-ordered', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST);
    const hrrr = frames.filter(f => f.source === 'iem_hrrr');
    expect(advectOf(frames).length).toBe(4);
    expect(hrrr.length).toBeGreaterThan(0);
    expect(hrrr.every(f => (f.time - NOW_S) > 60 * 60)).toBe(true);      // all HRRR beyond the 60-min cap
    const times = frames.map(f => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('EU: advect owns the near term, DWD supplements beyond the cap', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'EU', RUN, PAST);
    const dwd = frames.filter(f => f.source === 'dwd_wn');
    expect(advectOf(frames).length).toBe(4);
    expect(dwd.length).toBeGreaterThan(0);
    expect(dwd.every(f => f.minutes > 60)).toBe(true);
  });

  it('kill switch __RAW_RADAR_ADVECTION_DISABLED__ → pure regional (no advect), near-term HRRR restored', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, { __RAW_RADAR_ADVECTION_DISABLED__: true }, 'CONUS', RUN, PAST);
    expect(advectOf(frames).length).toBe(0);
    expect(frames.some(f => (f.time - NOW_S) <= 30 * 60)).toBe(true);    // near-term HRRR NOT skipped
    // …and outside CONUS/EU with advection killed → no future at all (pre-2026-07-08 behavior)
    expect(radarFutureFramesForModel('GFS', NOW, { __RAW_RADAR_ADVECTION_DISABLED__: true }, 'NONE', RUN, PAST)).toEqual([]);
  });

  it('guards: <2 past frames or an implausible observed interval → no advect frames', () => {
    expect(advectOf(radarFutureFramesForModel('GFS', NOW, {}, 'NONE', RUN, [PAST[1]]))).toHaveLength(0);
    const farApart = [{ time: NOW_S - 7800, path: '/a' }, { time: NOW_S - 600, path: '/b' }]; // 7200s > 1h cap
    expect(advectOf(radarFutureFramesForModel('GFS', NOW, {}, 'NONE', RUN, farApart))).toHaveLength(0);
  });

  it('advect works standalone when no HRRR run is discovered (CONUS, runMs null)', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', null, PAST);
    expect(frames.length).toBe(4);
    expect(frames.every(f => f.source === 'advect')).toBe(true);
  });

  it('tunable cap/step', () => {
    const win = { __RAW_RADAR_ADVECT_CAP_MIN__: 20, __RAW_RADAR_ADVECT_STEP_MIN__: 10 };
    expect(advectOf(radarFutureFramesForModel('GFS', NOW, win, 'NONE', RUN, PAST)).map(f => f.minutes)).toEqual([10, 20]);
  });
});

describe('radar advection — advect-rv:// URL', () => {
  it('builds <leadFactor>|<prevTileUrl>|<currTileUrl> with a shared {z}/{x}/{y}', () => {
    const advect = advectOf(radarFutureFramesForModel('GFS', NOW, {}, 'NONE', RUN, PAST))[0];
    expect(radarForecastTileUrl(advect, {})).toBe(
      `advect-rv://${advect.leadFactor}` +
      '|https://tilecache.rainviewer.com/v2/radar/PREV/256/{z}/{x}/{y}/7/1_0.png' +
      '|https://tilecache.rainviewer.com/v2/radar/CURR/256/{z}/{x}/{y}/7/1_0.png'
    );
  });

  it('returns null for a malformed advect frame (missing paths)', () => {
    expect(radarForecastTileUrl({ future: true, source: 'advect', leadFactor: 2 }, {})).toBeNull();
  });
});
