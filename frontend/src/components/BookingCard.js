import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin, Users, Share2, AlertTriangle, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { CrewPaymentDashboard } from './CrewPaymentDashboard';
import { SessionActionDrawer } from './SessionActionDrawer';
import CrewHub from './CrewHub';

/**
 * BookingCard - Extracted from Bookings.js for modularity
 * Displays a single booking with status, payment info, and crew management
 */
export const BookingCard = ({
  booking,
  user,
  theme = 'dark',
  onInvite,
  onRefresh,
  onOpenCrewHub,
  onOpenModify,
  onOpenCrewView  // New prop for crew lineup visualization
}) => {
  const navigate = useNavigate();
  const [showActionDrawer, setShowActionDrawer] = useState(false);
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  const getStatusBadge = () => {
    if (booking.status === 'Confirmed') {
      return <Badge variant="default">{booking.status}</Badge>;
    }
    if (booking.status === 'PendingPayment') {
      return (
        <Badge 
          variant="warning" 
          className="bg-amber-500/20 text-amber-400 border-amber-500/30"
        >
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Awaiting Payment
          </span>
        </Badge>
      );
    }
    return <Badge variant="outline">{booking.status}</Badge>;
  };

  const isHost = booking.creator_id === user?.id;
  const showCrewPayment = booking.status === 'PendingPayment' || booking.crew_payment_required;
  const canInvite = booking.status === 'Confirmed' && 
                    booking.current_participants < booking.max_participants &&
                    booking.invite_code; // Only show if invite code exists
  const isParticipant = booking.participants?.some(p => p.participant_id === user?.id);
  const myParticipant = booking.participants?.find(p => p.participant_id === user?.id);

  return (
    <Card 
      className={`${cardBgClass} transition-colors duration-300`} 
      data-testid={`booking-card-${booking.id}`}
    >
      <CardContent className="p-4">
        {/* Header: Title, Location, Status */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className={`font-medium ${textPrimaryClass}`}>Surf Photo Session</h3>
            <div className={`flex items-center gap-2 mt-1 text-sm ${textSecondaryClass}`}>
              <MapPin className="w-4 h-4" />
              <span>{booking.location}</span>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Date/Time */}
        <div className={`flex items-center gap-2 text-sm ${textSecondaryClass} mb-3`}>
          <Calendar className="w-4 h-4" />
          <span>{new Date(booking.session_date).toLocaleString()}</span>
        </div>

        {/* Participants & Price + Manage Button */}
        <div className={`flex items-center justify-between p-3 rounded-lg ${
          isLight ? 'bg-gray-100' : 'bg-zinc-900/50'
        }`}>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-yellow-400" />
            <span className={`text-sm ${textSecondaryClass}`}>
              {booking.current_participants}/{booking.max_participants} spots
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`font-bold ${textPrimaryClass}`}>
              ${booking.paid_amount?.toFixed(2) || '0.00'}
            </span>
            {/* Manage Button - Command Center for hosts */}
            {isHost && ['Confirmed', 'PendingPayment', 'Pending'].includes(booking.status) && (
              <Button
                onClick={() => setShowActionDrawer(true)}
                size="sm"
                variant="outline"
                className={`ml-2 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
                data-testid={`manage-btn-${booking.id}`}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        
        {/* Crew Hub for hosts (Captain's Command Center) - Scheduled Bookings */}
        {showCrewPayment && isHost && booking.booking_type !== 'on_demand' && (
          <div className="mt-3">
            <CrewHub
              booking={booking}
              crewMembers={booking.participants || []}
              totalPrice={booking.total_price}
              onUpdate={onRefresh}
            />
          </div>
        )}
        
        {/* Legacy Crew Payment Dashboard - For on-demand bookings */}
        {showCrewPayment && isHost && booking.booking_type === 'on_demand' && (
          <div className="mt-3">
            <CrewPaymentDashboard
              booking={booking}
              onUpdate={onRefresh}
            />
          </div>
        )}
        
        {/* Crew Payment Card - Shows for non-host crew members */}
        {showCrewPayment && !isHost && (
          <div className="mt-3">
            <Card className={`${isLight ? 'bg-cyan-50 border-cyan-200' : 'bg-cyan-500/10 border-cyan-500/30'}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`font-medium ${textPrimaryClass}`}>Your Share</p>
                    <p className={`text-2xl font-bold text-cyan-400`}>
                      ${booking.my_share?.toFixed(2) || (booking.total_price / (booking.current_participants || 1)).toFixed(2)}
                    </p>
                  </div>
                  <Button
                    onClick={() => navigate(`/bookings/pay/${booking.id}`)}
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white"
                  >
                    Pay Now
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Invite friends button for confirmed bookings */}
        {canInvite && (
          <Button
            variant="outline"
            className={`w-full mt-3 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
            size="sm"
            onClick={() => onInvite?.(booking)}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Invite Friends to Split
          </Button>
        )}
        
        {/* Show enable splitting option if host but no invite code */}
        {isHost && booking.status === 'Confirmed' && !booking.invite_code && booking.max_participants > 1 && (
          <Button
            variant="outline"
            className={`w-full mt-3 ${isLight ? 'border-cyan-300 text-cyan-600' : 'border-cyan-500/50 text-cyan-400'}`}
            size="sm"
            onClick={() => onInvite?.({ ...booking, needsEnableSplitting: true })}
          >
            <Users className="w-4 h-4 mr-2" />
            Enable Crew Split
          </Button>
        )}
        
        {/* Show participant status if not host */}
        {!isHost && isParticipant && booking.status === 'Confirmed' && (
          <div className={`mt-3 p-3 rounded-lg ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
            <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-400'} flex items-center gap-2`}>
              <Users className="w-4 h-4" />
              You're in this session
              {myParticipant?.payment_status === 'Paid' && ' · Paid'}
            </p>
          </div>
        )}
      </CardContent>
      
      {/* Session Action Drawer - Command Center */}
      <SessionActionDrawer
        isOpen={showActionDrawer}
        onClose={() => setShowActionDrawer(false)}
        booking={booking}
        user={user}
        theme={theme}
        onRefresh={onRefresh}
        onOpenCrewHub={onOpenCrewHub}
        onOpenModify={onOpenModify}
        onOpenCrewView={onOpenCrewView}
      />
    </Card>
  );
};

export default BookingCard;
