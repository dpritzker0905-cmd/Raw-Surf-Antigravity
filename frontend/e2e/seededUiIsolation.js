/**
 * Runner-only isolation for tokenless synthetic UI sessions. Install before any page,
 * only alongside the loopback weather fixture, with service workers blocked by the caller.
 * Real auth, public gates, Explore/SpotHub reads and the weather route remain outside this policy.
 * No server connection is opened by a socket handler. Receipts never include query/header/storage values.
 */
const { URL } = require('node:url');
const { createRouteLifecycle } = require('../scripts/offline-backend/route_lifecycle');

const IDS = new Set(['test-surfer-id', 'admin-user-id']);
const MARKER = 'x-rawsurf-e2e-isolation';
const RUM_PATH = '/api/weather/client-diagnostics';
const ADMIN = '/api/admin';
const ADMIN_READS = new Map([
  ['/api/admin/event-dashboard/events', { success: true, events: [] }],
  ['/api/admin/event-dashboard/actions', { success: true, actions: [] }],
]);
const HEALTH_PATH = '/api/health/data';
const HEALTH = {
  status: 'ok', fixture: 'synthetic-ui-read', freshest_run_age_h: 0, lanes: {}, alerts: [],
};
const PUBLIC_SOCKETS = new Set(['/api/ws/conditions', '/api/ws/live']);
const REALTIME = '/realtime/v1';

function settings(config) {
  try {
    const live = new URL(config.liveOrigin);
    const site = new URL(config.siteOrigin);
    if (![live, site].every(u => ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password)) {
      throw new Error();
    }
    return { liveOrigin: live.origin, siteOrigin: site.origin,
      socketOrigin: live.origin.replace(/^http/, 'ws') };
  } catch {
    throw new Error('Seeded UI isolation requires HTTP(S) liveOrigin and siteOrigin');
  }
}

function httpKind(url, cfg) {
  if ([cfg.liveOrigin, cfg.siteOrigin].includes(url.origin) && url.pathname === RUM_PATH) return 'rum';
  if (![cfg.liveOrigin, cfg.siteOrigin].includes(url.origin)) return null;
  if (url.pathname === ADMIN || url.pathname.startsWith(`${ADMIN}/`)) return 'admin';
  if (url.pathname === HEALTH_PATH) return 'diagnostics';
  return null;
}

function socketKind(url, cfg) {
  if (url.pathname === REALTIME || url.pathname.startsWith(`${REALTIME}/`)) {
    return url.pathname === `${REALTIME}/websocket` ? 'realtime' : 'unexpected-realtime';
  }
  if (url.origin !== cfg.socketOrigin || !url.pathname.startsWith('/api/ws/') || PUBLIC_SOCKETS.has(url.pathname)) {
    return null;
  }
  if (url.pathname === '/api/ws/admin/events') return 'admin';
  if ([...IDS].some(id => url.pathname === `/api/ws/call/${id}`)) return 'call';
  return 'unexpected-protected';
}

// Observation failures must never change session policy or route cleanup.
function observeSafely(observe, event) {
  try { observe?.(event); } catch { /* diagnostic only */ }
}

function evaluationOutcome(error) {
  try {
    const message = error?.message;
    if (typeof message === 'string') {
      if (message.includes('Test ended.')) return 'evaluate-test-ended';
      if (message.includes('Target page, context or browser has been closed')) return 'evaluate-context-closed';
    }
  } catch { /* unknown metadata remains unknown */ }
  return 'evaluate-other-error';
}

async function sessionFor(page, cfg, observe) {
  let evaluating = false;
  observeSafely(observe, 'read-start');
  try {
    if (!page || page.isClosed() || new URL(page.url()).origin !== cfg.siteOrigin) {
      observeSafely(observe, 'unavailable-before-evaluation');
      return null;
    }
    evaluating = true;
    // Return only identity and token presence, never the stored session or token.
    const session = await page.evaluate(() => {
      try {
        const user = JSON.parse(globalThis.localStorage.getItem('raw-surf-user') || 'null');
        return { id: typeof user?.id === 'string' ? user.id : null, hasToken: !!user?.access_token };
      } catch {
        return { id: null, hasToken: false };
      }
    });
    observeSafely(observe, 'evaluated');
    return session;
  } catch (error) {
    if (observe) observeSafely(observe, evaluating ? evaluationOutcome(error) : 'unavailable-before-evaluation');
    return null;
  }
}

