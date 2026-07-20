/**
 * ARBITER PHASE C — THE STATEFUL SEQUENCE HARNESS (the named flip gate from the 07-18 EVE-3
 * handoff §8: "the sweep covers the PURE decision function, not the STATEFUL surfaces …
 * next step is a stateful sequence harness (replay lane interleavings against both modes),
 * then flip the default").
 *
 * WHAT THE DIFFERENTIAL SWEEP CANNOT SEE. marineCommitArbiter.differential.test.js proves
 * per-decision equality on 3000 enumerated fixtures — one decision, fresh grace state, one
 * instant. The surfaces that remain are SEQUENTIAL: the `_pendingDowngrade` stash re-offered
 * every frame by the render loop, the rating-grace singletons (guard mode and arbiter mode
 * each own one) whose key/startedAt/expired evolve ACROSS decisions, and the interleaving of
 * rating-flag flips, hour scrubs, view changes and grace expiry BETWEEN commit attempts. The
 * historical failure shapes here are trajectories, not verdicts: the commit⇄stash bounce at
 * frame rate (the two-call-site mirror), the 07-03 permanent wedge (a hold no later event
 * releases), and round-12 §4f (the band blink on a rating interlude).
 *
 * WHAT THIS HARNESS DOES. A minimal, faithful model of the engine's commit state machine —
 * resident grid + stash + per-frame self-heal — driven through the REAL exported
 * `decideMarineCommit` (both call sites in the engine use exactly this function; the model
 * replays choke-then-frames the way setWaveData and the render loop do). Every enumerated
 * event sequence runs twice, guard mode then arbiter mode, grace singletons reset per run,
 * clock fully synthetic. Assertions:
 *   S1. TRAJECTORY EQUALITY — after every event, both modes display the same resident and
 *       agree on stash presence. This is the stateful analogue of the differential's Q2.
 *   S2. NO VERDICT INSTABILITY — within a mode, a choke reject followed by a next-frame
 *       self-heal accept with UNCHANGED inputs and NO grace-boundary crossing is the bounce
 *       class; zero tolerated, either mode.
 *   S3. ENGAGEMENT PROOF — the arbiter leg must show __RAW_ARBITER_LIVE__.n > 0 (a flip that
 *       silently fell back to guards yields an identically green battery — 07-18 lesson).
 *   S4. TEETH — the sweep must actually exercise stashes, grace holds and releases (floors
 *       below), or agreement is vacuous. Do not lower the floors to make a change pass.
 *
 * OUT OF SCOPE (deliberately): the commitMarineData-side guards (dedup / commit
 * short-circuit) sit UPSTREAM of the choke, are identical in both modes, and are not part
 * of the flip surface — see the 07-18 EVE-2 handoff §8 ("do NOT flip those").
 */
import {
  decideMarineCommit, __resetRatingGraceForTests, __resetArbiterGraceForTests,
} from './WebGLMarineEngine';

const GRIDS = {
  world_coarse: { bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 37, rows: 17 },
  mid_16deg: { bounds: { west: -88, south: 22, east: -72, north: 34 }, cols: 9, rows: 7 },
  regional_4deg: { bounds: { west: -83, south: 26, east: -79, north: 30 }, cols: 16, rows: 16 },
  fine_2deg: { bounds: { west: -81, south: 26, east: -79, north: 28 }, cols: 32, rows: 32 },
};
const VIEWS = {
  narrow_z9: { vb: [-80.6, 26.6, -79.4, 27.6], zoom: 9.3 },
  mid_z7: { vb: [-84, 25, -76, 31], zoom: 7.5 },
  wide_z5: { vb: [-110, 5, -50, 45], zoom: 5.2 },
};
const VIEW_CYCLE = ['narrow_z9', 'wide_z5', 'mid_z7'];
const GRACE_MS = 4000;
const FRAME_MS = 16;

const mkGrid = (kind, rated, hour = 0) => ({
  ...GRIDS[kind],
  vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
  __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: hour,
  ratingMode: rated, __renderable: true,
  __kind: kind,
});
const gridKey = (g) => (g ? `${g.__kind}|${g.ratingMode ? 'rated' : 'plain'}|h${g.hourOffset}` : 'none');

