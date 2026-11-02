/** Synthetic correlation only. No URLs, headers, body vectors or raw errors in events. */
const { randomUUID } = require('node:crypto');
const HEADER = 'x-rawsurf-synthetic-request-id';
const IDS = new WeakMap();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value);
function requestIdFor(request) {
  if (!IDS.has(request)) IDS.set(request, randomUUID());
  return IDS.get(request);
}
function errorKind(error) {
  const message = String(error?.message || '');
  if (/ECONNRESET/.test(message)) return 'transport_reset';
  // Playwright 1.60 disposes the request client with this exact normal teardown reason.
  if (message === 'Test ended.' || message === 'route.fetch: Test ended.') return 'page_or_context_closed';
  if (/has been closed|Target closed|disposed/i.test(message)) return 'page_or_context_closed';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  return 'other';
}
function requestMetadata(url) {
  const q = url.searchParams, result = {};
  for (const [key, values] of [['model', ['GFS', 'ICON', 'EURO']], ['domain', ['marine', 'atmosphere']],
    ['layer', ['waves', 'swell_1', 'swell_2', 'wind_waves', 'wind']]]) {
    if (values.includes(q.get(key))) result[key] = q.get(key);
  }
  const rawHours = q.get('hours') || '';
  if (/^\d+(,\d+)*$/.test(rawHours)) {
    const hours = [...new Set(rawHours.split(',').map(Number))].sort((a, b) => a - b);
    if (hours.length <= 48 && hours.every(h => h <= 1000)) result.requested_hours = hours;
  }
  const bbox = (q.get('bbox') || '').split(',').map(Number);
  if (bbox.length === 4 && bbox.every(x => Number.isFinite(x) && Math.abs(x) <= 360)) result.bbox = bbox;
  if (['0', '1'].includes(q.get('surf'))) result.surf = q.get('surf') === '1';
  const base = Date.parse(q.get('base_time') || '');
  if (Number.isFinite(base)) result.base_time = new Date(base).toISOString();
  return result;
}
function createSeriesDiagnostics(meta, emit = line => console.log(line)) {
  const context = { project: String(meta.project || '').slice(0, 64),
    test: String(meta.test || '').slice(0, 512), retry: Number.isInteger(meta.retry) ? meta.retry : 0 };
  return {
    begin(request, url) {
      const id = requestIdFor(request), start = process.hrtime.bigint();
      const fields = requestMetadata(url);
      const trace = { id, event(event, extra = {}) {
        try {
          emit('[SYNTHETIC SERIES] ' + JSON.stringify({ schema: 1, event, request_id: id,
            at: new Date().toISOString(), monotonic_ns: String(process.hrtime.bigint()),
            request_elapsed_ms: Number(process.hrtime.bigint() - start) / 1e6,
            ...context, request: fields, ...extra }));
        } catch { /* Observations cannot replace a route outcome. */ }
      } };
      trace.event('fetch_start');
      return trace;
    },
  };
}
module.exports = { HEADER, validId, requestIdFor, errorKind, requestMetadata, createSeriesDiagnostics };
