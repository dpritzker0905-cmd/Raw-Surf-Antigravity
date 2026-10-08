/**
 * Paused heat map churn — the COMMIT TRAJECTORY (2026-10-08; Codex's diagnosis asked for one, not single-call assertions).
 *
 * This mounts the real `useMarineScrubSettle` hook (the settle check, the scrub-end/revalidation/moveend triggers and the 1 s render
 * backstop with its no-progress cap) on fake timers, and routes every commit through the real `decideMarineCommit` choke, as
 * WebGLMarineEngine.setWaveData does. What is simulated, and how:
 *   - the engine resident: `window.__MARINE_ENGINE__._waveData.waveGrid` (what detectClamp reads), replaced only by an admitted grid;
 *   - a /grid fetch (`updateMarineGridRef`): 1.5 s of latency with `__MARINE_FETCH_PENDING__` set, then the 2-degree mid clip the
 *     logged /grid served for the selected hour (25 x 19 over 48 degrees), committed through the same choke;
 *   - background series loads: `marine_series_revalidated` every 3 s (the log's series load count kept climbing while paused), and
 *     the series cache missing one lookup in four (revalidation windows);
 *   - the hourly world warm is switched off (`__RAW_DISABLE_HOUR_WORLD_WARM__`): it warms the held base, not the resident.
 * Every offer is recorded with its producer lane, dims, cell sizes, requested instant and verdict.
 *
 * The kill switch (`__RAW_DISABLE_HOUR_BY_INSTANT__`) runs the RECORDED defect through the same harness: it must churn, or the harness
 * could not see churn and a quiet "fixed" run would prove nothing.
 */
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useMarineScrubSettle } from './useMarineScrubSettle';
import { getMarineSeriesFrame, ensureMarineSeries } from './marineGridSeries';
import { setCachedManifest, getSharedValidTime } from './backendWeatherServiceClient';
import { decideMarineCommit, __resetArbiterGraceForTests } from './marineCommitGate';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));

const NOW = Date.parse('2026-10-08T20:58:22Z');           // the recording's clock: the anchor rounds to 21:00Z
const T12 = '2026-10-09T12:00:00Z';
const MANIFEST = { products: ['06', '09', '12', '15', '18'].map(h => (
  { model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: `2026-10-09T${h}:00:00Z` })) };
const VIEW = { west: -82.47, south: 27.03, east: -77.93, north: 29.06 };
const VB = [VIEW.west, VIEW.south, VIEW.east, VIEW.north];
const ZOOM = 7.26;
const vec = [{ lat: 28, lng: -80, speed: 1.2, u: 0.1, v: 0.1 }];
const base = { vectors: vec, __renderable: true, __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false, served_valid_time: null };
const TILE_BOUNDS = { west: -82.75, south: 26.6, east: -77.21, north: 29.6 };
const tile = (over = {}) => ({ ...base, cols: 23, rows: 13, bounds: TILE_BOUNDS, hourOffset: 15, valid_time: T12, __fromSeries: true, ...over });
const clip = (hour, valid) => ({ ...base, cols: 25, rows: 19, bounds: { west: -106, south: 10, east: -58, north: 46 }, hourOffset: hour, valid_time: valid });
const wrap = (g, lane) => ({ grid: g, hourOffset: g.hourOffset, valid_time: g.valid_time, __sourceModel: 'GFS', ...(lane ? { __commitLane: lane } : {}) });
const instantFor = hour => new Date(getSharedValidTime(hour, 'waves', 'GFS', { readOnly: true })).toISOString().replace('.000Z', 'Z');
const span = b => b.east - b.west;
const dimsOf = g => `${g.cols}x${g.rows}@${span(g.bounds).toFixed(2)}`;

