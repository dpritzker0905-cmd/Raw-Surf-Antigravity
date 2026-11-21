import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ComposeModal from './ComposeModal';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../contexts/PersonaContext', () => ({
  isProLevelRole: () => false, isBusinessRole: () => false, getExpandedRoleInfo: () => ({}),
}));

let requests;
const profile = id => ({ id, full_name: id, role: 'Surfer' });
const contact = id => ({ other_user_id: id, other_user_name: id, other_user_role: 'Surfer' });
beforeEach(() => {
  requests = [];
  apiClient.get.mockReset().mockImplementation(url => new Promise((resolve, reject) => {
    requests.push({ url, resolve, reject });
  }));
});
const resolve = async (request, data) => { await act(async () => request.resolve({ data })); };
const reject = async request => { await act(async () => request.reject(new Error('offline'))); };
const type = value => fireEvent.change(screen.getByRole('textbox'), { target: { value } });

function mount() {
  const props = { currentUserId: 'owner-a', isOpen: true, onClose: jest.fn(), onSelectUser: jest.fn() };
  const ui = render(<ComposeModal {...props} />);
  return { ...props, change: overrides => ui.rerender(<ComposeModal {...props} {...overrides} />) };
}

test('a late search cannot replace the matching recipient or open the wrong chat', async () => {
  const ui = mount();
  type('reef');
  type('tide');
  expect(requests.map(r => r.url)).toEqual([
    '/messages/conversations/owner-a?inbox_type=all', '/profiles/search?q=reef&limit=20', '/profiles/search?q=tide&limit=20',
  ]);
  await resolve(requests[2], [profile('Tide')]);
  await resolve(requests[1], [profile('Reef')]);
  expect(screen.queryByText('Reef')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Tide'));
  expect(ui.onSelectUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'Tide' }));
  expect(ui.onClose).toHaveBeenCalledTimes(1);
});

test('a failed search is retryable and only a successful empty response shows no matches', async () => {
  mount();
  await resolve(requests[0], [contact('Recent')]);
  type('sea');
  await reject(requests[1]);
  expect(screen.queryByText('No users found')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(requests[2].url).toBe(requests[1].url);
  await resolve(requests[2], []);
  expect(screen.getByText('No users found')).toBeVisible();
  type('');
  expect(screen.getByText('Recent')).toBeVisible();
});

test('a previous account or closed composer cannot supply suggestions to the next one', async () => {
  const ui = mount();
  await resolve(requests[0], [contact('First contact')]);
  ui.change({ currentUserId: 'owner-b' });
  expect(screen.queryByText('First contact')).not.toBeInTheDocument();
  ui.change({ isOpen: false, currentUserId: 'owner-b' });
  await resolve(requests[1], [contact('Late contact')]);
  ui.change({ currentUserId: 'owner-b' });
  await reject(requests[2]);
  expect(screen.queryByText('Late contact')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await resolve(requests[3], [contact('Current contact')]);
  expect(screen.getByText('Current contact')).toBeVisible();
});

test('clearing a search ignores late failures and restores suggestions', async () => {
  mount();
  await resolve(requests[0], [contact('Recent')]);
  type('swell');
  type('');
  await reject(requests[1]);
  expect(screen.getByText('Recent')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test('re-entering a query waits for its new request, even when the earlier query succeeded', async () => {
  mount();
  type('wave');
  await resolve(requests[1], [profile('Former match')]);
  type('reef');
  type('wave');
  expect(screen.queryByText('Former match')).not.toBeInTheDocument();
  await reject(requests[2]);
  await reject(requests[0]);
  expect(screen.getByRole('status', { name: 'Loading recipients' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await resolve(requests[3], [profile('Current match')]);
  expect(screen.getByText('Current match')).toBeVisible();
});
