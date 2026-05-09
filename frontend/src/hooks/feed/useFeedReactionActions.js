/**
 * useFeedReactionActions — Extracted from useFeedActions.js (v77)
 * Handles: likes, shaka tap/hold, emoji reactions, save/bookmark, comments
 */
import { useRef } from 'react';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const useFeedReactionActions = ({
  user, posts,
  showReactionPicker, commentInputs, showAllComments, loadingComments,
  // State setters
  setAllComments, setCommentInputs, setLoadingComments,
  setPosts, setPressingPostId, setPickerAnchor,
  setShowAllComments, setShowReactionPicker, setCollaborationLoading,
  setShowCollaboratorsModal,
}) => {
  // Refs for long-press reaction picker
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartTimeRef = useRef(0);

  // In-flight guard: prevents concurrent like/reaction API calls for same post
  const likingInFlight = useRef(new Set());

  const handleLike = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in to like posts');
      return;
    }
    
    // In-flight guard: skip if a like/reaction call is already running for this post
    if (likingInFlight.current.has(postId)) return;
    likingInFlight.current.add(postId);
    
    // Snapshot current state BEFORE optimistic update
    const currentPost = posts.find(p => p.id === postId);
    const wasLiked = currentPost?.liked;
    const oldCount = currentPost?.likes_count || 0;
    
    // Optimistic UI update
    setPosts(prevPosts => prevPosts.map(p =>
      p.id === postId
        ? {
            ...p,
            liked: !wasLiked,
            likes_count: wasLiked ? Math.max(0, oldCount - 1) : oldCount + 1
          }
        : p
    ));
    
    try {
      if (wasLiked) {
        await apiClient.delete(`/posts/${postId}/like?user_id=${user.id}`);
      } else {
        await apiClient.post(`/posts/${postId}/like?user_id=${user.id}`);
      }
    } catch (error) {
      // Revert optimistic update by re-fetching authoritative state
      try {
        const postResponse = await apiClient.get(`/posts/${postId}`);
        if (postResponse.data) {
          setPosts(prevPosts => prevPosts.map(p =>
            p.id === postId ? { ...postResponse.data, liked: postResponse.data.is_liked_by_user } : p
          ));
        }
      } catch { /* silent - UI may be slightly stale */ }
      toast.error('Failed to update like');
    } finally {
      likingInFlight.current.delete(postId);
    }
  };

  const handleShakaTapToggle = (postId) => {
    if (longPressTriggeredRef.current) return;
    handleLike(postId);
  };

  const handleShakaPointerDown = (postId, e) => {
    longPressTriggeredRef.current = false;
    touchStartTimeRef.current = Date.now();

    // Capture anchor rect eagerly — React recycles the synthetic event,
    // so e.currentTarget will be null by the time the timeout fires.
    const anchorRect = e.currentTarget?.getBoundingClientRect();

    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setPressingPostId(postId);
      setShowReactionPicker(postId);
      setPickerAnchor(anchorRect);
    }, 500);
  };

  const handleShakaPointerUp = (postId) => {
    clearTimeout(longPressTimerRef.current);
    if (!longPressTriggeredRef.current) {
      handleShakaTapToggle(postId);
    }
    longPressTriggeredRef.current = false;
    setPressingPostId(null);
  };

  const handleShakaPointerLeave = () => {
    clearTimeout(longPressTimerRef.current);
    longPressTriggeredRef.current = false;
    setPressingPostId(null);
  };

  // Fallback onClick for mobile browsers where pointerUp may not fire
  // (e.g., when touch is intercepted by scroll or context menu).
  const handleShakaClick = (postId) => {
    // Only act if pointerUp didn't already handle it — check elapsed time.
    const elapsed = Date.now() - touchStartTimeRef.current;
    if (elapsed < 500 && !longPressTriggeredRef.current) {
      // PointerUp should have handled it, but if the like didn't go through
      // within the last 100ms, this is a safety net.
      // Skip if pointerUp already processed it (check in-flight guard).
      if (!likingInFlight.current.has(postId)) {
        handleLike(postId);
      }
    }
    longPressTriggeredRef.current = false;
  };

  const handleReaction = async (postId, emoji) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }

    // In-flight guard
    if (likingInFlight.current.has(postId)) return;
    likingInFlight.current.add(postId);

    const targetPost = posts.find(p => p.id === postId);
    const currentReaction = targetPost?.user_reaction;
    const isRemoving = currentReaction?.emoji === emoji;

    // Optimistic update
    setPosts(prevPosts => prevPosts.map(p => {
      if (p.id !== postId) return p;
      if (isRemoving) {
        return { ...p, user_reaction: null, liked: false };
      }
      return {
        ...p,
        user_reaction: { emoji, user_id: user.id },
        liked: true
      };
    }));
    setShowReactionPicker(null);

    try {
      const response = await apiClient.post(`/posts/${postId}/reactions`, {
        user_id: user.id,
        emoji: emoji
      });

      const action = response.data?.action;
      if (action === 'removed') {
        setPosts(prevPosts => prevPosts.map(p =>
          p.id === postId ? { ...p, liked: false } : p
        ));
      } else if (action === 'added' || action === 'changed') {
        setPosts(prevPosts => prevPosts.map(p =>
          p.id === postId ? { ...p, liked: true } : p
        ));
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
            action: action || (isRemoving ? 'removed' : 'added')
          }
        });
      } catch (broadcastError) {
        // Silent fail for broadcast - not critical
        logger.debug('Broadcast skipped:', broadcastError.message);
      }
      
      // Send notification to post author if adding a reaction (not removing)
      if ((action === 'added' || action === 'changed') && targetPost && targetPost.author_id !== user.id) {
        try {
          await apiClient.post('/notifications', {
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
          });
        } catch (_notifErr) {
          // Silent fail - notification is non-critical
        }
      }
    } catch (error) {
      logger.error('Reaction error:', error);
      toast.error('Failed to add reaction');
      // Revert by re-fetching authoritative state instead of full fetchPosts
      try {
        const postResponse = await apiClient.get(`/posts/${postId}`);
        if (postResponse.data) {
          setPosts(prevPosts => prevPosts.map(p =>
            p.id === postId ? { ...postResponse.data, liked: postResponse.data.is_liked_by_user } : p
          ));
        }
      } catch { /* silent - UI may be slightly stale */ }
    } finally {
      likingInFlight.current.delete(postId);
    }
  };

  const handleSavePost = async (postId, isSaved) => {
    // Optimistic update
    setPosts(posts.map(p =>
      p.id === postId ? { ...p, saved: !isSaved } : p
    ));
    
    try {
      if (isSaved) {
        await apiClient.delete(`/posts/${postId}/save?user_id=${user.id}`);
        toast.success('Post removed from saved');
      } else {
        await apiClient.post(`/posts/${postId}/save?user_id=${user.id}`);
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

  return {
    handleLike,
    handleShakaTapToggle,
    handleShakaPointerDown,
    handleShakaPointerUp,
    handleShakaPointerLeave,
    handleShakaClick,
    handleReaction,
    handleSavePost,
    handleCommentSubmit,
    loadAllComments,
    hideAllComments,
    handleIWasThere,
    handleViewCollaborators,
  };
};

export default useFeedReactionActions;
