import { act, renderHook } from '@testing-library/react';
import apiClient from '../lib/apiClient';
import usePublicGalleryActions from './usePublicGalleryActions';
import useSurferGalleryActions from './useSurferGalleryActions';
import { toast } from 'sonner';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), debug: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
const buyer = { id: 'buyer-fixture', role: 'surfer' };
function publicGallery() {
  const props = { user: buyer, photographerId: 'pro-fixture', items: [], galleries: [],
    selectedItem: { id: 'asset-fixture', media_type: 'photo' }, selectedQuality: 'high',
    serviceFilter: 'all', searchQuery: '', sortBy: 'newest' };
  ['setPurchaseLoading', 'setPurchasedIds', 'setShowPurchaseModal', 'setSelectedItem',
    'setItems', 'setLoading'].forEach(name => { props[name] = jest.fn(); });
  return { props, ...renderHook(() => usePublicGalleryActions(props)) };
}
beforeEach(() => { jest.clearAllMocks(); apiClient.get.mockResolvedValue({ data: [] }); });

test('public purchase reaches the mounted credit endpoint with its query and quality body', async () => {
  // FastAPI declares buyer_id as a required query scalar, not a PurchaseRequest field.
  apiClient.post.mockImplementation(async (url, body) => {
    if (url !== '/gallery/item/asset-fixture/purchase?buyer_id=buyer-fixture' || body.quality_tier !== 'high') {
      throw { response: { data: { detail: 'Mounted route not reached' } } };
    }
    return { data: { message: 'Purchase successful', download_url: '/fixture-download' } };
  });
  const { props, result } = publicGallery();
  await act(async () => result.current.handlePurchase());
  expect(apiClient.post).toHaveBeenCalledWith('/gallery/item/asset-fixture/purchase?buyer_id=buyer-fixture', {
    payment_method: 'credits', quality_tier: 'high',
  });
  expect(props.setPurchasedIds.mock.calls[0][0](new Set())).toEqual(new Set(['asset-fixture']));
  expect(props.setShowPurchaseModal).toHaveBeenCalledWith(false);
  expect(apiClient.get).toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

test('a refused purchase keeps the modal and entitlement unchanged', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { detail: 'Not enough credits' } } });
  const { props, result } = publicGallery();
  await act(async () => result.current.handlePurchase());
  expect(toast.error).toHaveBeenCalledWith('Not enough credits');
  expect(props.setPurchasedIds).not.toHaveBeenCalled();
  expect(props.setShowPurchaseModal).not.toHaveBeenCalled();
  expect(props.setPurchaseLoading).toHaveBeenLastCalledWith(false);
});

test('repeated purchase clicks cannot launch concurrent credit requests', async () => {
  let resolve;
  apiClient.post.mockReturnValue(new Promise(r => { resolve = r; }));
  const { result } = publicGallery();
  let first;
  act(() => { first = result.current.handlePurchase(); result.current.handlePurchase(); });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ data: {} }); await first; });
});

test.each([{ sessions: [{ id: 'session-fixture', pending_count: 2 }] }, { sessions: [] }])('locker loads actual or empty sessions through the mounted route', async ({ sessions }) => {
  apiClient.get.mockImplementation(async url => {
    if (url !== '/surfer-gallery/ai-sessions?surfer_id=buyer-fixture') throw new Error('Wrong router prefix');
    return { data: { sessions } };
  });
  const props = { user: buyer, setAiSessions: jest.fn() };
  const { result } = renderHook(() => useSurferGalleryActions(props));
  await act(async () => result.current.fetchAiSessions());
  expect(props.setAiSessions).toHaveBeenCalledWith(sessions);
});

test.each([403, 503])('locker exposes HTTP %s failure instead of silently looking empty', async status => {
  apiClient.get.mockRejectedValue({ response: { status } });
  const props = { user: buyer, setAiSessions: jest.fn() };
  const { result } = renderHook(() => useSurferGalleryActions(props));
  await act(async () => result.current.fetchAiSessions());
  expect(toast.error).toHaveBeenCalledWith(status === 403 ? 'You do not have access to these sessions.' : 'Could not load session matches. Please try again.');
  expect(props.setAiSessions).not.toHaveBeenCalled();
});
