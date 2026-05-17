/**
 * WhoReactedModal - Shows list of users who reacted to a post
 * Opens when user long-presses on the like count
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getFullUrl } from '../utils/media';
import { useTheme } from '../contexts/ThemeContext';

const WhoReactedModal = ({ isOpen, onClose, reactions = [], _postAuthorName, loading = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  const bgClass = isBeach ? 'bg-amber-50 border-amber-200' : isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800';
  const textClass = isLight || isBeach ? 'text-gray-900' : 'text-white';
  const textMuted = isLight || isBeach ? 'text-gray-500' : 'text-zinc-500';
  const hoverClass = isLight || isBeach ? 'hover:bg-gray-100' : 'hover:bg-zinc-800';
  const avatarBorder = isLight || isBeach ? 'border-gray-200' : 'border-zinc-700';
  const avatarFallbackBg = isLight || isBeach ? 'bg-gray-200 text-gray-700' : 'bg-zinc-800 text-white';

  // Group reactions by emoji for summary
  const emojiCounts = reactions.reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {});

  const handleUserClick = (userId) => {
    onClose();
    navigate(`/profile/${userId}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${bgClass} ${textClass} max-w-sm max-h-[70vh] flex flex-col`} data-testid="who-reacted-modal">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            Reactions
            {/* Emoji summary */}
            <span className="flex gap-1 ml-2">
              {Object.entries(emojiCounts).map(([emoji, count]) => (
                <span key={emoji} className="flex items-center text-sm">
                  <span className="text-base">{emoji}</span>
                  {count > 1 && <span className={`${textMuted} ml-0.5`}>{count}</span>}
                </span>
              ))}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2 -mx-2 px-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
            </div>
          ) : reactions.length === 0 ? (
            <div className={`text-center py-8 ${textMuted}`}>
              <p>No reactions yet</p>
              <p className="text-sm mt-1">Be the first to react!</p>
            </div>
          ) : (
            <div className="space-y-1">
              {reactions.map((reaction, index) => (
                <button aria-label="Avatar"
                  key={`${reaction.user_id}-${index}`}
                  onClick={() => handleUserClick(reaction.user_id)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors text-left ${hoverClass}`}
                  data-testid={`reactor-${reaction.user_id}`}
                >
                  <Avatar className={`w-10 h-10 border ${avatarBorder}`}>
                    <AvatarImage src={getFullUrl(reaction.avatar_url)} />
                    <AvatarFallback className={avatarFallbackBg}>
                      {(reaction.user_name || 'U').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${textClass}`}>
                      {reaction.user_name || 'Unknown User'}
                    </p>
                    {reaction.user_role && (
                      <p className={`text-xs capitalize ${textMuted}`}>{reaction.user_role}</p>
                    )}
                  </div>
                  <span className="text-xl" title={`Reacted with ${reaction.emoji}`}>
                    {reaction.emoji}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WhoReactedModal;
