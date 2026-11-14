import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GearHub } from './GearHub';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

let mockUser;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../utils/gromPurchase', () => ({ submitPurchaseRequest: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

let reads;
const row = name => ({ id: name, name, category: 'camera', price_credits: 25, retail_price_usd: 50 });
const settle = (read, name) => act(async () => { read.resolve({ data: [row(name)] }); });
const reject = read => act(async () => { read.reject(new Error('synthetic read failure')); });
const search = value => fireEvent.change(screen.getByRole('textbox', { name: 'Search cameras, lenses, surfboards...' }), { target: { value } });
beforeEach(() => {
  jest.clearAllMocks(); mockUser = null; reads = [];
  apiClient.get.mockImplementation(url => {
    if (!url.startsWith('/gear-hub?')) return Promise.resolve({ data: { available_credits: 0, progress_items: [] } });
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    reads.push({ url, resolve, reject });
    return promise;
  });
});

test('late initial result cannot replace a newer search result', async () => {
  render(<GearHub />); search('lens');
  expect(reads.map(r => r.url)).toEqual(['/gear-hub?', '/gear-hub?search=lens']);
  await settle(reads[1], 'Newest search'); await settle(reads[0], 'Stale initial');
  expect(screen.getByText('Newest search')).toBeInTheDocument();
  expect(screen.queryByText('Stale initial')).not.toBeInTheDocument();
});
test('obsolete rejection produces no error toast or log after newer success', async () => {
  render(<GearHub />); search('lens'); await settle(reads[1], 'Newest'); await reject(reads[0]);
  expect(screen.getByText('Newest')).toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
});
test('obsolete finalizer cannot dismiss loading for a pending current request', async () => {
  const { container } = render(<GearHub />); search('lens'); await settle(reads[0], 'Stale');
  expect(container.querySelector('.animate-spin')).not.toBeNull();
  expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  await settle(reads[1], 'Current'); expect(screen.getByText('Current')).toBeInTheDocument();
});
test('search A to B to A still rejects the first A request', async () => {
  render(<GearHub />); search('A'); search('B'); search('A');
  await settle(reads[3], 'Latest A'); await settle(reads[1], 'First A'); await settle(reads[2], 'Old B'); await settle(reads[0], 'Initial');
  expect(screen.getByText('Latest A')).toBeInTheDocument();
  expect(screen.queryByText('First A')).not.toBeInTheDocument();
});
test('category change owns its result despite prior search completion', async () => {
  render(<GearHub />); search('water'); fireEvent.click(screen.getByText('Lenses'));
  expect(reads[2].url).toBe('/gear-hub?category=lens&search=water');
  await settle(reads[2], 'Selected lens'); await settle(reads[1], 'Old search'); await settle(reads[0], 'Initial');
  expect(screen.getByText('Selected lens')).toBeInTheDocument();
});
test('account A to B to A creates a new catalog lifetime', async () => {
  mockUser = { id: 'A' }; const view = render(<GearHub />);
  mockUser = { id: 'B' }; view.rerender(<GearHub />);
  mockUser = { id: 'A' }; view.rerender(<GearHub />);
  await settle(reads[2], 'Current A'); await settle(reads[0], 'Old A'); await settle(reads[1], 'Old B');
  expect(screen.getByText('Current A')).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
test('unmount suppresses a late error notification', async () => {
  const view = render(<GearHub />); view.unmount(); await reject(reads[0]);
  expect(toast.error).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
});
test('StrictMode discarded effect cannot replace its surviving request', async () => {
  render(<React.StrictMode><GearHub /></React.StrictMode>); expect(reads).toHaveLength(2);
  await settle(reads[1], 'Surviving'); await settle(reads[0], 'Discarded');
  expect(screen.getByText('Surviving')).toBeInTheDocument();
});
test('current failure still reports its error and completes loading', async () => {
  const { container } = render(<GearHub />); await reject(reads[0]);
  expect(toast.error).toHaveBeenCalledWith('Failed to load gear catalog');
  expect(logger.error).toHaveBeenCalledTimes(1); expect(container.querySelector('.animate-spin')).toBeNull();
});
test('normal current success renders without purchase or progress requests when signed out', async () => {
  render(<GearHub />); await settle(reads[0], 'Current catalog');
  expect(screen.getByText('Current catalog')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(1); expect(apiClient.post).not.toHaveBeenCalled();
});
