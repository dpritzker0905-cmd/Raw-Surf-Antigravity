import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePricing } from '../contexts/PricingContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import {
  Camera,
  Upload,
  X,
  DollarSign,
  Plus,
  Loader2,
  Image,
  Check,
  Video,
  Play,
  Settings,
  Edit3,
  Sparkles,
  RotateCcw,
  Folder,
  MapPin,
  Calendar,
  Trash2,
  Copy,
  Radio,
  UserPlus,
  Droplet,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Users,
  Send,
  CheckCircle,
  Link2,
  ImagePlus
} from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { toast } from 'sonner';
import { GalleryGrid } from './GalleryGrid';
import WatermarkSettings from './WatermarkSettings';

// Extracted gallery components
import { UploadPhotoModal } from './gallery/UploadPhotoModal';
import { GalleryItemModal } from './gallery/GalleryItemModal';
import { SessionRosterCard } from './gallery/SessionRosterCard';
import { PostSessionSummary } from './gallery/PostSessionSummary';
import { GalleryCard } from './gallery/GalleryCard';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import { getFullUrl } from '../utils/media';
import { TagAssignModal, ThumbnailPickerModal, LinkSessionModal } from './gallery/GalleryModals';

// Extracted gallery folder modals
import { GalleryFolderModals } from './gallery/GalleryFolderModals';
import { GalleryPricingCard } from './gallery/GalleryPricingCard';
import GromHighlightsCard from './gallery/GromHighlightsCard';



import { getErrorMessage } from '../utils/errors';
import usePullToRefresh from '../hooks/usePullToRefresh';
import useGalleryActions from '../hooks/useGalleryActions';
import PullToRefreshIndicator from './ui/PullToRefreshIndicator';
import { GallerySkeleton } from './ui/SkeletonVariants';