function runScene({ start, hour = 16, seriesFor, seconds = 120, onTick, grab }) {
  const log = [];
  const requests = [];
  const stats = { seriesCalls: 0 };
  let resident = start;
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: resident } };
  const offer = (grid, lane) => {
    const d = decideMarineCommit(resident, grid, ZOOM, VB, window, Date.now());
    const switched = !d.reject && dimsOf(grid) !== dimsOf(resident);
    log.push({ t: Date.now() - NOW, lane, dims: dimsOf(grid), lngCell: +(span(grid.bounds) / grid.cols).toFixed(3),
      latCell: +((grid.bounds.north - grid.bounds.south) / grid.rows).toFixed(3), valid: grid.valid_time, reject: d.reject, why: d.why, switched });
    if (!d.reject) { resident = grid; window.__MARINE_ENGINE__ = { _waveData: { waveGrid: grid } }; }
  };
  getMarineSeriesFrame.mockImplementation((_m, _l, _b, h) => {
    stats.seriesCalls++;
    if (stats.seriesCalls % 4 === 0) return null;                  // a revalidation window: the cache misses
    const g = seriesFor(h);
    return g ? wrap(g) : null;
  });
  const timeOffsetRef = { current: hour };
  const refs = {
    timeOffsetRef, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' }, activeMarineLayersRef: { current: ['waves'] },
    marineFetchLocksRef: { current: { isFetching: false, lastHash: 'h' } }, marineRevision: { current: 0 }, lastCommittedSigRef: { current: null },
  };
  const map = { getZoom: () => ZOOM, on: jest.fn(), off: jest.fn(),
    getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }) };
  let setState = null;
  const updateMarineGridRef = { current: (source) => {
    const h = timeOffsetRef.current;
    requests.push({ t: Date.now() - NOW, source, hour: h });
    window.__MARINE_FETCH_PENDING__ = { hour: h, model: 'GFS', layer: 'waves' };
    setTimeout(() => {
      window.__MARINE_FETCH_PENDING__ = null;
      const md = wrap(clip(h, instantFor(h)), `grid:${source}`);
      setState(md); offer(md.grid, md.__commitLane);
    }, 1500);
  } };
  if (grab) grab(updateMarineGridRef.current);
  ensureMarineSeries.mockImplementation(() => { setTimeout(() => window.dispatchEvent(new Event('marine_series_revalidated')), 2000); });
  const hook = renderHook(() => {
    const [marineData, setMarineDataState] = useState(wrap(start));
    setState = setMarineDataState;
    const setMarineData = (md) => { setMarineDataState(md); offer(md.grid, md.__commitLane || 'commit'); };
    useMarineScrubSettle({ mapInstance: map, marineData, setMarineData, updateMarineGridRef, ...refs });
    return marineData;
  });
  for (let ms = 0; ms < seconds * 1000; ms += 500) {
    act(() => {
      if (ms % 3000 === 0) window.dispatchEvent(new Event('marine_series_revalidated'));
      if (onTick) onTick(ms, timeOffsetRef);
      jest.advanceTimersByTime(500);
    });
  }
  hook.unmount();
  const switches = log.filter(e => e.switched);
  return { log, requests, switches, uploads: log.filter(e => !e.reject).length, resident,
    lateSwitches: switches.filter(e => e.t > seconds * 500) };      // the second half of the run: converged or not
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.__MOCK_DATE_NOW__ = NOW;
  setCachedManifest(MANIFEST);
  window.isScrubbingTimeline = false;
  window.__RAW_DISABLE_HOUR_WORLD_WARM__ = true;
  delete window.__RAW_DISABLE_HOUR_BY_INSTANT__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__MARINE_GOVERNOR_STATE__;
  __resetArbiterGraceForTests();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setCachedManifest(null);
  delete window.__MOCK_DATE_NOW__;
  delete window.__MARINE_ENGINE__;
  delete window.__RAW_DISABLE_HOUR_WORLD_WARM__;
  delete window.__RAW_DISABLE_HOUR_BY_INSTANT__;
});

const tileForTheSelectedInstant = h => (instantFor(h) === T12 ? tile() : tile({ hourOffset: h, valid_time: instantFor(h) }));

