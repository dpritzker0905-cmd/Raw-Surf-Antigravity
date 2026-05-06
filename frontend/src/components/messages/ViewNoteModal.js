/**
 * ViewNoteModal - Modal for viewing and replying to Instagram-style notes.
 * Shows note author, content, reply input, and engagement stats.
 * Extracted from MessagesPage.js for maintainability.
 */
import React, { useState } from 'react';
import { X, Send } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';

// Cache-bust avatar URL to prevent stale images
const cacheBustUrl = (url) => {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}cb=${Date.now()}`;
};

const ViewNoteModal = ({ isOpen, onClose, note, currentUserId, onReply }) => {
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  
  const handleReply = async () => {
    if (!replyText.trim() || isReplying) return;
    
    setIsReplying(true);
    try {
      await onReply(note.id, replyText.trim());
      setReplyText('');
      onClose();
      toast.success('Reply sent as message');
    } catch (error) {
      toast.error('Failed to send reply');
    } finally {
      setIsReplying(false);
    }
  };
  
  if (!isOpen || !note) return null;
  
  const resolvedNoteAvatar = note.user_avatar ? getFullUrl(note.user_avatar) : null;
  const avatarWithCacheBust = cacheBustUrl(resolvedNoteAvatar);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* User info */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-muted relative">
            {avatarWithCacheBust ? (
              <img 
                src={avatarWithCacheBust} 
                alt="" 
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div 
              className="w-full h-full flex items-center justify-center text-muted-foreground absolute inset-0"
              style={{ display: avatarWithCacheBust ? 'none' : 'flex' }}
            >
              {note.user_name?.charAt(0)}
            </div>
          </div>
          <div>
            <p className="font-medium text-foreground">{note.user_name}</p>
            <p className="text-xs text-emerald-500 dark:text-emerald-400">{note.time_remaining} left</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Note content */}
        <div className="bg-muted rounded-xl p-4 mb-4">
          <p className="text-foreground text-center text-lg">{note.content}</p>
        </div>
        
        {/* Reply section - only show if not own note */}
        {note.user_id !== currentUserId && (
          <div className="flex gap-2">
            <Input aria-label="Reply to note..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Reply to note..."
              className="bg-muted border-border text-foreground flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleReply()}
              data-testid="note-reply-input"
            />
            <Button aria-label="Send"
              onClick={handleReply}
              disabled={!replyText.trim() || isReplying}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
              data-testid="send-note-reply-btn"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        )}
        
        {/* Stats */}
        <div className="flex justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <span>{note.view_count} views</span>
          <span>{note.reply_count} replies</span>
        </div>
      </div>
    </div>
  );
};

export default ViewNoteModal;
