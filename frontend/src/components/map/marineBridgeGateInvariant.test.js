/**
 * F-22 (audit 2026-10-01): THE GATE/BRIDGE INVARIANT, AS A TEST.
 *
 * WebGLMarineCustomLayer's zoom-out gate HIDES a regional resident (mult 0: the regional pass and the crest animation go dark,
 * only the retained base wash stays) whenever the view is "wide" (z <= MARINE_ZOOMED_OUT_MAX_ZOOM, or either axis > 15 deg) and
 * the resident covers < __RAW_DOWNGRADE_COVER_FRAC__ (0.6) of it. The layer's own comment states the design: "guard keeps >=0.6,
 * gate shows >=0.6, bridge promotes <0.6 - no coverage band is resident-but-hidden". The bridge is the engine's promotion of the
 * held world base (shouldBridgeToCoarseGlobal), its mirror is the sub-covering reject (shouldRejectSubcoveringRegional), and the
 * arbiter carries the mirror as `subcover_at_wide`.
 *
 * 06b3dbc2 (2026-07-22) narrowed the bridge and its mirror to span > 40 deg (the 2 deg mid tier SERVES to 40 deg) and left the
 * gate alone, so for ten weeks a clip hidden at z <= 7 with span <= 40 was replaced by nothing until a wider clip committed: the
 * Marine Nightly's MULT0_FRAME red of 2026-09-28..10-01 (4, 12, 9, 12 frames against a budget of 2). The comment was the only
 * thing that said the two rules agreed; nothing ran it (LESSONS L-F13).
 *
 * THE RULE THESE TESTS PIN. The 40 deg ceiling protected a 2 deg mid clip from being replaced by the 10 deg coarse base (a ~5 s
 * coarse flash, EURO, 07-22). It has no business protecting a clip from a base of the SAME 2 deg resolution (the backend serves
 * the 2 deg mid at world span since 2026-07-23). So the bridge is base-aware: a held base of FINE_BASE_MAX_CELL_DEG or finer uses
 * the gate's own wide test (gate hides <=> bridge fires); a coarser base keeps the 40 deg ceiling. A fine base is promoted only
 * when it is the SAME model and layer as the resident and for the SELECTED hour (its valid time within a snapped step of the
 * selected instant, marineStaleHour.isWorldGridForSelectedHour; an unknown time fails CLOSED, because a promotion is a new
 * action), otherwise this band behaves as it did before (hidden, wash only), so the fix adds no wrong-hour or wrong-model frame.
 * Near the antimeridian (a wrapped clip, a view past +-180) the engine's coverage math cannot be trusted and the band keeps the old
 * rule. A tuned ceiling (__RAW_MARINE_GLOBAL_SPAN__) is never narrowed: the fine-base rule is the gate's test OR the ceiling's.
 * Default on; kill: window.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true.
 *
 * The gate is transcribed ONCE in marineBridgeGateOracle.testutil.js (the coverage-aligned zoom-out reject for a regional resident) with
 * its OWN constants (the shared zoom threshold and DEFAULT_COVER_FRAC), so the implication is checked against the layer's rule, not
 * against the bridge's reading of it; marineBridgeGateInvariant.wiring.test.js checks that transcription against the REAL layer.
 */
import {
  shouldBridgeToCoarseGlobal, shouldRejectSubcoveringRegional, decideMarineCommit, __resetArbiterGraceForTests,
} from './marineCommitGate';
import { isGateWideView } from './marineZoomOutGate';
import { isFineWorldBase, FINE_BASE_MAX_CELL_DEG, coverageWrapSafe } from './marineCommitArbiter';
import { WORLD, viewport, clipFor as clip, gateHides, SPANS, ZOOMS, COVERS } from './marineBridgeGateOracle.testutil';

const NOW = '2026-10-01T12:00:00Z';
const NOW_MS = Date.parse(NOW);

