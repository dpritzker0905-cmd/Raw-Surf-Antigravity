import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HubJumpInFlow from './JumpInFlow';
import DrawerJumpInFlow from '../spot-drawer/JumpInFlow';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';

const mockUpdateUser = jest.fn();
const mockNavigate = jest.fn();
let mockTheme = 'dark';
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'surfer-fixture', role: 'surfer', credit_balance: 100 }, updateUser: mockUpdateUser,
}) }));
jest.mock('../../contexts/PersonaContext', () => ({ usePersona: () => ({
  getEffectiveRole: role => role, isGodMode: false, activePersona: null,
}) }));
jest.mock('../../contexts/ThemeContext', () => ({ useThemeName: () => mockTheme }));
jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../spot-drawer/SpotDrawerHelpers', () => ({ CAMERA_AUTHORIZED_KEY: 'raw_surf_camera_authorized' }));
jest.mock('../../utils/liveSessionCheckout', () => ({
  navigateToLiveCheckout: url => mockNavigate(url),
}), { virtual: true });

const photographer = { id: 'pro-fixture', full_name: 'Fixture Pro', session_price: 25 };
const pending = { requires_payment: true, checkout_url: 'https://checkout.stripe.com/c/pay/fixture', session_id: 'cs_fixture' };
const joined = { session_id: 'participant-fixture', check_in_created: true, remaining_credits: 75 };
function setup(Component, method = 'card') {
  const onSuccess = jest.fn();
  const view = render(<Component photographer={photographer} onBack={jest.fn()} onSuccess={onSuccess} />);
  fireEvent.click(screen.getAllByText(/Skip selfie/)[0]);
  if (method === 'card') fireEvent.click(screen.getByText('Pay with Card'));
  return { ...view, onSuccess, pay: () => fireEvent.click(screen.getByTestId('pay-now-btn')) };
}
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem('raw_surf_camera_authorized', 'true');
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }),
  } });
});
afterEach(() => { localStorage.clear(); mockTheme = 'dark'; jest.useRealTimers(); });

describe.each([['hub', HubJumpInFlow], ['drawer', DrawerJumpInFlow]])('%s live checkout', (_, Component) => {
  it.each(['light', 'dark', 'beach'])('redirects card checkout without claiming entitlement in %s', async theme => {
    mockTheme = theme;
    apiClient.post.mockResolvedValue({ data: pending });
    const { pay, onSuccess } = setup(Component);
    pay();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(pending.checkout_url));
    expect(screen.getByRole('status')).toHaveTextContent(/not joined.*verified/i);
    expect(screen.getByRole('status').parentElement).toHaveClass({ light: 'bg-white', dark: 'bg-zinc-900', beach: 'bg-black' }[theme]);
    expect(screen.queryByText("You're In!")).toBeNull();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /continue.*checkout/i })).toHaveAttribute('href', pending.checkout_url);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('ignores repeat clicks while the join request is in flight', async () => {
    let resolve;
    apiClient.post.mockReturnValue(new Promise(r => { resolve = r; }));
    const { pay } = setup(Component);
    pay(); pay();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: pending }); });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...pending, checkout_url: undefined },
    { ...pending, checkout_url: 'javascript:alert(1)' },
    { ...pending, session_id: undefined },
    {},
  ])('rejects incomplete or invalid checkout responses without false success', async data => {
    apiClient.post.mockResolvedValue({ data });
    const { pay, onSuccess } = setup(Component);
    pay();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText("You're In!")).toBeNull();
    expect(screen.getByTestId('pay-now-btn')).not.toBeDisabled();
  });

  it('keeps the payment choice and permits retry after a failed request', async () => {
    apiClient.post.mockRejectedValueOnce({ response: { data: { detail: 'Checkout unavailable' } } })
      .mockResolvedValueOnce({ data: pending });
    const { pay } = setup(Component);
    pay();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Checkout unavailable'));
    pay();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('does not navigate a cancelled view when an in-flight request resolves', async () => {
    let resolve;
    apiClient.post.mockReturnValue(new Promise(r => { resolve = r; }));
    const { pay, unmount, onSuccess } = setup(Component);
    pay(); unmount();
    await act(async () => { resolve({ data: pending }); });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('retains a retry link to the same checkout if browser navigation is unavailable', async () => {
    apiClient.post.mockResolvedValue({ data: pending });
    mockNavigate.mockImplementationOnce(() => { throw new Error('Navigation unavailable'); });
    const { pay, onSuccess } = setup(Component);
    pay();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Navigation unavailable'));
    expect(screen.getByRole('link', { name: /continue.*checkout/i })).toHaveAttribute('href', pending.checkout_url);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('preserves confirmed credit wallet updates and success callback', async () => {
    jest.useFakeTimers();
    apiClient.post.mockResolvedValue({ data: joined });
    const { pay, onSuccess } = setup(Component, 'credits');
    await act(async () => { pay(); });
    expect(mockUpdateUser).toHaveBeenCalledWith({ credit_balance: 75 });
    expect(screen.getByText("You're In!")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(onSuccess).toHaveBeenCalledWith(joined);
  });

  it('cancels the delayed success callback when the view closes', async () => {
    jest.useFakeTimers();
    apiClient.post.mockResolvedValue({ data: joined });
    const { pay, unmount, onSuccess } = setup(Component, 'credits');
    await act(async () => { pay(); });
    unmount();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
