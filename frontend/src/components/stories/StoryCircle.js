import React from 'react';
import { MapPin } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

// Story ring colors - Ring System
export const LIVE_RING = 'bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-pulse';
export const NEW_RING = 'bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400';
export const PHOTOGRAPHER_RING = 'bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500';
export const SURFER_RING = 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500';
export const VIEWED_RING = 'bg-zinc-600';

// Get ring color based on story state
export const getStoryRingColor = (authorGroup, isViewed = false) => {
  // RED ring for active live broadcasts (always front)
  if (authorGroup.is_live) return LIVE_RING;
  // CLEAR ring for viewed stories
  if (isViewed || !authorGroup.has_unviewed) return VIEWED_RING;
  // BLUE ring for new/unseen stories
  if (authorGroup.has_unviewed) return NEW_RING;
  // Default to type-based ring
  return authorGroup.story_type === 'photographer' ? PHOTOGRAPHER_RING : SURFER_RING;
};

export const StoryCircle = ({ authorGroup, onClick, isConnecting = false }) => {
  const ringClass = getStoryRingColor(authorGroup);
  const connectingClass = isConnecting ? 'animate-[pulse_0.4s_ease-in-out_infinite] scale-105' : '';

  return (
    <button
      onClick={onClick}
      disabled={isConnecting}
      className={`flex-shrink-0 flex flex-col items-center w-16 group relative ${connectingClass}`}
      data-testid={`story-circle-${authorGroup.author_id}`}
    >
      {/* Avatar with Ring */}
      <div className={`p-[2px] rounded-full ${ringClass} ${isConnecting ? 'ring-4 ring-red-500/50' : ''}`}>
        <div className="p-[2px] rounded-full bg-black">
          <div className="w-14 h-14 rounded-full overflow-hidden bg-zinc-800">
            {authorGroup.author_avatar ? (
              <img loading="lazy" decoding="async"
                src={getFullUrl(authorGroup.author_avatar)}
                alt={authorGroup.author_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg font-bold text-gray-400">
                {authorGroup.author_name?.[0] || '?'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Badge - shows "Joining..." when connecting */}
      {authorGroup.is_live && (
        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-white text-[8px] font-bold px-2 py-0.5 rounded uppercase ${
          isConnecting ? 'bg-red-400 animate-pulse' : 'bg-red-500'
        }`}>
          {isConnecting ? 'Joining...' : 'Live'}
        </div>
      )}

      {/* Name */}
      <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center group-hover:text-white transition-colors">
        {authorGroup.author_name?.split(' ')[0] || 'User'}
      </span>

      {/* Location (if visible) */}
      {authorGroup.show_location && authorGroup.location_name && (
        <span className="text-[9px] text-yellow-400 truncate w-full text-center flex items-center justify-center gap-0.5">
          <MapPin className="w-2 h-2" />
          {authorGroup.location_name.length > 10 
            ? authorGroup.location_name.substring(0, 10) + '...' 
            : authorGroup.location_name}
        </span>
      )}
    </button>
  );
};

export default StoryCircle;
