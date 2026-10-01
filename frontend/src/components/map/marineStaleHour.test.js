/**
 * The wrong-hour world frame (2026-10-01, audit F-21): the pure rules.
 *
 * Select Wednesday at a regional zoom and zoom out: the engine drew the world frame the page had loaded with (the "now" hour,
 * swell 0.78 m where Wednesday reads 2.33 m) at full strength for 4 to 5 s, under a readout that said Wed. Replayed offline on the
 * unfixed build in every variant (jump and wheel, cold and warm). These tests pin the three rules that stop it: a right-hour seed
 * replaces a base made for another hour; a world frame for another hour is drawn provisional; and an unknown time fails open.
 */
import {
  gridValidMs, coarseBaseOutdatedBy, coarseBaseStaleForSeed, isWorldGrid, isStaleWorldGrid, judgeStaleWorld, resolveStaleWorldDim,
  staleResidentSwapWanted, createStaleHourTracker,
  SAME_STEP_TOL_MS, STALE_DIM_MIN_MS, STALE_WORLD_DIM, STALE_HOLD_MS, HOUR_MS,
} from './marineStaleHour';
import { coarseBaseStaleForSeed as viaCommitGate } from './marineCommitGate';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -82, south: 26, east: -79, north: 29 };
const NOW0 = '2026-10-01T12:00:00Z';
const WED15 = '2026-10-07T15:00:00Z';
const ms = (iso) => Date.parse(iso);
const grid = (vt, over = {}) => ({ bounds: WORLD, cols: 181, rows: 82, valid_time: vt, ...over });
const base = (vt, over = {}) => ({ __sourceModel: 'GFS', __componentLayer: 'waves', waveGrid: grid(vt), ...over });

afterEach(() => {
  delete window.__RAW_DISABLE_BASE_HOUR_SYNC__;
  delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
  delete window.__RAW_DISABLE_STALE_HOUR_DIM__;
  delete window.__RAW_STALE_HOUR_DIM__;
  delete window.isScrubbingTimeline;
});

describe('gridValidMs: the hour a frame is made for is its VALID TIME, never its label', () => {
  it('reads served first, then the ask echo, then the truth tag, from a grid, a held base or a marineData wrapper', () => {
    expect(gridValidMs(grid(WED15, { served_valid_time: NOW0 }))).toBe(ms(NOW0));
    expect(gridValidMs(grid(WED15))).toBe(ms(WED15));
    expect(gridValidMs({ bounds: WORLD, truthTag: { valid_time: WED15 } })).toBe(ms(WED15));
    expect(gridValidMs(base(WED15))).toBe(ms(WED15));                                   // the engine's _coarseBaseData
    expect(gridValidMs({ grid: grid(WED15) })).toBe(ms(WED15));                          // a marineData wrapper
  });
  it('is null for an unknown or unparseable time, never a guess', () => {
    expect(gridValidMs(null)).toBeNull();
    expect(gridValidMs(grid(undefined))).toBeNull();
    expect(gridValidMs(grid('soon'))).toBeNull();
    expect(gridValidMs({})).toBeNull();
  });
  it('ignores the hourOffset label entirely (at 3-hourly range one valid time wears several labels)', () => {
    expect(gridValidMs(grid(WED15, { hourOffset: 144 }))).toBe(gridValidMs(grid(WED15, { hourOffset: 147 })));
  });
});

