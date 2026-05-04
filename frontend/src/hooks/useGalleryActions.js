/**
 * useGalleryActions.js � Extracted from GalleryPage.js
 * Custom hook containing all gallery data-fetching and action handlers.
 * ~730 lines extracted to reduce GalleryPage from 121KB.
 */
import { useCallback } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const useGalleryActions = ({
  user,
  selectedGallery,
  selectedItems,
  bulkSelectMode,
  galleryItems,
  participants,
  // State setters
  setGallery,
  setGalleries,
  setGalleryItems,
  setGalleryItemsLoading,
  setLinkedGroms,
  setGromHighlights,
  setShowTagGromModal,
  setItemToTag,
  setDeleteConfirm,
  setDeletingItemId,
  setShowAddToGalleryModal,
  setSelectedGallery,
  setConditionsStatus,
  setPushingConditions,
  setFolderActionLoading,
  setNewFolderName,
  setShowCreateFolderModal,
  setFolderToRename,
  setShowRenameFolderModal,
  setFolderToDelete,
  setShowDeleteFolderModal,
  setSelectedItems,
  setBulkSelectMode,
  setShowMoveToFolderModal,
  setShowCopyToFolderModal,
  setShowTagAssignModal,
  setParticipantsLoading,
  setParticipants,
  setSessionInfo,
  setDistributeLoading,
  setDistributeAllLoading,
  setDistributeProgress,
  setManualSurferSearch,
  setSearchResults,
  setSearchLoading,
  setAiAutoTagLoading,
  setBatchTagLoading,
  setShowBatchTagPicker,
  setShowThumbnailPicker,
  setThumbnailPickerGallery,
  setThumbnailPickerItems,
  setThumbnailPickerLoading,
  setSettingThumbnail,
  setShowLinkSessionModal,
  setLinkSessionGallery,
  setRecentSessions,
  setRecentSessionsLoading,
  setLinkingSession,
  setLoading,
  // Context
  updateGeneralSettings,
  setItemCustomPrice,
  clearItemCustomPrice: clearItemCustomPriceFn,
  setShowGalleryPricingModal,
  newFolderName,
  folderToRename,
  folderToDelete,
  galleryPricing,
}) => {

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
    // Check conditions report status for this gallery
    if (gal.surf_spot_id) {
      fetchConditionsStatus(gal.id);
    } else {
      setConditionsStatus(null);
    }
  };

  // Close gallery detail view
  const closeGalleryDetail = () => {
    setSelectedGallery(null);
    setGalleryItems([]);
    setConditionsStatus(null);
  };

  // ============ PUSH TO SPOT HUB HANDLERS ============
  
  // Fetch current conditions report status for a gallery
  const fetchConditionsStatus = async (galleryId) => {
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

  // Push conditions report to spot hub
  const handlePushToSpotHub = async () => {
    if (!selectedGallery?.surf_spot_id) {
      toast.error('This gallery has no linked surf spot');
      return;
    }
    setPushingConditions(true);
    try {
      const response = await apiClient.post(
        `/galleries/${selectedGallery.id}/push-conditions?photographer_id=${user.id}`,
        {}
      );
      const data = response.data;
      toast.success(`📡 ${data.message}`);
      // Refresh status
      await fetchConditionsStatus(selectedGallery.id);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to push conditions report'));
    } finally {
      setPushingConditions(false);
    }
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
      // Track progress by distributing items individually
      const galleryItemsResponse = await apiClient.get(`/galleries/${selectedGallery.id}/items?viewer_id=${user.id}`);
      const allItems = galleryItemsResponse.data || [];
      const totalItems = allItems.length * participants.length;
      setDistributeProgress({ current: 0, total: totalItems || 1 });
      
      const response = await apiClient.post(
        `/gallery/${selectedGallery.id}/distribute?photographer_id=${user.id}`
      );
      const total = response.data.total_distributed || 0;
      setDistributeProgress({ current: totalItems, total: totalItems });
      toast.success(`✅ Distributed ${total} locker items to all participants!`);
      
      // Refresh to update counts
      await fetchParticipants(selectedGallery.id);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to distribute to all participants'));
    } finally {
      setDistributeAllLoading(false);
      setTimeout(() => setDistributeProgress(null), 2000);
    }
  };

  // Trigger AI auto-tagging for gallery items
  const handleAiAutoTag = async () => {
    if (!selectedGallery) return;
    setAiAutoTagLoading(true);
    try {
      const response = await apiClient.post(
        `/gallery/trigger-ai-match?photographer_id=${user.id}`,
        { 
          gallery_id: selectedGallery.id,
          item_ids: bulkSelectMode && selectedItems.size > 0 ? Array.from(selectedItems) : undefined
        }
      );
      const matched = response.data.matches_found || 0;
      const processed = response.data.items_processed || 0;
      if (matched > 0) {
        toast.success(`🤖 AI matched ${matched} items to surfers! (${processed} processed)`);
      } else {
        toast.info(`🤖 AI processed ${processed} items — no confident matches found. Try manual tagging.`);
      }
      // Refresh gallery to show updated AI status
      if (selectedGallery) {
        await fetchGalleryItems(selectedGallery.id);
        await fetchParticipants(selectedGallery.id);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'AI auto-tag failed'));
    } finally {
      setAiAutoTagLoading(false);
    }
  };

  // Batch tag selected items to a specific surfer
  const handleBatchTagToSurfer = async (surferId, surferName) => {
    const itemsToTag = selectedItems.size > 0 ? selectedItems : new Set(galleryItems.map(i => i.id));
    if (!selectedGallery || itemsToTag.size === 0) return;
    setBatchTagLoading(prev => ({ ...prev, [surferId]: true }));
    try {
      let tagged = 0;
      let alreadyTagged = 0;
      let alreadyDelivered = 0;
      for (const itemId of itemsToTag) {
        try {
          const response = await apiClient.post(
            `/gallery/${selectedGallery.id}/tag-item?photographer_id=${user.id}`,
            { surfer_id: surferId, item_id: itemId }
          );
          if (response.data.already_tagged) {
            if (response.data.is_delivered) {
              alreadyDelivered++;
            } else {
              alreadyTagged++;
            }
          } else {
            tagged++;
          }
        } catch (_err) {
          // Continue with remaining items
        }
      }
      // Build descriptive result message
      const parts = [];
      if (tagged > 0) parts.push(`${tagged} tagged`);
      if (alreadyDelivered > 0) parts.push(`${alreadyDelivered} already delivered`);
      if (alreadyTagged > 0) parts.push(`${alreadyTagged} already pending`);
      
      if (tagged > 0) {
        toast.success(`✅ ${parts.join(' • ')} → ${surferName}`);
      } else {
        toast.info(`${parts.join(' • ')} for ${surferName}`);
      }
      // Refresh
      await fetchGalleryItems(selectedGallery.id);
      await fetchParticipants(selectedGallery.id);
      fetchGalleries();
      setShowBatchTagPicker(false);
      setShowTagAssignModal(false);
      clearSelection();
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to batch tag to ${surferName}`));
    } finally {
      setBatchTagLoading(prev => ({ ...prev, [surferId]: false }));
    }
  };

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

  // ============ THUMBNAIL PICKER HANDLERS ============
  
  // Open thumbnail picker for a gallery
  const handleOpenThumbnailPicker = async (gal) => {
    setThumbnailPickerGallery(gal);
    setShowThumbnailPicker(true);
    setThumbnailPickerLoading(true);
    try {
      const response = await apiClient.get(`/galleries/${gal.id}/items?viewer_id=${user.id}`);
      setThumbnailPickerItems(response.data || []);
    } catch (error) {
      logger.error('Error loading gallery items for thumbnail picker:', error);
      setThumbnailPickerItems([]);
    } finally {
      setThumbnailPickerLoading(false);
    }
  };

  // Set a specific item as the gallery cover
  const handleSetThumbnail = async (itemId) => {
    if (!thumbnailPickerGallery) return;
    setSettingThumbnail(true);
    try {
      await apiClient.patch(
        `/galleries/${thumbnailPickerGallery.id}/set-thumbnail?photographer_id=${user.id}`,
        { item_id: itemId }
      );
      toast.success('📸 Folder thumbnail updated!');
      setShowThumbnailPicker(false);
      setThumbnailPickerGallery(null);
      // Clear broken cover cache for this gallery
      setBrokenCoverImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(thumbnailPickerGallery.id);
        newSet.delete(`${thumbnailPickerGallery.id}_fallback`);
        return newSet;
      });
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to set thumbnail'));
    } finally {
      setSettingThumbnail(false);
    }
  };

  // Clear gallery thumbnail (revert to auto-select)
  const handleClearThumbnail = async (galleryId) => {
    try {
      await apiClient.patch(
        `/galleries/${galleryId}/clear-thumbnail?photographer_id=${user.id}`
      );
      toast.success('Thumbnail reset — will auto-select on next load');
      setShowThumbnailPicker(false);
      setThumbnailPickerGallery(null);
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to clear thumbnail'));
    }
  };

  // Set cover directly from gallery detail view (Set as Cover action)
  const handleSetAsCover = async (itemId) => {
    if (!selectedGallery) return;
    try {
      await apiClient.patch(
        `/galleries/${selectedGallery.id}/set-thumbnail?photographer_id=${user.id}`,
        { item_id: itemId }
      );
      toast.success('📸 Set as folder cover!');
      setBrokenCoverImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedGallery.id);
        newSet.delete(`${selectedGallery.id}_fallback`);
        return newSet;
      });
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to set cover'));
    }
  };

  // ============ LINK SESSION HANDLERS ============
  
  // Open link session modal and fetch recent sessions
  const handleOpenLinkSession = async (gal) => {
    setLinkSessionGallery(gal);
    setShowLinkSessionModal(true);
    setRecentSessionsLoading(true);
    try {
      const response = await apiClient.get(`/photographer/${user.id}/recent-sessions?limit=20`);
      setRecentSessions(response.data || []);
    } catch (error) {
      logger.error('Error fetching recent sessions:', error);
      setRecentSessions([]);
    } finally {
      setRecentSessionsLoading(false);
    }
  };

  // Link gallery to a session (live, booking, or dispatch)
  const handleLinkSession = async (session) => {
    if (!linkSessionGallery) return;
    setLinkingSession(true);
    try {
      // Build the correct payload based on session type
      const linkPayload = { [session.link_key]: session.id };
      
      await apiClient.post(
        `/gallery/${linkSessionGallery.id}/link-session?photographer_id=${user.id}`,
        linkPayload
      );
      const typeLabel = session.session_type === 'live' ? 'Live Session' :
        session.session_type === 'booking' ? 'Booking' : 'On-Demand';
      toast.success(`✅ Folder linked to ${typeLabel}! Participants and distribution are now available.`);
      setShowLinkSessionModal(false);
      setLinkSessionGallery(null);
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to link session'));
    } finally {
      setLinkingSession(false);
    }
  };

  return {
    fetchLinkedGroms,
    fetchGromHighlights,
    handleTagGrom,
    handleUntagGrom,
    fetchGalleries,
    fetchGalleryItems,
    handleDeleteFromGallery,
    executeDeleteFromGallery,
    handleAddToGallery,
    openGalleryDetail,
    closeGalleryDetail,
    fetchConditionsStatus,
    handlePushToSpotHub,
    handleSaveGalleryPricing,
    fetchGallery,
    handleQuickPriceUpdate,
    handleClearCustomPrice,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    confirmDeleteFolder,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    handleMoveToFolder,
    handleCopyToFolder,
    handleOpenTagAssign,
    fetchParticipants,
    handleDistributeToSurfer,
    handleDistributeAll,
    handleAiAutoTag,
    handleBatchTagToSurfer,
    handleSearchSurfers,
    handleBulkDelete,
    handleOpenThumbnailPicker,
    handleSetThumbnail,
    handleClearThumbnail,
    handleSetAsCover,
    handleOpenLinkSession,
    handleLinkSession,
  };
};

export default useGalleryActions;