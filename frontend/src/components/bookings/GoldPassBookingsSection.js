/**
 * GoldPassBookingsSection - Exclusive early-access booking slots for Premium subscribers
 * 
 * Gold Pass Feature:
 * - Premium (tier_3) subscribers get 2-hour early access to new photographer slots
 * - Non-premium users see locked slots with countdown timers
 * - Creates urgency and incentivizes upgrades
 * 
 * Placement: Bookings page, before the main booking tabs
 */
import React, { useState, useEffect } from 'react';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { 
  Crown, Sparkles, Loader2, ChevronRight, Lock, 
  Calendar, Clock, Camera, ArrowUpRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';
import { GoldPassSlotCard } from '../GoldPassSlotCard';
import { useNavigate } from 'react-router-dom';
import logger from '../../utils/logger';


export const GoldPassBookingsSection = ({ user, theme, onBookingComplete }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState([]);
  const [hasGoldPass, setHasGoldPass] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [booking, setBooking] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    if (user?.id) {
      fetchGoldPassSlots();
    }
  }, [user?.id]);

  const fetchGoldPassSlots = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/career/gold-pass/available?surfer_id=${user.id}`);
      setSlots(response.data.slots || []);
      setHasGoldPass(response.data.has_gold_pass || false);
    } catch (error) {
      logger.error('Failed to fetch gold pass slots:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBookSlot = async (slot) => {
    setSelectedSlot(slot);
  };

  const confirmBooking = async () => {
    if (!selectedSlot) return;
    setBooking(true);
    try {
      await apiClient.post(
        `/career/gold-pass/${selectedSlot.id}/book?surfer_id=${user.id}`
      );
      toast.success(
        hasGoldPass 
          ? 'Booked with Gold Pass early access!' 
          : 'Slot booked successfully!'
      );
      setSelectedSlot(null);
      fetchGoldPassSlots();
      onBookingComplete?.();
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to book slot';
      toast.error(message);
    } finally {
      setBooking(false);
    }
  };

  // Don't show section if no slots and user doesn't have gold pass
  if (!loading && slots.length === 0 && !hasGoldPass) {
    return null;
  }

  // Count locked vs available
  const lockedCount = slots.filter(s => s.is_locked).length;
  const availableCount = slots.filter(s => !s.is_locked).length;
  const displaySlots = expanded ? slots : slots.slice(0, 3);

  return (
    <>
      <Card className={`${cardBgClass} border-2 ${hasGoldPass ? 'border-yellow-500/50' : 'border-yellow-500/20'} mb-4`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className={`${textPrimaryClass} flex items-center gap-2 text-base`}>
              <div className={`p-1.5 rounded-full ${hasGoldPass ? 'bg-gradient-to-r from-yellow-400 to-amber-500' : 'bg-yellow-500/20'}`}>
                <Crown className={`w-4 h-4 ${hasGoldPass ? 'text-black' : 'text-yellow-400'}`} />
              </div>
              Gold Pass Bookings
              {hasGoldPass && (
                <Badge className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black border-0 text-[10px] ml-2">
                  ACTIVE
                </Badge>
              )}
            </CardTitle>
            {!hasGoldPass && slots.length > 0 && (
              <Button 
                size="sm" 
                variant="outline"
                className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
                onClick={() => navigate('/settings?tab=billing')}
              >
                <ArrowUpRight className="w-3 h-3 mr-1" />
                Upgrade
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-yellow-400" />
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center py-6">
              <Sparkles className="w-10 h-10 mx-auto text-yellow-400/50 mb-2" />
              <p className={`${textSecondaryClass} text-sm`}>
                No exclusive slots available right now
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Check back soon for early-access photographer bookings
              </p>
            </div>
          ) : (
            <>
              {/* Status summary */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                {hasGoldPass ? (
                  <div className="flex items-center gap-2 text-yellow-400">
                    <Sparkles className="w-4 h-4" />
                    <span>{slots.length} exclusive slots available</span>
                  </div>
                ) : (
                  <>
                    {availableCount > 0 && (
                      <div className="flex items-center gap-1 text-green-400">
                        <Calendar className="w-4 h-4" />
                        <span>{availableCount} available</span>
                      </div>
                    )}
                    {lockedCount > 0 && (
                      <div className="flex items-center gap-1 text-yellow-400">
                        <Lock className="w-4 h-4" />
                        <span>{lockedCount} locked (Gold Pass)</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Slot cards */}
              <div className="space-y-3">
                {displaySlots.map(slot => (
                  <GoldPassSlotCard
                    key={slot.id}
                    slot={slot}
                    hasGoldPass={hasGoldPass}
                    onBook={handleBookSlot}
                    showPhotographer={true}
                  />
                ))}
              </div>

              {/* Show more button */}
              {slots.length > 3 && (
                <Button
                  variant="ghost"
                  className="w-full mt-3 text-yellow-400 hover:bg-yellow-500/10"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'Show Less' : `Show All ${slots.length} Slots`}
                  <ChevronRight className={`w-4 h-4 ml-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                </Button>
              )}

              {/* Upgrade prompt for non-premium users */}
              {!hasGoldPass && lockedCount > 0 && (
                <div className="mt-4 p-3 bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/30 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Crown className="w-5 h-5 text-yellow-400 mt-0.5" />
                    <div className="flex-1">
                      <p className={`font-medium ${textPrimaryClass} text-sm`}>
                        Unlock {lockedCount} exclusive slots
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Premium subscribers get 2-hour early access to all new photographer slots
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black hover:from-yellow-500 hover:to-amber-600"
                      onClick={() => navigate('/settings?tab=billing')}
                    >
                      Upgrade
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Booking Confirmation Dialog */}
      <Dialog open={!!selectedSlot} onOpenChange={() => setSelectedSlot(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-cyan-400" />
              Confirm Booking
            </DialogTitle>
          </DialogHeader>
          {selectedSlot && (
            <div className="space-y-4">
              {/* Photographer */}
              <div className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg">
                <div className="p-2 bg-cyan-500/20 rounded-full">
                  <Camera className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <p className="font-medium">{selectedSlot.photographer_name}</p>
                  <p className="text-sm text-gray-400">Photographer</p>
                </div>
              </div>

              {/* Time */}
              <div className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg">
                <div className="p-2 bg-purple-500/20 rounded-full">
                  <Clock className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="font-medium">
                    {new Date(selectedSlot.slot_start).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })} - {new Date(selectedSlot.slot_end).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </p>
                  <p className="text-sm text-gray-400">
                    {new Date(selectedSlot.slot_start).toLocaleDateString([], {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </p>
                </div>
              </div>

              {/* Gold Pass Badge */}
              {hasGoldPass && selectedSlot.is_gold_pass_active && (
                <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <Crown className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-yellow-400">
                    Booking with Gold Pass early access
                  </span>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelectedSlot(null)}>
              Cancel
            </Button>
            <Button 
              onClick={confirmBooking}
              disabled={booking}
              className={hasGoldPass 
                ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-black hover:from-yellow-500 hover:to-amber-600"
                : "bg-cyan-500 hover:bg-cyan-600 text-black"
              }
            >
              {booking ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Confirm Booking'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GoldPassBookingsSection;
