/**
 * GalleryLightbox — Fullscreen immersive photo/video viewer
 * 
 * Features:
 * - Swipe-to-navigate (touch + keyboard arrows)
 * - Pinch-to-zoom on mobile (two-finger)
 * - Scroll-wheel zoom on desktop
 * - Download, favorite, share actions in bottom bar
 * - Purchase CTA for locked/unpurchased items
 * - Photo counter "3 of 24"
 * - Unlock animation after purchase
 * - Auto-navigates through filtered gallery items
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, Heart, Download, Share2,
  ShoppingCart, Lock, Loader2, ZoomIn, ZoomOut, Camera,
  MapPin, Calendar, Check, Maximize2
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';

export const GalleryLightbox = ({
  item,
  items = [],
  onClose,
  onNavigate,
  onFavoriteToggle,
  onDownload,
  onShare,
  onPurchase,
  onMessage,
  isGromUser = false,
}) => {
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [swipeStartX, setSwipeStartX] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const containerRef = useRef(null);
  const imgRef = useRef(null);

  if (!item) return null;

  const currentIndex = items.findIndex(i => i.id === item.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;
  const isAccessible = item.is_paid || ['included', 'gifted'].includes(item.access_type);
  const isFavorite = item.is_favorite;

  // Reset zoom when navigating
  useEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setImgLoaded(false);
    setUnlocked(false);
  }, [item?.id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowRight' && hasNext) onNavigate?.(items[currentIndex + 1]);
      else if (e.key === 'ArrowLeft' && hasPrev) onNavigate?.(items[currentIndex - 1]);
      else if (e.key === 'f' || e.key === 'F') onFavoriteToggle?.(item.id);
      else if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 5));
      else if (e.key === '-') setZoom(z => Math.max(z - 0.25, 1));
      else if (e.key === '0') { setZoom(1); setPanOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, currentIndex, hasNext, hasPrev, items, onClose, onNavigate, onFavoriteToggle]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom(z => {
      const newZ = Math.max(1, Math.min(z + delta, 5));
      if (newZ <= 1) setPanOffset({ x: 0, y: 0 });
      return newZ;
    });
  }, []);

  // Touch swipe
  const handleTouchStart = (e) => {
    if (e.touches.length === 1 && zoom <= 1) {
      setSwipeStartX(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = (e) => {
    if (swipeStartX !== null && zoom <= 1) {
      const diff = e.changedTouches[0].clientX - swipeStartX;
      if (Math.abs(diff) > 60) {
        if (diff < 0 && hasNext) onNavigate?.(items[currentIndex + 1]);
        else if (diff > 0 && hasPrev) onNavigate?.(items[currentIndex - 1]);
      }
    }
    setSwipeStartX(null);
  };

  // Mouse pan when zoomed
  const handleMouseDown = (e) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging && zoom > 1) {
      setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  // Handle purchase with unlock animation
  const handlePurchaseClick = async () => {
    if (isGromUser) {
      toast.info('🤙 Ask your parent to approve this purchase!');
      return;
    }
    if (!onPurchase) return;
    setPurchasing(true);
    try {
      await onPurchase(item.id, 'high');
      setUnlocking(true);
      setTimeout(() => {
        setUnlocked(true);
        setUnlocking(false);
      }, 1200);
    } catch {
      // Error handled by parent
    } finally {
      setPurchasing(false);
    }
  };

  // Native download
  const handleNativeDownload = () => {
    const url = getFullUrl(item.original_url || item.url);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rawsurf_${item.id?.slice(-8) || 'photo'}.jpg`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('📸 Saved to device!');
  };

  const mediaUrl = getFullUrl(
    isAccessible || unlocked
      ? (item.original_url || item.url)
      : (item.thumbnail_url || item.url)
  );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200] bg-black flex flex-col select-none"
      onClick={(e) => { if (e.target === containerRef.current) onClose?.(); }}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          {items.length > 1 && (
            <span className="text-white/70 text-sm font-medium">
              {currentIndex + 1} of {items.length}
            </span>
          )}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.max(z - 0.5, 1))}
            disabled={zoom <= 1}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-30 transition"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-white/60 text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(z + 0.5, 5))}
            disabled={zoom >= 5}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-30 transition"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          {zoom > 1 && (
            <button
              onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-all"
          onClick={(e) => { e.stopPropagation(); onNavigate?.(items[currentIndex - 1]); }}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {hasNext && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-all"
          onClick={(e) => { e.stopPropagation(); onNavigate?.(items[currentIndex + 1]); }}
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Main image area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        {/* Unlock animation overlay */}
        {unlocking && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <div className="text-center animate-bounce">
              <div className="w-20 h-20 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/50">
                <Check className="w-10 h-10 text-white" />
              </div>
              <p className="text-white text-xl font-bold">🎉 Unlocked!</p>
              <p className="text-emerald-400 text-sm mt-1">Full resolution available</p>
            </div>
          </div>
        )}

        {item.media_type === 'video' ? (
          <video
            src={mediaUrl}
            controls
            playsInline
            className="max-w-[90vw] max-h-[75vh] object-contain"
            poster={getFullUrl(item.thumbnail_url)}
          />
        ) : (
          <>
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            )}
            <img
              ref={imgRef}
              src={mediaUrl}
              alt={item.title || 'Gallery photo'}
              className={`max-w-[90vw] max-h-[75vh] object-contain transition-all duration-200 ${
                !isAccessible && !unlocked ? 'blur-sm' : ''
              } ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
              style={{
                transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out'
              }}
              onLoad={() => setImgLoaded(true)}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          </>
        )}

        {/* Lock overlay for unpurchased items */}
        {!isAccessible && !unlocked && !unlocking && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-black/60 backdrop-blur-md rounded-2xl p-8 text-center max-w-sm mx-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-white text-lg font-bold mb-2">Unlock Full Resolution</h3>
              <p className="text-zinc-400 text-sm mb-4">
                Purchase this photo to download in full quality
              </p>
              <Button
                onClick={handlePurchaseClick}
                disabled={purchasing}
                className={`w-full font-bold py-3 ${
                  isGromUser
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white'
                    : 'bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black'
                }`}
              >
                {purchasing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isGromUser ? (
                  <>👨‍👧 Ask Parent to Approve</>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Buy for ${item.price || item.custom_price || 5}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="max-w-4xl mx-auto px-4 pb-6 pt-12">
          {/* Photo metadata */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-lg truncate">
                {item.photographer_name || 'Photographer'}
              </p>
              <div className="flex items-center gap-3 text-zinc-400 text-sm mt-1">
                {item.spot_name && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {item.spot_name}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Favorite */}
              <button
                onClick={(e) => { e.stopPropagation(); onFavoriteToggle?.(item.id); }}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                  isFavorite
                    ? 'bg-red-500/30 text-red-400 ring-1 ring-red-500/50'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
              </button>

              {/* Share */}
              <button
                onClick={(e) => { e.stopPropagation(); onShare?.(item); }}
                className="w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all"
              >
                <Share2 className="w-5 h-5" />
              </button>

              {/* Message photographer */}
              {item.photographer_id && onMessage && (
                <button
                  onClick={(e) => { e.stopPropagation(); onMessage?.(item.photographer_id, item.photographer_name); }}
                  className="w-11 h-11 rounded-full bg-white/10 text-white hover:bg-cyan-500/30 flex items-center justify-center transition-all"
                  title="Message photographer"
                >
                  <Camera className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Download — only for accessible items */}
              {(isAccessible || unlocked) && (
                <Button
                  onClick={(e) => { e.stopPropagation(); handleNativeDownload(); }}
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold px-5"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Save to Device
                </Button>
              )}
            </div>
          </div>

          {/* Keyboard hints (desktop only) */}
          <p className="text-center text-white/25 text-xs mt-3 hidden md:block">
            ← → Navigate • F Favorite • +/− Zoom • 0 Reset • Esc Close
          </p>
        </div>
      </div>
    </div>
  );
};

export default GalleryLightbox;
