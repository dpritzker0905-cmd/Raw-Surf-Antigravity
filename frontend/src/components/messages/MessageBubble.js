import React, { useState, useRef } from 'react';
import { Reply, MoreHorizontal, Check, CheckCheck, Smile, Heart, X } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import { BACKEND_URL } from '../../lib/apiClient';
import EphemeralCountdown from './EphemeralCountdown';

const REACTIONS = ['🤙', '🌊', '❤️', '🔥', '👏', '😂'];

// Format timestamp for message bubble
const formatTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};


const MessageBubble = ({ message, onReact, _onReply, onNavigateProfile }) => {
  const [showReactions, setShowReactions] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const longPressTimer = useRef(null);
  
  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => setShowReactions(true), 500);
  };
  
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
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
    
    if (message.message_type === 'image' && mediaUrl) {
      return (
        <img 
          src={mediaUrl} 
          alt="Shared" 
          className="max-w-full rounded-lg mb-1 cursor-pointer hover:opacity-90"
          onClick={() => window.open(mediaUrl, '_blank')}
          onError={(e) => {
            e.target.style.display = 'none';
            console.error('Failed to load image:', mediaUrl);
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
        <img 
          src={mediaUrl} 
          alt="GIF" 
          className="max-w-full rounded-lg mb-1"
        />
      );
    }
    return null;
  };

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
        <button
          onClick={() => onNavigateProfile && message.sender_id && onNavigateProfile(message.sender_id)}
          className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden bg-muted ring-1 ring-border hover:ring-cyan-400/60 hover:scale-105 transition-all self-end mb-1 cursor-pointer"
          title={`View ${message.sender_name || 'profile'}`}
        >
          {message.sender_avatar ? (
            <img src={message.sender_avatar} alt="" className="w-full h-full object-cover" />
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
          <button
            onClick={() => setShowReactions(true)}
            className={`absolute right-0 translate-x-[calc(100%+8px)] top-1/2 -translate-y-1/2 p-2 rounded-full text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100 z-10 flex items-center justify-center`}
          >
            <div className="bg-muted/80 hover:bg-muted rounded-full p-1.5 shadow-sm">
              <Smile className="w-4 h-4" />
            </div>
          </button>
        )}
        
        <div className={`rounded-2xl px-4 py-2 ${
          message.is_mine 
            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white' 
            : 'bg-muted text-foreground'
        }`}>
          {renderMedia()}
          {message.content && <p className="text-sm whitespace-pre-wrap">{message.content}</p>}
        </div>
        
        <div className={`flex items-center gap-1 mt-1 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-muted-foreground">{formatTime(message.created_at)}</span>
          {message.is_mine && (
            message.is_read ? <CheckCheck className="w-3 h-3 text-cyan-400" /> : <Check className="w-3 h-3 text-muted-foreground" />
          )}
          {/* Double-tap hint on mobile */}
          {!message.is_mine && (
            <button
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
            <button onClick={() => setShowReactions(false)} className="text-muted-foreground hover:text-foreground ml-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
