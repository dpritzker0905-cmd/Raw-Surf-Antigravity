/**
 * ConversationListPanel - Extracted from MessagesPage.js
 * Renders the conversation list sidebar including folder tabs, stories, crew chats, and conversation items.
 */
import React, { useState } from 'react';
import {
  Search, ChevronLeft, Check, Edit3, Filter, Users
} from 'lucide-react';
import { Button } from '../ui/button';
import PullToRefreshIndicator from '../ui/PullToRefreshIndicator';
import ConversationItem from './ConversationItem';
import StoryBubble from './StoryBubble';
import { getFolders } from './messagesHelpers';
import logger from '../../utils/logger';

const ConversationListPanel = ({
  // Pull to refresh
  msgPullRef, msgPulling, msgPullProgress, msgPtrRefreshing,
  // User & persona
  user, effectiveRole, isMasked, isGodMode,
  // State
  activeFolder, setActiveFolder, conversations, folderCounts,
  selectedConversation, setSelectedConversation,
  searchQuery, setSearchQuery,
  stories, loading,
  showMobileTools, setShowMobileTools,
  crewChats, crewChatsLoading,
  // Presence
  isOnline,
  // Handlers
  handleComposeNew, handleNoteClick,
  handleAcceptAllRequests,
  // Navigation
  navigate,
}) => {
  const [showNotes, setShowNotes] = useState(true);
  // Filter conversations by search AND by active folder
  let filteredConversations = [];
  try {
    filteredConversations = conversations
      .filter(c => {
        if (c.folder && c.folder !== activeFolder) return false;
        return (c?.other_user_name || '').toLowerCase().includes((searchQuery || '').toLowerCase());
      })
      .sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        const bTime = new Date(b.last_message_at || 0).getTime();
        const aTime = new Date(a.last_message_at || 0).getTime();
        return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
      });
  } catch (err) {
    logger.error('Error filtering conversations:', err);
  }

  try {
    return (
    <div ref={msgPullRef} className="flex flex-col h-full bg-background">
      <PullToRefreshIndicator isPulling={msgPulling} progress={msgPullProgress} isRefreshing={msgPtrRefreshing} />
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border">
        <button aria-label="Filter" 
          aria-expanded={showMobileTools} onClick={() => setShowMobileTools(!showMobileTools)}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <Filter className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-foreground font-oswald flex items-center gap-2">
          Messages
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} title={isOnline ? 'Connected' : 'Reconnecting...'} />
        </h1>
        <button aria-label="Edit3" 
          onClick={handleComposeNew}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <Edit3 className="w-5 h-5" />
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input aria-label="Search conversations"
            type="text"
            placeholder="Search conversations"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
          />
        </div>
      </div>

      {/* Stories/Notes Section */}
      {stories.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-b border-border">
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 select-none">
            <span>Active Notes</span>
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold transition-all lowercase"
            >
              {showNotes ? 'hide' : 'show'}
            </button>
          </div>
          {showNotes && (
            <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide animate-in fade-in slide-in-from-top-1 duration-200">
              {stories.map((story) => (
                <StoryBubble 
                  key={story.id} 
                  story={story} 
                  onClick={handleNoteClick}
                  isOwnNote={story.isOwnNote}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Folder Tabs */}
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
        
        <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide border-b border-zinc-800 scroll-smooth">
          {getFolders(user?.role, user?.is_admin || isGodMode, effectiveRole, isMasked, user?.is_grom_parent === true).map((folder) => {
            const _Icon = folder.icon;
            const count = folderCounts[folder.id] || 0;
            const isActive = activeFolder === folder.id;
            
            return (
              <button
                key={folder.id}
                onClick={() => setActiveFolder(folder.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                  isActive 
                    ? 'bg-foreground text-background' 
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              data-testid={`folder-${folder.id}`}
            >
              {folder.emoji && <span className="text-sm">{folder.emoji}</span>}
              <span>{folder.label}</span>
              {count > 0 && (
                <>
                  <span className={`w-2 h-2 rounded-full ${folder.color.replace('text-', 'bg-')}`} />
                  <span className="text-xs opacity-70">{count}</span>
                </>
              )}
            </button>
          );
        })}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {/* Crew Chats Folder */}
        {activeFolder === 'crew_chats' ? (
          crewChatsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : crewChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Users className="w-12 h-12 mb-2 text-muted-foreground/50" />
              <p>No active crew sessions</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Book a session with crew to start chatting</p>
            </div>
          ) : (
            <div className="space-y-1">
              {crewChats.map((chat) => (
                <button aria-label="div"
                  key={chat.id}
                  onClick={() => navigate(`/bookings/${chat.id}/chat`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50"
                  data-testid={`crew-chat-${chat.id}`}
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white truncate">
                        {chat.location || 'Surf Session'}
                      </span>
                      {chat.unread_count > 0 && (
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{chat.chatInfo?.participants?.length || 0} participants</span>
                      <span>-</span>
                      <span>{chat.status}</span>
                    </div>
                    {(() => {
                      if (!chat.session_date) return null;
                      const sessionDate = new Date(chat.session_date);
                      if (isNaN(sessionDate.getTime())) return null;
                      return (
                        <div className="text-xs text-cyan-400 mt-0.5">
                          {sessionDate.toLocaleDateString()}
                        </div>
                      );
                    })()}
                  </div>
                  <ChevronLeft className="w-4 h-4 text-gray-600 rotate-180" />
                </button>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <p>No conversations in {activeFolder}</p>
          </div>
        ) : (
          <>
            {/* Quick Accept All Banner for Requests folder */}
            {activeFolder === 'requests' && filteredConversations.length > 1 && (
              <div className="px-4 py-2 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-b border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    {filteredConversations.length} pending request{filteredConversations.length > 1 ? 's' : ''}
                  </span>
                  <Button aria-label="Confirm"
                    onClick={handleAcceptAllRequests}
                    size="sm"
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-bold px-3 py-1 h-7"
                    data-testid="accept-all-requests-btn"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Accept All
                  </Button>
                </div>
              </div>
            )}
            {filteredConversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={selectedConversation?.id === conv.id}
                isOnline={isOnline(conv.other_user_id)}
                onClick={() => {
                  setSelectedConversation(conv);
                  navigate(`/messages/${conv.id}`);
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
    );
  } catch (err) {
    logger.error('Error in ConversationListPanel:', err);
    return <div className="p-4 text-red-500">List Error: {err.toString()}</div>;
  }
};

export default ConversationListPanel;