const world = (cols, rows, over = {}) => ({
  bounds: WORLD, cols, rows, vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
  __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 0, ratingMode: false, valid_time: NOW, ...over,
});
const FINE = (over) => world(181, 82, over);      // the 2 deg world (global_mid at world span): cell ~1.99
const COARSE = (over) => world(37, 17, over);     // the 10 deg global_coarse: cell ~9.7

// A failing list prints as a count and its first two entries, not as hundreds of lines.
const expectNone = (list) => expect({ count: list.length, first: list.slice(0, 2) }).toEqual({ count: 0, first: [] });

const sweep = (fn) => {
  let n = 0;
  for (const zoom of ZOOMS) for (const [w, h] of SPANS) for (const c of COVERS) { fn(zoom, viewport(w, h), c); n++; }
  return n;
};

describe('F-22: the bridge and the gate agree for a fine (2 deg) base', () => {
  it('the gate hides a clip <=> the bridge promotes the held 2 deg base, over the whole zoom x span x coverage grid', () => {
    const miss = [];
    let hidden = 0;
    const n = sweep((zoom, vb, c) => {
      const res = clip(vb, c);
      const hides = gateHides(zoom, vb, res);
      if (hides) hidden++;
      const bridged = shouldBridgeToCoarseGlobal(res, FINE(), zoom, vb, {}, undefined, NOW_MS);
      if (hides !== bridged) miss.push({ zoom, span: [vb[2] - vb[0], vb[3] - vb[1]], cover: c, gateHides: hides, bridged });
    });
    expect(n).toBe(7 * 8 * 8);
    expect(hidden).toBeGreaterThan(150);          // the grid really contains hidden frames (not a vacuous pass)
    expectNone(miss);                              // pre-fix: every hidden frame with span <= 40 is listed here
  });

  it('names the band that was broken: z <= 7, span <= 40, a clip under 60% is hidden and must be replaced', () => {
    const vb = viewport(20, 12);                   // a 20 x 12 deg view (about z5.8 on a desktop map)
    expect(gateHides(6.2, vb, clip(vb, 0.3))).toBe(true);
    expect(shouldBridgeToCoarseGlobal(clip(vb, 0.3), FINE(), 6.2, vb, {}, undefined, NOW_MS)).toBe(true);
  });

  it('a clip the gate SHOWS (60% or more) is never replaced', () => {
    const vb = viewport(20, 12);
    expect(gateHides(6.2, vb, clip(vb, 0.8))).toBe(false);
    expect(shouldBridgeToCoarseGlobal(clip(vb, 0.8), FINE(), 6.2, vb, {}, undefined, NOW_MS)).toBe(false);
  });
});

describe('F-22: a COARSE (10 deg) base keeps the 40 deg ceiling (the 2026-07-22 trade, unchanged)', () => {
  it('never promoted inside the ceiling, promoted past it; never promoted over a clip the gate shows', () => {
    const inside = [];
    const past = [];
    const shown = [];
    sweep((zoom, vb, c) => {
      const res = clip(vb, c);
      const span = Math.max(vb[2] - vb[0], vb[3] - vb[1]);
      const hides = gateHides(zoom, vb, res);
      const bridged = shouldBridgeToCoarseGlobal(res, COARSE(), zoom, vb, {}, undefined, NOW_MS);
      if (!hides && bridged) shown.push({ zoom, span, cover: c });
      if (span <= 40 && bridged) inside.push({ zoom, span, cover: c });
      if (span > 40 && hides !== bridged) past.push({ zoom, span, cover: c, hides, bridged });
    });
    expectNone(inside);
    expectNone(past);
    expectNone(shown);
  });
});

