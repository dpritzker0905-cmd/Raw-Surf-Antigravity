/** Bounded observer-side request evidence; never retain private paths, queries or headers. */
const { randomUUID } = require('crypto');
const RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'script',
  'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other']);
const ROUTES = [
  [/^\/api\/explore\/spot-details\/[^/]+\/?$/, 'spot-details'],
  [/^\/api\/weather\/grid\/?$/, 'weather-grid'],
  [/^\/api\/weather\/grid[-_]series\/?$/, 'weather-grid-series'],
  [/^\/api\/conditions\/batch\/?$/, 'conditions-batch'],
  [/^\/api\/condition-reports(?:\/|$)/, 'condition-reports'],
  [/\/latest\.json$/, 'weather-manifest'],
];
function identify(request) {
  let origin = null, route = null, resourceType = 'other';
  try {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin.length <= 300) {
      origin = url.origin;
      route = ROUTES.find(([pattern]) => pattern.test(url.pathname))?.[1] || null;
    }
    const type = request.resourceType();
    if (RESOURCE_TYPES.has(type)) resourceType = type;
  } catch (_) { /* Attribution that cannot be read remains unknown. */ }
  return { origin, route, resourceType };
}
function utc(ms) {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}
function attachNetworkEvidence(page, options = {}) {
  if (typeof options === 'number') options = { limit: options }; // Original numeric API.
  const { limit = 200, pendingLimit = 1000, slowMs = 1000,
    now = () => ({ utcMs: Date.now(), monoMs: performance.now() }) } = options;
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000
      || !Number.isInteger(pendingLimit) || pendingLimit < 1 || pendingLimit > 2000
      || !Number.isFinite(slowMs) || slowMs < 0) throw new RangeError('Invalid evidence bounds');
  const requests = [], pending = new Map();
  const captureId = randomUUID(); // Request IDs are scoped to this capture, not server trace IDs.
  const totals = { started: 0, finished: 0, failed: 0, httpErrors: 0, slow: 0, unattributedTerminals: 0 };
  let sequence = 0, dropped = 0, trackingDropped = 0, phase = 'capture', stopped = false, stoppedAt;
  const metadata = (request, start) => ({ ...identify(request), requestId: `r${++sequence}`,
    start, startedPhase: start ? phase : null, status: null });
  function record(entry, end, outcome, errorCode = null) {
    const elapsed = entry.start ? end.monoMs - entry.start.monoMs : null;
    return { requestId: entry.requestId, origin: entry.origin, route: entry.route,
      resourceType: entry.resourceType, outcome, status: entry.status, errorCode,
      startedAtUTC: entry.start ? utc(entry.start.utcMs) : null,
      observedAtUTC: utc(end.utcMs), durationMs: Number.isFinite(elapsed) && elapsed >= 0
        ? Math.round(elapsed * 1000) / 1000 : null,
      durationBasis: 'observer-monotonic', startedPhase: entry.startedPhase, finishedPhase: phase };
  }
  function started(request) {
    totals.started++;
    if (pending.size >= pendingLimit) { trackingDropped++; return; }
    pending.set(request, metadata(request, now()));
  }
  function responseReceived(response) {
    const entry = pending.get(response.request());
    const status = response.status();
    if (entry && Number.isInteger(status) && status >= 100 && status <= 599) entry.status = status;
  }
  function ended(request, failed) {
    let entry = pending.get(request);
    if (!entry) { totals.unattributedTerminals++; entry = metadata(request, null); }
    pending.delete(request);
    totals[failed ? 'failed' : 'finished']++;
    const result = record(entry, now(), failed ? 'failed' : 'finished');
    if (failed) {
      let error = '';
      try { error = request.failure()?.errorText || ''; } catch (_) { /* Unknown stays unknown. */ }
      result.errorCode = typeof error === 'string'
        ? error.match(/\bnet::ERR_[A-Z_]{1,64}\b/)?.[0] || 'UNKNOWN' : 'UNKNOWN';
    }
    if (result.status >= 400) {
      totals.httpErrors++;
      if (!failed) result.outcome = 'http-error';
    } else if (!failed && result.durationMs !== null && result.durationMs >= slowMs) {
      totals.slow++;
      result.outcome = 'slow';
    }
    // Fast successful requests cannot exhaust the diagnostic record budget.
    if (result.outcome !== 'finished') {
      if (requests.length < limit) requests.push(result);
      else dropped++;
    }
  }
  const handlers = { request: started, response: responseReceived,
    requestfinished: request => ended(request, false), requestfailed: request => ended(request, true) };
  for (const [event, handler] of Object.entries(handlers)) page.on(event, handler);
  const snapshot = () => ({ version: 2, captureId, phase, stopped, dropped, trackingDropped,
    totals: { ...totals }, requests: requests.map(r => ({ ...r })),
    pending: [...pending.values()].map(entry => record(entry, stoppedAt || now(), 'incomplete')) });
  snapshot.beginTeardown = () => { if (!stopped) phase = 'teardown'; };
  snapshot.stop = () => {
    if (stopped) return;
    stoppedAt = now(); stopped = true;
    for (const [event, handler] of Object.entries(handlers)) page.off(event, handler);
  };
  return snapshot;
}

/** Save a sidecar even when navigation, the scenario, or browser cleanup fails. */
async function runWithNetworkEvidence(page, { run, close, save, recorderOptions }) {
  const snapshot = attachNetworkEvidence(page, recorderOptions);
  let result, runError, closeError, saveError;
  let scenarioCompleted = false, contextClosed = false, saved = false;
  try { result = await run(snapshot); scenarioCompleted = true; } catch (error) { runError = error; }
  snapshot.beginTeardown();
  try { await close(); contextClosed = true; } catch (error) { closeError = error; }
  snapshot.stop();
  try { await save({ ...snapshot(), completion: { scenarioCompleted, contextClosed } }); saved = true; }
  catch (error) { saveError = error; }
  // Cleanup must not replace the actual scenario failure with a secondary exception.
  if (!scenarioCompleted) throw runError;
  if (!contextClosed) throw closeError;
  if (!saved) throw saveError;
  return result;
}
module.exports = { attachNetworkEvidence, runWithNetworkEvidence };
