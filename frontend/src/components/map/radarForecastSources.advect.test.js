/**
 * radarForecastSources.advect.test.js — advection frame emission + advect-rv:// URL (backlog #2).
 * Pure logic (no DOM/network) — the protocol HANDLER's tile warping is verified separately (unit
 * tests for the core in radarAdvection.test.js) + a LIVE CONUS-storm visual check. Here we lock:
 *   - OFF by default → byte-identical HRRR behavior (no advect frames)
 *   - ON (opt-in) → correct advect frames, HRRR yields the near term, timeline stays time-ordered
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

describe('radar advection — frame emission', () => {
  it('OFF by default: no advect frames, HRRR near-term frames present (unchanged behavior)', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some(f => f.source === 'advect')).toBe(false);
    // near-term HRRR frames (<=30 min) are NOT skipped when advection is off
    expect(frames.some(f => (f.time - NOW_S) <= 30 * 60)).toBe(true);
  });

  it('ON (opt-in): advect frames at 15/30 with correct leadFactor + observed paths', () => {
    const win = { __RAW_RADAR_ADVECTION__: true };
    const frames = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST);
    const advect = frames.filter(f => f.source === 'advect');
    expect(advect.map(f => f.minutes)).toEqual([15, 30]);
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 600); // 1.5 observed-intervals
    expect(advect[1].leadFactor).toBeCloseTo((30 * 60) / 600); // 3.0
    expect(advect[0].prevPath).toBe('/v2/radar/PREV');
    expect(advect[0].currPath).toBe('/v2/radar/CURR');
    expect(advect[0].future).toBe(true);
  });

  it('ON: HRRR yields the near term (all HRRR frames beyond the advect cap) and the list is time-ordered', () => {
    const win = { __RAW_RADAR_ADVECTION__: true };
    const frames = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST);
    const hrrr = frames.filter(f => f.source === 'iem_hrrr');
    expect(hrrr.length).toBeGreaterThan(0);
    expect(hrrr.every(f => (f.time - NOW_S) > 30 * 60)).toBe(true);
    const times = frames.map(f => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('kill switch __RAW_RADAR_ADVECTION_DISABLED__ overrides the opt-in', () => {
    const win = { __RAW_RADAR_ADVECTION__: true, __RAW_RADAR_ADVECTION_DISABLED__: true };
    const frames = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'advect')).toBe(false);
  });

  it('guards: <2 past frames or an implausible observed interval → no advect frames', () => {
    const win = { __RAW_RADAR_ADVECTION__: true };
    expect(radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, [PAST[1]]).some(f => f.source === 'advect')).toBe(false);
    const farApart = [{ time: NOW_S - 7800, path: '/a' }, { time: NOW_S - 600, path: '/b' }]; // 7200s > 1h cap
    expect(radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, farApart).some(f => f.source === 'advect')).toBe(false);
  });

  it('advect works standalone when no HRRR run is discovered (advect-only frames)', () => {
    const win = { __RAW_RADAR_ADVECTION__: true };
    const frames = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', null, PAST);
    expect(frames.length).toBe(2);
    expect(frames.every(f => f.source === 'advect')).toBe(true);
  });

  it('advection is CONUS-only: EU/none regions never emit advect frames', () => {
    const win = { __RAW_RADAR_ADVECTION__: true };
    expect(radarFutureFramesForModel('EURO', NOW, win, 'EU', RUN, PAST).some(f => f.source === 'advect')).toBe(false);
    expect(radarFutureFramesForModel('GFS', NOW, win, 'NONE', RUN, PAST)).toEqual([]);
  });

  it('tunable cap/step', () => {
    const win = { __RAW_RADAR_ADVECTION__: true, __RAW_RADAR_ADVECT_CAP_MIN__: 20, __RAW_RADAR_ADVECT_STEP_MIN__: 10 };
    const advect = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST).filter(f => f.source === 'advect');
    expect(advect.map(f => f.minutes)).toEqual([10, 20]);
  });
});

describe('radar advection — advect-rv:// URL', () => {
  it('builds <leadFactor>|<prevTileUrl>|<currTileUrl> with a shared {z}/{x}/{y}', () => {
    const win = { __RAW_RADAR_ADVECTION__: true };
    const advect = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST).find(f => f.source === 'advect');
    const url = radarForecastTileUrl(advect, win);
    expect(url).toBe(
      `advect-rv://${advect.leadFactor}` +
      '|https://tilecache.rainviewer.com/v2/radar/PREV/256/{z}/{x}/{y}/7/1_0.png' +
      '|https://tilecache.rainviewer.com/v2/radar/CURR/256/{z}/{x}/{y}/7/1_0.png'
    );
  });

  it('returns null for a malformed advect frame (missing paths)', () => {
    expect(radarForecastTileUrl({ future: true, source: 'advect', leadFactor: 2 }, {})).toBeNull();
  });
});
