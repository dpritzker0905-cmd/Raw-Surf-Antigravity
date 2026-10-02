/**
 * F-22: THE GATE/BRIDGE INVARIANT AS A TRAJECTORY PROPERTY, in guard mode and arbiter mode, with the REAL bridge in the loop.
 *
 * marineCommitArbiter.sequence.test.js replays commit interleavings through decideMarineCommit with a 10 deg world grid, so it never
 * reaches the base-aware bridge (it needs a 2 deg world frame held as the base) nor the bridge itself (it models only the commit
 * choke and the self-heal frame). The base-aware bridge adds a NEW state transition, resident clip -> held world base, in a band
 * where it never fired, so the historical failure shapes are the ones to look for again: the commit <-> stash bounce at frame rate,
 * a hold nothing releases (the 07-03 wedge), and the thing this fix exists for, a clip the gate hides with nothing replacing it.
 *
 * THE MODEL (the engine's per-frame order, renderHeatmapAndParticles): re-offer the stash through decideMarineCommit (the self-heal),
 * then, with no stash pending, ask shouldBridgeToCoarseGlobal (with the selected instant, as the layer publishes it) and commit the
 * held base through the same choke (a rejected bridge commit becomes the stash, as setWaveData does). A committed coarse-global grid
 * is captured as the held base (BLEND BOTH). Events change the view, offer clips of a given coverage of the CURRENT view (plain or
 * rated) and offer world frames (2 deg for the selected hour, 2 deg for another hour). Every sequence runs twice, guard mode then
 * arbiter mode (the surf flag toggles the flavor rules), on a synthetic clock.
 *
 *   T1. TRAJECTORY EQUALITY: both modes display the same resident and agree on the stash after every event.
 *   T2. THE INVARIANT: after the settling frames, no reachable state is "a regional clip the gate hides, with a fine base held FOR THE
 *       SELECTED HOUR" (where the engine's coverage arithmetic can be trusted: coverageWrapSafe; the fiji_z6 view has WRAPPED clips and keeps
 *       the old rule). It has a POSITIVE CONTROL: with __RAW_DISABLE_BASE_AWARE_BRIDGE__ on, thousands of interleavings reach that state.
 *       A coarse base is exempt, by design (the 40 deg ceiling).
 *   T3. NO BOUNCE: (a) across the frames of a step the display never goes A -> B -> A; (b) an event's own commit is never handed straight
 *       back by the bridge, EXCEPT a RATED clip offered over an unrated resident (a deliberate flavor switch the mirror never holds; the
 *       same hand-back exists past the 40 deg ceiling since 07-16, and it is one flip, not a loop): any other hand-back is the mirror and
 *       the bridge disagreeing, which is the ping-pong the mirror exists to stop.
 *   T4. NO WRONG HOUR: the bridge never promotes a base that is not for the selected hour inside the band.
 *   T5. NO WEDGE: after any sequence, a non-wide view and 5 s release every stashed REGIONAL grid of the resident's flavor.
 *   T6. TEETH: the bridge must actually fire, in the band and past it, and the stash must be exercised, or the rest is vacuous
 *       (floors are about 80% of what the sweep measures: it is deterministic).
 *
 * NOT MODELLED, ON PURPOSE (found by this sweep and its reviewers, 2026-10-02; none is changed by the F-22 fix, each is arbiter-mode-only
 * or older): (1) a 10 deg world frame OFFERED over a 2 deg world resident: the arbiter's rule 7 (tier_downgrade) rejects it, the guard chain
 * commits it; (2) clips of a realistic 1.9 deg cell: with the 2 deg world offered over a covering clip, the guards stash and the arbiter
 * commits (6 classes). Both appear with __RAW_DISABLE_BASE_AWARE_BRIDGE__ on too. A coarse base is still covered: the world_coarse INIT holds
 * one as resident and base.
 */
import { decideMarineCommit, shouldBridgeToCoarseGlobal, __resetArbiterGraceForTests } from './marineCommitGate';
import { isCoarseGlobalGrid } from './marineEngineDecisions';
import { coverageWrapSafe, isFineWorldBase } from './marineCommitArbiter';
import { isWorldGridForSelectedHour } from './marineStaleHour';
import { gateHides } from './marineBridgeGateOracle.testutil';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const NOW = '2026-10-01T12:00:00Z';
const SELECTED_MS = Date.parse(NOW);                  // the layer's selected instant (engine.__selectedMs)
const base = (over = {}) => ({
  vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
  __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 0, ratingMode: false, __renderable: true,
  valid_time: NOW, ...over,
});
const worldFine = () => base({ bounds: WORLD, cols: 181, rows: 82, __kind: 'world_fine' });
const worldFineStale = () => base({ bounds: WORLD, cols: 181, rows: 82, __kind: 'world_fine_stale', valid_time: '2026-10-01T18:00:00Z' });   // another step: 6 h off
const worldCoarse = () => base({ bounds: WORLD, cols: 37, rows: 17, __kind: 'world_coarse' });

