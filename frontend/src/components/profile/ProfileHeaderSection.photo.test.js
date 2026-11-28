import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfileHeaderSection from './ProfileHeaderSection';

jest.mock('../../contexts/PersonaContext', () => ({ getExpandedRoleInfo: () => ({ label: 'Surfer' }) }));
jest.mock('../GamificationUI', () => ({}));
jest.mock('../ui/TrustSignalBadges', () => () => null);
jest.mock('../../utils/media', () => ({ getFullUrl: url => url }));

const profile = { id: 'a', full_name: 'Kai', avatar_url: '/kai.jpg' };
const props = {
  profile, profileUserId: 'a', canPreviewPhoto: true, contentStats: {}, socialStats: {},
  streak: {}, gamificationStats: {}, notesHook: { userNote: { content: 'Dawn patrol' }, setShowNoteModal: jest.fn() },
};
const nativeImage = window.Image;
beforeEach(() => {
  window.Image = class extends EventTarget {
    set src(value) {
      Promise.resolve().then(() => this.dispatchEvent(new Event(value === '/broken.jpg' ? 'error' : 'load')));
    }
  };
});
afterEach(() => { window.Image = nativeImage; });

async function openPhoto() {
  const trigger = screen.getByRole('button', { name: 'View profile photo of Kai' });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  return trigger;
}

test('photo opens independently of the owner controls and note, and Escape restores focus', async () => {
  const fileInputRef = React.createRef();
  render(<ProfileHeaderSection {...props} isOwnProfile fileInputRef={fileInputRef} />);
  const picker = jest.spyOn(fileInputRef.current, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Change profile photo' }));
  expect(picker).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Dawn patrol' }));
  expect(props.notesHook.setShowNoteModal).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  const trigger = await openPhoto();
  expect(screen.getByRole('dialog', { name: 'Kai profile photo' })).toBeVisible();
  expect(screen.getByRole('img', { name: 'Profile photo of Kai' })).toHaveAttribute('src', '/kai.jpg');
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(picker).toHaveBeenCalledTimes(1);
  expect(props.notesHook.setShowNoteModal).toHaveBeenCalledTimes(1);
});

test('a new profile dismisses the old photo even when the URL is shared', async () => {
  const { rerender } = render(<ProfileHeaderSection {...props} />);
  await openPhoto();
  rerender(<ProfileHeaderSection {...props} profileUserId="b" profile={{ ...profile, id: 'b', full_name: 'Reef' }} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'View profile photo of Reef' })).toBeInTheDocument();
});

test('missing, blocked and failed thumbnails cannot open a preview', async () => {
  const { rerender } = render(<ProfileHeaderSection {...props} canPreviewPhoto={false} />);
  expect(screen.queryByRole('button', { name: /view profile photo/i })).toBeNull();
  rerender(<ProfileHeaderSection {...props} profile={{ ...profile, avatar_url: null }} />);
  expect(screen.queryByRole('button', { name: /view profile photo/i })).toBeNull();
  rerender(<ProfileHeaderSection {...props} profile={{ ...profile, avatar_url: '/broken.jpg' }} />);
  await screen.findByText('K');
  expect(screen.getByRole('button', { name: /view profile photo/i })).toBeDisabled();
});

test('a failed enlarged image announces the failure and can be reopened', async () => {
  render(<ProfileHeaderSection {...props} />);
  await openPhoto();
  fireEvent.error(screen.getByRole('img', { name: 'Profile photo of Kai' }));
  expect(screen.getByRole('status')).toHaveTextContent('couldn’t be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Close profile photo' }));
  await openPhoto();
  expect(screen.getByRole('img', { name: 'Profile photo of Kai' })).toBeVisible();
});
