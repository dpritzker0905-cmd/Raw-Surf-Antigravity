import React from 'react';
import { Calculator } from 'lucide-react';

// Potential Earnings Calculator Component
const PotentialEarningsCalculator = ({ 
  buyinPrice, 
  maxSurfers, 
  photoPrice, 
  estimatedPhotosPerSurfer = 5,
  commissionRate = 0.20,
  isLight,
  textPrimaryClass,
  textSecondaryClass 
}) => {
  const buyinEarnings = buyinPrice * maxSurfers;
  const photoEarnings = photoPrice * estimatedPhotosPerSurfer * maxSurfers;
  const grossTotal = buyinEarnings + photoEarnings;
  const platformFee = grossTotal * commissionRate;
  const netTotal = grossTotal - platformFee;
  const commissionPercent = Math.round(commissionRate * 100);
  
  return (
    <div className={`p-4 rounded-xl bg-gradient-to-r ${isLight ? 'from-amber-50 to-orange-50 border border-amber-200' : 'from-amber-500/10 to-orange-500/10 border border-amber-500/30'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-5 h-5 text-amber-400" />
        <span className={`font-bold ${textPrimaryClass}`}>Potential Earnings</span>
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className={textSecondaryClass}>Buy-ins ({maxSurfers} × ${buyinPrice})</span>
          <span className="text-green-400 font-medium">${buyinEarnings}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className={textSecondaryClass}>Photo sales (est. {estimatedPhotosPerSurfer}/surfer × ${photoPrice})</span>
          <span className="text-cyan-400 font-medium">${photoEarnings}</span>
        </div>
        <div className={`pt-2 border-t ${isLight ? 'border-amber-200' : 'border-amber-500/30'}`}>
          <div className="flex justify-between text-sm mb-1">
            <span className={textSecondaryClass}>Gross Total</span>
            <span className={textPrimaryClass}>${grossTotal}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span className={textSecondaryClass}>Platform fee ({commissionPercent}%)</span>
            <span className="text-red-400">-${platformFee.toFixed(2)}</span>
          </div>
        </div>
        <div className={`pt-2 border-t ${isLight ? 'border-amber-200' : 'border-amber-500/30'} flex justify-between`}>
          <span className={`font-bold ${textPrimaryClass}`}>Your Net Earnings</span>
          <span className="text-amber-400 text-xl font-bold">${netTotal.toFixed(2)}</span>
        </div>
      </div>
      
      <p className={`text-xs ${textSecondaryClass} mt-2`}>
        Based on {maxSurfers} surfers at ${buyinPrice} buy-in + ~{estimatedPhotosPerSurfer} photos each at ${photoPrice}
      </p>
    </div>
  );
};

export default PotentialEarningsCalculator;