// Context-local logical order, not a native clock. False means unobserved.
// Keep only three phase markers and per-rejection observations; no handler event log.
function socketObservations() {
  let sequence = 0, handlerId = 0;
  const phase = { fixtureUseReturned: false, contextCloseObserved: false, finalReceiptStarted: false };
  const events = [];
  const mark = name => {
    if (phase[name]) return;
    phase[name] = true;
    events.push({ phase: name, sequence: ++sequence });
  };
  return {
    observeFixtureUseReturned: () => mark('fixtureUseReturned'),
    observeContextClose: () => mark('contextCloseObserved'),
    observeFinalReceiptStart: () => mark('finalReceiptStarted'),
    socketLifecycleSnapshot: () => ({ phase: { ...phase }, events: events.map(event => ({ ...event })), lastSequence: sequence }),
    handler() {
      const data = { handlerId: ++handlerId, handlerEntrySequence: ++sequence,
        readStartSequence: null, readSettlementSequence: null,
        phaseAtReadStart: null, phaseAtReadSettlement: null, outcome: 'no-unique-owner' };
      return { data, observe(event) {
        if (event === 'read-start') {
          data.readStartSequence = ++sequence;
          data.phaseAtReadStart = { ...phase };
        } else {
          data.readSettlementSequence = ++sequence;
          data.phaseAtReadSettlement = { ...phase };
          data.outcome = event;
        }
      } };
    },
  };
}

const synthetic = session => !!session && IDS.has(session.id) && session.hasToken === false;

