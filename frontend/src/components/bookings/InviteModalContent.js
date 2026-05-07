/**
 * InviteModalContent.js - Extracted from Bookings.js (v61)
 * Handles both handle-based user search invites and code sharing for session splitting.
 */
import React, { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient';
import { Users, Copy, Loader2, AtSign, Send, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';

const InviteModalContent = ({ booking, user, isLight, textPrimaryClass, textSecondaryClass, onCopyCode, onClose, onRefresh }) => {
  const [activeTab, setActiveTab] = useState('handle'); // 'handle' or 'code'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const [sentInvites, setSentInvites] = useState([]);
  const [inviteMessage, setInviteMessage] = useState('');
  
  // Debounced search for users
  useEffect(() => {
    if (!booking?.id || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await apiClient.get(
          `/bookings/${booking.id}/search-users?query=${encodeURIComponent(searchQuery)}`
        );
        setSearchResults(response.data || []);
      } catch (error) {
        logger.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery, booking?.id, user?.id]);
  
  const handleInviteByHandle = async (targetUser) => {
    setInviting(targetUser.user_id);
    try {
      const _response = await apiClient.post(
        `/bookings/${booking.id}/invite-by-handle`,
        {
          // Use username if available, otherwise fall back to full_name
          handle_query: targetUser.username || targetUser.full_name,
          message: inviteMessage || null
        }
      );
      
      const displayName = targetUser.username ? `@${targetUser.username}` : targetUser.full_name;
      toast.success(`Invite sent to ${displayName}!`);
      setSentInvites(prev => [...prev, targetUser.user_id]);
      setSearchQuery('');
      setSearchResults([]);
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send invite');
    } finally {
      setInviting(null);
    }
  };
  
  return (
    <div className="py-4 space-y-4">
      {/* Tab Switcher */}
      <div className="flex border-b border-zinc-700">
        <button aria-label="At Sign"
          onClick={() => setActiveTab('handle')}
          className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'handle' 
              ? `${textPrimaryClass} border-b-2 border-cyan-400` 
              : textSecondaryClass
          }`}
        >
          <AtSign className="w-4 h-4" />
          Invite by Name
        </button>
        <button aria-label="Copy"
          onClick={() => setActiveTab('code')}
          className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'code' 
              ? `${textPrimaryClass} border-b-2 border-cyan-400` 
              : textSecondaryClass
          }`}
        >
          <Copy className="w-4 h-4" />
          Share Code
        </button>
      </div>
      
      {/* Handle-based Invite Tab */}
      {activeTab === 'handle' && (
        <div className="space-y-4">
          <p className={`text-sm ${textSecondaryClass}`}>
            Search for friends by name to send them an invite notification.
          </p>
          
          {/* Search Input */}
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondaryClass}`} />
            <Input aria-label="Type a name to search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type a name to search..."
              className={`pl-10 ${isLight ? 'bg-gray-100' : 'bg-muted'} ${textPrimaryClass}`}
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-cyan-400" />
            )}
          </div>
          
          {/* Optional Message */}
          <div>
            <Label className={`text-sm ${textSecondaryClass}`}>Message (optional)</Label>
            <Input
              value={inviteMessage}
              onChange={(e) => setInviteMessage(e.target.value)}
              placeholder="e.g., Join me for the session!"
              className={`mt-1 ${isLight ? 'bg-gray-100' : 'bg-muted'} ${textPrimaryClass}`}
            />
          </div>
          
          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className={`rounded-lg border ${isLight ? 'border-gray-200' : 'border-zinc-700'} overflow-hidden`}>
              {searchResults.map((result) => {
                const alreadySent = sentInvites.includes(result.user_id);
                
                return (
                  <div
                    key={result.user_id}
                    className={`flex items-center justify-between p-3 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-muted'} border-b last:border-b-0 ${isLight ? 'border-gray-100' : 'border-zinc-700'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                        {result.avatar_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(result.avatar_url)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            {result.full_name?.[0] || '?'}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className={`font-medium ${textPrimaryClass}`}>{result.full_name}</p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          @{result.handle}
                          {result.is_following && (
                            <span className="ml-2 text-cyan-400">Following</span>
                          )}
                        </p>
                      </div>
                    </div>
                    
                    <Button aria-label="Loader2"
                      size="sm"
                      onClick={() => handleInviteByHandle(result)}
                      disabled={inviting === result.user_id || alreadySent}
                      className={alreadySent 
                        ? 'bg-green-500/20 text-green-400 cursor-default'
                        : 'bg-cyan-500 hover:bg-cyan-600 text-black'
                      }
                    >
                      {inviting === result.user_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : alreadySent ? (
                        <>
                          <Send className="w-3 h-3 mr-1" />
                          Sent
                        </>
                      ) : (
                        <>
                          <Send className="w-3 h-3 mr-1" />
                          Invite
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Empty state */}
          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <div className={`text-center py-6 ${textSecondaryClass}`}>
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No users found matching "{searchQuery}"</p>
            </div>
          )}
          
          {/* Sent invites summary */}
          {sentInvites.length > 0 && (
            <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
              <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-400'}`}>
                ? {sentInvites.length} invite{sentInvites.length > 1 ? 's' : ''} sent! They'll receive a notification.
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Code Sharing Tab */}
      {activeTab === 'code' && (
        <div className="space-y-4">
          <p className={textSecondaryClass}>
            Share this code with friends to split the session cost.
          </p>
          {booking && booking.invite_code ? (
            <>
              <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-muted'} text-center`}>
                <p className={`text-sm ${textSecondaryClass} mb-2`}>Invite Code</p>
                <div className="flex items-center justify-center gap-2">
                  <span className={`font-mono text-2xl font-bold tracking-widest ${textPrimaryClass}`}>
                    {booking.invite_code}
                  </span>
                  <Button aria-label="Copy"
                    variant="ghost"
                    size="sm"
                    onClick={() => onCopyCode(booking.invite_code)}
                    className="text-cyan-400"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'}`}>
                <p className={`text-sm ${textSecondaryClass}`}>
                  When friends join, the total session cost will be split equally among all participants.
                </p>
              </div>
            </>
          ) : (
            <div className={`p-4 rounded-lg ${isLight ? 'bg-orange-50' : 'bg-orange-500/10'} text-center`}>
              <p className={`text-sm ${isLight ? 'text-orange-700' : 'text-orange-400'}`}>
                No invite code available. This session was booked without split payment enabled.
              </p>
            </div>
          )}
        </div>
      )}
      
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
  );
};

export default InviteModalContent;
