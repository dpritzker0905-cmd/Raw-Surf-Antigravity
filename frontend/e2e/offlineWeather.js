/**
 * offlineWeather: the suite's `test`, with `/api/weather/*` answered by a backend INSIDE the runner.
 *
 * Every spec imports `test`/`expect` from here instead of '@playwright/test'. When E2E_WEATHER_BACKEND names
 * a loopback origin (e2e-tests.yml starts frontend/scripts/offline-backend/serve_synthetic.py there), an
 * automatic fixture routes each weather request the page sends to the live backend origin to that local
 * server instead (scripts/offline-backend/weather_route.js has the why and the fail-closed rules). The
 * deployed site, auth, explore, spot hub and sockets are untouched: only the heavy weather traffic moves.
 *
 * ⭐ IT IS ALSO THE INSTRUMENT. Per test it records how many weather requests were answered locally and how
 * many weather responses arrived WITHOUT the local marker, i.e. reached the live box. That second number
 * must be 0: a non-zero count fails the test, so a future handler that `route.continue()`s backend URLs
 * (the spec-level catch-all used to) cannot quietly put the load back. One JSON line per test goes to
 * stdout (`[OFFLINE WEATHER] ...`) and, when E2E_WEATHER_LEDGER is set, to that file for the run summary.
 *
 * Unset E2E_WEATHER_BACKEND = routing off (a local run against a backend you chose). E2E_STUB_OTHER_BACKEND=1
 * additionally answers every OTHER backend call with an empty 200 and closes backend sockets, for a fully
 * offline local run; CI never sets it, because the explore/spot-hub specs need the real responses.
 */
const fs = require('node:fs');
const base = require('@playwright/test');
const { installSeededUiIsolation } = require('./seededUiIsolation');
const {
  weatherRouteConfig, routeWeatherToLocal, watchLiveWeatherLeaks, stubOtherLiveBackend,
} = require('../scripts/offline-backend/weather_route');

const cfg = weatherRouteConfig(process.env, 'E2E_WEATHER_BACKEND');
const STUB_OTHER = process.env.E2E_STUB_OTHER_BACKEND === '1';
const LEDGER = process.env.E2E_WEATHER_LEDGER || '';
const UI_LEDGER = process.env.E2E_UI_ISOLATION_LEDGER || '';

const test = base.test.extend({
  offlineWeather: [async ({ context }, use, testInfo) => {
    if (!cfg.local) { await use(null); return; }
    const stats = await routeWeatherToLocal(context, cfg);
    // Install the exact UI/RUM fence last so its local diagnostics response wins over
    // the general weather route. All handlers are ready before any page is created.
    const isolation = await installSeededUiIsolation(context, {
      liveOrigin: cfg.liveOrigin,
      siteOrigin: new URL(process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app').origin,
    });
    const leaks = watchLiveWeatherLeaks(context, cfg.liveOrigin);
    if (STUB_OTHER) await stubOtherLiveBackend(context, cfg.liveOrigin);
    await use(stats);
    const { leaked, examples } = leaks();
    const row = {
      project: testInfo.project.name, test: testInfo.titlePath.slice(1).join(' > '), retry: testInfo.retry,
      routedToLocal: stats.local, answeredHere: stats.answered, localFailures: stats.failed,
      cancelledByPage: stats.cancelled, sentToLive: leaked, byEndpoint: stats.byEndpoint,
      ...(stats.failedExamples.length ? { failedExamples: stats.failedExamples } : {}),
    };
    console.log(`[OFFLINE WEATHER] ${JSON.stringify(row)}`);
    if (LEDGER) fs.appendFileSync(LEDGER, `${JSON.stringify(row)}\n`);
    const uiRow = { project: testInfo.project.name, test: testInfo.titlePath.slice(1).join(' > '),
      retry: testInfo.retry, ...isolation.stats, violations: isolation.violations };
    console.log(`[SEEDED UI ISOLATION] ${JSON.stringify(uiRow)}`);
    if (UI_LEDGER) fs.appendFileSync(UI_LEDGER, `${JSON.stringify(uiRow)}\n`);
    isolation.assertNoViolations();
    base.expect(leaked, `weather responses that reached the LIVE backend instead of the in-runner one: ${examples.join(', ')}`)
      .toBe(0);
  }, { auto: true }],
});

module.exports = { test, expect: base.expect };
