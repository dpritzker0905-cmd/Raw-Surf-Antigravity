import React from 'react';
import { Camera, Clock, MapPin, CheckCircle2 } from 'lucide-react';

export var BookingConfirmStep = ({
  photographer,
  selectedDate,
  selectedTime,
  impactZone,
  totalPrice,
  appliedCredits,
  isLight,
  textPrimary,
  textSecondary
}) => {
  return (
    <div className="space-y-4 pb-4">
      <div className={`p-3 rounded-xl ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} border border-yellow-500/30`}>
        <h4 className={`font-bold text-sm ${textPrimary} mb-2 flex items-center gap-2`}>
          <CheckCircle2 className="w-4 h-4 text-yellow-400" />
          Confirm Your Booking
        </h4>
        
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <Camera className="w-3 h-3 text-gray-500" />
            <span className={textPrimary}>{photographer?.full_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-gray-500" />
            <span className={textPrimary}>
              {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-3 h-3 text-gray-500" />
            <span className={`${textPrimary} truncate`}>{impactZone?.description}</span>
          </div>
          
          <div className={`pt-2 border-t ${isLight ? 'border-yellow-200' : 'border-yellow-500/30'}`}>
            <div className="flex justify-between">
              <span className={textSecondary}>Total</span>
              <span className={textPrimary}>${totalPrice.toFixed(2)}</span>
            </div>
            {appliedCredits > 0 && (
              <div className="flex justify-between text-yellow-500">
                <span>Credits</span>
                <span>-${appliedCredits.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm mt-1">
              <span className={textPrimary}>Pay Now</span>
              <span className="text-green-400">${(totalPrice - appliedCredits).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
