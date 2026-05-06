/**
 * SinglePost - View a single post with full details
 * Used when navigating directly to /post/:postId
 */
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import PostCard from './PostCard';
import PostMenu, { SharePostModal } from './PostMenu';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { REACTION_EMOJIS } from '../constants/emojis';
import { FeedPostSkeleton } from './ui/SkeletonVariants';
import { getFullUrl } from '../utils/media';


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

  // Dynamic Open Graph meta tags for social sharing / link previews
  useEffect(() => {
    if (!post) return;
    const ogTags = [];
    const setMeta = (property, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };
    const setName = (name, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };

    const authorName = post.author_full_name || post.author_username || 'Someone';
    const snippet = post.content ? post.content.substring(0, 120) : 'Check out this post on Raw Surf';
    const title = `${authorName} on Raw Surf`;
    const image = post.media_url ? getFullUrl(post.media_url) : null;
    const url = `${window.location.origin}/post/${post.id}`;

    document.title = title;
    setMeta('og:title', title);
    setMeta('og:description', snippet);
    setMeta('og:image', image);
    setMeta('og:url', url);
    setMeta('og:type', 'article');
    setMeta('og:site_name', 'Raw Surf');
    setName('twitter:card', image ? 'summary_large_image' : 'summary');
    setName('twitter:title', title);
    setName('twitter:description', snippet);
    setName('twitter:image', image);

    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, [post]);

  const fetchPost = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/posts/${postId}`, {
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
      const response = await apiClient.get(`/follows/${user.id}/following`);
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
  const inFlightRef = React.useRef(false); // Concurrency guard
  
  const VALID_REACTIONS = REACTION_EMOJIS;
  
  const handleShakaPointerDown = (postId, _e) => {
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

  const handleShakaPointerUp = async (postId, _e) => {
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
    
    // Concurrency guard
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    
    setShowReactionPicker(false);
    
    try {
      // ALWAYS use /reactions endpoint for ALL emojis (including shaka)
      const response = await apiClient.post(`/posts/${postId}/reactions`, { emoji });
      
      const action = response.data.action;
      
      // Sync server state
      setPost(prev => {
        const serverCount = response.data.likes_count;
        const newState = { ...prev };
        
        if (serverCount !== undefined) {
          newState.likes_count = serverCount;
        }
        
        if (action === 'added' || action === 'changed') {
          newState.liked = true;
          const filtered = (prev.reactions || []).filter(r => r.user_id !== user.id);
          newState.reactions = [...filtered, { user_id: user.id, emoji }];
        } else if (action === 'removed') {
          newState.liked = false;
          newState.reactions = (prev.reactions || []).filter(r => r.user_id !== user.id);
        }
        
        return newState;
      });
    } catch (err) {
      toast.error('Failed to add reaction');
    } finally {
      inFlightRef.current = false;
    }
  };

  // Double-tap to like handler for PostCard — toggles shaka on/off
  const handleDoubleTapLike = async (postId) => {
    if (!user?.id || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await apiClient.post(`/posts/${postId}/reactions`, { emoji: '\u{1F919}' });
      setPost(prev => {
        const newState = { ...prev };
        if (response.data?.likes_count !== undefined) newState.likes_count = response.data.likes_count;
        const action = response.data?.action;
        if (action === 'added' || action === 'changed') {
          newState.liked = true;
          const filtered = (prev.reactions || []).filter(r => r.user_id !== user.id);
          newState.reactions = [...filtered, { user_id: user.id, emoji: '\u{1F919}' }];
        } else if (action === 'removed') {
          newState.liked = false;
          newState.reactions = (prev.reactions || []).filter(r => r.user_id !== user.id);
        }
        return newState;
      });
    } catch { /* silent */ }
    finally { inFlightRef.current = false; }
  };

  // Save post
  const handleSavePost = async (postId, isSaved) => {
    if (!user?.id) {
      toast.error('Please log in to save posts');
      return;
    }
    
    try {
      if (isSaved) {
        await apiClient.delete(`/posts/${postId}/save?user_id=${user.id}`);
        setPost(prev => ({ ...prev, saved: false }));
        toast.success('Removed from saved');
      } else {
        await apiClient.post(`/posts/${postId}/save?user_id=${user.id}`);
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
      await apiClient.post(
        `/posts/${postId}/comments`,
        { content },
        { }
      );
      
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
      const response = await apiClient.get(`/posts/${postId}/comments`, {
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
      await apiClient.post(`/follows/${user.id}/follow/${userId}`);
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
      await apiClient.post(`/posts/${postId}/collaborators`, null, {
      });
      toast.success("Added you as a collaborator!");
      fetchPost(); // Refresh to show updated collaborators
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add collaboration');
    }
  };

  const handleViewCollaborators = (_postId) => {
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
      await apiClient.delete(`/follows/${user.id}/unfollow/${userId}`);
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
      <div className={`min-h-screen ${bgClass} p-4 max-w-2xl mx-auto`}>
        <FeedPostSkeleton />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className={`min-h-screen ${bgClass} flex flex-col items-center justify-center gap-4`}>
        <p className={textPrimaryClass}>{error || 'Post not found'}</p>
        <Button aria-label="Go back" onClick={() => navigate('/feed')} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Feed
        </Button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass}`}>
      {/* JSON-LD Structured Data for SEO */}
      {post && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.content ? post.content.substring(0, 110) : 'Post on Raw Surf',
          image: post.media_url ? getFullUrl(post.media_url) : undefined,
          datePublished: post.created_at,
          author: {
            '@type': 'Person',
            name: post.author_full_name || post.author_username || 'Raw Surf User',
          },
          publisher: {
            '@type': 'Organization',
            name: 'Raw Surf',
            url: window.location.origin,
          },
          mainEntityOfPage: `${window.location.origin}/post/${post.id}`,
        }) }} />
      )}
      {/* Header - sticky on mobile for easy back navigation, static on desktop (Instagram pattern) */}
      <div className={`sticky md:relative top-0 z-20 ${isLight ? 'bg-white/95 backdrop-blur-sm' : 'bg-zinc-900/95 backdrop-blur-sm'} border-b ${borderClass}`}>
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBack}
            className={textPrimaryClass}
            aria-label="Go back"
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
          onDoubleTapLike={handleDoubleTapLike}
        />
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
              aria-label="Close reaction picker"
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
