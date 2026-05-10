/**
 * useMessagesActions.js
 * Extracted from MessagesPage.js — API handler logic for messaging.
 * 
 * Note: useCallback/useRef/useEffect-based handlers remain in the parent
 * component since they require React hook context. Only pure API handlers
 * are extracted here.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getFullUrl, cacheBustUrl } from '../utils/media';

const useMessagesActions = ({
  user,
  navigate,
  selectedConversation,
  conversationDetail,
  conversations,
  replyingTo,
  fromProfileId,
  activeFolderRef,
  setLoading,
  setConversations,
  setFolderCounts,
  setSelectedConversation,
  setConversationDetail,
  setNewMessage,
  setSendingMessage,
  setReplyingTo,
  setNewChatRecipient,
  setStories,
  setMyNote,
  setNotesFeed,
  setActiveFolder,
  setShowCreateNoteModal,
  setShowViewNoteModal,
  setSelectedNote,
  setCrewChats,
  setCrewChatsLoading,
  setShowVoiceRecorder,
  setIsComposeModalOpen,
  setSearchParams,
  fetchAbortRef,
}) => {

  const loadConversationById = async (convId) => {
    if (!user?.id) {
      logger.error('[Messages] Cannot load conversation - user not authenticated');
      return;
    }
    try {
      logger.debug('[Messages] Fetching conversation:', convId);
      const response = await apiClient.get(`/messages/conversation/${convId}?user_id=${user.id}`);
      setSelectedConversation({
        id: convId,
        other_user_id: response.data.other_user_id,
        other_user_name: response.data.other_user_name,
        other_user_avatar: response.data.other_user_avatar,
        is_request: response.data.is_request
      });
      setConversationDetail(response.data);
      logger.debug('[Messages] Conversation loaded successfully');
    } catch (error) {
      logger.error('[Messages] Failed to load conversation:', error.response?.data || error.message);
      toast.error('Conversation not found');
      navigate('/messages');
    }
  };

  const startNewConversation = async (targetRecipientId) => {
    try {
      const response = await apiClient.post(`/messages/start-conversation?sender_id=${user.id}&recipient_id=${targetRecipientId}`);
      setSearchParams({});
      await fetchConversations();
      setSelectedConversation({
        id: response.data.conversation_id,
        other_user_id: response.data.recipient_id,
        other_user_name: response.data.recipient_name,
        other_user_avatar: response.data.recipient_avatar
      });
      setNewChatRecipient(null);
    } catch (error) {
      toast.error('Failed to start conversation');
      setSearchParams({});
    }
  };

  const handleBackNavigation = () => {
    if (fromProfileId) {
      navigate(`/profile/${fromProfileId}`);
    } else if (selectedConversation?.is_new_chat) {
      navigate(`/profile/${selectedConversation.other_user_id}`);
    } else {
      setSelectedConversation(null);
      setConversationDetail(null);
      setNewChatRecipient(null);
      navigate('/messages');
    }
  };

  const fetchConversations = async () => {
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const abortController = new AbortController();
    fetchAbortRef.current = abortController;

    try {
      const currentFolder = activeFolderRef.current;
      const isGromZone = currentFolder === 'grom_zone';
      const isFamily = currentFolder === 'family';
      
      let path;
      if (isGromZone) {
        path = `/messages/conversations/${user.id}?inbox_type=primary&grom_zone=true`;
      } else if (isFamily) {
        path = `/messages/conversations/${user.id}/family`;
      } else {
        path = `/messages/conversations/${user.id}?inbox_type=${currentFolder}`;
      }
      
      const [response, countsResp, familyCountResp] = await Promise.all([
        apiClient.get(path, { signal: abortController.signal }),
        apiClient.get(`/messages/unread-counts/${user.id}`, { signal: abortController.signal }).catch(() => ({ data: { primary: 0, requests: 0, grom_zone: 0 } })),
        apiClient.get(`/messages/conversations/${user.id}/family`, { signal: abortController.signal }).catch(() => ({ data: [] }))
      ]);
      
      if (activeFolderRef.current !== currentFolder) {
        return;
      }

      setConversations(response.data);
      
      const unreadData = countsResp.data;
      const familyUnread = (familyCountResp.data || []).filter(c => c.unread_count > 0).length;
      
      setFolderCounts({
        primary: unreadData.primary || 0,
        requests: unreadData.requests || 0,
        grom_zone: unreadData.grom_zone || 0,
        family: familyUnread,
        pro_lounge: currentFolder === 'pro_lounge' ? (response.data || []).filter(c => c.unread_count > 0).length : 0,
        channel: currentFolder === 'channel' ? (response.data || []).filter(c => c.unread_count > 0).length : 0,
        hidden: 0
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
        return;
      }
      logger.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConversationDetail = async (convId) => {
    try {
      const response = await apiClient.get(`/messages/conversation/${convId}?user_id=${user.id}`);
      setConversationDetail(response.data);
      
      // Optimistic unread clearing: the backend marks messages as read
      // when GET /conversation/{id} is called, but the conversation list
      // won't update until the next 10s poll. Immediately zero out the
      // unread_count and is_manually_unread for this conversation in local
      // state so the sidebar badge disappears instantly.
      setConversations(prev => prev.map(c => 
        c.id === convId 
          ? { ...c, unread_count: 0, is_manually_unread: false }
          : c
      ));
    } catch (error) {
      logger.error('Failed to fetch conversation:', error);
    }
  };

  const fetchStories = async () => {
    try {
      const response = await apiClient.get(`/notes/feed`);
      const { own_note, feed } = response.data;
      
      let freshAvatarUrl = user?.avatar_url ? getFullUrl(user.avatar_url) : null;
      try {
        const profileResp = await apiClient.get(`/profiles/${user.id}`);
        freshAvatarUrl = profileResp.data.avatar_url ? getFullUrl(profileResp.data.avatar_url) : null;
      } catch (e) {
        logger.debug('Could not fetch fresh profile, using context avatar');
      }
      
      const avatarWithCacheBust = cacheBustUrl(freshAvatarUrl);
      setMyNote(own_note);
      setNotesFeed(feed || []);
      
      const storiesArray = [];
      storiesArray.push({
        id: 'own', name: 'Your note', avatar: avatarWithCacheBust, type: 'note',
        hasUnread: false, isOwnNote: true, noteContent: own_note?.content || '',
        timeRemaining: own_note?.time_remaining || '', noteData: own_note
      });
      
      for (const note of (feed || [])) {
        const resolvedNoteAvatar = note.user_avatar ? getFullUrl(note.user_avatar) : null;
        storiesArray.push({
          id: note.id, name: note.user_name?.split(' ')[0] || 'User',
          avatar: cacheBustUrl(resolvedNoteAvatar), type: 'note', hasUnread: true,
          isOwnNote: false, noteContent: note.content, timeRemaining: note.time_remaining,
          noteData: note
        });
      }
      
      setStories(storiesArray);
    } catch (error) {
      logger.error('Failed to fetch notes:', error);
      let fallbackAvatar = user?.avatar_url ? getFullUrl(user.avatar_url) : null;
      try {
        const profileResp = await apiClient.get(`/profiles/${user.id}`);
        fallbackAvatar = profileResp.data.avatar_url ? getFullUrl(profileResp.data.avatar_url) : null;
      } catch (e) { /* fallback */ }
      
      setStories([{
        id: 'own', name: 'Your note', avatar: cacheBustUrl(fallbackAvatar), type: 'note',
        hasUnread: false, isOwnNote: true, noteContent: '', timeRemaining: ''
      }]);
    }
  };

  const createNote = async (content) => {
    try {
      await apiClient.post(`/notes/create`, { content });
      toast.success('Note shared!');
      fetchStories();
    } catch (error) {
      logger.error('Failed to create note:', error);
      throw error;
    }
  };

  const replyToNote = async (noteId, replyText) => {
    try {
      const response = await apiClient.post(`/notes/${noteId}/reply`, { reply_text: replyText });
      if (response.data.conversation_id) {
        navigate(`/messages/${response.data.conversation_id}`);
      }
    } catch (error) {
      logger.error('Failed to reply to note:', error);
      throw error;
    }
  };

  const handleNoteClick = (story) => {
    if (story.isOwnNote) {
      setShowCreateNoteModal(true);
    } else if (story.noteData) {
      setSelectedNote(story.noteData);
      setShowViewNoteModal(true);
    }
  };

  const fetchCrewChats = async () => {
    if (!user?.id) return;
    setCrewChatsLoading(true);
    try {
      const response = await apiClient.get(`/bookings/user/${user.id}`);
      const bookings = response.data || [];
      const activeBookings = bookings.filter(b => 
        b.status === 'Confirmed' || b.status === 'Pending' || b.status === 'In Progress'
      );
      const chatsWithInfo = await Promise.all(
        activeBookings.map(async (booking) => {
          try {
            const chatInfo = await apiClient.get(`/crew-chat/${booking.id}/info`);
            return { ...booking, chatInfo: chatInfo.data, unread_count: chatInfo.data.unread_count || 0 };
          } catch (e) {
            return { ...booking, chatInfo: null, unread_count: 0 };
          }
        })
      );
      setCrewChats(chatsWithInfo.filter(c => c.chatInfo !== null));
      const unreadCount = chatsWithInfo.reduce((acc, c) => acc + (c.unread_count || 0), 0);
      setFolderCounts(prev => ({ ...prev, crew_chats: unreadCount > 0 ? 1 : 0 }));
    } catch (error) {
      logger.error('Failed to fetch crew chats:', error);
      setCrewChats([]);
    } finally {
      setCrewChatsLoading(false);
    }
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      await apiClient.post(`/messages/react/${messageId}?user_id=${user.id}`, { emoji });
      fetchConversationDetail(selectedConversation.id);
    } catch (error) {
      toast.error('Failed to add reaction');
    }
  };

  const handleAcceptRequest = async () => {
    try {
      await apiClient.post(`/messages/accept/${selectedConversation.id}`);
      toast.success('Moved to Primary inbox');
      fetchConversations();
      fetchConversationDetail(selectedConversation.id);
    } catch (error) {
      toast.error('Failed to accept request');
    }
  };

  const handleDeclineRequest = async () => {
    try {
      await apiClient.delete(`/messages/conversation/${selectedConversation.id}?user_id=${user.id}`);
      toast.success('Request declined');
      setSelectedConversation(null);
      setConversationDetail(null);
      navigate('/messages');
      fetchConversations();
    } catch (error) {
      toast.error('Failed to decline request');
    }
  };

  const handleTogglePin = async () => {
    if (!selectedConversation?.id) return;
    try {
      const response = await apiClient.post(`/messages/conversation/${selectedConversation.id}/pin?user_id=${user.id}`);
      toast.success(response.data.message);
      fetchConversations();
      if (conversationDetail) {
        setConversationDetail(prev => ({...prev, is_pinned: response.data.is_pinned}));
      }
    } catch (error) {
      toast.error('Failed to update pin status');
    }
  };

  const handleToggleMute = async () => {
    if (!selectedConversation?.id) return;
    try {
      const response = await apiClient.post(`/messages/conversation/${selectedConversation.id}/mute?user_id=${user.id}`);
      toast.success(response.data.message);
      fetchConversations();
      if (conversationDetail) {
        setConversationDetail(prev => ({...prev, is_muted: response.data.is_muted}));
      }
    } catch (error) {
      toast.error('Failed to update mute status');
    }
  };

  const handleMarkUnread = async () => {
    if (!selectedConversation?.id) return;
    try {
      const response = await apiClient.post(`/messages/conversation/${selectedConversation.id}/mark-unread?user_id=${user.id}`);
      toast.success(response.data.message);
      fetchConversations();
      if (conversationDetail) {
        setConversationDetail(prev => ({...prev, is_manually_unread: response.data.is_unread}));
      }
    } catch (error) {
      toast.error('Failed to mark as unread');
    }
  };

  const handleDeleteConversation = async () => {
    if (!selectedConversation?.id) return;
    if (!window.confirm('Delete this conversation? It will be hidden from your inbox.')) return;
    try {
      await apiClient.delete(`/messages/conversation/${selectedConversation.id}?user_id=${user.id}`);
      toast.success('Conversation deleted');
      setSelectedConversation(null);
      setConversationDetail(null);
      navigate('/messages');
      fetchConversations();
    } catch (error) {
      toast.error('Failed to delete conversation');
    }
  };

  const handleAcceptAllRequests = async () => {
    const requestConversations = conversations.filter(c => c.folder === 'requests' || c.is_request);
    if (requestConversations.length === 0) { toast.info('No requests to accept'); return; }
    try {
      await Promise.all(requestConversations.map(conv => apiClient.post(`/messages/accept/${conv.id}`)));
      toast.success(`Accepted ${requestConversations.length} request${requestConversations.length > 1 ? 's' : ''}`);
      fetchConversations();
      setActiveFolder('primary');
    } catch (error) {
      logger.error('Failed to accept all requests:', error);
      toast.error('Failed to accept some requests');
      fetchConversations();
    }
  };

  const handleMediaUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversation_id', selectedConversation.id || '');
    formData.append('sender_id', user.id);
    formData.append('recipient_id', selectedConversation.other_user_id);
    if (file.type.startsWith('video/')) {
      formData.append('message_type_override', 'ephemeral_video');
    }
    try {
      await apiClient.post(`/messages/media`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(file.type.startsWith('video/') ? 'Disappearing video sent!' : 'Media sent!');
      if (selectedConversation.id) fetchConversationDetail(selectedConversation.id);
      fetchConversations();
    } catch (error) {
      toast.error('Failed to upload media');
    }
  };

  const handleEphemeralMediaUpload = async (files) => {
    const file = files?.[0];
    if (!file || !selectedConversation) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversation_id', selectedConversation.id || '');
    formData.append('sender_id', user.id);
    formData.append('recipient_id', selectedConversation.other_user_id);
    formData.append('message_type_override', 'ephemeral_video');
    try {
      await apiClient.post(`/messages/media`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Disappearing video sent!');
      if (selectedConversation.id) fetchConversationDetail(selectedConversation.id);
      fetchConversations();
    } catch (error) {
      toast.error('Failed to send video');
    }
  };

  const handleVoiceNoteSent = () => {
    setShowVoiceRecorder(false);
    if (selectedConversation?.id) fetchConversationDetail(selectedConversation.id);
    fetchConversations();
  };

  const handleComposeNew = () => {
    setIsComposeModalOpen(true);
  };

  const handleComposeSelectUser = async (selectedUser) => {
    try {
      const response = await apiClient.get(`/messages/check-thread/${user.id}/${selectedUser.id}`);
      if (response.data.exists) {
        navigate(`/messages/${response.data.conversation_id}`);
        setSelectedConversation({
          id: response.data.conversation_id,
          other_user_id: selectedUser.id,
          other_user_name: selectedUser.name,
          other_user_avatar: selectedUser.avatar
        });
      } else {
        setSelectedConversation({
          id: null, other_user_id: selectedUser.id, other_user_name: selectedUser.name,
          other_user_avatar: selectedUser.avatar, is_new_chat: true
        });
        navigate(`/messages/new/${selectedUser.id}`, {
          state: { recipientName: selectedUser.name, recipientAvatar: selectedUser.avatar }
        });
      }
    } catch (error) {
      toast.error('Failed to check conversation');
    }
  };

  return {
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
  };
};

export default useMessagesActions;
