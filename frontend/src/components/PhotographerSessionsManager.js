import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import {
  Radio,
  MapPin,
  Users,
  DollarSign,
  Play,
  Square,
  Eye,
  Camera,
  Zap,
  Settings,
  RefreshCw,
  Video,
  Tag,
  Upload,
  Image as ImageIcon
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';


import { toast } from 'sonner';
import useSessionActions from '../hooks/useSessionActions';
import PhotoUploadModal from './PhotoUploadModal';
import ConditionsModal from './ConditionsModal';
import EndSessionModal from './EndSessionModal';
import { SurferRosterCard } from './SurferRosterCard';
import logger from '../utils/logger';
import LiveSavingsBadge from './sessions/LiveSavingsBadge';
import PotentialEarningsCalculator from './sessions/PotentialEarningsCalculator';
import SessionDetailDrawer from './bookings/SessionDetailDrawer';
import SessionSettingsModal from './sessions/SessionSettingsModal';
import GoLiveLocationModal from './sessions/GoLiveLocationModal';
import { SessionPricingModal, GalleryCreatedModal } from './sessions/SessionPricingModals';

// Helper function to get commission rate based on subscription tier
const getCommissionRate = (subscriptionTier) => {
  // Check localStorage for admin-configured rates first
  const savedRates = localStorage.getItem('admin_commission_rates');
  if (savedRates) {
    try {
      const adminRates = JSON.parse(savedRates);
      const tier = subscriptionTier?.toLowerCase?.() || 'free';
      const tierMap = { 'basic': 'tier_2', 'premium': 'tier_3', 'pro': 'tier_3' };
      const normalizedTier = tierMap[tier] || tier;
      if (adminRates[normalizedTier] !== undefined) {
        return adminRates[normalizedTier] / 100;
      }
    } catch (e) {
      // Fall through to defaults
    }
  }
  
  // Default commission rates (handles multiple naming conventions)
  const COMMISSION_RATES = {
    'free': 0.25,
    'tier_1': 0.25,
    'tier_2': 0.20,
    'basic': 0.20,      // Alias for tier_2
    'tier_3': 0.15,
    'premium': 0.15,    // Alias for tier_3
    'pro': 0.15,
  };
  
  const tier = subscriptionTier?.toLowerCase?.() || 'free';
  return COMMISSION_RATES[tier] || COMMISSION_RATES.free;
};


export const PhotographerSessionsManager = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [isLive, setIsLive] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [surfSpots, setSurfSpots] = useState([]);
  const [_galleries, setGalleries] = useState([]);
  const [showGalleryCreatedModal, setShowGalleryCreatedModal] = useState(false);
  const [lastCreatedGallery, setLastCreatedGallery] = useState(null);
  
  // Earnings destination (for Hobbyists)
  const [causes, setCauses] = useState([]);
  const [groms, setGroms] = useState([]);
  const isHobbyist = ['Hobbyist', 'Grom Parent'].includes(user?.role);
  
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  // Modal states - SEPARATED WORKFLOWS
  const [showSettingsModal, setShowSettingsModal] = useState(false);  // Rates/Pricing setup
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);       // Location selection for Go Live
  const [showConditionsModal, setShowConditionsModal] = useState(false);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [showSessionDetailDrawer, setShowSessionDetailDrawer] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] = useState(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [endSessionLoading, setEndSessionLoading] = useState(false);
  const [isOnDemandActive, setIsOnDemandActive] = useState(false);  // Track on-demand status for mutual exclusivity
  // Collapsible settings sections state
  const [expandedSections, setExpandedSections] = useState({
    buyin: true,      // Session Buy-in - expanded by default
    pricing: false,   // Resolution-Based Pricing
    videoPricing: false, // Video Pricing
    settings: false,  // Session Settings
    earnings: false   // Earnings Destination
  });
  
  // Location verification state for live sessions
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [distanceToSpot, setDistanceToSpot] = useState(null);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [nearbySpots, setNearbySpots] = useState([]);
  const [nearbySpotsLoading, setNearbySpotsLoading] = useState(false);
  const [spotSearchQuery, setSpotSearchQuery] = useState(''); // Search query for manual spot selection
  const REQUIRED_DISTANCE_MILES = 0.2; // Must be within 0.2 miles of spot
  const NEARBY_RADIUS_MILES = 25; // Radius for fetching nearby spots
  
  const [debugInfo, setDebugInfo] = useState({
    gpsAccuracy: null,
    gpsStatus: 'unknown',
    latitude: null,
    longitude: null,
    cameraStatus: 'unknown',
    cameraStream: null,
    permissionStep: 'idle'
  });
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  
  // Session settings - SYNCED WITH UnifiedSpotDrawer
  const [sessionSettings, setSessionSettings] = useState({
    location: '',
    surf_spot_id: null,
    price_per_join: 25,
    auto_accept: true,
    max_surfers: 10,
    estimated_duration: 2,
    // Live Session Rates (synced with map drawer)
    live_photo_price: 5,
    photos_included: 3,
    videos_included: 1,       // Videos included in buy-in
    general_photo_price: 10,
    // Resolution-based pricing (MANDATORY for all workflows)
    photo_price_web: 3,       // Web-res (social media optimized)
    photo_price_standard: 5,  // Standard digital delivery
    photo_price_high: 10,     // High-res (print quality)
    // Pricing mode: 'tiered' (Web/Standard/High) or 'promotional' (single rate for all)
    pricing_mode: 'tiered',
    // Video pricing settings
    video_price_720p: 8,      // 720p video
    video_price_1080p: 15,    // 1080p video
    video_price_4k: 30,       // 4K video
    video_pricing_mode: 'tiered',  // 'tiered' or 'promotional'
    live_video_price: 12,     // Promotional flat rate for videos
    // Earnings destination
    earnings_destination_type: null,
    earnings_destination_id: null,
    earnings_cause_name: null
  });
  
  // Pricing settings (global photographer settings)
  const [pricing, setPricing] = useState({
    live_buyin_price: 25,
    live_photo_price: 5,
    photo_package_size: 3,
    booking_hourly_rate: 50,
    booking_min_hours: 1,
    gallery_photo_price: 10  // General gallery price for comparison
  });
  
  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-900';

  // Calculate live savings based on pricing mode
  // In promotional mode: compare promotional rate vs high-res standard price
  // In tiered mode: compare general price vs live photo price (for surfers who already joined)
  const liveSavings = sessionSettings.pricing_mode === 'promotional'
    ? sessionSettings.photo_price_high - sessionSettings.live_photo_price
    : sessionSettings.general_photo_price - sessionSettings.live_photo_price;
  const hasSavings = liveSavings > 0 && sessionSettings.pricing_mode === 'promotional';

  // Toggle collapsible section
  // ============ HANDLERS EXTRACTED TO hooks/useSessionActions.js ============

  const refreshSession = async () => {
    if (!isLive) return;
    try {
      const activeRes = await apiClient.get(`/photographer/${user?.id}/active-session`);
      if (activeRes.data) {
        setCurrentSession(activeRes.data);
      }
    } catch (error) {
      logger.error('Error refreshing session:', error);
    }
  };

  // Auto-refresh active session every 30 seconds

  const {
    toggleSection, fetchCausesAndGroms, fetchSurfSpots, fetchGalleries,
    fetchSessionData, handleSaveSettings, fetchNearbySpots,
    calculateDistanceInMiles, startSequentialGoLive,
    handleGoLiveConfirmed, handleGoLiveWithConditions,
    handleEndSessionClick, handleEndSessionConfirmed,
    handleEndSession, handleSavePricing,
    commissionRate, isWithinRange, canProceed,
  } = useSessionActions({
    user, navigate, pricing, isHobbyist, isOnDemandActive, manualConfirm,
    endSessionLoading, debugInfo, streamRef,
    REQUIRED_DISTANCE_MILES, NEARBY_RADIUS_MILES, getCommissionRate,
    setExpandedSections, setDistanceToSpot, distanceToSpot, showGoLiveModal, sessionSettings, surfSpots,
    nearbySpots, setNearbySpots, setSurfSpots, setGalleries, setLoading,
    setCauses, setGroms, setPricing, setSessionSettings,
    setIsLive, setCurrentSession, setIsOnDemandActive, setSessionHistory,
    setDebugInfo, setShowSettingsModal, setNearbySpotsLoading,
    setUserLocation, setLocationError, setShowGoLiveModal, setShowConditionsModal,
    setGoLiveLoading, setShowEndSessionModal, setEndSessionLoading,
    setLastCreatedGallery, setShowGalleryCreatedModal, setShowPricingModal,
  });

  useEffect(() => {
    let interval;
    if (isLive) {
      interval = setInterval(refreshSession, 30000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLive]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="photographer-sessions-page">
      {/* Note: Live Status HUD is now Map-integrated, shown only on MapPage */}
      
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-3xl font-bold ${textPrimaryClass} font-oswald`} >
            Live Sessions
          </h1>
        </div>

        {/* Live Status Card */}
        <Card className={`mb-6 ${isLive ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/50' : cardBgClass}`}>
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0 ${
                  isLive ? 'bg-green-500/30' : isLight ? 'bg-gray-100' : 'bg-zinc-800'
                }`}>
                  {isLive ? (
                    <Radio className="w-6 h-6 sm:w-8 sm:h-8 text-green-400 animate-pulse" />
                  ) : (
                    <Camera className={`w-6 h-6 sm:w-8 sm:h-8 ${textSecondaryClass}`} />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className={`text-lg sm:text-xl font-bold ${textPrimaryClass}`}>
                    {isLive ? "You're Live!" : 'Start a Live Session'}
                  </h2>
                  <p className={`${textSecondaryClass} text-sm sm:text-base truncate`}>
                    {isLive 
                      ? `Capturing action from ${currentSession?.location || sessionSettings.location}`
                      : 'Go live to let surfers find and join your session'
                    }
                  </p>
                  {/* Live Savings Badge - Synced with map */}
                  {!isLive && hasSavings && (
                    <LiveSavingsBadge 
                      generalPrice={sessionSettings.general_photo_price} 
                      livePrice={sessionSettings.live_photo_price}
                      className="mt-2"
                    />
                  )}
                </div>
              </div>
              
              {isLive ? (
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button aria-label="Upload"
                    onClick={() => setShowPhotoUpload(true)}
                    variant="outline"
                    className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                    data-testid="upload-photos-btn"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Media
                  </Button>
                  <Button aria-label="Refresh"
                    onClick={refreshSession}
                    variant="outline"
                    size="icon"
                    className="border-green-500/50 text-green-400 hover:bg-green-500/10 shrink-0"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  <Button aria-label="Square"
                    onClick={handleEndSession}
                    className="bg-red-500 hover:bg-red-600 text-white shrink-0"
                    data-testid="end-session-btn"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    End
                  </Button>
                </div>
              ) : (
                <Button aria-label="Play"
                  onClick={startSequentialGoLive}
                  className="bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 text-black font-medium"
                  data-testid="go-live-btn"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Go Live
                </Button>
              )}
            </div>

            {/* Live Session Stats */}
            {isLive && currentSession && (
              <div className={`mt-6 grid grid-cols-3 gap-4 pt-4 border-t ${borderClass}`}>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Users className="w-4 h-4 text-cyan-400" />
                    <span className={`text-2xl font-bold ${textPrimaryClass}`}>
                      {currentSession.active_surfers || 0}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondaryClass}`}>Active Surfers</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Eye className="w-4 h-4 text-yellow-400" />
                    <span className={`text-2xl font-bold ${textPrimaryClass}`}>
                      {currentSession.views || 0}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondaryClass}`}>Views</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    <span className={`text-2xl font-bold ${textPrimaryClass}`}>
                      ${currentSession.earnings?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondaryClass}`}>Earned</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Enhanced Surfer Roster - Full grid with selfies and identification */}
        {isLive && (
          <div className="mb-6">
            <SurferRosterCard
              photographerId={user?.id}
              isLive={isLive}
              theme={theme}
              onParticipantsUpdate={(data) => {
                // Update the stats in current session
                setCurrentSession(prev => prev ? {
                  ...prev,
                  active_surfers: data.count,
                  earnings: data.earnings
                } : prev);
              }}
            />
          </div>
        )}

        {/* Quick Settings - SYNCED WITH Map Drawer */}
        {!isLive && (
          <Card className={`mb-6 ${cardBgClass}`}>
            <CardHeader>
              <CardTitle className={`text-lg ${textPrimaryClass} flex items-center gap-2`}>
                <Settings className="w-5 h-5" />
                Session Setup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Buy-in Price */}
              <div className="flex items-center justify-between">
                <div>
                  <p className={textPrimaryClass}>Session Buy-in</p>
                  <p className={`text-sm ${textSecondaryClass}`}>${sessionSettings.price_per_join} per surfer</p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowSettingsModal(true)}
                  className={isLight ? 'border-gray-300' : 'border-zinc-700'}
                >
                  Edit
                </Button>
              </div>
              
              {/* Photos Included */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-cyan-400" />
                  <div>
                    <p className={textPrimaryClass}>Photos Included</p>
                    <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.photos_included} with buy-in</p>
                  </div>
                </div>
              </div>
              
              {/* Videos Included */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <div>
                    <p className={textPrimaryClass}>Videos Included</p>
                    <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.videos_included} with buy-in</p>
                  </div>
                </div>
              </div>
              
              {/* Photo Pricing */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className={textPrimaryClass}>Photo Pricing</p>
                    <div className="flex items-center gap-2">
                      {sessionSettings.pricing_mode === 'promotional' ? (
                        <>
                          <span className={`text-sm ${textSecondaryClass}`}>${sessionSettings.live_photo_price}/photo</span>
                          {sessionSettings.live_photo_price < sessionSettings.photo_price_high && (
                            <>
                              <span className="text-gray-500 line-through text-xs">${sessionSettings.photo_price_high}</span>
                              <Badge className="bg-green-500/20 text-green-400 text-xs">
                                Save ${sessionSettings.photo_price_high - sessionSettings.live_photo_price}
                              </Badge>
                            </>
                          )}
                        </>
                      ) : (
                        <span className={`text-sm ${textSecondaryClass}`}>
                          ${sessionSettings.photo_price_web} / ${sessionSettings.photo_price_standard} / ${sessionSettings.photo_price_high}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondaryClass}`}>
                      {sessionSettings.pricing_mode === 'promotional' ? 'Promo rate (high-res)' : 'Web / Standard / High-res'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Video Pricing */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <div>
                    <p className={textPrimaryClass}>Video Pricing</p>
                    <div className="flex items-center gap-2">
                      {sessionSettings.video_pricing_mode === 'promotional' ? (
                        <>
                          <span className={`text-sm ${textSecondaryClass}`}>${sessionSettings.live_video_price}/video</span>
                          {sessionSettings.live_video_price < sessionSettings.video_price_4k && (
                            <>
                              <span className="text-gray-500 line-through text-xs">${sessionSettings.video_price_4k}</span>
                              <Badge className="bg-green-500/20 text-green-400 text-xs">
                                Save ${sessionSettings.video_price_4k - sessionSettings.live_video_price}
                              </Badge>
                            </>
                          )}
                        </>
                      ) : (
                        <span className={`text-sm ${textSecondaryClass}`}>
                          ${sessionSettings.video_price_720p} / ${sessionSettings.video_price_1080p} / ${sessionSettings.video_price_4k}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondaryClass}`}>
                      {sessionSettings.video_pricing_mode === 'promotional' ? 'Promo rate (4K quality)' : '720p / 1080p / 4K'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Max Surfers */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className={textPrimaryClass}>Max Surfers</p>
                    <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.max_surfers} capacity</p>
                  </div>
                </div>
              </div>
              
              {/* Auto-Accept */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className={textPrimaryClass}>Auto-accept Surfers</p>
                    <p className={`text-sm ${textSecondaryClass}`}>
                      {sessionSettings.auto_accept ? 'Walk-ups welcome' : 'Manual approval'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Potential Earnings Calculator */}
        {!isLive && (
          <div className="mb-6">
            <PotentialEarningsCalculator
              buyinPrice={sessionSettings.price_per_join}
              maxSurfers={sessionSettings.max_surfers}
              photoPrice={sessionSettings.live_photo_price}
              commissionRate={commissionRate}
              isLight={isLight}
              textPrimaryClass={textPrimaryClass}
              textSecondaryClass={textSecondaryClass}
            />
          </div>
        )}

        {/* Session History */}
        <div>
          <h2 className={`text-xl font-bold ${textPrimaryClass} mb-4 font-oswald`} >
            Session History
          </h2>
          
          {sessionHistory.length === 0 ? (
            <Card className={cardBgClass}>
              <CardContent className="py-12 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
                  <Radio className={`w-8 h-8 ${textSecondaryClass}`} />
                </div>
                <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Past Sessions</h3>
                <p className={textSecondaryClass}>
                  Your completed live sessions will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessionHistory.map((session) => (
                <Card 
                  key={session.id} 
                  className={`${cardBgClass} cursor-pointer transition-all hover:ring-1 ${isLight ? 'hover:ring-amber-300' : 'hover:ring-amber-500/30'}`}
                  onClick={() => {
                    setSelectedHistorySession(session);
                    setShowSessionDetailDrawer(true);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <MapPin className={`w-4 h-4 ${textSecondaryClass} flex-shrink-0`} />
                          <span className={`${textPrimaryClass} truncate`}>{session.location}</span>
                        </div>
                        <p className={`text-sm ${textSecondaryClass} mt-1`}>
                          {new Date(session.started_at).toLocaleDateString()} - {session.duration_mins} mins
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Users className="w-4 h-4 text-cyan-400" />
                            <span className={textPrimaryClass}>{session.total_surfers}</span>
                          </div>
                          <p className="text-green-400 font-bold">${session.total_earnings?.toFixed(2) || '0.00'}</p>
                        </div>
                        {session.has_pending_reviews && (
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500" />
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Session Detail Drawer */}
        <SessionDetailDrawer
          isOpen={showSessionDetailDrawer}
          onClose={() => {
            setShowSessionDetailDrawer(false);
            setSelectedHistorySession(null);
          }}
          session={selectedHistorySession}
          theme={theme}
          userRole="photographer"
          userId={user?.id}
          onNavigateToGallery={(galleryId) => {
            navigate(`/gallery/${galleryId}`);
          }}
        />
      </div>

      {/* Settings Modal - Extracted to sessions/SessionSettingsModal.js */}
      <SessionSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        sessionSettings={sessionSettings}
        setSessionSettings={setSessionSettings}
        expandedSections={expandedSections}
        toggleSection={toggleSection}
        isHobbyist={isHobbyist}
        causes={causes}
        groms={groms}
        commissionRate={commissionRate}
        hasSavings={hasSavings}
        liveSavings={liveSavings}
        handleSaveSettings={handleSaveSettings}
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
        borderClass={borderClass}
        inputBgClass={inputBgClass}
      />

      {/* Go Live Modal - Extracted to sessions/GoLiveLocationModal.js */}
      <GoLiveLocationModal
        isOpen={showGoLiveModal}
        onClose={() => setShowGoLiveModal(false)}
        sessionSettings={sessionSettings}
        setSessionSettings={setSessionSettings}
        userLocation={userLocation}
        nearbySpots={nearbySpots}
        nearbySpotsLoading={nearbySpotsLoading}
        surfSpots={surfSpots}
        spotSearchQuery={spotSearchQuery}
        setSpotSearchQuery={setSpotSearchQuery}
        distanceToSpot={distanceToSpot}
        setDistanceToSpot={setDistanceToSpot}
        setManualConfirm={setManualConfirm}
        manualConfirm={manualConfirm}
        isWithinRange={isWithinRange}
        canProceed={canProceed}
        handleGoLiveConfirmed={handleGoLiveConfirmed}
        locationError={locationError}
        REQUIRED_DISTANCE_MILES={REQUIRED_DISTANCE_MILES}
        NEARBY_RADIUS_MILES={NEARBY_RADIUS_MILES}
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
        borderClass={borderClass}
        inputBgClass={inputBgClass}
      />

      {/* Pricing Modal - Extracted to sessions/SessionPricingModals.js */}
      <SessionPricingModal
        isOpen={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        pricing={pricing}
        setPricing={setPricing}
        handleSavePricing={handleSavePricing}
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
        borderClass={borderClass}
        inputBgClass={inputBgClass}
      />

      {/* Gallery Created Modal - Extracted to sessions/SessionPricingModals.js */}
      <GalleryCreatedModal
        isOpen={showGalleryCreatedModal}
        onClose={() => setShowGalleryCreatedModal(false)}
        lastCreatedGallery={lastCreatedGallery}
        navigate={navigate}
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
        borderClass={borderClass}
      />

      {/* Photo Upload Modal */}
      <PhotoUploadModal
        isOpen={showPhotoUpload}
        onClose={() => setShowPhotoUpload(false)}
        sessionId={currentSession?.live_session_id}
        galleryId={null}
        participants={currentSession?.participants || []}
        sessionPricing={{
          live_photo_price: sessionSettings.live_photo_price,
          general_photo_price: sessionSettings.general_photo_price
        }}
        onSuccess={(data) => {
          toast.success(`Uploaded ${data.uploaded} photos!`);
          setShowPhotoUpload(false);
        }}
      />

      {/* Conditions Modal - Go Live Gatekeeper */}
      <ConditionsModal
        isOpen={showConditionsModal}
        onClose={() => setShowConditionsModal(false)}
        onConfirm={handleGoLiveWithConditions}
        spotName={surfSpots.find(s => s.id === sessionSettings.surf_spot_id)?.name || 'Selected Spot'}
        isLoading={goLiveLoading}
      />

      {/* End Session Modal - Kill Switch */}
      <EndSessionModal
        isOpen={showEndSessionModal}
        onClose={() => setShowEndSessionModal(false)}
        onConfirm={handleEndSessionConfirmed}
        session={currentSession}
        isLoading={endSessionLoading}
      />
    </div>
  );
};
