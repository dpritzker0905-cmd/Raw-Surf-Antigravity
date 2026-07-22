// marineTransitionCoordinator.js
//
// Single source of truth for marine heatmap MODEL/LAYER transition ownership.
//
// Replaces the loosely-coordinated global boolean `window.__MARINE_TRANSITIONING__`,
// which had multiple independent writers and clearers. The core defect that motivated
// this module: an older in-flight fetch could clear the transition flag while a NEWER
// model/layer transition was still pending (because the flag carried no ownership), so
// the UI could briefly relabel a stale frame as the newly-selected target.
//
// Design:
//   - A monotonically increasing generation (`transitionId`) identifies each transition.
//   - `beginTransition` is idempotent on {model,layer}: re-calling it while the same
//     transition is still pending returns the same generation (safe for render-phase /
//     React StrictMode double-render).
//   - Only the holder of the CURRENT generation may end the transition. A stale fetch
//     captures its generation at dispatch and passes it to `endTransition`; if a newer
//     transition has since begun, the stale call is a no-op.
//   - `markDisplayed` records the identity of the frame actually shown on the heatmap,
//     so readers (infobox parity gate, diagnostics) can compare displayed-vs-requested
//     identity instead of trusting a single boolean.
//
// Compatibility: during migration this module MIRRORS its pending state to
// `window.__MARINE_TRANSITIONING__` so un-migrated readers and existing Playwright /
// diagnostics keep working. `__MARINE_FETCH_PENDING__` and `__MARINE_FETCH_DEBOUNCING__`
// remain owned by useMarineDataFetcher (separate concerns) and are NOT touched here.

import { isHandheldDevice } from './deviceTier';

let _gen = 0;          // monotonic transitionId
let _target = null;    // { gen, beginKey, model, layer, hour, viewportKey, status }
let _displayed = null; // { model, layer, hour, viewportKey } — last frame actually shown
const _subs = new Set();

const transitionKey = (model, layer) => `${model ?? ''}|${layer ?? ''}`;

// CROSS-FAMILY TOGGLE HOLD (2026-07-11, audit #27 "marine clears when toggling to wind; wind
// seemed better than marine"): the 07-06 transition-hold below only covers IN-FAMILY switches
// (model/layer flips set __MARINE_TRANSITIONING__/__MARINE_FETCH_*), so a marine→wind/radar/raster
// toggle set none of the flags, both clear sites fired, and the return leg paid a full re-encode
// + mask rebuild + TWO particle resets — while wind RETAINS across the same gesture
// (hold-last-frame 06fbeef2 + trail-keep 68e80179), hence the felt asymmetry. Residents now stay
// held for a TTL after ANY deactivation; within it the reactivation dup-skips (the residency-aware
// diff in computeVectorDiffAndLog re-uploads whenever the engine is actually empty, so a held-then-
// expired engine can never dup-skip into a blank heatmap). Marginal VRAM is small: clearBuffers
// never freed the big residents (_residentWaveTex/_cachedMaskTex/bath/chl survive it) — the hold
// only keeps the coarse-base FBO + the _waveData binding alive. Handhelds hold for a shorter TTL.
// Expiry executes at the per-frame clear site on the next rendered frame past the TTL (same
// deferred-clear reliance as the in-family hold); truth stays safe because the held frame's
// displayed identity is unchanged (infobox parity gate compares identity, not recency).
// Kill: __RAW_MARINE_XFAM_HOLD_DISABLED__=true (cross-family only) or __RAW_DISABLE_CLEAR_HOLD__
// (all holds). Tune: __RAW_MARINE_XFAM_HOLD_TTL_MS__. Telemetry: __MARINE_XFAM_HOLD_COUNT__ +
// recordChurn('xfam_hold_expired').
const XFAM_HOLD_TTL_MS_DEFAULT = 120000;
const XFAM_HOLD_TTL_MS_HANDHELD = 30000;
let _xfamDeactivatedAt = null; // first deactivated-with-residents call starts the clock
let _xfamExpiredLogged = false;

