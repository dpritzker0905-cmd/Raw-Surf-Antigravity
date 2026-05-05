/**
 * useSpotHubActions.js
 * Extracted from SpotHub.js — handler logic for spot detail pages.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useSpotHubActions = ({
  user,
  spotId,
  navigate,
  setLoading,
  setSpotData,
  setPhotographers,
  setConditionReports,
  setLivePhotographers,
  setLivePulse,
  setIntelData,
  setShowConditionForm,
  setShowBookingDrawer,
  setSelectedPhotographer,
  setBookingType,
}) => {

  const fetchAllSpotData = async () => {
    setLoading(true);
    try {
      const [spotRes, photosRes, reportsRes, liveRes] = await Promise.allSettled([
        apiClient.get(`/surf-spots/${spotId}`),
        apiClient.get(`/surf-spots/${spotId}/photographers`),
        apiClient.get(`/surf-spots/${spotId}/condition-reports`),
        apiClient.get(`/photographers/live`)
      ]);

      if (spotRes.status === 'fulfilled') setSpotData(spotRes.value.data);
      if (photosRes.status === 'fulfilled') setPhotographers(photosRes.value.data || []);
      if (reportsRes.status === 'fulfilled') setConditionReports(reportsRes.value.data || []);
      
      if (liveRes.status === 'fulfilled') {
        const livePros = (liveRes.value.data || []).filter(p => 
          p.current_spot_id === spotId || p.spot_id === spotId
        );
        setLivePhotographers(livePros);
      }
    } catch (error) {
      logger.error('Error fetching spot data:', error);
      toast.error('Failed to load spot data');
    } finally {
      setLoading(false);
    }
  };

  const fetchLivePulse = async () => {
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/live-pulse`);
      setLivePulse(response.data);
    } catch (error) {
      logger.error('Error fetching live pulse:', error);
    }
  };

  const fetchIntelData = async () => {
    try {
      const response = await apiClient.get(`/surf-spots/${spotId}/intel`);
      setIntelData(response.data);
    } catch (error) {
      logger.debug('Intel data not available:', error);
    }
  };

  const handleSubmitConditionReport = async (formData) => {
    try {
      await apiClient.post(`/surf-spots/${spotId}/condition-reports`, {
        ...formData,
        reporter_id: user.id
      });
      toast.success('Condition report submitted!');
      setShowConditionForm(false);
      fetchAllSpotData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit report');
    }
  };

  const handleReportConditionReport = async (reportId) => {
    try {
      await apiClient.post(`/surf-spots/condition-reports/${reportId}/report`, {
        reporter_id: user.id,
        reason: 'Inaccurate conditions'
      });
      toast.success('Report flagged for review');
    } catch (error) {
      toast.error('Failed to report');
    }
  };

  const handleClose = () => {
    navigate(-1);
  };

  const handleBookingTypeSelect = (bookingType, photographer) => {
    setBookingType(bookingType);
    setSelectedPhotographer(photographer);
    setShowBookingDrawer(true);
  };

  const handleOpenBookingModal = (photographer) => {
    setSelectedPhotographer(photographer);
    setShowBookingDrawer(true);
  };

  return {
    fetchAllSpotData,
    fetchLivePulse,
    fetchIntelData,
    handleSubmitConditionReport,
    handleReportConditionReport,
    handleClose,
    handleBookingTypeSelect,
    handleOpenBookingModal,
  };
};

export default useSpotHubActions;
