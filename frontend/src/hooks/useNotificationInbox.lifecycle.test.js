import { renderHook, act } from '@testing-library/react';
import useNotificationInbox from './useNotificationInbox';
import { getNotifications, getUnreadCount, markAllRead, markRead } from '../services/notificationService';
import { refreshUnreadCounts } from './useUnreadCounts';

jest.mock('../services/notificationService', () => ({
  getNotifications: jest.fn(), getUnreadCount: jest.fn(), markAllRead: jest.fn(), markRead: jest.fn(),
}));
jest.mock('./useUnreadCounts', () => ({ refreshUnreadCounts: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const row = (id, is_read = false) => ({ id, is_read, created_at: '2026-10-29T16:00:00Z' });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
beforeEach(() => {
  jest.clearAllMocks();
  getNotifications.mockResolvedValue({ data: [row('existing')] });
  getUnreadCount.mockResolvedValue({ data: { unread_count: 3 } });
  markAllRead.mockResolvedValue({ data: {} });
  markRead.mockResolvedValue({ data: {} });
});

it('invalidates a pre-mutation refresh and reads a new arrival as unread after mark-all', async () => {
  const { result } = renderHook(() => useNotificationInbox('owner'));
  await flush();
  const staleRows = deferred();
  const staleCount = deferred();
  getNotifications.mockReturnValueOnce(staleRows.promise);
  getUnreadCount.mockReturnValueOnce(staleCount.promise);
  act(() => { result.current.reload(); });
  const write = deferred();
  markAllRead.mockReturnValueOnce(write.promise);
  act(() => { result.current.readAll(); });
  getNotifications.mockResolvedValue({ data: [row('new arrival'), row('existing', true)] });
  getUnreadCount.mockResolvedValue({ data: { unread_count: 1 } });
  await act(async () => write.resolve({ data: {} }));
  await flush();
  await act(async () => {
    staleRows.resolve({ data: [row('stale')] });
    staleCount.resolve({ data: { unread_count: 3 } });
  });
  expect(result.current.items).toEqual([row('new arrival'), row('existing', true)]);
  expect(result.current.unread).toBe(1);
  expect(refreshUnreadCounts).toHaveBeenCalledWith({ force: true });
});

it('drops a pending read when the drawer closes, even if the same user reopens it', async () => {
  const old = deferred();
  getNotifications.mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(({ open }) => useNotificationInbox('owner', open), { initialProps: { open: true } });
  rerender({ open: false });
  expect(result.current.items).toEqual([]);
  rerender({ open: true });
  await flush();
  await act(async () => old.resolve({ data: [row('stale closed drawer')] }));
  expect(result.current.items).toEqual([row('existing')]);
});

it('does not perform follow-up UI or count work after unmount during a write', async () => {
  const { result, unmount } = renderHook(() => useNotificationInbox('owner'));
  await flush();
  const write = deferred();
  markRead.mockReturnValueOnce(write.promise);
  let read;
  act(() => { read = result.current.read('existing'); });
  unmount();
  await act(async () => write.resolve({ data: {} }));
  expect(await read).toBe(false);
  expect(refreshUnreadCounts).not.toHaveBeenCalled();
});

it('notifies another mounted inbox without optimistic blanket-read updates', async () => {
  const { result } = renderHook(() => [useNotificationInbox('owner'), useNotificationInbox('owner')]);
  await flush();
  getNotifications.mockResolvedValue({ data: [row('arrived after read-all'), row('existing', true)] });
  getUnreadCount.mockResolvedValue({ data: { unread_count: 1 } });
  await act(async () => { await result.current[0].readAll(); });
  result.current.forEach(inbox => {
    expect(inbox.items[0]).toEqual(row('arrived after read-all'));
    expect(inbox.unread).toBe(1);
  });
});

it('keeps history on an older-page failure and retries the same cursor', async () => {
  const first = Array.from({ length: 50 }, (_, i) => row(`n${i}`));
  getNotifications.mockResolvedValueOnce({ data: first });
  const { result } = renderHook(() => useNotificationInbox('owner'));
  await flush();
  getNotifications.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await result.current.loadOlder(); });
  expect(result.current.items).toEqual(first);
  expect(result.current.error).toBe('older');
  getNotifications.mockResolvedValueOnce({ data: [row('oldest')] });
  await act(async () => { await result.current.loadOlder(); });
  expect(result.current.items).toHaveLength(51);
  expect(getNotifications).toHaveBeenLastCalledWith('owner', { limit: 50, before_created_at: first[49].created_at, before_id: first[49].id });
});

it('keeps writes serialized until their authoritative refresh finishes', async () => {
  const { result } = renderHook(() => useNotificationInbox('owner'));
  await flush();
  const refresh = deferred();
  getNotifications.mockReturnValueOnce(refresh.promise);
  let first;
  act(() => { first = result.current.readAll(); });
  await flush();
  await act(async () => { expect(await result.current.readAll()).toBe(false); });
  expect(markAllRead).toHaveBeenCalledTimes(1);
  await act(async () => refresh.resolve({ data: [row('existing', true)] }));
  expect(await first).toBe(true);
  expect(result.current.mutating).toBe(false);
});
