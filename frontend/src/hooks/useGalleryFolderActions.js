import { useLayoutEffect, useRef, useState } from 'react';
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
  const userId = user?.id ?? null;
  const selectedId = selectedGallery?.id ?? null;
  const owner = useRef(userId);
  const [dataOwner, setDataOwner] = useState(userId);
  const ownerGeneration = useRef(0);
  const selectedIdRef = useRef(selectedId);
  const folderRequest = useRef(0);
  const itemRequest = useRef(0);
  const mounted = useRef(true);
  const [folderLoad, setFolderLoad] = useState({ loading: false, error: null });
  const [galleryItemsError, setGalleryItemsError] = useState(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      folderRequest.current += 1;
      itemRequest.current += 1;
    };
  }, []);

  // Reset owner-scoped data before paint and before the page starts its next fetch.
  useLayoutEffect(() => {
    if (owner.current === userId) return;
    owner.current = userId;
    setDataOwner(userId);
    ownerGeneration.current += 1;
    folderRequest.current += 1;
    itemRequest.current += 1;
    selectedIdRef.current = null;
    setGalleries([]);
    setGalleryItems([]);
    setSelectedGallery(null);
    setGalleryItemsLoading(false);
    setFolderLoad({ loading: Boolean(userId), error: null });
    setGalleryItemsError(null);
  }, [userId, setGalleries, setGalleryItems, setSelectedGallery, setGalleryItemsLoading]);

  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const canRetainData = error => {
    const status = error?.response?.status;
    return !error?.response || status === 408 || status === 429 || (status >= 500 && status <= 599);
  };

  const fetchGalleries = async () => {
    if (!userId || owner.current !== userId || !mounted.current) return;
    const generation = ownerGeneration.current;
    const request = ++folderRequest.current;
    const isCurrent = () => mounted.current && owner.current === userId
      && ownerGeneration.current === generation && folderRequest.current === request;
    setFolderLoad(previous => ({ ...previous, loading: true }));
    try {
      const response = await apiClient.get(`/galleries/photographer/${userId}`);
      if (!isCurrent()) return;
      if (!Array.isArray(response?.data)) throw new Error('Invalid gallery folders response');
      setGalleries(response.data);
      setFolderLoad({ loading: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('Error fetching galleries:', error);
      if (!canRetainData(error)) setGalleries([]);
      setFolderLoad({ loading: false, error: 'Unable to load folders. Please try again.' });
    }
  };

  const fetchGalleryItems = async (galleryId) => {
    if (!userId || owner.current !== userId || !mounted.current || selectedIdRef.current !== galleryId) return;
    const generation = ownerGeneration.current;
    const request = ++itemRequest.current;
    const isCurrent = () => mounted.current && owner.current === userId
      && ownerGeneration.current === generation && itemRequest.current === request && selectedIdRef.current === galleryId;
    setGalleryItemsLoading(true);
    try {
      const response = await apiClient.get(`/galleries/${galleryId}/items?viewer_id=${userId}`);
      if (!isCurrent()) return;
      if (!Array.isArray(response?.data)) throw new Error('Invalid gallery items response');
      setGalleryItems(response.data);
      setGalleryItemsError(null);
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('Error fetching gallery items:', error);
      if (!canRetainData(error)) setGalleryItems([]);
      setGalleryItemsError('Unable to load gallery items. Please try again.');
    } finally {
      if (isCurrent()) setGalleryItemsLoading(false);
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
    if (owner.current !== userId || !mounted.current) return;
    if (selectedIdRef.current !== gal.id) setGalleryItems([]);
    selectedIdRef.current = gal.id;
    setGalleryItemsError(null);
    setSelectedGallery(gal);
    fetchGalleryItems(gal.id);
    if (gal.surf_spot_id) {
      fetchConditionsStatus(gal.id);
    } else {
      setConditionsStatus(null);
    }
  };

  const closeGalleryDetail = () => {
    if (owner.current !== userId || !mounted.current) return;
    selectedIdRef.current = null;
    itemRequest.current += 1;
    setGalleryItemsLoading(false);
    setGalleryItemsError(null);
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
      toast.success('Folder thumbnail updated!');
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
      toast.success('Thumbnail reset -- will auto-select on next load');
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
      toast.success('Set as folder cover!');
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
    galleriesLoading: folderLoad.loading,
    galleriesError: folderLoad.error,
    galleryItemsError,
    galleryOwnerMatches: dataOwner === userId,
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
