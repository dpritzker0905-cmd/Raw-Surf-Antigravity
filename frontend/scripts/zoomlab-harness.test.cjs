const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { stubZoomlabMessageBadge, marineReadyPredicate, requireMarinePage,
  waitForMarineReady, findWavesControl, waitForWavesControl, ZoomlabInstrumentError,
  instrumentFailureReport } = require('./zoomlab-harness.cjs');
const { runWithNetworkEvidence } = require('./zoomlab-network-evidence');
const { analyzeTrace } = require('./zoomlab-verdict');
const origin = 'https://backend.fixture.invalid';
const badge = '/api/messages/unread-counts/dev-mock-user-id';

async function routeFixture() {
  let matches, handler;
  const count = await stubZoomlabMessageBadge({ route: async (match, handle) => { matches = match; handler = handle; } }, origin);
  return { count, async request(path, method = 'GET', host = origin, authorization = 'Bearer dev-mock-user-token') {
    let result = 'passed-through';
    if (matches(new URL(path, host))) await handler({ request: () => ({ method: () => method, headers: () => ({ authorization }) }),
      fallback: async () => {}, fulfill: async options => { result = options; } });
    return result;
  } };
}

test('synthetic GET is neutral, labelled and counted; duplicate callers remain covered', async () => {
  const f = await routeFixture();
  for (let i = 1; i <= 2; i++) {
    const result = await f.request(badge);
    assert.deepEqual(result.json, { total: 0, primary: 0, requests: 0, grom_zone: 0 });
    assert.equal(result.headers['x-rawsurf-zoomlab-fixture'], 'synthetic-message-badge');
    assert.equal(f.count(), i);
  }
});

for (const authorization of [undefined, 'Bearer actual-user-control-token']) {
  test(`matching synthetic path with nonmock authentication is never fulfilled (${authorization ? 'another token' : 'missing'})`, async () => {
    const f = await routeFixture();
    assert.equal(await f.request(badge, 'GET', origin, authorization || null), 'passed-through');
    assert.equal(f.count(), 0);
  });
}

for (const [label, path, method, host] of [
  ['another user', '/api/messages/unread-counts/real-user', 'GET', origin],
  ['prefix-only path', badge + '/extra', 'GET', origin],
  ['another backend origin', badge, 'GET', 'https://another.fixture.invalid'],
  ['POST', badge, 'POST', origin], ['DELETE', badge, 'DELETE', origin],
  ['grid', '/api/weather/grid', 'GET', origin], ['series', '/api/weather/grid-series', 'GET', origin],
  ['point', '/api/weather/point', 'GET', origin], ['spot', '/api/explore/spot-details/fixture', 'GET', origin],
  ['auth', '/api/auth/login', 'POST', origin],
]) test(`${label} is never mocked`, async () => {
  const f = await routeFixture();
  assert.equal(await f.request(path, method, host), 'passed-through'); assert.equal(f.count(), 0);
});

function browser(fn, window, document = {}, argument) {
  return vm.runInNewContext(`(${fn.toString()})(argument)`, { window, document, argument });
}
function ready(path = '/map') { return { location: { pathname: path }, map: { jumpTo() {} }, __MARINE_ENGINE__: {} }; }
function pageFor(window) { return { evaluate: async (fn, arg) => browser(fn, window, {}, arg) }; }

test('map readiness requires a callable map and marine engine', () => {
  const w = ready(); assert.equal(browser(marineReadyPredicate, w), true);
  w.map = {}; assert.equal(browser(marineReadyPredicate, w), false);
  w.map = { jumpTo() {} }; delete w.__MARINE_ENGINE__; assert.equal(browser(marineReadyPredicate, w), false);
});

for (const path of ['/auth', '/feed', '/private/customer-fixture']) {
  test(`unexpected route is rejected, including stale globals (${path})`, async () => {
    const w = ready(path);
    await assert.rejects(requireMarinePage(pageFor(w)), e => e instanceof ZoomlabInstrumentError &&
      e.code === 'unexpected-route' && !e.message.includes('customer-fixture'));
  });
}

