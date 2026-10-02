/**
 * Draw the exact world frame at far zoom once the timeline settles (2026-10-01).
 *
 * Replayed live and offline: scrubbing to Wed 15Z at far zoom commits the thinned series frame (46 x 20, an 8° lattice,
 * `decimated_stride` 4) and nothing ever replaces it, so the swell off Florida reads 1.34 m against 2.33 m on the exact
 * frame. These tests pin the decision (pure), the trigger (normal fetch path, bounded), the re-drive hook, and that the
 * backend's thinning stamp survives into the grid.
 */
import { renderHook } from '@testing-library/react';
import {
  EXACT_UPGRADE_DELAY_MS, EXACT_UPGRADE_FORGET_MS, EXACT_UPGRADE_GLOBAL_GAP_MS, EXACT_UPGRADE_MAX_ATTEMPTS, EXACT_UPGRADE_MIN_GAP_MS,
  EXACT_UPGRADE_HOUR_TOLERANCE, EXACT_UPGRADE_RETRY_MS, EXACT_UPGRADE_SOURCE,
  _resetExactUpgradeForTest, exactUpgradeKey, isThinnedWorldGrid, planExactUpgrade, tryExactUpgrade, useMarineExactUpgrade,
} from './marineExactUpgrade';
import { frameToMarineData } from './marineSeriesFrame';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -82, south: 26, east: -79, north: 29 };
const grid = (over = {}) => ({ bounds: WORLD, cols: 46, rows: 20, __decimatedStride: 4, hourOffset: 147, ...over });
const md = (g) => ({ grid: g, hourOffset: g.hourOffset });
const mapOf = ({ w = 120, h = 60, zoom = 3.6 } = {}) => ({
  getBounds: () => ({ getWest: () => -80 - w / 2, getEast: () => -80 + w / 2, getSouth: () => 28 - h / 2, getNorth: () => 28 + h / 2 }),
  getZoom: () => zoom,
});
const ctxOf = (over = {}) => ({
  marineData: md(grid()), mapInstance: mapOf(),
  timeOffsetRef: { current: 147 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
  marineFetchLocksRef: { current: { lastHash: 'viewport-abc' } }, updateMarineGridRef: { current: jest.fn() },
  ...over,
});

beforeEach(() => {
  _resetExactUpgradeForTest();
  delete window.isScrubbingTimeline;
  delete window.__RAW_DISABLE_EXACT_UPGRADE__;
  delete window.__MARINE_FETCH_PENDING__;
  jest.useRealTimers();
});

describe('isThinnedWorldGrid', () => {
  it('is true only for a WORLD-width grid the backend thinned (stride > 1)', () => {
    expect(isThinnedWorldGrid(grid())).toBe(true);
    expect(isThinnedWorldGrid(grid({ __decimatedStride: 2 }))).toBe(true);
  });
  it('is false for the exact frame, an unstamped frame, a regional frame and nothing', () => {
    expect(isThinnedWorldGrid(grid({ __decimatedStride: 0 }))).toBe(false);
    expect(isThinnedWorldGrid(grid({ __decimatedStride: 1 }))).toBe(false);
    expect(isThinnedWorldGrid(grid({ __decimatedStride: undefined }))).toBe(false);
    expect(isThinnedWorldGrid(grid({ bounds: TILE }))).toBe(false);          // a thinned REGIONAL frame is not the far-zoom field
    expect(isThinnedWorldGrid(grid({ bounds: undefined }))).toBe(false);
    expect(isThinnedWorldGrid(null)).toBe(false);
  });
  it('reads an antimeridian-crossing world bound as world width', () => {
    expect(isThinnedWorldGrid(grid({ bounds: { west: 10, south: -80, east: 5, north: 85 } }))).toBe(true);   // 355° wide
    expect(isThinnedWorldGrid(grid({ bounds: { west: 10, south: -80, east: -20, north: 85 } }))).toBe(false); // 330° wide
  });
});

describe('planExactUpgrade (pure)', () => {
  const base = { marineData: md(grid()), currentHour: 147, scrubbing: false, wideView: true, fetchPendingForHour: false, attempts: null, nowMs: 1e6, disabled: false };
  it('upgrades a settled thinned world frame for the selected hour at a wide view', () => {
    expect(planExactUpgrade(base)).toEqual({ upgrade: true, reason: 'thinned_world_frame_settled' });
  });
  it.each([
    ['the kill switch', { disabled: true }, 'disabled'],
    ['scrubbing (the thin frame is wanted while the timeline moves)', { scrubbing: true }, 'scrubbing'],
    ['an exact resident', { marineData: md(grid({ __decimatedStride: 0 })) }, 'resident_not_thinned_world'],
    ['another hour (the hour-mismatch branch owns that)', { currentHour: 150 }, 'hour_mismatch'],
    ['a frame with no hour at all', { marineData: { grid: grid({ hourOffset: undefined }) } }, 'hour_mismatch'],
    ['a zoomed-in view (the display gate hides a world frame)', { wideView: false }, 'not_wide_view'],
    ['a fetch already pending for this hour', { fetchPendingForHour: true }, 'fetch_pending'],
  ])('does not upgrade for %s', (_label, over, reason) => {
    expect(planExactUpgrade({ ...base, ...over })).toEqual({ upgrade: false, reason });
  });
  it('treats the nearest warmed frame (within the 1.5 h tolerance) as the frame for the selected hour', () => {
    // live: the selected offset was 147 and the warmed placeholder was the h146 frame (valid 15:00Z): both must upgrade
    expect(planExactUpgrade({ ...base, marineData: md(grid({ hourOffset: 146 })) }).upgrade).toBe(true);
    expect(planExactUpgrade({ ...base, marineData: md(grid({ hourOffset: 147 - EXACT_UPGRADE_HOUR_TOLERANCE })) }).upgrade).toBe(true);
    expect(planExactUpgrade({ ...base, marineData: md(grid({ hourOffset: 147 - EXACT_UPGRADE_HOUR_TOLERANCE - 0.5 })) }).reason).toBe('hour_mismatch');
  });
  it('is bounded: too soon after a try, and exhausted after the cap, until the record is forgotten', () => {
    const now = 1e6;
    expect(planExactUpgrade({ ...base, nowMs: now, attempts: { count: 1, lastAt: now - 100 } }).reason).toBe('too_soon');
    expect(planExactUpgrade({ ...base, nowMs: now, attempts: { count: 1, lastAt: now - EXACT_UPGRADE_MIN_GAP_MS - 1 } }).upgrade).toBe(true);
    expect(planExactUpgrade({ ...base, nowMs: now, attempts: { count: EXACT_UPGRADE_MAX_ATTEMPTS, lastAt: now - EXACT_UPGRADE_MIN_GAP_MS - 1 } }).reason).toBe('attempts_exhausted');
    expect(planExactUpgrade({ ...base, nowMs: now, attempts: { count: EXACT_UPGRADE_MAX_ATTEMPTS, lastAt: now - EXACT_UPGRADE_FORGET_MS - 1 } }).upgrade).toBe(true);
  });
});

describe('tryExactUpgrade (the trigger)', () => {
  it('starts the exact fetch through the NORMAL path, bypassing the same-viewport dedupe, and says so', () => {
    const ctx = ctxOf();
    expect(tryExactUpgrade(ctx)).toBe(true);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledTimes(1);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledWith(EXACT_UPGRADE_SOURCE);
    expect(ctx.marineFetchLocksRef.current.lastHash).toBeNull();
    expect(window.__MARINE_EXACT_UPGRADE__.triggers).toBe(1);
    expect(window.__MARINE_EXACT_UPGRADE__.last.key).toBe(exactUpgradeKey('GFS', 'waves', 147));
  });
  it('does nothing for an exact resident, while scrubbing, zoomed in, killed, or with no map', () => {
    const exact = ctxOf({ marineData: md(grid({ __decimatedStride: 0 })) });
    expect(tryExactUpgrade(exact)).toBe(false);
    window.isScrubbingTimeline = true;
    const scrubbing = ctxOf();
    expect(tryExactUpgrade(scrubbing)).toBe(false);
    delete window.isScrubbingTimeline;
    const zoomedIn = ctxOf({ mapInstance: mapOf({ w: 4, h: 3, zoom: 9 }) });
    expect(tryExactUpgrade(zoomedIn)).toBe(false);
    window.__RAW_DISABLE_EXACT_UPGRADE__ = true;
    const killed = ctxOf();
    expect(tryExactUpgrade(killed)).toBe(false);
    delete window.__RAW_DISABLE_EXACT_UPGRADE__;
    expect(tryExactUpgrade(ctxOf({ mapInstance: null }))).toBe(false);
    for (const c of [exact, scrubbing, zoomedIn, killed]) expect(c.updateMarineGridRef.current).not.toHaveBeenCalled();
  });
  it('treats a fetch already pending for this very hour as the upgrade in flight', () => {
    window.__MARINE_FETCH_PENDING__ = { hour: 147, model: 'GFS', layer: 'waves' };
    const ctx = ctxOf();
    expect(tryExactUpgrade(ctx)).toBe(false);
    window.__MARINE_FETCH_PENDING__ = { hour: 150, model: 'GFS', layer: 'waves' };      // a different hour does not block it
    expect(tryExactUpgrade(ctx)).toBe(true);
  });
  it('cannot storm a backend that cannot serve the exact frame: spaced tries, then it stops, the placeholder stays', () => {
    const realNow = Date.now;
    let t = 5e6;
    Date.now = () => t;
    try {
      const ctx = ctxOf();
      const fired = [];
      for (let i = 0; i < 8; i++) { fired.push(tryExactUpgrade(ctx)); t += EXACT_UPGRADE_MIN_GAP_MS + 1; }
      expect(fired.filter(Boolean)).toHaveLength(EXACT_UPGRADE_MAX_ATTEMPTS);
      expect(ctx.updateMarineGridRef.current).toHaveBeenCalledTimes(EXACT_UPGRADE_MAX_ATTEMPTS);
      t += EXACT_UPGRADE_FORGET_MS + 1;                                                  // a long dwell: it may try again
      expect(tryExactUpgrade(ctx)).toBe(true);
    } finally { Date.now = realNow; }
  });
  it('spaces triggers across hours too: stepping through hours does not fire an exact world fetch per step', () => {
    const realNow = Date.now;
    let t = 7e6;
    Date.now = () => t;
    try {
      const a = ctxOf();
      expect(tryExactUpgrade(a)).toBe(true);                                                  // hour 147
      const b = ctxOf({ timeOffsetRef: { current: 150 }, marineData: md(grid({ hourOffset: 150 })) });
      t += EXACT_UPGRADE_GLOBAL_GAP_MS - 1;
      expect(tryExactUpgrade(b)).toBe(false);                                                 // hour 150, too soon after ANY trigger
      t += 2;
      expect(tryExactUpgrade(b)).toBe(true);
      expect(b.updateMarineGridRef.current).toHaveBeenCalledTimes(1);
    } finally { Date.now = realNow; }
  });
  it('forgets the attempts once the resident is exact, so the next thinned frame gets its full budget', () => {
    const realNow = Date.now;
    let t = 9e6;
    Date.now = () => t;
    try {
      const ctx = ctxOf();
      expect(tryExactUpgrade(ctx)).toBe(true);
      t += EXACT_UPGRADE_MIN_GAP_MS + 1;
      expect(tryExactUpgrade(ctx)).toBe(true);
      ctx.marineData = md(grid({ __decimatedStride: 0 }));                                 // the exact frame landed
      expect(tryExactUpgrade(ctx)).toBe(false);
      ctx.marineData = md(grid());                                                         // a new scrub, thin again
      t += EXACT_UPGRADE_GLOBAL_GAP_MS + 1;                                                // past the global spacing, still inside MIN_GAP
      expect(tryExactUpgrade(ctx)).toBe(true);                                             // not 'too_soon': the record was dropped
    } finally { Date.now = realNow; }
  });
  it('never throws on a half-built context', () => {
    expect(tryExactUpgrade({})).toBe(false);
    expect(tryExactUpgrade(ctxOf({ updateMarineGridRef: null }))).toBe(false);
    expect(tryExactUpgrade(ctxOf({ timeOffsetRef: null }))).toBe(false);
  });
});

describe('useMarineExactUpgrade (the re-drive)', () => {
  it('re-drives the settle check shortly after a thinned world frame lands, and once more as a fallback', () => {
    jest.useFakeTimers();
    const check = jest.fn();
    const checkRef = { current: check };
    const m = md(grid());
    renderHook(() => useMarineExactUpgrade(m, checkRef));
    expect(check).not.toHaveBeenCalled();
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS + 1);
    expect(check).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(EXACT_UPGRADE_RETRY_MS);
    expect(check).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(EXACT_UPGRADE_RETRY_MS * 5);
    expect(check).toHaveBeenCalledTimes(2);                      // never a loop
  });
  it('is NOT re-armed by a re-commit of the SAME grid (the settle check re-commits the warmed frame every pass: a 1 Hz loop otherwise)', () => {
    jest.useFakeTimers();
    const check = jest.fn();
    const checkRef = { current: check };
    const g = grid();
    const { rerender } = renderHook(({ m }) => useMarineExactUpgrade(m, checkRef), { initialProps: { m: { grid: g, hourOffset: 146 } } });
    for (let i = 0; i < 6; i++) {
      jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS + 1);
      rerender({ m: { grid: g, hourOffset: 146, __commitRevision: i + 2 } });                 // stampSeriesCommit: a new wrapper, the same grid
    }
    jest.advanceTimersByTime(EXACT_UPGRADE_RETRY_MS * 3);
    expect(check.mock.calls.length).toBeLessThanOrEqual(2);
    rerender({ m: { grid: grid({ hourOffset: 149 }), hourOffset: 149 } });                    // a DIFFERENT frame re-arms it
    const before = check.mock.calls.length;
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS + 1);
    expect(check.mock.calls.length).toBe(before + 1);
  });
  it('waits for the selected hour to hold still: a click burst starts one check, not one per pause', () => {
    jest.useFakeTimers();
    const check = jest.fn();
    const hourRef = { current: 146 };
    renderHook(() => useMarineExactUpgrade(md(grid()), { current: check }, hourRef));
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS - 200);
    hourRef.current = 147;                                          // a button step lands under the pending drive (the frame is the same one)
    jest.advanceTimersByTime(300);                                  // the drive fires, sees the hour moved, and re-arms instead of checking
    expect(check).not.toHaveBeenCalled();
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS);               // the hour then held still for a whole delay
    expect(check).toHaveBeenCalledTimes(1);
  });
  it('keeps waiting while the hour keeps moving, and a hook given no hour ref still fires after the delay', () => {
    jest.useFakeTimers();
    const check = jest.fn();
    const hourRef = { current: 146 };
    renderHook(() => useMarineExactUpgrade(md(grid()), { current: check }, hourRef));
    for (let i = 0; i < 4; i++) { jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS - 100); hourRef.current += 1; jest.advanceTimersByTime(100); }
    expect(check).not.toHaveBeenCalled();                           // four steps, each inside the delay: nothing fired
    const noRef = jest.fn();
    renderHook(() => useMarineExactUpgrade(md(grid({ hourOffset: 150 })), { current: noRef }));
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS + 1);
    expect(noRef).toHaveBeenCalledTimes(1);
  });
  it('gives every hour its upgrade budget back when an exact world frame lands (an erratic zoom must not exhaust it)', () => {
    const realNow = Date.now;
    let t = 3e7;
    Date.now = () => t;
    try {
      const ctx = ctxOf();
      for (let i = 0; i < EXACT_UPGRADE_MAX_ATTEMPTS; i++) { expect(tryExactUpgrade(ctx)).toBe(true); t += EXACT_UPGRADE_MIN_GAP_MS + 1; }
      expect(tryExactUpgrade(ctx)).toBe(false);                                            // exhausted: the placeholder would stay
      renderHook(() => useMarineExactUpgrade(md(grid({ __decimatedStride: 0, cols: 181, rows: 82 })), { current: jest.fn() }));
      expect(tryExactUpgrade(ctx)).toBe(true);                                             // an exact world frame was served: the budget is whole
    } finally { Date.now = realNow; }
  });
  it('does not give the budget back for a thinned frame or a regional one', () => {
    const realNow = Date.now;
    let t = 4e7;
    Date.now = () => t;
    try {
      const ctx = ctxOf();
      for (let i = 0; i < EXACT_UPGRADE_MAX_ATTEMPTS; i++) { tryExactUpgrade(ctx); t += EXACT_UPGRADE_MIN_GAP_MS + 1; }
      renderHook(() => useMarineExactUpgrade(md(grid()), { current: jest.fn() }));                             // thin: no
      renderHook(() => useMarineExactUpgrade(md(grid({ bounds: TILE, __decimatedStride: 0 })), { current: jest.fn() }));   // regional exact: no
      expect(tryExactUpgrade(ctx)).toBe(false);
    } finally { Date.now = realNow; }
  });
  it('stays silent for an exact frame, an unstamped frame, and no data', () => {
    jest.useFakeTimers();
    const check = jest.fn();
    for (const m of [md(grid({ __decimatedStride: 0 })), md(grid({ bounds: TILE })), null]) renderHook(() => useMarineExactUpgrade(m, { current: check }));
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS * 3);
    expect(check).not.toHaveBeenCalled();
  });
  it('cancels the re-drive when the frame is replaced or the hook unmounts', () => {
    jest.useFakeTimers();
    const check = jest.fn();
    const checkRef = { current: check };
    const { rerender, unmount } = renderHook(({ m }) => useMarineExactUpgrade(m, checkRef), { initialProps: { m: md(grid()) } });
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS - 100);
    rerender({ m: md(grid({ __decimatedStride: 0 })) });                                   // the exact frame arrived first
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS * 2);
    expect(check).not.toHaveBeenCalled();
    rerender({ m: md(grid()) });
    unmount();
    jest.advanceTimersByTime(EXACT_UPGRADE_DELAY_MS * 2);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('frameToMarineData keeps the backend thinning stamp', () => {
  const frame = (over = {}) => ({ hour_offset: 147, valid_time: '2026-10-07T15:00:00Z', cols: 46, rows: 21, bounds: WORLD,
    vectors: [{ lat: 0, lng: 0, speed: 1, direction: 0, u: 0, v: 1 }], provider: 'open-meteo', ...over });
  it('stamps __decimatedStride from `decimated_stride`', () => {
    expect(frameToMarineData(frame({ decimated_stride: 4 }), 'GFS', 'waves').grid.__decimatedStride).toBe(4);
  });
  it('is 0 for an exact frame, whatever the stamp says about stride 1 or junk', () => {
    expect(frameToMarineData(frame(), 'GFS', 'waves').grid.__decimatedStride).toBe(0);
    expect(frameToMarineData(frame({ decimated_stride: 1 }), 'GFS', 'waves').grid.__decimatedStride).toBe(0);
    expect(frameToMarineData(frame({ decimated_stride: 'x' }), 'GFS', 'waves').grid.__decimatedStride).toBe(0);
  });
  it('makes the converted frame recognisable as a thinned world frame', () => {
    expect(isThinnedWorldGrid(frameToMarineData(frame({ decimated_stride: 4 }), 'GFS', 'waves').grid)).toBe(true);
    expect(isThinnedWorldGrid(frameToMarineData(frame(), 'GFS', 'waves').grid)).toBe(false);
  });
});
