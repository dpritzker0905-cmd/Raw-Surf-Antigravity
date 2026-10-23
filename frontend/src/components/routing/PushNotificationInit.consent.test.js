/**
 * PUSH SUBSCRIPTIONS COME FROM AN ACCOUNT'S OWN OPT-IN, NEVER FROM SIGNING IN.
 *
 * The defect (live trace of dev, 2026-10-23: POST /api/push/subscribe on page load, no click): PushNotificationInit
 * subscribed whoever was signed in whenever `Notification.permission === 'granted'`. That permission belongs to the
 * BROWSER (per origin), not to an account, and the backend keys subscriptions by (user, endpoint): on a shared browser
 * where account A said yes, account B was subscribed the moment B signed in, with no click.
 *
 * The contract: the on-load re-sync runs only for an account that opted in on this browser (recorded by its own
 * Enable click), and an unsubscribe clears that record.
 */
import { render } from '@testing-library/react';

const mockSubscribe = jest.fn();
let mockUser = null;
// react-router-dom v7 resolves through package `exports`, which CRA's Jest cannot follow (house pattern: a virtual mock).
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(), useLocation: () => ({ pathname: '/feed' }), useParams: () => ({}),
  NavLink: () => null, Link: () => null, Navigate: () => null, Outlet: () => null,
}), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../hooks/usePushNotifications', () => {
  const actual = jest.requireActual('../../hooks/usePushNotifications');
  return {
    ...actual,
    usePushNotifications: () => ({ isSupported: true, subscribe: mockSubscribe }),
  };
});

import { PushNotificationInit } from './AppLayout';
import { hasPushOptIn, recordPushOptIn, clearPushOptIn } from '../../hooks/usePushNotifications';

beforeEach(() => {
  localStorage.clear();
  mockSubscribe.mockReset();
  global.Notification = { permission: 'granted' };
});

it('does not subscribe a signed-in account that never opted in, even with the browser permission granted', () => {
  mockUser = { id: 'account-b' };
  render(<PushNotificationInit />);
  expect(mockSubscribe).not.toHaveBeenCalled();
});

it('another account\'s opt-in on this browser does not subscribe the one signed in now', () => {
  recordPushOptIn('account-a');
  mockUser = { id: 'account-b' };
  render(<PushNotificationInit />);
  expect(mockSubscribe).not.toHaveBeenCalled();
});

it('re-syncs the subscription of an account that opted in on this browser', () => {
  recordPushOptIn('account-a');
  mockUser = { id: 'account-a' };
  render(<PushNotificationInit />);
  expect(mockSubscribe).toHaveBeenCalledTimes(1);
});

it('does nothing when the browser permission is not granted, opted in or not', () => {
  recordPushOptIn('account-a');
  global.Notification = { permission: 'default' };
  mockUser = { id: 'account-a' };
  render(<PushNotificationInit />);
  expect(mockSubscribe).not.toHaveBeenCalled();
});

it('the opt-in record is per account and can be cleared', () => {
  recordPushOptIn('account-a');
  expect(hasPushOptIn('account-a')).toBe(true);
  expect(hasPushOptIn('account-b')).toBe(false);
  expect(hasPushOptIn(undefined)).toBe(false);
  clearPushOptIn('account-a');
  expect(hasPushOptIn('account-a')).toBe(false);
});
