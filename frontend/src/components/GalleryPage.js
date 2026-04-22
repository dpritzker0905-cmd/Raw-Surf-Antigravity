import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePricing } from '../contexts/PricingContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { Camera, Upload, X, DollarSign, Eye, ShoppingCart, Plus, Loader2, Image, Check, Lock, Video, Play, Settings, Edit3, Sparkles, RotateCcw, Folder, MapPin, Calendar, Trash2, Copy, Radio, UserPlus, Droplet, ChevronLeft, ChevronDown, ChevronUp, MoreHorizontal, Users, Send, CheckCircle } from 'lucide-react';
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
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import { getFullUrl } from '../utils/media';


import { getErrorMessage } from '../utils/errors';

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
    live_session_photos_included: 3, live_session_videos_included: 0,
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
  const [manualSurferSearch, setManualSurferSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Grom Highlights state (for Grom Parents)
  const [gromHighlights, setGromHighlights] = useState([]);
  const [linkedGroms, setLinkedGroms] = useState([]);
  const [_selectedTagGrom, _setSelectedTagGrom] = useState(null);
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
  const fetchLinkedGroms = async () => {
    try {
      const response = await apiClient.get(`/gallery/linked-groms/${user.id}`);
      setLinkedGroms(response.data.groms || []);
    } catch (error) {
      logger.error('Error fetching linked groms:', error);
      setLinkedGroms([]);
    }
  };

  // Fetch Grom Highlights (Grom Parents only)
  const fetchGromHighlights = async () => {
    try {
      const response = await apiClient.get(`/gallery/grom-highlights/${user.id}`);
      setGromHighlights(response.data.items || []);
    } catch (error) {
      logger.error('Error fetching grom highlights:', error);
      setGromHighlights([]);
    }
  };

  // Tag a Grom in a photo
  const handleTagGrom = async (galleryItemId, gromId) => {
    try {
      await apiClient.post(`/gallery/tag-grom?parent_id=${user.id}`, {
        gallery_item_id: galleryItemId,
        grom_id: gromId
      });
      toast.success('Photo added to Grom Highlights!');
      fetchGromHighlights();
      setShowTagGromModal(false);
      setItemToTag(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to tag Grom'));
    }
  };

  // Remove Grom tag from photo
  const handleUntagGrom = async (galleryItemId, gromId) => {
    try {
      await apiClient.delete(`/gallery/untag-grom/${galleryItemId}/${gromId}?parent_id=${user.id}`);
      toast.success('Photo removed from Grom Highlights');
      fetchGromHighlights();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove tag'));
    }
  };

  const fetchGalleries = async () => {
    try {
      const response = await apiClient.get(`/galleries/photographer/${user.id}`);
      setGalleries(response.data || []);
    } catch (error) {
      logger.error('Error fetching galleries:', error);
      setGalleries([]);
    }
  };

  // Fetch items for a specific gallery
  const fetchGalleryItems = async (galleryId) => {
    setGalleryItemsLoading(true);
    try {
      const response = await apiClient.get(`/galleries/${galleryId}/items?viewer_id=${user.id}`);
      setGalleryItems(response.data || []);
    } catch (error) {
      logger.error('Error fetching gallery items:', error);
      setGalleryItems([]);
    } finally {
      setGalleryItemsLoading(false);
    }
  };

  // Delete item from gallery
  const handleDeleteFromGallery = async (itemId) => {
    if (!selectedGallery) return;
    setDeleteConfirm({ type: 'single', itemId });
  };

  const executeDeleteFromGallery = async (itemId) => {
    setDeletingItemId(itemId);
    try {
      // Try gallery-scoped delete first, fall back to direct item delete
      try {
        await apiClient.delete(`/galleries/${selectedGallery.id}/items/${itemId}?photographer_id=${user.id}`);
      } catch (galleryErr) {
        if (galleryErr.response?.status === 404) {
          await apiClient.delete(`/gallery/item/${itemId}?photographer_id=${user.id}`);
        } else {
          throw galleryErr;
        }
      }
      toast.success('Item deleted');
      fetchGalleryItems(selectedGallery.id);
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete item'));
    } finally {
      setDeletingItemId(null);
    }
  };

  // Add existing photo to gallery
  const handleAddToGallery = async (itemId) => {
    if (!selectedGallery) return;
    
    try {
      await apiClient.post(`/galleries/${selectedGallery.id}/items?photographer_id=${user.id}`, {
        item_id: itemId
      });
      toast.success('Photo added to gallery');
      fetchGalleryItems(selectedGallery.id);
      fetchGalleries();
      setShowAddToGalleryModal(false);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add photo'));
    }
  };

  // Open gallery detail view
  const openGalleryDetail = (gal) => {
    setSelectedGallery(gal);
    fetchGalleryItems(gal.id);
  };

  // Close gallery detail view
  const closeGalleryDetail = () => {
    setSelectedGallery(null);
    setGalleryItems([]);
  };

  const handleSaveGalleryPricing = async () => {
    const result = await updateGeneralSettings(galleryPricing);
    if (result.success) {
      toast.success('Gallery pricing updated! All items without custom prices will update instantly.');
      setShowGalleryPricingModal(false);
      // Refresh gallery to show updated prices
      fetchGallery();
    } else {
      toast.error(result.error || 'Failed to update pricing');
    }
  };

  const fetchGallery = async () => {
    try {
      const response = await apiClient.get(
        `/gallery/photographer/${user.id}?viewer_id=${user.id}`
      );
      setGallery(response.data);
    } catch (error) {
      logger.error('Error fetching gallery:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle quick price update from thumbnail
  const handleQuickPriceUpdate = async (itemId, newPrice) => {
    const result = await setItemCustomPrice(itemId, newPrice);
    if (result.success) {
      toast.success(result.data.has_override ? 'Fixed price set!' : 'Price reset to gallery default');
      fetchGallery();
    } else {
      toast.error(result.error);
    }
  };

  // Handle clearing custom price
  const handleClearCustomPrice = async (itemId) => {
    const result = await clearItemCustomPrice(itemId);
    if (result.success) {
      toast.success('Price reset to gallery default');
      fetchGallery();
    } else {
      toast.error(result.error);
    }
  };

  // NEW: Create folder/gallery
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }
    setFolderActionLoading(true);
    try {
      await apiClient.post(`/galleries?photographer_id=${user.id}`, {
        title: newFolderName.trim(),
        description: ''
      });
      toast.success('Folder created successfully');
      setNewFolderName('');
      setShowCreateFolderModal(false);
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create folder'));
    } finally {
      setFolderActionLoading(false);
    }
  };

  // NEW: Rename folder/gallery
  const handleRenameFolder = async () => {
    if (!folderToRename || !newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }
    setFolderActionLoading(true);
    try {
      await apiClient.put(`/galleries/${folderToRename.id}?photographer_id=${user.id}`, {
        title: newFolderName.trim()
      });
      toast.success('Folder renamed successfully');
      setNewFolderName('');
      setFolderToRename(null);
      setShowRenameFolderModal(false);
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to rename folder'));
    } finally {
      setFolderActionLoading(false);
    }
  };

  // NEW: Delete folder/gallery - opens confirmation modal
  const handleDeleteFolder = (folderId, folderName) => {
    setFolderToDelete({ id: folderId, name: folderName });
    setShowDeleteFolderModal(true);
  };

  // Confirm delete folder action
  const confirmDeleteFolder = async () => {
    if (!folderToDelete) return;
    setFolderActionLoading(true);
    try {
      await apiClient.delete(`/galleries/${folderToDelete.id}?photographer_id=${user.id}`);
      toast.success('Folder deleted successfully');
      if (selectedGallery?.id === folderToDelete.id) {
        closeGalleryDetail();
      }
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete folder'));
    } finally {
      setFolderActionLoading(false);
      setShowDeleteFolderModal(false);
      setFolderToDelete(null);
    }
  };

  // NEW: Toggle item selection for bulk actions
  const toggleItemSelection = (itemId) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  // NEW: Select all items
  const selectAllItems = () => {
    const items = selectedGallery ? galleryItems : gallery;
    setSelectedItems(new Set(items.map(item => item.id)));
  };

  // NEW: Clear selection
  const clearSelection = () => {
    setSelectedItems(new Set());
    setBulkSelectMode(false);
  };

  // NEW: Move selected items to folder
  const handleMoveToFolder = async (targetFolderId) => {
    if (selectedItems.size === 0) {
      toast.error('No items selected');
      return;
    }
    setFolderActionLoading(true);
    try {
      const itemIds = Array.from(selectedItems);
      await Promise.all(itemIds.map(itemId => 
        apiClient.patch(`/gallery/item/${itemId}/move?photographer_id=${user.id}`, {
          target_gallery_id: targetFolderId
        })
      ));
      toast.success(`Moved ${itemIds.length} item${itemIds.length > 1 ? 's' : ''} to folder`);
      setShowMoveToFolderModal(false);
      clearSelection();
      fetchGallery();
      fetchGalleries();
      if (selectedGallery) {
        fetchGalleryItems(selectedGallery.id);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to move items'));
    } finally {
      setFolderActionLoading(false);
    }
  };

  // NEW: Copy selected items to folder (keeps original in main gallery)
  const handleCopyToFolder = async (targetFolderId) => {
    if (selectedItems.size === 0) {
      toast.error('No items selected');
      return;
    }
    setFolderActionLoading(true);
    try {
      const itemIds = Array.from(selectedItems);
      await Promise.all(itemIds.map(itemId => 
        apiClient.post(`/gallery/item/${itemId}/copy?photographer_id=${user.id}`, {
          target_gallery_id: targetFolderId
        })
      ));
      toast.success(`Copied ${itemIds.length} item${itemIds.length > 1 ? 's' : ''} to folder`);
      setShowCopyToFolderModal(false);
      clearSelection();
      fetchGalleries();
      if (selectedGallery) {
        fetchGalleryItems(selectedGallery.id);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to copy items'));
    } finally {
      setFolderActionLoading(false);
    }
  };

  // ============ TAG & ASSIGN HANDLERS ============
  
  // Open Tag & Assign modal and fetch participants
  const handleOpenTagAssign = async () => {
    if (!selectedGallery) {
      toast.error('Please select a gallery folder first');
      return;
    }
    setShowTagAssignModal(true);
    setManualSurferSearch('');
    setSearchResults([]);
    await fetchParticipants(selectedGallery.id);
  };

  // Fetch session participants for the gallery
  const fetchParticipants = async (galleryId) => {
    setParticipantsLoading(true);
    try {
      const response = await apiClient.get(
        `/gallery/${galleryId}/session-participants?photographer_id=${user.id}`
      );
      setParticipants(response.data.participants || []);
      setSessionInfo(response.data.session || null);
    } catch (error) {
      logger.error('Failed to fetch participants:', error);
      setParticipants([]);
      setSessionInfo({ is_linked: false });
    } finally {
      setParticipantsLoading(false);
    }
  };

  // Distribute ALL gallery items to a specific surfer (respects payment tiers)
  const handleDistributeToSurfer = async (surferId, surferName) => {
    if (!selectedGallery) return;
    setDistributeLoading(prev => ({ ...prev, [surferId]: true }));
    try {
      // Find participant to check credits
      const participant = participants.find(p => p.surfer_id === surferId);
      const hasCredits = participant && participant.photos_credit_remaining > 0;
      const accessType = hasCredits ? 'included' : 'pending_selection';
      
      const response = await apiClient.post(
        `/gallery/${selectedGallery.id}/distribute-to-surfer?photographer_id=${user.id}`,
        { surfer_id: surferId, access_type: accessType }
      );
      const count = response.data.items_distributed || 0;
      const skipped = response.data.skipped_count || 0;
      
      if (count > 0) {
        const tierMsg = hasCredits 
          ? `${Math.min(count, participant.photos_credit_remaining)} included (full-res)` 
          : 'as previews';
        toast.success(`✅ Pushed ${count} items to ${surferName}'s Locker ${tierMsg}!`);
      } else if (skipped > 0) {
        toast.info(`All items already in ${surferName}'s Locker`);
      } else {
        toast.info('No items to distribute');
      }
      
      // Refresh participant list to update counts
      await fetchParticipants(selectedGallery.id);
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to distribute to ${surferName}`));
    } finally {
      setDistributeLoading(prev => ({ ...prev, [surferId]: false }));
    }
  };

  // Distribute ALL items to ALL session participants at once
  const handleDistributeAll = async () => {
    if (!selectedGallery || participants.length === 0) return;
    setDistributeAllLoading(true);
    
    try {
      const response = await apiClient.post(
        `/gallery/${selectedGallery.id}/distribute?photographer_id=${user.id}`
      );
      const total = response.data.total_distributed || 0;
      toast.success(`✅ Distributed ${total} locker items to all participants!`);
      
      // Refresh to update counts
      await fetchParticipants(selectedGallery.id);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to distribute to all participants'));
    } finally {
      setDistributeAllLoading(false);
    }
  };

  // Search surfers by name/username for manual assignment
  let searchTimeout = null;
  const handleSearchSurfers = (query) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    searchTimeout = setTimeout(async () => {
      try {
        const response = await apiClient.get(`/profiles/search?q=${encodeURIComponent(query)}&limit=10`);
        // Filter out current user
        const results = (response.data || []).filter(p => p.id !== user.id);
        setSearchResults(results);
      } catch (error) {
        logger.error('Search failed:', error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
  };

  // NEW: Bulk delete selected items
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) {
      toast.error('No items selected');
      return;
    }
    setDeleteConfirm({ type: 'bulk', count: selectedItems.size });
  };

  const executeBulkDelete = async () => {
    setFolderActionLoading(true);
    try {
      const itemIds = Array.from(selectedItems);
      await Promise.all(itemIds.map(itemId => 
        apiClient.delete(`/gallery/item/${itemId}?photographer_id=${user.id}`)
      ));
      toast.success(`Deleted ${itemIds.length} items`);
      clearSelection();
      fetchGallery();
      if (selectedGallery) {
        fetchGalleryItems(selectedGallery.id);
        fetchGalleries();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete items'));
    } finally {
      setFolderActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto" data-testid="gallery-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Camera className="w-7 h-7 text-yellow-400" />
            Gallery Hub
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {gallery.length} items • Manage your sessions, folders & distribution
          </p>
        </div>
        
        {isPhotographer && (
          <Button
            onClick={() => setShowUploadModal(true)}
            className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
          >
            <Plus className="w-4 h-4 mr-2" />
            Upload
          </Button>
        )}
      </div>

      {/* Gallery Pricing Card – Tabbed Per-Service Pricing */}
      {showPricing && (
        <Card className="mb-6 bg-card border-border">
          <CardHeader className="cursor-pointer md:cursor-default" onClick={() => setPricingCollapsed(!pricingCollapsed)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg text-foreground flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                Gallery Pricing
                <button className="md:hidden ml-1 text-muted-foreground">
                  {pricingCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </CardTitle>
              <Button 
                variant="outline" 
                size="sm"
                onClick={(e) => { e.stopPropagation(); setShowGalleryPricingModal(true); }}
                className="border-border"
                data-testid="edit-gallery-pricing-btn"
              >
                <Settings className="w-4 h-4 mr-2" />
                Edit Pricing
              </Button>
            </div>
          </CardHeader>
          <CardContent className={`${pricingCollapsed ? 'hidden md:block' : ''}`}>
            {/* Service Type Tabs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {[
                { key: 'gallery', label: 'Gallery', icon: <Image className="w-3.5 h-3.5" />, color: 'cyan' },
                { key: 'live', label: 'Live Session', icon: <Radio className="w-3.5 h-3.5" />, color: 'red' },
                { key: 'booking', label: 'Booking', icon: <Calendar className="w-3.5 h-3.5" />, color: 'blue' },
                { key: 'ondemand', label: 'On-Demand', icon: <MapPin className="w-3.5 h-3.5" />, color: 'emerald' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setPricingTab?.(tab.key)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    (pricingTab || 'gallery') === tab.key
                      ? `bg-${tab.color}-500/20 text-${tab.color}-400 ring-1 ring-${tab.color}-500/40`
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                  style={(pricingTab || 'gallery') === tab.key ? {
                    background: tab.color === 'cyan' ? 'rgba(6,182,212,0.15)' :
                                tab.color === 'red' ? 'rgba(239,68,68,0.15)' :
                                tab.color === 'blue' ? 'rgba(59,130,246,0.15)' :
                                'rgba(16,185,129,0.15)',
                    color: tab.color === 'cyan' ? '#06b6d4' :
                           tab.color === 'red' ? '#ef4444' :
                           tab.color === 'blue' ? '#3b82f6' :
                           '#10b981',
                    boxShadow: `inset 0 0 0 1px ${tab.color === 'cyan' ? 'rgba(6,182,212,0.4)' :
                                tab.color === 'red' ? 'rgba(239,68,68,0.4)' :
                                tab.color === 'blue' ? 'rgba(59,130,246,0.4)' :
                                'rgba(16,185,129,0.4)'}`
                  } : {}}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* ─── Gallery Tab ─── */}
            {(pricingTab || 'gallery') === 'gallery' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">📷 Photo Pricing</p>
                  <div className="space-y-1.5">
                    {[
                      { label: 'Web (800px)', val: galleryPricing.photo_price_web },
                      { label: 'Standard (1920px)', val: galleryPricing.photo_price_standard },
                      { label: 'High Res (Original)', val: galleryPricing.photo_price_high },
                    ].map(r => (
                      <div key={r.label} className="p-2 rounded bg-muted/50 flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">{r.label}</span>
                        <span className="text-xs font-semibold text-cyan-400">${r.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🎬 Video Pricing</p>
                  <div className="space-y-1.5">
                    {[
                      { label: '720p HD', val: galleryPricing.video_price_720p },
                      { label: '1080p Full HD', val: galleryPricing.video_price_1080p },
                      { label: '4K Ultra HD', val: galleryPricing.video_price_4k },
                    ].map(r => (
                      <div key={r.label} className="p-2 rounded bg-muted/50 flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">{r.label}</span>
                        <span className="text-xs font-semibold text-purple-400">${r.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ─── Live Session Tab ─── */}
            {pricingTab === 'live' && (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">📷 Photo Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Web (800px)', val: galleryPricing.live_price_web },
                        { label: 'Standard (1920px)', val: galleryPricing.live_price_standard },
                        { label: 'High Res (Original)', val: galleryPricing.live_price_high },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-red-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🎬 Video Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: '720p HD', val: galleryPricing.live_video_720p },
                        { label: '1080p Full HD', val: galleryPricing.live_video_1080p },
                        { label: '4K Ultra HD', val: galleryPricing.live_video_4k },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-red-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-2 border-t border-red-500/20">
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Photos Included</p>
                    <p className="text-lg font-bold text-red-400">{galleryPricing.live_session_photos_included}</p>
                  </div>
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Videos Included</p>
                    <p className="text-lg font-bold text-red-400">{galleryPricing.live_session_videos_included}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Booking Tab ─── */}
            {pricingTab === 'booking' && (
              <div>
                <div className="p-2.5 rounded-lg mb-3 flex items-center justify-between" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <span className="text-xs text-muted-foreground">⏱ Hourly Rate</span>
                  <span className="text-sm font-bold text-blue-400">${galleryPricing.booking_hourly_rate}/hr</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">📷 Photo Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Web (800px)', val: galleryPricing.booking_price_web },
                        { label: 'Standard (1920px)', val: galleryPricing.booking_price_standard },
                        { label: 'High Res (Original)', val: galleryPricing.booking_price_high },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-blue-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🎬 Video Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: '720p HD', val: galleryPricing.booking_video_720p },
                        { label: '1080p Full HD', val: galleryPricing.booking_video_1080p },
                        { label: '4K Ultra HD', val: galleryPricing.booking_video_4k },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-blue-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-2 border-t border-blue-500/20">
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(59,130,246,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Photos Included</p>
                    <p className="text-lg font-bold text-blue-400">{galleryPricing.booking_photos_included}</p>
                  </div>
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(59,130,246,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Videos Included</p>
                    <p className="text-lg font-bold text-blue-400">{galleryPricing.booking_videos_included}</p>
                  </div>
                </div>
                {/* Advanced settings summary + deep-link */}
                <div className="mt-3 space-y-2">
                  {/* Quick-glance pills for advanced settings */}
                  <div className="flex flex-wrap gap-1.5">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <span className="text-muted-foreground">⏱ Min Hours:</span>
                      <span className="font-semibold text-blue-400">{galleryPricing.booking_min_hours}h</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: galleryPricing.charges_travel_fees ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.08)', border: `1px solid ${galleryPricing.charges_travel_fees ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.15)'}` }}>
                      <span className="text-muted-foreground">🚗 Travel Fees:</span>
                      <span className={`font-semibold ${galleryPricing.charges_travel_fees ? 'text-amber-400' : 'text-muted-foreground'}`}>
                        {galleryPricing.charges_travel_fees ? 'Enabled' : 'Off'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <span className="text-muted-foreground">📍 Radius:</span>
                      <span className="font-semibold text-blue-400">{galleryPricing.service_radius_miles} mi</span>
                    </div>
                    {(galleryPricing.group_discount_2_plus > 0 || galleryPricing.group_discount_3_plus > 0 || galleryPricing.group_discount_5_plus > 0) && (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                        <span className="text-muted-foreground">👥 Group Discounts:</span>
                        <span className="font-semibold text-emerald-400">Active</span>
                      </div>
                    )}
                  </div>
                  {/* Deep-link to full booking settings */}
                  <button
                    onClick={() => navigate('/photographer/bookings')}
                    className="w-full p-3 rounded-lg flex items-center justify-between group/link transition-all hover:scale-[1.01]"
                    style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))', border: '1px dashed rgba(59,130,246,0.3)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-blue-400" />
                      <div className="text-left">
                        <p className="text-xs font-semibold text-foreground">Configure Advanced Booking Rates</p>
                        <p className="text-[10px] text-muted-foreground">Group discounts, travel surcharges, cancellation policy, deposit %</p>
                      </div>
                    </div>
                    <ChevronDown className="w-4 h-4 text-blue-400 -rotate-90 group-hover/link:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            )}

            {/* ─── On-Demand Tab ─── */}
            {pricingTab === 'ondemand' && (
              <div>
                <div className="p-2.5 rounded-lg mb-3 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <span className="text-xs text-muted-foreground">⚡ Hourly Rate</span>
                  <span className="text-sm font-bold text-emerald-400">${galleryPricing.on_demand_hourly_rate}/hr</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">📷 Photo Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Web (800px)', val: galleryPricing.on_demand_price_web },
                        { label: 'Standard (1920px)', val: galleryPricing.on_demand_price_standard },
                        { label: 'High Res (Original)', val: galleryPricing.on_demand_price_high },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-emerald-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🎬 Video Pricing</p>
                    <div className="space-y-1.5">
                      {[
                        { label: '720p HD', val: galleryPricing.on_demand_video_720p },
                        { label: '1080p Full HD', val: galleryPricing.on_demand_video_1080p },
                        { label: '4K Ultra HD', val: galleryPricing.on_demand_video_4k },
                      ].map(r => (
                        <div key={r.label} className="p-2 rounded flex justify-between items-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                          <span className="text-xs text-muted-foreground">{r.label}</span>
                          <span className="text-xs font-semibold text-emerald-400">${r.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-2 border-t border-emerald-500/20">
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Photos Included</p>
                    <p className="text-lg font-bold text-emerald-400">{galleryPricing.on_demand_photos_included}</p>
                  </div>
                  <div className="p-2 rounded flex-1 text-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <p className="text-[10px] text-muted-foreground uppercase">Videos Included</p>
                    <p className="text-lg font-bold text-emerald-400">{galleryPricing.on_demand_videos_included}</p>
                  </div>
                </div>
                {/* Advanced settings deep-link */}
                <button
                  onClick={() => navigate('/photographer/bookings')}
                  className="w-full mt-3 p-3 rounded-lg flex items-center justify-between group/link transition-all hover:scale-[1.01]"
                  style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(6,182,212,0.08))', border: '1px dashed rgba(16,185,129,0.3)' }}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-400" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-foreground">Advanced On-Demand Settings</p>
                      <p className="text-[10px] text-muted-foreground">Service radius, peak pricing, availability zone</p>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-emerald-400 -rotate-90 group-hover/link:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grom Highlights Section - SPECIAL for Grom Parents */}
      {isGromParent && !selectedGallery && (
        <Card className="mb-6 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-cyan-500 dark:text-cyan-400 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Grom Highlights
              {gromHighlights.length > 0 && (
                <Badge variant="secondary" className="ml-2 bg-cyan-500/20 text-cyan-500 dark:text-cyan-400">
                  {gromHighlights.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-4">
              Tag photos to share them to your Grom's profile. They'll appear here and on their profile.
            </p>
            
            {/* Linked Groms Pills */}
            {linkedGroms.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {linkedGroms.map((grom) => (
                  <div key={grom.id} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full text-sm">
                    {grom.avatar ? (
                      <img src={grom.avatar} alt={grom.name} className="w-5 h-5 rounded-full" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center text-xs text-black font-bold">
                        {grom.name?.charAt(0) || 'G'}
                      </div>
                    )}
                    <span className="text-foreground">{grom.name}</span>
                    {grom.is_approved && (
                      <Check className="w-3 h-3 text-green-400" />
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {/* Highlights Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {gromHighlights.map((item) => (
                <div 
                  key={item.id} 
                  className="relative aspect-square rounded-lg overflow-hidden group"
                >
                  {item.media_type === 'video' ? (
                    <video 
                      src={getFullUrl(item.preview_url)} 
                      className="w-full h-full object-cover"
                      muted
                      loop
                      playsInline
                      autoPlay
                      preload="metadata"
                    />
                  ) : (
                    <img 
                      src={getFullUrl(item.thumbnail_url || item.preview_url)} 
                      alt={item.title || 'Grom photo'} 
                      className="w-full h-full object-cover"
                    />
                  )}
                  
                  {/* Overlay with remove button */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      onClick={() => handleUntagGrom(item.id, item.grom_id)}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Remove
                    </Button>
                  </div>
                  
                  {/* Media type badge */}
                  {item.media_type === 'video' && (
                    <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1.5 py-0.5">
                      <Play className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              ))}
              
              {/* Add photo placeholder */}
              <div 
                className="aspect-square bg-muted/50 rounded-lg flex items-center justify-center border-2 border-dashed border-cyan-500/30 cursor-pointer hover:border-cyan-500/60 transition-colors"
                onClick={() => {
                  if (linkedGroms.length === 0) {
                    toast.error('No linked Groms found. Link a Grom first.');
                    return;
                  }
                  toast.info('Select a photo below and use the "Tag Grom" button to add it here.');
                }}
              >
                <div className="text-center p-3">
                  <Plus className="w-6 h-6 text-cyan-500 mx-auto mb-1" />
                  <span className="text-xs text-muted-foreground">Tag a photo</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
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
              <Button
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
                          <img 
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
                          <img 
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
                    {/* Session type badges — Phase 5 integration */}
                    <div className="absolute top-2 left-2 flex gap-1.5">
                      {gal.live_session_id && (
                        <Badge className="bg-emerald-500/90 text-white text-[10px] shadow-sm px-1.5">
                          🟢 Live
                        </Badge>
                      )}
                      {gal.session_type === 'booking' && !gal.live_session_id && (
                        <Badge className="bg-blue-500/90 text-white text-[10px] shadow-sm px-1.5">
                          📅 Booking
                        </Badge>
                      )}
                      {gal.session_type === 'on_demand' && !gal.live_session_id && (
                        <Badge className="bg-orange-500/90 text-white text-[10px] shadow-sm px-1.5">
                          ⚡ On-Demand
                        </Badge>
                      )}
                      {gal.session_type === 'manual' && !gal.live_session_id && (
                        <Badge className="bg-zinc-600/90 text-white text-[10px] shadow-sm px-1.5">
                          📋 Manual
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
                          💰 {gal.purchase_count} sold
                        </Badge>
                      )}
                    </div>
                    {/* Folder actions — visible on hover (desktop) or always via overflow menu (mobile) */}
                    <div className="absolute top-2 right-2 z-10">
                      <div className="hidden group-hover:flex gap-1">
                        <button
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
                        <button
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
                    <Badge className="bg-emerald-500/90 text-white text-[10px] px-1.5 flex-shrink-0">🟢 Live</Badge>
                  )}
                  {selectedGallery.session_type === 'booking' && !selectedGallery.live_session_id && (
                    <Badge className="bg-blue-500/90 text-white text-[10px] px-1.5 flex-shrink-0">📅 Booking</Badge>
                  )}
                  {selectedGallery.session_type === 'on_demand' && !selectedGallery.live_session_id && (
                    <Badge className="bg-orange-500/90 text-white text-[10px] px-1.5 flex-shrink-0">⚡ On-Demand</Badge>
                  )}
                  {selectedGallery.session_type === 'manual' && !selectedGallery.live_session_id && (
                    <Badge className="bg-zinc-600/90 text-white text-[10px] px-1.5 flex-shrink-0">📋 Manual</Badge>
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
            
            {/* Row 2: Action buttons — scrollable on mobile */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {bulkSelectMode ? (
                <>
                  <Button
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
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border text-muted-foreground flex-shrink-0"
                    onClick={() => setShowMoveToFolderModal(true)}
                    disabled={selectedItems.size === 0}
                  >
                    <Folder className="w-4 h-4 mr-1" />
                    Move
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-cyan-700 text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0"
                    onClick={() => setShowCopyToFolderModal(true)}
                    disabled={selectedItems.size === 0}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </Button>
                  <Button
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
                  <Button
                    onClick={() => setShowAddToGalleryModal(true)}
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold flex-shrink-0 shadow-sm"
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Upload
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-600 text-purple-400 hover:bg-purple-500/10 flex-shrink-0"
                    onClick={() => handleOpenTagAssign()}
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    Tag & Assign
                  </Button>
                  <Button
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

          {/* ── Session Roster: Full surfer delivery tracker ── */}
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
              <Button
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

      {/* Individual Photos Header with Bulk Actions */}
      {isPhotographer && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Image className="w-5 h-5 text-yellow-400" />
              All Media
              {bulkSelectMode && selectedItems.size > 0 && (
                <Badge className="bg-cyan-500 text-white text-xs ml-2">
                  {selectedItems.size} selected
                </Badge>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {bulkSelectMode ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-muted-foreground flex-shrink-0"
                  onClick={selectAllItems}
                >
                  <Check className="w-4 h-4 mr-1" />
                  All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-muted-foreground flex-shrink-0"
                  onClick={() => setShowMoveToFolderModal(true)}
                  disabled={selectedItems.size === 0}
                >
                  <Folder className="w-4 h-4 mr-1" />
                  Move
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-cyan-700 text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0"
                  onClick={() => setShowCopyToFolderModal(true)}
                  disabled={selectedItems.size === 0}
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copy
                </Button>
                <Button
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
              <Button
                size="sm"
                variant="outline"
                className="border-border text-muted-foreground flex-shrink-0"
                onClick={() => setBulkSelectMode(true)}
                data-testid="bulk-select-btn"
              >
                <Check className="w-4 h-4 mr-1" />
                Select
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Gallery Grid */}
      {gallery.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-xl border border-border">
          <Camera className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-foreground mb-2">No photos or videos yet</h3>
          <p className="text-muted-foreground mb-4">
            Start uploading your surf photos & videos to sell them to surfers!
          </p>
          {isPhotographer && (
            <Button
              onClick={() => setShowUploadModal(true)}
              className="bg-yellow-400 text-black font-bold"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Your First Media
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {gallery.map((item) => (
            <div key={item.id} className="relative">
              {/* Selection checkbox overlay when in bulk mode */}
              {bulkSelectMode && (
                <button
                  onClick={() => toggleItemSelection(item.id)}
                  className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selectedItems.has(item.id)
                      ? 'bg-cyan-500 border-cyan-500'
                      : 'bg-black/50 border-white/50 hover:border-white'
                  }`}
                  data-testid={`select-item-${item.id}`}
                >
                  {selectedItems.has(item.id) && <Check className="w-4 h-4 text-white" />}
                </button>
              )}
              <GalleryCard
                item={item}
                onClick={() => bulkSelectMode ? toggleItemSelection(item.id) : setSelectedItem(item)}
                isOwner={isPhotographer}
                isGromParent={isGromParent}
                linkedGroms={linkedGroms}
                onTagGrom={handleTagGrom}
                onSetCustomPrice={handleQuickPriceUpdate}
                onClearCustomPrice={handleClearCustomPrice}
                getDisplayPrice={getDisplayPrice}
              />
            </div>
          ))}
        </div>
      )}

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
        />
      )}

      {/* Gallery Pricing Modal */}
      <Dialog open={showGalleryPricingModal} onOpenChange={setShowGalleryPricingModal}>
        <DialogContent className="bg-background border-border text-foreground max-h-[90vh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Gallery Pricing — All Service Types</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Each service type has <strong>independent</strong> resolution pricing. Changes here update your photographer profile defaults.
            </p>

            {/* ─── GALLERY (General) ─── */}
            <div className="p-4 rounded-lg bg-card border border-border">
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <Image className="w-4 h-4 text-cyan-400" /> Gallery — General Pricing
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">📷 Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'photo_price_web' },
                    { label: 'Standard (1920px)', field: 'photo_price_standard' },
                    { label: 'High Res', field: 'photo_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">🎬 Videos</p>
                  {[
                    { label: '720p HD', field: 'video_price_720p' },
                    { label: '1080p Full HD', field: 'video_price_1080p' },
                    { label: '4K Ultra HD', field: 'video_price_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ─── LIVE SESSION ─── */}
            <div className="p-4 rounded-lg border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <Radio className="w-4 h-4 text-red-400" /> Live Session Pricing
              </h4>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">📷 Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'live_price_web' },
                    { label: 'Standard (1920px)', field: 'live_price_standard' },
                    { label: 'High Res', field: 'live_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">🎬 Videos</p>
                  {[
                    { label: '720p HD', field: 'live_video_720p' },
                    { label: '1080p Full HD', field: 'live_video_1080p' },
                    { label: '4K Ultra HD', field: 'live_video_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
                <div>
                  <Label className="text-muted-foreground text-xs">Photos Included in Buy-In</Label>
                  <Input type="number" min="0" value={galleryPricing.live_session_photos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, live_session_photos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Videos Included in Buy-In</Label>
                  <Input type="number" min="0" value={galleryPricing.live_session_videos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, live_session_videos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
              </div>
            </div>

            {/* ─── ON-DEMAND ─── */}
            <div className="p-4 rounded-lg border" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-emerald-400" /> On-Demand Pricing
              </h4>
              <div className="mb-3">
                <Label className="text-muted-foreground text-xs">Hourly Rate ($)</Label>
                <Input type="number" value={galleryPricing.on_demand_hourly_rate} onChange={(e) => setGalleryPricing({ ...galleryPricing, on_demand_hourly_rate: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-28" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">📷 Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'on_demand_price_web' },
                    { label: 'Standard (1920px)', field: 'on_demand_price_standard' },
                    { label: 'High Res', field: 'on_demand_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">🎬 Videos</p>
                  {[
                    { label: '720p HD', field: 'on_demand_video_720p' },
                    { label: '1080p Full HD', field: 'on_demand_video_1080p' },
                    { label: '4K Ultra HD', field: 'on_demand_video_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(16,185,129,0.2)' }}>
                <div>
                  <Label className="text-muted-foreground text-xs">Photos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.on_demand_photos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, on_demand_photos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Videos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.on_demand_videos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, on_demand_videos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
              </div>
            </div>

            {/* ─── BOOKING ─── */}
            <div className="p-4 rounded-lg border" style={{ background: 'rgba(59,130,246,0.05)', borderColor: 'rgba(59,130,246,0.2)' }}>
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-blue-400" /> Booking Pricing
              </h4>
              <div className="mb-3">
                <Label className="text-muted-foreground text-xs">Hourly Rate ($)</Label>
                <Input type="number" value={galleryPricing.booking_hourly_rate} onChange={(e) => setGalleryPricing({ ...galleryPricing, booking_hourly_rate: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-28" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">📷 Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'booking_price_web' },
                    { label: 'Standard (1920px)', field: 'booking_price_standard' },
                    { label: 'High Res', field: 'booking_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">🎬 Videos</p>
                  {[
                    { label: '720p HD', field: 'booking_video_720p' },
                    { label: '1080p Full HD', field: 'booking_video_1080p' },
                    { label: '4K Ultra HD', field: 'booking_video_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(59,130,246,0.2)' }}>
                <div>
                  <Label className="text-muted-foreground text-xs">Photos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.booking_photos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, booking_photos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Videos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.booking_videos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, booking_videos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
              </div>
            </div>

            {/* Watermark Settings */}
            <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Droplet className="w-4 h-4 text-cyan-400" />
                  <h4 className="font-medium text-foreground text-sm">Watermark Settings</h4>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowWatermarkSettings(true)} className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10" data-testid="pricing-modal-watermark-btn">
                  <Settings className="w-3 h-3 mr-1" /> Configure
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-24 h-16 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-cyan-500/50 transition-all bg-background" onClick={() => setShowWatermarkSettings(true)} data-testid="pricing-watermark-preview">
                  {watermarkPreviewUrl ? (
                    <img src={watermarkPreviewUrl} alt="Watermark preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Droplet className="w-6 h-6 text-cyan-400/30" />
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground">Style: <span className="text-foreground">{watermarkSettings.style === 'text' ? 'Text' : watermarkSettings.style === 'logo' ? 'Logo' : 'Logo + Text'}</span></p>
                  <p className="text-muted-foreground">Position: <span className="text-foreground capitalize">{watermarkSettings.position.replace('-', ' ')}</span></p>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-green-500/10">
              <p className="text-sm text-muted-foreground">
                <strong className="text-green-400">Platform fee:</strong> 20% is deducted from each sale. You receive 80% of all gallery purchases.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGalleryPricingModal(false)} className="border-border">
              Cancel
            </Button>
            <Button
              onClick={handleSaveGalleryPricing}
              className="bg-gradient-to-r from-purple-400 to-pink-500 text-black"
            >
              Save All Pricing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Add Photo to Gallery Modal — Upload New + Pick from Library */}
      <Dialog open={showAddToGalleryModal} onOpenChange={setShowAddToGalleryModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Plus className="w-5 h-5 text-cyan-400" />
              Add Media to {selectedGallery?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Upload New — Primary CTA */}
            <button
              onClick={() => {
                setShowAddToGalleryModal(false);
                setShowUploadModal(true);
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-dashed border-yellow-400/40 hover:border-yellow-400 bg-yellow-400/5 hover:bg-yellow-400/10 transition-all group"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-yellow-400 to-orange-400 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <Upload className="w-5 h-5 text-black" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">Upload from Device</p>
                <p className="text-xs text-muted-foreground">Camera roll, files, or take a new photo/video</p>
              </div>
            </button>

            {/* Divider */}
            {gallery.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">or pick from library</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            
            {gallery.length === 0 ? (
              <div className="text-center py-6 bg-muted/50 rounded-lg">
                <Camera className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Your library is empty — upload your first photo above!</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto rounded-lg">
                {gallery.filter(item => !galleryItems.find(gi => gi.id === item.id)).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleAddToGallery(item.id)}
                    className="relative aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-cyan-400 transition-all"
                  >
                    <img
                      src={getFullUrl(item.thumbnail_url || item.preview_url)}
                      alt={item.title || 'Photo'}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center">
                      <Plus className="w-6 h-6 text-white opacity-0 hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddToGalleryModal(false)} className="border-border">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Modal */}
      <Dialog open={showCreateFolderModal} onOpenChange={setShowCreateFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Folder className="w-5 h-5 text-cyan-400" />
              Create New Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-muted-foreground">Folder Name</Label>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g., Pipeline Session 2024"
              className="bg-card text-foreground border-border mt-2"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFolderModal(false)} className="border-border">
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={folderActionLoading || !newFolderName.trim()}
              className="bg-cyan-500 hover:bg-cyan-600 text-black"
            >
              {folderActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Modal */}
      <Dialog open={showRenameFolderModal} onOpenChange={setShowRenameFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-yellow-400" />
              Rename Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-muted-foreground">New Folder Name</Label>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter new name"
              className="bg-card text-foreground border-border mt-2"
              onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameFolderModal(false)} className="border-border">
              Cancel
            </Button>
            <Button
              onClick={handleRenameFolder}
              disabled={folderActionLoading || !newFolderName.trim()}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {folderActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation Modal */}
      <Dialog open={showDeleteFolderModal} onOpenChange={setShowDeleteFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Delete Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-foreground">
              Are you sure you want to delete <span className="font-semibold">"{folderToDelete?.name}"</span>?
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              Photos will be moved back to your main gallery.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteFolderModal(false);
                setFolderToDelete(null);
              }} 
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteFolder}
              disabled={folderActionLoading}
              className="bg-red-500 hover:bg-red-600 text-white"
              data-testid="confirm-delete-folder"
            >
              {folderActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Modal */}
      <Dialog open={showMoveToFolderModal} onOpenChange={setShowMoveToFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Folder className="w-5 h-5 text-cyan-400" />
              Move {selectedItems.size} item(s) to folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            {galleries.length === 0 ? (
              <div className="text-center py-8 bg-muted/50 rounded-lg">
                <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No folders yet</p>
                <Button
                  onClick={() => {
                    setShowMoveToFolderModal(false);
                    setShowCreateFolderModal(true);
                  }}
                  className="mt-3 bg-cyan-500 hover:bg-cyan-600 text-black"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Folder First
                </Button>
              </div>
            ) : (
              galleries.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => handleMoveToFolder(folder.id)}
                  disabled={folderActionLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-muted transition-colors text-left border border-border"
                >
                  <Folder className="w-5 h-5 text-cyan-400" />
                  <div className="flex-1">
                    <p className="text-foreground font-medium">{folder.title}</p>
                    <p className="text-muted-foreground text-xs">{folder.item_count || 0} photos</p>
                  </div>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveToFolderModal(false)} className="border-border">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy to Folder Modal */}
      <Dialog open={showCopyToFolderModal} onOpenChange={setShowCopyToFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Copy className="w-5 h-5 text-cyan-400" />
              Copy {selectedItems.size} item(s) to folder
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">Original photos will remain in your main gallery.</p>
          <div className="py-4 space-y-2">
            {galleries.length === 0 ? (
              <div className="text-center py-8 bg-muted/50 rounded-lg">
                <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No folders yet</p>
                <Button
                  onClick={() => {
                    setShowCopyToFolderModal(false);
                    setShowCreateFolderModal(true);
                  }}
                  className="mt-3 bg-cyan-500 hover:bg-cyan-600 text-black"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Folder First
                </Button>
              </div>
            ) : (
              galleries.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => handleCopyToFolder(folder.id)}
                  disabled={folderActionLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-muted transition-colors text-left border border-border"
                >
                  <Folder className="w-5 h-5 text-cyan-400" />
                  <div className="flex-1">
                    <p className="text-foreground font-medium">{folder.title}</p>
                    <p className="text-muted-foreground text-xs">{folder.item_count || 0} photos</p>
                  </div>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCopyToFolderModal(false)} className="border-border">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ TAG & ASSIGN MODAL ============ */}
      <Dialog open={showTagAssignModal} onOpenChange={setShowTagAssignModal}>
        <DialogContent className="max-w-lg bg-background border-border max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              Tag & Assign — {selectedGallery?.title || 'Gallery'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Session Info Banner */}
            {sessionInfo && (
              <div className={`p-3 rounded-lg border ${
                sessionInfo.is_linked
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-amber-500/10 border-amber-500/30'
              }`}>
                <div className="flex items-center gap-2 text-sm">
                  {sessionInfo.is_linked ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">
                        Session linked — {sessionInfo.session_type === 'live' || sessionInfo.live_session_id ? '🟢 Live Session' 
                          : sessionInfo.session_type === 'booking' ? '📅 Booking' 
                          : sessionInfo.session_type === 'on_demand' ? '⚡ On-Demand' : '📋 Manual'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Radio className="w-4 h-4 text-amber-400" />
                      <span className="text-amber-400 font-medium">No session linked — use manual assignment below</span>
                    </>
                  )}
                </div>
                {sessionInfo.session_date && (
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    {new Date(sessionInfo.session_date).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}

            {/* Session Participants Section */}
            {participantsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                <span className="ml-2 text-muted-foreground text-sm">Loading participants...</span>
              </div>
            ) : participants.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-400" />
                    Session Participants ({participants.length})
                  </h3>
                </div>
                
                {participants.map((p) => {
                  const isFullyDistributed = p.items_distributed >= galleryItems.length && galleryItems.length > 0;
                  const isLoading = distributeLoading[p.surfer_id];
                  const hasCredits = p.photos_credit_remaining > 0;
                  return (
                    <div
                      key={p.surfer_id}
                      className={`p-3 rounded-lg border transition-all ${
                        isFullyDistributed
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-muted/30 border-border/50 hover:border-purple-500/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        {p.avatar_url || p.selfie_url ? (
                          <img
                            src={getFullUrl(p.selfie_url || p.avatar_url)}
                            alt={p.full_name}
                            className="w-10 h-10 rounded-full object-cover border-2 border-border"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm">
                            {(p.full_name || p.username || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        
                        {/* Name + payment info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {p.full_name || p.username || 'Unknown'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ${p.amount_paid || 0} paid via {p.payment_method || 'credits'}
                          </p>
                        </div>
                        
                        {/* Action button */}
                        {isFullyDistributed ? (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" /> Delivered
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            className="bg-purple-500 hover:bg-purple-600 text-white text-xs h-8"
                            onClick={() => handleDistributeToSurfer(p.surfer_id, p.full_name || p.username)}
                            disabled={isLoading || galleryItems.length === 0}
                          >
                            {isLoading ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Send className="w-3 h-3 mr-1" />
                                Push to Locker
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      
                      {/* Delivery details row */}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {hasCredits && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            🎟️ {p.photos_credit_remaining} included (full-res)
                          </span>
                        )}
                        {p.items_distributed > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            📤 {p.items_distributed}/{galleryItems.length} sent
                          </span>
                        )}
                        {p.resolution_preference && p.resolution_preference !== 'standard' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            📐 {p.resolution_preference}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {/* Batch action for all participants */}
                {participants.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-emerald-600 text-emerald-400 hover:bg-emerald-500/10 text-xs h-8 mt-1"
                    onClick={handleDistributeAll}
                    disabled={distributeAllLoading || galleryItems.length === 0}
                  >
                    {distributeAllLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Send className="w-3 h-3 mr-1" />
                    )}
                    Push All {galleryItems.length} Items to All {participants.length} Participants
                  </Button>
                )}
              </div>
            ) : sessionInfo && !sessionInfo.is_linked ? null : (
              <div className="text-center py-6">
                <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No session participants found</p>
                <p className="text-xs text-muted-foreground mt-1">Use manual assignment below to send items to any surfer</p>
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or assign manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Manual Surfer Search */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-400" />
                Manual Assignment
              </h3>
              <div className="relative">
                <Input
                  placeholder="Search surfer by name or username..."
                  value={manualSurferSearch}
                  onChange={(e) => {
                    setManualSurferSearch(e.target.value);
                    handleSearchSurfers(e.target.value);
                  }}
                  className="bg-muted border-border text-foreground"
                />
                {searchLoading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              
              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {searchResults.map((surfer) => (
                    <div
                      key={surfer.id}
                      className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 border border-border/50 hover:border-amber-500/50 transition-all"
                    >
                      {surfer.avatar_url ? (
                        <img src={getFullUrl(surfer.avatar_url)} alt={surfer.full_name} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-xs">
                          {(surfer.full_name || surfer.username || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{surfer.full_name || surfer.username}</p>
                        <p className="text-xs text-muted-foreground">@{surfer.username}</p>
                      </div>
                      <Button
                        size="sm"
                        className="bg-amber-500 hover:bg-amber-600 text-black text-xs h-7"
                        onClick={() => handleDistributeToSurfer(surfer.id, surfer.full_name || surfer.username)}
                        disabled={distributeLoading[surfer.id]}
                      >
                        {distributeLoading[surfer.id] ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <Send className="w-3 h-3 mr-1" /> Push
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {manualSurferSearch.length >= 2 && !searchLoading && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No surfers found for "{manualSurferSearch}"</p>
              )}
            </div>
            
            {/* Gallery Items Summary — Smart Delivery Info */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-1">
              <p className="text-xs text-muted-foreground">
                📦 <strong>{galleryItems.length}</strong> items in this gallery
              </p>
              {participants.some(p => p.photos_credit_remaining > 0) ? (
                <p className="text-xs text-emerald-400">
                  🎟️ Participants with included photos will receive <strong>full-resolution</strong> items up to their credit. 
                  Additional items are delivered as previews.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Items will be pushed to surfer Lockers. Surfers can then purchase full-resolution versions.
                </p>
              )}
            </div>
          </div>
          
          <DialogFooter className="pt-3 border-t border-border">
            <Button variant="outline" onClick={() => setShowTagAssignModal(false)} className="border-border">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Watermark Settings Modal */}
      <WatermarkSettings
        open={showWatermarkSettings}
        onOpenChange={setShowWatermarkSettings}
        theme="dark"
      />
    </div>
  );
};

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

export default GalleryPage;
