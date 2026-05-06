import React, { useState, useEffect, useRef, useCallback } from 'react';
// Build trigger: 2026-04-30
import apiClient from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePersona, getExpandedRoleInfo, isProLevelRole, isBusinessRole as isBusinessRoleCheck } from '../contexts/PersonaContext';
import { useSearchParams, useNavigate, useParams, useLocation } from 'react-router-dom';
import { 
  Search, Send, ChevronLeft, MoreHorizontal, Check, CheckCheck, 
  X, Mic, Image, Camera, Play, Edit3, Video, Phone, PhoneCall,
  Reply, Smile, Heart, Shield, Users, EyeOff, Filter, Star, Store, Briefcase, Pin, BellOff, Mail, Trash2, Clock
} from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { toast } from 'sonner';
import VoiceRecorder from './VoiceRecorder';
import WebcamCaptureModal from './WebcamCaptureModal';
import { supabase } from '../lib/supabase';
import logger from '../utils/logger';
import useMessagesActions from '../hooks/useMessagesActions';
import { getFullUrl, cacheBustUrl } from '../utils/media';
import GifPicker from './messages/GifPicker';
import EmojiPicker from './messages/EmojiPicker';
import EphemeralCountdown from './messages/EphemeralCountdown';
import ComposeModal from './messages/ComposeModal';
import ConversationItem from './messages/ConversationItem';
import usePullToRefresh from '../hooks/usePullToRefresh';
import PullToRefreshIndicator from './ui/PullToRefreshIndicator';
import MessageBubble from './messages/MessageBubble';
import StoryBubble from './messages/StoryBubble';
import CreateNoteModal from './messages/CreateNoteModal';
import ViewNoteModal from './messages/ViewNoteModal';
import { ROLES } from '../constants/roles';
import usePresence from '../hooks/usePresence';

// Role-based icon helper - uses expanded PersonaContext
const getRoleIcon = (role, isAdmin = false) => {
  const _roleInfo = getExpandedRoleInfo(role, isAdmin);
  if (isAdmin) return { icon: Shield, color: 'text-red-500', label: 'God Mode', emoji: '\u{1F6E1}\u{FE0F}' };
  
  // Map to lucide icons for non-emoji contexts
  switch (role) {
    case 'Pro':
        case 'Comp Surfer':
      return { icon: Star, color: 'text-amber-400', label: 'Pro', emoji: '\u{2B50}' };
    case 'Approved Pro':
      return { icon: Camera, color: 'text-blue-400', label: 'Pro Photographer', emoji: '\u{1F4F8}' };
    case 'Photographer':
      return { icon: Camera, color: 'text-purple-400', label: 'Photographer', emoji: '\u{1F4F7}' };
    case 'Hobbyist':
      return { icon: Search, color: 'text-indigo-400', label: 'Hobbyist', emoji: '\u{1F3C4}' };
    case 'Shop':
      return { icon: Store, color: 'text-pink-400', label: 'Surf Shop', emoji: '\u{1F6CD}\u{FE0F}' };
    case 'Surf School':
      return { icon: Users, color: 'text-teal-400', label: 'Surf School', emoji: '\u{1F3EB}' };
    case 'Shaper':
      return { icon: Briefcase, color: 'text-orange-400', label: 'Shaper', emoji: '\u{1FA93}' };
    case 'Resort':
      return { icon: Store, color: 'text-emerald-400', label: 'Resort', emoji: '\u{1F3D6}\u{FE0F}' };
    default:
      return { icon: null, color: 'text-cyan-400', label: 'Surfer', emoji: '\u{1F30A}' };
  }
};

// Check if user is a Pro (for Pro Lounge access)
const isProRole = (role) => isProLevelRole(role);

// Check if user is Business/Photographer
const isBusinessRole = (role) => isBusinessRoleCheck(role);

