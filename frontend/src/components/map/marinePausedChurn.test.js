/**
 * Paused heat map churn (2026-10-08, owner's screen recording + console of dev 3b7ca954).
 *
 * THE SCENE, from the console: GFS Waves, timeline PAUSED at offset 16, z7.26 off the Florida east coast. While nothing moved, the
 * drawn grid kept changing between the 0.25-degree series tile (23 x 13 over 5.5 degrees, hour label 15) and the 2-degree mid clip
 * served by /grid (25 x 19 over 48 degrees, hour label 16); "Series hit for hour=16 - committing warmed frame" printed 20+ times.
 * Every one of those frames was valid 2026-10-09 12:00Z: GFS waves are 3-hourly there, so offset 15 (12:00Z) and offset 16 (13:00Z,
 * which the manifest snaps to the 12:00Z product) are one forecast time under two labels.
 *
 * TWO READERS TOOK THE LABEL FOR THE DATA:
 *   1. the scrub-settle check: "label 15 != selected 16" => stale, so it re-committed the series frame on every trigger (each a new
 *      revision, so the engine re-uploaded it) and, on a series miss, fetched /grid for hour 16 - the coarse clip;
 *   2. the no-downgrade guard (label mode, the shipped default): "16 !== 15" => an hour change, so the 2-degree clip replaced the
 *      covering 0.25-degree tile, which is the exact downgrade the guard exists to block. The clamp detector then sharpened back.
 *
 * Each case below states what it is: the FIXED SCENE must hold still (failed before the fix), and the POSITIVE CONTROLS must still move
 * (another forecast time, another model, no manifest, no valid time, the kill switch, identity mode).
 */
import { runScrubSettleCheck } from './useMarineScrubSettle';
import { getMarineSeriesFrame } from './marineGridSeries';
import { setCachedManifest } from './backendWeatherServiceClient';
import { decideMarineCommit, __resetArbiterGraceForTests } from './marineCommitGate';
import fs from 'fs';
import path from 'path';
import { frameServesSelectedHour, uploadedGridServesHour } from './marineHourInstant';
import { sameMarineLabelledHour, sameMarineRequestedInstant } from './marineFrameInstant';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));

// The recording's clock (16:58:22 EDT): the forecast anchor rounds to 21:00Z.
const NOW = Date.parse('2026-10-08T20:58:22Z');
const T12 = '2026-10-09T12:00:00Z';
const T15 = '2026-10-09T15:00:00Z';
// EURO is listed at the same times so the "another model" controls are refused by the MODEL, not by a time that happens to differ.
const MANIFEST = {
  products: ['GFS', 'EURO'].flatMap(model => ['06', '09', '12', '15', '18'].map(h => (
    { model, domain: 'marine', layer: 'waves', valid_time_start: `2026-10-09T${h}:00:00Z` }))),
};
// The logged viewport and grids.
const VIEW = { west: -82.47, south: 27.03, east: -77.93, north: 29.06 };
const VB = [VIEW.west, VIEW.south, VIEW.east, VIEW.north];
const ZOOM = 7.26;
const vec = [{ lat: 28, lng: -80, speed: 1.2, u: 0.1, v: 0.1 }];
const seriesTile = (over = {}) => ({
  vectors: vec, cols: 23, rows: 13, bounds: { west: -82.75, south: 26.6, east: -77.21, north: 29.6 },
  hourOffset: 15, valid_time: T12, served_valid_time: null, __renderable: true, __fromSeries: true,
  __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false, ...over,
});
const midClip = (over = {}) => ({
  vectors: vec, cols: 25, rows: 19, bounds: { west: -106, south: 10, east: -58, north: 46 },
  hourOffset: 16, valid_time: T12, served_valid_time: null, __renderable: true,
  __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false, ...over,
});
const wrap = (g, over = {}) => ({ grid: g, hourOffset: g.hourOffset, valid_time: g.valid_time, __sourceModel: g.__sourceModel, ...over });

