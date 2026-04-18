import React, { useState, useEffect, useRef } from 'react';
import apiClient from '../../lib/apiClient';
import { isProLevelRole, isBusinessRole } from '../../contexts/PersonaContext';
import { Check, X, Search, Users, Star, Camera, Briefcase, Store, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import logger from '../../utils/logger';

// Alias for compatibility with internal code
const isProRole = isProLevelRole;

// Role icon helper (inline since it uses MessagesPage internal logic)
const getRoleIcon = (role, isAdmin = false) => {
  if (isAdmin) return { icon: Shield, color: 'text-red-500', label: 'God Mode', emoji: '🔴' };
  switch (role) {
    case 'Pro': case 'Comp Surfer': return { icon: Star, color: 'text-amber-400', label: 'Pro', emoji: '⭐' };
    case 'Approved Pro': return { icon: Camera, color: 'text-blue-400', label: 'Pro Photographer', emoji: '📸' };
    case 'Photographer': return { icon: Camera, color: 'text-purple-400', label: 'Photographer', emoji: '📷' };
    case 'Shop': return { icon: Store, color: 'text-pink-400', label: 'Surf Shop', emoji: '🛍️' };
    case 'Surf School': return { icon: Users, color: 'text-teal-400', label: 'Surf School', emoji: '🌬️' };
    case 'Shaper': return { icon: Briefcase, color: 'text-orange-400', label: 'Shaper', emoji: '🛠️' };
    case 'Resort': return { icon: Store, color: 'text-emerald-400', label: 'Resort', emoji: '🌴' };
    default: return { icon: null, color: 'text-cyan-400', label: 'Surfer', emoji: '🏄' };
  }
};

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

export default ComposeModal;
