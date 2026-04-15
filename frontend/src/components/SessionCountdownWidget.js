/**
 * SessionCountdownWidget - Live countdown cards for upcoming booked sessions
 * Shows on Feed for on-demand and scheduled bookings
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Clock, MapPin, Camera, Users, Waves, Calendar,
  ChevronRight, Timer, Zap, Sun, Sunrise, Sunset
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

// Time category icons
const getTimeIcon = (hour) => {
  if (hour >= 5 && hour < 7) return <Sunrise className="w-4 h-4 text-orange-400" />;
  if (hour >= 7 && hour < 17) return <Sun className="w-4 h-4 text-yellow-400" />;
  return <Sunset className="w-4 h-4 text-pink-400" />;
};

// Format countdown display
const formatCountdown = (ms) => {
  if (ms <= 0) return { text: 'Starting now!', urgent: true };
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return { 
      text: `${days}d ${hours % 24}h`, 
      urgent: false,
      detail: `${days} day${days > 1 ? 's' : ''}, ${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`
    };
  }
  if (hours > 0) {
    return { 
      text: `${hours}h ${minutes % 60}m`, 
      urgent: hours < 2,
      detail: `${hours} hour${hours > 1 ? 's' : ''}, ${minutes % 60} min`
    };
  }
  if (minutes > 0) {
    return { 
      text: `${minutes}m ${seconds % 60}s`, 
      urgent: true,
      detail: `${minutes} minute${minutes > 1 ? 's' : ''}`
    };
  }
  return { 
    text: `${seconds}s`, 
    urgent: true,
    detail: 'Less than a minute!'
  };
};

// Individual Session Card
const SessionCard = ({ booking, isLight, onViewDetails }) => {
  const [countdown, setCountdown] = useState({ text: '--', urgent: false });
  
  const sessionDate = new Date(booking.session_date);
  const hour = sessionDate.getHours();
  
  // Update countdown every second
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const diff = sessionDate - now;
      setCountdown(formatCountdown(diff));
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [booking.session_date]);
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  // Determine if this is an on-demand or scheduled booking
  const isOnDemand = booking.booking_type === 'on_demand' || booking.is_on_demand;
  
  return (
    <div 
      className={`relative overflow-hidden rounded-xl ${
        isLight 
          ? 'bg-gradient-to-br from-cyan-50 via-blue-50 to-indigo-50 border border-cyan-200' 
          : 'bg-gradient-to-br from-cyan-900/30 via-blue-900/20 to-indigo-900/30 border border-cyan-500/30'
      }`}
      data-testid={`session-countdown-${booking.id}`}
    >
      {/* Wave Pattern Background */}
      <div className="absolute inset-0 opacity-10">
        <svg viewBox="0 0 400 100" className="w-full h-full" preserveAspectRatio="none">
          <path 
            d="M0,50 Q100,20 200,50 T400,50 V100 H0 Z" 
            fill="currentColor" 
            className="text-cyan-500"
          />
        </svg>
      </div>
      
      <div className="relative p-4">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Booking Type Badge */}
            <Badge className={`${
              isOnDemand 
                ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
            }`}>
              {isOnDemand ? (
                <>
                  <Zap className="w-3 h-3 mr-1" />
                  On-Demand
                </>
              ) : (
                <>
                  <Calendar className="w-3 h-3 mr-1" />
                  Scheduled
                </>
              )}
            </Badge>
            
            {/* Time of day icon */}
            {getTimeIcon(hour)}
          </div>
          
          {/* Countdown Timer */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${
            countdown.urgent 
              ? 'bg-red-500/20 border border-red-500/50' 
              : 'bg-cyan-500/20 border border-cyan-500/30'
          }`}>
            <Timer className={`w-4 h-4 ${countdown.urgent ? 'text-red-400 animate-pulse' : 'text-cyan-400'}`} />
            <span className={`font-mono font-bold text-sm ${countdown.urgent ? 'text-red-400' : 'text-cyan-400'}`}>
              {countdown.text}
            </span>
          </div>
        </div>
        
        {/* Session Details */}
        <div className="space-y-2">
          {/* Location */}
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span className={`font-medium ${textPrimary} truncate`}>
              {booking.location || 'Location TBD'}
            </span>
          </div>
          
          {/* Date & Time */}
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            <span className={`text-sm ${textSecondary}`}>
              {sessionDate.toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric' 
              })} at {sessionDate.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit' 
              })}
            </span>
          </div>
          
          {/* Photographer */}
          {booking.photographer_name && (
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-pink-400 flex-shrink-0" />
              <span className={`text-sm ${textSecondary}`}>
                with <span className={textPrimary}>{booking.photographer_name}</span>
              </span>
            </div>
          )}
          
          {/* Crew count if applicable */}
          {booking.current_participants > 1 && (
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <span className={`text-sm ${textSecondary}`}>
                {booking.current_participants} surfers in crew
              </span>
            </div>
          )}
        </div>
        
        {/* Action Button */}
        <Button
          onClick={() => onViewDetails?.(booking)}
          size="sm"
          className="w-full mt-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
          data-testid={`view-session-${booking.id}`}
        >
          <Waves className="w-4 h-4 mr-2" />
          View Session Details
          <ChevronRight className="w-4 h-4 ml-auto" />
        </Button>
      </div>
    </div>
  );
};

// Main Widget Component
export const SessionCountdownWidget = ({ 
  bookings = [], 
  isLight = false, 
  onViewDetails,
  maxDisplay = 2 
}) => {
  const navigate = useNavigate();
  
  // Filter to only upcoming sessions (not past)
  const upcomingSessions = bookings
    .filter(b => new Date(b.session_date) > new Date())
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))
    .slice(0, maxDisplay);
  
  if (upcomingSessions.length === 0) return null;
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  const handleViewDetails = (booking) => {
    if (onViewDetails) {
      onViewDetails(booking);
    } else {
      // Navigate to bookings with the specific session highlighted
      navigate(`/bookings?tab=scheduled&session=${booking.id}`);
    }
  };
  
  return (
    <div className="space-y-3" data-testid="session-countdown-widget">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
            <Timer className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className={`font-semibold ${textPrimary}`}>Upcoming Sessions</h3>
            <p className={`text-xs ${textSecondary}`}>
              {upcomingSessions.length} session{upcomingSessions.length > 1 ? 's' : ''} coming up
            </p>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/bookings')}
          className={`text-xs ${textSecondary} hover:${textPrimary}`}
        >
          View All
          <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      </div>
      
      {/* Session Cards */}
      <div className="space-y-3">
        {upcomingSessions.map((booking) => (
          <SessionCard 
            key={booking.id} 
            booking={booking} 
            isLight={isLight}
            onViewDetails={handleViewDetails}
          />
        ))}
      </div>
    </div>
  );
};

export default SessionCountdownWidget;
