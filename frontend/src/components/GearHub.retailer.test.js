import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { GearHub } from './GearHub';
import apiClient from '../lib/apiClient';

let mockUser;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../utils/gromPurchase', () => ({ submitPurchaseRequest: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const items = [
  { id: 'synthetic-a', name: 'Synthetic Camera', category: 'camera', price_credits: 25, retail_price_usd: 50 },
  { id: 'synthetic-b', name: 'Synthetic Lens', category: 'lens', price_credits: 30, retail_price_usd: 60 },
];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let reads;
let catalog;
const destination = (index = 0, url = 'https://retailer.example/item-a') => ({
  data: { id: items[index].id, affiliate_url: url },
});
const mount = async (strict = false) => {
  const result = render(strict ? <React.StrictMode><GearHub /></React.StrictMode> : <GearHub />);
  await screen.findByText(items[0].name);
  return result;
};
const request = (index = 0) => {
  fireEvent.click(screen.getAllByTitle('View on retailer site')[index]);
  expect(apiClient.get).toHaveBeenCalledWith('/gear-hub/' + items[index].id);
  return reads[reads.length - 1];
};
const settle = async (read, value) => { await act(async () => { read.resolve(value); await read.promise; }); };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'synthetic-owner', role: 'Surfer', access_token: 'synthetic-session' };
  reads = [];
  catalog = items;
  jest.spyOn(window, 'open').mockImplementation(() => null);
  apiClient.get.mockImplementation(path => {
    if (path.startsWith('/gear-hub?')) return Promise.resolve({ data: catalog });
    if (path.includes('/progress')) return Promise.resolve({ data: { available_credits: 0, progress_items: [] } });
    const read = deferred(); reads.push(read); return read.promise;
  });
});
afterEach(() => { jest.restoreAllMocks(); document.documentElement.className = ''; });

test('catalog-shaped item resolves its detail before exposing a native retailer link', async () => {
  await mount();
  const read = request();
  expect(screen.getByRole('status')).toHaveTextContent('Loading retailer link');
  expect(screen.getAllByTitle('View on retailer site')[0]).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await settle(read, destination());
  const link = screen.getByRole('link', { name: 'Open Synthetic Camera on retailer site' });
  expect(link).toHaveAttribute('href', 'https://retailer.example/item-a');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link.tagName).toBe('A');
  expect(window.open).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
});

test('does not use an unconfirmed URL incidentally present on a list record', async () => {
  catalog = [{ ...items[0], affiliate_url: 'https://retailer.example/old' }];
  await mount();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  const read = request();
  await settle(read, destination());
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://retailer.example/item-a');
  expect(window.open).not.toHaveBeenCalled();
});

test.each([undefined, null, '', '   ', 42, 'not a destination', '/relative-item', 'ftp://retailer.example/item'])('missing or unusable destination %p leaves a scoped error and retry', async url => {
  await mount(); const read = request(); await settle(read, { data: { id: items[0].id, affiliate_url: url } });
  expect(screen.getByRole('alert')).toHaveTextContent('Retailer link unavailable');
  expect(screen.getByRole('button', { name: 'Retry retailer link for Synthetic Camera' })).toBeEnabled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(window.open).not.toHaveBeenCalled();
});

