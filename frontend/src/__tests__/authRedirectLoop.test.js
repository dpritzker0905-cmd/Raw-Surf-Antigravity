/**
 * authRedirectLoop.test.js -- the 2026-10-08 "401 -> /auth -> /feed -> 401" loop, replayed offline.
 *
 * What happened: http://localhost:3000/map (a development build) pointed at the live backend sent
 * over 1,500 requests and pushed /api/health from 0.4 s to 2.9 s until the tab was closed. The
 * network log was GET /auth, hundreds of times. The cycle, one hard page load per turn:
 *   1. an authenticated call 401s -> apiClient clears raw-surf-user and, 2 s later, sets
 *      window.location.href to /auth (a hard load: every module's state starts over);
 *   2. on /auth, AuthProvider finds no raw-surf-user and, in a development build, seeds the mock
 *      user (access_token 'dev-mock-user-token'), which the deployed backend refuses
 *      (dev_identity_allowed() fails closed there, backend/core/security.py);
 *   3. Auth.js sees a user and forwards to /feed;
 *   4. /feed's first authenticated call 401s -> back to 1.
 *
 * This replays that cycle with the real AuthContext, apiClient and Auth page. Each hard load gets a
 * fresh module registry (jest.isolateModules), as the browser re-evaluates the bundle; localStorage
 * and sessionStorage survive, as they do in the tab. The "backend" is a local adapter that answers
 * 401 to every authenticated request: no network.
 */

let mockNavigate = () => {};
let mockSearch = '';
// The router is a test boundary: the harness performs the SPA navigation Auth.js asks for.
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(mockSearch), jest.fn()],
}), { virtual: true });

const MAX_HARD_LOADS = 6;
const AUTHED_CALL = '/notifications/dev-mock-user-id/unread-count';
const realLocation = window.location;
const realNodeEnv = process.env.NODE_ENV;

let navigations;   // every hard navigation a page asked for (location.href = ...)
let hardLoads;     // every page the tab actually loaded
let backendCalls;

function installLocation(path) {
  const url = new URL(path, 'http://localhost');
  delete window.location;
  window.location = {
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    get href() { return url.href; },
    set href(next) { navigations.push(next); },
    assign(next) { navigations.push(next); },
    replace(next) { navigations.push(next); },
  };
}

// The deployed backend: it refuses every Bearer token this tab can hold, the mock one included.
function refusingBackend(config) {
  backendCalls.push(config.url);
  if (config.headers && config.headers.Authorization) {
    const err = new Error('Request failed with status code 401');
    err.config = config;
    err.response = { status: 401, data: { detail: 'Invalid token' }, headers: {}, config };
    return Promise.reject(err);
  }
  return Promise.resolve({ status: 200, data: {}, headers: {}, config });
}

const isProtected = (path) => !path.startsWith('/auth') && path !== '/';

/**
 * Load `path` the way the browser does after location.href = path, run the page until it is idle
 * (Auth.js's forward, the protected page's first authenticated call, apiClient's 2 s redirect
 * timer), and return the page's rendered container, the SPA forward it asked for (if any) and the
 * next hard navigation it asked for.
 */
async function hardLoad(path, { beforeLoad } = {}) {
  hardLoads.push(path);
  if (beforeLoad) beforeLoad();
  installLocation(path);
  mockSearch = new URL(path, 'http://localhost').search;
  const spaNavigations = [];
  mockNavigate = (to) => spaNavigations.push(to);
  const navigationsBefore = navigations.length;

  let page;
  jest.isolateModules(() => {
    page = {
      React: require('react'),
      // /pure: the default entry registers afterEach hooks, which may not be declared mid-test.
      rtl: require('@testing-library/react/pure'),
      AuthProvider: require('../contexts/AuthContext').AuthProvider,
      Auth: require('../components/Auth').Auth,
      apiClient: require('../lib/apiClient').default,
    };
  });
  page.apiClient.defaults.adapter = refusingBackend;

  const { React, rtl, AuthProvider, Auth } = page;
  let view;
  await rtl.act(async () => {
    view = rtl.render(
      <AuthProvider>{path.startsWith('/auth') ? <Auth /> : null}</AuthProvider>,
    );
  });
  void React;

  // A forward from the auth page is an SPA navigation: same page, same module state.
  const landedOn = spaNavigations.length ? spaNavigations[spaNavigations.length - 1] : path;
  if (landedOn !== path) installLocation(landedOn);
  if (isProtected(landedOn)) {
    await page.apiClient.get(AUTHED_CALL).catch(() => {});
  }
  await rtl.act(async () => { jest.advanceTimersByTime(5000); });

  const container = view.container.cloneNode(true);
  view.unmount();
  const next = navigations.length > navigationsBefore ? navigations[navigations.length - 1] : null;
  return { container, forwardedTo: landedOn !== path ? landedOn : null, next };
}

/** Follow hard navigations from `startPath` until the tab is idle or MAX_HARD_LOADS is reached. */
async function runTab(startPath, options) {
  let path = startPath;
  let last = null;
  while (path && hardLoads.length < MAX_HARD_LOADS) {
    last = await hardLoad(path, options);
    path = last.next;
  }
  return last;
}

const EXPIRED_SESSION = {
  id: 'u-expired', email: 'surfer@example.invalid', username: 'surfer', role: 'Surfer',
  subscription_tier: 'free', access_token: 'an-expired-token',
};

describe('the 401 -> /auth redirect loop (2026-10-08)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    navigations = [];
    hardLoads = [];
    backendCalls = [];
    localStorage.setItem('raw-surf-user', JSON.stringify(EXPIRED_SESSION));
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = realNodeEnv;
  });

  afterAll(() => {
    window.location = realLocation;
  });

  it('a development build whose session the backend refuses is redirected once, not in a loop', async () => {
    process.env.NODE_ENV = 'development';
    const last = await runTab('/map');

    // Before the fix: ['/map', '/auth', '/auth', '/auth', '/auth', '/auth'] and still going.
    expect(hardLoads).toEqual(['/map', '/auth?tab=login']);
    expect(last.next).toBeNull();
  });

  it('... and rests on the sign-in form instead of being forwarded to /feed', async () => {
    process.env.NODE_ENV = 'development';
    const last = await runTab('/map');

    expect(last.forwardedTo).toBeNull();
    expect(last.container.querySelector('input[type="email"]')).not.toBeNull();
    expect(last.container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('a session restored by another writer (another tab) cannot restart the loop either', async () => {
    // A production build seeds nothing, but anything that writes raw-surf-user back between the
    // clear and the load (another tab's updateUser, a late refresh) re-arms the same cycle.
    const restore = () => localStorage.setItem('raw-surf-user', JSON.stringify(EXPIRED_SESSION));
    const last = await runTab('/map', { beforeLoad: restore });

    expect(hardLoads).toEqual(['/map', '/auth?tab=login']);
    expect(last.next).toBeNull();
  });

  it('... and the restored session is not forwarded either', async () => {
    const restore = () => localStorage.setItem('raw-surf-user', JSON.stringify(EXPIRED_SESSION));
    const last = await runTab('/map', { beforeLoad: restore });

    expect(last.forwardedTo).toBeNull();
  });

  it('control: a production build with nothing re-seeding the session stops after one redirect', async () => {
    const last = await runTab('/map');

    expect(hardLoads).toHaveLength(2);
    expect(last.next).toBeNull();
    expect(localStorage.getItem('raw-surf-user')).toBeNull();
  });
});
