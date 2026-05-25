/**
 * crewChatUtils.js - Utility functions extracted from CrewChat.js.
 * Reduces CrewChat from 52.6KB to under 50KB.
 */
import React from 'react';
import { Badge } from '../ui/badge';

const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getFileIcon = (fileType) => {
 if (fileType?.includes('pdf')) return '=';
 if (fileType?.includes('word') || fileType?.includes('doc')) return '=';
 if (fileType?.includes('excel') || fileType?.includes('sheet')) return '=';
 if (fileType?.includes('powerpoint') || fileType?.includes('presentation')) return '=';
 if (fileType?.includes('zip') || fileType?.includes('archive')) return '=';
 if (fileType?.includes('text') || fileType?.includes('csv')) return '=';
 return '=';
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
 { id: 'omw', text: 'On my way! +-+-++-+G++', category: 'status', icon: '+-+-++-+GG' },
 { id: 'late', text: 'Running 5 mins late', category: 'status', icon: '+-+-+-' },
 { id: 'arrived', text: 'Just arrived at the spot', category: 'status', icon: '+-+-++G++-' },
 { id: 'parking', text: 'Looking for parking', category: 'status', icon: '+-+-++G-+-++-+-++-' },
 { id: 'paddling', text: 'Paddling out now!', category: 'status', icon: '+-+-++-+-' },
 { id: 'ready', text: 'Ready when you are! +-+-++-+GP-', category: 'status', icon: '+-+G+G-' },

  // Wave conditions
 { id: 'pumping', text: 'Waves are pumping! +-+-++G+-', category: 'conditions', icon: '+-+-++G+-' },
 { id: 'glassy', text: "It's glassy out here! +-+-++G-+-", category: 'conditions', icon: '+-+G+-' },
 { id: 'choppy', text: 'Getting a bit choppy', category: 'conditions', icon: '+-+-++GG+-' },
 { id: 'crowded', text: 'Pretty crowded lineup', category: 'conditions', icon: '+-+-++G-+-' },
 { id: 'uncrowded', text: 'Lineup is empty! +-+-++-++G-', category: 'conditions', icon: '+-+-++-+GG+-+-++-' },
 { id: 'perfect', text: 'Conditions are PERFECT', category: 'conditions', icon: '+-+-++GG+-' },

  // Logistics
 { id: 'gear', text: 'Bringing extra gear', category: 'logistics', icon: '+-+-++-++GG' },
 { id: 'wax', text: 'Got extra wax if needed', category: 'logistics', icon: '+-+-++-+-' },
 { id: 'drinks', text: 'Bringing drinks/snacks', category: 'logistics', icon: '+-+-++-+-' },
 { id: 'camera', text: 'Camera is ready! +-+-++G++-+', category: 'logistics', icon: '+-+-++G++-+' },

  // Vibes
 { id: 'stoked', text: 'So stoked for this session!', category: 'vibes', icon: '+-+-++-+-' },
 { id: 'sunset', text: 'Staying for sunset +-+-++G+G-', category: 'vibes', icon: '+-+-++G+G-' },
 { id: 'thanks', text: 'Thanks for the session! +-+-++-+GP-', category: 'vibes', icon: '+-+-++GP-+-' },
 { id: 'again', text: "Let's do this again soon!", category: 'vibes', icon: '+-+-++G-+G++' },
];

export { formatFileSize, getFileIcon, getTotalReactions, hasUserReacted, getRoleBadge, getInitials, renderMessageContent };
