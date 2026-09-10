import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockSpotId = 'spot-1';
let mockSearch = '?model=GFS';
let mockTheme = 'dark';
let mockTier = 'premium';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useParams: () => ({ spotId: mockSpotId }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ search: mockSearch }),
}), { virtual: true });
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', subscription_tier: mockTier } }),
}));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), debug: jest.fn() } }));
jest.mock('./spot-hub/SpotHubConditionsTab', () => ({ conditionReports }) => (
  <div data-testid="condition-report-data">{JSON.stringify(conditionReports)}</div>
));
jest.mock('./spot-hub/SpotHubIntelTab', () => () => null);
jest.mock('./spot-hub/SpotHubMediaTab', () => () => null);
jest.mock('./spot-hub/SpotHubPhotographers', () => () => null);
jest.mock('./spot-hub/SpotHubLivePulse', () => () => null);
jest.mock('./spot-hub/BookingTypeModal', () => () => null);
jest.mock('./spot-hub/PhotographerRequestModal', () => () => null);
jest.mock('./ScheduledBookingDrawer', () => ({ ScheduledBookingDrawer: () => null }));

import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import SpotHub from './SpotHub';

const spot = (id = mockSpotId) => ({ data: { id, name: `Beach ${id}`, region: 'Test coast', forecast: [] } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const detailCalls = () => apiClient.get.mock.calls.filter(([url]) => url.includes('/spot-details/'));
const respond = (details) => apiClient.get.mockImplementation((url, config) =>
  url.includes('/spot-details/') ? details(url, config) : Promise.resolve({ data: {} }));

beforeAll(() => {
  global.IntersectionObserver = class { observe() {} disconnect() {} };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSpotId = 'spot-1'; mockSearch = '?model=GFS'; mockTheme = 'dark'; mockTier = 'premium';
});

// Paired interventions against the actual screen and loading hook: only the response changes.
it.each([
  ['timeout', { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }],
  ['network', { code: 'ERR_NETWORK' }],
  ['server', { response: { status: 503 } }],
  ['rate limit', { response: { status: 429 } }],
])('%s failure is recoverable and never claims the spot was removed', async (_, error) => {
  respond(() => Promise.reject(error));
  render(<SpotHub />);
  expect(await screen.findByRole('heading', { name: 'Unable to load this spot' })).toBeInTheDocument();
  expect(screen.queryByText('Spot Not Found')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(detailCalls()).toHaveLength(1); // No automatic request amplification.
  fireEvent.click(screen.getByRole('button', { name: 'Back to Explore' }));
  expect(mockNavigate).toHaveBeenCalledWith('/explore');
});

it.each(['http', 'legacy'])('preserves a genuine %s not-found response', async (kind) => {
  respond(() => kind === 'http' ? Promise.reject({ response: { status: 404 } })
    : Promise.resolve({ data: { error: 'Spot not found' } }));
  render(<SpotHub />);
  expect(await screen.findByText('Spot Not Found')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

it.each([null, '<html>upstream unavailable</html>', {}, { error: 'Database unavailable' },
  { id: 'other-spot', name: 'Wrong beach' }])('rejects malformed or mismatched success payload %j', async (data) => {
  respond(() => Promise.resolve({ data }));
  render(<SpotHub />);
  expect(await screen.findByText('Unable to load this spot')).toBeInTheDocument();
  expect(screen.queryByText('Spot Not Found')).not.toBeInTheDocument();
  expect(screen.queryByTestId('close-spothub-btn')).not.toBeInTheDocument();
});

it.each(['dark', 'light', 'beach'])('one manual retry recovers the actual hub in %s', async (theme) => {
  mockTheme = theme;
  respond(() => Promise.reject({ code: 'ECONNABORTED' }));
  render(<SpotHub />);
  const retry = await screen.findByRole('button', { name: 'Try again' });
  const pending = deferred();
  respond(() => pending.promise);
  fireEvent.click(retry);
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(detailCalls()).toHaveLength(2);
  await act(async () => pending.resolve(spot()));
  expect(await screen.findByTestId('close-spothub-btn')).toBeInTheDocument();
  expect(screen.queryByText('Unable to load this spot')).not.toBeInTheDocument();
});

it.each(['resolve', 'reject'])('a departed request cannot %s over the next spot', async (completion) => {
  const first = deferred(), second = deferred();
  respond(() => mockSpotId === 'spot-1' ? first.promise : second.promise);
  const { rerender } = render(<SpotHub />);
  const oldSignal = detailCalls()[0][1]?.signal;
  mockSpotId = 'spot-2'; rerender(<SpotHub />);
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => first[completion](completion === 'resolve' ? spot('spot-1') : { response: { status: 404 } }));
  expect(screen.queryByText('Spot Not Found')).not.toBeInTheDocument();
  expect(screen.queryByTestId('close-spothub-btn')).not.toBeInTheDocument();
  await act(async () => second.resolve(spot('spot-2')));
  expect(await screen.findByTestId('close-spothub-btn')).toBeInTheDocument();
  expect(screen.queryByText('Beach spot-1')).not.toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each(['model', 'tier'])('reloads when the requested %s changes', async (dimension) => {
  respond(() => Promise.resolve(spot()));
  const { rerender } = render(<SpotHub />);
  await screen.findByTestId('close-spothub-btn');
  if (dimension === 'model') mockSearch = '?model=ICON'; else mockTier = 'free';
  rerender(<SpotHub />);
  await waitFor(() => expect(detailCalls()).toHaveLength(2));
  expect(detailCalls()[1][0]).toContain(dimension === 'model' ? 'model=ICON' : 'subscription_tier=free');
});

it('aborts on unmount and suppresses the resulting cancellation toast', async () => {
  const pending = deferred(); respond(() => pending.promise);
  const { unmount } = render(<SpotHub />);
  const signal = detailCalls()[0][1]?.signal;
  unmount();
  await act(async () => pending.reject({ code: 'ERR_CANCELED' }));
  expect(signal?.aborted).toBe(true);
  expect(toast.error).not.toHaveBeenCalled();
});

it('survives React Strict Mode setup, cleanup, and setup with one current result', async () => {
  const first = deferred();
  let calls = 0;
  respond(() => ++calls === 1 ? first.promise : Promise.resolve(spot()));
  render(<React.StrictMode><SpotHub /></React.StrictMode>);
  await screen.findByTestId('close-spothub-btn');
  expect(detailCalls()).toHaveLength(2);
  await act(async () => first.reject({ response: { status: 404 } }));
  expect(screen.getByTestId('close-spothub-btn')).toBeInTheDocument();
  expect(screen.queryByText('Spot Not Found')).not.toBeInTheDocument();
});

it('old optional reports cannot overwrite the newly loaded spot', async () => {
  const oldReports = deferred();
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/spot-details/')) return Promise.resolve(spot());
    if (url.includes('/condition-reports/spot/spot-1')) return oldReports.promise;
    if (url.includes('/condition-reports/spot/spot-2')) return Promise.resolve({ data: { reports: [{ id: 'new' }] } });
    return Promise.resolve({ data: {} });
  });
  const { rerender } = render(<SpotHub />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/condition-reports/spot/spot-1'), expect.anything()));
  mockSpotId = 'spot-2'; rerender(<SpotHub />);
  await screen.findByTestId('close-spothub-btn');
  await act(async () => oldReports.resolve({ data: { reports: [{ id: 'old' }] } }));
  expect(screen.getByTestId('condition-report-data')).toHaveTextContent('new');
  expect(screen.getByTestId('condition-report-data')).not.toHaveTextContent('old');
});

it.each(['rejected', 'empty'])('optional %s responses preserve the valid spot', async (kind) => {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/spot-details/')) return Promise.resolve(spot());
    return kind === 'empty' ? Promise.resolve({ data: null }) : Promise.reject({ response: { status: 503 } });
  });
  render(<SpotHub />);
  expect(await screen.findByTestId('close-spothub-btn')).toBeInTheDocument();
  expect(screen.queryByText('Unable to load this spot')).not.toBeInTheDocument();
});
