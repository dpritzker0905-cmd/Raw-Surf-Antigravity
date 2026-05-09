/**
 * PostCard - Extracted from Feed.js for better maintainability
 * Renders a single post in the feed with all interactions
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import SessionLogHeader from './SessionLogHeader';
import { CommentInputWithEmoji } from './EmojiPicker';
import WhoReactedModal from './WhoReactedModal';
import SessionJoinCard from './SessionJoinCard';
import { RichText } from './RichText';
import PostCardMedia from './social/PostCardMedia';
import { MapPin, MessageCircle, Send, Bookmark, MoreHorizontal, Loader2, Radio, ShoppingBag, ChevronRight } from 'lucide-react';
import { getFullUrl } from '../utils/media';
import { formatTimeAgo } from '../utils/formatTime';



// Comment reaction emojis - imported from centralized constants/emojis.js

/**
 * ReplyItem - Simpler component for reply rendering (non-recursive)
 */
// ReplyItem extracted to ./social/ReplyItem.js

/**
 * CommentWithReaction - Individual comment with like/reaction button and reply support
 */
import CommentWithReaction from './social/CommentWithReaction';
import RoleBadge from './social/RoleBadge';
import ReactionIcon from './social/ReactionIcon';




const PostCard = ({
  post,
  user,
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  borderClass,
  postCardBgClass,
  liveUsers,
  connectingToStream,
  followingUsers,
  commentInputs,
  showAllComments,
  allComments,
  loadingComments,
  isPressing,  // Track if shaka is being pressed for visual feedback
  onNavigateProfile,
  onPostMenuOpen,
  onSharePost,
  onSavePost,
  onLikeStart,
  onLikeEnd,
  onLikeLeave,
  onLikeClick,
  onCommentChange,
  onCommentSubmit,
  onLoadAllComments,
  onHideAllComments,
  onJoinLive,
  onIWasThere,
  onViewCollaborators,
  onFollowFromFeed,
  onImageClick,  // Opens Instagram-style modal
  onDoubleTapLike  // Direct like function for double-tap (bypasses pointer events)
}) => {
  const navigate = useNavigate();
  
  // Who Reacted Modal state
  const [showWhoReacted, setShowWhoReacted] = useState(false);
  const [detailedReactions, setDetailedReactions] = useState([]);
  const [loadingReactions, setLoadingReactions] = useState(false);

  if (!post) return null;
  
  // Fetch detailed reactions when modal opens
  const handleLikesCountClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowWhoReacted(true);
    
    // Fetch detailed data
    setLoadingReactions(true);
    try {
      const response = await apiClient.get(`/posts/${post.id}/reactions-detail`);
      // Combine likers and reactors for full list
      const allReactors = [
        ...(response.data.all_reactors || []).map(r => ({
          user_id: r.user_id,
          user_name: r.full_name,
          avatar_url: r.avatar_url,
          user_role: r.role,
          emoji: r.emoji
        })),
        ...(response.data.likers || []).map(l => ({
          user_id: l.user_id,
          user_name: l.full_name,
          avatar_url: l.avatar_url,
          user_role: l.role,
          emoji: '\u{1F919}'
        }))
      ];
      setDetailedReactions(allReactors);
    } catch (err) {
      // Fallback to inline data
      setDetailedReactions(post.reactions || []);
    } finally {
      setLoadingReactions(false);
    }
  };


  return (
    <>
    <article 
      className={`${postCardBgClass} transition-colors duration-300 ${
        post.is_check_in ? 'border-l-4 border-l-cyan-500' : ''
      }`} 
      data-testid={`post-card-${post.id}`}
    >
      {/* Check-In Banner */}
      {post.is_check_in && (
        <div className="bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-transparent px-4 py-2 flex items-center gap-2">
          <div className="w-6 h-6 bg-cyan-500 rounded-full flex items-center justify-center">
            <MapPin className="w-3 h-3 text-white" />
          </div>
          <span className="text-cyan-400 font-medium text-sm">Jumped In</span>
          {post.check_in_spot_name && (
            <span className="text-zinc-400 text-sm">at {post.check_in_spot_name}</span>
          )}
          {post.check_in_conditions && (
            <span className="text-zinc-500 text-xs ml-auto">{post.check_in_conditions}</span>
          )}
        </div>
      )}
      
      {/* Post Header */}
      <div className="flex items-center justify-between p-4">
        <div 
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => onNavigateProfile(post.author_id)}
          data-testid={`post-author-${post.id}`}
        >
          {/* Avatar with LIVE ring indicator */}
          <div className="relative">
            <div className={`${liveUsers.includes(post.author_id) ? 'p-[2px] rounded-full bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-pulse' : ''}`}>
              <div className={`w-10 h-10 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} ${liveUsers.includes(post.author_id) ? 'border-2 border-black' : ''} flex items-center justify-center overflow-hidden`}>
                {post.author_avatar ? (
                  <img loading="lazy" decoding="async" 
                    src={getFullUrl(post.author_avatar)} 
                    alt={post.author_name} 
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <span className={textSecondaryClass + " font-medium"}>
                    {post.author_name?.charAt(0) || '?'}
                  </span>
                )}
              </div>
            </div>
            {/* LIVE badge */}
            {liveUsers.includes(post.author_id) && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded uppercase">
                LIVE
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              {/* Instagram-style: username primary, real name secondary */}
              {post.author_username ? (
                <span className={`font-semibold ${textPrimaryClass} hover:underline`}>@{post.author_username}</span>
              ) : (
                <span className={`font-medium ${textPrimaryClass} hover:underline`}>{post.author_name || 'Anonymous'}</span>
              )}
              {post.author_role && <RoleBadge role={post.author_role} />}
              {/* Join Live button with connecting pulse */}
              {liveUsers.includes(post.author_id) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onJoinLive(post.author_id, post.author_name, post.author_avatar);
                  }}
                  disabled={connectingToStream === post.author_id}
                  className={`ml-2 flex items-center gap-1 px-2 py-0.5 text-white text-xs font-bold rounded-full transition-all ${
                    connectingToStream === post.author_id 
                      ? 'bg-red-400 scale-105 animate-[pulse_0.5s_ease-in-out_infinite]' 
                      : 'bg-red-500 hover:bg-red-600 animate-pulse'
                  }`}
                  data-testid={`join-live-${post.id}`}
                >
                  <Radio className={`w-3 h-3 ${connectingToStream === post.author_id ? 'animate-spin' : ''}`} />
                  {connectingToStream === post.author_id ? 'Joining...' : 'Join'}
                </button>
              )}
            </div>
          {/* Timestamp + location row */}
          <p className={`text-xs ${textSecondaryClass} flex items-center gap-1`}>
            {post.created_at && (
              <span>{formatTimeAgo(post.created_at)}</span>
            )}
            {post.location && post.created_at && (
              <span className="opacity-50">-</span>
            )}
            {post.location && (
              <span>{post.location}</span>
            )}
          </p>
        </div>
        </div>
        <button aria-label="More options" 
          onClick={() => onPostMenuOpen(post)}
          className={`${textSecondaryClass} hover:${textPrimaryClass} p-2`}
          data-testid={`post-menu-btn-${post.id}`}
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Shop This Photographer's Work CTA - for verified photographers */}
      {['Photographer', 'Approved Pro'].includes(post.author_role) && post.author_id !== user?.id && (
        <div className="px-4 py-2 border-b border-border/50">
          <button aria-label="Shopping Bag"
            onClick={() => navigate(`/photographer/${post.author_id}/gallery`)}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-gradient-to-r from-amber-500/10 to-yellow-500/10 hover:from-amber-500/20 hover:to-yellow-500/20 border border-amber-500/30 transition-all group"
            data-testid={`shop-photographer-${post.id}`}
          >
            <ShoppingBag className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Shop {post.author_username ? `@${post.author_username}` : post.author_name}'s Gallery
            </span>
            <ChevronRight className="w-4 h-4 text-amber-500/70" />
          </button>
        </div>
      )}

      {/* Post Image/Video/Carousel — delegated to PostCardMedia */}
      <PostCardMedia
        post={post}
        user={user}
        isLight={isLight}
        onImageClick={onImageClick}
        onDoubleTapLike={onDoubleTapLike}
      />

      {/* Session Log Header - "Strava for Surfing" metadata */}
      {(post.session_date || post.session_start_time || post.location || post.spot || 
        post.wave_height_ft || post.collaborators?.length > 0) && (
        <div className="px-4 pt-2">
          <SessionLogHeader
            post={post}
            collaborators={post.collaborators || []}
            currentUserId={user?.id}
            isOwnPost={post.author_id === user?.id}
            onIWasThere={() => onIWasThere(post.id)}
            onViewCollaborators={() => onViewCollaborators(post.id)}
            showBookCTA={['Photographer', 'Approved Pro'].includes(post.author_role) && post.author_id !== user?.id}
            isFollowingPhotographer={followingUsers.has(post.author_id)}
            photographerId={post.author_id}
            photographerName={post.author_name}
            onFollowPhotographer={onFollowFromFeed}
            onBookPhotographer={(photographerId) => navigate(`/profile/${photographerId}`)}
          />
        </div>
      )}

      {/* Post Actions */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4 relative">
            {/* Shaka Button with count next to it - Instagram style */}
            <div className="flex items-center gap-1.5">
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  onLikeStart(post.id, e);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  onLikeEnd(post.id, e);
                }}
                onClick={(e) => {
                  // Fallback for mobile browsers where pointerUp may not fire
                  e.preventDefault();
                  e.stopPropagation();
                  if (onLikeClick) onLikeClick(post.id);
                }}
                onPointerCancel={() => onLikeLeave()}
                onPointerLeave={() => onLikeLeave()}
                onContextMenu={(e) => {
                  // Prevent browser context menu on long-press
                  e.preventDefault();
                  e.stopPropagation();
                  return false;
                }}
                className={`transition-all duration-300 select-none transform ${
                  post.liked || post.user_reaction || isPressing
                    ? 'scale-110' 
                    : 'hover:scale-105'
                }`}
                style={{
                  transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation' // Allow taps and scrolling, block double-tap zoom
                }}
                data-testid={`like-btn-${post.id}`}
                title="Tap to like, hold for reactions"
              >
                <ReactionIcon post={post} userId={user?.id} isLiked={post.liked} isPressing={isPressing} />
              </button>
              {/* Count next to shaka - Click to see who reacted */}
              {!post.hide_like_count && post.likes_count > 0 && (
                <button
                  onClick={handleLikesCountClick}
                  className={`font-semibold ${textPrimaryClass} text-sm hover:opacity-70 transition-opacity select-none cursor-pointer`}
                  data-testid={`likes-count-${post.id}`}
                  title="Click to see who reacted"
                >
                  {post.likes_count.toLocaleString()}
                </button>
              )}
            </div>
            {/* Comment button - hidden if comments are disabled */}
            {!post.comments_disabled && (
              <button aria-label="Message" 
                className={`${textPrimaryClass} hover:${textSecondaryClass} transition-colors`}
                onClick={() => {
                  const input = document.querySelector(`[data-testid="comment-input-${post.id}"]`);
                  if (input) input.focus();
                }}
                data-testid={`comment-btn-${post.id}`}
              >
                <MessageCircle className="w-6 h-6" />
              </button>
            )}
            <button aria-label="Send" 
              className={`${textPrimaryClass} hover:${textSecondaryClass} transition-colors`}
              onClick={() => onSharePost(post)}
              data-testid={`share-btn-${post.id}`}
            >
              <Send className="w-6 h-6" />
            </button>
          </div>
          <button aria-label="Bookmark" 
            onClick={(e) => {
              e.preventDefault();
              onSavePost(post.id, post.saved);
            }}
            className={`transition-colors touch-manipulation ${post.saved ? 'text-yellow-400' : `${textPrimaryClass} hover:${textSecondaryClass}`}`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
            data-testid={`save-btn-${post.id}`}
          >
            <Bookmark className="w-6 h-6" fill={post.saved ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Caption */}
        <p className={textPrimaryClass}>
          <span 
            className="font-medium cursor-pointer hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/profile/${post.author_id}`);
            }}
          >
            {post.author_name}
          </span>{' '}
          <RichText 
            text={post.caption}
            className={textSecondaryClass}
            maxLength={150}
            showExpand={true}
          />
        </p>

        {/* Session Join Card - Show if post is a shared session with open spots */}
        {post.is_session_log && post.session_invite_open && post.session_spots_left > 0 && (
          <SessionJoinCard
            post={post}
            user={user}
            isLight={isLight}
          />
        )}

        {/* Comments Section */}
        <div className="mt-3 space-y-2">
          {/* View all comments link */}
          {(post.comments_count > 0) && !showAllComments[post.id] && (
            <button aria-label="Loader2" 
              onClick={() => onLoadAllComments(post.id)}
              className={`${textSecondaryClass} text-sm hover:opacity-80`}
              data-testid={`view-comments-${post.id}`}
            >
              {loadingComments[post.id] ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                </span>
              ) : (
                `View all ${post.comments_count} comment${post.comments_count !== 1 ? 's' : ''}`
              )}
            </button>
          )}

          {/* Show all comments when expanded */}
          {showAllComments[post.id] && allComments[post.id] && (
            <div className="space-y-3">
              <button 
                onClick={() => onHideAllComments(post.id)}
                className={`${textSecondaryClass} text-sm hover:opacity-80`}
              >
                Hide comments
              </button>
              {allComments[post.id].map((comment) => (
                <CommentWithReaction
                  key={comment.id}
                  comment={comment}
                  userId={user?.id}
                  postId={post.id}
                  textPrimaryClass={textPrimaryClass}
                  textSecondaryClass={textSecondaryClass}
                  isLight={isLight}
                />
              ))}
            </div>
          )}

          {/* Show recent comments inline (when not expanded) - click to expand */}
          {!showAllComments[post.id] && post.recent_comments && post.recent_comments.length > 0 && (
            <div className="space-y-1">
              {post.recent_comments.map((comment) => (
                <div 
                  key={comment.id} 
                  className="flex gap-2 cursor-pointer hover:opacity-80"
                  onClick={() => onLoadAllComments(post.id)}
                  title="Click to view all comments and reply"
                >
                  <span className={`font-medium ${textPrimaryClass} text-sm cursor-pointer hover:underline`}
                    onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>
                    {comment.author_name}
                  </span>
                  <span className={`${textSecondaryClass} text-sm flex-1 truncate`}>{comment.content}</span>
                </div>
              ))}
              <button 
                onClick={() => onLoadAllComments(post.id)}
                className={`${textSecondaryClass} text-xs hover:opacity-80 mt-1`}
              >
                Click to reply...
              </button>
            </div>
          )}
        </div>

        {/* Comment Input with Emoji Picker - hidden if comments are disabled */}
        {!post.comments_disabled && (
          <div className="mt-3">
            <CommentInputWithEmoji
              value={commentInputs[post.id] || ''}
              onChange={(val) => onCommentChange(post.id, val)}
              onSubmit={() => onCommentSubmit(post.id)}
              placeholder="Add a comment..."
              postId={post.id}
              textClass={textSecondaryClass}
              borderClass={borderClass}
            />
          </div>
        )}
        
        {/* Comments disabled message */}
        {post.comments_disabled && (
          <p className={`text-xs ${textSecondaryClass} mt-3 italic`}>
            Comments are turned off for this post.
          </p>
        )}
      </div>
    </article>
    
    {/* Who Reacted Modal */}
    <WhoReactedModal
      isOpen={showWhoReacted}
      onClose={() => setShowWhoReacted(false)}
      reactions={detailedReactions.length > 0 ? detailedReactions : (post.reactions || [])}
      postAuthorName={post.author_name}
      loading={loadingReactions}
    />
    </>
  );
};

export default React.memo(PostCard);
