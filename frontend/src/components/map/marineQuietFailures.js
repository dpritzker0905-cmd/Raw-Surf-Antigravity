/**
 * marineQuietFailures.js — D12 (2026-10-28; the lead's offline erratic fuzzer at 4bd90d0d9).
 *
 * 1. INTENTIONAL ABORTS ARE NOT ERRORS. A newer ask cancels the one in flight on every scrub step, pan and model/layer switch, and three
 *    fetch paths logged that cancel with console.error (the fuzzer counted over 100 per batch; in six seeded sequences offline the top
 *    console error was "Grid fetch error: signal is aborted without reason", then the ICON extended point's AbortError and the wind
 *    grid's). A console.error is what the fuzzer, WeatherTelemetry's interceptor (a false "model_error" in the Diagnostics HUD, the note in
 *    backendCopernicusServiceClient) and a person reading the console treat as a fault, so a real failure hid among them. An abort is
 *    logged at debug; anything else stays an error. Kill: window.__RAW_DISABLE_ABORT_LOG_DOWNGRADE__ = true.
 * 2. A MAP THAT IS GONE IS NOT ASKED FOR ITS LAYERS. MapLibre's map.getLayer reads map.style, which is null once the map is removed
 *    (the fuzzer's page error, Wind on plus a WebGL context loss: "Cannot read properties of null (reading 'getLayer')" from
 *    OceanMask's deferred hide). OceanMask's timers and frame callbacks ask maskMapGone first. Kill:
 *    window.__RAW_DISABLE_MASK_MAP_GONE_GUARD__ = true.
 */
const W = () => (typeof window !== 'undefined' ? window : {});

export function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || /\babort/i.test(String(err.message || '')));
}

/** console.error(message, ...extra) for a failure, console.debug for an abort of `err`. Returns which one it used. Never throws. */
export function logFetchFailure(err, message, ...extra) {
  try {
    if (isAbortError(err) && W().__RAW_DISABLE_ABORT_LOG_DOWNGRADE__ !== true) {
      console.debug(`${message} (aborted: a newer request replaced it)`);
      return 'debug';
    }
    console.error(message, ...extra);
    return 'error';
  } catch (e) { return 'error'; }
}

/** True when `map` can no longer be asked for its style or layers (removed, or never had a style). */
export function maskMapGone(map) {
  if (W().__RAW_DISABLE_MASK_MAP_GONE_GUARD__ === true) return false;
  try { return !map || !map.style || map._removed === true; } catch (e) { return true; }
}
