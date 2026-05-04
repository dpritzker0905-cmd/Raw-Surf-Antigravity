/**
 * NearbyMode — GPS-based spot discovery for Explore.
 * Extracted from Explore.js to reduce file size.
 * 
 * Features:
 * - GPS location status display
 * - Nearby spots grid with forecast info
 * - Loading spinner with compass animation
 * - Empty state with fallback to Browse mode
 * - Location permission request CTA
 */
import React from 'react';
import { MapPin, Globe, Compass, Waves } from 'lucide-react';
import { Badge } from '../ui/badge';
import ExploreSpotCard from '../ExploreSpotCard';

const NearbyMode = ({
  userLocation,
  nearbySpots,
  nearbyLoading,
  spotSearchQuery,
  user,
  fetchNearbySpots,
  setDiscoveryMode,
  activateNearbyMode,
}) => {
  return (
    <>
      {/* GPS Status */}
      {userLocation && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400">
            Located: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
          </span>
          <button
            onClick={() => fetchNearbySpots(userLocation.lat, userLocation.lng)}
            className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 underline"
            aria-label="Refresh nearby spots"
          >
            Refresh
          </button>
        </div>
      )}
      
      {/* Tiered Forecast Info Banner */}
      <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-cyan-400">
          <Waves className="w-4 h-4" />
          <span>
            <strong>Today</strong> = Current Conditions • <strong>Forecast:</strong> 3 days free, 7 paid, 10 premium
          </span>
        </div>
      </div>
      
      {/* Nearby Spots Results */}
      {nearbyLoading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="relative">
            <Compass className="w-10 h-10 text-emerald-400 animate-spin" />
            <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-emerald-400/20 animate-ping" />
          </div>
          <p className="text-sm text-gray-400">Finding spots near you...</p>
        </div>
      ) : nearbySpots.length === 0 && userLocation ? (
        <div className="text-center py-16 text-muted-foreground">
          <MapPin className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="font-medium mb-1">No spots found nearby</p>
          <p className="text-sm text-gray-500 mb-4">Try browsing by location instead</p>
          <button aria-label="Globe"
            onClick={() => setDiscoveryMode('browse')}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <Globe className="w-4 h-4 inline mr-2" />
            Browse All Locations
          </button>
        </div>
      ) : nearbySpots.length > 0 ? (
        <>
          <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
            {nearbySpots.filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase())).length} spots near you
          </Badge>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {nearbySpots
              .filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase()))
              .map((spot) => (
              <ExploreSpotCard 
                key={spot.id} 
                spot={spot} 
                userSubscriptionTier={user?.subscription_tier || 'free'}
              />
            ))}
          </div>
        </>
      ) : !userLocation ? (
        <div className="text-center py-16 text-muted-foreground">
          <Compass className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="font-medium mb-1">Enable Location Access</p>
          <p className="text-sm text-gray-500 mb-4">Allow location access to find surf spots near you</p>
          <button aria-label="Explore"
            onClick={activateNearbyMode}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 rounded-xl text-white text-sm font-medium transition-all shadow-lg shadow-emerald-500/20"
          >
            <Compass className="w-4 h-4 inline mr-2" />
            Use My Location
          </button>
        </div>
      ) : null}
    </>
  );
};

export default NearbyMode;
