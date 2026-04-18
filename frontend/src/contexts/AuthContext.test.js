/**
 * AuthContext.test.js
 * Tests for the AuthProvider and useAuth hook.
 * Covers: login, signup, logout, updateUser, refreshUser, token storage, impersonation.
 */

jest.mock('../lib/apiClient', () => ({
  get: jest.fn(),
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
import { render, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import apiClient from '../lib/apiClient';

// Helper: wrap with AuthProvider
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  // ── Initial state ────────────────────────────────────────────────────────────

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

  // ── Login ────────────────────────────────────────────────────────────────────

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

  // ── Signup ───────────────────────────────────────────────────────────────────

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

  // ── Logout ───────────────────────────────────────────────────────────────────

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

  // ── updateUser ───────────────────────────────────────────────────────────────

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

  // ── refreshUser ──────────────────────────────────────────────────────────────

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

  // ── useAuth guard ──────────────────────────────────────────────────────────

  describe('useAuth guard', () => {
    it('throws if useAuth is called outside AuthProvider', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
      spy.mockRestore();
    });
  });
});