function xfamHoldTtlMs() {
  if (typeof window !== 'undefined' && typeof window.__RAW_MARINE_XFAM_HOLD_TTL_MS__ === 'number') {
    return Math.max(0, window.__RAW_MARINE_XFAM_HOLD_TTL_MS__);
  }
  return isHandheldDevice() ? XFAM_HOLD_TTL_MS_HANDHELD : XFAM_HOLD_TTL_MS_DEFAULT;
}

/** Reset the cross-family deactivation clock. Called from the marine layer's active paths
 *  (React effect on the active flip + per-frame render, both idempotent-cheap). */
export function noteMarineActive() {
  if (_xfamDeactivatedAt === null && !_xfamExpiredLogged) return;
  _xfamDeactivatedAt = null;
  _xfamExpiredLogged = false;
}

// TRANSITION-HOLD predicate (2026-07-06, "models not switching fast between GFS/EURO/ICON"):
// a model/layer switch blinks the marine layer INACTIVE during the style transition, and both
// clear sites (the custom layer's per-frame !activeRef edge and the React layer's !active
// effect) threw away all resident GPU state on that blink — forcing a full re-encode plus TWO
// particle resets per switch (clear → reactivate_refeed → data_commit). Live log: Engine-Clear
// dozens of times and ~112 SimLoop field rebinds in one short toggling session. While the
// coordinator (or a queued/debounced fetch) is in flight, deactivation HOLDS the residents:
// nothing renders while inactive, and the reactivation commit replaces them anyway. A real
// toggle-off (no transition in flight) still clears — and a held deactivation that OUTLIVES the
// transition clears on the next frame/effect once the flags drop. Kill: __RAW_DISABLE_CLEAR_HOLD__;
// telemetry: __MARINE_CLEAR_HELD__.
export function shouldHoldClearOnDeactivate() {
  if (typeof window === 'undefined') return false;
  if (window.__RAW_DISABLE_CLEAR_HOLD__ === true) return false;
  const hold = window.__MARINE_TRANSITIONING__ === true ||
    !!window.__MARINE_FETCH_PENDING__ ||
    !!window.__MARINE_FETCH_DEBOUNCING__;
  if (hold) {
    window.__MARINE_CLEAR_HELD__ = (window.__MARINE_CLEAR_HELD__ || 0) + 1;
    return true;
  }
  // CROSS-FAMILY TOGGLE HOLD (audit #27) — see the block comment above noteMarineActive().
  if (window.__RAW_MARINE_XFAM_HOLD_DISABLED__ === true) return false;
  const now = Date.now();
  if (_xfamDeactivatedAt === null) _xfamDeactivatedAt = now;
  if (now - _xfamDeactivatedAt < xfamHoldTtlMs()) {
    window.__MARINE_XFAM_HOLD_COUNT__ = (window.__MARINE_XFAM_HOLD_COUNT__ || 0) + 1;
    return true;
  }
  if (!_xfamExpiredLogged) {
    _xfamExpiredLogged = true;
    recordChurn('xfam_hold_expired', { heldMs: now - _xfamDeactivatedAt });
  }
  return false;
}

