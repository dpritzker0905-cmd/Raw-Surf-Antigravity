import React from 'react';
import { Play, Camera, MapPin, Grid3X3, Check, Pin } from 'lucide-react';
import { getFullUrl } from '../utils/media';

/**
 * Media grid item — renders a single cell in the profile content grid.
 * Handles photos, videos, check-ins, text posts, and photographer sessions.
 * Previously defined at the bottom of Profile.js.
 */
export const MediaGridItem = ({ item, onClick, isPinned = false }) => {
  if (!item) return null;

  const _checkMediaUrl = getFullUrl(item.media_url || item.image_url);
  const isVideo = item.media_type === 'video' || (typeof _checkMediaUrl === 'string' && _checkMediaUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i));
  const isNew = item.is_new;
  const hasMedia = item.media_url || item.thumbnail_url || (item.media_urls && item.media_urls.length > 0);
  const isCheckIn = item.is_check_in;
  const isPhotographerSession = item.is_photographer_session;

  return (
    <div
      className="aspect-square relative cursor-pointer group bg-muted"
      onClick={onClick}
      data-testid={`media-item-${item.id}`}
    >
      {hasMedia ? (
        isVideo ? (
          <>
            <img src={getFullUrl(item.thumbnail_url || item.media_url)} alt="" className="w-full h-full object-cover" loading="lazy"
              onError={(e) => { e.target.style.display = 'none'; }} />
            <div className="absolute top-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-white text-xs flex items-center gap-1">
              <Play className="w-3 h-3" fill="currentColor" />
              {item.video_duration ? `${Math.round(item.video_duration)}s` : ''}
            </div>
          </>
        ) : (
          <img src={getFullUrl(item.thumbnail_url || item.media_url)} alt="" className="w-full h-full object-cover" loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; }} />
        )
      ) : isPhotographerSession ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cyan-900 to-zinc-900 p-2">
          <Camera className="w-8 h-8 text-cyan-400 mb-1" />
          <span className="text-[10px] text-gray-400 text-center line-clamp-2">{item.location || 'Session'}</span>
          {item.item_count > 0 && (
            <span className="text-[9px] text-cyan-400 mt-1">{item.item_count} photos</span>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-2">
          {isCheckIn ? (
            <>
              <MapPin className="w-8 h-8 text-cyan-400 mb-1" />
              <span className="text-[10px] text-gray-400 text-center line-clamp-2">{item.location || 'Check-in'}</span>
            </>
          ) : (
            <>
              <Grid3X3 className="w-8 h-8 text-yellow-400 mb-1" />
              <span className="text-[10px] text-gray-400 text-center line-clamp-2">{item.caption?.substring(0, 30) || 'Post'}</span>
            </>
          )}
        </div>
      )}

      {/* Photo count badge for photographer sessions */}
      {isPhotographerSession && hasMedia && item.item_count > 0 && (
        <div className="absolute bottom-2 left-2 bg-black/70 px-1.5 py-0.5 rounded text-white text-xs flex items-center gap-1">
          <Camera className="w-3 h-3" /> {item.item_count}
        </div>
      )}

      {/* PINNED Badge */}
      {isPinned && (
        <div className="absolute top-2 left-2 bg-white/90 dark:bg-black/80 px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg" data-testid="pinned-indicator">
          <Pin className="w-3 h-3 text-amber-500" /> <span className="text-foreground">Pinned</span>
        </div>
      )}

      {/* NEW Badge */}
      {isNew && !isPinned && (
        <div className="absolute top-2 left-2 bg-gradient-to-r from-cyan-400 to-blue-500 px-2 py-0.5 rounded-full text-black text-xs font-bold animate-pulse">NEW</div>
      )}

      {/* Access granted indicator */}
      {item.access_granted && (
        <div className="absolute bottom-2 right-2 bg-green-500/80 p-1 rounded-full">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <div className="flex items-center gap-4 text-white text-sm">
          {item.likes_count !== undefined && <span className="flex items-center gap-1">❤️ {item.likes_count}</span>}
          {item.tagged_by && <span className="flex items-center gap-1">Tagged by {item.tagged_by}</span>}
        </div>
      </div>
    </div>
  );
};
