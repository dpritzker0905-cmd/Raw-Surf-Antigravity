import React, { useState } from 'react';
import {
  Eye, ShoppingCart, Check, Lock, Play, Edit3, Sparkles,
  RotateCcw, UserPlus
} from 'lucide-react';
import { Badge } from './ui/badge';
import { getFullUrl } from '../utils/media';

const GalleryCard = ({ item, onClick, isOwner, isGromParent, linkedGroms, onTagGrom, onSetCustomPrice, onClearCustomPrice, getDisplayPrice }) => {
  const isVideo = item.media_type === 'video';
  const [showPriceEdit, setShowPriceEdit] = useState(false);
  const [editPrice, setEditPrice] = useState(item.custom_price || '');
  const [saving, setSaving] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  
  // Calculate display price using dynamic pricing rules
  const priceInfo = getDisplayPrice ? getDisplayPrice(item) : { price: item.price, source: 'default' };
  const hasCustomPrice = item.custom_price !== null && item.custom_price !== undefined && item.custom_price > 0;
  
  const handlePriceSubmit = async (e) => {
    e.stopPropagation();
    if (!onSetCustomPrice) return;
    
    setSaving(true);
    const price = parseFloat(editPrice);
    await onSetCustomPrice(item.id, price > 0 ? price : 0);
    setSaving(false);
    setShowPriceEdit(false);
  };
  
  const handleClearPrice = async (e) => {
    e.stopPropagation();
    if (!onClearCustomPrice) return;
    
    setSaving(true);
    await onClearCustomPrice(item.id);
    setSaving(false);
    setShowPriceEdit(false);
    setEditPrice('');
  };
  
  return (
    <div
      className="relative aspect-square rounded-lg overflow-hidden bg-card cursor-pointer group"
      data-testid={`gallery-item-${item.id}`}
    >
      <div onClick={onClick}>
        {isVideo ? (
          <video
            src={getFullUrl(item.preview_url)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            muted
            playsInline
          />
        ) : (
          <img
            src={getFullUrl(item.preview_url)}
            alt={item.title || 'Gallery photo'}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        )}
      </div>
      
      {/* Video indicator */}
      {isVideo && (
        <div className="absolute top-2 left-2">
          <Badge className="bg-black/70 text-white text-xs">
            <Play className="w-3 h-3 mr-1" />
            {item.video_duration ? `${Math.round(item.video_duration)}s` : 'Video'}
          </Badge>
        </div>
      )}
      
      {/* Price badge - with dynamic pricing indicator */}
      {!item.is_purchased && item.is_for_sale && (
        <div className="absolute top-2 right-2">
          <Badge className={`text-white text-xs ${
            hasCustomPrice 
              ? 'bg-gradient-to-r from-amber-500 to-orange-500' 
              : 'bg-black/70'
          }`}>
            {hasCustomPrice && <Sparkles className="w-3 h-3 mr-1" />}
            {!hasCustomPrice && <Lock className="w-3 h-3 mr-1" />}
            ${priceInfo.price}
          </Badge>
        </div>
      )}
      
      {item.is_purchased && (
        <div className="absolute top-2 right-2">
          <Badge className="bg-emerald-500 text-white text-xs">
            <Check className="w-3 h-3 mr-1" />
            Owned
          </Badge>
        </div>
      )}
      
      {/* Hover overlay - different for owners vs buyers */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-auto">
          {item.title && (
            <p className="text-white font-medium truncate" onClick={onClick}>{item.title}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-300 mt-1" onClick={onClick}>
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {item.view_count}
            </span>
            <span className="flex items-center gap-1">
              <ShoppingCart className="w-3 h-3" />
              {item.purchase_count}
            </span>
          </div>
          
          {/* Quick Edit Price Button - Owner Only */}
          {isOwner && !showPriceEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPriceEdit(true);
                setEditPrice(item.custom_price || '');
              }}
              className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-zinc-800/90 hover:bg-zinc-700 rounded text-xs text-white transition-colors"
              data-testid={`quick-price-btn-${item.id}`}
            >
              <Edit3 className="w-3 h-3" />
              {hasCustomPrice ? 'Edit Fixed Price' : 'Set Fixed Price'}
            </button>
          )}
          
          {/* Quick Edit Price Form */}
          {isOwner && showPriceEdit && (
            <div 
              className="mt-2 p-2 bg-zinc-900/95 rounded border border-zinc-700"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    placeholder="Price"
                    className="w-full pl-5 pr-2 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-white text-xs"
                    min="0"
                    step="0.5"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handlePriceSubmit}
                  disabled={saving}
                  className="px-2 py-1.5 bg-green-500 hover:bg-green-600 rounded text-black text-xs font-medium disabled:opacity-50"
                >
                  {saving ? '...' : 'Set'}
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                {hasCustomPrice && (
                  <button
                    onClick={handleClearPrice}
                    disabled={saving}
                    className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Use gallery price
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPriceEdit(false);
                  }}
                  className="text-xs text-gray-400 hover:text-white ml-auto"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          
          {/* Tag Grom Button - Grom Parents Only */}
          {isGromParent && linkedGroms && linkedGroms.length > 0 && !showPriceEdit && (
            <div className="relative mt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTagMenu(!showTagMenu);
                }}
                className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 rounded text-xs text-white font-medium transition-colors"
                data-testid={`tag-grom-btn-${item.id}`}
              >
                <UserPlus className="w-3 h-3" />
                Tag Grom
              </button>
              
              {/* Grom Selection Dropdown */}
              {showTagMenu && (
                <div 
                  className="absolute bottom-full left-0 right-0 mb-1 p-2 bg-zinc-900 rounded border border-zinc-700 z-50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-xs text-gray-400 mb-2">Select Grom to tag:</p>
                  {linkedGroms.map((grom) => (
                    <button
                      key={grom.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onTagGrom) {
                          onTagGrom(item.id, grom.id);
                        }
                        setShowTagMenu(false);
                      }}
                      className="w-full flex items-center gap-2 p-2 hover:bg-zinc-800 rounded text-left"
                    >
                      {grom.avatar ? (
                        <img src={grom.avatar} alt={grom.name} className="w-5 h-5 rounded-full" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center text-xs text-black font-bold">
                          {grom.name?.charAt(0) || 'G'}
                        </div>
                      )}
                      <span className="text-white text-xs">{grom.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTagMenu(false);
                    }}
                    className="mt-2 text-xs text-gray-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { GalleryCard };
