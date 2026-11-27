import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { navigateToCheckout } from '../utils/checkoutUrl';
import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';

const mockUpdateUser = jest.fn();
const mockHaptic = jest.fn();
let mockBuyerId;
let mockRealPayment;
jest.mock('../utils/checkoutUrl', () => ({
  ...jest.requireActual('../utils/checkoutUrl'), navigateToCheckout: jest.fn(),
}));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() } }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: mockBuyerId, credit_balance: 100 }, updateUser: mockUpdateUser,
}) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('../hooks/useHapticFeedback', () => () => mockHaptic);
jest.mock('./ui/slider', () => ({ Slider: () => null }));
jest.mock('./ExactTimeSlotPicker', () => ({ ExactTimeSlotPicker: ({ onDateChange, onTimeChange, onCategoryChange }) =>
  <button onClick={() => {
    onDateChange(new Date(2030, 0, 5)); onTimeChange('12:00'); onCategoryChange('Surf');
  }}>Choose slot</button> }));
jest.mock('./booking/ImpactZonePicker', () => ({ onLocationChange }) =>
  <button onClick={() => onLocationChange({ description: 'Fixture beach' })}>Choose beach</button>);
jest.mock('./booking/BookingPaymentStep', () => props => {
  if (mockRealPayment) {
    const Payment = jest.requireActual('./booking/BookingPaymentStep').default;
    return <Payment {...props} />;
  }
  return <>
    <button onClick={() => props.setPaymentMethod('credits')}>Use credits</button>
    <button onClick={() => props.setAppliedCredits(5)}>Apply partial credits</button>
  </>;
});
jest.mock('./booking/BookingSelfieStep', () => ({ BookingSelfieStep: ({ setStep, setSelfieUrl }) => <>
  <button onClick={() => setStep('confirm')}>Skip selfie</button>
  <button onClick={() => { setSelfieUrl('fixture.jpg'); setStep('confirm'); }}>Use selfie</button>
</> }));
jest.mock('./booking/ScheduledBookingHelpers', () => ({
  ...jest.requireActual('./booking/ScheduledBookingHelpers'),
  DURATION_PRICES: { 60: 1 }, CrossSellSuggestion: () => null,
  CrewSplitSection: ({ onToggle, onCrewChange }) => <button onClick={() => {
    onToggle(true); onCrewChange([{ user_id: 'crew', name: 'Crew' }]);
  }}>Add crew</button>,
}));

const photographer = { id: 'pro', session_price: 25 };
const checkout = { booking_id: 'booking', session_id: 'session', checkout_url: 'https://checkout.stripe.com/c/pay/fixture', credits_applied: 5, remaining_credits: 95 };
const booking = { booking: { id: 'booking', status: 'Confirmed' }, remaining_credits: 75 };
const endpoints = () => apiClient.post.mock.calls.map(([url]) => url);
async function prepare(choice, options) {
  let view;
  await act(async () => { view = render(drawer()); });
  chooseBooking(choice, options);
  return view;
}

function openPayment(crew = false) {
  fireEvent.click(screen.getByText('Choose slot'));
  fireEvent.click(screen.getByTestId('continue-to-location-btn'));
  fireEvent.click(screen.getByText('Choose beach'));
  fireEvent.click(screen.getByTestId('continue-to-crew-btn'));
  if (crew) fireEvent.click(screen.getByText('Add crew'));
  fireEvent.click(screen.getByTestId('continue-to-payment-btn'));
}

function chooseBooking(choice, { crew = false, selfie = false } = {}) {
  openPayment(crew);
  if (choice) fireEvent.click(screen.getByText(choice));
  fireEvent.click(screen.getByTestId('review-booking-btn'));
  fireEvent.click(screen.getByText(selfie ? 'Use selfie' : 'Skip selfie'));
}
const submit = () => fireEvent.click(screen.getByTestId('confirm-booking-btn'));
beforeEach(() => {
  jest.resetAllMocks();
  mockBuyerId = 'buyer';
  mockRealPayment = false;
  apiClient.get.mockImplementation(async () => ({ data: { user_id: mockBuyerId, balance: 100 } }));
});

const drawer = (isOpen = true) => <ScheduledBookingDrawer isOpen={isOpen} photographer={photographer} onClose={jest.fn()} />;