describe('F-22: the mirror (sub-covering reject) and the arbiter agree with the bridge', () => {
  it('a fine world resident rejects a clip the gate would hide, and accepts one it shows', () => {
    const miss = [];
    sweep((zoom, vb, c) => {
      const inc = clip(vb, c);
      const rejected = shouldRejectSubcoveringRegional(FINE(), inc, zoom, vb, false, {});
      if (rejected !== gateHides(zoom, vb, inc)) miss.push({ zoom, span: [vb[2] - vb[0], vb[3] - vb[1]], cover: c, rejected });
    });
    expectNone(miss);
  });

  it('a coarse world resident keeps the 40 deg ceiling in the mirror too', () => {
    const vb = viewport(20, 12);
    expect(shouldRejectSubcoveringRegional(COARSE(), clip(vb, 0.3), 6.2, vb, false, {})).toBe(false);
    const wide = viewport(60, 30);
    expect(shouldRejectSubcoveringRegional(COARSE(), clip(wide, 0.3), 4.6, wide, false, {})).toBe(true);
  });

  it('decideMarineCommit gives the same verdict in guard mode and in arbiter mode over the fine-world grid', () => {
    const diverge = [];
    let rejects = 0;
    sweep((zoom, vb, c) => {
      const inc = clip(vb, c);
      __resetArbiterGraceForTests();
      const g = decideMarineCommit(FINE(), inc, zoom, vb, {}, 1000);
      __resetArbiterGraceForTests();
      const a = decideMarineCommit(FINE(), inc, zoom, vb, { __RAW_MARINE_ARBITER__: true }, 1000);
      if (g.reject) rejects++;
      if (g.reject !== a.reject) diverge.push({ zoom, span: [vb[2] - vb[0], vb[3] - vb[1]], cover: c, guards: g.rule, arbiter: a.rule });
      if (g.reject !== gateHides(zoom, vb, inc)) diverge.push({ zoom, cover: c, guardsVsGate: g.reject });
    });
    expect(rejects).toBeGreaterThan(100);
    expectNone(diverge);
  });
});

describe('F-22: what keeps the band from adding a wrong-hour or wrong-model frame', () => {
  const vb = viewport(20, 12);
  const res = clip(vb, 0.3);
  const call = (base, resident = res, selectedMs = NOW_MS, win = {}, staleSwapMs) =>
    shouldBridgeToCoarseGlobal(resident, base, 6.2, vb, win, staleSwapMs, selectedMs);

  it('promotes a base for the selected hour: the same valid time, or the same step snapped (within 1.5 h)', () => {
    expect(call(FINE())).toBe(true);
    expect(call(FINE({ valid_time: '2026-10-01T13:00:00Z' }), res, NOW_MS)).toBe(true);    // 1 h apart: the same step, snapped
    expect(call(FINE({ valid_time: '2026-10-01T11:00:00Z' }), res, NOW_MS)).toBe(true);
  });

  it('does NOT promote a base for another STEP of the model (2 h, 3 h, 24 h from the selected instant): the band stays hidden, as before', () => {
    expect(call(FINE({ valid_time: '2026-10-01T14:00:00Z' }))).toBe(false);   // the neighbouring 3-hourly step: drawn at full strength it would be a wrong hour (the dim starts only at 3.5 h)
    expect(call(FINE({ valid_time: '2026-10-01T09:00:00Z' }))).toBe(false);
    expect(call(FINE({ valid_time: '2026-10-02T12:00:00Z' }))).toBe(false);
  });

  it('...but a stale base is still promoted PAST the ceiling (the existing zoom-out arc: marineStaleHour owns it there)', () => {
    const wide = viewport(60, 30);
    expect(shouldBridgeToCoarseGlobal(clip(wide, 0.3), FINE({ valid_time: '2026-10-02T12:00:00Z' }), 4.6, wide, {}, undefined, NOW_MS)).toBe(true);
  });

  it('unknown times fail CLOSED: a promotion is a new action, so an unknown hour keeps the old rule (hidden, wash only)', () => {
    expect(shouldBridgeToCoarseGlobal(res, FINE(), 6.2, vb, {}, undefined, undefined)).toBe(false);   // not through `call`: its default would fill an undefined selectedMs in
    expect(call(FINE(), res, NaN)).toBe(false);
    expect(call(FINE(), res, null)).toBe(false);
    expect(call(FINE({ valid_time: undefined }), res, NOW_MS)).toBe(false);
  });

  it('does NOT promote another model\'s or another layer\'s base in the band', () => {
    expect(call(FINE({ __sourceModel: 'EURO' }))).toBe(false);
    expect(call(FINE({ __componentLayer: 'swell_1' }))).toBe(false);
    expect(call(FINE({ __sourceModel: 'EURO' }), clip(vb, 0.3, { __sourceModel: 'EURO' }))).toBe(true);
  });

  it('a rated resident is still replaced by the unrated base (the band the gate hides holds scores, not heights)', () => {
    expect(call(FINE(), clip(vb, 0.3, { ratingMode: true }))).toBe(true);
  });

  it('kill switch: __RAW_DISABLE_BASE_AWARE_BRIDGE__ restores the 40 deg ceiling for every base', () => {
    expect(call(FINE(), res, NOW_MS, { __RAW_DISABLE_BASE_AWARE_BRIDGE__: true })).toBe(false);
    const wide = viewport(60, 30);
    expect(shouldBridgeToCoarseGlobal(clip(wide, 0.3), FINE(), 4.6, wide, { __RAW_DISABLE_BASE_AWARE_BRIDGE__: true }, undefined, NOW_MS)).toBe(true);
    expect(shouldRejectSubcoveringRegional(FINE(), clip(vb, 0.3), 6.2, vb, false, { __RAW_DISABLE_BASE_AWARE_BRIDGE__: true })).toBe(false);
    __resetArbiterGraceForTests();
    expect(decideMarineCommit(FINE(), clip(vb, 0.3), 6.2, vb, { __RAW_MARINE_ARBITER__: true, __RAW_DISABLE_BASE_AWARE_BRIDGE__: true }, 1000).reject).toBe(false);
  });

  it('the older switches still win: the whole bridge off, and the 15 deg ceiling restore for every base', () => {
    expect(call(FINE(), res, NOW_MS, { __RAW_DISABLE_ZOOMOUT_BRIDGE__: true })).toBe(false);
    expect(call(COARSE(), res, NOW_MS, { __RAW_DISABLE_MIDBAND_BRIDGE_CEIL__: true })).toBe(true);
  });

  it('the F-21 stale-resident swap clause is untouched (a stale WORLD resident still swaps to a right-hour base)', () => {
    const staleWorld = FINE({ valid_time: '2026-10-01T03:00:00Z' });
    expect(shouldBridgeToCoarseGlobal(staleWorld, FINE(), 3.6, viewport(160, 70), {}, NOW_MS)).toBe(true);
  });
});

