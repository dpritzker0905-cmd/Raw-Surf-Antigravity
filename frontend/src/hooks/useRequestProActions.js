/**
 * useRequestProActions.js
 * Extracted from RequestProModal.js — handler logic for on-demand pro requests.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useRequestProActions = ({
  user,
  photographer,
  crewMembers,
  onClose,
  onSuccess,
  setCredits,
  setLoading,
}) => {

  const fetchCredits = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/credits/${user.id}/balance`);
      setCredits(response.data.balance || 0);
    } catch (error) {
      logger.error('Failed to fetch credits:', error);
    }
  };

  const handlePercentageChange = (memberId, pct, setCrewMembers) => {
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId ? { ...m, percentage: pct } : m
    ));
  };

  const handleSubmit = async (requestData) => {
    setLoading(true);
    try {
      const response = await apiClient.post('/dispatch/request', {
        ...requestData,
        requester_id: user.id,
        photographer_id: photographer?.id,
        crew_members: crewMembers.filter(m => m.selected).map(m => ({
          user_id: m.id,
          split_percentage: m.percentage
        }))
      });
      
      toast.success('Request sent! Looking for your photographer...');
      onSuccess?.(response.data);
      onClose?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send request');
    } finally {
      setLoading(false);
    }
  };

  return {
    fetchCredits,
    handlePercentageChange,
    handleSubmit,
  };
};

export default useRequestProActions;
