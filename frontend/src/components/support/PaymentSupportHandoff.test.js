import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Bookings } from '../Bookings';
import BookingPaymentSuccess from '../BookingPaymentSuccess';
import DispatchPaymentSuccess from '../DispatchPaymentSuccess';
import apiClient from '../../lib/apiClient';

let mockQuery = '';
const mockNavigate = jest.fn();
const mockUpdateUser = jest.fn();
const mockUser = { id: 'fictional-owner', role: 'Surfer' };
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, useLocation: () => ({ key: "checkout" }),
  useSearchParams: () => [new URLSearchParams(mockQuery), jest.fn()] }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, updateUser: mockUpdateUser }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('../RequestProSelfieModal', () => ({ RequestProSelfieModal: () => null }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: role => role }) }));
jest.mock('../../hooks/useBookingsActions', () => () => ({ fetchData: jest.fn() }));
jest.mock('../bookings/index', () => ({}));
jest.mock('../bookings/BookingsModals', () => () => null);
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

beforeEach(() => { jest.clearAllMocks(); mockQuery = ''; apiClient.get.mockRejectedValue({ response: { status: 400 } }); });

describe.each([
  ['booking', BookingPaymentSuccess, 'booking_id', 'scheduled'],
  ['dispatch', DispatchPaymentSuccess, 'dispatch_id', 'on_demand'],
])('%s payment support handoff', (_kind, Page, parameter, tab) => {
  test('missing references lead to support inbox with no automatic API write', async () => {
    render(<Page />); await screen.findByRole('heading', { name: 'Something Went Wrong' });
    fireEvent.click(screen.getByRole('button', { name: 'Contact Support' }));
    expect(mockNavigate.mock.calls).toEqual([['/support']]);
    expect(apiClient.get).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('failed confirmation hands off without retrying payment or forwarding references', async () => {
    mockQuery = `session_id=fictional-provider-reference&${parameter}=44444444-4444-4444-8444-444444444444`;
    render(<Page />); await screen.findByRole('heading', { name: 'Something Went Wrong' });
    const reads = apiClient.get.mock.calls.length; expect(reads).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Contact Support' }));
    expect(mockNavigate.mock.calls).toEqual([['/support']]);
    expect(apiClient.get).toHaveBeenCalledTimes(reads); expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('View Bookings retains its existing tab/reference destination', async () => {
    mockQuery = `${parameter}=44444444-4444-4444-8444-444444444444`;
    render(<Page />); await screen.findByRole('heading', { name: 'Something Went Wrong' });
    fireEvent.click(screen.getByRole('button', { name: 'View Bookings' }));
    expect(mockNavigate).toHaveBeenCalledWith(`/bookings?tab=${tab}&highlight=44444444-4444-4444-8444-444444444444`);
  });
});

test('a verified live checkout opens its existing case without a second payment request', async () => {
  const ticket = '44444444-4444-4444-8444-444444444444';
  mockQuery = 'session_payment=success&checkout_session_id=fictional-checkout';
  apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: {
    detail: 'Open your support ticket', support_ticket_id: ticket,
  } } });
  render(<Bookings />);
  await waitFor(() => expect(mockNavigate.mock.calls).toEqual([[`/support/tickets/${ticket}`, { replace: true }]]));
  expect(apiClient.post.mock.calls).toEqual([['/sessions/complete-payment', { checkout_session_id: 'fictional-checkout' }]]);
});
