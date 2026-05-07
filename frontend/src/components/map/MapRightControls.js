import React from 'react';
import { Navigation, Loader2, MapPin, Camera, Users } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Right-side floating control panel on the map.
 * Contains GPS button, featured photographers toggle, and friends toggle.
 */
export const MapRightControls = ({
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
}) => {
  return (
    <div
      className="absolute right-4 z-[1000] flex flex-col gap-2"
      style={{
        top: currentUserShooting
          ? 'calc(130px + env(safe-area-inset-top))'
          : 'calc(max(96px, env(safe-area-inset-top) + 80px))',
      }}
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
          className={`backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${
            userLocation?.accuracy && userLocation.accuracy > 500
              ? 'bg-orange-600/90'
              : 'bg-zinc-800/90'
          }`}
          data-testid="gps-location-btn"
          title={userLocation?.accuracy ? `Accuracy: ${Math.round(userLocation.accuracy)}m` : 'Get location'}
        >
          {gpsLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Navigation className={`w-5 h-5 ${userLocation && userLocation.accuracy <= 100 ? 'text-blue-400' : ''}`} />
          )}
        </Button>
        {(locationDenied || (userLocation?.accuracy && userLocation.accuracy > 200)) && (
          <button
            onClick={onShowGPSGuide}
            className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-500 hover:bg-yellow-400 rounded-full flex items-center justify-center text-black text-xs font-bold shadow-lg"
            title="GPS Help"
            data-testid="gps-help-btn"
          >
            ?
          </button>
        )}
      </div>

      {/* Featured photographers toggle */}
      <Button
        aria-expanded={showFeaturedPanel}
        onClick={onToggleFeatured}
        className={`bg-zinc-800/90 backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${showFeaturedPanel ? 'ring-2 ring-yellow-400' : ''}`}
        data-testid="featured-photographers-btn"
      >
        <Camera className={`w-5 h-5 ${showFeaturedPanel ? 'text-yellow-400' : ''}`} />
      </Button>

      {/* Friends on map toggle */}
      <Button
        aria-expanded={showFriendsOnMap}
        onClick={onToggleFriends}
        className={`bg-zinc-800/90 backdrop-blur-sm hover:bg-zinc-700 text-white rounded-full w-12 h-12 p-0 ${showFriendsOnMap ? 'ring-2 ring-yellow-400' : ''}`}
        data-testid="friends-on-map-btn"
      >
        <Users className={`w-5 h-5 ${showFriendsOnMap ? 'text-yellow-400' : ''}`} />
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
