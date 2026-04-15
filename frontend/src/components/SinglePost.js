/**
 * SinglePost - View a single post with full details
 * Used when navigating directly to /post/:postId
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Loader2, X, MessageCircle, Send } from 'lucide-react';
import { Button } from './ui/button';
import PostCard from './PostCard';
import PostMenu, { SharePostModal } from './PostMenu';
import { CommentInputWithEmoji } from './EmojiPicker';
import { CommentText } from './RichText';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SinglePost = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Comment state
  const [commentInputs, setCommentInputs] = useState({});
  const [showAllComments, setShowAllComments] = useState({});
  const [allComments, setAllComments] = useState({});
  const [loadingComments, setLoadingComments] = useState({});
  
  // Following state
  const [followingUsers, setFollowingUsers] = useState(new Set());
  
  // Menu state
  const [postMenuOpen, setPostMenuOpen] = useState(null);
  const [sharePostOpen, setSharePostOpen] = useState(null);
  
  // Live users (empty for single post view)
  const [liveUsers] = useState([]);
  const [connectingToStream] = useState(null);

  // Smart back navigation - uses browser history when available
  const handleBack = () => {
    // If we have history entries beyond the initial page load, go back
    // window.history.length > 1 means there's at least one page to go back to
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      // Only fallback to feed if there's truly no history (e.g., direct URL access)
      navigate('/feed', { replace: true });
    }
  };

  // Theme classes
  const bgClass = isLight ? 'bg-gray-50' : 'bg-black';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-500' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const postCardBgClass = isLight ? 'bg-white' : 'bg-zinc-900/50';

  // Time formatting helper
  const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return date.toLocaleDateString();
  };

  useEffect(() => {
    fetchPost();
    if (user?.id) {
      fetchFollowing();
    }
  }, [postId, user?.id]);

  // Auto-load all comments when viewing single post
  useEffect(() => {
    if (post?.id && !showAllComments[post.id]) {
      loadAllComments(post.id);
      setShowAllComments(prev => ({ ...prev, [post.id]: true }));
    }
  }, [post?.id]);

  const fetchPost = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/posts/${postId}`, {
        params: { viewer_id: user?.id }
      });
      setPost(response.data);
      setError(null);
    } catch (err) {
      logger.error('Error fetching post:', err);
      setError(err.response?.status === 404 ? 'Post not found' : 'Failed to load post');
    } finally {
      setLoading(false);
    }
  };

  const fetchFollowing = async () => {
    try {
      const response = await axios.get(`${API}/follows/${user.id}/following`);
      const followingIds = new Set(response.data.map(f => f.following_id));
      setFollowingUsers(followingIds);
    } catch (err) {
      logger.error('Error fetching following:', err);
    }
  };

  // Like/Reaction handlers
  // Shaka reaction handlers with long-press for emoji picker
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const pressTimerRef = React.useRef(null);
  const isPressingRef = React.useRef(false);
  const pickerShownRef = React.useRef(false);
  
  const VALID_REACTIONS = ['🤙', '❤️', '🔥', '🌊', '👏'];
  
  const handleShakaPointerDown = (postId, e) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    
    isPressingRef.current = true;
    pickerShownRef.current = false;
    setIsPressing(true);
    
    // Long press to show picker
    pressTimerRef.current = setTimeout(() => {
      pickerShownRef.current = true;
      if (navigator.vibrate) navigator.vibrate(10);
      setShowReactionPicker(postId);
      setIsPressing(false);
    }, 600);
  };

  const handleShakaPointerUp = async (postId, e) => {
    const wasPressing = isPressingRef.current;
    const pickerWasShown = pickerShownRef.current;
    
    setIsPressing(false);
    isPressingRef.current = false;
    
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    
    // If picker was shown, don't trigger quick tap
    if (pickerWasShown || showReactionPicker) {
      return;
    }
    
    // Quick tap = toggle shaka reaction
    if (wasPressing) {
      await handleReaction(postId, '🤙');
    }
  };
  
  const handleShakaPointerLeave = () => {
    setIsPressing(false);
    isPressingRef.current = false;
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  
  const handleReaction = async (postId, emoji) => {
    if (!user?.id) {
      toast.error('Please log in to react');
      return;
    }
    
    setShowReactionPicker(false);
    
    try {
      const response = await axios.post(`${API}/posts/${postId}/reactions`, 
        { emoji },
        { params: { user_id: user.id } }
      );
      
      const action = response.data.action;
      
      if (action === 'added') {
        // New reaction added - increment count
        setPost(prev => {
          const newReactions = [...(prev.reactions || []), { user_id: user.id, emoji }];
          return {
            ...prev,
            liked: true,
            reactions: newReactions,
            likes_count: (prev.likes_count || 0) + 1
          };
        });
        toast.success(`Reacted with ${emoji}`);
      } else if (action === 'changed') {
        // Changed emoji - update reaction but don't change count
        setPost(prev => {
          const filteredReactions = (prev.reactions || []).filter(r => r.user_id !== user.id);
          const newReactions = [...filteredReactions, { user_id: user.id, emoji }];
          return {
            ...prev,
            liked: true,
            reactions: newReactions
            // Don't change likes_count - just swapped emoji
          };
        });
        toast.success(`Changed to ${emoji}`);
      } else if (action === 'removed') {
        // Reaction removed - decrement count
        setPost(prev => {
          const filteredReactions = (prev.reactions || []).filter(r => r.user_id !== user.id);
          return {
            ...prev,
            liked: false,
            reactions: filteredReactions,
            likes_count: Math.max(0, (prev.likes_count || 1) - 1)
          };
        });
      }
    } catch (err) {
      toast.error('Failed to add reaction');
    }
  };

  // Save post
  const handleSavePost = async (postId, isSaved) => {
    if (!user?.id) {
      toast.error('Please log in to save posts');
      return;
    }
    
    try {
      if (isSaved) {
        await axios.delete(`${API}/posts/${postId}/save`, {
          params: { user_id: user.id }
        });
        setPost(prev => ({ ...prev, saved: false }));
        toast.success('Removed from saved');
      } else {
        await axios.post(`${API}/posts/${postId}/save`, null, {
          params: { user_id: user.id }
        });
        setPost(prev => ({ ...prev, saved: true }));
        toast.success('Saved!');
      }
    } catch (err) {
      toast.error('Failed to save post');
    }
  };

  // Comment handlers
  const handleCommentSubmit = async (postId) => {
    const content = commentInputs[postId]?.trim();
    if (!content || !user?.id) return;
    
    try {
      await axios.post(`${API}/posts/${postId}/comments`, {
        author_id: user.id,
        content
      });
      
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
      setPost(prev => ({
        ...prev,
        comments_count: (prev.comments_count || 0) + 1
      }));
      
      // Reload comments if showing
      if (showAllComments[postId]) {
        loadAllComments(postId);
      }
      
      toast.success('Comment added');
    } catch (err) {
      toast.error('Failed to add comment');
    }
  };

  const loadAllComments = async (postId) => {
    setLoadingComments(prev => ({ ...prev, [postId]: true }));
    try {
      const response = await axios.get(`${API}/posts/${postId}/comments`, {
        params: { viewer_id: user?.id }
      });
      setAllComments(prev => ({ ...prev, [postId]: response.data }));
      setShowAllComments(prev => ({ ...prev, [postId]: true }));
    } catch (err) {
      toast.error('Failed to load comments');
    } finally {
      setLoadingComments(prev => ({ ...prev, [postId]: false }));
    }
  };

  const hideAllComments = (postId) => {
    setShowAllComments(prev => ({ ...prev, [postId]: false }));
  };

  // Follow handlers
  const handleFollowFromFeed = async (userId, userName) => {
    if (!user?.id) return;
    
    try {
      await axios.post(`${API}/follows/${user.id}/follow/${userId}`);
      setFollowingUsers(prev => new Set([...prev, userId]));
      toast.success(`Following ${userName}`);
    } catch (err) {
      toast.error('Failed to follow');
    }
  };

  // Collaboration handlers
  const handleIWasThere = async (postId) => {
    if (!user?.id) {
      toast.error('Please log in');
      return;
    }
    
    try {
      await axios.post(`${API}/posts/${postId}/collaborators`, null, {
        params: { user_id: user.id }
      });
      toast.success("Added you as a collaborator!");
      fetchPost(); // Refresh to show updated collaborators
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add collaboration');
    }
  };

  const handleViewCollaborators = (postId) => {
    // Could show a modal, for now just a toast
    const collabs = post?.collaborators || [];
    if (collabs.length === 0) {
      toast.info('No collaborators yet');
    } else {
      toast.info(`${collabs.length} collaborator${collabs.length > 1 ? 's' : ''} in this session`);
    }
  };

  const handleJoinLive = () => {
    // Not applicable for single post view
  };

  // Post menu handlers
  const handlePostUpdated = (updatedPost) => {
    setPost(prev => ({ ...prev, ...updatedPost }));
  };

  const handlePostDeleted = () => {
    toast.success('Post deleted');
    navigate('/feed');
  };

  const handleUnfollowFromMenu = async (userId) => {
    if (!user?.id) return;
    try {
      await axios.delete(`${API}/follows/${user.id}/unfollow/${userId}`);
      setFollowingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      toast.success('Unfollowed');
    } catch (err) {
      toast.error('Failed to unfollow');
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <Loader2 className={`w-8 h-8 animate-spin ${textSecondaryClass}`} />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className={`min-h-screen ${bgClass} flex flex-col items-center justify-center gap-4`}>
        <p className={textPrimaryClass}>{error || 'Post not found'}</p>
        <Button onClick={() => navigate('/feed')} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Feed
        </Button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass}`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${isLight ? 'bg-white' : 'bg-zinc-900'} border-b ${borderClass}`}>
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBack}
            className={textPrimaryClass}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className={`font-semibold ${textPrimaryClass}`}>Post</h1>
        </div>
      </div>

      {/* Post */}
      <div className="max-w-2xl mx-auto">
        <PostCard
          post={post}
          user={user}
          isLight={isLight}
          textPrimaryClass={textPrimaryClass}
          textSecondaryClass={textSecondaryClass}
          borderClass={borderClass}
          postCardBgClass={postCardBgClass}
          liveUsers={liveUsers}
          connectingToStream={connectingToStream}
          followingUsers={followingUsers}
          commentInputs={commentInputs}
          showAllComments={showAllComments}
          allComments={allComments}
          loadingComments={loadingComments}
          isPressing={isPressing}
          onNavigateProfile={(authorId) => navigate(`/profile/${authorId}`)}
          onPostMenuOpen={setPostMenuOpen}
          onSharePost={setSharePostOpen}
          onSavePost={handleSavePost}
          onLikeStart={handleShakaPointerDown}
          onLikeEnd={handleShakaPointerUp}
          onLikeLeave={handleShakaPointerLeave}
          onCommentChange={(postId, val) => setCommentInputs(prev => ({ ...prev, [postId]: val }))}
          onCommentSubmit={handleCommentSubmit}
          onLoadAllComments={loadAllComments}
          onHideAllComments={hideAllComments}
          onJoinLive={handleJoinLive}
          onIWasThere={handleIWasThere}
          onViewCollaborators={handleViewCollaborators}
          onFollowFromFeed={handleFollowFromFeed}
        />
        
        {/* Comments Section */}
        <div className={`${postCardBgClass} border-t ${borderClass} px-4 py-4`}>
          {/* Comment Input */}
          <div className="flex items-start gap-3 mb-4">
            {user?.avatar_url ? (
              <img 
                src={user.avatar_url} 
                alt="" 
                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                <span className={`text-sm ${textPrimaryClass}`}>{user?.full_name?.charAt(0) || '?'}</span>
              </div>
            )}
            <div className="flex-1">
              <CommentInputWithEmoji
                value={commentInputs[post?.id] || ''}
                onChange={(val) => setCommentInputs(prev => ({ ...prev, [post?.id]: val }))}
                onSubmit={() => post?.id && handleCommentSubmit(post.id)}
                placeholder="Add a comment..."
                isLight={isLight}
              />
            </div>
          </div>
          
          {/* Comments List */}
          <div className="space-y-3">
            {loadingComments[post?.id] ? (
              <div className="flex justify-center py-4">
                <Loader2 className={`w-5 h-5 animate-spin ${textSecondaryClass}`} />
              </div>
            ) : (
              <>
                {/* Show all comments */}
                {(allComments[post?.id] || post?.recent_comments || []).map((comment) => (
                  <div key={comment.id} className="flex items-start gap-3">
                    <div 
                      className="w-8 h-8 rounded-full bg-zinc-700 overflow-hidden flex-shrink-0 cursor-pointer"
                      onClick={() => navigate(`/profile/${comment.author_id}`)}
                    >
                      {comment.author_avatar ? (
                        <img src={comment.author_avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className={`w-full h-full flex items-center justify-center text-sm ${textPrimaryClass}`}>
                          {comment.author_name?.charAt(0)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span 
                          className={`font-semibold text-sm cursor-pointer hover:underline ${textPrimaryClass}`}
                          onClick={() => navigate(`/profile/${comment.author_id}`)}
                        >
                          {comment.author_name}
                        </span>
                        <span className={`text-xs ${textSecondaryClass}`}>
                          {formatTimeAgo(comment.created_at)}
                        </span>
                      </div>
                      <p className={`text-sm mt-0.5 ${textPrimaryClass}`}>
                        <CommentText text={comment.content} />
                      </p>
                    </div>
                  </div>
                ))}
                
                {/* No comments message */}
                {(allComments[post?.id] || post?.recent_comments || []).length === 0 && (
                  <p className={`text-center py-4 ${textSecondaryClass}`}>
                    No comments yet. Be the first to comment!
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Post Menu */}
      <PostMenu
        post={postMenuOpen}
        open={postMenuOpen !== null}
        onClose={() => setPostMenuOpen(null)}
        onPostUpdated={handlePostUpdated}
        onPostDeleted={handlePostDeleted}
        onIWasThere={() => postMenuOpen && handleIWasThere(postMenuOpen.id)}
        isFollowingAuthor={postMenuOpen ? followingUsers.has(postMenuOpen.author_id) : false}
        onFollow={handleFollowFromFeed}
        onUnfollow={handleUnfollowFromMenu}
      />

      {/* Share Modal */}
      <SharePostModal
        post={sharePostOpen}
        open={sharePostOpen !== null}
        onClose={() => setSharePostOpen(null)}
        isLight={isLight}
      />
      
      {/* Reaction Picker Overlay */}
      {showReactionPicker && (
        <div className="fixed inset-0 z-[200]">
          <div 
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowReactionPicker(false)}
          />
          <div 
            className="absolute bg-zinc-900/95 backdrop-blur-sm border border-zinc-600 rounded-full px-2 py-2 flex items-center shadow-2xl"
            style={{ 
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {VALID_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReaction(showReactionPicker, emoji)}
                className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-all duration-150 hover:bg-zinc-700/50 rounded-full active:scale-95 touch-manipulation"
                style={{ fontSize: '22px' }}
              >
                {emoji}
              </button>
            ))}
            <button 
              onClick={() => setShowReactionPicker(false)}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white border-l border-zinc-600 ml-1 hover:bg-zinc-700/50 rounded-full touch-manipulation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SinglePost;
