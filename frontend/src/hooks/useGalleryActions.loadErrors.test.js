import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import useGalleryActions from './useGalleryActions';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const unavailable = () => Object.assign(new Error('Unavailable'), { response: { status: 503 } });
function useHost(user) {
  const [galleries, setGalleries] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [galleryItemsLoading, setGalleryItemsLoading] = useState(false);
  const actions = useGalleryActions({ user, selectedGallery, galleries, galleryItems,
    selectedItems: [], participants: [], setGalleries, setGalleryItems, setSelectedGallery,
    setGalleryItemsLoading, setConditionsStatus: () => {}, setGallery: () => {}, setLoading: () => {} });
  return { ...actions, galleries, galleryItems, selectedGallery, galleryItemsLoading };
}
const alice = { id: 'photographer-a', role: 'Photographer' };
const bob = { id: 'photographer-b', role: 'Photographer' };
beforeEach(() => { apiClient.get.mockReset(); });

test.each(['success', 'error'])('an older folder-list %s cannot overwrite a newer successful response', async outcome => {
  const old = pending(), fresh = pending();
  apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(() => useHost(alice));
  let oldCall, newCall;
  act(() => { oldCall = result.current.fetchGalleries(); });
  act(() => { newCall = result.current.fetchGalleries(); });
  await act(async () => { fresh.resolve({ data: [{ id: 'new-folder' }] }); await newCall; });
  await act(async () => { if (outcome === 'success') old.resolve({ data: [{ id: 'old-folder' }] }); else old.reject(unavailable()); await oldCall; });
  expect(result.current.galleries).toEqual([{ id: 'new-folder' }]);
  expect(result.current.galleriesError).toBeFalsy();
});

test.each(['success', 'error'])('an old user %s is ignored even before the next user starts a request', async outcome => {
  const old = pending();
  apiClient.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(({ user }) => useHost(user), { initialProps: { user: alice } });
  let oldCall;
  act(() => { oldCall = result.current.fetchGalleries(); });
  rerender({ user: bob });
  await act(async () => { if (outcome === 'success') old.resolve({ data: [{ id: 'alice-private-folder' }] }); else old.reject(unavailable()); await oldCall; });
  expect(result.current.galleries).toEqual([]);
  expect(result.current.galleriesError).toBeFalsy();
});

test.each(['success', 'error'])('an older selected-folder %s cannot overwrite the current folder', async outcome => {
  const old = pending(), fresh = pending();
  apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  act(() => { result.current.openGalleryDetail({ id: 'folder-b' }); });
  await act(async () => { fresh.resolve({ data: [{ id: 'bob-photo' }] }); });
  await act(async () => { if (outcome === 'success') old.resolve({ data: [{ id: 'alice-photo' }] }); else old.reject(unavailable()); });
  expect(result.current.selectedGallery.id).toBe('folder-b');
  expect(result.current.galleryItems).toEqual([{ id: 'bob-photo' }]);
  expect(result.current.galleryItemsLoading).toBe(false);
  expect(result.current.galleryItemsError).toBeFalsy();
});

test('closing a folder invalidates its outstanding item response', async () => {
  const request = pending();
  apiClient.get.mockReturnValueOnce(request.promise);
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  act(() => { result.current.closeGalleryDetail(); });
  await act(async () => { request.resolve({ data: [{ id: 'late-photo' }] }); });
  expect(result.current.selectedGallery).toBeNull();
  expect(result.current.galleryItems).toEqual([]);
  expect(result.current.galleryItemsLoading).toBe(false);
});


test('transient same-folder refresh keeps its previously loaded items with a recoverable error', async () => {
  apiClient.get.mockResolvedValueOnce({ data: [{ id: 'existing-photo' }] }).mockRejectedValueOnce(unavailable());
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  await act(async () => {});
  expect(result.current.galleryItems).toEqual([{ id: 'existing-photo' }]);
  await act(async () => { await result.current.fetchGalleryItems('folder-a'); });
  expect(result.current.galleryItems).toEqual([{ id: 'existing-photo' }]);
  expect(result.current.galleryItemsError).toMatch(/unable to load gallery items/i);
});

test.each([401, 403, 404])('refusal or missing-resource status %i does not retain previously loaded folders', async status => {
  apiClient.get.mockResolvedValueOnce({ data: [{ id: 'previous-folder' }] })
    .mockRejectedValueOnce(Object.assign(new Error('Refused'), { response: { status } }));
  const { result } = renderHook(() => useHost(alice));
  await act(async () => { await result.current.fetchGalleries(); });
  expect(result.current.galleries).toEqual([{ id: 'previous-folder' }]);
  await act(async () => { await result.current.fetchGalleries(); });
  expect(result.current.galleries).toEqual([]);
});