// Updated folder system with Pro Lounge and The Channel
const getFolders = (userRole, _isAdmin = false, effectiveRole = null, _isMasked = false, isGromParentFlag = false) => {
  // Use effective role if God Mode is masking
  const roleToCheck = effectiveRole || userRole;
  // Pro Lounge access: ONLY for 'Pro' or 'God' roles
  // Admin status alone does NOT grant Pro Lounge access (e.g., Comp Surfer admin should NOT see Pro Lounge)
  // When masking, use the masked role; otherwise use the actual role
  const isPro = isProRole(roleToCheck);
  const _isBusiness = isBusinessRole(roleToCheck);
  const isGrom = roleToCheck === ROLES.GROM || roleToCheck === 'GROM';
  const isGromParent = roleToCheck === ROLES.GROM_PARENT || roleToCheck === 'GROM_PARENT' || roleToCheck === 'grom_parent' || isGromParentFlag;
  
  const folders = [];
  
  // PRIMARY - Standard surfer-to-surfer communication (visible to all)
  // This is the main inbox for direct messages between surfers
  folders.push({ 
    id: 'primary', 
    label: isGrom ? 'Grom Zone' : 'Primary', 
    icon: Users, 
    color: 'text-cyan-400', 
    description: isGrom ? 'Chat with other Groms' : 'Friends & surfers',
    emoji: '\u{1F4AC}'
  });
  
  // FAMILY CHAT - Grom Parents chat with their linked Groms
  if (isGromParent) {
    folders.push({ 
      id: 'family', 
      label: 'Family', 
      icon: Users, 
      color: 'text-cyan-400', 
      description: 'Chat with your linked Groms',
      emoji: '\u{1F46A}',
      isFamilyOnly: true
    });
  }
  
  // Family chat for Groms to chat with their parent
  if (isGrom) {
    folders.push({ 
      id: 'family', 
      label: 'Family', 
      icon: Users, 
      color: 'text-emerald-400', 
      description: 'Chat with your parent',
      emoji: '\u{1F46A}',
      isFamilyOnly: true
    });
  }
  
  // The Pro Lounge - Only visible to Pro users
  if (isPro) {
    folders.push({ 
      id: 'pro_lounge', 
      label: 'Pro Lounge', 
      icon: Star, 
      color: 'text-amber-400', 
      description: 'Private athlete ecosystem',
      emoji: '\u{1F451}'
    });
  }
  
  // The Channel - Business communication (always visible, but NOT for Groms)
  if (!isGrom) {
    folders.push({ 
      id: 'channel', 
      label: 'The Channel', 
      icon: Briefcase, 
      color: 'text-purple-400', 
      description: 'Business & photographer hub',
      emoji: '\u{1F4BC}'
    });
  }
  
  // Requests
  folders.push({ 
    id: 'requests', 
    label: 'Requests', 
    icon: Smile, 
    color: 'text-orange-400', 
    description: 'Message requests',
    emoji: '\u{1F4E9}'
  });
  
  // Hidden
  folders.push({ 
    id: 'hidden', 
    label: 'Hidden', 
    icon: EyeOff, 
    color: 'text-gray-500', 
    description: 'Muted conversations',
    emoji: '\u{1F648}'
  });
  
  return folders;
};

// GifPicker extracted to ./messages/GifPicker.js

// Shaka SVG Icon Component
const ShakaIcon = ({ className = "w-16 h-16" }) => (
  <svg className={className} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 44 C18 42 16 38 16 32 C16 26 18 22 22 20 L26 18 C28 17 30 18 30 20 L30 28" strokeLinecap="round" />
    <path d="M30 28 L30 16 C30 14 32 12 34 12 C36 12 38 14 38 16 L38 28" strokeLinecap="round" />
    <path d="M38 20 L38 14 C38 12 40 10 42 10 C44 10 46 12 46 14 L46 28" strokeLinecap="round" />
    <path d="M46 22 L46 18 C46 16 48 14 50 14 C52 14 54 16 54 18 L54 32 C54 42 48 50 38 52 L28 54 C24 54 20 52 18 48" strokeLinecap="round" />
    <path d="M30 28 L26 32 C24 34 22 38 22 42" strokeLinecap="round" />
  </svg>
);

