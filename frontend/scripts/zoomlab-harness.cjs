/** Synthetic badge isolation and strict browser prerequisites for the marine instrument. */
async function stubZoomlabMessageBadge(page, backendOrigin) {
  const origin = new URL(backendOrigin || process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
  const pathname = '/api/messages/unread-counts/dev-mock-user-id';
  let fulfilled = 0;
  await page.route(url => url.origin === origin && url.pathname === pathname, route => {
    const request = route.request();
    // Public dummy marker from AuthContext's dev-only synthetic session, never a real credential.
    if (request.method() !== 'GET' || request.headers().authorization !== 'Bearer dev-mock-user-token') return route.fallback();
    return route.fulfill({
      json: { total: 0, primary: 0, requests: 0, grom_zone: 0 },
      headers: { 'x-rawsurf-zoomlab-fixture': 'synthetic-message-badge' },
    }).then(() => { fulfilled += 1; });
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
  if (path !== '/map') {
    const route = ['/auth', '/feed'].includes(path) ? path : 'other';
    throw new Error('ZOOMLAB_INSTRUMENT_UNEXPECTED_ROUTE:' + route);
  }
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

async function waitForMarineReady(page, timeout = 60000) {
  try {
    await page.waitForFunction(marineReadyPredicate, null, { timeout });
  } catch (error) {
    if (error.name !== 'TimeoutError' && !error.message.includes('ZOOMLAB_INSTRUMENT_UNEXPECTED_ROUTE:')) throw error;
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
    await page.waitForFunction(`(() => { (${marineReadyPredicate.toString()})(); return (${findWavesControl.toString()})() !== null; })()`, null, { timeout });
  } catch (error) {
    if (error.name !== 'TimeoutError' && !error.message.includes('ZOOMLAB_INSTRUMENT_UNEXPECTED_ROUTE:')) throw error;
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
