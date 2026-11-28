import { useRef, useEffect } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

/**
 * usePostModal - Extracted handler logic from PostModal.js
 * Handles: comments, likes, saves, reactions
 */
export default function usePostModal({
  user, post, onPostUpdated,
  liked, setLiked, likeCount, setLikeCount,
  saved, setSaved, userReaction, setUserReaction,
  setShowReactionPicker, showReactionPicker,
  setComments, setLoadingComments,
  commentInput, setCommentInput, setSubmittingComment,
  setIsPressing,
}) {
  const inFlightRef = useRef(false);
  const pressTimerRef = useRef(null);
  const isPressingRef = useRef(false);
  const pickerShownRef = useRef(false);

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const response = await apiClient.get(`/posts/${post.id}/comments`, {
        params: { viewer_id: user?.id }
      });
      setComments(response.data || []);
    } catch (err) {
      logger.error('Failed to load comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };
  
  const handleLike = async () => {
    if (!user?.id) {
      toast.error('Please log in to like');
      return;
    }
    
    // Concurrency guard
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    
    // Optimistic update
    const wasLiked = liked;
    const prevCount = likeCount;
    setLiked(!wasLiked);
    setLikeCount(wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    
    try {
      // Always use toggle endpoint for consistency
      const response = await apiClient.post(`/posts/${post.id}/like`);
      // Sync with authoritative server state
      setLiked(response.data.is_liked);
      setLikeCount(response.data.likes_count);
      // Propagate to parent (Feed) so card state stays in sync
      onPostUpdated?.({ ...post, liked: response.data.is_liked, likes_count: response.data.likes_count });
    } catch (err) {
      // Revert optimistic update
      setLiked(wasLiked);
      setLikeCount(prevCount);
      toast.error('Failed to update like');
    } finally {
      inFlightRef.current = false;
    }
  };
  
  const handleSave = async () => {
    if (!user?.id) {
      toast.error('Please log in to save');
      return;
    }
    
    try {
      if (saved) {
        await apiClient.delete(`/posts/${post.id}/save?user_id=${user.id}`);
        setSaved(false);
        toast.success('Removed from saved');
      } else {
        await apiClient.post(`/posts/${post.id}/save?user_id=${user.id}`);
        setSaved(true);
        toast.success('Saved!');
      }
    } catch (err) {
      logger.error('Save error:', err);
      toast.error(err.response?.data?.detail || 'Failed to save');
    }
  };
  
  // ============ SHAKA REACTION HANDLERS (copied from Feed.js pattern) ============
  const handleReactionStart = () => {
    // Clear any existing timer first
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    
    isPressingRef.current = true;
    pickerShownRef.current = false;
    setIsPressing(true);
    
    // Set timer for long-press (600ms for reliable mobile detection)
    pressTimerRef.current = setTimeout(() => {
      pickerShownRef.current = true;
      // Trigger haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }
      setShowReactionPicker(true);
      setIsPressing(false);
    }, 600);
  };
  
  const handleReactionEnd = async () => {
    const wasPressing = isPressingRef.current;
    const pickerWasShown = pickerShownRef.current;
    
    // Clear pressing state
    setIsPressing(false);
    isPressingRef.current = false;
    
    // Always clear the timer
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    
    // If long-press triggered the picker, don't do quick tap
    if (pickerWasShown) {
      pickerShownRef.current = false;
      return;
    }
    
    // If picker is showing, don't do anything
    if (showReactionPicker) {
      return;
    }
    
    // Quick tap = toggle shaka
    if (wasPressing) {
      await handleReaction(userReaction?.emoji || '\u{1F919}');
    }
  };
  
  const handleReactionCancel = () => {
    setIsPressing(false);
    isPressingRef.current = false;
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  
  const handleReaction = async (emoji) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    // Concurrency guard
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    
    setShowReactionPicker(false);
    
    const isRemoving = userReaction?.emoji === emoji;
    
    // Snapshot for rollback
    const prevLiked = liked;
    const prevCount = likeCount;
    const prevReaction = userReaction;
    
    // Optimistic update
    if (isRemoving) {
      setUserReaction(null);
      setLiked(false);
      setLikeCount(Math.max(0, prevCount - 1));
    } else {
      setUserReaction({ emoji });
      setLiked(true); // Any active reaction = liked
      // Only increment if user didn't already have a reaction (swap = no count change).
 // Check BOTH prevReaction and prevLiked a PostLike-based shaka may not
      // have set userReaction yet, but liked will be true.
      const hadExistingReaction = !!prevReaction || prevLiked;
      if (!hadExistingReaction) {
        setLikeCount(prevCount + 1);
      }
    }
    
    try {
      // ALWAYS use /reactions endpoint for ALL emojis (including shaka)
      const response = await apiClient.post(`/posts/${post.id}/reactions`, { emoji });
      
      // Always sync with authoritative server count
      if (response.data?.likes_count !== undefined) {
        setLikeCount(response.data.likes_count);
      }
      
      const action = response.data?.action;
      const newLiked = action === 'removed' ? false : true;
      const newCount = response.data?.likes_count ?? likeCount;
      if (action === 'removed') {
        setUserReaction(null);
        setLiked(false);
      } else if (action === 'added' || action === 'changed') {
        setUserReaction({ emoji });
        setLiked(true);
      }
      // Propagate to parent (Feed) so card state stays in sync.
 // IMPORTANT: Don't spread ...post here the prop is a stale snapshot
      // from when the modal opened. Only send the changed fields so the Feed
      // merges them into its live state without overwriting other updates.
      const otherReactions = (post.reactions || []).filter(r => r.user_id !== user.id);
      const newReactions = action === 'removed'
        ? otherReactions
        : [...otherReactions, { emoji, user_id: user.id, user_name: user.full_name }];
      const newUserReaction = action === 'removed' ? null : { emoji, user_id: user.id };
      onPostUpdated?.({ id: post.id, liked: newLiked, is_liked_by_user: newLiked, likes_count: newCount, reactions: newReactions, user_reaction: newUserReaction });
    } catch (err) {
      // Revert optimistic update
      setLiked(prevLiked);
      setLikeCount(prevCount);
      setUserReaction(prevReaction);
      toast.error('Failed to add reaction');
    } finally {
      inFlightRef.current = false;
    }
  };
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, []);
  
  const pendingComments = useRef(new Set());
  const handleSubmitComment = async (richPayload = null, parentId = null) => {
    const content = richPayload ? richPayload.content : commentInput.trim();
    const media_url = richPayload ? richPayload.media_url : null;
    const media_type = richPayload ? richPayload.media_type : null;
    
    if (!content?.trim() && !media_url) return;
    if (!user?.id) {
      toast.error('Please log in to comment');
      return;
    }
    
    if (pendingComments.current.has(parentId)) throw new Error('Comment already sending');
    pendingComments.current.add(parentId);
    setSubmittingComment(true);
    try {
      const { data: saved } = await apiClient.post(`/posts/${post.id}/comments`, {
        content: content?.trim() || '',
        media_url,
        media_type,
        ...(parentId ? { parent_id: parentId } : {})
      });
      if (parentId) {
        setComments(prev => prev.map(parent => parent.id === parentId
          ? { ...parent, replies: [...(parent.replies || []), saved] }
          : parent));
      } else {
        setCommentInput('');
        loadComments();
      }
      toast.success(parentId ? 'Reply added' : 'Comment added');
    } catch (err) {
      toast.error(parentId ? 'Failed to add reply' : 'Failed to add comment');
      throw err;
    } finally {
      pendingComments.current.delete(parentId);
      setSubmittingComment(false);
    }
  };
  
  // Alias for mobile view
  const handleComment = handleSubmitComment;
  
  // Ref for comment input (mobile)
  const mobileCommentInputRef = useRef(null);
  // Ref for comment input (desktop)
  const desktopCommentInputRef = useRef(null);
  
  // Like/unlike a comment
  const pendingCommentReactions = useRef(new Set());
  const handleLikeComment = async (comment) => {
    if (!user?.id) {
      toast.error('Please log in to like comments');
      return;
    }
    
    if (pendingCommentReactions.current.has(comment.id)) return;
    pendingCommentReactions.current.add(comment.id);
    const emoji = comment.viewer_reaction || '\u{1F919}';
    try {
      const { data } = await apiClient.post(`/comments/${comment.id}/reactions`, { emoji });
      const delta = data.action === 'added' ? 1 : data.action === 'removed' ? -1 : 0;
      const update = c => ({
        ...c,
        viewer_reaction: data.action === 'removed' ? null : emoji,
        reaction_count: Math.max(0, (c.reaction_count || 0) + delta)
      });
      setComments(prev => prev.map(c => {
        if (c.id === comment.id) return update(c);
        if (!c.replies?.some(reply => reply.id === comment.id)) return c;
        return { ...c, replies: c.replies.map(reply => reply.id === comment.id ? update(reply) : reply) };
      }));
    } catch (err) {
      toast.error('Failed to like comment');
    } finally {
      pendingCommentReactions.current.delete(comment.id);
    }
  };

  return {
    inFlightRef, pressTimerRef,
    loadComments, handleLike, handleSave,
    handleReactionStart, handleReactionEnd, handleReactionCancel,
    handleReaction, handleSubmitComment, handleLikeComment,
    handleComment: handleSubmitComment,
  };
}