// SWITCH-HOLD (2026-07-21, user "switching models and layers is the issue with the clearing"): a
// model/LAYER switch fires the non_renderable_terminal clear (WebGLMarineLayer data-commit effect)
// BEFORE beginTransition sets __MARINE_TRANSITIONING__ — a multi-render effect-ordering race that the
// render-phase beginTransition guard (useMarineOrchestrator) can't win, live-proven: at the clear the
// coordinator _target was still the OLD model/layer and transitioning===false, so isTransitionGuard was
// false and (modelOrLayerChanged ⇒ sameTargetTransient false) fell straight through to the clear → a
// ~875ms blank. The resident GPU texture (_residentWaveTex) is still alive; only _waveData was nulled.
// This predicate makes the hold cover the switch window WITHOUT depending on the flag race: while a
// switch is in progress and a renderable resident is held, HOLD the last-good frame until the new
// target's data commits — BOUNDED by a TTL so a stalled/failed switch can't strand a stale frame, and
// keyed on the target so each distinct switch restarts the clock (consecutive switches always change
// the key, so the clock is self-resetting per switch). Truth-safe: the held frame's DISPLAYED identity
// is unchanged and the infobox/readout parity gate compares displayed-vs-requested identity (never
// recency), so the readout shows the transition, not a mislabel. Kill: __RAW_DISABLE_SWITCH_HOLD__;
// tune: __RAW_SWITCH_HOLD_TTL_MS__; telemetry: __MARINE_SWITCH_HOLD_COUNT__.
// TTL only needs to bridge the sub-second PRE-FLAG race (once beginTransition sets the flags,
// isTransitionGuard owns the hold for the whole fetch). 2s is a conservative bridge for flag latency;
// on a normal switch the new renderable commit replaces the held frame the instant it lands regardless.
// Its only real effect is the stalled/no-coverage switch, where it bridges ~2s then blanks honestly.
const SWITCH_HOLD_TTL_MS_DEFAULT = 2000;
let _switchHoldStartedAt = null;
let _switchHoldTargetKey = null;

export function shouldHoldFrameThroughSwitch(opts, nowMs, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  if (w.__RAW_DISABLE_SWITCH_HOLD__ === true) { _switchHoldStartedAt = null; _switchHoldTargetKey = null; return false; }
  const { hasRenderableResident, modelOrLayerChanged, residentRegionalAtGlobalViewport, targetKey } = opts || {};
  // Only a real switch with a renderable resident that would actually PAINT is worth holding. A regional
  // resident at a global viewport must NOT be held (it renders as a clamped rectangle — the zoom-out
  // bridge owns that case). Any of these ⇒ drop the clock and let the normal path run.
  if (!modelOrLayerChanged || !hasRenderableResident || residentRegionalAtGlobalViewport) {
    _switchHoldStartedAt = null; _switchHoldTargetKey = null; return false;
  }
  const now = (typeof nowMs === 'number') ? nowMs : Date.now();
  const ttl = (typeof w.__RAW_SWITCH_HOLD_TTL_MS__ === 'number') ? Math.max(0, w.__RAW_SWITCH_HOLD_TTL_MS__) : SWITCH_HOLD_TTL_MS_DEFAULT;
  // A new target (or first hold) starts a fresh window; the same target keeps counting.
  if (_switchHoldTargetKey !== targetKey || _switchHoldStartedAt === null) {
    _switchHoldStartedAt = now; _switchHoldTargetKey = targetKey;
  }
  if (now - _switchHoldStartedAt < ttl) {
    w.__MARINE_SWITCH_HOLD_COUNT__ = (w.__MARINE_SWITCH_HOLD_COUNT__ || 0) + 1;
    return true;
  }
  // TTL expired — a genuinely stalled switch. Allow the clear (blank) rather than hold a stale frame forever.
  if (typeof recordChurn === 'function') recordChurn('switch_hold_expired', { targetKey, heldMs: now - _switchHoldStartedAt });
  return false;
}

// Reset the switch-hold clock when a renderable frame commits (belt-and-suspenders: the target-keying
// already self-resets per switch, but an explicit reset on a successful commit guarantees a subsequent
// same-target transient can never inherit a stale clock). Cheap + idempotent.
export function noteMarineRenderableCommit() {
  _switchHoldStartedAt = null;
  _switchHoldTargetKey = null;
}

