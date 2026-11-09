/** Synthetic badge isolation and strict browser prerequisites for the marine instrument. */
// The dev-only synthetic session (AuthContext: id dev-mock-user-id, token dev-mock-user-token) is a PUBLIC dummy, never a credential.
// The live backend binds personal reads to the caller's JWT (#496, 2026-10-23), so it answers that dummy with 401 and apiClient's
// handleRefusedSession sends the tab to /auth: every Marine Nightly from 2026-10-24 to 2026-11-09 died there. Each fixture below
// is EXACT (GET, path, mock token) and neutral; anything else passes through, and refusals of the mock token are recorded by path.
const MOCK_USER = 'dev-mock-user-id';
const MOCK_AUTH = 'Bearer dev-mock-user-token';
const SESSION_FIXTURES = [
  { path: `/api/messages/unread-counts/${MOCK_USER}`, label: 'synthetic-message-badge',
    json: { total: 0, primary: 0, requests: 0, grom_zone: 0 } },
  { path: `/api/compliance/tos-status/${MOCK_USER}`, label: 'synthetic-tos-status',   // TosReacceptanceGate
    json: { acknowledged: true } },
  { path: `/api/compliance/violations/user/${MOCK_USER}`, label: 'synthetic-violations', // ViolationBanner
    json: { violations: [], is_suspended: false, is_banned: false } },
];

async function stubZoomlabMessageBadge(page, backendOrigin) {
  const origin = new URL(backendOrigin || process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
  const byPath = new Map(SESSION_FIXTURES.map(f => [f.path, f]));
  const counts = Object.fromEntries(SESSION_FIXTURES.map(f => [f.label, 0]));
  const refused = [];
  await page.route(url => url.origin === origin && byPath.has(url.pathname), route => {
    const request = route.request();
    if (request.method() !== 'GET' || request.headers().authorization !== MOCK_AUTH) return route.fallback();
    const fixture = byPath.get(new URL(request.url()).pathname);
    return route.fulfill({ json: fixture.json, headers: { 'x-rawsurf-zoomlab-fixture': fixture.label } })
      .then(() => { counts[fixture.label] += 1; });
  });
  // Evidence, not a fix: any OTHER request carrying the dummy token that the live backend refuses, by path (dummy id only).
  if (typeof page.on === 'function') {
    page.on('response', response => {
      try {
        const request = response.request();
        const url = new URL(response.url());
        if (url.origin !== origin || response.status() !== 401 || request.headers().authorization !== MOCK_AUTH) return;
        if (refused.length < 20) refused.push(`${request.method()} ${url.pathname}`);
      } catch (e) { /* evidence only */ }
    });
  }
  const fulfilled = () => counts['synthetic-message-badge'];
  fulfilled.counts = () => ({ ...counts });
  fulfilled.refused = () => [...refused];
  return fulfilled;
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
