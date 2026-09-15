// Retain the originating exception before console/recorder wrappers can obscure it.
// Fixed-size, engine-local evidence; no automatic network transport or sampling.
function errorText(error, key, fallback) {
  try { return String(error?.[key] ?? fallback).slice(0, 4096); }
  catch (_) { return '[unreadable exception]'; }
}

export function recordMaskRefreshFailure(engine, scope, error) {
  const failure = { at: new Date().toISOString(), scope,
    name: errorText(error, 'name', 'Error'), message: errorText(error, 'message', error),
    stack: errorText(error, 'stack', '').split('\n').slice(0, 8).join('\n') };
  const previous = engine._maskRefreshFailures;
  engine._maskRefreshFailures = { count: (previous?.count || 0) + 1,
    first: previous?.first || failure, latest: failure };
  try {
    console.warn(`[WebGLMarineEngine] ${scope} mask refresh skipped:`, failure.message, failure.stack);
  } catch (_) { /* Reporting must not turn a recoverable refresh into a thrown failure. */ }
}
