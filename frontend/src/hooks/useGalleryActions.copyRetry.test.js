import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import useGalleryActions from './useGalleryActions';

jest.mock('../lib/apiClient', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

test('retrying a mixed copy creates one destination copy of each selected original', async () => {
  const copies = [];
  const setBulkSelectMode = jest.fn();
  let acknowledge;
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValueOnce(new Error('temporarily unavailable'))
    .mockImplementationOnce(() => new Promise(resolve => {
      acknowledge = () => { copies.push('b'); resolve({}); };
    }))
    .mockImplementation(async url => { copies.push(url.split('/')[3]); });
  const { result } = renderHook(() => {
    const [selectedItems, setSelectedItems] = useState(new Set(['a', 'b']));
    const [open, setShowCopyToFolderModal] = useState(true);
    const [busy, setFolderActionLoading] = useState(false);
    const actions = useGalleryActions({
      user: { id: 'owner' }, selectedGallery: { id: 'source' }, selectedItems, setSelectedItems,
      setShowCopyToFolderModal, setFolderActionLoading, setBulkSelectMode,
      setGalleries: jest.fn(), setGalleryItems: jest.fn(), setGalleryItemsLoading: jest.fn(),
    });
    return { copy: () => actions.handleCopyToFolder('destination'), selectedItems, open, busy };
  });
  let first;
  await act(async () => { first = result.current.copy(); });
  const busyBeforeAcknowledgment = result.current.busy;
  await act(async () => { acknowledge(); await first; });
  const retrySelection = [...result.current.selectedItems];
  expect(result.current.open).toBe(true);
  await act(async () => { await result.current.copy(); });
  expect(copies.sort()).toEqual(['a', 'b']);
  expect(busyBeforeAcknowledgment).toBe(true);
  expect(retrySelection).toEqual(['a']);
  expect(result.current.selectedItems.size).toBe(0);
  expect(result.current.open).toBe(false);
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(apiClient.post.mock.calls.map(([url]) => url.split('/')[3])).toEqual(['a', 'b', 'a']);
  expect(apiClient.post.mock.calls.every(([, body]) => body.target_gallery_id === 'destination')).toBe(true);
});

test('leaving during a copy clears the old retry selection and ignores late results', async () => {
  const setBulkSelectMode = jest.fn();
  let acknowledge;
  apiClient.post.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
  const { result, rerender } = renderHook(({ id }) => {
    const [selectedItems, setSelectedItems] = useState(new Set(['a']));
    const [open, setShowCopyToFolderModal] = useState(true);
    const [busy, setFolderActionLoading] = useState(false);
    const actions = useGalleryActions({
      user: { id: 'owner' }, selectedGallery: { id }, selectedItems, setSelectedItems,
      setShowCopyToFolderModal, setFolderActionLoading, setBulkSelectMode,
    });
    return { actions, selectedItems, setSelectedItems, open, busy };
  }, { initialProps: { id: 'source' } });
  let operation;
  await act(async () => { operation = result.current.actions.handleCopyToFolder('destination'); });
  rerender({ id: 'another-folder' });
  expect(result.current.selectedItems.size).toBe(0);
  expect(result.current.open).toBe(false);
  expect(result.current.busy).toBe(false);
  act(() => result.current.setSelectedItems(new Set(['c'])));
  await act(async () => { acknowledge({}); await operation; });
  expect([...result.current.selectedItems]).toEqual(['c']);
});

test.each([
  ['folder', 'owner', 'destination', true],
  ['account', 'another-owner', 'source', false],
])('leaving the %s after a settled copy clears its failed selection', async (_, nextUser, nextFolder, mixed) => {
  apiClient.post.mockRejectedValueOnce(new Error('copy failed'));
  if (mixed) {
    apiClient.post.mockResolvedValueOnce({});
  } else {
    apiClient.post.mockRejectedValueOnce(new Error('copy failed'));
  }
  apiClient.get.mockResolvedValue({ data: [] });
  const { result, rerender } = renderHook(({ userId, folderId }) => {
    const [selectedItems, setSelectedItems] = useState(new Set(['a', 'b']));
    const [bulk, setBulkSelectMode] = useState(true);
    const [open, setShowCopyToFolderModal] = useState(true);
    const [busy, setFolderActionLoading] = useState(false);
    const actions = useGalleryActions({
      user: { id: userId }, selectedGallery: { id: folderId }, selectedItems, setSelectedItems,
      setBulkSelectMode, setShowCopyToFolderModal, setFolderActionLoading, setGalleries: jest.fn(),
    });
    return { actions, selectedItems, bulk, open, busy, setShowCopyToFolderModal, setFolderActionLoading };
  }, { initialProps: { userId: 'owner', folderId: 'source' } });

  await act(async () => { await result.current.actions.handleCopyToFolder('target'); });
  expect([...result.current.selectedItems]).toEqual(mixed ? ['a'] : ['a', 'b']);
  expect(result.current.busy).toBe(false);
  act(() => result.current.setShowCopyToFolderModal(false));
  rerender({ userId: 'owner', folderId: 'source' });
  expect(result.current.bulk).toBe(true);
  expect(result.current.selectedItems.has('a')).toBe(true);

  // A different folder action may own the shared loading flag after copy settles.
  act(() => result.current.setFolderActionLoading(true));
  rerender({ userId: nextUser, folderId: nextFolder });
  expect(result.current.selectedItems.size).toBe(0);
  expect(result.current.bulk).toBe(false);
  expect(result.current.open).toBe(false);
  expect(result.current.busy).toBe(true);
});
