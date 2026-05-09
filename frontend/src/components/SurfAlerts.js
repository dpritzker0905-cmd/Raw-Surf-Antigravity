import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation, useSearchParams } from 'react-router-dom';
import { 
  Bell, BellRing, Plus, Trash2, MapPin, Waves, Loader2, X, Check, BellOff,
  Share2, Copy, Pencil
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { AlertCardSkeleton } from './ui/SkeletonVariants';
import useSurfAlertActions from '../hooks/useSurfAlertActions';
import SurfAlertModal from './alerts/SurfAlertModal';


// Time window options
import { TIME_WINDOWS, TIDE_STATES, SURF_CONDITIONS } from './alerts/surfAlertConstants';
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

  // ============ HANDLERS EXTRACTED TO hooks/useSurfAlertActions.js ============
  const {
    filteredSpots,
    requestUserLocation, checkPushSupport,
    fetchAlerts, fetchSpots,
    enablePushNotifications, selectSpot,
    toggleTimeWindow, toggleTideState, toggleCondition,
    createAlert, resetNewAlert, openEditModal,
    updateAlert, handleSaveAlert, toggleAlert, deleteAlert,
    openShareModal, shareAlert, copyAlertLink,
  } = useSurfAlertActions({
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
  });


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
      <div className="p-4 space-y-3">
        <AlertCardSkeleton />
        <AlertCardSkeleton />
        <AlertCardSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 bg-background min-h-screen" data-testid="surf-alerts-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 font-oswald" >
            <BellRing className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />
            Surf Alerts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Get notified when conditions are perfect</p>
        </div>
        <Button aria-label="Add"
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
                      <img loading="lazy" decoding="async" src={alert.spot_image} alt={alert.spot_name} className="w-full h-full object-cover" />
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
                        <button aria-label="Edit"
                          onClick={() => openEditModal(alert)}
                          className="p-1 text-gray-400 hover:text-yellow-400 transition-colors"
                          title="Edit alert"
                          data-testid={`edit-alert-${alert.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button aria-label="Share"
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
                        <button aria-label="Delete"
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

      {/* Create/Edit Alert Modal (Extracted to alerts/SurfAlertModal.js) */}
      <SurfAlertModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        isEditMode={isEditMode}
        newAlert={newAlert}
        setNewAlert={setNewAlert}
        spotSearchQuery={spotSearchQuery}
        setSpotSearchQuery={setSpotSearchQuery}
        showSpotResults={showSpotResults}
        setShowSpotResults={setShowSpotResults}
        filteredSpots={filteredSpots}
        selectSpot={selectSpot}
        userLocation={userLocation}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        toggleTimeWindow={toggleTimeWindow}
        toggleTideState={toggleTideState}
        toggleCondition={toggleCondition}
        createLoading={createLoading}
        handleSaveAlert={handleSaveAlert}
        resetNewAlert={resetNewAlert}
      />

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
              
              <Button aria-label="Loader2"
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
              <Button aria-label="Copy"
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
