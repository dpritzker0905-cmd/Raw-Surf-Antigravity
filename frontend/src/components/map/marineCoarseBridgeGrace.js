// === COARSE-BRIDGE GRACE (pure; exported for tests) ===
// 2026-08-15, from the `Marine Nightly` zoomlab traces (runs 31680258907 / 31871169312 red,
// 31781976971 green). The COARSE-BASE BRIDGE (`WebGLMarineCustomLayer.js`, `e3fb61b4` 2026-07-04)
// hides a non-covering regional at `opacityMultiplier = 0` and lets the coarse wash carry the
// viewport "until the real global commits". Its comment assumes ~1 s. MEASURED at HEAD:
//
//     08-13   heatmap at zero 18,836 ms   (3,327 ms of it AFTER the zoom stopped)
//     08-15   heatmap at zero  4,874 ms   (2,866 ms of it AFTER the zoom stopped)
//     08-14   heatmap at zero      0 ms   — a covering grid simply arrived a zoom step early
//
// The hold length is FETCH LATENCY for a covering grid, and nothing bounds it. That is the exact
// failure the cold veil's own comment names, dated to this bridge's own commit:
//   "BOUNDED by design (the 2026-06-29/07-04 lesson — every unbounded fade-to-zero here read as a
//    'blank heatmap' bug): a grace timer reveals the coarse anyway if no adequate commit lands."
// Every sibling here is bounded — cold veil (__RAW_COLD_VEIL_GRACE_MS__ 4000 + a 350 ms lift),
// sharpen ease (600), rating grace. The bridge is the only fade-to-zero in the family with no bound.
//
// ⛔⛔ THIS IS DELIBERATELY *NOT* EITHER OF THE TWO FIXES ALREADY TRIED AND REJECTED:
//  1. `b21cf29d` (2026-07-16, a REVERT) painted the partial regional IMMEDIATELY — "the 0.6-0.8
//     band rendered a partial regional over a blank/damped background MID-GESTURE (the motion
//     rectangle)". ⇒ this reveals only after a grace AND only while the view is NOT moving, which
//     is where the measured damage is (2.9-3.3 s with the zoom already stopped).
//  2. The FROM-hidden snap in `applySharpenOpacityEase` (2026-07-17) exists because easing UP from
//     hm 0 measured ΔL 1.9 → +48.3 — WORSE. ⇒ this ramps with the cold veil's own 350 ms lift and
//     never routes through the sharpen ease; by revealing BEFORE the commit it also gives that ease
//     a visible `from`, so the arriving grid stops taking the snap path at all.
//
// ⚠️ The reveal ceiling is 1.0 ON PURPOSE: at wide zoom the engine's TINY-TILE VIVIDNESS PARITY
// fade (2026-07-19, `4da586aa`) already pulls a sub-viewport regional to a PEER of the wash instead
// of a postage stamp — but it is gated `blendEngaged && heatmapOpacity > 0`, so the bridge's own
// zero disables it. Handing back a non-zero multiplier is what lets the mechanism built for this
// hazard actually run. (blendEngaged measured TRUE on every frame of both red bursts.)
// ⚠️ The clock advances per RENDERED frame; the marine engine animates continuously, which is why
// a settled viewport still ticks. A layer that stopped rendering would hold at 0 — the legacy state.
// ⚠️ EPISODE BOUNDARIES COME FROM THE CALLER: it clears `engine.__coarseBridgeGrace` at the top of
// every render and only this branch re-arms it, so a frame that does not take the bridge path drops
// the clock. That is why there is no staleness timer here (see the note in the body).
//
// DEFAULT OFF (`__RAW_COARSE_BRIDGE_GRACE__` unset ⇒ mult 0 ⇒ byte-identical to the line it
// replaces). Levers: __RAW_COARSE_BRIDGE_GRACE_MS__ (4000) / __RAW_COARSE_BRIDGE_GRACE_RAMP_MS__
// (350) / __RAW_COARSE_BRIDGE_GRACE_CEIL__ (1.0). Telemetry: __RAW_GPU__.coarseBridgeGrace.
// Returns { mult, state } — the opacity multiplier for this frame and the (possibly null) clock.

const num = (v, dflt) => ((typeof v === 'number' && v >= 0) ? v : dflt);

export function resolveCoarseBridgeGrace(state, opts, nowMs, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const o = opts || {};
  // OFF, or the bridge is not holding this frame ⇒ legacy: hidden, and the clock is dropped so a
  // later episode starts from zero rather than inheriting a stale one.
  if (w.__RAW_COARSE_BRIDGE_GRACE__ !== true || !o.bridgeActive) return { mult: 0, state: null };

  const graceMs = num(w.__RAW_COARSE_BRIDGE_GRACE_MS__, 4000);
  const rampMs = Math.max(1, num(w.__RAW_COARSE_BRIDGE_GRACE_RAMP_MS__, 350));
  const ceil = Math.max(0, Math.min(1, num(w.__RAW_COARSE_BRIDGE_GRACE_CEIL__, 1.0)));

  // EPISODE IDENTITY IS THE CALLER'S, NOT A TIMER'S. `state` survives only while the bridge branch
  // runs on consecutive frames — the caller clears it at the top of every render — so "no state"
  // means "the bridge was not holding last frame" exactly, with no wall-clock heuristic to tune.
  // ⚠️ A staleness window was tried first and rejected: it assumes a repaint cadence, and a viewport
  // that stopped repainting would restart the clock forever ⇒ a grace that can never be reached,
  // which is the guard-cannot-reach-its-subject class.
  const t0 = (state && typeof state.t0 === 'number' && nowMs >= state.t0) ? state.t0 : nowMs;
  const held = nowMs - t0;

  // ⛔ NEVER mid-gesture (the b21cf29d lesson). Motion also RESETS the ramp origin, so the reveal
  // can only ever restart from hidden — it can hide faster, never appear faster.
  const eligible = held >= graceMs && !o.moving;
  const prevRt0 = (state && typeof state.rt0 === 'number') ? state.rt0 : null;
  const rt0 = eligible ? ((prevRt0 !== null && nowMs >= prevRt0) ? prevRt0 : nowMs) : null;

  let mult = 0;
  if (rt0 !== null) {
    const t = Math.max(0, Math.min(1, (nowMs - rt0) / rampMs));
    mult = ceil * (t * t * (3 - 2 * t));    // smoothstep — the cold veil's lift shape
  }
  return { mult, state: { t0, rt0, held, revealing: rt0 !== null } };
}
