/**
 * MapFilterTabs - Filter buttons and spot search for map view
 * Extracted from MapPage.js for better organization
 */
import React, { useState, useRef, useEffect } from 'react';
import { AlertCircle, Search, X, MapPin } from 'lucide-react';
import { toast } from 'sonner';

export const MapFilterTabs = ({ 
  filter, 
  onFilterChange, 
  locationDenied,
  surfSpots = [],
  onSpotSelect
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);
  
  // Handle search input
  const handleSearch = (query) => {
    setSearchQuery(query);
    
    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    
    // Filter spots by name (case-insensitive)
    const queryLower = query.toLowerCase();
    const filtered = surfSpots.filter(spot => 
      spot.name.toLowerCase().includes(queryLower) ||
      (spot.region && spot.region.toLowerCase().includes(queryLower)) ||
      (spot.country && spot.country.toLowerCase().includes(queryLower))
    ).slice(0, 8); // Limit to 8 results
    
    setSearchResults(filtered);
    setShowResults(filtered.length > 0);
  };
  
  // Handle spot selection from search
  const handleSpotClick = (spot) => {
    setSearchQuery('');
    setShowResults(false);
    onSpotSelect?.(spot);
  };
  
  // Close results when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  return (
    <div className="flex flex-col gap-2 pointer-events-auto">
      {/* Search Bar */}
      <div className="relative" ref={searchRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
            placeholder="Search surf spots..."
            className="w-full pl-9 pr-8 py-2 bg-zinc-800/90 backdrop-blur-sm border border-zinc-700 rounded-full text-white text-sm placeholder-gray-500 focus:outline-none focus:border-yellow-400/50 focus:ring-1 focus:ring-yellow-400/30"
            data-testid="map-spot-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
                setShowResults(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        
        {/* Search Results Dropdown */}
        {showResults && searchResults.length > 0 && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-zinc-800/95 backdrop-blur-md border border-zinc-700 rounded-lg shadow-xl z-50 max-h-[300px] overflow-y-auto">
            {searchResults.map((spot) => (
              <button
                key={spot.id}
                onClick={() => handleSpotClick(spot)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700/50 transition-colors text-left border-b border-zinc-700/50 last:border-b-0"
                data-testid={`search-result-${spot.id}`}
              >
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{spot.name}</p>
                  <p className="text-gray-400 text-xs truncate">
                    {[spot.region, spot.country].filter(Boolean).join(', ')}
                  </p>
                </div>
                {spot.active_photographers_count > 0 && (
                  <div className="shrink-0 px-2 py-0.5 bg-green-500/20 rounded-full">
                    <span className="text-green-400 text-[10px] font-medium">
                      {spot.active_photographers_count} Live
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Filter Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'spots', 'photographers'].map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all backdrop-blur-sm ${
              filter === f
                ? 'bg-yellow-400 text-black'
                : 'bg-zinc-800/90 text-gray-300 hover:bg-zinc-700'
            }`}
            data-testid={`map-filter-${f}`}
          >
            {f === 'all' ? 'All' : f === 'spots' ? 'Surf Spots' : 'Photographers'}
          </button>
        ))}
        
        {/* Location Denied Warning */}
        {locationDenied && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-full text-xs">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-red-300">Location denied</span>
            <button
              onClick={() => {
                toast.info(
                  'To enable location: Click the lock/info icon in your browser\'s address bar, then allow location access.',
                  { duration: 8000 }
                );
              }}
              className="text-cyan-400 hover:text-cyan-300 underline"
            >
              Help
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapFilterTabs;
