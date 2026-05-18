/**
 * BookingSessionSummary G Extracted from ScheduledBookingDrawer.js (v80)
 *
 * Displays the session details summary and crew payment info within
 * the payment step of the booking flow.
 */
import React from 'react';
import { Crown, Users } from 'lucide-react';

const BookingSessionSummary = ({
  selectedDate,
  selectedTime,
  selectedDuration,
  impactZone,
  crewSplitEnabled,
  crewMembers,
  maxParticipants,
  groupDiscountPercent,
  discountAmount,
  totalPrice,
  captainShare,
  pricePerPerson,
  isLight,
  textPrimary,
  textSecondary,
}) => {
  return (
    <>
      {/* Session Summary */}
      <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
        <h4 className={`font-medium text-sm ${textPrimary} mb-2`}>Session Summary</h4>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className={textSecondary}>Date & Time</span>
            <span className={textPrimary}>
              {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={textSecondary}>Duration</span>
            <span className={textPrimary}>{selectedDuration} min</span>
          </div>
          <div className="flex justify-between">
            <span className={textSecondary}>Location</span>
            <span className={`${textPrimary} truncate ml-2 max-w-[150px]`}>{impactZone?.description}</span>
          </div>
          {crewSplitEnabled && (
            <>
              <div className="flex justify-between">
                <span className={textSecondary}>Crew Size</span>
                <span className={textPrimary}>{maxParticipants} surfers</span>
              </div>
              {groupDiscountPercent > 0 && (
                <div className="flex justify-between text-green-400">
                  <span>Group Discount ({groupDiscountPercent}%)</span>
                  <span>-${discountAmount.toFixed(2)}</span>
                </div>
              )}
            </>
          )}
          <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
            <span className={`font-bold ${textPrimary}`}>Total</span>
            <span className="font-bold text-yellow-400">${totalPrice.toFixed(2)}</span>
          </div>
          {crewSplitEnabled && (
            <div className="flex justify-between">
              <span className={`font-bold ${textPrimary} flex items-center gap-1`}>
                <Crown className="w-3 h-3 text-yellow-400" />
                Your Share
              </span>
              <span className="font-bold text-cyan-400">${captainShare.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Crew Payment Info */}
      {crewSplitEnabled && crewMembers.length > 0 && (
        <div className={`p-2 rounded-lg ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border ${isLight ? 'border-cyan-200' : 'border-cyan-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-3 h-3 text-cyan-400" />
            <span className={`text-xs font-medium ${textPrimary}`}>Crew Payments</span>
          </div>
          <p className={`text-xs ${textSecondary}`}>
            ${pricePerPerson.toFixed(2)} each sent to crew via Messages.
          </p>
        </div>
      )}
    </>
  );
};

export default BookingSessionSummary;