const mkMap = () => ({
  getZoom: () => ZOOM,
  getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }),
});
const mkCtx = (resident, hour = 16, model = 'GFS') => ({
  marineData: resident, mapInstance: mkMap(), setMarineData: jest.fn(),
  timeOffsetRef: { current: hour }, activeModelRef: { current: model }, activeMarineLayerRef: { current: 'waves' },
  safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
  marineFetchLocksRef: { current: { isFetching: false, lastHash: 'abc' } }, updateMarineGridRef: { current: jest.fn() },
  marineRevision: { current: 0 }, lastCommittedSigRef: { current: 'SIG' },
});
const savedEnv = process.env.REACT_APP_FORECAST_STATE_IDENTITY;

beforeEach(() => {
  jest.clearAllMocks();
  window.__MOCK_DATE_NOW__ = NOW;
  setCachedManifest(MANIFEST);
  window.isScrubbingTimeline = false;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__RAW_DISABLE_HOUR_BY_INSTANT__;
  delete window.__RAW_MARINE_ARBITER__;
  delete process.env.REACT_APP_FORECAST_STATE_IDENTITY;
  __resetArbiterGraceForTests();
});
afterEach(() => {
  delete window.__MOCK_DATE_NOW__;
  delete window.__MARINE_ENGINE__;
  setCachedManifest(null);
  if (savedEnv === undefined) delete process.env.REACT_APP_FORECAST_STATE_IDENTITY;
  else process.env.REACT_APP_FORECAST_STATE_IDENTITY = savedEnv;
});

describe('frameServesSelectedHour (pure)', () => {
  it('is true when the drawn frame was made for the instant the selected hour asks for (the logged case: label 15, offset 16, both 12:00Z)', () => {
    expect(frameServesSelectedHour(wrap(seriesTile()), 16, 'GFS', 'waves')).toBe(true);
    expect(frameServesSelectedHour(wrap(seriesTile()), 15, 'GFS', 'waves')).toBe(true);
  });
  it.each([
    ['another forecast time (offset 18 asks for 15:00Z)', wrap(seriesTile()), 18, 'GFS'],
    ['another model selected', wrap(seriesTile()), 16, 'EURO'],
    ['a drawn frame with no valid time', wrap(seriesTile({ valid_time: undefined }), { valid_time: undefined }), 16, 'GFS'],
    ['an unparseable valid time', wrap(seriesTile({ valid_time: 'soon' }), { valid_time: 'soon' }), 16, 'GFS'],
    ['nothing drawn', null, 16, 'GFS'],
  ])('is false for %s', (_l, resident, hour, model) => {
    expect(frameServesSelectedHour(resident, hour, model, 'waves')).toBe(false);
  });
  it('is false for another layer', () => {
    expect(frameServesSelectedHour(wrap(seriesTile({ __componentLayer: 'swell' })), 16, 'GFS', 'waves')).toBe(false);
  });
  it('without a manifest the hour maps to anchor + offset (13:00Z), so differing labels stay differing: the old behaviour', () => {
    setCachedManifest(null);
    expect(frameServesSelectedHour(wrap(seriesTile()), 16, 'GFS', 'waves')).toBe(false);
    expect(frameServesSelectedHour(wrap(seriesTile()), 15, 'GFS', 'waves')).toBe(true);
  });
  it('honours the kill switch', () => {
    window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;
    expect(frameServesSelectedHour(wrap(seriesTile()), 16, 'GFS', 'waves')).toBe(false);
  });
});

