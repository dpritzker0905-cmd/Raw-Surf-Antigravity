// File: frontend/src/hooks/useGalleryActions.js
import { useRef, useLayoutEffect } from 'react';
import apiClient from '../lib/apiClient';
import { copyGalleryItem } from '../lib/copyGalleryItem';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

// Import newly refactored sub-hooks
import useGalleryGromActions from './useGalleryGromActions';
import useGalleryFolderActions from './useGalleryFolderActions';
import useGalleryDistributionActions from './useGalleryDistributionActions';

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
  showAddToGalleryModal,
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
  manualSurferSearch,
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
  clearItemCustomPrice,
  setShowGalleryPricingModal,
  newFolderName,
  folderToRename,
  folderToDelete,
  galleryPricing,
  thumbnailPickerGallery,
  linkSessionGallery,
  setBrokenCoverImages,
  gallery,
}) => {
  const copyRequest = useRef(null);
  const copyRetryPending = useRef(false);
  useLayoutEffect(() => () => {
    if (copyRequest.current || copyRetryPending.current) {
      copyRetryPending.current = false;
      setSelectedItems(new Set());
      setBulkSelectMode(false);
      setShowCopyToFolderModal(false);
    }
    if (copyRequest.current) {
      copyRequest.current = null;
      setFolderActionLoading(false);
    }
  }, [user?.id, selectedGallery?.id, setSelectedItems, setBulkSelectMode, setShowCopyToFolderModal, setFolderActionLoading]);

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
      toast.success(String(data.message));
      if (folderActions && folderActions.fetchConditionsStatus) {
        await folderActions.fetchConditionsStatus(selectedGallery.id);
      }
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
      fetchGallery();
    } else {
      toast.error(result.error || 'Failed to update pricing');
    }
  };

  const handleQuickPriceUpdate = async (itemId, newPrice) => {
    const result = await setItemCustomPrice(itemId, newPrice);
    if (result.success) {
      toast.success(result.data.has_override ? 'Fixed price set!' : 'Price reset to gallery default');
      fetchGallery();
    } else {
      toast.error(result.error);
    }
  };

  const handleClearCustomPrice = async (itemId) => {
    const result = await clearItemCustomPrice(itemId);
    if (result.success) {
      toast.success('Price reset to gallery default');
      fetchGallery();
    } else {
      toast.error(result.error);
    }
  };

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

  const selectAllItems = () => {
    const items = selectedGallery ? galleryItems : gallery;
    setSelectedItems(new Set(items.map(item => item.id)));
  };

  const clearSelection = () => {
    copyRetryPending.current = false;
    setSelectedItems(new Set());
    setBulkSelectMode(false);
  };

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
      if (folderActions && folderActions.fetchGalleries) {
        folderActions.fetchGalleries();
      }
      if (selectedGallery && folderActions && folderActions.fetchGalleryItems) {
        folderActions.fetchGalleryItems(selectedGallery.id);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to move items'));
    } finally {
      setFolderActionLoading(false);
    }
  };

  const handleCopyToFolder = async (targetFolderId) => {
    if (copyRequest.current) return;
    if (selectedItems.size === 0) {
      toast.error('No items selected');
      return;
    }
    const itemIds = Array.from(selectedItems);
    copyRequest.current = itemIds;
    setFolderActionLoading(true);
    try {
      const outcomes = await Promise.allSettled(itemIds.map(itemId =>
        copyGalleryItem(user.id, itemId, targetFolderId)
      ));
      if (copyRequest.current !== itemIds) return;
      const copied = new Set(itemIds.filter((_, index) => outcomes[index].status === 'fulfilled'));
      const removed = itemIds.filter((_, index) => outcomes[index].reason?.code === 'PREVIOUS_COPY_REMOVED');
      if (removed.length) {
        const unresolved = new Set(itemIds.filter(id => !copied.has(id) && !removed.includes(id)));
        copyRetryPending.current = unresolved.size > 0;
        setSelectedItems(unresolved);
        if (!unresolved.size) {
          setShowCopyToFolderModal(false);
          setBulkSelectMode(false);
        }
        folderActions.fetchGalleries();
        if (selectedGallery?.id === targetFolderId) folderActions.fetchGalleryItems(targetFolderId);
        toast.error(`Confirmed ${copied.size}. Previous copies no longer in this folder: ${removed.length}. Select those photos again to make new copies.`);
        return;
      }
      copyRetryPending.current = copied.size < itemIds.length;
      if (copied.size === 0) {
        toast.error(getErrorMessage(outcomes[0].reason, 'Failed to copy items'));
        return;
      }
      if (copied.size < itemIds.length) {
        setSelectedItems(current => new Set([...current].filter(id => !copied.has(id))));
        folderActions.fetchGalleries();
        if (selectedGallery?.id === targetFolderId) folderActions.fetchGalleryItems(targetFolderId);
        toast.error(`Confirmed ${copied.size} of ${itemIds.length} copies. Retry the remaining items.`);
        return;
      }
      const earlier = outcomes.filter(outcome => outcome.value?.replayed).length;
      if (earlier) {
        toast.success(`New copies: ${copied.size - earlier}. Previous copies confirmed: ${earlier}.`);
      } else {
        toast.success(`Copied ${itemIds.length} item${itemIds.length > 1 ? 's' : ''} to folder`);
      }
      setShowCopyToFolderModal(false);
      clearSelection();
      if (folderActions && folderActions.fetchGalleries) {
        folderActions.fetchGalleries();
      }
      if (selectedGallery && folderActions && folderActions.fetchGalleryItems) {
        folderActions.fetchGalleryItems(selectedGallery.id);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to copy items'));
    } finally {
      if (copyRequest.current === itemIds) {
        copyRequest.current = null;
        setFolderActionLoading(false);
      }
    }
  };

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
      await Promise.all(itemIds.map(async (itemId) => {
        try {
          if (selectedGallery) {
            await apiClient.delete(`/galleries/${selectedGallery.id}/items/${itemId}?photographer_id=${user.id}`);
          } else {
            await apiClient.delete(`/gallery/item/${itemId}?photographer_id=${user.id}`);
          }
        } catch (err) {
          if (err.response?.status === 404 && selectedGallery) {
            await apiClient.delete(`/gallery/item/${itemId}?photographer_id=${user.id}`);
          } else {
            throw err;
          }
        }
      }));
      toast.success(`Deleted ${itemIds.length} item${itemIds.length > 1 ? 's' : ''}`);
      clearSelection();
      if (folderActions && folderActions.fetchGalleries) {
        folderActions.fetchGalleries();
      }
      if (selectedGallery && folderActions && folderActions.fetchGalleryItems) {
        folderActions.fetchGalleryItems(selectedGallery.id);
      } else {
        fetchGallery();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete items'));
    } finally {
      setFolderActionLoading(false);
      setDeleteConfirm(null);
    }
  };

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

  const handleLinkSession = async (session) => {
    if (!linkSessionGallery) return;
    setLinkingSession(true);
    try {
      const linkPayload = { [session.link_key]: session.id };
      await apiClient.post(
        `/gallery/${linkSessionGallery.id}/link-session?photographer_id=${user.id}`,
        linkPayload
      );
      const typeLabel = session.session_type === 'live' ? 'Live Session' :
        session.session_type === 'booking' ? 'Booking' : 'On-Demand';
      toast.success(`Folder linked to ${typeLabel}! Participants and distribution are now available.`);
      setShowLinkSessionModal(false);
      setLinkSessionGallery(null);
      if (folderActions && folderActions.fetchGalleries) {
        folderActions.fetchGalleries();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to link session'));
    } finally {
      setLinkingSession(false);
    }
  };

  // Instantiate Sub-Hooks
  const gromActions = useGalleryGromActions({
    user,
    setLinkedGroms,
    setGromHighlights,
    setShowTagGromModal,
    setItemToTag
  });

  const folderActions = useGalleryFolderActions({
    user,
    selectedGallery,
    setGalleries,
    setGalleryItems,
    setGalleryItemsLoading,
    setDeleteConfirm,
    setDeletingItemId,
    showAddToGalleryModal,
    setShowAddToGalleryModal,
    setSelectedGallery,
    setConditionsStatus,
    setNewFolderName,
    setShowCreateFolderModal,
    setFolderToRename,
    setShowRenameFolderModal,
    setFolderToDelete,
    setShowDeleteFolderModal,
    setShowThumbnailPicker,
    setThumbnailPickerGallery,
    setThumbnailPickerItems,
    setThumbnailPickerLoading,
    setSettingThumbnail,
    setBrokenCoverImages,
    newFolderName,
    folderToRename,
    folderToDelete,
    thumbnailPickerGallery,
    fetchGallery
  });

  const distributionActions = useGalleryDistributionActions({
    user,
    selectedGallery,
    selectedItems,
    bulkSelectMode,
    galleryItems,
    participants,
    setShowTagAssignModal,
    setManualSurferSearch,
    setSearchResults,
    setParticipantsLoading,
    setParticipants,
    setSessionInfo,
    setDistributeLoading,
    setDistributeAllLoading,
    setDistributeProgress,
    setAiAutoTagLoading,
    setBatchTagLoading,
    setShowBatchTagPicker,
    setSearchLoading,
    manualSurferSearch,
    fetchGalleryItems: folderActions.fetchGalleryItems,
    fetchGalleries: folderActions.fetchGalleries,
    clearSelection
  });

  return {
    ...gromActions,
    ...folderActions,
    ...distributionActions,
    handleSaveGalleryPricing,
    fetchGallery,
    handleQuickPriceUpdate,
    handleClearCustomPrice,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    handleMoveToFolder,
    handleCopyToFolder,
    handlePushToSpotHub,
    handleBulkDelete,
    executeBulkDelete,
    handleOpenLinkSession,
    handleLinkSession
  };
};

export default useGalleryActions;
