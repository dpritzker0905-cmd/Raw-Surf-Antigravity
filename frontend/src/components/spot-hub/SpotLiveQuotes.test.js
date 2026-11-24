import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import BookingTypeModal from './BookingTypeModal';
import SpotHubPhotographers from './SpotHubPhotographers';
import SpotReportContent from '../spot-drawer/SpotReportContent';
import { JumpInSessionModal } from '../JumpInSessionModal';

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark' }), useThemeName: () => 'dark',
}));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'buyer', role: 'surfer', credit_balance: 100 },
}) }));
jest.mock('../SpotConditions', () => ({ SpotConditions: () => null }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));

it.each([
  [0, 40, 0], [40, 15, 40], [null, 17, 17], [null, 0, 0], [null, null, 25],
])('quotes live %s and legacy %s as $%s from discovery through checkout', (live, legacy, price) => {
  const photographer = {
    id: 'pro', full_name: 'Fixture photographer', is_shooting: true,
    session_price: legacy, live_buyin_price: live,
  };
  const hub = render(<SpotHubPhotographers activePhotographers={[photographer]} isWithinProximity />);
  expect(screen.getByText(`$${price}`)).toBeVisible();
  hub.unmount();

  const drawer = render(<SpotReportContent spot={{ id: 'spot' }}
    activeShooters={[photographer]} isWithinGeofence conditionReports={[]} proPhotos={[]}
    communityPhotos={[]} />);
  expect(within(screen.getByTestId('photographer-card-pro')).getByText(`$${price} buy-in`)).toBeVisible();
  drawer.unmount();

  const choice = render(<BookingTypeModal photographer={photographer} isOpen />);
  expect(within(screen.getByTestId('booking-option-live_active')).getByText(`$${price}/session`)).toBeVisible();
  choice.unmount();

  render(<JumpInSessionModal photographer={photographer} onClose={jest.fn()} onSuccess={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /skip selfie/i }));
  expect(screen.getByText(price === 0 ? 'Join for free' : `Pay $${price.toFixed(2)} & Join`)).toBeEnabled();
});
