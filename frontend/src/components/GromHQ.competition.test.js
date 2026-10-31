import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GromHQ from './GromHQ';
import { toast } from 'sonner';

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockTheme = 'light';
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'parent' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockGet(...args), post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../utils/media', () => ({ getFullUrl: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./grom/PurchaseRequestsPanel', () => ({ PurchaseRequestsPanel: () => null }));
jest.mock('./grom/LinkMyChildPanel', () => () => null);

const child = (id, tier = null) => ({ id, full_name: `Child ${id}`, elite_tier: tier,
  credits_balance: 0, achievements_count: 0, guardian_level: 'L1', unlocked: {} });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const linked = children => mockGet.mockImplementation(async path => ({ data:
  path.includes('/linked-groms/') ? { linked_groms: children, pending_requests: [], stats: {} } :
    path.includes('/age-verification-status/') ? { age_verified: true } : { alerts: [], activities: [] },
}));
const toggle = id => screen.getByTestId(`grom-competition-toggle-${id}`);

beforeEach(() => {
  jest.clearAllMocks(); mockGet.mockReset(); mockPost.mockReset().mockResolvedValue({ data: { success: true } });
  mockTheme = 'light'; linked([child('A'), child('B')]);
});

test.each([null, 'grom_rising', 'other_tier'])('stored %s has a named native switch with accurate checked state', async tier => {
  linked([child('A', tier)]); render(<GromHQ />);
  await screen.findByText('Child A');
  const control = screen.getByRole('switch', { name: 'Competition Mode for Child A', exact: true });
  expect(control).toHaveAttribute('type', 'button');
  expect(control).toHaveAttribute('aria-checked', String(tier === 'grom_rising'));
});

test('rapid same-child activation sends one request and updates only after success', async () => {
  const pending = deferred(); mockPost.mockReturnValue(pending.promise);
  render(<GromHQ />); await screen.findByText('Child A');
  const control = toggle('A');
  act(() => { fireEvent.click(control); fireEvent.click(control); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('/grom-hq/toggle-competition/A?parent_id=parent', { competes: true });
  expect(control).toBeDisabled();
  expect(control).toHaveAttribute('aria-busy', 'true');
  expect(control).toHaveAttribute('aria-checked', 'false');
  await act(async () => { pending.resolve({ data: { success: true } }); });
  expect(toggle('A')).toBeEnabled();
  expect(toggle('A')).toHaveAttribute('aria-checked', 'true');
  expect(toggle('B')).toHaveAttribute('aria-checked', 'false');
});

test('different children can save independently without clearing another pending switch', async () => {
  const first = deferred(); const second = deferred();
  mockPost.mockImplementation(path => path.includes('/A?') ? first.promise : second.promise);
  render(<GromHQ />); await screen.findByText('Child A');
  fireEvent.click(toggle('A')); fireEvent.click(toggle('B'));
  expect(mockPost).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve({ data: { success: true } }); });
  expect(toggle('B')).toBeEnabled(); expect(toggle('B')).toHaveAttribute('aria-checked', 'true');
  expect(toggle('A')).toBeDisabled(); expect(toggle('A')).toHaveAttribute('aria-checked', 'false');
  await act(async () => { first.resolve({ data: { success: true } }); });
  expect(toggle('A')).toBeEnabled(); expect(toggle('A')).toHaveAttribute('aria-checked', 'true');
});

test('failed save preserves the checked value and unlocks the same requested retry', async () => {
  linked([child('A', 'grom_rising')]); mockPost.mockRejectedValueOnce(new Error('offline'));
  render(<GromHQ />); await screen.findByText('Child A');
  fireEvent.click(toggle('A'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update competition status'));
  expect(toggle('A')).toBeEnabled(); expect(toggle('A')).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle('A'));
  await waitFor(() => expect(toggle('A')).toHaveAttribute('aria-checked', 'false'));
  expect(mockPost.mock.calls.map(call => call[1])).toEqual([{ competes: false }, { competes: false }]);
});

test.each(['light', 'dark', 'beach'])('%s exposes a stable name and checked state after each successful toggle', async theme => {
  mockTheme = theme; render(<GromHQ />); await screen.findByText('Child A');
  const name = 'Competition Mode for Child A';
  fireEvent.click(screen.getByRole('switch', { name, exact: true }));
  await waitFor(() => expect(screen.getByRole('switch', { name, exact: true })).toHaveAttribute('aria-checked', 'true'));
  fireEvent.click(screen.getByRole('switch', { name, exact: true }));
  await waitFor(() => expect(screen.getByRole('switch', { name, exact: true })).toHaveAttribute('aria-checked', 'false'));
});
