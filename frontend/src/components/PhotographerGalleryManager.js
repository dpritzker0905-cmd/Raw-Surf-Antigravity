import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { 

  ArrowLeft, Upload, Image as ImageIcon, Video, DollarSign, 
  Settings, Trash2, Eye, Users,
  MapPin, Calendar, Sparkles, Loader2,
  Search, Filter, Check, MoreVertical,
  TrendingUp, ShoppingBag, CheckCircle, Globe, Radio,
} from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {

  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { toast } from 'sonner';
import usePhotographerGalleryActions from '../hooks/usePhotographerGalleryActions';
import { ROLES } from '../constants/roles';
import AssignDrawer from './gallery/AssignDrawerModal';
import LinkSessionModal from './gallery/LinkSessionModal';
import ClientActivityModal from './gallery/ClientActivityModal';
import SalesDashboardModal from './gallery/SalesDashboardModal';
import TaggingAssignModal from './gallery/TaggingAssignModal';
import EditGalleryModal from './gallery/EditGalleryModal';
import GalleryPricingModal from './gallery/GalleryPricingModal';
import ItemPricingModal from './gallery/ItemPricingModal';
import GallerySessionPanel from './gallery/GallerySessionPanel';
import PhotographerLightbox from './gallery/PhotographerLightbox';
import GalleryPricingPanel from './gallery/GalleryPricingPanel';
import { ProStudioManager } from './gallery/ProStudioManager';



export const PhotographerGalleryManager = () => {
  const { galleryId } = useParams();
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  // ROLE-BASED COMMERCE RESTRICTIONS
  // Grom Parent: NO commerce at all - pure archive/family photos
  // Hobbyist: Can browse/buy but NOT sell
  const isGromParent = user?.role === ROLES.GROM_PARENT || user?.role === 'GROM_PARENT';
  const isHobbyist = user?.role === ROLES.HOBBYIST || user?.role === 'HOBBYIST';
  const canSellPhotos = !isGromParent && !isHobbyist; // Only Pro photographers can sell
  const showPricing = canSellPhotos; // Hide all pricing UI for non-sellers
  
  const [gallery, setGallery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTaggingModal, setShowTaggingModal] = useState(false);
  const [showItemPricingModal, setShowItemPricingModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [aiTagSuggestions, setAiTagSuggestions] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  
  // Phase 1: Search, Filter, Sort, Bulk Selection
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [itemCustomPrice, setItemCustomPrice] = useState('');
  const [lightboxItem, setLightboxItem] = useState(null); // Phase 2: Lightbox
  
  // Distribution Panel State
  const [sessionParticipants, setSessionParticipants] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [totalGalleryItems, setTotalGalleryItems] = useState(0);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [distributing, setDistributing] = useState(null); // surfer_id being distributed to
  const [showLinkSessionModal, setShowLinkSessionModal] = useState(false);
  const [recentSessions, setRecentSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showAssignDrawer, setShowAssignDrawer] = useState(false);
  const [assigningItem, setAssigningItem] = useState(null);

  // Phase 3: Sales Intelligence
  const [showSalesDashboard, setShowSalesDashboard] = useState(false);
  const [showClientActivity, setShowClientActivity] = useState(false);
  const [salesData, setSalesData] = useState({ sales: [], stats: {} });
  const [clientsData, setClientsData] = useState({ clients: [], stats: {} });
  const [loadingSales, setLoadingSales] = useState(false);
  const [publishing, setPublishing] = useState(false);
  
  // Push to Spot Hub state
  const [pushingConditions, setPushingConditions] = useState(false);
  const [conditionsStatus, setConditionsStatus] = useState(null);
  
  const [pricing, setPricing] = useState({
    price_web: 3,
    price_standard: 5,
    price_high: 10,
    price_720p: 8,
    price_1080p: 15,
    price_4k: 30
  });
  
  const [editData, setEditData] = useState({
    title: '',
    description: ''
  });

  // Theme classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-900';

  useEffect(() => {
    if (galleryId) {
      fetchGallery();
    }
  }, [galleryId]);

  // Fetch session participants when gallery loads
  useEffect(() => {
    if (gallery && user?.id) {
      fetchSessionParticipants();
    }
  }, [gallery?.id]);

  // ============ HANDLERS EXTRACTED ============


  const {
    fetchGallery,
    fetchConditionsStatus,
    handlePushToSpotHub,
    fetchSessionParticipants,
    fetchRecentSessions,
    handleLinkSession,
    handleDistributeAll,
    handleDistributeToSurfer,
    handleAssignItemToSurfer,
    fetchSalesData,
    fetchClientActivity,
    handleFileUpload,
    handleSavePricing,
    handleSaveEdit,
    handleDeleteGallery,
    handleSetAsCover,
    handleOpenTagging,
    handleAnalyzePhoto,
    toggleTagSelection,
    handleConfirmTags,
    handleToggleSelect,
    handleSelectAll,
    handleDeleteItem,
    handleBulkDelete,
    handleSetCustomPrice,
    openItemPricing,
    filteredItems,
  } = usePhotographerGalleryActions({
    user, gallery, selectedItems, editData, navigate, galleryId, setAiTagSuggestions,
    setAnalyzingPhoto,
    setAssigningItem,
    setBulkMode,
    setClientsData,
    setConditionsStatus,
    setDistributing,
    setEditData,
    setGallery,
    itemCustomPrice,
    setItemCustomPrice,
    lightboxItem,
    setLightboxItem,
    setLoading,
    setLoadingParticipants,
    setLoadingSales,
    setLoadingSessions,
    pricing,
    setPricing,
    setPushingConditions,
    setRecentSessions,
    setSalesData,
    selectedItem,
    setSelectedItem,
    setSelectedItems,
    selectedTags,
    setSelectedTags,
    setSessionInfo,
    setSessionParticipants,
    setShowAssignDrawer,
    setShowEditModal,
    setShowItemPricingModal,
    setShowLinkSessionModal,
    setShowPricingModal,
    setShowTaggingModal,
    setTotalGalleryItems,
    setUploading,
    filterType,
    searchQuery,
    sortBy,
  });

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <p className={textSecondaryClass}>Gallery not found</p>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="photographer-gallery-manager">
      <div className="max-w-4xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button aria-label="Go back"
            variant="ghost"
            onClick={() => navigate('/photographer/sessions')}
            className={textSecondaryClass}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className={`text-2xl font-bold ${textPrimaryClass} font-oswald`} >
              {gallery.title}
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {/* Phase 5: Session type badge */}
              {gallery.session_type && gallery.session_type !== 'manual' && (
                <Badge variant="outline" className={
                  gallery.session_type === 'live' ? 'border-emerald-500/50 text-emerald-400 text-[10px]' :
                  gallery.session_type === 'booking' ? 'border-blue-500/50 text-blue-400 text-[10px]' :
                  gallery.session_type === 'on_demand' ? 'border-orange-500/50 text-orange-400 text-[10px]' :
                  'border-zinc-500/50 text-zinc-400 text-[10px]'
                }>
 {gallery.session_type === 'live' ? '++-+G+-++-+G-+G+G+-+ Live Session' : 
 gallery.session_type === 'booking' ? '++-+G+-++-+G-+G+-+G-+- Booking' : 
 gallery.session_type === 'on_demand' ? '++-+G+-+G+- On-Demand' : gallery.session_type}
                </Badge>
              )}
              {gallery.session_type === 'manual' && (
              <Badge variant="outline" className="border-zinc-600 text-zinc-500 text-[10px]">{String.fromCodePoint(0x270B)} Manual</Badge>
              )}
              {gallery.surf_spot_name && (
                <span className={`text-sm ${textSecondaryClass} flex items-center gap-1`}>
                  <MapPin className="w-3 h-3" /> {gallery.surf_spot_name}
                </span>
              )}
              {gallery.session_date && (
                <span className={`text-sm ${textSecondaryClass} flex items-center gap-1`}>
                  <Calendar className="w-3 h-3" /> {new Date(gallery.session_date).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button aria-label="Settings"
              variant="outline"
              onClick={() => setShowEditModal(true)}
              className={borderClass}
            >
              <Settings className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button
              variant={gallery?.is_public ? 'outline' : 'default'}
              onClick={async () => {
                setPublishing(true);
                try {
                  const willPublish = !gallery?.is_public;
                  await apiClient.post(`/gallery/${galleryId}/publish?photographer_id=${user?.profile_id}`, { is_published: willPublish });
                  setGallery(prev => ({ ...prev, is_public: willPublish, is_featured: willPublish }));
 toast.success(willPublish ? '++-+G+-++-+G-+G+G+-+ Gallery published to your Sessions tab!' : 'Gallery unpublished');
                } catch (err) {
                  toast.error('Failed to publish gallery');
                } finally {
                  setPublishing(false);
                }
              }}
              disabled={publishing}
              className={gallery?.is_public
                ? `${borderClass} text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/10`
                : 'bg-gradient-to-r from-cyan-400 to-blue-500 text-black hover:from-cyan-500 hover:to-blue-600'
              }
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Globe className="w-4 h-4 mr-2" />
              )}
              {gallery?.is_public ? '? Published' : 'Publish Gallery'}
            </Button>
            {showPricing && (
              <Button aria-label="Dollar Sign"
                onClick={() => setShowPricingModal(true)}
                className="bg-gradient-to-r from-green-400 to-emerald-500 text-black"
              >
                <DollarSign className="w-4 h-4 mr-2" />
                Set Pricing
              </Button>
            )}
 {/* Push to Spot Hub ++G+G+-++G++G+-+++G++G+-+ requires linked surf spot AND live session */}
            {gallery?.surf_spot_id && (
              <Button
                variant="outline"
                className={`${
                  !gallery?.live_session_id
                    ? `${borderClass} border-zinc-500/30 text-zinc-500 cursor-not-allowed`
                    : conditionsStatus?.has_active_report
                    ? `${borderClass} border-amber-500/50 text-amber-400 hover:bg-amber-500/10`
                    : `${borderClass} border-teal-500/50 text-teal-400 hover:bg-teal-500/10`
                }`}
                onClick={() => {
                  if (!gallery?.live_session_id) {
                    toast.error('Link a live session to this gallery first, then push to Spot Hub.');
                    return;
                  }
                  handlePushToSpotHub();
                }}
                disabled={pushingConditions || (gallery?.item_count || 0) === 0 || !gallery?.live_session_id}
                title={!gallery?.live_session_id ? 'Link a live session first' : ''}
                data-testid="push-to-spot-hub-pgm-btn"
              >
                {pushingConditions ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Radio className="w-4 h-4 mr-2" />
                )}
                {conditionsStatus?.has_active_report ? 'Refresh Spot Hub' : 'Push to Spot Hub'}
              </Button>
            )}
          </div>
        </div>

        {/* Stats - Show limited stats for Grom Parent/Hobbyist */}
        <div className={`grid ${showPricing ? 'grid-cols-4' : 'grid-cols-2'} gap-4 mb-6`}>
          <Card className={cardBgClass}>
            <CardContent className="p-4 text-center">
              <ImageIcon className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
              <p className={`text-xl font-bold ${textPrimaryClass}`}>{gallery.item_count || 0}</p>
              <p className={`text-xs ${textSecondaryClass}`}>Items</p>
            </CardContent>
          </Card>
          <Card className={cardBgClass}>
            <CardContent className="p-4 text-center">
              <Eye className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
              <p className={`text-xl font-bold ${textPrimaryClass}`}>{gallery.view_count || 0}</p>
              <p className={`text-xs ${textSecondaryClass}`}>Views</p>
            </CardContent>
          </Card>
          {showPricing && (
            <>
              <Card className={`${cardBgClass} cursor-pointer hover:ring-2 hover:ring-cyan-500/30 transition-all`} onClick={() => { setShowSalesDashboard(true); fetchSalesData(); }}>
                <CardContent className="p-4 text-center">
                  <ShoppingBag className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                  <p className={`text-xl font-bold ${textPrimaryClass}`}>{gallery.purchase_count || 0}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>Purchases</p>
                  <p className="text-[10px] text-cyan-400 mt-1">Click for details</p>
                </CardContent>
              </Card>
              <Card className={`${cardBgClass} cursor-pointer hover:ring-2 hover:ring-green-500/30 transition-all`} onClick={() => { setShowClientActivity(true); fetchClientActivity(); }}>
                <CardContent className="p-4 text-center">
                  <TrendingUp className={`w-5 h-5 mx-auto mb-1 text-green-400`} />
                  <p className={`text-xl font-bold text-green-400`}>
                    ${((gallery.purchase_count || 0) * (pricing.price_standard || 5) * 0.8).toFixed(0)}
                  </p>
                  <p className={`text-xs ${textSecondaryClass}`}>Est. Revenue</p>
                  <p className="text-[10px] text-green-400 mt-1">View activity</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* ============ SESSION CONTEXT PANEL ============ */}
        {/* Session Context Panel - Extracted to gallery/GallerySessionPanel.js */}
        <GallerySessionPanel
          sessionInfo={sessionInfo}
          sessionParticipants={sessionParticipants}
          totalGalleryItems={totalGalleryItems}
          loadingParticipants={loadingParticipants}
          distributing={distributing}
          fetchSessionParticipants={fetchSessionParticipants}
          handleDistributeAll={handleDistributeAll}
          handleDistributeToSurfer={handleDistributeToSurfer}
          setShowLinkSessionModal={setShowLinkSessionModal}
          fetchRecentSessions={fetchRecentSessions}
          cardBgClass={cardBgClass}
          textPrimaryClass={textPrimaryClass}
          textSecondaryClass={textSecondaryClass}
          isLight={isLight}
        />


        {/* Current Pricing Summary - Extracted to gallery/GalleryPricingPanel.js */}
        <GalleryPricingPanel
          gallery={gallery}
          galleryId={galleryId}
          pricing={pricing}
          user={user}
          showPricing={showPricing}
          cardBgClass={cardBgClass}
          textPrimaryClass={textPrimaryClass}
          textSecondaryClass={textSecondaryClass}
          setGallery={setGallery}
          fetchSessionParticipants={fetchSessionParticipants}
        />


        {/* Pro Photographer AI Studio Panel */}
        <div className="mb-6">
          <ProStudioManager
            gallery={gallery}
            galleryId={galleryId}
            sessionParticipants={sessionParticipants}
            theme={theme}
          />
        </div>

        {/* Upload Section */}
        <Card className={`mb-6 ${cardBgClass}`}>
          <CardContent className="p-6">
            <label className="block cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              <div className={`border-2 border-dashed rounded-lg p-8 text-center hover:bg-opacity-50 transition-colors ${
                isLight ? 'border-gray-300 hover:bg-gray-50' : 'border-zinc-700 hover:bg-zinc-800/50'
              }`}>
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
                    <p className={textPrimaryClass}>Uploading...</p>
                  </>
                ) : (
                  <>
                    <Upload className={`w-12 h-12 mx-auto mb-4 ${textSecondaryClass}`} />
                    <p className={textPrimaryClass}>Click or drag files to upload</p>
                    <p className={`text-sm ${textSecondaryClass} mt-1`}>
                      Support photos and videos from your session
                    </p>
                  </>
                )}
              </div>
            </label>
          </CardContent>
        </Card>

        {/* Phase 1: Search, Filter, Sort Bar */}
        <div className={`flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondaryClass}`} />
            <Input aria-label="Search by title..."
              placeholder="Search by title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-9 ${inputBgClass} ${textPrimaryClass}`}
            />
          </div>
          
          {/* Filter */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className={`w-[130px] ${inputBgClass} ${textPrimaryClass}`}>
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="photos">Photos Only</SelectItem>
              <SelectItem value="videos">Videos Only</SelectItem>
              <SelectItem value="tagged">Tagged</SelectItem>
              <SelectItem value="untagged">Untagged</SelectItem>
              <SelectItem value="distributed">? Distributed</SelectItem>
              <SelectItem value="undistributed">? Undistributed</SelectItem>
                <SelectItem value="ai_pending">{String.fromCodePoint(0x1F916)} AI Pending</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Sort */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className={`w-[140px] ${inputBgClass} ${textPrimaryClass}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="purchases">Most Purchased</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Bulk Mode Toggle */}
          <Button aria-label="Confirm"
            variant={bulkMode ? "default" : "outline"}
            size="sm"
            onClick={() => { setBulkMode(!bulkMode); setSelectedItems(new Set()); }}
            className={bulkMode ? 'bg-cyan-500 text-black' : borderClass}
          >
            <Check className="w-4 h-4 mr-1" />
            {bulkMode ? 'Done' : 'Select'}
          </Button>
        </div>

        {/* Bulk Actions Bar */}
        {bulkMode && selectedItems.size > 0 && (
          <div className={`flex items-center gap-3 mb-4 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30`}>
            <span className="text-cyan-400 font-medium">{selectedItems.size} selected</span>
            <Button size="sm" variant="ghost" onClick={handleSelectAll} className="text-cyan-400">
              {selectedItems.size === filteredItems.length ? 'Deselect All' : 'Select All'}
            </Button>
            <div className="flex-1" />
            <Button aria-label="Delete" size="sm" variant="destructive" onClick={handleBulkDelete}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete Selected
            </Button>
          </div>
        )}

        {/* Gallery Items Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredItems.map((item) => (
            <Card key={item.id} className={`overflow-hidden ${cardBgClass} group ${bulkMode && selectedItems.has(item.id) ? 'ring-2 ring-cyan-500' : ''}`}>
              <div className="aspect-square relative">
                {/* Bulk selection checkbox */}
                {bulkMode && (
                  <button aria-label="Confirm"
                    onClick={() => handleToggleSelect(item.id)}
                    className={`absolute top-2 left-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                      selectedItems.has(item.id) 
                        ? 'bg-cyan-500 border-cyan-500' 
                        : 'bg-black/50 border-white/50 hover:border-cyan-400'
                    }`}
                  >
                    {selectedItems.has(item.id) && <Check className="w-4 h-4 text-black" />}
                  </button>
                )}
                
                {item.media_type === 'video' ? (
                  <img loading="lazy" decoding="async"
                    src={item.thumbnail_url || item.preview_url}
                    alt={item.title || 'Video thumbnail'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'flex'); }}
                  />
                ) : (
                  <img loading="lazy" decoding="async" 
                    src={item.preview_url || item.thumbnail_url} 
                    alt={item.title || 'Gallery item'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                <Badge className="absolute top-2 right-2 bg-black/70">
                  {item.media_type === 'video' ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                </Badge>

                {/* Phase 4: Distribution status badge */}
                {(() => {
                  const dc = item.distributed_count || 0;
                  const ac = item.ai_suggested_count || 0;
                  const cc = item.confirmed_count || 0;
                  const totalP = sessionParticipants.length || 1;
                  if (dc > 0 && dc >= totalP) {
                    // Green: Distributed to all participants
                    return (
                      <Badge className="absolute top-2 left-2 bg-emerald-500/90 text-black text-[9px] gap-0.5 px-1.5">
                        <CheckCircle className="w-2.5 h-2.5" /> All ({dc})
                      </Badge>
                    );
                  } else if (dc > 0) {
                    // Amber: Partial distribution
                    return (
                      <Badge className="absolute top-2 left-2 bg-amber-500/90 text-black text-[9px] gap-0.5 px-1.5">
                        <Users className="w-2.5 h-2.5" /> {dc}/{totalP}
                      </Badge>
                    );
                  } else if (ac > 0 && cc === 0) {
                    // Purple: AI suggested but not confirmed
                    return (
                      <Badge className="absolute top-2 left-2 bg-purple-500/90 text-white text-[9px] gap-0.5 px-1.5">
                        <Sparkles className="w-2.5 h-2.5" /> AI
                      </Badge>
                    );
                  }
                  return null;
                })()}
                
                {/* Custom price badge */}
                {item.custom_price && (
                  <Badge className="absolute bottom-2 left-2 bg-green-500/90 text-black">
                    ${item.custom_price}
                  </Badge>
                )}

                {/* Cover image indicator */}
                {gallery?.cover_image_url && (item.preview_url === gallery.cover_image_url || item.thumbnail_url === gallery.cover_image_url) && (
                  <Badge className="absolute bottom-2 right-2 bg-cyan-500/90 text-black text-[9px] gap-0.5 px-1.5">
                    <ImageIcon className="w-2.5 h-2.5" /> Cover
                  </Badge>
                )}
                
                {/* Hover overlay with actions */}
                {!bulkMode && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button aria-label="View"
                      size="sm"
                      onClick={() => setLightboxItem(item)}
                      variant="outline"
                      className="border-white/50 text-white hover:bg-white/20"
                    >
                      <Eye className="w-4 h-4 mr-1" /> View
                    </Button>
                    <Button aria-label="Sparkles"
                      size="sm"
                      onClick={() => handleOpenTagging(item)}
                      className="bg-gradient-to-r from-purple-400 to-pink-500 text-black"
                    >
                      <Sparkles className="w-4 h-4 mr-1" />
                      AI Tag
                    </Button>
                  </div>
                )}
              </div>
              <CardContent className="p-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${textSecondaryClass}`}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                  {/* Item actions dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-6 px-2" aria-label="More options">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Phase 3: Unified "Tag & Assign" replaces separate AI Tag + Assign options */}
                      <DropdownMenuItem onClick={() => handleOpenTagging(item)}>
                        <Sparkles className="w-4 h-4 mr-2" /> Tag & Assign
                      </DropdownMenuItem>
                      {showPricing && (
                        <DropdownMenuItem onClick={() => openItemPricing(item)}>
                          <DollarSign className="w-4 h-4 mr-2" /> Set Custom Price
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleSetAsCover(item)}>
                        <ImageIcon className="w-4 h-4 mr-2" /> Set as Cover
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-red-500 focus:text-red-500"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {filteredItems.length === 0 && (
            <div className={`col-span-full text-center py-12 ${textSecondaryClass}`}>
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>{gallery.items?.length ? 'No items match your filters' : 'No items yet. Upload photos and videos from your session!'}</p>
            </div>
          )}
        </div>
      </div>

      {/* ItemPricingModal - Extracted to gallery/ItemPricingModal.js */}
      <ItemPricingModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />

      {/* GalleryPricingModal - Extracted to gallery/GalleryPricingModal.js */}
      <GalleryPricingModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />

      {/* EditGalleryModal - Extracted to gallery/EditGalleryModal.js */}
      <EditGalleryModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />

      {/* TaggingAssignModal - Extracted to gallery/TaggingAssignModal.js */}
      <TaggingAssignModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />

      {/* Phase 2: Lightbox Modal - Extracted to gallery/PhotographerLightbox.js */}
      <PhotographerLightbox
        lightboxItem={lightboxItem}
        setLightboxItem={setLightboxItem}
        filteredItems={filteredItems}
        handleOpenTagging={handleOpenTagging}
      />

      {/* SalesDashboardModal - Extracted to gallery/SalesDashboardModal.js */}
      <SalesDashboardModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />

      {/* ClientActivityModal - Extracted to gallery/ClientActivityModal.js */}
      <ClientActivityModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />
      {/* LinkSessionModal - Extracted to gallery/LinkSessionModal.js */}
      <LinkSessionModal {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />

      {/* AssignDrawer - Extracted to gallery/AssignDrawerModal.js */}
      <AssignDrawer {...{ showPricingModal, setShowPricingModal, showEditModal, setShowEditModal, showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal, showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity, showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer, selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions, selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery, pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice, handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection, handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer, assigningItem, salesData, clientsData, loadingSales, loadingSessions, sessionParticipants, distributing, recentSessions, handleLinkSession, fetchRecentSessions, user, galleryId, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate }} />
    </div>
  );
};

// PricingTierRow extracted to ./gallery/GalleryPricingPanel.js

