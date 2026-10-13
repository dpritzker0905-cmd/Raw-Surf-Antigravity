// openMeteoProtocolFailure.js — what happens when the Open-Meteo protocol never registers.
//
// F-15 (audit 14.0, 2026-09-21). `registerOpenMeteoProtocol` does all of its work inside
// `import('@openmeteo/weather-map-layer').then(cb)`, and `cb` runs ~400 lines before reaching
// `setProtocolReady(true)` at its very last statement. That chain had NO `.catch`. So ANY throw
// anywhere in it — a chunk-load failure, an upstream API change, a bad colour-scale assign —
// left `protocolReady === false` forever, and `MapWebGL.js`'s slot factory is gated on exactly
// that flag:
//
//     return protocolReady && Object.keys(LAYER_REGISTRY).filter(…)   // false ⇒ renders NOTHING
//
// ⇒ **rain, satellite, pressure, temperature, water_temp and fog all mount ZERO sources and
// render blank**, with no error reaching the user, nothing in telemetry, and nothing in the
// truth HUD saying why. The app's own diagnostic made it worse rather than better: `getLayerTruth`
// reports a raster layer that is not visible as **"LOADING"**, so a permanently dead protocol
// read as a load that had not finished yet — forever.
//
// ⭐⭐⭐ THE CLASS. This is the repo's recurring "absence encoded as silence" shape, here at a
// six-layer blast radius, and it is the SAME SIGNATURE F-13 spent a day diagnosing (six blank
// rasters, no stated reason). That is the argument for this module: not that the throw is likely,
// but that if it ever happens the cause would be invisible in exactly the way that already cost a
// day. A failure that cannot be read is indistinguishable from a feature that is merely slow.
//
// ⚠️ SCOPE, STATED HONESTLY. F-15 was filed SUSPECTED-BY-CONSTRUCTION, NOT OBSERVED: the missing
// `.catch` and the gate it feeds are proven by reading the code; no live throw was ever produced.
// So this module changes NOTHING on the success path — it is reachable only from the new `.catch`.
// Do not read its existence as evidence that any past blank layer was caused this way.
//
// WHY `protocolReady` STAYS FALSE ON FAILURE. Flipping it true so the slots mount "and fail
// visibly" would be worse: without a registered `om://` handler every slot URL is unresolvable, so
// the map would fill with broken sources instead of empty ones, and the real cause would be even
// further from the symptom. The fix is to make the emptiness LEGIBLE, not to manufacture noise.

import { WeatherTelemetry } from './WeatherTelemetry';

export const OM_PROTOCOL_FAILURE_EVENT = 'raw:om-protocol-failed';

// The six layers that go dark together when registration fails — used by the disclosure copy.
// Verified against LAYER_REGISTRY rather than recalled: these are exactly the entries with
// `type: 'raster'` AND an `omVariable`, which is the pair `MapWebGL.js`'s slot factory filters on.
// ⚠️ NOT the whole blast radius, and the copy deliberately does not claim it is: waves / swell_1 /
// swell_2 / wind_waves also carry an `omVariable` and mount slots through the SAME factory when
// `webglMarineFailed` is set. They are omitted because on the normal path marine renders through
// the WebGL engine and is unaffected — naming them would over-report in the common case.
export const OM_PROTOCOL_DEPENDENT_LAYERS = Object.freeze([
  'rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog',
]);

// Module-level rather than window-level so the record survives in non-browser test environments
// and so a reader cannot be fooled by a window that was replaced between frames. The window
// mirror below is the FORENSIC copy, for reading live from a console during an incident.
let _failure = null;

function _win() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * Record a fatal Open-Meteo protocol registration failure.
 *
 * Deliberately total: every step is independently try/caught, because this runs on the path where
 * something has ALREADY gone wrong. A disclosure mechanism that can itself throw would convert a
 * legible failure back into a silent one — which is the entire defect it exists to prevent.
 *
 * @param {Error} err            the real error, never a summary of it
 * @param {Function} [setProtocolReady] the React setter; called with `false` so a late success
 *                                      can never leave a stale `true` behind it
 * @returns {object} the recorded failure
 */
