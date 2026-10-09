/**
 * apiClient.test.js
 * Tests for the shared Axios instance: Bearer token injection, error handling.
 */
import axios from 'axios';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

// We test the interceptor behavior by mocking localStorage and checking requests
describe('apiClient', () => {
  const BACKEND_URL = 'https://api.rawsurf.com';

  beforeEach(() => {
    // Set the env var
    process.env.REACT_APP_BACKEND_URL = BACKEND_URL;
    // Clear localStorage before each test
    localStorage.clear();
    // Clear module cache so interceptors are fresh
    jest.resetModules();
  });

  describe('BACKEND_URL and API_BASE exports', () => {
    it('exports BACKEND_URL from env var', () => {
      const { BACKEND_URL: url } = require('./apiClient');
      expect(url).toBe(BACKEND_URL);
    });

    it('exports API_BASE as BACKEND_URL + /api', () => {
      const { API_BASE } = require('./apiClient');
      expect(API_BASE).toBe(`${BACKEND_URL}/api`);
    });
  });

  describe('Bearer token injection', () => {
    it('injects Authorization header when user has access_token in localStorage', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        access_token: 'eyJhbGciOiJIUzI1NiJ9.test.token',
      };
      localStorage.setItem('raw-surf-user', JSON.stringify(mockUser));

      // Re-import to get fresh interceptors
      const { default: client } = require('./apiClient');

      // Mock the actual HTTP call via Axios adapter
      const mockAdapter = jest.fn().mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        config: {},
      });
      client.defaults.adapter = mockAdapter;

      await client.get('/test');

      expect(mockAdapter).toHaveBeenCalled();
      const passedConfig = mockAdapter.mock.calls[0][0];
      expect(passedConfig.headers['Authorization']).toMatch(/^Bearer /);
    });

    it('does not inject Authorization header when no user in localStorage', async () => {
      // No user stored
      const { default: client } = require('./apiClient');

      const mockAdapter = jest.fn().mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        config: {},
      });
      client.defaults.adapter = mockAdapter;

      await client.get('/test');

      expect(mockAdapter).toHaveBeenCalled();
      const passedConfig = mockAdapter.mock.calls[0][0];
      expect(passedConfig.headers['Authorization']).toBeUndefined();
    });

    it('silently skips malformed localStorage JSON', async () => {
      localStorage.setItem('raw-surf-user', 'NOT_VALID_JSON{{{{');
      const { default: client } = require('./apiClient');

      const mockAdapter = jest.fn().mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        config: {},
      });
      client.defaults.adapter = mockAdapter;

      let error = null;
      try {
        await client.get('/test');
      } catch (err) {
        error = err;
      }

      // Should not throw a JSON parse error, should complete successfully
      expect(error).toBeNull();
      expect(mockAdapter).toHaveBeenCalled();
    });
  });

  // A 401 sends the tab to the sign-in form with a hard load (window.location.href), which restarts
  // every module. 2026-10-08: that redirect looped (401 -> /auth -> /feed -> 401 ...) because
  // nothing that survives a hard load remembered it had just happened. See
  // src/__tests__/authRedirectLoop.test.js for the whole cycle.
  describe('401 -> sign-in redirect', () => {
    const realLocation = window.location;
    let navigations;

    const setPath = (path) => {
      delete window.location;
      window.location = {
        pathname: path,
        search: '',
        get href() { return `http://localhost${path}`; },
        set href(next) { navigations.push(next); },
        assign(next) { navigations.push(next); },
      };
    };

    const respond = (status) => (config) => (status < 400
      ? Promise.resolve({ status, data: {}, headers: {}, config })
      : Promise.reject(Object.assign(new Error(`status ${status}`), {
        config, response: { status, data: {}, headers: {}, config },
      })));

    // One page: a fresh module registry, as after a hard load. Storage survives, as in the tab.
    const loadPage = (path) => {
      jest.resetModules();
      setPath(path);
      const { default: client } = require('./apiClient');
      const { toast } = require('sonner');
      return { client, toast };
    };

    beforeEach(() => {
      jest.useFakeTimers();
      sessionStorage.clear();
      navigations = [];
      localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'u1', access_token: 'refused-token' }));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    afterAll(() => {
      window.location = realLocation;
    });

    it('redirects once, to the sign-in form, however many 401s and 2xx interleave on a page', async () => {
      const { client, toast } = loadPage('/feed');
      for (const status of [401, 200, 401, 200, 401]) {
        client.defaults.adapter = respond(status);
        await client.get(`/poll/${status}`).catch(() => {});
      }
      jest.advanceTimersByTime(2000);

      // Before: ['/auth', '/auth', '/auth'] -- one hard navigation (and one toast) per 401 that
      // followed a 2xx, because any success re-armed the module flag.
      expect(navigations).toEqual(['/auth?tab=login']);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('raw-surf-user')).toBeNull();
    });

    it('a 401 on the page that a 401 redirect just loaded does not navigate again (the loop guard)', async () => {
      let page = loadPage('/feed');
      page.client.defaults.adapter = respond(401);
      await page.client.get('/me').catch(() => {});
      jest.advanceTimersByTime(2000);
      expect(navigations).toEqual(['/auth?tab=login']);

      // Something re-armed the session (the development mock seed, another tab), the auth page
      // forwarded, and the next page's first call is refused again.
      localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'u1', access_token: 'refused-token' }));
      jest.advanceTimersByTime(3000);
      page = loadPage('/feed');
      page.client.defaults.adapter = respond(401);
      await page.client.get('/me').catch(() => {});
      jest.advanceTimersByTime(2000);

      expect(navigations).toEqual(['/auth?tab=login']);
      // The refused session is still cleared, and the way to the form is a button, not a timer.
      expect(localStorage.getItem('raw-surf-user')).toBeNull();
      const [, options] = page.toast.error.mock.calls[page.toast.error.mock.calls.length - 1];
      expect(options.action.label).toBe('Sign in');
      options.action.onClick();
      expect(navigations).toEqual(['/auth?tab=login', '/auth?tab=login']);
    });

    it('the guard expires: a 401 more than 30 s after the last redirect redirects again', async () => {
      sessionStorage.setItem('raw-surf-session-rejected-at', String(Date.now() - 31000));
      const { client } = loadPage('/feed');
      client.defaults.adapter = respond(401);
      await client.get('/me').catch(() => {});
      jest.advanceTimersByTime(2000);

      expect(navigations).toEqual(['/auth?tab=login']);
    });

    it('never redirects from the auth page itself, for an admin call, or for a login attempt', async () => {
      let page = loadPage('/auth');
      page.client.defaults.adapter = respond(401);
      await page.client.get('/me').catch(() => {});
      page = loadPage('/feed');
      page.client.defaults.adapter = respond(401);
      await page.client.get('/admin/users').catch(() => {});
      await page.client.post('/auth/login', {}).catch(() => {});
      jest.advanceTimersByTime(2000);

      expect(navigations).toEqual([]);
      expect(sessionStorage.getItem('raw-surf-session-rejected-at')).toBeNull();
    });
  });

  describe('baseURL config', () => {
    it('uses REACT_APP_BACKEND_URL + /api as base', () => {
      const { default: client } = require('./apiClient');
      expect(client.defaults.baseURL).toBe(`${BACKEND_URL}/api`);
    });

    // Was 60s, asserted here as such. Lowered to 15s: the 60s was justified as cover for Render
    // free-tier cold starts (30-60s idle wake), which do not happen -- the backend is on a paid
    // plan -- so it only delayed real failures from reaching the user. See SLOW_ENDPOINTS in
    // apiClient.js for the genuinely-slow endpoints that are pinned longer instead of inheriting.
    it('has a 15s default timeout configured', () => {
      const { default: client } = require('./apiClient');
      expect(client.defaults.timeout).toBe(15000);
    });
  });
});
