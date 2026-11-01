/*
 * Push per account per device (#470, 2026-10-23). The page is made non-localhost here (the hook skips the service
 * worker on localhost; this Jest 27 ignores a docblock URL, so window.location is stubbed for this file), and the
 * browser's push subscription is a fake one endpoint shared by every account on this browser.
 *
 * Pins:
 *  - logout's helper deletes the LEAVING account's row for this device with that account's own token;
 *  - Off deletes only this account's row and leaves the browser subscription for other accounts;
 *  - the backend status is asked only where asked for (Settings), never on every page load;
 *  - On (subscribe) records this account's opt-in.
 */
import { renderHook, act, waitFor } from '@testing-library/react';

jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import apiClient from '../lib/apiClient';
import { usePushNotifications, forgetThisDeviceForAccount, hasPushOptIn, recordPushOptIn } from './usePushNotifications';

const ENDPOINT = 'https://push.example.invalid/device-1';
const DELETE_URL = `/push/unsubscribe?endpoint=${encodeURIComponent(ENDPOINT)}`;
let browserSub;
let reg;
const realLocation = window.location;

beforeAll(() => {
  delete window.location;
  window.location = { ...realLocation, hostname: 'rawsurf.test', href: 'https://rawsurf.test/settings' };
});
afterAll(() => { window.location = realLocation; });

beforeEach(() => {
  localStorage.clear();
  browserSub = { endpoint: ENDPOINT, unsubscribe: jest.fn(), toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }) };
  reg = { pushManager: { getSubscription: jest.fn().mockResolvedValue(browserSub), subscribe: jest.fn().mockResolvedValue(browserSub) } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true, value: { register: jest.fn().mockResolvedValue(reg), getRegistration: jest.fn().mockResolvedValue(reg) },
  });
  window.PushManager = function PushManager() {};
  window.Notification = { permission: 'granted', requestPermission: jest.fn().mockResolvedValue('granted') };
  apiClient.get.mockImplementation((url) => Promise.resolve({
    data: url.startsWith('/push/status') ? { subscribed: true } : { public_key: 'AQAB' },
  }));
  apiClient.post.mockResolvedValue({ data: { status: 'new' } });
  apiClient.delete.mockResolvedValue({ data: {} });
});

describe('logout: forgetThisDeviceForAccount', () => {
  it('deletes the leaving account\'s row for this device with that account\'s own token', async () => {
    await expect(forgetThisDeviceForAccount('token-of-a')).resolves.toBe(true);
    expect(apiClient.delete).toHaveBeenCalledTimes(1);
    expect(apiClient.delete).toHaveBeenCalledWith(DELETE_URL, { headers: { Authorization: 'Bearer token-of-a' } });
    expect(browserSub.unsubscribe).not.toHaveBeenCalled();
  });

  it('does nothing without a token or without a push subscription on this browser', async () => {
    await expect(forgetThisDeviceForAccount(null)).resolves.toBe(false);
    reg.pushManager.getSubscription.mockResolvedValue(null);
    await expect(forgetThisDeviceForAccount('token-of-a')).resolves.toBe(false);
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('never throws (logout must not fail on a network error)', async () => {
    apiClient.delete.mockRejectedValue(new Error('offline'));
    await expect(forgetThisDeviceForAccount('token-of-a')).resolves.toBe(false);
  });
});

describe('usePushNotifications per account', () => {
  const statusCalls = () => apiClient.get.mock.calls.filter(([u]) => u.startsWith('/push/status'));

  it('asks the backend only where asked (Settings), not on every page that mounts the hook', async () => {
    const { result } = renderHook(() => usePushNotifications('u1'));
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(statusCalls()).toHaveLength(0);
    expect(result.current.serverSubscribed).toBeNull();
  });

  it('Settings reads this account\'s status for this device', async () => {
    const { result } = renderHook(() => usePushNotifications('u1', { checkServer: true }));
    await waitFor(() => expect(result.current.serverSubscribed).toBe(true));
    expect(statusCalls()[0][0]).toBe(`/push/status?endpoint=${encodeURIComponent(ENDPOINT)}`);
  });

  it('a failed status check is reported, not shown as Off', async () => {
    apiClient.get.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => usePushNotifications('u1', { checkServer: true }));
    await waitFor(() => expect(result.current.serverStatusError).toBe(true));
    expect(result.current.serverSubscribed).toBeNull();
  });

  it('Off deletes only this account\'s row, keeps the shared browser subscription, clears the opt-in', async () => {
    recordPushOptIn('u1');
    recordPushOptIn('u2');
    const { result } = renderHook(() => usePushNotifications('u1', { checkServer: true }));
    await waitFor(() => expect(result.current.serverSubscribed).toBe(true));
    await act(async () => { await expect(result.current.unsubscribe()).resolves.toBe(true); });
    expect(apiClient.delete).toHaveBeenCalledWith(DELETE_URL);
    expect(browserSub.unsubscribe).not.toHaveBeenCalled();
    expect(result.current.serverSubscribed).toBe(false);
    expect(hasPushOptIn('u1')).toBe(false);
    expect(hasPushOptIn('u2')).toBe(true);
  });

  it('On (this account\'s click) posts the subscription and records its opt-in', async () => {
    apiClient.get.mockImplementation((url) => Promise.resolve({
      data: url.startsWith('/push/status') ? { subscribed: false } : { public_key: 'AQAB' },
    }));
    const { result } = renderHook(() => usePushNotifications('u1', { checkServer: true }));
    await waitFor(() => expect(result.current.serverSubscribed).toBe(false));
    await act(async () => { await expect(result.current.subscribe()).resolves.toBe(true); });
    expect(apiClient.post).toHaveBeenCalledWith('/push/subscribe?user_id=u1', expect.objectContaining({ endpoint: ENDPOINT }));
    expect(result.current.serverSubscribed).toBe(true);
    expect(hasPushOptIn('u1')).toBe(true);
  });
});
