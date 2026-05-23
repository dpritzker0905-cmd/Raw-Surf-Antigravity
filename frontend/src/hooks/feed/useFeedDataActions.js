/**
 * useFeedDataActions -- Extracted from useFeedActions.js (v77)
 * Handles: post fetching, pagination, refresh, feed lineups,
 * upcoming sessions, live users, following, post CRUD
 */
import { useCallback, useRef } from 'react';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const useFeedDataActions = ({
  user, posts, latestPostIdRef, isPhotographer,
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

  const handleFeedRefresh = useCallback(async (e) => {
    const silent = e?.detail?.silent === true;
    setIsRefreshing(true);
    try {
      const response = await apiClient.get('/posts', {
        params: { limit: 10 },
 timeout: 8000 // 8s timeout -- Render cold-starts can take up to 30s
      });
      // New paginated response format: { posts, next_cursor, has_more }
      const data = response.data;
      const incoming = data?.posts || data || [];
      if (incoming.length === 0) { setIsRefreshing(false); return; }

      // Update cursor state from paginated response
      if (data?.next_cursor !== undefined) {
        feedCursorRef.current = data.next_cursor;
        feedHasMoreRef.current = data.has_more;
      }

      // Snap to new posts immediately on manual tap (non-silent)
      if (!silent) {
        setPosts(incoming.map(post => ({ ...post, liked: post.is_liked_by_user || !!post.user_reaction })));
        setNewPostsChip(0);
        latestPostIdRef.current = incoming[0]?.id ?? null;
      } else {
        // Silent auto-refresh: show chip only if there are genuinely new posts
        const currentLatest = latestPostIdRef.current;
        const newCount = currentLatest
          ? incoming.filter(p => String(p.id) > String(currentLatest)).length
          : 0;
        if (newCount > 0) setNewPostsChip(newCount);
      }
    } catch (err) {
      logger.error('feed:refresh failed', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.id]);

  const handleLoadNewPosts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await apiClient.get('/posts', {
        params: { limit: 10 }
      });
      const data = response.data;
      const incoming = data?.posts || (Array.isArray(data) ? data : []);
      if (incoming.length > 0) {
        setPosts(incoming.map(post => ({
          ...post,
          liked: post.is_liked_by_user || !!post.user_reaction
        })));
        
        // Update pagination cursor to keep infinite scroll in sync
        if (data?.next_cursor !== undefined) {
          feedCursorRef.current = data.next_cursor;
          feedHasMoreRef.current = data.has_more;
        }
        
        latestPostIdRef.current = incoming[0]?.id ?? null;
        
        // Scroll the main content container to the top (works on both desktop and mobile)
        const scrollContainer = document.getElementById('main-content') || window;
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      logger.error('handleLoadNewPosts failed:', err);
    }
    setNewPostsChip(0);
    setIsRefreshing(false);
  }, [user?.id]);

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
    if (postModalOpen?.id === updatedPost.id) {
      setPostModalOpen(prev => prev ? { ...prev, ...updatedPost } : prev);
    }
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
    // Stale-while-revalidate: show cached feed instantly while fetching fresh data
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    let servedFromCache = false;
    try {
      const cached = localStorage.getItem('rawsurf_cached_feed');
      const cachedTs = localStorage.getItem('rawsurf_cached_feed_ts');
      if (cached && cachedTs) {
        const age = Date.now() - new Date(cachedTs).getTime();
        if (age < CACHE_TTL_MS) {
          const cachedPosts = JSON.parse(cached);
          if (cachedPosts.length > 0) {
            setPosts(cachedPosts);
            setFeedLastUpdated(cachedTs);
            setLoading(false); // Unblock UI immediately with cached content
            servedFromCache = true;
            logger.info(`feed:cache-hit (${Math.round(age/1000)}s old, ${cachedPosts.length} posts)`);
          }
        }
      }
    } catch { /* ignore corrupt cache */ }

    try {
      const response = await apiClient.get(`/posts`, {
        params: { limit: 10 },
        timeout: 12000  // 12s timeout for initial load (allows Render wake-up)
      });
      // New paginated response format: { posts, next_cursor, has_more }
      const data = response.data;
      const postsArray = data?.posts || (Array.isArray(data) ? data : []);
      
      // Store pagination cursor for infinite scroll
      if (data?.next_cursor !== undefined) {
        feedCursorRef.current = data.next_cursor;
        feedHasMoreRef.current = data.has_more;
      } else {
        feedCursorRef.current = null;
        feedHasMoreRef.current = false;
      }
      
      if (postsArray.length > 0) {
        // Map is_liked_by_user to liked for frontend state
        const mappedPosts = postsArray.map(post => ({
          ...post,
          liked: post.is_liked_by_user || !!post.user_reaction
        }));
        setPosts(mappedPosts);
        setLoading(false); // Unblock UI immediately after posts arrive
        setFeedLastUpdated(new Date().toISOString());
        // Cache last 20 posts for offline fallback (async, non-blocking)
        try {
          localStorage.setItem('rawsurf_cached_feed', JSON.stringify(mappedPosts.slice(0, 20)));
          localStorage.setItem('rawsurf_cached_feed_ts', new Date().toISOString());
        } catch { /* localStorage full */ }
      } else {
        // Fallback demo posts if no real posts
        setPosts([
          {
            id: 'demo-1',
            author_name: 'Pro Surfer Mike',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600',
            media_type: 'image',
 caption: 'Dawn patrol at its finest! =',
            location: 'Pipeline, Hawaii',
            likes_count: 247,
            liked: false,
            created_at: new Date().toISOString()
          },
          {
            id: 'demo-2',
            author_name: 'SurfPhotog_Sarah',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=600',
            media_type: 'image',
            caption: 'Caught this beauty yesterday morning',
            location: 'Sebastian Inlet',
            likes_count: 189,
            liked: false,
            created_at: new Date().toISOString()
          },
          {
            id: 'demo-3',
            author_name: 'GromDad_FL',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600',
            media_type: 'image',
            caption: 'Little one is getting better every day!',
            location: 'Cocoa Beach',
            likes_count: 312,
            liked: false,
            created_at: new Date().toISOString()
          }
        ]);
      }
    } catch (error) {
      logger.error('Error fetching posts:', error);
      // Try loading cached feed before falling back to demo posts
      try {
        const cached = localStorage.getItem('rawsurf_cached_feed');
        const cachedTs = localStorage.getItem('rawsurf_cached_feed_ts');
        if (cached) {
          setPosts(JSON.parse(cached));
          setFeedLastUpdated(cachedTs || null);
          logger.info('Loaded cached feed data');
        } else {
          throw new Error('No cache');
        }
      } catch {
        // Final fallback: demo posts
        setPosts([
          {
            id: 'demo-1',
            author_name: 'Pro Surfer Mike',
            author_avatar: null,
            media_url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600',
            media_type: 'image',
 caption: 'Dawn patrol at its finest! =',
            location: 'Pipeline, Hawaii',
            likes_count: 247,
            liked: false,
            created_at: new Date().toISOString()
          }
        ]);
      }
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
    
    loadingMoreRef.current = true;
    try {
      const response = await apiClient.get('/posts', {
        params: {
          limit: 20,
          cursor: feedCursorRef.current
        }
      });
      
      const data = response.data;
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
    handleFeedRefresh,
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
