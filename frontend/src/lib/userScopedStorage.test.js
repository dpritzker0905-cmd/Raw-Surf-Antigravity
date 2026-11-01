/**
 * SHARED DEVICE: ending a session must end the account's cached content (audit 2026-10-18, F-08).
 *
 * The defect: logout removed only `raw-surf-user` & co., so `rawsurf_cached_feed` survived and the next account
 * to sign in on that browser saw the previous account's posts whenever /api/posts was unreachable (and on first
 * paint of /feed); `rawsurf_offline_queue` survived too and would be replayed under the next account's token.
 */
import React from 'react';
import { render, act } from '@testing-library/react';

jest.mock('../hooks/usePushNotifications', () => ({
  forgetThisDeviceForAccount: jest.fn(),
  hasPushOptIn: () => false,
}));

import { USER_SCOPED_STORAGE_KEYS, purgeUserScopedStorage } from './userScopedStorage';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import apiClient from './apiClient';
import { clearSessionRejected } from './sessionRejection';

// What the storage writers actually use today; if one is renamed this list (not the purge) is what a reviewer sees.
const KEYS_THAT_HOLD_ACCOUNT_CONTENT = [
  'rawsurf_cached_feed', 'rawsurf_cached_feed_ts', 'rawsurf_offline_queue', 'rawsurf_favorite_spots',
  'rs-recent-searches', 'rawsurf_recent_searches', 'rawsurf_recent_spots',
  'rawsurf_last_known_city', 'rawsurf_last_known_coords', 'user_gps_location',
  'pending_session_join', 'credits_return_to', 'credits_return_reason', 'credits_open_crew_invite',
  'credits_dispatch_id',
];
// Device preferences that must outlive a logout.
const DEVICE_PREFERENCES = ['raw-surf-theme', 'raw-surf-cookie-consent', 'raw_surf_camera_authorized', 'rawsurf-active-model'];

const seed = () => {
  KEYS_THAT_HOLD_ACCOUNT_CONTENT.forEach((k) => localStorage.setItem(k, '"previous-account"'));
  DEVICE_PREFERENCES.forEach((k) => localStorage.setItem(k, 'keep'));
};

beforeEach(() => localStorage.clear());

it('lists every key that holds one account\'s content, and no device preference', () => {
  expect([...USER_SCOPED_STORAGE_KEYS].sort()).toEqual([...KEYS_THAT_HOLD_ACCOUNT_CONTENT].sort());
  DEVICE_PREFERENCES.forEach((k) => expect(USER_SCOPED_STORAGE_KEYS).not.toContain(k));
});

it('purgeUserScopedStorage removes the account keys, keeps the device preferences, reports what it removed', () => {
  seed();
  const removed = purgeUserScopedStorage();
  expect([...removed].sort()).toEqual([...KEYS_THAT_HOLD_ACCOUNT_CONTENT].sort());
  KEYS_THAT_HOLD_ACCOUNT_CONTENT.forEach((k) => expect(localStorage.getItem(k)).toBeNull());
  DEVICE_PREFERENCES.forEach((k) => expect(localStorage.getItem(k)).toBe('keep'));
});

it('never throws when storage is blocked (a failed purge must not stop a logout)', () => {
  const spy = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(() => purgeUserScopedStorage()).not.toThrow();
  spy.mockRestore();
});

it('AuthContext.logout purges the previous account\'s cached feed and offline queue', () => {
  let auth;
  const Probe = () => { auth = useAuth(); return null; };
  localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'a1', username: 'a', access_token: 't' }));
  seed();
  render(<AuthProvider><Probe /></AuthProvider>);

  act(() => { auth.logout(); });

  expect(localStorage.getItem('raw-surf-user')).toBeNull();
  KEYS_THAT_HOLD_ACCOUNT_CONTENT.forEach((k) => expect(localStorage.getItem(k)).toBeNull());
  DEVICE_PREFERENCES.forEach((k) => expect(localStorage.getItem(k)).toBe('keep'));
});

it('a refused session (401 -> sign-in form) ends the account on this device the same way', async () => {
  jest.useFakeTimers();
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // jsdom: "navigation not implemented"
  try {
    clearSessionRejected();
    localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'a1', access_token: 'expired' }));
    seed();
    apiClient.defaults.adapter = (config) => Promise.reject(Object.assign(new Error('401'), { config, response: { status: 401, data: {} } }));

    await expect(apiClient.get('/profiles/a1')).rejects.toBeTruthy();
    act(() => { jest.advanceTimersByTime(2500); });

    expect(localStorage.getItem('raw-surf-user')).toBeNull();
    KEYS_THAT_HOLD_ACCOUNT_CONTENT.forEach((k) => expect(localStorage.getItem(k)).toBeNull());
    DEVICE_PREFERENCES.forEach((k) => expect(localStorage.getItem(k)).toBe('keep'));
  } finally {
    errSpy.mockRestore();
    jest.useRealTimers();
    clearSessionRejected();
  }
});
