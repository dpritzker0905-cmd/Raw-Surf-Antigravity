import { act, renderHook } from '@testing-library/react';
import { useGalleryDistributionActions } from './useGalleryDistributionActions';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));

test('Gallery Hub AI Tag opens manual review without identity matching or automatic paid calls', async () => {
  apiClient.get.mockResolvedValue({ data: { participants: [] } });
  const open = jest.fn();
  const { result } = renderHook(() => useGalleryDistributionActions({
    user: { id: 'owner' }, selectedGallery: { id: 'gallery' }, setShowTagAssignModal: open,
    setManualSurferSearch: jest.fn(), setSearchResults: jest.fn(), setParticipantsLoading: jest.fn(),
    setParticipants: jest.fn(), setSessionInfo: jest.fn(),
  }));
  await act(async () => result.current.handleAiAutoTag());
  expect(open).toHaveBeenCalledWith(true);
  expect(apiClient.get).toHaveBeenCalledWith('/gallery/gallery/session-participants?photographer_id=owner');
  expect(apiClient.post).not.toHaveBeenCalled();
});
