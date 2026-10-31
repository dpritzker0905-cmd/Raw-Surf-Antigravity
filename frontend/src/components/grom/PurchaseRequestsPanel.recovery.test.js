import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PurchaseRequestsPanel from './PurchaseRequestsPanel';

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockTheme = 'light';
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-parent' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockGet(...args), post: (...args) => mockPost(...args),
} }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../utils/media', () => ({ getFullUrl: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const response = (name = 'Fictional pending photo', status = 'pending') => ({ data: {
  requests: [{ id: name, grom_name: 'Fictional Child', item_name: name, item_type: 'gallery_photo', amount: 4, status }], pending_count: 7,
} });
const empty = { data: { requests: [], pending_count: 0 } };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); mockTheme = 'light'; });

test('failed purchase read is unavailable rather than a confirmed empty queue', async () => {
  mockGet.mockRejectedValue(new Error('offline')); render(<PurchaseRequestsPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Purchase requests could not be loaded');
  expect(screen.queryByText('No pending requests')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Purchase request status' })).toHaveValue('pending');
  expect(screen.getByRole('button', { name: 'Refresh purchase requests' })).toBeEnabled();
  expect(mockPost).not.toHaveBeenCalled();
});

test('retry fetches the current pending queue without approving or denying anything', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response()); render(<PurchaseRequestsPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry purchase requests' }));
  await screen.findByText('Fictional pending photo'); expect(screen.getByText('7 PENDING')).toBeInTheDocument();
  expect(mockGet.mock.calls.map(call => call[0])).toEqual(Array(2).fill('/grom-hq/purchase-requests/fictional-parent?status=pending'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(mockPost).not.toHaveBeenCalled();
});

test('only successful empty retry shows the normal empty queue', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty); render(<PurchaseRequestsPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry purchase requests' }));
  await screen.findByText('No pending requests'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('pending retry is announced, hides empty data and prevents a duplicate refresh', async () => {
  const read = deferred(); mockGet.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(read.promise);
  render(<PurchaseRequestsPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Retry purchase requests' }));
  expect(screen.getByRole('status', { name: 'Loading purchase requests' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh purchase requests' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Retry purchase requests' })).not.toBeInTheDocument();
  expect(screen.queryByText('No pending requests')).not.toBeInTheDocument();
  await act(async () => { read.resolve(response()); }); await screen.findByText('Fictional pending photo');
});

test('failed refresh hides stale rows and pending count until a current retry succeeds', async () => {
  mockGet.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty);
  render(<PurchaseRequestsPanel />); await screen.findByText('Fictional pending photo');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh purchase requests' })); await screen.findByRole('alert');
  expect(screen.queryByText('Fictional pending photo')).not.toBeInTheDocument();
  expect(screen.queryByText('7 PENDING')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry purchase requests' })); await screen.findByText('No pending requests');
});

test('filter changes and retry retain the selected status', async () => {
  mockGet.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('Approved fictional photo', 'approved'));
  render(<PurchaseRequestsPanel />); await screen.findByText('No pending requests');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'approved' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Retry purchase requests' }));
  await screen.findByText('Approved fictional photo');
  expect(screen.getByRole('combobox')).toHaveValue('approved');
  expect(mockGet.mock.calls.slice(1).map(call => call[0])).toEqual(Array(2).fill('/grom-hq/purchase-requests/fictional-parent?status=approved'));
});

test('an older pending success cannot replace a newer approved filter result', async () => {
  const old = deferred(); mockGet.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('Current approved photo', 'approved'));
  render(<PurchaseRequestsPanel />); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'approved' } });
  await screen.findByText('Current approved photo'); await act(async () => { old.resolve(response('Obsolete pending photo')); });
  expect(screen.getByText('Current approved photo')).toBeInTheDocument();
  expect(screen.queryByText('Obsolete pending photo')).not.toBeInTheDocument(); expect(mockPost).not.toHaveBeenCalled();
});

test('an older failed read cannot clear the newer filter result', async () => {
  const old = deferred(); mockGet.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('Current approved photo', 'approved'));
  render(<PurchaseRequestsPanel />); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'approved' } });
  await screen.findByText('Current approved photo'); await act(async () => { old.reject(new Error('obsolete offline failure')); });
  expect(screen.getByText('Current approved photo')).toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test.each(['light', 'dark', 'beach'])('%s repeated failure remains recoverable and read-only', async theme => {
  mockTheme = theme; mockGet.mockRejectedValue(new Error('offline')); render(<PurchaseRequestsPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry purchase requests' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Purchase requests could not be loaded');
  expect(mockGet).toHaveBeenCalledTimes(2); expect(mockPost).not.toHaveBeenCalled();
});
