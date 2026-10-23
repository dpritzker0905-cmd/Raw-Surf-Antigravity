/**
 * THE WEATHER MODULES FOLLOW THE APP'S BACKEND URL (audit 2026-10-18, F-10).
 *
 * LayerAccessResolver (/api/weather/capabilities) and useOpenMeteoForecast (/api/weather/point) each kept a private
 * copy of the URL resolution that guarded on `typeof process !== 'undefined'`. That is false in a browser bundle, so
 * both always fell back to the PRODUCTION origin whatever REACT_APP_BACKEND_URL said: a dev/preview build hammered the
 * live 1-CPU box (CLAUDE.md: one Render box serves production AND dev). The hook also sent localhost to :8000.
 *
 * Both now use lib/apiClient's BACKEND_URL. Jest has a Node `process`, so the `typeof process` trap itself cannot be
 * reproduced here; the source scan below bans the pattern, and the hook case fails on the old code because the old
 * resolution answered http://localhost:8000 under jsdom.
 */
const fs = require('fs');
const path = require('path');

const ENV_ORIGIN = 'https://env-backend.example.test';
process.env.REACT_APP_BACKEND_URL = ENV_ORIGIN;

// A plain recorder, not jest.fn: CRA's resetMocks would wipe a jest.fn's calls before the first test runs.
let fetched = [];
global.fetch = (url) => {
  fetched.push(String(url));
  return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
};

// Required AFTER the env and fetch are set: both modules read them at load / first call.
const { renderHook, waitFor } = require('@testing-library/react');
const { BACKEND_URL } = require('../lib/apiClient');
require('../components/map/LayerAccessResolver');
const { useOpenMeteoForecast } = require('../hooks/useOpenMeteoForecast');

const urlsCalled = () => fetched;

it('BACKEND_URL itself follows REACT_APP_BACKEND_URL in this environment', () => {
  expect(BACKEND_URL).toBe(ENV_ORIGIN);
});

it('LayerAccessResolver asks the configured backend for /api/weather/capabilities', () => {
  expect(urlsCalled()).toContain(`${ENV_ORIGIN}/api/weather/capabilities`);
  expect(urlsCalled().some((u) => u.includes('onrender.com'))).toBe(false);
});

it('useOpenMeteoForecast asks the configured backend for /api/weather/point (not localhost:8000, not onrender)', async () => {
  fetched = [];
  renderHook(() => useOpenMeteoForecast({
    latitude: 33.6, longitude: -117.9, activeModel: 'GFS', isExplicit: true, activeLayer: 'wind',
  }));
  await waitFor(() => expect(urlsCalled().some((u) => u.includes('/api/weather/point'))).toBe(true));
  const pointUrls = urlsCalled().filter((u) => u.includes('/api/weather/point'));
  pointUrls.forEach((u) => expect(u.startsWith(`${ENV_ORIGIN}/api/weather/point?`)).toBe(true));
});

describe('source scan', () => {
  const SRC = path.resolve(__dirname, '..');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(js|jsx|ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });

  it('no module resolves the backend URL with its own `typeof process` guard', () => {
    // process.env.REACT_APP_* is substituted textually at build time; `typeof process` stays and is "undefined"
    // in a browser, which silently selects the fallback (production) origin.
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(`${path.sep}lib${path.sep}apiClient.js`))
      .filter((f) => {
        const text = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
        return /typeof process[^\n]*REACT_APP_BACKEND_URL/.test(text);
      })
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
