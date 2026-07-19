/**
 * THE ARBITER PHASE C GATE — exhaustive guard-vs-arbiter differential over the FULL cartesian
 * decision space (2026-07-18 EVE-3).
 *
 * WHY THIS EXISTS. Phase B measured agreement by running the arbiter in SHADOW on live traffic
 * and reached 89/89. That number was a FIXTURE COVERAGE artifact, not equivalence: a live
 * trajectory only ever walks the common path through a guard's ~6 conjunctive predicates, so the
 * branches stay unmeasured. This sweep enumerates them instead — and on first run it found 166
 * divergences in 19 classes (94.5%), reducing to four root mechanisms, three of which mapped onto
 * known historical bugs the guards were built to prevent (07-01 spin, 07-03 permanent wedge).
 * ALL FOUR ARE FIXED; the sweep is now the standing gate.
 *
 * Two assertions, both hard:
 *   Q1. decideMarineCommit in GUARD mode is identical to calling the raw guard chain. This is what
 *       makes the shipped default provably a no-op. Never relax it.
 *   Q2. The arbiter rule list reproduces the guard chain on every enumerated fixture. If you edit
 *       a rule and this drops, the console report names the exact class — decide deliberately
 *       whether the guard nuance is a load-bearing scar (match it) or genuinely obsolete (then
 *       document the intended divergence here rather than loosening the threshold).
 */
import { arbiterDecide } from './marineCommitArbiter';
import {
  shouldRejectResolutionDowngrade, shouldRejectSubcoveringRegional, decideMarineCommit,
  __resetRatingGraceForTests, __resetArbiterGraceForTests,
} from './WebGLMarineEngine';

const GRIDS = {
  // name: [westSpanDeg, cols]  -> cellDeg = span/cols
  world_coarse: { bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 37, rows: 17 },
  mid_16deg: { bounds: { west: -88, south: 22, east: -72, north: 34 }, cols: 9, rows: 7 },
  regional_4deg: { bounds: { west: -83, south: 26, east: -79, north: 30 }, cols: 16, rows: 16 },
  fine_2deg: { bounds: { west: -81, south: 26, east: -79, north: 28 }, cols: 32, rows: 32 },
  offscreen_fine: { bounds: { west: 140, south: 26, east: 142, north: 28 }, cols: 32, rows: 32 },
};
const mk = (key, over = {}) => ({
  ...GRIDS[key],
  vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
  __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 0,
  ratingMode: false, __renderable: true,
  ...over,
});
const VPS = {
  narrow_z9: [-80.6, 26.6, -79.4, 27.6],   // ~1.2 x 1.0 deg
  mid_z7: [-84, 25, -76, 31],              // 8 x 6 deg
  wide_z5: [-110, 5, -50, 45],             // 60 x 40 deg
};
const ZOOMS = [9.3, 7.5, 6.4, 5.2, 3.1];

describe('FORENSIC: exhaustive guard-vs-arbiter differential', () => {
  it('sweeps the decision space and reports every divergence class', () => {
    const keys = Object.keys(GRIDS);
    const rows = [];
    for (const rk of keys) for (const ik of keys)
      for (const vk of Object.keys(VPS)) for (const z of ZOOMS)
        for (const rRated of [false, true]) for (const iRated of [false, true])
          for (const flag of [false, true]) {
            const resident = mk(rk, { ratingMode: rRated });
            const incoming = mk(ik, { ratingMode: iRated });
            const vb = VPS[vk];
            rows.push({ rk, ik, vk, z, rRated, iRated, flag, resident, incoming, vb });
          }

    let guardModeMismatch = 0;
    const diverge = {};
    let n = 0, bothReject = 0, bothCommit = 0;

    for (const r of rows) {
      // --- Q1: guard mode must equal the raw guard chain, exactly.
      __resetRatingGraceForTests();
      global.window.__SURF_MODE__ = r.flag;
      const rawReject = shouldRejectResolutionDowngrade(r.resident, r.incoming, r.z, r.vb, false, 1000)
        || shouldRejectSubcoveringRegional(r.resident, r.incoming, r.z, r.vb, false, global.window);
      __resetRatingGraceForTests();
      const viaFn = decideMarineCommit(r.resident, r.incoming, r.z, r.vb, global.window, 1000).reject;
      if (rawReject !== viaFn) guardModeMismatch++;

      // --- Q2: arbiter verdict on the same inputs.
      __resetArbiterGraceForTests();
      global.window.__RAW_MARINE_ARBITER__ = true;
      const arb = decideMarineCommit(r.resident, r.incoming, r.z, r.vb, global.window, 1000);
      delete global.window.__RAW_MARINE_ARBITER__;

      n++;
      if (rawReject && arb.reject) bothReject++;
      if (!rawReject && !arb.reject) bothCommit++;
      if (rawReject !== arb.reject) {
        const cls = `${arb.reject ? 'ARB_REJECTS_guard_commits' : 'ARB_COMMITS_guard_rejects'} | rule=${arb.rule} | res=${r.rk} inc=${r.ik}`;
        (diverge[cls] = diverge[cls] || { count: 0, samples: [] }).count++;
        if (diverge[cls].samples.length < 2) {
          diverge[cls].samples.push({ vp: r.vk, z: r.z, rRated: r.rRated, iRated: r.iRated, flag: r.flag });
        }
      }
    }
    delete global.window.__SURF_MODE__;

    const classes = Object.entries(diverge).sort((a, b) => b[1].count - a[1].count);
    const totalDiv = classes.reduce((s, [, v]) => s + v.count, 0);
    /* eslint-disable no-console */
    console.log(`\n=== SWEEP: ${n} fixtures ===`);
    console.log(`Q1 guard-mode vs raw guard chain mismatches: ${guardModeMismatch}`);
    console.log(`Q2 agreement: ${n - totalDiv}/${n} (${((1 - totalDiv / n) * 100).toFixed(1)}%)  [bothReject=${bothReject} bothCommit=${bothCommit}]`);
    console.log(`Q2 divergence classes: ${classes.length}, total ${totalDiv}`);
    for (const [cls, v] of classes) {
      console.log(`  ${String(v.count).padStart(4)}  ${cls}`);
      console.log(`        e.g. ${JSON.stringify(v.samples[0])}`);
    }
    /* eslint-enable no-console */

    // Q1 — non-negotiable: the shipped default must be a provable no-op.
    expect(guardModeMismatch).toBe(0);
    // Q2 — the flip gate. See the header before ever changing this expectation.
    expect({ classes: classes.map(([c]) => c), total: totalDiv }).toEqual({ classes: [], total: 0 });
    expect(n).toBe(3000);                // the sweep must not silently shrink
    expect(bothReject).toBeGreaterThan(300);   // …nor collapse into all-commit (a vacuous pass)
  });
});
