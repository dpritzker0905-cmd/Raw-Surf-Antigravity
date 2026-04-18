import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { 
  Bell, BellRing, Plus, Trash2, MapPin, Waves, Loader2, X, Check, BellOff,
  Search, Target, Clock, Sun, Sunrise, Sunset, Share2, Copy, 
  ChevronDown, ChevronUp, Droplets, ArrowUp, ArrowDown, Minus, Pencil, Settings
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Time window options
const TIME_WINDOWS = [
  { id: 'dawn', label: 'Dawn Patrol', icon: Sunrise, time: '5am - 8am', color: 'text-orange-400' },
  { id: 'morning', label: 'Morning', icon: Sun, time: '8am - 12pm', color: 'text-yellow-400' },
  { id: 'afternoon', label: 'Afternoon', icon: Sun, time: '12pm - 5pm', color: 'text-amber-400' },
  { id: 'evening', label: 'Evening', icon: Sunset, time: '5pm - 8pm', color: 'text-purple-400' },
];

// Tide state options
const TIDE_STATES = [
  { id: 'low', label: 'Low Tide', icon: ArrowDown, color: 'text-cyan-400' },
  { id: 'mid', label: 'Mid Tide', icon: Minus, color: 'text-blue-400' },
  { id: 'high', label: 'High Tide', icon: ArrowUp, color: 'text-indigo-400' },
  { id: 'rising', label: 'Rising', icon: ArrowUp, color: 'text-emerald-400' },
  { id: 'falling', label: 'Falling', icon: ArrowDown, color: 'text-amber-400' },
];

// Surf condition options
const SURF_CONDITIONS = [
  // Surface conditions
  { id: 'glassy', label: 'Glassy', description: 'Mirror-like surface', category: 'surface', emoji: '🪞' },
  { id: 'clean', label: 'Clean', description: 'Light texture, good shape', category: 'surface', emoji: '✨' },
  { id: 'choppy', label: 'Choppy', description: 'Bumpy, textured surface', category: 'surface', emoji: '🌊' },
  { id: 'messy', label: 'Messy', description: 'Disorganized waves', category: 'surface', emoji: '💨' },
  
  // Wind conditions
  { id: 'offshore', label: 'Offshore Wind', description: 'Wind from land to sea', category: 'wind', emoji: '🌬️' },
  { id: 'onshore', label: 'Onshore Wind', description: 'Wind from sea to land', category: 'wind', emoji: '💨' },
  { id: 'cross-shore', label: 'Cross-shore', description: 'Side wind', category: 'wind', emoji: '↔️' },
  { id: 'light-wind', label: 'Light Wind', description: 'Under 10 knots', category: 'wind', emoji: '🍃' },
  { id: 'no-wind', label: 'No Wind', description: 'Calm conditions', category: 'wind', emoji: '😌' },
  
  // Wave quality
  { id: 'hollow', label: 'Hollow', description: 'Barreling waves', category: 'quality', emoji: '🫗' },
  { id: 'steep', label: 'Steep', description: 'Fast, vertical faces', category: 'quality', emoji: '📐' },
  { id: 'mellow', label: 'Mellow', description: 'Gentle, forgiving waves', category: 'quality', emoji: '😊' },
  { id: 'powerful', label: 'Powerful', description: 'Strong, heavy waves', category: 'quality', emoji: '💪' },
  { id: 'peaky', label: 'Peaky', description: 'A-frame peaks', category: 'quality', emoji: '⛰️' },
  { id: 'walled', label: 'Walled', description: 'Long, unbroken faces', category: 'quality', emoji: '🧱' },
  
  // Crowd conditions
  { id: 'uncrowded', label: 'Uncrowded', description: 'Few surfers out', category: 'crowd', emoji: '🏝️' },
];

// Calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const SurfAlerts = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const highlightedAlertRef = useRef(null);
  
  const [alerts, setAlerts] = useState([]);
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Highlight state for notification deep linking
  const [highlightedAlertId, setHighlightedAlertId] = useState(null);
  
  // Edit mode state
  const [editingAlert, setEditingAlert] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  
  // GPS and search state
  const [userLocation, setUserLocation] = useState(null);
  const [spotSearchQuery, setSpotSearchQuery] = useState('');
  const [showSpotResults, setShowSpotResults] = useState(false);
  
  // Share alert state
  const [showShareModal, setShowShareModal] = useState(false);
  const [alertToShare, setAlertToShare] = useState(null);
  const [shareRecipient, setShareRecipient] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  
  // New alert state with enhanced fields
  const [newAlert, setNewAlert] = useState({
    spot_id: '',
    spot_name: '',
    min_wave_height: '',
    max_wave_height: '',
    preferred_conditions: [], // Array of condition IDs
    time_windows: [], // ['dawn', 'morning', 'afternoon', 'evening']
    tide_states: [],  // ['low', 'mid', 'high', 'rising', 'falling']
    notify_push: true
  });

  useEffect(() => {
    if (user?.id) {
      fetchAlerts();
      fetchSpots();
      checkPushSupport();
      requestUserLocation();
    }
  }, [user?.id]);

  // Handle deep link to specific alert from notifications
  useEffect(() => {
    const alertId = searchParams.get('alert_id') || location.state?.alertId;
    if (alertId && alerts.length > 0) {
      setHighlightedAlertId(alertId);
      // Scroll to the alert after a short delay
      setTimeout(() => {
        if (highlightedAlertRef.current) {
          highlightedAlertRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
      // Remove highlight after 3 seconds
      setTimeout(() => setHighlightedAlertId(null), 3000);
    }
  }, [searchParams, location.state, alerts]);

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
      const response = await axios.get(`${API}/alerts/user/${user.id}`);
      setAlerts(response.data);
    } catch (error) {
      logger.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSpots = async () => {
    try {
      const response = await axios.get(`${API}/surf-spots`);
      setSpots(response.data);
    } catch (error) {
      logger.error('Error fetching spots:', error);
    }
  };

  // Filter and sort spots based on search and GPS
  const filteredSpots = useMemo(() => {
    let result = [...spots];
    
    // Add distance if GPS available
    if (userLocation) {
      result = result.map(spot => ({
        ...spot,
        distance: spot.latitude && spot.longitude 
          ? calculateDistance(userLocation.lat, userLocation.lng, spot.latitude, spot.longitude)
          : null
      }));
    }
    
    // Filter by search query
    if (spotSearchQuery.trim()) {
      const query = spotSearchQuery.toLowerCase();
      result = result.filter(spot =>
        spot.name?.toLowerCase().includes(query) ||
        spot.region?.toLowerCase().includes(query) ||
        spot.city?.toLowerCase().includes(query) ||
        spot.country?.toLowerCase().includes(query)
      );
    }
    
    // Sort by distance if GPS available, otherwise alphabetically
    if (userLocation) {
      result.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    } else {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    
    return result.slice(0, 15); // Limit results
  }, [spots, spotSearchQuery, userLocation]);

  const enablePushNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPushEnabled(true);
        toast.success('Push notifications enabled!');
        
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready;
          const vapidResponse = await axios.get(`${API}/push/vapid-key`);
          
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidResponse.data.public_key
          });
          
          const subJson = subscription.toJSON();
          await axios.post(`${API}/push/subscribe?user_id=${user.id}`, {
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
      await axios.post(`${API}/alerts?user_id=${user.id}`, {
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
      await axios.put(`${API}/alerts/${editingAlert.id}`, {
        spot_id: newAlert.spot_id,
        min_wave_height: newAlert.min_wave_height ? parseFloat(newAlert.min_wave_height) : null,
        max_wave_height: newAlert.max_wave_height ? parseFloat(newAlert.max_wave_height) : null,
        preferred_conditions: newAlert.preferred_conditions.length > 0 ? newAlert.preferred_conditions : null,
        time_windows: newAlert.time_windows.length > 0 ? newAlert.time_windows : null,
        tide_states: newAlert.tide_states.length > 0 ? newAlert.tide_states : null,
        notify_push: newAlert.notify_push
      });
      
      toast.success('Alert updated! 🌊');
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
      await axios.patch(`${API}/alerts/${alertId}`, { is_active: !isActive });
      setAlerts(alerts.map(a => a.id === alertId ? { ...a, is_active: !isActive } : a));
      toast.success(isActive ? 'Alert paused' : 'Alert activated');
    } catch (error) {
      toast.error('Failed to update alert');
    }
  };

  const deleteAlert = async (alertId) => {
    try {
      await axios.delete(`${API}/alerts/${alertId}`);
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
      await axios.post(`${API}/alerts/share`, {
        alert_id: alertToShare.id,
        sender_id: user.id,
        recipient_identifier: shareRecipient.trim()
      });
      
      toast.success(`Alert shared with ${shareRecipient}! 🎉`);
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

  // Check for imported alert on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const importData = params.get('import');
    
    if (importData && user?.id) {
      try {
        const alertConfig = JSON.parse(atob(importData));
        setNewAlert({
          spot_id: alertConfig.spot_id || '',
          spot_name: alertConfig.spot_name || '',
          min_wave_height: alertConfig.min_wave_height?.toString() || '',
          max_wave_height: alertConfig.max_wave_height?.toString() || '',
          preferred_conditions: alertConfig.preferred_conditions || '',
          time_windows: alertConfig.time_windows || [],
          tide_states: alertConfig.tide_states || [],
          notify_push: true
        });
        setSpotSearchQuery(alertConfig.spot_name || '');
        setShowCreateModal(true);
        toast.info('Alert configuration loaded! Review and create.');
        
        // Clean URL
        window.history.replaceState({}, '', '/alerts');
      } catch (e) {
        logger.error('Failed to parse imported alert:', e);
      }
    }
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 bg-background min-h-screen" data-testid="surf-alerts-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: 'Oswald' }}>
            <BellRing className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />
            Surf Alerts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Get notified when conditions are perfect</p>
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          className="bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
          data-testid="create-alert-btn"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Alert
        </Button>
      </div>

      {/* Push Notification Banner */}
      {pushSupported && !pushEnabled && (
        <Card className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-500/30 mb-6">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-8 h-8 text-blue-400" />
              <div>
                <p className="text-white font-medium">Enable Push Notifications</p>
                <p className="text-sm text-gray-400">Get instant alerts when conditions match</p>
              </div>
            </div>
            <Button onClick={enablePushNotifications} className="bg-blue-500 hover:bg-blue-600 text-white">
              Enable
            </Button>
          </CardContent>
        </Card>
      )}

      {pushEnabled && (
        <div className="flex items-center gap-2 mb-4 text-emerald-400 text-sm">
          <Check className="w-4 h-4" />
          Push notifications enabled
        </div>
      )}

      {/* Alerts List */}
      {alerts.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <BellOff className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-bold text-foreground mb-2">No Alerts Yet</h3>
            <p className="text-muted-foreground mb-4">Create an alert to get notified when your favorite spot is firing!</p>
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
            >
              Create Your First Alert
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Card 
              key={alert.id}
              ref={alert.id === highlightedAlertId ? highlightedAlertRef : null}
              className={`bg-card border-border transition-all duration-500 ${
                !alert.is_active ? 'opacity-50' : ''
              } ${
                alert.id === highlightedAlertId 
                  ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-background animate-pulse' 
                  : ''
              }`}
              data-testid={`alert-card-${alert.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Spot Image */}
                  <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                    {alert.spot_image ? (
                      <img src={alert.spot_image} alt={alert.spot_name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MapPin className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Alert Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-foreground truncate">{alert.spot_name}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(alert)}
                          className="p-1 text-gray-400 hover:text-yellow-400 transition-colors"
                          title="Edit alert"
                          data-testid={`edit-alert-${alert.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openShareModal(alert)}
                          className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
                          title="Share alert"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                        <Switch
                          checked={alert.is_active}
                          onCheckedChange={() => toggleAlert(alert.id, alert.is_active)}
                        />
                        <button
                          onClick={() => deleteAlert(alert.id)}
                          className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-2">
                      {alert.min_wave_height && (
                        <Badge className="bg-blue-500/20 text-blue-400">
                          <Waves className="w-3 h-3 mr-1" />
                          {alert.min_wave_height}ft+
                        </Badge>
                      )}
                      {alert.max_wave_height && (
                        <Badge className="bg-blue-500/20 text-blue-400">
                          Max {alert.max_wave_height}ft
                        </Badge>
                      )}
                      {alert.preferred_conditions && (
                        <>
                          {(Array.isArray(alert.preferred_conditions) ? alert.preferred_conditions : [alert.preferred_conditions]).map(condId => {
                            const condition = SURF_CONDITIONS.find(c => c.id === condId);
                            if (!condition) {
                              // Fallback for legacy string values
                              return (
                                <Badge key={condId} className="bg-emerald-500/20 text-emerald-400">
                                  {condId}
                                </Badge>
                              );
                            }
                            return (
                              <Badge key={condId} className="bg-emerald-500/20 text-emerald-400 text-xs">
                                <span className="mr-1">{condition.emoji}</span>
                                {condition.label}
                              </Badge>
                            );
                          })}
                        </>
                      )}
                    </div>
                    
                    {/* Time Windows & Tide States */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {alert.time_windows?.map(tw => {
                        const window = TIME_WINDOWS.find(w => w.id === tw);
                        if (!window) return null;
                        const Icon = window.icon;
                        return (
                          <Badge key={tw} className="bg-purple-500/20 text-purple-400 text-xs">
                            <Icon className="w-3 h-3 mr-1" />
                            {window.label}
                          </Badge>
                        );
                      })}
                      {alert.tide_states?.map(ts => {
                        const state = TIDE_STATES.find(s => s.id === ts);
                        if (!state) return null;
                        const Icon = state.icon;
                        return (
                          <Badge key={ts} className="bg-cyan-500/20 text-cyan-400 text-xs">
                            <Icon className="w-3 h-3 mr-1" />
                            {state.label}
                          </Badge>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Triggered {alert.trigger_count || 0} times</span>
                      {alert.last_triggered && (
                        <span>Last: {new Date(alert.last_triggered).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Alert Modal */}
      <Dialog open={showCreateModal} onOpenChange={(open) => { setShowCreateModal(open); if (!open) resetNewAlert(); }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[95vw] sm:w-full max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col p-0 sm:rounded-2xl gap-0">
          <DialogHeader className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/95 sticky top-0 z-10 shrink-0">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <BellRing className="w-5 h-5 text-yellow-400" />
              {isEditMode ? 'Edit Surf Alert' : 'Create Surf Alert'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto p-5 space-y-5 overscroll-contain">
            {/* Spot Selection with Search & GPS */}
            <div>
              <label className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                Surf Spot *
                {userLocation && (
                  <Badge className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0 border-green-500/30">
                    <Target className="w-3 h-3 mr-1" />
                    GPS Active
                  </Badge>
                )}
              </label>
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type="text"
                  placeholder={userLocation ? "Search or pick nearby spot..." : "Search for a spot..."}
                  value={spotSearchQuery}
                  onChange={(e) => {
                     setSpotSearchQuery(e.target.value);
                    setShowSpotResults(true);
                    if (!e.target.value) {
                      setNewAlert(prev => ({ ...prev, spot_id: '', spot_name: '' }));
                    }
                  }}
                  onFocus={() => setShowSpotResults(true)}
                  className="pl-10 pr-10 bg-zinc-950 border-zinc-800 text-white focus:ring-yellow-500/50 rounded-xl rounded-b-xl" // Added rounded-b-xl
                  data-testid="spot-search-input"
                />
                {spotSearchQuery && (
                  <button
                    onClick={() => {
                      setSpotSearchQuery('');
                      setNewAlert(prev => ({ ...prev, spot_id: '', spot_name: '' }));
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-800 rounded-full transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-400 hover:text-white" />
                  </button>
                )}
              </div>
              
              {/* Spot Results Dropdown */}
              {showSpotResults && (spotSearchQuery || userLocation) && (
                <div className="mt-2 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto shadow-2xl">
                  {filteredSpots.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 text-sm">
                      {spotSearchQuery ? 'No spots found' : 'Start typing to search'}
                    </div>
                  ) : (
                    filteredSpots.map((spot) => (
                      <button
                        key={spot.id}
                        onClick={() => selectSpot(spot)}
                        className={`w-full flex items-center gap-3 p-3 hover:bg-zinc-800 transition-colors text-left border-b border-zinc-800/50 last:border-0 ${
                          newAlert.spot_id === spot.id ? 'bg-yellow-500/10' : ''
                        }`}
                        data-testid={`spot-option-${spot.id}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${newAlert.spot_id === spot.id ? 'bg-yellow-500/20' : 'bg-zinc-800'}`}>
                          <MapPin className={`w-4 h-4 ${newAlert.spot_id === spot.id ? 'text-yellow-400' : 'text-gray-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate text-sm flex items-center gap-2 ${newAlert.spot_id === spot.id ? 'text-yellow-400' : 'text-white'}`}>
                            {spot.name}
                            {newAlert.spot_id === spot.id && <Check className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
                          </p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {spot.region || spot.city || spot.country || 'Unknown location'}
                          </p>
                        </div>
                        {spot.distance !== null && spot.distance !== undefined && (
                          <div className={`text-xs font-medium px-2 py-1 rounded-md flex-shrink-0 tracking-wide ${spot.distance < 5 ? 'bg-green-500/10 text-green-400' : 'bg-zinc-800 text-gray-400'}`}>
                            {spot.distance < 0.1 ? '<0.1' : spot.distance.toFixed(1)} mi
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Wave Height Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Min Wave Height</label>
                <Select value={newAlert.min_wave_height} onValueChange={(v) => setNewAlert(prev => ({ ...prev, min_wave_height: v }))}>
                  <SelectTrigger className="bg-zinc-950 border-zinc-800 text-white rounded-xl">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-zinc-800 rounded-xl">
                    <SelectItem value="2" className="text-white">2ft+</SelectItem>
                    <SelectItem value="3" className="text-white">3ft+</SelectItem>
                    <SelectItem value="4" className="text-white">4ft+</SelectItem>
                    <SelectItem value="5" className="text-white">5ft+</SelectItem>
                    <SelectItem value="6" className="text-white">6ft+ (OH)</SelectItem>
                    <SelectItem value="8" className="text-white">8ft+ (DOH)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Max Wave Height</label>
                <Select value={newAlert.max_wave_height} onValueChange={(v) => setNewAlert(prev => ({ ...prev, max_wave_height: v }))}>
                  <SelectTrigger className="bg-zinc-950 border-zinc-800 text-white rounded-xl">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-zinc-800 rounded-xl">
                    <SelectItem value="4" className="text-white">Up to 4ft</SelectItem>
                    <SelectItem value="6" className="text-white">Up to 6ft</SelectItem>
                    <SelectItem value="8" className="text-white">Up to 8ft</SelectItem>
                    <SelectItem value="10" className="text-white">Up to 10ft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Time Window Preference */}
            <div>
              <label className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-400" />
                Preferred Time Windows
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TIME_WINDOWS.map((window) => {
                  const Icon = window.icon;
                  const isSelected = newAlert.time_windows.includes(window.id);
                  return (
                    <button
                      key={window.id}
                      onClick={() => toggleTimeWindow(window.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-purple-500/10 border-purple-500/40 shadow-[inset_0_0_12px_rgba(168,85,247,0.15)]'
                          : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
                      }`}
                      data-testid={`time-window-${window.id}`}
                    >
                      <div className={`p-1.5 rounded-md ${isSelected ? 'bg-purple-500/20' : 'bg-transparent'}`}>
                        <Icon className={`w-4 h-4 ${isSelected ? 'text-purple-400' : 'text-gray-500'}`} />
                      </div>
                      <div className="text-left flex-1">
                        <p className={`text-sm font-medium ${isSelected ? 'text-purple-300' : 'text-gray-300'}`}>{window.label}</p>
                        <p className={`text-[10px] ${isSelected ? 'text-purple-400/70' : 'text-gray-500'}`}>{window.time}</p>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-purple-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500 mt-2 px-1">Leave empty for any time</p>
            </div>

            {/* Tide State Preference */}
            <div>
              <label className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <Droplets className="w-4 h-4 text-cyan-400" />
                Preferred Tide
              </label>
              <div className="flex flex-wrap gap-2">
                {TIDE_STATES.map((state) => {
                  const Icon = state.icon;
                  const isSelected = newAlert.tide_states.includes(state.id);
                  return (
                    <button
                      key={state.id}
                      onClick={() => toggleTideState(state.id)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-cyan-500/10 border-cyan-500/40 shadow-[inset_0_0_12px_rgba(6,182,212,0.15)] text-cyan-300'
                          : 'bg-zinc-950 border-zinc-800 text-gray-400 hover:border-zinc-700 hover:bg-zinc-900'
                      }`}
                      data-testid={`tide-state-${state.id}`}
                    >
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-cyan-400' : 'text-gray-500'}`} />
                      <span className="text-sm font-medium">{state.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 ml-1 text-cyan-400" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500 mt-2 px-1">Leave empty for any tide</p>
            </div>

            {/* Advanced Options Toggle */}
            <div className="pt-2">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-2 font-medium text-sm text-gray-300">
                  <Settings className="w-4 h-4 text-yellow-500/70" />
                  Advanced Conditions
                </div>
                {showAdvanced ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
              </button>
            </div>

            {showAdvanced && (
              <div className="space-y-5 px-1 animate-in slide-in-from-top-1 fade-in duration-200 block">
                <div className="bg-zinc-950/50 rounded-2xl p-4 border border-zinc-800/50">
                  <label className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                    <Waves className="w-4 h-4 text-blue-400" />
                    Specific Conditions
                  </label>
                  <p className="text-xs text-gray-400 mb-5">Select all specific traits you require. Leave blank if you don't care.</p>
                  
                  {/* Surface Conditions */}
                  <div className="mb-4">
                    <p className="text-[11px] text-blue-400/80 font-semibold mb-2 uppercase tracking-wider">Surface</p>
                    <div className="flex flex-wrap gap-2">
                      {SURF_CONDITIONS.filter(c => c.category === 'surface').map((condition) => (
                        <button
                          key={condition.id}
                          type="button"
                          onClick={() => toggleCondition(condition.id)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                            newAlert.preferred_conditions.includes(condition.id)
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                              : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                          }`}
                        >
                          <span className="text-base leading-none">{condition.emoji}</span>
                          {condition.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Wind Conditions */}
                  <div className="mb-4">
                    <p className="text-[11px] text-emerald-400/80 font-semibold mb-2 uppercase tracking-wider">Wind</p>
                    <div className="flex flex-wrap gap-2">
                      {SURF_CONDITIONS.filter(c => c.category === 'wind').map((condition) => (
                        <button
                          key={condition.id}
                          type="button"
                          onClick={() => toggleCondition(condition.id)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                            newAlert.preferred_conditions.includes(condition.id)
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                              : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                          }`}
                        >
                          <span className="text-base leading-none">{condition.emoji}</span>
                          {condition.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Wave Quality */}
                  <div className="mb-4">
                    <p className="text-[11px] text-purple-400/80 font-semibold mb-2 uppercase tracking-wider">Wave Quality</p>
                    <div className="flex flex-wrap gap-2">
                      {SURF_CONDITIONS.filter(c => c.category === 'quality').map((condition) => (
                        <button
                          key={condition.id}
                          type="button"
                          onClick={() => toggleCondition(condition.id)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                            newAlert.preferred_conditions.includes(condition.id)
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                              : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                          }`}
                        >
                          <span className="text-base leading-none">{condition.emoji}</span>
                          {condition.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Crowd */}
                  <div>
                    <p className="text-[11px] text-amber-400/80 font-semibold mb-2 uppercase tracking-wider">Other / Vibe</p>
                    <div className="flex flex-wrap gap-2">
                      {SURF_CONDITIONS.filter(c => c.category === 'crowd').map((condition) => (
                        <button
                          key={condition.id}
                          type="button"
                          onClick={() => toggleCondition(condition.id)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                            newAlert.preferred_conditions.includes(condition.id)
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                              : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                          }`}
                        >
                          <span className="text-base leading-none">{condition.emoji}</span>
                          {condition.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Push Toggle & Actions */}
            <div className="pt-2 pb-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-yellow-500/10 p-2 rounded-lg">
                    <Bell className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Push Notifications</p>
                    <p className="text-[11px] text-gray-400">Get instant alerts on your phone</p>
                  </div>
                </div>
                <Switch
                  checked={newAlert.notify_push}
                  onCheckedChange={(checked) => setNewAlert(prev => ({ ...prev, notify_push: checked }))}
                  className="data-[state=checked]:bg-yellow-500"
                />
              </div>

              <Button
                onClick={handleSaveAlert}
                disabled={createLoading || !newAlert.spot_id}
                className="w-full h-14 rounded-xl bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold shadow-lg shadow-yellow-500/20 text-base"
                data-testid={isEditMode ? "update-alert-submit" : "create-alert-submit"}
              >
                {createLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isEditMode ? 'Update Alert Configuration' : 'Create Surf Alert')}
              </Button>
            </div>

          </div>
        </DialogContent>
      </Dialog>

      {/* Share Alert Modal */}
      <Dialog open={showShareModal} onOpenChange={setShowShareModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[95vw] sm:w-full max-w-sm max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col p-0 sm:rounded-2xl gap-0">
          <DialogHeader className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/95 sticky top-0 z-10 shrink-0">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Share2 className="w-5 h-5 text-blue-400" />
              Share Alert
            </DialogTitle>
          </DialogHeader>
          
          {alertToShare && (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl">
                <p className="text-white font-medium">{alertToShare.spot_name}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {alertToShare.min_wave_height && (
                    <Badge className="bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 border-blue-500/30">{alertToShare.min_wave_height}ft+</Badge>
                  )}
                  {alertToShare.time_windows?.map(tw => (
                    <Badge key={tw} className="bg-purple-500/20 text-purple-400 text-xs px-2 py-0.5 border-purple-500/30">{tw}</Badge>
                  ))}
                  {alertToShare.tide_states?.map(ts => (
                    <Badge key={ts} className="bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 border-cyan-500/30">{ts}</Badge>
                  ))}
                </div>
              </div>
              
              {/* Share with user */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300 block">Share with user</label>
                <Input
                  type="text"
                  placeholder="Username or email"
                  value={shareRecipient}
                  onChange={(e) => setShareRecipient(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 text-white h-11 rounded-xl focus:ring-blue-500/50"
                  data-testid="share-recipient-input"
                />
              </div>
              
              <Button
                onClick={shareAlert}
                disabled={shareLoading || !shareRecipient.trim()}
                className="w-full h-12 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold shadow-lg shadow-blue-500/20"
              >
                {shareLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Alert Directly'}
              </Button>
              
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wider font-semibold">
                  <span className="bg-zinc-900 px-3 text-gray-500">or link</span>
                </div>
              </div>
              
              {/* Copy link */}
              <Button
                onClick={copyAlertLink}
                variant="outline"
                className="w-full h-12 rounded-xl border-zinc-700 bg-zinc-950 text-white hover:bg-zinc-800 hover:text-white"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy Alert Link
              </Button>
              
              <p className="text-xs text-gray-500 text-center px-4 leading-relaxed">
                Anyone with the link can import this alert configuration to their profile
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
