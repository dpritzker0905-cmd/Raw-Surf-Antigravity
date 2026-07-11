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
  it('ON by default (via the cached proxy): advect frames 15/30/45/60, no HRRR far-term (Windy/Ventusky)', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST);
    const advect = frames.filter(f => f.source === 'advect');
    expect(advect.map(f => f.minutes)).toEqual([15, 30, 45, 60]);
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 600); // 1.5 observed-intervals
    expect(advect[3].leadFactor).toBeCloseTo((60 * 60) / 600); // 6.0
    expect(advect[0].prevPath).toBe('/v2/radar/PREV');
    expect(advect[0].currPath).toBe('/v2/radar/CURR');
    expect(advect[0].future).toBe(true);
    // the long forecast is the SEPARATE Precip layer — no coarse far-term seamed into radar
    expect(frames.some(f => f.source === 'iem_hrrr')).toBe(false);
    const times = frames.map(f => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('__RAW_RADAR_ADVECTION__=false opts out → HRRR owns the forecast (incl the near term)', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, { __RAW_RADAR_ADVECTION__: false }, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'advect')).toBe(false);
    expect(frames.some(f => f.source === 'iem_hrrr')).toBe(true);
    expect(frames.some(f => (f.time - NOW_S) <= 30 * 60)).toBe(true);
  });

  it('__RAW_RADAR_HRRR_FAR__=true adds the HRRR far-term back past the advect cap', () => {
    const frames = radarFutureFramesForModel('GFS', NOW, { __RAW_RADAR_HRRR_FAR__: true }, 'CONUS', RUN, PAST);
    expect(frames.some(f => f.source === 'advect')).toBe(true);
    const hrrr = frames.filter(f => f.source === 'iem_hrrr');
    expect(hrrr.length).toBeGreaterThan(0);
    expect(hrrr.every(f => (f.time - NOW_S) > 60 * 60)).toBe(true); // advect still owns <=60 min
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

describe('radar advection — ~30-min motion baseline (#16 "frames don\'t slide")', () => {
  // Full 13-frame catalog at the real 10-min cadence, newest last.
  const FULL = Array.from({ length: 13 }, (_, i) => ({
    time: NOW_S - 600 - (12 - i) * 600,
    path: `/v2/radar/F${12 - i}0`, // F00 = newest (10 min ago), F120 = oldest (130 min ago)
  }));

  it('pairs curr with the frame ~30 min earlier (not the adjacent one); leadFactor uses the real interval', () => {
    const advect = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, FULL).filter(f => f.source === 'advect');
    expect(advect[0].currPath).toBe('/v2/radar/F00');
    expect(advect[0].prevPath).toBe('/v2/radar/F30'); // 30 min before curr
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 1800); // 0.5 baselines ahead
    expect(advect[3].leadFactor).toBeCloseTo((60 * 60) / 1800); // 2.0 — was 6.0 on the 10-min pair
  });

  it('lever __RAW_RADAR_ADVECT_BASELINE_MIN__ ≤10 restores the legacy adjacent pair', () => {
    const win = { __RAW_RADAR_ADVECT_BASELINE_MIN__: 10 };
    const advect = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, FULL).filter(f => f.source === 'advect');
    expect(advect[0].prevPath).toBe('/v2/radar/F10');
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 600);
  });

  it('lever picks other baselines (20 min)', () => {
    const win = { __RAW_RADAR_ADVECT_BASELINE_MIN__: 20 };
    const advect = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, FULL).filter(f => f.source === 'advect');
    expect(advect[0].prevPath).toBe('/v2/radar/F20');
  });

  it('short catalog degrades to the widest available pair', () => {
    const short = FULL.slice(-3); // 10/20/30 min ago → widest pair = 20-min interval
    const advect = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, short).filter(f => f.source === 'advect');
    expect(advect[0].prevPath).toBe('/v2/radar/F20');
    expect(advect[0].leadFactor).toBeCloseTo((15 * 60) / 1200);
  });

  it('2-frame catalog = the legacy adjacent pair (all older tests unchanged)', () => {
    const advect = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, PAST).filter(f => f.source === 'advect');
    expect(advect[0].prevPath).toBe('/v2/radar/PREV');
    expect(advect[0].leadFactor).toBeCloseTo(1.5);
  });

  it('irregular cadence: picks the frame CLOSEST to the target baseline', () => {
    const irregular = [
      { time: NOW_S - 600 - 2700, path: '/v2/radar/OLD45' }, // 45 min before curr
      { time: NOW_S - 600 - 1500, path: '/v2/radar/OLD25' }, // 25 min before curr — closest to 30
      { time: NOW_S - 600, path: '/v2/radar/CURRX' },
    ];
    const advect = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, irregular).filter(f => f.source === 'advect');
    expect(advect[0].prevPath).toBe('/v2/radar/OLD25');
  });

  it('malformed frames (no path/time) are skipped by the walk-back', () => {
    const holey = [
      { time: NOW_S - 600 - 1800, path: '/v2/radar/GOOD30' },
      { time: NOW_S - 600 - 1200 }, // no path
      { path: '/v2/radar/NOTIME' }, // no time
      { time: NOW_S - 600, path: '/v2/radar/CURRX' },
    ];
    const advect = radarFutureFramesForModel('GFS', NOW, {}, 'CONUS', RUN, holey).filter(f => f.source === 'advect');
    expect(advect.length).toBe(4); // still emits — the walk-back found a valid pair
    expect(advect[0].prevPath).toBe('/v2/radar/GOOD30');
  });
});

describe('radar advection — advect-rv:// URL', () => {
  it('builds <leadFactor>|<prevTileUrl>|<currTileUrl> through the same-origin /rv/ proxy (default)', () => {
    const win = {}; // no location → not localhost → proxied (production behavior)
    const advect = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST).find(f => f.source === 'advect');
    const url = radarForecastTileUrl(advect, win);
    expect(url).toBe(
      `advect-rv://${advect.leadFactor}` +
      '|/rv/v2/radar/PREV/256/{z}/{x}/{y}/7/1_0.png' +
      '|/rv/v2/radar/CURR/256/{z}/{x}/{y}/7/1_0.png'
    );
  });

  it('__RAW_RADAR_PROXY_DISABLED__ / localhost → direct RainViewer URLs (no proxy)', () => {
    const win = { __RAW_RADAR_PROXY_DISABLED__: true };
    const advect = radarFutureFramesForModel('GFS', NOW, win, 'CONUS', RUN, PAST).find(f => f.source === 'advect');
    expect(radarForecastTileUrl(advect, win)).toBe(
      `advect-rv://${advect.leadFactor}` +
      '|https://tilecache.rainviewer.com/v2/radar/PREV/256/{z}/{x}/{y}/7/1_0.png' +
      '|https://tilecache.rainviewer.com/v2/radar/CURR/256/{z}/{x}/{y}/7/1_0.png'
    );
  });

  it('returns null for a malformed advect frame (missing paths)', () => {
    expect(radarForecastTileUrl({ future: true, source: 'advect', leadFactor: 2 }, {})).toBeNull();
  });
});
