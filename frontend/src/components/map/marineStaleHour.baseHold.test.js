/**
 * The held 2-degree base stays, and comes back, for the selected hour (2026-10-02; owner: "keep the 2 degree frame for the selected hour at
 * every zoom in that range"; the follow-up to the F-22 base-aware bridge; marineStaleHour.js, rules 5 and 6).
 *
 * THE F-22 BRIDGE promotes a held 2-degree world base over a clip the gate hides, but only when the held base IS that frame, for the selected
 * hour. Replayed offline on the F-22 build the base was often something else: in the 390-px phone replay, after 3.1 s of a trial the held
 * base turned into the thinned series frame (46 x 20, an 8-degree lattice, the backend's `decimated_stride`) and stayed that for the rest of
 * the trial and the whole next one, with 35 and 52 hidden frames where a 2-degree base for the selected hour had 0.
 *
 * TWO THINGS DID IT, and each is pinned here:
 *   5. The base is the last coarse-global grid the engine COMMITTED, so a thin world frame committed at a world view replaced the exact frame
 *      the engine already held for the same data (`heldBaseKeeps`: an exact base is not replaced by a coarser frame of the same data).
 *   6. Once a thin frame was the base, the exact frame could not come back through the seed path (the world warm's landing, the cached world
 *      grid): the gate that stages and consumes a seed asked "same model, layer and hour: nothing to replace" (`coarseBaseOutdatedBy`: a finer
 *      lattice of the same data now replaces a coarser one).
 * Both are judged on the DATA, never the label: the valid time (served first), within the snapped step the rest of the F-21/F-22 machinery uses,
 * the same model run when both name one, the same rating flavor. An unknown time fails open (the old behaviour: the frame replaces).
 */
import { coarseBaseOutdatedBy, coarseBaseStaleForSeed, heldBaseKeeps } from './marineStaleHour';
import { heldBaseKeeps as viaCommitGate } from './marineCommitGate';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -82, south: 26, east: -79, north: 29 };
const T15 = '2026-10-07T15:00:00Z';
const T16 = '2026-10-07T16:00:00Z';                                  // one hour later: inside the snapped step (1.5 h)
const T18 = '2026-10-07T18:00:00Z';                                  // the next 3-hourly step: another hour
const R1 = '2026-10-01T06:00:00Z';
const R2 = '2026-10-01T12:00:00Z';
const ID = { __sourceModel: 'GFS', __componentLayer: 'waves' };
// 360 / 181 = 1.99 deg: the 2-degree mid tier at world span. 360 / 46 = 7.83 deg: a backend-thinned series frame. 360 / 37 = 9.73 deg: the old coarse tier.
const exact = (vt, over = {}) => ({ ...ID, bounds: WORLD, cols: 181, rows: 82, valid_time: vt, ...over });
const thin = (vt, over = {}) => ({ ...ID, bounds: WORLD, cols: 46, rows: 20, __decimatedStride: 4, valid_time: vt, ...over });
const tenDeg = (vt, over = {}) => ({ ...ID, bounds: WORLD, cols: 37, rows: 17, valid_time: vt, ...over });
const cyc = (t, over = {}) => ({ model_run_time: t, model_run_time_status: 'known', ...over });                                     // a verified model cycle (verifiedCycleTime.js)
const entry = (g) => ({ __sourceModel: g.__sourceModel, __componentLayer: g.__componentLayer, waveGrid: g, u_waveTexture: {} });   // the engine's held-base shape
const slotKey = (g) => `${g.__sourceModel}|${g.__componentLayer}|${g.ratingMode ? 'r1' : 'r0'}`;                                   // coarseBaseLruKey
const lruOf = (...gs) => new Map(gs.map((g) => [slotKey(g), entry(g)]));

afterEach(() => {
  delete window.__RAW_DISABLE_BASE_HOLD__;
  delete window.__RAW_DISABLE_BASE_HOUR_SYNC__;
  delete window.__MARINE_BASE_HOLD__;
});