async function installSeededUiIsolation(context, config) {
  const cfg = settings(config);
  const stats = { adminReads: 0, diagnosticsReads: 0, rumAnswered: 0, rumLeaks: 0,
    adminSockets: 0, callSockets: 0, realtimeSockets: 0, blocked: 0 };
  const violations = [];
  const lifecycle = createRouteLifecycle();
  const socketHandlers = createRouteLifecycle();
  const observations = socketObservations();
  const record = (kind, method, path, socket, socketObservation) => {
    stats.blocked += 1;
    violations.push({ kind, method, path, ...(socket ? { socket } : {}),
      ...(socketObservation ? { socketObservation } : {}) });
  };
  const reject = async (route, kind, method, path) => {
    record(kind, method, path);
    await route.abort('blockedbyclient');
  };

  await context.addInitScript(() => {
    // Keep local RUM collection and render instruments, but send no batch anywhere.
    globalThis.__RAW_RUM_URL__ = '';
  });

  await context.route(url => !!httpKind(url, cfg), lifecycle.wrap(async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const kind = httpKind(url, cfg);
    // Do not retain header values or arbitrary private path segments in receipts.
    const path = kind === 'admin' && !ADMIN_READS.has(url.pathname) ? `${ADMIN}/[unexpected]` : url.pathname;
    const allowedMethod = kind === 'rum' ? 'POST' : 'GET';
    const cors = { 'access-control-allow-origin': cfg.siteOrigin,
      'access-control-allow-methods': `${allowedMethod}, OPTIONS`,
      'access-control-allow-headers': 'content-type', vary: 'Origin' };
    try {
      if (kind !== 'rum' && await request.headerValue('authorization')) {
        return reject(route, 'unexpected-request-auth', method, path);
      }
      const origin = await request.headerValue('origin');
      if ((origin && origin !== cfg.siteOrigin) || (method === 'OPTIONS' && origin !== cfg.siteOrigin)) {
        return reject(route, 'unexpected-request-origin', method, path);
      }
      if (method === 'OPTIONS') {
        const requestedMethod = await request.headerValue('access-control-request-method');
        const requestedHeaders = (await request.headerValue('access-control-request-headers') || '')
          .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (requestedMethod !== allowedMethod || requestedHeaders.some(value => value !== 'content-type')) {
          return reject(route, 'unexpected-preflight', method, path);
        }
      }
    } catch {
      return reject(route, 'unavailable-request-origin', method, path);
    }
    if (kind === 'rum') {
      if (!['POST', 'OPTIONS'].includes(method)) return reject(route, 'unexpected-rum-method', method, RUM_PATH);
      await route.fulfill({ status: 204, headers: { [MARKER]: 'rum',
        // The existing weather ledger also recognizes this response as answered locally.
        'x-rawsurf-offline-weather': 'local', ...cors } });
      stats.rumAnswered += 1;
      return;
    }
    if (!['GET', 'OPTIONS'].includes(method) || (kind === 'admin' && !ADMIN_READS.has(url.pathname))) {
      return reject(route, 'unexpected-protected-request', method, path);
    }
    let page;
    try { page = request.frame().page(); } catch { /* no owning page: reject below */ }
    if (!synthetic(await sessionFor(page, cfg))) return reject(route, 'unexpected-session', method, path);
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { [MARKER]: kind, ...cors } });
      return;
    }
    await route.fulfill({ json: kind === 'admin' ? ADMIN_READS.get(url.pathname) : HEALTH,
      headers: { [MARKER]: kind, ...cors } });
    stats[kind === 'admin' ? 'adminReads' : 'diagnosticsReads'] += 1;
  }));

  await context.routeWebSocket(url => !!socketKind(url, cfg), socketHandlers.wrap(lifecycle.wrap(async socket => {
    let observation;
    try { observation = observations.handler(); } catch { /* diagnostic only */ }
    const url = new URL(socket.url());
    const kind = socketKind(url, cfg);
    const path = kind === 'unexpected-protected' ? '/api/ws/[unexpected]'
      : kind === 'unexpected-realtime' ? `${REALTIME}/[unexpected]` : url.pathname;
    // WebSocketRoute has no frame API. Refuse ambiguous ownership rather than guessing a page.
    const pages = context.pages().filter(page => {
      try { return !page.isClosed() && new URL(page.url()).origin === cfg.siteOrigin; } catch { return false; }
    });
    const session = pages.length === 1 ? await sessionFor(pages[0], cfg, observation?.observe) : null;
    const mismatch = kind === 'call' && url.pathname !== `/api/ws/call/${session?.id}`;
    if (kind.startsWith('unexpected') || !synthetic(session) || mismatch || url.searchParams.has('token')) {
      // Snapshot existing observations only; never retain URL credentials or session values.
      record(kind.startsWith('unexpected') ? kind : 'unexpected-socket-session', 'WS', path, {
        origin: url.origin, kind, matchingPageCount: pages.length,
        sessionObserved: session !== null, syntheticIdMatch: !!session && IDS.has(session.id),
        storedTokenPresent: session?.hasToken ?? null,
        callMismatch: mismatch, tokenQueryPresent: url.searchParams.has('token'),
      }, observation?.data);
    } else {
      stats[`${kind}Sockets`] += 1;
    }
    // Deliberately never call connectToServer(), even on invalid sessions or unknown protected paths.
    await socket.close({ code: 1008, reason: 'Synthetic UI fixture: no server connection' });
  })));

  context.on('response', response => {
    const url = new URL(response.url());
    const kind = httpKind(url, cfg);
    if (!kind || response.headers()[MARKER] === kind) return;
    const method = response.request().method();
    if (kind === 'rum') stats.rumLeaks += 1;
    const path = kind === 'admin' && !ADMIN_READS.has(url.pathname) ? `${ADMIN}/[unexpected]` : url.pathname;
    record(`unmarked-${kind}-response`, method, path);
  });

  return { stats, violations, lifecycle, socketHandlers,
    observeFixtureUseReturned: () => observeSafely(observations.observeFixtureUseReturned),
    observeContextClose: () => observeSafely(observations.observeContextClose),
    observeFinalReceiptStart: () => observeSafely(observations.observeFinalReceiptStart),
    socketLifecycleSnapshot: observations.socketLifecycleSnapshot,
    assertNoViolations() {
    if (violations.length) throw new Error(`Seeded UI isolation recorded ${violations.length} violation(s)`);
  } };
}

module.exports = { installSeededUiIsolation };
