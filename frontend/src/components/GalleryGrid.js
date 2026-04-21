import React, { useState } from 'react';
import { Edit3, Trash2, Check, Loader2, Play, Image, MoreVertical, X } from 'lucide-react';
import { Button } from './ui/button';
import { getFullUrl } from '../utils/media';

/**
 * GalleryGrid - Mobile-first gallery grid with tap-to-view UX.
 * 
 * UX pattern (industry standard - Google Photos / Instagram):
 * - Tap an item → opens detail view (onClick handler)
 * - In bulk select mode → tap toggles selection
 * - Long-press or 3-dot menu → shows edit/delete actions
 * - No hover-dependent interactions (mobile-friendly)
 */

export const GalleryGridItem = ({
  item,
  isSelected = false,
  bulkSelectMode = false,
  isDeleting = false,
  onSelect,
  onClick,
  onEdit,
  onDelete,
  _theme = 'dark'
}) => {
  const isVideo = item.media_type === 'video' || item.type === 'video';
  const [imgError, setImgError] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const imgSrc = getFullUrl(
    isVideo
      ? (item.thumbnail_url || item.preview_url)
      : (item.preview_url || item.thumbnail_url)
  );

  const handleTap = () => {
    if (bulkSelectMode) {
      onSelect?.(item.id);
    } else {
      onClick?.(item);
    }
  };

  const handleMenuToggle = (e) => {
    e.stopPropagation();
    setShowMenu(prev => !prev);
  };

  return (
    <div
      className="relative aspect-square rounded-xl overflow-hidden bg-muted/50 group cursor-pointer"
      onClick={handleTap}
      data-testid={`gallery-item-${item.id}`}
    >
      {/* Selection checkbox in bulk mode */}
      {bulkSelectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(item.id); }}
          className={`absolute top-2 left-2 z-20 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-cyan-500 border-cyan-500 scale-110'
              : 'bg-black/40 border-white/60 backdrop-blur-sm'
          }`}
        >
          {isSelected && <Check className="w-4 h-4 text-white" />}
        </button>
      )}

      {/* 3-dot menu button (always visible on mobile, shown on hover for desktop) */}
      {!bulkSelectMode && (onEdit || onDelete) && (
        <button
          onClick={handleMenuToggle}
          className="absolute top-2 right-2 z-20 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white opacity-80 md:opacity-0 md:group-hover:opacity-100 transition-opacity active:scale-90"
          aria-label="Item actions"
        >
          {showMenu ? <X className="w-4 h-4" /> : <MoreVertical className="w-4 h-4" />}
        </button>
      )}

      {/* Dropdown action menu */}
      {showMenu && (
        <>
          {/* Invisible overlay to close menu on tap outside */}
          <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} />
          <div className="absolute top-12 right-2 z-30 bg-card border border-border rounded-lg shadow-xl overflow-hidden min-w-[140px] animate-in fade-in slide-in-from-top-2 duration-150">
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(false); onEdit(item); }}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-foreground hover:bg-muted/80 transition-colors"
              >
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(item.id); }}
                disabled={isDeleting}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {/* Media preview with graceful fallback */}
      {imgError || !imgSrc ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900 text-gray-400">
          {isVideo ? (
            <Play className="w-10 h-10 mb-1 opacity-60" />
          ) : (
            <Image className="w-10 h-10 mb-1 opacity-60" />
          )}
          <span className="text-[10px] opacity-40">Preview unavailable</span>
        </div>
      ) : (
        <>
          <img
            src={imgSrc}
            alt={item.title || (isVideo ? 'Video' : 'Photo')}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
          {/* Selection tint overlay */}
          {bulkSelectMode && isSelected && (
            <div className="absolute inset-0 bg-cyan-500/20 border-2 border-cyan-400 rounded-xl" />
          )}
        </>
      )}

      {/* Video badge */}
      {isVideo && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[11px] text-white font-medium flex items-center gap-1">
          <Play className="w-3 h-3" fill="white" />
          Video
          {item.video_duration && (
            <span className="ml-0.5 text-white/70">
              {Math.floor(item.video_duration / 60)}:{String(Math.floor(item.video_duration % 60)).padStart(2, '0')}
            </span>
          )}
        </div>
      )}

      {/* Price badge */}
      {item.price > 0 && item.is_for_sale && !bulkSelectMode && (
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-emerald-500/90 backdrop-blur-sm text-[11px] text-white font-bold">
          ${(item.custom_price || item.price).toFixed(0)}
        </div>
      )}
    </div>
  );
};

export const GalleryGrid = ({
  items = [],
  selectedItems = new Set(),
  bulkSelectMode = false,
  deletingItemId = null,
  columns = { base: 2, md: 3, lg: 4 },
  gap = 3,
  onItemSelect,
  onItemClick,
  onItemEdit,
  onItemDelete,
  emptyMessage = 'No items in gallery',
  theme = 'dark'
}) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Image className="w-14 h-14 mb-3 opacity-30" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-${gap}`}>
      {items.map((item) => (
        <GalleryGridItem
          key={item.id}
          item={item}
          isSelected={selectedItems.has(item.id)}
          bulkSelectMode={bulkSelectMode}
          isDeleting={deletingItemId === item.id}
          onSelect={onItemSelect}
          onClick={onItemClick}
          onEdit={onItemEdit}
          onDelete={onItemDelete}
          theme={theme}
        />
      ))}
    </div>
  );
};

export default GalleryGrid;
