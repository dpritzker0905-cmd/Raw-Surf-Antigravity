/**
 * LOGOUT STOPS THE LEAVING ACCOUNT'S PUSH ON THIS DEVICE (#470, 2026-10-23).
 *
 * On a shared browser the push endpoint stays for whoever signs in next, and the backend keys rows by (user, endpoint):
 * before this, account A's pushes kept arriving on the device after A logged out. Logout now asks the backend to drop
 * A's row for this device, with A's OWN token, read before the stored session is cleared.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockForget = jest.fn();
jest.mock('../hooks/usePushNotifications', () => ({ forgetThisDeviceForAccount: (...a) => mockForget(...a) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));

import { AuthProvider, useAuth } from './AuthContext';

const LogoutButton = () => {
  const { user, logout } = useAuth();
  return <button type="button" onClick={logout}>{user ? `log out ${user.id}` : 'signed out'}</button>;
};

beforeEach(() => {
  localStorage.clear();
  mockForget.mockReset();
});

it('logout drops this device for the leaving account, with that account\'s own token', () => {
  localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'account-a', username: 'a', access_token: 'token-of-a' }));
  mockForget.mockImplementation(() => {
    // Read before the session is cleared: the token is the leaving account's.
    expect(localStorage.getItem('raw-surf-user')).not.toBeNull();
    return Promise.resolve(true);
  });
  render(<AuthProvider><LogoutButton /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'log out account-a' }));
  expect(mockForget).toHaveBeenCalledTimes(1);
  expect(mockForget).toHaveBeenCalledWith('token-of-a');
  expect(localStorage.getItem('raw-surf-user')).toBeNull();
  expect(screen.getByRole('button', { name: 'signed out' })).toBeInTheDocument();
});

it('a session without a token logs out without a push call', () => {
  localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'account-a', username: 'a' }));
  render(<AuthProvider><LogoutButton /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'log out account-a' }));
  expect(mockForget).not.toHaveBeenCalled();
  expect(localStorage.getItem('raw-surf-user')).toBeNull();
});
