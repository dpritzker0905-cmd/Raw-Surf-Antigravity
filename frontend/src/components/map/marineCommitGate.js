/**
 * marineCommitGate.js — THE COMMIT-ARBITRATION LANE (extracted 2026-08-01)
 *
 * One question, asked at one place: **may this incoming grid become the resident one, and when
 * should the held coarse-global take over instead?** The zoom-out bridge, its mirror-image
 * sub-covering reject, and `decideMarineCommit` (the single choke both the `setWaveData` commit
 * and the render loop's `_pendingDowngrade` self-heal route through) share one coverage
 * classifier — `_midBandBridgeWide` — and were already pure, exported and unit-tested. They
 * lived in WebGLMarineEngine.js only by history.
 *
 * WHY THE MOVE: the #11 marine-mask work (7551d511, dd6fd934, 3a0987ee, 883c0588) took the engine
 * 3207 -> 3336 lines against a baseline that is shrink-only, so `scripts/loc_ratchet.py` went red
 * on every push to dev. The baseline was NOT rubber-stamped; this is the 129 lines paid back with
 * interest out of a unit that never needed a GL context.
 *
 * BEHAVIOUR-PRESERVING BY CONSTRUCTION, the same way the 2026-07-29 `marineEngineDecisions` move
 * was: the function bodies are byte-identical (the ONLY edit is one added `export` keyword, see
 * `_arbiterGraceState` below), and WebGLMarineEngine.js imports them back BY NAME and re-exports
 * them, so `import { decideMarineCommit } from './WebGLMarineEngine'` still resolves exactly what
 * it did before. Six test files depend on that: marineCommitArbiter{,.sequence,.differential},
 * marineTransitionCoordinator.switchHold, and WebGLMarineEngine.{noDowngrade,subcoverReject}.
 *
 * `_arbiterGraceState` moves WITH `decideMarineCommit` and `__resetArbiterGraceForTests` — all
 * three must share a module or the reset stops resetting the state the decision actually reads,
 * a silent no-op of exactly the kind the reset exists to prevent between tests. It is `export`ed
 * rather than module-private because a SECOND reader stayed behind in the engine; that reader is
 * why the first cut of this move failed the scope-integrity guard instead of shipping green.
 */

import { arbiterDecide } from './marineCommitArbiter';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';
import {
  isCoarseGlobalGrid, isRegionalBounds, shouldRejectResolutionDowngrade,
} from './marineEngineDecisions';