describe('F-22: near the antimeridian the band keeps the OLD rule (the engine coverage math has no longitude wrap)', () => {
  // A Fiji-style view: MapLibre reports an UNWRAPPED east (192), the backend returns the clip with WRAPPED bounds (west 170 > east -168).
  // The layer's gate is wrap-aware (it sees the clip cover the view); the engine's coverage math is not (it reads 0), so in the band it
  // would promote the world base over a covering clip and then reject every clip as sub-covering. Until the engine's math is wrap-aware
  // the new rule steps aside there: the band behaves exactly as it did before.
  const vbAM = [172, -25, 192, -13];                                                                     // 20 x 12 deg across the antimeridian
  const wrappedClip = (over = {}) => clip(viewport(8, 6), 1, { bounds: { west: 170, south: -26, east: -168, north: -12 }, ...over });
  const hiddenNormalClip = (over = {}) => clip(vbAM, 0.3, over);                                          // unwrapped bounds, 30% of the view

  it('a wrapped clip is not replaced by the base (the old ceiling: 20 deg is inside it)', () => {
    expect(shouldBridgeToCoarseGlobal(wrappedClip(), FINE(), 6.2, vbAM, {}, undefined, NOW_MS)).toBe(false);
  });

  it('a view past +-180 keeps the old rule even for an unwrapped, really sub-covering clip (the conservative limit)', () => {
    expect(shouldBridgeToCoarseGlobal(hiddenNormalClip(), FINE(), 6.2, vbAM, {}, undefined, NOW_MS)).toBe(false);
    const west = [-192, -25, -172, -13];
    expect(shouldBridgeToCoarseGlobal(clip(west, 0.3), FINE(), 6.2, west, {}, undefined, NOW_MS)).toBe(false);
  });

  it('...while a view EXACTLY at the edge of the world is an ordinary view (the rule applies)', () => {
    const edge = [-180, 20, -160, 32];
    expect(shouldBridgeToCoarseGlobal(clip(edge, 0.3), FINE(), 6.2, edge, {}, undefined, NOW_MS)).toBe(true);
  });

  it('the mirror does not reject a wrapped clip over a fine world resident, and the arbiter agrees', () => {
    expect(shouldRejectSubcoveringRegional(FINE(), wrappedClip(), 6.2, vbAM, false, {})).toBe(false);
    __resetArbiterGraceForTests();
    const g = decideMarineCommit(FINE(), wrappedClip(), 6.2, vbAM, {}, 1000);
    __resetArbiterGraceForTests();
    const a = decideMarineCommit(FINE(), wrappedClip(), 6.2, vbAM, { __RAW_MARINE_ARBITER__: true }, 1000);
    expect([g.reject, a.reject]).toEqual([false, false]);
    expect(shouldRejectSubcoveringRegional(FINE(), hiddenNormalClip(), 6.2, vbAM, false, {})).toBe(false);
  });

  it('past the 40 deg ceiling nothing changes near the antimeridian (the bridge still promotes, as before)', () => {
    const wide = [150, -40, 210, -5];                                                                    // 60 x 35 deg
    expect(shouldBridgeToCoarseGlobal(wrappedClip(), FINE(), 4.4, wide, {}, undefined, NOW_MS)).toBe(true);
    expect(shouldBridgeToCoarseGlobal(wrappedClip(), COARSE(), 4.4, wide, {}, undefined, NOW_MS)).toBe(true);
  });

  it('coverageWrapSafe: a normal view and grid are safe; a wrapped grid, a wrapped or beyond-world view, and unknowns are not', () => {
    const g = { west: -84, south: 24, east: -76, north: 32 };
    expect(coverageWrapSafe([-90, 22, -70, 34], g)).toBe(true);
    expect(coverageWrapSafe([-180, -80, 180, 85], g)).toBe(true);                                        // the engine's default world view
    expect(coverageWrapSafe([172, -25, 192, -13], g)).toBe(false);                                       // east past +180
    expect(coverageWrapSafe([-192, -25, -172, -13], g)).toBe(false);                                     // west past -180
    expect(coverageWrapSafe([170, -25, -170, -13], g)).toBe(false);                                      // east < west
    expect(coverageWrapSafe([-90, 22, -70, 34], { west: 170, south: -26, east: -168, north: -12 })).toBe(false);   // a wrapped grid
    expect(coverageWrapSafe(null, g)).toBe(false);
    expect(coverageWrapSafe([-90, 22, -70], g)).toBe(false);
    expect(coverageWrapSafe([-90, 22, -70, 34], null)).toBe(true);                                       // no grid bounds to read: the view alone decides
  });
});

