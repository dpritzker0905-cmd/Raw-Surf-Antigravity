import React from 'react';
import {
  Lock, Download, Eye, EyeOff, Video, Heart, Share2, Calendar, Camera, MapPin,
  MoreHorizontal, MessageSquare, Check
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '../ui/dropdown-menu';

const GalleryItemCard = ({ 
  item, 
  onVisibilityToggle, 
  onDownload, 
  onFavoriteToggle,
  onShare,
  onRequestEdit,
  onImageClick,
  onMessage,
  _userId,
  viewMode = 'grid',
  isSelected,
  onSelect
}) => {
  const isPro = item.gallery_tier === 'pro';
  const isAccessible = item.is_paid || ['included', 'gifted'].includes(item.access_type);
  const isFavorite = item.is_favorite;
  
  // List view
  if (viewMode === 'list') {
    return (
      <div 
        data-testid="surfer-gallery-page" className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
          isSelected 
            ? 'bg-cyan-500/10 border-cyan-500/50' 
            : 'bg-card border-border hover:bg-muted/50'
        }`}
        data-testid={`gallery-item-${item.id}`}
      >
        {/* Selection checkbox */}
        <button aria-label="Confirm"
          onClick={() => onSelect?.(item.id)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-600 hover:border-cyan-400'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 text-foreground" />}
        </button>
        
        {/* Thumbnail */}
        <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
          <img loading="lazy" decoding="async" 
            src={item.thumbnail_url || item.url} 
            alt=""
            className="w-full h-full object-cover"
          />
          {item.media_type === 'video' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Video className="w-5 h-5 text-foreground" />
            </div>
          )}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {item.title || `Photo ${item.id?.slice(-6)}`}
            </span>
            {isFavorite && <Heart className="w-4 h-4 text-red-400 fill-red-400" />}
            {isPro && <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">PRO</Badge>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Camera className="w-3 h-3" />
              {item.photographer_name || 'Unknown'}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(item.created_at).toLocaleDateString()}
            </span>
            {item.spot_name && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {item.spot_name}
              </span>
            )}
          </div>
        </div>
        
        {/* Status */}
        <div className="flex items-center gap-2">
          {item.is_public ? (
            <Badge className="bg-green-500/20 text-green-400 text-xs">Public</Badge>
          ) : (
            <Badge className="bg-zinc-700 text-muted-foreground text-xs">Private</Badge>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onFavoriteToggle?.(item.id)}
            className={isFavorite ? 'text-red-400' : 'text-muted-foreground'}
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
          </Button>
          <Button aria-label="Download"
            size="sm"
            variant="ghost"
            onClick={() => onDownload?.(item)}
            disabled={!isAccessible}
            className="text-muted-foreground"
          >
            <Download className="w-4 h-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="text-muted-foreground" aria-label="More options">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border">
              <DropdownMenuItem onClick={() => onVisibilityToggle?.(item.id, !item.is_public)}>
                {item.is_public ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                Make {item.is_public ? 'Private' : 'Public'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onShare?.(item)}>
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRequestEdit?.(item)}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Request Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }
  
  // Grid view (default)
  return (
    <div 
      className={`group relative rounded-xl overflow-hidden border-2 transition-all ${
        isSelected 
          ? 'border-cyan-500 ring-2 ring-cyan-500/30' 
          : 'border-transparent hover:border-zinc-600'
      }`}
      data-testid={`gallery-item-${item.id}`}
    >
      {/* Selection checkbox */}
      <button aria-label="Confirm"
        onClick={() => onSelect?.(item.id)}
        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
          isSelected 
            ? 'bg-cyan-500 border-cyan-500' 
            : 'bg-black/50 border-white/50 opacity-0 group-hover:opacity-100'
        }`}
      >
        {isSelected && <Check className="w-4 h-4 text-foreground" />}
      </button>
      
      {/* Favorite button */}
      <button
        onClick={() => onFavoriteToggle?.(item.id)}
        className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all ${
          isFavorite 
            ? 'bg-red-500/80 text-foreground' 
            : 'bg-black/50 text-foreground opacity-0 group-hover:opacity-100 hover:bg-red-500/80'
        }`}
      >
        <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
      </button>
      
      {/* Image */}
      <div className="aspect-square bg-muted cursor-pointer" onClick={() => onImageClick?.(item)}>
        <img loading="lazy" decoding="async" 
          src={item.thumbnail_url || item.url} 
          alt=""
          className={`w-full h-full object-cover transition-all ${
            !isAccessible ? 'blur-sm' : ''
          }`}
        />
        
        {/* Video indicator */}
        {item.media_type === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
              <Video className="w-6 h-6 text-foreground" />
            </div>
          </div>
        )}
        
        {/* Pro tier badge */}
        {isPro && (
          <div className="absolute top-2 left-10 px-2 py-0.5 rounded bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-xs font-bold">
            PRO
          </div>
        )}
        
        {/* Locked overlay */}
        {!isAccessible && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <Lock className="w-8 h-8 text-amber-400 mb-2" />
            <span className="text-foreground text-sm font-medium">Purchase to unlock</span>
          </div>
        )}
      </div>
      
      {/* Info overlay on hover */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-foreground text-sm font-medium truncate">
              {item.photographer_name || 'Unknown'}
            </p>
            <p className="text-muted-foreground text-xs">
              {new Date(item.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {/* Quick Message to Photographer */}
            {item.photographer_id && (
              <Button aria-label="Message Square"
                size="sm"
                variant="ghost"
                onClick={() => onMessage?.(item.photographer_id, item.photographer_name)}
                className="text-foreground hover:bg-cyan-500/20 h-8 w-8 p-0"
                title="Message photographer"
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
            )}
            <Button aria-label="Share"
              size="sm"
              variant="ghost"
              onClick={() => onShare?.(item)}
              className="text-foreground hover:bg-white/20 h-8 w-8 p-0"
            >
              <Share2 className="w-4 h-4" />
            </Button>
            <Button aria-label="Download"
              size="sm"
              variant="ghost"
              onClick={() => onDownload?.(item)}
              disabled={!isAccessible}
              className="text-foreground hover:bg-white/20 h-8 w-8 p-0"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
      
      {/* Visibility indicator */}
      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button aria-label="View"
          onClick={() => onVisibilityToggle?.(item.id, !item.is_public)}
          className={`p-1.5 rounded-full ${
            item.is_public ? 'bg-green-500/80' : 'bg-zinc-700/80'
          }`}
        >
          {item.is_public ? <Eye className="w-3 h-3 text-foreground" /> : <EyeOff className="w-3 h-3 text-foreground" />}
        </button>
      </div>
    </div>
  );
};

export default GalleryItemCard;
