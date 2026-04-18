/**
 * SessionLogHeader - Displays session metadata on feed posts
 * Shows: Location, Time, Conditions, Collaborators
 * "Strava for Surfing" - Rich metadata on every session post
 */

import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  MapPin, Clock, Waves, Wind, Droplets, Users, ChevronDown,
  ChevronUp, Sunrise, Sunset, Sun, Moon, CheckCircle,
  UserPlus, Calendar
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import { DirectionCompass } from './WaveDirectionIndicator';

// Session label icons
const SESSION_LABEL_ICONS = {
  'Dawn Patrol': Sunrise,
  'Morning Glass': Sun,
  'Midday Session': Sun,
  'Afternoon Shred': Sun,
  'Sunset Session': Sunset,
  'Night Session': Moon
};

// Wind direction display
const _WIND_ARROWS = {
  'N': '↓', 'NE': '↙', 'E': '←', 'SE': '↖',
  'S': '↑', 'SW': '↗', 'W': '→', 'NW': '↘'
};

/**
 * Compact conditions badge with wave direction visualization
 */
const ConditionsBadge = ({ waveHeight, waveDirection, waveDirectionDegrees, wavePeriod, windSpeed, windDirection, tide, tideHeight, isLight }) => {
  if (!waveHeight && !windSpeed && !tide) return null;
  
  return (
    <div className={`flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
      {waveHeight && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1">
                <Waves className="w-3 h-3 text-cyan-400" />
                {waveHeight}ft
                {wavePeriod && <span className="text-gray-500">@{wavePeriod}s</span>}
                {waveDirection && (
                  <DirectionCompass
                    degrees={waveDirectionDegrees}
                    direction={waveDirection}
                    type="wave"
                    size="xs"
                    showLabel={false}
                  />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Wave Height{waveDirection && ` from ${waveDirection}`}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {windSpeed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1">
                <Wind className="w-3 h-3 text-emerald-400" />
                {windSpeed}mph
                {windDirection && (
                  <DirectionCompass
                    direction={windDirection}
                    type="wind"
                    size="xs"
                    showLabel={false}
                  />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>Wind: {windDirection || 'N/A'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {tide && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-0.5">
                <Droplets className="w-3 h-3 text-blue-400" />
                {tide}
                {tideHeight && <span className="text-gray-500">{tideHeight}ft</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>Tide</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

/**
 * Collaborators avatars row
 */
const CollaboratorsRow = ({ collaborators, onViewAll, isLight }) => {
  if (!collaborators || collaborators.length === 0) return null;
  
  const accepted = collaborators.filter(c => c.status === 'accepted');
  if (accepted.length === 0) return null;
  
  return (
    <button 
      onClick={onViewAll}
      className={`flex items-center gap-2 ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'} rounded-lg px-2 py-1 -mx-2 transition-colors`}
    >
      <Users className="w-3.5 h-3.5 text-cyan-400" />
      <div className="flex -space-x-1.5">
        {accepted.slice(0, 4).map((collab, idx) => (
          <div 
            key={collab.id}
            className="w-5 h-5 rounded-full border border-black bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden"
            style={{ zIndex: 4 - idx }}
          >
            {collab.avatar_url ? (
              <img src={collab.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-xs font-bold">
                {collab.full_name?.charAt(0) || '?'}
              </span>
            )}
          </div>
        ))}
      </div>
      <span className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
        {accepted.length} {accepted.length === 1 ? 'surfer' : 'surfers'} in session
      </span>
      {accepted.some(c => c.verified_by_gps) && (
        <CheckCircle className="w-3 h-3 text-green-400" />
      )}
    </button>
  );
};

/**
 * Main Session Log Header Component
 */
export const SessionLogHeader = ({
  post,
  collaborators = [],
  onIWasThere,
  onViewCollaborators,
  onBookPhotographer,
  onFollowPhotographer,
  currentUserId,
  isOwnPost = false,
  showBookCTA = false,
  isFollowingPhotographer = false,
  photographerId = null,
  photographerName = null
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [expanded, setExpanded] = useState(false);
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const bgCard = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  
  // Extract session data from post
  const {
    location,
    spot,
    session_date,
    session_start_time,
    session_end_time,
    session_label,
    wave_height_ft,
    wave_period_sec,
    wave_direction,
    wind_speed_mph,
    wind_direction,
    tide_height_ft,
    tide_status
  } = post;
  
  const hasSessionData = session_date || session_start_time || location || spot;
  const hasConditions = wave_height_ft || wind_speed_mph || tide_status;
  
  // Check if current user is already a collaborator
  const userCollaboration = collaborators.find(c => c.user_id === currentUserId);
  const canRequestCollaboration = !isOwnPost && !userCollaboration;
  const isPendingRequest = userCollaboration?.status === 'pending';
  const isAcceptedCollaborator = userCollaboration?.status === 'accepted';
  
  // Format time display
  const formatTimeDisplay = () => {
    if (session_label) {
      const Icon = SESSION_LABEL_ICONS[session_label] || Clock;
      return (
        <span className="flex items-center gap-1">
          <Icon className="w-3.5 h-3.5 text-yellow-400" />
          {session_label}
          {session_start_time && session_end_time && (
            <span className={textSecondary}>
              ({session_start_time} - {session_end_time})
            </span>
          )}
        </span>
      );
    }
    if (session_start_time) {
      return (
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {session_start_time}{session_end_time && ` - ${session_end_time}`}
        </span>
      );
    }
    return null;
  };
  
  // Format date display - make it clear this is the SESSION date
  const formatDateDisplay = () => {
    if (!session_date) return null;
    
    // Handle both ISO date strings and date-only strings
    let dateStr = session_date;
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0]; // Extract just the date part
    }
    
    const date = new Date(dateStr + 'T12:00:00'); // Use noon to avoid timezone issues
    if (isNaN(date.getTime())) return null; // Invalid date
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    
    if (dateOnly.getTime() === todayOnly.getTime()) {
      return { text: 'Today', isRecent: true };
    } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
      return { text: 'Yesterday', isRecent: true };
    }
    
    // Show full date for older sessions
    return { 
      text: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined }), 
      isRecent: false 
    };
  };

  // Check if conditions are from session date (historical)
  const sessionDateInfo = formatDateDisplay();
  const isHistoricalSession = sessionDateInfo && !sessionDateInfo.isRecent;
  
  if (!hasSessionData && !hasConditions) {
    // No session data, show minimal header or nothing
    return null;
  }
  
  return (
    <div className={`${bgCard} rounded-lg p-3 mb-2`} data-testid="session-log-header">
      {/* Session Date Banner - Prominent for historical sessions */}
      {sessionDateInfo && (
        <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${isLight ? 'border-gray-200' : 'border-zinc-700/50'}`}>
          <Calendar className="w-4 h-4 text-cyan-400" />
          <span className={`text-sm font-medium ${textPrimary}`}>
            {isHistoricalSession ? 'Session from ' : ''}{sessionDateInfo.text}
          </span>
          {hasConditions && isHistoricalSession && (
            <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full">
              Conditions from this day
            </span>
          )}
        </div>
      )}

      {/* Main Session Info Row */}
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-1">
          {/* Location */}
          {(location || spot) && (
            <div className={`flex items-center gap-1.5 text-sm font-medium ${textPrimary}`}>
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span>{spot?.name || location}</span>
              {spot?.unified_peak && (
                <Badge variant="outline" className="text-xs px-1 py-0 border-cyan-500/50 text-cyan-400">
                  Unified Peak
                </Badge>
              )}
            </div>
          )}
          
          {/* Time display (without date - now in banner above) */}
          {formatTimeDisplay() && (
            <div className={`flex items-center gap-3 text-sm ${textSecondary}`}>
              {formatTimeDisplay()}
            </div>
          )}
          
          {/* Conditions (compact view) */}
          {hasConditions && !expanded && (
            <ConditionsBadge 
              waveHeight={wave_height_ft}
              waveDirection={wave_direction}
              waveDirectionDegrees={post.wave_direction_degrees}
              wavePeriod={wave_period_sec}
              windSpeed={wind_speed_mph}
              windDirection={wind_direction}
              tide={tide_status}
              tideHeight={post.tide_height_ft}
              isLight={isLight}
            />
          )}
        </div>
        
        {/* Expand/Collapse for conditions */}
        {hasConditions && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="p-1 h-auto"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        )}
      </div>
      
      {/* Expanded Conditions */}
      {expanded && hasConditions && (
        <div className={`grid grid-cols-3 gap-3 mt-3 pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
          {wave_height_ft && (
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Waves className="w-5 h-5 text-cyan-400" />
                {wave_direction && (
                  <DirectionCompass
                    degrees={post.wave_direction_degrees}
                    direction={wave_direction}
                    type="wave"
                    size="xs"
                    showLabel={false}
                  />
                )}
              </div>
              <p className={`text-sm font-medium ${textPrimary}`}>{wave_height_ft}ft</p>
              {wave_period_sec && (
                <p className={`text-xs ${textSecondary}`}>{wave_period_sec}s period</p>
              )}
              <p className={`text-xs ${textSecondary}`}>
                {wave_direction ? `From ${wave_direction}` : 'Waves'}
              </p>
            </div>
          )}
          {wind_speed_mph && (
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Wind className="w-5 h-5 text-emerald-400" />
                {wind_direction && (
                  <DirectionCompass
                    direction={wind_direction}
                    type="wind"
                    size="xs"
                    showLabel={false}
                  />
                )}
              </div>
              <p className={`text-sm font-medium ${textPrimary}`}>{wind_speed_mph}mph</p>
              <p className={`text-xs ${textSecondary}`}>{wind_direction || 'Wind'}</p>
            </div>
          )}
          {(tide_height_ft || tide_status) && (
            <div className="text-center">
              <Droplets className="w-5 h-5 mx-auto text-blue-400 mb-1" />
              {tide_height_ft && (
                <p className={`text-sm font-medium ${textPrimary}`}>{tide_height_ft}ft</p>
              )}
              <p className={`text-xs ${textSecondary}`}>{tide_status || 'Tide'}</p>
            </div>
          )}
        </div>
      )}
      
      {/* Collaborators Row */}
      <CollaboratorsRow 
        collaborators={collaborators}
        onViewAll={onViewCollaborators}
        isLight={isLight}
      />
      
      {/* Action Buttons */}
      <div className={`flex items-center gap-2 mt-2 pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
        {/* I Was There Button */}
        {canRequestCollaboration && (
          <Button
            size="sm"
            variant="outline"
            onClick={onIWasThere}
            className="text-xs border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
            data-testid="i-was-there-btn"
          >
            <UserPlus className="w-3 h-3 mr-1" />
            I Was There
          </Button>
        )}
        
        {isPendingRequest && (
          <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-400">
            <Clock className="w-3 h-3 mr-1" />
            Request Pending
          </Badge>
        )}
        
        {isAcceptedCollaborator && (
          <Badge className="bg-green-500/20 text-green-400 text-xs">
            <CheckCircle className="w-3 h-3 mr-1" />
            In This Session
          </Badge>
        )}
        
        {/* Follow the Pro / View Profile CTA */}
        {showBookCTA && photographerId && (
          <>
            {!isFollowingPhotographer && onFollowPhotographer && (
              <Button
                size="sm"
                onClick={() => onFollowPhotographer(photographerId)}
                className="text-xs bg-gradient-to-r from-cyan-400 to-blue-500 text-black ml-auto"
                data-testid="follow-pro-cta"
              >
                <UserPlus className="w-3 h-3 mr-1" />
                Follow {photographerName?.split(' ')[0] || 'Pro'}
              </Button>
            )}
            {isFollowingPhotographer && onBookPhotographer && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBookPhotographer(photographerId)}
                className="text-xs border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 ml-auto"
                data-testid="view-pro-profile-cta"
              >
                View Profile
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SessionLogHeader;
