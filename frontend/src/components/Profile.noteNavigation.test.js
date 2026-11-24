import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { Profile } from './Profile';
import apiClient from '../lib/apiClient';

jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });
jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../contexts/AuthContext', () => {
  const user = { id: 'reader', role: 'Surfer' };
  return { useAuth: () => ({ user }) };
});
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

test('the routed profile keeps its header and note together when both earlier responses arrive late', async () => {
  const delayed = new Map();
  apiClient.get.mockImplementation(url => {
    if (url.startsWith('/profiles/') || url.startsWith('/notes/user/')) {
      return new Promise(resolve => delayed.set(url, data => resolve({ data })));
    }
    return Promise.resolve({ data: {} });
  });

  render(<MemoryRouter initialEntries={['/profile/Kai']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Link to="/profile/Mara">Open Mara</Link>
    <Routes><Route path="/profile/:userId" element={<Profile />} /></Routes>
  </MemoryRouter>);
  fireEvent.click(screen.getByText('Open Mara'));

  async function deliver(profile) {
    await act(async () => {
      delayed.get('/profiles/' + profile)({ id: profile, full_name: profile, role: 'Surfer' });
      delayed.get('/notes/user/' + profile + '?viewer_id=reader')({
        note: { content: profile + ' note', time_remaining: '1h' }, is_mutual_follower: true,
      });
    });
  }
  await deliver('Mara');
  expect(screen.getByTestId('profile-name')).toHaveTextContent('Mara');
  await deliver('Kai');
  expect(screen.getByTestId('profile-name')).toHaveTextContent('Mara');
  expect(screen.getByTestId('profile-note-bubble')).toHaveTextContent('Mara note');
  fireEvent.click(screen.getByTestId('profile-note-bubble'));
  expect(screen.getByRole('dialog')).toHaveTextContent("Mara's Note");
  expect(screen.getByRole('dialog')).toHaveTextContent('Mara note');
});
