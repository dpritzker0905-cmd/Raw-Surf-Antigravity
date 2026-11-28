import { act, renderHook } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import usePostModal from '../usePostModal';
import useFeedDataActions from './useFeedDataActions';
import useFeedReactionActions from './useFeedReactionActions';

jest.mock('../../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));

function mountFeed(activeTab = 'for_you') {
  const options = {
    activeTab, latestPostIdRef: { current: null }, latestPostCreatedAtRef: { current: null },
    setPosts: jest.fn(), setNewPostsChip: jest.fn(), setFeedLastUpdated: jest.fn(),
    setLoading: jest.fn(), setIsRefreshing: jest.fn()
  };
  return { ...renderHook(() => useFeedDataActions(options)), options };
}

beforeEach(() => { jest.resetAllMocks(); localStorage.clear(); });

test('a background check preserves the Following cursor and leaves the For You cache alone', async () => {
  const { result, options } = mountFeed('following');
  const page = cursor => ({ data: { posts: [{ id: cursor }], next_cursor: cursor, has_more: true } });
  apiClient.get.mockResolvedValueOnce(page('first')).mockResolvedValueOnce(page('second'))
    .mockResolvedValueOnce(page('background')).mockResolvedValueOnce(page('third'));
  await act(async () => { await result.current.fetchPosts(); });
  await act(async () => { await result.current.loadMorePosts(); });
  await act(async () => { await result.current.handleFeedRefresh({ detail: { silent: true } }); });
  await act(async () => { await result.current.loadMorePosts(); });
  expect(apiClient.get.mock.calls.map(([, { params }]) => [params.following_only, params.cursor]))
    .toEqual([[true, undefined], [true, 'first'], [true, undefined], [true, 'second']]);
  expect(options.setPosts).toHaveBeenCalledTimes(3);
  expect(localStorage.getItem('rawsurf_cached_feed')).toBeNull();
});

test('an empty refresh clears cached posts and supersedes an older pagination response', async () => {
  const { result, options } = mountFeed();
  let resolveOlder;
  apiClient.get.mockResolvedValueOnce({ data: { posts: [{ id: 'real' }], next_cursor: 'first', has_more: true } })
    .mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }))
    .mockResolvedValueOnce({ data: { posts: [], next_cursor: null, has_more: false } });
  await act(async () => { await result.current.fetchPosts(); });
  const older = result.current.loadMorePosts();
  await act(async () => { await result.current.handleFeedRefresh(); });
  await act(async () => { resolveOlder({ data: { posts: [{ id: 'stale' }] } }); await older; });
  expect(options.setPosts).toHaveBeenLastCalledWith([]);
  expect(localStorage.getItem('rawsurf_cached_feed')).toBe('[]');
  expect(result.current.feedHasMoreRef.current).toBe(false);
});

test('a tap and a keyboard activation each issue one like and a long press only opens the picker', async () => {
  jest.useFakeTimers();
  try {
    const options = { user: { id: 'viewer' }, posts: [{ id: 'post' }], setPosts: jest.fn(),
      setPressingPostId: jest.fn(), setShowReactionPicker: jest.fn(), setPickerAnchor: jest.fn() };
    const { result } = renderHook(() => useFeedReactionActions(options));
    const actions = result.current;
    apiClient.post.mockResolvedValue({ data: {} });
    actions.handleShakaPointerDown('post', {});
    actions.handleShakaPointerUp('post');
    await actions.handleShakaClick('post', { detail: 1 });
    await actions.handleShakaClick('post', { detail: 0 });
    actions.handleShakaPointerDown('post', {});
    jest.advanceTimersByTime(501);
    actions.handleShakaPointerUp('post');
    actions.handleShakaClick('post', { detail: 1 });
    expect(apiClient.post.mock.calls).toEqual([['/posts/post/like?user_id=viewer'], ['/posts/post/like?user_id=viewer']]);
    expect(options.setShowReactionPicker).toHaveBeenCalledWith('post');
  } finally { jest.useRealTimers(); }
});

test('modal taps undo the saved emoji and failed comment writes preserve its count', async () => {
  const heart = '\u2764\uFE0F';
  const comment = { id: 'comment', viewer_reaction: heart, reaction_count: 3 };
  const options = {
    post: { id: 'post' }, user: { id: 'viewer' }, userReaction: { emoji: heart }, liked: true, likeCount: 3,
    setComments: jest.fn(), setUserReaction: jest.fn(), setLiked: jest.fn(), setLikeCount: jest.fn(),
    setIsPressing: jest.fn(), setShowReactionPicker: jest.fn(), onPostUpdated: jest.fn()
  };
  const { result } = renderHook(() => usePostModal(options));
  apiClient.post.mockResolvedValueOnce({ data: { action: 'removed', likes_count: 2 } });
  result.current.handleReactionStart();
  await result.current.handleReactionEnd();
  expect(apiClient.post).toHaveBeenCalledWith('/posts/post/reactions', { emoji: heart });
  expect(options.onPostUpdated).toHaveBeenCalledWith(expect.objectContaining({ user_reaction: null, likes_count: 2 }));
  apiClient.post.mockRejectedValueOnce(new Error('offline'));
  await result.current.handleLikeComment(comment);
  expect(options.setComments).not.toHaveBeenCalled();
  apiClient.post.mockResolvedValueOnce({ data: { action: 'removed' } });
  await result.current.handleLikeComment(comment);
  expect(apiClient.post).toHaveBeenLastCalledWith('/comments/comment/reactions', { emoji: heart });
  expect(options.setComments.mock.calls[0][0]([comment])).toEqual([{ ...comment, viewer_reaction: null, reaction_count: 2 }]);
});
test('feed reactions reconcile a different server outcome and recover during an outage', async () => {
  const heart = '\u2764\uFE0F';
  const reaction = { emoji: heart, user_id: 'viewer' };
  const post = { id: 'post', author_id: 'viewer', liked: true, is_liked_by_user: true,
    user_reaction: reaction, likes_count: 1, reactions: [reaction] };
  let state = [post];
  const options = { posts: state, user: { id: 'viewer' }, setShowReactionPicker: jest.fn(),
    setPosts: update => { state = update(state); } };
  const { result } = renderHook(() => useFeedReactionActions(options));
  apiClient.post.mockRejectedValueOnce(new Error('offline'));
  apiClient.get.mockRejectedValueOnce(new Error('offline'));
  await result.current.handleReaction('post', heart);
  expect(state).toEqual([post]);
  apiClient.post.mockResolvedValueOnce({ data: { action: 'added', likes_count: 4 } })
    .mockResolvedValueOnce({ data: {} });
  await result.current.handleReaction('post', heart);
  expect(state).toEqual([{ ...post, likes_count: 4 }]);
  expect(apiClient.post.mock.calls.at(-1)[1].payload).toMatchObject({ emoji: heart, action: 'added' });
});
test('a reaction completing after navigation updates only its original post', () => {
  const original = { id: 'first', likes_count: 1 };
  const next = { id: 'next', likes_count: 9 };
  const setPostModalOpen = jest.fn();
  const setPosts = jest.fn();
  const { result } = renderHook(() => useFeedDataActions({ postModalOpen: original, setPostModalOpen, setPosts }));
  result.current.handlePostUpdated({ id: 'first', likes_count: 2 });
  const updateModal = setPostModalOpen.mock.calls[0][0];
  expect(updateModal(next)).toBe(next);
  expect(updateModal(null)).toBeNull();
  expect(updateModal(original).likes_count).toBe(2);
  expect(setPosts.mock.calls[0][0]([original, next])).toEqual([{ ...original, likes_count: 2 }, next]);
});
