import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

export const useGalleryFolderActions = ({
  user,
  selectedGallery,
  // State setters
  setGalleries,
  setGalleryItems,
  setGalleryItemsLoading,
  setDeleteConfirm,
  setDeletingItemId,
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
  // Inputs
  newFolderName,
  folderToRename,
  folderToDelete,
  thumbnailPickerGallery,
  // Core fetch functions needed from main hook
  fetchGallery
}) => {

  const fetchGalleries = async () => {
    try {
      const response = await apiClient.get(`/galleries/photographer/${user.id}`);
      setGalleries(response.data || []);
    } catch (error) {
      logger.error('Error fetching galleries:', error);
      setGalleries([]);
    }
  };

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

  const handleDeleteFromGallery = async (itemId) => {
    if (!selectedGallery) return;
    setDeleteConfirm({ type: 'single', itemId });
  };

  const executeDeleteFromGallery = async (itemId) => {
    setDeletingItemId(itemId);
    try {
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

  const openGalleryDetail = (gal) => {
    setSelectedGallery(gal);
    fetchGalleryItems(gal.id);
    if (gal.surf_spot_id) {
      fetchConditionsStatus(gal.id);
    } else {
      setConditionsStatus(null);
    }
  };

  const closeGalleryDetail = () => {
    setSelectedGallery(null);
    setGalleryItems([]);
    setConditionsStatus(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }
    setNewFolderName(newFolderName.trim());
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
    }
  };

  const handleRenameFolder = async () => {
    if (!folderToRename || !newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }
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
    }
  };

  const handleDeleteFolder = (folderId, folderName) => {
    setFolderToDelete({ id: folderId, name: folderName });
    setShowDeleteFolderModal(true);
  };

  const confirmDeleteFolder = async () => {
    if (!folderToDelete) return;
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
      setShowDeleteFolderModal(false);
      setFolderToDelete(null);
    }
  };

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

  const handleSetThumbnail = async (itemId) => {
    if (!thumbnailPickerGallery) return;
    setSettingThumbnail(true);
    try {
      await apiClient.patch(
         `/galleries/${thumbnailPickerGallery.id}/set-thumbnail?photographer_id=${user.id}`,
         { item_id: itemId }
      );
      toast.success('+++G-+ Folder thumbnail updated!');
      setShowThumbnailPicker(false);
      setThumbnailPickerGallery(null);
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

  const handleClearThumbnail = async (galleryId) => {
    try {
      await apiClient.patch(
        `/galleries/${galleryId}/clear-thumbnail?photographer_id=${user.id}`
      );
      toast.success('Thumbnail reset +GG will auto-select on next load');
      setShowThumbnailPicker(false);
      setThumbnailPickerGallery(null);
      fetchGalleries();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to clear thumbnail'));
    }
  };

  const handleSetAsCover = async (itemId) => {
    if (!selectedGallery) return;
    try {
      await apiClient.patch(
        `/galleries/${selectedGallery.id}/set-thumbnail?photographer_id=${user.id}`,
        { item_id: itemId }
      );
      toast.success('+++G-+ Set as folder cover!');
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

  return {
    fetchGalleries,
    fetchGalleryItems,
    handleDeleteFromGallery,
    executeDeleteFromGallery,
    handleAddToGallery,
    fetchConditionsStatus,
    openGalleryDetail,
    closeGalleryDetail,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    confirmDeleteFolder,
    handleOpenThumbnailPicker,
    handleSetThumbnail,
    handleClearThumbnail,
    handleSetAsCover
  };
};

export default useGalleryFolderActions;
