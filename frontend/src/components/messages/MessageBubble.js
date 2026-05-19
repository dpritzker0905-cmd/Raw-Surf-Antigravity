import React, { useState, useRef } from 'react';
import {
  Reply,
  Check,
  CheckCheck,
  Smile,
  Heart,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import EphemeralCountdown from './EphemeralCountdown';
import logger from '../../utils/logger';
import { formatClockTime } from '../../utils/formatTime';

// Must stay in sync with backend ALLOWED_REACTIONS in schemas.py
const REACTIONS = [
 '\u{2764}\u{FE0F}', // Gn+ Red Heart
 '\u{1F525}', // = Fire
 '\u{1F919}', // = Call Me Hand (Shaka)
 '\u{1F602}', // = Face with Tears of Joy
 '\u{1F30A}', // = Wave
 '\u{1F4AF}', // = Hundred Points
];

// Format timestamp for message bubble - shared utility
const formatTime = formatClockTime;

/**
 * Attempt to parse a post_share message's JSON content.
 * Returns null if it's a legacy plain-text share.
 */
const parsePostShareData = (content) => {
  if (!content) return null;
  try {
    const data = JSON.parse(content);
    // Validate it has at minimum a post_id
    if (data && data.post_id) return data;
    return null;
  } catch {
    return null;
  }
};


const MessageBubble = ({ message, onReact, _onReply, onNavigateProfile }) => {
  const navigate = useNavigate();
  const [showReactions, setShowReactions] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const longPressTimer = useRef(null);
  
  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => setShowReactions(true), 500);
  };
  
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  /**
   * Renders an Instagram-style shared-post card.
   * Clickable to navigate to the full post.
   */
  const renderPostShareCard = (shareData) => {
    const mediaUrl = getFullUrl(shareData.media_url);
    const authorAvatar = getFullUrl(shareData.author_avatar);
    const isVideo = shareData.media_type === 'video';
    const caption = shareData.caption || '';
    const truncatedCaption = caption.length > 120
      ? caption.substring(0, 120) + '\u{2026}'
      : caption;

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/post/${shareData.post_id}`);
        }}
        className="block w-full text-left rounded-xl overflow-hidden border border-white/10 bg-black/20 hover:bg-black/30 transition-colors cursor-pointer max-w-[280px]"
        data-testid="shared-post-card"
        aria-label="View shared post"
      >
        {/* Post Thumbnail */}
        {mediaUrl && (
          <div className="relative w-full aspect-[4/3] bg-black/40 overflow-hidden">
            {isVideo ? (
              <video
                src={mediaUrl}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
                playsInline
              />
            ) : (
              <img
                loading="lazy"
                decoding="async"
                src={mediaUrl}
                alt="Shared post"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            )}
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
                    <polygon points="4,2 14,8 4,14" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Author + Caption */}
        <div className="px-3 py-2.5">
          {/* Author row */}
          {shareData.author_name && (
            <div className="flex items-center gap-2 mb-1.5">
              {authorAvatar ? (
                <img
                  src={authorAvatar}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-semibold text-white/70">
                    {shareData.author_name?.charAt(0) || '?'}
                  </span>
                </div>
              )}
              <span className="text-xs font-semibold truncate" style={{ color: 'inherit' }}>
                {shareData.author_name}
              </span>
            </div>
          )}

          {/* Caption */}
          {truncatedCaption && (
            <p className="text-xs leading-relaxed opacity-80 line-clamp-2" style={{ color: 'inherit' }}>
              {truncatedCaption}
            </p>
          )}

          {/* "View Post" hint */}
          <p className="text-[10px] mt-1.5 opacity-50 font-medium" style={{ color: 'inherit' }}>
            View post
          </p>
        </div>
      </button>
    );
  };

  const renderMedia = () => {
    // Helper to get full URL for media
    const getMediaUrl = (url) => {
      if (!url) return null;
      // If it's already an absolute URL (http/https), use as-is
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      // If it's a relative /uploads path, prepend the backend URL
      if (url.startsWith('/uploads') || url.startsWith('/api/uploads')) {
        return `${BACKEND_URL}${url.startsWith('/api') ? '' : '/api'}${url}`;
      }
      return url;
    };
    
    const mediaUrl = getMediaUrl(message.media_url);

 // --- Post Share Card ---
    if (message.message_type === 'post_share') {
      const shareData = parsePostShareData(message.content);
      if (shareData) {
        return renderPostShareCard(shareData);
      }
      // Legacy plain-text post shares fall through to text rendering
      return null;
    }
    
    if (message.message_type === 'image' && mediaUrl) {
      return (
        <img loading="lazy" decoding="async" 
          src={mediaUrl} 
          alt="Shared" 
          className="max-w-full rounded-lg mb-1 cursor-pointer hover:opacity-90"
          onClick={() => window.open(mediaUrl, '_blank')}
          onError={(e) => {
            e.target.style.display = 'none';
            logger.error('Failed to load image:', mediaUrl);
          }}
        />
      );
    }
    if ((message.message_type === 'video' || message.message_type === 'ephemeral_video') && mediaUrl) {
      // Only treat as ephemeral if message_type is explicitly 'ephemeral_video'
      const isEphemeral = message.message_type === 'ephemeral_video';

      return (
        <div className="relative group max-w-sm rounded-2xl overflow-hidden mt-1 cursor-pointer">
          {isEphemeral && <EphemeralCountdown createdAt={message.created_at} />}
          <video 
            src={mediaUrl} 
            controls 
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            className={`max-w-full rounded-lg ${isEphemeral ? 'border-2 border-red-500/30' : ''}`}
          />
        </div>
      );
    }
    if (message.message_type === 'voice_note' && mediaUrl) {
      return (
        <div className="flex items-center gap-2 mb-1">
          <audio src={mediaUrl} controls className="max-w-[200px]" />
        </div>
      );
    }
    // Handle GIF messages
    if (message.message_type === 'gif' && mediaUrl) {
      return (
        <img loading="lazy" decoding="async" 
          src={mediaUrl} 
          alt="GIF" 
          className="max-w-full rounded-lg mb-1"
        />
      );
    }
    return null;
  };

  // Determine if this is a rich post share (suppress text content for those)
  const isRichPostShare = message.message_type === 'post_share' && parsePostShareData(message.content);

  return (
    <div 
      className={`relative flex ${message.is_mine ? 'justify-end' : 'justify-start'} items-end gap-2 mb-3 group`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); setShowReactions(true); }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); if (!showReactions) setShowReactions(false); }}
    >
      {/* Sender avatar - only for incoming messages, Instagram-style */}
      {!message.is_mine && (
        <button aria-label="span"
          onClick={() => onNavigateProfile && message.sender_id && onNavigateProfile(message.sender_id)}
          className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden bg-muted ring-1 ring-border hover:ring-cyan-400/60 hover:scale-105 transition-all self-end mb-1 cursor-pointer"
          title={`View ${message.sender_name || 'profile'}`}
        >
          {message.sender_avatar ? (
            <img loading="lazy" decoding="async" src={message.sender_avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
              {message.sender_name?.charAt(0) || '?'}
            </span>
          )}
        </button>
      )}

      {message.reply_to && (
        <div className={`absolute -top-6 ${message.is_mine ? 'right-0' : 'left-8'} max-w-[60%]`}>
          <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
            <Reply className="w-3 h-3" />
            <span className="truncate">{message.reply_to.content}</span>
          </div>
        </div>
      )}
      
      <div className={`max-w-[75%] ${message.is_mine ? 'items-end' : 'items-start'} relative flex flex-col`}>
        {/* Quick React Button - Visible on hover */}
        {!message.is_mine && isHovered && !showReactions && (
          <button aria-label="Emoji"
            onClick={() => setShowReactions(true)}
            className={`absolute right-0 translate-x-[calc(100%+8px)] top-1/2 -translate-y-1/2 p-2 rounded-full text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100 z-10 flex items-center justify-center`}
          >
            <div className="bg-muted/80 hover:bg-muted rounded-full p-1.5 shadow-sm">
              <Smile className="w-4 h-4" />
            </div>
          </button>
        )}
        
        <div className={`rounded-2xl ${isRichPostShare ? 'p-1' : 'px-4 py-2'} ${
          message.is_mine 
            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white' 
            : 'bg-muted text-foreground'
        }`}>
          {renderMedia()}
          {/* Hide raw content for rich post shares (the card replaces it) */}
          {message.content && !isRichPostShare && <p className="text-sm whitespace-pre-wrap">{message.content}</p>}
        </div>
        
        <div className={`flex items-center gap-1 mt-1 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-muted-foreground">{formatTime(message.created_at)}</span>
          {message.is_mine && (
            message.is_read ? <CheckCheck className="w-3 h-3 text-cyan-400" /> : <Check className="w-3 h-3 text-muted-foreground" />
          )}
          {/* Double-tap hint on mobile */}
          {!message.is_mine && (
            <button aria-label="Like"
              onClick={() => setShowReactions(true)}
              className="ml-1 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground md:hidden"
            >
              <Heart className="w-3 h-3" />
            </button>
          )}
        </div>

        {message.reactions?.length > 0 && (
          <div className={`flex gap-0.5 mt-1 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
            {message.reactions.map((r, i) => (
              <span key={i} className="text-xs bg-muted rounded-full px-1.5 py-0.5 cursor-pointer hover:bg-muted/80" onClick={() => onReact(message.id, r.emoji)}>
                {r.emoji} {r.count > 1 && <span className="text-[10px]">{r.count}</span>}
              </span>
            ))}
          </div>
        )}
        {/* Reaction Emoji Picker - positioned beside the bubble */}
        {showReactions && (
          <div className={`absolute ${message.is_mine ? 'left-0 -translate-x-[calc(100%+8px)]' : 'right-0 translate-x-[calc(100%+8px)]'} top-1/2 -translate-y-1/2 bg-card rounded-full px-2 py-1 flex gap-1 shadow-xl border border-border z-50`}>
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onReact(message.id, emoji); setShowReactions(false); }}
                className="text-lg hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
            <button onClick={() => setShowReactions(false)} className="text-muted-foreground hover:text-foreground ml-1" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;