test('a detail for another item cannot supply the selected card destination', async () => {
  await mount(); const read = request(); await settle(read, destination(1));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test.each([404, 500, null])('a failed read %p retries the same item without a purchase', async status => {
  await mount(); const read = request();
  await act(async () => { read.reject(status ? { response: { status } } : new Error('offline')); await Promise.resolve(); });
  fireEvent.click(screen.getByRole('button', { name: 'Retry retailer link for Synthetic Camera' }));
  expect(reads).toHaveLength(2);
  await settle(reads[1], destination());
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://retailer.example/item-a');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

test('a superseded item read cannot replace the latest selected destination', async () => {
  await mount(); const old = request(); const latest = request(1);
  await settle(latest, destination(1, 'https://retailer.example/item-b'));
  await settle(old, destination());
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Open Synthetic Lens on retailer site' })).toHaveAttribute('href', 'https://retailer.example/item-b');
});

test('an older failure cannot erase a newer successful destination', async () => {
  await mount(); const old = request(); const latest = request(1);
  await settle(latest, destination(1, 'https://retailer.example/item-b'));
  await act(async () => { old.reject(new Error('offline')); await Promise.resolve(); });
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://retailer.example/item-b');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('filter changes invalidate pending and already resolved retailer destinations', async () => {
  await mount(); const old = request();
  fireEvent.change(screen.getByPlaceholderText('Search cameras, lenses, surfboards...'), { target: { value: 'lens' } });
  await settle(old, destination()); expect(screen.queryByRole('link')).not.toBeInTheDocument();
  const current = request(); await settle(current, destination());
  expect(screen.getByRole('link')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search cameras, lenses, surfboards...'), { target: { value: '' } });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test.each([null, { id: 'synthetic-next', role: 'Surfer', access_token: 'synthetic-next-session' },
  { id: 'synthetic-owner', role: 'Surfer', access_token: 'synthetic-replacement-session' }])('account departure %p invalidates a pending detail', async user => {
  const { rerender } = await mount(); const old = request(); mockUser = user; rerender(<GearHub />);
  await settle(old, destination()); expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('a pending response from an unmounted instance cannot supply a remounted item link', async () => {
  const first = await mount(); const old = request(); first.unmount(); await mount();
  await settle(old, destination()); expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(window.open).not.toHaveBeenCalled();
});

test('ordinary detail resolution remains available after StrictMode cleanup/setup', async () => {
  await mount(true); const read = request(); await settle(read, destination());
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://retailer.example/item-a');
});

test.each(['light', 'dark', 'beach'])('retailer control is keyboard reachable with semantic theme classes in %s', async theme => {
  document.documentElement.className = theme;
  await mount(); const user = userEvent.setup();
  const button = screen.getAllByTitle('View on retailer site')[0]; button.focus();
  expect(button).toHaveAccessibleName('View Synthetic Camera on retailer site');
  await user.keyboard('{Enter}');
  expect(apiClient.get).toHaveBeenCalledWith('/gear-hub/synthetic-a');
  await settle(reads[0], destination());
  const link = screen.getByRole('link'); expect(link).toHaveFocus();
  expect(link).toHaveClass('text-muted-foreground');
  expect(link).toHaveAttribute('href', 'https://retailer.example/item-a');
  expect(window.open).not.toHaveBeenCalled();
});


test('repeated activation while pending does not duplicate the item read', async () => {
  await mount(); const read = request();
  fireEvent.click(screen.getAllByTitle('View on retailer site')[0]);
  expect(reads).toHaveLength(1); await settle(read, destination());
});

test('read completion does not steal focus after the user moves elsewhere', async () => {
  await mount(); const button = screen.getAllByTitle('View on retailer site')[0]; button.focus();
  const read = request(); const search = screen.getByPlaceholderText('Search cameras, lenses, surfboards...');
  fireEvent.blur(button); search.focus(); await settle(read, destination()); expect(search).toHaveFocus();
});

test.each(['  https://retailer.example/item-a  ', 'http://retailer.example/item-a'])('uses an ordinary absolute destination %p', async url => {
  await mount(); const read = request(); await settle(read, destination(0, url));
  expect(screen.getByRole('link')).toHaveAttribute('href', url.trim());
});

test.each([null, {}, {affiliate_url:'https://retailer.example/item-a'}])('incomplete detail %p cannot produce an unrelated destination', async data => {
  await mount(); const read = request(); await settle(read, {data});
  expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
});


test('a newer item failure cannot fall back to an older item success', async () => {
  await mount(); const old = request(); const latest = request(1);
  await act(async () => { latest.reject(new Error('offline')); await Promise.resolve(); });
  await settle(old, destination());
  expect(screen.getByRole('button', { name: 'Retry retailer link for Synthetic Lens' })).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('switching A to B and back to A does not revive the first A request', async () => {
  await mount(); const oldA = request(); const oldB = request(1); const currentA = request();
  await settle(currentA, destination(0, 'https://retailer.example/current-a'));
  await settle(oldB, destination(1, 'https://retailer.example/item-b'));
  await settle(oldA, destination());
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://retailer.example/current-a');
});