describe('F-22: a tuned ceiling keeps working (an operator lever is never narrowed by the fix)', () => {
  const vb = viewport(12, 8);                              // not wide for the gate at z8.4 (span 12 <= 15), wide for a ceiling of 10
  const tuned = { __RAW_MARINE_GLOBAL_SPAN__: 10 };
  const res = clip(vb, 0.3);
  it('with __RAW_MARINE_GLOBAL_SPAN__ = 10 the bridge and the mirror act on a 12 deg view at z8.4 exactly as before the fix; at the default they do not', () => {
    expect(shouldBridgeToCoarseGlobal(res, FINE(), 8.4, vb, tuned, undefined, NOW_MS)).toBe(true);
    expect(shouldBridgeToCoarseGlobal(res, FINE(), 8.4, vb, {}, undefined, NOW_MS)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(res, COARSE(), 8.4, vb, tuned, undefined, NOW_MS)).toBe(true);
    expect(shouldRejectSubcoveringRegional(FINE(), res, 8.4, vb, false, tuned)).toBe(true);
    expect(shouldRejectSubcoveringRegional(FINE(), res, 8.4, vb, false, {})).toBe(false);
  });
  it('the arbiter agrees with the guard under the tuned ceiling', () => {
    __resetArbiterGraceForTests();
    const g = decideMarineCommit(FINE(), res, 8.4, vb, { ...tuned }, 1000);
    __resetArbiterGraceForTests();
    const a = decideMarineCommit(FINE(), res, 8.4, vb, { ...tuned, __RAW_MARINE_ARBITER__: true }, 1000);
    expect([g.reject, a.reject]).toEqual([true, true]);
  });
});

