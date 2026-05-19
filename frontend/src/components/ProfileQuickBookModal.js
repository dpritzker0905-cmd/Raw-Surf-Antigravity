import React from 'react';
import { Zap, CalendarClock, Camera, Clock, Calculator, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { NumericStepper } from './ui/numeric-stepper';
import { getFullUrl } from '../utils/media';

/**
 * Quick Book modal -- lets surfers request on-demand or scheduled bookings
 * with a photographer directly from their profile.
 * Extracted from Profile.js to reduce god-component complexity.
 */
export const ProfileQuickBookModal = ({
  isOpen,
  onClose,
  profile,
  quickBookType,
  quickBookDuration,
  setQuickBookDuration,
  quickBookLoading,
  quickBookHourlyRate,
  quickBookTotal,
  photographerPricing,
  isOnDemandActive,
  onSubmit,
}) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
      <DialogHeader>
        <DialogTitle className="text-xl font-bold flex items-center gap-2">
          {quickBookType === 'on-demand' ? (
            <>
              <Zap className="w-5 h-5 text-yellow-400" />
              Quick Book - On-Demand
            </>
          ) : (
            <>
              <CalendarClock className="w-5 h-5 text-cyan-400" />
              Quick Book - Scheduled
            </>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Photographer Info */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-zinc-800">
          <Avatar className="w-14 h-14 border-2 border-cyan-400">
            <AvatarImage src={getFullUrl(profile?.avatar_url)} />
            <AvatarFallback className="bg-zinc-700 text-cyan-400">
              {profile?.full_name?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h3 className="font-semibold text-white">{profile?.full_name}</h3>
            <p className="text-sm text-gray-400">{profile?.role}</p>
            {quickBookType === 'on-demand' && isOnDemandActive && (
              <div className="flex items-center gap-1 mt-1">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400">Available Now</span>
              </div>
            )}
          </div>
        </div>

        {/* Live Price Calculator */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-400/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-yellow-400" />
              <span className="font-bold text-white">Price Calculator</span>
            </div>
            <span className="text-2xl font-bold text-yellow-400">${quickBookTotal.toFixed(2)}</span>
          </div>
          <p className="text-sm text-gray-400">
 ${quickBookHourlyRate}/hr + {quickBookDuration} hr{quickBookDuration > 1 ? 's' : ''} = ${quickBookTotal.toFixed(2)}
          </p>
        </div>

        {/* Duration Stepper */}
        <NumericStepper
          label="Session Duration"
          value={quickBookDuration}
          onChange={setQuickBookDuration}
          min={0.5}
          max={8}
          step={0.5}
          suffix="hours"
          description={`Rate: $${quickBookHourlyRate}/hour`}
          theme="dark"
        />

        {/* What's included */}
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30">
          <p className="text-green-400 font-medium mb-2">What's Included:</p>
          <ul className="text-sm text-gray-400 space-y-1">
            <li className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-green-400" />
              {photographerPricing?.on_demand_photos_included || 3} photos included
            </li>
            <li className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-green-400" />
              {quickBookDuration} hour{quickBookDuration > 1 ? 's' : ''} of dedicated shooting
            </li>
            {quickBookType === 'on-demand' && (
              <li className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-green-400" />
                Immediate response from photographer
              </li>
            )}
          </ul>
        </div>

        {/* Info note for scheduled */}
        {quickBookType === 'scheduled' && (
          <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
            <p className="text-sm text-cyan-400">
              You'll be redirected to the full booking page to select your preferred date and time.
            </p>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onClose(false)}>
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          disabled={quickBookLoading}
          className={`flex-1 ${
            quickBookType === 'on-demand'
              ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black'
              : 'bg-gradient-to-r from-cyan-400 to-blue-500 text-black'
          } font-bold`}
          data-testid="quick-book-submit-btn"
        >
          {quickBookLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : quickBookType === 'on-demand' ? (
            <>
              <Zap className="w-4 h-4 mr-2" />
              Send Request - ${quickBookTotal.toFixed(2)}
            </>
          ) : (
            <>
              <CalendarClock className="w-4 h-4 mr-2" />
              Continue to Booking
            </>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
