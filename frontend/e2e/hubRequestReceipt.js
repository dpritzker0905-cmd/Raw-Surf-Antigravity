// Persist only allowlisted facts. Never retain URLs, headers, bodies, tokens or errors.
const { performance } = require('node:perf_hooks');

function observeHubRequests(page) {
  const entries = [];
  const requests = new Map();
  const backendOrigin = new URL(process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
  const originCategory = request => {
    const origin = new URL(request.url()).origin;
    if (origin === backendOrigin) return 'backend';
    if (typeof page.url === 'function' && origin === new URL(page.url()).origin) return 'frontend';
    return 'other';
  };
  const classify = request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/explore\/spot-details\/[^/]+$/.test(path)) return 'details';
    if (path === '/api/conditions/batch') return 'batch';
    if (/^\/api\/condition-reports\/spot\/[^/]+$/.test(path)) return 'reports';
    if (/^\/api\/posts\/spot\/[^/]+$/.test(path)) return 'posts';
    if (/^\/api\/messages\/unread-counts\/[^/]+$/.test(path)) return 'message-badge';
    if (/^\/api\/profiles\/[^/]+$/.test(path)) return 'profile';
    if (/^\/api\/sessions\//.test(path)) return 'session';
    if (/^\/api\/dispatch\/user\/[^/]+\/active$/.test(path)) return 'active-session';
    if (/^\/api\/notifications(?:\/|$)/.test(path)) return 'notification';
    if (/^\/api\/surf-spots\/[^/]+\/live-shooting-pulse$/.test(path)) return 'spot-pulse';
    if (/^\/api\/compliance\/violations\/user\/[^/]+$/.test(path)) return 'account-notice';
    const root = path.split('/')[2];
    if (path.startsWith('/api/') && ['auth', 'bookings', 'conditions', 'explore', 'photographer',
      'compliance', 'push', 'hashtags', 'waves', 'tos', 'livekit'].includes(root)) return `family-${root}`;
    return null;
  };
  const onRequest = request => {
    const endpoint = classify(request);
    if (!endpoint || entries.length >= 64) return;
    const entry = { endpoint, origin: originCategory(request), timing: 'request-to-finish',
      state: 'pending', status: null, started: performance.now() };
    entries.push(entry);
    requests.set(request, entry);
  };
  const onResponse = response => {
    const request = response.request();
    let entry = requests.get(request);
    // Capture an otherwise unobserved 401 without retaining its URL or guessing its cause.
    if (!entry && response.status() === 401 && entries.length < 64) {
      entry = { endpoint: classify(request) || 'other-unauthorized', origin: originCategory(request), state: 'pending',
        timing: 'response-to-finish', status: null, started: performance.now() };
      entries.push(entry);
      requests.set(request, entry);
    }
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
