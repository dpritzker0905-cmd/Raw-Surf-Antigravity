/**
 * The status line's words for three states from the lead's 10-26/10-27 live rounds (dev 4bd90d0d9), replayed offline through the
 * real record (marineDrawnFrame.publishMarineDrawn), the real words (drawnFrameReadout) and the real line (ForecastTimeStatus).
 *   1. "Estimated forecast: estimated" (a doubled word; wrong at a native hour) over a rating frame and over unnamed bases.
 *   2. A tab idle ~10 h: the wheel's +156 moved with the clock to 11-03T08Z, the drawn frame stayed at 11-03T03Z, and the line
 *      said "beyond EURO’s range". It now names the clock (and an older run when the manifest shows one).
 *   3. EURO swell_1 at z9 drawn from a 10.313-degree grid with no user-facing words.
 * Each fix ships ON; each kill switch is pinned to bring back the live reading.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ForecastTimeStatus from './ForecastTimeStatus';
import { publishMarineDrawn, getMarineDrawn, latestKnownRunMs, _resetMarineDrawnForTest } from './marineDrawnFrame';
import { describeDrawnFrame, describeCoarseGrid, formatInstant, reconcileStaleBadge } from './drawnFrameReadout';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const H = 3600000;
const KILLS = ['DRAWN_ESTIMATE_WORDS', 'DRAWN_HOLD_REASON', 'COARSE_GRID_WORDS'];
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
// A world/regional marine grid as the conform hands it to the engine (the fields the record reads).
const grid = (extra = {}) => ({
  hourOffset: 0, __componentLayer: 'waves', __sourceModel: 'GFS', bounds: { west: -82, east: -78, south: 26, north: 30 },
  cols: 17, rows: 17, is_estimated: false, estimate_basis: null, ...extra,
});
const sel = (model, layer, hour, extra = {}) => {
  const anchor = Math.round(Date.now() / H) * H;
  return { model, layer, hour, labelMs: anchor + hour * H, instantMs: anchor + hour * H, nearestMaxHours: 1, ...extra };
};

beforeEach(() => {
  jest.useFakeTimers('modern');
  _resetMarineDrawnForTest();
});
afterEach(() => {
  jest.useRealTimers();
  setCachedManifest(null);
  for (const k of KILLS) delete window[`__RAW_DISABLE_${k}__`];
  delete window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
});

describe('1. no doubled "estimated", and none over a native hour', () => {
  test('a rating frame (surf transform stamps is_estimated, no basis) at GFS hour 0 says nothing; kill = the live reading', () => {
    jest.setSystemTime(Date.parse('2026-10-26T15:00:00Z'));
    const g = grid({ ratingMode: true, is_estimated: true });
    publishMarineDrawn(g);
    expect(getMarineDrawn().estimated).toBe(false);
    expect(describeDrawnFrame(sel('GFS', 'waves', 0), getMarineDrawn())).toBeNull();
    window.__RAW_DISABLE_DRAWN_ESTIMATE_WORDS__ = true;
    publishMarineDrawn({ ...g });
    expect(describeDrawnFrame(sel('GFS', 'waves', 0), getMarineDrawn()))
      .toEqual({ state: 'estimated', text: 'Estimated forecast: estimated' });   // what the lead read live (R6)
  });

  test('replay: band OFF at a native EURO hour, the rating resident lingers ~1.9 s, then the plain frame lands: no word throughout', () => {
    jest.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
    const base = { __sourceModel: 'EURO', hourOffset: 24, bounds: { west: -82.5, east: -78, south: 25.5, north: 31 }, cols: 19, rows: 23 };
    publishMarineDrawn(grid({ ...base, ratingMode: true, is_estimated: true }));   // band ON
    const words = [];
    for (let t = 0; t <= 1900; t += 100) {                                          // band OFF; the next commit lands at +1.9 s
      jest.advanceTimersByTime(100);
      words.push(describeDrawnFrame(sel('EURO', 'waves', 24), getMarineDrawn()));
    }
    publishMarineDrawn(grid({ ...base, ratingMode: false, is_estimated: false }));
    words.push(describeDrawnFrame(sel('EURO', 'waves', 24), getMarineDrawn()));
    expect(words.every((w) => w === null)).toBe(true);
  });

  test('a rating frame over a REAL estimate keeps its basis words (the flag is only discounted when the surf model is all it says)', () => {
    jest.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
    publishMarineDrawn(grid({ __sourceModel: 'ICON', ratingMode: true, is_estimated: true, estimate_basis: { type: 'icon_extended_blend' } }));
    expect(describeDrawnFrame(sel('ICON', 'waves', 0), getMarineDrawn()))
      .toEqual({ state: 'estimated', text: 'Estimated forecast: blended from GFS and EURO beyond ICON’s range' });
  });

  test('EURO’s tail blends have words (R9 read "Estimated forecast: estimated" at h294-h336); an unnamed basis is not doubled', () => {
    jest.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
    const say = (type) => {
      publishMarineDrawn(grid({ __sourceModel: 'EURO', hourOffset: 300, is_estimated: true, estimate_basis: { type } }));
      return describeDrawnFrame(sel('EURO', 'waves', 300), getMarineDrawn()).text;
    };
    expect(say('euro_persistence_gfs_blend')).toBe('Estimated forecast: beyond EURO’s range, blended with GFS');
    expect(say('euro_persistence_gfs_icon_blend')).toBe('Estimated forecast: beyond EURO’s range, blended with GFS and ICON');
    expect(say('some_future_basis')).toBe('Estimated forecast');
    window.__RAW_DISABLE_DRAWN_ESTIMATE_WORDS__ = true;
    expect(say('euro_persistence_gfs_blend')).toBe('Estimated forecast: estimated');
    expect(say('some_future_basis')).toBe('Estimated forecast: estimated');
  });
});

describe('2. a held frame names the clock and the run, not range', () => {
  // The live read: tab idle ~10 h; the wheel's +156 now names 11-03T08Z; the drawn frame's data is 11-03T03Z.
  const DRAWN_AT = Date.parse('2026-10-27T10:00:00Z');   // anchor when the frame was drawn
  const NOW = Date.parse('2026-10-27T20:00:00Z');        // 10 h later: anchor + 156 h = 11-03T08Z
  const DATA = Date.parse('2026-11-03T03:00:00Z');
  const RUN = Date.parse('2026-10-27T00:00:00Z');
  const drawAndIdle = (extra = {}) => {
    jest.setSystemTime(DRAWN_AT);
    publishMarineDrawn(grid({ __sourceModel: 'EURO', __componentLayer: 'waves', hourOffset: 156, served_valid_time: iso(DATA),
      is_estimated: true, model_run_time: iso(RUN), model_run_time_status: 'known', ...extra }));
    jest.setSystemTime(NOW);
    return getMarineDrawn();
  };
  const requested = (extra = {}) => sel('EURO', 'waves', 156, { nearestMaxHours: 3, ...extra });

  test('the replay: "drawn 10 h ago, and the selected time has moved on" (was "beyond EURO’s range")', () => {
    const drawn = drawAndIdle();
    expect(requested().labelMs).toBe(Date.parse('2026-11-03T08:00:00Z'));
    const r = describeDrawnFrame(requested(), drawn);
    expect(r).toMatchObject({ state: 'held', stale: true,
      text: `Holding ${formatInstant(DATA, true)}’s EURO forecast: drawn 10 h ago, and the selected time has moved on` });
    expect(reconcileStaleBadge(null, requested(), drawn)).toBe('retained_stale_warning');   // the point card's badge stays
    window.__RAW_DISABLE_DRAWN_HOLD_REASON__ = true;
    expect(describeDrawnFrame(requested(), drawn).text).toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: beyond EURO’s range`);
  });

  test('with a newer verified cycle in the manifest, the words add "from an older run"', () => {
    const drawn = drawAndIdle();
    setCachedManifest({ products: [
      { model: 'EURO', domain: 'marine', layer: 'waves', model_run_time: iso(RUN), model_run_time_status: 'known' },
      { model: 'EURO', domain: 'marine', layer: 'waves', model_run_time: iso(RUN + 12 * H), model_run_time_status: 'known' },
      { model: 'EURO', domain: 'marine', layer: 'waves', model_run_time: iso(RUN + 24 * H), model_run_time_status: 'missing' },
    ] });
    expect(latestKnownRunMs('EURO', 'waves')).toBe(RUN + 12 * H);                // verified cycles only
    expect(describeDrawnFrame(requested({ latestRunMs: latestKnownRunMs('EURO', 'waves') }), drawn).text)
      .toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: drawn 10 h ago from an older run, and the selected time has moved on`);
  });

  test('an older run alone (no roll) replaces only the generic range words; a basis with its own reason keeps it', () => {
    jest.setSystemTime(NOW);
    publishMarineDrawn(grid({ __sourceModel: 'EURO', hourOffset: 156, served_valid_time: iso(DATA), is_estimated: true,
      model_run_time: iso(RUN), model_run_time_status: 'known' }));
    const r = requested({ latestRunMs: RUN + 12 * H });
    expect(describeDrawnFrame(r, getMarineDrawn()).text).toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: from an older EURO run`);
    publishMarineDrawn(grid({ __sourceModel: 'EURO', hourOffset: 156, served_valid_time: iso(DATA), is_estimated: true,
      estimate_basis: { type: 'far_edge_hold' }, model_run_time: iso(RUN), model_run_time_status: 'known' }));
    expect(describeDrawnFrame(r, getMarineDrawn()).text).toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: the 14-day estimate ends there`);
  });

  test('a NON-estimate drawn before the roll is held and named too ("Loading" promised a fetch an idle tab never makes)', () => {
    const drawn = drawAndIdle({ is_estimated: false });
    expect(describeDrawnFrame(requested(), drawn).text)
      .toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: drawn 10 h ago, and the selected time has moved on`);
  });

  test('controls: no roll and no older run keeps the range words; a scrub to another hour still reads "Loading"', () => {
    jest.setSystemTime(NOW);
    publishMarineDrawn(grid({ __sourceModel: 'EURO', hourOffset: 156, served_valid_time: iso(DATA), is_estimated: true }));
    expect(describeDrawnFrame(requested(), getMarineDrawn()).text).toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: beyond EURO’s range`);
    const drawn = drawAndIdle();
    expect(describeDrawnFrame(sel('EURO', 'waves', 160, { nearestMaxHours: 3 }), drawn).state).toBe('pending');
  });
});

describe('3. a coarse drawn grid is said in words', () => {
  // EURO swell_1 global_coarse: 33 x 17 nodes over -180..150 x -80..85 -> 330/32 = 10.3125, the HUD's "COARSE 10.313° GRID".
  const euroCoarse = (extra = {}) => grid({ __sourceModel: 'EURO', __componentLayer: 'swell_1', hourOffset: 6,
    bounds: { west: -180, east: 150, south: -80, north: 85 }, cols: 33, rows: 17, ...extra });

  test('the record carries the HUD\'s own spacing; the words name model, layer and degrees', () => {
    jest.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
    publishMarineDrawn(euroCoarse());
    expect(getMarineDrawn().resolutionDeg).toBe(10.313);
    expect(describeCoarseGrid({ model: 'EURO', layer: 'swell_1' }, getMarineDrawn()))
      .toEqual({ state: 'coarse', deg: 10.313, text: 'Coarse grid: EURO Swell points are 10.3° apart' });
  });

  test('quiet for the 2-degree world tier, a regional tile, another layer (a switch) and under the kill switch', () => {
    jest.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
    publishMarineDrawn(euroCoarse({ cols: 166, rows: 83, bounds: { west: -180, east: 150, south: -80, north: 84 } }));   // 2.0 deg
    expect(describeCoarseGrid({ model: 'EURO', layer: 'swell_1' }, getMarineDrawn())).toBeNull();
    publishMarineDrawn(grid({ __sourceModel: 'EURO', __componentLayer: 'swell_1' }));                                  // 0.25 deg
    expect(describeCoarseGrid({ model: 'EURO', layer: 'swell_1' }, getMarineDrawn())).toBeNull();
    publishMarineDrawn(euroCoarse());
    expect(describeCoarseGrid({ model: 'EURO', layer: 'waves' }, getMarineDrawn())).toBeNull();
    window.__RAW_DISABLE_COARSE_GRID_WORDS__ = true;
    expect(describeCoarseGrid({ model: 'EURO', layer: 'swell_1' }, getMarineDrawn())).toBeNull();
  });

  test.each(['light', 'dark', 'beach'])('ForecastTimeStatus (%s) speaks it as a status line, before the time readout', (theme) => {
    jest.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
    act(() => { publishMarineDrawn(euroCoarse({ is_estimated: true, estimate_basis: { type: 'euro_persistence_gfs_blend' } })); });
    const { container } = render(<ForecastTimeStatus model="EURO" layer="swell_1" hour={6} theme={theme} />);
    const lines = screen.getAllByRole('status');
    expect(lines.map((l) => l.textContent)).toEqual([
      'Coarse grid: EURO Swell points are 10.3° apart',
      'Estimated forecast: beyond EURO’s range, blended with GFS',
    ]);
    expect(lines[0].getAttribute('aria-live')).toBe('polite');
    expect(lines[0].className).toContain(theme === 'light' ? 'text-slate-600' : 'text-slate-300');
    expect(container.querySelector('[data-coarse-grid]').getAttribute('data-coarse-grid')).toBe('10.313');
  });
});
