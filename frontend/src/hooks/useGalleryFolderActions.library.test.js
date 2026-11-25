import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import useGalleryFolderActions from './useGalleryFolderActions';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function picker() {
  const props = {
    user: { id: 'owner' }, selectedGallery: { id: 'destination' }, showAddToGalleryModal: true,
    setShowAddToGalleryModal: jest.fn(), setGalleryItems: jest.fn(),
    setGalleryItemsLoading: jest.fn(), setGalleries: jest.fn(),
  };
  return { props, ...renderHook(useGalleryFolderActions, { initialProps: props }) };
}

beforeEach(() => {
  jest.resetAllMocks();
  apiClient.get.mockResolvedValue({ data: [] });
});

test('two activations send one copy and refresh the destination', async () => {
  const pending = deferred();
  apiClient.post.mockReturnValue(pending.promise);
  const { result, props } = picker();
  let copy;
  act(() => {
    copy = result.current.handleAddToGallery('photo');
    result.current.handleAddToGallery('photo');
  });
  expect(result.current.addingLibraryPhoto).toBe(true);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/gallery/item/photo/copy?photographer_id=owner', {
    target_gallery_id: 'destination',
  });
  await act(async () => { pending.resolve({ data: { new_item_id: 'new-id' } }); await copy; });
  expect(result.current.addingLibraryPhoto).toBe(false);
  expect(apiClient.get).toHaveBeenCalledWith('/galleries/destination/items?viewer_id=owner');
  expect(apiClient.get).toHaveBeenCalledWith('/galleries/photographer/owner');
  expect(props.setShowAddToGalleryModal).toHaveBeenCalledWith(false);
});

test('a refused copy keeps the picker open and permits retry', async () => {
  apiClient.post.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ data: {} });
  const { result, props } = picker();
  await act(async () => { await result.current.handleAddToGallery('photo'); });
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(props.setShowAddToGalleryModal).not.toHaveBeenCalled();
  expect(apiClient.get).not.toHaveBeenCalled();
  await act(async () => { await result.current.handleAddToGallery('photo'); });
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  expect(props.setShowAddToGalleryModal).toHaveBeenCalledWith(false);
});

test('a late success cannot dismiss a reopened picker', async () => {
  const pending = deferred();
  apiClient.post.mockReturnValue(pending.promise);
  const { result, props, rerender } = picker();
  let copy;
  act(() => { copy = result.current.handleAddToGallery('photo'); });
  rerender({ ...props, showAddToGalleryModal: false });
  rerender(props);
  await act(async () => { pending.resolve({ data: {} }); await copy; });
  expect(props.setShowAddToGalleryModal).not.toHaveBeenCalled();
  expect(props.setGalleryItems).toHaveBeenCalledWith([]);
});

test('a previous folder refresh cannot replace the new folder contents', async () => {
  const pending = deferred();
  apiClient.post.mockResolvedValue({ data: {} });
  apiClient.get.mockReturnValue(pending.promise);
  const { result, props, rerender } = picker();
  let copy;
  await act(async () => { copy = result.current.handleAddToGallery('photo'); });
  rerender({ ...props, selectedGallery: { id: 'next-folder' } });
  await act(async () => { pending.resolve({ data: ['old-folder'] }); await copy; });
  expect(props.setGalleryItems).not.toHaveBeenCalled();
  expect(props.setGalleryItemsLoading).not.toHaveBeenCalledWith(false);
});

test('an older folder read cannot erase the copy when it finishes last', async () => {
  const first = deferred();
  apiClient.get.mockReturnValueOnce(first.promise).mockResolvedValue({ data: ['new-copy'] });
  apiClient.post.mockResolvedValue({ data: {} });
  const { result, props } = picker();
  let initialRead;
  act(() => { initialRead = result.current.fetchGalleryItems('destination'); });
  await act(async () => { await result.current.handleAddToGallery('photo'); });
  await act(async () => { first.resolve({ data: [] }); await initialRead; });
  expect(props.setGalleryItems.mock.calls).toEqual([[['new-copy']]]);
});

test('returning to the destination while its copy is pending cannot create a second copy', async () => {
  const pending = deferred();
  apiClient.post.mockReturnValue(pending.promise);
  const { result, props, rerender } = picker();
  let copy;
  act(() => { copy = result.current.handleAddToGallery('photo'); });
  rerender({ ...props, selectedGallery: { id: 'next-folder' } });
  expect(result.current.addingLibraryPhoto).toBe(false);
  rerender(props);
  act(() => { result.current.handleAddToGallery('photo'); });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ data: {} }); await copy; });
  expect(result.current.addingLibraryPhoto).toBe(false);
  expect(props.setShowAddToGalleryModal).not.toHaveBeenCalled();
});

test.each([
  ['same owner', 'owner', 1],
  ['different owner', 'other', 0],
])('copy completion after navigation refreshes only the applicable folder list (%s)', async (_, owner, reads) => {
  const pending = deferred();
  apiClient.post.mockReturnValue(pending.promise);
  const { result, props, rerender } = picker();
  let copy;
  act(() => { copy = result.current.handleAddToGallery('photo'); });
  rerender({ ...props, user: { id: owner }, selectedGallery: null });
  await act(async () => { pending.resolve({ data: {} }); await copy; });
  expect(apiClient.get).toHaveBeenCalledTimes(reads);
  expect(props.setGalleries).toHaveBeenCalledTimes(reads);
  expect(props.setGalleryItems).not.toHaveBeenCalled();
  expect(props.setShowAddToGalleryModal).not.toHaveBeenCalled();
});
