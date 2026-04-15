/**
 * FollowersModal - Instagram-style modal showing followers or following list
 * Allows users to view who follows them or who they follow
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { X, Loader2, UserPlus, UserMinus, Users } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const FollowersModal = ({ 
  isOpen, 
  onClose, 
  userId, 
  type = 'followers', // 'followers' or 'following'
  userName = ''
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followingIds, setFollowingIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(null);

  // Fetch the list of followers or following
  useEffect(() => {
    const fetchUsers = async () => {
      if (!isOpen || !userId) return;
      
      setLoading(true);
      try {
        const endpoint = type === 'followers' 
          ? `${API}/followers/${userId}`
          : `${API}/following/${userId}`;
        
        const response = await axios.get(endpoint);
        setUsers(response.data || []);
        
        // If logged in, also fetch who the current user follows to show follow/unfollow buttons
        if (user?.id) {
          const followingRes = await axios.get(`${API}/following/${user.id}`);
          const followingSet = new Set((followingRes.data || []).map(u => u.id));
          setFollowingIds(followingSet);
        }
      } catch (error) {
        console.error('Error fetching users:', error);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [isOpen, userId, type, user?.id]);

  // Handle follow/unfollow
  const handleFollowToggle = async (targetUserId, isCurrentlyFollowing) => {
    if (!user?.id) {
      toast.error('Please log in to follow users');
      return;
    }

    setActionLoading(targetUserId);
    try {
      if (isCurrentlyFollowing) {
        await axios.delete(`${API}/follow/${targetUserId}?follower_id=${user.id}`);
        setFollowingIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(targetUserId);
          return newSet;
        });
        toast.success('Unfollowed');
      } else {
        await axios.post(`${API}/follow/${targetUserId}?follower_id=${user.id}`);
        setFollowingIds(prev => new Set([...prev, targetUserId]));
        toast.success('Following!');
      }
    } catch (error) {
      toast.error('Failed to update follow status');
    } finally {
      setActionLoading(null);
    }
  };

  // Navigate to user profile
  const handleUserClick = (clickedUserId) => {
    onClose();
    navigate(`/profile/${clickedUserId}`);
  };

  const title = type === 'followers' ? 'Followers' : 'Following';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        hideCloseButton
        className="bg-background border-border w-[calc(100%-2rem)] sm:w-[95vw] max-w-md max-h-[80vh] overflow-hidden flex flex-col p-0 mx-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {userName && (
              <span className="text-sm text-muted-foreground">• {userName}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">
                {type === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {users.map((listUser) => {
                const isFollowing = followingIds.has(listUser.id);
                const isSelf = user?.id === listUser.id;
                
                return (
                  <div 
                    key={listUser.id}
                    className="flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors"
                  >
                    {/* Avatar - Clickable */}
                    <button
                      onClick={() => handleUserClick(listUser.id)}
                      className="flex-shrink-0"
                    >
                      <Avatar className="w-12 h-12 border-2 border-border">
                        <AvatarImage src={listUser.avatar_url} alt={listUser.full_name} />
                        <AvatarFallback className="bg-muted text-muted-foreground">
                          {listUser.full_name?.charAt(0) || '?'}
                        </AvatarFallback>
                      </Avatar>
                    </button>

                    {/* User Info - Clickable */}
                    <button
                      onClick={() => handleUserClick(listUser.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">
                          {listUser.username ? `@${listUser.username}` : listUser.full_name}
                        </p>
                        {listUser.is_verified && (
                          <Badge className="bg-blue-500/20 text-blue-400 border-0 text-xs px-1.5">
                            ✓
                          </Badge>
                        )}
                      </div>
                      {listUser.username && (
                        <p className="text-sm text-muted-foreground truncate">
                          {listUser.full_name}
                        </p>
                      )}
                      {listUser.role && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {listUser.role}
                        </p>
                      )}
                    </button>

                    {/* Follow/Unfollow Button */}
                    {!isSelf && user?.id && (
                      <Button
                        size="sm"
                        variant={isFollowing ? 'outline' : 'default'}
                        onClick={() => handleFollowToggle(listUser.id, isFollowing)}
                        disabled={actionLoading === listUser.id}
                        className={`flex-shrink-0 min-w-[90px] ${
                          isFollowing 
                            ? 'border-border text-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50' 
                            : 'bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 text-black hover:opacity-90'
                        }`}
                      >
                        {actionLoading === listUser.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isFollowing ? (
                          <>
                            <UserMinus className="w-4 h-4 mr-1" />
                            Unfollow
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4 mr-1" />
                            Follow
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FollowersModal;
