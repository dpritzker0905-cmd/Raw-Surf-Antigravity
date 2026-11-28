import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RequestProModal } from '../map/RequestProModal';
import { OnDemandRequestDrawer } from '../OnDemandRequestDrawer';
import apiClient from '../../lib/apiClient';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'buyer' }, updateUser: jest.fn() }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('../../hooks/useHapticFeedback', () => () => jest.fn());
jest.mock('../map/RequestProCrewPanel', () => props =>
  <button onClick={() => props.addCrewMember({ id: 'alex', full_name: 'Alex' })}>Choose Alex</button>);
jest.mock('../on-demand/OnDemandEarlySteps', () => ({
  TimingStep: ({ booking }) => booking.step === 'timing' &&
    <button onClick={() => {booking.handleSelectFriend({ id: 'alex', full_name: 'Alex' }); booking.setStep('confirm');}}>
      Choose Alex
    </button>,
  DurationStep: () => null, LocationStep: () => null, SplitChoiceStep: () => null,
}));
jest.mock('../on-demand/OnDemandStepPanels', () => ({ CrewStepPanel: () => null, CrewPaymentStepPanel: () => null }));
jest.mock('../RequestProSelfieModal', () => ({ RequestProSelfieModal: () => null }));

const pro = { id: 'pro', full_name: 'Test Photographer', on_demand_hourly_rate: 75,
  min_session_hours: 1, price_per_additional_surfer: 15 };
const covered = { gross_cents: 9000, total_cents: 4500, captain_cents: 0, crew_cents: { alex: 4500 },
  subscription_covered: true, benefit_cents: 4500, quote_id: 'covered' };

it.each(['map', 'drawer'])('confirms the server split in the %s and skips card checkout for a covered captain', async entry => {
  const close = jest.fn();
  apiClient.get.mockResolvedValue({ data: { balance: 0 } });
  const paths = [];
  apiClient.post.mockImplementation(async (path, body) => {
    paths.push(path);
    if (path === '/dispatch/shared-quote') {
      expect(body.friend_ids).toEqual(['alex']);
      return { data: covered };
    }
    if (path === '/dispatch/request?requester_id=buyer') {
      expect(body.accepted_shared_quote).toBe('covered');
      return { data: { id: 'dispatch', shared_quote: covered, captain_share_amount: 0 } };
    }
    if (path === '/dispatch/dispatch/pay?payer_id=buyer') return { data: { remaining_credits: 0 } };
    throw new Error('Unexpected payment path');
  });
  const props = { isOpen: true, onClose: close, userLocation: { lat: 33, lng: -117 } };
  render(entry === 'map'
    ? <RequestProModal {...props} userId="buyer" onDemandPhotographers={[pro]} />
    : <OnDemandRequestDrawer {...props} photographer={pro} />);
  if (entry === 'map') fireEvent.click(screen.getByText(pro.full_name));
  fireEvent.click(screen.getByText('Choose Alex'));
  if (entry === 'map') fireEvent.click(screen.getByTestId('request-pro-continue'));
  const review = await screen.findByRole('region', { name: 'Crew price' });
  expect(review).toHaveTextContent('You pay $0.00');
  expect(review).toHaveTextContent('Alex owes $45.00');
  expect(within(review).getByText(/1 included session/)).toBeVisible();
  expect(screen.queryByText('Payment Method')).toBeNull();
  expect(paths).toEqual(['/dispatch/shared-quote']);
  fireEvent.click(screen.getByRole('button', { name: entry === 'map' ? 'Confirm request' : 'Send Request' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(paths.slice(1)).toEqual(['/dispatch/request?requester_id=buyer', '/dispatch/dispatch/pay?payer_id=buyer']);
});

it('stops after a stale quote and shows the new amount before any payment', async () => {
  apiClient.get.mockResolvedValue({ data: { balance: 0 } });
  const updated = { ...covered, total_cents: 9000, captain_cents: 4500, benefit_cents: 0,
    subscription_covered: false, quote_id: 'updated' };
  let quoteCount = 0;
  const paths = [];
  apiClient.post.mockImplementation(async path => {
    paths.push(path);
    if (path === '/dispatch/shared-quote') return { data: ++quoteCount === 1 ? covered : updated };
    throw Object.assign(new Error('reprice'), { response: { data: { detail: { code: 'shared_price_changed' } } } });
  });
  render(<RequestProModal isOpen onClose={jest.fn()} userId="buyer"
    userLocation={{ lat: 33, lng: -117 }} onDemandPhotographers={[pro]} />);
  fireEvent.click(screen.getByText(pro.full_name));
  fireEvent.click(screen.getByText('Choose Alex'));
  fireEvent.click(screen.getByTestId('request-pro-continue'));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm request' }));
  expect(await screen.findByRole('button', { name: 'Pay $45.00 with Card' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Crew price' })).toHaveTextContent('Alex owes $45.00');
  expect(paths).toEqual(['/dispatch/shared-quote', '/dispatch/request?requester_id=buyer', '/dispatch/shared-quote']);
});
