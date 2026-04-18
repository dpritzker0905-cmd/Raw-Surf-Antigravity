import React, { useState, useRef, useEffect } from 'react';
import { 
  MapPin, 
  Search, 
  X,
  Check,
  AlertTriangle,
  Target,
  Crosshair
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import logger from '../utils/logger';

const _API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * LocationPicker - Allows users to manually select their location on a map
 * Used when GPS is inaccurate or denied
 */
export const LocationPicker = ({ 
  isOpen, 
  onClose, 
  onLocationSelected,
  currentLocation = null,
  currentAccuracy = null,
  surfSpots = []
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const _markerRef = useRef(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [_mapReady, setMapReady] = useState(false);

  // Initialize map when dialog opens
  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstanceRef.current) return;
    
    // Wait for Leaflet
    const initMap = () => {
      if (!window.L) {
        setTimeout(initMap, 100);
        return;
      }

      // Default to Florida/Cape Canaveral area if no current location
      const defaultCenter = currentLocation 
        ? [currentLocation.lat, currentLocation.lng] 
        : [28.3922, -80.6077]; // Cape Canaveral
      
      const map = window.L.map(mapRef.current, {
        center: defaultCenter,
        zoom: currentLocation ? 12 : 8,
        zoomControl: true
      });

      // Satellite imagery for better recognition
      window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'ESRI', maxZoom: 19 }
      ).addTo(map);

      // Add labels layer
      window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 0.8 }
      ).addTo(map);

      // Add surf spots as reference points
      surfSpots.forEach(spot => {
        // Validate coordinates before creating marker
        if (spot.latitude && spot.longitude && 
            !isNaN(spot.latitude) && !isNaN(spot.longitude) &&
            isFinite(spot.latitude) && isFinite(spot.longitude)) {
          window.L.circleMarker([spot.latitude, spot.longitude], {
            radius: 6,
            fillColor: '#00CCFF',
            color: '#fff',
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.6
          }).bindTooltip(spot.name, { permanent: false }).addTo(map);
        }
      });

      // Show current inaccurate location with accuracy circle
      if (currentLocation && currentAccuracy && currentAccuracy > 100 &&
          currentLocation.lat && currentLocation.lng &&
          !isNaN(currentLocation.lat) && !isNaN(currentLocation.lng)) {
        window.L.circle([currentLocation.lat, currentLocation.lng], {
          radius: currentAccuracy,
          color: '#ff6b6b',
          fillColor: '#ff6b6b',
          fillOpacity: 0.1,
          dashArray: '5, 10'
        }).addTo(map);
        
        window.L.marker([currentLocation.lat, currentLocation.lng], {
          icon: window.L.divIcon({
            className: 'current-location-marker',
            html: `<div style="background: #ff6b6b; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          })
        }).bindTooltip('Current GPS Location (Inaccurate)', { permanent: false }).addTo(map);
      }

      // Crosshair in center
      const _crosshairIcon = window.L.divIcon({
        className: 'crosshair-icon',
        html: `
          <div style="position: relative; width: 40px; height: 40px;">
            <div style="position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: #00CCFF; transform: translateY(-50%);"></div>
            <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #00CCFF; transform: translateX(-50%);"></div>
            <div style="position: absolute; top: 50%; left: 50%; width: 10px; height: 10px; border: 2px solid #00CCFF; border-radius: 50%; transform: translate(-50%, -50%); background: rgba(0, 204, 255, 0.2);"></div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      // Fixed crosshair in center of map
      const crosshairDiv = document.createElement('div');
      crosshairDiv.innerHTML = `
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; pointer-events: none;">
          <div style="width: 2px; height: 30px; background: #00CCFF; position: absolute; left: 50%; transform: translateX(-50%);"></div>
          <div style="height: 2px; width: 30px; background: #00CCFF; position: absolute; top: 50%; transform: translateY(-50%);"></div>
          <div style="width: 16px; height: 16px; border: 2px solid #00CCFF; border-radius: 50%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0, 204, 255, 0.3);"></div>
        </div>
      `;
      mapRef.current.appendChild(crosshairDiv);

      // Update selected location when map moves
      map.on('moveend', () => {
        const center = map.getCenter();
        setSelectedLocation({ lat: center.lat, lng: center.lng });
      });

      // Initial selected location
      setSelectedLocation({ lat: defaultCenter[0], lng: defaultCenter[1] });
      
      mapInstanceRef.current = map;
      setMapReady(true);
      
      // Invalidate size after render
      setTimeout(() => map.invalidateSize(), 200);
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        setMapReady(false);
      }
    };
  }, [isOpen, currentLocation, currentAccuracy, surfSpots]);

  // Search for locations using OpenStreetMap Nominatim
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    try {
      // Use Nominatim for geocoding (free, no API key needed)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&countrycodes=us`
      );
      const data = await response.json();
      setSearchResults(data.map(r => ({
        name: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon)
      })));
    } catch (error) {
      logger.error('Search failed:', error);
      toast.error('Search failed. Try again.');
    } finally {
      setSearching(false);
    }
  };

  // Go to a search result
  const goToLocation = (location) => {
    if (mapInstanceRef.current && location?.lat && location?.lng &&
        !isNaN(location.lat) && !isNaN(location.lng)) {
      mapInstanceRef.current.setView([location.lat, location.lng], 14);
      setSelectedLocation({ lat: location.lat, lng: location.lng });
    }
    setSearchResults([]);
    setSearchQuery('');
  };

  // Find nearest surf spot to help user orient
  const goToNearestSpot = () => {
    if (surfSpots.length > 0 && selectedLocation) {
      // Find nearest spot
      let nearest = surfSpots[0];
      let minDist = Infinity;
      
      surfSpots.forEach(spot => {
        if (spot.latitude && spot.longitude &&
            !isNaN(spot.latitude) && !isNaN(spot.longitude)) {
          const dist = Math.sqrt(
            Math.pow(spot.latitude - selectedLocation.lat, 2) + 
            Math.pow(spot.longitude - selectedLocation.lng, 2)
          );
          if (dist < minDist) {
            minDist = dist;
            nearest = spot;
          }
        }
      });
      
      if (nearest && mapInstanceRef.current && 
          nearest.latitude && nearest.longitude &&
          !isNaN(nearest.latitude) && !isNaN(nearest.longitude)) {
        mapInstanceRef.current.setView([nearest.latitude, nearest.longitude], 14);
        toast.success(`Moved to ${nearest.name}`);
      }
    }
  };

  // Confirm the selected location
  const handleConfirm = () => {
    if (selectedLocation) {
      onLocationSelected({
        lat: selectedLocation.lat,
        lng: selectedLocation.lng,
        accuracy: 0, // Manual selection = perfect accuracy
        isManual: true,
        isHighAccuracy: true
      });
      toast.success('Location set!');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 w-[95vw] max-w-lg h-[85vh] max-h-[600px] overflow-hidden p-0 flex flex-col">
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        {/* Header with close button */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white">Set Your Location</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Accuracy Warning */}
          {currentAccuracy && currentAccuracy > 500 && (
            <div className="p-3 bg-red-500/10 border-b border-red-500/30 flex items-center gap-2 flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-400 text-sm font-medium">GPS is inaccurate (~{Math.round(currentAccuracy/1000)}km off)</p>
                <p className="text-red-300 text-xs">Pan the map to your actual location</p>
              </div>
            </div>
          )}

          {/* Search Bar */}
          <div className="p-3 border-b border-zinc-700 flex-shrink-0">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="Search city, beach, or address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="bg-zinc-800 border-zinc-600 text-white pr-10"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="bg-cyan-600 hover:bg-cyan-700"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="mt-2 bg-zinc-800 rounded-lg border border-zinc-600 max-h-32 overflow-y-auto">
                {searchResults.map((result, idx) => (
                  <button
                    key={idx}
                    onClick={() => goToLocation(result)}
                    className="w-full p-2 text-left hover:bg-zinc-700 text-sm text-gray-200 border-b border-zinc-700 last:border-b-0"
                  >
                    <MapPin className="w-3 h-3 inline mr-2 text-cyan-400" />
                    {result.name.length > 40 ? result.name.substring(0, 40) + '...' : result.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Map Container */}
          <div className="flex-1 relative min-h-[200px]">
            <div
              ref={mapRef}
              className="w-full h-full absolute inset-0"
              style={{ background: '#1a1a2e' }}
            />
            
            {/* Instructions overlay */}
            <div className="absolute bottom-3 left-3 right-3 bg-zinc-900/90 backdrop-blur-sm rounded-lg p-2.5 border border-zinc-700">
              <div className="flex items-center gap-2 text-white text-sm">
                <Crosshair className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <span className="text-xs sm:text-sm">Move the map so the crosshair is on your location</span>
              </div>
              {selectedLocation && (
                <p className="text-xs text-gray-400 mt-1">
                  {selectedLocation.lat.toFixed(4)}°N, {Math.abs(selectedLocation.lng).toFixed(4)}°W
                </p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="absolute top-3 right-3 flex flex-col gap-2">
              <Button
                onClick={goToNearestSpot}
                size="sm"
                className="bg-zinc-800/90 hover:bg-zinc-700 text-white text-xs"
                title="Jump to nearest surf spot"
              >
                <MapPin className="w-4 h-4 mr-1 text-cyan-400" />
                Spots
              </Button>
            </div>
          </div>

          {/* Confirm Button */}
          <div className="p-3 border-t border-zinc-700 bg-zinc-800 flex-shrink-0">
            <Button
              onClick={handleConfirm}
              disabled={!selectedLocation}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
            >
              <Check className="w-4 h-4 mr-2" />
              Confirm This Location
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LocationPicker;
