import { useMemo } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

/**
 * useSurfAlertActions - Extracted handler logic from SurfAlerts.js
 * Handles: CRUD for alerts, push notifications, GPS, sharing
 */
export default function useSurfAlertActions({
  user,
  alerts, setAlerts, setLoading,
  newAlert, setNewAlert,
  setSpots, setUserLocation, userLocation, spots,
  spotSearchQuery, setSpotSearchQuery,
  setPushSupported, setPushEnabled,
  setShowAdvanced, setShowCreateModal, setCreateLoading,
  setEditingAlert, setIsEditMode, editingAlert, isEditMode,
  setShowShareModal, setAlertToShare, alertToShare,
  setShareRecipient, shareRecipient, setShareLoading,
  setShowSpotResults,
}) {

  const requestUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          logger.warn('Location access denied:', error);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  };

  const checkPushSupport = () => {
    if ('Notification' in window && 'serviceWorker' in navigator) {
      setPushSupported(true);
      setPushEnabled(Notification.permission === 'granted');
    }
  };

  const fetchAlerts = async () => {
    try {
      const response = await apiClient.get(`/alerts/user/${user.id}`);
      setAlerts(response.data);
    } catch (error) {
      logger.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSpots = async () => {
    try {
      const response = await apiClient.get(`/surf-spots`);
      setSpots(response.data);
    } catch (error) {
      logger.error('Error fetching spots:', error);
    }
  };
  const enablePushNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPushEnabled(true);
        toast.success('Push notifications enabled!');
        
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready;
          const vapidResponse = await apiClient.get(`/push/vapid-key`);
          
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidResponse.data.public_key
          });
          
          const subJson = subscription.toJSON();
          await apiClient.post(`/push/subscribe`, {
            endpoint: subJson.endpoint,
            p256dh_key: subJson.keys?.p256dh || '',
            auth_key: subJson.keys?.auth || '',
            user_agent: navigator.userAgent
          });
        }
      } else {
        toast.error('Please enable notifications in your browser settings');
      }
    } catch (error) {
      logger.error('Error enabling push:', error);
      toast.error('Failed to enable push notifications');
    }
  };

  const selectSpot = (spot) => {
    setNewAlert(prev => ({ 
      ...prev, 
      spot_id: spot.id, 
      spot_name: spot.name 
    }));
    setSpotSearchQuery(spot.name);
    setShowSpotResults(false);
  };

  const toggleTimeWindow = (windowId) => {
    setNewAlert(prev => ({
      ...prev,
      time_windows: prev.time_windows.includes(windowId)
        ? prev.time_windows.filter(w => w !== windowId)
        : [...prev.time_windows, windowId]
    }));
  };

  const toggleTideState = (stateId) => {
    setNewAlert(prev => ({
      ...prev,
      tide_states: prev.tide_states.includes(stateId)
        ? prev.tide_states.filter(s => s !== stateId)
        : [...prev.tide_states, stateId]
    }));
  };

  const toggleCondition = (conditionId) => {
    setNewAlert(prev => ({
      ...prev,
      preferred_conditions: prev.preferred_conditions.includes(conditionId)
        ? prev.preferred_conditions.filter(c => c !== conditionId)
        : [...prev.preferred_conditions, conditionId]
    }));
  };

  const createAlert = async () => {
    if (!newAlert.spot_id) {
      toast.error('Please select a surf spot');
      return;
    }

    setCreateLoading(true);
    try {
      await apiClient.post(`/alerts`, {
        spot_id: newAlert.spot_id,
        min_wave_height: newAlert.min_wave_height ? parseFloat(newAlert.min_wave_height) : null,
        max_wave_height: newAlert.max_wave_height ? parseFloat(newAlert.max_wave_height) : null,
        preferred_conditions: newAlert.preferred_conditions.length > 0 ? newAlert.preferred_conditions : null,
        time_windows: newAlert.time_windows.length > 0 ? newAlert.time_windows : null,
        tide_states: newAlert.tide_states.length > 0 ? newAlert.tide_states : null,
        notify_push: newAlert.notify_push
      });
      
      toast.success('Surf alert created! 🌊');
      setShowCreateModal(false);
      resetNewAlert();
      fetchAlerts();
    } catch (error) {
      if (error.response?.data?.detail === 'Alert already exists for this spot') {
        toast.error('You already have an alert for this spot');
      } else {
        toast.error('Failed to create alert');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const resetNewAlert = () => {
    setNewAlert({
      spot_id: '',
      spot_name: '',
      min_wave_height: '',
      max_wave_height: '',
      preferred_conditions: [],
      time_windows: [],
      tide_states: [],
      notify_push: true
    });
    setSpotSearchQuery('');
    setShowAdvanced(false);
    setEditingAlert(null);
    setIsEditMode(false);
  };

  const openEditModal = (alert) => {
    setEditingAlert(alert);
    setIsEditMode(true);
    // Handle both array and string formats for backwards compatibility
    const conditions = Array.isArray(alert.preferred_conditions) 
      ? alert.preferred_conditions 
      : (alert.preferred_conditions ? [alert.preferred_conditions] : []);
    setNewAlert({
      spot_id: alert.spot_id,
      spot_name: alert.spot_name,
      min_wave_height: alert.min_wave_height?.toString() || '',
      max_wave_height: alert.max_wave_height?.toString() || '',
      preferred_conditions: conditions,
      time_windows: alert.time_windows || [],
      tide_states: alert.tide_states || [],
      notify_push: alert.notify_push !== false
    });
    setSpotSearchQuery(alert.spot_name);
    // Show advanced if any advanced settings are set
    if ((alert.time_windows && alert.time_windows.length > 0) || 
        (alert.tide_states && alert.tide_states.length > 0) ||
        (conditions.length > 0)) {
      setShowAdvanced(true);
    }
    setShowCreateModal(true);
  };

  const updateAlert = async () => {
    if (!editingAlert) return;

    setCreateLoading(true);
    try {
      await apiClient.put(`/alerts/${editingAlert.id}`, {
        spot_id: newAlert.spot_id,
        min_wave_height: newAlert.min_wave_height ? parseFloat(newAlert.min_wave_height) : null,
        max_wave_height: newAlert.max_wave_height ? parseFloat(newAlert.max_wave_height) : null,
        preferred_conditions: newAlert.preferred_conditions.length > 0 ? newAlert.preferred_conditions : null,
        time_windows: newAlert.time_windows.length > 0 ? newAlert.time_windows : null,
        tide_states: newAlert.tide_states.length > 0 ? newAlert.tide_states : null,
        notify_push: newAlert.notify_push
      });
      
      toast.success('Alert updated! ✅');
      setShowCreateModal(false);
      resetNewAlert();
      fetchAlerts();
    } catch (error) {
      logger.error('Error updating alert:', error);
      toast.error('Failed to update alert');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleSaveAlert = () => {
    if (isEditMode) {
      updateAlert();
    } else {
      createAlert();
    }
  };

  const toggleAlert = async (alertId, isActive) => {
    try {
      await apiClient.patch(`/alerts/${alertId}`, { is_active: !isActive });
      setAlerts(alerts.map(a => a.id === alertId ? { ...a, is_active: !isActive } : a));
      toast.success(isActive ? 'Alert paused' : 'Alert activated');
    } catch (error) {
      toast.error('Failed to update alert');
    }
  };

  const deleteAlert = async (alertId) => {
    try {
      await apiClient.delete(`/alerts/${alertId}`);
      setAlerts(alerts.filter(a => a.id !== alertId));
      toast.success('Alert deleted');
    } catch (error) {
      toast.error('Failed to delete alert');
    }
  };

  const openShareModal = (alert) => {
    setAlertToShare(alert);
    setShareRecipient('');
    setShowShareModal(true);
  };

  const shareAlert = async () => {
    if (!shareRecipient.trim()) {
      toast.error('Please enter a username or email');
      return;
    }

    setShareLoading(true);
    try {
      await apiClient.post(`/alerts/share`, {
        alert_id: alertToShare.id,
        sender_id: user.id,
        recipient_identifier: shareRecipient.trim()
      });
      
      toast.success(`Alert shared with ${shareRecipient}! 📤`);
      setShowShareModal(false);
      setAlertToShare(null);
      setShareRecipient('');
    } catch (error) {
      if (error.response?.status === 404) {
        toast.error('User not found');
      } else {
        toast.error('Failed to share alert');
      }
    } finally {
      setShareLoading(false);
    }
  };

  const copyAlertLink = () => {
    const alertConfig = {
      spot_id: alertToShare.spot_id,
      spot_name: alertToShare.spot_name,
      min_wave_height: alertToShare.min_wave_height,
      max_wave_height: alertToShare.max_wave_height,
      preferred_conditions: alertToShare.preferred_conditions,
      time_windows: alertToShare.time_windows,
      tide_states: alertToShare.tide_states
    };
    
    const encoded = btoa(JSON.stringify(alertConfig));
    const link = `${window.location.origin}/alerts?import=${encoded}`;
    
    navigator.clipboard.writeText(link);
    toast.success('Alert link copied to clipboard!');
  };

  // Filter and sort spots based on search and GPS
  const filteredSpots = useMemo(() => {
    let result = [...spots];
    if (userLocation) {
      result = result.map(spot => ({
        ...spot,
        distance: spot.latitude && spot.longitude
          ? calculateDistance(userLocation.lat, userLocation.lng, spot.latitude, spot.longitude)
          : null
      }));
    }
    if (spotSearchQuery.trim()) {
      const query = spotSearchQuery.toLowerCase();
      result = result.filter(spot =>
        spot.name?.toLowerCase().includes(query) ||
        spot.region?.toLowerCase().includes(query) ||
        spot.city?.toLowerCase().includes(query) ||
        spot.country?.toLowerCase().includes(query)
      );
    }
    if (userLocation) {
      result.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    } else {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return result.slice(0, 15);
  }, [spots, spotSearchQuery, userLocation]);

  return {
    filteredSpots,
    requestUserLocation, checkPushSupport,
    fetchAlerts, fetchSpots,
    enablePushNotifications, selectSpot,
    toggleTimeWindow, toggleTideState, toggleCondition,
    createAlert, resetNewAlert, openEditModal,
    updateAlert, handleSaveAlert, toggleAlert, deleteAlert,
    openShareModal, shareAlert, copyAlertLink,
  };
}
