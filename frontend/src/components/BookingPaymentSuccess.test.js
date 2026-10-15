import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BookingPaymentSuccess from './BookingPaymentSuccess';
import apiClient from '../lib/apiClient';

let mockUser = { id: 'buyer' };
const mockUpdateUser = jest.fn();
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('session_id=receipt&booking_id=booking')],
  useNavigate: () => mockNavigate,
}), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, updateUser: mockUpdateUser }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
const page = () => <BookingPaymentSuccess />;

beforeEach(() => { jest.useFakeTimers(); mockUser = { id: 'buyer' }; apiClient.get.mockReset(); sessionStorage.clear(); });
afterEach(() => { jest.useRealTimers(); });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

test('waits for authenticated identity before confirming a booking receipt', async () => {
  mockUser = null;
  apiClient.get.mockResolvedValue({ data: { success: true } });
  render(page()); await settle();
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('confirmed booking does not invent an XP award absent from the receipt', async () => {
  apiClient.get.mockResolvedValue({ data: { success: true, booking_id: 'booking', status: 'Confirmed' } });
  render(page()); await settle();
  expect(screen.getByRole('heading', { name: 'Session Booked!' })).toBeInTheDocument();
  expect(screen.queryByText(/XP earned/i)).not.toBeInTheDocument();
});

test('transient confirmation failures have a bounded retry budget', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 503 } });
  render(page()); await settle();
  for (let n = 0; n < 10; n++) {
    await act(async () => { jest.advanceTimersByTime(2000); await Promise.resolve(); });
  }
  expect(apiClient.get).toHaveBeenCalledTimes(6);
});

test('reconciliation is a review state and does not retry or claim success', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 409, data: { detail: { reconciliation_required: true } } } });
  render(page()); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent(/payment needs review/i);
  await act(async () => { jest.advanceTimersByTime(12000); });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Session Booked!')).not.toBeInTheDocument();
});

test('Check Again starts exactly one fresh bounded confirmation cycle', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 503 } });
  render(page()); await settle();
  for (let n = 0; n < 5; n++) await act(async () => { jest.advanceTimersByTime(2000); });
  expect(apiClient.get).toHaveBeenCalledTimes(6);
  fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
  await settle();
  expect(apiClient.get).toHaveBeenCalledTimes(7);
});

test.each([
  ['refunded', 'Payment refunded'],
  ['refund_pending', 'Refund pending'],
])('links %s receipt state without claiming booking success or retrying', async (state, heading) => {
  sessionStorage.setItem('raw-surf:checkout:buyer:scheduled:pro', JSON.stringify({ sessionId: 'receipt' }));
  sessionStorage.setItem('raw-surf:checkout:other:scheduled:pro', JSON.stringify({ sessionId: 'receipt' }));
  apiClient.get.mockRejectedValue({ response: { status: 409, data: {
    detail: { reconciliation_required: true, state },
  } } });
  render(page()); await settle();
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/not confirmed/i);
  expect(screen.queryByText('Session Booked!')).not.toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(12000); });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem('raw-surf:checkout:buyer:scheduled:pro') === null).toBe(state === 'refunded');
  expect(sessionStorage.getItem('raw-surf:checkout:other:scheduled:pro')).not.toBeNull();
});
