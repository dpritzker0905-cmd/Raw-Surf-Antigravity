import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { 
  Camera, Image, Play, ShoppingCart, Grid, LayoutGrid, MapPin, Check,
  Sparkles, Star, ArrowLeft, User, Lock,
  Zap, Radio, CalendarCheck, Folder, Search, ScanFace
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { LockerSelfieModal } from './LockerSelfieModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { isGrom } from '../lib/roles';


// Gallery View Modes
const VIEW_MODES = {
  GRID: 'grid',
  MASONRY: 'masonry',
  LIST: 'list'
};

// Service Types for filtering
const _SERVICE_TYPES = [
  { id: 'all', label: 'All Photos', icon: Image },
  { id: 'live_session', label: 'Live Sessions', icon: Radio },
  { id: 'booking', label: 'Bookings', icon: CalendarCheck },
  { id: 'on_demand', label: 'On-Demand', icon: Zap },
  { id: 'portfolio', label: 'Portfolio', icon: Star }
];

export const PublicPhotographerGallery = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { photographerId: paramPhotographerId } = useParams();
  
  // Get photographer ID from URL params or query string
  const photographerId = paramPhotographerId || searchParams.get('photographer');
  
  // State
  const [photographer, setPhotographer] = useState(null);
  const [galleries, setGalleries] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [serviceFilter, _setServiceFilter] = useState('all');
  const [_showFilters, _setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [purchasedIds, setPurchasedIds] = useState(new Set());
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState('standard');
  
  // AI Face Match state
  const [showAIMatch, setShowAIMatch] = useState(false);
  const [aiMatchResults, setAIMatchResults] = useState([]);
  const [_aiMatchLoading, setAIMatchLoading] = useState(false);
  
  // New Find Me Selfie Scanner state
  const [scanModalOpen, setScanModalOpen] = useState(false);

  // Theme classes
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

  // Fetch photographer profile
  const fetchPhotographer = useCallback(async () => {
    if (!photographerId) return;
    
    try {
      const res = await apiClient.get(`/profiles/${photographerId}`);
      setPhotographer(res.data);
    } catch (error) {
      logger.error('Failed to fetch photographer:', error);
      toast.error('Photographer not found');
    }
  }, [photographerId]);

  // Fetch photographer's galleries (albums)
  const fetchGalleries = useCallback(async () => {
    if (!photographerId) return;
    
    try {
      const res = await apiClient.get(`/galleries/photographer/${photographerId}`);
      // Only show public galleries
      setGalleries(res.data.filter(g => g.is_public));
    } catch (error) {
      logger.error('Failed to fetch galleries:', error);
    }
  }, [photographerId]);

  // Fetch gallery items
  const fetchItems = useCallback(async () => {
    if (!photographerId) return;
    
    try {
      setLoading(true);
      let url = `/gallery/photographer/${photographerId}?include_in_folders=true&limit=100`;
      if (user?.id) {
        url += `&viewer_id=${user.id}`;
      }
      
      const res = await apiClient.get(url);
      setItems(res.data);
      
      // Track purchased items
      if (user?.id) {
        const purchased = new Set(res.data.filter(i => i.is_purchased).map(i => i.id));
        setPurchasedIds(purchased);
      }
    } catch (error) {
      logger.error('Failed to fetch gallery items:', error);
    } finally {
      setLoading(false);
    }
  }, [photographerId, user?.id]);

  // AI Face Match - Find photos of the current user
  const _runAIFaceMatch = async () => {
    if (!user?.id || !photographerId) {
      toast.error('Please log in to find your photos');
      return;
    }
    
    setAIMatchLoading(true);
    try {
      const res = await apiClient.post(`/ai/face-match`, {
        photographer_id: photographerId,
        surfer_id: user.id
      });
      setAIMatchResults(res.data.matches || []);
      setShowAIMatch(true);
      
      if (res.data.matches?.length > 0) {
        toast.success(`Found ${res.data.matches.length} photos that might be you!`);
      } else {
        toast.info('No matching photos found yet. Check back after your session!');
      }
    } catch (error) {
      logger.error('AI face match failed:', error);
      toast.error('Face matching unavailable');
    } finally {
      setAIMatchLoading(false);
    }
  };

  // Purchase item
  const handlePurchase = async () => {
    if (!user?.id || !selectedItem) {
      toast.error('Please log in to purchase');
      return;
    }
    if (isGrom(user)) {
      toast.info('🤙 Ask your parent to approve this purchase!');
      return;
    }
    
    setPurchaseLoading(true);
    try {
      const _res = await apiClient.post(`/gallery/${selectedItem.id}/purchase`, {
        buyer_id: user.id,
        quality_tier: selectedQuality
      });
      
      toast.success('Purchase successful!');
      setPurchasedIds(prev => new Set([...prev, selectedItem.id]));
      setShowPurchaseModal(false);
      setSelectedItem(null);
      
      // Refresh items to get download URL
      fetchItems();
    } catch (error) {
      logger.error('Purchase failed:', error);
      toast.error(error.response?.data?.detail || 'Purchase failed');
    } finally {
      setPurchaseLoading(false);
    }
  };

  // Filter and sort items
  const filteredItems = items
    .filter(item => {
      // Service type filter
      if (serviceFilter !== 'all') {
        // This would require service_type on items - for now, show all
      }
      
      // Gallery filter
      if (selectedGallery && item.gallery_id !== selectedGallery.id) {
        return false;
      }
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.title?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.spot_name?.toLowerCase().includes(query) ||
          item.tags?.some(t => t.toLowerCase().includes(query))
        );
      }
      
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'oldest':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'price_low':
          return (a.custom_price || a.price) - (b.custom_price || b.price);
        case 'price_high':
          return (b.custom_price || b.price) - (a.custom_price || a.price);
        case 'popular':
          return b.purchase_count - a.purchase_count;
        default:
          return 0;
      }
    });

  useEffect(() => {
    if (photographerId) {
      fetchPhotographer();
      fetchGalleries();
      fetchItems();
    }
  }, [photographerId, fetchPhotographer, fetchGalleries, fetchItems]);

  // Get price for quality tier
  const getQualityPrice = (item, quality) => {
    if (!item) return 5; // Default price if item is null
    
    if (item.media_type === 'video') {
      switch (quality) {
        case '720p': return item.price_720p || item.price || 10;
        case '1080p': return item.price_1080p || (item.price || 10) * 1.5;
        case '4k': return item.price_4k || (item.price || 10) * 2;
        default: return item.price || 10;
      }
    } else {
      switch (quality) {
        case 'web': return item.price_web || (item.price || 5) * 0.5;
        case 'standard': return item.custom_price || item.price || 5;
        case 'high': return item.price_high || (item.price || 5) * 2;
        default: return item.custom_price || item.price || 5;
      }
    }
  };

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
            <Button 
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
                <img 
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
                <p className={`${textSecondary} mb-2`}>@{photographer.username}</p>
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
              <Button 
                onClick={() => navigate(`/profile/${photographerId}`)}
                className="bg-gradient-to-r from-emerald-500 to-yellow-500 text-black font-semibold"
              >
                <CalendarCheck className="w-4 h-4 mr-2" />
                Book Session
              </Button>
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
              <Button 
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
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              <button
                onClick={() => setSelectedGallery(null)}
                className={`flex-shrink-0 px-4 py-2 rounded-full border transition-all ${
                  !selectedGallery 
                    ? pillActive 
                    : pillInactive
                }`}
              >
                All Photos
              </button>
              {galleries.map(gallery => (
                <button
                  key={gallery.id}
                  onClick={() => setSelectedGallery(gallery)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full border transition-all flex items-center gap-2 ${
                    selectedGallery?.id === gallery.id 
                      ? pillActive 
                      : pillInactive
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  {gallery.title}
                  <span className="text-xs opacity-60">({gallery.item_count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
            <Input
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
        {loading ? (
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
      </div>

      {/* Purchase Modal */}
      <Dialog open={showPurchaseModal} onOpenChange={setShowPurchaseModal}>
        <DialogContent className={`${modalBg} max-w-lg`}>
          <DialogHeader>
            <DialogTitle>Purchase Photo</DialogTitle>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4">
              {/* Preview */}
              <div className={`relative aspect-video ${cardItemBg} rounded-lg overflow-hidden`}>
                <img 
                  src={selectedItem.preview_url || selectedItem.thumbnail_url}
                  alt={selectedItem.title || 'Gallery item'}
                  className="w-full h-full object-contain"
                />
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
                    <img src={selectedItem.photographer_avatar} alt="" className="w-full h-full object-cover" />
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
            <Button 
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
                  <img 
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

// Gallery Item Card Component
const GalleryItemCard = ({ item, isPurchased, viewMode, isLight, onClick }) => {
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
          src={item.preview_url || item.original_url}
          className={`
            w-full h-full object-cover transition-transform duration-300
            ${isHovered ? 'scale-105' : 'scale-100'}
          `}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          poster={item.thumbnail_url || undefined}
        />
      ) : (
        <img 
          src={item.thumbnail_url || item.preview_url}
          alt={item.title || 'Gallery item'}
          className={`
            w-full h-full object-cover transition-transform duration-300
            ${isHovered ? 'scale-105' : 'scale-100'}
          `}
          loading="lazy"
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
          <Button size="sm" className="bg-white/20 hover:bg-white/30 text-white">
            <ShoppingCart className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

// Quality Option Component
const QualityOption = ({ label, sublabel, price, selected, onClick, recommended, isLight }) => (
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

export default PublicPhotographerGallery;
