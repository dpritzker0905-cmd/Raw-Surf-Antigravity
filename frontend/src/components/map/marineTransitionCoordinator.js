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

let _gen = 0;          // monotonic transitionId
let _target = null;    // { gen, beginKey, model, layer, hour, viewportKey, status }
let _displayed = null; // { model, layer, hour, viewportKey } — last frame actually shown
const _subs = new Set();

const transitionKey = (model, layer) => `${model ?? ''}|${layer ?? ''}`;

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

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

// Test-only reset. Not used in production code paths.
export function __resetForTests() {
  _gen = 0;
  _target = null;
  _displayed = null;
  _subs.clear();
  if (typeof window !== 'undefined') {
    window.__MARINE_TRANSITIONING__ = false;
    window.__MARINE_TRANSITION_STATE__ = null;
  }
}
