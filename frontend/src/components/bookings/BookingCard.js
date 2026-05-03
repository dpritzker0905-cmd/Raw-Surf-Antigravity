/**
 * BookingCard — Individual booking card for photographer bookings manager.
 * Extracted from PhotographerBookingsManager.js.
 * 
 * Features:
 * - Location, date, time, duration display
 * - Status badges (Pending/Confirmed/Cancelled/Completed)
 * - Split session indicator with invite code
 * - Action buttons per status (Confirm/Manage/Cancel)
 * - Participant count and earnings display
 * - Highlight animation for deep-linked bookings
 */
import React, { forwardRef } from 'react';
import { MapPin, Calendar as CalendarIcon, Clock, Users, DollarSign, Check, X, UserPlus, Copy, Settings, Lock, Unlock, Share2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

const BookingCard = forwardRef(({
  booking,
  isHighlighted,
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  cardBgClass,
  // Handlers
  handleUpdateStatus,
  openEditModal,
  copyInviteCode,
  viewParticipants,
  onManageSession,
}, ref) => {
  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ${
        isHighlighted 
          ? 'ring-2 ring-pink-400 ring-offset-2 ring-offset-zinc-900 rounded-xl' 
          : ''
      }`}
    >
      <Card className={`${cardBgClass} transition-colors duration-300`} data-testid={`booking-${booking.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className={`font-medium ${textPrimaryClass}`}>Surf Photo Session</h3>
              <div className={`flex items-center gap-2 mt-1 text-sm ${textSecondaryClass}`}>
                <MapPin className="w-4 h-4" />
                <span>{booking.location}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {booking.allow_splitting && (
                <Badge variant="outline" className="text-cyan-400 border-cyan-400/50">
                  <Share2 className="w-3 h-3 mr-1" />
                  {booking.split_mode === 'open_nearby' ? 'Open' : 'Friends'}
                </Badge>
              )}
              <Badge variant={
                booking.status === 'Confirmed' ? 'default' :
                booking.status === 'Pending' ? 'outline' :
                booking.status === 'Completed' ? 'secondary' : 'destructive'
              }>
                {booking.status}
              </Badge>
            </div>
          </div>
          
          <div className={`flex items-center gap-4 text-sm ${textSecondaryClass} mb-3`}>
            <div className="flex items-center gap-1">
              <CalendarIcon className="w-4 h-4" />
              <span>{new Date(booking.session_date).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{new Date(booking.session_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{booking.duration} min</span>
            </div>
          </div>

          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-900/50'} mb-3`}>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Users className="w-4 h-4 text-cyan-400" />
                <span className={`text-sm ${textSecondaryClass}`}>
                  {booking.current_participants}/{booking.max_participants} spots
                </span>
              </div>
              <div className="flex items-center gap-1">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className={`text-sm ${textSecondaryClass}`}>
                  ${booking.price_per_person}/person
                </span>
              </div>
            </div>
            <span className="font-bold text-green-400">
              ${((booking.current_participants || 0) * booking.price_per_person).toFixed(2)}
            </span>
          </div>

          {/* Invite Code Section */}
          {booking.allow_splitting && booking.invite_code && booking.status === 'Confirmed' && (
            <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} mb-3`}>
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-cyan-400" />
                <span className={`text-sm ${textSecondaryClass}`}>Invite Code:</span>
                <span className={`font-mono font-bold ${textPrimaryClass}`}>{booking.invite_code}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyInviteCode(booking.invite_code)}
                className="text-cyan-400 hover:text-cyan-300"
                aria-label="Copy invite code"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Action Buttons for Pending */}
          {booking.status === 'Pending' && (
            <div className="flex gap-2">
              <Button
                onClick={() => handleUpdateStatus(booking.id, 'Confirmed')}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                size="sm"
              >
                <Check className="w-4 h-4 mr-1" />
                Confirm
              </Button>
              <Button
                onClick={() => openEditModal(booking)}
                variant="outline"
                className={`border-zinc-600 ${textSecondaryClass}`}
                size="sm"
              >
                <Settings className="w-4 h-4" />
              </Button>
              <Button
                onClick={() => handleUpdateStatus(booking.id, 'Cancelled')}
                variant="outline"
                className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                size="sm"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* View participants for confirmed */}
          {booking.status === 'Confirmed' && (
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white"
                size="sm"
                onClick={() => onManageSession(booking)}
                data-testid={`manage-session-btn-${booking.id}`}
              >
                {booking.lineup_status === 'open' ? <Unlock className="w-4 h-4 mr-1" /> : <Lock className="w-4 h-4 mr-1" />}
                Manage Session
              </Button>
              <Button
                variant="outline"
                className={`${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                size="sm"
                onClick={() => viewParticipants(booking)}
              >
                <Users className="w-4 h-4 mr-1" />
                ({booking.current_participants})
              </Button>
              <Button
                variant="outline"
                className={`border-zinc-600 ${textSecondaryClass}`}
                size="sm"
                onClick={() => openEditModal(booking)}
                data-testid={`edit-booking-btn-${booking.id}`}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

BookingCard.displayName = 'BookingCard';

export default BookingCard;
