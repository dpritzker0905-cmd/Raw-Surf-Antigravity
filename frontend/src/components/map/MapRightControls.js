import React from 'react';
import { Navigation, Loader2, MapPin, Camera, Users, Layers } from 'lucide-react';
import { Button } from '../ui/button';
import { useThemeName } from '../../contexts/ThemeContext';
import { mapChromeTheme } from './mapChromeTheme';

/**
 * Right-side floating control panel on the map.
 * Contains GPS button, featured photographers toggle, and friends toggle.
 */
export var MapRightControls = ({
  userLocation,
  gpsLoading,
  locationDenied,
  currentUserShooting,
  showFeaturedPanel,
  showFriendsOnMap,
  friendsOnMap,
  showGPSGuide,
  onGetLocation,
  onShowLocationPicker,
  onToggleFeatured,
  onToggleFriends,
  onShowGPSGuide,
  showWeatherControls,
  onToggleWeatherControls,
  activeLayers = [],
}) => {
  const bottomStyle = activeLayers.length > 0 ? 'bottom-[150px] md:bottom-20' : 'bottom-20';
  // Three themes (W-10 R4): these buttons were zinc-800 / text-white in every mode.
  const c = mapChromeTheme(useThemeName());

  return (
    <div
      className={`absolute right-4 z-[1000] flex flex-col gap-2 transition-all duration-300 ${bottomStyle}`}
    >
      {/* Low-accuracy location fix button */}
      {userLocation?.accuracy && userLocation.accuracy > 1000 && (
        <button
          onClick={onShowLocationPicker}
          className="flex items-center gap-2 px-3 py-2 bg-red-500/90 hover:bg-red-600 text-white rounded-full text-sm font-medium shadow-lg animate-pulse"
          data-testid="location-fix-btn"
        >
          <MapPin className="w-4 h-4" />
          <span>Fix Location</span>
        </button>
      )}

      {/* GPS location button */}
      <div className="relative">
        <Button
          onClick={onGetLocation}
          disabled={gpsLoading}
          className={`backdrop-blur-sm rounded-full w-12 h-12 p-0 ${
            userLocation?.accuracy && userLocation.accuracy > 500
              ? 'bg-orange-600/90 text-white hover:bg-zinc-700'
              : c.fab
          }`}
          data-testid="gps-location-btn"
          title={userLocation?.accuracy ? `Accuracy: ${Math.round(userLocation.accuracy)}m` : 'Get location'}
        >
          {gpsLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Navigation className={`w-5 h-5 ${userLocation && userLocation.accuracy <= 100 ? c.activeBlue : ''}`} />
          )}
        </Button>
        {(locationDenied || (userLocation?.accuracy && userLocation.accuracy > 200)) && (
          <button
            onClick={onShowGPSGuide}
            className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-500 hover:bg-yellow-400 rounded-full flex items-center justify-center text-black text-xs font-bold shadow-lg"
            title="GPS Help"
            aria-label="GPS help"
            data-testid="gps-help-btn"
          >
            ?
          </button>
        )}
      </div>

      {/* Featured photographers toggle */}
      {/* ⚠️ ICON-ONLY ⇒ THE `aria-label` IS THE ONLY ACCESSIBLE NAME. A lucide glyph contributes no
          text, so without this the control is anonymous to a screen reader at every width. */}
      <Button
        aria-label="Featured photographers"
        aria-expanded={showFeaturedPanel}
        onClick={onToggleFeatured}
        className={`${c.fab} backdrop-blur-sm rounded-full w-12 h-12 p-0 ${showFeaturedPanel ? 'ring-2 ring-yellow-400' : ''}`}
        data-testid="featured-photographers-btn"
      >
        <Camera className={`w-5 h-5 ${showFeaturedPanel ? c.activeYellow : ''}`} />
      </Button>

      {/* Friends on map toggle */}
      <Button
        aria-label="Friends on map"
        aria-expanded={showFriendsOnMap}
        onClick={onToggleFriends}
        className={`${c.fab} backdrop-blur-sm rounded-full w-12 h-12 p-0 ${showFriendsOnMap ? 'ring-2 ring-yellow-400' : ''}`}
        data-testid="friends-on-map-btn"
      >
        <Users className={`w-5 h-5 ${showFriendsOnMap ? c.activeYellow : ''}`} />
      </Button>

      {/* Mobile Weather Layers Toggle */}
      <Button
        aria-label="Weather layers"
        aria-expanded={showWeatherControls}
        onClick={onToggleWeatherControls}
        className={`${c.fab} backdrop-blur-sm rounded-full w-12 h-12 p-0 md:hidden ${showWeatherControls ? 'ring-2 ring-cyan-400' : ''}`}
        data-testid="weather-layers-btn"
      >
        <Layers className={`w-5 h-5 ${showWeatherControls ? c.activeCyan : ''}`} />
      </Button>

      {/* Friend count badge */}
      {showFriendsOnMap && friendsOnMap.length > 0 && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center text-xs text-black font-bold">
          {friendsOnMap.length}
        </div>
      )}
    </div>
  );
};
