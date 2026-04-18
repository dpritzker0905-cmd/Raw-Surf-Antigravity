import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePersona, getExpandedRoleInfo, isProLevelRole, isBusinessRole as isBusinessRoleCheck } from '../contexts/PersonaContext';
import { useSearchParams, useNavigate, useParams, useLocation } from 'react-router-dom';
import { 
  Search, Send, ChevronLeft, MoreHorizontal, Check, CheckCheck, 
  X, Mic, Image, Camera, Play, Edit3, Video,
  Reply, Smile, Heart, Shield, Users, EyeOff, Filter, Star, Store, Briefcase, Pin, BellOff, Mail, Trash2, Clock
} from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { toast } from 'sonner';
import VoiceRecorder from './VoiceRecorder';
import WebcamCaptureModal from './WebcamCaptureModal';
import { supabase } from '../lib/supabase';
import logger from '../utils/logger';
import GifPicker from './messages/GifPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";



// Role-based icon helper - uses expanded PersonaContext
const getRoleIcon = (role, isAdmin = false) => {
  const _roleInfo = getExpandedRoleInfo(role, isAdmin);
  if (isAdmin) return { icon: Shield, color: 'text-red-500', label: 'God Mode', emoji: '🔴' };
  
  // Map to lucide icons for non-emoji contexts
  switch (role) {
    case 'Pro':
    case 'Comp Surfer':
      return { icon: Star, color: 'text-amber-400', label: 'Pro', emoji: '⭐' };
    case 'Approved Pro':
      return { icon: Camera, color: 'text-blue-400', label: 'Pro Photographer', emoji: '📸' };
    case 'Photographer':
      return { icon: Camera, color: 'text-purple-400', label: 'Photographer', emoji: '📷' };
    case 'Hobbyist':
      return { icon: Search, color: 'text-indigo-400', label: 'Hobbyist', emoji: '🔍' };
    case 'Shop':
      return { icon: Store, color: 'text-pink-400', label: 'Surf Shop', emoji: '🛍️' };
    case 'Surf School':
      return { icon: Users, color: 'text-teal-400', label: 'Surf School', emoji: '🌬️' };
    case 'Shaper':
      return { icon: Briefcase, color: 'text-orange-400', label: 'Shaper', emoji: '🛠️' };
    case 'Resort':
      return { icon: Store, color: 'text-emerald-400', label: 'Resort', emoji: '🌴' };
    default:
      return { icon: null, color: 'text-cyan-400', label: 'Surfer', emoji: '🏄' };
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
  const isGrom = roleToCheck === 'Grom' || roleToCheck === 'GROM';
  const isGromParent = roleToCheck === 'Grom Parent' || roleToCheck === 'GROM_PARENT' || roleToCheck === 'grom_parent' || isGromParentFlag;
  
  const folders = [];
  
  // PRIMARY - Standard surfer-to-surfer communication (visible to all)
  // This is the main inbox for direct messages between surfers
  folders.push({ 
    id: 'primary', 
    label: isGrom ? 'Grom Zone' : 'Primary', 
    icon: Users, 
    color: 'text-cyan-400', 
    description: isGrom ? 'Chat with other Groms' : 'Friends & surfers',
    emoji: '🏄'
  });
  
  // FAMILY CHAT - Grom Parents chat with their linked Groms
  if (isGromParent) {
    folders.push({ 
      id: 'family', 
      label: 'Family', 
      icon: Users, 
      color: 'text-cyan-400', 
      description: 'Chat with your linked Groms',
      emoji: '👨‍👧',
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
      emoji: '👨‍👧',
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
      emoji: '⭐'
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
      emoji: '📷'
    });
  }
  
  // Requests
  folders.push({ 
    id: 'requests', 
    label: 'Requests', 
    icon: Smile, 
    color: 'text-orange-400', 
    description: 'Message requests',
    emoji: '📩'
  });
  
  // Hidden
  folders.push({ 
    id: 'hidden', 
    label: 'Hidden', 
    icon: EyeOff, 
    color: 'text-gray-500', 
    description: 'Muted conversations',
    emoji: '🔇'
  });
  
  return folders;
};

// Available reaction emojis for messages
const REACTIONS = ['🤙', '🌊', '❤️', '🔥', '👏', '😂'];

// GifPicker extracted to ./messages/GifPicker.js

// Emoji picker categories and emojis
const EMOJI_CATEGORIES = {
  'Recent': ['🤙', '🌊', '❤️', '🔥', '👏', '😂', '🏄', '🏄‍♀️'],
  'Surf': ['🏄', '🏄‍♀️', '🌊', '🏖️', '🐚', '🐬', '🦈', '☀️', '🌅', '🌴', '🐠', '🦑', '🐙', '🦀'],
  'Faces': ['😀', '😂', '🥹', '😍', '🥰', '😘', '😎', '🤩', '😇', '🙂', '😉', '😊', '😋', '🤪', '😜'],
  'Gestures': ['🤙', '👋', '✌️', '👍', '👊', '🤟', '🤘', '👏', '🙌', '🤝', '💪', '🫶', '❤️', '🔥', '💯'],
  'Nature': ['🌞', '🌈', '⭐', '🌙', '☁️', '💨', '🌬️', '🌀', '🌪️', '🌧️', '⚡', '🔆', '🌺', '🌸', '🌻']
};

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

// Compose Modal Component - Instagram-style new message search
const ComposeModal = ({ isOpen, onClose, onSelectUser, currentUserId }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [_suggestedUsers, setSuggestedUsers] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [recentContacts, setRecentContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const inputRef = useRef(null);

  // Fetch suggested users on mount
  useEffect(() => {
    if (isOpen && currentUserId) {
      fetchSuggestedUsers();
      // Focus input on open
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, currentUserId]);

  // Search users when term changes
  useEffect(() => {
    if (searchTerm.trim()) {
      searchUsers(searchTerm);
    } else {
      setSearchResults([]);
    }
  }, [searchTerm]);

  const fetchSuggestedUsers = async () => {
    setLoading(true);
    try {
      // Fetch recent conversations for frequent contacts
      const convResponse = await apiClient.get(`/messages/conversations/${currentUserId}?inbox_type=all`);
      const recentUsers = convResponse.data.slice(0, 10).map(c => ({
        id: c.other_user_id,
        name: c.other_user_name,
        username: c.other_username,  // Use actual username from API
        avatar: c.other_user_avatar,
        role: c.other_user_role,
        isRecent: true
      }));
      setRecentContacts(recentUsers);

      // Top 3 frequent contacts for horizontal row
      setSuggestedUsers(recentUsers.slice(0, 3));
    } catch (error) {
      logger.error('Failed to fetch suggested users:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async (term) => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/profiles/search?q=${encodeURIComponent(term)}&limit=20&user_id=${currentUserId}`);
      
      // Results are already sorted by backend: God Mode > Pros > Photographers > Businesses > Users
      setSearchResults(response.data.map(u => ({
        id: u.id,
        name: u.full_name,
        username: u.username,  // Use actual username from API (no fallback)
        avatar: u.avatar_url,
        role: u.role,
        isAdmin: u.is_admin,
        isPro: isProRole(u.role),
        isBusiness: isBusinessRole(u.role),
        isFollowing: u.is_following,
        followsYou: u.follows_you,
        isMutual: u.is_mutual
      })));
    } catch (error) {
      logger.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const _handleSelectUser = (user) => {
    setSelectedUsers([user]);
  };

  const handleStartChat = () => {
    if (selectedUsers.length > 0) {
      onSelectUser(selectedUsers[0]);
      onClose();
    }
  };

  const handleUserClick = (user) => {
    // Direct navigation to chat
    onSelectUser(user);
    onClose();
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSearchResults([]);
    inputRef.current?.focus();
  };

  if (!isOpen) return null;

  const displayUsers = searchTerm.trim() ? searchResults : recentContacts;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-full max-w-md mx-4 bg-card rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="w-6" />
          <h2 className="text-lg font-semibold text-foreground">New message</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search Input */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">To:</span>
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="w-full bg-transparent text-foreground placeholder-muted-foreground text-sm focus:outline-none"
                data-testid="compose-search-input"
              />
              {searchTerm && (
                <button 
                  onClick={clearSearch}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* User List */}
        <div className="max-h-[400px] overflow-y-auto">
          {/* Suggested Label */}
          {!searchTerm.trim() && (
            <div className="px-4 py-2">
              <span className="text-sm font-semibold text-foreground">Suggested</span>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* User List */}
          {!loading && displayUsers.map((user) => {
            const roleInfo = getRoleIcon(user.role, user.isAdmin);
            const RoleIcon = roleInfo.icon;
            
            return (
              <button
                key={user.id}
                onClick={() => handleUserClick(user)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors ${
                  selectedUsers.some(u => u.id === user.id) ? 'bg-muted' : ''
                }`}
                data-testid={`compose-user-${user.id}`}
              >
                {/* Avatar */}
                <div className="relative">
                  <div className={`w-12 h-12 rounded-full overflow-hidden ${
                    user.isAdmin ? 'ring-2 ring-red-500/50' :
                    user.isPro ? 'ring-2 ring-amber-400/50' : 
                    user.isBusiness ? 'ring-2 ring-purple-400/50' : ''
                  }`}>
                    {user.avatar ? (
                      <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-lg font-semibold">
                        {user.name?.charAt(0)}
                      </div>
                    )}
                  </div>
                  {/* Mutual Follow Badge */}
                  {user.isMutual && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-card" title="Mutual Follow">
                      <Users className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                {/* User Info */}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">{user.name}</span>
                    {RoleIcon ? (
                      <RoleIcon className={`w-4 h-4 ${roleInfo.color}`} />
                    ) : (
                      <span className="text-sm">🏄</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {user.username && (
                      <span className="text-sm text-muted-foreground">@{user.username}</span>
                    )}
                    <span className="text-xs text-muted-foreground/70">{user.username ? '·' : ''} {roleInfo.label}</span>
                    {/* Follow status indicator */}
                    {user.isMutual && (
                      <span className="text-xs text-emerald-400 ml-1">· Mutuals</span>
                    )}
                    {!user.isMutual && user.followsYou && (
                      <span className="text-xs text-cyan-400 ml-1">· Follows you</span>
                    )}
                  </div>
                </div>

                {/* Selection Circle */}
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  selectedUsers.some(u => u.id === user.id) 
                    ? 'border-cyan-400 bg-cyan-400' 
                    : 'border-muted-foreground/50'
                }`}>
                  {selectedUsers.some(u => u.id === user.id) && (
                    <Check className="w-4 h-4 text-black" />
                  )}
                </div>
              </button>
            );
          })}

          {/* Empty State */}
          {!loading && displayUsers.length === 0 && searchTerm.trim() && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <p>No users found</p>
            </div>
          )}
        </div>

        {/* Chat Button */}
        <div className="p-4 border-t border-border">
          <Button
            onClick={handleStartChat}
            disabled={selectedUsers.length === 0}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
            data-testid="compose-chat-button"
          >
            Chat
          </Button>
        </div>
      </div>
    </div>
  );
};

// Story Bubble Component - Enhanced with Notes support
const StoryBubble = ({ story, onClick, isOwnNote = false, _showCreateOption = false }) => {
  const hasUnread = story.hasUnread;
  const hasNote = story.noteContent && story.noteContent.length > 0;
  const ringColor = hasNote 
    ? 'from-green-400 via-emerald-500 to-teal-500'
    : story.type === 'photographer' 
      ? 'from-amber-400 via-orange-500 to-pink-500' 
      : 'from-cyan-400 via-blue-500 to-purple-500';
  
  return (
    <button 
      onClick={() => onClick?.(story)}
      className="flex flex-col items-center gap-1 min-w-[72px] relative group pt-3"
      data-testid={`note-bubble-${story.id || 'create'}`}
    >
      {/* Avatar ring with Note bubble ON top-left (Instagram-style) */}
      <div className="relative">
        {/* Note bubble - positioned ON avatar, overlapping top edge */}
        {hasNote && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 animate-in fade-in zoom-in duration-200">
            <div className="bg-card/95 dark:bg-zinc-900/95 backdrop-blur-sm border border-emerald-400 rounded-full px-2 py-0.5 max-w-[80px] shadow-lg whitespace-nowrap">
              <p className="text-[10px] text-foreground truncate text-center font-medium">{story.noteContent}</p>
            </div>
          </div>
        )}
        
        {/* Add note button - positioned ON avatar top when no note */}
        {isOwnNote && !hasNote && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
            <div className="bg-muted/90 border border-dashed border-muted-foreground rounded-full w-5 h-5 flex items-center justify-center hover:border-emerald-400 transition-colors">
              <span className="text-muted-foreground text-xs leading-none">+</span>
            </div>
          </div>
        )}
        
        <div className={`p-0.5 rounded-full ${hasUnread || hasNote ? `bg-gradient-to-br ${ringColor}` : 'bg-muted'}`}>
          <div className="p-0.5 bg-background rounded-full">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-muted relative">
              {story.avatar ? (
                <img src={story.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-lg">
                  {story.name?.charAt(0) || '?'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <span className="text-[11px] text-muted-foreground truncate max-w-[64px]">{story.name}</span>
      {story.timeRemaining && hasNote && (
        <span className="text-[10px] text-emerald-500 dark:text-emerald-400 truncate max-w-[64px] -mt-0.5">{story.timeRemaining}</span>
      )}
    </button>
  );
};

// Create Note Modal Component with Emoji Picker
const CreateNoteModal = ({ isOpen, onClose, onSubmit }) => {
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  
  // Surf-themed emojis
  const SURF_EMOJIS = ['🤙', '🌊', '🏄', '🔥', '💯', '😎', '🌅', '🐚', '🦈', '☀️', '🌴', '✨'];
  
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!noteText.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(noteText.trim());
      setNoteText('');
      onClose();
    } catch (error) {
      toast.error('Failed to create note');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const addEmoji = (emoji) => {
    setNoteText(prev => (prev + emoji).slice(0, 60));
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-foreground mb-2 text-center">Share a note</h3>
        <p className="text-sm text-muted-foreground mb-1 text-center">Shared with followers you follow back</p>
        <p className="text-xs text-emerald-500 dark:text-emerald-400 mb-4 text-center">Notes disappear after 24 hours</p>
        
        <form onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value.slice(0, 60))}
            placeholder="What's on your mind? 🤙"
            className="bg-muted border-border text-foreground text-lg text-center h-14 mb-2"
            maxLength={60}
            data-testid="note-input"
          />
          
          {/* Emoji Picker */}
          <div className="flex justify-center flex-wrap gap-2 mb-3" data-testid="note-emoji-picker">
            {SURF_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => addEmoji(emoji)}
                className="text-xl hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
          
          <div className="flex justify-between text-xs text-muted-foreground mb-4">
            <span>{noteText.length}/60</span>
            <span>Mutual followers only</span>
          </div>
          
          <div className="flex gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="flex-1 text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!noteText.trim() || isSubmitting}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white"
              data-testid="submit-note-btn"
            >
              {isSubmitting ? 'Sharing...' : 'Share'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// View Note Modal Component
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
  
  const avatarWithCacheBust = note.user_avatar 
    ? `${note.user_avatar}${note.user_avatar.includes('?') ? '&' : '?'}t=${Date.now()}`
    : null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* User info */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-muted">
            {avatarWithCacheBust ? (
              <img src={avatarWithCacheBust} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {note.user_name?.charAt(0)}
              </div>
            )}
          </div>
          <div>
            <p className="font-medium text-foreground">{note.user_name}</p>
            <p className="text-xs text-emerald-500 dark:text-emerald-400">{note.time_remaining} left</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
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
            <Input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Reply to note..."
              className="bg-muted border-border text-foreground flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleReply()}
              data-testid="note-reply-input"
            />
            <Button
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

// Conversation List Item Component
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

// Emoji Picker Component
const EmojiPicker = ({ show, onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState('Recent');
  
  if (!show) return null;
  
  return (
    <div 
      className="absolute bottom-full left-0 mb-2 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 animate-in slide-in-from-bottom-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex border-b border-zinc-700 overflow-x-auto px-2 py-1 scrollbar-hide">
        {Object.keys(EMOJI_CATEGORIES).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors rounded ${
              activeCategory === cat ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="p-2 grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
        {EMOJI_CATEGORIES[activeCategory].map((emoji, i) => (
          <button
            key={i}
            onClick={() => onSelect(emoji)}
            className="text-xl p-1.5 hover:bg-zinc-800 rounded transition-colors hover:scale-110"
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="flex justify-end px-2 py-1 border-t border-zinc-700">
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Close</button>
      </div>
    </div>
  );
};
// EphemeralCountdown - Live ticking countdown badge for 24hr ephemeral videos
// Uses setInterval to update every minute so the display actually ticks down
const EphemeralCountdown = ({ createdAt }) => {
  const EPHEMERAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const calcRemaining = () => {
    const startTime = createdAt ? new Date(createdAt).getTime() : Date.now();
    return EPHEMERAL_MS - (Date.now() - startTime);
  };

  const [remaining, setRemaining] = useState(calcRemaining);

  useEffect(() => {
    // Tick every 30 seconds (videos don't need per-second precision)
    const interval = setInterval(() => {
      const r = calcRemaining();
      setRemaining(r);
      if (r <= 0) clearInterval(interval); // Stop when expired
    }, 30000);
    return () => clearInterval(interval);
  }, [createdAt]); // eslint-disable-line

  if (remaining <= 0) {
    return (
      <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1 z-10 pointer-events-none">
        <Clock className="w-3 h-3 text-gray-400" />
        <span className="text-gray-300 text-[10px] font-bold">Expired</span>
      </div>
    );
  }

  const h = Math.floor(remaining / (1000 * 60 * 60));
  const m = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const label = h > 0 ? `${h}h ${m}m left` : `${m}m left`;

  return (
    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1 z-10 pointer-events-none animate-pulse">
      <Clock className="w-3 h-3 text-red-400" />
      <span className="text-white text-[10px] font-bold">{label}</span>
    </div>
  );
};

// Message Bubble Component
const MessageBubble = ({ message, onReact, _onReply, onNavigateProfile }) => {
  const [showReactions, setShowReactions] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const longPressTimer = useRef(null);
  
  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => setShowReactions(true), 500);
  };
  
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const renderMedia = () => {
    // Helper to get full URL for media
    const getMediaUrl = (url) => {
      if (!url) return null;
      // If it's already an absolute URL (http/https), use as-is
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      // If it's a relative /uploads path, prepend the backend URL
      if (url.startsWith('/uploads') || url.startsWith('/api/uploads')) {
        return `${BACKEND_URL}${url.startsWith('/api') ? '' : '/api'}${url}`;
      }
      return url;
    };
    
    const mediaUrl = getMediaUrl(message.media_url);
    
    if (message.message_type === 'image' && mediaUrl) {
      return (
        <img 
          src={mediaUrl} 
          alt="Shared" 
          className="max-w-full rounded-lg mb-1 cursor-pointer hover:opacity-90"
          onClick={() => window.open(mediaUrl, '_blank')}
          onError={(e) => {
            e.target.style.display = 'none';
            console.error('Failed to load image:', mediaUrl);
          }}
        />
      );
    }
    if ((message.message_type === 'video' || message.message_type === 'ephemeral_video') && mediaUrl) {
      // Only treat as ephemeral if message_type is explicitly 'ephemeral_video'
      const isEphemeral = message.message_type === 'ephemeral_video';

      return (
        <div className="relative group max-w-sm rounded-2xl overflow-hidden mt-1 cursor-pointer">
          {isEphemeral && <EphemeralCountdown createdAt={message.created_at} />}
          <video 
            src={mediaUrl} 
            controls 
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            className={`max-w-full rounded-lg ${isEphemeral ? 'border-2 border-red-500/30' : ''}`}
          />
        </div>
      );
    }
    if (message.message_type === 'voice_note' && mediaUrl) {
      return (
        <div className="flex items-center gap-2 mb-1">
          <audio src={mediaUrl} controls className="max-w-[200px]" />
        </div>
      );
    }
    // Handle GIF messages
    if (message.message_type === 'gif' && mediaUrl) {
      return (
        <img 
          src={mediaUrl} 
          alt="GIF" 
          className="max-w-full rounded-lg mb-1"
        />
      );
    }
    return null;
  };

  return (
    <div 
      className={`relative flex ${message.is_mine ? 'justify-end' : 'justify-start'} items-end gap-2 mb-3 group`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); setShowReactions(true); }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); if (!showReactions) setShowReactions(false); }}
    >
      {/* Sender avatar - only for incoming messages, Instagram-style */}
      {!message.is_mine && (
        <button
          onClick={() => onNavigateProfile && message.sender_id && onNavigateProfile(message.sender_id)}
          className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden bg-muted ring-1 ring-border hover:ring-cyan-400/60 hover:scale-105 transition-all self-end mb-1 cursor-pointer"
          title={`View ${message.sender_name || 'profile'}`}
        >
          {message.sender_avatar ? (
            <img src={message.sender_avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
              {message.sender_name?.charAt(0) || '?'}
            </span>
          )}
        </button>
      )}

      {message.reply_to && (
        <div className={`absolute -top-6 ${message.is_mine ? 'right-0' : 'left-8'} max-w-[60%]`}>
          <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
            <Reply className="w-3 h-3" />
            <span className="truncate">{message.reply_to.content}</span>
          </div>
        </div>
      )}
      
      <div className={`max-w-[75%] ${message.is_mine ? 'items-end' : 'items-start'} relative flex flex-col`}>
        {/* Quick React Button - Visible on hover */}
        {!message.is_mine && isHovered && !showReactions && (
          <button
            onClick={() => setShowReactions(true)}
            className={`absolute right-0 translate-x-[calc(100%+8px)] top-1/2 -translate-y-1/2 p-2 rounded-full text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100 z-10 flex items-center justify-center`}
          >
            <div className="bg-muted/80 hover:bg-muted rounded-full p-1.5 shadow-sm">
              <Smile className="w-4 h-4" />
            </div>
          </button>
        )}
        
        <div className={`rounded-2xl px-4 py-2 ${
          message.is_mine 
            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white' 
            : 'bg-muted text-foreground'
        }`}>
          {renderMedia()}
          {message.content && <p className="text-sm whitespace-pre-wrap">{message.content}</p>}
        </div>
        
        <div className={`flex items-center gap-1 mt-1 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-muted-foreground">{formatTime(message.created_at)}</span>
          {message.is_mine && (
            message.is_read ? <CheckCheck className="w-3 h-3 text-cyan-400" /> : <Check className="w-3 h-3 text-muted-foreground" />
          )}
          {/* Double-tap hint on mobile */}
          {!message.is_mine && (
            <button
              onClick={() => setShowReactions(true)}
              className="ml-1 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground md:hidden"
            >
              <Heart className="w-3 h-3" />
            </button>
          )}
        </div>

        {message.reactions?.length > 0 && (
          <div className={`flex gap-0.5 mt-1 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
            {message.reactions.map((r, i) => (
              <span key={i} className="text-xs bg-muted rounded-full px-1.5 py-0.5 cursor-pointer hover:bg-muted/80" onClick={() => onReact(message.id, r.emoji)}>
                {r.emoji} {r.count > 1 && <span className="text-[10px]">{r.count}</span>}
              </span>
            ))}
          </div>
        )}
        {/* Reaction Emoji Picker - positioned beside the bubble */}
        {showReactions && (
          <div className={`absolute ${message.is_mine ? 'left-0 -translate-x-[calc(100%+8px)]' : 'right-0 translate-x-[calc(100%+8px)]'} top-1/2 -translate-y-1/2 bg-card rounded-full px-2 py-1 flex gap-1 shadow-xl border border-border z-50`}>
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onReact(message.id, emoji); setShowReactions(false); }}
                className="text-lg hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
            <button onClick={() => setShowReactions(false)} className="text-muted-foreground hover:text-foreground ml-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper functions
const formatTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatTimeAgo = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${diffWeeks}w`;
};

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

  // Re-fetch when persona changes (God Mode switching)
  useEffect(() => {
    if (user?.id) {
      // Reset to appropriate default folder based on effective role
      const folders = getFolders(user?.role, user?.is_admin || isGodMode, effectiveRole, isMasked, user?.is_grom_parent === true);
      const folderIds = folders.map(f => f.id);
      
      // If current folder is not available for this role, switch to primary
      if (!folderIds.includes(activeFolder)) {
        setActiveFolder('primary');
      }
      
      // Refetch conversations for current folder
      fetchConversations();
    }
  }, [effectiveRole, isGodMode, activePersona]);

  // Fetch conversations on folder change
  useEffect(() => {
    if (user?.id) {
      fetchConversations();
      fetchStories();
    }
  }, [user?.id, activeFolder]);

  // Fetch conversation detail when selected
  useEffect(() => {
    if (selectedConversation?.id && !selectedConversation.is_new_chat) {
      fetchConversationDetail(selectedConversation.id);
    }
  }, [selectedConversation]);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [conversationDetail?.messages]);

  // Real-time subscriptions
  useEffect(() => {
    if (!user?.id) return;

    const messagesChannel = supabase
      .channel('inbox-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (selectedConversation && payload.new.conversation_id === selectedConversation.id) {
          if (payload.new.sender_id !== user.id) {
            fetchConversationDetail(selectedConversation.id);
          }
        }
        fetchConversations();
      })
      .subscribe();

    const conversationsChannel = supabase
      .channel('inbox-conversations')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, (payload) => {
        if (payload.new.participant_one_id === user.id || payload.new.participant_two_id === user.id) {
          fetchConversations();
          if (selectedConversation?.id === payload.new.id) {
            fetchConversationDetail(payload.new.id);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(conversationsChannel);
    };
  }, [user?.id, selectedConversation?.id]);

  // Typing indicator polling
  useEffect(() => {
    if (!selectedConversation?.id || selectedConversation.is_new_chat) return;
    
    const fetchTypingUsers = async () => {
      try {
        const response = await apiClient.get(`/messages/typing/${selectedConversation.id}?user_id=${user.id}`);
        setTypingUsers(response.data.typing_users || []);
      } catch (error) { /* typing indicator is non-critical, ignore poll failures */ }
    };

    fetchTypingUsers();
    const interval = setInterval(fetchTypingUsers, 3000);
    return () => clearInterval(interval);
  }, [selectedConversation?.id, user?.id]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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
    try {
      // Check if fetching Grom Zone
      const isGromZone = activeFolder === 'grom_zone';
      const isFamily = activeFolder === 'family';
      
      // Fetch conversations for active folder
      let path;
      if (isGromZone) {
        path = `/messages/conversations/${user.id}?inbox_type=primary&grom_zone=true`;
      } else if (isFamily) {
        path = `/messages/conversations/${user.id}/family`;
      } else {
        path = `/messages/conversations/${user.id}?inbox_type=${activeFolder}`;
      }
      
      // Fetch conversations + unread counts in parallel (2 requests max, not 8)
      // /messages/unread-counts returns primary, requests, grom_zone totals in ONE call
      const [response, countsResp, familyCountResp] = await Promise.all([
        apiClient.get(path),
        apiClient.get(`/messages/unread-counts/${user.id}`).catch(() => ({ data: { primary: 0, requests: 0, grom_zone: 0 } })),
        apiClient.get(`/messages/conversations/${user.id}/family`).catch(() => ({ data: [] }))
      ]);
      
      setConversations(response.data);
      
      // Build folder counts from the single unread-counts response
      const unreadData = countsResp.data;
      const familyUnread = (familyCountResp.data || []).filter(c => c.unread_count > 0).length;
      
      setFolderCounts({
        primary: unreadData.primary || 0,
        requests: unreadData.requests || 0,
        grom_zone: unreadData.grom_zone || 0,
        family: familyUnread,
        // Channel/Pro Lounge/Hidden don't have dedicated count endpoints;
        // derive from current conversation list when viewing those folders
        pro_lounge: activeFolder === 'pro_lounge' ? (response.data || []).filter(c => c.unread_count > 0).length : 0,
        channel: activeFolder === 'channel' ? (response.data || []).filter(c => c.unread_count > 0).length : 0,
        hidden: 0
      });
    } catch (error) {
      logger.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConversationDetail = async (convId) => {
    try {
      const response = await apiClient.get(`/messages/conversation/${convId}?user_id=${user.id}`);
      setConversationDetail(response.data);
    } catch (error) {
      logger.error('Failed to fetch conversation:', error);
    }
  };

  const fetchStories = async () => {
    // Fetch notes from API (Instagram-style Notes feature)
    try {
      const response = await apiClient.get(`/notes/feed?user_id=${user.id}`);
      const { own_note, feed } = response.data;
      
      // CRITICAL: Fetch fresh profile data to get current avatar_url
      // The user context may have stale data from login
      let freshAvatarUrl = user?.avatar_url;
      try {
        const profileResp = await apiClient.get(`/profiles/${user.id}`);
        freshAvatarUrl = profileResp.data.avatar_url;
      } catch (e) {
        logger.debug('Could not fetch fresh profile, using context avatar');
      }
      
      // Cache-busting with current timestamp ensures browser fetches fresh image
      const avatarWithCacheBust = freshAvatarUrl 
        ? `${freshAvatarUrl}${freshAvatarUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        : null;
      
      // Set my note state
      setMyNote(own_note);
      setNotesFeed(feed || []);
      
      // Build stories array for UI
      const storiesArray = [];
      
      // Always add own note bubble first (even if no note exists - shows "Add a note")
      storiesArray.push({
        id: 'own',
        name: 'Your note',
        avatar: avatarWithCacheBust,
        type: 'note',
        hasUnread: false,
        isOwnNote: true,
        noteContent: own_note?.content || '',
        timeRemaining: own_note?.time_remaining || '',
        noteData: own_note
      });
      
      // Add notes from followed users
      for (const note of (feed || [])) {
        const noteAvatar = note.user_avatar 
          ? `${note.user_avatar}${note.user_avatar.includes('?') ? '&' : '?'}t=${Date.now()}`
          : null;
        
        storiesArray.push({
          id: note.id,
          name: note.user_name?.split(' ')[0] || 'User', // First name only
          avatar: noteAvatar,
          type: 'note',
          hasUnread: true, // Notes from others are "unread"
          isOwnNote: false,
          noteContent: note.content,
          timeRemaining: note.time_remaining,
          noteData: note
        });
      }
      
      setStories(storiesArray);
    } catch (error) {
      logger.error('Failed to fetch notes:', error);
      // Fallback to basic own note bubble - try to fetch fresh avatar
      let fallbackAvatar = user?.avatar_url;
      try {
        const profileResp = await apiClient.get(`/profiles/${user.id}`);
        fallbackAvatar = profileResp.data.avatar_url;
      } catch (e) { /* fallback avatar fetch failed - use cached value */ }
      
      const avatarWithCacheBust = fallbackAvatar 
        ? `${fallbackAvatar}${fallbackAvatar.includes('?') ? '&' : '?'}v=${Date.now()}`
        : null;
      setStories([{
        id: 'own',
        name: 'Your note',
        avatar: avatarWithCacheBust,
        type: 'note',
        hasUnread: false,
        isOwnNote: true,
        noteContent: '',
        timeRemaining: ''
      }]);
    }
  };
  
  // Create a new note
  const createNote = async (content) => {
    try {
      await apiClient.post(`/notes/create?user_id=${user.id}`, { content });
      toast.success('Note shared!');
      fetchStories(); // Refresh notes
    } catch (error) {
      logger.error('Failed to create note:', error);
      throw error;
    }
  };
  
  // Reply to a note
  const replyToNote = async (noteId, replyText) => {
    try {
      const response = await apiClient.post(`/notes/${noteId}/reply?user_id=${user.id}`, {
        reply_text: replyText
      });
      // Navigate to the conversation created by the reply
      if (response.data.conversation_id) {
        navigate(`/messages/${response.data.conversation_id}`);
      }
    } catch (error) {
      logger.error('Failed to reply to note:', error);
      throw error;
    }
  };
  
  // Handle clicking on a note bubble
  const handleNoteClick = (story) => {
    if (story.isOwnNote) {
      // Own note - show create/edit modal
      setShowCreateNoteModal(true);
    } else if (story.noteData) {
      // Other user's note - show view modal
      setSelectedNote(story.noteData);
      setShowViewNoteModal(true);
    }
  };

  // Fetch crew chats (bookings with chat enabled)
  const fetchCrewChats = async () => {
    if (!user?.id) return;
    setCrewChatsLoading(true);
    try {
      // Get user's bookings
      const response = await apiClient.get(`/bookings/user/${user.id}`);
      const bookings = response.data || [];
      
      // Filter to only active/confirmed bookings and get chat info for each
      const activeBookings = bookings.filter(b => 
        b.status === 'Confirmed' || b.status === 'Pending' || b.status === 'In Progress'
      );
      
      // Get chat info for each booking
      const chatsWithInfo = await Promise.all(
        activeBookings.map(async (booking) => {
          try {
            const chatInfo = await apiClient.get(`/crew-chat/${booking.id}/info?user_id=${user.id}`);
            return {
              ...booking,
              chatInfo: chatInfo.data,
              unread_count: chatInfo.data.unread_count || 0
            };
          } catch (e) {
            return { ...booking, chatInfo: null, unread_count: 0 };
          }
        })
      );
      
      setCrewChats(chatsWithInfo.filter(c => c.chatInfo !== null));
      
      // Update folder count
      const unreadCount = chatsWithInfo.reduce((acc, c) => acc + (c.unread_count || 0), 0);
      setFolderCounts(prev => ({ ...prev, crew_chats: unreadCount > 0 ? 1 : 0 }));
    } catch (error) {
      logger.error('Failed to fetch crew chats:', error);
      setCrewChats([]);
    } finally {
      setCrewChatsLoading(false);
    }
  };

  // Fetch crew chats when folder changes to crew_chats
  useEffect(() => {
    if (activeFolder === 'crew_chats' && user?.id) {
      fetchCrewChats();
    }
  }, [activeFolder, user?.id]);

  const sendTypingIndicator = useCallback(async (isTyping) => {
    if (!selectedConversation?.id || selectedConversation.is_new_chat) return;
    try {
      await apiClient.post(`/messages/typing/${selectedConversation.id}?user_id=${user.id}`, { is_typing: isTyping });
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

    setSendingMessage(true);
    sendTypingIndicator(false);
    
    try {
      const response = await apiClient.post(`/messages/send?sender_id=${user.id}`, {
        recipient_id: selectedConversation.other_user_id,
        content: newMessage.trim(),
        reply_to_id: replyingTo?.id || null
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
      
      setNewMessage('');
      setReplyingTo(null);
      
      const convId = response.data.conversation_id || selectedConversation.id;
      if (convId) fetchConversationDetail(convId);
      fetchConversations();
    } catch (error) {
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
      await apiClient.post(`/messages/accept/${selectedConversation.id}?user_id=${user.id}`);
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

  // Conversation Controls
  const handleTogglePin = async () => {
    if (!selectedConversation?.id) return;
    try {
      const response = await apiClient.post(
        `/messages/conversation/${selectedConversation.id}/pin?user_id=${user.id}`
      );
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
      const response = await apiClient.post(
        `/messages/conversation/${selectedConversation.id}/mute?user_id=${user.id}`
      );
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
      const response = await apiClient.post(
        `/messages/conversation/${selectedConversation.id}/mark-unread?user_id=${user.id}`
      );
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

  // Quick Accept All Requests
  const handleAcceptAllRequests = async () => {
    const requestConversations = conversations.filter(c => 
      c.folder === 'requests' || c.is_request
    );
    
    if (requestConversations.length === 0) {
      toast.info('No requests to accept');
      return;
    }

    try {
      // Accept all requests in parallel
      await Promise.all(
        requestConversations.map(conv => 
          apiClient.post(`/messages/accept/${conv.id}?user_id=${user.id}`)
        )
      );
      
      toast.success(`Accepted ${requestConversations.length} request${requestConversations.length > 1 ? 's' : ''}`);
      fetchConversations();
      setActiveFolder('primary'); // Switch to primary to see the accepted conversations
    } catch (error) {
      logger.error('Failed to accept all requests:', error);
      toast.error('Failed to accept some requests');
      fetchConversations(); // Refresh anyway to show partial results
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
    
    // Automatically force ALL video uploads inside DM's to map to ephemeral securely
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

  // Handle user selection from compose modal
  const handleComposeSelectUser = async (selectedUser) => {
    try {
      // Check for existing conversation
      const response = await apiClient.get(`/messages/check-thread/${user.id}/${selectedUser.id}`);
      
      if (response.data.exists) {
        // Navigate to existing conversation
        navigate(`/messages/${response.data.conversation_id}`);
        setSelectedConversation({
          id: response.data.conversation_id,
          other_user_id: selectedUser.id,
          other_user_name: selectedUser.name,
          other_user_avatar: selectedUser.avatar
        });
      } else {
        // Navigate to new chat
        setSelectedConversation({
          id: null,
          other_user_id: selectedUser.id,
          other_user_name: selectedUser.name,
          other_user_avatar: selectedUser.avatar,
          is_new_chat: true
        });
        navigate(`/messages/new/${selectedUser.id}`, {
          state: {
            recipientName: selectedUser.name,
            recipientAvatar: selectedUser.avatar
          }
        });
      }
    } catch (error) {
      toast.error('Failed to start conversation');
    }
  };

  // Filter conversations by search
  const filteredConversations = conversations
    .filter(c => c.other_user_name?.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      // Pinned conversations first
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      // Then by last message time
      return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });

  // Render conversation list (shared between mobile and desktop)
  const renderConversationList = () => (
    <div className="flex flex-col h-full bg-background">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border">
        <button 
          onClick={() => setShowMobileTools(!showMobileTools)}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <Filter className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Oswald' }}>Messages</h1>
        <button 
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
          <input
            type="text"
            placeholder="Search conversations"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
                <button
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
                      <span>•</span>
                      <span>{chat.status}</span>
                    </div>
                    {chat.session_date && (
                      <div className="text-xs text-cyan-400 mt-0.5">
                        {new Date(chat.session_date).toLocaleDateString()}
                      </div>
                    )}
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
                  <Button
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

  // Render chat view
  const renderChatView = () => {
    // Cache-bust avatar URL to prevent stale images
    const chatAvatarUrl = conversationDetail?.other_user_avatar || selectedConversation?.other_user_avatar;
    const chatAvatarWithCacheBust = chatAvatarUrl
      ? `${chatAvatarUrl}${chatAvatarUrl.includes('?') ? '&' : '?'}t=${conversationDetail?.last_message_at || Date.now()}`
      : null;
    
    return (
    <div className="flex flex-col h-full bg-background">
      {/* Chat Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <button
          onClick={handleBackNavigation}
          className="text-muted-foreground hover:text-foreground"
          data-testid="back-button"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          onClick={() => navigate(`/profile/${conversationDetail?.other_user_id || selectedConversation?.other_user_id}`)}
          className="w-10 h-10 rounded-full bg-muted overflow-hidden ring-2 ring-cyan-500/30 hover:ring-cyan-400 hover:scale-105 transition-all flex-shrink-0"
          title="View profile"
        >
          {chatAvatarWithCacheBust ? (
            <img src={chatAvatarWithCacheBust} className="w-full h-full object-cover" alt="" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-muted-foreground">
              {(conversationDetail?.other_user_name || selectedConversation?.other_user_name)?.charAt(0)}
            </span>
          )}
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
            ) : (() => {
              const lastActive = conversationDetail?.other_user_last_active;
              if (!lastActive) return <span className="text-muted-foreground">Active recently</span>;
              const diff = Math.floor((Date.now() - new Date(lastActive).getTime()) / 1000);
              if (diff < 300) return <span className="text-green-400">&#x25CF; Active now</span>;
              if (diff < 3600) return <span className="text-muted-foreground">Active {Math.floor(diff / 60)}m ago</span>;
              if (diff < 86400) return <span className="text-muted-foreground">Active {Math.floor(diff / 3600)}h ago</span>;
              return <span className="text-muted-foreground">Active {new Date(lastActive).toLocaleDateString()}</span>;
            })()}
          </div>
        </div>
        
        {/* Conversation Controls Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button 
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
                <img src={selectedConversation.other_user_avatar} className="w-full h-full object-cover" alt="" />
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
          <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Message Input */}
      {(selectedConversation?.is_new_chat || !conversationDetail?.is_request) && (
        <div className="p-4 border-t border-border bg-muted/50 relative">
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
              <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaUpload} className="hidden" />
              
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
                <input
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  placeholder="Message..."
                  className="w-full bg-muted rounded-full px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
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
                <button
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
                  <button type="button" onClick={() => setShowVoiceRecorder(true)} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors">
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
