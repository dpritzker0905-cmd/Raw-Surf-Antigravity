/**
 * usePhotographerGalleryActions.js - Extracted from PhotographerGalleryManager.js
 * Gallery management: upload, pricing, tagging, distribution.
 * ~466 lines, 27 handlers extracted.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { useEffect, useMemo } from 'react';

const usePhotographerGalleryActions = ({
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
}) => {

  const fetchGallery = async () => {
    try {
      const res = await apiClient.get(`/galleries/${galleryId}?viewer_id=${user?.id}`);
      setGallery(res.data);
      setPricing({
        price_web: res.data.pricing?.photo?.web || 3,
        price_standard: res.data.pricing?.photo?.standard || 5,
        price_high: res.data.pricing?.photo?.high || 10,
        price_720p: res.data.pricing?.video?.['720p'] || 8,
        price_1080p: res.data.pricing?.video?.['1080p'] || 15,
        price_4k: res.data.pricing?.video?.['4k'] || 30
      });
      setEditData({
        title: res.data.title || '',
        description: res.data.description || ''
      });
    } catch (error) {
      toast.error('Failed to load gallery');
      navigate('/photographer/sessions');
    } finally {
      setLoading(false);
    }
  };

  // ============ PUSH TO SPOT HUB HANDLERS ============

  // Fetch conditions status when gallery loads
  useEffect(() => {
    if (gallery?.surf_spot_id && user?.id) {
      fetchConditionsStatus();
    }
  }, [gallery?.id, gallery?.surf_spot_id]);

  const fetchConditionsStatus = async () => {
    try {
      const response = await apiClient.get(
        `/galleries/${galleryId}/conditions-status?photographer_id=${user.id}`
      );
      setConditionsStatus(response.data);
    } catch (error) {
      logger.error('Error fetching conditions status:', error);
      setConditionsStatus(null);
    }
  };

  const handlePushToSpotHub = async () => {
    if (!gallery?.surf_spot_id) {
      toast.error('This gallery has no linked surf spot');
      return;
    }
    setPushingConditions(true);
    try {
      const response = await apiClient.post(
        `/galleries/${galleryId}/push-conditions?photographer_id=${user.id}`,
        {}
      );
      const data = response.data;
 toast.success(`=+ ${data.message}`);
      await fetchConditionsStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to push conditions report');
    } finally {
      setPushingConditions(false);
    }
  };

  // ============ DISTRIBUTION HANDLERS ============
  const fetchSessionParticipants = async () => {
    if (!galleryId || !user?.id) return;
    setLoadingParticipants(true);
    try {
      const res = await apiClient.get(`/gallery/${galleryId}/session-participants?photographer_id=${user.id}`);
      setSessionParticipants(res.data.participants || []);
      setSessionInfo(res.data.session || {});
      setTotalGalleryItems(res.data.total_gallery_items || 0);
    } catch (error) {
      logger.warn('Failed to load session participants:', error);
    } finally {
      setLoadingParticipants(false);
    }
  };

  const fetchRecentSessions = async () => {
    if (!user?.id) return;
    setLoadingSessions(true);
    try {
      const res = await apiClient.get(`/photographer/${user.id}/recent-sessions`);
      setRecentSessions(res.data || []);
    } catch (error) {
      toast.error('Failed to load recent sessions');
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleLinkSession = async (session) => {
    try {
      // session can be a full object with link_key, or a plain sessionId string for backward compat
      const linkPayload = typeof session === 'object' && session.link_key
        ? { [session.link_key]: session.id }
        : { live_session_id: session };
      
      await apiClient.post(`/gallery/${galleryId}/link-session?photographer_id=${user.id}`, linkPayload);
      const typeLabel = session?.session_type === 'booking' ? 'Booking' :
        session?.session_type === 'on_demand' ? 'On-Demand' : 'Live Session';
      toast.success(`Gallery linked to ${typeLabel}!`);
      setShowLinkSessionModal(false);
      fetchGallery();
      fetchSessionParticipants();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to link session');
    }
  };

  const handleDistributeAll = async () => {
    try {
      setDistributing('all');
      const res = await apiClient.post(`/gallery/${galleryId}/distribute?photographer_id=${user.id}`);
      toast.success(res.data.message || 'Distribution complete!');
      fetchSessionParticipants();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Distribution failed');
    } finally {
      setDistributing(null);
    }
  };

  const handleDistributeToSurfer = async (surferId, surferName) => {
    try {
      setDistributing(surferId);
      const res = await apiClient.post(`/gallery/${galleryId}/distribute-to-surfer?photographer_id=${user.id}`, {
        surfer_id: surferId,
        access_type: 'pending_selection'
      });
      toast.success(res.data.message || `Distributed to ${surferName}!`);
      fetchSessionParticipants();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Distribution failed');
    } finally {
      setDistributing(null);
    }
  };

  const handleAssignItemToSurfer = async (itemId, surferId, silent = false) => {
    try {
      await apiClient.post(`/gallery/item/${itemId}/assign-surfer`, {
        photographer_id: user.id,
        surfer_id: surferId,
        access_type: 'pending_selection'
      });
      if (!silent) {
        toast.success('Item assigned to surfer!');
        setShowAssignDrawer(false);
        setAssigningItem(null);
      }
    } catch (error) {
      if (!silent) toast.error(error.response?.data?.detail || 'Assignment failed');
    }
  };

  // Phase 3: Fetch sales data
  const fetchSalesData = async () => {
    setLoadingSales(true);
    try {
      const res = await apiClient.get(`/galleries/${galleryId}/sales-dashboard?photographer_id=${user?.id}`);
      setSalesData(res.data);
    } catch (error) {
      logger.error('Failed to load sales data:', error);
    } finally {
      setLoadingSales(false);
    }
  };

  // Phase 3: Fetch client activity
  const fetchClientActivity = async () => {
    setLoadingSales(true);
    try {
      const res = await apiClient.get(`/galleries/${galleryId}/client-activity?photographer_id=${user?.id}`);
      setClientsData(res.data);
    } catch (error) {
      logger.error('Failed to load client activity:', error);
    } finally {
      setLoadingSales(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    let successCount = 0;

    for (const file of files) {
      try {
        // Create FormData for file upload
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', user?.id);  // Backend expects user_id
        formData.append('add_watermark_preview', 'true');

        // Upload to server using the correct photographer-gallery endpoint
        const uploadRes = await apiClient.post(`/upload/photographer-gallery`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        if (uploadRes.data) {
          // Add item to gallery
          await apiClient.post(`/galleries/${galleryId}/items?photographer_id=${user?.id}`, {
            original_url: uploadRes.data.original_url,
            preview_url: uploadRes.data.preview_url,
            thumbnail_url: uploadRes.data.thumbnail_url,
            media_type: file.type.startsWith('video') ? 'video' : 'image'
          });
          successCount++;
        }
      } catch (error) {
        logger.error(`Failed to upload ${file.name}:`, error);
        toast.error(`Failed to upload ${file.name}: ${error.response?.data?.detail || error.message}`);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file(s) successfully`);
      fetchGallery();
    }
  };

  const handleSavePricing = async () => {
    try {
      await apiClient.put(`/galleries/${galleryId}?photographer_id=${user?.id}`, {
        ...pricing
      });
      toast.success('Pricing updated');
      setShowPricingModal(false);
      fetchGallery();
    } catch (error) {
      toast.error('Failed to update pricing');
    }
  };

  const handleSaveEdit = async () => {
    try {
      await apiClient.put(`/galleries/${galleryId}?photographer_id=${user?.id}`, editData);
      toast.success('Gallery updated');
      setShowEditModal(false);
      fetchGallery();
    } catch (error) {
      toast.error('Failed to update gallery');
    }
  };

  const handleDeleteGallery = async () => {
    if (!window.confirm('Are you sure you want to delete this gallery? This cannot be undone.')) {
      return;
    }
    try {
      await apiClient.delete(`/galleries/${galleryId}?photographer_id=${user?.id}`);
      toast.success('Gallery deleted');
      navigate('/photographer/sessions');
    } catch (error) {
      toast.error('Failed to delete gallery');
    }
  };

  // Set a specific item as gallery cover/thumbnail
  const handleSetAsCover = async (item) => {
    const coverUrl = item.preview_url || item.thumbnail_url;
    if (!coverUrl) {
      toast.error('This item has no preview image');
      return;
    }
    try {
      await apiClient.put(`/galleries/${galleryId}?photographer_id=${user?.id}`, {
        cover_image_url: coverUrl
      });
      setGallery(prev => ({ ...prev, cover_image_url: coverUrl }));
      toast.success('Gallery cover updated!');
    } catch (error) {
      toast.error('Failed to update cover image');
    }
  };

  // AI Tagging Functions
  const handleOpenTagging = async (item) => {
    setSelectedItem(item);
    setSelectedTags([]);
    setAiTagSuggestions([]);
    setShowTaggingModal(true);
  };

  const handleAnalyzePhoto = async () => {
    if (!selectedItem) return;
    
    setAnalyzingPhoto(true);
    try {
      const response = await apiClient.post(`/ai/suggest-tags`, {
        image_url: selectedItem.preview_url,
        gallery_item_id: selectedItem.id
      });
      
      if (response.data.success) {
        setAiTagSuggestions(response.data.suggested_tags || []);
        if (response.data.suggested_tags?.length === 0) {
          toast.info(`Detected ${response.data.people_detected || 0} people but no registered surfers matched`);
        } else {
          toast.success(`Found ${response.data.suggested_tags.length} potential tag suggestions`);
        }
      }
    } catch (error) {
      toast.error('Failed to analyze photo');
    } finally {
      setAnalyzingPhoto(false);
    }
  };

  const toggleTagSelection = (profileId) => {
    setSelectedTags(prev => 
      prev.includes(profileId) 
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    );
  };

  const handleConfirmTags = async () => {
    if (selectedTags.length === 0) {
      toast.warning('No tags selected');
      return;
    }
    
    try {
      await apiClient.post(`/ai/confirm-tags?photographer_id=${user?.id}`, {
        gallery_item_id: selectedItem.id,
        surfer_ids: selectedTags
      });
      
      toast.success(`Tagged ${selectedTags.length} surfer(s)! They'll be notified.`);
      setShowTaggingModal(false);
      setSelectedItem(null);
      setSelectedTags([]);
      setAiTagSuggestions([]);
    } catch (error) {
      toast.error('Failed to save tags');
    }
  };

  // Phase 1: Filter and sort items
  const filteredItems = useMemo(() => {
    if (!gallery?.items) return [];
    
    let items = [...gallery.items];
    
    // Filter by type
    if (filterType === 'photos') items = items.filter(i => i.media_type === 'image');
    else if (filterType === 'videos') items = items.filter(i => i.media_type === 'video');
    else if (filterType === 'tagged') items = items.filter(i => i.tagged_surfer_ids);
    else if (filterType === 'untagged') items = items.filter(i => !i.tagged_surfer_ids);
    // Phase 4: Distribution-based filters
    else if (filterType === 'distributed') items = items.filter(i => (i.distributed_count || 0) > 0);
    else if (filterType === 'undistributed') items = items.filter(i => (i.distributed_count || 0) === 0);
    else if (filterType === 'ai_pending') items = items.filter(i => (i.ai_suggested_count || 0) > 0 && (i.confirmed_count || 0) === 0);
    
    // Search by title
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    }
    
    // Sort
    if (sortBy === 'newest') items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (sortBy === 'oldest') items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sortBy === 'purchases') items.sort((a, b) => (b.purchase_count || 0) - (a.purchase_count || 0));
    
    return items;
  }, [gallery?.items, filterType, searchQuery, sortBy]);

  // Phase 1: Bulk selection handlers
  const handleToggleSelect = (itemId) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.id)));
    }
  };

  // Phase 2: Keyboard navigation for lightbox
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!lightboxItem) return;
      const currentIndex = filteredItems.findIndex(i => i.id === lightboxItem.id);
      
      if (e.key === 'Escape') {
        setLightboxItem(null);
      } else if (e.key === 'ArrowRight' && currentIndex < filteredItems.length - 1) {
        setLightboxItem(filteredItems[currentIndex + 1]);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setLightboxItem(filteredItems[currentIndex - 1]);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxItem, filteredItems]);

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this item? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/galleries/${galleryId}/items/${itemId}?photographer_id=${user?.id}`);
      toast.success('Item deleted');
      fetchGallery();
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    if (!window.confirm(`Delete ${selectedItems.size} items? This cannot be undone.`)) return;
    
    try {
      for (const itemId of selectedItems) {
        await apiClient.delete(`/galleries/${galleryId}/items/${itemId}?photographer_id=${user?.id}`);
      }
      toast.success(`Deleted ${selectedItems.size} items`);
      setSelectedItems(new Set());
      setBulkMode(false);
      fetchGallery();
    } catch (error) {
      toast.error('Failed to delete some items');
    }
  };

  const handleSetCustomPrice = async () => {
    if (!selectedItem || !itemCustomPrice) return;
    try {
      await apiClient.patch(`/gallery/item/${selectedItem.id}/custom-price?photographer_id=${user?.id}`, {
        custom_price: parseFloat(itemCustomPrice)
      });
      toast.success('Custom price set');
      setShowItemPricingModal(false);
      setSelectedItem(null);
      setItemCustomPrice('');
      fetchGallery();
    } catch (error) {
      toast.error('Failed to set price');
    }
  };

  const openItemPricing = (item) => {
    setSelectedItem(item);
    setItemCustomPrice(item.custom_price || '');
    setShowItemPricingModal(true);
  };

  return {
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
  };
};

export default usePhotographerGalleryActions;
