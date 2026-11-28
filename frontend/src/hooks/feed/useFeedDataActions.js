/**
 * useFeedDataActions -- Extracted from useFeedActions.js (v77)
 * Handles: post fetching, pagination, refresh, feed lineups,
 * upcoming sessions, live users, following, post CRUD
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const useFeedDataActions = ({
  user, activeTab, posts, latestPostIdRef, latestPostCreatedAtRef, isPhotographer,
  postModalOpen, postMenuOpen,
  // State setters
  setConnectingToStream, setFeedLastUpdated, setFeedLineups,
  setFeedLineupsLoading, setFollowLoading, setFollowingUsers,
  setIsRefreshing, setLiveStreamInfo, setLiveUsers,
  setLoading, setNewPostsChip, setPostMenuOpen, setPostModalOpen,
  setPosts, setShowLiveViewer, setUpcomingSessions,
  setUpcomingSessionsLoading,
}) => {
  // Infinite scroll pagination state (refs to avoid re-render on every update)
  const feedCursorRef = useRef(null);
  const feedHasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);

  const followingOnly = activeTab === 'following';
  const [feedLoadFailed, setFeedLoadFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const pageGeneration = useRef(0);

  const replaceFeed = useCallback(data => {
    if (!mounted.current) return;
    setFeedLoadFailed(false);
    const incoming = Array.isArray(data) ? data : data.posts;
    const mapped = incoming.map(post => ({
      ...post, liked: post.is_liked_by_user || !!post.user_reaction
    }));
    pageGeneration.current += 1;
    feedCursorRef.current = data.next_cursor ?? null;
    feedHasMoreRef.current = !!data.has_more;
    latestPostIdRef.current = mapped[0]?.id ?? null;
    latestPostCreatedAtRef.current = mapped[0]?.created_at ?? null;
    setPosts(mapped);
    setNewPostsChip(0);
    const updated = new Date().toISOString();
    setFeedLastUpdated(updated);
    if (followingOnly) return;
    try {
      localStorage.setItem('rawsurf_cached_feed', JSON.stringify(mapped.slice(0, 20)));
      localStorage.setItem('rawsurf_cached_feed_ts', updated);
    } catch { /* Storage can be unavailable. */ }
  }, [followingOnly, latestPostIdRef, latestPostCreatedAtRef, setPosts, setNewPostsChip, setFeedLastUpdated]);

  const handleFeedRefresh = useCallback(async (e) => {
    const silent = e?.detail?.silent === true;
    setIsRefreshing(true);
    try {
      const response = await apiClient.get('/posts', {
        params: { limit: 10, following_only: followingOnly }
      });
      // New paginated response format: { posts, next_cursor, has_more }
      const data = response.data;
      if (!silent) {
        replaceFeed(data);
      } else {
        // Silent auto-refresh: show chip only if there are genuinely new posts
        const incoming = Array.isArray(data) ? data : data.posts;
        const currentLatestTime = latestPostCreatedAtRef.current 
          ? new Date(latestPostCreatedAtRef.current).getTime() 
          : 0;
        const newCount = currentLatestTime
          ? incoming.filter(p => new Date(p.created_at).getTime() > currentLatestTime).length
          : 0;
        setNewPostsChip(currentLatestTime ? newCount : incoming.length);
      }
    } catch (err) {
      logger.error('feed:refresh failed', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [followingOnly, replaceFeed, latestPostCreatedAtRef, setIsRefreshing, setNewPostsChip]);

  const handleLoadNewPosts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await apiClient.get('/posts', {
        params: { limit: 10, following_only: followingOnly }
      });
      replaceFeed(response.data);
      if (response.data?.posts?.length || response.data?.length) {
        // Scroll the main content container to the top (works on both desktop and mobile)
        const scrollContainer = document.getElementById('main-content') || window;
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      logger.error('handleLoadNewPosts failed:', err);
    }
    setNewPostsChip(0);
    setIsRefreshing(false);
  }, [followingOnly, replaceFeed, setIsRefreshing, setNewPostsChip]);

  const fetchFeedLineups = async () => {
    if (!user?.id) return;
    
    try {
      setFeedLineupsLoading(true);
      const response = await apiClient.get(`/feed/lineups`, {
        params: { limit: 3 }
      });
      setFeedLineups(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch feed lineups:', error);
    } finally {
      setFeedLineupsLoading(false);
    }
  };

  const fetchUpcomingSessions = async () => {
    if (!user?.id) return;
    
    try {
      setUpcomingSessionsLoading(true);
      
      let upcoming = [];
      const now = new Date();
      
      // For photographers, get bookings where they are the photographer (client bookings)
      if (isPhotographer) {
        const response = await apiClient.get(`/photographer/${user.id}/bookings`);
        upcoming = (response.data || []).filter(b => {
          const sessionDate = new Date(b.session_date);
          const isActive = ['Confirmed', 'Pending', 'PendingPayment'].includes(b.status);
          const isFuture = sessionDate > now;
          return isActive && isFuture;
        }).slice(0, 2);
      } else {
        // For surfers, get bookings where they are a participant
        const response = await apiClient.get(`/bookings/user/${user.id}`, {
          params: { status: 'upcoming', limit: 5 }
        });
        upcoming = (response.data || []).filter(b => {
          const sessionDate = new Date(b.session_date);
          const isActive = ['Confirmed', 'Pending', 'PendingPayment'].includes(b.status);
          const isFuture = sessionDate > now;
          // Also check participant status isn't cancelled/refunded
          const participantActive = !['cancelled', 'refunded'].includes(b.participant_status?.toLowerCase());
          return isActive && isFuture && participantActive;
        }).slice(0, 2);
      }
      
      setUpcomingSessions(upcoming);
    } catch (error) {
      logger.error('Failed to fetch upcoming sessions:', error);
    } finally {
      setUpcomingSessionsLoading(false);
    }
  };

  const fetchLiveUsers = async () => {
    try {
      const response = await apiClient.get(`/livekit/active-streams`);
      const liveUserIds = response.data.streams?.map(s => s.broadcaster_id) || [];
      setLiveUsers(liveUserIds);
    } catch (e) {
      // Ignore errors
    }
  };

  const fetchFollowing = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/following/${user.id}`);
      const followingIds = new Set(response.data.map(f => f.id));
      setFollowingUsers(followingIds);
    } catch (e) {
      // Ignore errors
    }
  };

  const handleFollowFromFeed = async (photographerId) => {
    if (!user?.id) {
      toast.error('Please log in to follow');
      return;
    }
    
    // Optimistic update - instant UI
    setFollowingUsers(prev => new Set([...prev, photographerId]));
    setFollowLoading(photographerId);
    
    try {
      await apiClient.post(`/follow/${photographerId}?follower_id=${user.id}`);
      toast.success('Following! Check their profile for availability');
    } catch (error) {
      // Rollback on failure
      setFollowingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(photographerId);
        return newSet;
      });
      toast.error(error.response?.data?.detail || 'Failed to follow');
    } finally {
      setFollowLoading(null);
    }
  };

  const handleUnfollowFromMenu = async (userId) => {
    if (!user?.id) return;
    
    // Optimistic update - instant UI
    setFollowingUsers(prev => {
      const newSet = new Set(prev);
      newSet.delete(userId);
      return newSet;
    });
    
    try {
      await apiClient.delete(`/follow/${userId}?follower_id=${user.id}`);
      if (followingOnly) setPosts(previous => previous.filter(post => post.author_id !== userId));
      toast.success('Unfollowed');
    } catch (error) {
      // Rollback on failure
      setFollowingUsers(prev => new Set([...prev, userId]));
      toast.error('Failed to unfollow');
    }
  };

  const handlePostUpdated = (updatedPost) => {
    setPosts(prevPosts => prevPosts.map(p => 
      p.id === updatedPost.id ? { ...p, ...updatedPost } : p
    ));
    // Keep the modal's post prop in sync so it doesn't hold stale data.
    // This prevents the "revert" bug where modal reactions overwrite feed state
    // with a frozen snapshot from when the modal first opened.
    setPostModalOpen(prev => prev?.id === updatedPost.id ? { ...prev, ...updatedPost } : prev);
  };

  const handlePostDeleted = (postId) => {
    if (!postId) return;
    // Remove from posts array and also clear any modal state
    setPosts(prevPosts => prevPosts.filter(p => p && p.id !== postId));
    // Close any open modals that might be showing the deleted post
    if (postModalOpen?.id === postId) {
      setPostModalOpen(null);
    }
    if (postMenuOpen?.id === postId) {
      setPostMenuOpen(null);
    }
  };

  const handleJoinLive = async (authorId, authorName, authorAvatar) => {
    // Set connecting state to show pulse animation
    setConnectingToStream(authorId);
    
    try {
      const response = await apiClient.get(`/livekit/active-streams`);
      const liveStream = response.data.streams?.find(s => s.broadcaster_id === authorId);
      
      if (liveStream) {
        setLiveStreamInfo({
          id: liveStream.id,
          room_name: liveStream.room_name,
          broadcaster_id: liveStream.broadcaster_id,
          broadcaster_name: liveStream.broadcaster_name || authorName,
          broadcaster_avatar: liveStream.broadcaster_avatar || authorAvatar,
          viewer_count: liveStream.viewer_count,
          title: liveStream.title
        });
        setShowLiveViewer(true);
      } else {
        toast.error('Stream is no longer live');
        fetchLiveUsers();
      }
    } catch (error) {
      logger.error('Failed to get live stream info:', error);
      toast.error('Failed to join stream');
    } finally {
      // Clear connecting state
      setConnectingToStream(null);
    }
  };

  const fetchPosts = async () => {
    try {
      const response = await apiClient.get(`/posts`, {
        params: { limit: 10, following_only: followingOnly }
      });
      replaceFeed(response.data);
    } catch (error) {
      if (!mounted.current) return;
      setFeedLoadFailed(true);
      logger.error('Error fetching posts:', error);
      // A server error is authoritative evidence that the cached list cannot
      // be revalidated. Do not keep showing deleted/broken posts indefinitely.
      if (!followingOnly && error.response?.status >= 500) {
        pageGeneration.current += 1;
        feedCursorRef.current = null;
        feedHasMoreRef.current = false;
        try {
          localStorage.removeItem('rawsurf_cached_feed');
          localStorage.removeItem('rawsurf_cached_feed_ts');
        } catch { /* storage may be unavailable */ }
        setPosts([]);
        setFeedLastUpdated(null);
        return;
      }
      // Feed initializes from the last cached page. Keep it on network errors.
    } finally {
      setLoading(false);
    }
  };

  /**
 * loadMorePosts -- Infinite scroll: fetches the next page of posts using cursor-based pagination.
   * Appends new posts to the existing list without replacing. Deduplicates by post ID.
   */
  const loadMorePosts = async () => {
    // Guard: don't load if already loading, no more pages, or no cursor
    if (loadingMoreRef.current || !feedHasMoreRef.current || !feedCursorRef.current) {
      return;
    }
    
    const generation = pageGeneration.current;
    loadingMoreRef.current = true;
    try {
      const response = await apiClient.get('/posts', {
        params: {
          limit: 20,
          following_only: followingOnly,
          cursor: feedCursorRef.current
        }
      });
      
      const data = response.data;
      if (generation !== pageGeneration.current) return;
      const newPosts = data?.posts || (Array.isArray(data) ? data : []);
      
      // Update pagination cursor
      feedCursorRef.current = data?.next_cursor || null;
      feedHasMoreRef.current = data?.has_more || false;
      
      if (newPosts.length > 0) {
        const mappedNew = newPosts.map(post => ({
          ...post,
          liked: post.is_liked_by_user || !!post.user_reaction
        }));
        
        // Append to existing posts, deduplicating by ID
        setPosts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNew = mappedNew.filter(p => !existingIds.has(p.id));
          return [...prev, ...uniqueNew];
        });
      }
    } catch (error) {
      logger.error('Error loading more posts:', error);
 // Don't show error toast -- silently fail, user can scroll down again
    } finally {
      loadingMoreRef.current = false;
    }
  };

  return {
    feedLoadFailed, handleFeedRefresh,
    handleLoadNewPosts,
    fetchFeedLineups,
    fetchUpcomingSessions,
    fetchLiveUsers,
    fetchFollowing,
    handleFollowFromFeed,
    handleUnfollowFromMenu,
    handlePostUpdated,
    handlePostDeleted,
    handleJoinLive,
    fetchPosts,
    loadMorePosts,
    feedHasMoreRef,
    loadingMoreRef,
  };
};

export default useFeedDataActions;