describe('rule 5, heldBaseKeeps: a coarser frame of the same data never replaces an exact base', () => {
  it.each([
    ['a thin frame of the same valid time (the phone replay: it replaced the exact base 3.1 s into the trial)', exact(T15), thin(T15), true],
    ['a thin frame one hour off (inside the snapped step: the bridge counts that base as the selected hour)', exact(T15), thin(T16), true],
    ['a thin frame exactly at the edge of the snapped step (1.5 h + 1 min)', exact(T15), thin('2026-10-07T16:31:00Z'), true],
    ['a thin frame a minute past the edge', exact(T15), thin('2026-10-07T16:32:00Z'), false],
    ['a stride-2 thinned frame (91 x 45, a 3.96-degree lattice)', exact(T15), thin(T15, { cols: 91, rows: 45, __decimatedStride: 2 }), true],
    ['a stride-3 thinned frame (61 x 30, a 5.9-degree lattice)', exact(T15), thin(T15, { cols: 61, rows: 30, __decimatedStride: 3 }), true],
    ['a frame at the fine limit itself (144 columns, 2.5 degrees) is not coarser: it replaces', exact(T15), exact(T15, { cols: 144, rows: 66 }), false],
    ['a frame just over the fine limit (143 columns, 2.52 degrees) is coarser', exact(T15), exact(T15, { cols: 143, rows: 66 }), true],
    ['a 10-degree frame of the same valid time', exact(T15), tenDeg(T15), true],
    ['a thin frame of the NEXT 3-hourly step (the selected hour moved: the right hour wins)', exact(T15), thin(T18), false],
    ['an exact frame of the same valid time (an equal lattice: the newer frame replaces)', exact(T15), exact(T15), false],
    ['an exact frame of another step', exact(T15), exact(T18), false],
    ['a thin frame over a thin base (nothing exact to protect)', thin(T15), thin(T15), false],
    ['a thin frame over a 10-degree base (the finer one replaces)', tenDeg(T15), thin(T15), false],
    ['a thin frame with no valid time (fails open: the old behaviour)', exact(T15), thin(undefined), false],
    ['an exact base with no valid time', exact(undefined), thin(T15), false],
    ['an unparseable valid time', exact('soon'), thin(T15), false],
    ['a thin frame that is not world-wide (never a base candidate: left alone)', exact(T15), thin(T15, { bounds: TILE }), false],
  ])('%s', (_label, base, incoming, want) => {
    expect(heldBaseKeeps(lruOf(base), null, incoming)).toBe(want);
  });

  it('judges the data by its SERVED valid time first (an exact frame the backend substituted from another hour protects nothing)', () => {
    expect(heldBaseKeeps(lruOf(exact(T15, { served_valid_time: T18 })), null, thin(T15))).toBe(false);
    expect(heldBaseKeeps(lruOf(exact(T15, { served_valid_time: T18 })), null, thin(T15, { served_valid_time: T18 }))).toBe(true);
  });

  it('only a base of the same model, layer and rating flavor protects (an ICON, swell or rated base never blocks a GFS wave frame)', () => {
    expect(heldBaseKeeps(lruOf(exact(T15, { __sourceModel: 'ICON' })), null, thin(T15))).toBe(false);
    expect(heldBaseKeeps(lruOf(exact(T15, { __componentLayer: 'swell_1' })), null, thin(T15))).toBe(false);
    expect(heldBaseKeeps(lruOf(exact(T15, { ratingMode: true })), null, thin(T15))).toBe(false);
    expect(heldBaseKeeps(lruOf(exact(T15, { ratingMode: true })), null, thin(T15, { ratingMode: true }))).toBe(true);
  });

  it('finds the protecting base in the slot of the INCOMING frame\'s identity, wherever the displayed pointer is', () => {
    const lru = lruOf(exact(T15), exact(T15, { __componentLayer: 'swell_1' }));
    const displayedIsAnotherLayer = lru.get('GFS|swell_1|r0');
    expect(heldBaseKeeps(lru, displayedIsAnotherLayer, thin(T15))).toBe(true);
    expect(heldBaseKeeps(lru, displayedIsAnotherLayer, thin(T15, { __componentLayer: 'wind_waves' }))).toBe(false);
  });

  it('with no LRU (the single-slot kill) the displayed base is the only candidate', () => {
    expect(heldBaseKeeps(null, entry(exact(T15)), thin(T15))).toBe(true);
    expect(heldBaseKeeps(undefined, entry(exact(T15, { __sourceModel: 'ICON' })), thin(T15))).toBe(false);
    expect(heldBaseKeeps(null, null, thin(T15))).toBe(false);
  });

  it('keeps against the same model run, yields to another run (it may be the fresher data), and lets the data time decide when a run is unnamed', () => {
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: R1 })), null, thin(T15, { run_time: R1 }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: R1 })), null, thin(T15, { run_time: R2 }))).toBe(false);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: R1 })), null, thin(T15))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15)), null, thin(T15, { run_time: R2 }))).toBe(true);
  });

  it('compares model runs as instants, not as strings (the /grid and series paths may spell one run differently)', () => {
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: R1 })), null, thin(T15, { run_time: '2026-10-01T06:00:00+00:00' }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: R1 })), null, thin(T15, { run_time: '2026-10-01T02:00:00-04:00' }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: 'run-A' })), null, thin(T15, { run_time: 'run-A' }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: 'run-A' })), null, thin(T15, { run_time: 'run-B' }))).toBe(false);
  });

  it('an unthinned series world frame (181 x 83) is an exact base too, and a real thinned frame (46 x 21) is coarser', () => {
    expect(heldBaseKeeps(lruOf(exact(T15, { rows: 83 })), null, thin(T15, { rows: 21 }))).toBe(true);
  });

  it('one run is one run in either spelling: /grid serves the ingest clock with microseconds, /grid_series truncates it to whole seconds', () => {
    const us = '2026-09-20T14:59:02.690207Z';
    const s = '2026-09-20T14:59:02Z';
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: us })), null, thin(T15, { run_time: s }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: s })), null, thin(T15, { run_time: us }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: us })), null, thin(T15, { run_time: '2026-09-20T14:59:02.690207+00:00' }))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: us })), null, thin(T15, { run_time: '2026-09-20T08:59:02Z' }))).toBe(false);   // six hours earlier: another run
    expect(heldBaseKeeps(lruOf(exact(T15, { run_time: us })), null, thin(T15, { run_time: '2026-09-20T14:59:03Z' }))).toBe(false);   // another second: another run
  });

  it('the verified cycle (model_run_time, status known) decides when BOTH name one; a cycle that is not verified, or named on one side only, names nothing', () => {
    const C1 = '2026-10-07T00:00:00Z';
    const C2 = '2026-10-07T06:00:00Z';
    expect(heldBaseKeeps(lruOf(exact(T15, cyc(C1))), null, thin(T15, cyc(C1)))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15, cyc(C1))), null, thin(T15, cyc(C2)))).toBe(false);
    expect(heldBaseKeeps(lruOf(exact(T15, cyc(C1))), null, thin(T15))).toBe(true);                                              // unnamed on one side: the data time decides
    expect(heldBaseKeeps(lruOf(exact(T15, cyc(C1))), null, thin(T15, cyc(C2, { model_run_time_status: 'missing' })))).toBe(true);   // an unverified cycle names nothing
    expect(heldBaseKeeps(lruOf(exact(T15, cyc(C1, { run_time: '2026-10-07T01:00:00Z' }))), null, thin(T15, cyc(C1, { run_time: '2026-10-07T01:05:00Z' })))).toBe(true);   // the cycle wins over the ingest clock
    expect(heldBaseKeeps(lruOf(exact(T15, cyc(C1, { run_time: '2026-10-07T01:00:00Z' }))), null, thin(T15, cyc(C2, { run_time: '2026-10-07T01:00:00Z' })))).toBe(false);
  });

  it('reads the held base from the engine\'s wrapper (.waveGrid) and from a raw grid alike', () => {
    expect(heldBaseKeeps(null, { waveGrid: exact(T15) }, thin(T15))).toBe(true);
    expect(heldBaseKeeps(null, exact(T15), thin(T15))).toBe(true);
  });

  it('counts each frame it keeps in window.__MARINE_BASE_HOLD__.kept, and is silent otherwise', () => {
    expect(heldBaseKeeps(lruOf(exact(T15)), null, exact(T15))).toBe(false);
    expect(window.__MARINE_BASE_HOLD__).toBeUndefined();
    expect(heldBaseKeeps(lruOf(exact(T15)), null, thin(T15))).toBe(true);
    expect(heldBaseKeeps(lruOf(exact(T15)), null, thin(T15))).toBe(true);
    expect(window.__MARINE_BASE_HOLD__.kept).toBe(2);
  });

  it('honours the kill switch: the old behaviour (every committed coarse-global grid replaces the base) comes back whole', () => {
    window.__RAW_DISABLE_BASE_HOLD__ = true;
    expect(heldBaseKeeps(lruOf(exact(T15)), null, thin(T15))).toBe(false);
    expect(window.__MARINE_BASE_HOLD__).toBeUndefined();
  });

  it('never throws on junk (the engine calls it inside a commit), and a map that throws while it is walked keeps nothing', () => {
    expect(() => heldBaseKeeps()).not.toThrow();
    expect(heldBaseKeeps({ values() { throw new Error('torn down'); } }, null, thin(T15))).toBe(false);
    expect(heldBaseKeeps()).toBe(false);
    expect(heldBaseKeeps({}, {}, {})).toBe(false);
    expect(heldBaseKeeps('lru', 3, thin(T15))).toBe(false);
    expect(heldBaseKeeps(new Map([['k', null]]), null, thin(T15))).toBe(false);
  });

  it('is the one rule the engine reads through the commit lane', () => {
    expect(viaCommitGate).toBe(heldBaseKeeps);
  });
});

