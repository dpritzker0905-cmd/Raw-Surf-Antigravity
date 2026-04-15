import React from 'react';
import { Image, Video, Play, Lock, DollarSign, Eye, Check, Loader2 } from 'lucide-react';
import { Badge } from './ui/badge';

/**
 * MediaCard - Reusable media display component
 * Extracted from GalleryPage.js and other monoliths
 * 
 * Supports: Photos, Videos, Thumbnails with overlays
 */

export const MediaCard = ({
  item,
  aspectRatio = 'square', // 'square', '16:9', '4:3', 'auto'
  showPrice = false,
  showStatus = false,
  showSelection = false,
  isSelected = false,
  isPurchased = false,
  isLocked = false,
  isLoading = false,
  onSelect,
  onClick,
  className = '',
  theme = 'dark'
}) => {
  const isVideo = item.media_type === 'video' || item.type === 'video';
  const isLight = theme === 'light';
  
  const aspectClasses = {
    'square': 'aspect-square',
    '16:9': 'aspect-video',
    '4:3': 'aspect-[4/3]',
    'auto': ''
  };

  return (
    <div
      className={`relative ${aspectClasses[aspectRatio]} rounded-lg overflow-hidden bg-zinc-800 group cursor-pointer ${className}`}
      onClick={(e) => {
        if (showSelection && onSelect) {
          e.stopPropagation();
          onSelect(item.id);
        } else if (onClick) {
          onClick(item);
        }
      }}
      data-testid={`media-card-${item.id}`}
    >
      {/* Selection checkbox */}
      {showSelection && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(item.id);
          }}
          className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
            isSelected
              ? 'bg-cyan-500 border-cyan-500'
              : 'bg-black/50 border-white/50 hover:border-white'
          }`}
        >
          {isSelected && <Check className="w-4 h-4 text-white" />}
        </button>
      )}
      
      {/* Media preview */}
      {isVideo ? (
        <div className="relative w-full h-full">
          <img
            src={item.thumbnail_url || item.preview_url}
            alt={item.title || 'Video thumbnail'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/70 flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-1" />
            </div>
          </div>
        </div>
      ) : (
        <img
          src={item.preview_url || item.thumbnail_url || item.url}
          alt={item.title || 'Photo'}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
      
      {/* Lock overlay for unpurchased content */}
      {isLocked && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <Lock className="w-8 h-8 text-white/70" />
        </div>
      )}
      
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
      )}
      
      {/* Purchased indicator */}
      {isPurchased && !showSelection && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
          <Check className="w-4 h-4 text-white" />
        </div>
      )}
      
      {/* Bottom badges row */}
      <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end">
        {/* Video indicator */}
        {isVideo && (
          <Badge className="bg-black/70 text-white text-xs flex items-center gap-1">
            <Play className="w-3 h-3" />
            Video
          </Badge>
        )}
        
        {/* Price badge */}
        {showPrice && item.price && !isPurchased && (
          <Badge className="bg-black/70 text-white text-xs ml-auto">
            ${item.custom_price || item.price}
          </Badge>
        )}
      </div>
      
      {/* Status badge */}
      {showStatus && item.status && (
        <div className="absolute top-2 right-2">
          <Badge className={`text-xs ${
            item.status === 'published' ? 'bg-green-500/80' :
            item.status === 'draft' ? 'bg-amber-500/80' :
            'bg-zinc-500/80'
          }`}>
            {item.status}
          </Badge>
        </div>
      )}
      
      {/* Hover overlay - only show when not in selection mode */}
      {!showSelection && onClick && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Eye className="w-6 h-6 text-white" />
        </div>
      )}
    </div>
  );
};

export default MediaCard;
