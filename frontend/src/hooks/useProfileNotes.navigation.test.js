import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import apiClient from '../lib/apiClient';
import { useProfileNotes } from './useProfileNotes';
import ProfileHeaderSection from '../components/profile/ProfileHeaderSection';
import { ProfileNoteModal } from '../components/ProfileNoteModal';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), delete: jest.fn() }));
jest.mock('../components/ui/TrustSignalBadges', () => () => null);
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Fixture({ profile, viewer = 'reader', refresh = 0 }) {
  const notes = useProfileNotes(profile, viewer);
  useEffect(() => {
    notes.fetchUserNote();
    // Match the profile page's fetch on navigation and its subsequent refresh.
  }, [profile, viewer, refresh]);
  return <>
    <ProfileHeaderSection profile={{ id: profile, full_name: profile }} profileUserId={profile}
      displayRole="Surfer" notesHook={notes} isOwnProfile={profile === viewer}
      contentStats={{}} socialStats={{}} gamificationStats={{ badges: [] }} streak={{}} />
    <ProfileNoteModal isOpen={notes.showNoteModal} isOwnProfile={profile === viewer}
      profileName={profile} userNote={notes.userNote} onClose={notes.setShowNoteModal}
      noteText={notes.noteText} setNoteText={notes.setNoteText} onCreateNote={notes.handleCreateNote}
      onDeleteNote={notes.handleDeleteNote} />
  </>;
}

function read() {
  const request = deferred();
  apiClient.get.mockReturnValueOnce(request.promise);
  return request;
}

const finish = (request, content) => act(async () => request.resolve({
  data: { note: content ? { content, time_remaining: '1h' } : null, is_mutual_follower: true },
}));
const bubble = () => screen.queryByTestId('profile-note-bubble');

beforeEach(() => jest.resetAllMocks());

test('a slow first profile cannot replace the note on the second profile', async () => {
  const first = read(), second = read();
  const ui = render(<Fixture profile="Kai" />);
  ui.rerender(<Fixture profile="Mara" />);
  await finish(second, 'Mara note');
  await finish(first, 'Kai note');
  expect(screen.getByTestId('profile-name')).toHaveTextContent('Mara');
  expect(bubble()).toHaveTextContent('Mara note');
});

test('an open note closes and clears immediately when the profile changes', async () => {
  const first = read();
  read();
  const ui = render(<Fixture profile="Kai" />);
  await finish(first, 'Kai note');
  fireEvent.click(bubble());
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  ui.rerender(<Fixture profile="Mara" />);
  expect(bubble()).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('an old failure cannot clear a newer read after returning to the same profile', async () => {
  const first = read();
  read();
  const last = read();
  const ui = render(<Fixture profile="Kai" />);
  ui.rerender(<Fixture profile="Mara" />);
  ui.rerender(<Fixture profile="Kai" />);
  await finish(last, 'Fresh note');
  await act(async () => first.reject(new Error('Old read failed')));
  expect(bubble()).toHaveTextContent('Fresh note');
});

test('only the latest refresh for the current viewer updates the header', async () => {
  const first = read(), second = read();
  const ui = render(<Fixture profile="Kai" />);
  ui.rerender(<Fixture profile="Kai" refresh={1} />);
  await finish(second, 'Latest note');
  await finish(first, 'Previous note');
  expect(bubble()).toHaveTextContent('Latest note');
});

test('a viewer change clears displayed information before a fresh response', async () => {
  const first = read();
  const ui = render(<Fixture profile="Kai" />);
  await finish(first, 'Kai note');
  ui.rerender(<Fixture profile="Kai" viewer={null} />);
  expect(bubble()).toBeNull();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a create finishing after navigation cannot refresh the old profile or close the current dialog', async () => {
  const own = read(), peer = read(), write = deferred();
  apiClient.post.mockReturnValueOnce(write.promise);
  const ui = render(<Fixture profile="reader" />);
  await finish(own, null);
  fireEvent.click(screen.getByTestId('add-note-btn'));
  fireEvent.change(screen.getByTestId('note-input'), { target: { value: 'My note' } });
  fireEvent.click(screen.getByTestId('submit-note-btn'));
  ui.rerender(<Fixture profile="Mara" />);
  await finish(peer, 'Mara note');
  fireEvent.click(bubble());
  await act(async () => write.resolve({}));
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('dialog')).toHaveTextContent('Mara note');
});

test('a read started before deletion cannot restore a deleted note', async () => {
  const own = read(), refresh = read();
  apiClient.delete.mockResolvedValueOnce({});
  const ui = render(<Fixture profile="reader" />);
  await finish(own, 'My note');
  ui.rerender(<Fixture profile="reader" refresh={1} />);
  fireEvent.click(bubble());
  await act(async () => fireEvent.click(screen.getByTestId('delete-note-btn')));
  await finish(refresh, 'My note');
  expect(apiClient.delete).toHaveBeenCalledTimes(1);
  expect(bubble()).toBeNull();
});