it.each(['card', 'credits'])('shows the saved wallet balance after an uncertain %s booking and remount', async method => {
  apiClient.post.mockRejectedValueOnce(new Error('Connection lost'));
  const original = await prepare(method === 'credits' ? 'Use credits' : 'Apply partial credits');
  await act(async () => { submit(); });
  expect(screen.getByRole('link', { name: /check scheduled bookings/i })).toBeInTheDocument();
  original.unmount();
  mockRealPayment = true;
  apiClient.get.mockResolvedValueOnce({ data: { user_id: 'buyer', balance: 12 } });
  render(drawer());
  openPayment();
  expect(await screen.findByText(/\$12\.00 available/)).toBeInTheDocument();
  expect(screen.queryByText(/\$100\.00 available/)).toBeNull();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it('waits for an abandoned create to settle before reading the reopened wallet, including a zero balance', async () => {
  const pending = deferred();
  apiClient.post.mockReturnValueOnce(pending.promise);
  const original = await prepare('Use credits');
  submit();
  original.unmount();
  apiClient.get.mockClear().mockResolvedValueOnce({ data: { user_id: 'buyer', balance: 0 } });
  mockRealPayment = true;
  render(drawer());
  openPayment();
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(screen.queryByTestId('pay-with-credits-btn')).toBeNull();
  await act(async () => { pending.resolve({ data: booking }); });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get.mock.calls[0][0]).toBe('/credits/balance/buyer');
  expect(screen.queryByTestId('pay-with-credits-btn')).toBeNull();
  expect(screen.queryByText(/checking wallet balance/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /retry wallet balance/i })).toBeNull();
  expect(screen.getByTestId('pay-with-card-btn')).toBeEnabled();
});

