import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JumpInSessionModal } from './JumpInSessionModal';
import apiClient from '../lib/apiClient';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'buyer', credit_balance: 0 }, updateUser: jest.fn() }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

test('mounted card flow resumes a lost checkout after the modal is reopened', async () => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
  sessionStorage.clear();
  apiClient.post.mockRejectedValue({ response: { status: 502, data: { detail: { checkout_intent_id: 'intent-1', message: 'Retry this purchase' } } } });
  const modal = () => <JumpInSessionModal photographer={{ id: 'pro', full_name: 'Photographer' }} onClose={() => {}} />;
  const first = render(modal());
  const pay = () => {
    fireEvent.click(screen.getByText('Skip Selfie & Join'));
    fireEvent.click(screen.getByRole('button', { name: 'Credit Card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Loader2' }));
  };
  pay();
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post.mock.calls[0][2].headers['Idempotency-Key']).toHaveLength(36);
  first.unmount();
  render(modal()); pay();
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
  expect(apiClient.post.mock.calls[1][0]).toBe('/payments/checkout-intents/intent-1/resume');
});