test.each(['success', 'error'])('an old item %s does not end the current folder loading state', async outcome => {
  const old = pending(), fresh = pending();
  apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  act(() => { result.current.openGalleryDetail({ id: 'folder-b' }); });
  await act(async () => { if (outcome === 'success') old.resolve({ data: [{ id: 'old-photo' }] }); else old.reject(unavailable()); });
  expect(result.current.galleryItemsLoading).toBe(true);
  expect(result.current.galleryItems).toEqual([]);
  expect(result.current.galleryItemsError).toBeFalsy();
  await act(async () => { fresh.resolve({ data: [{ id: 'current-photo' }] }); });
  expect(result.current.galleryItems).toEqual([{ id: 'current-photo' }]);
  expect(result.current.galleryItemsLoading).toBe(false);
});

test('a failed newly selected folder cannot retain the previous folder items', async () => {
  apiClient.get.mockResolvedValueOnce({ data: [{ id: 'folder-a-photo' }] }).mockRejectedValueOnce(unavailable());
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  await act(async () => {});
  expect(result.current.galleryItems).toEqual([{ id: 'folder-a-photo' }]);
  act(() => { result.current.openGalleryDetail({ id: 'folder-b' }); });
  expect(result.current.galleryItems).toEqual([]);
  await act(async () => {});
  expect(result.current.galleryItems).toEqual([]);
  expect(result.current.galleryItemsError).toMatch(/unable to load gallery items/i);
});

test('returning to the same user ID does not revive a request from its previous identity epoch', async () => {
  const old = pending();
  apiClient.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(({ user }) => useHost(user), { initialProps: { user: alice } });
  let oldCall;
  act(() => { oldCall = result.current.fetchGalleries(); });
  rerender({ user: bob });
  rerender({ user: alice });
  await act(async () => { old.resolve({ data: [{ id: 'previous-epoch-folder' }] }); await oldCall; });
  expect(result.current.galleries).toEqual([]);
});

test.each([401, 403])('item refusal status %i never retains cached items', async status => {
  apiClient.get.mockResolvedValueOnce({ data: [{ id: 'previous-photo' }] })
    .mockRejectedValueOnce(Object.assign(new Error('Refused'), { response: { status } }));
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  await act(async () => {});
  await act(async () => { await result.current.fetchGalleryItems('folder-a'); });
  expect(result.current.galleryItems).toEqual([]);
});


test.each([null, {}])('malformed successful folders refresh %p retains same-owner data until valid retry', async data => {
  apiClient.get.mockResolvedValueOnce({ status: 200, data: [{ id: 'known-folder' }] })
    .mockResolvedValueOnce({ status: 200, data }).mockResolvedValueOnce({ status: 200, data: [] });
  const { result } = renderHook(() => useHost(alice));
  await act(async () => { await result.current.fetchGalleries(); });
  await act(async () => { await result.current.fetchGalleries(); });
  expect(result.current.galleries).toEqual([{ id: 'known-folder' }]);
  expect(result.current.galleriesError).toMatch(/unable to load folders/i);
  expect(result.current.galleriesLoading).toBe(false);
  await act(async () => { await result.current.fetchGalleries(); });
  expect(result.current.galleries).toEqual([]);
  expect(result.current.galleriesError).toBeNull();
});

test.each([null, {}])('malformed successful items refresh %p retains only current-folder data until valid retry', async data => {
  apiClient.get.mockResolvedValueOnce({ status: 200, data: [{ id: 'known-photo' }] })
    .mockResolvedValueOnce({ status: 200, data }).mockResolvedValueOnce({ status: 200, data: [] });
  const { result } = renderHook(() => useHost(alice));
  act(() => { result.current.openGalleryDetail({ id: 'folder-a' }); });
  await act(async () => {});
  await act(async () => { await result.current.fetchGalleryItems('folder-a'); });
  expect(result.current.galleryItems).toEqual([{ id: 'known-photo' }]);
  expect(result.current.galleryItemsError).toMatch(/unable to load gallery items/i);
  expect(result.current.galleryItemsLoading).toBe(false);
  await act(async () => { await result.current.fetchGalleryItems('folder-a'); });
  expect(result.current.galleryItems).toEqual([]);
  expect(result.current.galleryItemsError).toBeNull();
});
