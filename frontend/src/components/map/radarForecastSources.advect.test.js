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
  it('ON by default: advect frames at 15/30/45/60 (cap 60) with correct leadFactor + observed paths', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST);
    const advect = frames.filter(f => f.source === 'advect');
    expect(advect.map(f => f.minutes)).toEqual([15, 30, 45, 60]);
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 600); // 1.5 observed-intervals
    expect(advect[3].leadFactor).toBeCloseTo((60 * 60) / 600); // 6.0
    expect(advect[0].prevPath).toBe('/v2/radar/PREV');
    expect(advect[0].currPath).toBe('/v2/radar/CURR');
    expect(advect[0].future).toBe(true);
  });

  it('explicit __RAW_RADAR_ADVECTION__=false opts out (HRRR owns the near term again)', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, { __RAW_RADAR_ADVECTION__: false }, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'advect')).toBe(false);
    expect(frames.some(f => (f.time - NOW_S) <= 30 * 60)).toBe(true);
  });

  it('ON: HRRR yields the near term (all HRRR frames beyond the advect cap) and the list is time-ordered', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST);
    const hrrr = frames.filter(f => f.source === 'iem_hrrr');
    expect(hrrr.length).toBeGreaterThan(0);
    expect(hrrr.every(f => (f.time - NOW_S) > 60 * 60)).toBe(true);
    const times = frames.map(f => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('kill switch __RAW_RADAR_ADVECTION_DISABLED__ overrides the default', () => {
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
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', null, PAST);
    expect(frames.length).toBe(4); // 15/30/45/60 (cap 60)
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

describe('radar advection — Stage 2 far-term (smooth model precip field)', () => {
  const VT = (m) => new Date(NOW + m * 60000).toISOString();
  // hourly precip valid-times around now (indices 0..6 = -60..+300 min)
  const META = { __MODEL_METADATA_CACHE__: { ncep_gfs013: { validTimes: [VT(-60), VT(0), VT(60), VT(120), VT(180), VT(240), VT(300)] } } };

  it('warm metadata: near-term advected, far-term = om MODEL precip frames (HRRR replaced)', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, { ...META }, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'advect')).toBe(true);
    const model = frames.filter(f => f.source === 'ommodel');
    expect(model.map(f => f.minutes)).toEqual([120, 180, 240]); // past the 60-min advect cap, within the 240 cap
    expect(frames.some(f => f.source === 'iem_hrrr')).toBe(false);
    const times = frames.map(f => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b)); // time-ordered across advect→model
  });

  it('the om:// source-url carries the resolved valid-time index + precipitation variable', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, { ...META }, 'CONUS', RUN, PAST);
    const first = frames.find(f => f.source === 'ommodel');
    const url = radarForecastTileUrl(first, { ...META });
    expect(url).toContain('om://https://map-tiles.open-meteo.com/data_spatial/ncep_gfs013/latest.json');
    expect(url).toContain('variable=precipitation');
    expect(url).toMatch(/time_step=valid_times_3\b/); // +120 min = index 3 in the mock grid
  });

  it('per-model precip source: ICON→dwd_icon, EURO→ecmwf_ifs025', () => {
    const iconMeta = { __MODEL_METADATA_CACHE__: { dwd_icon: { validTimes: [VT(120), VT(180)] } } };
    const iconUrl = radarForecastTileUrl(
      radarFutureFramesForModel('ICON', NOW, iconMeta, 'CONUS', RUN, PAST).find(f => f.source === 'ommodel'),
      iconMeta
    );
    expect(iconUrl).toContain('/data_spatial/dwd_icon/');
  });

  it('kill switch __RAW_RADAR_MODEL_FAR_DISABLED__ → legacy HRRR far-term', () => {
    const win = { ...META, __RAW_RADAR_MODEL_FAR_DISABLED__: true };
    const frames = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'ommodel')).toBe(false);
    expect(frames.some(f => f.source === 'iem_hrrr')).toBe(true);
  });

  it('cold metadata (cache not warmed) falls back to HRRR gracefully', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'ommodel')).toBe(false);
    expect(frames.some(f => f.source === 'iem_hrrr')).toBe(true);
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
