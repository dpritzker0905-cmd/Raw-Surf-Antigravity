import { useLayoutEffect, useRef, useState } from 'react';
import apiClient from '../lib/apiClient';
import { copyGalleryItem } from '../lib/copyGalleryItem';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

export const useGalleryFolderActions = ({
  user,
  selectedGallery,
  showAddToGalleryModal,
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
  const folderVisit = useRef(null);
  const pickerVisit = useRef(0);
  const ownerId = user?.id;
  const destination = JSON.stringify([ownerId, selectedGallery?.id]);
  const galleriesRead = useRef(0);
  const itemsRead = useRef(0);
  const pendingCopies = useRef(new Set());
  const [busyFolders, setBusyFolders] = useState(() => new Set());

  useLayoutEffect(() => {
    folderVisit.current = { destination, ownerId };
    return () => { folderVisit.current = null; };
  }, [destination, ownerId]);

  useLayoutEffect(() => { pickerVisit.current += 1; }, [showAddToGalleryModal]);
  useLayoutEffect(() => () => {
    galleriesRead.current += 1;
    itemsRead.current += 1;
  }, [ownerId]);

  const fetchGalleries = async () => {
    const read = ++galleriesRead.current;
    try {
      const response = await apiClient.get(`/galleries/photographer/${user.id}`);
      if (galleriesRead.current === read) setGalleries(response.data || []);
    } catch (error) {
      logger.error('Error fetching galleries:', error);
      if (galleriesRead.current === read) setGalleries([]);
    }
  };

  const fetchGalleryItems = async (galleryId, visit) => {
    const read = ++itemsRead.current;
    const isCurrent = () => itemsRead.current === read && (!visit || folderVisit.current === visit);
    setGalleryItemsLoading(true);
    try {
      const response = await apiClient.get(`/galleries/${galleryId}/items?viewer_id=${user.id}`);
      if (isCurrent()) setGalleryItems(response.data || []);
    } catch (error) {
      logger.error('Error fetching gallery items:', error);
      if (isCurrent()) setGalleryItems([]);
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
    const visit = folderVisit.current;
    const picker = pickerVisit.current;
    if (!ownerId || !selectedGallery || visit?.destination !== destination) return;
    if (pendingCopies.current.has(destination)) return;
    pendingCopies.current.add(destination);
    setBusyFolders(new Set(pendingCopies.current));
    try {
      await copyGalleryItem(ownerId, itemId, selectedGallery.id);
      const currentVisit = folderVisit.current;
      if (currentVisit?.ownerId !== ownerId) return;
      const listRefresh = fetchGalleries();
      if (currentVisit.destination !== destination) {
        await listRefresh;
        return;
      }
      toast.success('Photo added to gallery');
      if (currentVisit === visit && pickerVisit.current === picker) setShowAddToGalleryModal(false);
      await Promise.all([fetchGalleryItems(selectedGallery.id, currentVisit), listRefresh]);
    } catch (error) {
      if (folderVisit.current?.destination === destination) {
        toast.error(getErrorMessage(error, 'Failed to add photo'));
      }
    } finally {
      pendingCopies.current.delete(destination);
      if (folderVisit.current) setBusyFolders(new Set(pendingCopies.current));
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
    itemsRead.current += 1;
    setGalleryItemsLoading(false);
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
    addingLibraryPhoto: busyFolders.has(destination),
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
