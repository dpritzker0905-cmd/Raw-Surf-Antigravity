import React from 'react';
import { MapPin, Eye, EyeOff, Bell, User, Users } from 'lucide-react';

/**
 * PrivacySection — Extracted from Settings.js
 * Handles all privacy-related toggles: Map Visibility, Ghost Mode,
 * Proximity Pings, Online Status, Private Account, Lineup Invites.
 */
export const PrivacySection = ({
  privacy,
  privacyLoading,
  updatePrivacySetting,
  textPrimaryClass,
  textSecondaryClass,
  borderClass,
}) => {
  const ToggleButton = ({ enabled, onClick, disabled }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-12 h-6 rounded-full transition-colors ${
        enabled ? 'bg-cyan-400' : 'bg-zinc-600'
      }`}
    >
      <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
        enabled ? 'translate-x-6' : 'translate-x-0.5'
      }`} />
    </button>
  );

  return (
    <>
      {/* Map Visibility */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <div>
            <span className={textPrimaryClass}>Map Visibility</span>
            <p className={`text-xs ${textSecondaryClass}`}>Who can see you on the map</p>
          </div>
        </div>
        <select
          value={privacy.map_visibility}
          aria-label="Map visibility"
          onChange={(e) => updatePrivacySetting('map_visibility', e.target.value)}
          disabled={privacyLoading}
          className="px-3 py-1 rounded-lg text-sm bg-muted text-foreground"
        >
          <option value="public">Everyone</option>
          <option value="friends">Friends Only</option>
          <option value="none">Hidden</option>
        </select>
      </div>
      
      {/* Ghost Mode */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          {privacy.is_ghost_mode ? (
            <EyeOff className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Eye className="w-4 h-4 text-muted-foreground" />
          )}
          <div>
            <span className={textPrimaryClass}>Ghost Mode</span>
            <p className={`text-xs ${textSecondaryClass}`}>Completely hide from all maps</p>
          </div>
        </div>
        <ToggleButton
          enabled={privacy.is_ghost_mode}
          onClick={() => updatePrivacySetting('is_ghost_mode', !privacy.is_ghost_mode)}
          disabled={privacyLoading}
        />
      </div>
      
      {/* Proximity Pings */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <div>
            <span className={textPrimaryClass}>Proximity Pings</span>
            <p className={`text-xs ${textSecondaryClass}`}>Let friends ping your location</p>
          </div>
        </div>
        <ToggleButton
          enabled={privacy.allow_proximity_pings}
          onClick={() => updatePrivacySetting('allow_proximity_pings', !privacy.allow_proximity_pings)}
          disabled={privacyLoading}
        />
      </div>
      
      {/* Show Online Status */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-muted-foreground" />
          <div>
            <span className={textPrimaryClass}>Show Online Status</span>
            <p className={`text-xs ${textSecondaryClass}`}>Let others see when you're online</p>
          </div>
        </div>
        <ToggleButton
          enabled={privacy.show_online_status}
          onClick={() => updatePrivacySetting('show_online_status', !privacy.show_online_status)}
          disabled={privacyLoading}
        />
      </div>
      
      {/* Private Account Toggle */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          {privacy.is_private ? (
            <EyeOff className="w-4 h-4 text-orange-400" />
          ) : (
            <Eye className="w-4 h-4 text-green-400" />
          )}
          <div>
            <span className={textPrimaryClass}>Private Account</span>
            <p className={`text-xs ${textSecondaryClass}`}>
              {privacy.is_private 
                ? 'Only approved followers can see your posts' 
                : 'Your posts are visible to everyone'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${privacy.is_private ? 'text-orange-400' : 'text-green-400'}`}>
            {privacy.is_private ? 'Private' : 'Public'}
          </span>
          <button
            onClick={() => updatePrivacySetting('is_private', !privacy.is_private)}
            disabled={privacyLoading}
            className={`w-12 h-6 rounded-full transition-colors ${
              privacy.is_private ? 'bg-orange-400' : 'bg-green-500'
            }`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
              privacy.is_private ? 'translate-x-6' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </div>
      
      {/* Accept Lineup Invites */}
      <div className={`flex items-center justify-between py-2`}>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <div>
            <span className={textPrimaryClass}>Accept Lineup Invites</span>
            <p className={`text-xs ${textSecondaryClass}`}>
              Allow nearby surfers to invite you to lineups
            </p>
          </div>
        </div>
        <ToggleButton
          enabled={privacy.accepting_lineup_invites}
          onClick={() => updatePrivacySetting('accepting_lineup_invites', !privacy.accepting_lineup_invites)}
          disabled={privacyLoading}
        />
      </div>
    </>
  );
};
