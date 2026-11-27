import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import useGalleryActions from './useGalleryActions';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), delete: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

test.each(['folder', 'library'])('mixed %s deletion waits for every item and retries only the failed item', async view => {
  jest.clearAllMocks();
  const user = { id: 'owner' };
  const selectedGallery = view === 'folder' ? { id: 'folder' } : null;
  let finishDeletion;
  apiClient.delete.mockRejectedValueOnce(new Error('temporarily unavailable'))
    .mockImplementationOnce(() => new Promise(resolve => { finishDeletion = resolve; }))
    .mockResolvedValue({});
  apiClient.get.mockResolvedValue({ data: [{ id: 'untouched' }] });
  const { result } = renderHook(() => {
    const [selectedItems, setSelectedItems] = useState(new Set(['retry', 'removed']));
    const [galleryItems, setGalleryItems] = useState([{ id: 'retry' }, { id: 'removed' }, { id: 'untouched' }]);
    const [bulkSelectMode, setBulkSelectMode] = useState(true);
    const [loading, setFolderActionLoading] = useState(false);
    const actions = useGalleryActions({
      user, selectedGallery, selectedItems, setSelectedItems, bulkSelectMode, setBulkSelectMode,
      ...(selectedGallery ? { galleryItems, setGalleryItems } : { gallery: galleryItems, setGallery: setGalleryItems }),
      setFolderActionLoading, setGalleries: jest.fn(), setLoading: jest.fn(),
      setGalleryItemsLoading: jest.fn(), setDeleteConfirm: jest.fn(),
    });
    return { actions, selectedItems, galleryItems, loading, bulkSelectMode };
  });

  let operation;
  await act(async () => { operation = result.current.actions.executeBulkDelete(); });
  expect(result.current.loading).toBe(true);
  expect(toast.error).not.toHaveBeenCalled();
  await act(async () => { await result.current.actions.executeBulkDelete(); });
  expect(apiClient.delete).toHaveBeenCalledTimes(2);
  await act(async () => { finishDeletion(); await operation; });
  expect(result.current.loading).toBe(false);
  expect(result.current.galleryItems.map(item => item.id)).toEqual(['retry', 'untouched']);
  expect(result.current.selectedItems).toEqual(new Set(['retry']));
  expect(result.current.bulkSelectMode).toBe(true);
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/1.*2/));
  await act(async () => { await result.current.actions.executeBulkDelete(); });
  const endpoint = selectedGallery ? '/galleries/folder/items' : '/gallery/item';
  expect(apiClient.delete.mock.calls.map(([url]) => url.split('?')[0])).toEqual(
    ['retry', 'removed', 'retry'].map(id => `${endpoint}/${id}`)
  );
  expect(result.current.bulkSelectMode).toBe(false);
});
