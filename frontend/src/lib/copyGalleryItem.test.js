import apiClient from './apiClient';
import { copyGalleryItem } from './copyGalleryItem';

jest.mock('./apiClient', () => ({ put: jest.fn() }));
const copy = () => copyGalleryItem('owner', 'photo', 'folder');
const success = { data: { gallery_id: 'folder', new_item_id: 'copy' } };

beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: jest.fn((_, options, callback) => callback({})),
  } });
  Object.defineProperty(window, 'crypto', { configurable: true, value: {
    randomUUID: jest.fn().mockReturnValueOnce('operation-one').mockReturnValueOnce('operation-two'),
  } });
});

test('lost acknowledgement reuses the operation; the next acknowledged selection has a new one', async () => {
  apiClient.put.mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(success);
  await expect(copy()).rejects.toThrow('response lost');
  await copy();
  await copy();
  expect(apiClient.put.mock.calls.map(([path]) => path)).toEqual([
    '/gallery/item/photo/copies/operation-one',
    '/gallery/item/photo/copies/operation-one',
    '/gallery/item/photo/copies/operation-two',
  ]);
});

test('a malformed success cannot acknowledge an operation', async () => {
  apiClient.put.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce(success);
  await expect(copy()).rejects.toThrow('confirmation');
  await copy();
  expect(apiClient.put.mock.calls[1]).toEqual(apiClient.put.mock.calls[0]);
});

test('a second tab holding the reservation prevents sending a competing request', async () => {
  navigator.locks.request.mockImplementation((_, options, callback) => callback(null));
  await expect(copy()).rejects.toThrow('already being copied');
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('failed durable storage prevents sending an untracked copy', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
  try {
    await expect(copy()).rejects.toThrow('storage full');
    expect(apiClient.put).not.toHaveBeenCalled();
  } finally {
    storage.mockRestore();
  }
});
