/**
 * useAdminConsoleActions.js
 * Extracted from UnifiedAdminConsole.js G handler logic for admin operations.
 * 
 * Note: useCallback-wrapped handlers (fetchData, fetchSessionData) remain in
 * the parent component. Only pure API handlers are extracted here.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useAdminConsoleActions = ({
  user,
  searchQuery,
  selectedUsers,
  setSearchResults,
  setSearchLoading,
  setSelectedUsers,
  setUsers,
  setAnalytics,
  setAnalyticsLoading,
  fetchData,
}) => {

  const handleSearch = async (query) => {
    const q = query || searchQuery;
    if (!q?.trim()) return;
    setSearchLoading(true);
    try {
      const response = await apiClient.get(`/admin/users/search?q=${encodeURIComponent(q)}`);
      setSearchResults(response.data || []);
    } catch (error) {
      toast.error('Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSuspend = async (targetUser) => {
    try {
      await apiClient.post(`/admin/users/${targetUser.id}/suspend`);
      toast.success(`${targetUser.full_name} suspended`);
      fetchData?.();
    } catch (error) {
      toast.error('Failed to suspend user');
    }
  };

  const handleUnsuspend = async (targetUser) => {
    try {
      await apiClient.post(`/admin/users/${targetUser.id}/unsuspend`);
      toast.success(`${targetUser.full_name} unsuspended`);
      fetchData?.();
    } catch (error) {
      toast.error('Failed to unsuspend user');
    }
  };

  const handleVerify = async (targetUser) => {
    try {
      await apiClient.post(`/admin/users/${targetUser.id}/verify`);
      toast.success(`${targetUser.full_name} verified`);
      fetchData?.();
    } catch (error) {
      toast.error('Failed to verify user');
    }
  };

  const handleToggleAdmin = async (targetUser) => {
    try {
      await apiClient.post(`/admin/users/${targetUser.id}/toggle-admin`);
      toast.success(`Admin toggled for ${targetUser.full_name}`);
      fetchData?.();
    } catch (error) {
      toast.error('Failed to toggle admin');
    }
  };

  const handleForceStart = async (photographerId, spotId) => {
    try {
      await apiClient.post('/admin/sessions/force-start', {
        photographer_id: photographerId,
        spot_id: spotId
      });
      toast.success('Session force-started');
      fetchData?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force-start session');
    }
  };

  const handleForceEnd = async (photographerId) => {
    try {
      await apiClient.post('/admin/sessions/force-end', {
        photographer_id: photographerId
      });
      toast.success('Session force-ended');
      fetchData?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force-end session');
    }
  };

  const handleUpdateRole = async (userId, newRole) => {
    try {
      await apiClient.put(`/admin/users/${userId}/role`, { role: newRole });
      toast.success('Role updated');
      fetchData?.();
    } catch (error) {
      toast.error('Failed to update role');
    }
  };

  const handleUpdateSubscription = async (userId, newTier) => {
    try {
      await apiClient.put(`/admin/users/${userId}/subscription`, { tier: newTier });
      toast.success('Subscription updated');
      fetchData?.();
    } catch (error) {
      toast.error('Failed to update subscription');
    }
  };

  const handleBulkUpdateRole = async (newRole) => {
    if (selectedUsers.length === 0) { toast.info('No users selected'); return; }
    try {
      await Promise.all(selectedUsers.map(id => 
        apiClient.put(`/admin/users/${id}/role`, { role: newRole })
      ));
      toast.success(`Updated role for ${selectedUsers.length} users`);
      setSelectedUsers([]);
      fetchData?.();
    } catch (error) {
      toast.error('Bulk role update failed');
    }
  };

  const handleBulkUpdateSubscription = async (newTier) => {
    if (selectedUsers.length === 0) { toast.info('No users selected'); return; }
    try {
      await Promise.all(selectedUsers.map(id => 
        apiClient.put(`/admin/users/${id}/subscription`, { tier: newTier })
      ));
      toast.success(`Updated subscription for ${selectedUsers.length} users`);
      setSelectedUsers([]);
      fetchData?.();
    } catch (error) {
      toast.error('Bulk subscription update failed');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.length === 0) { toast.info('No users selected'); return; }
    if (!window.confirm(`Delete ${selectedUsers.length} users? This cannot be undone.`)) return;
    try {
      await Promise.all(selectedUsers.map(id => apiClient.delete(`/admin/users/${id}`)));
      toast.success(`Deleted ${selectedUsers.length} users`);
      setSelectedUsers([]);
      fetchData?.();
    } catch (error) {
      toast.error('Bulk delete failed');
    }
  };

  const handleResetPassword = async (userId) => {
    try {
      await apiClient.post(`/admin/users/${userId}/reset-password`);
      toast.success('Password reset email sent');
    } catch (error) {
      toast.error('Failed to send reset email');
    }
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const response = await apiClient.get('/admin/analytics');
      setAnalytics(response.data);
    } catch (error) {
      logger.error('Failed to fetch analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleRefreshCache = async () => {
    try {
      await apiClient.post('/admin/refresh-cache');
      toast.success('Cache refreshed');
    } catch (error) {
      toast.error('Failed to refresh cache');
    }
  };

  return {
    handleSearch,
    handleSuspend,
    handleUnsuspend,
    handleVerify,
    handleToggleAdmin,
    handleForceStart,
    handleForceEnd,
    handleUpdateRole,
    handleUpdateSubscription,
    handleBulkUpdateRole,
    handleBulkUpdateSubscription,
    handleBulkDelete,
    handleResetPassword,
    fetchAnalytics,
    handleRefreshCache,
  };
};

export default useAdminConsoleActions;
