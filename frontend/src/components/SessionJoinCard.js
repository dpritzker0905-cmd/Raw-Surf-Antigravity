/**
 * SessionJoinCard - Inline component for joining sessions from Feed posts
 * 
 * Displays when a post is a session_log with open invites
 * Allows users to:
 * - View session details (spots left, price per person)
 * - Join session directly (triggers crew payment flow)
 */
import React, { useState } from 'react';
import axios from 'axios';
import { Users, DollarSign, MapPin, Calendar, ChevronRight, Loader2, UserPlus } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const SessionJoinCard = ({
  post,
  user,
  isLight = false,
  onJoinSuccess
}) => {
  const [loading, setLoading] = useState(false);
  
  const bgClass = isLight 
    ? 'bg-gradient-to-r from-cyan-50 to-blue-50 border-cyan-200' 
    : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  // Don't show if not a session log or no spots left
  if (!post.is_session_log || !post.session_invite_open || post.session_spots_left <= 0) {
    return null;
  }

  // Don't show join button for your own posts
  if (post.author_id === user?.id) {
    return null;
  }

  const handleJoinSession = async () => {
    if (!user?.id || !post.booking_id) {
      toast.error('Please log in to join sessions');
      return;
    }
    
    setLoading(true);
    try {
      // Request to join the booking
      const response = await axios.post(
        `${API}/bookings/${post.booking_id}/request-join`,
        { user_id: user.id }
      );
      
      toast.success('Join request sent! The captain will be notified.');
      onJoinSuccess?.(response.data);
    } catch (error) {
      logger.error('Join error:', error);
      toast.error(error.response?.data?.detail || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`mt-3 p-3 rounded-lg border ${bgClass}`} data-testid={`session-join-card-${post.id}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-cyan-400" />
          <span className={`text-sm font-medium ${textPrimaryClass}`}>
            Join This Session
          </span>
        </div>
        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          {post.session_spots_left} spot{post.session_spots_left > 1 ? 's' : ''} left
        </Badge>
      </div>
      
      <div className="flex items-center gap-4 mb-3 text-sm">
        {post.session_price_per_person && (
          <div className="flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-green-400" />
            <span className={textSecondaryClass}>
              ${post.session_price_per_person.toFixed(2)}/person
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-gray-400" />
          <span className={textSecondaryClass}>
            Crew session
          </span>
        </div>
      </div>
      
      <Button
        onClick={handleJoinSession}
        disabled={loading}
        className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-medium"
        data-testid={`join-session-btn-${post.id}`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <UserPlus className="w-4 h-4 mr-2" />
        )}
        Request to Join
      </Button>
    </div>
  );
};

export default SessionJoinCard;