// StoryBubble extracted ? ./messages/StoryBubble.js
// CreateNoteModal extracted ? ./messages/CreateNoteModal.js
// ViewNoteModal extracted ? ./messages/ViewNoteModal.js

// Conversation List Item Component
// ConversationItem extracted ? ./messages/ConversationItem.js

// Emoji Picker Component
// EmojiPicker extracted ? ./messages/EmojiPicker.js
// EphemeralCountdown - Live ticking countdown badge for 24hr ephemeral videos
// Uses setInterval to update every minute so the display actually ticks down
// EphemeralCountdown extracted ? ./messages/EphemeralCountdown.js

// Message Bubble Component
// MessageBubble extracted ? ./messages/MessageBubble.js

// Helper functions
// formatTime was consolidated into ../utils/formatTime.js (formatClockTime)



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
    messagesEndRef.current?.scrollIntoView({ 
      behavior: instant || !initialScrollDoneRef.current ? 'auto' : 'smooth' 
    });
    initialScrollDoneRef.current = true;
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
  let filteredConversations = [];
  try {
    filteredConversations = conversations
      .filter(c => {
        // Folder guard: only show conversations that belong to the active folder.
        // The backend already returns folder-filtered data, but during tab
        // transitions, stale data from the previous folder may still be in state.
        if (c.folder && c.folder !== activeFolder) return false;
        // Search filter
        return (c?.other_user_name || '').toLowerCase().includes((searchQuery || '').toLowerCase());
      })
      .sort((a, b) => {
        // Pinned conversations first
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // Then by last message time
        const bTime = new Date(b.last_message_at || 0).getTime();
        const aTime = new Date(a.last_message_at || 0).getTime();
        return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
      });
  } catch (err) {
    logger.error('Error filtering conversations:', err);
  }

  // Render conversation list (shared between mobile and desktop)
  const renderConversationList = () => {
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
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
          />
        </div>
      </div>

      {/* Stories/Notes Section */}
      <div className="px-2 pt-4 pb-3 border-b border-border">
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {stories.map((story) => (
            <StoryBubble 
              key={story.id} 
              story={story} 
              onClick={handleNoteClick}
              isOwnNote={story.isOwnNote}
            />
          ))}
        </div>
      </div>

      {/* Folder Tabs - Dynamic based on effective role (respects God Mode masking) */}
      <div className="relative">
        {/* Scroll indicators */}
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
        {/* Crew Chats Folder - Special rendering */}
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
                  {/* Session Icon */}
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  
                  {/* Chat Info */}
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
                  
                  {/* Arrow */}
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
      logger.error('Error in renderConversationList:', err);
      return <div className="p-4 text-red-500">List Error: {err.toString()}</div>;
    }
  };

  // Render chat view
  const renderChatView = () => {
    // Cache-bust avatar URL to prevent stale images
    const rawChatAvatarUrl = conversationDetail?.other_user_avatar || selectedConversation?.other_user_avatar;
    const chatAvatarUrl = rawChatAvatarUrl ? getFullUrl(rawChatAvatarUrl) : null;
    const chatAvatarWithCacheBust = cacheBustUrl(chatAvatarUrl, conversationDetail?.last_message_at);
    
    return (
    <div className="flex flex-col h-full bg-background messages-chat-view">
      {/* Chat Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <button aria-label="Previous"
          onClick={handleBackNavigation}
          className="text-muted-foreground hover:text-foreground"
          data-testid="back-button"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          onClick={() => navigate(`/profile/${conversationDetail?.other_user_id || selectedConversation?.other_user_id}`)}
          className="w-10 h-10 rounded-full bg-muted overflow-hidden ring-2 ring-cyan-500/30 hover:ring-cyan-400 hover:scale-105 transition-all flex-shrink-0 relative"
          title="View profile"
        >
          {chatAvatarWithCacheBust ? (
            <img loading="lazy" decoding="async" 
              src={chatAvatarWithCacheBust} 
              className="w-full h-full object-cover" 
              alt=""
              onError={(e) => {
                e.target.style.display = 'none';
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <span 
            className="w-full h-full flex items-center justify-center text-muted-foreground absolute inset-0"
            style={{ display: chatAvatarWithCacheBust ? 'none' : 'flex' }}
          >
            {(conversationDetail?.other_user_name || selectedConversation?.other_user_name)?.charAt(0)}
          </span>
        </button>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => navigate(`/profile/${conversationDetail?.other_user_id || selectedConversation?.other_user_id}`)}
            className="font-medium text-foreground hover:text-cyan-400 transition-colors text-left block truncate"
          >
            {conversationDetail?.other_user_name || selectedConversation?.other_user_name}
          </button>
          <div className="text-xs mt-0.5">
            {selectedConversation?.is_new_chat ? (
              <span className="text-muted-foreground">Start a conversation</span>
            ) : typingUsers.length > 0 ? (
              <span className="text-cyan-400 animate-pulse">typing...</span>
            ) : isOnline(conversationDetail?.other_user_id || selectedConversation?.other_user_id) ? (
              <span className="text-green-400">&#x25CF; Active now</span>
            ) : (() => {
              const lastActive = conversationDetail?.other_user_last_active;
              if (!lastActive) return <span className="text-muted-foreground">Active recently</span>;
              const lastActiveDate = new Date(lastActive);
              if (isNaN(lastActiveDate.getTime())) return <span className="text-muted-foreground">Active recently</span>;
              const diff = Math.floor((Date.now() - lastActiveDate.getTime()) / 1000);
              if (diff < 3600) return <span className="text-muted-foreground">Active {Math.floor(diff / 60)}m ago</span>;
              if (diff < 86400) return <span className="text-muted-foreground">Active {Math.floor(diff / 3600)}h ago</span>;
              return <span className="text-muted-foreground">Active {lastActiveDate.toLocaleDateString()}</span>;
            })()}
          </div>
        </div>
        
        {/* Call Buttons - Audio & Video */}
        {!selectedConversation?.is_new_chat && !selectedConversation?.is_request && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const callEvent = new CustomEvent('rawsurf:startCall', { 
                  detail: { 
                    targetUserId: selectedConversation?.other_user_id, 
                    callType: 'audio',
                    targetUserName: conversationDetail?.other_user_name || selectedConversation?.other_user_name,
                    targetUserAvatar: chatAvatarUrl,
                  }
                });
                window.dispatchEvent(callEvent);
              }}
              className="text-muted-foreground hover:text-cyan-400 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              title="Audio call"
              data-testid="audio-call-btn"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                const callEvent = new CustomEvent('rawsurf:startCall', { 
                  detail: { 
                    targetUserId: selectedConversation?.other_user_id, 
                    callType: 'video',
                    targetUserName: conversationDetail?.other_user_name || selectedConversation?.other_user_name,
                    targetUserAvatar: chatAvatarUrl,
                  }
                });
                window.dispatchEvent(callEvent);
              }}
              className="text-muted-foreground hover:text-cyan-400 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              title="Video call"
              data-testid="video-call-btn"
            >
              <Video className="w-5 h-5" />
            </button>
          </div>
        )}
        
        {/* Conversation Controls Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="More options" 
              className="text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-muted transition-colors"
              data-testid="conversation-menu-btn"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-popover border border-border">
            <DropdownMenuItem 
              onClick={handleMarkUnread}
              className="flex items-center justify-between cursor-pointer hover:bg-accent"
            >
              <span>{conversationDetail?.is_manually_unread ? 'Mark as read' : 'Mark as unread'}</span>
              <Mail className="w-5 h-5" />
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleTogglePin}
              className="flex items-center justify-between cursor-pointer hover:bg-accent"
            >
              <span>{conversationDetail?.is_pinned ? 'Unpin' : 'Pin'}</span>
              <Pin className="w-5 h-5" />
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleToggleMute}
              className="flex items-center justify-between cursor-pointer hover:bg-accent"
            >
              <span>{conversationDetail?.is_muted ? 'Unmute' : 'Mute'}</span>
              <BellOff className="w-5 h-5" />
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleDeleteConversation}
              className="flex items-center justify-between cursor-pointer text-red-500 hover:bg-red-500/10 hover:text-red-600"
            >
              <span>Delete</span>
              <Trash2 className="w-5 h-5" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Request Banner */}
      {conversationDetail?.is_request && (
        <div className="p-4 bg-muted border-b border-border">
          <p className="text-muted-foreground text-sm mb-3">This person isn't in your contacts. Accept to move to your primary inbox.</p>
          <div className="flex gap-2">
            <Button 
              onClick={handleAcceptRequest} 
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold"
              data-testid="accept-request-btn"
            >
              Accept
            </Button>
            <Button 
              onClick={handleDeclineRequest} 
              variant="outline"
              className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
              data-testid="decline-request-btn"
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {selectedConversation?.is_new_chat ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-full bg-muted overflow-hidden mb-4">
              {selectedConversation.other_user_avatar ? (
                <img loading="lazy" decoding="async" src={selectedConversation.other_user_avatar} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-3xl text-muted-foreground">
                  {selectedConversation.other_user_name?.charAt(0)}
                </span>
              )}
            </div>
            <h3 className="text-foreground font-semibold text-lg">{selectedConversation.other_user_name}</h3>
            <p className="text-muted-foreground text-sm mt-2">Send a message to start the conversation</p>
          </div>
        ) : (
          conversationDetail?.messages?.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onReact={handleReaction}
              onReply={(msg) => setReplyingTo(msg)}
              onNavigateProfile={(userId) => navigate(`/profile/${userId}`)}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Preview */}
      {replyingTo && (
        <div className="px-4 py-2 bg-muted border-t border-border flex items-center gap-2">
          <Reply className="w-4 h-4 text-cyan-400" />
          <span className="flex-1 text-sm text-muted-foreground truncate">Replying to: {replyingTo.content}</span>
          <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Message Input */}
      {(selectedConversation?.is_new_chat || !conversationDetail?.is_request) && (
        <div className="p-4 border-t border-border bg-muted/50 relative flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <WebcamCaptureModal
            isOpen={showVideoCapture}
            onClose={() => setShowVideoCapture(false)}
            onCapture={handleEphemeralMediaUpload}
            maxLength={30}
          />
          {/* GIF Picker - positioned above the entire input area */}
          <GifPicker
            show={showGifPicker}
            onSelect={(gifUrl) => {
              if (gifUrl) {
                handleSendGif(gifUrl);
                setShowGifPicker(false);
              }
            }}
            onClose={() => setShowGifPicker(false)}
          />
          
          {showVoiceRecorder ? (
            <VoiceRecorder
              conversationId={selectedConversation?.id}
              senderId={user.id}
              onSend={handleVoiceNoteSent}
              onCancel={() => setShowVoiceRecorder(false)}
            />
          ) : (
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              {/* Media upload button */}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors">
                <Image className="w-5 h-5" />
              </button>
              <input aria-label="Upload file" ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaUpload} className="hidden" />
              
              {/* GIF button */}
              <button 
                type="button" 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGifPicker(prev => !prev);
                }}
                className={`p-2 transition-colors touch-manipulation ${showGifPicker ? 'text-cyan-400' : 'text-muted-foreground hover:text-cyan-400'}`}
                data-testid="gif-button"
              >
                <span className="text-xs font-bold border border-current rounded px-1">GIF</span>
              </button>
              
              <div className="flex-1 relative">
                <input aria-label="Message..."
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  placeholder="Message..."
                  className="w-full bg-muted rounded-full px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <button aria-label="Emoji"
                  type="button"
                  aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <EmojiPicker
                  show={showEmojiPicker}
                  onSelect={(emoji) => { setNewMessage(prev => prev + emoji); setShowEmojiPicker(false); }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>

              {newMessage.trim() ? (
                <button aria-label="Send"
                  type="submit"
                  disabled={sendingMessage}
                  className="p-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full text-white disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </button>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setShowVideoCapture(true)} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors">
                    <Video className="w-5 h-5" />
                  </button>
                  <button type="button" onClick={() => setShowVoiceRecorder(true)} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors" aria-label="Microphone">
                    <Mic className="w-5 h-5" />
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
  };

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
