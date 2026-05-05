/**
 * useSettingsActions.js - Extracted from Settings.js
 * Settings: privacy, notifications, logout.
 * 7 pure handlers.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useSettingsActions = ({
  user, navigate, logout,
  setExpandedSections,
  setFriends,
  setFriendsLoading,
  setNotifLoading,
  setNotifPrefs,
  setPendingRequests,
  setPrivacy,
  setPrivacyLoading,
}) => {

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const fetchPrivacySettings = async () => {
    try {
      const response = await apiClient.get(`/friends/privacy/${user.id}`);
      setPrivacy(response.data);
    } catch (error) {
      logger.error('Failed to fetch privacy settings:', error);
    }
  };

  const fetchNotificationPrefs = async () => {
    try {
      const response = await getPreferencesByPath(user.id);
      setNotifPrefs(response.data);
    } catch (error) {
      logger.error('Failed to fetch notification preferences:', error);
    }
  };

  const updateNotifPref = async (key, value) => {
    setNotifLoading(true);
    try {
      await updatePreferenceByPath(user.id, key, value);
      setNotifPrefs(prev => ({ ...prev, [key]: value }));
      toast.success('Notification setting updated');
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setNotifLoading(false);
    }
  };

  const updatePrivacySetting = async (key, value) => {
    setPrivacyLoading(true);
    try {
      await apiClient.put(`/friends/privacy/${user.id}`, { [key]: value });
      setPrivacy(prev => ({ ...prev, [key]: value }));
      toast.success('Privacy setting updated');
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setPrivacyLoading(false);
    }
  };

  const fetchFriends = async () => {
    setFriendsLoading(true);
    try {
      const [friendsRes, pendingRes] = await Promise.all([
        apiClient.get(`/friends/list/${user.id}`),
        apiClient.get(`/friends/pending/${user.id}`)
      ]);
      setFriends(friendsRes.data.friends || []);
      setPendingRequests(pendingRes.data.pending_requests || []);
    } catch (error) {
      logger.error('Failed to fetch friends:', error);
    } finally {
      setFriendsLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/auth');
    toast.success('Logged out successfully');
  };


  return {
    toggleSection,
    fetchPrivacySettings,
    fetchNotificationPrefs,
    updateNotifPref,
    updatePrivacySetting,
    fetchFriends,
    handleLogout,
  };
};

export default useSettingsActions;