it.each([null, { user_id: 'other', balance: 45 }, { user_id: 'buyer', balance: -1 },
  { user_id: 'buyer', balance: '45' }])('offers retry without exposing cached credits for an invalid balance %p', async data => {
  mockRealPayment = true;
  apiClient.get.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ data: { user_id: 'buyer', balance: 9 } });
  render(drawer());
  openPayment();
  fireEvent.click(await screen.findByRole('button', { name: /retry wallet balance/i }));
  expect(await screen.findByText(/\$9\.00 available/)).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it.each(['reopen', 'switch photographer'])('discards a late balance from an earlier buyer visit on %s', async change => {
  mockRealPayment = true;
  const earlier = deferred();
  apiClient.get.mockReturnValueOnce(earlier.promise);
  const view = render(drawer());
  if (change === 'reopen') view.rerender(drawer(false));
  apiClient.get.mockResolvedValueOnce({ data: { user_id: 'buyer', balance: 17 } });
  view.rerender(<ScheduledBookingDrawer isOpen photographer={{ ...photographer, id: change === 'reopen' ? 'pro' : 'other-pro' }} onClose={jest.fn()} />);
  openPayment();
  expect(await screen.findByText(/\$17\.00 available/)).toBeInTheDocument();
  await act(async () => { earlier.resolve({ data: { user_id: 'buyer', balance: 99 } }); });
  expect(screen.getByText(/\$17\.00 available/)).toBeInTheDocument();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it('keeps explicit card checkout available after a balance read fails', async () => {
  mockRealPayment = true;
  apiClient.get.mockRejectedValueOnce(new Error('Balance unavailable'));
  apiClient.post.mockResolvedValueOnce({ data: { ...checkout, credits_applied: 0 } });
  render(drawer());
  openPayment();
  expect(await screen.findByRole('button', { name: /retry wallet balance/i })).toBeEnabled();
  expect(screen.queryByTestId('pay-with-credits-btn')).toBeNull();
  fireEvent.click(screen.getByTestId('pay-with-card-btn'));
  fireEvent.click(screen.getByTestId('review-booking-btn'));
  fireEvent.click(screen.getByText('Skip selfie'));
  await act(async () => { submit(); });
  expect(apiClient.post).toHaveBeenCalledWith('/bookings/create-with-stripe', expect.objectContaining({ apply_credits: 0 }));
  expect(navigateToCheckout).toHaveBeenCalledWith(checkout.checkout_url);
});

it('keeps the second buyer’s balance when the first buyer’s read finishes late', async () => {
  mockRealPayment = true;
  const first = deferred();
  apiClient.get.mockReturnValueOnce(first.promise);
  const view = render(drawer());
  apiClient.get.mockResolvedValueOnce({ data: { user_id: 'second-buyer', balance: 23 } });
  switchBuyer(view, 'second-buyer');
  openPayment();
  expect(await screen.findByText(/\$23\.00 available/)).toBeInTheDocument();
  await act(async () => { first.resolve({ data: { user_id: 'buyer', balance: 90 } }); });
  expect(screen.getByText(/\$23\.00 available/)).toBeInTheDocument();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it.each([undefined, '', '/missing', 'http://example.invalid/session'])(
  'never sends a second create when paid checkout returns URL %p', async checkout_url => {
    apiClient.post.mockResolvedValueOnce({ data: { ...checkout, checkout_url } })
      .mockResolvedValueOnce({ data: booking });
    await prepare('Apply partial credits');
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
  await prepare('Apply partial credits');
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
    await prepare(); submit();
    expect(await screen.findByRole('link', { name: /check scheduled bookings/i })).toBeInTheDocument();
    expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    expect(screen.queryByRole('link', { name: /continue to checkout/i })).toBeNull();
    expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(navigateToCheckout).not.toHaveBeenCalled();
  },
);

it.each([[undefined, 'create-with-stripe'], ['Use credits', 'create']])(
  'links to the existing pending booking after a retry using %s', async (choice, endpoint) => {
    apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: {
      detail: 'Already started', pending_booking_id: 'original/one&two',
    } } });
    await prepare(choice);
    await act(async () => { submit(); });
    expect(screen.getByRole('link', { name: /check scheduled bookings/i })).toHaveAttribute(
      'href', '/bookings?tab=scheduled&highlight=original%2Fone%26two',
    );
    expect(screen.getByRole('status')).toHaveTextContent('already have a pending checkout');
    expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
    expect(endpoints()).toEqual([`/bookings/${endpoint}`]);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(navigateToCheckout).not.toHaveBeenCalled();
  },
);

it.each([
  ['connection loss', new Error('Connection lost')],
  ['request timeout', { response: { status: 408 } }],
  ['gateway error', { response: { status: 502 } }],
])('offers Scheduled Bookings after wallet %s without submitting again', async (_, error) => {
  const create = deferred();
  apiClient.post.mockReturnValueOnce(create.promise);
  await prepare('Use credits', { crew: true, selfie: true });
  submit();
  submit();
  await act(async () => { create.reject(error); });
  expect(screen.getByRole('status')).toHaveTextContent(/couldn.t confirm your booking/i);
  expect(screen.getByRole('link', { name: /check scheduled bookings/i })).toHaveAttribute('href', '/bookings?tab=scheduled');
  expect(screen.queryByRole('link', { name: /continue to checkout/i })).toBeNull();
  expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
  expect(endpoints()).toEqual(['/bookings/create']);
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(navigateToCheckout).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it('keeps a definitively rejected wallet booking editable', async () => {
  apiClient.post.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Insufficient credit balance' } } });
  await prepare('Use credits');
  await act(async () => { submit(); });
  expect(toast.error).toHaveBeenCalledWith('Insufficient credit balance');
  expect(screen.getByTestId('confirm-booking-btn')).toBeEnabled();
  expect(screen.queryByRole('link', { name: /check scheduled bookings/i })).toBeNull();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it.each([null, {}, { booking_id: ' ', remaining_credits: 75 }])(
  'asks the buyer to check Scheduled Bookings when the wallet receipt is incomplete (%p)', async data => {
    apiClient.post.mockResolvedValueOnce({ data });
    await prepare('Use credits');
    await act(async () => { submit(); });
    expect(screen.getByRole('link', { name: /check scheduled bookings/i })).toBeInTheDocument();
    expect(screen.queryByText('Booking confirmed')).toBeNull();
    expect(screen.queryByTestId('confirm-booking-btn')).toBeNull();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(endpoints()).toEqual(['/bookings/create']);
  },
);

it('accepts the wallet API receipt with a top-level booking ID', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { booking_id: 'original', status: 'Confirmed', remaining_credits: 75 } });
  await prepare('Use credits');
  await act(async () => { submit(); });
  expect(screen.getByText('Booking confirmed')).toBeInTheDocument();
  expect(mockUpdateUser).toHaveBeenCalledWith({ credit_balance: 75 });
  expect(endpoints()).toEqual(['/bookings/create']);
  expect(apiClient.patch).not.toHaveBeenCalled();
});

it.each([
  { booking_id: 'new & original', booking: { id: 'older' } },
  { booking_id: 'new & original' },
  { booking: { id: 'new & original' } },
])('uses the validated wallet receipt for both requested follow-ups (%p)', async receipt => {
  apiClient.post.mockResolvedValueOnce({ data: receipt }).mockResolvedValueOnce({ data: { conversation_id: null } });
  apiClient.patch.mockResolvedValueOnce({});
  await prepare('Use credits', { crew: true, selfie: true });
  submit();
  expect(await screen.findByRole('button', { name: 'View My Bookings' })).toBeInTheDocument();
  expect(endpoints()).toEqual(['/bookings/create', '/bookings/new%20%26%20original/send-crew-requests']);
  expect(apiClient.post.mock.calls[1][1]).toMatchObject({
    crew_members: [{ user_id: 'crew', name: 'Crew', share_amount: 12.5 }],
    photographer_name: expect.any(String),
  });
  expect(apiClient.patch.mock.calls).toEqual([['/bookings/new%20%26%20original/participant-selfie', {
    participant_id: 'buyer', selfie_url: 'fixture.jpg',
  }]]);
});

it.each([
  [{ status: 'Pending', booking: { status: 'Confirmed' } }, 'Booking pending'],
  [{ status: 'Pending Acceptance' }, 'Booking pending acceptance'],
  [{ status: 'Confirmed' }, 'Booking confirmed'],
  [{ booking: { status: ' confirmed ' } }, 'Booking confirmed'],
  [{ booking: { id: 'original', status: 'Pending' } }, 'Booking pending'],
  [{ booking: { id: 'different-booking', status: 'Confirmed' } }, 'Booking request received'],
  [{}, 'Booking request received'],
  [{ status: 'Unknown', booking: { status: 'Confirmed' } }, 'Booking request received'],
])('shows the returned split booking status (%p)', async (receipt, title) => {
  apiClient.post.mockResolvedValueOnce({ data: { booking_id: 'original', credits_applied: 10, ...receipt } })
    .mockResolvedValueOnce({ data: {} });
  await prepare('Use credits', { crew: true });
  await act(async () => { submit(); });
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  const scheduledEvent = screen.getByRole('dialog').querySelector('script[type="application/ld+json"]');
  const reminder = screen.queryByText(/notification when it's time to head out/i);
  if (title === 'Booking confirmed') {
    expect(toast.success).toHaveBeenCalledWith(title);
    expect(toast.info).not.toHaveBeenCalled();
    expect(JSON.parse(scheduledEvent.textContent).eventStatus).toBe('https://schema.org/EventScheduled');
    expect(reminder).toBeInTheDocument();
  } else {
    expect(toast.info).toHaveBeenCalledWith(title);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText(/is confirmed/i)).toBeNull();
    expect(scheduledEvent).toBeNull();
    expect(reminder).toBeNull();
    expect(screen.getByText('Credits applied')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  }
  expect(endpoints()).toEqual(['/bookings/create', '/bookings/original/send-crew-requests']);
  expect(screen.getByRole('button', { name: 'View My Bookings' })).toBeEnabled();
});

it('ignores a lost wallet response after switching buyers', async () => {
  const create = deferred();
  apiClient.post.mockReturnValueOnce(create.promise);
  const view = await prepare('Use credits');
  submit();
  switchBuyer(view, 'second-buyer');
  await act(async () => { create.reject(new Error('Connection lost')); });
  expect(screen.getByText('Choose slot')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /check scheduled bookings/i })).toBeNull();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each([[409, undefined], [409, '  '], [409, 123], [400, 'original']])(
  'keeps a rejected booking editable for status %s and pending booking ID %p', async (status, pendingId) => {
    apiClient.post.mockRejectedValueOnce({ response: { status, data: { detail: 'Slot taken', pending_booking_id: pendingId } } });
    await prepare();
    await act(async () => { submit(); });
    expect(toast.error).toHaveBeenCalledWith('Slot taken');
    expect(screen.getByTestId('confirm-booking-btn')).toBeEnabled();
    expect(screen.queryByRole('link', { name: /check scheduled bookings/i })).toBeNull();
    expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
  },
);

it('retains the original link if browser navigation fails', async () => {
  navigateToCheckout.mockImplementationOnce(() => { throw new Error('Navigation interrupted'); });
  apiClient.post.mockResolvedValueOnce({ data: checkout });
  await prepare(); submit();
  expect(await screen.findByRole('link', { name: /continue to checkout/i })).toHaveAttribute('href', checkout.checkout_url);
  expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
});

it('ignores a checkout response after the drawer closes and reopens', async () => {
  let finish;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = await prepare('Apply partial credits');
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
  await prepare('Apply partial credits'); submit();
  await screen.findByRole('link', { name: /check scheduled bookings/i });
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it('creates a fully credit-funded booking once without starting card checkout', async () => {
  apiClient.post.mockResolvedValueOnce({ data: booking });
  await prepare('Use credits'); submit();
  expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  expect(endpoints()).toEqual(['/bookings/create']);
  expect(mockUpdateUser).toHaveBeenCalledWith({ credit_balance: 75 });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function switchBuyer(view, id) {
  mockBuyerId = id;
  view.rerender(<ScheduledBookingDrawer isOpen photographer={photographer} onClose={jest.fn()} />);
}

it.each(['switch', 'return', 'unmount'])('ignores late wallet creation after %s', async change => {
  const create = deferred();
  apiClient.post.mockReturnValueOnce(create.promise);
  const view = await prepare('Use credits', { crew: true, selfie: true });
  submit();
  if (change === 'unmount') view.unmount();
  else {
    switchBuyer(view, 'second-buyer');
    if (change === 'return') switchBuyer(view, 'buyer');
  }
  await act(async () => { create.resolve({ data: booking }); });
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(endpoints()).toEqual(['/bookings/create']);
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(mockHaptic).not.toHaveBeenCalled();
  if (change !== 'unmount') expect(screen.getByText('Choose slot')).toBeInTheDocument();
});

it.each(['resolve', 'reject'])('ignores stale crew notification completion on %s', async outcome => {
  const crew = deferred();
  apiClient.post.mockResolvedValueOnce({ data: booking }).mockReturnValueOnce(crew.promise);
  const view = await prepare('Use credits', { crew: true, selfie: true });
  await act(async () => { submit(); });
  expect(endpoints()).toEqual(['/bookings/create', '/bookings/booking/send-crew-requests']);
  switchBuyer(view, 'second-buyer');
  await act(async () => { crew[outcome](); });
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(toast.warning).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(mockHaptic).not.toHaveBeenCalled();
  expect(screen.getByText('Choose slot')).toBeInTheDocument();
});

it('keeps the next buyer submission pending when the first wallet receipt arrives', async () => {
  const first = deferred(), next = deferred();
  apiClient.post.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
  const view = await prepare('Use credits');
  submit();
  await act(async () => { switchBuyer(view, 'second-buyer'); });
  chooseBooking('Use credits');
  submit();
  await act(async () => { first.resolve({ data: booking }); });
  expect(screen.getByTestId('confirm-booking-btn')).toBeDisabled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  await act(async () => { next.resolve({ data: { ...booking, remaining_credits: 42 } }); });
  expect(screen.getByText('Booking confirmed')).toBeInTheDocument();
  expect(mockUpdateUser.mock.calls).toEqual([[{ credit_balance: 42 }]]);
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(endpoints()).toEqual(['/bookings/create', '/bookings/create']);
});

it.each(['resolve', 'reject'])('keeps a reopened drawer at the first step after a late selfie %s', async outcome => {
  const selfie = deferred();
  apiClient.post.mockResolvedValueOnce({ data: booking });
  apiClient.patch.mockReturnValueOnce(selfie.promise);
  const view = await prepare('Use credits', { selfie: true });
  await act(async () => { submit(); });
  expect(apiClient.patch).toHaveBeenCalledTimes(1);
  view.rerender(<ScheduledBookingDrawer isOpen={false} photographer={photographer} onClose={jest.fn()} />);
  view.rerender(<ScheduledBookingDrawer isOpen photographer={photographer} onClose={jest.fn()} />);
  await act(async () => { selfie[outcome](); });
  expect(toast.success).not.toHaveBeenCalled();
  expect(mockHaptic).not.toHaveBeenCalled();
  expect(screen.getByText('Choose slot')).toBeInTheDocument();
});

it('finishes the active wallet booking when its crew notification fails', async () => {
  apiClient.post.mockResolvedValueOnce({ data: booking }).mockRejectedValueOnce(new Error('Fixture error'));
  apiClient.patch.mockResolvedValueOnce({});
  await prepare('Use credits', { crew: true, selfie: true });
  submit();
  expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(apiClient.patch).toHaveBeenCalledWith('/bookings/booking/participant-selfie', {
    participant_id: 'buyer', selfie_url: 'fixture.jpg',
  });
  expect(mockHaptic).toHaveBeenCalledWith('success');
});

it('starts the next buyer with the default card option after the previous buyer chose credits', async () => {
  const view = await prepare('Use credits');
  await act(async () => { switchBuyer(view, 'second-buyer'); });
  chooseBooking();
  apiClient.post.mockResolvedValueOnce({ data: checkout });
  await act(async () => { submit(); });
  expect(endpoints()).toEqual(['/bookings/create-with-stripe']);
  expect(apiClient.post.mock.calls[0][1].apply_credits).toBe(0);
});