describe('coarseBaseOutdatedBy / coarseBaseStaleForSeed: a right-hour seed replaces a base made for another hour', () => {
  it('the page-load base (now) against a Wednesday seed: outdated', () => {
    expect(coarseBaseOutdatedBy(base(NOW0), grid(WED15))).toBe(true);
    expect(coarseBaseStaleForSeed(base(NOW0), grid(WED15))).toBe(true);
  });
  it('the same valid time, or a snap of it, is NOT outdated (the nearest-step snap is disclosed, not stale)', () => {
    expect(coarseBaseOutdatedBy(base(WED15), grid(WED15))).toBe(false);
    expect(coarseBaseOutdatedBy(base(WED15), grid('2026-10-07T16:00:00Z'))).toBe(false);          // one hour apart
    expect(coarseBaseOutdatedBy(base(WED15), grid('2026-10-07T16:30:00Z'))).toBe(false);          // exactly the tolerance
    expect(coarseBaseOutdatedBy(base(WED15), grid('2026-10-07T18:00:00Z'))).toBe(true);           // the next 3-hourly step
    expect(SAME_STEP_TOL_MS).toBeGreaterThan(1.5 * HOUR_MS);
  });
  it('an unknown valid time on either side fails OPEN (the old behaviour: nothing replaced)', () => {
    expect(coarseBaseOutdatedBy(base(undefined), grid(WED15))).toBe(false);
    expect(coarseBaseOutdatedBy(base(NOW0), grid(undefined))).toBe(false);
    expect(coarseBaseOutdatedBy(null, grid(WED15))).toBe(false);
  });
  it('the identity rules are untouched: no base, another model, another layer', () => {
    expect(coarseBaseStaleForSeed(null, grid(WED15))).toBe(true);
    expect(coarseBaseStaleForSeed(base(WED15, { __sourceModel: 'ICON' }), grid(WED15, { __sourceModel: 'GFS' }))).toBe(true);
    expect(coarseBaseStaleForSeed(base(WED15, { __componentLayer: 'swell_1' }), grid(WED15))).toBe(true);
    expect(coarseBaseStaleForSeed(base(WED15), grid(WED15))).toBe(false);                          // a matching base is kept, as before
  });
  it('the kill switch restores the identity-only test', () => {
    window.__RAW_DISABLE_BASE_HOUR_SYNC__ = true;
    expect(coarseBaseOutdatedBy(base(NOW0), grid(WED15))).toBe(false);
    expect(coarseBaseStaleForSeed(base(NOW0), grid(WED15))).toBe(false);
  });
  it('the engine reads it through the commit lane (one import line, one rule)', () => {
    expect(viaCommitGate).toBe(coarseBaseStaleForSeed);
  });
});

describe('isWorldGrid / isStaleWorldGrid', () => {
  it('a world-width grid only', () => {
    expect(isWorldGrid(grid(NOW0))).toBe(true);
    expect(isWorldGrid(grid(NOW0, { bounds: TILE }))).toBe(false);
    expect(isWorldGrid(grid(NOW0, { bounds: { west: 10, south: -80, east: 5, north: 85 } }))).toBe(true);     // antimeridian, 355 degrees
    expect(isWorldGrid(null)).toBe(false);
  });
  it('stale = a world frame at least a step and a half from the selected instant', () => {
    expect(isStaleWorldGrid(grid(NOW0), ms(WED15))).toBe(true);
    expect(isStaleWorldGrid(grid(WED15), ms(WED15))).toBe(false);
    expect(isStaleWorldGrid(grid('2026-10-07T12:00:00Z'), ms(WED15))).toBe(false);                 // one 3-hourly step behind: a lag, not a different hour
    expect(isStaleWorldGrid(grid('2026-10-07T11:00:00Z'), ms(WED15))).toBe(true);                  // 4 h
    expect(isStaleWorldGrid(grid(NOW0, { bounds: TILE }), ms(WED15))).toBe(false);                  // a regional frame is never "stale world"
    expect(isStaleWorldGrid(grid(undefined), ms(WED15))).toBe(false);
    expect(isStaleWorldGrid(grid(NOW0), NaN)).toBe(false);
  });
});

