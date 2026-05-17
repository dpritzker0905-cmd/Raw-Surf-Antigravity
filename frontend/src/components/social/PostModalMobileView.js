/**
 * PostModalMobileView — Extracted from PostModal.js (v77)
 * Instagram-style fullscreen mobile post view with:
 * - Fullscreen image/video with double-tap shaka
 * - Bottom overlay with actions, caption, comments
 * - Emoji reaction picker
 * - Comment input with emoji picker
 */
import React, { useState, useRef, useCallback } from 'react';
import ReactionIcon from './ReactionIcon';
import { ImageCarousel } from './PostModalComponents';
import { useNavigate } from 'react-router-dom';
import { X, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Smile } from 'lucide-react';
import { RichText } from '../RichText';
import { SharePostModal } from '../PostMenu';
import PostMenu from '../PostMenu';
import { getFullUrl } from '../../utils/media';
import { formatTimeAgo } from '../../utils/formatTime';
import { REACTION_EMOJIS } from '../../constants/emojis';
import EmojiPicker from '../EmojiPicker';

var PostModalMobileView = ({
  post, onClose, user, isLight,
  // Theme tokens (mobile)
  m, t,
  // Media
  mediaItems,
  // Caption
  truncatedCaption,
  // State
  comments, commentInput, setCommentInput,
  submittingComment, liked, likeCount, saved,
  showReactionPicker, setShowReactionPicker,
  isPressing, userReaction,
  showDoubleTapHeart,
  showCommentEmoji, setShowCommentEmoji,
  // Handlers
  handleMobileTouchEnd,
  handleReactionStart, handleReactionEnd, handleReactionCancel,
  handleReaction, handleSave, handleComment, handleLikeComment,
  // Refs
  mobileCommentInputRef,
}) => {
  const navigate = useNavigate();
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);

  // Guard: track when the reaction picker was recently dismissed
  // to prevent the backdrop from closing the entire modal.
  const pickerJustDismissedRef = useRef(false);

  const handleBackdropClose = useCallback(() => {
    // Skip close if the reaction picker was just dismissed (touch residual)
    if (pickerJustDismissedRef.current) {
      pickerJustDismissedRef.current = false;
      return;
    }
    onClose();
  }, [onClose]);

  // Wrap setShowReactionPicker to set the guard when dismissing
  const dismissReactionPicker = useCallback(() => {
    pickerJustDismissedRef.current = true;
    setShowReactionPicker(false);
    // Reset guard after event loop settles
    setTimeout(() => { pickerJustDismissedRef.current = false; }, 300);
  }, [setShowReactionPicker]);

  return (
    <div 
      className={`fixed inset-0 z-[9999] ${m.containerBg}`}
      data-testid="post-modal-mobile"
    >
      {/* Tap-to-close backdrop - ONLY in the image area, not top bar or bottom */}
      <div 
        className="absolute inset-0 top-[60px] bottom-[200px]"
        onClick={handleBackdropClose}
        onTouchEnd={(e) => {
          // Only close if tapping the backdrop itself
          if (e.target === e.currentTarget) {
            handleBackdropClose();
          }
        }}
        style={{ zIndex: 1 }}
      />
      
      {/* Fullscreen Image/Video - with touch double-tap handler for mobile */}
      <div 
        className="absolute inset-0 flex items-center justify-center"
        style={{ zIndex: 2 }}
        onTouchEnd={handleMobileTouchEnd}
      >
        {/* Double-tap shaka animation (mobile) */}
        {showDoubleTapHeart && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <img loading="lazy" decoding="async" 
              src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
              alt="shaka"
              className="w-24 h-24 animate-ping"
              style={{ animationDuration: '0.6s', filter: 'drop-shadow(0 4px 12px rgba(234, 179, 8, 0.5))' }}
              draggable={false}
            />
          </div>
        )}
        <div>
          <ImageCarousel images={mediaItems} mediaType={post.media_type} />
        </div>
      </div>
      
      <div 
        className={`absolute top-0 left-0 right-0 ${m.topGradient} pb-12 pt-4`}
        style={{ zIndex: 10, pointerEvents: 'none' }}
      >
        <div className="flex items-center justify-between px-4 pt-2" style={{ pointerEvents: 'auto' }}>
          <button aria-label="Close"
            onClick={onClose}
            className={`p-2 ${m.textPrimary} touch-manipulation`}
            data-testid="close-post-modal"
          ><X className="w-6 h-6" />
          </button>
          
          {/* Author Info */}
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full ${m.avatarFallbackBg} overflow-hidden ring-2 ${m.avatarRing}`}>
              {post.author_avatar ? (
                <img loading="lazy" decoding="async" src={getFullUrl(post.author_avatar)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className={`w-full h-full flex items-center justify-center text-sm ${m.textPrimary}`}>
                  {post.author_name?.charAt(0)}
                </span>
              )}
            </div>
            <div>
              <p className={`font-semibold ${m.textPrimary} text-sm`}>{post.author_name}</p>
              {post.location && (
                <p className={`text-xs ${m.textSecondary}`}>{post.location}</p>
              )}
            </div>
          </div>
          
          <button 
            className={`p-3 ${m.textPrimary} touch-manipulation ${m.menuBtnHover} rounded-full`}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setPostMenuOpen(true);
            }}
            style={{ WebkitTapHighlightColor: 'transparent' }}
            data-testid="post-modal-menu-button"
          >
            <MoreHorizontal className="w-6 h-6" />
          </button>
        </div>
      </div>
      
      {/* Reaction Picker Overlay - highest z-index when visible */}
      {showReactionPicker && (
        <div className="fixed inset-0 z-[200]">
          {/* Backdrop to close picker */}
          <div 
            className="absolute inset-0 bg-black/30"
            onClick={(e) => { e.stopPropagation(); dismissReactionPicker(); }}
          />
          {/* Centered Picker - 2-row grid for mobile */}
          <div 
            className={`absolute ${t.reactionPickerBg} backdrop-blur-md border ${t.reactionPickerBorder} rounded-2xl px-3 py-3 shadow-2xl animate-in zoom-in-95 duration-200`}
            style={{ 
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: `${Math.min(window.innerWidth - 24, 300)}px`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={(e) => { e.stopPropagation(); dismissReactionPicker(); }}
              className={`absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center ${t.textMuted} ${m.pickerCloseHover} rounded-full touch-manipulation`}
              style={{ zIndex: 1 }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="grid grid-cols-5 gap-1 justify-items-center">
              {REACTION_EMOJIS.map((emoji, _index) => (
                <button
                  key={emoji}
                  onClick={(e) => { e.stopPropagation(); pickerJustDismissedRef.current = true; handleReaction(emoji); setTimeout(() => { pickerJustDismissedRef.current = false; }, 300); }}
                  className={`w-11 h-11 flex items-center justify-center rounded-full ${t.reactionHover} active:scale-90 transition-transform duration-100 touch-manipulation`}
                  style={{ fontSize: '24px' }}
                  data-testid={`post-reaction-${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Bottom Overlay - Caption & Actions - highest z-index for touch */}
      <div 
        className={`absolute bottom-0 left-0 right-0 ${m.bottomGradient} pt-20 pb-6`}
        style={{ zIndex: 50 }}
      >
        {/* Actions Row */}
        <div className="flex items-center justify-between px-4 mb-3">
          <div className="flex items-center gap-1">
            {/* Shaka Reaction Button - copy exact pattern from PostCard */}
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                handleReactionStart();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                handleReactionEnd();
              }}
              onPointerCancel={handleReactionCancel}
              onPointerLeave={handleReactionCancel}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
              }}
              className={`transition-all duration-300 select-none transform touch-manipulation ${isPressing ? 'scale-125' : 'hover:scale-105'}`}
              style={{
                transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
              data-testid="reaction-button"
            >
              <ReactionIcon post={post} userId={user?.id} isLiked={liked} isPressing={isPressing} userReactionOverride={userReaction} />
            </button>
            
            {/* Like Count */}
            {likeCount > 0 && (
              <span className={`${m.textPrimary} font-semibold text-sm ml-1`}>
                {likeCount.toLocaleString()}
              </span>
            )}
            
            <button
              className={`p-3 ${m.iconColor} ml-2`}
              onClick={(e) => {
                e.stopPropagation();
                setShowComments(true);
                // Focus comment input after expanding
                setTimeout(() => {
                  if (mobileCommentInputRef.current) mobileCommentInputRef.current.focus();
                }, 100);
              }}
            >
              <MessageCircle className="w-7 h-7" />
            </button>
            <button aria-label="Send" 
              className={`p-3 ${m.iconColor} touch-manipulation`}
              onClick={() => setShareModalOpen(true)}
            >
              <Send className="w-7 h-7" />
            </button>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSave();
            }}
            className={`p-3 active:scale-95 touch-manipulation select-none ${saved ? m.savedColor : m.unsavedColor}`}
            style={{ 
              WebkitTapHighlightColor: 'transparent'
            }}
            data-testid="save-button"
          >
            <Bookmark 
              className="w-7 h-7"
              fill={saved ? 'currentColor' : 'none'}
            />
          </button>
        </div>
        
        {/* Caption - Truncated, expand on tap */}
        {post.caption && (
          <div 
            className="px-4 mb-2"
            onClick={() => setCaptionExpanded(!captionExpanded)}
            style={{ pointerEvents: 'auto' }}
          >
            <p className={`${m.textCaption} text-sm`}>
              <span className={`font-semibold mr-1 cursor-pointer hover:underline ${m.textPrimary}`} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${post.author_id}`); }}>{post.author_name}</span>
              <RichText 
                text={captionExpanded ? post.caption : truncatedCaption}
                hashtagClassName="text-cyan-400 hover:text-cyan-300 cursor-pointer"
                mentionClassName="text-blue-400 hover:text-blue-300 cursor-pointer"
              />
            </p>
            {post.caption?.length > 100 && !captionExpanded && (
              <button className={`${m.moreBtn} text-sm mt-1`}>more</button>
            )}
          </div>
        )}
        
        {/* Comments preview */}
        {comments.length > 0 && !showComments && (
          <button 
            className={`${m.moreBtn} text-sm px-4 mb-2`} 
            style={{ pointerEvents: 'auto' }}
            onClick={() => setShowComments(true)}
          >
            View all {comments.length} comment{comments.length !== 1 ? 's' : ''}
          </button>
        )}
        
        {/* Expanded Comments Section */}
        {showComments && (
          <div className="px-4 mb-2 max-h-40 overflow-y-auto" style={{ pointerEvents: 'auto' }}>
            <button 
              className={`${m.moreBtn} text-sm mb-2`}
              onClick={() => setShowComments(false)}
            >
              Hide comments
            </button>
            {comments.map((comment) => {
              const isLiked = comment.reactions?.some(r => r.user_id === user?.id);
              return (
                <div key={comment.id} className="mb-3 flex items-start gap-2">
                  <div className="flex-1">
                    <p className={`${m.commentAuthor} text-sm`}>
                      <span className="font-semibold mr-1 cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>{comment.author_name}</span>
                      <span className={m.commentText}>{comment.content}</span>
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`${m.textMuted} text-xs`}>{formatTimeAgo(comment.created_at)}</span>
                      {(comment.likes_count > 0 || comment.reactions?.length > 0) && (
                        <span className={`${m.textMuted} text-xs`}>
                          {comment.likes_count || comment.reactions?.length || 0} likes
                        </span>
                      )}
                      <button 
                        className={`${m.textMuted} text-xs font-semibold`}
                        onClick={() => {/* Reply functionality */}}
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                  <button 
                    className="p-1 touch-manipulation"
                    onClick={() => handleLikeComment(comment.id)}
                  >
                    <Heart 
                      className={`w-4 h-4 ${isLiked ? 'text-red-500 fill-red-500' : m.heartInactive}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        
        {/* Comment Input with Emoji Picker */}
        <div className="relative px-4 pb-2 flex items-center gap-2" style={{ pointerEvents: 'auto' }}>
          <button aria-label="Emoji"
            aria-expanded={showCommentEmoji} onClick={() => setShowCommentEmoji(!showCommentEmoji)}
            className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
              showCommentEmoji ? m.emojiActive : m.emojiInactive
            }`}
          >
            <Smile className="w-5 h-5" />
          </button>
          <input aria-label="Add a comment..."
            ref={mobileCommentInputRef}
            type="text"
            placeholder="Add a comment..."
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commentInput.trim()) {
                handleComment();
                setShowCommentEmoji(false);
              }
            }}
            className={`flex-1 bg-transparent ${m.inputText} text-sm ${m.inputPlaceholder} outline-none`}
          />
          {commentInput.trim() && (
            <button
              onClick={() => { handleComment(); setShowCommentEmoji(false); }}
              disabled={submittingComment}
              className="text-cyan-400 font-semibold text-sm"
            >
              {submittingComment ? '...' : 'Post'}
            </button>
          )}
          <EmojiPicker
            isOpen={showCommentEmoji}
            onClose={() => setShowCommentEmoji(false)}
            onSelect={(emoji) => {
              setCommentInput(prev => prev + emoji);
            }}
            position="above"
          />
        </div>
        
        {/* Timestamp */}
        <p className={`${m.textMuted} text-xs uppercase px-4 pb-4`}>
          {formatTimeAgo(post.created_at)}
        </p>
      </div>
      
      {/* Share Modal */}
      <SharePostModal
        post={post}
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        isLight={isLight}
      />
      
      {/* Post Menu */}
      <PostMenu
        post={post}
        open={postMenuOpen}
        onClose={() => setPostMenuOpen(false)}
        isLight={isLight}
        onPostUpdated={(_updatedPost) => {
          // Handle post update if needed
        }}
        onPostDeleted={() => {
          onClose();
        }}
      />
    </div>
  );
};

export default PostModalMobileView;
