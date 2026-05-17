/**
 * crewChatUtils.js - Utility functions extracted from CrewChat.js.
 * Reduces CrewChat from 52.6KB to under 50KB.
 */
import React from 'react';
import { Badge } from '../ui/badge';

var formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getFileIcon = (fileType) => {
    if (fileType?.includes('pdf')) return '📄';
    if (fileType?.includes('word') || fileType?.includes('doc')) return '📝';
    if (fileType?.includes('excel') || fileType?.includes('sheet')) return '📊';
    if (fileType?.includes('powerpoint') || fileType?.includes('presentation')) return '📊';
    if (fileType?.includes('zip') || fileType?.includes('archive')) return '📦';
    if (fileType?.includes('text') || fileType?.includes('csv')) return '📃';
    return '📎';
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

export { formatFileSize, getFileIcon, getTotalReactions, hasUserReacted, getRoleBadge, getInitials, renderMessageContent };
