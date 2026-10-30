import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Auth } from '../Auth';

let mockUser = null;
let mockQuery = '';
const mockNavigate = jest.fn();
const mockParams = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(mockQuery), mockParams],
}), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, login: jest.fn(), signup: jest.fn() }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../lib/sessionRejection', () => ({ wasSessionRejected: () => false }));
jest.mock('../security/MfaSignInSteps', () => ({ MfaChallengeStep: () => null, MfaSetupStep: () => null, PasskeySignInButton: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const path = '/support/tickets/44444444-4444-4444-8444-444444444444';
beforeEach(() => { jest.clearAllMocks(); mockUser = null; mockQuery = `tab=signup&redirect=${encodeURIComponent(path)}`; });
test('actual signed-in Auth returns to the ticket instead of feed', async () => {
  mockUser = { id: 'fixture-owner' }; render(<Auth />);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(path, { replace: true }));
  expect(mockNavigate).not.toHaveBeenCalledWith('/feed', expect.anything());
});
test('actual auth tab and category handlers retain the support return', () => {
  const view = render(<Auth />);
  fireEvent.click(screen.getByTestId('login-tab'));
  expect(mockParams).toHaveBeenCalledWith({ tab: 'login', redirect: path });
  fireEvent.click(screen.getByTestId('category-surfer'));
  expect(mockParams).toHaveBeenCalledWith({ tab: 'signup', category: 'surfer', redirect: path });
  mockQuery = `tab=signup&category=surfer&redirect=${encodeURIComponent(path)}`; view.rerender(<Auth />);
  fireEvent.click(screen.getByTestId('back-to-categories'));
  expect(mockParams).toHaveBeenCalledWith({ tab: 'signup', redirect: path });
});
test('signed-in non-support auto-forward retains existing feed behavior', async () => {
  mockUser = { id: 'fixture-owner' }; mockQuery = 'tab=login&redirect=https://outside.invalid'; render(<Auth />);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/feed', { replace: true }));
});
