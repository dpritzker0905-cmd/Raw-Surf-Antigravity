import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiClient from '../lib/apiClient';
import { ForgotPassword } from './PasswordReset';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams()],
}), { virtual: true });
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), debug: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

// Audit 2026-10-24, T-04: the screen rendered a one-click "reset password" button straight from fields in the
// forgot-password response. The token is a credential and travels by email only; the screen must never act on one,
// even if a server (or an old build of it) still sent the fields.
test('after sending, the screen says to check email and renders no reset shortcut, whatever the response holds', async () => {
  apiClient.post.mockResolvedValue({
    data: { success: true, _dev_token: 'synthetic-token-123', _dev_reset_link: 'https://x.invalid/reset-password?token=synthetic-token-123' },
  });
  const { container } = render(<ForgotPassword />);
  fireEvent.change(screen.getByTestId('forgot-email-input'), { target: { value: 'someone@example.com' } });
  fireEvent.click(screen.getByTestId('forgot-submit'));

  await waitFor(() => expect(screen.getByText(/you'll receive a password reset link shortly/i)).toBeTruthy());
  expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'someone@example.com' });
  expect(screen.getByText('Back to Login')).toBeTruthy();
  expect(screen.queryByText(/dev mode/i)).toBeNull();
  expect(screen.queryByText(/click here to reset password/i)).toBeNull();
  expect(container.innerHTML).not.toContain('synthetic-token-123');
  expect(container.querySelectorAll('a[href*="reset-password"]').length).toBe(0);
});
