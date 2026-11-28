import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import useOnDemandBooking from '../../hooks/useOnDemandBooking';
import OnDemandRequestDrawer from '../OnDemandRequestDrawer';
import CrewCardPaymentSuccess from '../CrewCardPaymentSuccess';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams('session_id=fixture')],
}), { virtual: true });
jest.mock('sonner', () => ({ toast: { info: jest.fn(), error: jest.fn() } }));
jest.mock('../../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../hooks/useOnDemandBooking');
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'guest' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../RequestProSelfieModal', () => ({ RequestProSelfieModal: () => null }));

it('shows the shared hold terms and reports the actual cancellation result', async () => {
  const onClose = jest.fn();
  useOnDemandBooking.mockReturnValue({
    step: 'waiting', requestId: 'dispatch', sharedQuickBook: true, showCancelConfirm: true,
    captainPayAmount: 0, crewMembers: [], countdown: 120, user: { id: 'captain' },
  });
  const message = 'Session cancelled. Payments and any included session are held for settlement.';
  apiClient.post.mockResolvedValue({ data: { settlement_status: 'pending_settlement', message } });
  render(<OnDemandRequestDrawer isOpen photographer={{ id: 'pro' }} onClose={onClose} />);
  expect(screen.getByText(/If the photographer has accepted, payments and any included session/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Yes, Cancel'));
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith(message));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('shows the held card receipt without offering another checkout', async () => {
  apiClient.get.mockResolvedValue({ data: { status: 'pending_settlement' } });
  render(<CrewCardPaymentSuccess />);
  expect(await screen.findByRole('heading', { name: 'Crew payment held for settlement' })).toBeInTheDocument();
  expect(screen.getByText('Your card payment is held while the cancelled session is reviewed.')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