// STRAND WATCHDOG DECISION (2026-07-22, hunt "model-switch strands at the coarse tier"): a model/layer
// switch calls beginTransition (opens a pending generation) and then fires the switch fetch; the fetcher
// ends the transition ONLY when it reaches dispatch (useMarineDataFetcherCore: the finally's transition-end
// is gated behind `requestId === marineRequestIdRef.current`, and requestId is bumped only at dispatch).
// So ANY of the fetcher's ~10 pre-dispatch early returns (isScrubbing/isCommitting guard, isMoving/isZooming
// + hasValidData, same-target-inflight, cooldown, consecutiveFailures>=3, ...) leaves the transition PENDING
// FOREVER with `__MARINE_FETCH_PENDING__` null — the live-reproduced "fp:null, transition pending" strand:
// the new model never commits and nothing re-drives (locks.isFetching was never set, so the fetcher's own
// stale-lock watchdog can't arm; lastFetchedModelRef was already advanced, so the switch effect won't re-fire).
// At the zoomed-out coarse tier the slow commit/mask-rebuild widens the isCommitting window, so a switch
// clicked mid-commit reliably strands. This pure decision drives a bounded watchdog (in useMarineOrchestrator):
// after a settle window, re-drive the switch fetch ONLY when the strand signature is present, never piling
// onto a healthy in-flight fetch, and give up (settle honestly) after a bounded number of attempts so the
// stuck `transitioning` flag can't wedge residents/gates forever.
//   Returns one of:
//     'superseded'    — no target, or a newer switch replaced ours → nothing to heal.
//     'healed'        — settled, or the displayed frame already IS the target → done.
//     'inflight_wait' — a fetch for THIS target is in flight → it will settle; keep watching, don't pile on.
//     'redrive'       — pending + displayed != target + NO in-flight fetch = the strand → re-drive the fetch.
//     'giveup'        — attempts exhausted → caller settles the stuck transition honestly.
export function decideStrandAction({
  target,
  armedGen,
  displayedMatchesTarget,
  fetchPendingModel,
  attempts,
  maxAttempts = 4,
} = {}) {
  if (!target || target.gen !== armedGen) return 'superseded';
  if (target.status !== 'pending' || displayedMatchesTarget) return 'healed';
  if (typeof attempts === 'number' && attempts >= maxAttempts) return 'giveup';
  if (fetchPendingModel && fetchPendingModel === target.model) return 'inflight_wait';
  return 'redrive';
}

function emit() {
  // Mirror pending status to the legacy global so un-migrated readers keep working.
  if (typeof window !== 'undefined') {
    const pending = !!_target && _target.status === 'pending';
    window.__MARINE_TRANSITIONING__ = pending;
    window.__MARINE_TRANSITION_STATE__ = {
      gen: _target ? _target.gen : 0,
      status: _target ? _target.status : 'idle',
      target: _target ? { model: _target.model, layer: _target.layer, hour: _target.hour, viewportKey: _target.viewportKey } : null,
      displayed: _displayed,
    };
  }
  for (const fn of _subs) {
    try { fn(_target, _displayed); } catch (e) { /* subscriber errors must not break callers */ }
  }
}

/**
 * Open a transition for a new {model, layer} target. Idempotent: if the same
 * {model, layer} transition is already pending, returns the existing generation
 * without bumping it (so render-phase / double-render calls are safe).
 * @returns {number} the generation token the caller must pass to endTransition.
 */
export function beginTransition({ model, layer, hour = null, viewportKey = null } = {}) {
  const key = transitionKey(model, layer);
  if (_target && _target.status === 'pending' && _target.beginKey === key) {
    // Already mid-transition to this exact target; keep the same owner but refresh
    // hour/viewport so diagnostics and the mirrored window state stay current.
    let changed = false;
    if (hour !== null && hour !== _target.hour) { _target.hour = hour; changed = true; }
    if (viewportKey !== null && viewportKey !== _target.viewportKey) { _target.viewportKey = viewportKey; changed = true; }
    if (changed) emit();
    return _target.gen;
  }
  _gen += 1;
  _target = { gen: _gen, beginKey: key, model, layer, hour, viewportKey, status: 'pending' };
  emit();
  return _gen;
}

/**
 * End the transition owned by `gen`. No-op (returns false) if `gen` is not the
 * current generation — i.e. a newer transition has begun, so a stale request
 * cannot end it.
 */
export function endTransition(gen, status = 'settled') {
  if (!_target || gen !== _target.gen) return false;
  if (_target.status === status) return true;
  _target = { ..._target, status };
  emit();
  return true;
}