export function reportProtocolRegistrationFailure(err, setProtocolReady) {
  const record = {
    message: (err && err.message) || String(err),
    name: (err && err.name) || 'Error',
    stack: (err && err.stack) || null,
    at: new Date().toISOString(),
    layers: OM_PROTOCOL_DEPENDENT_LAYERS,
  };
  _failure = record;

  // 1. LOG THE REAL ERROR. Not `err.message` alone: the stack is what distinguishes a chunk-load
  //    failure from a colour-scale assign, and those have opposite repairs.
  try {
    console.error(
      '[OM-Protocol] FATAL: registration failed — every forecast raster layer '
      + `(${OM_PROTOCOL_DEPENDENT_LAYERS.join(', ')}) will render blank until this is fixed.`,
      err,
    );
  } catch (e) { /* a broken console must not swallow the rest */ }

  // 2. TELEMETRY. `model_error` rather than `model_warning`: nothing recovers from this state, and
  //    the two are filtered differently downstream.
  try {
    WeatherTelemetry.trackModelError('ALL', 'om_protocol_registration_failed', record);
  } catch (e) { /* telemetry is never load-bearing */ }

  // 3. FORENSIC GLOBAL, for reading live during an incident without a rebuild — the same idiom as
  //    `__OM_PROTOCOL_SETTINGS__` / `__DECODED_OM_TILES__`, which is where an investigator looks.
  try {
    const w = _win();
    if (w) w.__OM_PROTOCOL_FAILURE__ = record;
  } catch (e) { /* ignore */ }

  // 4. TELL THE UI. A DOM event rather than an import: the protocol layer must not depend on a
  //    React surface, and more than one surface may want to disclose this.
  try {
    const w = _win();
    if (w && typeof w.dispatchEvent === 'function' && typeof w.CustomEvent === 'function') {
      w.dispatchEvent(new w.CustomEvent(OM_PROTOCOL_FAILURE_EVENT, { detail: record }));
    }
  } catch (e) { /* ignore */ }

  // 5. PIN THE GATE FALSE. Belt and braces — the flag is already false here, but saying so
  //    explicitly means a future reordering cannot leave a half-registered protocol reading ready.
  try {
    if (typeof setProtocolReady === 'function') setProtocolReady(false);
  } catch (e) { /* ignore */ }

  return record;
}

/** The recorded failure, or null. Null means "no failure recorded", never "everything is fine". */
export function getOpenMeteoProtocolFailure() {
  return _failure;
}

/** True when the Open-Meteo raster protocol is known-dead. */
export function isOpenMeteoProtocolFailed() {
  return _failure !== null;
}

/**
 * Subscribe to the failure. Fires at most once per listener, and fires IMMEDIATELY if the failure
 * already happened — registration and failure race, and a listener that mounts late must not miss
 * the only event it will ever get. That race is the reason this is not a bare `addEventListener`.
 *
 * @returns {Function} unsubscribe
 */
export function subscribeToProtocolFailure(cb) {
  if (typeof cb !== 'function') return () => {};
  let done = false;
  const fire = (record) => {
    if (done) return;
    done = true;
    try { cb(record); } catch (e) { /* a bad listener must not break the others */ }
  };
  if (_failure) { fire(_failure); return () => { done = true; }; }
  const w = _win();
  if (!w || typeof w.addEventListener !== 'function') return () => {};
  const handler = (ev) => fire((ev && ev.detail) || _failure);
  w.addEventListener(OM_PROTOCOL_FAILURE_EVENT, handler);
  return () => {
    done = true;
    try { w.removeEventListener(OM_PROTOCOL_FAILURE_EVENT, handler); } catch (e) { /* ignore */ }
  };
}

/** Test-only reset. Named so it can never be mistaken for production recovery — there is none. */
export function _resetProtocolFailureForTest() {
  _failure = null;
  try {
    const w = _win();
    if (w) delete w.__OM_PROTOCOL_FAILURE__;
  } catch (e) { /* ignore */ }
}
