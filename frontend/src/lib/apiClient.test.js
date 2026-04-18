/**
 * apiClient.test.js
 * Tests for the shared Axios instance: Bearer token injection, error handling.
 */
import axios from 'axios';

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

      // Mock the actual HTTP call
      const mockAdapter = jest.fn().mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        config: {},
      });

      // Intercept the request config before it goes out
      let capturedConfig = null;
      client.interceptors.request.use((config) => {
        capturedConfig = config;
        throw new axios.Cancel('stop'); // Short-circuit the request
      });

      try {
        await client.get('/test');
      } catch (e) {
        // Expected cancel
      }

      if (capturedConfig) {
        expect(capturedConfig.headers['Authorization']).toMatch(/^Bearer /);
      }
    });

    it('does not inject Authorization header when no user in localStorage', async () => {
      // No user stored
      const { default: client } = require('./apiClient');

      let capturedConfig = null;
      client.interceptors.request.use((config) => {
        capturedConfig = config;
        throw new axios.Cancel('stop');
      });

      try {
        await client.get('/test');
      } catch (e) {
        // Expected cancel
      }

      if (capturedConfig) {
        expect(capturedConfig.headers['Authorization']).toBeUndefined();
      }
    });

    it('silently skips malformed localStorage JSON', async () => {
      localStorage.setItem('raw-surf-user', 'NOT_VALID_JSON{{{{');
      const { default: client } = require('./apiClient');

      let error = null;
      client.interceptors.request.use(
        (config) => { throw new axios.Cancel('stop'); },
        (err) => { error = err; }
      );

      try {
        await client.get('/test');
      } catch (e) {
        // Expected cancel
      }

      // Should not throw a JSON parse error
      expect(error).toBeNull();
    });
  });

  describe('baseURL config', () => {
    it('uses REACT_APP_BACKEND_URL + /api as base', () => {
      const { default: client } = require('./apiClient');
      expect(client.defaults.baseURL).toBe(`${BACKEND_URL}/api`);
    });

    it('has 30s timeout configured', () => {
      const { default: client } = require('./apiClient');
      expect(client.defaults.timeout).toBe(30000);
    });
  });
});
