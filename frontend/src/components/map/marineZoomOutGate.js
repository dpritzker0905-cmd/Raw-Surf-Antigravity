/**
 * marineZoomOutGate.js — the zoom-out rejection decision, extracted PURE so it can be tested.
 *
 * ⚠️ THIS DECISION HAD NO TEST, AND THAT IS WHY THE BLANK SHIPPED. It lived inline in
 * WebGLMarineCustomLayer's render path, reachable only by booting a map with a GL context, so the
 * only thing that could observe it was the nightly zoomlab battery — a ~20-minute job whose verdict
 * is bimodal. The repo already has the answer to that shape one file over: `marineRefeedCovers` is
 * pure, exported, window-injected and kill-switched precisely so a gate test can drive it. Same
 * pattern here.
 *
 * THE DEFECT IT DESCRIBES, measured 2026-08-06 over 7 nightly runs / 2,452 frames:
 *
 *     blank  <=>  overlapRatio < _coverFrac (0.6)  AND  no coarse base to promote
 *
 *     predicted-blank & blank     :   14
 *     predicted-blank & NOT blank :    0
 *     blank & NOT predicted       :    0
 *     clean & predicted clean     : 2438
 *
 * Zero false positives, zero misses. The layer's own comment states the intended design —
 * "guard keeps >=0.6, gate shows >=0.6, bridge promotes <0.6 — no coverage band is
 * resident-but-hidden" — so the <0.6 band is SUPPOSED to be covered by the coarse bridge. When
 * `engine._coarseBaseData` is absent the third branch paints nothing instead, and the viewport goes
 * blank for as long as the wider grid takes to arrive (measured: 8 consecutive frames, ~8 s).
 *
 * ⛔ TWO FIXES ARE ALREADY KNOWN-BAD — DO NOT RE-PROPOSE THEM:
 *   1. Lower `_coverFrac`. Tried and REVERTED (b21cf29d): without the coarse promotion underneath,
 *      the 0.6-0.8 band renders a partial regional over a blank background — the "motion rectangle".
 *   2. Route the no-bridge case into the existing fade branch. NO-OP: that branch computes
 *      zoomFade = clamp((z - 5.5) / 1.0), and every measured blank frame is at z = 4.985 / 4.805 /
 *      4.625, so zoomFade is already 0 at all of them.
 *
 * ★ THIS MODULE DELIBERATELY DOES NOT CHANGE BEHAVIOUR. It reproduces the current decision exactly,
 *   including the blank, so the defect is reproducible in milliseconds instead of a flaky nightly.
 *   Choosing between "blank" and "partial regional over basemap" is a visual product judgement on a
 *   surface with a documented revert history; the durable fix is to make the coarse base reliably
 *   retained so the <0.6 band is covered as designed (see WebGLMarineEngine.coarseBaseLru /
 *   coarseBaseSwap). Encode the decision first, then change it against a test that can see it.
 *
 * ✅ WIRED 2026-08-16 (C4-MR-15). `WebGLMarineCustomLayer` imports `resolveRejectedOpacity` and the
 * inline copy is retired. Equivalence proved over a 1,296-case grid against the retired logic
 * transcribed as an oracle (`marineZoomOutGate.wiring.test.js`), and the full frontend suite ran
 * green (237 suites / 2,248 tests) — from a NORMAL checkout, which is what the earlier deferral was
 * waiting on.
 *
 * ⚠️ AND THE DRIFT THIS HEADER WARNED ABOUT HAD ALREADY HAPPENED — in nine days. `e17f0332`
 * (2026-08-15) added the COARSE-BRIDGE GRACE to the layer's branch 1, while this module still froze
 * that branch at a flat 0.0. Wiring the module AS WRITTEN would have REVERTED the grace: a
 * behaviour regression delivered inside a "no-op refactor". The resolution is the division below.
 *
 * ★ THE DIVISION: this module owns WHICH BRANCH applies; the layer owns branch 1's OPACITY and its
 *   side effects (the grace needs `map`, `performance` and engine state — it cannot be pure). So
 *   `coarseBridge: true` means "the bridge branch applies, YOU supply the multiplier", and the
 *   `opacity: 0.0` returned with it is the legacy default the layer overrides. Branches 2-4 are
 *   authoritative here. Neither side duplicates the other's condition.
 */

export const DEFAULT_COVER_FRAC = 0.6;

/**
 * Resolve what a REJECTED regional grid should render as while zoomed out.
 *
 * Pure. Every input is a plain value read from the frame the layer is about to draw.
 * Returns { opacity, coarseBridge, bail } where `bail` means "return without rendering".
 *
 * @param {object} s
 * @param {boolean} s.isViewportZoomedOut
 * @param {boolean} s.isGridRegional
 * @param {boolean} s.hasCoarseBridge   engine._coarseBaseData?.u_waveTexture is present
 * @param {boolean} s.isZoomingOrMoving includes the fetch-pending/transitioning flags
 * @param {number}  s.currentZoom
 * @param {number}  s.overlapRatio      fraction of the viewport the resident grid covers
 */
export function resolveRejectedOpacity(s) {
  const {
    isViewportZoomedOut = false,
    isGridRegional = false,
    hasCoarseBridge = false,
    isZoomingOrMoving = false,
    currentZoom = 0,
    overlapRatio = 1,
  } = s || {};

  // 1. The designed graceful path: hide the non-covering regional but let the engine paint the
  //    retained coarse-global base underneath, so the viewport degrades to a coarse field.
  // ⚠️ `opacity` here is the LEGACY DEFAULT, not the answer. The caller overrides it with the
  //    coarse-bridge grace multiplier (`e17f0332`), which is impure. `coarseBridge: true` is the
  //    real return value of this branch — see the header's DIVISION note.
  if (isViewportZoomedOut && isGridRegional && hasCoarseBridge) {
    return { opacity: 0.0, coarseBridge: true, bail: false };
  }

  // 2. Settled and rejected: stop rendering entirely.
  if (!isZoomingOrMoving) {
    return { opacity: 0.0, coarseBridge: false, bail: true };
  }

  // 3. ⚠️ THE UNHANDLED CASE — zoomed out, regional, mid-gesture, and NO coarse base to promote.
  //    Paints nothing. This is the measured blank: 14/14 blank frames land here, and no frame that
  //    landed here failed to blank. Reproduced as-is on purpose; see the header before "fixing" it.
  if (isViewportZoomedOut && isGridRegional) {
    return { opacity: 0.0, coarseBridge: false, bail: false, unhandledBlank: true };
  }

  // 4. Otherwise fade out on zoom and on low overlap.
  let zoomFade = 1.0;
  if (currentZoom <= 6.5) {
    zoomFade = Math.max(0.0, Math.min(1.0, (currentZoom - 5.5) / (6.5 - 5.5)));
  }
  let overlapFade = 1.0;
  if (overlapRatio < 0.15) {
    overlapFade = Math.max(0.0, Math.min(1.0, (overlapRatio - 0.05) / (0.15 - 0.05)));
  }
  return { opacity: Math.min(zoomFade, overlapFade), coarseBridge: false, bail: false };
}

/**
 * Would this frame blank? The model validated against 2,452 measured frames.
 * Exported so a guard can assert the condition directly rather than inferring it from an opacity.
 */
export function isBlankFrame({ overlapRatio, hasCoarseBridge, coverFrac = DEFAULT_COVER_FRAC }) {
  return overlapRatio < coverFrac && !hasCoarseBridge;
}