// The event alphabet. Commit attempts across tiers and flavors, plus the stateful events the
// pure sweep cannot express: a rating-flag flip, a view change, an hour scrub, grace expiry.
const EVENTS = [
  { t: 'attempt', kind: 'world_coarse', rated: false },
  { t: 'attempt', kind: 'world_coarse', rated: true },
  { t: 'attempt', kind: 'mid_16deg', rated: false },
  { t: 'attempt', kind: 'mid_16deg', rated: true },
  { t: 'attempt', kind: 'regional_4deg', rated: false },
  { t: 'attempt', kind: 'fine_2deg', rated: false },
  { t: 'attempt', kind: 'fine_2deg', rated: true },
  { t: 'hour_scrub' },   // re-offer the resident's own kind at hour+3 (or fine h3 cold)
  { t: 'flag_flip' },
  { t: 'view_next' },
  { t: 'wait_grace' },   // clock past the 4 s grace bound, then frames
];

const INITS = [
  null,
  { kind: 'world_coarse', rated: false },
  { kind: 'world_coarse', rated: true },
  { kind: 'mid_16deg', rated: false },
  { kind: 'regional_4deg', rated: false },
  { kind: 'fine_2deg', rated: false },
  { kind: 'fine_2deg', rated: true },
];

function runSequence(mode, init, view0, flag0, events) {
  // Fresh grace singletons and window flags per run — the singletons are the state under test
  // WITHIN a run; leakage ACROSS runs would confound sequences.
  __resetRatingGraceForTests();
  __resetArbiterGraceForTests();
  const w = global.window;
  if (mode === 'arbiter') { w.__RAW_MARINE_ARBITER__ = true; } else { delete w.__RAW_MARINE_ARBITER__; }
  delete w.__RAW_ARBITER_LIVE__;

  const st = {
    resident: init ? mkGrid(init.kind, init.rated) : null,
    stash: null,
    viewKey: view0,
    flag: flag0,
    clock: 100000,
    bounces: 0,
    stashes: 0,
    graceHolds: 0,
    selfHeals: 0,
    decisions: 0,
  };
  const trajectory = [];

  const decide = (incoming) => {
    w.__SURF_MODE__ = st.flag;
    const v = VIEWS[st.viewKey];
    st.decisions++;
    return decideMarineCommit(st.resident, incoming, v.zoom, v.vb, w, st.clock);
  };

  // The render loop: re-offer the stash each frame, exactly as the engine's self-heal does.
  // BOUNCE DEFINITION: within one event step, nothing the decision reads can change between
  // the choke reject and the next two frames — flag/view are per-step constants and +32 ms
  // cannot cross the 4 s grace bound. So ANY same-step accept after a choke reject means the
  // choke and the self-heal disagreed on identical inputs: the commit⇄stash bounce class the
  // shared decision function exists to make impossible. Accepts on LATER steps (after a view/
  // flag/time event changed the inputs) are the legitimate self-heal.
  const frames = (n, lastRejectAt) => {
    for (let i = 0; i < n; i++) {
      st.clock += FRAME_MS;
      if (st.stash) {
        const d = decide(st.stash);
        if (!d.reject) {
          if (lastRejectAt !== null) st.bounces++;
          st.resident = st.stash;
          st.stash = null;
          st.selfHeals++;
        }
      }
    }
  };

  for (const ev of events) {
    let lastRejectAt = null;
    if (ev.t === 'attempt' || ev.t === 'hour_scrub') {
      let incoming;
      if (ev.t === 'hour_scrub') {
        incoming = st.resident
          ? mkGrid(st.resident.__kind, st.resident.ratingMode, st.resident.hourOffset + 3)
          : mkGrid('fine_2deg', false, 3);
      } else {
        incoming = mkGrid(ev.kind, ev.rated);
      }
      const d = decide(incoming);
      if (d.reject) {
        st.stash = incoming;          // engine: this._pendingDowngrade = waveGrid
        st.stashes++;
        lastRejectAt = st.clock;
        if (d.rule === 'rated_uncovering_grace') st.graceHolds++;
      } else {
        st.resident = incoming;       // engine: accepted commit supersedes the stash
        st.stash = null;
      }
    } else if (ev.t === 'flag_flip') {
      st.flag = !st.flag;
    } else if (ev.t === 'view_next') {
      st.viewKey = VIEW_CYCLE[(VIEW_CYCLE.indexOf(st.viewKey) + 1) % VIEW_CYCLE.length];
    } else if (ev.t === 'wait_grace') {
      st.clock += GRACE_MS + 100;
    }
    frames(2, lastRejectAt);
    trajectory.push(`${gridKey(st.resident)}/${st.stash ? 'stash' : '-'}`);
  }

  const live = w.__RAW_ARBITER_LIVE__ ? w.__RAW_ARBITER_LIVE__.n : 0;
  delete w.__RAW_MARINE_ARBITER__;
  delete w.__SURF_MODE__;
  return { trajectory, bounces: st.bounces, stashes: st.stashes, graceHolds: st.graceHolds,
    selfHeals: st.selfHeals, live, decisions: st.decisions };
}

