/**
 * FeedLineupCard - Session lineup card that appears in the Feed
 * 
 * Shows open lineups from friends or nearby surfers
 * Users can join directly from the Feed
 */
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { 
  Users, MapPin, Calendar, 
  Loader2, UserPlus, Waves, DollarSign, Timer,
  Crown, Camera
} from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Calculate time remaining
const getTimeRemaining = (closesAt) => {
  if (!closesAt) return null;
  const now = new Date();
  const closes = new Date(closesAt);
  const diff = closes - now;
  
  if (diff <= 0) return { expired: true, text: 'Closed' };
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (days > 0) return { expired: false, text: `${days}d ${hours}h left` };
  return { expired: false, text: `${hours}h left`, urgent: hours < 24 };
};

export const FeedLineupCard = ({
  lineup,
  user,
  isLight = false,
  onJoinSuccess
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  
  const isCaptain = lineup.creator_id === user?.id;
  const isInLineup = lineup.participants?.some(p => p.participant_id === user?.id);
  const currentCrew = (lineup.participants?.filter(p => ['confirmed', 'pending'].includes(p.status)).length || 0) + 1;
  const maxCrew = lineup.lineup_max_crew || lineup.max_participants || 10;
  const progress = (currentCrew / maxCrew) * 100;
  const spotsLeft = maxCrew - currentCrew;
  const pricePerPerson = lineup.total_price ? (lineup.total_price / Math.max(currentCrew, 1)).toFixed(2) : '0.00';
  const timeRemaining = getTimeRemaining(lineup.lineup_closes_at);
  
  const cardBg = isLight 
    ? 'bg-gradient-to-br from-cyan-50 to-blue-50 border-cyan-200' 
    : 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  const handleJoinLineup = async () => {
    if (!user?.id) {
      toast.error('Please log in to join lineups');
      return;
    }
    
    setLoading(true);
    try {
      await axios.post(`${API}/bookings/${lineup.id}/lineup/join`, null, {
        params: { user_id: user.id }
      });
      
      setJoined(true);
      toast.success('You joined the lineup! 🤙');
      onJoinSuccess?.(lineup);
    } catch (error) {
      logger.error('Join error:', error);
      toast.error(error.response?.data?.detail || 'Failed to join lineup');
    } finally {
      setLoading(false);
    }
  };

  const _handleViewLineup = () => {
    navigate('/bookings?tab=lineup');
  };

  // Don't show for captain or already joined
  if (isCaptain || isInLineup || joined) {
    return null;
  }

  // Don't show if no spots left
  if (spotsLeft <= 0) {
    return null;
  }

  return (
    <Card className={`${cardBg} overflow-hidden my-4`} data-testid={`feed-lineup-card-${lineup.id}`}>
      <CardContent className="p-4">
        {/* Header: Lineup Label + Timer */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
              <Waves className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs text-cyan-400 font-medium uppercase tracking-wide">The Lineup</p>
              <p className={`text-sm ${textSecondary}`}>Join this session</p>
            </div>
          </div>
          {timeRemaining && !timeRemaining.expired && (
            <Badge className={`${timeRemaining.urgent ? 'bg-orange-500/20 text-orange-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
              <Timer className="w-3 h-3 mr-1" />
              {timeRemaining.text}
            </Badge>
          )}
        </div>

        {/* Captain Info */}
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="w-10 h-10 border-2 border-yellow-400">
            <AvatarImage src={lineup.creator_avatar_url} />
            <AvatarFallback className="bg-yellow-400/20 text-yellow-400">
              {(lineup.creator_name || 'C').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className={`font-medium ${textPrimary} flex items-center gap-1`}>
              <Crown className="w-3 h-3 text-yellow-400" />
              {lineup.creator_name || 'Captain'}
            </p>
            <p className={`text-sm ${textSecondary}`}>is looking for crew</p>
          </div>
        </div>

        {/* Session Details */}
        <div className={`p-3 rounded-lg ${isLight ? 'bg-white/80' : 'bg-black/20'} mb-3`}>
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-cyan-400" />
            <span className={`font-medium ${textPrimary}`}>{lineup.location || 'Location TBD'}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-gray-400" />
              <span className={textSecondary}>
                {lineup.session_date ? new Date(lineup.session_date).toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric'
                }) : 'TBD'}
              </span>
            </div>
            {lineup.photographer_name && (
              <div className="flex items-center gap-1">
                <Camera className="w-3 h-3 text-gray-400" />
                <span className={textSecondary}>{lineup.photographer_name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Crew Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm ${textSecondary}`}>
              <Users className="w-4 h-4 inline mr-1" />
              {currentCrew}/{maxCrew} crew
            </span>
            <span className="text-sm text-green-400 font-medium">
              {spotsLeft} spot{spotsLeft > 1 ? 's' : ''} left
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Price + Join Button */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-1">
              <DollarSign className="w-4 h-4 text-green-400" />
              <span className={`text-lg font-bold ${textPrimary}`}>${pricePerPerson}</span>
              <span className={`text-sm ${textSecondary}`}>/person</span>
            </div>
            <p className={`text-xs ${textSecondary}`}>Price splits with more crew</p>
          </div>
          <Button
            onClick={handleJoinLineup}
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white px-6"
            data-testid={`feed-join-lineup-${lineup.id}`}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Join
              </>
            )}
          </Button>
        </div>

        {/* Captain's Message */}
        {lineup.lineup_message && (
          <p className={`mt-3 text-sm ${textSecondary} italic border-t border-cyan-500/20 pt-3`}>
            "{lineup.lineup_message}"
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default FeedLineupCard;
