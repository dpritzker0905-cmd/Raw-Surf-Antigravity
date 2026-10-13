/**
 * crewChatUtils.js - Utility functions extracted from CrewChat.js.
 * Reduces CrewChat from 52.6KB to under 50KB.
 */
import React from 'react';
import { File as FileIcon, FileText, FileSpreadsheet, FileArchive, Presentation } from 'lucide-react';
import { Badge } from '../ui/badge';

// The backend (routes/crew/crew_chat_media.py) stores an uncaptioned file message as
// "\U0001f4ce <original name>": paperclip + name. The bubble already shows the name, so that
// generated content is hidden; a real caption is shown.
export const FILE_MESSAGE_AUTO_PREFIX = '\u{1F4CE}';

const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Decorative: the file name is always rendered beside the icon.
  const getFileIcon = (fileType, className = 'w-8 h-8') => {
    let Icon = FileIcon;
    if (fileType?.includes('pdf')) Icon = FileText;
    else if (fileType?.includes('word') || fileType?.includes('doc')) Icon = FileText;
    else if (fileType?.includes('excel') || fileType?.includes('sheet')) Icon = FileSpreadsheet;
    else if (fileType?.includes('powerpoint') || fileType?.includes('presentation')) Icon = Presentation;
    else if (fileType?.includes('zip') || fileType?.includes('archive')) Icon = FileArchive;
    else if (fileType?.includes('text') || fileType?.includes('csv')) Icon = FileText;
    return <Icon className={className} aria-hidden="true" />;
  };

  const getTotalReactions = (reactions) => {
    if (!reactions) return 0;
    return Object.values(reactions).reduce((sum, users) => sum + users.length, 0);
  };

  const hasUserReacted = (reactions, emoji, userId) => {
    if (!reactions || !reactions[emoji]) return false;
    return reactions[emoji].includes(userId);
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'captain':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Captain</Badge>;
      case 'photographer':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">Pro</Badge>;
      case 'system':
        return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">System</Badge>;
      default:
        return <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">Crew</Badge>;
    }
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const renderMessageContent = (content, mentions = [], navigate) => {
    if (!mentions || mentions.length === 0) {
      return <span>{content}</span>;
    }
    
    // Parse @[Name](id) mentions and render as links
    const mentionPattern = /@\[([^\]]+)\]\(([a-f0-9-]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    
    while ((match = mentionPattern.exec(content)) !== null) {
      // Add text before mention
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{content.substring(lastIndex, match.index)}</span>);
      }
      
      // Add mention link
      const displayName = match[1];
      const userId = match[2];
      parts.push(
        <button
          key={`mention-${match.index}`}
          onClick={() => navigate && navigate(`/profile/${userId}`)}
          className="text-cyan-400 hover:text-cyan-300 font-medium"
        >
          @{displayName}
        </button>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(<span key={`text-end`}>{content.substring(lastIndex)}</span>);
    }
    
    return <>{parts}</>;
  };

export const QUICK_ACTIONS = [
  // Status updates
  { id: 'omw', text: 'On my way!', category: 'status' },
  { id: 'late', text: 'Running 5 mins late', category: 'status' },
  { id: 'arrived', text: 'Just arrived at the spot', category: 'status' },
  { id: 'parking', text: 'Looking for parking', category: 'status' },
  { id: 'paddling', text: 'Paddling out now!', category: 'status' },
  { id: 'ready', text: 'Ready when you are!', category: 'status' },

  // Wave conditions
  { id: 'pumping', text: 'Waves are pumping!', category: 'conditions' },
  { id: 'glassy', text: "It's glassy out here!", category: 'conditions' },
  { id: 'choppy', text: 'Getting a bit choppy', category: 'conditions' },
  { id: 'crowded', text: 'Pretty crowded lineup', category: 'conditions' },
  { id: 'uncrowded', text: 'Lineup is empty!', category: 'conditions' },
  { id: 'perfect', text: 'Conditions are PERFECT', category: 'conditions' },

  // Logistics
  { id: 'gear', text: 'Bringing extra gear', category: 'logistics' },
  { id: 'wax', text: 'Got extra wax if needed', category: 'logistics' },
  { id: 'drinks', text: 'Bringing drinks/snacks', category: 'logistics' },
  { id: 'camera', text: 'Camera is ready!', category: 'logistics' },

  // Vibes
  { id: 'stoked', text: 'So stoked for this session!', category: 'vibes' },
  { id: 'sunset', text: 'Staying for sunset', category: 'vibes' },
  { id: 'thanks', text: 'Thanks for the session!', category: 'vibes' },
  { id: 'again', text: "Let's do this again soon!", category: 'vibes' },
];

export { formatFileSize, getFileIcon, getTotalReactions, hasUserReacted, getRoleBadge, getInitials, renderMessageContent };
