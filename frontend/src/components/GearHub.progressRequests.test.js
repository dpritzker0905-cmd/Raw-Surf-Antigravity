import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GearHub } from './GearHub';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { submitPurchaseRequest } from '../utils/gromPurchase';

let mockUser;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../utils/gromPurchase', () => ({ submitPurchaseRequest: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
let reads;
const account = (id = 'A', session = 'synthetic-session-A') => ({ id, access_token: session, role: 'Hobbyist' });
const credit = amount => ({ available_credits: amount, can_purchase: true, progress_items: [] });
const settle = (read, amount, extra = {}) => act(async () => { read.resolve({ data: { ...credit(amount), ...extra } }); });
const reject = read => act(async () => { read.reject(new Error('synthetic failed read')); });
const search = value => fireEvent.change(screen.getByRole('textbox', { name: 'Search cameras, lenses, surfboards...' }), { target: { value } });
const mount = async () => { const view = render(<GearHub />); await screen.findByText('Fixture Camera'); return view; };
beforeEach(() => {
  jest.clearAllMocks(); mockUser = account(); reads = [];
  apiClient.get.mockImplementation(url => {
    if (!url.includes('/user/')) return Promise.resolve({ data: [{ id: 'fixture-camera', name: 'Fixture Camera', category: 'camera', price_credits: 25, retail_price_usd: 50 }] });
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    reads.push({ url, resolve, reject }); return promise;
  });
});
afterEach(() => {
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(submitPurchaseRequest).not.toHaveBeenCalled();
});
test('current progress displays its exact balance', async () => {
  await mount(); await settle(reads[0], 12.34);
  expect(screen.getByText('12.34')).toBeInTheDocument();
});
test('older search-related progress cannot overwrite the latest balance', async () => {
  await mount(); search('lens'); await settle(reads[1], 77.77); await settle(reads[0], 11.11);
  expect(screen.getByText('77.77')).toBeInTheDocument(); expect(screen.queryByText('11.11')).not.toBeInTheDocument();
});
test('category-related refresh ignores the preceding progress response', async () => {
  await mount(); fireEvent.click(screen.getByText('Lenses')); await settle(reads[1], 66.66); await settle(reads[0], 11.11);
  expect(screen.getByText('66.66')).toBeInTheDocument();
});
test('account B cannot display a late account A balance', async () => {
  const view = await mount(); mockUser = account('B', 'synthetic-session-B'); view.rerender(<GearHub />);
  expect(reads.map(x => x.url)).toEqual(['/gear-hub/user/A/progress', '/gear-hub/user/B/progress']);
  await settle(reads[1], 22.22); await settle(reads[0], 11.11);
  expect(screen.getByText('22.22')).toBeInTheDocument(); expect(screen.queryByText('11.11')).not.toBeInTheDocument();
});
test('loaded balance is cleared immediately when account identity changes', async () => {
  const view = await mount(); await settle(reads[0], 88.88); mockUser = account('B'); view.rerender(<GearHub />);
  expect(screen.queryByText('Your Gear Credits')).not.toBeInTheDocument(); expect(screen.queryByText('88.88')).not.toBeInTheDocument();
  await settle(reads[1], 22.22); expect(screen.getByText('22.22')).toBeInTheDocument();
});
test('sign-out clears loaded account balance and goal', async () => {
  const view = await mount(); await settle(reads[0], 88.88, { progress_items: [{ id: 'goal-A', name: 'Account A goal', can_afford: true, price_credits: 100 }] });
  expect(screen.getByText('Account A goal')).toBeInTheDocument();
  await act(async () => { mockUser = null; view.rerender(<GearHub />); });
  expect(screen.queryByText('Your Gear Credits')).not.toBeInTheDocument(); expect(screen.queryByText('Account A goal')).not.toBeInTheDocument();
});
test('late success after sign-out cannot repopulate a balance', async () => {
  const view = await mount(); mockUser = null; view.rerender(<GearHub />); await settle(reads[0], 88.88);
  expect(screen.queryByText('Your Gear Credits')).not.toBeInTheDocument();
});
test('account A to B to A creates a fresh progress lifetime', async () => {
  const view = await mount(); mockUser = account('B'); view.rerender(<GearHub />); mockUser = account('A'); view.rerender(<GearHub />);
  await settle(reads[2], 33.33); await settle(reads[0], 11.11); await settle(reads[1], 22.22);
  expect(screen.getByText('33.33')).toBeInTheDocument();
});
test('session replacement for the same account clears stale state and refreshes', async () => {
  const view = await mount(); await settle(reads[0], 11.11); mockUser = account('A', 'synthetic-session-next'); view.rerender(<GearHub />);
  expect(screen.queryByText('Your Gear Credits')).not.toBeInTheDocument(); expect(reads).toHaveLength(2);
  await settle(reads[1], 33.33); expect(screen.getByText('33.33')).toBeInTheDocument();
});
test('late previous-session response cannot replace the new session balance', async () => {
  const view = await mount(); mockUser = account('A', 'synthetic-session-next'); view.rerender(<GearHub />);
  expect(reads).toHaveLength(2); await settle(reads[1], 33.33); await settle(reads[0], 11.11);
  expect(screen.getByText('33.33')).toBeInTheDocument();
});
test('a superseded progress failure does not report a current error', async () => {
  await mount(); search('lens'); await settle(reads[1], 33.33); await reject(reads[0]);
  expect(logger.error).not.toHaveBeenCalled(); expect(screen.getByText('33.33')).toBeInTheDocument();
});
test('unmount invalidates pending progress failure', async () => {
  const view = await mount(); view.unmount(); await reject(reads[0]); expect(logger.error).not.toHaveBeenCalled();
});
test('StrictMode discarded progress cannot replace the surviving request', async () => {
  render(<React.StrictMode><GearHub /></React.StrictMode>); await screen.findByText('Fixture Camera'); expect(reads).toHaveLength(2);
  await settle(reads[1], 33.33); await settle(reads[0], 11.11); expect(screen.getByText('33.33')).toBeInTheDocument();
});
test('current failure remains logged and does not invent a balance', async () => {
  await mount(); await reject(reads[0]); expect(logger.error).toHaveBeenCalledWith('Failed to fetch user progress:', expect.any(Error));
  expect(screen.queryByText('Your Gear Credits')).not.toBeInTheDocument();
});
test('same-account query refresh retains already loaded balance while pending', async () => {
  await mount(); await settle(reads[0], 12.34); search('lens'); expect(screen.getByText('12.34')).toBeInTheDocument();
  await settle(reads[1], 22.22); expect(screen.getByText('22.22')).toBeInTheDocument();
});
