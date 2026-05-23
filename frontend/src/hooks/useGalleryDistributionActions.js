import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

export const useGalleryDistributionActions = ({
  user,
  selectedGallery,
  selectedItems,
  bulkSelectMode,
  galleryItems,
  participants,
  // State setters
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
  // Inputs
  manualSurferSearch,
  // Core functions from main hook
  fetchGalleryItems,
  fetchGalleries,
  clearSelection
}) => {

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

  const handleDistributeToSurfer = async (surferId, surferName) => {
    if (!selectedGallery) return;
    setDistributeLoading(prev => ({ ...prev, [surferId]: true }));
    try {
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
        toast.success(`++G Pushed ${count} items to ${surferName}'s Locker ${tierMsg}!`);
      } else if (skipped > 0) {
        toast.info(`All items already in ${surferName}'s Locker`);
      } else {
        toast.info('No items to distribute');
      }
      
      await fetchParticipants(selectedGallery.id);
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to distribute to ${surferName}`));
    } finally {
      setDistributeLoading(prev => ({ ...prev, [surferId]: false }));
    }
  };

  const handleDistributeAll = async () => {
    if (!selectedGallery || participants.length === 0) return;
    setDistributeAllLoading(true);
    
    try {
      const galleryItemsResponse = await apiClient.get(`/galleries/${selectedGallery.id}/items?viewer_id=${user.id}`);
      const allItems = galleryItemsResponse.data || [];
      const totalItems = allItems.length * participants.length;
      setDistributeProgress({ current: 0, total: totalItems || 1 });
      
      const response = await apiClient.post(
        `/gallery/${selectedGallery.id}/distribute?photographer_id=${user.id}`
      );
      const total = response.data.total_distributed || 0;
      setDistributeProgress({ current: totalItems, total: totalItems });
      toast.success(`++G Distributed ${total} locker items to all participants!`);
      
      await fetchParticipants(selectedGallery.id);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to distribute to all participants'));
    } finally {
      setDistributeAllLoading(false);
      setTimeout(() => setDistributeProgress(null), 2000);
    }
  };

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
        toast.success(`+++-G AI matched ${matched} items to surfers! (${processed} processed)`);
      } else {
        toast.info(`+++-G AI processed ${processed} items +GG no confident matches found. Try manual tagging.`);
      }
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
          /* ignore */
        }
      }
      const parts = [];
      if (tagged > 0) parts.push(`${tagged} tagged`);
      if (alreadyDelivered > 0) parts.push(`${alreadyDelivered} already delivered`);
      if (alreadyTagged > 0) parts.push(`${alreadyTagged} already pending`);
      
      if (tagged > 0) {
        toast.success(`++G ${parts.join(' +G- ')} +GG ${surferName}`);
      } else {
        toast.info(`${parts.join(' +G- ')} for ${surferName}`);
      }
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

  return {
    handleOpenTagAssign,
    fetchParticipants,
    handleDistributeToSurfer,
    handleDistributeAll,
    handleAiAutoTag,
    handleBatchTagToSurfer,
    handleSearchSurfers
  };
};

export default useGalleryDistributionActions;