const viewport = (w, h) => [-80 - w / 2, 28 - h / 2, -80 + w / 2, 28 + h / 2];
const VIEWS = {
  coast_z9: { vb: viewport(1.2, 1.0), zoom: 9.3 },    // narrow, not wide: a covering clip is shown
  band_z7: { vb: viewport(8, 6), zoom: 7.0 },          // wide by zoom
  band_z6: { vb: viewport(20, 12), zoom: 6.2 },        // wide by both
  band_z5: { vb: viewport(39, 24), zoom: 5.4 },        // the widest view still inside the 40 deg ceiling
  span_z8: { vb: viewport(20, 12), zoom: 8.4 },        // wide by SPAN only (z > 7, an axis over 15 deg)
  world_z3: { vb: [-175, -35, 25, 50], zoom: 3.0 },    // past the ceiling
  fiji_z6: { vb: [172, -25, 192, -13], zoom: 6.2 },     // across the antimeridian: MapLibre reports east 192, the backend returns clips WRAPPED (east < west)
};
const VIEW_KEYS = Object.keys(VIEWS);

// A regional clip that covers fraction `c` of the view `vb` (it shares the view's SW corner, so the overlap is exactly c x area).
const clipFor = (vb, c, rated, seq) => {
  const s = Math.sqrt(c);
  const east = vb[0] + (vb[2] - vb[0]) * s, north = vb[1] + (vb[3] - vb[1]) * s;
  return base({
    bounds: { west: vb[0], south: vb[1], east: east > 180 ? east - 360 : east, north },   // the backend wraps an east past +180 (marineBboxGeometry)
    cols: Math.max(3, Math.round((east - vb[0]) / 0.25)), rows: Math.max(3, Math.round((north - vb[1]) / 0.25)),
    ratingMode: rated, __kind: `clip${Math.round(c * 100)}${rated ? 'r' : ''}#${seq}`,
  });
};

const EVENTS = [
  ...VIEW_KEYS.map((v) => ({ t: 'view', v })),
  { t: 'clip', c: 0.3 }, { t: 'clip', c: 0.8 }, { t: 'clip', c: 1.0 },
  { t: 'clip', c: 0.3, rated: true }, { t: 'clip', c: 1.0, rated: true },
  { t: 'world', kind: 'fine' }, { t: 'world', kind: 'fine_stale' },
];
const INITS = [null, 'world_fine', 'world_coarse', 'clip_cover', 'clip_cover_stale'];
const VIEW0S = ['coast_z9', 'band_z6', 'world_z3'];
const label = (e) => (e.t === 'view' ? `view:${e.v}` : e.t === 'clip' ? `clip:${e.c}${e.rated ? 'r' : ''}` : `world:${e.kind}`);

