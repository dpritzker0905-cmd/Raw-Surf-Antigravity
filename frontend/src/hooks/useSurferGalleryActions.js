/**
 * useSurferGalleryActions.js
 * Extracted from SurferGallery.js — handler logic for the Locker page.
 * 
 * Extraction checklist (v30):
 * ✅ Step 1: JSX scan — zero JSX in extraction range (lines 716-921)
 * ✅ Step 2: Closure param audit — all state/setters listed
 * ✅ Step 3: Phantom param check — every param used in handler body
 * ✅ Step 4: React hooks scan — no React hooks needed (pure handlers)
 * ✅ Step 5: Utility/import scan — apiClient, toast, logger, getFullUrl
 * ✅ Step 6: Hook placement — called AFTER all useState declarations
 * ✅ Step 7: Cross-module export — no constants needed
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

var useSurferGalleryActions = ({
  user,
  galleryItems,
  selectedItems,
  multiSelectMode,
  filteredItems,
  setLoading,
  setGalleryItems,
  setClaimQueue,
  setStats,
  setPendingSelections,
  setAiSessions,
  setDownloadModal,
  setSelectedItems,
  setMultiSelectMode,
  setShowVisibilityOnboarding,
}) => {

  const fetchGallery = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/surfer-gallery?surfer_id=${user.id}`);
      setGalleryItems(response.data.items || []);
      setStats(response.data.stats || {});
    } catch (error) {
      logger.error('Failed to fetch gallery:', error);
      toast.error('Failed to load gallery');
    } finally {
      setLoading(false);
    }
  };

  const fetchClaimQueue = async () => {
    try {
      const response = await apiClient.get(`/surfer-gallery/claim-queue?surfer_id=${user.id}`);
      setClaimQueue(response.data.items || []);
    } catch (error) {
      logger.error('Failed to fetch claim queue:', error);
    }
  };

  const fetchAiSessions = async () => {
    try {
      const response = await apiClient.get(`/surfer-gallery-review/ai-sessions?surfer_id=${user.id}`);
      setAiSessions(response.data.sessions || []);
    } catch (error) {
      logger.debug('AI sessions not available:', error);
    }
  };

  const checkPendingSelections = async () => {
    try {
      const response = await apiClient.get(`/surfer-gallery/pending-selections?surfer_id=${user.id}`);
      setPendingSelections(response.data.count || 0);
    } catch (error) {
      logger.error('Failed to check pending selections:', error);
    }
  };

  const handleVisibilityToggle = async (itemId, isPublic) => {
    try {
      await apiClient.put(`/surfer-gallery/${itemId}/visibility`, {
        surfer_id: user.id,
        is_public: isPublic
      });
      setGalleryItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, is_public: isPublic } : item
      ));
      toast.success(`Photo is now ${isPublic ? 'public' : 'private'}`);
    } catch (error) {
      toast.error('Failed to update visibility');
    }
  };

  const handleFavoriteToggle = async (itemId) => {
    try {
      const item = galleryItems.find(i => i.id === itemId);
      await apiClient.put(`/surfer-gallery/${itemId}/favorite`, {
        surfer_id: user.id,
        is_favorite: !item.is_favorite
      });
      setGalleryItems(prev => prev.map(i => 
        i.id === itemId ? { ...i, is_favorite: !i.is_favorite } : i
      ));
    } catch (error) {
      toast.error('Failed to update favorite');
    }
  };

  const handleClaimAction = async (queueItemId, action) => {
    try {
      await apiClient.post(`/surfer-gallery/claim-queue/${queueItemId}/action`, { action });
      setClaimQueue(prev => prev.filter(item => item.id !== queueItemId));
      if (action === 'claim') {
        toast.success('Added to your gallery!');
        fetchGallery();
      } else {
        toast.success('Removed from suggestions');
      }
    } catch (error) {
      toast.error('Failed to process');
    }
  };

  const handleDownload = async (itemId, quality) => {
    try {
      const response = await apiClient.get(`/surfer-gallery/download/${itemId}`, {
        params: { surfer_id: user.id, quality_tier: quality }
      });
      window.open(response.data.download_url, '_blank');
      toast.success(`Downloading ${quality} quality`);
      setDownloadModal({ isOpen: false, item: null });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Download failed');
    }
  };

  const handleBulkDownload = async () => {
    if (selectedItems.size === 0) return;
    toast.info(`Preparing ${selectedItems.size} files for download...`);
    for (const itemId of selectedItems) {
      await handleDownload(itemId, 'standard');
    }
    setSelectedItems(new Set());
  };

  const handleSinglePurchase = async (itemId, quality) => {
    setDownloadModal({ isOpen: false, item: null });
    try {
      const response = await apiClient.post(`/gallery/bulk-purchase`, {
        item_ids: [itemId],
        quality_tiers: { [itemId]: quality },
        buyer_id: user.id
      });
      
      if (response.data.stripe_checkout_url) {
        window.location.href = response.data.stripe_checkout_url;
      } else {
        toast.success(`Successfully unlocked item!`);
        fetchGallery();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Checkout failed');
    }
  };

  const handleRequestEdit = async (itemId, message) => {
    await apiClient.post(`/surfer-gallery/${itemId}/request-edit`, {
      surfer_id: user.id,
      message
    });
  };

  const handleMessagePhotographer = async (photographerId, _photographerName) => {
    try {
      const response = await apiClient.post(`/messages/start-conversation`, {
        sender_id: user.id,
        recipient_id: photographerId,
        initial_message: null
      });
      const conversationId = response.data.conversation_id;
      window.location.href = `/messages?conversation=${conversationId}`;
    } catch (error) {
      try {
        const checkResponse = await apiClient.get(`/messages/check-thread/${user.id}/${photographerId}`);
        if (checkResponse.data.conversation_id) {
          window.location.href = `/messages?conversation=${checkResponse.data.conversation_id}`;
        }
      } catch {
        toast.error('Failed to start conversation');
      }
    }
  };

  const handleSelectItem = (itemId) => {
    if (!multiSelectMode) return;
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

  const handleToggleMultiSelect = () => {
    if (multiSelectMode) {
      setSelectedItems(new Set());
    }
    setMultiSelectMode(!multiSelectMode);
  };

  const handleBulkPurchaseComplete = (result) => {
    setMultiSelectMode(false);
    setSelectedItems(new Set());
    fetchGallery();
    toast.success(`Successfully purchased ${result.purchase_count} items!`);
  };

  const handleDismissVisibilityOnboarding = () => {
    localStorage.setItem('surfer_gallery_visibility_seen', 'true');
    setShowVisibilityOnboarding(false);
  };

  return {
    fetchGallery,
    fetchClaimQueue,
    fetchAiSessions,
    checkPendingSelections,
    handleVisibilityToggle,
    handleFavoriteToggle,
    handleClaimAction,
    handleDownload,
    handleBulkDownload,
    handleSinglePurchase,
    handleRequestEdit,
    handleMessagePhotographer,
    handleSelectItem,
    handleSelectAll,
    handleToggleMultiSelect,
    handleBulkPurchaseComplete,
    handleDismissVisibilityOnboarding,
  };
};

export default useSurferGalleryActions;
