import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../lib/apiClient';
import { CommentText } from '../RichText';
import { Heart, MoreHorizontal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ReplyItem from './ReplyItem';
import { formatTimeAgo } from '../../utils/formatTime';
import { REACTION_EMOJIS } from '../../constants/emojis';

const CommentWithReaction = ({ 
  comment, 
  userId, 
  postId,
  textPrimaryClass, 
  textSecondaryClass, 
  isLight,
  onReplyAdded,
  onCommentUpdated
}) => {
  const navigate = useNavigate();
  const [reactionCount, setReactionCount] = useState(comment.reaction_count || 0);
  const [viewerReaction, setViewerReaction] = useState(comment.viewer_reaction || null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [localReplies, setLocalReplies] = useState(comment.replies || []);
  const [showReplies, setShowReplies] = useState(true);
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [localContent, setLocalContent] = useState(comment.content);
  const [localIsEdited, setLocalIsEdited] = useState(comment.is_edited || false);
  const [showMenu, setShowMenu] = useState(false);

  const handleReaction = async (emoji = '🤙') => {
    if (!userId) {
      toast.error('Please log in to react');
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.post(
        `/comments/${comment.id}/reactions`,
        { emoji }
      );
      
      if (response.data.action === 'added') {
        setReactionCount(prev => prev + 1);
        setViewerReaction(emoji);
      } else if (response.data.action === 'removed') {
        setReactionCount(prev => Math.max(0, prev - 1));
        setViewerReaction(null);
      } else if (response.data.action === 'updated') {
        setViewerReaction(emoji);
      }
      
      setShowReactionPicker(false);
    } catch (err) {
      toast.error('Failed to react');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReply = async () => {
    if (!replyContent.trim()) return;
    
    if (!userId) {
      toast.error('Please log in to reply');
      return;
    }
    
    setSubmittingReply(true);
    try {
      const response = await apiClient.post(
        `/posts/${postId}/comments`,
        { 
          content: replyContent.trim(),
          parent_id: comment.id
        }
      );
      
      const newReply = {
        ...response.data,
        reaction_count: 0,
        viewer_reaction: null
      };
      setLocalReplies(prev => [...prev, newReply]);
      setReplyContent('');
      setShowReplyInput(false);
      setShowReplies(true);
      toast.success('Reply added');
      
      if (onReplyAdded) onReplyAdded();
    } catch (err) {
      toast.error('Failed to add reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim() || editContent.trim() === comment.content) {
      setIsEditing(false);
      setEditContent(localContent);
      return;
    }
    
    setSavingEdit(true);
    try {
      const response = await apiClient.put(
        `/posts/${postId}/comments/${comment.id}`,
        { content: editContent.trim() }
      );
      
      setLocalContent(response.data.content);
      setLocalIsEdited(true);
      setIsEditing(false);
      toast.success('Comment updated');
      
      if (onCommentUpdated) onCommentUpdated(comment.id, response.data);
    } catch (err) {
      toast.error('Failed to update comment');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(localContent);
  };



  const replyCount = localReplies.length;
  const isOwner = userId && comment.author_id === userId;

  return (
    <div data-testid={`comment-${comment.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <textarea aria-label="Text input"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className={`w-full p-2 rounded-lg text-sm resize-none ${
                  isLight 
                    ? 'bg-gray-100 border border-gray-200 text-gray-900' 
                    : 'bg-zinc-800 border border-zinc-700 text-white'
                } focus:outline-none focus:ring-1 focus:ring-cyan-500`}
                rows={2}
                autoFocus
                data-testid={`edit-comment-input-${comment.id}`}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className={`px-2 py-1 text-xs rounded ${
                    isLight ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 hover:bg-zinc-700'
                  }`}
                  data-testid={`cancel-edit-${comment.id}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editContent.trim()}
                  className={`px-2 py-1 text-xs rounded bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50`}
                  data-testid={`save-edit-${comment.id}`}
                >
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className={`font-medium ${textPrimaryClass} text-sm cursor-pointer hover:underline`}
                onClick={(e) => { e.stopPropagation(); navigate(`/profile/${comment.author_id}`); }}>
                {comment.author_username ? `@${comment.author_username}` : comment.author_name}
              </span>
              <CommentText 
                text={localContent}
                className={`${textSecondaryClass} text-sm ml-1`}
              />
              {localIsEdited && (
                <span className={`${textSecondaryClass} text-xs ml-1 opacity-60`}>(edited)</span>
              )}
            </>
          )}
        </div>
        
        {/* Edit/Delete menu for owner */}
        {isOwner && !isEditing && (
          <div className="relative">
            <button aria-label="More options"
              aria-expanded={showMenu} onClick={() => setShowMenu(!showMenu)}
              className={`p-1 rounded ${textSecondaryClass} hover:opacity-80`}
              data-testid={`comment-menu-${comment.id}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className={`absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg z-50 min-w-[100px] ${
                  isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'
                }`}>
                  <button
                    onClick={() => { setIsEditing(true); setShowMenu(false); }}
                    className={`w-full px-3 py-1.5 text-left text-sm ${
                      isLight ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-zinc-700 text-gray-200'
                    }`}
                    data-testid={`edit-comment-btn-${comment.id}`}
                  >
                    Edit
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      {/* Comment actions row */}
      <div className={`flex items-center gap-3 mt-1 ${textSecondaryClass} text-xs`}>
        <span className="opacity-70">{formatTimeAgo(comment.created_at)}</span>
        
        {reactionCount > 0 && (
          <span className="font-medium">{reactionCount} like{reactionCount !== 1 ? 's' : ''}</span>
        )}
        
        <button 
          aria-expanded={showReplyInput} onClick={() => setShowReplyInput(!showReplyInput)}
          className="hover:opacity-80 font-medium"
          data-testid={`reply-btn-${comment.id}`}
        >
          Reply
        </button>
        
        <div className="relative ml-auto">
          <button
            onClick={() => viewerReaction ? handleReaction(viewerReaction) : handleReaction('🤙')}
            onContextMenu={(e) => { e.preventDefault(); setShowReactionPicker(true); }}
            disabled={loading}
            className={`p-1 rounded transition-all ${
              viewerReaction ? 'text-red-500' : `${textSecondaryClass} hover:text-red-400`
            } ${loading ? 'opacity-50' : ''}`}
            data-testid={`comment-like-${comment.id}`}
          >
            {viewerReaction && viewerReaction !== '🤙' ? (
              <span className="text-sm">{viewerReaction}</span>
            ) : (
              <Heart className="w-3.5 h-3.5" fill={viewerReaction ? 'currentColor' : 'none'} />
            )}
          </button>
          
          {showReactionPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowReactionPicker(false)} />
              <div 
                className={`absolute bottom-full right-0 mb-1 flex gap-1 p-1.5 rounded-full shadow-lg z-50 ${
                  isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'
                }`}
                style={{ maxWidth: 'calc(100vw - 32px)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
              >
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className={`w-7 h-7 flex-shrink-0 flex items-center justify-center text-base hover:scale-125 transition-transform rounded-full ${
                      viewerReaction === emoji ? isLight ? 'bg-blue-100' : 'bg-blue-900/30' : ''
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Reply Input */}
      {showReplyInput && (
        <div className="mt-2 ml-6 flex gap-2" data-testid={`reply-input-container-${comment.id}`}>
          <input aria-label="Reply to ${comment.author_name}..."
            type="text"
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder={`Reply to ${comment.author_name}...`}
            className={`flex-1 text-sm px-3 py-1.5 rounded-full ${
              isLight ? 'bg-gray-100 border border-gray-200 text-gray-900' : 'bg-zinc-800 border border-zinc-700 text-white'
            } focus:outline-none focus:ring-1 focus:ring-blue-500`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && replyContent.trim()) {
                e.preventDefault();
                handleSubmitReply();
              }
            }}
            data-testid={`reply-input-${comment.id}`}
          />
          <button aria-label="Loader2"
            onClick={handleSubmitReply}
            disabled={!replyContent.trim() || submittingReply}
            className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
              replyContent.trim() ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-zinc-700 text-gray-400 cursor-not-allowed'
            }`}
            data-testid={`reply-submit-${comment.id}`}
          >
            {submittingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}
          </button>
        </div>
      )}
      
      {/* View/Hide Replies Toggle */}
      {replyCount > 0 && !showReplies && (
        <button aria-label="span"
          onClick={() => setShowReplies(true)}
          className={`mt-2 ml-6 text-xs ${textSecondaryClass} hover:opacity-80 flex items-center gap-1`}
        >
          <span className="w-6 h-px bg-current opacity-50" />
          View {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </button>
      )}
      
      {/* Replies - Use simple ReplyItem instead of recursive CommentWithReaction */}
      {showReplies && localReplies.length > 0 && (
        <div className="mt-2 space-y-2">
          {localReplies.length > 0 && (
            <button aria-label="span"
              onClick={() => setShowReplies(false)}
              className={`ml-6 text-xs ${textSecondaryClass} hover:opacity-80 flex items-center gap-1`}
            >
              <span className="w-6 h-px bg-current opacity-50" />
              Hide replies
            </button>
          )}
          {localReplies.map((reply) => (
            <ReplyItem
              key={reply.id}
              reply={reply}
              userId={userId}
              postId={postId}
              textPrimaryClass={textPrimaryClass}
              textSecondaryClass={textSecondaryClass}
              isLight={isLight}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentWithReaction;
