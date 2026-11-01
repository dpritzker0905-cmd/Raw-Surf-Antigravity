import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GlobalSearchBar from './GlobalSearchBar';
import apiClient from '../lib/apiClient';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), error: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('../contexts/PersonaContext', () => ({ getExpandedRoleInfo: () => null }));

const result = name => ({ data: { users: [{ id: name, full_name: name }], spots: [], posts: [], hashtags: [] } });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const type = text => fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: text } });
const debounce = async () => { await act(async () => { jest.advanceTimersByTime(300); }); };
const finish = async (request, value) => { await act(async () => { request.resolve(value); }); };

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  mockNavigate.mockReset();
  apiClient.get.mockReset();
  apiClient.get.mockImplementation(url => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : Promise.resolve(result('default')));
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('closes and clears completed results immediately when the query becomes one character', async () => {
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  expect(screen.getByTestId('search-result-user-default')).toBeInTheDocument();
  type('r');
  expect(screen.queryByTestId('search-results-dropdown')).not.toBeInTheDocument();
  await debounce();
  expect(screen.queryByTestId('search-results-dropdown')).not.toBeInTheDocument();
});

it('ignores an old response during the next query debounce, then keeps the new result', async () => {
  const old = deferred();
  const current = deferred();
  apiClient.get.mockImplementation((url, config) => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : config.params.q === 'reef' ? old.promise : current.promise);
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  type('beach');
  await finish(old, result('old-reef'));
  expect(screen.queryByText('old-reef')).not.toBeInTheDocument();
  await debounce();
  await finish(current, result('current-beach'));
  expect(screen.getByText('current-beach')).toBeInTheDocument();
});

it('keeps the latest result when an older request finishes last', async () => {
  const old = deferred();
  const current = deferred();
  apiClient.get.mockImplementation((url, config) => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : config.params.q === 'reef' ? old.promise : current.promise);
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  type('beach');
  await debounce();
  await finish(current, result('current-beach'));
  await finish(old, result('old-reef'));
  expect(screen.getByText('current-beach')).toBeInTheDocument();
  expect(screen.queryByText('old-reef')).not.toBeInTheDocument();
});

it('does not launch fallback for a rejected superseded query', async () => {
  const old = deferred();
  apiClient.get.mockImplementation(url => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : old.promise);
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  type('r');
  await act(async () => { old.reject(new Error('old failure')); });
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/explore/search')).toHaveLength(0);
  expect(screen.queryByTestId('search-results-dropdown')).not.toBeInTheDocument();
});

it('ignores an older fallback response after a new primary result', async () => {
  const fallback = deferred();
  apiClient.get.mockImplementation((url, config) => {
    if (url.startsWith('/hashtags/')) return Promise.resolve({ data: { hashtags: [] } });
    if (url === '/explore/search') return fallback.promise;
    return config.params.q === 'reef' ? Promise.reject(new Error('primary failed')) : Promise.resolve(result('beach'));
  });
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  type('beach');
  await debounce();
  await finish(fallback, result('old-fallback'));
  expect(screen.getByText('beach')).toBeInTheDocument();
  expect(screen.queryByText('old-fallback')).not.toBeInTheDocument();
});

it('retains the current fallback and encodes View All navigation', async () => {
  apiClient.get.mockImplementation(url => {
    if (url.startsWith('/hashtags/')) return Promise.resolve({ data: { hashtags: [] } });
    return url === '/search/global' ? Promise.reject(new Error('primary failed')) : Promise.resolve(result('fallback'));
  });
  render(<GlobalSearchBar />);
  type(' reef & sand ');
  await debounce();
  expect(screen.getByText('fallback')).toBeInTheDocument();
  fireEvent.click(screen.getByText('View all results for " reef & sand "'));
  expect(mockNavigate).toHaveBeenCalledWith('/explore?q=reef%20%26%20sand');
});

it('keeps a cleared query closed after its pending request resolves', async () => {
  const request = deferred();
  apiClient.get.mockImplementation(url => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : request.promise);
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  fireEvent.click(screen.getByRole('button', { name: /clear search|loader2/i }));
  await finish(request, result('late-result'));
  expect(screen.getByTestId('global-search-input')).toHaveValue('');
  expect(screen.queryByTestId('search-results-dropdown')).not.toBeInTheDocument();
});

it('does not launch fallback after unmount', async () => {
  const request = deferred();
  apiClient.get.mockImplementation(url => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : request.promise);
  const { unmount } = render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  unmount();
  await act(async () => { request.reject(new Error('late failure')); });
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/explore/search')).toHaveLength(0);
});

it('keeps the current spinner active when an old request finishes first', async () => {
  const old = deferred();
  const current = deferred();
  apiClient.get.mockImplementation((url, config) => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : config.params.q === 'reef' ? old.promise : current.promise);
  render(<GlobalSearchBar variant="mobile-expanded" />);
  type('reef');
  await debounce();
  const oldSignal = apiClient.get.mock.calls.find(([url]) => url === '/search/global')[1].signal;
  type('beach');
  await debounce();
  expect(oldSignal.aborted).toBe(true);
  await finish(old, result('old-reef'));
  expect(screen.getByRole('button', { name: 'Clear search' }).querySelector('.animate-spin')).not.toBeNull();
  await finish(current, result('current-beach'));
  expect(screen.getByRole('button', { name: 'Clear search' }).querySelector('.animate-spin')).toBeNull();
});

it('rejects the first request even if the user clears and retypes the same query', async () => {
  const old = deferred();
  const current = deferred();
  let calls = 0;
  apiClient.get.mockImplementation(url => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : (++calls === 1 ? old.promise : current.promise));
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  type('');
  type('reef');
  await debounce();
  await finish(current, result('current-reef'));
  await finish(old, result('old-reef'));
  expect(screen.getByText('current-reef')).toBeInTheDocument();
  expect(screen.queryByText('old-reef')).not.toBeInTheDocument();
});

it('does not reopen the persistent sidebar dropdown after submitting before debounce', async () => {
  render(<GlobalSearchBar />);
  type('reef');
  fireEvent.submit(screen.getByTestId('global-search-input').closest('form'));
  expect(mockNavigate).toHaveBeenCalledWith('/explore?q=reef');
  await debounce();
  expect(screen.queryByTestId('search-results-dropdown')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/search/global')).toHaveLength(0);
});

it('invalidates an active sidebar request when its query is submitted', async () => {
  const request = deferred();
  apiClient.get.mockImplementation(url => url.startsWith('/hashtags/')
    ? Promise.resolve({ data: { hashtags: [] } }) : request.promise);
  render(<GlobalSearchBar />);
  type('reef');
  await debounce();
  fireEvent.submit(screen.getByTestId('global-search-input').closest('form'));
  await act(async () => { request.reject(new Error('late sidebar failure')); });
  expect(mockNavigate).toHaveBeenCalledWith('/explore?q=reef');
  expect(screen.queryByTestId('search-results-dropdown')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/explore/search')).toHaveLength(0);
});
