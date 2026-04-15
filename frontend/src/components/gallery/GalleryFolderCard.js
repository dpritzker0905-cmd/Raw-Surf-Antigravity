/**
 * GalleryFolderCard - Folder/Album card for gallery organization
 * Extracted from GalleryPage.js for better organization
 */
import React from 'react';
import { Folder, Image, Video, MapPin, Calendar, Edit3, Trash2 } from 'lucide-react';
import { Badge } from '../ui/badge';

export const GalleryFolderCard = ({ 
  folder, 
  onSelect, 
  onRename, 
  onDelete,
  isSelected = false 
}) => {
  const photoCount = folder.photo_count || 0;
  const videoCount = folder.video_count || 0;
  const totalItems = photoCount + videoCount;
  
  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div
      className={`relative group cursor-pointer rounded-lg overflow-hidden transition-all ${
        isSelected 
          ? 'ring-2 ring-cyan-400' 
          : 'hover:ring-2 hover:ring-zinc-600'
      }`}
      onClick={() => onSelect(folder)}
      data-testid={`gallery-folder-${folder.id}`}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-zinc-800 relative">
        {folder.thumbnail_url ? (
          <img 
            src={folder.thumbnail_url} 
            alt={folder.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Folder className="w-12 h-12 text-zinc-600" />
          </div>
        )}
        
        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename(folder);
              }}
              className="p-2 bg-zinc-800 rounded-full hover:bg-zinc-700"
            >
              <Edit3 className="w-4 h-4 text-white" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(folder);
              }}
              className="p-2 bg-red-900/50 rounded-full hover:bg-red-800"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          )}
        </div>
        
        {/* Item count badge */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          {photoCount > 0 && (
            <Badge className="bg-zinc-900/80 text-white text-[10px]">
              <Image className="w-3 h-3 mr-1" />
              {photoCount}
            </Badge>
          )}
          {videoCount > 0 && (
            <Badge className="bg-zinc-900/80 text-white text-[10px]">
              <Video className="w-3 h-3 mr-1" />
              {videoCount}
            </Badge>
          )}
        </div>
      </div>
      
      {/* Info */}
      <div className="p-2 bg-zinc-900">
        <h3 className="text-sm font-medium text-white truncate">{folder.name}</h3>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
          {folder.spot_name && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {folder.spot_name}
            </span>
          )}
          {folder.session_date && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(folder.session_date)}
            </span>
          )}
          {!folder.spot_name && !folder.session_date && (
            <span>{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default GalleryFolderCard;
