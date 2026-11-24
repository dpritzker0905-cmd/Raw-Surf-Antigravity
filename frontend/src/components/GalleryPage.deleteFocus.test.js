import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { GalleryPage } from './GalleryPage';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

const mockTheme = 'dark';
const mockUser = { id: 'photographer-a', role: 'Photographer' };
const mockPricing = { generalSettings: null, lastUpdated: 0 };
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }), useThemeName: () => mockTheme }));
jest.mock('../contexts/PricingContext', () => ({ usePricing: () => mockPricing }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../hooks/usePullToRefresh', () => ({ __esModule: true, default: () => ({ pullRef: { current: null } }) }));
jest.mock('./WatermarkSettings', () => () => null);
jest.mock('./gallery/UploadPhotoModal', () => ({ UploadPhotoModal: () => null }));
jest.mock('./gallery/GalleryItemModal', () => ({ GalleryItemModal: () => null }));
jest.mock('./gallery/SessionRosterCard', () => ({ SessionRosterCard: () => null }));
jest.mock('./gallery/GalleryFolderList', () => ({ GalleryFolderList: () => null }));
jest.mock('./gallery/GalleryFolderModals', () => ({ GalleryFolderModals: () => null }));
jest.mock('./gallery/GalleryPricingCard', () => ({ GalleryPricingCard: () => null }));
jest.mock('./gallery/GromHighlightsCard', () => () => null);
jest.mock('./gallery/ProStudioManager', () => ({ ProStudioManager: () => null }));
jest.mock('./ui/PullToRefreshIndicator', () => () => null);
jest.mock('./ui/SkeletonVariants', () => ({ GallerySkeleton: () => 'Loading gallery' }));

async function openDelete(ids, removed, user) {
  render(<GalleryPage initialRecapData={{ gallery: { id: 'gallery-a', title: 'Gallery' }, items: ids.map(id => ({ id, title: id })) }} />);
  const tile = await screen.findByTestId(`gallery-item-${removed}`);
  const trigger = within(tile).getByRole('button', { name: 'Item actions' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const remove = within(tile).getByRole('button', { name: 'Delete' });
  remove.focus();
  await user.keyboard('{Enter}');
  return { trigger, dialog: await screen.findByRole('dialog', { name: 'Confirm Delete' }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  apiClient.get.mockReset().mockResolvedValue({ data: [] });
  apiClient.delete.mockReset();
});

test.each([
  [['a', 'b', 'c'], 'b', 'c'],
  [['a', 'b'], 'b', 'a'],
  [['a'], 'a', null],
])('restores focus after deleting from %j', async (ids, removed, remainingTarget) => {
  const user = userEvent.setup();
  const items = ids.map(id => ({ id, title: id }));
  const remaining = items.filter(item => item.id !== removed);
  let finishRefresh;
  apiClient.get.mockImplementation(url => url.startsWith('/galleries/gallery-a/items?')
    ? new Promise(resolve => { finishRefresh = () => resolve({ data: remaining }); })
    : Promise.resolve({ data: [] }));
  apiClient.delete.mockResolvedValue({ data: {} });
  const { dialog } = await openDelete(ids, removed, user);
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(finishRefresh).toEqual(expect.any(Function)));
  await act(async () => finishRefresh());
  expect(screen.queryByTestId(`gallery-item-${removed}`)).not.toBeInTheDocument();
  const target = remainingTarget
    ? within(screen.getByTestId(`gallery-item-${remainingTarget}`)).getByRole('button', { name: 'Item actions' })
    : within(screen.getByText('No items in this gallery yet').parentElement).getByRole('button', { name: 'Add' });
  await waitFor(() => expect(target).toHaveFocus());
  expect(apiClient.delete).toHaveBeenCalledTimes(1);
});

test.each(['cancel', 'failure'])('%s returns focus to the original tile', async outcome => {
  const user = userEvent.setup();
  apiClient.delete.mockRejectedValue(new Error('synthetic failure'));
  const { dialog, trigger } = await openDelete(['a'], 'a', user);
  await user.click(within(dialog).getByRole('button', { name: outcome === 'cancel' ? 'Cancel' : 'Delete' }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(apiClient.delete).toHaveBeenCalledTimes(outcome === 'cancel' ? 0 : 1);
});

test('closing during deletion leaves focus on a control that survives the refresh', async () => {
  const user = userEvent.setup();
  let finish;
  apiClient.delete.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { dialog } = await openDelete(['a'], 'a', user);
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  const pending = within(dialog).getByRole('button', { name: 'Deleting…' });
  expect(pending).toHaveFocus();
  expect(pending).toHaveAttribute('aria-disabled', 'true');
  await user.keyboard('{Enter}');
  expect(apiClient.delete).toHaveBeenCalledTimes(1);
  await user.keyboard('{Escape}');
  const back = screen.getByRole('button', { name: 'Go back' });
  await waitFor(() => expect(back).toHaveFocus());
  await act(async () => finish({ data: {} }));
  await screen.findByText('No items in this gallery yet');
  expect(back).toHaveFocus();
});

test('a failed refresh preserves the known survivors of a successful deletion', async () => {
  const user = userEvent.setup();
  apiClient.delete.mockResolvedValue({ data: {} });
  apiClient.get.mockImplementation(url => url.startsWith('/galleries/gallery-a/items?')
    ? Promise.reject(new Error('synthetic readback failure')) : Promise.resolve({ data: [] }));
  const { dialog } = await openDelete(['a', 'b', 'c'], 'b', user);
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(within(screen.getByTestId('gallery-item-c')).getByRole('button', { name: 'Item actions' })).toHaveFocus());
  expect(screen.queryByTestId('gallery-item-b')).not.toBeInTheDocument();
  expect(screen.getByTestId('gallery-item-a')).toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledWith('Item deleted');
  expect(toast.error).toHaveBeenCalledWith('Could not refresh the remaining gallery items');
});