describe('resolveStaleWorldDim', () => {
  const ctx = (over = {}) => ({ resident: grid(NOW0), selectedMs: ms(WED15), hourHeldMs: STALE_HOLD_MS + 100, ...over });
  it('a stale world frame, the hour held still: drawn at a fraction of its strength', () => {
    expect(resolveStaleWorldDim(ctx())).toEqual({ mult: STALE_WORLD_DIM, stale: true, why: 'stale_world' });
  });
  it.each([
    ['the right hour', { resident: grid(WED15) }, 'same_step', false],
    ['a regional frame', { resident: grid(NOW0, { bounds: TILE }) }, 'not_world', false],
    ['no resident', { resident: null }, 'not_world', false],
    ['an unknown valid time', { resident: grid(undefined) }, 'unknown_time', false],
    ['an unknown selected instant', { selectedMs: NaN }, 'unknown_time', false],
  ])('is untouched for %s', (_l, over, why, stale) => {
    expect(resolveStaleWorldDim(ctx(over))).toEqual({ mult: 1, stale, why });
  });
  it('is untouched while the hour is still moving (a scrub changes the hour every few hundred ms and must not flicker)', () => {
    expect(resolveStaleWorldDim(ctx({ hourHeldMs: STALE_HOLD_MS - 1 }))).toEqual({ mult: 1, stale: true, why: 'hour_moving' });
    window.isScrubbingTimeline = true;
    expect(resolveStaleWorldDim(ctx())).toEqual({ mult: 1, stale: true, why: 'scrubbing' });
  });
  it('honours the kill switch and the tuning lever (an out-of-range lever falls back to the default)', () => {
    window.__RAW_STALE_HOUR_DIM__ = 0.25;
    expect(resolveStaleWorldDim(ctx()).mult).toBe(0.25);
    window.__RAW_STALE_HOUR_DIM__ = 0;
    expect(resolveStaleWorldDim(ctx()).mult).toBe(STALE_WORLD_DIM);
    window.__RAW_STALE_HOUR_DIM__ = 7;
    expect(resolveStaleWorldDim(ctx()).mult).toBe(STALE_WORLD_DIM);
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    expect(resolveStaleWorldDim(ctx())).toEqual({ mult: 1, stale: false, why: 'killed' });
  });
  it('never throws on junk', () => {
    expect(resolveStaleWorldDim()).toEqual({ mult: 1, stale: false, why: 'not_world' });
    expect(resolveStaleWorldDim({})).toEqual({ mult: 1, stale: false, why: 'not_world' });
    expect(STALE_DIM_MIN_MS).toBeGreaterThan(3 * HOUR_MS);                                          // more than one 3-hourly step
  });
  it('the dim is a visible, provisional strength: neither untouched nor invisible (the engine\'s own provisional floors are 0.3 to 0.7)', () => {
    expect(STALE_WORLD_DIM).toBeGreaterThan(0.2);
    expect(STALE_WORLD_DIM).toBeLessThanOrEqual(0.7);
    expect(STALE_HOLD_MS).toBeGreaterThanOrEqual(400);                                              // a scrub moves the hour every few hundred ms and must not flicker
  });
});

describe('judgeStaleWorld: the judgment the dim and the resident swap share, with no kill switch of its own', () => {
  const ctx = (over = {}) => ({ resident: grid(NOW0), selectedMs: ms(WED15), hourHeldMs: STALE_HOLD_MS + 100, ...over });
  it('a stale world frame, the hour held still: stale_world (the consumer may act)', () => {
    expect(judgeStaleWorld(ctx())).toEqual({ stale: true, why: 'stale_world' });
  });
  it.each([
    ['the right hour', { resident: grid(WED15) }, { stale: false, why: 'same_step' }],
    ['a regional frame', { resident: grid(NOW0, { bounds: TILE }) }, { stale: false, why: 'not_world' }],
    ['an unknown valid time', { resident: grid(undefined) }, { stale: false, why: 'unknown_time' }],
    ['an unknown selected instant', { selectedMs: NaN }, { stale: false, why: 'unknown_time' }],
    ['an hour that has not held still', { hourHeldMs: STALE_HOLD_MS - 1 }, { stale: true, why: 'hour_moving' }],
  ])('is not actionable for %s', (_l, over, want) => {
    expect(judgeStaleWorld(ctx(over))).toEqual(want);
  });
  it('is not actionable while scrubbing, and ignores the dim kill switch (the swap has its own)', () => {
    window.isScrubbingTimeline = true;
    expect(judgeStaleWorld(ctx())).toEqual({ stale: true, why: 'scrubbing' });
    window.isScrubbingTimeline = false;
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    expect(judgeStaleWorld(ctx())).toEqual({ stale: true, why: 'stale_world' });
    expect(resolveStaleWorldDim(ctx())).toEqual({ mult: 1, stale: false, why: 'killed' });
  });
  it('never throws on junk', () => {
    expect(judgeStaleWorld()).toEqual({ stale: false, why: 'not_world' });
  });
});

