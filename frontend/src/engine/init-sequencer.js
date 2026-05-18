/**
 * Init Sequencer Deterministic Engine Boot Order
 *
 * GUARANTEES SAFE ORDERED BOOT:
 * idle dom-ready map-ready engine-ready layers-ready complete
 *
 * RULES:
 * - NO import-time side effects (all var/function TDZ-immune)
 *   - NO engine access during render
 *   - NO React coupling
 *   - Engine MUST wait for map-ready before init
 */

// STATE (var = hoisted, TDZ-immune) 
var _state = 'idle';
var _engineReadyResolver = null;
var _mapReadyResolver = null;
var _stateListeners = [];

/**
 * @typedef {'idle'|'dom-ready'|'map-ready'|'engine-ready'|'layers-ready'|'complete'} InitState
 */

/** @returns {InitState} */
export function getInitState() { return _state; }

/** @param {InitState} next */
export function setInitState(next) {
  _state = next;
  _stateListeners.forEach(function(fn) { fn(next); });
}

/** Subscribe to state changes. @returns {function} unsubscribe */
export function onStateChange(fn) {
  _stateListeners.push(fn);
  return function() {
    _stateListeners = _stateListeners.filter(function(f) { return f !== fn; });
  };
}

/** Called AFTER DOM + React mount */
export function markDOMReady() {
  _state = 'dom-ready';
}

/** Called AFTER MapLibre is fully initialized */
export function markMapReady() {
  _state = 'map-ready';
  if (_mapReadyResolver) { _mapReadyResolver(); _mapReadyResolver = null; }
}

/** Engine MUST wait for this before init */
export function waitForMap() {
  if (_state === 'map-ready' || _state === 'engine-ready' ||
      _state === 'layers-ready' || _state === 'complete') {
    return Promise.resolve();
  }
  return new Promise(function(res) { _mapReadyResolver = res; });
}

/** Wait for engine boot to complete */
export function waitForEngineBoot() {
  if (_state === 'engine-ready' || _state === 'layers-ready' ||
      _state === 'complete') {
    return Promise.resolve();
  }
  return new Promise(function(res) { _engineReadyResolver = res; });
}

/** Called ONLY by engine bootstrap AFTER full init */
export function markEngineReady() {
  _state = 'engine-ready';
  if (_engineReadyResolver) { _engineReadyResolver(); _engineReadyResolver = null; }
}

/** Mark layers initialized */
export function markLayersReady() {
  _state = 'layers-ready';
}

/** Mark boot complete */
export function markComplete() {
  _state = 'complete';
}

/**
 * HARD SAFETY CHECK throws if engine tries to init too early.
 * Prevents the class of "Cannot access X before initialization" crashes.
 */
export function assertSafeToInitEngine() {
  if (_state !== 'map-ready') {
    throw new Error('[InitSequencer] Engine init blocked. State=' + _state +
      '. Engine can only init after map-ready.');
  }
}
