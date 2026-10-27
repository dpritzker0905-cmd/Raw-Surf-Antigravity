import { act, renderHook } from '@testing-library/react';
import usePhotographerGalleryActions from './usePhotographerGalleryActions';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

jest.mock('../lib/apiClient', () => ({ post: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), debug: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const analysis = { people_count: 1, overall_description: 'A surfer with a blue board.', visual_tags: ['blue board'] };
const props = () => ({
  selectedItem: { id: 'first', preview_url: 'https://example.com/photo.jpg' },
  setAnalyzingPhoto: jest.fn(), setAiTagSuggestions: jest.fn(),
  filterType: 'all', searchQuery: '', sortBy: 'newest', gallery: { items: [] },
});
beforeEach(() => jest.clearAllMocks());

test('scan renders actual analysis and does not turn descriptions into profile suggestions', async () => {
  apiClient.post.mockResolvedValue({ data: { success: true, analysis, suggested_tags: [] } });
  const input = props();
  const { result } = renderHook(() => usePhotographerGalleryActions(input));
  await act(async () => result.current.handleAnalyzePhoto());
  expect(result.current.aiPhotoAnalysis).toEqual(analysis);
  expect(input.setAiTagSuggestions).toHaveBeenCalledWith([]);
  expect(apiClient.post).toHaveBeenCalledWith('/ai/suggest-tags', {
    image_url: input.selectedItem.preview_url, gallery_item_id: 'first',
  });
});

test('a response for an earlier photo cannot overwrite the newly selected photo', async () => {
  let finish;
  apiClient.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const input = props();
  const { result, rerender } = renderHook(p => usePhotographerGalleryActions(p), { initialProps: input });
  let pending;
  act(() => { pending = result.current.handleAnalyzePhoto(); });
  rerender({ ...input, selectedItem: { id: 'second', preview_url: 'https://example.com/second.jpg' } });
  await act(async () => { finish({ data: { success: true, analysis } }); await pending; });
  expect(result.current.aiPhotoAnalysis).toBeNull();
  expect(toast.success).not.toHaveBeenCalled();
});

test('provider unavailable response is explained and scan loading is cleared', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { detail: 'Image analysis is temporarily unavailable' } } });
  const input = props();
  const { result } = renderHook(() => usePhotographerGalleryActions(input));
  await act(async () => result.current.handleAnalyzePhoto());
  expect(result.current.aiPhotoAnalysis).toBeNull();
  expect(toast.error).toHaveBeenCalledWith('Image analysis is temporarily unavailable');
  expect(input.setAnalyzingPhoto).toHaveBeenLastCalledWith(false);
});
