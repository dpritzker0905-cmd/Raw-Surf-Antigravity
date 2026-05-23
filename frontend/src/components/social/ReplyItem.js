/**
 * ReplyItem.js - Individual reply/comment display component.
 * Extracted from PostCard.js to reduce God component size.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import { CommentText } from '../RichText';
import { formatTimeAgo } from '../../utils/formatTime';
import { getFullUrl } from '../../utils/media';

const ReplyItem = ({ reply, userId, _postId, textPrimaryClass, textSecondaryClass, _isLight }) => {
  const navigate = useNavigate();
  const [reactionCount, setReactionCount] = useState(reply.reaction_count || 0);
  const [viewerReaction, setViewerReaction] = useState(reply.viewer_reaction || null);
  const [loading, setLoading] = useState(false);

 const handleReaction = async (emoji = '=') => {
    if (!userId) {
      toast.error('Please log in to react');
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.post(
        `/comments/${reply.id}/reactions`,
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
    } catch (err) {
      toast.error('Failed to react');
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="ml-6 pl-3 border-l-2 border-zinc-700/50">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className={`font-medium ${textPrimaryClass} text-sm cursor-pointer hover:underline`}
            onClick={(e) => { e.stopPropagation(); navigate(`/profile/${reply.author_id}`); }}>
            {reply.author_name}
          </span>
          <CommentText 
            text={reply.content}
            className={`${textSecondaryClass} text-sm ml-1`}
          />
          {reply.media_url && (
            <div className="mt-2 max-w-[240px] rounded-lg overflow-hidden border border-white/10 shadow-md bg-black/40">
              {reply.media_type === 'video' ? (
                <video 
                  src={getFullUrl(reply.media_url)} 
                  controls 
                  className="w-full max-h-[160px] object-contain bg-black animate-in fade-in duration-200"
                  playsInline
                />
              ) : (
                <img 
                  src={getFullUrl(reply.media_url)} 
                  alt="Reply attachment" 
                  className="w-full max-h-[160px] object-contain cursor-pointer hover:opacity-90 transition-opacity animate-in fade-in duration-200"
                  onClick={() => window.open(getFullUrl(reply.media_url), '_blank')}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <div className={`flex items-center gap-3 mt-1 ${textSecondaryClass} text-xs`}>
        <span className="opacity-70">{formatTimeAgo(reply.created_at)}</span>
        {reactionCount > 0 && (
          <span className="font-medium">{reactionCount} like{reactionCount !== 1 ? 's' : ''}</span>
        )}
        <button aria-label="Like"
 onClick={() => handleReaction('=')}
          disabled={loading}
          className={`ml-auto p-1 rounded transition-all ${
            viewerReaction ? 'text-red-500' : `${textSecondaryClass} hover:text-red-400`
          }`}
        >
          <Heart className="w-3.5 h-3.5" fill={viewerReaction ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
};

export default ReplyItem;
