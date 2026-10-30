import React, { StrictMode, Suspense, startTransition, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import useNotificationInbox from './useNotificationInbox';
import { getNotifications, getUnreadCount, markRead, markAllRead } from '../services/notificationService';
import { refreshUnreadCounts } from './useUnreadCounts';

jest.mock('../services/notificationService', () => ({
  getNotifications: jest.fn(), getUnreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(),
}));
jest.mock('./useUnreadCounts', () => ({ refreshUnreadCounts: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

const row = (is_read = false, id = 'notification') => ({ id, is_read, created_at: '2026-10-29T16:00:00Z' });
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => act(async () => {});
const mount = () => renderHook(({ user, open }) => useNotificationInbox(user, open), {
  initialProps: { user: 'owner', open: true },
});
const switchCycle = (hook, transition) => {
  if (transition === 'unmount') hook.unmount();
  else if (transition === 'account') {
    hook.rerender({ user: 'other', open: true });
    hook.rerender({ user: 'owner', open: true });
  } else {
    hook.rerender({ user: 'owner', open: false });
    hook.rerender({ user: 'owner', open: true });
  }
};

beforeEach(() => {
  getNotifications.mockResolvedValue({ data: [row()] });
  getUnreadCount.mockResolvedValue({ data: { unread_count: 1 } });
  markRead.mockResolvedValue({ data: {} });
  markAllRead.mockResolvedValue({ data: {} });
  refreshUnreadCounts.mockResolvedValue();
});

it('serializes same-tick already-read activation and bulk/single writes', async () => {
  const { result } = mount(); await flush();
  const callback = jest.fn(); let first; let duplicate; let bulk; let single;
  act(() => {
    first = result.current.activate(row(true), callback);
    duplicate = result.current.activate(row(true), callback);
    bulk = result.current.readAll();
    single = result.current.read('other');
    expect(callback).not.toHaveBeenCalled();
  });
  await act(async () => {
    expect(await first).toBe(true);
    expect(await duplicate).toBe(false);
    expect(await bulk).toBe(false);
    expect(await single).toBe(false);
  });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(markRead).not.toHaveBeenCalled();
  expect(markAllRead).not.toHaveBeenCalled();
  expect(result.current.mutating).toBe(false);
});

it('waits for the unread write and authoritative refresh before activating', async () => {
  const write = deferred(); const refresh = deferred();
  const { result } = mount(); await flush();
  markRead.mockReturnValueOnce(write.promise);
  getNotifications.mockReturnValueOnce(refresh.promise);
  const callback = jest.fn(); let operation;
  act(() => { operation = result.current.activate(row(), callback); });
  expect(markRead).toHaveBeenCalledWith('notification');
  await act(async () => { expect(await result.current.activate(row(), callback)).toBe(false); });
  await act(async () => write.resolve({ data: {} }));
  expect(callback).not.toHaveBeenCalled();
  expect(result.current.mutating).toBe(true);
  await act(async () => { expect(await result.current.readAll()).toBe(false); });
  await act(async () => { refresh.resolve({ data: [row(true)] }); expect(await operation).toBe(true); });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(result.current.items).toEqual([row(true)]);
  expect(refreshUnreadCounts).toHaveBeenCalledWith({ force: true });
});

it.each([true, false])('rejects activation (read=%s) while read-all is pending', async isRead => {
  const write = deferred(); markAllRead.mockReturnValueOnce(write.promise);
  const { result } = mount(); await flush();
  let operation; act(() => { operation = result.current.readAll(); });
  const callback = jest.fn();
  await act(async () => { expect(await result.current.activate(row(isRead), callback)).toBe(false); });
  expect(callback).not.toHaveBeenCalled();
  expect(markRead).not.toHaveBeenCalled();
  await act(async () => { write.resolve({ data: {} }); await operation; });
});

it('holds the lock through an asynchronous activation callback', async () => {
  const held = deferred(); const callback = jest.fn(() => held.promise);
  const { result } = mount(); await flush();
  let operation; act(() => { operation = result.current.activate(row(true), callback); });
  await flush();
  expect(callback).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await result.current.readAll()).toBe(false); });
  await act(async () => { held.resolve(); expect(await operation).toBe(true); });
  await act(async () => { expect(await result.current.readAll()).toBe(true); });
});

it('releases the lock after a current mark failure and allows retry', async () => {
  const failure = new Error('fixture write failed');
  markRead.mockRejectedValueOnce(failure);
  const { result } = mount(); await flush(); const callback = jest.fn();
  await act(async () => { await expect(result.current.activate(row(), callback)).rejects.toBe(failure); });
  expect(callback).not.toHaveBeenCalled();
  expect(result.current.mutating).toBe(false);
  await act(async () => { expect(await result.current.activate(row(), callback)).toBe(true); });
  expect(markRead).toHaveBeenCalledTimes(2);
  expect(callback).toHaveBeenCalledTimes(1);
});

it.each(['rows', 'count'])('does not activate after an authoritative %s failure and permits retry', async target => {
  const { result } = mount(); await flush(); const callback = jest.fn();
  (target === 'rows' ? getNotifications : getUnreadCount).mockRejectedValueOnce(new Error('fixture refresh failed'));
  await act(async () => { expect(await result.current.activate(row(), callback, { requireFresh: true })).toBe(false); });
  expect(callback).not.toHaveBeenCalled();
  expect(result.current.error).toBe('latest');
  expect(result.current.mutating).toBe(false);
  await act(async () => { expect(await result.current.activate(row(), callback, { requireFresh: true })).toBe(true); });
  expect(callback).toHaveBeenCalledTimes(1);
});

it.each(['account', 'reopen', 'unmount'])('rejects previously captured actions after %s', async transition => {
  const hook = mount(); await flush(); const old = hook.result.current;
  switchCycle(hook, transition); await flush();
  const callback = jest.fn();
  getNotifications.mockClear(); markAllRead.mockClear(); markRead.mockClear();
  await act(async () => {
    expect(await old.read('old')).toBe(false);
    expect(await old.readAll()).toBe(false);
    await old.reload();
    await old.loadOlder();
  });
  expect(markRead).not.toHaveBeenCalled();
  expect(markAllRead).not.toHaveBeenCalled();
  expect(getNotifications).not.toHaveBeenCalled();
  await act(async () => { expect(await old.activate(row(true), callback)).toBe(false); });
  expect(callback).not.toHaveBeenCalled();
});

it.each(['account', 'reopen', 'unmount'])('cancels a queued read-only activation on %s', async transition => {
  const hook = mount(); await flush(); const callback = jest.fn(); let operation;
  act(() => { operation = hook.result.current.activate(row(true), callback); });
  switchCycle(hook, transition);
  await act(async () => { expect(await operation).toBe(false); });
  expect(callback).not.toHaveBeenCalled();
});

it.each(['account', 'reopen', 'unmount'].flatMap(transition => [[transition, 'resolve'], [transition, 'reject']]))(
  'drops pending activation on %s before mark %s', async (transition, outcome) => {
    const gate = deferred(); markRead.mockReturnValueOnce(gate.promise);
    const hook = mount(); await flush(); const callback = jest.fn(); let operation;
    act(() => { operation = hook.result.current.activate(row(), callback); });
    switchCycle(hook, transition); await flush();
    getNotifications.mockClear(); refreshUnreadCounts.mockClear();
    await act(async () => {
      if (outcome === 'resolve') gate.resolve({ data: {} }); else gate.reject(new Error('obsolete write'));
      expect(await operation).toBe(false);
    });
    expect(callback).not.toHaveBeenCalled();
    expect(getNotifications).not.toHaveBeenCalled();
    expect(refreshUnreadCounts).not.toHaveBeenCalled();
    if (transition !== 'unmount') expect(hook.result.current.mutating).toBe(false);
  });

it.each(['resolve', 'reject'])('drops an obsolete authoritative refresh %s without navigation or error', async outcome => {
  const gate = deferred();
  const hook = mount(); await flush();
  getNotifications.mockReturnValueOnce(gate.promise);
  const callback = jest.fn(); let operation;
  act(() => { operation = hook.result.current.activate(row(), callback); });
  await flush(); switchCycle(hook, 'account'); await flush();
  await act(async () => {
    if (outcome === 'resolve') gate.resolve({ data: [row(true, 'obsolete')] }); else gate.reject(new Error('obsolete refresh'));
    expect(await operation).toBe(false);
  });
  expect(callback).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.items).toEqual([row()]);
});