// ZOOM-OUT BRIDGE (2026-07-15, user "heatmap clears for a quick second midway zooming out" AND
// "green grid around FL"): on a fast/settling zoom-out the regional resident either CLEARS to a
// blank flash (WebGLMarineLayer's zoom-out clamp guard) or is HELD and renders as a tiny blocky
// grid rectangle floating over its bounds. Both faces are the same root: the regional is never
// replaced by the held global-coarse until a fresh global fetch commits. We already retain a
// global-coarse grid for the wash (_coarseBaseData.waveGrid) — promote it to the MAIN resident
// the moment the regional stops covering a wide viewport, so the honest global field bridges the
// gap (no blank, no floating rectangle). Self-contained coverage check (same math + lever as the
// no-downgrade guard) using the last render frame's zoom/viewport, so both the render loop and
// the layer can call it safely. Runs ONCE — after promotion the resident is coarse-global and the
// isRegionalBounds guard is false. Kill: __RAW_DISABLE_ZOOMOUT_BRIDGE__. Returns true if bridged.
// Pure decision for the zoom-out bridge (exported + unit-tested, mirroring
// shouldRejectResolutionDowngrade). TRUE ⇒ promote the held coarse-global `coarse` over the
// regional `resident`. Fires ONLY when: a coarse-global grid is held, the resident is a regional
// grid, the view is wide (zoomed out ≤ MARINE_ZOOMED_OUT_MAX_ZOOM or >15° either axis), and the
// resident covers < __RAW_DOWNGRADE_COVER_FRAC__ (0.6) of the viewport — i.e. exactly the
// coverage boundary where the no-downgrade guard also releases it, so the two never fight.
// MID-BAND BRIDGE CEILING (2026-07-22, USER "Bertha clears / heatmap changes as I zoom out"): the
// 2° mid tier now SERVES to 40° (MARINE_MID_RES_MAX_SPAN / __RAW_MARINE_GLOBAL_SPAN__), so a 15-40°
// viewport is NOT "too wide for the mid" — the bridge (and its mirror reject) must only fire PAST the
// ceiling, i.e. genuine world zoom where no mid exists. The old `zoom<=7 || span>15` classed z5-7 as
// wide and bridged the covering mid → 10° global-coarse during the mid fetch-latency window (EURO
// Copernicus ~7-10s) = a ~5s coarse flash where the compact storm vanished (zoomlab-proven: bridge
// OFF → EURO holds the mid, cols 7-13, no flash; bridge ON → cols 37 for ~5s). Below the ceiling the
// mid keeps up on a moderate zoom-out (each viewport gets a wider mid) with the coarse base under any
// uncovered edge; past it the coarse is honest. Kill: __RAW_DISABLE_MIDBAND_BRIDGE_CEIL__ restores 15°.
function _midBandBridgeWide(vb, lastZoom, w) {
  if (!vb) return false;
  if (w && w.__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__ === true) {
    return (typeof lastZoom === 'number' && lastZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM)
      || (vb[2] - vb[0]) > 15.0 || (vb[3] - vb[1]) > 15.0;
  }
  const ceil = (w && Number(w.__RAW_MARINE_GLOBAL_SPAN__)) || 40.0;
  return (vb[2] - vb[0]) > ceil || (vb[3] - vb[1]) > ceil;
}