test('camera validation and use share one evaluation; failed prerequisites never move camera', async () => {
  let calls = 0; const w = ready(); w.map.jumpTo = camera => { calls++; assert.equal(camera.zoom, 7); };
  await requireMarinePage(pageFor(w), { zoom: 7 }); assert.equal(calls, 1);
  w.location.pathname = '/feed';
  await assert.rejects(requireMarinePage(pageFor(w), { zoom: 7 }), ZoomlabInstrumentError); assert.equal(calls, 1);
});

test('real camera exceptions remain application errors', async () => {
  const w = ready(); w.map.jumpTo = () => { throw new Error('controlled camera defect'); };
  await assert.rejects(requireMarinePage(pageFor(w), { zoom: 7 }), e => e.message === 'controlled camera defect' && !(e instanceof ZoomlabInstrumentError));
});

test('readiness timeout is explicit and unexpected browser failures are preserved', async () => {
  const w = ready(); delete w.map;
  const p = pageFor(w); p.waitForFunction = async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  await assert.rejects(waitForMarineReady(p), e => e.code === 'map-unavailable');
  p.waitForFunction = async () => { throw new Error('browser disconnected'); };
  await assert.rejects(waitForMarineReady(p), e => e.message === 'browser disconnected');
});

test('redirect during readiness yields a specific route failure', async () => {
  const w = ready('/auth'); const p = pageFor(w);
  p.waitForFunction = async fn => pollHandle(browser(fn, w));
  await assert.rejects(waitForMarineReady(p), e => e.code === 'unexpected-route' && e.state.route === '/auth');
});

function button(text, pressed = null, label = '') {
  return { textContent: text, title: '', clicks: 0, getAttribute: name => name === 'aria-pressed' ? pressed : name === 'aria-label' ? label : null,
    click() { this.clicks++; } };
}
function select(w, buttons) { return browser(findWavesControl, w, { querySelectorAll: () => buttons }); }

test('selector rejects feed Waves and accepts only map pressed-state controls', () => {
  const feedTab = button('Waves'); const layer = button('Waves', 'false');
  assert.equal(select(ready(), [feedTab, layer]), layer);
  assert.equal(select(ready('/feed'), [layer]), null);
  assert.equal(select(ready(), [button('Wind Waves', 'false')]), null);
  assert.equal(select(ready(), [button('Waves', 'invalid')]), null);
  assert.equal(select(ready(), [button('Waves', 'true')]).getAttribute('aria-pressed'), 'true');
});

test('collapsed controls expand only on the map and are reacquired on the next poll', () => {
  const expander = button('', null, 'Expand weather controls');
  assert.equal(select(ready(), [expander]), null); assert.equal(expander.clicks, 1);
  const layer = button('Waves', 'false'); assert.equal(select(ready(), [layer]), layer);
  assert.equal(select(ready('/feed'), [expander]), null); assert.equal(expander.clicks, 1);
});