describe('isGateWideView (the gate\'s own wide test, shared by the layer and the bridge)', () => {
  it('is wide at z <= 7 or when either axis is wider than 15 degrees, and an unknown zoom falls back to the spans', () => {
    expect(isGateWideView(8.4, 10, 18)).toBe(true);        // tall only
    expect(isGateWideView(8.4, 18, 10)).toBe(true);        // wide only
    expect(isGateWideView(8.4, 15, 15)).toBe(false);       // exactly 15 is not wider than 15
    expect(isGateWideView(7.0, 1, 1)).toBe(true);          // the threshold itself is wide
    expect(isGateWideView(7.01, 1, 1)).toBe(false);
    expect(isGateWideView(undefined, 8, 6)).toBe(false);
    expect(isGateWideView(undefined, 20, 6)).toBe(true);
    expect(isGateWideView(NaN, 8, 6)).toBe(false);
  });
});

describe('isFineWorldBase', () => {
  it('is true for the 2 deg world and false for the 10 deg one, a regional tile and nothing', () => {
    expect(FINE_BASE_MAX_CELL_DEG).toBeGreaterThan(2.0);
    expect(FINE_BASE_MAX_CELL_DEG).toBeLessThan(10.0);
    expect(isFineWorldBase(FINE())).toBe(true);
    expect(isFineWorldBase(COARSE())).toBe(false);
    expect(isFineWorldBase(clip(viewport(8, 6), 1))).toBe(false);   // a 0.25 deg regional tile is fine but is not a WORLD base
    expect(isFineWorldBase(world(721, 331))).toBe(false);          // a 0.5 deg world frame is not a coarse-global grid (cell must exceed 1 deg), so never a held base
    expect(isFineWorldBase({ ...world(173, 82), bounds: { west: -172, south: -80, east: 173, north: 85 } })).toBe(false);   // 345 deg wide: not world-wide (359 or more)
    expect(isFineWorldBase(null)).toBe(false);
    expect(isFineWorldBase({ bounds: WORLD })).toBe(false);          // no cols: unknowable
  });

  it('classifies the grids the backend serves: 2 deg is fine, a 2.5 deg lattice is the last fine one, 3 deg and 5 deg are coarse', () => {
    expect(isFineWorldBase(world(181, 82))).toBe(true);    // 360/181
    expect(isFineWorldBase(world(145, 66))).toBe(true);    // 360/145 = 2.48
    expect(isFineWorldBase(world(121, 55))).toBe(false);   // 360/121 = 2.98
    expect(isFineWorldBase(world(73, 34))).toBe(false);    // 360/73 = 4.93
  });
});

describe('the fixture grid is not vacuous', () => {
  it('has hidden frames inside the old ceiling, past it, and shown frames, so each assertion above can fail', () => {
    let hiddenInside = 0, hiddenPast = 0, shown = 0;
    sweep((zoom, vb, c) => {
      const hides = gateHides(zoom, vb, clip(vb, c));
      const span = Math.max(vb[2] - vb[0], vb[3] - vb[1]);
      if (hides && span <= 40) hiddenInside++;
      if (hides && span > 40) hiddenPast++;
      if (!hides) shown++;
    });
    expect(hiddenInside).toBeGreaterThan(100);
    expect(hiddenPast).toBeGreaterThan(20);
    expect(shown).toBeGreaterThan(50);
  });
});