export function shouldBridgeToCoarseGlobal(resident, coarse, lastZoom, viewportBounds, win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (w && w.__RAW_DISABLE_ZOOMOUT_BRIDGE__ === true) return false;
  if (!coarse || !isCoarseGlobalGrid(coarse)) return false;
  if (!resident || !resident.bounds || !isRegionalBounds(resident.bounds) || isCoarseGlobalGrid(resident)) return false;
  const vb = viewportBounds;
  if (!vb) return false;
  if (!_midBandBridgeWide(vb, lastZoom, w)) return false;
  const rb = resident.bounds;
  const vpA = Math.max(1e-9, (vb[2] - vb[0]) * (vb[3] - vb[1]));
  const ix = Math.max(0, Math.min(rb.east, vb[2]) - Math.max(rb.west, vb[0]));
  const iy = Math.max(0, Math.min(rb.north, vb[3]) - Math.max(rb.south, vb[1]));
  const frac = (ix * iy) / vpA;
  const minFrac = (w && Number(w.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
  return frac < minFrac;   // regional no longer covers → bridge to the held global
}

// SUB-COVERING REGIONAL REJECT (2026-07-16, Playwright real-wheel frame trace of the z5.9→5.02
// "cleared then came back" report; pure + exported for tests). Mid-gesture the pan-following
// refetch committed a regional covering only ~60% of the wide viewport OVER the covering
// coarse-global resident; the display gate hid it (mult 0) and the bridge bounced the world grid
// right back two frames later — a pale interlude plus a promotion flash for zero net change.
// Reject that commit at the same choke point the no-downgrade guard uses: at wide view a regional
// that covers < __RAW_DOWNGRADE_COVER_FRAC__ (0.6 — the SAME lever and math as
// shouldBridgeToCoarseGlobal, so commit/gate/bridge can never disagree) must not replace a
// coarse-global resident. Deliberate switches are never held (model/layer/hour/rating flavor must
// all match), and unknown zoom/viewport FAILS OPEN (the 07-03 lesson: a wrong accept self-heals,
// a wrong reject strands). Rejected grids go to the SAME self-heal stash — zoom back in past the
// coverage boundary and the stash commits. Kill: __RAW_DISABLE_SUBCOVER_REJECT__ (also off under
// the shared __RAW_DISABLE_NO_DOWNGRADE__ via the call sites' `disabled` arg).
export function shouldRejectSubcoveringRegional(resident, incoming, lastZoom, viewportBounds, disabled, win) {
  if (disabled || !resident || !incoming) return false;
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (w && w.__RAW_DISABLE_SUBCOVER_REJECT__ === true) return false;
  if (!isCoarseGlobalGrid(resident)) return false;
  if (!incoming.bounds || !isRegionalBounds(incoming.bounds) || isCoarseGlobalGrid(incoming)) return false;
  if ((resident.__sourceModel || 'GFS') !== (incoming.__sourceModel || 'GFS')) return false;
  if ((resident.__componentLayer || 'waves') !== (incoming.__componentLayer || 'waves')) return false;
  if (incoming.hourOffset === undefined || resident.hourOffset === undefined
      || incoming.hourOffset !== resident.hourOffset) return false;
  if (!!resident.ratingMode !== !!incoming.ratingMode) return false;
  const vb = viewportBounds;
  if (typeof lastZoom !== 'number' || !vb) return false;   // unknown → fail open
  // Mirror of shouldBridgeToCoarseGlobal (2026-07-22): fire only PAST the mid-band ceiling so a
  // 15-40° mid is ACCEPTED over a coarse resident (it covers) instead of rejected as "subcovering" —
  // the reject and the bridge share this classification so commit/gate/bridge can never disagree.
  if (!_midBandBridgeWide(vb, lastZoom, w)) return false;
  const ib = incoming.bounds;
  const vpA = Math.max(1e-9, (vb[2] - vb[0]) * (vb[3] - vb[1]));
  const ix = Math.max(0, Math.min(ib.east, vb[2]) - Math.max(ib.west, vb[0]));
  const iy = Math.max(0, Math.min(ib.north, vb[3]) - Math.max(ib.south, vb[1]));
  const frac = (ix * iy) / vpA;
  const minFrac = (w && Number(w.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
  return frac < minFrac;
}

// === ARBITER PHASE C — THE ONE COMMIT DECISION POINT (2026-07-18 EVE-3) ===
// Design: DESIGN-2026-07-18-marine-commit-arbiter.md §5. Phases A/B gave every commit a descriptor
// and ran `arbiterDecide` in shadow to 89/89 agreement; this is the flip surface.
//
// WHY A SHARED FUNCTION AND NOT AN `if` AT THE CHOKE: the accept/reject verdict is computed in TWO
// places that MUST agree exactly — the `setWaveData` choke and the `_pendingDowngrade` self-heal
// re-evaluation in the render loop (which carries the standing comment "must mirror the setWaveData
// choke point exactly, or a grid stashed by the subcover clause would insta-accept here and bounce
// anyway"). Flipping only the choke would have the ARBITER reject and the GUARDS insta-accept the
// stash on the very next frame: a permanent commit⇄stash bounce at frame rate — a worse shape than
// the ping-pong the guards were built to kill. Routing BOTH call sites through this one function
// makes that divergence structurally impossible, in either mode.
//
// MODE: guards (default, byte-identical to pre-flip) → `__RAW_MARINE_ARBITER__ = true` routes the
// verdict through the arbiter rule list. Kill: `__RAW_DISABLE_MARINE_ARBITER__ = true` restores the
// guard chain wholesale and outranks the enable (both paths ship for one release, per design §5).
// The self-heal stash, its every-frame re-evaluation, and the rating-interlude grace all survive
// the flip unchanged in SHAPE — the grace is a named arbiter rule (`rated_uncovering_grace`), not a
// dropped nuance: releasing instantly there re-opens round-12 §4f (see marineCommitArbiter.js).
// Returns { reject, why: 'downgrade'|'subcover'|null, rule, source }.
// EXPORTED because there is a SECOND consumer: the Phase B shadow `arbiterDecide` call still living
// at the `setWaveData` choke passes this very object (WebGLMarineEngine.js, "Shadow must exercise
// the SAME rule list the flip will run, grace included"). Identity is the contract — two grace
// states would let the shadow report a permanent divergence on the rating-grace rule. The engine's
// scope-integrity guard is what caught this when the move first left that reader unbound.
export const _arbiterGraceState = { key: null, startedAt: 0, expired: false };
export function __resetArbiterGraceForTests() {
  _arbiterGraceState.key = null; _arbiterGraceState.startedAt = 0; _arbiterGraceState.expired = false;
}
export function decideMarineCommit(resident, incoming, lastZoom, viewportBounds, win, nowMs) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  const disabled = !!(w && w.__RAW_DISABLE_NO_DOWNGRADE__);
  const arbiterOn = !!(w && w.__RAW_MARINE_ARBITER__ === true && w.__RAW_DISABLE_MARINE_ARBITER__ !== true);

  if (!arbiterOn) {
    if (resident && incoming) {
      if (shouldRejectResolutionDowngrade(resident, incoming, lastZoom, viewportBounds, disabled, nowMs)) {
        return { reject: true, why: 'downgrade', rule: 'guard_downgrade', source: 'guards' };
      }
      if (shouldRejectSubcoveringRegional(resident, incoming, lastZoom, viewportBounds, disabled, w)) {
        return { reject: true, why: 'subcover', rule: 'guard_subcover', source: 'guards' };
      }
    }
    return { reject: false, why: null, rule: 'guard_pass', source: 'guards' };
  }

  // Arbiter mode. The whole-guard kill switch must keep killing the whole decision (operators reach
  // for __RAW_DISABLE_NO_DOWNGRADE__ to force every commit through, in either mode).
  if (disabled) return { reject: false, why: null, rule: 'no_downgrade_disabled', source: 'arbiter' };
  const d = arbiterDecide(resident, incoming, {
    zoom: lastZoom,
    viewportBounds,
    flavorWant: !!(w && (w.__SURF_MODE__ === true
      || (w.__SURF_MODE__ === undefined && w.localStorage
          && w.localStorage.getItem('__SURF_MODE__') === 'true'))),
    zoomedOutMaxZoom: MARINE_ZOOMED_OUT_MAX_ZOOM,
    // Mid-band ceiling from the SAME `w` the guard's shouldRejectSubcoveringRegional read above.
    midBandCeil: (w && Number(w.__RAW_MARINE_GLOBAL_SPAN__)) || 40.0,
    midBandCeilOff: !!(w && w.__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__ === true),
    coverFrac: (w && Number(w.__RAW_DOWNGRADE_COVER_FRAC__)) || undefined,
    graceState: _arbiterGraceState,
    graceDisabled: !!(w && w.__RAW_DISABLE_RATING_GRACE__ === true),
    graceMs: (w && typeof w.__RAW_RATING_GRACE_MS__ === 'number') ? w.__RAW_RATING_GRACE_MS__ : undefined,
    nowMs,
  });
  const reject = d.verdict === 'reject';
  // ENGAGEMENT PROOF (the A/B's positive control): a flip that silently fell back to the guards
  // would produce an identical-looking green battery. This tally is how a run proves the arbiter
  // actually decided, and the rule histogram is the decision log the design asked for.
  if (w) {
    const t = w.__RAW_ARBITER_LIVE__ || (w.__RAW_ARBITER_LIVE__ = { n: 0, rejects: 0, byRule: {} });
    t.n++;
    if (reject) t.rejects++;
    t.byRule[d.rule] = (t.byRule[d.rule] || 0) + 1;
    t.last = { rule: d.rule, verdict: d.verdict };
  }
  // `why` keeps the legacy telemetry/log vocabulary stable across the flip (dashboards + the
  // zoomlab verdict parser key off 'downgrade'/'subcover').
  return {
    reject,
    why: reject ? (d.rule === 'subcover_at_wide' ? 'subcover' : 'downgrade') : null,
    rule: d.rule,
    source: 'arbiter',
  };
}
