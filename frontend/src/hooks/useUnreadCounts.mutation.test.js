import { renderHook, act } from '@testing-library/react';
import { useUnreadCounts, refreshUnreadCounts } from './useUnreadCounts';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks();
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('/messages/') ? { total: 2 } : { unread_count: 0 } }));
});

it('post-mutation force refresh supersedes the in-flight pre-mutation count', async () => {
  const old = deferred();
  apiClient.get.mockImplementationOnce(() => old.promise);
  const { result } = renderHook(() => useUnreadCounts('owner'));
  await act(async () => { await refreshUnreadCounts({ force: true }); });
  expect(result.current.notifications).toBe(0);
  await act(async () => old.resolve({ data: { unread_count: 9 } }));
  expect(result.current.notifications).toBe(0);
  expect(apiClient.get.mock.calls.filter(([url]) => url.includes('/notifications/'))).toHaveLength(2);
});

it('an A to B to A account cycle does not reaccept the first A response', async () => {
  const old = deferred();
  apiClient.get.mockImplementationOnce(() => old.promise);
  const { result, rerender } = renderHook(({ id }) => useUnreadCounts(id), { initialProps: { id: 'a' } });
  rerender({ id: 'b' });
  await flush();
  rerender({ id: 'a' });
  await flush();
  await act(async () => old.resolve({ data: { unread_count: 9 } }));
  expect(result.current.notifications).toBe(0);
});
