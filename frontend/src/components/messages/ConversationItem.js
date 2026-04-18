import React from 'react';
import { Check, CheckCheck, EyeOff, BellOff, Pin, Camera, Play, Mic, Star, Shield, Users, Store, Briefcase } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

// Inline role icon helper (mirrors MessagesPage logic for ConversationItem)
const getRoleIcon = (role, isAdmin = false) => {
  if (isAdmin) return { icon: Shield, color: 'text-red-500' };
  switch (role) {
    case 'Pro': case 'Comp Surfer': return { icon: Star, color: 'text-amber-400' };
    case 'Approved Pro': return { icon: Camera, color: 'text-blue-400' };
    case 'Photographer': return { icon: Camera, color: 'text-purple-400' };
    case 'Shop': return { icon: Store, color: 'text-pink-400' };
    case 'Surf School': return { icon: Users, color: 'text-teal-400' };
    case 'Shaper': return { icon: Briefcase, color: 'text-orange-400' };
    default: return { icon: null, color: 'text-cyan-400' };
  }
};

// Format relative time (e.g., "2h ago")
const formatTimeAgo = (ts) => {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};


const ConversationItem = ({ conversation, isSelected, onClick }) => {
  const hasUnread = conversation.unread_count > 0 || conversation.is_manually_unread;
  const roleInfo = getRoleIcon(conversation.other_user_role);
  const RoleIcon = roleInfo.icon;
  const isRequest = conversation.is_request || conversation.folder === 'requests';
  
  // Add cache-busting to avatar URL to fix stale profile pictures
  // Use user's updated_at timestamp if available, else use current time for fresh fetch
  const avatarWithCacheBust = conversation.other_user_avatar 
    ? `${conversation.other_user_avatar}${conversation.other_user_avatar.includes('?') ? '&' : '?'}v=${conversation.other_user_updated_at || Date.now()}`
    : null;
  
  // Determine ring color based on folder/role
  const getRingClass = () => {
    if (conversation.folder === 'pro_lounge') return 'ring-2 ring-amber-400/50';
    if (conversation.folder === 'channel') return 'ring-2 ring-purple-400/50';
    return '';
  };
  
  // Determine preview icon based on message type
  const getPreviewIcon = () => {
    const preview = conversation.last_message_preview || '';
    if (preview.includes('📷')) return <Camera className="w-4 h-4 text-gray-400" />;
    if (preview.includes('🎬')) return <Play className="w-4 h-4 text-cyan-400" />;
    if (preview.includes('🎤')) return <Mic className="w-4 h-4 text-gray-400" />;
    return null;
  };

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors ${
        isSelected ? 'bg-accent' : ''
      }`}
      data-testid={`conversation-${conversation.id}`}
    >
      {/* Avatar with online indicator */}
      <div className="relative flex-shrink-0">
        <div className={`w-14 h-14 rounded-full overflow-hidden ${getRingClass()}`}>
          {avatarWithCacheBust ? (
            <img src={avatarWithCacheBust} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground text-xl">
              {conversation.other_user_name?.charAt(0)}
            </div>
          )}
        </div>
        {/* Online indicator - green dot only if they sent a message in this chat within last 5 min */}
        {conversation.other_user_last_active &&
          (Date.now() - new Date(conversation.other_user_last_active).getTime()) < 300000 && (
          <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-background" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className={`font-medium truncate ${hasUnread ? 'text-foreground' : 'text-muted-foreground'}`}>
            {conversation.other_user_name}
          </span>
          {/* Role icon */}
          {RoleIcon ? (
            <RoleIcon className={`w-4 h-4 ${roleInfo.color} flex-shrink-0`} />
          ) : (
            <span className="text-sm flex-shrink-0">🏄</span>
          )}
          {/* Request badge */}
          {isRequest && (
            <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded-full flex-shrink-0">
              Request
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-sm truncate ${hasUnread ? 'text-gray-300' : 'text-gray-500'}`}>
            {conversation.last_message_preview || 'Start a conversation'}
          </span>
          {conversation.last_message_at && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              · {formatTimeAgo(conversation.last_message_at)}
            </span>
          )}
        </div>
      </div>

      {/* Right side indicators */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Pinned indicator */}
        {conversation.is_pinned && (
          <Pin className="w-4 h-4 text-cyan-400" />
        )}
        {/* Muted indicator */}
        {conversation.is_muted && (
          <BellOff className="w-4 h-4 text-gray-500" />
        )}
        {hasUnread && (
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
        )}
        {getPreviewIcon()}
      </div>
    </button>
  );
};

export default ConversationItem;
