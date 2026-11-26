import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Bookings } from './Bookings';
import useBookingsActions from '../hooks/useBookingsActions';

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
  expect(screen.queryByTestId('booking-card-other')).toBeNull();
  expect(screen.queryByTestId('booking-card-on-demand')).toBeNull();
  expect(screen.queryByText(/Add a Selfie for Better Photos/)).toBeNull();
});
