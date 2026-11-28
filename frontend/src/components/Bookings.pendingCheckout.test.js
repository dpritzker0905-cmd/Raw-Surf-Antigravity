import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Bookings } from './Bookings';
import useBookingsActions from '../hooks/useBookingsActions';
import apiClient from '../lib/apiClient';
import { navigateToCheckout } from '../utils/checkoutUrl';
import { PendingCheckoutActions } from './bookings/PendingCheckoutActions';

jest.mock('../lib/apiClient', () => ({ post: jest.fn() }));
jest.mock('../utils/checkoutUrl', () => ({ ...jest.requireActual('../utils/checkoutUrl'), navigateToCheckout: jest.fn() }));

jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'buyer', role: 'Surfer' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: role => role }) }));
jest.mock('../hooks/useBookingsActions');
jest.mock('./bookings/BookingsModals', () => () => null);
jest.mock('./bookings/BookingsTabStrip', () => ({ BookingsTabStrip: () => null }));
jest.mock('./BookingSelfieModal', () => ({ BookingSelfieModal: () => null }));
jest.mock('./SessionActionDrawer', () => ({ SessionActionDrawer: () => null }));
jest.mock('./CrewHub', () => () => null);
jest.mock('./CrewPaymentDashboard', () => ({ CrewPaymentDashboard: () => null }));
jest.mock('./bookings/index', () => ({
  ScheduledTab: jest.requireActual('./bookings/ScheduledTab').ScheduledTab,
  LineupTab: () => null, LiveSessionsTab: () => null, OnDemandTab: () => null,
  FindBuddiesTab: () => null, PastTab: () => null, LiveNowTab: () => null,
  DirectoryTab: () => null, SubscriptionsTab: () => null,
}));

it('shows the buyer their pending checkout on the scheduled recovery link', async () => {
  const pending = {
    id: 'checkout', status: 'Pending Payment', creator_id: 'buyer', booking_type: 'scheduled',
    session_date: '2099-01-05T12:00:00Z', location: 'Fixture beach', duration: 60,
    paid_amount: 10, participants: [{ participant_id: 'buyer' }],
  };
  useBookingsActions.mockImplementation(({ setBookings, setLoading }) => ({
    fetchData: () => {
      setBookings([pending, { ...pending, id: 'other', creator_id: 'other' },
        { ...pending, id: 'on-demand', booking_type: 'on_demand' }]);
      setLoading(false);
    },
  }));
  render(<MemoryRouter initialEntries={['/bookings?tab=scheduled']}><Bookings /></MemoryRouter>);
  const card = await screen.findByTestId('booking-card-checkout');
  expect(within(card).getByText('Pending Payment')).toBeVisible();
  expect(within(card).getByText('Fixture beach')).toBeVisible();
  apiClient.post.mockResolvedValueOnce({ data: { status: 'open', checkout_url: 'https://checkout.stripe.com/c/pay/original' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Resume checkout' }));
  await waitFor(() => expect(navigateToCheckout).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/original'));
  expect(apiClient.post).toHaveBeenCalledWith('/bookings/checkout/pending-checkout', { action: 'resume' }, expect.anything());
  expect(screen.queryByTestId('booking-card-other')).toBeNull();
  expect(screen.queryByTestId('booking-card-on-demand')).toBeNull();
  expect(screen.queryByText(/Add a Selfie for Better Photos/)).toBeNull();
});

it.each(['Cancelled', 'Confirmed'])('refreshes after a confirmed cancel request returns %s', async status => {
  const refresh = jest.fn();
  apiClient.post.mockResolvedValueOnce({ data: { status } });
  render(<PendingCheckoutActions bookingId="existing" onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel checkout' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep checkout' }));
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel checkout' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith('/bookings/existing/pending-checkout', { action: 'cancel' }, expect.anything());
  expect(screen.getByRole('status')).toHaveTextContent(status === 'Cancelled' ? 'Checkout cancelled' : 'Payment received');
  expect(navigateToCheckout).not.toHaveBeenCalled();
});

it('allows retry after an unavailable checkout and suppresses a late redirect after unmount', async () => {
  let finish;
  apiClient.post.mockRejectedValueOnce({ response: { data: { detail: 'Try again.' } } })
    .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(<PendingCheckoutActions bookingId="old" />);
  const resume = screen.getByRole('button', { name: 'Resume checkout' });
  fireEvent.click(resume);
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again.');
  fireEvent.click(resume);
  expect(resume).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel checkout' })).toBeDisabled();
  unmount();
  await act(async () => finish({ data: { status: 'open', checkout_url: 'https://checkout.stripe.com/c/pay/old' } }));
  expect(navigateToCheckout).not.toHaveBeenCalled();
});

it('keeps the buyer on the booking when the resume response has no usable checkout link', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { status: 'open', checkout_url: '/no-checkout' } });
  render(<PendingCheckoutActions bookingId="existing" />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume checkout' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm checkout');
  expect(screen.getByRole('button', { name: 'Resume checkout' })).toBeEnabled();
  expect(navigateToCheckout).not.toHaveBeenCalled();
});
