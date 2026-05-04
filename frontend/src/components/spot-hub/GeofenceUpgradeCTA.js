/**
 * GeofenceUpgradeCTA — Geofence upgrade call-to-action for subscription upsell.
 * 
 * Extracted from UnifiedSpotDrawer.js for maintainability.
 */
import React from 'react';
import { MapPin, Lock, Sparkles, Crown, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { motion } from 'framer-motion';
const GeofenceUpgradeCTA = ({ distanceMiles, _visibilityRadius, activePhotographersCount = 0 }) => {
  const navigate = useNavigate();
  
  return (
    <div className="mx-4 my-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl">
      {/* High Intent Upsell - Show real photographer count */}
      {activePhotographersCount > 0 && (
        <div className="bg-gradient-to-r from-cyan-500/20 to-green-500/20 border border-cyan-500/40 rounded-lg p-3 mb-3 animate-pulse">
          <div className="flex items-center justify-center gap-2">
            <Camera className="w-5 h-5 text-cyan-400" />
            <span className="text-white font-bold text-lg">
              {activePhotographersCount} Pro{activePhotographersCount > 1 ? 's' : ''} Shooting Now
            </span>
          </div>
          <p className="text-center text-cyan-300 text-sm mt-1">
            Upgrade to Premium to Book
          </p>
        </div>
      )}
      
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Lock className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h3 className="text-white font-medium">Outside Your Coverage Area</h3>
          <p className="text-gray-400 text-xs">
            {distanceMiles ? `${distanceMiles.toFixed(1)} miles away` : 'Expand your range to view live activity'}
          </p>
        </div>
      </div>
      
      <div className="bg-zinc-800/50 rounded-lg p-3 mb-3">
        <p className="text-gray-300 text-sm mb-2">
          Upgrade to see:
        </p>
        <ul className="space-y-1 text-xs text-gray-400">
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Live photographers at this spot
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Real-time conditions & session reports
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Instant booking capability
          </li>
        </ul>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <Button aria-label="Crown"
          onClick={() => navigate('/settings?tab=billing')}
          className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium"
          data-testid="upgrade-plan-btn"
        >
          <Crown className="w-4 h-4 mr-1" />
          Upgrade Plan
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate('/wallet')}
          className="border-purple-500/50 text-purple-400"
          data-testid="view-plans-btn"
        >
          View Plans
        </Button>
      </div>
      
      <p className="text-center text-gray-500 text-[10px] mt-2">
        Premium members get unlimited range access
      </p>
    </div>
  );
};

// Jump In Flow Component (Selfie + Payment) - Integrated into Drawer

export default GeofenceUpgradeCTA;