describe('the scrub-settle check in the FIXED SCENE (paused at offset 16, the series tile drawn)', () => {
  beforeEach(() => {
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: seriesTile() } };     // the engine draws the fine tile: no clamp
  });

  it('holds still across 20 settle ticks: no re-commit, no fetch (before the fix: 20 commits, one per tick)', () => {
    getMarineSeriesFrame.mockReturnValue(wrap(seriesTile()));
    const ctx = mkCtx(wrap(seriesTile()));
    for (let i = 0; i < 20; i++) runScrubSettleCheck(ctx);
    expect(ctx.setMarineData).not.toHaveBeenCalled();
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();
  });

  it('does not fetch /grid for hour 16 when the series misses (before the fix: the "timeline_scrub" fetch that brought the 2-degree clip)', () => {
    getMarineSeriesFrame.mockReturnValue(null);
    const ctx = mkCtx(wrap(seriesTile()));
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();
    expect(ctx.marineFetchLocksRef.current.lastHash).toBe('abc');
  });

  it('POSITIVE CONTROL: a genuine time change (offset 18, the 15:00Z product) still commits the warmed frame', () => {
    getMarineSeriesFrame.mockReturnValue(wrap(seriesTile({ hourOffset: 18, valid_time: T15 })));
    const ctx = mkCtx(wrap(seriesTile()), 18);
    runScrubSettleCheck(ctx);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE CONTROL: a genuine time change with a series miss still fetches', () => {
    getMarineSeriesFrame.mockReturnValue(null);
    const ctx = mkCtx(wrap(seriesTile()), 18);
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledWith('timeline_scrub');
  });

  it.each([
    ['another model selected', () => mkCtx(wrap(seriesTile()), 16, 'EURO')],
    ['no manifest yet', () => { setCachedManifest(null); return mkCtx(wrap(seriesTile())); }],
    ['a drawn frame with no valid time', () => mkCtx(wrap(seriesTile({ valid_time: undefined }), { valid_time: undefined }))],
    ['the kill switch', () => { window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true; return mkCtx(wrap(seriesTile())); }],
  ])('POSITIVE CONTROL: %s keeps the old label test (the warmed frame is committed)', (_l, build) => {
    getMarineSeriesFrame.mockReturnValue(wrap(seriesTile()));
    const ctx = build();
    runScrubSettleCheck(ctx);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
  });
});

describe('the no-downgrade guard in the FIXED SCENE (label mode, the shipped default)', () => {
  it('rejects the 2-degree clip over the covering 0.25-degree tile of the same 12:00Z forecast (before the fix: accepted, labels 16 vs 15)', () => {
    const d = decideMarineCommit(seriesTile(), midClip(), ZOOM, VB, window, NOW);
    expect(d).toMatchObject({ reject: true, why: 'downgrade' });
  });

  it('the arbiter (opt-in) agrees, so the guard/arbiter differential stays whole', () => {
    window.__RAW_MARINE_ARBITER__ = true;
    expect(decideMarineCommit(seriesTile(), midClip(), ZOOM, VB, window, NOW).reject).toBe(true);
    expect(decideMarineCommit(seriesTile(), midClip({ hourOffset: 18, valid_time: T15 }), ZOOM, VB, window, NOW).reject).toBe(false);
    window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;                    // the kill switch reaches the arbiter's rule too
    expect(decideMarineCommit(seriesTile(), midClip(), ZOOM, VB, window, NOW).reject).toBe(false);
  });

  it.each([
    ['a genuine time change (the 15:00Z product)', midClip({ hourOffset: 18, valid_time: T15 })],
    ['labels that differ with no valid time to compare (the old test decides)', midClip({ valid_time: undefined })],
    ['another model (a deliberate switch)', midClip({ __sourceModel: 'EURO' })],
  ])('POSITIVE CONTROL: accepts %s', (_l, incoming) => {
    expect(decideMarineCommit(seriesTile(), incoming, ZOOM, VB, window, NOW).reject).toBe(false);
  });

  it('POSITIVE CONTROL: the kill switch restores the old acceptance', () => {
    window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;
    expect(decideMarineCommit(seriesTile(), midClip(), ZOOM, VB, window, NOW).reject).toBe(false);
  });

  it('leaves identity mode alone: there only a served clock certifies a frame, and with none it releases as designed', () => {
    process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'true';
    expect(decideMarineCommit(seriesTile(), midClip(), ZOOM, VB, window, NOW).reject).toBe(false);
  });

  it('the wide-view sub-cover reject reads the same "same hour" (a 4-degree regional must not replace the world resident at one forecast time)', () => {
    const world = { vectors: vec, cols: 37, rows: 17, bounds: { west: -180, south: -80, east: 180, north: 85 }, hourOffset: 15, valid_time: T12,
      __renderable: true, __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false };
    const regional = { ...seriesTile({ bounds: { west: -83, south: 26, east: -79, north: 30 }, cols: 16, rows: 16 }), hourOffset: 16 };
    const wide = [-110, 5, -50, 45];
    expect(decideMarineCommit(world, regional, 5.2, wide, window, NOW)).toMatchObject({ reject: true, why: 'subcover' });
    expect(decideMarineCommit(world, { ...regional, valid_time: T15, hourOffset: 18 }, 5.2, wide, window, NOW).reject).toBe(false);
  });
});