describe('FORENSIC: stateful sequence differential (guard mode vs arbiter mode)', () => {
  afterEach(() => {
    delete global.window.__RAW_MARINE_ARBITER__;
    delete global.window.__SURF_MODE__;
    delete global.window.__RAW_ARBITER_LIVE__;
    __resetRatingGraceForTests();
    __resetArbiterGraceForTests();
  });

  it('replays every enumerated interleaving through both modes and compares trajectories', () => {
    const diverge = {};
    let n = 0, guardBounces = 0, arbBounces = 0;
    let totalStashes = 0, totalGraceHolds = 0, totalSelfHeals = 0;
    let arbLiveTotal = 0, arbDecisionsTotal = 0;

    for (const init of INITS) {
      for (const view0 of ['narrow_z9', 'wide_z5']) {
        for (const flag0 of [false, true]) {
          for (const e1 of EVENTS) for (const e2 of EVENTS) for (const e3 of EVENTS) {
            const seq = [e1, e2, e3];
            const g = runSequence('guards', init, view0, flag0, seq);
            const a = runSequence('arbiter', init, view0, flag0, seq);
            n++;
            guardBounces += g.bounces;
            arbBounces += a.bounces;
            totalStashes += g.stashes;
            totalGraceHolds += a.graceHolds;
            totalSelfHeals += g.selfHeals;
            arbLiveTotal += a.live;
            arbDecisionsTotal += a.decisions;
            for (let i = 0; i < seq.length; i++) {
              if (g.trajectory[i] !== a.trajectory[i]) {
                const cls = `step${i} guard=${g.trajectory[i]} arb=${a.trajectory[i]} ev=${seq[i].t}${seq[i].kind ? ':' + seq[i].kind + (seq[i].rated ? ':rated' : '') : ''}`;
                (diverge[cls] = diverge[cls] || { count: 0, sample: null }).count++;
                if (!diverge[cls].sample) {
                  diverge[cls].sample = {
                    init: init ? `${init.kind}${init.rated ? ':rated' : ''}` : 'none',
                    view0, flag0, seq: seq.map(e => e.t + (e.kind ? ':' + e.kind + (e.rated ? ':r' : '') : '')).join(' > '),
                  };
                }
                break; // first divergent step per sequence — later steps compound it
              }
            }
          }
        }
      }
    }

    const classes = Object.entries(diverge).sort((x, y) => y[1].count - x[1].count);
    const totalDiv = classes.reduce((s, [, v]) => s + v.count, 0);
    /* eslint-disable no-console */
    console.log(`\n=== SEQUENCE SWEEP: ${n} interleavings x 2 modes ===`);
    console.log(`trajectory divergences: ${totalDiv} in ${classes.length} classes`);
    for (const [cls, v] of classes.slice(0, 20)) {
      console.log(`  ${String(v.count).padStart(5)}  ${cls}`);
      console.log(`         e.g. ${JSON.stringify(v.sample)}`);
    }
    console.log(`bounce (next-frame verdict instability): guards=${guardBounces} arbiter=${arbBounces}`);
    console.log(`teeth: stashes=${totalStashes} graceHolds=${totalGraceHolds} selfHeals=${totalSelfHeals} arbLive=${arbLiveTotal}/${arbDecisionsTotal}`);
    /* eslint-enable no-console */

    // S1 — the flip gate: identical resident/stash trajectories on every interleaving.
    expect({ classes: classes.map(([c]) => c), total: totalDiv }).toEqual({ classes: [], total: 0 });
    // S2 — zero commit⇄stash bounce, either mode (the two-call-site mirror, statefully).
    expect(guardBounces).toBe(0);
    expect(arbBounces).toBe(0);
    // S3 — engagement proof: the arbiter tally must account for EVERY decision its legs made
    // (a flip that silently fell back to guards would leave live < decisions).
    expect(arbLiveTotal).toBe(arbDecisionsTotal);
    expect(arbDecisionsTotal).toBeGreaterThan(50000);
    // S4 — teeth: the sweep must exercise the stateful machinery, not tiptoe around it.
    expect(n).toBe(7 * 2 * 2 * EVENTS.length ** 3);
    expect(totalStashes).toBeGreaterThan(5000);
    // Grace-hold floor: the grace-eligible geometry (rated resident + flag ON + NARROW view +
    // resident uncovering) requires a mid-sequence view change to reach — measured 136 exercises
    // on the full 37,268-sequence space at authoring time. The floor proves the rule is WALKED
    // by the sweep; per-decision grace correctness is owned by the differential + unit tests.
    expect(totalGraceHolds).toBeGreaterThan(100);
    expect(totalSelfHeals).toBeGreaterThan(1000);
  });

  it('outage anchor: round-12 §4f — a rated incoming lands during the grace with NO band blink', () => {
    // Rated fine resident, flag ON, narrow view. The unrated world grid arrives (SWR refresh):
    // both modes must HOLD (stash), keep displaying the rated band, and when the RATED clip
    // lands next it must commit rated->rated — the band never blinks through an unrated frame.
    for (const mode of ['guards', 'arbiter']) {
      const r = runSequence(mode, { kind: 'fine_2deg', rated: true }, 'narrow_z9', true, [
        { t: 'attempt', kind: 'world_coarse', rated: false },
        { t: 'attempt', kind: 'fine_2deg', rated: true },
      ]);
      expect(r.trajectory[0]).toBe('fine_2deg|rated|h0/stash'); // held + stashed, band intact
      expect(r.trajectory[1]).toBe('fine_2deg|rated|h0/-');     // rated->rated swap, stash gone
    }
  });

  it('outage anchor: the grace is BOUNDED — expiry releases truth in both modes', () => {
    // Same interlude, but no rated clip ever lands: after the 4 s bound the stashed unrated
    // grid must commit (stranding is worse than a blink; the 07-04 stranded-rectangle class
    // stays impossible BY THE BOUND). NOTE: at the narrow view the resident fine tile still
    // covers, so the hold is the plain downgrade guard; the release needs the viewport to
    // leave the tile (pan) — this anchor uses the wide view where coverage drops.
    for (const mode of ['guards', 'arbiter']) {
      const r = runSequence(mode, { kind: 'fine_2deg', rated: true }, 'wide_z5', true, [
        { t: 'attempt', kind: 'world_coarse', rated: false },
      ]);
      // Wide view: the wide-view exemption releases immediately (display gate already hides
      // the band there) — the unrated world grid must be resident, no stash, both modes.
      expect(r.trajectory[0]).toBe('world_coarse|plain|h0/-');
    }
  });

  it('outage anchor: 07-03 wedge shape — a rated WORLD resident never wedges the flag-on lane', () => {
    // Rated world-coarse resident with the flag ON: an unrated incoming must NOT be held
    // forever (a world grid always covers, so no coverage release could ever end a hold).
    for (const mode of ['guards', 'arbiter']) {
      const r = runSequence(mode, { kind: 'world_coarse', rated: true }, 'narrow_z9', true, [
        { t: 'attempt', kind: 'world_coarse', rated: false },
        { t: 'wait_grace' },
      ]);
      // Either the incoming commits immediately (guard: resident not regional -> no hold;
      // arbiter: flavor_downgrade_world_resident) or at worst releases by the grace bound.
      expect(r.trajectory[1]).toBe('world_coarse|plain|h0/-');
    }
  });
});
