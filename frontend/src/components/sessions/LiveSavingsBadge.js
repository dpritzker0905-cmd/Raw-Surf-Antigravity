import React from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';

// Live Savings Badge Component - Synced with UnifiedSpotDrawer
const LiveSavingsBadge = ({ generalPrice, livePrice, className = '' }) => {
  const savings = generalPrice - livePrice;
  const _savingsPercent = Math.round((savings / generalPrice) * 100);
  
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold animate-pulse ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings} per photo!
    </Badge>
  );
};

export default LiveSavingsBadge;
