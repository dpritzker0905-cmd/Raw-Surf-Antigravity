import React from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostMenu from './PostMenu';
import apiClient from '../lib/apiClient';

let mockTheme = 'dark';
let mockMobile = false;
const mockNavigate = jest.fn();
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }), { virtual: true });
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }), { virtual: true });
jest.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => mockMobile }), { virtual: true });
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../lib/apiClient', () => ({ post: jest.fn(), patch: jest.fn(), delete: jest.fn() }), { virtual: true });
jest.mock('../utils/logger', () => ({ debug: jest.fn(), error: jest.fn() }), { virtual: true });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('./post-menu/EditPostModal', () => () => null, { virtual: true });
jest.mock('./post-menu/DeleteConfirmModal', () => () => null, { virtual: true });
jest.mock('./post-menu/ReportPostModal', () => () => null, { virtual: true });
jest.mock('./post-menu/SharePostModal', () => () => null, { virtual: true });

const ownerActions = ['Delete', 'Edit', 'Pin to profile', 'Hide like count to others',
  'Turn off commenting', 'Go to post', 'Share to...', 'Copy link', 'About this account'];
const otherActions = ['Report', 'Add to favorites', 'I was there too', 'About this account',
  'Go to post', 'Share to...', 'Copy link'];
const post = { id: 'session', author_id: 'other' };

function mount(overrides = {}) {
  const callbacks = { onClose: jest.fn(), onIWasThere: jest.fn(), onUnfollow: jest.fn(), onPostUpdated: jest.fn() };
  return { ...render(<PostMenu post={post} open {...callbacks} {...overrides} />), ...callbacks };
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockTheme = 'dark';
  mockMobile = false;
});

describe.each(['light', 'dark', 'beach'])('%s theme', theme => {
  describe.each([false, true])('mobile=%s', mobile => {
    it.each([false, true])('names match every visible action, owner=%s', owner => {
      mockTheme = theme;
      mockMobile = mobile;
      mount({ post: { ...post, author_id: owner ? 'viewer' : 'other' } });
      const expected = [...(owner ? ownerActions : otherActions), 'Cancel'];
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(expected.length);
      for (const label of expected) {
        const button = screen.getByRole('button', { name: label, exact: true });
        expect(button).toHaveTextContent(label);
        expect(button).toHaveAccessibleName(label);
        for (const svg of button.querySelectorAll('svg')) {
          expect(svg).toHaveAttribute('aria-hidden', 'true');
          expect(svg).toHaveAttribute('focusable', 'false');
        }
      }
      expect(screen.queryByRole('button', { name: 'Loader2' })).toBeNull();
      const surface = screen.getByRole('dialog', { name: 'Post Options' });
      expect(surface).toHaveClass(theme === 'light' ? 'bg-white' : 'bg-zinc-900');
      expect(screen.getByRole('button', { name: 'Go to post' })).toHaveClass(theme === 'light' ? 'text-gray-700' : 'text-white');
      expect(screen.queryByRole('button', { name: owner ? 'Report' : 'Delete' })).toBeNull();
    });

    it('keeps native keyboard activation and Cancel behavior', async () => {
      mockTheme = theme;
      mockMobile = mobile;
      const user = userEvent.setup();
      const { onClose, onIWasThere } = mount();
      const go = screen.getByRole('button', { name: 'Go to post' });
      go.focus();
      await user.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith('/post/session');
      expect(onClose).toHaveBeenCalledTimes(1);
      screen.getByRole('button', { name: 'I was there too' }).focus();
      await user.keyboard(' ');
      expect(onIWasThere).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(2);
      screen.getByRole('button', { name: 'Cancel' }).focus();
      await user.keyboard('{Enter}');
      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });
});

it.each([
  ['Pin to profile', true, 'post', false],
  ['Hide like count to others', true, 'patch', false],
  ['Turn off commenting', true, 'patch', false],
  ['Add to favorites', false, 'post', false],
  ['Unfollow', false, 'unfollow', true],
])('preserves %s name and blocks activation while loading', async (label, owner, method, following) => {
  const user = userEvent.setup();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const action = jest.fn(() => pending);
  if (method !== 'unfollow') apiClient[method].mockImplementation(action);
  const { onClose } = mount({ post: { ...post, author_id: owner ? 'viewer' : 'other' },
    isFollowingAuthor: following, onUnfollow: action });
  await user.click(screen.getByRole('button', { name: label, exact: true }));
  const busy = screen.getByRole('button', { name: label, exact: true });
  expect(busy).toBeDisabled();
  expect(busy).toHaveTextContent(label);
  expect(busy.querySelector('svg')).toHaveClass('animate-spin');
  expect(busy.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  await user.click(busy);
  expect(action).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { finish({ data: { pinned: true } }); await pending; });
  expect(onClose).toHaveBeenCalledTimes(1);
  if (label === 'Pin to profile') expect(screen.getByRole('button', { name: 'Unpin from profile' })).toBeEnabled();
  else expect(screen.getByRole('button', { name: label, exact: true })).toBeEnabled();
});

it('uses current setting labels and exposes Unfollow only for followed authors', () => {
  mount({ post: { ...post, author_id: 'viewer', hide_like_count: true, comments_disabled: true } });
  expect(screen.getByRole('button', { name: 'Show like count' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Turn on commenting' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Unfollow' })).toBeNull();
  cleanup();
  mount({ isFollowingAuthor: true });
  expect(screen.getByRole('button', { name: 'Unfollow' })).toBeEnabled();
});
