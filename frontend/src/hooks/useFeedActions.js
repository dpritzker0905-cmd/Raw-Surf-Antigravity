/**
 * useFeedActions.js — Extracted from Feed.js
 * Feed data fetching, social interactions, check-in, GPS location.
 * ~1009 lines of pure handler functions extracted.
 */
import { useCallback, useRef } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const useFeedActions = ({
  user, navigate, activeTab, feedFilter, selectedCountry, selectedState, selectedCity,
  replyingTo, commentText, checkInSpot, posts, expandedComments, commentSections,
  latestPostIdRef,
  // State setters
  setAllComments,
  setCheckInData,
  setCheckInLoading,
  setCheckInReward,
  setCollaborationLoading,
  setCommentInputs,
  setConnectingToStream,
  setFeedLastUpdated,
  setFeedLineups,
  setFeedLineupsLoading,
  setFollowLoading,
  setFollowingUsers,
  setGpsLoading,
  setIsRefreshing,
  setItem,
  setLiveStreamInfo,
  setLiveUsers,
  setLoading,
  setLoadingComments,
  setLocationHierarchy,
  setNearestSpot,
  setNewPostsChip,
  setPickerAnchor,
  setPostMenuOpen,
  setPostModalOpen,
  setPosts,
  setPressingPostId,
  setSelectedCity,
  setSelectedCountry,
  setSelectedState,
  setShowAllComments,
  setShowCheckInModal,
  setShowCollaboratorsModal,
  setShowLiveViewer,
  setShowReactionPicker,
  setSpots,
  setStreak,
  setUpcomingSessions,
  setUpcomingSessionsLoading,
}) => {

  const handleFeedRefresh = useCallback(async (e) => {
    const silent = e?.detail?.silent === true;
    setIsRefreshing(true);
    try {
      const response = await apiClient.get('/posts', {
        params: { limit: 10 }
      });
      const incoming = response.data || [];
      if (incoming.length === 0) { setIsRefreshing(false); return; }

      // Snap to new posts immediately on manual tap (non-silent)
      if (!silent) {
        setPosts(incoming.map(post => ({ ...post, localLiked: false })));
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
      const incoming = response.data || [];
      if (incoming.length > 0) {
        setPosts(incoming.map(post => ({ ...post, localLiked: false })));
        latestPostIdRef.current = incoming[0]?.id ?? null;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch { /* silent � non-critical refresh */ }
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
    
    // Optimistic update � instant UI
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
    
    // Optimistic update � instant UI
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
      });
      if (response.data && response.data.length > 0) {
        // Map is_liked_by_user to liked for frontend state
        const mappedPosts = response.data.map(post => ({
          ...post,
          liked: post.is_liked_by_user
        }));
        setPosts(mappedPosts);
        setFeedLastUpdated(new Date().toISOString());
        // Cache last 20 posts for offline fallback
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
            caption: 'Dawn patrol at its finest! ??',
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
            caption: 'Dawn patrol at its finest! ??',
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

  const fetchStreak = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/streak/${user.id}`);
      setStreak(response.data);
    } catch (error) {
      logger.error('Error fetching streak:', error);
    }
  };

  const fetchSpots = async () => {
    try {
      const response = await apiClient.get(`/surf-spots`);
      setSpots(response.data);
    } catch (error) {
      logger.error('Error fetching spots:', error);
    }
  };

  const fetchLocationHierarchy = async () => {
    try {
      const response = await apiClient.get(`/surf-spots/locations`);
      setLocationHierarchy(response.data || { countries: [] });
    } catch (error) {
      logger.error('Error fetching location hierarchy:', error);
    }
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const getGpsLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    setGpsLoading(true);

    const handlePosition = (position) => {
      const { latitude, longitude } = position.coords;

      // Find nearest spot
      let nearest = null;
      let minDistance = Infinity;
      spots.forEach(spot => {
        const distance = calculateDistance(latitude, longitude, spot.latitude, spot.longitude);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { ...spot, distance: distance.toFixed(1) };
        }
      });

      setCheckInData(prev => ({
        ...prev,
        latitude,
        longitude,
        use_gps: true,
        spot_id: nearest && minDistance < 10 ? nearest.id : prev.spot_id
      }));

      setNearestSpot(nearest);
      if (nearest && minDistance < 10) {
        toast.success(`\uD83D\uDCCD At ${nearest.name} (${nearest.distance}km) � GPS verified, you'll earn XP!`);
      } else if (nearest) {
        toast.success(`\uD83D\uDCCD Location found. Nearest spot: ${nearest.name} (${nearest.distance}km)`);
      } else {
        toast.success('\uD83D\uDCCD Location detected � select your spot to earn XP');
      }
      setGpsLoading(false);
    };

    const handleErrorFinal = (error) => {
      setGpsLoading(false);
      if (error.code === 1) { // PERMISSION_DENIED
        toast.error(
          navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')
            ? 'Location denied. Go to Settings \u2192 Privacy \u2192 Location Services \u2192 Safari \u2192 While Using.'
            : 'Location access denied. Please enable it in your browser settings.'
        );
      } else if (error.code === 3) { // TIMEOUT
        toast.error('Location timed out. Tap again or select your spot manually below.');
      } else {
        toast.error('Unable to detect location. Select your spot manually below.');
      }
    };

    const handleErrorWithRetry = (error) => {
      if (error.code === 2 || error.code === 3) {
        // POSITION_UNAVAILABLE or TIMEOUT � retry with high accuracy & fresh fix
        navigator.geolocation.getCurrentPosition(
          handlePosition,
          handleErrorFinal,
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      } else {
        handleErrorFinal(error);
      }
    };

    // First attempt: low-accuracy / cached � fast on most devices
    navigator.geolocation.getCurrentPosition(
      handlePosition,
      handleErrorWithRetry,
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
    );
  };

  const handleLike = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to like posts');
      return;
    }
    
    // Find current post state
    const currentPost = posts.find(p => p.id === postId);
    const isCurrentlyLiked = currentPost?.liked;
    const currentLikesCount = currentPost?.likes_count || 0;
    
    // Optimistic update with toggle using functional update
    setPosts(prevPosts => prevPosts.map(p =>
      p.id === postId ? { 
        ...p, 
        likes_count: isCurrentlyLiked ? Math.max(0, p.likes_count - 1) : p.likes_count + 1, 
        liked: !isCurrentlyLiked 
      } : p
    ));
    
    try {
      const response = await apiClient.post(`/posts/${postId}/like`);
      // Update with actual server response using functional update
      setPosts(prevPosts => prevPosts.map(p =>
        p.id === postId ? { 
          ...p, 
          likes_count: response.data.likes_count, 
          liked: response.data.is_liked 
        } : p
      ));
    } catch (error) {
      // Revert on error using functional update
      setPosts(prevPosts => prevPosts.map(p =>
        p.id === postId ? { 
          ...p, 
          likes_count: currentLikesCount, 
          liked: isCurrentlyLiked 
        } : p
      ));
      toast.error('Failed to update like');
    }
  };

  const handleShakaTapToggle = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    const currentPost = posts.find(p => p.id === postId);
    const userReaction = currentPost?.reactions?.find(r => r.user_id === user.id);
    const isLiked = currentPost?.liked;
    
    // Case 1: User has an active non-Shaka reaction (Fire, Wave, Heart) ? CLEAR IT & UNLIKE
    if (userReaction && userReaction.emoji !== '??') {
      // Optimistic update - remove reaction AND set liked to false (unchecked Shaka)
      setPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            liked: false, // Global reset to unchecked state
            likes_count: Math.max(0, (p.likes_count || 1) - 1),
            reactions: (p.reactions || []).filter(r => r.user_id !== user.id)
          };
        }
        return p;
      }));
      
      try {
        // Call API to remove the reaction (toggle it off)
        await apiClient.post(`/posts/${postId}/reactions`, { 
          emoji: userReaction.emoji 
        });
        // Also unlike if was liked
        if (isLiked) {
          await apiClient.post(`/posts/${postId}/like`);
        }
      } catch (error) {
        toast.error('Failed to clear reaction');
        fetchPosts();
      }
      return;
    }
    
    // Case 2: User has liked (checked Shaka) ? Unlike (revert to unchecked)
    // Case 3: User has unchecked Shaka ? Like (check it)
    handleLike(postId);
  };

  const handleShakaPointerDown = (postId, e) => {
    // Prevent any default browser behavior
    if (e.cancelable) {
      e.preventDefault();
    }
    
    // Capture the button's position for the picker to anchor to
    if (e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      setPickerAnchor({ x: rect.left + rect.width / 2, y: rect.top });
    }
    
    // Clear any existing timer first
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    touchStartTimeRef.current = Date.now();
    longPressTriggeredRef.current = false;
    
    // Set pressing state for visual feedback
    setPressingPostId(postId);
    
    // Set timer for long-press (600ms for more reliable mobile detection)
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      // Trigger haptic feedback when reaction picker appears
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }
      setShowReactionPicker(postId);
    }, 600); // 600ms threshold - slightly longer for mobile reliability
  };

  const handleShakaPointerUp = (postId, e) => {
    // Prevent any default browser behavior
    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();
    
    // Clear pressing state
    setPressingPostId(null);
    
    // Always clear the timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    // If long-press triggered the menu, do nothing - menu stays open
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false; // Reset for next interaction
      return;
    }
    
    // If menu is already showing, don't do anything (let overlay handle close)
    if (showReactionPicker === postId) {
      return;
    }
    
    // Quick tap (< 600ms) = toggle reaction with proper reversion logic
    const pressDuration = Date.now() - touchStartTimeRef.current;
    if (pressDuration < 600) {
      handleShakaTapToggle(postId); // Use new toggle function with reversion logic
    }
  };

  const handleShakaPointerLeave = () => {
    // Clear pressing state and timer if finger/mouse leaves the button
    setPressingPostId(null);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleReaction = async (postId, emoji) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    setShowReactionPicker(null);
    setPickerAnchor(null);  // Clear anchor position
    setPressingPostId(null); // Clear pressing state when picker closes

    
    // Find the post to get author info for notification
    const targetPost = posts.find(p => p.id === postId);
    
    // Check if user already has this reaction (for toggle logic)
    const existingReaction = targetPost?.reactions?.find(r => r.user_id === user.id && r.emoji === emoji);
    const isRemoving = !!existingReaction;
    
    // Special handling for shaka emoji - it maps to the "liked" state
    const isShakaEmoji = emoji === '??';
    
    // Optimistic update with animation trigger
    setPosts(prevPosts => prevPosts.map(p => {
      if (p.id === postId) {
        const reactions = p.reactions || [];
        const existingIndex = reactions.findIndex(r => r.user_id === user.id && r.emoji === emoji);
        const hadAnyReaction = reactions.some(r => r.user_id === user.id);
        
        if (existingIndex >= 0) {
          // Remove reaction - revert to UNCHECKED Shaka (liked = false)
          return {
            ...p,
            liked: false,
            likes_count: Math.max(0, (p.likes_count || 1) - 1),
            reactions: reactions.filter((_, i) => i !== existingIndex)
          };
        } else {
          // Add reaction - replace any existing reaction from this user
          const filteredReactions = reactions.filter(r => r.user_id !== user.id);
          
          // If selecting shaka, set liked=true; otherwise liked=false (emoji replaces shaka)
          return {
            ...p,
            liked: isShakaEmoji,
            // Only increment count if user didn't already have a reaction (swap = no count change)
            likes_count: hadAnyReaction ? (p.likes_count || 0) : (p.likes_count || 0) + 1,
            reactions: isShakaEmoji 
              ? filteredReactions // Shaka uses liked state, not reactions array
              : [...filteredReactions, { emoji, user_id: user.id, user_name: user.full_name }]
          };
        }
      }
      return p;
    }));
    
    try {
      let response;
      if (isShakaEmoji) {
        // Shaka emoji uses the like endpoint
        response = await apiClient.post(`/posts/${postId}/like`);
      } else {
        response = await apiClient.post(`/posts/${postId}/reactions`, { emoji });
      }
      
      // Broadcast reaction update via Supabase Realtime for social sync
      try {
        await apiClient.post(`/realtime/broadcast`, {
          channel: `post:${postId}`,
          event: 'reaction_update',
          payload: {
            post_id: postId,
            user_name: user.full_name,
            emoji: isRemoving ? null : emoji,
            action: response?.data?.action || (isRemoving ? 'removed' : 'added')
          }
        });
      } catch (broadcastError) {
        // Silent fail for broadcast - not critical
        logger.debug('Broadcast skipped:', broadcastError.message);
      }
      
      // Send notification to post author if adding a reaction (not removing)
      const action = response?.data?.action || (isRemoving ? 'removed' : 'added');
      if (action === 'added' && targetPost && targetPost.author_id !== user.id) {
        // Create notification via API
        await createNotification({
          user_id: targetPost.author_id,
          type: 'post_reaction',
          title: `${user.full_name} reacted ${emoji}`,
          message: `${user.full_name} reacted with ${emoji} to your post`,
          data: {
            post_id: postId,
            reactor_id: user.id,
            reactor_name: user.full_name,
            emoji: emoji
          }
        }).catch(() => {}); // Silent fail for notification
      }
    } catch (error) {
      logger.error('Reaction error:', error);
      toast.error('Failed to add reaction');
      fetchPosts(); // Refresh to get correct state
    }
  };

  const handleSavePost = async (postId, isSaved) => {
    // Optimistic update
    setPosts(posts.map(p =>
      p.id === postId ? { ...p, saved: !isSaved } : p
    ));
    
    try {
      if (isSaved) {
        await apiClient.delete(`/posts/${postId}/save`);
        toast.success('Post removed from saved');
      } else {
        await apiClient.post(`/posts/${postId}/save`);
        toast.success('Post saved!');
      }
    } catch (error) {
      // Revert on error
      setPosts(posts.map(p =>
        p.id === postId ? { ...p, saved: isSaved } : p
      ));
      toast.error('Failed to save post');
    }
  };

  const handleCommentSubmit = async (postId) => {
    const content = commentInputs[postId]?.trim();
    if (!content || !user?.id) {
      if (!user?.id) toast.error('Please log in to comment');
      return;
    }

    try {
      const response = await apiClient.post(
        `/posts/${postId}/comments`,
        { content }
      );
      
      // Add new comment to the post's recent_comments
      setPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          const newComment = response.data;
          const updatedComments = [...(p.recent_comments || []), newComment].slice(-2);
          return {
            ...p,
            comments_count: (p.comments_count || 0) + 1,
            recent_comments: updatedComments
          };
        }
        return p;
      }));
      
      // Also add to allComments if viewing all
      if (showAllComments[postId]) {
        setAllComments(prev => ({
          ...prev,
          [postId]: [...(prev[postId] || []), response.data]
        }));
      }
      
      // Clear input
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
      toast.success('Comment posted!');
    } catch (error) {
      logger.error('Failed to post comment:', error);
      toast.error('Failed to post comment');
    }
  };

  const loadAllComments = async (postId) => {
    if (loadingComments[postId]) return;
    
    setLoadingComments(prev => ({ ...prev, [postId]: true }));
    try {
      const response = await apiClient.get(`/posts/${postId}/comments`, {
        params: { viewer_id: user?.id }
      });
      setAllComments(prev => ({ ...prev, [postId]: response.data }));
      setShowAllComments(prev => ({ ...prev, [postId]: true }));
    } catch (error) {
      logger.error('Failed to load comments:', error);
      toast.error('Failed to load comments');
    } finally {
      setLoadingComments(prev => ({ ...prev, [postId]: false }));
    }
  };

  const hideAllComments = (postId) => {
    setShowAllComments(prev => ({ ...prev, [postId]: false }));
  };

  const handleIWasThere = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to join sessions');
      return;
    }
    
    setCollaborationLoading(postId);
    
    try {
      // Get GPS location if available
      let latitude = null;
      let longitude = null;
      
      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 0
            });
          });
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
        } catch (gpsError) {
          // GPS not available, continue without it
          logger.debug('GPS not available:', gpsError);
        }
      }
      
      await apiClient.post(
        `/posts/${postId}/request-collaboration`,
        {
          latitude,
          longitude
        }
      );
      
      toast.success('Request sent! The post owner will review your request.');
      
      // Update local state to show pending
      setPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            collaborators: [
              ...(p.collaborators || []),
              {
                id: 'pending-' + user.id,
                full_name: user.full_name,
                avatar_url: user.avatar_url,
                status: 'pending',
                verified_by_gps: !!latitude
              }
            ]
          };
        }
        return p;
      }));
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to send request';
      toast.error(message);
    } finally {
      setCollaborationLoading(null);
    }
  };

  const handleViewCollaborators = (postId) => {
    setShowCollaboratorsModal(postId);
  };

  const handleCheckIn = async () => {
    if (streak.checked_in_today) {
      toast.info('You already checked in today! Keep the streak going tomorrow ??');
      return;
    }
    setShowCheckInModal(true);
  };

  const submitCheckIn = async () => {
    setCheckInLoading(true);

    const spotId = checkInData.spot_id || nearestSpot?.id;
    const spotName = spotId
      ? (spots.find(s => s.id === spotId)?.name || nearestSpot?.name || 'Unknown Spot')
      : 'Custom Location';

    try {
      if (checkInData.use_gps && checkInData.latitude && checkInData.longitude && spotId) {
        // GPS path ? Passport check-in (XP + stamps + badges)
        const passportResponse = await apiClient.post(`/passport/checkin`, {
          spot_id: spotId,
          latitude: checkInData.latitude,
          longitude: checkInData.longitude,
          notes: checkInData.notes || null
        });

        if (!passportResponse.data.success) {
          toast.error(passportResponse.data.message || `You're too far from ${spotName} to check in`);
          setCheckInLoading(false);
          return;
        }

        // Also update legacy streak (best-effort)
        try {
          const streakResponse = await apiClient.post(`/check-in`, {
            spot_id: spotId,
            spot_name: spotName,
            conditions: checkInData.conditions || null,
            wave_height: checkInData.wave_height || null,
            notes: checkInData.notes || null,
            latitude: checkInData.latitude,
            longitude: checkInData.longitude,
            use_gps: true
          });
          setStreak({
            current_streak: streakResponse.data.current_streak,
            longest_streak: streakResponse.data.longest_streak,
            total_check_ins: streakResponse.data.total_check_ins,
            checked_in_today: true
          });
        } catch (streakError) {
          if (streakError.response?.data?.detail !== 'Already checked in today') {
            logger.warn('Legacy streak update failed:', streakError);
          }
          setStreak(prev => ({ ...prev, checked_in_today: true }));
        }

        // Show gamification reward card in modal instead of plain toast
        setCheckInReward({
          spot_name: spotName,
          xp_earned: passportResponse.data.xp_earned,
          badge_earned: passportResponse.data.badge_earned,
          is_first_visit: passportResponse.data.is_first_visit,
          streak_days: passportResponse.data.streak_days,
          new_level: passportResponse.data.new_level,
        });

      } else {
        // Manual (non-GPS) path ? legacy streak only, no passport XP
        const response = await apiClient.post(`/check-in`, {
          spot_id: spotId || null,
          spot_name: spotName,
          conditions: checkInData.conditions || null,
          wave_height: checkInData.wave_height || null,
          notes: checkInData.notes || null,
          latitude: checkInData.latitude,
          longitude: checkInData.longitude,
          use_gps: checkInData.use_gps
        });

        setStreak({
          current_streak: response.data.current_streak,
          longest_streak: response.data.longest_streak,
          total_check_ins: response.data.total_check_ins,
          checked_in_today: true
        });

        toast.success(`Checked in! \uD83D\uDD25 ${response.data.current_streak} day streak!`);
        // Close immediately for manual check-in
        setShowCheckInModal(false);
        setCheckInData({ spot_id: '', conditions: '', wave_height: '', notes: '', latitude: null, longitude: null, use_gps: false });
        setNearestSpot(null);
        setSelectedCountry('');
        setSelectedState('');
        setSelectedCity('');
      }

    } catch (error) {
      if (error.response?.data?.detail === 'Already checked in today') {
        toast.info('You already checked in today!');
        setStreak(prev => ({ ...prev, checked_in_today: true }));
      } else {
        const errorMsg = error.response?.data?.message || error.response?.data?.detail || 'Failed to check in';
        toast.error(errorMsg);
      }
    } finally {
      setCheckInLoading(false);
    }
  };

  const closeCheckInModal = () => {
    setShowCheckInModal(false);
    setCheckInReward(null);
    setCheckInData({ spot_id: '', conditions: '', wave_height: '', notes: '', latitude: null, longitude: null, use_gps: false });
    setNearestSpot(null);
    setSelectedCountry('');
    setSelectedState('');
    setSelectedCity('');
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
    fetchStreak,
    fetchSpots,
    fetchLocationHierarchy,
    calculateDistance,
    getGpsLocation,
    handleLike,
    handleShakaTapToggle,
    handleShakaPointerDown,
    handleShakaPointerUp,
    handleShakaPointerLeave,
    handleReaction,
    handleSavePost,
    handleCommentSubmit,
    loadAllComments,
    hideAllComments,
    handleIWasThere,
    handleViewCollaborators,
    handleCheckIn,
    submitCheckIn,
    closeCheckInModal,
  };
};

export default useFeedActions;