import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Camera, Image, Play, ShoppingCart, Grid, LayoutGrid, MapPin, Check,
  Sparkles, Star, ArrowLeft, User, Lock,
  CalendarCheck, Folder, Search, ScanFace
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { LockerSelfieModal } from './LockerSelfieModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { getFullUrl } from '../utils/media';
import usePublicGalleryActions from '../hooks/usePublicGalleryActions';
import { PhotographerAvailability } from './PhotographerAvailability';
import { GalleryItemCard, QualityOption } from './gallery/GalleryItemCard';

// Gallery View Modes
const VIEW_MODES = {
  GRID: 'grid',
  MASONRY: 'masonry',
  LIST: 'list'
};

export const PublicPhotographerGallery = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { photographerId: paramPhotographerId } = useParams();
  
  const photographerId = paramPhotographerId || searchParams.get('photographer');
  const deepLinkGalleryId = searchParams.get('gallery');

  const [photographer, setPhotographer] = useState(null);
  const [galleries, setGalleries] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [serviceFilter, _setServiceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [purchasedIds, setPurchasedIds] = useState(new Set());
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState('standard');
  const [galleriesReady, setGalleriesReady] = useState(false);
  
  const [showAIMatch, setShowAIMatch] = useState(false);
  const [aiMatchResults, setAIMatchResults] = useState([]);
  const [_aiMatchLoading, setAIMatchLoading] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);

  const swipeStartXRef = useRef(0);
  const swipeStartYRef = useRef(0);
  const swipeActiveRef = useRef(false);
  const swipeDragRef = useRef(0);
  const swipeLockedRef = useRef(false);
  const galleryContentRef = useRef(null);
  const galleryPillsRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBg = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-950';
  const cardBg = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-900 border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : isBeach ? 'text-gray-300' : 'text-zinc-400';
  const borderColor = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const inputBg = isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-900 border-zinc-700 text-white';
  const coverGradient = isLight
    ? 'bg-gradient-to-r from-emerald-100 via-gray-100 to-yellow-100'
    : 'bg-gradient-to-r from-emerald-900/50 via-zinc-900 to-yellow-900/50';
  const avatarBorder = isLight ? 'border-white' : 'border-black';
  const avatarBg = isLight ? 'bg-gray-200' : 'bg-zinc-800';
  const pillActive = isLight ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-black border-white';
  const pillInactive = isLight
    ? 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
    : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500';
  const skeletonBg = isLight ? 'bg-gray-200' : 'bg-zinc-800';
  const cardItemBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  const modalBg = isLight ? 'bg-white border-gray-200 text-gray-900' : 'bg-zinc-900 border-zinc-700 text-white';
  const viewToggleBg = isLight ? 'border-gray-300' : 'border-zinc-700';
  const viewToggleActive = isLight ? 'bg-gray-200' : 'bg-zinc-700';
  const viewToggleInactive = isLight ? 'bg-white' : 'bg-zinc-900';

  const {
    fetchPhotographer,
    fetchGalleries,
    fetchItems,
    runAIFaceMatch,
    handlePurchase,
    filteredItems,
    handleSwipeGallery,
    getQualityPrice,
  } = usePublicGalleryActions({
    photographerId,
    user,
    galleries,
    setGalleries,
    items,
    setItems,
    setLoading,
    selectedGallery,
    setSelectedGallery,
    setPhotographer,
    setPurchasedIds,
    purchasedIds,
    selectedItem,
    setSelectedItem,
    serviceFilter,
    searchQuery,
    sortBy,
    setShowPurchaseModal,
    setPurchaseLoading,
    selectedQuality,
    setAIMatchLoading,
    setAIMatchResults,
    setShowAIMatch,
    setGalleriesReady,
    galleryContentRef,
    isAnimating,
    setIsAnimating,
  });

  useEffect(() => {
    if (photographerId) {
      fetchPhotographer();
      fetchGalleries();
      fetchItems();
    }
  }, [photographerId, fetchPhotographer, fetchGalleries, fetchItems]);

  useEffect(() => {
    if (galleries.length > 0 && !selectedGallery) {
      if (deepLinkGalleryId) {
        const target = galleries.find(g => g.id === deepLinkGalleryId);
        if (target) {
          setSelectedGallery(target);
          return;
        }
      }
      // Default to first gallery
      setSelectedGallery(galleries[0]);
    }
  }, [deepLinkGalleryId, galleries, selectedGallery]);

  useEffect(() => {
    if (!selectedGallery || !galleryPillsRef.current) return;
    const activeBtn = galleryPillsRef.current.querySelector(
      `[data-gallery-id="${selectedGallery.id}"]`
    );
    if (activeBtn) {
      activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedGallery]);

  if (!photographerId) {
    return (
      <div className={`min-h-screen ${mainBg} flex items-center justify-center`}>
        <div className="text-center">
          <Camera className={`w-16 h-16 ${textSecondary} mx-auto mb-4`} />
          <h2 className={`text-xl ${textPrimary} mb-2`}>No Photographer Selected</h2>
          <p className={`${textSecondary} mb-4`}>Browse our photographer directory to find amazing surf shots</p>
          <Button onClick={() => navigate('/explore')} className="bg-gradient-to-r from-emerald-500 to-yellow-500">
            Find Photographers
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${mainBg}`}>
      {/* Photographer Header */}
      <div className="relative">
        {/* Cover gradient */}
        <div className={`h-32 ${coverGradient}`} />
        
        {/* Profile section */}
        <div className="max-w-7xl mx-auto px-4 -mt-16">
          <div className="flex flex-col md:flex-row items-start md:items-end gap-4 pb-6">
            {/* Back button */}
            <Button aria-label="Go back" 
              variant="ghost" 
              onClick={() => navigate(-1)}
              className={`absolute top-4 left-4 ${isLight ? 'text-gray-500 hover:text-gray-900' : 'text-white/70 hover:text-white'}`}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back
            </Button>
            
            {/* Avatar */}
            <div className={`w-28 h-28 rounded-full border-4 ${avatarBorder} overflow-hidden ${avatarBg}`}>
              {photographer?.avatar_url ? (
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(photographer.avatar_url)}
                  alt={photographer?.full_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className={`w-12 h-12 ${textSecondary}`} />
                </div>
              )}
            </div>
            
            {/* Info */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 className={`text-2xl font-bold ${textPrimary}`}>{photographer?.full_name || 'Photographer'}</h1>
                {photographer?.is_approved_pro && (
                  <Badge className="bg-gradient-to-r from-emerald-500 to-yellow-500 text-black">
                    <Check className="w-3 h-3 mr-1" />
                    Verified Pro
                  </Badge>
                )}
              </div>
              {photographer?.username && (
                <p 
                  className={`${textSecondary} mb-2 cursor-pointer hover:underline hover:text-cyan-400 transition-colors`}
                  onClick={() => navigate(`/profile/${photographerId}`)}
                >@{photographer.username}</p>
              )}
              {photographer?.bio && (
                <p className={`${isLight ? 'text-gray-600' : 'text-zinc-300'} text-sm max-w-xl`}>{photographer.bio}</p>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex gap-2">
              <Button 
                onClick={() => navigate(`/profile/${photographerId}`)}
                variant="outline"
                className={`${borderColor} ${textPrimary} ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'}`}
              >
                View Profile
              </Button>
              <PhotographerAvailability
                photographerId={photographerId}
                photographerName={photographer?.full_name || 'Photographer'}
                onWatchLive={() => navigate(`/live/${photographerId}`)}
                onRequestOnDemand={() => navigate(`/profile/${photographerId}`)}
                onBook={() => navigate(`/profile/${photographerId}`)}
                trigger={
                  <Button aria-label="Calendar Check" 
                    className="bg-gradient-to-r from-emerald-500 to-yellow-500 text-black font-semibold"
                  >
                    <CalendarCheck className="w-4 h-4 mr-2" />
                    Book Session
                  </Button>
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* AI Face Match Banner */}
        {user && (
          <Card className={`${isLight ? 'bg-gradient-to-r from-purple-100 to-pink-100 border-purple-300' : 'bg-gradient-to-r from-purple-900/30 to-pink-900/30 border-purple-500/30'} mb-6 p-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className={`${textPrimary} font-semibold`}>AI Photo Finder</h3>
                  <p className={`${textSecondary} text-sm`}>Let AI find photos of you using facial recognition</p>
                </div>
              </div>
              <Button aria-label="Scan Face" 
                onClick={() => setScanModalOpen(true)}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-semibold"
              >
                <ScanFace className="w-4 h-4 mr-2" />
                Find My Photos
              </Button>
            </div>
          </Card>
        )}

        {/* Galleries/Albums Row */}
        {galleries.length > 0 && (
          <div className="mb-6">
            <h2 className={`text-lg font-semibold ${textPrimary} mb-3`}>Session Galleries</h2>
            <div ref={galleryPillsRef} className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {galleries.map(gallery => (
                <button aria-label="Folder"
                  key={gallery.id}
                  data-gallery-id={gallery.id}
                  onClick={() => setSelectedGallery(gallery)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full border transition-all flex items-center gap-2 max-w-[75vw] ${
                    selectedGallery?.id === gallery.id 
                      ? pillActive 
                      : pillInactive
                  }`}
                >
                  <Folder className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{gallery.title}</span>
                  <span className="text-xs opacity-60 flex-shrink-0">({gallery.item_count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Swipeable content area - swipe left/right to switch gallery folders on mobile */}
        <div
          className="relative overflow-hidden"
          onTouchStart={(e) => {
            if (isAnimating) return;
            swipeStartXRef.current = e.touches[0].clientX;
            swipeStartYRef.current = e.touches[0].clientY;
            swipeActiveRef.current = true;
            swipeLockedRef.current = false;
            swipeDragRef.current = 0;
            if (galleryContentRef.current) {
              galleryContentRef.current.style.transition = 'none';
            }
          }}
          onTouchMove={(e) => {
            if (!swipeActiveRef.current || isAnimating) return;
            const dx = e.touches[0].clientX - swipeStartXRef.current;
            const dy = e.touches[0].clientY - swipeStartYRef.current;
            if (!swipeLockedRef.current) {
  
              if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
                swipeActiveRef.current = false;
                if (galleryContentRef.current) {
                  galleryContentRef.current.style.transform = '';
                  galleryContentRef.current.style.transition = '';
                }
                return;
              }
              if (Math.abs(dx) > 10) {
                swipeLockedRef.current = true;
              } else {
                return;
              }
            }
            e.preventDefault();
            const currentIdx = galleries.findIndex(g => g.id === selectedGallery?.id);
            const atEdge = (dx > 0 && currentIdx === 0) || (dx < 0 && currentIdx === galleries.length - 1);
            const dampened = atEdge ? dx * 0.2 : dx;
            swipeDragRef.current = dampened;
            if (galleryContentRef.current) {
              galleryContentRef.current.style.transform = `translateX(${dampened}px)`;
              const progress = Math.min(Math.abs(dampened) / 200, 1);
              galleryContentRef.current.style.opacity = `${1 - progress * 0.15}`;
            }
          }}
          onTouchEnd={() => {
            if (!swipeActiveRef.current || isAnimating) {
              swipeActiveRef.current = false;
              return;
            }
            swipeActiveRef.current = false;
            const dragX = swipeDragRef.current;
            const MIN_SWIPE = 50;
            if (Math.abs(dragX) >= MIN_SWIPE && swipeLockedRef.current) {
              const goingLeft = dragX < 0;
              handleSwipeGallery(goingLeft ? 'left' : 'right');
              return;
            }

            if (galleryContentRef.current) {
              galleryContentRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
              galleryContentRef.current.style.transform = 'translateX(0)';
              galleryContentRef.current.style.opacity = '1';
              setTimeout(() => {
                if (galleryContentRef.current) {
                  galleryContentRef.current.style.transition = '';
                  galleryContentRef.current.style.transform = '';
                  galleryContentRef.current.style.opacity = '';
                }
              }, 220);
            }
          }}
        >
        <div ref={galleryContentRef} className="will-change-transform">

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
            <Input aria-label="Search photos..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search photos..."
              className={`pl-10 ${inputBg}`}
            />
          </div>
          
          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className={`px-3 py-2 ${inputBg} border rounded-md text-sm`}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="price_low">Price: Low to High</option>
            <option value="price_high">Price: High to Low</option>
            <option value="popular">Most Popular</option>
          </select>
          
          {/* View Mode */}
          <div className={`flex border ${viewToggleBg} rounded-md overflow-hidden`}>
            <button
              onClick={() => setViewMode(VIEW_MODES.GRID)}
              className={`p-2 ${viewMode === VIEW_MODES.GRID ? viewToggleActive : viewToggleInactive}`}
            >
              <Grid className={`w-4 h-4 ${textPrimary}`} />
            </button>
            <button
              onClick={() => setViewMode(VIEW_MODES.MASONRY)}
              className={`p-2 ${viewMode === VIEW_MODES.MASONRY ? viewToggleActive : viewToggleInactive}`}
            >
              <LayoutGrid className={`w-4 h-4 ${textPrimary}`} />
            </button>
          </div>
          
          {/* Results count */}
          <span className={`${textSecondary} text-sm ml-auto`}>
            {filteredItems.length} {filteredItems.length === 1 ? 'photo' : 'photos'}
          </span>
        </div>

        {/* Gallery Grid */}
        {(loading || (!galleriesReady) || (galleries.length > 0 && !selectedGallery)) ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={`aspect-square ${skeletonBg} rounded-lg animate-pulse`} />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <Image className={`w-16 h-16 ${textSecondary} mx-auto mb-4`} />
            <h3 className={`text-xl ${textPrimary} mb-2`}>No Photos Yet</h3>
            <p className={textSecondary}>Check back after your session with this photographer</p>
          </div>
        ) : (
          <div className={`
            ${viewMode === VIEW_MODES.GRID 
              ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4' 
              : 'columns-2 md:columns-3 lg:columns-4 gap-4'
            }
          `}>
            {filteredItems.map(item => (
              <GalleryItemCard
                key={item.id}
                item={item}
                isPurchased={purchasedIds.has(item.id)}
                viewMode={viewMode}
                isLight={isLight}
                onClick={() => {
                  setSelectedItem(item);
                  if (!purchasedIds.has(item.id)) {
                    setShowPurchaseModal(true);
                  }
                }}
              />
            ))}
          </div>
        )}

        </div>{/* end galleryContentRef */}
        </div>{/* end swipe container */}
      </div>

      {/* Purchase Modal */}
      <Dialog open={showPurchaseModal} onOpenChange={setShowPurchaseModal}>
        <DialogContent className={`${modalBg} max-w-lg`}>
          <DialogHeader>
            <DialogTitle>Purchase {selectedItem?.media_type === 'video' ? 'Video' : 'Photo'}</DialogTitle>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4">
              {/* Preview */}
              <div className={`relative aspect-video ${cardItemBg} rounded-lg overflow-hidden`}>
                {selectedItem.media_type === 'video' ? (
                  <video 
                    src={selectedItem.preview_url || selectedItem.thumbnail_url}
                    className="w-full h-full object-contain"
                    muted
                    loop
                    playsInline
                    preload="none"
                    poster={selectedItem.thumbnail_url || undefined}
                  />
                ) : (
                  <img loading="lazy" decoding="async" 
                    src={selectedItem.preview_url || selectedItem.thumbnail_url}
                    alt={selectedItem.title || 'Gallery item'}
                    className="w-full h-full object-contain"
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Lock className="w-8 h-8 text-white/50" />
                </div>
              </div>
              
              {/* Quality Selection */}
              <div>
                <label className={`text-sm ${textSecondary} mb-2 block`}>Select Quality</label>
                <div className="grid grid-cols-3 gap-2">
                  {selectedItem.media_type === 'video' ? (
                    <>
                      <QualityOption
                        label="720p HD"
                        price={getQualityPrice(selectedItem, '720p')}
                        selected={selectedQuality === '720p'}
                        onClick={() => setSelectedQuality('720p')}
                        isLight={isLight}
                      />
                      <QualityOption
                        label="1080p Full HD"
                        price={getQualityPrice(selectedItem, '1080p')}
                        selected={selectedQuality === '1080p'}
                        onClick={() => setSelectedQuality('1080p')}
                        recommended
                        isLight={isLight}
                      />
                      <QualityOption
                        label="4K Ultra HD"
                        price={getQualityPrice(selectedItem, '4k')}
                        selected={selectedQuality === '4k'}
                        onClick={() => setSelectedQuality('4k')}
                        isLight={isLight}
                      />
                    </>
                  ) : (
                    <>
                      <QualityOption
                        label="Web"
                        sublabel="Social media"
                        price={getQualityPrice(selectedItem, 'web')}
                        selected={selectedQuality === 'web'}
                        onClick={() => setSelectedQuality('web')}
                        isLight={isLight}
                      />
                      <QualityOption
                        label="Standard"
                        sublabel="Print ready"
                        price={getQualityPrice(selectedItem, 'standard')}
                        selected={selectedQuality === 'standard'}
                        onClick={() => setSelectedQuality('standard')}
                        recommended
                        isLight={isLight}
                      />
                      <QualityOption
                        label="High Res"
                        sublabel="Full quality"
                        price={getQualityPrice(selectedItem, 'high')}
                        selected={selectedQuality === 'high'}
                        onClick={() => setSelectedQuality('high')}
                        isLight={isLight}
                      />
                    </>
                  )}
                </div>
              </div>
              
              {/* Photographer info */}
              <div className={`flex items-center gap-3 p-3 ${cardItemBg} rounded-lg`}>
                <div className={`w-10 h-10 rounded-full ${isLight ? 'bg-gray-300' : 'bg-zinc-700'} overflow-hidden`}>
                  {selectedItem.photographer_avatar ? (
                    <img loading="lazy" decoding="async" src={selectedItem.photographer_avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-6 h-6 text-zinc-500 m-auto mt-2" />
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm ${textPrimary} font-medium`}>{selectedItem.photographer_name}</p>
                  <p className={`text-xs ${textSecondary}`}>Photographer</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-emerald-400">
                    ${getQualityPrice(selectedItem, selectedQuality).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPurchaseModal(false)} className={borderColor}>
              Cancel
            </Button>
            <Button aria-label="div" 
              onClick={handlePurchase}
              disabled={purchaseLoading}
              className="bg-gradient-to-r from-emerald-500 to-yellow-500 text-black font-semibold"
            >
              {purchaseLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Purchase for ${getQualityPrice(selectedItem, selectedQuality).toFixed(2)}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Match Results Modal */}
      <Dialog open={showAIMatch} onOpenChange={setShowAIMatch}>
        <DialogContent className={`${modalBg} max-w-2xl`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              AI Found Your Photos
            </DialogTitle>
          </DialogHeader>
          
          {aiMatchResults.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 max-h-96 overflow-y-auto">
              {aiMatchResults.map(match => (
                <div 
                  key={match.id}
                  className={`relative aspect-square ${cardItemBg} rounded-lg overflow-hidden cursor-pointer hover:ring-2 ring-purple-500 transition-all`}
                  onClick={() => {
                    setSelectedItem(items.find(i => i.id === match.id));
                    setShowAIMatch(false);
                    setShowPurchaseModal(true);
                  }}
                >
                  <img loading="lazy" decoding="async" 
                    src={match.preview_url || match.thumbnail_url}
                    alt="Matched photo"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-purple-600 text-white text-xs">
                      {Math.round(match.confidence * 100)}% match
                    </Badge>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                    <p className="text-white text-sm font-semibold">${match.price || 5}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Sparkles className={`w-12 h-12 ${textSecondary} mx-auto mb-4`} />
              <p className={textSecondary}>No matching photos found yet</p>
              <p className={`${textSecondary} text-sm mt-2`}>Photos will appear here after your session</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Targeted Locker Selfie Scanner */}
      <LockerSelfieModal 
        isOpen={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        user={user}
        photographerId={photographer?.id}
        photographerName={photographer?.full_name}
      />
    </div>
  );
};

export default PublicPhotographerGallery;
