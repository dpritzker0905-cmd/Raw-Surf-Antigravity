import React, { useState, useEffect, useRef, useCallback } from 'react';

import { useLocation } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import { 

  Power, MapPin, Clock, DollarSign, Camera, Zap, Settings, User, Navigation, Check, X, Flame, Bell, Volume2, VolumeX, Loader2, Radio, Eye, Calendar, Square, ChevronDown, ChevronUp, Wallet, History, Info, Waves, Users, MessageCircle, Mic
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Switch } from './ui/switch';

import { NumericStepper } from './ui/numeric-stepper';

import { toast } from 'sonner';
import useOnDemandActions from '../hooks/useOnDemandActions';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';
import { SessionChatDrawer, SessionChatFAB } from './SessionChatDrawer';
import SessionDetailDrawer from './bookings/SessionDetailDrawer';
import { useSessionChatSync } from '../hooks/useSessionChatSync';
import { formatDuration } from '../utils/formatTime';




// Extracted card components
import { IncomingRequestCard, ActiveSessionCard, EarningsStatsCard, getImageUrl } from './on-demand/OnDemandSessionCards';


// ============ MAIN COMPONENT ============
export const OnDemandSessionManager = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  
  // Check for deep link to specific request
  const highlightDispatchId = location.state?.highlightDispatchId;
  const autoExpandRequest = location.state?.autoExpandRequest;
  
  // Status state
  const [isOnline, setIsOnline] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [selectedOnDemandSpot, setSelectedOnDemandSpot] = useState(null);
  const [isLiveShooting, setIsLiveShooting] = useState(false);
  
  // Session state
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState(null);  // For auto-expanding specific request
  
  // Settings state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseRate, setBaseRate] = useState(75);
  const [peakPricingEnabled, setPeakPricingEnabled] = useState(false);
  const [peakMultiplier, setPeakMultiplier] = useState(1.5);
  const [onDemandPhotosIncluded, setOnDemandPhotosIncluded] = useState(3);
  const [onDemandFullGallery, setOnDemandFullGallery] = useState(false);

  // On-Demand independent resolution pricing
  const [odPriceWeb, setOdPriceWeb] = useState(5);
  const [odPriceStandard, setOdPriceStandard] = useState(10);
  const [odPriceHigh, setOdPriceHigh] = useState(18);
  const [odVideo720p, setOdVideo720p] = useState(12);
  const [odVideo1080p, setOdVideo1080p] = useState(20);
  const [odVideo4k, setOdVideo4k] = useState(40);

  // Cancellation fee state
  const [cancellationFeePct, setCancellationFeePct] = useState(100);

  // Exception requests state
  const [exceptionRequests, setExceptionRequests] = useState([]);
  const [resolvingExceptionId, setResolvingExceptionId] = useState(null);
  
  // Coverage spots state
  const [nearbySpots, setNearbySpots] = useState([]);
  const [selectedSpots, setSelectedSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showSpotsList, setShowSpotsList] = useState(true);
  const [showPricingSection, setShowPricingSection] = useState(true);
  
  // Stats and history
  const [stats, setStats] = useState({});
  const [sessionHistory, setSessionHistory] = useState([]);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] = useState(null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('dashboard');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Session chat state
  const [showSessionChat, setShowSessionChat] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  // Background chat sync (runs even when drawer is closed)
  const {
    unreadCount: bgUnreadCount,
    latestMessage: bgLatestMessage,
  } = useSessionChatSync({
    userId: user?.id,
    otherUserId: activeSession?.requester_id,
    otherUserName: activeSession?.requester_name || 'Surfer',
    drawerOpen: showSessionChat,
    enabled: !!activeSession,
  });

  // Sync background unread count to state (when drawer is closed, background hook is authoritative)
  useEffect(() => {
    if (!showSessionChat) {
      setChatUnreadCount(bgUnreadCount);
    }
  }, [bgUnreadCount, showSessionChat]);
  
  const pollIntervalRef = useRef(null);
  const audioRef = useRef(null);
  const highlightedRequestRef = useRef(null);
  
  // Auto-expand and scroll to highlighted request when it loads
  useEffect(() => {
    if (highlightDispatchId && autoExpandRequest && incomingRequests.length > 0) {
      const targetRequest = incomingRequests.find(r => r.dispatch_id === highlightDispatchId);
      if (targetRequest) {
        setExpandedRequestId(highlightDispatchId);
        // Scroll to the request after a short delay
        setTimeout(() => {
          highlightedRequestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    }
  }, [highlightDispatchId, autoExpandRequest, incomingRequests]);
  
  // ============ THEME CLASSES ============
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const cardBg = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-900 border-zinc-800';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : isBeach ? 'bg-zinc-900' : 'bg-zinc-800/50';
  
  // Geographic Range Logic (Role-Based)
  const getGeographicRadius = () => {
    if (user?.role === ROLES.APPROVED_PRO) return { min: 30, max: 50, default: 40 };
    if (user?.role === ROLES.PRO) return { min: 30, max: 50, default: 40 };
    return { min: 10, max: 20, default: 15 };
  };
  const geoRadius = getGeographicRadius();
  const isPro = ['Approved Pro', 'Pro'].includes(user?.role);
  
  // ============ FETCH FUNCTIONS ============
  useEffect(() => {
    if (!user?.id) return;
    
    fetchOnDemandStatus();
    fetchSettings();
    fetchStats();
    fetchSessionHistory();
    fetchExceptionRequests();
    requestLocation();
  }, [user?.id]);
  
  // Polling for incoming requests when online
  useEffect(() => {
    if (!isOnline || !user?.id) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }
    
    fetchIncomingRequests();
    fetchActiveSession();
    
    pollIntervalRef.current = setInterval(() => {
      // Skip polling when browser tab is hidden (saves battery & bandwidth)
      if (document.visibilityState === 'hidden') return;
      fetchIncomingRequests();
      fetchActiveSession();
    }, 10000);
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOnline, user?.id]);
  
  // Play sound when new request arrives
  useEffect(() => {
    if (incomingRequests.length > 0 && soundEnabled) {
      playNotificationSound();
    }
  }, [incomingRequests.length]);
  
  const playNotificationSound = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/sounds/notification.mp3');
        audioRef.current.volume = 0.7;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch (e) {
      logger.debug('Could not play notification sound');
    }
  };
  
  const requestLocation = () => {
    setLocationLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setUserLocation(location);
          fetchNearbySpots(location);
          setLocationLoading(false);
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setLocationLoading(false);
          toast.error('Unable to get location. Please enable GPS.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationLoading(false);
      toast.error('Geolocation not supported by your browser');
    }
  };
  
  // ============ HANDLERS EXTRACTED TO hooks/useOnDemandActions.js ============
  const {
    fetchNearbySpots, fetchOnDemandStatus, fetchSettings, fetchStats,
    fetchIncomingRequests, fetchActiveSession, fetchSessionHistory,
    fetchExceptionRequests, handleToggleOnline,
    handleAcceptRequest, handleDeclineRequest,
    handleMarkArrived, handleCompleteSession, handleConfirmCancel,
    toggleSpotSelection, saveSettings,
    clearAllSpots, selectAllSpots, promptCancelSession,
  } = useOnDemandActions({
    user, activeSession, selectedSpots,
    userLocation, nearbySpots, geoRadius, isOnline, isLiveShooting,
    baseRate, peakPricingEnabled, peakMultiplier, cancellationFeePct,
    odPriceWeb, odPriceStandard, odPriceHigh,
    odVideo720p, odVideo1080p, odVideo4k,
    onDemandPhotosIncluded, onDemandFullGallery,
    cancelTargetId,
    setIsOnline, setIsTogglingStatus, setIsAccepting, setIsCancelling,
    setIsLiveShooting, setActiveSession, setSessionHistory,
    setIncomingRequests, setExceptionRequests, setStats, setLoading,
    setNearbySpots, setSelectedSpots, setSelectedOnDemandSpot,
    setBaseRate, setPeakPricingEnabled, setPeakMultiplier, setCancellationFeePct,
    setOdPriceWeb, setOdPriceStandard, setOdPriceHigh,
    setOdVideo720p, setOdVideo1080p, setOdVideo4k,
    setOnDemandPhotosIncluded, setOnDemandFullGallery,
    setSaving, setCancelTargetId, setShowCancelConfirm,
  });
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }
  
  return (
    <div className="p-4 max-w-6xl mx-auto pb-24" data-testid="on-demand-session-manager">
      {/* Header with Save Button (Settings tab only) */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Zap className="w-7 h-7 text-yellow-400" />
            On-Demand Hub
          </h1>
          <p className={`${textSecondary} text-sm mt-1`}>
            {selectedSpots.length} coverage spots - {geoRadius.min}-{geoRadius.max} mile range
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button aria-label="Volume2"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl ${sectionBg} hover:opacity-80 transition-opacity`}
            data-testid="sound-toggle-btn"
          >
            {soundEnabled ? (
              <Volume2 className="w-5 h-5 text-cyan-400" />
            ) : (
              <VolumeX className={`w-5 h-5 ${textSecondary}`} />
            )}
          </button>
          
          {activeTab === 'settings' && (
            <Button aria-label="Loader2"
              onClick={saveSettings}
              disabled={saving}
              className="bg-gradient-to-r from-green-400 to-cyan-400 text-black font-bold"
              data-testid="save-settings-btn"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          )}
        </div>
      </div>
      
      {/* On-Demand Status Toggle Card - Shown on Dashboard */}
      {activeTab === 'dashboard' && (
        <Card className={`mb-6 ${isOnline 
          ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-400/50' 
          : cardBg}`}
          data-testid="on-demand-status-card"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  isOnline ? 'bg-yellow-500/30' : sectionBg
                }`}>
                  <Zap className={`w-6 h-6 ${isOnline ? 'text-yellow-400' : textSecondary}`} />
                </div>
                <div>
                  <p className={`font-bold ${textPrimary}`}>On-Demand Status</p>
                  <p className={`text-sm ${isOnline ? 'text-yellow-300' : textSecondary}`}>
                    {isOnline 
                      ? `Active at: ${selectedOnDemandSpot?.name || 'Your Area'}` 
                      : selectedSpots.length > 0 
                        ? 'Ready to activate' 
                        : 'Select coverage spots in Settings'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleToggleOnline}
                disabled={isTogglingStatus || (selectedSpots.length === 0 && !isOnline)}
                className={`w-14 h-8 rounded-full transition-colors relative ${
                  isOnline 
                    ? 'bg-yellow-500' 
                    : selectedSpots.length > 0 
                      ? isLight ? 'bg-gray-300 hover:bg-gray-400' : 'bg-zinc-600 hover:bg-zinc-500' 
                      : isLight ? 'bg-gray-200 opacity-50 cursor-not-allowed' : 'bg-zinc-700 opacity-50 cursor-not-allowed'
                }`}
                data-testid="on-demand-status-toggle"
              >
                {isTogglingStatus ? (
                  <Loader2 className="w-5 h-5 animate-spin absolute top-1.5 left-1/2 -translate-x-1/2 text-white" />
                ) : (
                  <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-transform shadow-md ${
                    isOnline ? 'right-1' : 'left-1'
                  }`} />
                )}
              </button>
            </div>
            
            {/* Active spot info */}
            {isOnline && selectedOnDemandSpot && (
              <div className="mt-3 pt-3 border-t border-yellow-500/30 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-300">
                  Accepting requests at {selectedOnDemandSpot.name}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Tab Navigation */}
      <div className={`flex rounded-xl ${sectionBg} p-1 mb-6`}>
        {[
          { id: 'dashboard', label: 'Dashboard', icon: Radio },
          { id: 'settings', label: 'Settings', icon: Settings },
          { id: 'history', label: 'History', icon: History }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all ${
              activeTab === tab.id 
                ? `${cardBg} ${textPrimary} shadow-sm` 
                : `${textSecondary} hover:text-white`
            }`}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Main Content */}
      <div className="space-y-6">
        {activeTab === 'dashboard' && (
          <>
            {/* Active Session (top priority) */}
            {activeSession && (
              <ActiveSessionCard
                session={activeSession}
                onMarkArrived={handleMarkArrived}
                onComplete={handleCompleteSession}
                onCancel={promptCancelSession}
                onOpenChat={() => setShowSessionChat(true)}
                cardBg={cardBg}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                sectionBg={sectionBg}
                chatUnreadCount={chatUnreadCount}
                chatLatestMessage={bgLatestMessage}
              />
            )}
            
            {/* Incoming Requests */}
            {!activeSession && incomingRequests.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-amber-400 animate-bounce" />
                  <h2 className={`font-bold text-lg ${textPrimary}`}>Incoming Requests</h2>
                  <Badge className="bg-amber-500 text-black">{incomingRequests.length}</Badge>
                </div>
                
                {incomingRequests.map((request) => (
                  <div
                    key={request.dispatch_id}
                    ref={request.dispatch_id === highlightDispatchId ? highlightedRequestRef : null}
                  >
                    <IncomingRequestCard
                      request={request}
                      onAccept={handleAcceptRequest}
                      onDecline={handleDeclineRequest}
                      isAccepting={isAccepting}
                      cardBg={cardBg}
                      textPrimary={textPrimary}
                      textSecondary={textSecondary}
                      sectionBg={sectionBg}
                      isHighlighted={request.dispatch_id === highlightDispatchId}
                      defaultExpanded={request.dispatch_id === expandedRequestId}
                    />
                  </div>
                ))}
              </div>
            )}
            
            {/* Waiting State */}
            {isOnline && !activeSession && incomingRequests.length === 0 && (
              <Card className={`${cardBg} text-center`}>
                <CardContent className="py-12 px-6">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <Radio className="w-10 h-10 text-green-400 animate-pulse" />
                  </div>
                  <h3 className={`text-xl font-bold ${textPrimary} mb-2`}>Waiting for Requests</h3>
                  <p className={textSecondary}>
                    You'll be notified when a surfer nearby requests a session
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-green-400">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Actively listening...
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Offline State */}
            {!isOnline && !activeSession && (
              <Card className={cardBg}>
                <CardContent className="py-12 px-6 text-center">
                  <div className={`w-20 h-20 mx-auto mb-6 rounded-xl ${sectionBg} flex items-center justify-center`}>
                    <Power className={`w-10 h-10 ${textSecondary}`} />
                  </div>
                  <h3 className={`text-xl font-bold ${textPrimary} mb-2`}>You're Offline</h3>
                  <p className={textSecondary}>
                    {selectedSpots.length === 0 
                      ? 'Configure coverage spots in Settings tab first'
                      : 'Toggle the switch above to start receiving requests'}
                  </p>
                </CardContent>
              </Card>
            )}
            
            {/* Earnings Stats */}
            <EarningsStatsCard
              stats={stats}
              cardBg={cardBg}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              sectionBg={sectionBg}
              borderClass={borderClass}
            />

            {/* ============ EXCEPTION REQUESTS FEED ============ */}
            {exceptionRequests.length > 0 && (
              <Card className={cardBg}>
                <CardHeader>
                  <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
                    <Bell className="w-5 h-5 text-amber-400" />
                    Fee Waiver Requests
                    <Badge className="bg-amber-500 text-white text-xs">{exceptionRequests.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {exceptionRequests.map(exc => (
                    <div key={exc.id} className={`p-4 rounded-xl border ${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className={`font-semibold ${textPrimary}`}>{exc.requester_name}</p>
                          <p className={`text-xs ${textSecondary}`}>
                            {exc.category === 'emergency' ? `${String.fromCodePoint(0x1F6A8)} Emergency` : exc.category === 'weather' ? `${String.fromCodePoint(0x26C8, 0xFE0F)} Weather` : exc.category === 'injury' ? `${String.fromCodePoint(0x1FA79)} Injury` : `${String.fromCodePoint(0x1F4DD)} Other`}
                          </p>
                        </div>
                        <p className="text-amber-400 font-bold">${exc.fee_amount?.toFixed(2)}</p>
                      </div>
                      <p className={`text-sm ${textSecondary} mb-3 italic`}>"{exc.reason}"</p>
                      {resolvingExceptionId === exc.id ? (
                        <div className="flex items-center justify-center py-2">
                          <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1 bg-green-500 hover:bg-green-600 text-white text-xs"
                            onClick={async () => {
                              setResolvingExceptionId(exc.id);
                              try {
                                await apiClient.post(`/dispatch/${exc.dispatch_id}/resolve-exception`, {
                                  approved: true,
                                  resolution_note: 'Approved by photographer'
                                });
                                toast.success('Waiver approved - surfer refunded');
                                setExceptionRequests(prev => prev.filter(e => e.id !== exc.id));
                              } catch (err) {
                                toast.error('Failed to approve waiver');
                              } finally {
                                setResolvingExceptionId(null);
                              }
                            }}
                          >
                            <Check className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`flex-1 text-xs ${isLight ? 'border-red-300 text-red-600' : 'border-red-500/50 text-red-400'}`}
                            onClick={async () => {
                              setResolvingExceptionId(exc.id);
                              try {
                                await apiClient.post(`/dispatch/${exc.dispatch_id}/resolve-exception`, {
                                  approved: false,
                                  resolution_note: 'Denied by photographer'
                                });
                                toast.info('Waiver denied');
                                setExceptionRequests(prev => prev.filter(e => e.id !== exc.id));
                              } catch (err) {
                                toast.error('Failed to deny waiver');
                              } finally {
                                setResolvingExceptionId(null);
                              }
                            }}
                          >
                            <X className="w-3 h-3 mr-1" /> Deny
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
        
        {activeTab === 'settings' && (
          <>
            {/* On-Demand Pricing Card */}
            <Card className={cardBg}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
                    <DollarSign className="w-5 h-5 text-green-400" />
                    On-Demand Pricing
                  </CardTitle>
                  <Button aria-label="Settings" 
                    variant="outline" 
                    size="sm"
                    aria-expanded={showPricingSection} onClick={() => setShowPricingSection(!showPricingSection)}
                    className={borderClass}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    {showPricingSection ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </CardHeader>
              {showPricingSection && (
                <CardContent className="space-y-6">
                  {/* Preview Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Base Rate</p>
                      <p className="text-xl font-bold text-green-400">${baseRate}/hr</p>
                    </div>
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Peak Rate</p>
                      <p className="text-xl font-bold text-amber-400">
                        {peakPricingEnabled ? `$${(baseRate * peakMultiplier).toFixed(0)}/hr` : 'OFF'}
                      </p>
                    </div>
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Photos Included</p>
                      <p className={`text-xl font-bold ${onDemandFullGallery ? 'text-green-400' : textPrimary}`}>
                        {onDemandFullGallery ? '8 Full' : onDemandPhotosIncluded}
                      </p>
                    </div>
                    <div className={`p-3 rounded-xl ${sectionBg}`}>
                      <p className={`text-xs ${textSecondary} mb-1`}>Coverage</p>
                      <p className="text-xl font-bold text-cyan-400">{selectedSpots.length} spots</p>
                    </div>
                  </div>
                  
                  {/* Base Rate - NUMERIC STEPPER */}
                  <NumericStepper
                    label="On-Demand Base Rate"
                    value={baseRate}
                    onChange={setBaseRate}
                    min={25}
                    max={300}
                    step={5}
                    prefix="$"
                    suffix="/hr"
                    description="Premium rate for On-Demand requests (above standard bookings)"
                    theme={theme}
                  />
                  
                  {/* Peak/Swell Pricing Toggle */}
                  <div className={`p-4 rounded-xl ${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'} border`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Waves className="w-5 h-5 text-amber-400" />
                        <div>
                          <p className={`font-medium ${textPrimary}`}>Peak/Swell Pricing</p>
                          <p className={`text-xs ${textSecondary}`}>Auto-increase rate during high demand</p>
                        </div>
                      </div>
                      <Switch
                        checked={peakPricingEnabled}
                        onCheckedChange={setPeakPricingEnabled}
                      />
                    </div>
                    
                    {peakPricingEnabled && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm ${textPrimary}`}>Peak Multiplier</span>
                          <span className="text-lg font-bold text-amber-400">{peakMultiplier}x</span>
                        </div>
                        <div className="flex gap-2">
                          {[1.25, 1.5, 1.75, 2.0].map(mult => (
                            <button
                              key={mult}
                              onClick={() => setPeakMultiplier(mult)}
                              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                                peakMultiplier === mult
                                  ? 'bg-amber-500 text-black'
                                  : isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-700 text-gray-300'
                              }`}
                            >
                              {mult}x
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Photos Included */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <label className={`font-medium ${textPrimary}`}>Photos Included</label>
                        {onDemandFullGallery && (
                          <Badge className="bg-green-500 text-white text-xs">FULL GALLERY</Badge>
                        )}
                      </div>
                    </div>
                    
                    {/* Full Gallery Toggle */}
                    <div className={`p-3 rounded-xl mb-4 ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="w-5 h-5 text-green-400" />
                          <div>
                            <p className={`font-medium ${textPrimary}`}>Full Gallery Access</p>
                            <p className={`text-xs ${textSecondary}`}>All photos included - unlimited downloads</p>
                          </div>
                        </div>
                        <Switch
                          checked={onDemandFullGallery}
                          onCheckedChange={setOnDemandFullGallery}
                        />
                      </div>
                    </div>
                    
                    {!onDemandFullGallery && (
                      <NumericStepper
                        value={onDemandPhotosIncluded}
                        onChange={setOnDemandPhotosIncluded}
                        min={0}
                        max={999}
                        step={1}
                        description="Photos included free with on-demand buy-in. Additional charged per resolution."
                        theme={theme}
                      />
                    )}

                    <div className={`mt-4 p-4 rounded-xl border ${isLight ? 'bg-blue-50 border-blue-200' : 'bg-blue-500/10 border-blue-500/20'}`}>
                      <p className={`text-sm font-semibold mb-3 flex items-center gap-2 ${textPrimary}`}>
                        {String.fromCodePoint(0x1F4F7)} Photo Download Prices
                        <span className={`text-xs font-normal ${textSecondary}`}>(per resolution - independent from Gallery)</span>
                      </p>
                      <div className="grid grid-cols-1 gap-3">
                        <NumericStepper label="Web Quality (800px)" value={odPriceWeb} onChange={setOdPriceWeb} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                        <NumericStepper label="Standard (1920px)" value={odPriceStandard} onChange={setOdPriceStandard} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                        <NumericStepper label="High-Res (Original)" value={odPriceHigh} onChange={setOdPriceHigh} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                      </div>
                    </div>

                    <div className={`mt-4 p-4 rounded-xl border ${isLight ? 'bg-purple-50 border-purple-200' : 'bg-purple-500/10 border-purple-500/20'}`}>
                      <p className={`text-sm font-semibold mb-3 flex items-center gap-2 ${textPrimary}`}>
                        {String.fromCodePoint(0x1F3AC)} Video Download Prices
                        <span className={`text-xs font-normal ${textSecondary}`}>(per resolution - independent from Gallery)</span>
                      </p>
                      <div className="grid grid-cols-1 gap-3">
                        <NumericStepper label="720p HD" value={odVideo720p} onChange={setOdVideo720p} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                        <NumericStepper label="1080p Full HD" value={odVideo1080p} onChange={setOdVideo1080p} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                        <NumericStepper label="4K Ultra HD" value={odVideo4k} onChange={setOdVideo4k} min={0} max={500} step={0.5} prefix="$" theme={theme} />
                      </div>
                    </div>

                    <div className={`mt-4 p-4 rounded-xl border ${isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/20'}`}>
                      <p className={`text-sm font-semibold mb-1 flex items-center gap-2 ${textPrimary}`}>
                        {String.fromCodePoint(0x26A0, 0xFE0F)} Cancellation Fee
                      </p>
                      <p className={`text-xs ${textSecondary} mb-3`}>
                        Percentage of payment kept when a surfer cancels after you accept. 0% = fully refundable.
                      </p>
                      <NumericStepper
                        label="Fee Percentage"
                        value={cancellationFeePct}
                        onChange={setCancellationFeePct}
                        min={0}
                        max={100}
                        step={5}
                        suffix="%"
                        theme={theme}
                      />
                      <div className={`mt-2 text-xs ${textSecondary} flex items-center gap-1`}>
                        <Info className="w-3 h-3" />
                        {cancellationFeePct === 0 ? 'Fully refundable - surfers get full payment back' :
                         cancellationFeePct === 100 ? 'Non-refundable - you keep the entire payment' :
                         `Surfer receives ${100 - cancellationFeePct}% refund on cancellation`}
                      </div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
            
            {/* Coverage Spots Card */}
            <Card className={cardBg}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
                    <MapPin className="w-5 h-5 text-cyan-400" />
                    Coverage Spots
                    <Badge className={isPro ? 'bg-purple-500 text-white' : 'bg-cyan-500 text-white'}>
                      {geoRadius.min}-{geoRadius.max} mi
                    </Badge>
                  </CardTitle>
                  <Button aria-label="Collapse" 
                    variant="outline" 
                    size="sm"
                    aria-expanded={showSpotsList} onClick={() => setShowSpotsList(!showSpotsList)}
                    className={borderClass}
                  >
                    {showSpotsList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>
              </CardHeader>
              
              {showSpotsList && (
                <CardContent>
                  {/* Location Status */}
                  <div className={`p-3 rounded-xl mb-4 ${sectionBg} flex items-center gap-3`}>
                    <div className={`w-8 h-8 rounded-lg ${userLocation ? 'bg-green-500/20' : 'bg-amber-500/20'} flex items-center justify-center`}>
                      <Navigation className={`w-4 h-4 ${userLocation ? 'text-green-400' : 'text-amber-400'}`} />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${textPrimary}`}>
                        {userLocation ? 'GPS Active' : 'Location unavailable'}
                      </p>
                    </div>
                    {!userLocation && !locationLoading && (
                      <Button onClick={requestLocation} size="sm" variant="outline">
                        Enable
                      </Button>
                    )}
                    {locationLoading && (
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    )}
                  </div>
                  
                  {/* Quick Actions */}
                  <div className="flex gap-2 mb-4">
                    <Button variant="outline" size="sm" onClick={selectAllSpots} className={`flex-1 ${borderClass}`}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearAllSpots} className={`flex-1 ${borderClass}`}>
                      Clear All
                    </Button>
                  </div>
                  
                  {/* Spots List */}
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scroll-touch">
                    {nearbySpots.length === 0 ? (
                      <p className={`text-center py-4 ${textSecondary}`}>
                        {locationLoading ? 'Finding nearby spots...' : 'No spots found nearby'}
                      </p>
                    ) : (
                      nearbySpots.map(spot => (
                        <button
                          key={spot.id}
                          onClick={() => toggleSpotSelection(spot.id)}
                          className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all border-2 ${
                            selectedSpots.includes(spot.id)
                              ? 'bg-cyan-500/20 border-cyan-500'
                              : isLight ? 'bg-white border-gray-200 hover:border-gray-300' : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                          }`}
                          data-testid={`spot-${spot.id}`}
                        >
                          {/* Checkbox Style Circle */}
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedSpots.includes(spot.id) 
                              ? 'border-cyan-500 bg-cyan-500' 
                              : isLight ? 'border-gray-400' : 'border-zinc-500'
                          }`}>
                            {selectedSpots.includes(spot.id) && (
                              <Check className="w-4 h-4 text-white" />
                            )}
                          </div>
                          
                          <div className="flex-1 text-left">
                            <p className={`font-medium ${textPrimary}`}>{spot.name}</p>
                            <p className={`text-xs ${textSecondary}`}>
                              {spot.region || spot.city || 'Florida'}
                              {spot.distance_miles && ` - ${spot.distance_miles.toFixed(1)} mi`}
                            </p>
                          </div>
                          
                          {spot.active_photographers_count > 0 && (
                            <Badge className="bg-green-500/20 text-green-400 text-xs">
                              {spot.active_photographers_count} active
                            </Badge>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  
                  <p className={`text-xs ${textSecondary} mt-3 flex items-start gap-1`}>
                    <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    Surfers searching at these spots will see you in On-Demand results
                  </p>
                </CardContent>
              )}
            </Card>
          </>
        )}
        
        {activeTab === 'history' && (
          <>
          <Card className={cardBg} data-testid="history-panel">
            <CardContent className="p-4">
              <h3 className={`font-bold text-lg ${textPrimary} flex items-center gap-2 mb-6`}>
                <History className="w-5 h-5 text-purple-400" />
                Session History
              </h3>
              
              {sessionHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className={`w-12 h-12 mx-auto mb-4 ${textSecondary}`} />
                  <p className={`font-medium ${textPrimary}`}>No sessions yet</p>
                  <p className={`text-sm ${textSecondary}`}>Your completed sessions will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sessionHistory.map((session, idx) => {
                    const durationMins = session.duration_hours ? Math.round(session.duration_hours * 60) : 0;
                    return (
                      <div 
                        key={session.id || idx}
                        className={`p-4 rounded-xl ${sectionBg} flex justify-between items-center cursor-pointer transition-all hover:ring-1 ${isLight ? 'hover:ring-purple-300' : 'hover:ring-purple-500/30'}`}
                        onClick={() => {
                          setSelectedHistorySession({
                            ...session,
                            session_type: 'on_demand',
                            location: session.location_name,
                            session_date: session.date,
                            duration_mins: durationMins,
                            total_surfers: session.participant_count || 1,
                            total_earnings: session.earnings || 0,
                            buyin_price: session.hourly_rate || 75,
                            photographer_name: session.requester_name,
                            gallery_photo_count: session.photo_count || 0,
                            gallery_id: session.gallery_id || null,
                            participants: session.participants || [],
                          });
                          setShowHistoryDrawer(true);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white bg-gradient-to-r from-purple-500 to-indigo-500">
                              <Zap className="w-2.5 h-2.5" /> On-Demand
                            </span>
                          </div>
                          <p className={`font-medium ${textPrimary}`}>{session.location_name}</p>
                          <p className={`text-sm ${textSecondary}`}>
                            {session.date ? new Date(session.date).toLocaleDateString() : 'Unknown'}
                            {session.requester_name && ` - ${session.requester_name}`}
                          </p>
                          <p className={`text-xs ${textSecondary} mt-1`}>
                            {durationMins > 0 ? `${durationMins} min` : ''}
                            {session.hourly_rate ? ` @ $${session.hourly_rate}/hr` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p className="text-green-400 font-bold text-lg">${(session.earnings || 0).toFixed(2)}</p>
                          <ChevronRightIcon className={`w-4 h-4 ${textSecondary}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Session Detail Drawer for On-Demand History */}
          <SessionDetailDrawer
            isOpen={showHistoryDrawer}
            onClose={() => {
              setShowHistoryDrawer(false);
              setSelectedHistorySession(null);
            }}
            session={selectedHistorySession}
            theme={theme}
            userRole="photographer"
            userId={user?.id}
            onNavigateToGallery={(galleryId) => {
              window.location.href = `/gallery/${galleryId}`;
            }}
          />
          </>
        )}
      </div>

      {/* ============ CANCEL CONFIRMATION MODAL ============ */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <X className="w-5 h-5 text-red-400" />
              </div>
              <AlertDialogTitle className="text-white text-lg">
                Cancel This Session?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-gray-400 text-sm leading-relaxed">
              This will end the on-demand session and notify the surfer.
              Any held payment will be refunded to the surfer's account credits.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Session context summary */}
          {activeSession && (
            <div className="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                {activeSession.requester_selfie ? (
                  <img loading="lazy" decoding="async" src={getImageUrl(activeSession.requester_selfie)} alt="" className="w-full h-full object-cover" />
                ) : activeSession.requester_avatar ? (
                  <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(activeSession.requester_avatar))} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User className="w-5 h-5 text-zinc-500" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{activeSession.requester_name || 'Surfer'}</p>
                <p className="text-xs text-gray-500 truncate">{activeSession.location_name || 'On-Demand Session'}</p>
              </div>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs flex-shrink-0">
                Cancelling
              </Badge>
            </div>
          )}

          <AlertDialogFooter className="gap-3 sm:gap-2">
            <AlertDialogCancel
              className="flex-1 border-zinc-600 bg-transparent text-white hover:bg-zinc-800 hover:text-white"
              disabled={isCancelling}
            >
              Keep Session
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // Prevent auto-close so loading state is visible
                handleConfirmCancel();
              }}
              disabled={isCancelling}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold border-0"
            >
              {isCancelling ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <X className="w-4 h-4 mr-2" />
              )}
              {isCancelling ? 'Cancelling...' : 'Yes, Cancel Session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Session Chat Drawer --- */}
      {activeSession && (
        <SessionChatDrawer
          isOpen={showSessionChat}
          onClose={() => setShowSessionChat(false)}
          otherUserId={activeSession.requester_id}
          otherUserName={activeSession.requester_name || 'Surfer'}
          otherUserAvatar={activeSession.requester_avatar || activeSession.requester_selfie}
          dispatchId={activeSession.id}
          isLight={false}
          onUnreadChange={setChatUnreadCount}
        />
      )}

      {/* --- Floating Chat FAB --- */}
      {activeSession && !showSessionChat && (
        <div className="fixed bottom-24 right-4 z-40">
          <SessionChatFAB
            unreadCount={chatUnreadCount}
            onClick={() => setShowSessionChat(true)}
            isLight={false}
          />
        </div>
      )}
    </div>
  );
};

export default OnDemandSessionManager;