it('does not let an obsolete callback settlement unlock the next activation', async () => {
  const oldGate = deferred(); const newGate = deferred();
  const hook = mount(); await flush(); let old; let current;
  act(() => { old = hook.result.current.activate(row(true), () => oldGate.promise); });
  await flush(); switchCycle(hook, 'reopen'); await flush();
  act(() => { current = hook.result.current.activate(row(true), () => newGate.promise); });
  await flush();
  await act(async () => { oldGate.resolve(); expect(await old).toBe(false); });
  expect(hook.result.current.mutating).toBe(true);
  await act(async () => { expect(await hook.result.current.readAll()).toBe(false); });
  await act(async () => { newGate.resolve(); expect(await current).toBe(true); });
});

it('preserves a committed write during an abandoned suspended account render', async () => {
  const gate = deferred(); const suspended = deferred();
  markAllRead.mockReturnValueOnce(gate.promise);
  const { result } = renderHook(() => {
    const [user, changeUser] = useState('owner');
    const inbox = useNotificationInbox(user);
    if (user === 'suspended') throw suspended.promise;
    return { ...inbox, changeUser };
  }, { wrapper: ({ children }) => <Suspense fallback={null}>{children}</Suspense> });
  await flush(); let operation;
  act(() => { operation = result.current.readAll(); });
  act(() => startTransition(() => result.current.changeUser('suspended')));
  await act(async () => { gate.resolve({ data: {} }); expect(await operation).toBe(true); });
  expect(refreshUnreadCounts).toHaveBeenCalledWith({ force: true });
  act(() => result.current.changeUser('owner'));
});

