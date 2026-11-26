import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { navigateToCheckout } from '../utils/checkoutUrl';
import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';

const mockUpdateUser = jest.fn();
jest.mock('../utils/checkoutUrl', () => ({
  ...jest.requireActual('../utils/checkoutUrl'), navigateToCheckout: jest.fn(),
}));
jest.mock('../lib/apiClient', () => ({ post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'buyer', credit_balance: 100 }, updateUser: mockUpdateUser,
}) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('../hooks/useHapticFeedback', () => () => jest.fn());
jest.mock('./ui/slider', () => ({ Slider: () => null }));
jest.mock('./ExactTimeSlotPicker', () => ({ ExactTimeSlotPicker: ({ onDateChange, onTimeChange, onCategoryChange }) =>
  <button onClick={() => {
    onDateChange(new Date(2030, 0, 5)); onTimeChange('12:00'); onCategoryChange('Surf');
  }}>Choose slot</button> }));
jest.mock('./booking/ImpactZonePicker', () => ({ onLocationChange }) =>
  <button onClick={() => onLocationChange({ description: 'Fixture beach' })}>Choose beach</button>);
jest.mock('./booking/BookingPaymentStep', () => ({ setPaymentMethod, setAppliedCredits }) => <>
  <button onClick={() => setPaymentMethod('credits')}>Use credits</button>
  <button onClick={() => setAppliedCredits(5)}>Apply partial credits</button>
</>);
jest.mock('./booking/BookingSelfieStep', () => ({ BookingSelfieStep: ({ setStep }) =>
  <button onClick={() => setStep('confirm')}>Skip selfie</button> }));
jest.mock('./booking/ScheduledBookingHelpers', () => ({
  DURATION_PRICES: { 60: 1 }, CrossSellSuggestion: () => null, CrewSplitSection: () => null,
  BookingConfirmation: () => <p>Booking confirmed</p>,
}));

const photographer = { id: 'pro', session_price: 25 };
const checkout = { booking_id: 'booking', session_id: 'session', checkout_url: 'https://checkout.stripe.com/c/pay/fixture', credits_applied: 5, remaining_credits: 95 };
const booking = { booking: { id: 'booking' }, remaining_credits: 75 };
const endpoints = () => apiClient.post.mock.calls.map(([url]) => url);
function prepare(choice) {
  const view = render(<ScheduledBookingDrawer isOpen photographer={photographer} onClose={jest.fn()} />);
  fireEvent.click(screen.getByText('Choose slot'));
  fireEvent.click(screen.getByTestId('continue-to-location-btn'));
  fireEvent.click(screen.getByText('Choose beach'));
  fireEvent.click(screen.getByTestId('continue-to-crew-btn'));
  fireEvent.click(screen.getByTestId('continue-to-payment-btn'));
  if (choice) fireEvent.click(screen.getByText(choice));
  fireEvent.click(screen.getByTestId('review-booking-btn'));
  fireEvent.click(screen.getByText('Skip selfie'));
  return view;
}
const submit = () => fireEvent.click(screen.getByTestId('confirm-booking-btn'));
beforeEach(() => { jest.resetAllMocks(); });

it.each([undefined, '', '/missing', 'http://example.invalid/session'])(
  'never sends a second create when paid checkout returns URL %p', async checkout_url => {
    apiClient.post.mockResolvedValueOnce({ data: { ...checkout, checkout_url } })
      .mockResolvedValueOnce({ data: booking });
    prepare('Apply partial credits');
    await act(async () => { submit(); });
    expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
    expect(screen.getByRole('link', { name: /check.*bookings/i })).toHaveAttribute('href', '/bookings?tab=scheduled');
    expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
    expect(screen.queryByText('Booking confirmed')).toBeNull();
    expect(mockUpdateUser).toHaveBeenCalledWith({ credit_balance: 95 });
    expect(navigateToCheckout).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  },
);

it('retains one pending checkout and applies its reported partial-credit balance', async () => {
  apiClient.post.mockResolvedValueOnce({ data: checkout });
  prepare('Apply partial credits');
  await act(async () => { submit(); });
  expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
  expect(screen.getByRole('link', { name: /continue to checkout/i })).toHaveAttribute('href', checkout.checkout_url);
  expect(mockUpdateUser).toHaveBeenCalledWith({ credit_balance: 95 });
  expect(navigateToCheckout).toHaveBeenCalledWith(checkout.checkout_url);
  expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
  expect(toast.success).not.toHaveBeenCalled();
});

it.each([new Error('Connection lost'), { response: { status: 503 } }, { response: { status: 408 } }])(
  'offers recovery when the booking outcome is unknown', async error => {
    apiClient.post.mockRejectedValueOnce(error);
    prepare(); submit();
    expect(await screen.findByRole('link', { name: /check scheduled bookings/i })).toBeInTheDocument();
    expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    expect(screen.queryByRole('link', { name: /continue to checkout/i })).toBeNull();
    expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(navigateToCheckout).not.toHaveBeenCalled();
  },
);

it('keeps a rejected time slot editable', async () => {
  apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Slot taken' } } });
  prepare();
  await act(async () => { submit(); });
  expect(toast.error).toHaveBeenCalledWith('Slot taken');
  expect(screen.getByTestId('confirm-booking-btn')).toBeEnabled();
  expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
});

it('retains the original link if browser navigation fails', async () => {
  navigateToCheckout.mockImplementationOnce(() => { throw new Error('Navigation interrupted'); });
  apiClient.post.mockResolvedValueOnce({ data: checkout });
  prepare(); submit();
  expect(await screen.findByRole('link', { name: /continue to checkout/i })).toHaveAttribute('href', checkout.checkout_url);
  expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
});

it('ignores a checkout response after the drawer closes and reopens', async () => {
  let finish;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = prepare('Apply partial credits');
  submit(); submit();
  expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
  rerender(<ScheduledBookingDrawer isOpen photographer={{ ...photographer }} onClose={jest.fn()} />);
  expect(screen.getByTestId('confirm-booking-btn')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  rerender(<ScheduledBookingDrawer isOpen={false} photographer={photographer} onClose={jest.fn()} />);
  rerender(<ScheduledBookingDrawer isOpen photographer={photographer} onClose={jest.fn()} />);
  await act(async () => { finish({ data: checkout }); });
  expect(screen.getByText('Choose slot')).toBeInTheDocument();
  expect(navigateToCheckout).not.toHaveBeenCalled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it.each([
  { remaining_credits: 95 }, { ...checkout, credits_applied: 0 }, { ...checkout, remaining_credits: -1 },
  { ...checkout, credits_applied: '5' }, { ...checkout, remaining_credits: '95' },
])('does not apply an unsupported wallet balance', async receipt => {
  apiClient.post.mockResolvedValueOnce({ data: { ...receipt, checkout_url: null } });
  prepare('Apply partial credits'); submit();
  await screen.findByRole('link', { name: /check scheduled bookings/i });
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it('creates a fully credit-funded booking once without starting card checkout', async () => {
  apiClient.post.mockResolvedValueOnce({ data: booking });
  prepare('Use credits'); submit();
  expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  expect(endpoints()).toEqual(['/bookings/create']);
  expect(mockUpdateUser).toHaveBeenCalledWith({ credit_balance: 75 });
});
