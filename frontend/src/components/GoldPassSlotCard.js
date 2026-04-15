/**
 * GoldPassSlotCard - Booking slot card with Gold-Pass time-gate logic
 * 
 * Gold Pass = Premium subscription (tier_3) benefit
 * - Premium users see ALL slots immediately
 * - Non-premium users see slots after 2-hour exclusive window
 * 
 * Features:
 * - Shows countdown timer for locked slots (non-Premium users)
 * - Visual feedback for Gold-Pass early access
 * - Real-time countdown updates
 * - Photographer info display
 */
import React, { useState, useEffect } from 'react';
import { Clock, Lock, Crown, Calendar, Unlock, Camera, MapPin } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

export const GoldPassSlotCard = ({ 
  slot, 
  hasGoldPass, 
  onBook, 
  disabled = false,
  showPhotographer = true
}) => {
  const [minutesRemaining, setMinutesRemaining] = useState(slot.unlock_minutes_remaining || 0);
  const [isLocked, setIsLocked] = useState(slot.is_locked);

  // Real-time countdown for locked slots
  useEffect(() => {
    if (!isLocked || minutesRemaining <= 0) return;

    const interval = setInterval(() => {
      setMinutesRemaining(prev => {
        if (prev <= 1) {
          setIsLocked(false);
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [isLocked, minutesRemaining]);

  // Format time for display (HH:MM -> 7:00 AM)
  const formatTime = (time) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Format countdown display
  const formatCountdown = (mins) => {
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remaining = mins % 60;
      return `${hours}h ${remaining}m`;
    }
    return `${mins}m`;
  };

  return (
    <div 
      className={`p-4 rounded-xl border transition-all ${
        isLocked 
          ? 'bg-zinc-900/80 border-yellow-500/30 hover:border-yellow-500/50' 
          : hasGoldPass 
            ? 'bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border-yellow-500/50 hover:border-yellow-400' 
            : 'bg-zinc-800/50 border-zinc-700 hover:border-cyan-500/50'
      }`}
      data-testid={`gold-pass-slot-${slot.id}`}
    >
      {/* Photographer Info */}
      {showPhotographer && slot.photographer_name && (
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-700/50">
          <Avatar className="w-10 h-10 border-2 border-cyan-500/30">
            <AvatarImage src={slot.photographer_avatar} />
            <AvatarFallback className="bg-cyan-500/20 text-cyan-400">
              <Camera className="w-4 h-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium text-white text-sm">{slot.photographer_name}</p>
            {slot.spot_name && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {slot.spot_name}
              </p>
            )}
          </div>
          {hasGoldPass && !isLocked && (
            <Badge className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black border-0 text-[10px]">
              <Crown className="w-3 h-3 mr-1" />
              GOLD
            </Badge>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Time Icon */}
          <div className={`p-2.5 rounded-full ${
            isLocked 
              ? 'bg-yellow-500/20' 
              : hasGoldPass 
                ? 'bg-yellow-500/30' 
                : 'bg-cyan-500/20'
          }`}>
            {isLocked ? (
              <Lock className="w-5 h-5 text-yellow-400" />
            ) : (
              <Calendar className="w-5 h-5 text-cyan-400" />
            )}
          </div>
          
          {/* Time & Date */}
          <div>
            <p className="font-semibold text-white">
              {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
            </p>
            <p className="text-sm text-gray-400">
              {slot.is_recurring 
                ? `Every ${slot.recurring_days?.join(', ')}` 
                : formatDate(slot.date)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Gold-Pass Early Access Badge (when unlocked for gold users) */}
          {hasGoldPass && !isLocked && !showPhotographer && (
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
              <Crown className="w-3 h-3 mr-1" />
              Early Access
            </Badge>
          )}

          {/* Locked State Badge */}
          {isLocked && !hasGoldPass && (
            <Badge className="bg-zinc-700 text-gray-300 text-xs">
              <Lock className="w-3 h-3 mr-1" />
              {formatCountdown(minutesRemaining)}
            </Badge>
          )}

          {/* Book Button */}
          <Button
            onClick={() => onBook(slot)}
            disabled={disabled || (isLocked && !hasGoldPass)}
            size="sm"
            className={
              isLocked && !hasGoldPass
                ? 'bg-zinc-700 text-gray-500 cursor-not-allowed'
                : hasGoldPass
                  ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-black hover:from-yellow-500 hover:to-amber-600 font-semibold'
                  : 'bg-cyan-500 hover:bg-cyan-600 text-black font-semibold'
            }
          >
            {isLocked && !hasGoldPass ? (
              <>
                <Lock className="w-3 h-3 mr-1" />
                Locked
              </>
            ) : (
              'Book Now'
            )}
          </Button>
        </div>
      </div>

      {/* Countdown Timer Banner - For locked slots */}
      {isLocked && !hasGoldPass && minutesRemaining > 0 && (
        <div className="mt-4 p-3 bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-yellow-400">
              <Clock className="w-4 h-4 animate-pulse" />
              <span className="text-sm font-medium">
                Gold-Pass Early Access
              </span>
            </div>
            <div className="flex items-center gap-1 text-yellow-400 font-mono">
              <span className="text-lg font-bold">{formatCountdown(minutesRemaining)}</span>
              <span className="text-xs">left</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Upgrade to Premium for instant access to all exclusive slots
          </p>
        </div>
      )}

      {/* Just Unlocked indicator */}
      {!isLocked && slot.unlock_minutes_remaining === 0 && slot.is_locked === false && !hasGoldPass && (
        <div className="mt-2 flex items-center gap-1 text-green-400 text-xs">
          <Unlock className="w-3 h-3" />
          Now available to book
        </div>
      )}
    </div>
  );
};

export default GoldPassSlotCard;