describe('staleResidentSwapWanted: promote the held base over a stale WORLD frame already drawn', () => {
  const wk = (vt, over = {}) => ({ ...grid(vt), __sourceModel: 'GFS', __componentLayer: 'waves', ...over });
  const swap = (resident, base, selected = ms(WED15)) => staleResidentSwapWanted(resident, base, selected);
  it('the resident is the hour-0 frame, the base is the selected hour: swap (the case a seed landing after the zoom-out leaves behind)', () => {
    expect(swap(wk(NOW0), wk(WED15))).toBe(true);
  });
  it('the base within a step and a half of the selected instant counts as the selected hour (the nearest-step snap)', () => {
    expect(swap(wk(NOW0), wk('2026-10-07T16:00:00Z'))).toBe(true);
    expect(swap(wk(NOW0), wk('2026-10-07T16:30:00Z'))).toBe(true);
    expect(swap(wk(NOW0), wk('2026-10-07T18:00:00Z'))).toBe(false);                    // the next step: not the selected hour
  });
  it('NEVER swaps a stale base over the right resident, nor one stale frame for another', () => {
    expect(swap(wk(WED15), wk(NOW0))).toBe(false);                                     // the resident is right: nothing to fix (the older base must not replace it)
    expect(swap(wk(NOW0), wk('2026-10-03T12:00:00Z'))).toBe(false);                    // neither is the selected hour
    expect(swap(wk(WED15), wk(WED15))).toBe(false);
  });
  it('needs the same model, layer and rating flavor (a deliberate switch is never undone by a swap)', () => {
    expect(swap(wk(NOW0), wk(WED15, { __sourceModel: 'ICON' }))).toBe(false);
    expect(swap(wk(NOW0), wk(WED15, { __componentLayer: 'swell_1' }))).toBe(false);
    expect(swap(wk(NOW0, { ratingMode: true }), wk(WED15))).toBe(false);
    expect(swap(wk(NOW0, { ratingMode: true }), wk(WED15, { ratingMode: true }))).toBe(true);
  });
  it('fails open: an unknown time or instant, a regional resident or base, no base', () => {
    expect(swap(wk(NOW0), wk(undefined))).toBe(false);
    expect(swap(wk(undefined), wk(WED15))).toBe(false);
    expect(swap(wk(NOW0), wk(WED15), NaN)).toBe(false);
    expect(swap(wk(NOW0, { bounds: TILE }), wk(WED15))).toBe(false);
    expect(swap(wk(NOW0), wk(WED15, { bounds: TILE }))).toBe(false);
    expect(swap(wk(NOW0), null)).toBe(false);
    expect(swap(null, wk(WED15))).toBe(false);
  });
  it('honours its own kill switch (the dim kill does not stop it)', () => {
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    expect(swap(wk(NOW0), wk(WED15))).toBe(true);
    window.__RAW_DISABLE_STALE_RESIDENT_SWAP__ = true;
    expect(swap(wk(NOW0), wk(WED15))).toBe(false);
  });
});

describe('createStaleHourTracker', () => {
  it('counts how long the selected hour has held still, and restarts when it moves', () => {
    const t = createStaleHourTracker();
    expect(t.heldMs(147, 1000)).toBe(0);
    expect(t.heldMs(147, 1700)).toBe(700);
    expect(t.heldMs(148, 1800)).toBe(0);
    expect(t.heldMs(148, 2500)).toBe(700);
  });
});
