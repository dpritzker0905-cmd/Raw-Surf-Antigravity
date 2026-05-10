import React, { useState, useEffect, useRef, useCallback } from 'react';
// Build trigger: 2026-04-30
import apiClient from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSearchParams, useNavigate, useParams, useLocation } from 'react-router-dom';


import { Button } from './ui/button';


import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import logger from '../utils/logger';
import useMessagesActions from '../hooks/useMessagesActions';
import ComposeModal from './messages/ComposeModal';
import usePullToRefresh from '../hooks/usePullToRefresh';
import CreateNoteModal from './messages/CreateNoteModal';
import ViewNoteModal from './messages/ViewNoteModal';
import ConversationListPanel from './messages/ConversationListPanel';
import ChatViewPanel from './messages/ChatViewPanel';
import usePresence from '../hooks/usePresence';

import { getFolders, ShakaIcon } from './messages/messagesHelpers';



// Main Component
export const MessagesPage = () => {
  const { user } = useAuth();
  const { getEffectiveRole, isMasked, activePersona, isGodMode } = usePersona();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { conversationId, recipientId } = useParams();
  const location = useLocation();
  
  // Get effective role for UI rendering (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // Real-time presence tracking
  const { isOnline } = usePresence(user?.id);
  
  // State
  const [activeFolder, setActiveFolder] = useState('primary');
  const [conversations, setConversations] = useState([]);
  const [folderCounts, setFolderCounts] = useState({ official: 0, primary: 0, requests: 0, hidden: 0 });
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversationDetail, setConversationDetail] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [showVideoCapture, setShowVideoCapture] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stories, setStories] = useState([]);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  
  // Notes state (Instagram-style notes feature)
  const [_notesFeed, setNotesFeed] = useState([]);
  const [_myNote, setMyNote] = useState(null);
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);
  const [showViewNoteModal, setShowViewNoteModal] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);
  
  // Crew Chats state
  const [crewChats, setCrewChats] = useState([]);
  const [crewChatsLoading, setCrewChatsLoading] = useState(false);
  
  // New chat state
  const [_newChatRecipient, setNewChatRecipient] = useState(null);
  const fromProfileId = location.state?.fromProfile;
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Ref to track current activeFolder - prevents stale-closure bugs in polling
  // intervals that capture an old fetchConversations and overwrite channel/pro-lounge
  // conversations with primary ones.
  const activeFolderRef = useRef(activeFolder);
  useEffect(() => { activeFolderRef.current = activeFolder; }, [activeFolder]);

  // Pull-to-refresh for mobile - triggers conversation list refresh on swipe-down
  const { pullRef: msgPullRef, isPulling: msgPulling, pullProgress: msgPullProgress, isRefreshing: msgPtrRefreshing } = usePullToRefresh(
    async () => { await fetchConversations(); },
    { threshold: 60, enabled: !loading && !selectedConversation }
  );

  // Handle direct conversation routing
  useEffect(() => {
    if (conversationId && conversationId !== 'undefined' && conversationId !== 'null' && user?.id) {
      logger.debug('[Messages] Loading conversation:', conversationId, 'for user:', user.id);
      loadConversationById(conversationId);
    } else if (conversationId === 'undefined' || conversationId === 'null') {
      navigate('/messages', { replace: true });
    }
  }, [conversationId, navigate, user?.id]);

  // Handle new chat routing
  useEffect(() => {
    if (recipientId && user?.id) {
      setNewChatRecipient({
        id: recipientId,
        name: location.state?.recipientName || 'User',
        avatar: location.state?.recipientAvatar
      });
      setSelectedConversation({
        id: null,
        other_user_id: recipientId,
        other_user_name: location.state?.recipientName || 'User',
        other_user_avatar: location.state?.recipientAvatar,
        is_new_chat: true
      });
    }
  }, [recipientId, user?.id, location.state]);

  // Handle legacy URL parameter
  useEffect(() => {
    const targetUserId = searchParams.get('user');
    if (targetUserId && user?.id && targetUserId !== user.id) {
      startNewConversation(targetUserId);
    }
  }, [searchParams, user?.id]);

  // Track previous persona state to detect GENUINE persona switches
  // (not mount or auth-settling re-renders)
  const prevPersonaRef = useRef({ effectiveRole, isGodMode, activePersona, initialized: false });

  // Re-fetch when persona GENUINELY changes (God Mode switching)
  useEffect(() => {
    if (!user?.id) return;

    const prev = prevPersonaRef.current;

    // On first run after mount, just record the current values - don't reset folder
    if (!prev.initialized) {
      prevPersonaRef.current = { effectiveRole, isGodMode, activePersona, initialized: true };
      return;
    }

    // Check if anything actually changed
    const personaChanged =
      prev.effectiveRole !== effectiveRole ||
      prev.isGodMode !== isGodMode ||
      prev.activePersona !== activePersona;

    if (!personaChanged) return;

    // Genuine persona switch - update ref
    prevPersonaRef.current = { effectiveRole, isGodMode, activePersona, initialized: true };

    // Reset to appropriate default folder based on effective role
    const folders = getFolders(user?.role, user?.is_admin || isGodMode, effectiveRole, isMasked, user?.is_grom_parent === true);
    const folderIds = folders.map(f => f.id);
    
    // If current folder is not available for this role, switch to primary
    if (!folderIds.includes(activeFolder)) {
      setActiveFolder('primary');
    }
    
    // Refetch conversations for current folder
    fetchConversations();
  }, [effectiveRole, isGodMode, activePersona]);

  // Fetch conversations on folder change
  useEffect(() => {
    if (user?.id) {
      fetchConversations();
      fetchStories();
    }

    // Cleanup: abort in-flight fetch if the folder changes before it completes
    return () => {
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }
    };
  }, [user?.id, activeFolder]);

  // Fetch conversation detail when selected
  // CRITICAL: Depend on selectedConversation?.id (not the full object) to prevent
  // unnecessary re-fetches when the object reference changes but the ID stays the
  // same. Re-fetching replaces all messages with the server response, which wipes
  // out any messages added optimistically or via the realtime subscription.
  const selectedConvId = selectedConversation?.id;
  const isNewChat = selectedConversation?.is_new_chat;
  useEffect(() => {
    if (selectedConvId && !isNewChat) {
      fetchConversationDetail(selectedConvId);
    }
  }, [selectedConvId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [conversationDetail?.messages]);

  // Real-time subscription for active conversation messages ONLY
  // OPTIMIZED: Only subscribes when a specific conversation is open (not globally)
  // This drastically reduces WAL events received via the shared pooler
  useEffect(() => {
    if (!user?.id || !selectedConversation?.id) return;

    const messagesChannel = supabase
      .channel(`inbox-messages-${selectedConversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${selectedConversation.id}`
      }, (payload) => {
        const msg = payload.new;
        if (msg.sender_id !== user.id) {
          // Append the incoming message directly to local state - no API refetch
          setConversationDetail(prev => {
            if (!prev?.messages) return prev;
            // Deduplicate: don't add if already present (e.g., from optimistic insert)
            const exists = prev.messages.some(m => m.id === msg.id);
            if (exists) return prev;
            // Use prev.other_user_name / prev.other_user_avatar instead of
            // conversationDetail (outer scope) to avoid stale-closure bugs.
            return {
              ...prev,
              messages: [...prev.messages, {
                id: msg.id,
                sender_id: msg.sender_id,
                content: msg.content,
                message_type: msg.message_type || 'text',
                media_url: msg.media_url,
                created_at: msg.created_at,
                reply_to_id: msg.reply_to_id,
                is_read: false,
                reactions: [],
                sender_name: prev.other_user_name || 'User',
                sender_avatar: prev.other_user_avatar,
              }]
            };
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
    };
  }, [user?.id, selectedConversation?.id]);

  // Lightweight polling for conversation list sidebar (replaces global postgres_changes)
  // The conversations channel was monitoring ALL conversation updates for ALL users,
  // generating massive shared pooler egress. Polling every 10s is sufficient for sidebar.
  // NOTE: activeFolder in deps ensures the interval restarts with the correct folder
  // when the user switches tabs. Combined with activeFolderRef inside fetchConversations,
  // this provides belt-and-suspenders protection against stale-closure overwrites.
  useEffect(() => {
    if (!user?.id) return;

    const pollInterval = setInterval(() => {
      fetchConversations();
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(pollInterval);
  }, [user?.id, activeFolder]);

  // Typing indicator polling
  useEffect(() => {
    if (!selectedConversation?.id || selectedConversation.is_new_chat) return;
    
    const fetchTypingUsers = async () => {
      try {
        const response = await apiClient.get(`/messages/typing/${selectedConversation.id}`);
        setTypingUsers(response.data.typing_users || []);
      } catch (error) { /* typing indicator is non-critical, ignore poll failures */ }
    };

    fetchTypingUsers();
    const interval = setInterval(fetchTypingUsers, 5000);
    return () => clearInterval(interval);
  }, [selectedConversation?.id, user?.id]);

  // Track whether initial scroll has happened for this conversation
  const initialScrollDoneRef = useRef(false);
  
  // Reset initial scroll flag when conversation changes
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [selectedConvId]);

  const scrollToBottom = (instant = false) => {
    // Use rAF + microtask to ensure scroll happens AFTER React has
    // committed DOM updates and the browser has painted. Without this,
    // scrollIntoView fires before message elements are laid out.
    requestAnimationFrame(() => {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ 
          behavior: instant || !initialScrollDoneRef.current ? 'auto' : 'smooth' 
        });
        initialScrollDoneRef.current = true;
      }, 0);
    });
  };

  // AbortController ref - cancels in-flight conversation fetches when the user
  // switches folders. This prevents stale responses from overwriting fresh data.
  const fetchAbortRef = useRef(null);

  // ============ HANDLERS EXTRACTED TO hooks/useMessagesActions.js ============
  const {
    loadConversationById,
    startNewConversation,
    handleBackNavigation,
    fetchConversations,
    fetchConversationDetail,
    fetchStories,
    createNote,
    replyToNote,
    handleNoteClick,
    fetchCrewChats,
    handleReaction,
    handleAcceptRequest,
    handleDeclineRequest,
    handleTogglePin,
    handleToggleMute,
    handleMarkUnread,
    handleDeleteConversation,
    handleAcceptAllRequests,
    handleMediaUpload,
    handleEphemeralMediaUpload,
    handleVoiceNoteSent,
    handleComposeNew,
    handleComposeSelectUser,
  } = useMessagesActions({
    user, navigate, selectedConversation, conversationDetail, conversations,
    replyingTo, fromProfileId, activeFolderRef, fetchAbortRef,
    setLoading, setConversations, setFolderCounts,
    setSelectedConversation, setConversationDetail, setNewMessage,
    setSendingMessage, setReplyingTo, setNewChatRecipient,
    setStories, setMyNote, setNotesFeed, setActiveFolder,
    setShowCreateNoteModal, setShowViewNoteModal, setSelectedNote,
    setCrewChats, setCrewChatsLoading, setShowVoiceRecorder,
    setIsComposeModalOpen, setSearchParams,
  });

  // Fetch crew chats when folder changes to crew_chats
  useEffect(() => {
    if (activeFolder === 'crew_chats' && user?.id) {
      fetchCrewChats();
    }
  }, [activeFolder, user?.id]);

  const sendTypingIndicator = useCallback(async (isTyping) => {
    if (!selectedConversation?.id || selectedConversation.is_new_chat) return;
    try {
      await apiClient.post(`/messages/typing/${selectedConversation.id}`, { is_typing: isTyping });
    } catch (error) { /* typing indicator fire-and-forget, ignore network errors */ }
  }, [selectedConversation, user?.id]);

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    sendTypingIndicator(true);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => sendTypingIndicator(false), 2000);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConversation) return;

    const messageContent = newMessage.trim();
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // -- Optimistic insert: show message instantly --
    setConversationDetail(prev => {
      if (!prev?.messages) return prev;
      return {
        ...prev,
        messages: [...prev.messages, {
          id: tempId,
          sender_id: user.id,
          content: messageContent,
          message_type: 'text',
          created_at: new Date().toISOString(),
          reply_to_id: replyingTo?.id || null,
          is_read: false,
          reactions: [],
          sender_name: user.full_name || 'You',
          sender_avatar: user.avatar_url,
          _optimistic: true,
        }]
      };
    });
    
    setNewMessage('');
    setReplyingTo(null);
    setSendingMessage(true);
    sendTypingIndicator(false);
    
    try {
      const response = await apiClient.post(`/messages/send?sender_id=${user.id}`, {
        recipient_id: selectedConversation.other_user_id,
        content: messageContent,
        reply_to_id: replyingTo?.id || null
      });
      
      // Replace optimistic message with real one
      setConversationDetail(prev => {
        if (!prev?.messages) return prev;
        return {
          ...prev,
          messages: prev.messages.map(m => 
            m.id === tempId 
              ? { ...m, id: response.data.message_id || m.id, _optimistic: false }
              : m
          )
        };
      });
      
      if (selectedConversation.is_new_chat && response.data.conversation_id) {
        setSelectedConversation(prev => ({
          ...prev,
          id: response.data.conversation_id,
          is_new_chat: false
        }));
        setNewChatRecipient(null);
        navigate(`/messages/${response.data.conversation_id}`, { replace: true, state: { fromProfile: fromProfileId } });
      }
      
      fetchConversations();
    } catch (error) {
      // Remove optimistic message on failure
      setConversationDetail(prev => {
        if (!prev?.messages) return prev;
        return {
          ...prev,
          messages: prev.messages.filter(m => m.id !== tempId)
        };
      });
      toast.error('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  // Handle sending a GIF
  const handleSendGif = async (gifUrl) => {
    if (!gifUrl) {
      toast.error('No GIF selected');
      return;
    }
    if (!selectedConversation) {
      toast.error('No conversation selected');
      return;
    }
    if (!selectedConversation.other_user_id) {
      toast.error('Cannot determine recipient');
      logger.error('[Messages] GIF send failed - no other_user_id:', selectedConversation);
      return;
    }
    
    setSendingMessage(true);
    try {
      logger.debug('[Messages] Sending GIF:', { gifUrl, recipientId: selectedConversation.other_user_id });
      const response = await apiClient.post(`/messages/send?sender_id=${user.id}`, {
        recipient_id: selectedConversation.other_user_id,
        content: '', // No text content for GIF
        message_type: 'gif',
        media_url: gifUrl
      });
      
      logger.debug('[Messages] GIF sent successfully:', response.data);
      
      if (selectedConversation.is_new_chat && response.data.conversation_id) {
        setSelectedConversation(prev => ({
          ...prev,
          id: response.data.conversation_id,
          is_new_chat: false
        }));
        setNewChatRecipient(null);
        navigate(`/messages/${response.data.conversation_id}`, { replace: true });
      }
      
      const convId = response.data.conversation_id || selectedConversation.id;
      if (convId) fetchConversationDetail(convId);
      fetchConversations();
      toast.success('GIF sent!');
    } catch (error) {
      logger.error('[Messages] Failed to send GIF:', error.response?.data || error.message);
      toast.error(error.response?.data?.detail || 'Failed to send GIF');
    } finally {
      setSendingMessage(false);
    }
  };

  // Filter conversations by search AND by active folder.
  // The folder filter is CRITICAL: it prevents conversations from the previous
  // tab from flashing in the new tab during the React render cycle. Without this,
  // switching from Channel (7 items) to Requests (0 items) shows Channel items
  // for one frame because state updates (useEffect) run AFTER the render.

  // Render conversation list (extracted to messages/ConversationListPanel.js)
  const renderConversationList = () => (
    <ConversationListPanel
      msgPullRef={msgPullRef} msgPulling={msgPulling} msgPullProgress={msgPullProgress} msgPtrRefreshing={msgPtrRefreshing}
      user={user} effectiveRole={effectiveRole} isMasked={isMasked} isGodMode={isGodMode}
      activeFolder={activeFolder} setActiveFolder={setActiveFolder}
      conversations={conversations} folderCounts={folderCounts}
      selectedConversation={selectedConversation} setSelectedConversation={setSelectedConversation}
      searchQuery={searchQuery} setSearchQuery={setSearchQuery}
      stories={stories} loading={loading}
      showMobileTools={showMobileTools} setShowMobileTools={setShowMobileTools}
      crewChats={crewChats} crewChatsLoading={crewChatsLoading}
      isOnline={isOnline}
      handleComposeNew={handleComposeNew} handleNoteClick={handleNoteClick}
      handleAcceptAllRequests={handleAcceptAllRequests}
      navigate={navigate}
    />
  );

  // Render chat view (extracted to messages/ChatViewPanel.js)
  const renderChatView = () => (
    <ChatViewPanel
      user={user}
      selectedConversation={selectedConversation} conversationDetail={conversationDetail}
      newMessage={newMessage} setNewMessage={setNewMessage} sendingMessage={sendingMessage}
      replyingTo={replyingTo} setReplyingTo={setReplyingTo}
      typingUsers={typingUsers}
      showVoiceRecorder={showVoiceRecorder} setShowVoiceRecorder={setShowVoiceRecorder}
      showVideoCapture={showVideoCapture} setShowVideoCapture={setShowVideoCapture}
      showEmojiPicker={showEmojiPicker} setShowEmojiPicker={setShowEmojiPicker}
      showGifPicker={showGifPicker} setShowGifPicker={setShowGifPicker}
      messagesEndRef={messagesEndRef} fileInputRef={fileInputRef}
      isOnline={isOnline}
      handleBackNavigation={handleBackNavigation}
      handleSendMessage={handleSendMessage} handleSendGif={handleSendGif}
      handleInputChange={handleInputChange}
      handleReaction={handleReaction}
      handleAcceptRequest={handleAcceptRequest} handleDeclineRequest={handleDeclineRequest}
      handleTogglePin={handleTogglePin} handleToggleMute={handleToggleMute}
      handleMarkUnread={handleMarkUnread} handleDeleteConversation={handleDeleteConversation}
      handleMediaUpload={handleMediaUpload} handleEphemeralMediaUpload={handleEphemeralMediaUpload}
      handleVoiceNoteSent={handleVoiceNoteSent}
      navigate={navigate}
    />
  );


  // Render empty state for desktop
  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center h-full bg-background text-center px-8">
      <div className="w-24 h-24 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center mb-6">
        <ShakaIcon className="w-16 h-16 text-muted-foreground/50" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Your messages</h2>
      <p className="text-muted-foreground text-sm mb-6">Send a message to start a session.</p>
      <Button 
        onClick={handleComposeNew}
        className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold px-6"
      >
        Send message
      </Button>
    </div>
  );

  return (
    <div className="h-full flex bg-background" data-testid="messages-page">
      {/* Desktop: Split Pane Layout */}
      <div className="hidden md:flex w-full">
        {/* Left Sidebar - Conversation List */}
        <div className="w-80 lg:w-96 border-r border-border flex-shrink-0">
          {renderConversationList()}
        </div>
        
        {/* Main Workspace */}
        <div className="flex-1">
          {selectedConversation ? renderChatView() : renderEmptyState()}
        </div>
      </div>

      {/* Mobile: Full screen with transitions */}
      <div className="md:hidden w-full h-full">
        {selectedConversation ? renderChatView() : renderConversationList()}
      </div>

      {/* Compose Modal */}
      <ComposeModal
        isOpen={isComposeModalOpen}
        onClose={() => setIsComposeModalOpen(false)}
        onSelectUser={handleComposeSelectUser}
        currentUserId={user?.id}
      />
      
      {/* Create Note Modal */}
      <CreateNoteModal
        isOpen={showCreateNoteModal}
        onClose={() => setShowCreateNoteModal(false)}
        onSubmit={createNote}
      />
      
      {/* View Note Modal */}
      <ViewNoteModal
        isOpen={showViewNoteModal}
        onClose={() => { setShowViewNoteModal(false); setSelectedNote(null); }}
        note={selectedNote}
        currentUserId={user?.id}
        onReply={replyToNote}
      />
    </div>
  );
};

export default MessagesPage;