/** Convenience for the legitimate owner (e.g. synchronous cache-hit path) to end the current transition. */
export function endCurrentTransition(status = 'settled') {
  return _target ? endTransition(_target.gen, status) : false;
}

/** Record the identity of the frame actually rendered to the heatmap. */
export function markDisplayed({ model, layer, hour = null, viewportKey = null } = {}) {
  _displayed = { model, layer, hour, viewportKey };
  emit();
}

export function isTransitioning() {
  return !!_target && _target.status === 'pending';
}

export function getGeneration() {
  return _gen;
}

export function getTarget() {
  return _target;
}

export function getDisplayed() {
  return _displayed;
}

/**
 * True when the frame currently displayed matches a requested identity on
 * model + layer + hour. Used by the infobox parity gate so a grid/forecast
 * fallback is never relabeled as the newly-selected target.
 */
export function displayMatchesRequested({ model, layer, hour } = {}) {
  if (!_displayed) return false;
  if (_displayed.model !== model) return false;
  if (_displayed.layer !== layer) return false;
  // hour is compared only when the caller supplies one (infobox cares about hour).
  if (hour !== undefined && hour !== null && _displayed.hour !== hour) return false;
  return true;
}

/**
 * Record an intentional GPU buffer clear with its reason and the displayed/requested
 * identity at the moment of clearing. Keeps a small ring buffer on window for diagnostics
 * and tests, so every clear is attributable (audit acceptance criterion).
 */
export function recordClear(reason, requested = null) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.__MARINE_CLEAR_LOG__)) window.__MARINE_CLEAR_LOG__ = [];
  const entry = {
    reason,
    gen: _target ? _target.gen : 0,
    transitioning: !!_target && _target.status === 'pending',
    displayed: _displayed,
    requested: requested || (_target ? { model: _target.model, layer: _target.layer, hour: _target.hour } : null),
    timestamp: Date.now(),
  };
  window.__MARINE_CLEAR_LOG__.push(entry);
  if (window.__MARINE_CLEAR_LOG__.length > 50) window.__MARINE_CLEAR_LOG__.shift();
  return entry;
}

/**
 * Churn telemetry (instrumentation-first, no behavior change). Records the events that
 * drive engine/recovery churn during scrub + layer/model toggling so we can fix with
 * evidence instead of guessing. Read `window.__MARINE_CHURN__` in the console:
 *   .counts  → running totals per kind (recovery_grid_commit, engine_init, engine_dispose,
 *              foam_mount, foam_unmount, active_layer_flip, abort)
 *   .log     → last 150 events with {kind, detail, gen, sinceMs, t}
 * Use `window.__MARINE_CHURN_RESET__()` to zero it before a measurement run.
 */
export function recordChurn(kind, detail = {}) {
  if (typeof window === 'undefined') return;
  let c = window.__MARINE_CHURN__;
  if (!c || typeof c !== 'object') {
    c = window.__MARINE_CHURN__ = { counts: {}, log: [], startedAt: Date.now(), _last: 0 };
    window.__MARINE_CHURN_RESET__ = () => { window.__MARINE_CHURN__ = { counts: {}, log: [], startedAt: Date.now(), _last: 0 }; };
  }
  c.counts[kind] = (c.counts[kind] || 0) + 1;
  const now = Date.now();
  const entry = { kind, ...detail, gen: _target ? _target.gen : 0, sinceMs: c._last ? now - c._last : 0, t: now };
  c._last = now;
  c.log.push(entry);
  if (c.log.length > 150) c.log.shift();
  return entry;
}

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

// Test-only reset. Not used in production code paths.
export function __resetForTests() {
  _gen = 0;
  _target = null;
  _displayed = null;
  _xfamDeactivatedAt = null;
  _xfamExpiredLogged = false;
  _switchHoldStartedAt = null;
  _switchHoldTargetKey = null;
  _subs.clear();
  if (typeof window !== 'undefined') {
    window.__MARINE_TRANSITIONING__ = false;
    window.__MARINE_TRANSITION_STATE__ = null;
  }
}
