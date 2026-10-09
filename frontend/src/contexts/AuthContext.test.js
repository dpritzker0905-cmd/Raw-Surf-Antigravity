/**
 * AuthContext.test.js
 * Tests for the AuthProvider and useAuth hook.
 * Covers: login, signup, logout, updateUser, refreshUser, token storage, impersonation.
 */

jest.mock('../lib/apiClient', () => ({
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
  defaults: { baseURL: 'http://test' },
}));

import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import apiClient from '../lib/apiClient';

// Helper: wrap with AuthProvider
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: {} });
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.put.mockResolvedValue({ data: {} });
    apiClient.delete.mockResolvedValue({ data: {} });
  });

 // Initial state 

  describe('initial state', () => {
    it('starts with user=null and loading=false when no localStorage', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.user).toBeNull();
    });

    it('rehydrates user from localStorage on mount', async () => {
      const storedUser = { id: 'u1', email: 'test@test.com', access_token: 'tok123' };
      localStorage.setItem('raw-surf-user', JSON.stringify(storedUser));
      
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.user?.id).toBe('u1');
      expect(result.current.user?.access_token).toBe('tok123');
    });
  });

 // Login 

  describe('login', () => {
    it('stores user + token in localStorage after successful login', async () => {
      const mockUser = { id: 'u1', email: 'test@test.com', access_token: 'jwt.signed.token', role: 'Surfer' };
      apiClient.post.mockResolvedValue({ data: mockUser });

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.login('test@test.com', 'Password123!');
      });

      expect(result.current.user?.id).toBe('u1');
      expect(result.current.user?.access_token).toBe('jwt.signed.token');

      const stored = JSON.parse(localStorage.getItem('raw-surf-user'));
      expect(stored?.access_token).toBe('jwt.signed.token');
    });

    it('calls /auth/login with correct credentials', async () => {
      apiClient.post.mockResolvedValue({ data: { id: 'u1', access_token: 'tok' } });
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.login('surfer@rawsurf.com', 'secret');
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        email: 'surfer@rawsurf.com',
        password: 'secret',
      });
    });
  });

 // Signup 

  describe('signup', () => {
    it('stores user in localStorage and sets user state', async () => {
      const mockUser = { id: 'u2', email: 'new@rawsurf.com', role: 'Photographer', access_token: 'new.jwt' };
      apiClient.post.mockResolvedValue({ data: mockUser });

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.signup('new@rawsurf.com', 'pass', 'New User', 'newuser', 'Photographer');
      });

      expect(result.current.user?.role).toBe('Photographer');
      const stored = JSON.parse(localStorage.getItem('raw-surf-user'));
      expect(stored?.email).toBe('new@rawsurf.com');
    });
  });

 // Logout 

  describe('logout', () => {
    it('clears user state and removes all localStorage keys', async () => {
      const storedUser = { id: 'u1', access_token: 'tok' };
      localStorage.setItem('raw-surf-user', JSON.stringify(storedUser));
      localStorage.setItem('isGodMode', 'true');
      localStorage.setItem('impersonation_session', '{}');

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => { result.current.logout(); });

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem('raw-surf-user')).toBeNull();
      expect(localStorage.getItem('isGodMode')).toBeNull();
      expect(localStorage.getItem('impersonation_session')).toBeNull();
    });
  });

 // updateUser 

  describe('updateUser', () => {
    it('merges updates into user state and localStorage', async () => {
      const storedUser = { id: 'u1', username: 'old', access_token: 'tok' };
      localStorage.setItem('raw-surf-user', JSON.stringify(storedUser));

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => { result.current.updateUser({ username: 'newusername', avatar_url: 'https://cdn.img/pic.jpg' }); });

      expect(result.current.user?.username).toBe('newusername');
      // Token must be preserved after update
      expect(result.current.user?.access_token).toBe('tok');
      const stored = JSON.parse(localStorage.getItem('raw-surf-user'));
      expect(stored?.username).toBe('newusername');
    });
  });

 // refreshUser 

  describe('refreshUser', () => {
    it('fetches fresh profile and merges into user without losing token', async () => {
      const storedUser = { id: 'u1', username: 'old', access_token: 'my.token' };
      localStorage.setItem('raw-surf-user', JSON.stringify(storedUser));
      apiClient.get.mockResolvedValue({ data: { id: 'u1', username: 'refreshed', avatar_url: 'http://img' } });

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => { await result.current.refreshUser(); });

      expect(result.current.user?.username).toBe('refreshed');
      // Token must survive the refresh
      expect(result.current.user?.access_token).toBe('my.token');
    });

    it('returns null and does not crash if no user id', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      let res;
      await act(async () => { res = await result.current.refreshUser(); });
      expect(res).toBeNull();
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

 // Development mock identity vs. a backend that refuses it

  // A development build seeds a mock admin whose token only a LOCAL backend accepts; the deployed
  // one refuses it (fail-closed dev_identity_allowed()). After such a refusal sent the tab to the
  // sign-in form, re-seeding handed the auth page a "signed-in" user again: the 2026-10-08 loop.
  describe('development mock identity', () => {
    const realNodeEnv = process.env.NODE_ENV;
    const REJECTED_KEY = 'raw-surf-session-rejected-at';

    beforeEach(() => { sessionStorage.clear(); });
    afterEach(() => { process.env.NODE_ENV = realNodeEnv; });

    it('is seeded in a development build when no session is stored', async () => {
      process.env.NODE_ENV = 'development';
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.user?.id).toBe('dev-mock-user-id');
      expect(JSON.parse(localStorage.getItem('raw-surf-user'))?.access_token).toBe('dev-mock-user-token');
    });

    it('is not re-seeded once a backend has refused this tab\'s session', async () => {
      process.env.NODE_ENV = 'development';
      sessionStorage.setItem(REJECTED_KEY, String(Date.now() - 5 * 60 * 1000));
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem('raw-surf-user')).toBeNull();
    });

    it('a successful login or signup clears the refused-session mark', async () => {
      apiClient.post.mockResolvedValue({ data: { id: 'u1', access_token: 'jwt.signed.token' } });
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      sessionStorage.setItem(REJECTED_KEY, String(Date.now()));
      await act(async () => { await result.current.login('surfer@example.invalid', 'test-only'); });
      expect(sessionStorage.getItem(REJECTED_KEY)).toBeNull();

      sessionStorage.setItem(REJECTED_KEY, String(Date.now()));
      await act(async () => {
        await result.current.signup('new@example.invalid', 'test-only', 'New', 'new', 'Surfer');
      });
      expect(sessionStorage.getItem(REJECTED_KEY)).toBeNull();
    });

    it('a failed login keeps the mark', async () => {
      apiClient.post.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      sessionStorage.setItem(REJECTED_KEY, String(Date.now()));
      await act(async () => {
        await expect(result.current.login('surfer@example.invalid', 'wrong')).rejects.toThrow();
      });
      expect(sessionStorage.getItem(REJECTED_KEY)).not.toBeNull();
    });
  });

 // useAuth guard

  describe('useAuth guard', () => {
    it('throws if useAuth is called outside AuthProvider', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
      spy.mockRestore();
    });
  });
});