test('control wait detects route loss instead of accepting feed controls', async () => {
  const w = ready(); const p = pageFor(w);
  p.waitForFunction = async () => { w.location.pathname = '/feed'; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  await assert.rejects(waitForWavesControl(p), e => e.code === 'unexpected-route');
});

test('instrument refusal cannot be a renderer pass; evidence survives failure', async () => {
  const state = { route: '/feed', mapReady: false, marineReady: false, reason: 'unexpected-route' };
  const error = new ZoomlabInstrumentError('unexpected-route', state);
  const report = instrumentFailureReport(error, 'staircase_full', 2);
  assert.equal(report.verdict, 'REFUSE'); assert.equal(report.completed, false);
  assert.equal(report.syntheticMessageBadge.fulfilled, 2);
  assert.notEqual(analyzeTrace(report).verdict, 'PASS');
  let evidence, closed = false;
  await assert.rejects(runWithNetworkEvidence(new EventEmitter(), {
    run: async () => { throw error; }, close: async () => { closed = true; }, save: async data => { evidence = data; },
  }), e => e === error);
  assert.equal(closed, true); assert.equal(evidence.completion.scenarioCompleted, false); assert.equal(evidence.completion.contextClosed, true);
});

test('independent application errors remain FAIL even when the instrument cannot complete', () => {
  const error = new ZoomlabInstrumentError('map-unavailable', { route: '/map', mapReady: false, marineReady: false });
  const report = instrumentFailureReport(error, 'staircase_full', 0, ['Uncaught controlled renderer defect']);
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(report.consoleErrors, ['Uncaught controlled renderer defect']);
  assert.equal(analyzeTrace(report).verdict, 'FAIL');
});

// Model the observed pageerror delivery at the browser boundary; no browser or network is used.
// The real predicate, Node-side checks, failure report and verdict run unchanged.
function pollHandle(value) { return { disposed: false, jsonValue: async () => value,
  async dispose() { this.disposed = true; } }; }
function pollingPage(window, beforePoll = () => {}, document = { querySelectorAll: () => [] }, afterPoll = () => {}) {
  const page = new EventEmitter();
  const errors = [];
  const handles = [];
  page.on('pageerror', error => errors.push(`Uncaught ${error.message}`));
  page.evaluate = async (fn, argument) => browser(fn, window, document, argument);
  page.waitForFunction = async expression => {
    beforePoll();
    let result;
    try {
      result = typeof expression === 'function' ? browser(expression, window, document)
        : vm.runInNewContext(expression, { window, document });
    } catch (error) {
      page.emit('pageerror', error);
      throw error;
    }
    if (!result) { const error = new Error('controlled poll timeout'); error.name = 'TimeoutError'; throw error; }
    afterPoll();
    const handle = pollHandle(result);
    handles.push(handle);
    return handle;
  };
  return { page, errors, handles };
}

for (const route of ['/auth', '/feed', '/private/customer-fixture']) {
  test(`route departure settles browser polling without a sentinel exception (${route})`, async () => {
    const { page, errors } = pollingPage(ready(route));
    let failure;
    await assert.rejects(waitForMarineReady(page), error => {
      failure = error;
      return error instanceof ZoomlabInstrumentError && error.code === 'unexpected-route';
    });
    assert.deepEqual(errors, [], 'a harness route check must not generate a browser pageerror');
    const report = instrumentFailureReport(failure, 'staircase_full', 1, errors);
    assert.equal(report.verdict, 'REFUSE');
    assert.equal(report.completed, false);
    assert.equal(report.readiness.route, route.startsWith('/private/') ? 'other' : route);
    assert.equal(JSON.stringify(report).includes('customer-fixture'), false);
  });
}

test('route loss during the Waves poll refuses without a browser exception or accepting stale controls', async () => {
  const window = ready();
  const { page, errors } = pollingPage(window, () => { window.location.pathname = '/auth'; });
  let failure;
  await assert.rejects(waitForWavesControl(page), error => {
    failure = error;
    return error instanceof ZoomlabInstrumentError && error.code === 'unexpected-route';
  });
  assert.deepEqual(errors, []);
  assert.equal(instrumentFailureReport(failure, 'staircase_full', 1, errors).verdict, 'REFUSE');
});

test('ordinary missing map and Waves controls remain instrument failures, while ready map succeeds', async () => {
  const window = ready();
  delete window.map;
  const missing = pollingPage(window);
  await assert.rejects(waitForMarineReady(missing.page), error => error.code === 'map-unavailable');
  assert.deepEqual(missing.errors, []);
  const present = pollingPage(ready());
  assert.equal((await waitForMarineReady(present.page)).route, '/map');
  await assert.rejects(waitForWavesControl(present.page), error => error.code === 'waves-control-unavailable');
  assert.deepEqual(present.errors, []);
  const controls = pollingPage(ready(), () => {}, { querySelectorAll: () => [button('Waves', 'false')] });
  await waitForWavesControl(controls.page);
});

test('genuine browser exceptions and their renderer failure are preserved', async () => {
  const window = ready();
  Object.defineProperty(window.map, 'jumpTo', { get() { throw new Error('controlled application crash'); } });
  const { page, errors } = pollingPage(window);
  await assert.rejects(waitForMarineReady(page), error => error.message === 'controlled application crash'
    && !(error instanceof ZoomlabInstrumentError));
  assert.deepEqual(errors, ['Uncaught controlled application crash']);
  assert.equal(analyzeTrace({ consoleErrors: errors }).verdict, 'FAIL');
});

test('a foreign error mentioning the old sentinel is not converted to instrument refusal', async () => {
  const page = pageFor(ready('/auth'));
  const failure = new Error('application failure ZOOMLAB_INSTRUMENT_UNEXPECTED_ROUTE:/auth');
  page.waitForFunction = async () => { throw failure; };
  await assert.rejects(waitForMarineReady(page), error => error === failure);
  await assert.rejects(waitForWavesControl(pageForForeignFailure()), error => error === failure);
  function pageForForeignFailure() {
    const readyPage = pageFor(ready());
    readyPage.waitForFunction = page.waitForFunction;
    return readyPage;
  }
});

test('route failure from the real poll still closes context and saves incomplete evidence', async () => {
  const { page, errors } = pollingPage(ready('/auth'));
  let evidence, closed = false;
  await assert.rejects(runWithNetworkEvidence(page, {
    run: () => waitForMarineReady(page),
    close: async () => { closed = true; },
    save: async value => { evidence = value; },
  }), error => error instanceof ZoomlabInstrumentError && error.code === 'unexpected-route');
  assert.equal(closed, true);
  assert.equal(evidence.completion.scenarioCompleted, false);
  assert.equal(evidence.completion.contextClosed, true);
  assert.deepEqual(errors, []);
});

test('route refusal keeps genuine coexisting errors and historical sentinel evidence unchanged', () => {
  const error = new ZoomlabInstrumentError('unexpected-route', { route: '/auth', reason: 'unexpected-route' });
  for (const message of ['Uncaught controlled application crash', 'Uncaught ZOOMLAB_INSTRUMENT_UNEXPECTED_ROUTE:/auth']) {
    const report = instrumentFailureReport(error, 'staircase_full', 1, [message]);
    assert.deepEqual(report.consoleErrors, [message]);
    assert.equal(report.verdict, 'FAIL');
  }
});

for (const route of ['/auth', '/feed', '/private/customer-fixture']) {
  for (const waiter of [waitForMarineReady, waitForWavesControl]) {
    test(`${waiter.name} retains terminal ${route} even if /map recovers before Node inspection`, async () => {
      const window = ready();
      const { page } = pollingPage(window, () => { window.location.pathname = route; },
        { querySelectorAll: () => [] }, () => { window.location.pathname = '/map'; });
      await assert.rejects(waiter(page), error => error instanceof ZoomlabInstrumentError
        && error.code === 'unexpected-route'
        && error.state.route === (route.startsWith('/private/') ? 'other' : route)
        && !error.message.includes('customer-fixture'));
    });
  }
}

for (const waiter of [waitForMarineReady, waitForWavesControl]) {
  test(`${waiter.name} still validates current state after a successful poll`, async () => {
    const window = ready();
    const { page, handles } = pollingPage(window, () => {},
      { querySelectorAll: () => [button('Waves', 'false')] },
      () => { window.location.pathname = '/auth'; });
    await assert.rejects(waiter(page), error => error.code === 'unexpected-route');
    assert.equal(handles[0].disposed, true);
  });
}

test('poll observation failure is preserved and its result handle is disposed', async () => {
  const page = pageFor(ready());
  const failure = new Error('controlled observation failure');
  let disposed = false;
  page.waitForFunction = async () => ({ jsonValue: async () => { throw failure; },
    dispose: async () => { disposed = true; } });
  await assert.rejects(waitForMarineReady(page), error => error === failure);
  assert.equal(disposed, true);
});
