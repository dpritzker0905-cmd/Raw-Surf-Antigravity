import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GromHQ from './GromHQ';

const mockLinkedGet = jest.fn();
const mockPost = jest.fn();
const mockNavigate = jest.fn();
let mockTheme = 'light';
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-parent' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: path => path.includes('/linked-groms/') ? mockLinkedGet(path) : Promise.resolve({ data: { age_verified: true, alerts: [], activities: [] } }),
  post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../utils/media', () => ({ getFullUrl: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./grom/PurchaseRequestsPanel', () => ({ PurchaseRequestsPanel: () => null }));
jest.mock('./grom/LinkMyChildPanel', () => ({ __esModule: true, default: ({ onLinked }) =>
  <button onClick={onLinked}>Fictional link readback</button> }));

const empty = { data: { linked_groms: [], pending_requests: [], stats: { totalEarnings: 0 } } };
const family = { data: {
  linked_groms: [{ id: 'A', full_name: 'Recovered Fictional Child', elite_tier: 'grom_rising' }],
  pending_requests: [{ id: 'B', full_name: 'Fictional Pending Child' }],
  stats: { totalEarnings: 37, totalSessions: 12, totalScreenTime: 0, achievementsUnlocked: 3 },
} };

beforeEach(() => {
  mockTheme = 'light'; mockPost.mockReset(); mockNavigate.mockReset(); mockLinkedGet.mockReset();
});

test('failed linked read never claims an empty family or fabricated zero totals', async () => {
  mockLinkedGet.mockRejectedValue(new Error('offline')); render(<GromHQ />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Linked Groms could not be loaded');
  expect(screen.queryByText('No Linked Groms')).not.toBeInTheDocument();
  expect(screen.queryByText('Total Earnings')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Invite a Grom/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});

test('retry restores linked children, pending requests, totals and competition readback', async () => {
  mockLinkedGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(family); render(<GromHQ />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry linked Groms' }));
  await screen.findByText('Recovered Fictional Child');
  expect(screen.getByText('Fictional Pending Child')).toBeInTheDocument();
  expect(screen.getByText('$37')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Competition Mode for Recovered Fictional Child' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mockLinkedGet.mock.calls.map(call => call[0])).toEqual(Array(2).fill('/grom-hq/linked-groms/fictional-parent'));
  expect(mockPost).not.toHaveBeenCalled();
});

test('only a successful empty retry displays the actual empty family state', async () => {
  mockLinkedGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty); render(<GromHQ />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry linked Groms' }));
  await screen.findByText('No Linked Groms');
  expect(screen.getByText('Total Earnings')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('pending retry announces loading and hides retry and derived dashboard controls', async () => {
  let finish;
  mockLinkedGet.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<GromHQ />); fireEvent.click(await screen.findByRole('button', { name: 'Retry linked Groms' }));
  expect(screen.getByRole('status', { name: 'Loading linked Groms' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry linked Groms' })).not.toBeInTheDocument();
  expect(screen.queryByText('No Linked Groms')).not.toBeInTheDocument();
  await act(async () => { finish(family); });
  await screen.findByText('Recovered Fictional Child'); expect(mockPost).not.toHaveBeenCalled();
});

test('initial pending read does not display successful empty data', async () => {
  let finish; mockLinkedGet.mockReturnValue(new Promise(resolve => { finish = resolve; })); render(<GromHQ />);
  expect(screen.getByRole('status', { name: 'Loading linked Groms' })).toBeInTheDocument();
  expect(screen.queryByText('Total Earnings')).not.toBeInTheDocument();
  await act(async () => { finish(empty); }); await screen.findByText('No Linked Groms');
});

test.each(['light', 'dark', 'beach'])('%s repeated failure retains read-only recovery', async theme => {
  mockTheme = theme; mockLinkedGet.mockRejectedValue(new Error('offline')); render(<GromHQ />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry linked Groms' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Linked Groms could not be loaded');
  expect(mockLinkedGet).toHaveBeenCalledTimes(2); expect(mockPost).not.toHaveBeenCalled();
});

test('Back to Settings leaves the unavailable dashboard without retrying or writing', async () => {
  mockLinkedGet.mockRejectedValue(new Error('offline')); render(<GromHQ />);
  fireEvent.click(await screen.findByRole('button', { name: 'Back to Settings' }));
  expect(mockNavigate).toHaveBeenCalledWith('/settings'); expect(mockLinkedGet).toHaveBeenCalledTimes(1);
  expect(mockPost).not.toHaveBeenCalled();
});

test('failed link readback hides stale totals and retry replaces them with current family data', async () => {
  mockLinkedGet.mockResolvedValueOnce({ data: { ...empty.data, stats: { totalEarnings: 94 } } })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(family);
  render(<GromHQ />); fireEvent.click(await screen.findByRole('button', { name: 'Fictional link readback' }));
  await screen.findByRole('alert'); expect(screen.queryByText('$94')).not.toBeInTheDocument();
  expect(screen.queryByText('No Linked Groms')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry linked Groms' }));
  await screen.findByText('Recovered Fictional Child'); expect(screen.getByText('$37')).toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});