describe('fixed scene: paused at offset 16, GFS Waves, z7.26, the logged viewport (120 s)', () => {
  it('CONTROL: the recorded defect (kill switch) churns in this harness, so a quiet run below means something', () => {
    window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;
    const r = runScene({ start: tile(), seriesFor: tileForTheSelectedInstant });
    expect(r.switches.length).toBeGreaterThanOrEqual(4);              // the tile <-> clip alternation
    expect(r.uploads).toBeGreaterThanOrEqual(20);                      // + re-commits of the same tile
    expect(r.lateSwitches.length).toBeGreaterThan(0);                  // still switching in the last minute: not converging
  });

  it('the tile drawn: nothing is offered, fetched or switched for two minutes', () => {
    const r = runScene({ start: tile(), seriesFor: tileForTheSelectedInstant });
    expect(r.uploads).toBe(0);
    expect(r.requests).toEqual([]);
    expect(r.resident.cols).toBe(23);
  });

  it('the coarse clip landed first (producer order reversed): one genuine sharpen, the re-fetched clip refused, then still', () => {
    const r = runScene({ start: clip(16, T12), seriesFor: tileForTheSelectedInstant });
    expect(r.switches.map(e => [e.lane, e.dims])).toEqual([['series_sharpen', '23x13@5.54']]);
    expect(r.log.filter(e => e.lane.startsWith('grid:')).every(e => e.reject && e.why === 'downgrade')).toBe(true);
    expect(r.requests.length).toBeLessThanOrEqual(2);                   // the clamp_resharpen cap
    expect(r.lateSwitches).toEqual([]);
    expect(r.resident.cols).toBe(23);
  });

  it('the recorded defect from the same start keeps switching (the control for the case above)', () => {
    window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;
    const r = runScene({ start: clip(16, T12), seriesFor: tileForTheSelectedInstant });
    expect(r.switches.length).toBeGreaterThanOrEqual(3);
  });
});

describe('positive controls: convergence must not come from freezing data', () => {
  it('a genuine time change (16 -> 18, the 15:00Z product) is drawn', () => {
    const r = runScene({
      start: tile(), seriesFor: tileForTheSelectedInstant, seconds: 60,
      onTick: (ms, ref) => { if (ms === 10000) { ref.current = 18; window.dispatchEvent(new Event('timeline_scrub_end')); } },
    });
    expect(r.resident.valid_time).toBe('2026-10-09T15:00:00Z');
    expect(r.log.some(e => !e.reject && e.valid === '2026-10-09T15:00:00Z')).toBe(true);
  });

  it('a tile covering under 60% of the view gives way to the covering clip at the SAME instant (incomplete coverage is not held)', () => {
    // An offset tile is resident only after a pan, and a pan's moveend fetch belongs to the orchestrator (not this hook): modelled
    // as that fetch at t=0. The guard must admit the covering clip, and nothing here may put the sub-covering tile back.
    const partial = tile({ bounds: { west: -79.2, south: 26.6, east: -73.66, north: 29.6 } });
    let update = null;
    const r = runScene({ start: partial, seriesFor: () => partial, seconds: 60,
      onTick: (ms) => { if (ms === 0) update('viewport_moveend'); } ,
      grab: (u) => { update = u; } });
    expect(r.log[0]).toMatchObject({ lane: 'grid:viewport_moveend', reject: false, valid: T12 });
    expect(r.resident.cols).toBe(25);
    expect(r.lateSwitches).toEqual([]);
  });
});

describe('perturbations, one input at a time (bounded, documented)', () => {
  it('cell axis: a tile fine in longitude but coarse in latitude stays drawn; /grid requests stay within the cap; no switching', () => {
    const latCoarse = tile({ rows: 3 });
    const r = runScene({ start: latCoarse, seriesFor: () => latCoarse });
    expect(r.requests.length).toBeLessThanOrEqual(2);
    expect(r.switches).toEqual([]);
    expect(r.resident.rows).toBe(3);
  });

  it('RESIDUAL (not fixed here, proposed separately): a coarse 6 x 5 series entry for the view converges, but only after swaps', () => {
    const coarseEntry = tile({ cols: 6, rows: 5, bounds: { west: -86, south: 24, east: -76, north: 32 } });
    const r = runScene({ start: clip(16, T12), seriesFor: () => coarseEntry });
    expect(r.requests.length).toBeLessThanOrEqual(2);
    expect(r.lateSwitches).toEqual([]);                                  // bounded by the resharpen cap: it does settle
    expect(r.switches.length).toBeGreaterThanOrEqual(1);                 // ...on a grid the fine tile would beat
  });
});
