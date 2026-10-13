/**
 * The auth page forwards a signed-in visitor to /feed -- unless a 401 just sent the tab here. Then
 * the "signed-in" user is one the backend has refused (a stale token, the re-seeded development
 * mock), and forwarding it restarts the 401 -> /auth -> /feed loop of 2026-10-08.
 * The whole cycle is replayed in authRedirectLoop.test.js.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { Auth } from '../components/Auth';

const mockNavigate = jest.fn();
let mockUser = null;
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, login: jest.fn(), signup: jest.fn() }),
}));
// Routing is the test boundary: what matters is whether the page ASKS to leave.
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams('tab=login'), jest.fn()],
}), { virtual: true });

const SIGNED_IN = { id: 'u1', role: 'Surfer', access_token: 'a-token' };

beforeEach(() => {
  mockNavigate.mockClear();
  sessionStorage.clear();
  mockUser = SIGNED_IN;
});

it('forwards a signed-in visitor to the feed', () => {
  render(<Auth />);
  expect(mockNavigate).toHaveBeenCalledWith('/feed', { replace: true });
});

it('after a 401 redirect, shows the sign-in form instead of forwarding the refused session', () => {
  sessionStorage.setItem('raw-surf-session-rejected-at', String(Date.now()));
  const { container } = render(<Auth />);

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="email"]')).not.toBeNull();
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
});

it('a visitor with no session is never forwarded', () => {
  mockUser = null;
  render(<Auth />);
  expect(mockNavigate).not.toHaveBeenCalled();
});
