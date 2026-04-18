import React from 'react';
import { Edit3, Trash2, Check, Loader2, Play, Image } from 'lucide-react';
import { Button } from './ui/button';

/**
 * GalleryGrid - Extracted from GalleryPage.js for modularity
 * Displays a grid of gallery items with selection and hover actions
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

  return (
    <div
      className="relative aspect-square rounded-lg overflow-hidden bg-zinc-800 group cursor-pointer"
      onClick={(_e) => {
        if (bulkSelectMode) {
          onSelect?.(item.id);
        } else {
          onClick?.(item);
        }
      }}
      data-testid={`gallery-item-${item.id}`}
    >
      {/* Selection checkbox when in bulk mode */}
      {bulkSelectMode && (
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
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/70 flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-1" />
            </div>
          </div>
        </div>
      ) : (
        <img
          src={item.preview_url || item.thumbnail_url}
          alt={item.title || 'Gallery photo'}
          className="w-full h-full object-cover"
        />
      )}
      
      {/* Hover overlay - only show when not in bulk mode */}
      {!bulkSelectMode && (
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {onEdit && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
              variant="outline"
              size="sm"
              className="border-white/50 text-white hover:bg-white/20"
            >
              <Edit3 className="w-4 h-4 mr-1" />
              Edit
            </Button>
          )}
          {onDelete && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
              disabled={isDeleting}
              variant="destructive"
              size="sm"
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      )}

      {/* Media type indicator */}
      {isVideo && !bulkSelectMode && (
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 text-xs text-white flex items-center gap-1">
          <Play className="w-3 h-3" />
          Video
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
  gap = 4,
  onItemSelect,
  onItemClick,
  onItemEdit,
  onItemDelete,
  emptyMessage = 'No items in gallery',
  theme = 'dark'
}) => {
  const isLight = theme === 'light';
  const _gridColsClass = `grid-cols-${columns.base} md:grid-cols-${columns.md} lg:grid-cols-${columns.lg}`;

  if (items.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 ${
        isLight ? 'text-gray-500' : 'text-gray-400'
      }`}>
        <Image className="w-12 h-12 mb-3 opacity-50" />
        <p>{emptyMessage}</p>
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
