import React from 'react';
import { MapPin, X } from 'lucide-react';

/**
 * IP-based location banner shown when GPS is unavailable.
 * Displays approximate city and offers GPS/dismiss controls.
 */
export const IPLocationBanner = ({
  showIpBanner,
  cityChanged,
  locationDenied,
  ipLocation,
  userLocation,
  onRequestGPS,
  onDismiss,
}) => {
  if (!showIpBanner || !(cityChanged || (locationDenied && ipLocation))) return null;

  return (
    <div
      className={`mt-2 px-3 py-2 rounded-lg backdrop-blur-sm pointer-events-auto flex items-center justify-between gap-2 text-sm ${
        cityChanged
          ? 'bg-gradient-to-r from-yellow-900/80 to-orange-900/80 border border-yellow-500/30'
          : 'bg-zinc-800/90 border border-zinc-700'
      }`}
      data-testid="ip-location-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <MapPin className="w-4 h-4 flex-shrink-0 text-gray-400" />
        <span className="text-gray-300 truncate">
          {cityChanged ? 'Updated: ' : ''}
          <span className="font-medium text-white">{ipLocation?.city}</span>
          <span className="text-gray-500 text-xs ml-1">(approx)</span>
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!userLocation && (
          <button
            onClick={onRequestGPS}
            className="px-2 py-0.5 text-xs bg-cyan-600 hover:bg-cyan-500 rounded text-white"
            data-testid="grant-gps-link"
          >
            GPS
          </button>
        )}
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-gray-300"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