function run(mode, init, view0, flag, events, KILL) {
  __resetArbiterGraceForTests();
  const w = { __SURF_MODE__: flag };
  if (KILL) w.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true;
  global.window.__SURF_MODE__ = flag;   // the guard chain reads the GLOBAL flag (shouldRejectResolutionDowngrade has no win argument), the arbiter reads w
  if (mode === 'arbiter') w.__RAW_MARINE_ARBITER__ = true;
  let seq = 0;
  const st = {
    resident: null, stash: null, base: null, view: view0, clock: 100000,
    bridges: 0, bridgesInBand: 0, staleBridgesInBand: 0, stashes: 0, hiddenWithFineBase: 0, bounces: 0, handBacks: 0, wrapHeld: 0, wedged: 0,
  };
  const capture = (g) => { if (isCoarseGlobalGrid(g)) st.base = g; };       // BLEND BOTH: a committed coarse-global grid becomes the held base
  const decide = (incoming) => decideMarineCommit(st.resident, incoming, VIEWS[st.view].zoom, VIEWS[st.view].vb, w, st.clock);
  const offer = (incoming) => {
    const d = decide(incoming);
    if (d.reject) { st.stash = incoming; st.stashes++; } else { st.resident = incoming; st.stash = null; capture(incoming); }
  };

  if (init === 'world_fine') { st.resident = worldFine(); capture(st.resident); }
  else if (init === 'world_coarse') { st.resident = worldCoarse(); capture(st.resident); }
  else if (init === 'clip_cover') { st.resident = clipFor(VIEWS[view0].vb, 1.0, false, seq++); st.base = worldFine(); }
  else if (init === 'clip_cover_stale') { st.resident = clipFor(VIEWS[view0].vb, 1.0, false, seq++); st.base = worldFineStale(); }

  const frame = () => {
    st.clock += 16;
    if (st.stash) {
      const d = decide(st.stash);
      if (!d.reject) { st.resident = st.stash; st.stash = null; capture(st.resident); }
    }
    if (!st.stash && st.base) {
      const v = VIEWS[st.view];
      if (shouldBridgeToCoarseGlobal(st.resident, st.base, v.zoom, v.vb, w, undefined, SELECTED_MS)) {
        const d = decide(st.base);
        if (d.reject) { st.stash = st.base; st.stashes++; } else {
          const inBand = Math.max(v.vb[2] - v.vb[0], v.vb[3] - v.vb[1]) <= 40;
          st.resident = st.base; st.bridges++;
          if (inBand) { st.bridgesInBand++; if (!isWorldGridForSelectedHour(st.base, SELECTED_MS)) st.staleBridgesInBand++; }
        }
      }
    }
  };

  const trajectory = [];
  for (const ev of events) {
    const before = st.resident;
    const shown = [before];                                                          // what is displayed, in order, inside this one step
    if (ev.t === 'view') st.view = ev.v;
    else if (ev.t === 'clip') offer(clipFor(VIEWS[st.view].vb, ev.c, !!ev.rated, seq++));
    else offer(ev.kind === 'fine' ? worldFine() : worldFineStale());
    shown.push(st.resident);
    for (let i = 0; i < 3; i++) { frame(); shown.push(st.resident); }
    // BOUNCE (a): across the FRAMES of one step the display goes A -> B -> A with nothing the decisions read changing.
    for (let i = 3; i < shown.length; i++) if (shown[i] === shown[i - 2] && shown[i] !== shown[i - 1]) st.bounces++;
    // BOUNCE (b): the event's own commit handed straight back by the bridge (shown: before, the commit, the bridge's frame). Allowed only for a
    // rated clip over an unrated resident (a deliberate flavor switch); anything else is the mirror and the bridge disagreeing.
    if (shown[1] !== shown[0] && shown[2] === shown[0] && shown[0]) {
      st.handBacks++;
      if (!(ev.t === 'clip' && ev.rated && !before.ratingMode)) st.bounces++;
    }
    const v = VIEWS[st.view];
    const fineBaseForHour = isFineWorldBase(st.base) && isWorldGridForSelectedHour(st.base, SELECTED_MS);
    if (isFineWorldBase(st.base) && st.resident && st.resident.bounds && st.resident.bounds.east < st.resident.bounds.west) st.wrapHeld++;   // a WRAPPED clip stayed resident beside a fine base (the old rule held)
    if (fineBaseForHour && coverageWrapSafe(v.vb, st.resident && st.resident.bounds) && gateHides(v.zoom, v.vb, st.resident)) st.hiddenWithFineBase++;   // with or without a stash pending: a stuck stash must not hide a wedge
    trajectory.push(`${st.resident ? st.resident.__kind : 'none'}/${st.stash ? 'stash' : '-'}`);
  }
  // T5: a non-wide view and 5 s must release every stashed REGIONAL grid of the resident's flavor (a different flavor is the rating band's own hold).
  st.view = 'coast_z9'; st.clock += 5000;
  for (let i = 0; i < 3; i++) frame();
  if (st.stash && !isCoarseGlobalGrid(st.stash) && !!st.stash.ratingMode === !!(st.resident && st.resident.ratingMode)) st.wedged++;
  delete global.window.__SURF_MODE__;
  return { trajectory, ...st };
}

