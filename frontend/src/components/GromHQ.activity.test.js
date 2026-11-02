import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GromHQ from './GromHQ';

const mockActivityGet = jest.fn();
const mockPost = jest.fn();
let mockTheme = 'light';
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'parent' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: path => path.includes('/family-activity/') ? mockActivityGet(path) : Promise.resolve({ data:
    path.includes('/linked-groms/') ? { linked_groms: [{ id: 'A', full_name: 'Fictional Child', elite_tier: 'grom_rising' }],
      pending_requests: [], stats: {} } : { age_verified: true, alerts: [] },
  }), post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../utils/media', () => ({ getFullUrl: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./grom/PurchaseRequestsPanel', () => ({ PurchaseRequestsPanel: () => null }));
jest.mock('./grom/LinkMyChildPanel', () => () => null);

const records = title => ({ data: { activities: [{ type: 'post', id: title, title, grom_name: 'Fictional Child' }] } });
const open = async () => {
  await screen.findByText('Fictional Child');
  const card = screen.getByTestId('family-activity-feed');
  fireEvent.click(within(card).getByRole('button', { name: 'Show', exact: true }));
  return card;
};

beforeEach(() => {
  mockTheme = 'light'; mockPost.mockReset();
  mockActivityGet.mockReset().mockResolvedValue({ data: { activities: [] } });
});

test('a failed activity read is unavailable, never a confirmed empty history', async () => {
  mockActivityGet.mockRejectedValue(new Error('offline')); render(<GromHQ />);
  const card = await open();
  expect(await within(card).findByRole('alert')).toHaveTextContent('Family activity could not be loaded');
  expect(within(card).queryByText('No recent activity from your Groms')).not.toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Competition Mode for Fictional Child' })).toHaveAttribute('aria-checked', 'true');
  expect(mockPost).not.toHaveBeenCalled();
});

test('retry reads actual activity without writing guardian settings', async () => {
  mockActivityGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(records('Recovered family post'));
  render(<GromHQ />); const card = await open();
  fireEvent.click(await within(card).findByRole('button', { name: 'Retry family activity' }));
  await within(card).findByText('Recovered family post');
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  expect(mockActivityGet.mock.calls.map(call => call[0])).toEqual([
    '/grom-hq/family-activity/parent?limit=20', '/grom-hq/family-activity/parent?limit=20',
  ]);
  expect(mockPost).not.toHaveBeenCalled();
});

test('a successful empty retry may show the real empty state', async () => {
  mockActivityGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { activities: [] } });
  render(<GromHQ />); const card = await open();
  fireEvent.click(await within(card).findByRole('button', { name: 'Retry family activity' }));
  await within(card).findByText('No recent activity from your Groms');
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
});

test('failed refresh hides stale rows/count and a later retry restores current data', async () => {
  mockActivityGet.mockResolvedValueOnce(records('Old family post')).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(records('New family post'));
  render(<GromHQ />); const card = await open(); await within(card).findByText('Old family post');
  fireEvent.click(within(card).getByRole('button', { name: 'Refresh', exact: true }));
  await within(card).findByRole('alert');
  expect(within(card).queryByText('Old family post')).not.toBeInTheDocument();
  expect(within(card).queryByText('1', { exact: true })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Refresh', exact: true })).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Retry family activity' }));
  await within(card).findByText('New family post'); expect(mockPost).not.toHaveBeenCalled();
});

test('a pending read has an announced loading state and no empty claim', async () => {
  let finish;
  mockActivityGet.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<GromHQ />); const card = await open();
  expect(within(card).getByRole('status', { name: 'Loading family activity' })).toBeInTheDocument();
  expect(within(card).queryByText('No recent activity from your Groms')).not.toBeInTheDocument();
  await act(async () => { finish({ data: { activities: [] } }); });
  await within(card).findByText('No recent activity from your Groms');
});

test.each(['light', 'dark', 'beach'])('%s repeated failure keeps an accessible read-only retry', async theme => {
  mockTheme = theme; mockActivityGet.mockRejectedValue(new Error('offline'));
  render(<GromHQ />); const card = await open();
  fireEvent.click(await within(card).findByRole('button', { name: 'Retry family activity' }));
  await waitFor(() => expect(mockActivityGet).toHaveBeenCalledTimes(2));
  expect(await within(card).findByRole('alert')).toHaveTextContent('Family activity could not be loaded');
  expect(mockPost).not.toHaveBeenCalled();
});
