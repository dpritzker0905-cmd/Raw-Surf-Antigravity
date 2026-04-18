/**
 * InviteNearbyCrewModal - Popup for inviting nearby friends to split a booking
 * 
 * Appears when creating a NEW booking (scheduled or on-demand) to offer splitting costs
 * NOT for active live shooting sessions - this is for booking together before the session
 */
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Users, MapPin, 
  Loader2, UserPlus, Check, Calendar, Waves,
  Navigation, UserCheck
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { Checkbox } from './ui/checkbox';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const InviteNearbyCrewModal = ({
  isOpen,
  onClose,
  booking,
  user,
  onInvitesSent,
  theme = 'dark'
}) => {
  const [nearbyFriends, setNearbyFriends] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const itemBgClass = isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800';

  // Calculate per-person price based on selected crew
  const totalCrew = selectedFriends.length + 1; // +1 for current user
  const pricePerPerson = booking?.total_price ? (booking.total_price / totalCrew).toFixed(2) : '0.00';
  const originalPrice = booking?.total_price?.toFixed(2) || '0.00';
  const savings = booking?.total_price ? (booking.total_price - (booking.total_price / totalCrew)).toFixed(2) : '0.00';

  // Fetch nearby friends on mount
  useEffect(() => {
    const fetchNearbyFriends = async () => {
      if (!user?.id || !isOpen) return;
      
      setLoading(true);
      try {
        // Get user's current location
        let lat, lon;
        if (navigator.geolocation) {
          try {
            const position = await new Promise((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 5000
              });
            });
            lat = position.coords.latitude;
            lon = position.coords.longitude;
          } catch (e) {
            console.log('Geolocation failed, using profile location');
          }
        }
        
        // Fetch nearby friends from API
        const response = await axios.get(`${API}/friends/nearby`, {
          params: {
            user_id: user.id,
            latitude: lat,
            longitude: lon,
            radius_miles: 10
          }
        });
        
        setNearbyFriends(response.data || []);
      } catch (error) {
        console.error('Failed to fetch nearby friends:', error);
        // Show empty state instead of error
        setNearbyFriends([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchNearbyFriends();
  }, [user?.id, isOpen]);

  const toggleFriend = (friendId) => {
    setSelectedFriends(prev => 
      prev.includes(friendId) 
        ? prev.filter(id => id !== friendId)
        : [...prev, friendId]
    );
  };

  const handleSendInvites = async () => {
    if (selectedFriends.length === 0) {
      toast.error('Select at least one friend to invite');
      return;
    }
    
    setSending(true);
    try {
      // Send invites to selected friends
      await axios.post(`${API}/bookings/${booking.id}/invite-crew`, {
        friend_ids: selectedFriends,
        share_amount: parseFloat(pricePerPerson),
        message: `Join my surf session! Split cost: $${pricePerPerson}/person`
      }, {
        params: { user_id: user.id }
      });
      
      toast.success(`Invites sent to ${selectedFriends.length} friend${selectedFriends.length > 1 ? 's' : ''}!`);
      onInvitesSent?.(selectedFriends);
      onClose();
    } catch (error) {
      console.error('Invite error:', error);
      toast.error(error.response?.data?.detail || 'Failed to send invites');
    } finally {
      setSending(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  // Format session date
  const sessionDate = booking?.session_date 
    ? new Date(booking.session_date).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      })
    : 'TBD';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${cardBgClass} border-zinc-700 max-w-md max-h-[80vh] flex flex-col`}>
        <DialogHeader>
          <DialogTitle className={`text-lg font-bold ${textPrimaryClass} flex items-center gap-2`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            Invite Nearby Crew
          </DialogTitle>
          <DialogDescription className={textSecondaryClass}>
            Split the cost of your session booking with friends nearby!
          </DialogDescription>
        </DialogHeader>

        {/* Booking Info */}
        <div className={`p-3 rounded-lg ${isLight ? 'bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200' : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30'} mb-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Waves className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-400">Surf Session Booking</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className={`font-medium ${textPrimaryClass}`}>{booking?.photographer_name || 'Photographer'}</p>
              <p className={`text-sm ${textSecondaryClass} flex items-center gap-1`}>
                <MapPin className="w-3 h-3" />
                {booking?.location || 'Location TBD'}
              </p>
              <p className={`text-xs ${textSecondaryClass} flex items-center gap-1 mt-1`}>
                <Calendar className="w-3 h-3" />
                {sessionDate}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-sm ${textSecondaryClass} line-through`}>${originalPrice}</p>
              <p className="text-lg font-bold text-green-400">${pricePerPerson}/person</p>
            </div>
          </div>
        </div>

        {/* Savings Banner */}
        {selectedFriends.length > 0 && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4 flex items-center gap-2">
            <Check className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-medium">
              You'll save ${savings} by splitting with {selectedFriends.length} friend{selectedFriends.length > 1 ? 's' : ''}!
            </span>
          </div>
        )}

        {/* Nearby Friends List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              <span className={`ml-2 ${textSecondaryClass}`}>Finding nearby friends...</span>
            </div>
          ) : nearbyFriends.length === 0 ? (
            <div className="text-center py-8">
              <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
                <Navigation className={`w-8 h-8 ${textSecondaryClass}`} />
              </div>
              <p className={`font-medium ${textPrimaryClass} mb-2`}>No friends nearby</p>
              <p className={`text-sm ${textSecondaryClass}`}>
                Your friends aren't currently in the area, but you can still book solo or open a Lineup!
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className={`text-sm ${textSecondaryClass} mb-2`}>
                {nearbyFriends.length} friend{nearbyFriends.length > 1 ? 's' : ''} nearby
              </p>
              {nearbyFriends.map((friend) => (
                <button
                  key={friend.id}
                  onClick={() => toggleFriend(friend.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg ${itemBgClass} transition-colors ${
                    selectedFriends.includes(friend.id) ? 'ring-2 ring-cyan-500' : ''
                  }`}
                  data-testid={`invite-friend-${friend.id}`}
                >
                  <Checkbox 
                    checked={selectedFriends.includes(friend.id)}
                    className="border-cyan-500 data-[state=checked]:bg-cyan-500"
                  />
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={friend.avatar_url} />
                    <AvatarFallback className="bg-cyan-500/20 text-cyan-400">
                      {(friend.full_name || 'F').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className={`font-medium ${textPrimaryClass}`}>{friend.full_name}</p>
                    <p className={`text-sm ${textSecondaryClass} flex items-center gap-1`}>
                      <MapPin className="w-3 h-3" />
                      {friend.distance_miles?.toFixed(1) || '?'} mi away
                    </p>
                  </div>
                  {selectedFriends.includes(friend.id) && (
                    <Badge className="bg-cyan-500/20 text-cyan-400">
                      <UserCheck className="w-3 h-3 mr-1" />
                      Selected
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-4 pt-4 border-t border-zinc-700">
          <Button
            onClick={handleSkip}
            variant="outline"
            className="flex-1 border-zinc-600"
          >
            Book Solo
          </Button>
          <Button
            onClick={handleSendInvites}
            disabled={sending || selectedFriends.length === 0}
            className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
            data-testid="send-crew-invites-btn"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite {selectedFriends.length > 0 ? `(${selectedFriends.length})` : 'Crew'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InviteNearbyCrewModal;
