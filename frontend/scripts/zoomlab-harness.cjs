/** Synthetic incidental reads and strict browser prerequisites for the marine instrument. */
async function stubZoomlabMessageBadge(page, backendOrigin) {
  const origin = new URL(backendOrigin || process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
  const userId = 'dev-mock-user-id';
  const messagePath = `/api/messages/unread-counts/${userId}`;
  // App navigation reads are incidental to the marine instrument. This fictional
  // development session cannot authenticate against their deployed protected APIs.
  const fixtures = new Map([
    [messagePath, { name: 'message-badge', json: { total: 0, primary: 0, requests: 0, grom_zone: 0 } }],
    [`/api/notifications/${userId}/unread-count`, { name: 'notification-badge', json: { unread_count: 0 } }],
    [`/api/dispatch/user/${userId}/active`, { name: 'active-session', json: { active_dispatch: null } }],
    [`/api/compliance/violations/user/${userId}`, { name: 'violations',
      json: { user_id: userId, total_strikes: 0, is_suspended: false, is_banned: false,
        suspension_until: null, violations: [] } }],
  ]);
  // Preserve the driver's existing message-badge receipt; other reads do not count as messages.
  let fulfilled = 0;
  await page.route(url => url.origin === origin && fixtures.has(url.pathname), route => {
    const request = route.request();
    const url = new URL(request.url());
    const fixture = fixtures.get(url.pathname);
    // Public dummy marker from AuthContext's dev-only synthetic session, never a real credential.
    if (url.origin !== origin || !fixture || request.method() !== 'GET'
        || request.headers().authorization !== 'Bearer dev-mock-user-token') return route.fallback();
    return route.fulfill({
      json: fixture.json,
      headers: { 'x-rawsurf-zoomlab-fixture': `synthetic-${fixture.name}` },
    }).then(() => { if (url.pathname === messagePath) fulfilled += 1; });
  });
  return () => fulfilled;
}

// Browser-evaluated functions are self-contained. Never retain private URL paths or user data.
function marinePageState(camera) {
  const path = window.location.pathname;
  const route = ['/map', '/auth', '/feed'].includes(path) ? path : 'other';
  const mapReady = typeof window.map?.jumpTo === 'function';
  const marineReady = !!window.__MARINE_ENGINE__;
  const reason = path !== '/map' ? 'unexpected-route' : !mapReady ? 'map-unavailable' : !marineReady ? 'marine-unavailable' : null;
  if (!reason && camera) window.map.jumpTo(camera);
  return { route, mapReady, marineReady, reason };
}

function marineReadyPredicate() {
  const path = window.location.pathname;
  // Settle the browser poll on route loss; requireMarinePage rejects it on the Node side.
  // Throwing here can surface our own diagnostic as an uncaught application error.
  if (path !== '/map') return {
    route: ['/auth', '/feed'].includes(path) ? path : 'other',
    mapReady: typeof window.map?.jumpTo === 'function', marineReady: !!window.__MARINE_ENGINE__,
    reason: 'unexpected-route',
  };
  return typeof window.map?.jumpTo === 'function' && !!window.__MARINE_ENGINE__;
}

class ZoomlabInstrumentError extends Error {
  constructor(reason, state) {
    super(`ZOOMLAB_INSTRUMENT ${reason} (route=${state.route})`);
    this.name = 'ZoomlabInstrumentError';
    this.code = reason;
    this.state = state;
  }
}

async function requireMarinePage(page, camera) {
  const state = await page.evaluate(marinePageState, camera);
  if (state.reason) throw new ZoomlabInstrumentError(state.reason, state);
  return state;
}

async function requirePollRoute(handle) {
  try {
    const state = await handle.jsonValue();
    // Preserve the poll's terminal observation even if navigation recovers before Node checks.
    if (state && state.reason === 'unexpected-route') throw new ZoomlabInstrumentError(state.reason, state);
  } finally {
    await handle.dispose();
  }
}

async function waitForMarineReady(page, timeout = 60000) {
  try {
    await requirePollRoute(await page.waitForFunction(marineReadyPredicate, null, { timeout }));
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    const state = await page.evaluate(marinePageState);
    throw new ZoomlabInstrumentError(state.reason || 'readiness-timeout', state);
  }
  return requireMarinePage(page);
}

function findWavesControl() {
  if (window.location.pathname !== '/map') return null;
  const all = Array.from(document.querySelectorAll('button'));
  const button = all.find(b => ['true', 'false'].includes(b.getAttribute('aria-pressed')) &&
    (b.title || b.getAttribute('aria-label') || b.textContent || '').trim() === 'Waves');
  if (button) return button;
  const expander = all.find(b => /weather controls/i.test((b.getAttribute('aria-label') || '') + (b.title || '')) &&
    !/collapse/i.test((b.getAttribute('aria-label') || '') + (b.title || '')));
  if (expander) expander.click();
  return null;
}

async function waitForWavesControl(page, timeout = 45000) {
  await requireMarinePage(page);
  try {
    await requirePollRoute(await page.waitForFunction(`(() => {
      const state = (${marineReadyPredicate.toString()})();
      if (state && state.reason === 'unexpected-route') return state;
      return state && (${findWavesControl.toString()})() !== null;
    })()`, null, { timeout }));
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    const state = await page.evaluate(marinePageState);
    throw new ZoomlabInstrumentError(state.reason || 'waves-control-unavailable', state);
  }
  await requireMarinePage(page);
}

function instrumentFailureReport(error, scenario, fixtureCount, consoleErrors = []) {
  const retainedErrors = [...new Set(consoleErrors)];
  const { verdict } = require('./zoomlab-verdict').analyzeTrace({ scenario, completed: false, consoleErrors: retainedErrors });
  return { scenario, completed: false, verdict, kind: 'instrument', consoleErrors: retainedErrors,
    code: error.code, readiness: error.state,
    syntheticMessageBadge: { user: 'dev-mock-user-id', fulfilled: fixtureCount } };
}

module.exports = { stubZoomlabMessageBadge, marinePageState, marineReadyPredicate,
  ZoomlabInstrumentError, requireMarinePage, waitForMarineReady, findWavesControl,
  waitForWavesControl, instrumentFailureReport };
