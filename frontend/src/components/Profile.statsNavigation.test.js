import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { Profile } from './Profile';
import apiClient from '../lib/apiClient';
import useProfileStats from '../hooks/useProfileStats';

jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });
jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: {} }) }));
jest.mock('../contexts/PersonaContext', () => ({
  usePersona: () => ({ getEffectiveRole: () => 'Surfer' }), getExpandedRoleInfo: () => ({}),
}));
jest.mock('./GoLiveModal', () => () => null);
jest.mock('./ScheduledBookingDrawer', () => ({ ScheduledBookingDrawer: () => null }));
jest.mock('./ProfileTabContent', () => () => null);
jest.mock('./profile/ProfileActionButtons', () => () => null);
jest.mock('./ui/TrustSignalBadges', () => () => null);
jest.mock('./FollowersModal', () => ({ FollowersModal: () => null }));
jest.mock('./ProfileEditModal', () => ({ ProfileEditModal: () => null }));
jest.mock('./AvatarCropModal', () => () => null);
jest.mock('./profile/ProfileHeaderSection', () => ({ profile, streak, socialStats, contentStats, impactScore, gamificationStats }) => (
  <output data-testid="stats">{JSON.stringify([profile.id, streak.current_streak, socialStats.followers,
    socialStats.following, contentStats.posts, impactScore?.score ?? null, gamificationStats.total_xp])}</output>
));

const { useAuth } = require('../contexts/AuthContext');

function setup({ deferProfiles = false } = {}) {
  let viewer = { id: 'reader', role: 'Surfer' };
  useAuth.mockImplementation(() => ({ user: viewer }));
  const requests = new Map();
  apiClient.get.mockImplementation(url => {
    const isProfile = url.startsWith('/profiles/');
    if (isProfile && !deferProfiles) {
      return Promise.resolve({ data: { id: url.split('/')[2], role: 'Surfer' } });
    }
    if (isProfile || /^\/(streak|followers|following|impact\/public|gamification\/user)\/|^\/profile\/[^/]+\/stats$/.test(url)) {
      return new Promise(resolve => {
        requests.set(url, [...(requests.get(url) || []), data => resolve({ data })]);
      });
    }
    return Promise.resolve({ data: {} });
  });
  const app = () => <MemoryRouter initialEntries={['/profile/A']}><Link to="/profile/A">A</Link>
    <Link to="/profile/B">B</Link><Routes><Route path="/profile/:userId" element={<Profile />} /></Routes></MemoryRouter>;
  const view = render(app());
  return {
    visit: id => act(async () => { fireEvent.click(screen.getByText(id)); }),
    changeViewer: () => act(async () => { viewer = { ...viewer, id: 'second-reader' }; view.rerender(app()); }),
    refreshViewer: () => act(async () => { viewer = { ...viewer }; view.rerender(app()); }),
    deliver: (id, index, n) => act(async () => {
      if (deferProfiles) requests.get(`/profiles/${id}`)[index]({ id, role: 'Surfer' });
      const data = {
        [`/streak/${id}`]: { current_streak: n },
        [`/followers/${id}`]: Array(n).fill({}),
        [`/following/${id}`]: Array(n + 1).fill({}),
        [`/profile/${id}/stats`]: { posts: n + 2 },
        [`/impact/public/${id}`]: { score: n + 3 },
        [`/gamification/user/${id}`]: { total_xp: n + 4 },
      };
      for (const [url, body] of Object.entries(data)) requests.get(url)[index](body);
    }),
  };
}

const stats = () => JSON.parse(screen.getByTestId('stats').textContent);

test('a slower refresh cannot overwrite newer stats during the same visit', async () => {
  const { refreshViewer, deliver } = setup();
  await refreshViewer();
  await deliver('A', 1, 10);
  expect(stats()).toEqual(['A', 10, 10, 11, 12, 13, 14]);
  await deliver('A', 0, 2);
  expect(stats()).toEqual(['A', 10, 10, 11, 12, 13, 14]);
});

test('stat setters stay stable within a visit and expire when the visit changes', () => {
  const { result, rerender } = renderHook(id => useProfileStats(id, 'reader'), { initialProps: 'A' });
  const first = result.current;
  act(() => first.setSocialStats(prev => ({ ...prev, following: 1 })));
  expect(result.current.socialStats.following).toBe(1);
  const setters = ['setStreak', 'setSocialStats', 'setContentStats', 'setImpactScore', 'setGamificationStats'];
  for (const name of setters) expect(result.current[name]).toBe(first[name]);
  rerender('B');
  for (const name of setters) expect(result.current[name]).not.toBe(first[name]);
  act(() => first.setSocialStats({ followers: 8, following: 9 }));
  expect(result.current.socialStats).toEqual({ followers: 0, following: 0 });
});

test('late profile and stat replies for A cannot replace B after navigation', async () => {
  const { visit, deliver } = setup({ deferProfiles: true });
  await visit('B');
  await deliver('B', 0, 10);
  expect(stats()).toEqual(['B', 10, 10, 11, 12, 13, 14]);
  await deliver('A', 0, 2);
  expect(stats()).toEqual(['B', 10, 10, 11, 12, 13, 14]);
});

test('navigation clears earlier values and a return visit rejects earlier viewer and visit responses', async () => {
  const { visit, deliver, changeViewer } = setup();
  await visit('B');
  await deliver('B', 0, 10);
  await visit('A');
  expect(stats()).toEqual(['A', 0, 0, 0, 0, null, 0]);
  await changeViewer();
  await deliver('A', 2, 7);
  await deliver('A', 1, 4);
  await deliver('A', 0, 2);
  expect(stats()).toEqual(['A', 7, 7, 8, 9, 10, 11]);
});
