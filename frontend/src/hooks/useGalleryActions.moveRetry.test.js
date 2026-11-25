import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import apiClient from '../lib/apiClient';
import useGalleryActions from './useGalleryActions';

jest.mock('../lib/apiClient', () => ({ patch: jest.fn(), get: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

test.each(['first-folder', 'source'])('retry affects only failed moves after targeting %s', async firstTarget => {
  const locations = { a: 'source', b: 'source', c: 'source' };
  let finish;
  apiClient.patch.mockReset().mockRejectedValueOnce(new Error('temporary failure'))
    .mockImplementationOnce(() => new Promise(resolve => {
      finish = () => { locations.b = firstTarget; resolve({}); };
    }))
    .mockImplementation(async (url, { target_gallery_id }) => { locations[url.split('/')[3]] = target_gallery_id; });
  apiClient.get.mockImplementation(async url => ({
    data: url.includes('/source/items?')
      ? Object.keys(locations).filter(id => locations[id] === 'source').map(id => ({ id })) : [],
  }));
  const { result } = renderHook(() => {
    const [selectedItems, setSelectedItems] = useState(new Set(['a', 'b']));
    const [galleryItems, setGalleryItems] = useState(Object.keys(locations).map(id => ({ id })));
    const [busy, setFolderActionLoading] = useState(false);
    const [open, setShowMoveToFolderModal] = useState(true);
    const [, setBulkSelectMode] = useState(true);
    const { handleMoveToFolder } = useGalleryActions({
      user: { id: 'owner' }, selectedGallery: { id: 'source' }, selectedItems, setSelectedItems,
      setFolderActionLoading, setShowMoveToFolderModal, setBulkSelectMode, setGalleryItems,
      setGalleries: jest.fn(), setGallery: jest.fn(), setGalleryItemsLoading: jest.fn(), setLoading: jest.fn(),
    });
    return { move: handleMoveToFolder, selectedItems, galleryItems, busy, open };
  });
  let first;
  await act(async () => { first = result.current.move(firstTarget); });
  const busyWhilePending = result.current.busy;
  await act(async () => { finish(); await first; });
  const partial = result.current;
  await act(async () => { await result.current.move('retry-folder'); });
  expect(locations).toEqual({ a: 'retry-folder', b: firstTarget, c: 'source' });
  expect(busyWhilePending).toBe(true);
  expect(partial.open).toBe(true);
  expect([...partial.selectedItems]).toEqual(['a']);
  expect(partial.galleryItems.map(item => item.id)).toEqual(firstTarget === 'source' ? ['a', 'b', 'c'] : ['a', 'c']);
  expect(result.current.open).toBe(false);
  expect(apiClient.patch).toHaveBeenCalledTimes(3);
});

test.each(['pending', 'settled'])('changing folders abandons a %s move selection', async phase => {
  let finish;
  apiClient.patch.mockReset().mockRejectedValueOnce(new Error('temporary failure'))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  apiClient.get.mockResolvedValue({ data: [] });
  const { result, rerender } = renderHook(({ id }) => {
    const [selectedItems, setSelectedItems] = useState(new Set(['a', 'b']));
    const [busy, setFolderActionLoading] = useState(false);
    const [open, setShowMoveToFolderModal] = useState(true);
    const [bulk, setBulkSelectMode] = useState(true);
    const { handleMoveToFolder } = useGalleryActions({
      user: { id: 'owner' }, selectedGallery: { id }, selectedItems, setSelectedItems,
      setFolderActionLoading, setShowMoveToFolderModal, setBulkSelectMode,
      setGalleryItems: jest.fn(), setGalleries: jest.fn(), setGallery: jest.fn(), setLoading: jest.fn(),
    });
    return { handleMoveToFolder, selectedItems, setSelectedItems, setShowMoveToFolderModal, busy, open, bulk };
  }, { initialProps: { id: 'source' } });
  let batch;
  await act(async () => { batch = result.current.handleMoveToFolder('target'); });
  if (phase === 'settled') {
    await act(async () => { finish(); await batch; });
    expect([...result.current.selectedItems]).toEqual(['a']);
    act(() => result.current.setShowMoveToFolderModal(false));
  }
  rerender({ id: 'new-folder' });
  expect(result.current.selectedItems.size).toBe(0);
  expect(result.current.open || result.current.bulk || result.current.busy).toBe(false);
  act(() => result.current.setSelectedItems(new Set(['c'])));
  if (phase === 'pending') await act(async () => { finish(); await batch; });
  expect([...result.current.selectedItems]).toEqual(['c']);
});
