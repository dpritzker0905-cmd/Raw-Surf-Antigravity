import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

export const useGalleryGromActions = ({
  user,
  setLinkedGroms,
  setGromHighlights,
  setShowTagGromModal,
  setItemToTag
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

  const fetchGromHighlights = async () => {
    try {
      const response = await apiClient.get(`/gallery/grom-highlights/${user.id}`);
      setGromHighlights(response.data.items || []);
    } catch (error) {
      logger.error('Error fetching grom highlights:', error);
      setGromHighlights([]);
    }
  };

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

  const handleUntagGrom = async (galleryItemId, gromId) => {
    try {
      await apiClient.delete(`/gallery/untag-grom/${galleryItemId}/${gromId}?parent_id=${user.id}`);
      toast.success('Photo removed from Grom Highlights');
      fetchGromHighlights();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove tag'));
    }
  };

  return {
    fetchLinkedGroms,
    fetchGromHighlights,
    handleTagGrom,
    handleUntagGrom
  };
};

export default useGalleryGromActions;