function sweep(KILL, bothModes) {
  const diverge = {};
  const violations = [];
  const t = { n: 0, bounces: 0, handBacks: 0, bridges: 0, bridgesInBand: 0, staleBridgesInBand: 0, stashes: 0, wrapHeld: 0, wedged: 0, hiddenInterleavings: 0 };
  for (const init of INITS) for (const view0 of VIEW0S) for (const flag of [false, true]) {
    for (const e1 of EVENTS) for (const e2 of EVENTS) for (const e3 of EVENTS) {
      const evs = [e1, e2, e3];
      const g = run('guards', init, view0, flag, evs, KILL);
      const a = bothModes ? run('arbiter', init, view0, flag, evs, KILL) : null;
      t.n++;
      t.bounces += g.bounces + (a ? a.bounces : 0);
      t.handBacks += g.handBacks; t.bridges += g.bridges; t.bridgesInBand += g.bridgesInBand; t.staleBridgesInBand += g.staleBridgesInBand;
      t.stashes += g.stashes; t.wrapHeld += g.wrapHeld; t.wedged += g.wedged + (a ? a.wedged : 0);
      if (a) {
        for (let i = 0; i < evs.length; i++) {
          if (g.trajectory[i] !== a.trajectory[i]) {
            const cls = `step${i} guard=${g.trajectory[i].replace(/#\d+/, '')} arb=${a.trajectory[i].replace(/#\d+/, '')} ev=${label(evs[i])}`;
            (diverge[cls] = diverge[cls] || { count: 0, sample: `${init}|${view0}|${flag}|${evs.map(label).join(' > ')}` }).count++;
            break;
          }
        }
      }
      if (g.hiddenWithFineBase || (a && a.hiddenWithFineBase)) {
        t.hiddenInterleavings++;
        if (violations.length < 3) violations.push({ init, view0, flag, seq: evs.map(label).join(' > '), guards: g.hiddenWithFineBase, arbiter: a ? a.hiddenWithFineBase : null });
      }
    }
  }
  return { t, diverge, violations };
}

describe('F-22: gate/bridge invariant over every enumerated interleaving (bridge in the loop, both commit modes)', () => {
  it('both modes agree, nothing bounces or wedges, no wrong hour is promoted, and a clip the gate hides never survives with a fine base held', () => {
    const { t, diverge, violations } = sweep(false, true);
    const classes = Object.entries(diverge).sort((x, y) => y[1].count - x[1].count);
    console.log(`\n=== F-22 SEQUENCE SWEEP: ${t.n} interleavings x 2 modes: bridges=${t.bridges} (in band ${t.bridgesInBand}, for another hour ${t.staleBridgesInBand}) stashes=${t.stashes} wrappedHeld=${t.wrapHeld} handBacks=${t.handBacks} bounces=${t.bounces} wedged=${t.wedged} divergent classes=${classes.length} hidden-with-fine-base interleavings=${t.hiddenInterleavings}`);
    for (const [c, v] of classes.slice(0, 8)) console.log(`  ${String(v.count).padStart(5)}  ${c}\n         e.g. ${v.sample}`);
    expect({ classes: classes.map(([c]) => c), total: classes.reduce((s, [, v]) => s + v.count, 0) }).toEqual({ classes: [], total: 0 });   // T1
    expect({ count: t.hiddenInterleavings, first: violations.slice(0, 2) }).toEqual({ count: 0, first: [] });                                  // T2
    expect(t.bounces).toBe(0);                                                                                                                  // T3
    expect(t.staleBridgesInBand).toBe(0);                                                                                                       // T4
    expect(t.wedged).toBe(0);                                                                                                                   // T5
    expect(t.n).toBe(INITS.length * VIEW0S.length * 2 * EVENTS.length ** 3);                                                                    // T6: teeth
    expect(t.bridgesInBand).toBeGreaterThan(7500);
    expect(t.bridges - t.bridgesInBand).toBeGreaterThan(8000);
    expect(t.stashes).toBeGreaterThan(15000);
    expect(t.wrapHeld).toBeGreaterThan(3100);                                                                                               // the antimeridian guard is walked, not tiptoed around
    expect(t.handBacks).toBeGreaterThan(3000);                                                                                             // the flavor-switch hand-back is reached: the bounce classifier has something to classify
  });

  it('POSITIVE CONTROL: with __RAW_DISABLE_BASE_AWARE_BRIDGE__ on, thousands of interleavings reach "a clip the gate hides beside a fine base" and the bridge never fires in the band', () => {
    const { t } = sweep(true, false);
    console.log(`\n=== F-22 SWEEP, rule OFF: ${t.n} interleavings, hidden-with-fine-base interleavings=${t.hiddenInterleavings}, bridges in band=${t.bridgesInBand}`);
    expect(t.hiddenInterleavings).toBeGreaterThan(8000);
    expect(t.bridgesInBand).toBe(0);
  });
});
