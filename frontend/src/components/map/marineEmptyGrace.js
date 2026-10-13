/**
 * marineEmptyGrace.js — when is "marine layer active, no vectors" a violation, and when is it a load?
 *
 * W-32 (2026-09-29). useLayerTruthDiff's RULE 3 reported MARINE_EMPTY_RENDER whenever a marine layer
 * was active, no fetch flag was set and the grid had no vectors. Those flags are cleared in the
 * fetch's `finally`, BEFORE the grid commits: measured on a production build (Waves on, 50 ms probe),
 * the flags dropped at 3,037 ms and the grid reached the engine at 3,719 ms — ~680 ms in which the
 * rule was true on a perfectly healthy load. The server log carried TRUTH_VIOLATION_MARINE_EMPTY_RENDER
 * on every build of 2026-09-29, so the one channel meant to surface a real empty render could not.
 *
 * The rule now needs the condition to HOLD for MARINE_EMPTY_GRACE_MS. A real empty render (no data and
 * nothing fetching) persists far longer and is still reported; the commit gap is not. A transition or
 * a present grid resets the clock, so every new load gets its own full grace.
 * Kill (restores the immediate report): window.__RAW_DISABLE_MARINE_EMPTY_GRACE__ = true.
 */

export const MARINE_EMPTY_GRACE_MS = 3000;

/**
 * Pure decision for one snapshot.
 * @param {object} p
 * @param {boolean} p.empty          marine layer active AND no vectors
 * @param {boolean} p.transitioning  any of the transition / fetch-pending / debouncing flags
 * @param {number|null} p.since      when the current empty spell began (ms), or null
 * @param {number} p.now             current time (ms)
 * @param {number} [p.graceMs]
 * @param {boolean} [p.disabled]     the kill switch
 * @returns {{ report: boolean, since: number|null, recheckInMs: number|null }}
 */
export function marineEmptyVerdict({ empty, transitioning, since, now, graceMs = MARINE_EMPTY_GRACE_MS, disabled = false }) {
  if (!empty || transitioning) return { report: false, since: null, recheckInMs: null };
  if (disabled) return { report: true, since: since ?? now, recheckInMs: null };
  const start = since ?? now;
  const held = now - start;
  if (held >= graceMs) return { report: true, since: start, recheckInMs: null };
  return { report: false, since: start, recheckInMs: graceMs - held };
}