it('preserves committed activation during an abandoned suspended close render', async () => {
  const gate = deferred(); const suspended = deferred(); markRead.mockReturnValueOnce(gate.promise);
  const { result } = renderHook(() => {
    const [open, changeOpen] = useState(true);
    const inbox = useNotificationInbox('owner', open);
    if (!open) throw suspended.promise;
    return { ...inbox, changeOpen };
  }, { wrapper: ({ children }) => <Suspense fallback={null}>{children}</Suspense> });
  await flush(); const callback = jest.fn(); let operation;
  act(() => { operation = result.current.activate(row(), callback); });
  act(() => startTransition(() => result.current.changeOpen(false)));
  await act(async () => { gate.resolve({ data: {} }); expect(await operation).toBe(true); });
  expect(callback).toHaveBeenCalledTimes(1);
  act(() => result.current.changeOpen(true));
});

it('remains usable after StrictMode effect replay', async () => {
  const { result } = renderHook(() => useNotificationInbox('owner'), {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
  await flush(); const callback = jest.fn();
  await act(async () => { expect(await result.current.activate(row(), callback)).toBe(true); });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(result.current.mutating).toBe(false);
});

it('preserves existing read-all success semantics when its refresh fails', async () => {
  const { result } = mount(); await flush();
  getNotifications.mockRejectedValueOnce(new Error('fixture refresh failed'));
  await act(async () => { expect(await result.current.readAll()).toBe(true); });
  expect(result.current.error).toBe('latest');
});

it.each([null, undefined, {}, [], { id: null }, { id: 0 }, { id: '' }, { id: '   ' }])(
  'rejects malformed activation input %# without marking all notifications', async notification => {
    const { result } = mount(); await flush(); const callback = jest.fn();
    await act(async () => { expect(await result.current.activate(notification, callback)).toBe(false); });
    expect(markRead).not.toHaveBeenCalled();
    expect(markAllRead).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(result.current.mutating).toBe(false);
  });

it('rejects activation without a callback before writing', async () => {
  const { result } = mount(); await flush();
  await act(async () => { expect(await result.current.activate(row())).toBe(false); });
  expect(markRead).not.toHaveBeenCalled();
  expect(markAllRead).not.toHaveBeenCalled();
});

it('rejects a function masquerading as a notification object', async () => {
  const { result } = mount(); await flush();
  const invalid = Object.assign(() => {}, { id: 'invalid' });
  await act(async () => { expect(await result.current.activate(invalid, jest.fn())).toBe(false); });
  expect(markRead).not.toHaveBeenCalled();
  expect(markAllRead).not.toHaveBeenCalled();
});

it('releases the lock after a current activation callback throws', async () => {
  const { result } = mount(); await flush(); const error = new Error('fixture callback failed');
  await act(async () => {
    await expect(result.current.activate(row(true), () => { throw error; })).rejects.toBe(error);
  });
  expect(result.current.mutating).toBe(false);
  const callback = jest.fn();
  await act(async () => { expect(await result.current.activate(row(true), callback)).toBe(true); });
  expect(callback).toHaveBeenCalledTimes(1);
});

it('suppresses an obsolete callback rejection after the drawer reopens', async () => {
  const gate = deferred(); const hook = mount(); await flush(); let operation;
  act(() => { operation = hook.result.current.activate(row(true), () => gate.promise); });
  await flush(); switchCycle(hook, 'reopen'); await flush();
  await act(async () => { gate.reject(new Error('obsolete callback')); expect(await operation).toBe(false); });
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.mutating).toBe(false);
});

it('preserves default activation after a successful write when its refresh fails', async () => {
  const { result } = mount(); await flush(); const callback = jest.fn();
  getNotifications.mockRejectedValueOnce(new Error('fixture refresh failed'));
  await act(async () => { expect(await result.current.activate(row(), callback)).toBe(true); });
  expect(markRead).toHaveBeenCalledWith('notification');
  expect(callback).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBe('latest');
  expect(result.current.mutating).toBe(false);
});
