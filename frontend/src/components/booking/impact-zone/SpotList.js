import React from 'react';
import { MapPin, Check, Anchor } from 'lucide-react';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';

export var SpotList = ({
  userCoords,
  selectedState,
  selectedCountry,
  nearbySpots,
  selectedTier,
  setSelectedTier,
  localSpots,
  extendedSpots,
  searchQuery,
  setSearchQuery,
  isLight,
  textPrimary,
  textSecondary,
  displayedSpots,
  handleSpotSelect,
  getFeeBadge,
  location,
  showAllSpots,
  setShowAllSpots,
  filteredSpotsLength
}) => {
  return (
    <div className="space-y-2">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${textPrimary}`}>
          <MapPin className="w-3 h-3 inline mr-1 text-cyan-400" />
          {userCoords 
            ? `Spots Near You (${nearbySpots.length})` 
            : `Spots in ${selectedState || selectedCountry} (${nearbySpots.length})`
          }
        </span>
      </div>
      
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {[
          { key: 'all', label: `All (${nearbySpots.length})`, color: 'bg-cyan-500', show: true },
          { key: 'local', label: `No Fee (${localSpots.length})`, color: 'bg-green-500', show: true },
          { key: 'extended', label: `+Fee (${extendedSpots.length})`, color: 'bg-yellow-500', show: extendedSpots.length > 0 },
        ].filter(t => t.show).map(t => (
          <button key={t.key} onClick={() => setSelectedTier(t.key)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
              selectedTier === t.key ? `${t.color} text-black` : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
            }`}
          >{t.label}</button>
        ))}
      </div>
      
      {/* Search within spots */}
      {nearbySpots.length > 8 && (
        <Input aria-label="Search spots..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search spots..."
          className={`h-8 text-xs ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
        />
      )}
      
      {/* Spots List */}
      <div className="space-y-1 max-h-[180px] overflow-y-auto">
        {displayedSpots.length === 0 ? (
          <p className={`text-xs ${textSecondary} text-center py-2`}>No spots match filter</p>
        ) : (
          displayedSpots.map((spot) => {
            const feeBadge = getFeeBadge(spot);
            const isOutOfRange = feeBadge.text === 'Out of Range';
            const isSelected = location?.spot_id === spot.id;
            const isPier = spot.name.toLowerCase().includes('pier') || spot.name.toLowerCase().includes('jetty');
            
            return (
              <button
                key={spot.id}
                onClick={() => handleSpotSelect(spot)}
                disabled={isOutOfRange}
                className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-all ${
                  isOutOfRange
                    ? 'border-red-500/30 bg-red-500/5 opacity-50 cursor-not-allowed'
                    : isSelected 
                      ? 'border-cyan-500 bg-cyan-500/10' 
                      : 'border-zinc-700 hover:border-zinc-600'
                }`}
              >
                {isPier ? (
                  <Anchor className={`w-3.5 h-3.5 flex-shrink-0 ${
                    isOutOfRange ? 'text-red-400' : isSelected ? 'text-cyan-400' : 'text-gray-500'
                  }`} />
                ) : (
                  <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${
                    isOutOfRange ? 'text-red-400' : isSelected ? 'text-cyan-400' : 'text-gray-500'
                  }`} />
                )}
                <div className="flex-1 min-w-0 text-left">
                  <span className={`text-xs block truncate ${textPrimary}`}>{spot.name}</span>
                  {spot.distanceFromUser != null && (
                    <span className={`text-[10px] ${textSecondary}`}>
                      {spot.distanceFromUser.toFixed(1)} mi from you
                    </span>
                  )}
                </div>
                <Badge className={`text-[10px] px-1.5 py-0 ${feeBadge.color}`}>
                  {feeBadge.text}
                </Badge>
                {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />}
              </button>
            );
          })
        )}
      </div>
      
      {/* Show more button */}
      {filteredSpotsLength > 6 && (
        <button 
          aria-expanded={showAllSpots} onClick={() => setShowAllSpots(!showAllSpots)}
          className={`w-full text-center text-[10px] text-cyan-400 hover:underline py-1`}
        >
          {showAllSpots ? 'Show less' : `Show all ${filteredSpotsLength} spots`}
        </button>
      )}
    </div>
  );
};