export const GalleryPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { 
    generalSettings, 
    updateGeneralSettings, 
    setItemCustomPrice, 
    clearItemCustomPrice,
    getDisplayPrice,
    lastUpdated,
    _refreshPricing 
  } = usePricing();
  
  const [gallery, setGallery] = useState([]);
  const [galleries, setGalleries] = useState([]); // Session galleries / albums
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [galleryItems, setGalleryItems] = useState([]); // Items in selected gallery
  const [galleryItemsLoading, setGalleryItemsLoading] = useState(false);
  const [showAddToGalleryModal, setShowAddToGalleryModal] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState(null);
  const [showGalleryPricingModal, setShowGalleryPricingModal] = useState(false);
  const [pricingCollapsed, setPricingCollapsed] = useState(true); // Collapsed by default on mobile
  const [brokenCoverImages, setBrokenCoverImages] = useState(new Set()); // Track failed cover images
  const [pricingTab, setPricingTab] = useState('gallery'); // 'gallery' | 'live' | 'booking' | 'ondemand'
  const [galleryPricing, setGalleryPricing] = useState({
    // Gallery (general) photo pricing
    photo_price_web: 3, photo_price_standard: 5, photo_price_high: 10,
    // Gallery (general) video pricing
    video_price_720p: 8, video_price_1080p: 15, video_price_4k: 30,
    // Live Session independent pricing
    live_price_web: 3, live_price_standard: 6, live_price_high: 12,
    live_video_720p: 8, live_video_1080p: 15, live_video_4k: 30,
    live_session_photos_included: 3, live_session_videos_included: 0, live_buyin_price: 25,
    // On-Demand independent pricing
    on_demand_price_web: 5, on_demand_price_standard: 10, on_demand_price_high: 18,
    on_demand_video_720p: 12, on_demand_video_1080p: 20, on_demand_video_4k: 40,
    on_demand_photos_included: 3, on_demand_videos_included: 0,
    // Booking independent pricing
    booking_hourly_rate: 50,
    booking_price_web: 3, booking_price_standard: 5, booking_price_high: 10,
    booking_video_720p: 8, booking_video_1080p: 15, booking_video_4k: 30,
    booking_photos_included: 3, booking_videos_included: 0,
    // On-Demand hourly rate
    on_demand_hourly_rate: 75,
    // Booking advanced settings (display-only, managed via /photographer/bookings)
    booking_min_hours: 1, charges_travel_fees: false, service_radius_miles: 25,
    group_discount_2_plus: 0, group_discount_3_plus: 0, group_discount_5_plus: 0,
    // Legacy fields
    on_demand_photo_price: 10, live_session_photo_price: 5
  });
  
  // NEW: Folder management state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showRenameFolderModal, setShowRenameFolderModal] = useState(false);
  const [folderToRename, setFolderToRename] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderActionLoading, setFolderActionLoading] = useState(false);
  
  // Delete folder confirmation modal state
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState(null);
  
  // Delete item confirmation dialog (replaces window.confirm)
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'single'|'bulk', itemId?, count? }
  
  // NEW: Bulk select state
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false);
  const [showCopyToFolderModal, setShowCopyToFolderModal] = useState(false);
  
  // Tag & Assign modal state
  const [showTagAssignModal, setShowTagAssignModal] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [distributeLoading, setDistributeLoading] = useState({});
  const [distributeAllLoading, setDistributeAllLoading] = useState(false);
  const [distributeProgress, setDistributeProgress] = useState(null); // { current, total }
  const [manualSurferSearch, setManualSurferSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Batch tagging state
  const [aiAutoTagLoading, setAiAutoTagLoading] = useState(false);
  const [showBatchTagPicker, setShowBatchTagPicker] = useState(false);
  const [batchTagLoading, setBatchTagLoading] = useState({});
  
  // Thumbnail picker state
  const [showThumbnailPicker, setShowThumbnailPicker] = useState(false);
  const [thumbnailPickerGallery, setThumbnailPickerGallery] = useState(null);
  const [thumbnailPickerItems, setThumbnailPickerItems] = useState([]);
  const [thumbnailPickerLoading, setThumbnailPickerLoading] = useState(false);
  const [settingThumbnail, setSettingThumbnail] = useState(false);
  
  // Link session state
  const [showLinkSessionModal, setShowLinkSessionModal] = useState(false);
  const [linkSessionGallery, setLinkSessionGallery] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [linkingSession, setLinkingSession] = useState(false);
  
  // Push to Spot Hub state
  const [pushingConditions, setPushingConditions] = useState(false);
  const [conditionsStatus, setConditionsStatus] = useState(null); // { has_spot, has_active_report, ... }
  
  // Grom Highlights state (for Grom Parents)
  const [gromHighlights, setGromHighlights] = useState([]);
  const [linkedGroms, setLinkedGroms] = useState([]);
  const [_showTagGromModal, setShowTagGromModal] = useState(false);
  const [_itemToTag, setItemToTag] = useState(null);
  
  // Watermark settings state
  const [showWatermarkSettings, setShowWatermarkSettings] = useState(false);
  const [watermarkPreviewUrl, setWatermarkPreviewUrl] = useState(null);
  const [watermarkSettings, setWatermarkSettings] = useState({
    style: 'text',
    text: '',
    position: 'bottom-right'
  });
  
  const isPhotographer = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(user?.role);
  
  // ROLE-BASED COMMERCE RESTRICTIONS
  // Grom Parent: NO commerce - archive only, zero selling
  // Hobbyist: Can spend but NOT sell
  const userRole = user?.role?.toLowerCase?.() || '';
  const isGromParent = userRole.includes('grom parent') || userRole === 'grom_parent' || userRole.includes('Grom Parent') || user?.is_grom_parent === true;
  const isHobbyist = userRole.includes('hobbyist') || user?.role === ROLES.HOBBYIST || user?.role === 'HOBBYIST';
  const canSellPhotos = isPhotographer && !isGromParent && !isHobbyist;
  const showPricing = canSellPhotos;

  // Sync local state with context when context updates
  useEffect(() => {
    if (generalSettings) {
      setGalleryPricing(prev => ({ ...prev, ...generalSettings }));
    }
  }, [generalSettings, lastUpdated]);

  useEffect(() => {
    if (user?.id) {
      fetchGallery();
      if (isPhotographer) {
        fetchGalleries();
      }
      if (isGromParent) {
        fetchLinkedGroms();
        fetchGromHighlights();
      }
    }
  }, [user?.id, lastUpdated]);

  // Fetch watermark settings and generate preview
  useEffect(() => {
    const fetchWatermarkPreview = async () => {
      if (!user?.id || !canSellPhotos) return;
      
      try {
        // Get watermark settings
        const settingsRes = await apiClient.get(`/photographer/${user.id}/watermark-settings`);
        const settings = settingsRes.data;
        
        setWatermarkSettings({
          style: settings.watermark_style || 'text',
          text: settings.watermark_text || user.business_name || user.full_name || 'Watermark',
          position: settings.watermark_position || 'bottom-right'
        });
        
        // Generate preview with a sample surf image
        const previewRes = await apiClient.post(`/gallery/generate-watermark-preview`, {
          photographer_id: user.id,
          sample_image_url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=400',
          watermark_style: settings.watermark_style || 'text',
          watermark_text: settings.watermark_text || user.business_name || user.full_name || 'Watermark',
          watermark_logo_url: settings.watermark_logo_url,
          watermark_opacity: settings.watermark_opacity || 0.5,
          watermark_position: settings.watermark_position || 'bottom-right'
        });
        
        if (previewRes.data.preview_url) {
          setWatermarkPreviewUrl(previewRes.data.preview_url);
        }
      } catch (error) {
        logger.error('Error fetching watermark preview:', error);
      }
    };
    
    fetchWatermarkPreview();
  }, [user?.id, canSellPhotos, showWatermarkSettings]); // Re-fetch when modal closes

  // Fetch linked Groms for tagging (Grom Parents only)
  // ============ HANDLERS EXTRACTED TO hooks/useGalleryActions.js ============
  const {
    fetchLinkedGroms, fetchGromHighlights, handleTagGrom, handleUntagGrom,
    fetchGalleries, fetchGalleryItems, handleDeleteFromGallery, executeDeleteFromGallery,
    handleAddToGallery, openGalleryDetail, closeGalleryDetail,
    fetchConditionsStatus, handlePushToSpotHub, handleSaveGalleryPricing,
    fetchGallery, handleQuickPriceUpdate, handleClearCustomPrice,
    handleCreateFolder, handleRenameFolder, handleDeleteFolder, confirmDeleteFolder,
    toggleItemSelection, selectAllItems, clearSelection,
    handleMoveToFolder, handleCopyToFolder,
    handleOpenTagAssign, fetchParticipants,
    handleDistributeToSurfer, handleDistributeAll,
    handleAiAutoTag, handleBatchTagToSurfer, handleSearchSurfers,
    handleBulkDelete, handleOpenThumbnailPicker,
    handleSetThumbnail, handleClearThumbnail, handleSetAsCover,
    handleOpenLinkSession, handleLinkSession,
  } = useGalleryActions({
    user, selectedGallery, selectedItems, bulkSelectMode, galleryItems, participants,
    setGallery, setGalleries, setGalleryItems, setGalleryItemsLoading,
    setLinkedGroms, setGromHighlights, setShowTagGromModal, setItemToTag,
    setDeleteConfirm, setDeletingItemId, setShowAddToGalleryModal,
    setSelectedGallery, setConditionsStatus, setPushingConditions,
    setFolderActionLoading, setNewFolderName, setShowCreateFolderModal,
    setFolderToRename, setShowRenameFolderModal,
    setFolderToDelete, setShowDeleteFolderModal,
    setSelectedItems, setBulkSelectMode,
    setShowMoveToFolderModal, setShowCopyToFolderModal,
    setShowTagAssignModal, setParticipantsLoading, setParticipants, setSessionInfo,
    setDistributeLoading, setDistributeAllLoading, setDistributeProgress,
    setManualSurferSearch, setSearchResults, setSearchLoading,
    setAiAutoTagLoading, setBatchTagLoading, setShowBatchTagPicker,
    setShowThumbnailPicker, setThumbnailPickerGallery, setThumbnailPickerItems,
    setThumbnailPickerLoading, setSettingThumbnail,
    setShowLinkSessionModal, setLinkSessionGallery,
    setRecentSessions, setRecentSessionsLoading, setLinkingSession,
    setLoading, updateGeneralSettings, setItemCustomPrice,
    clearItemCustomPrice, setShowGalleryPricingModal,
    newFolderName, folderToRename, folderToDelete, galleryPricing,
  });

  // Pull-to-refresh for mobile - triggers gallery refresh on swipe-down
  const { pullRef: galleryPullRef, isPulling: galleryPulling, pullProgress: galleryPullProgress, isRefreshing: galleryPtrRefreshing } = usePullToRefresh(
    async () => { await fetchGallery(); if (isPhotographer) await fetchGalleries(); },
    { threshold: 60, enabled: !loading }
  );

  if (loading) {
    return (
      <div className="p-4 max-w-6xl mx-auto">
        <GallerySkeleton />
      </div>
    );
  }

  return (
    <div ref={galleryPullRef} className="p-4 max-w-6xl mx-auto" data-testid="gallery-page">
      <PullToRefreshIndicator isPulling={galleryPulling} progress={galleryPullProgress} isRefreshing={galleryPtrRefreshing} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Camera className="w-7 h-7 text-yellow-400" />
            Gallery Hub
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {gallery.length} items {"\u2022"} Manage your sessions, folders & distribution
          </p>
        </div>
        
        {isPhotographer && (
          <Button aria-label="Add"
            onClick={() => setShowUploadModal(true)}
            className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
          >
            <Plus className="w-4 h-4 mr-2" />
            Upload
          </Button>
        )}
      </div>

      {/* Post-Session Summary -- shows for recent galleries when inside a gallery folder */}
      {selectedGallery && (
        <PostSessionSummary
          gallery={selectedGallery}
          participants={participants}
          onDistributeAll={handleDistributeAll}
          onOpenTagAssign={handleOpenTagAssign}
          onAiAutoTag={handleAiAutoTag}
          isDistributing={distributeAllLoading}
          distributeProgress={distributeProgress}
          isAiTagging={aiAutoTagLoading}
        />
      )}

      {/* Gallery Pricing Card - Tabbed Per-Service Pricing */}
      {/* Gallery Pricing Card - Tabbed Per-Service Pricing */}
      {showPricing && (
        <GalleryPricingCard
          pricingCollapsed={pricingCollapsed}
          setPricingCollapsed={setPricingCollapsed}
          pricingTab={pricingTab}
          setPricingTab={setPricingTab}
          galleryPricing={galleryPricing}
          setShowGalleryPricingModal={setShowGalleryPricingModal}
        />
      )}

      {/* Grom Highlights Section - SPECIAL for Grom Parents */}
      {isGromParent && !selectedGallery && (
        <GromHighlightsCard
          gromHighlights={gromHighlights}
          linkedGroms={linkedGroms}
          handleUntagGrom={handleUntagGrom}
        />
      )}

      {/* Session Galleries - Albums/Folders with management */}
      {isPhotographer && !selectedGallery && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Folder className="w-5 h-5 text-cyan-400" />
              {isGromParent ? 'Grom Archive' : 'Folders & Albums'}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">{galleries.length} folders</span>
              <Button aria-label="Add"
                onClick={() => {
                  setNewFolderName('');
                  setShowCreateFolderModal(true);
                }}
                size="sm"
                className="bg-cyan-500 hover:bg-cyan-600 text-black"
                data-testid="create-folder-btn"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Folder
              </Button>
            </div>
          </div>
          
          {galleries.length === 0 ? (
            <div className="text-center py-8 bg-muted/50 rounded-lg">
              <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">No folders yet. Create one to organize your photos & videos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {galleries.map((gal) => (
                <div 
                  key={gal.id}
                  className="bg-card rounded-xl overflow-hidden cursor-pointer active:scale-[0.98] hover:shadow-lg transition-all group relative border border-border"
                  data-testid={`session-gallery-${gal.id}`}
                  onClick={() => openGalleryDetail(gal)}
                >
                  {/* Folder thumbnail */}
                  <div className="aspect-[16/10] relative overflow-hidden">
                    {(() => {
                      // Try cover image first, then fall back to first item preview
                      const coverUrl = (!brokenCoverImages.has(gal.id) && gal.cover_image_url) 
                        ? getFullUrl(gal.cover_image_url) 
                        : null;
                      
                      if (coverUrl) {
                        return (
                          <img loading="lazy" decoding="async" 
                            src={coverUrl} 
                            alt={gal.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                            onError={() => setBrokenCoverImages(prev => new Set([...prev, gal.id]))}
                          />
                        );
                      }
                      
                      // Fallback 2: use first_item_preview from API as real thumbnail
                      if (gal.first_item_preview && !brokenCoverImages.has(`${gal.id}_fallback`)) {
                        return (
                          <img loading="lazy" decoding="async" 
                            src={getFullUrl(gal.first_item_preview)} 
                            alt={gal.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                            onError={() => setBrokenCoverImages(prev => new Set([...prev, `${gal.id}_fallback`]))}
                          />
                        );
                      }
                      
                      // Fallback 3: show item count indicator when gallery has items but images failed
                      if (gal.item_count > 0) {
                        return (
                          <div className="w-full h-full bg-gradient-to-br from-cyan-500/15 via-blue-500/10 to-purple-500/15 flex flex-col items-center justify-center gap-2">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center">
                              <Camera className="w-7 h-7 text-cyan-400" />
                            </div>
                            <span className="text-xs text-muted-foreground font-medium">{gal.item_count} {gal.item_count === 1 ? 'item' : 'items'} inside</span>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="w-full h-full bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-purple-500/10 flex flex-col items-center justify-center gap-2">
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                            <Camera className="w-7 h-7 text-cyan-500/60" />
                          </div>
                          <span className="text-xs text-muted-foreground/60 font-medium">No items yet</span>
                        </div>
                      );
                    })()}
                    {/* Session type badges - Phase 5 integration */}
                    <div className="absolute top-2 left-2 flex gap-1.5">
                      {gal.live_session_id && (
                        <Badge className="bg-emerald-500/90 text-white text-[10px] shadow-sm px-1.5">
                          {"\u{1F7E2}"} Live
                        </Badge>
                      )}
                      {gal.session_type === 'booking' && !gal.live_session_id && (
                        <Badge className="bg-blue-500/90 text-white text-[10px] shadow-sm px-1.5">
                          {"\u{1F4C5}"} Booking
                        </Badge>
                      )}
                      {gal.session_type === 'on_demand' && !gal.live_session_id && (
                        <Badge className="bg-orange-500/90 text-white text-[10px] shadow-sm px-1.5">
                          {"\u26A1"} On-Demand
                        </Badge>
                      )}
                      {gal.session_type === 'manual' && !gal.live_session_id && (
                        <Badge className="bg-zinc-600/90 text-white text-[10px] shadow-sm px-1.5">
                          {"\u{1F4CB}"} Manual
                        </Badge>
                      )}
                    </div>
                    <div className="absolute bottom-2 left-2 flex gap-1.5">
                      <Badge className="bg-black/60 backdrop-blur-sm text-white text-xs">
                        <Image className="w-3 h-3 mr-1" />
                        {gal.item_count || 0}
                      </Badge>
                      {(gal.purchase_count || 0) > 0 && (
                        <Badge className="bg-green-500/80 backdrop-blur-sm text-white text-[10px]">
                          {"\u{1F4B0}"} {gal.purchase_count} sold
                        </Badge>
                      )}
                    </div>
                    {/* Folder actions -- visible on hover (desktop) or always via overflow menu (mobile) */}
                    <div className="absolute top-2 right-2 z-10">
                      <div className="hidden group-hover:flex gap-1">
                        <button aria-label="Image Plus"
                          className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm hover:bg-cyan-500/70 text-white flex items-center justify-center transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenThumbnailPicker(gal);
                          }}
                          title="Change thumbnail"
                          data-testid={`change-thumbnail-${gal.id}`}
                        >
                          <ImagePlus className="w-3.5 h-3.5" />
                        </button>
                        {!gal.live_session_id && (
                          <button aria-label="Link2"
                            className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm hover:bg-purple-500/70 text-white flex items-center justify-center transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenLinkSession(gal);
                            }}
                            title="Link to session"
                            data-testid={`link-session-${gal.id}`}
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button aria-label="Edit3"
                          className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderToRename(gal);
                            setNewFolderName(gal.title);
                            setShowRenameFolderModal(true);
                          }}
                          data-testid={`rename-folder-${gal.id}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button aria-label="Delete"
                          className="h-8 w-8 rounded-full bg-red-500/60 backdrop-blur-sm hover:bg-red-500/80 text-white flex items-center justify-center transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFolder(gal.id, gal.title);
                          }}
                          data-testid={`delete-folder-${gal.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Folder info */}
                  <div className="p-3">
                    <h3 className="text-foreground font-semibold text-sm truncate">{gal.title}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {gal.surf_spot_name && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{gal.surf_spot_name}</span>
                        </span>
                      )}
                      {gal.session_date && (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <Calendar className="w-3 h-3" />
                          {new Date(gal.session_date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Session Roster: Compact surfer delivery tracker */}
                  {gal.session_roster && gal.session_roster.length > 0 && (
                    <SessionRosterCard 
                      roster={gal.session_roster}
                      sessionType={gal.session_type}
                      itemCount={gal.item_count}
                      compact={true}
                      galleryId={gal.id}
                      photographerId={user?.id}
                      onRosterUpdate={fetchGalleries}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gallery Detail View - When a gallery is selected */}
      {selectedGallery && (
        <div className="mb-8">
          {/* Mobile-optimized stacked header */}
          <div className="mb-4">
            {/* Row 1: Back + Title */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={closeGalleryDetail}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-muted hover:bg-muted/80 text-foreground transition-colors flex-shrink-0"
                aria-label="Go back"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-foreground truncate">
                    {selectedGallery.title}
                  </h2>
                  {/* Session type badge */}
                  {selectedGallery.live_session_id && (
                    <Badge className="bg-emerald-500/90 text-white text-[10px] px-1.5 flex-shrink-0">{"\u{1F7E2}"} Live</Badge>
                  )}
                  {selectedGallery.session_type === 'booking' && !selectedGallery.live_session_id && (
                    <Badge className="bg-blue-500/90 text-white text-[10px] px-1.5 flex-shrink-0">{"\u{1F4C5}"} Booking</Badge>
                  )}
                  {selectedGallery.session_type === 'on_demand' && !selectedGallery.live_session_id && (
                    <Badge className="bg-orange-500/90 text-white text-[10px] px-1.5 flex-shrink-0">{"\u26A1"} On-Demand</Badge>
                  )}
                  {selectedGallery.session_type === 'manual' && !selectedGallery.live_session_id && (
                    <Badge className="bg-zinc-600/90 text-white text-[10px] px-1.5 flex-shrink-0">{"\u{1F4CB}"} Manual</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  {selectedGallery.surf_spot_name && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{selectedGallery.surf_spot_name}</span>
                    </span>
                  )}
                  <span className="flex-shrink-0">{galleryItems.length} items</span>
                  {bulkSelectMode && selectedItems.size > 0 && (
                    <Badge className="bg-cyan-500 text-white text-xs">
                      {selectedItems.size} selected
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            
            {/* Row 2: Action buttons -- scrollable on mobile */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {bulkSelectMode ? (
                <>
                  <Button aria-label="Confirm"
                    size="sm"
                    variant="outline"
                    className="border-border text-muted-foreground flex-shrink-0"
                    onClick={() => {
                      setSelectedItems(new Set(galleryItems.map(item => item.id)));
                    }}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    All
                  </Button>
                  <Button aria-label="Folder"
                    size="sm"
                    variant="outline"
                    className="border-border text-muted-foreground flex-shrink-0"
                    onClick={() => setShowMoveToFolderModal(true)}
                    disabled={selectedItems.size === 0}
                  >
                    <Folder className="w-4 h-4 mr-1" />
                    Move
                  </Button>
                  <Button aria-label="Copy"
                    size="sm"
                    variant="outline"
                    className="border-cyan-700 text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0"
                    onClick={() => setShowCopyToFolderModal(true)}
                    disabled={selectedItems.size === 0}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </Button>
                  <Button aria-label="Loader2"
                    size="sm"
                    variant="outline"
                    className="border-cyan-600 text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0"
                    onClick={handleAiAutoTag}
                    disabled={aiAutoTagLoading}
                  >
                    {aiAutoTagLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1" />
                    )}
                    AI Tag
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-600 text-purple-400 hover:bg-purple-500/10 flex-shrink-0"
                    onClick={async () => {
                      if (selectedItems.size === 0) {
                        toast.info('Select items first');
                        return;
                      }
                      await fetchParticipants(selectedGallery.id);
                      setShowTagAssignModal(true);
                    }}
                    disabled={selectedItems.size === 0}
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Tag {selectedItems.size > 0 ? `(${selectedItems.size})` : ''}
                  </Button>
                  <Button aria-label="Delete"
                    size="sm"
                    variant="destructive"
                    className="bg-red-500/20 text-red-400 hover:bg-red-500/30 flex-shrink-0"
                    onClick={handleBulkDelete}
                    disabled={selectedItems.size === 0}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground flex-shrink-0"
                    onClick={clearSelection}
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button aria-label="Add"
                    onClick={() => setShowAddToGalleryModal(true)}
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold flex-shrink-0 shadow-sm"
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Upload
                  </Button>
                  <Button aria-label="Loader2"
                    size="sm"
                    variant="outline"
                    className="border-cyan-600 text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0"
                    onClick={handleAiAutoTag}
                    disabled={aiAutoTagLoading || galleryItems.length === 0}
                  >
                    {aiAutoTagLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1" />
                    )}
                    AI Tag
                  </Button>
                  <Button aria-label="User Plus"
                    size="sm"
                    variant="outline"
                    className="border-purple-600 text-purple-400 hover:bg-purple-500/10 flex-shrink-0"
                    onClick={() => handleOpenTagAssign()}
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Tag & Assign
                  </Button>
                  {/* Link Session button Ã¢â‚¬â€ only for unlinked folders */}
                  {!selectedGallery.live_session_id && (
                    <Button aria-label="Link2"
                      size="sm"
                      variant="outline"
                      className="border-purple-600/50 text-purple-400 hover:bg-purple-500/10 flex-shrink-0"
                      onClick={() => handleOpenLinkSession(selectedGallery)}
                    >
                      <Link2 className="w-4 h-4 mr-1" />
                      Link Session
                    </Button>
                  )}
                  {/* Push to Spot Hub Ã¢â‚¬â€ requires linked surf spot AND live session */}
                  {selectedGallery.surf_spot_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={`flex-shrink-0 ${
                        !selectedGallery.live_session_id
                          ? 'border-zinc-500/30 text-zinc-500 cursor-not-allowed'
                          : conditionsStatus?.has_active_report
                          ? 'border-amber-500/60 text-amber-400 hover:bg-amber-500/10'
                          : 'border-teal-500/60 text-teal-400 hover:bg-teal-500/10'
                      }`}
                      onClick={() => {
                        if (!selectedGallery.live_session_id) {
                          toast.error('Link a live session to this gallery first, then push to Spot Hub.');
                          return;
                        }
                        handlePushToSpotHub();
                      }}
                      disabled={pushingConditions || galleryItems.length === 0 || !selectedGallery.live_session_id}
                      title={!selectedGallery.live_session_id ? 'Link a live session first' : ''}
                      data-testid="push-to-spot-hub-btn"
                    >
                      {pushingConditions ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      ) : (
                        <Radio className="w-4 h-4 mr-1" />
                      )}
                      {conditionsStatus?.has_active_report ? 'Refresh Spot Hub' : 'Push to Spot Hub'}
                    </Button>
                  )}
                  <Button aria-label="Confirm"
                    size="sm"
                    variant="outline"
                    className="border-border text-muted-foreground flex-shrink-0"
                    onClick={() => setBulkSelectMode(true)}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Select
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ Session Roster: Full surfer delivery tracker Ã¢â€â‚¬Ã¢â€â‚¬ */}
          {selectedGallery.session_roster && selectedGallery.session_roster.length > 0 && (
            <div className="mb-4">
              <SessionRosterCard 
                roster={selectedGallery.session_roster}
                sessionType={selectedGallery.session_type}
                itemCount={galleryItems.length}
                compact={false}
                galleryId={selectedGallery.id}
                photographerId={user?.id}
                onRosterUpdate={fetchGalleries}
              />
            </div>
          )}

          {/* Gallery items grid */}
          {galleryItemsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : galleryItems.length === 0 ? (
            <div className="text-center py-12 bg-muted/50 rounded-lg">
              <Camera className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">No items in this gallery yet</p>
              <Button aria-label="Add"
                onClick={() => setShowAddToGalleryModal(true)}
                className="mt-4 bg-cyan-500 hover:bg-cyan-600 text-black"
              >
                <Plus className="w-4 h-4 mr-1" />
                Upload
              </Button>
            </div>
          ) : (
            <GalleryGrid
              items={galleryItems}
              selectedItems={selectedItems}
              bulkSelectMode={bulkSelectMode}
              deletingItemId={deletingItemId}
              onItemSelect={toggleItemSelection}
              onItemClick={(item) => setSelectedItem(item)}
              onItemEdit={(item) => setSelectedItem(item)}
              onItemDelete={handleDeleteFromGallery}
              emptyMessage="No items in gallery"
              theme="dark"
            />
          )}
        </div>
      )}

      {/* All Media section removed Ã¢â‚¬â€ photographers upload into session folders only */}

      {/* Upload Modal */}
      <UploadPhotoModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          // Refresh data so freshly uploaded items appear immediately
          fetchGallery();
          fetchGalleries();
          if (selectedGallery) fetchGalleryItems(selectedGallery.id);
        }}
        onUploaded={() => {
          fetchGallery();
          fetchGalleries();
          if (selectedGallery) fetchGalleryItems(selectedGallery.id);
        }}
        targetFolderId={selectedGallery?.id || null}
        targetFolderName={selectedGallery?.title || null}
        galleries={galleries}
        galleryPricing={galleryPricing}
        selectedGallery={selectedGallery}
      />

      {/* Delete Confirmation Dialog (replaces browser confirm) */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="bg-background border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground py-2">
            {deleteConfirm?.type === 'bulk'
              ? `Delete ${deleteConfirm?.count} selected items? This cannot be undone.`
              : 'Delete this item from the gallery? This cannot be undone.'}
          </p>
          <div className="flex gap-3 justify-end pt-2">
            <Button
              variant="outline"
              className="border-border"
              onClick={() => setDeleteConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => {
                if (deleteConfirm?.type === 'bulk') {
                  executeBulkDelete();
                } else if (deleteConfirm?.itemId) {
                  executeDeleteFromGallery(deleteConfirm.itemId);
                }
                setDeleteConfirm(null);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View/Purchase Modal */}
      {selectedItem && (
        <GalleryItemModal
          item={selectedItem}
          galleryId={selectedGallery?.id}
          onClose={() => setSelectedItem(null)}
          onPurchased={fetchGallery}
          onSetAsCover={selectedGallery ? handleSetAsCover : undefined}
        />
      )}

      {/* Gallery Pricing Modal */}
      {/* Extracted Folder & Pricing Modals */}
      <GalleryFolderModals
        showGalleryPricingModal={showGalleryPricingModal}
        setShowGalleryPricingModal={setShowGalleryPricingModal}
        galleryPricing={galleryPricing}
        setGalleryPricing={setGalleryPricing}
        handleSaveGalleryPricing={handleSaveGalleryPricing}
        showWatermarkSettings={showWatermarkSettings}
        setShowWatermarkSettings={setShowWatermarkSettings}
        watermarkPreviewUrl={watermarkPreviewUrl}
        watermarkSettings={watermarkSettings}
        canSellPhotos={canSellPhotos}
        navigate={navigate}
        showAddToGalleryModal={showAddToGalleryModal}
        setShowAddToGalleryModal={setShowAddToGalleryModal}
        selectedGallery={selectedGallery}
        gallery={gallery}
        galleryItems={galleryItems}
        handleAddToGallery={handleAddToGallery}
        setShowUploadModal={setShowUploadModal}
        showCreateFolderModal={showCreateFolderModal}
        setShowCreateFolderModal={setShowCreateFolderModal}
        showRenameFolderModal={showRenameFolderModal}
        setShowRenameFolderModal={setShowRenameFolderModal}
        showDeleteFolderModal={showDeleteFolderModal}
        setShowDeleteFolderModal={setShowDeleteFolderModal}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        folderToRename={folderToRename}
        folderToDelete={folderToDelete}
        setFolderToDelete={setFolderToDelete}
        folderActionLoading={folderActionLoading}
        handleCreateFolder={handleCreateFolder}
        handleRenameFolder={handleRenameFolder}
        confirmDeleteFolder={confirmDeleteFolder}
        showMoveToFolderModal={showMoveToFolderModal}
        setShowMoveToFolderModal={setShowMoveToFolderModal}
        showCopyToFolderModal={showCopyToFolderModal}
        setShowCopyToFolderModal={setShowCopyToFolderModal}
        galleries={galleries}
        selectedItems={selectedItems}
        handleMoveToFolder={handleMoveToFolder}
        handleCopyToFolder={handleCopyToFolder}
      />

      {/* TAG_ASSIGN modal - extracted */}

      {/* Batch Tag Picker now unified into Tag & Assign modal above */}

      {/* THUMBNAIL modal - extracted */}

      {/* LINK_SESSION modal - extracted */}

      {/* Watermark Settings Modal */}
      <WatermarkSettings
        open={showWatermarkSettings}
        onOpenChange={setShowWatermarkSettings}
        theme="dark"
      />
    </div>
  );
};


export default GalleryPage;