describe('rule 6, coarseBaseOutdatedBy / coarseBaseStaleForSeed: a finer lattice of the same data replaces a coarser base', () => {
  it.each([
    ['a thin base, the exact frame of the same valid time arrives (the world warm\'s landing)', thin(T15), exact(T15), true],
    ['a thin base, the exact frame one hour off', thin(T15), exact(T16), true],
    ['a 10-degree base, the exact frame of the same valid time', tenDeg(T15), exact(T15), true],
    ['an exact base, a thin seed of the same valid time (the base is kept, as it always was)', exact(T15), thin(T15), false],
    ['an exact base, an exact seed (kept, as it always was)', exact(T15), exact(T15), false],
    ['a thin base, a thin seed', thin(T15), thin(T15), false],
    ['a thin base, a 10-degree seed (the finer base is kept)', thin(T15), tenDeg(T15), false],
    ['a thin base, an exact seed with no valid time (fails open)', thin(T15), exact(undefined), false],
    ['a thin base with no valid time, an exact seed', thin(undefined), exact(T15), false],
    ['a thin base of one model run, the exact seed of another (it may be the older data)', thin(T15, { run_time: R1 }), exact(T15, { run_time: R2 }), false],
    ['a thin base (whole-second run), the exact frame (microsecond run) of the same ingest', thin(T15, { run_time: '2026-09-20T14:59:02Z' }), exact(T15, { run_time: '2026-09-20T14:59:02.690207Z' }), true],
    ['a thin base of one ingest, the exact frame of one six hours earlier', thin(T15, { run_time: '2026-09-20T14:59:02Z' }), exact(T15, { run_time: '2026-09-20T08:59:02.1Z' }), false],
    ['a thin base of one verified cycle, the exact frame of the next', thin(T15, cyc('2026-10-07T00:00:00Z')), exact(T15, cyc('2026-10-07T06:00:00Z')), false],
    ['a thin base and an exact frame of the same verified cycle', thin(T15, cyc('2026-10-07T00:00:00Z')), exact(T15, cyc('2026-10-07T00:00:00Z')), true],
    ['a rated thin base, an unrated exact seed (the rating flavor is its own rule)', thin(T15, { ratingMode: true }), exact(T15), false],
    ['an unrated thin base, a rated exact seed', thin(T15), exact(T15, { ratingMode: true }), false],
  ])('%s', (_label, base, seed, want) => {
    expect(coarseBaseOutdatedBy(entry(base), seed)).toBe(want);
  });

  it('the seed gate the engine reads: a thin base is replaced by the exact seed of its own hour, an exact base keeps its place against a thin one', () => {
    expect(coarseBaseStaleForSeed(entry(thin(T15)), exact(T15))).toBe(true);
    expect(coarseBaseStaleForSeed(entry(exact(T15)), thin(T15))).toBe(false);
    expect(coarseBaseStaleForSeed(entry(exact(T15)), exact(T15))).toBe(false);
  });

  it('the hour rule is untouched: a seed for another step still replaces the base, thin or exact, whatever its lattice', () => {
    expect(coarseBaseStaleForSeed(entry(exact(T15)), thin(T18))).toBe(true);
    expect(coarseBaseStaleForSeed(entry(thin(T15)), thin(T18))).toBe(true);
    expect(coarseBaseOutdatedBy(entry(exact(T15)), exact(T18))).toBe(true);
  });

  it('honours its own kill switch (the hour sync keeps working), and the hour-sync kill leaves the finer-lattice rule working', () => {
    window.__RAW_DISABLE_BASE_HOLD__ = true;
    expect(coarseBaseOutdatedBy(entry(thin(T15)), exact(T15))).toBe(false);
    expect(coarseBaseOutdatedBy(entry(exact(T15)), exact(T18))).toBe(true);
    delete window.__RAW_DISABLE_BASE_HOLD__;
    window.__RAW_DISABLE_BASE_HOUR_SYNC__ = true;
    expect(coarseBaseOutdatedBy(entry(thin(T15)), exact(T15))).toBe(true);
    expect(coarseBaseOutdatedBy(entry(exact(T15)), exact(T18))).toBe(false);
  });
});
