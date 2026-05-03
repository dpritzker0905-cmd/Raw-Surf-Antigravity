/**
 * BookingConfirmation — Success confirmation modal after booking.
 * Shows booking details, next steps, and cross-sell suggestions.
 * 
 * Extracted from ScheduledBookingDrawer.js for maintainability.
 */
import React from 'react';
import {
  Camera, MapPin, Clock, DollarSign, Check, Star, Bell, Gift,
  Sparkles, ChevronRight, CheckCircle2
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
const CrossSellSuggestion = ({ type, _photographerName, onAction, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  if (type === 'live_now') {
    return (
      <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-r from-green-50 to-emerald-50' : 'bg-gradient-to-r from-green-500/10 to-emerald-500/10'} border border-green-500/30`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <Radio className="w-5 h-5 text-green-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <p className={`font-medium ${textPrimary}`}>Can't Wait?</p>
            <p className={`text-sm ${textSecondary}`}>Check if photographers are live NOW</p>
          </div>
          <Button
            size="sm"
            onClick={() => onAction('live_now')}
            className="bg-green-500 hover:bg-green-600 text-black"
          >
            <Zap className="w-4 h-4 mr-1" />
            Live Now
          </Button>
        </div>
      </div>
    );
  }
  
  return null;
};


const BookingConfirmation = ({ 
  booking, 
  photographer, 
  onClose, 
  onViewBookings,
  onAddAnotherSpot,
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  return (
    <div className="text-center py-6 space-y-6">
      {/* Success Animation */}
      <div className="relative">
        <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center animate-pulse">
          <CheckCircle2 className="w-12 h-12 text-white" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-black" />
        </div>
      </div>
      
      <div>
        <h3 className={`text-2xl font-bold ${textPrimary}`}>Session Booked!</h3>
        <p className={textSecondary}>
          Your session with {photographer?.full_name} is confirmed
        </p>
      </div>
      
      {/* Booking Details */}
      <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-left space-y-3`}>
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-yellow-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>
              {booking?.session_date ? new Date(booking.session_date).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              }) : 'Date TBD'}
            </p>
            <p className={`text-sm ${textSecondary}`}>{booking?.duration || 60} minutes</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-orange-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>Impact Zone</p>
            <p className={`text-sm ${textSecondary}`}>{booking?.location || 'Location set'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-green-400" />
          <div>
            <p className={`font-medium ${textPrimary}`}>${booking?.total_paid?.toFixed(2) || '0.00'}</p>
            <p className={`text-sm ${textSecondary}`}>Total Paid</p>
          </div>
        </div>
      </div>
      
      {/* Push Notification Notice */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border ${isLight ? 'border-blue-200' : 'border-blue-500/30'}`}>
        <Bell className="w-5 h-5 text-blue-400" />
        <p className={`text-sm ${isLight ? 'text-blue-700' : 'text-blue-300'}`}>
          You'll receive a notification when it's time to head out!
        </p>
      </div>
      
      {/* Gamification - XP Earned */}
      <div className={`flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30`}>
        <Gift className="w-5 h-5 text-purple-400" />
        <span className={`font-medium ${textPrimary}`}>+50 XP earned!</span>
        <Badge className="bg-purple-500/20 text-purple-400 text-xs">Passport</Badge>
      </div>
      
      {/* Escrow Protection Notice */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border ${isLight ? 'border-green-200' : 'border-green-500/30'}`}>
        <Check className="w-5 h-5 text-green-400" />
        <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-300'}`}>
          Payment protected until session complete & content delivered
        </p>
      </div>
      
      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button
          onClick={onAddAnotherSpot}
          className="w-full bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-black font-bold"
          data-testid="add-another-spot-btn"
        >
          <MapPin className="w-4 h-4 mr-2" />
          Add Another Spot to This Trip
        </Button>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-zinc-700"
          >
            Close
          </Button>
          <Button
            onClick={onViewBookings}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            View My Bookings
          </Button>
        </div>
      </div>
    </div>
  );
};

export { BookingConfirmation, CrossSellSuggestion };
export default BookingConfirmation;

