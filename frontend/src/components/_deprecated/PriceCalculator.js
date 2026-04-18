import React from 'react';
import { Calculator, Users, Clock } from 'lucide-react';

/**
 * PriceCalculator - Real-time pricing math component
 * Extracted from Bookings.js for modularity and reusability
 * 
 * Formula: (Base Hourly Rate × Hours) + (Per-Surfer Fee × Additional Crew) = Total
 */

export const usePriceCalculator = ({
  hourlyRate = 75,
  perSurferFee = 15,
  durationHours = 1,
  crewCount = 0,
  photosIncluded = 3
}) => {
  // Base session price
  const baseSessionPrice = hourlyRate * durationHours;
  
  // Additional crew cost
  const crewAdditionalCost = perSurferFee * crewCount;
  
  // Total price
  const totalPrice = baseSessionPrice + crewAdditionalCost;
  
  // Split calculation
  const totalParticipants = crewCount + 1; // +1 for primary surfer
  const perPersonSplit = totalPrice / totalParticipants;
  
  return {
    baseSessionPrice,
    crewAdditionalCost,
    totalPrice,
    totalParticipants,
    perPersonSplit,
    photosIncluded
  };
};

export const PriceBreakdown = ({
  pricing,
  durationHours = 1,
  crewCount = 0,
  perSurferFee = 15,
  hourlyRate = 75,
  theme = 'dark',
  compact = false
}) => {
  const isLight = theme === 'light';
  const {
    baseSessionPrice,
    crewAdditionalCost,
    totalPrice,
    totalParticipants,
    perPersonSplit
  } = pricing;

  if (compact) {
    return (
      <div className={`flex items-center justify-between ${isLight ? 'text-gray-900' : 'text-white'}`}>
        <span className="text-sm">Total</span>
        <span className="text-lg font-bold text-yellow-400">${totalPrice.toFixed(2)}</span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Calculator className="w-4 h-4 text-yellow-400" />
        <span className={`text-sm font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
          Price Breakdown
        </span>
      </div>

      {/* Line Items */}
      <div className="space-y-2">
        <div className={`flex items-center justify-between text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>Base Rate ({durationHours}hr × ${hourlyRate})</span>
          </div>
          <span>${baseSessionPrice.toFixed(2)}</span>
        </div>

        {crewCount > 0 && (
          <div className={`flex items-center justify-between text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>Crew ({crewCount} × ${perSurferFee})</span>
            </div>
            <span>+${crewAdditionalCost.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className={`border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`} />

      {/* Total */}
      <div className="flex items-center justify-between">
        <span className={`font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>Total</span>
        <span className="text-xl font-bold text-yellow-400">${totalPrice.toFixed(2)}</span>
      </div>

      {/* Per Person Split (if crew) */}
      {crewCount > 0 && (
        <div className={`flex items-center justify-between text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          <span>Per person ({totalParticipants} surfers)</span>
          <span className="text-cyan-400">${perPersonSplit.toFixed(2)} each</span>
        </div>
      )}

      {/* Formula tooltip */}
      <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
        <span className="font-medium">Formula:</span> Base (${baseSessionPrice.toFixed(2)}) 
        {crewCount > 0 && ` + Crew ($${perSurferFee} × ${crewCount})`} = ${totalPrice.toFixed(2)}
      </div>
    </div>
  );
};

export default PriceBreakdown;