describe('sameMarineLabelledHour / sameMarineRequestedInstant (pure)', () => {
  it('only widens the label test: equal labels stay one hour, equal requested instants join them', () => {
    expect(sameMarineLabelledHour({ hourOffset: 3 }, { hourOffset: 3 })).toBe(true);
    expect(sameMarineLabelledHour({ hourOffset: 3 }, { hourOffset: 4 })).toBe(false);
    expect(sameMarineLabelledHour({ hourOffset: 15, valid_time: T12 }, { hourOffset: 16, valid_time: '2026-10-09T08:00:00-04:00' })).toBe(true);
    expect(sameMarineLabelledHour({ valid_time: T12 }, { valid_time: T12 })).toBe(true);
    expect(sameMarineLabelledHour({}, {})).toBe(false);
  });
  it('needs both instants, and refuses impossible ones', () => {
    expect(sameMarineRequestedInstant({ valid_time: T12 }, {})).toBe(false);
    expect(sameMarineRequestedInstant({ valid_time: '2026-02-30T12:00:00Z' }, { valid_time: '2026-02-30T12:00:00Z' })).toBe(false);
  });
});

// THE DISCLOSURE HALF. The recording shows "Stale Hour Retained" on some frames. WebGLMarineLayer raised it from
// `requestedHour === renderedDataHour`, labels again, so the 12:00Z tile labelled 15 read as stale at offset 16. Held still by the
// fix above, that tile would have kept a false warning up for good; the badge must read the same instant rule.
describe('uploadedGridServesHour (the layer render-hour parity behind "Stale Hour Retained")', () => {
  // The record WebGLMarineLayer keeps for the uploaded grid (lastUploadedGridRef).
  const sig = (over = {}) => ({ activeModel: 'GFS', activeMarineLayer: 'waves', componentLayer: 'waves', vectorsLength: 1,
    renderedDataHour: 15, renderedValidTime: T12, ...over });

  it('is true for the 12:00Z tile at offset 16 (the badge was a false warning)', () => {
    expect(uploadedGridServesHour(sig(), 16, 'GFS')).toBe(true);
  });
  it.each([
    ['a genuine stale hour (12:00Z drawn, offset 18 asks for 15:00Z)', sig(), 18, 'GFS'],
    ['another model selected than the one drawn', sig(), 16, 'EURO'],
    ['an upload with no valid time recorded', sig({ renderedValidTime: null }), 16, 'GFS'],
    ['a grid of another layer than the selected one', sig({ componentLayer: 'swell_1' }), 16, 'GFS'],
    ['no upload yet', null, 16, 'GFS'],
  ])('POSITIVE CONTROL: is false for %s, so the badge still shows', (_l, s, hour, model) => {
    expect(uploadedGridServesHour(s, hour, model)).toBe(false);
  });
  it('POSITIVE CONTROL: the kill switch restores the label-only parity', () => {
    window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;
    expect(uploadedGridServesHour(sig(), 16, 'GFS')).toBe(false);
  });

  // No unit test mounts WebGLMarineLayer (a WebGL engine), so the wiring is asserted in SOURCE, house style
  // (marineCommitGate.wiring.test.js), each assertion with a negative control so an empty match cannot pass for clean.
  const LAYER_SRC = fs.readFileSync(path.join(__dirname, 'WebGLMarineLayer.js'), 'utf8');
  it('the layer parity reads the instant rule, and the upload record carries the valid time it needs', () => {
    expect(LAYER_SRC).toMatch(/const parity = active && renderedDataHour !== null &&\s*\(requestedHour === renderedDataHour \|\| uploadedGridServesHour\(lastSig, requestedHour, activeModel\)\)/);
    expect(LAYER_SRC).toMatch(/renderedValidTime: \(grid\.grid && grid\.grid\.valid_time\) \|\| grid\.valid_time \|\| null,/);
    expect(LAYER_SRC).not.toMatch(/const parity = active && renderedDataHour !== null && requestedHour === renderedDataHour;/);   // the old line is gone
  });
});
