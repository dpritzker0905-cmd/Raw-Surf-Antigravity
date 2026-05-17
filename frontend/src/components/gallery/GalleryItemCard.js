/**
 * GalleryItemCard & QualityOption — Extracted from PublicPhotographerGallery.js (v83)
 */
import React, { useState } from 'react';
import { Play, ShoppingCart, MapPin, Check, Star } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

var VIEW_MODES = {
  GRID: 'grid',
  MASONRY: 'masonry',
  LIST: 'list'
};

export var GalleryItemCard = ({ item, isPurchased, viewMode, isLight, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const itemCardBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  
  return (
    <div
      className={`
        relative group cursor-pointer overflow-hidden rounded-lg ${itemCardBg}
        ${viewMode === VIEW_MODES.MASONRY ? 'mb-4 break-inside-avoid' : 'aspect-square'}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {item.media_type === 'video' ? (
        <video 
          className={`
            w-full h-full object-cover transition-transform duration-300
            ${isHovered ? 'scale-105' : 'scale-100'}
          `}
          muted
          loop
          playsInline
          preload="none"
          poster={item.thumbnail_url || undefined}
        />
      ) : (
        <img loading="lazy" decoding="async" 
          src={item.thumbnail_url || item.preview_url}
          alt={item.title || 'Gallery item'}
          className={`
            w-full h-full object-cover transition-transform duration-300
            ${isHovered ? 'scale-105' : 'scale-100'}
          `}
        />
      )}
      
      {/* Video indicator */}
      {item.media_type === 'video' && (
        <div className="absolute top-2 left-2">
          <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
            <Play className="w-4 h-4 text-white fill-white" />
          </div>
        </div>
      )}
      
      {/* Purchase status */}
      {isPurchased ? (
        <div className="absolute top-2 right-2">
          <Badge className="bg-emerald-600 text-white">
            <Check className="w-3 h-3 mr-1" />
            Owned
          </Badge>
        </div>
      ) : (
        <div className="absolute top-2 right-2">
          <Badge className="bg-black/60 text-white">
            ${item.custom_price || item.price || 5}
          </Badge>
        </div>
      )}
      
      {/* Featured badge */}
      {item.is_featured && (
        <div className="absolute top-2 left-2">
          <Badge className="bg-yellow-500 text-black">
            <Star className="w-3 h-3 mr-1 fill-current" />
            Featured
          </Badge>
        </div>
      )}
      
      {/* Hover overlay */}
      <div className={`
        absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent
        flex items-end p-3 transition-opacity duration-200
        ${isHovered ? 'opacity-100' : 'opacity-0'}
      `}>
        <div className="flex-1">
          {item.spot_name && (
            <p className="text-xs text-zinc-400 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {item.spot_name}
            </p>
          )}
          <p className="text-white text-sm font-medium truncate">
            {item.title || 'Surf Shot'}
          </p>
        </div>
        {!isPurchased && (
          <Button aria-label="Shopping Cart" size="sm" className="bg-white/20 hover:bg-white/30 text-white">
            <ShoppingCart className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export var QualityOption = ({ label, sublabel, price, selected, onClick, recommended, isLight }) => (
  <button
    onClick={onClick}
    className={`
      p-3 rounded-lg border transition-all text-left
      ${selected 
        ? 'border-emerald-500 bg-emerald-500/10' 
        : isLight ? 'border-gray-300 bg-gray-100 hover:border-gray-400' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
      }
    `}
  >
    <div className="flex items-center justify-between mb-1">
      <span className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>{label}</span>
      {recommended && (
        <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">Best</Badge>
      )}
    </div>
    {sublabel && (
      <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-zinc-500'} mb-1`}>{sublabel}</p>
    )}
    <p className="text-lg font-bold text-emerald-400">${price.toFixed(2)}</p>
  </button>
);
