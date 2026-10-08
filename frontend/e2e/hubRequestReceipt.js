// Persist only allowlisted facts. Never retain URLs, headers, bodies, tokens or errors.
const { performance } = require('node:perf_hooks');

function observeHubRequests(page) {
  const entries = [];
  const requests = new Map();
  const classify = request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/explore\/spot-details\/[^/]+$/.test(path)) return 'details';
    if (path === '/api/conditions/batch') return 'batch';
    if (/^\/api\/condition-reports\/spot\/[^/]+$/.test(path)) return 'reports';
    if (/^\/api\/posts\/spot\/[^/]+$/.test(path)) return 'posts';
    return null;
  };
  const onRequest = request => {
    const endpoint = classify(request);
    if (!endpoint || entries.length >= 64) return;
    const entry = { endpoint, state: 'pending', status: null, started: performance.now() };
    entries.push(entry);
    requests.set(request, entry);
  };
  const onResponse = response => {
    const entry = requests.get(response.request());
    if (entry) entry.status = response.status();
  };
  const finish = state => request => {
    const entry = requests.get(request);
    if (entry) {
      entry.state = state;
      entry.elapsedMs = Math.round(performance.now() - entry.started);
    }
  };
  const onFinished = finish('finished'), onFailed = finish('failed');
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  return () => {
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfinished', onFinished);
    page.off('requestfailed', onFailed);
    return entries.map(({ started, ...entry }) => ({ ...entry,
      elapsedMs: entry.elapsedMs ?? Math.round(performance.now() - started) }));
  };
}

module.exports = { observeHubRequests };
